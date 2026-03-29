import * as fs from 'fs-extra';
import { strictEqual, ok } from 'assert';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nalcGlobal } from '../src/constant';

const tmpDir = join(__dirname, 'consumer-install-tmp');
const consumerDir = join(tmpDir, 'consumer');
const globalDir = join(tmpDir, 'nalc-home');
const registryUrl = 'http://127.0.0.1:4876';
const staleTimestamp = new Date('2026-03-20T08:00:00.000Z');

const writeInstalledState = (workingDir: string) => {
  const pkg = fs.readJSONSync(join(workingDir, 'package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const resolveInstalledVersion = (spec?: string) => {
    if (!spec) return 'missing';
    return spec.replace(/^[~^]/, '').split(' ')[0];
  };

  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    "      '@cmshiki/editor':",
    `        specifier: ${pkg.dependencies?.['@cmshiki/editor'] || 'missing'}`,
    `        version: ${resolveInstalledVersion(pkg.dependencies?.['@cmshiki/editor'])}`,
    "      '@cmshiki/shiki':",
    `        specifier: ${pkg.dependencies?.['@cmshiki/shiki'] || 'missing'}`,
    `        version: ${resolveInstalledVersion(pkg.dependencies?.['@cmshiki/shiki'])}`,
    "      '@cmshiki/utils':",
    `        specifier: ${pkg.dependencies?.['@cmshiki/utils'] || 'missing'}`,
    `        version: ${resolveInstalledVersion(pkg.dependencies?.['@cmshiki/utils'])}`,
    '',
  ].join('\n');
  fs.writeFileSync(join(workingDir, 'pnpm-lock.yaml'), lockfile);

  const installedSpecs = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  Object.entries(installedSpecs).forEach(([packageName, spec]) => {
    if (typeof spec !== 'string') {
      return;
    }

    const version = resolveInstalledVersion(spec);
    const topLevelPackageDir = join(
      workingDir,
      'node_modules',
      ...packageName.split('/'),
    );
    fs.ensureDirSync(topLevelPackageDir);
    fs.writeJSONSync(
      join(topLevelPackageDir, 'package.json'),
      { name: packageName, version },
      { spaces: 2 },
    );

    if (!/-(?:nalc)\.\d{8}(?:\d{6})?\.[0-9a-f]{8}$/.test(version)) {
      return;
    }

    const packageDir = join(
      workingDir,
      'node_modules',
      '.pnpm',
      `${packageName.replace(/\//g, '+')}@${version}`,
      'node_modules',
      ...packageName.split('/'),
    );
    fs.ensureDirSync(packageDir);
    fs.writeJSONSync(
      join(packageDir, 'package.json'),
      { name: packageName, version },
      { spaces: 2 },
    );
  });
};

const { ensureRegistryRuntimeMock, runRegistryInstallMock, runPmInstallMock } = vi.hoisted(() => ({
  ensureRegistryRuntimeMock: vi.fn(async () => ({
    pid: 123,
    port: 4876,
    url: registryUrl,
    configPath: '/tmp/verdaccio.yaml',
    storagePath: '/tmp/storage',
    startedAt: '2026-03-27T12:00:00.000Z',
  })),
  runRegistryInstallMock: vi.fn((workingDir: string) => {
    writeInstalledState(workingDir);
  }),
  runPmInstallMock: vi.fn((workingDir: string) => {
    writeInstalledState(workingDir);
  }),
}));

vi.mock('../src/registry/runtime', () => ({
  ensureRegistryRuntime: ensureRegistryRuntimeMock,
}));

vi.mock('../src/registry/pm', () => ({
  runRegistryInstall: runRegistryInstallMock,
}));

vi.mock('../src/pm', async () => {
  const actual = await vi.importActual<typeof import('../src/pm')>('../src/pm');
  return {
    ...actual,
    runPmInstall: runPmInstallMock,
  };
});

import { addRegistryPackages, passRegistryConsumer } from '../src/registry/consumer';
import {
  readConsumerRegistryState,
  readGlobalRegistryState,
  writeConsumerRegistryState,
  writeGlobalRegistryState,
} from '../src/registry/state';

describe('Registry consumer installs', () => {
  beforeEach(() => {
    fs.removeSync(tmpDir);
    fs.ensureDirSync(consumerDir);
    nalcGlobal.nalcHomeDir = globalDir;
    ensureRegistryRuntimeMock.mockClear();
    runRegistryInstallMock.mockClear();
    runPmInstallMock.mockClear();

    fs.writeJSONSync(
      join(consumerDir, 'package.json'),
      {
        name: 'consumer-app',
        version: '1.0.0',
        private: true,
        dependencies: {
          '@cmshiki/editor': '^0.2.0',
          '@cmshiki/shiki': '^0.2.0',
          '@cmshiki/utils': '^0.2.0',
        },
      },
      { spaces: 2 },
    );

    fs.writeJSONSync(
      join(consumerDir, 'tsconfig.json'),
      { compilerOptions: { target: 'ES2022' } },
      { spaces: 2 },
    );
    fs.utimesSync(join(consumerDir, 'tsconfig.json'), staleTimestamp, staleTimestamp);

    fs.writeFileSync(
      join(consumerDir, 'pnpm-lock.yaml'),
      [
        "lockfileVersion: '9.0'",
        '',
        'importers:',
        '',
        '  .:',
        '    dependencies:',
        "      '@cmshiki/editor':",
        '        specifier: ^0.2.0',
        '        version: 0.2.0',
        "      '@cmshiki/shiki':",
        '        specifier: ^0.2.0',
        '        version: 0.2.0',
        "      '@cmshiki/utils':",
        '        specifier: ^0.2.0',
        '        version: 0.2.0',
        '',
      ].join('\n'),
    );

    writeGlobalRegistryState({
      version: 1,
      runtime: {
        pid: 123,
        port: 4876,
        url: registryUrl,
        configPath: '/tmp/verdaccio.yaml',
        storagePath: '/tmp/storage',
        startedAt: '2026-03-27T12:00:00.000Z',
      },
      packages: {
        '@cmshiki/utils': {
          sourcePath: '/repo/utils',
          baseVersion: '0.2.0',
          localVersion: '0.2.0-nalc.20260327.f353dc70',
          distTag: 'nalc',
          publishedAt: '2026-03-27T12:00:00.000Z',
          buildId: 'f353dc70',
          contentHash: 'utils',
        },
        '@cmshiki/shiki': {
          sourcePath: '/repo/shiki',
          baseVersion: '0.2.0',
          localVersion: '0.2.0-nalc.20260327.f82cd2ef',
          distTag: 'nalc',
          publishedAt: '2026-03-27T12:00:00.000Z',
          buildId: 'f82cd2ef',
          contentHash: 'shiki',
        },
        '@cmshiki/editor': {
          sourcePath: '/repo/editor',
          baseVersion: '0.2.0',
          localVersion: '0.2.0-nalc.20260327.b904ac54',
          distTag: 'nalc',
          publishedAt: '2026-03-27T12:00:00.000Z',
          buildId: 'b904ac54',
          contentHash: 'editor',
        },
      },
      consumers: {
        '@cmshiki/utils': [consumerDir],
        '@cmshiki/shiki': [consumerDir],
        '@cmshiki/editor': [consumerDir],
      },
    });

    const staleShikiDir = join(
      consumerDir,
      'node_modules',
      '.pnpm',
      '@cmshiki+shiki@0.2.0-nalc.20260327.25ed9823',
      'node_modules',
      '@cmshiki',
      'shiki',
    );
    fs.ensureDirSync(staleShikiDir);
    fs.writeJSONSync(
      join(staleShikiDir, 'package.json'),
      {
        name: '@cmshiki/shiki',
        version: '0.2.0-nalc.20260327.25ed9823',
      },
      { spaces: 2 },
    );
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('installs exact nalc specs and refreshes the project graph', async () => {
    await addRegistryPackages(
      ['@cmshiki/utils', '@cmshiki/shiki', '@cmshiki/editor'],
      { workingDir: consumerDir },
    );

    expect(runRegistryInstallMock).toHaveBeenCalledTimes(1);
    expect(runPmInstallMock).toHaveBeenCalledTimes(0);
    expect(ensureRegistryRuntimeMock).toHaveBeenCalledTimes(1);

    const manifest = fs.readJSONSync(join(consumerDir, 'package.json')) as any;
    strictEqual(
      manifest.dependencies['@cmshiki/editor'],
      '0.2.0-nalc.20260327.b904ac54',
    );
    strictEqual(
      manifest.dependencies['@cmshiki/shiki'],
      '0.2.0-nalc.20260327.f82cd2ef',
    );
    strictEqual(
      manifest.dependencies['@cmshiki/utils'],
      '0.2.0-nalc.20260327.f353dc70',
    );

    const lockfile = fs.readFileSync(join(consumerDir, 'pnpm-lock.yaml'), 'utf8');
    ok(lockfile.includes('specifier: 0.2.0-nalc.20260327.b904ac54'));
    ok(lockfile.includes('version: 0.2.0-nalc.20260327.b904ac54'));

    const consumerState = readConsumerRegistryState(consumerDir);
    strictEqual(
      consumerState.packages['@cmshiki/editor'].manifestSpec,
      '0.2.0-nalc.20260327.b904ac54',
    );
    strictEqual(
      consumerState.packages['@cmshiki/editor'].originalSpec,
      '^0.2.0',
    );

    ok(
      fs.existsSync(
        join(
          consumerDir,
          'node_modules',
          '.pnpm',
          '@cmshiki+editor@0.2.0-nalc.20260327.b904ac54',
        ),
      ),
    );
    ok(
      !fs.existsSync(
        join(
          consumerDir,
          'node_modules',
          '.pnpm',
          '@cmshiki+shiki@0.2.0-nalc.20260327.25ed9823',
        ),
      ),
    );

    const tsconfigStat = fs.statSync(join(consumerDir, 'tsconfig.json'));
    ok(tsconfigStat.mtimeMs > staleTimestamp.getTime());
  });

  it('passes a consumer back to normal dependencies and removes nalc state', async () => {
    fs.writeJSONSync(
      join(consumerDir, 'package.json'),
      {
        name: 'consumer-app',
        version: '1.0.0',
        private: true,
        dependencies: {
          '@cmshiki/editor': '0.2.0-nalc.20260327.b904ac54',
          '@cmshiki/shiki': '0.2.0-nalc.20260327.f82cd2ef',
          '@cmshiki/utils': '0.2.0-nalc.20260327.f353dc70',
        },
      },
      { spaces: 2 },
    );

    writeConsumerRegistryState(consumerDir, {
      version: 1,
      packageManager: 'pnpm',
      packages: {
        '@cmshiki/editor': {
          dependencyType: 'dependencies',
          originalSpec: '^0.2.0',
          localSpec: '0.2.0-nalc.20260327.b904ac54',
          manifestSpec: '0.2.0-nalc.20260327.b904ac54',
          sourcePath: '/repo/editor',
          registryUrl,
          installedAt: '2026-03-27T12:00:00.000Z',
        },
        '@cmshiki/shiki': {
          dependencyType: 'dependencies',
          originalSpec: '^0.2.0',
          localSpec: '0.2.0-nalc.20260327.f82cd2ef',
          manifestSpec: '0.2.0-nalc.20260327.f82cd2ef',
          sourcePath: '/repo/shiki',
          registryUrl,
          installedAt: '2026-03-27T12:00:00.000Z',
        },
        '@cmshiki/utils': {
          dependencyType: 'dependencies',
          originalSpec: '^0.2.0',
          localSpec: '0.2.0-nalc.20260327.f353dc70',
          manifestSpec: '0.2.0-nalc.20260327.f353dc70',
          sourcePath: '/repo/utils',
          registryUrl,
          installedAt: '2026-03-27T12:00:00.000Z',
        },
      },
    });

    writeInstalledState(consumerDir);
    fs.utimesSync(join(consumerDir, 'tsconfig.json'), staleTimestamp, staleTimestamp);

    await passRegistryConsumer(consumerDir);

    expect(runRegistryInstallMock).toHaveBeenCalledTimes(0);
    expect(runPmInstallMock).toHaveBeenCalledTimes(1);

    const manifest = fs.readJSONSync(join(consumerDir, 'package.json')) as any;
    strictEqual(manifest.dependencies['@cmshiki/editor'], '^0.2.0');
    strictEqual(manifest.dependencies['@cmshiki/shiki'], '^0.2.0');
    strictEqual(manifest.dependencies['@cmshiki/utils'], '^0.2.0');

    ok(!fs.existsSync(join(consumerDir, '.nalc', 'state.json')));
    ok(!fs.existsSync(join(consumerDir, '.nalc')));

    ok(
      !fs.existsSync(
        join(
          consumerDir,
          'node_modules',
          '.pnpm',
          '@cmshiki+editor@0.2.0-nalc.20260327.b904ac54',
        ),
      ),
    );

    const globalState = readGlobalRegistryState();
    strictEqual(globalState.consumers['@cmshiki/editor'], undefined);
    strictEqual(globalState.consumers['@cmshiki/shiki'], undefined);
    strictEqual(globalState.consumers['@cmshiki/utils'], undefined);

    const tsconfigStat = fs.statSync(join(consumerDir, 'tsconfig.json'));
    ok(tsconfigStat.mtimeMs > staleTimestamp.getTime());
  });
});
