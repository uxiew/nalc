import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import fs from 'fs-extra';
import {
  getRegistryConfigPath,
  getRegistryHomeDir,
  getRegistryStoragePath,
} from './constants';
import { readGlobalRegistryState, writeGlobalRegistryState } from './state';
import type { RegistryRuntimeState } from './types';

const require = createRequire(import.meta.url);

export interface EnsureRegistryRuntimeOptions {
  port?: number;
}

const DEFAULT_PORT = 4873;
const HOST = '127.0.0.1';
const PORT_SCAN_LIMIT = 50;
const REGISTRY_PING_PATH = '/-/ping';

/**
 * Ensure the embedded Verdaccio registry is running and reachable.
 */
export const ensureRegistryRuntime = async (
  options: EnsureRegistryRuntimeOptions = {},
): Promise<RegistryRuntimeState> => {
  const currentState = readGlobalRegistryState();
  const preferredPort =
    options.port || currentState.runtime?.port || DEFAULT_PORT;

  const reusableRuntime = await findReusableRegistryRuntime(
    currentState.runtime,
  );
  if (reusableRuntime) {
    writeGlobalRegistryState({
      ...currentState,
      runtime: reusableRuntime,
    });
    return reusableRuntime;
  }

  const port = await findAvailablePort(preferredPort);
  const runtime = await startRegistryRuntime(port);
  writeGlobalRegistryState({
    ...currentState,
    runtime,
  });
  return runtime;
};

/**
 * Start Verdaccio as a detached background daemon.
 */
export const startRegistryRuntime = async (
  port: number,
): Promise<RegistryRuntimeState> => {
  const homeDir = getRegistryHomeDir();
  const configPath = getRegistryConfigPath();
  const storagePath = getRegistryStoragePath();

  fs.ensureDirSync(homeDir);
  fs.ensureDirSync(storagePath);
  fs.writeFileSync(configPath, createVerdaccioConfig(storagePath), 'utf8');

  const verdaccioBin = require.resolve('verdaccio/bin/verdaccio');
  const child = spawn(
    process.execPath,
    [verdaccioBin, '--config', configPath, '--listen', `${HOST}:${port}`],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();

  const url = `http://${HOST}:${port}`;
  await waitForRegistry(url, 15000);

  return {
    pid: child.pid!,
    port,
    url,
    configPath,
    storagePath,
    startedAt: new Date().toISOString(),
  };
};

/**
 * Check whether the registry responds on the configured URL.
 */
export const isRegistryHealthy = async (registryUrl: string) => {
  return new Promise<boolean>((resolve) => {
    const request = http.get(
      new URL(REGISTRY_PING_PATH, registryUrl),
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const statusCode = response.statusCode || 500;
          const contentType = String(
            response.headers['content-type'] || '',
          ).toLowerCase();
          const header = String(
            response.headers['x-powered-by'] || '',
          ).toLowerCase();
          const body = Buffer.concat(chunks).toString('utf8').toLowerCase();
          const looksLikeRegistry =
            contentType.includes('application/json') ||
            header.includes('verdaccio') ||
            body.includes('verdaccio');

          resolve(
            statusCode >= 200 &&
              statusCode < 500 &&
              statusCode !== 404 &&
              looksLikeRegistry,
          );
        });
      },
    );
    request.on('error', () => resolve(false));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(false);
    });
  });
};

/**
 * Poll the registry URL until it becomes reachable.
 */
export const waitForRegistry = async (
  registryUrl: string,
  timeoutMs: number,
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isRegistryHealthy(registryUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for registry at ${registryUrl}`);
};

/**
 * Find a free TCP port starting from the preferred one.
 */
export const findAvailablePort = async (preferredPort: number) => {
  for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
    const candidate = preferredPort + offset;
    const probe = await probeRegistryPort(candidate);
    if (probe.free) {
      return candidate;
    }
  }
  throw new Error(`Could not find a free port near ${preferredPort}`);
};

/**
 * Check whether a TCP port is available on localhost.
 */
export const isPortFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, HOST);
  });

/**
 * Reuse only the registry instance already tracked by nalc state.
 *
 * We intentionally do not adopt arbitrary healthy registries discovered on
 * nearby ports. nalc should manage exactly one Verdaccio runtime per home dir,
 * and any custom `--port` value only affects the next spawn when no healthy
 * runtime is currently recorded.
 */
const findReusableRegistryRuntime = async (
  existingRuntime: RegistryRuntimeState | undefined,
): Promise<RegistryRuntimeState | undefined> => {
  if (!existingRuntime) {
    return undefined;
  }

  const probe = await probeRegistryPort(existingRuntime.port);
  if (!probe.healthy) {
    return undefined;
  }

  return {
    ...existingRuntime,
    configPath: getRegistryConfigPath(),
    storagePath: getRegistryStoragePath(),
  };
};

/**
 * Probe a port to see whether it is free or already serving a registry.
 */
const probeRegistryPort = async (port: number) => {
  const url = `http://${HOST}:${port}`;
  if (await isRegistryHealthy(url)) {
    return {
      free: false,
      healthy: true,
    };
  }

  return {
    free: await isPortFree(port),
    healthy: false,
  };
};

/**
 * Create the Verdaccio configuration used by nalc registry mode.
 */
export const createVerdaccioConfig = (
  storagePath: string,
) => `storage: ${storagePath}
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '@*/*':
    access: $all
    publish: $all
    proxy: npmjs
  '**':
    access: $all
    publish: $all
    proxy: npmjs
log:
  type: stdout
  format: pretty
  level: warn
server:
  keepAliveTimeout: 60
`;
