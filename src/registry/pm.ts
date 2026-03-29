import { execSync } from "node:child_process";
import { execLoudOptions } from "../utils";
import { getPm, type PackageManagerName } from "../pm";

/**
 * Run the consumer package manager install command against the local registry.
 */
export const runRegistryInstall = (
  workingDir: string,
  registryUrl: string,
  fallbackPm?: PackageManagerName,
) => {
  const pm = getPm(workingDir, fallbackPm);
  switch (pm) {
    case "npm":
      execSync(`npm install --registry=${registryUrl} --legacy-peer-deps`, {
        cwd: workingDir,
        ...execLoudOptions,
      });
      return;
    case "pnpm":
      execSync(`pnpm install --registry=${registryUrl}`, {
        cwd: workingDir,
        ...execLoudOptions,
      });
      return;
    case "bun":
      execSync("bun install", {
        cwd: workingDir,
        env: {
          ...process.env,
          BUN_CONFIG_REGISTRY: registryUrl,
        },
        ...execLoudOptions,
      });
      return;
    case "yarn":
      throw new Error(
        "Registry mode does not support Yarn in phase 1. Use npm, pnpm or bun.",
      );
    default:
      throw new Error(`Unsupported package manager: ${pm}`);
  }
};
