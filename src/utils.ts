import { join } from "node:path";
import { ExecSyncOptions } from "node:child_process";
import { homedir } from "node:os";
import fs from "fs-extra";

import { VALUES, nalcGlobal } from "./constant";

const { myName, storeDirName, signatureFile, rcFile } = VALUES;

const userHome = homedir();

export interface UpdatePackagesOptions {
  safe?: boolean;
  workingDir: string;
}

/**
 * Get the nalc home directory.
 */
export function getStoreMainDir(): string {
  if (nalcGlobal.nalcHomeDir) {
    return nalcGlobal.nalcHomeDir;
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, storeDirName);
  }
  return join(userHome, "." + myName);
}

export const execLoudOptions = { stdio: "inherit" } as ExecSyncOptions;

/**
 * Read signature file
 * @param workingDir working directory
 * @returns signature file content
 */
export const readSignatureFile = (workingDir: string) => {
  const signatureFilePath = join(workingDir, signatureFile);
  try {
    const fileData = fs.readFileSync(signatureFilePath, "utf-8");
    return fileData;
  } catch (e) {
    return "";
  }
};

export const writeSignatureFile = (workingDir: string, signature: string) => {
  const signatureFilePath = join(workingDir, signatureFile);
  try {
    fs.writeFileSync(signatureFilePath, signature);
  } catch (e) {
    console.error("Could not write signature file");
    throw e;
  }
};
