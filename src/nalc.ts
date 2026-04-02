#!/usr/bin/env node
import yargs from "yargs";
import { join, resolve } from "node:path";
import { readRcConfig } from "./rc";
import { makeConsoleColored, disabledConsoleOutput } from "./console";
import { type PublishPackageOptions, publishPackage } from "./publish";
import { VALUES, nalcGlobal } from "./constant";
import { getStoreMainDir } from "./utils";
import { ensureRegistryRuntime, stopRegistryRuntime } from "./registry/runtime";
import {
  addRegistryPackages,
  passRegistryConsumer,
  pushRegistryPackages,
  removeRegistryPackages,
  updateRegistryPackages,
} from "./registry/consumer";

const { version, myName } = VALUES;

makeConsoleColored();

const rcArgs = readRcConfig();

if (process.argv.includes("--quiet") || rcArgs.quiet) {
  disabledConsoleOutput();
}

const getPublishOptions = (
  argv: any,
  override: Partial<PublishPackageOptions> = {},
): PublishPackageOptions => {
  const folder = argv._[1];
  return {
    workingDir: join(process.cwd(), folder || ""),
    mode: "registry",
    push: argv.push,
    changed: argv.changed,
    content: argv.content,
    private: argv.private,
    scripts: argv.scripts,
    update: argv.update || argv.upgrade,
    workspaceResolve: argv.workspaceResolve,
    devMod: argv.devMod,
    ignore: argv.ignore
      ? {
          files: [],
          packages: argv.ignore,
        }
      : undefined,
    ...override,
  };
};

yargs(process.argv.slice(2))
  .scriptName(myName)
  .usage(`${myName} <command> [options]`)
  .option("dir", {
    describe: "Override the nalc home directory",
    type: "string",
    global: true,
  })
  .coerce("dir", function (folder: string) {
    if (!nalcGlobal.nalcHomeDir) {
      nalcGlobal.nalcHomeDir = resolve(folder);
      console.log("nalc home directory used:", nalcGlobal.nalcHomeDir);
    }
  })
  .command({
    command: "*",
    builder: (y) => y.boolean(["version"]),
    handler: (argv) => {
      let msg = `Use \`${myName} help\` to see available commands.`;
      if (argv._[0]) {
        msg = `Unknown command \`${argv._[0]}\`. ${msg}`;
      } else if (argv.version) {
        msg = version;
      }
      console.log(msg);
    },
  })
  .command({
    command: "serve",
    describe: "Start or reuse the local registry",
    builder: (y) =>
      y.option("port", {
        describe: "Preferred local registry port",
        type: "number",
      }),
    handler: async (argv) => {
      const runtime = await ensureRegistryRuntime({
        port: argv.port,
      });
      console.log(
        `Local registry running at ${runtime.url} (pid ${runtime.pid})`,
      );
    },
  })
  .command({
    command: "stop",
    describe: "Stop the local registry managed by nalc",
    builder: (y) =>
      y
        .option("force", {
          describe: "Use SIGKILL if graceful shutdown times out",
          type: "boolean",
          default: true,
        })
        .default(rcArgs),
    handler: async (argv) => {
      const result = await stopRegistryRuntime({
        force: argv.force !== false,
      });

      if (result.stopped && result.runtime) {
        console.log(
          `Local registry stopped at ${result.runtime.url} (pid ${result.runtime.pid})`,
        );
        return;
      }

      if (result.stale && result.runtime) {
        console.log(
          `Cleared stale local registry state for ${result.runtime.url} (pid ${result.runtime.pid})`,
        );
        return;
      }

      console.log("Local registry is not running.");
    },
  })
  .command({
    command: "publish",
    describe: "Publish a package to the local nalc registry",
    builder: (y) =>
      y
        .option("scripts", {
          describe: "Run lifecycle scripts",
          type: "boolean",
          default: true,
        })
        .option("dev-mod", {
          describe: "Remove dev-only fields from the published manifest",
          type: "boolean",
          default: true,
        })
        .option("workspace-resolve", {
          describe: "Resolve workspace: protocol to valid versions",
          type: "boolean",
          default: true,
        })
        .option("push", {
          describe: "Update all tracked consumers after publishing",
          type: "boolean",
        })
        .option("content", {
          describe: "Show included files",
          type: "boolean",
        })
        .option("private", {
          describe: "Publish even if private: true",
          type: "boolean",
        })
        .option("changed", {
          describe: "Only publish if content changed",
          type: "boolean",
        })
        .option("ignore", {
          alias: "exclude",
          describe: "Exclude packages during ws/watch",
          type: "array",
        })
        .default(rcArgs),
    handler: async (argv) => {
      await publishPackage(getPublishOptions(argv));
    },
  })
  .command({
    command: "push",
    describe: "Publish and push the latest version to tracked consumers",
    builder: (y) =>
      y
        .option("scripts", {
          describe: "Run lifecycle scripts",
          type: "boolean",
          default: false,
        })
        .option("dev-mod", {
          describe: "Remove dev-only fields from the published manifest",
          type: "boolean",
          default: true,
        })
        .option("workspace-resolve", {
          describe: "Resolve workspace: protocol to valid versions",
          type: "boolean",
          default: true,
        })
        .option("changed", {
          describe: "Only publish if content changed",
          type: "boolean",
        })
        .option("ignore", {
          alias: "exclude",
          describe: "Exclude packages during ws/watch",
          type: "array",
        })
        .default(rcArgs),
    handler: async (argv) => {
      await publishPackage(getPublishOptions(argv, { push: true }));
    },
  })
  .command({
    command: "add <packageNames...>",
    describe: "Install published local packages into the current project",
    builder: (y) =>
      y
        .option("dev", {
          alias: ["D", "save-dev"],
          describe: "Install into devDependencies",
          type: "boolean",
        })
        .default(rcArgs)
        .help(true),
    handler: async (argv: any) => {
      await addRegistryPackages(argv.packageNames as string[], {
        dev: argv.dev,
        workingDir: process.cwd(),
      });
    },
  })
  .command({
    command: "update [packageNames...]",
    describe: "Update tracked local packages in the current project",
    builder: (y) => y.default(rcArgs).help(true),
    handler: async (argv: any) => {
      await updateRegistryPackages((argv.packageNames || []) as string[], {
        workingDir: process.cwd(),
      });
    },
  })
  .command({
    command: "remove [packageNames...]",
    aliases: ["rm"],
    describe:
      "Stop tracking selected local package overrides in the current project",
    builder: (y) => y.boolean(["all"]).default(rcArgs).help(true),
    handler: async (argv: any) => {
      await removeRegistryPackages((argv.packageNames || []) as string[], {
        all: argv.all,
        workingDir: process.cwd(),
      });
    },
  })
  .command({
    command: "pass",
    describe:
      "Restore the current project to normal dependencies and remove nalc state",
    builder: (y) => y.default(rcArgs).help(true),
    handler: async () => {
      await passRegistryConsumer(process.cwd());
    },
  })
  .command({
    command: "ws",
    describe: "Publish every package in a workspace to the local registry",
    builder: (y) =>
      y
        .option("scripts", {
          describe: "Run lifecycle scripts",
          type: "boolean",
          default: true,
        })
        .option("dev-mod", {
          describe: "Remove dev-only fields from the published manifest",
          type: "boolean",
          default: true,
        })
        .option("workspace-resolve", {
          describe: "Resolve workspace: protocol to valid versions",
          type: "boolean",
          default: true,
        })
        .option("ignore", {
          alias: "exclude",
          describe: "Exclude packages",
          type: "array",
        })
        .default(rcArgs),
    handler: async (argv) => {
      const { smartPublish } = await import("./watch");
      await smartPublish(getPublishOptions(argv));
    },
  })
  .command({
    command: "watch",
    describe: "Watch packages and republish to the local registry on changes",
    builder: (y) =>
      y
        .option("scripts", {
          describe: "Run lifecycle scripts",
          type: "boolean",
          default: true,
        })
        .option("dev-mod", {
          describe: "Remove dev-only fields from the published manifest",
          type: "boolean",
          default: true,
        })
        .option("workspace-resolve", {
          describe: "Resolve workspace: protocol to valid versions",
          type: "boolean",
          default: true,
        })
        .option("ignore", {
          alias: "exclude",
          describe: "Exclude packages",
          type: "array",
        })
        .default(rcArgs),
    handler: async (argv) => {
      const { watchPackages } = await import("./watch");
      await watchPackages(
        getPublishOptions(argv, { push: true, changed: true }),
      );
    },
  })
  .command({
    command: "refresh [path]",
    describe:
      "Touch project inputs so editors rebuild the local dependency graph",
    handler: async (argv) => {
      const { refreshConsumerProjectGraph } =
        await import("./registry/project-graph");
      const workingDir = resolve(process.cwd(), String(argv.path || ""));
      const result = refreshConsumerProjectGraph(workingDir);
      console.log(`Refreshed project graph via ${result.touchedFile}`);
      console.log(`Package manager: ${result.packageManager}`);
      console.log(`Tracked local packages: ${result.trackedPackages.length}`);
    },
  })
  .command({
    command: "dir",
    describe: "Show the nalc home directory",
    handler: () => {
      console.log(getStoreMainDir());
    },
  })
  .help("help").argv;
