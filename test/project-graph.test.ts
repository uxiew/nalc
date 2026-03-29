import * as fs from 'fs-extra';
import { deepEqual, strictEqual } from 'assert';
import { join } from 'path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { nalcGlobal } from '../src/constant';
import { refreshConsumerProjectGraph } from '../src/registry/project-graph';
import { writeConsumerRegistryState } from '../src/registry/state';

const tmpDir = join(__dirname, 'project-graph-tmp');
const consumerDir = join(tmpDir, 'consumer');
const globalDir = join(tmpDir, 'nalc-home');
const staleTimestamp = new Date('2026-03-20T08:00:00.000Z');

describe('Consumer project graph refresh', () => {
  beforeEach(() => {
    fs.removeSync(tmpDir);
    fs.ensureDirSync(consumerDir);
    nalcGlobal.nalcHomeDir = globalDir;

    fs.writeJSONSync(
      join(consumerDir, 'package.json'),
      { name: 'consumer-app', version: '1.0.0' },
      { spaces: 2 },
    );
    fs.writeJSONSync(
      join(consumerDir, 'tsconfig.json'),
      { compilerOptions: { module: 'ESNext' } },
      { spaces: 2 },
    );
    fs.utimesSync(join(consumerDir, 'tsconfig.json'), staleTimestamp, staleTimestamp);

    writeConsumerRegistryState(consumerDir, {
      version: 1,
      packageManager: 'pnpm',
      packages: {
        demo: {
          dependencyType: 'dependencies',
          originalSpec: '^1.0.0',
          localSpec: '1.0.0-nalc.20260328.deadbeef',
          manifestSpec: '1.0.0-nalc.20260328.deadbeef',
          sourcePath: '/tmp/demo',
          registryUrl: 'http://127.0.0.1:4873',
          installedAt: '2026-03-28T08:00:00.000Z',
        },
      },
    });
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('touches tsconfig first and reports consumer metadata', () => {
    const result = refreshConsumerProjectGraph(consumerDir);

    strictEqual(result.touchedFile, join(consumerDir, 'tsconfig.json'));
    strictEqual(result.packageManager, 'pnpm');
    deepEqual(result.trackedPackages, ['demo']);
    strictEqual(
      fs.statSync(join(consumerDir, 'tsconfig.json')).mtimeMs > staleTimestamp.getTime(),
      true,
    );
  });
});
