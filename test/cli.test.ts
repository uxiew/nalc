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
});
