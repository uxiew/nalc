import { join } from "node:path";
import chokidar from "chokidar";
import fs from "fs-extra";
import {
  findWorkspacePackages,
  sortWorkspacePackagesByDependencyOrder,
} from "./monorepo";
import { publishPackage, type PublishPackageOptions } from "./publish";

const resolveTargetPackages = async (options: PublishPackageOptions) => {
  const workingDir = options.workingDir || process.cwd();
  const workspacePackages = await findWorkspacePackages(workingDir);
  const targetPackages = workspacePackages.filter(
    (pkg) => !options.ignore?.packages?.includes(pkg.name),
  );

  if (targetPackages.length) {
    return sortWorkspacePackagesByDependencyOrder(targetPackages);
  }

  if (!fs.existsSync(join(workingDir, "package.json"))) {
    throw new Error(`No package.json found in ${workingDir}`);
  }

  return [
    {
      name: fs.readJSONSync(join(workingDir, "package.json")).name as string,
      version: "",
      path: workingDir,
    },
  ];
};

/**
 * Detect a workspace and publish all packages through the registry pipeline.
 */
export const smartPublish = async (options: PublishPackageOptions) => {
  const targetPackages = await resolveTargetPackages(options);
  for (const pkg of targetPackages) {
    await publishPackage({
      ...options,
      workingDir: pkg.path,
      workspaceResolve: true,
    });
  }
};

/**
 * Watch packages and republish through the registry pipeline on change.
 */
export const watchPackages = async (options: PublishPackageOptions) => {
  const targetPackages = await resolveTargetPackages(options);
  const watchDirs = targetPackages.map((pkg) => pkg.path);
  let activeTimer: NodeJS.Timeout | undefined;

  const watcher = chokidar.watch(watchDirs, {
    ignored: ["**/node_modules/**", "**/.git/**", "**/.nalc/**", "**/*.log"],
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  const queuePublish = async (filePath: string) => {
    const pkgDir = watchDirs.find((dir) => filePath.startsWith(dir));
    if (!pkgDir) {
      return;
    }

    if (activeTimer) {
      clearTimeout(activeTimer);
    }

    activeTimer = setTimeout(async () => {
      activeTimer = undefined;
      await smartPublish({
        ...options,
        changed: true,
        push: true,
        workspaceResolve: true,
      });
    }, 750);
  };

  watcher.on("change", queuePublish);
  watcher.on("add", queuePublish);
  watcher.on("unlink", queuePublish);
};
