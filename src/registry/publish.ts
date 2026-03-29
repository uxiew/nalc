import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fs from "fs-extra";
import { packAsList } from "@publint/pack";
import pc from "picocolors";
import {
  readCatalogConfig,
  resolveCatalogDependency,
  isCatalogDependency,
} from "../catalog";
import {
  findWorkspacePackages,
  resolveWorkspaceVersion,
  type WorkspacePackage,
} from "../monorepo";
import { getPm, pmRunScriptCmd } from "../pm";
import {
  type PackageManifest,
  type PackageScripts,
  readPackageManifest,
} from "../pkg";
import type { PublishPackageOptions } from "../publish";
import { execLoudOptions } from "../utils";
import { REGISTRY_DIST_TAG } from "./constants";
import { pushRegistryPackages } from "./consumer";
import { ensureRegistryRuntime } from "./runtime";
import { readGlobalRegistryState, writeGlobalRegistryState } from "./state";
import { createBuildId, createRegistryPrereleaseVersion } from "./version";

/**
 * Publish a package into the local Verdaccio-backed registry.
 */
export const publishPackageToRegistry = async (
  options: PublishPackageOptions,
) => {
  const pkg = readPackageManifest(options.workingDir);
  if (!pkg) {
    return null;
  }

  if (options.ignore?.packages?.includes(pkg.name)) {
    console.log(`[${pkg.name}] is ignored.`);
    return null;
  }

  if (pkg.private && !options.private) {
    console.log(
      pc.yellow(
        "Will not publish package with `private: true`" +
          " use --private flag to force publishing.",
      ),
    );
    return null;
  }

  const runtime = await ensureRegistryRuntime();
  const pm = getPm(options.workingDir);

  runLifecycleScripts(pkg, options.workingDir, pm, options.scripts, [
    "prepublish",
    "prepare",
    "prepublishOnly",
    "prepack",
    "prenalcpublish",
  ]);

  const fileList = (await packAsList(options.workingDir)).map((filePath) =>
    filePath.replace(/^\.\//, ""),
  );

  if (options.content) {
    console.info("Files included in published content:");
    fileList.sort().forEach((filePath) => {
      console.log(`- ${filePath}`);
    });
    console.info(`Total ${fileList.length} files.`);
  }

  const globalState = readGlobalRegistryState();
  const preparedManifestBase = await prepareManifestForRegistry(
    pkg,
    options.workingDir,
    options,
    globalState,
  );
  const contentHash = computePublishHash(
    options.workingDir,
    fileList,
    preparedManifestBase,
  );
  const buildId = createBuildId(contentHash);
  const existingState = globalState.packages[pkg.name];

  const publishedAt = new Date();
  const localVersion = createRegistryPrereleaseVersion(
    pkg.version,
    buildId,
    publishedAt,
  );
  const preparedManifest = {
    ...preparedManifestBase,
    version: localVersion,
  };

  if (
    options.changed &&
    existingState &&
    existingState.contentHash === contentHash
  ) {
    console.warn(`[${pkg.name}] has not changed, skipping publishing.`);
    if (options.push) {
      await pushRegistryPackages([pkg.name]);
    }
    return existingState;
  }

  const tempDir = fs.mkdtempSync(join(tmpdir(), "nalc-registry-"));
  try {
    await copyPublishFiles(options.workingDir, tempDir, fileList);
    fs.writeJSONSync(join(tempDir, "package.json"), preparedManifest, {
      spaces: 2,
    });
    fs.writeFileSync(
      join(tempDir, ".npmrc"),
      createTemporaryNpmRc(runtime.url),
      "utf8",
    );

    execSync(
      `npm publish --tag ${REGISTRY_DIST_TAG} --registry=${runtime.url}`,
      {
        cwd: tempDir,
        ...execLoudOptions,
      },
    );
  } finally {
    fs.removeSync(tempDir);
  }

  runLifecycleScripts(pkg, options.workingDir, pm, options.scripts, [
    "postnalcpublish",
    "postpack",
  ]);

  const nextState = {
    sourcePath: options.workingDir,
    baseVersion: pkg.version,
    localVersion,
    distTag: REGISTRY_DIST_TAG,
    publishedAt: publishedAt.toISOString(),
    buildId,
    contentHash,
  };
  writeGlobalRegistryState({
    ...globalState,
    runtime,
    packages: {
      ...globalState.packages,
      [pkg.name]: nextState,
    },
    consumers: globalState.consumers || {},
  });

  console.log(`[${pkg.name}@${localVersion}] published in local registry.\n`);
  if (options.push) {
    await pushRegistryPackages([pkg.name]);
  }
  return nextState;
};

/**
 * Run the nalc publish lifecycle scripts through the active package manager.
 */
const runLifecycleScripts = (
  pkg: PackageManifest,
  workingDir: string,
  pm: ReturnType<typeof getPm>,
  scriptsEnabled: boolean | undefined,
  scripts: (keyof PackageScripts)[],
) => {
  if (!scriptsEnabled) {
    return;
  }

  scripts.forEach((scriptName) => {
    const scriptCmd = pkg.scripts?.[scriptName];
    if (!scriptCmd) {
      return;
    }
    console.log(`Running ${scriptName} script: ${pc.yellow(scriptCmd)}`);
    execSync(`${pmRunScriptCmd[pm]} ${scriptName}`, {
      cwd: workingDir,
      ...execLoudOptions,
    });
  });
};

/**
 * Prepare the manifest that gets published into the local registry.
 */
const prepareManifestForRegistry = async (
  pkg: PackageManifest,
  workingDir: string,
  options: PublishPackageOptions,
  globalState: ReturnType<typeof readGlobalRegistryState>,
) => {
  let nextPkg =
    options.devMod === false ? { ...pkg } : stripDevelopmentFields(pkg);
  nextPkg = stripPublishLifecycleScripts(nextPkg);
  if (options.workspaceResolve !== false) {
    nextPkg = await resolveLocalProtocols(nextPkg, workingDir, globalState);
  }
  nextPkg = applyPublishConfig(nextPkg);
  nextPkg.nalcSig = undefined;
  delete nextPkg.__Indent;
  return nextPkg;
};

/**
 * Remove fields that are only useful while developing the source package.
 */
const stripDevelopmentFields = (pkg: PackageManifest): PackageManifest => ({
  ...pkg,
  scripts: pkg.scripts
    ? {
        ...pkg.scripts,
        prepare: undefined,
        prepublish: undefined,
      }
    : undefined,
  devDependencies: undefined,
});

/**
 * Remove publish-time lifecycle scripts from the temporary manifest.
 */
const stripPublishLifecycleScripts = (
  pkg: PackageManifest,
): PackageManifest => ({
  ...pkg,
  scripts: pkg.scripts
    ? {
        ...pkg.scripts,
        prepublish: undefined,
        prepublishOnly: undefined,
        prepack: undefined,
        postpack: undefined,
        publish: undefined,
        postpublish: undefined,
        prenalcpublish: undefined,
        postnalcpublish: undefined,
      }
    : undefined,
});

/**
 * Resolve workspace: and catalog: references before publishing.
 */
const resolveLocalProtocols = async (
  pkg: PackageManifest,
  workingDir: string,
  globalState: ReturnType<typeof readGlobalRegistryState>,
): Promise<PackageManifest> => {
  const catalogConfig = readCatalogConfig(workingDir);
  const workspacePackages = await findWorkspacePackages(workingDir);
  const workspacePackageMap = new Map(
    workspacePackages.map((workspacePkg) => [workspacePkg.name, workspacePkg]),
  );

  const resolveVersion = (
    depName: string,
    version: string,
    dependencyField:
      | "dependencies"
      | "devDependencies"
      | "peerDependencies"
      | "optionalDependencies",
  ) => {
    if (isCatalogDependency(version)) {
      return resolveCatalogDependency(version, depName, catalogConfig);
    }

    const localWorkspaceVersion = resolveLocalWorkspaceVersion(
      depName,
      dependencyField,
      workspacePackageMap,
      globalState,
    );
    if (localWorkspaceVersion) {
      return localWorkspaceVersion;
    }

    if (version.startsWith("workspace:")) {
      const resolved = resolveWorkspaceVersion(
        depName,
        version,
        workspacePackages,
      );
      return resolved || "*";
    }

    return version;
  };

  const resolveDepsMap = (
    deps: PackageManifest["dependencies"],
    dependencyField:
      | "dependencies"
      | "devDependencies"
      | "peerDependencies"
      | "optionalDependencies",
  ) => {
    if (!deps) {
      return deps;
    }

    return Object.keys(deps).reduce<Record<string, string>>((acc, depName) => {
      acc[depName] = resolveVersion(depName, deps[depName], dependencyField);
      return acc;
    }, {});
  };

  return {
    ...pkg,
    dependencies: resolveDepsMap(pkg.dependencies, "dependencies"),
    devDependencies: resolveDepsMap(pkg.devDependencies, "devDependencies"),
    peerDependencies: resolveDepsMap(pkg.peerDependencies, "peerDependencies"),
    optionalDependencies: resolveDepsMap(
      pkg.optionalDependencies,
      "optionalDependencies",
    ),
  };
};

/**
 * Resolve a workspace dependency to the latest locally published version.
 */
const resolveLocalWorkspaceVersion = (
  depName: string,
  dependencyField:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies",
  workspacePackageMap: Map<string, WorkspacePackage>,
  globalState: ReturnType<typeof readGlobalRegistryState>,
) => {
  if (dependencyField === "peerDependencies") {
    return null;
  }

  if (!workspacePackageMap.has(depName)) {
    return null;
  }

  const publishedPkg = globalState.packages[depName];
  return publishedPkg?.localVersion || null;
};

/**
 * Apply the publishConfig field overrides that npm would honor during publish.
 */
const applyPublishConfig = (pkg: PackageManifest): PackageManifest => {
  if (!pkg.publishConfig) {
    return pkg;
  }

  const nextPkg: PackageManifest = {
    ...pkg,
  };
  const overrideFields: (keyof NonNullable<
    PackageManifest["publishConfig"]
  >)[] = ["main", "module", "exports", "types", "typings", "browser", "bin"];
  overrideFields.forEach((fieldName) => {
    if (pkg.publishConfig && pkg.publishConfig[fieldName] !== undefined) {
      (nextPkg as unknown as Record<string, unknown>)[fieldName] =
        pkg.publishConfig[fieldName];
    }
  });
  delete nextPkg.publishConfig;
  return nextPkg;
};

/**
 * Create a content hash from the publishable file set.
 */
const computePublishHash = (
  workingDir: string,
  fileList: string[],
  preparedManifest: PackageManifest,
) => {
  const hash = crypto.createHash("sha256");
  fileList
    .slice()
    .sort()
    .forEach((filePath) => {
      hash.update(filePath.replace(/\\/g, "/"));
      hash.update(fs.readFileSync(join(workingDir, filePath)));
    });
  hash.update(JSON.stringify(preparedManifest));
  return hash.digest("hex");
};

/**
 * Copy the publishable files into a temporary directory for npm publish.
 */
const copyPublishFiles = async (
  workingDir: string,
  tempDir: string,
  fileList: string[],
) => {
  await Promise.all(
    fileList.map(async (filePath) => {
      const sourcePath = join(workingDir, filePath);
      const destinationPath = join(tempDir, filePath);
      await fs.copy(sourcePath, destinationPath);
    }),
  );
};

/**
 * Create the temporary .npmrc required for anonymous local publishing.
 */
const createTemporaryNpmRc = (registryUrl: string) => {
  const normalizedRegistry = registryUrl.replace(/^https?:/i, "");
  return `${normalizedRegistry}/:_authToken="nalc"\n`;
};
