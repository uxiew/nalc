import type { PackageManagerName } from '../pm';

export type RegistryStateVersion = 1;

export type DependencyField =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies';

export interface RegistryRuntimeState {
  pid: number;
  port: number;
  url: string;
  configPath: string;
  storagePath: string;
  startedAt: string;
}

export interface PublishedRegistryPackageState {
  sourcePath: string;
  baseVersion: string;
  localVersion: string;
  distTag: string;
  publishedAt: string;
  buildId: string;
  /**
   * Fingerprint of the publishable package contents plus the resolved manifest.
   * This changes when source files change or when local workspace dependencies
   * are rebound to a newer local prerelease.
   */
  contentHash: string;
}

export interface GlobalRegistryState {
  version: RegistryStateVersion;
  runtime?: RegistryRuntimeState;
  packages: Record<string, PublishedRegistryPackageState>;
  consumers: Record<string, string[]>;
}

export interface ConsumerRegistryPackageState {
  dependencyType: DependencyField;
  originalSpec?: string;
  /**
   * The exact nalc version currently installed in node_modules.
   */
  localSpec: string;
  /**
   * The dependency spec persisted to package.json while the consumer is under
   * nalc management. This remains an exact local version.
   */
  manifestSpec?: string;
  sourcePath: string;
  registryUrl: string;
  installedAt: string;
}

export interface ConsumerRegistryState {
  version: RegistryStateVersion;
  packageManager?: PackageManagerName;
  packages: Record<string, ConsumerRegistryPackageState>;
}
