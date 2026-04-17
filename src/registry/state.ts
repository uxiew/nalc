import fs from "fs-extra";
import { dirname, join } from "node:path";
import {
  getConsumerRegistryProjectsDir,
  getConsumerRegistryStateDir,
  getConsumerRegistryStatePath,
  getGlobalRegistryStatePath,
  getLegacyConsumerRegistryStatePath,
  getRegistryHomeDir,
} from "./constants";
import type { ConsumerRegistryState, GlobalRegistryState } from "./types";
import { VALUES } from "../constant";
import { getStoreMainDir } from "../utils";

const createEmptyGlobalState = (): GlobalRegistryState => ({
  version: 1,
  packages: {},
  consumers: {},
});

const createEmptyConsumerState = (): ConsumerRegistryState => ({
  version: 1,
  packages: {},
});

/**
 * Read the global registry state from the nalc home directory.
 */
export const readGlobalRegistryState = (): GlobalRegistryState => {
  const filePath = getGlobalRegistryStatePath();
  try {
    const state = fs.readJSONSync(filePath) as GlobalRegistryState;
    return state.version === 1 ? state : createEmptyGlobalState();
  } catch {
    return createEmptyGlobalState();
  }
};

/**
 * Track a consumer project for one or more packages.
 */
export const addTrackedConsumers = (
  workingDir: string,
  packageNames: string[],
) => {
  const state = readGlobalRegistryState();
  packageNames.forEach((packageName) => {
    const tracked = state.consumers[packageName] || [];
    if (!tracked.includes(workingDir)) {
      state.consumers[packageName] = tracked.concat(workingDir);
    }
  });
  writeGlobalRegistryState(state);
};

/**
 * Remove a consumer project from the tracked package list.
 */
export const removeTrackedConsumers = (
  workingDir: string,
  packageNames: string[],
) => {
  const state = readGlobalRegistryState();
  packageNames.forEach((packageName) => {
    const tracked = (state.consumers[packageName] || []).filter(
      (entry) => entry !== workingDir,
    );
    if (tracked.length) {
      state.consumers[packageName] = tracked;
    } else {
      delete state.consumers[packageName];
    }
  });
  writeGlobalRegistryState(state);
};

/**
 * Persist the global registry state atomically enough for CLI usage.
 */
export const writeGlobalRegistryState = (state: GlobalRegistryState) => {
  const filePath = getGlobalRegistryStatePath();
  fs.ensureDirSync(dirname(filePath));
  fs.writeJSONSync(filePath, state, { spaces: 2 });
};

/**
 * Read the consumer-local registry state.
 */
export const readConsumerRegistryState = (
  workingDir: string,
): ConsumerRegistryState => {
  return (
    readConsumerRegistryStateFile(getConsumerRegistryStatePath(workingDir)) ||
    readConsumerRegistryStateFile(getLegacyConsumerRegistryStatePath(workingDir)) ||
    createEmptyConsumerState()
  );
};

/**
 * Persist the consumer-local registry state.
 */
export const writeConsumerRegistryState = (
  workingDir: string,
  state: ConsumerRegistryState,
) => {
  const filePath = getConsumerRegistryStatePath(workingDir);
  fs.ensureDirSync(dirname(filePath));
  fs.writeJSONSync(filePath, state, { spaces: 2 });
  removeLegacyConsumerRegistryState(workingDir);
};

/**
 * Remove the consumer-local nalc state and drop the directory when it becomes empty.
 */
export const removeConsumerRegistryState = (workingDir: string) => {
  fs.removeSync(getConsumerRegistryStatePath(workingDir));
  removeDirIfEmpty(getConsumerRegistryStateDir(workingDir));
  removeLegacyConsumerRegistryState(workingDir);
};

/**
 * Remove the whole nalc system store.
 */
export const destroyNalcStore = () => {
  fs.removeSync(getStoreMainDir());
};

/**
 * Build a user-friendly state report for the current directory and system store.
 */
export const describeNalcState = (workingDir: string) => {
  const packageSummary = readPackageSummary(workingDir);
  const consumerState = readConsumerRegistryState(workingDir);
  const systemStatePath = getConsumerRegistryStatePath(workingDir);
  const legacyStatePath = getLegacyConsumerRegistryStatePath(workingDir);
  const hasSystemState = fs.existsSync(systemStatePath);
  const hasLegacyState = fs.existsSync(legacyStatePath);
  const trackedPackages = Object.entries(consumerState.packages).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const isManagedProject =
    hasSystemState || hasLegacyState || trackedPackages.length > 0;
  const lines: string[] = [];

  if (isManagedProject || packageSummary) {
    lines.push("Current project state");
    lines.push(`- path: ${workingDir}`);
    if (packageSummary) {
      lines.push(
        `- package: ${packageSummary.name || "(unnamed)"}@${packageSummary.version || "(unknown)"}`,
      );
    }

    if (isManagedProject) {
      lines.push("- nalc: managing this project");
      lines.push(`- state file: ${systemStatePath}`);
      if (hasLegacyState && !hasSystemState) {
        lines.push(`- legacy state file detected: ${legacyStatePath}`);
      }
      if (consumerState.packageManager) {
        lines.push(`- package manager: ${consumerState.packageManager}`);
      }
      lines.push(
        `- registry address: ${getProjectRegistryAddress(consumerState) || "not recorded"}`,
      );
      lines.push(`- tracked packages: ${trackedPackages.length}`);
      trackedPackages.forEach(([packageName, entry]) => {
        lines.push(
          `  - ${packageName} -> ${entry.localSpec} [${entry.dependencyType}]`,
        );
      });
      return lines.join("\n");
    }

    lines.push("- nalc: not managing this project");
    lines.push(`- expected state file: ${systemStatePath}`);
    lines.push("");
  } else {
    lines.push(
      "Current directory is not a package project, showing nalc system state.",
    );
    lines.push("");
  }

  const globalState = readGlobalRegistryState();
  const trackedConsumers = getTrackedConsumerProjects(globalState);
  const storedProjectStates = listStoredProjectStates();
  lines.push("System nalc state");
  lines.push(`- home dir: ${getStoreMainDir()}`);
  lines.push(`- global state file: ${getGlobalRegistryStatePath()}`);
  lines.push(`- project states dir: ${getConsumerRegistryProjectsDir()}`);
  lines.push(`- registry dir: ${getRegistryHomeDir()}`);
  lines.push(
    globalState.runtime
      ? `- registry runtime: ${describeRuntime(globalState.runtime)}`
      : "- registry runtime: not recorded",
  );
  lines.push(
    `- registry address: ${globalState.runtime?.url || "not recorded"}`,
  );

  const publishedPackages = Object.entries(globalState.packages).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  lines.push(`- published packages: ${publishedPackages.length}`);
  publishedPackages.forEach(([packageName, entry]) => {
    lines.push(`  - ${packageName} -> ${entry.localVersion}`);
  });

  lines.push(`- tracked consumer projects: ${trackedConsumers.length}`);
  trackedConsumers.forEach(([projectPath, packageNames]) => {
    lines.push(`  - ${projectPath} (${packageNames.sort().join(", ")})`);
  });

  lines.push(`- saved project states: ${storedProjectStates.length}`);
  storedProjectStates.forEach((statePath) => {
    lines.push(`  - ${statePath}`);
  });

  return lines.join("\n");
};

const readConsumerRegistryStateFile = (filePath: string) => {
  try {
    const state = fs.readJSONSync(filePath) as ConsumerRegistryState;
    return state.version === 1 ? state : createEmptyConsumerState();
  } catch {
    return undefined;
  }
};

const removeLegacyConsumerRegistryState = (workingDir: string) => {
  const filePath = getLegacyConsumerRegistryStatePath(workingDir);
  fs.removeSync(filePath);

  const stateDir = join(workingDir, VALUES.nalcStateFolder);
  removeDirIfEmpty(stateDir);
};

const removeDirIfEmpty = (dirPath: string) => {
  if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
    fs.removeSync(dirPath);
  }
};

const readPackageSummary = (workingDir: string) => {
  const packageJsonPath = join(workingDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const pkg = fs.readJSONSync(packageJsonPath) as {
      name?: string;
      version?: string;
    };
    return {
      name: pkg.name,
      version: pkg.version,
    };
  } catch {
    return undefined;
  }
};

const describeRuntime = (runtime: NonNullable<GlobalRegistryState["runtime"]>) =>
  `${runtime.url} (pid ${runtime.pid}, storage ${runtime.storagePath})`;

const getProjectRegistryAddress = (state: ConsumerRegistryState) =>
  Object.values(state.packages)
    .map((entry) => entry.registryUrl)
    .find((registryUrl) => !!registryUrl);

const getTrackedConsumerProjects = (state: GlobalRegistryState) => {
  const projects = new Map<string, string[]>();
  Object.entries(state.consumers).forEach(([packageName, projectPaths]) => {
    projectPaths.forEach((projectPath) => {
      const existing = projects.get(projectPath) || [];
      if (!existing.includes(packageName)) {
        projects.set(projectPath, existing.concat(packageName));
      }
    });
  });

  return Array.from(projects.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
};

const listStoredProjectStates = () => {
  const projectsDir = getConsumerRegistryProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    return [] as string[];
  }

  return fs
    .readdirSync(projectsDir)
    .map((entry) => join(projectsDir, entry, "state.json"))
    .filter((statePath) => fs.existsSync(statePath))
    .sort((left, right) => left.localeCompare(right));
};
