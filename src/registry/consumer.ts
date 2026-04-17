import { join } from "node:path";
import fs from "fs-extra";
import {
  type PackageManifest,
  readPackageManifest,
  writePackageManifest,
} from "../pkg";
import { getPm, runPmInstall } from "../pm";
import {
  addTrackedConsumers,
  readConsumerRegistryState,
  readGlobalRegistryState,
  removeConsumerRegistryState,
  removeTrackedConsumers,
  writeConsumerRegistryState,
} from "./state";
import { runRegistryInstall } from "./pm";
import { refreshConsumerProjectGraph } from "./project-graph";
import { ensureRegistryRuntime } from "./runtime";
import type {
  ConsumerRegistryPackageState,
  ConsumerRegistryState,
  DependencyField,
} from "./types";

export interface RegistryConsumerOptions {
  workingDir: string;
  dev?: boolean;
  all?: boolean;
}

export interface RegistryUpdateResult {
  workingDir: string;
  packageNames: string[];
  registryUrl?: string;
  updated: boolean;
}

export interface RegistryPushResult {
  packageNames: string[];
  consumers: RegistryUpdateResult[];
}

const LOCAL_REGISTRY_VERSION_RE =
  /^(?:[~^])?.*-(?:nalc)\.\d{8}(?:\d{6})?\.[0-9a-f]{8}$/;

/**
 * Add packages from the local registry into a consumer project.
 */
export const addRegistryPackages = async (
  packages: string[],
  options: RegistryConsumerOptions,
) => {
  if (!packages.length) {
    return;
  }

  const pkg = readPackageManifest(options.workingDir);
  if (!pkg) {
    return;
  }

  const globalState = readGlobalRegistryState();
  const runtime = await ensureRegistryRuntime({
    port: globalState.runtime?.port,
  });

  const consumerState = readConsumerRegistryState(options.workingDir);
  consumerState.packageManager = getPm(
    options.workingDir,
    consumerState.packageManager,
  );
  reconcileConsumerState(pkg, consumerState, globalState, runtime.url);

  packages.forEach((packageName) => {
    const publishedPkg = globalState.packages[packageName];
    if (!publishedPkg) {
      throw new Error(
        `[${packageName}] has not been published to the local registry yet.`,
      );
    }

    consumerState.packages[packageName] = upsertConsumerDependency(
      pkg,
      packageName,
      publishedPkg.localVersion,
      publishedPkg.sourcePath,
      runtime.url,
      options.dev,
      consumerState.packages[packageName],
    );
  });

  installTrackedRegistryState(
    options.workingDir,
    pkg,
    consumerState,
    runtime.url,
  );
  writeConsumerRegistryState(options.workingDir, consumerState);
  addTrackedConsumers(options.workingDir, packages);
};

/**
 * Update registry-managed packages to the latest locally published versions.
 */
export const updateRegistryPackages = async (
  packages: string[],
  options: RegistryConsumerOptions,
): Promise<RegistryUpdateResult> => {
  const consumerState = readConsumerRegistryState(options.workingDir);
  consumerState.packageManager = getPm(
    options.workingDir,
    consumerState.packageManager,
  );
  const packageNames = Array.from(
    new Set(
      (packages.length ? packages : Object.keys(consumerState.packages)).sort(
        (left, right) => left.localeCompare(right),
      ),
    ),
  );
  if (!packageNames.length) {
    console.log(
      `[nalc:update] ${options.workingDir} has no tracked packages to update.`,
    );
    return {
      workingDir: options.workingDir,
      packageNames: [],
      updated: false,
    };
  }

  const pkg = readPackageManifest(options.workingDir);
  if (!pkg) {
    console.log(
      `[nalc:update] ${options.workingDir} is not a package project, skipping.`,
    );
    return {
      workingDir: options.workingDir,
      packageNames,
      updated: false,
    };
  }

  const globalState = readGlobalRegistryState();
  const runtime = await ensureRegistryRuntime({
    port: globalState.runtime?.port,
  });

  reconcileConsumerState(pkg, consumerState, globalState, runtime.url);
  packageNames.forEach((packageName) => {
    const consumerEntry = consumerState.packages[packageName];
    if (!consumerEntry) {
      throw new Error(`[${packageName}] is not tracked in consumer state.`);
    }
    applyLatestRegistryVersion(
      consumerState,
      globalState,
      runtime.url,
      packageName,
    );
  });

  console.log(`[nalc:update] project: ${options.workingDir}`);
  console.log(`[nalc:update] registry: ${runtime.url}`);
  packageNames.forEach((packageName) => {
    const consumerEntry = consumerState.packages[packageName];
    console.log(
      `[nalc:update]   - ${packageName} -> ${consumerEntry.localSpec}`,
    );
  });

  installTrackedRegistryState(
    options.workingDir,
    pkg,
    consumerState,
    runtime.url,
  );
  writeConsumerRegistryState(options.workingDir, consumerState);
  console.log(
    `[nalc:update] updated ${packageNames.length} package(s) in ${options.workingDir}`,
  );
  return {
    workingDir: options.workingDir,
    packageNames,
    registryUrl: runtime.url,
    updated: true,
  };
};

/**
 * Remove tracked local package overrides while keeping the consumer in nalc mode.
 */
export const removeRegistryPackages = async (
  packages: string[],
  options: RegistryConsumerOptions,
) => {
  const consumerState = readConsumerRegistryState(options.workingDir);
  consumerState.packageManager = getPm(
    options.workingDir,
    consumerState.packageManager,
  );
  const globalState = readGlobalRegistryState();
  const packageNames = packages.length
    ? packages
    : options.all
      ? Object.keys(consumerState.packages)
      : [];
  if (!packageNames.length) {
    return;
  }

  const pkg = readPackageManifest(options.workingDir);
  if (!pkg) {
    return;
  }

  reconcileConsumerState(pkg, consumerState, globalState);
  packageNames.forEach((packageName) => {
    const consumerEntry = consumerState.packages[packageName];
    if (!consumerEntry) {
      return;
    }
    restoreDependencyValue(pkg, packageName, consumerEntry);
    delete consumerState.packages[packageName];
  });

  await reinstallConsumerManifest(
    options.workingDir,
    pkg,
    consumerState,
    packageNames,
  );
  writeConsumerRegistryState(options.workingDir, consumerState);
  removeTrackedConsumers(options.workingDir, packageNames);
};

/**
 * Fully exit nalc mode for the current consumer.
 */
export const passRegistryConsumer = async (workingDir: string) => {
  const consumerState = readConsumerRegistryState(workingDir);
  consumerState.packageManager = getPm(workingDir, consumerState.packageManager);
  const packageNames = Object.keys(consumerState.packages);

  if (!packageNames.length) {
    removeConsumerRegistryState(workingDir);
    refreshConsumerProjectGraph(workingDir, consumerState.packageManager);
    return;
  }

  const pkg = readPackageManifest(workingDir);
  if (!pkg) {
    return;
  }

  reconcileConsumerState(pkg, consumerState, readGlobalRegistryState());
  packageNames.forEach((packageName) => {
    restoreDependencyValue(pkg, packageName, consumerState.packages[packageName]);
    delete consumerState.packages[packageName];
  });

  await reinstallConsumerManifest(workingDir, pkg, consumerState, packageNames);
  removeTrackedConsumers(workingDir, packageNames);
  removeConsumerRegistryState(workingDir);
};

/**
 * Push the latest published versions into tracked consumer projects.
 */
export const pushRegistryPackages = async (packages: string[]) => {
  const globalState = readGlobalRegistryState();
  const packageNames = Array.from(
    new Set(
      (packages.length ? packages : Object.keys(globalState.consumers)).sort(
        (left, right) => left.localeCompare(right),
      ),
    ),
  );
  if (!packageNames.length) {
    console.log("[nalc:push] no tracked consumer packages to update.");
    return {
      packageNames: [],
      consumers: [],
    } satisfies RegistryPushResult;
  }

  const consumerPackagesMap = new Map<string, string[]>();
  packageNames.forEach((packageName) => {
    const trackedConsumers = globalState.consumers[packageName] || [];
    trackedConsumers.forEach((workingDir) => {
      const trackedPackages = consumerPackagesMap.get(workingDir) || [];
      if (!trackedPackages.includes(packageName)) {
        trackedPackages.push(packageName);
      }
      consumerPackagesMap.set(workingDir, trackedPackages);
    });
  });

  console.log(
    `[nalc:push] target packages: ${packageNames.join(", ") || "(none)"}`,
  );

  const consumers = Array.from(consumerPackagesMap.entries()).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  if (!consumers.length) {
    console.log("[nalc:push] no tracked consumers matched the selected packages.");
    return {
      packageNames,
      consumers: [],
    } satisfies RegistryPushResult;
  }

  const results: RegistryUpdateResult[] = [];
  for (const [workingDir, trackedPackages] of consumers) {
    const sortedTrackedPackages = trackedPackages.sort((left, right) =>
      left.localeCompare(right),
    );
    console.log(
      `[nalc:push] project: ${workingDir} <- ${sortedTrackedPackages.join(", ")}`,
    );
    results.push(
      await updateRegistryPackages(sortedTrackedPackages, { workingDir }),
    );
  }

  console.log(
    `[nalc:push] updated ${results.length} consumer project(s).`,
  );
  return {
    packageNames,
    consumers: results,
  } satisfies RegistryPushResult;
};

/**
 * Apply the latest local registry versions to the manifest and consumer state.
 */
const applyLatestRegistryVersion = (
  consumerState: ConsumerRegistryState,
  globalState: ReturnType<typeof readGlobalRegistryState>,
  registryUrl: string,
  packageName: string,
) => {
  const consumerEntry = consumerState.packages[packageName];
  if (!consumerEntry) {
    throw new Error(`Package ${packageName} is not tracked in consumer state.`);
  }
  const publishedPkg = globalState.packages[packageName];
  if (!publishedPkg) {
    throw new Error(
      `Package ${packageName} has not been published to the local registry yet.`,
    );
  }

  consumerState.packages[packageName] = {
    ...consumerEntry,
    localSpec: publishedPkg.localVersion,
    manifestSpec: createManifestLocalSpec(publishedPkg.localVersion),
    sourcePath: publishedPkg.sourcePath,
    registryUrl,
    installedAt: new Date().toISOString(),
  };
};

/**
 * Materialize the tracked local versions into package.json and install them.
 */
const installTrackedRegistryState = (
  workingDir: string,
  pkg: PackageManifest,
  consumerState: ConsumerRegistryState,
  registryUrl: string,
) => {
  const manifest = clonePackageManifest(pkg);
  restoreTrackedDependencyValues(manifest, consumerState);
  applyTrackedDependencyValues(manifest, consumerState);

  writePackageManifest(workingDir, manifest);
  runRegistryInstall(workingDir, registryUrl, consumerState.packageManager);
  syncInstalledLocalSpecs(workingDir, consumerState);
  cleanupStaleTrackedPnpmInstances(workingDir, consumerState);
  refreshConsumerProjectGraph(workingDir, consumerState.packageManager);
};

/**
 * Reinstall the consumer after restoring one or more packages back to their
 * normal dependency specs.
 */
const reinstallConsumerManifest = async (
  workingDir: string,
  pkg: PackageManifest,
  consumerState: ConsumerRegistryState,
  removedPackageNames: string[],
) => {
  if (Object.keys(consumerState.packages).length) {
    const runtime = await ensureRegistryRuntime({
      port: readGlobalRegistryState().runtime?.port,
    });
    installTrackedRegistryState(workingDir, pkg, consumerState, runtime.url);
    cleanupRemovedTrackedPnpmInstances(workingDir, removedPackageNames);
    return;
  }

  writePackageManifest(workingDir, pkg);
  runPmInstall(workingDir, consumerState.packageManager);
  cleanupRemovedTrackedPnpmInstances(workingDir, removedPackageNames);
  refreshConsumerProjectGraph(workingDir, consumerState.packageManager);
};

/**
 * Read back the exact installed nalc versions after install.
 */
const syncInstalledLocalSpecs = (
  workingDir: string,
  consumerState: ConsumerRegistryState,
) => {
  const lockfileVersions = readTrackedLocalSpecsFromPnpmLockfile(
    workingDir,
    consumerState,
  );

  Object.entries(consumerState.packages).forEach(([packageName, entry]) => {
    const lockfileVersion = lockfileVersions[packageName];
    if (isLocalRegistryVersion(lockfileVersion)) {
      entry.localSpec = normalizeResolvedVersion(lockfileVersion)!;
      return;
    }

    const packageJsonPath = join(
      workingDir,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    if (!fs.existsSync(packageJsonPath)) {
      return;
    }

    const installedVersion = fs.readJSONSync(packageJsonPath).version;
    if (!isLocalRegistryVersion(installedVersion)) {
      return;
    }

    entry.localSpec = installedVersion;
  });
};

/**
 * Read the currently resolved exact versions for tracked packages from the
 * pnpm importer section.
 */
const readTrackedLocalSpecsFromPnpmLockfile = (
  workingDir: string,
  consumerState: ConsumerRegistryState,
) => {
  const lockfilePath = join(workingDir, "pnpm-lock.yaml");
  if (!fs.existsSync(lockfilePath)) {
    return {} as Record<string, string | undefined>;
  }

  const lockfileContent = fs.readFileSync(lockfilePath, "utf8");
  const importersSection =
    lockfileContent.split("\npackages:\n")[0] || lockfileContent;
  const lines = importersSection.split("\n");
  const versions = {} as Record<string, string | undefined>;

  Object.keys(consumerState.packages).forEach((packageName) => {
    const packageLine = `'${packageName}':`;
    const packageIndex = lines.findIndex((line) => line.trim() === packageLine);
    if (packageIndex === -1) {
      return;
    }

    for (const line of lines.slice(packageIndex + 1, packageIndex + 6)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("version:")) {
        continue;
      }

      versions[packageName] = normalizeResolvedVersion(
        trimmed.slice("version:".length).trim(),
      );
      return;
    }
  });

  return versions;
};

/**
 * Remove stale nalc package instances that are no longer referenced by the
 * current tracked exact versions.
 */
const cleanupStaleTrackedPnpmInstances = (
  workingDir: string,
  consumerState: ConsumerRegistryState,
) => {
  const pnpmDir = join(workingDir, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) {
    return;
  }

  Object.entries(consumerState.packages).forEach(([packageName, entry]) => {
    if (!isLocalRegistryVersion(entry.localSpec)) {
      return;
    }

    const packageDirPrefix = `${packageName.replace(/\//g, "+")}@`;
    const expectedPrefix = `${packageDirPrefix}${entry.localSpec}`;
    fs.readdirSync(pnpmDir).forEach((dirName) => {
      if (!dirName.startsWith(packageDirPrefix)) {
        return;
      }
      if (dirName.startsWith(expectedPrefix)) {
        return;
      }

      fs.removeSync(join(pnpmDir, dirName));
    });
  });
};

/**
 * Remove all nalc-owned pnpm instances for packages that were just restored.
 */
const cleanupRemovedTrackedPnpmInstances = (
  workingDir: string,
  packageNames: string[],
) => {
  const pnpmDir = join(workingDir, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) {
    return;
  }

  packageNames.forEach((packageName) => {
    const packageDirPrefix = `${packageName.replace(/\//g, "+")}@`;
    fs.readdirSync(pnpmDir).forEach((dirName) => {
      if (!dirName.startsWith(packageDirPrefix)) {
        return;
      }

      const resolvedVersion = dirName.slice(packageDirPrefix.length).split("_")[0];
      if (!isLocalRegistryVersion(resolvedVersion)) {
        return;
      }

      fs.removeSync(join(pnpmDir, dirName));
    });
  });
};

/**
 * Apply tracked local versions to a manifest.
 */
const applyTrackedDependencyValues = (
  pkg: PackageManifest,
  consumerState: ConsumerRegistryState,
) => {
  Object.entries(consumerState.packages).forEach(([packageName, entry]) => {
    setDependencyValue(
      pkg,
      entry.dependencyType,
      packageName,
      entry.manifestSpec || entry.localSpec,
    );
  });
};

/**
 * Reset tracked packages back to their original dependency specs.
 */
const restoreTrackedDependencyValues = (
  pkg: PackageManifest,
  consumerState: ConsumerRegistryState,
) => {
  Object.entries(consumerState.packages).forEach(([packageName, entry]) => {
    restoreDependencyValue(pkg, packageName, entry);
  });
};

/**
 * Clone a package manifest so install planning can derive variants safely.
 */
const clonePackageManifest = (pkg: PackageManifest): PackageManifest =>
  JSON.parse(JSON.stringify(pkg)) as PackageManifest;

/**
 * Refresh tracked consumer entries from the current manifest.
 */
const reconcileConsumerState = (
  pkg: PackageManifest,
  consumerState: ConsumerRegistryState,
  globalState: ReturnType<typeof readGlobalRegistryState>,
  registryUrl?: string,
) => {
  Object.entries(consumerState.packages).forEach(
    ([packageName, consumerEntry]) => {
      const located = findDependency(pkg, packageName);
      if (!located.dependencyType) {
        return;
      }

      const manifestLocalSpec = isLocalRegistryVersion(located.spec)
        ? located.spec
        : consumerEntry.manifestSpec ||
          createManifestLocalSpec(consumerEntry.localSpec);
      const publishedPkg = globalState.packages[packageName];

      consumerState.packages[packageName] = {
        ...consumerEntry,
        dependencyType: located.dependencyType,
        manifestSpec: manifestLocalSpec,
        sourcePath: publishedPkg?.sourcePath || consumerEntry.sourcePath,
        registryUrl: registryUrl || consumerEntry.registryUrl,
      };
    },
  );
};

/**
 * Add or update a single dependency entry in package.json and consumer state.
 */
const upsertConsumerDependency = (
  pkg: PackageManifest,
  packageName: string,
  localVersion: string,
  sourcePath: string,
  registryUrl: string,
  dev: boolean | undefined,
  existingEntry?: ConsumerRegistryPackageState,
): ConsumerRegistryPackageState => {
  const located = findDependency(pkg, packageName);
  const dependencyType =
    (dev ? "devDependencies" : located.dependencyType) || "dependencies";
  const originalSpec =
    existingEntry?.originalSpec !== undefined
      ? existingEntry.originalSpec
      : located.spec;

  setDependencyValue(
    pkg,
    dependencyType,
    packageName,
    createManifestLocalSpec(localVersion),
  );

  return {
    dependencyType,
    originalSpec,
    localSpec: localVersion,
    manifestSpec: createManifestLocalSpec(localVersion),
    sourcePath,
    registryUrl,
    installedAt: new Date().toISOString(),
  };
};

/**
 * Locate a dependency across the supported dependency fields.
 */
const findDependency = (pkg: PackageManifest, packageName: string) => {
  const fields: DependencyField[] = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ];
  for (const dependencyType of fields) {
    const spec = pkg[dependencyType]?.[packageName];
    if (spec) {
      return {
        dependencyType,
        spec,
      };
    }
  }
  return {
    dependencyType: undefined,
    spec: undefined,
  };
};

/**
 * Convert an exact local prerelease into the persisted package.json spec.
 */
const createManifestLocalSpec = (localVersion: string) => localVersion;

/**
 * Strip peer suffixes from resolved lockfile versions such as
 * `1.0.0(@peer/a@1.0.0)`.
 */
const normalizeResolvedVersion = (version: string | undefined) =>
  version?.trim().split("(")[0];

/**
 * Check whether a dependency spec is a nalc-managed local prerelease version.
 */
const isLocalRegistryVersion = (spec: string | undefined) =>
  !!normalizeResolvedVersion(spec) &&
  LOCAL_REGISTRY_VERSION_RE.test(normalizeResolvedVersion(spec)!);

/**
 * Set a dependency value in package.json and remove duplicates from other fields.
 */
const setDependencyValue = (
  pkg: PackageManifest,
  dependencyType: DependencyField,
  packageName: string,
  value: string,
) => {
  const fields: DependencyField[] = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ];
  fields.forEach((fieldName) => {
    if (!pkg[fieldName]) {
      return;
    }
    if (fieldName !== dependencyType) {
      delete pkg[fieldName]![packageName];
    }
  });

  const targetField = pkg[dependencyType] || {};
  targetField[packageName] = value;
  pkg[dependencyType] = targetField;
};

/**
 * Restore the original dependency spec or remove the dependency if none existed.
 */
const restoreDependencyValue = (
  pkg: PackageManifest,
  packageName: string,
  consumerEntry: ConsumerRegistryPackageState,
) => {
  const currentField = pkg[consumerEntry.dependencyType];
  if (currentField) {
    delete currentField[packageName];
    if (!Object.keys(currentField).length) {
      delete pkg[consumerEntry.dependencyType];
    }
  }

  if (consumerEntry.originalSpec) {
    const restoredField = pkg[consumerEntry.dependencyType] || {};
    restoredField[packageName] = consumerEntry.originalSpec;
    pkg[consumerEntry.dependencyType] = restoredField;
  }
};
