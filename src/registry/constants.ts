import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import fs from "fs-extra";
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
 * Consumer registry state root.
 */
export const getConsumerRegistryProjectsDir = () =>
  join(getStoreMainDir(), "projects");

/**
 * Legacy in-project consumer state file.
 */
export const getLegacyConsumerRegistryStatePath = (workingDir: string) =>
  join(workingDir, VALUES.nalcStateFolder, "state.json");

/**
 * Consumer state directory for registry mode.
 */
export const getConsumerRegistryStateDir = (workingDir: string) => {
  const normalizedPath = getNormalizedProjectPath(workingDir);
  const projectName = sanitizePathSegment(basename(normalizedPath));
  const pathHash = createHash("sha1")
    .update(normalizedPath)
    .digest("hex")
    .slice(0, 12);

  return join(
    getConsumerRegistryProjectsDir(),
    `${projectName || "project"}__${pathHash}`,
  );
};

/**
 * Consumer state file for registry mode.
 */
export const getConsumerRegistryStatePath = (workingDir: string) =>
  join(getConsumerRegistryStateDir(workingDir), "state.json");

/**
 * Global state file for registry mode.
 */
export const getGlobalRegistryStatePath = () =>
  join(getStoreMainDir(), "state.json");

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

const getNormalizedProjectPath = (workingDir: string) => {
  const resolvedPath = resolve(workingDir);
  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
};

const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
