import fs from "fs-extra";
import { dirname, join } from "node:path";
import {
  getConsumerRegistryStatePath,
  getGlobalRegistryStatePath,
} from "./constants";
import type { ConsumerRegistryState, GlobalRegistryState } from "./types";
import { VALUES } from "../constant";

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
  const filePath = getConsumerRegistryStatePath(workingDir);
  try {
    const state = fs.readJSONSync(filePath) as ConsumerRegistryState;
    return state.version === 1 ? state : createEmptyConsumerState();
  } catch {
    return createEmptyConsumerState();
  }
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
};

/**
 * Remove the consumer-local nalc state and drop the directory when it becomes empty.
 */
export const removeConsumerRegistryState = (workingDir: string) => {
  const filePath = getConsumerRegistryStatePath(workingDir);
  fs.removeSync(filePath);

  const stateDir = join(workingDir, VALUES.nalcStateFolder);
  if (fs.existsSync(stateDir) && fs.readdirSync(stateDir).length === 0) {
    fs.removeSync(stateDir);
  }
};
