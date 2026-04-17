import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalArgv = [...process.argv];

describe('nalc CLI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.doUnmock('../src/console');
    vi.doUnmock('../src/rc');
    vi.doUnmock('../src/registry/runtime');
    vi.doUnmock('../src/registry/state');
    vi.doUnmock('../src/registry/consumer');
  });

  it('routes the stop command to the registry shutdown handler', async () => {
    const stopRegistryRuntime = vi.fn().mockResolvedValue({
      stopped: true,
      stale: false,
      runtime: {
        pid: 321,
        port: 4873,
        url: 'http://127.0.0.1:4873',
        configPath: '/tmp/verdaccio.yaml',
        storagePath: '/tmp/storage',
        startedAt: '2026-04-02T10:00:00.000Z',
      },
    });

    vi.doMock('../src/console', () => ({
      makeConsoleColored: vi.fn(),
      disabledConsoleOutput: vi.fn(),
    }));
    vi.doMock('../src/rc', () => ({
      readRcConfig: () => ({}),
    }));
    vi.doMock('../src/registry/runtime', () => ({
      ensureRegistryRuntime: vi.fn(),
      stopRegistryRuntime,
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = ['node', 'nalc', 'stop'];

    await import('../src/nalc');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopRegistryRuntime).toHaveBeenCalledWith({ force: true });
    expect(logSpy).toHaveBeenCalledWith(
      'Local registry stopped at http://127.0.0.1:4873 (pid 321)',
    );
  });

  it('routes the destroy command to pass, stop, and system cleanup', async () => {
    const stopRegistryRuntime = vi.fn().mockResolvedValue({
      stopped: true,
      stale: false,
      runtime: {
        pid: 654,
        port: 4873,
        url: 'http://127.0.0.1:4873',
        configPath: '/tmp/verdaccio.yaml',
        storagePath: '/tmp/storage',
        startedAt: '2026-04-15T10:00:00.000Z',
      },
    });
    const passRegistryConsumer = vi.fn().mockResolvedValue(undefined);
    const destroyNalcStore = vi.fn();

    vi.doMock('../src/console', () => ({
      makeConsoleColored: vi.fn(),
      disabledConsoleOutput: vi.fn(),
    }));
    vi.doMock('../src/rc', () => ({
      readRcConfig: () => ({}),
    }));
    vi.doMock('../src/registry/runtime', () => ({
      ensureRegistryRuntime: vi.fn(),
      stopRegistryRuntime,
    }));
    vi.doMock('../src/registry/consumer', () => ({
      addRegistryPackages: vi.fn(),
      passRegistryConsumer,
      pushRegistryPackages: vi.fn(),
      removeRegistryPackages: vi.fn(),
      updateRegistryPackages: vi.fn(),
    }));
    vi.doMock('../src/registry/state', () => ({
      describeNalcState: vi.fn(),
      destroyNalcStore,
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = ['node', 'nalc', 'destroy'];

    await import('../src/nalc');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(passRegistryConsumer).toHaveBeenCalledWith(process.cwd());
    expect(stopRegistryRuntime).toHaveBeenCalledWith({ force: true });
    expect(destroyNalcStore).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'Local registry stopped at http://127.0.0.1:4873 (pid 654)',
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Removed nalc system store at '),
    );
  });

  it('routes the state command to the state reporter', async () => {
    const describeNalcState = vi.fn().mockReturnValue(
      'Current project state\n- nalc: managing this project',
    );

    vi.doMock('../src/console', () => ({
      makeConsoleColored: vi.fn(),
      disabledConsoleOutput: vi.fn(),
    }));
    vi.doMock('../src/rc', () => ({
      readRcConfig: () => ({}),
    }));
    vi.doMock('../src/registry/runtime', () => ({
      ensureRegistryRuntime: vi.fn(),
      stopRegistryRuntime: vi.fn(),
    }));
    vi.doMock('../src/registry/state', () => ({
      describeNalcState,
      destroyNalcStore: vi.fn(),
    }));
    vi.doMock('../src/registry/consumer', () => ({
      addRegistryPackages: vi.fn(),
      passRegistryConsumer: vi.fn(),
      pushRegistryPackages: vi.fn(),
      removeRegistryPackages: vi.fn(),
      updateRegistryPackages: vi.fn(),
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = ['node', 'nalc', 'state'];

    await import('../src/nalc');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(describeNalcState).toHaveBeenCalledWith(process.cwd());
    expect(logSpy).toHaveBeenCalledWith(
      'Current project state\n- nalc: managing this project',
    );
  });

  it('routes the update alias to the consumer updater', async () => {
    const updateRegistryPackages = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../src/console', () => ({
      makeConsoleColored: vi.fn(),
      disabledConsoleOutput: vi.fn(),
    }));
    vi.doMock('../src/rc', () => ({
      readRcConfig: () => ({}),
    }));
    vi.doMock('../src/registry/runtime', () => ({
      ensureRegistryRuntime: vi.fn(),
      stopRegistryRuntime: vi.fn(),
    }));
    vi.doMock('../src/registry/state', () => ({
      describeNalcState: vi.fn(),
      destroyNalcStore: vi.fn(),
    }));
    vi.doMock('../src/registry/consumer', () => ({
      addRegistryPackages: vi.fn(),
      passRegistryConsumer: vi.fn(),
      pushRegistryPackages: vi.fn(),
      removeRegistryPackages: vi.fn(),
      updateRegistryPackages,
    }));

    process.argv = ['node', 'nalc', 'up'];

    await import('../src/nalc');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateRegistryPackages).toHaveBeenCalledWith([], {
      workingDir: process.cwd(),
    });
  });

  it('routes push --all to publish once and then refresh all tracked consumers', async () => {
    const publishPackage = vi.fn().mockResolvedValue({
      sourcePath: '/repo/demo',
      baseVersion: '1.0.0',
      localVersion: '1.0.0-nalc.20260416.deadbeef',
      distTag: 'nalc',
      publishedAt: '2026-04-16T12:00:00.000Z',
      buildId: 'deadbeef',
      contentHash: 'deadbeef',
    });
    const pushRegistryPackages = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../src/console', () => ({
      makeConsoleColored: vi.fn(),
      disabledConsoleOutput: vi.fn(),
    }));
    vi.doMock('../src/rc', () => ({
      readRcConfig: () => ({}),
    }));
    vi.doMock('../src/publish', () => ({
      publishPackage,
    }));
    vi.doMock('../src/registry/runtime', () => ({
      ensureRegistryRuntime: vi.fn(),
      stopRegistryRuntime: vi.fn(),
    }));
    vi.doMock('../src/registry/state', () => ({
      describeNalcState: vi.fn(),
      destroyNalcStore: vi.fn(),
    }));
    vi.doMock('../src/registry/consumer', () => ({
      addRegistryPackages: vi.fn(),
      passRegistryConsumer: vi.fn(),
      pushRegistryPackages,
      removeRegistryPackages: vi.fn(),
      updateRegistryPackages: vi.fn(),
    }));

    process.argv = ['node', 'nalc', 'push', '--all'];

    await import('../src/nalc');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publishPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDir: process.cwd(),
        mode: 'registry',
        push: false,
      }),
    );
    expect(pushRegistryPackages).toHaveBeenCalledWith([]);
  });
});
