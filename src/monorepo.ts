import path, { dirname, parse, resolve } from "node:path";
import fs from "fs-extra";
import glob from "fast-glob";
import { readPackageManifest, PackageManifest } from "./pkg";
import { parseWorkspaceYaml } from "./catalog";

export interface WorkspacePackage {
  name: string;
  version: string;
  path: string;
  private: boolean;
  manifest: PackageManifest;
}

const findWorkspaceRoot = (startDir: string): string | null => {
  let currentDir = resolve(startDir);
  const root = parse(currentDir).root;

  while (true) {
    const pnpmWorkspacePath = path.join(currentDir, "pnpm-workspace.yaml");
    if (fs.existsSync(pnpmWorkspacePath)) {
      return currentDir;
    }

    const pkgPath = path.join(currentDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = fs.readJsonSync(pkgPath);
        if (
          Array.isArray(pkg.workspaces) ||
          (pkg.workspaces && Array.isArray((pkg.workspaces as any).packages))
        ) {
          return currentDir;
        }
      } catch (e) {
        console.warn("解析 package.json workspaces 失败:", e);
      }
    }

    if (currentDir === root) {
      return null;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
};

const getWorkspaceDependencyNames = (
  pkg: WorkspacePackage,
  workspaceNames: Set<string>,
) => {
  const dependencyFields = [
    pkg.manifest.dependencies,
    pkg.manifest.optionalDependencies,
  ];

  const names = new Set<string>();
  for (const deps of dependencyFields) {
    if (!deps) continue;
    Object.keys(deps).forEach((depName) => {
      if (workspaceNames.has(depName)) {
        names.add(depName);
      }
    });
  }

  return names;
};

/**
 * 查找 Monorepo 下的所有包
 * @param root 项目根目录
 * @returns 找到的包列表
 */
export const findWorkspacePackages = async (
  root: string,
): Promise<WorkspacePackage[]> => {
  const workspaceRoot = findWorkspaceRoot(root);
  if (!workspaceRoot) {
    return [];
  }

  let patterns: string[] = [];

  // 1. 尝试读取 pnpm-workspace.yaml
  const pnpmWorkspacePath = path.join(workspaceRoot, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWorkspacePath)) {
    try {
      const content = fs.readFileSync(pnpmWorkspacePath, "utf-8");
      const config = parseWorkspaceYaml(content);
      if (config && config.packages && Array.isArray(config.packages)) {
        patterns = config.packages;
      }
    } catch (e) {
      console.warn("解析 pnpm-workspace.yaml 失败:", e);
    }
  }

  // 2. 如果没有 pnpm-workspace.yaml，尝试读取 package.json 中的 workspaces
  if (patterns.length === 0) {
    const pkgPath = path.join(workspaceRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = fs.readJsonSync(pkgPath);
        if (Array.isArray(pkg.workspaces)) {
          patterns = pkg.workspaces;
        } else if (
          pkg.workspaces &&
          Array.isArray((pkg.workspaces as any).packages)
        ) {
          // 处理 yarn workspaces 对象格式
          patterns = (pkg.workspaces as any).packages;
        }
      } catch (e) {
        console.warn("解析 package.json workspaces 失败:", e);
      }
    }
  }

  // 如果没有找到任何 workspace 配置，假设不处于 monorepo 环境或无需处理
  if (patterns.length === 0) {
    return [];
  }

  // 3. 使用 fast-glob 扫描包目录
  const entries = await glob(patterns, {
    cwd: workspaceRoot,
    onlyDirectories: true,
    absolute: true,
    ignore: ["**/node_modules/**"],
  });

  const packages: WorkspacePackage[] = [];

  for (const entry of entries) {
    const pkg = readPackageManifest(entry);
    if (pkg && pkg.name) {
      packages.push({
        name: pkg.name,
        version: pkg.version || "0.0.0",
        path: entry,
        private: pkg.private || false,
        manifest: pkg,
      });
    }
  }

  return packages;
};

/**
 * Sort workspace packages so local runtime dependencies are published first.
 */
export const sortWorkspacePackagesByDependencyOrder = (
  packages: WorkspacePackage[],
): WorkspacePackage[] => {
  const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const workspaceNames = new Set(packageMap.keys());
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();

  packages.forEach((pkg) => {
    inDegree.set(pkg.name, 0);
    dependents.set(pkg.name, new Set());
  });

  packages.forEach((pkg) => {
    const dependencyNames = getWorkspaceDependencyNames(pkg, workspaceNames);
    dependencyNames.forEach((dependencyName) => {
      inDegree.set(pkg.name, (inDegree.get(pkg.name) || 0) + 1);
      dependents.get(dependencyName)?.add(pkg.name);
    });
  });

  const ready = packages
    .filter((pkg) => (inDegree.get(pkg.name) || 0) === 0)
    .sort((a, b) => a.path.localeCompare(b.path));
  const sorted: WorkspacePackage[] = [];

  while (ready.length) {
    const next = ready.shift()!;
    sorted.push(next);

    const nextDependents = Array.from(dependents.get(next.name) || []).sort();
    nextDependents.forEach((dependentName) => {
      const remaining = (inDegree.get(dependentName) || 0) - 1;
      inDegree.set(dependentName, remaining);
      if (remaining === 0) {
        const dependentPkg = packageMap.get(dependentName);
        if (dependentPkg) {
          ready.push(dependentPkg);
          ready.sort((a, b) => a.path.localeCompare(b.path));
        }
      }
    });
  }

  if (sorted.length === packages.length) {
    return sorted;
  }

  return packages.slice().sort((a, b) => a.path.localeCompare(b.path));
};

/**
 * 解析 Monorepo 中的 workspace 协议依赖版本
 * @param packageName 依赖包名
 * @param range 依赖范围 (例如 "workspace:^1.2.3" 或 "workspace:*")
 * @param workspacePackages 所有 workspace 包的列表
 * @returns 解析后的实际版本号 (例如 "^1.2.3" 或 "1.0.0")，如果无法解析则返回 null
 */
export const resolveWorkspaceVersion = (
  packageName: string,
  range: string,
  workspacePackages: WorkspacePackage[],
): string | null => {
  const targetPkg = workspacePackages.find((p) => p.name === packageName);
  if (!targetPkg) {
    return null;
  }

  // 处理 "workspace:*" -> 具体的版本号
  if (range === "workspace:*") {
    return targetPkg.version;
  }

  // 处理 "workspace:^" -> ^ + 具体的版本号
  if (range === "workspace:^") {
    return "^" + targetPkg.version;
  }

  // 处理 "workspace:~" -> ~ + 具体的版本号
  if (range === "workspace:~") {
    return "~" + targetPkg.version;
  }

  // 处理 "workspace:1.2.3", "workspace:^1.2.3" 等 -> 转换为语义化版本 range
  if (range.startsWith("workspace:")) {
    const semverRange = range.replace("workspace:", "");

    // 如果是空字符串 (workspace:)，返回版本号
    if (semverRange === "") {
      return targetPkg.version;
    }

    // 如果是路径引用 (包含 / 或以 . 开头)，转为版本依赖
    if (semverRange.includes("/") || semverRange.startsWith(".")) {
      return targetPkg.version;
    }

    // 否则直接返回提取出的 semver range (如 ^1.2.3, ~1.2.3, 1.2.3)
    return semverRange;
  }

  return null;
};
