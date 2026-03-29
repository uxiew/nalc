import { join } from 'node:path';
import fs from 'fs-extra';
import { VALUES } from '../constant';
import { getPm, type PackageManagerName } from '../pm';
import { readConsumerRegistryState } from './state';

const { nalcStateFolder } = VALUES;

const projectGraphInputs = [
  'tsconfig.json',
  'tsconfig.base.json',
  'jsconfig.json',
  'package.json',
] as const;

export interface ConsumerProjectRefreshResult {
  workingDir: string;
  touchedFile: string;
  packageManager: PackageManagerName;
  trackedPackages: string[];
  touchedAt: string;
}

/**
 * Pick the best file to touch so editors rebuild the project graph.
 */
const resolveProjectGraphInput = (workingDir: string) => {
  for (const fileName of projectGraphInputs) {
    const filePath = join(workingDir, fileName);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  const fallbackFile = join(workingDir, nalcStateFolder, 'project-graph.touch');
  fs.ensureDirSync(join(workingDir, nalcStateFolder));
  if (!fs.existsSync(fallbackFile)) {
    fs.writeFileSync(fallbackFile, '');
  }
  return fallbackFile;
};

/**
 * Touch the consumer project inputs so TypeScript-based editors rebuild their
 * cached dependency graph after nalc rewires local packages.
 */
export const refreshConsumerProjectGraph = (
  workingDir: string,
  fallbackPm?: PackageManagerName,
): ConsumerProjectRefreshResult => {
  const consumerState = readConsumerRegistryState(workingDir);
  const touchedFile = resolveProjectGraphInput(workingDir);
  const touchedAt = new Date();

  fs.utimesSync(touchedFile, touchedAt, touchedAt);

  return {
    workingDir,
    touchedFile,
    packageManager: getPm(workingDir, fallbackPm || consumerState.packageManager),
    trackedPackages: Object.keys(consumerState.packages),
    touchedAt: touchedAt.toISOString(),
  };
};
