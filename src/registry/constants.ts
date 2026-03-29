import { join } from "node:path";
import { VALUES } from "../constant";
import { getStoreMainDir } from "../utils";

/**
 * Registry dist-tag used for locally published builds.
 */
export const REGISTRY_DIST_TAG = "nalc";

/**
 * Registry runtime root.
 */
export const getRegistryHomeDir = () => join(getStoreMainDir(), "registry");

/**
 * Consumer state file for registry mode.
 */
export const getConsumerRegistryStatePath = (workingDir: string) =>
  join(workingDir, VALUES.nalcStateFolder, "state.json");

/**
 * Global state file for registry mode.
 */
export const getGlobalRegistryStatePath = () =>
  join(getRegistryHomeDir(), "state.json");

/**
 * Verdaccio config path managed by nalc.
 */
export const getRegistryConfigPath = () =>
  join(getRegistryHomeDir(), "verdaccio.yaml");

/**
 * Verdaccio storage path managed by nalc.
 */
export const getRegistryStoragePath = () =>
  join(getRegistryHomeDir(), "storage");
