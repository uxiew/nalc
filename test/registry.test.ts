import * as fs from "fs-extra";
import { strictEqual, ok, deepEqual } from "assert";
import { join } from "path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { nalcGlobal } from "../src/constant";
import {
  getConsumerRegistryStatePath,
  getGlobalRegistryStatePath,
  getLegacyConsumerRegistryStatePath,
  getRegistryHomeDir,
} from "../src/registry/constants";
import {
  readConsumerRegistryState,
  readGlobalRegistryState,
  writeConsumerRegistryState,
  writeGlobalRegistryState,
} from "../src/registry/state";
import {
  createBuildId,
  createRegistryPrereleaseVersion,
} from "../src/registry/version";

const tmpDir = join(__dirname, "registry-tmp");
const consumerDir = join(tmpDir, "consumer");
const globalDir = join(tmpDir, "nalc-home");

describe("Registry mode helpers", () => {
  beforeEach(() => {
    fs.removeSync(tmpDir);
    fs.ensureDirSync(consumerDir);
    nalcGlobal.nalcHomeDir = globalDir;
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it("creates stable build ids from content hashes", () => {
    const buildId = createBuildId("same-content");
    strictEqual(buildId.length, 8);
    strictEqual(buildId, createBuildId("same-content"));
  });

  it("creates local prerelease versions", () => {
    const version = createRegistryPrereleaseVersion(
      "1.2.3",
      "deadbeef",
      new Date("2026-03-23T08:00:00.000Z"),
    );
    strictEqual(version, "1.2.3-nalc.20260323.deadbeef");
  });

  it("persists global registry state", () => {
    writeGlobalRegistryState({
      version: 1,
      runtime: {
        pid: 123,
        port: 4873,
        url: "http://127.0.0.1:4873",
        configPath: "/tmp/config.yaml",
        storagePath: "/tmp/storage",
        startedAt: "2026-03-23T08:00:00.000Z",
      },
      packages: {
        demo: {
          sourcePath: "/tmp/demo",
          baseVersion: "1.0.0",
          localVersion: "1.0.0-nalc.20260323.deadbeef",
          distTag: "nalc",
          publishedAt: "2026-03-23T08:00:00.000Z",
          buildId: "deadbeef",
          contentHash: "sha",
        },
      },
    });

    const state = readGlobalRegistryState();
    ok(state.runtime);
    strictEqual(state.runtime?.port, 4873);
    strictEqual(
      state.packages.demo.localVersion,
      "1.0.0-nalc.20260323.deadbeef",
    );
    strictEqual(getGlobalRegistryStatePath(), join(globalDir, "state.json"));
    strictEqual(getRegistryHomeDir(), join(globalDir, "registry"));
  });

  it("persists consumer registry state", () => {
    writeConsumerRegistryState(consumerDir, {
      version: 1,
      packageManager: 'pnpm',
      packages: {
        demo: {
          dependencyType: "dependencies",
          originalSpec: "^1.0.0",
          localSpec: "1.0.0-nalc.20260323.deadbeef",
          manifestSpec: "1.0.0-nalc.20260323.deadbeef",
          sourcePath: "/tmp/demo",
          registryUrl: "http://127.0.0.1:4873",
          installedAt: "2026-03-23T08:00:00.000Z",
        },
      },
    });

    deepEqual(readConsumerRegistryState(consumerDir), {
      version: 1,
      packageManager: 'pnpm',
      packages: {
        demo: {
          dependencyType: "dependencies",
          originalSpec: "^1.0.0",
          localSpec: "1.0.0-nalc.20260323.deadbeef",
          manifestSpec: "1.0.0-nalc.20260323.deadbeef",
          sourcePath: "/tmp/demo",
          registryUrl: "http://127.0.0.1:4873",
          installedAt: "2026-03-23T08:00:00.000Z",
        },
      },
    });
    ok(fs.existsSync(getConsumerRegistryStatePath(consumerDir)));
    ok(!getConsumerRegistryStatePath(consumerDir).startsWith(consumerDir));
  });

  it("reads legacy in-project consumer state and migrates writes to the system store", () => {
    const legacyPath = getLegacyConsumerRegistryStatePath(consumerDir);
    fs.ensureDirSync(join(consumerDir, ".nalc"));
    fs.writeJSONSync(legacyPath, {
      version: 1,
      packageManager: "pnpm",
      packages: {
        demo: {
          dependencyType: "dependencies",
          originalSpec: "^1.0.0",
          localSpec: "1.0.0-nalc.20260323.deadbeef",
          manifestSpec: "1.0.0-nalc.20260323.deadbeef",
          sourcePath: "/tmp/demo",
          registryUrl: "http://127.0.0.1:4873",
          installedAt: "2026-03-23T08:00:00.000Z",
        },
      },
    });

    const state = readConsumerRegistryState(consumerDir);
    strictEqual(state.packageManager, "pnpm");
    strictEqual(state.packages.demo.localSpec, "1.0.0-nalc.20260323.deadbeef");

    writeConsumerRegistryState(consumerDir, state);

    ok(fs.existsSync(getConsumerRegistryStatePath(consumerDir)));
    ok(!fs.existsSync(legacyPath));
    ok(!fs.existsSync(join(consumerDir, ".nalc")));
  });
});
