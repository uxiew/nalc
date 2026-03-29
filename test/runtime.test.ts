import http from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nalcGlobal } from '../src/constant';
import { readGlobalRegistryState, writeGlobalRegistryState } from '../src/registry/state';

const tmpDir = join(__dirname, 'runtime-tmp');
const globalDir = join(tmpDir, 'nalc-home');
const HOST = '127.0.0.1';

const httpServers: http.Server[] = [];
const tcpServers: net.Server[] = [];

const closeServer = (server: http.Server | net.Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const closeAllServers = async () => {
  while (httpServers.length) {
    await closeServer(httpServers.pop()!);
  }
  while (tcpServers.length) {
    await closeServer(tcpServers.pop()!);
  }
};

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a free port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

const startRegistryLikeServer = (port: number) =>
  new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.url === '/-/ping') {
        response.writeHead(200, {
          'content-type': 'application/json',
          'x-powered-by': 'verdaccio',
        });
        response.end('{"ok":true}');
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"not found"}');
    });
    server.once('error', reject);
    server.listen(port, HOST, () => {
      httpServers.push(server);
      resolve(server);
    });
  });

const startBusyTcpServer = (port: number) =>
  new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.destroy();
    });
    server.once('error', reject);
    server.listen(port, HOST, () => {
      tcpServers.push(server);
      resolve(server);
    });
  });

describe('registry runtime', () => {
  beforeEach(() => {
    fs.removeSync(tmpDir);
    fs.ensureDirSync(globalDir);
    nalcGlobal.nalcHomeDir = globalDir;
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await closeAllServers();
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:module');
    vi.resetModules();
    fs.removeSync(tmpDir);
  });

  it('increments from the preferred port until a free port is found', async () => {
    const preferredPort = await getFreePort();
    await startBusyTcpServer(preferredPort);

    const { findAvailablePort } = await import('../src/registry/runtime');
    const nextPort = await findAvailablePort(preferredPort);

    expect(nextPort).toBe(preferredPort + 1);
  });

  it('reuses the runtime recorded in nalc state before considering a new port', async () => {
    const runtimePort = await getFreePort();
    await startRegistryLikeServer(runtimePort);

    writeGlobalRegistryState({
      version: 1,
      runtime: {
        pid: 321,
        port: runtimePort,
        url: `http://${HOST}:${runtimePort}`,
        configPath: join(globalDir, 'registry', 'verdaccio.yaml'),
        storagePath: join(globalDir, 'registry', 'storage'),
        startedAt: '2026-03-29T00:00:00.000Z',
      },
      packages: {},
      consumers: {},
    });

    const { ensureRegistryRuntime } = await import('../src/registry/runtime');
    const runtime = await ensureRegistryRuntime({ port: runtimePort + 20 });

    expect(runtime.port).toBe(runtimePort);
    expect(runtime.pid).toBe(321);
    expect(readGlobalRegistryState().runtime?.port).toBe(runtimePort);
  });

  it('starts a new managed runtime instead of adopting an arbitrary registry on the preferred port', async () => {
    const preferredPort = await getFreePort();
    await startRegistryLikeServer(preferredPort);

    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => '/mock/verdaccio/bin/verdaccio',
      }),
    }));
    vi.doMock('node:child_process', () => ({
      spawn: (_command: string, args: string[]) => {
        const listenIndex = args.indexOf('--listen');
        const listenValue = args[listenIndex + 1] || '';
        const [, portText] = listenValue.split(':');
        void startRegistryLikeServer(Number(portText));
        return {
          pid: 6543,
          unref() {},
        };
      },
    }));

    const { ensureRegistryRuntime } = await import('../src/registry/runtime');
    const runtime = await ensureRegistryRuntime({ port: preferredPort });

    expect(runtime.port).toBe(preferredPort + 1);
    expect(runtime.pid).toBe(6543);
    expect(readGlobalRegistryState().runtime?.port).toBe(preferredPort + 1);
  });
});
