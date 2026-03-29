# nalc

> Registry-first local package development powered by an embedded Verdaccio proxy.

`nalc` is a hard fork focused on one thing only: making local package testing behave as close as possible to a real `npm`, `pnpm`, or `bun` install.

Instead of copying files into a local store or wiring `file:` / `link:` dependencies, `nalc` always goes through a local registry pipeline:

1. publish a local prerelease build to an embedded Verdaccio instance
2. let the consumer project install that version through its own package manager
3. track the relationship between source package, local registry version, and consumer state

## What Problem It Solves

Local package workflows based on symlinks or file copies often differ from real installs in subtle but important ways:

- nested dependencies may resolve differently
- peer dependency warnings can disappear or appear inconsistently
- bundlers may optimize the linked source differently from a published package
- package manager lockfiles do not reflect the real package graph

`nalc` solves this by making the consumer run a normal install against a local registry, so the runtime dependency graph is much closer to production.

## Architecture Summary

`nalc` has two sides.

### 1. Publisher Side

When you run `nalc publish`, the source package is packed, normalized, and published into the local registry.

Key behaviors:

- starts or reuses an embedded Verdaccio runtime under `~/.nalc/registry`
- rewrites the package version to a local prerelease such as `1.2.3-nalc.20260328.deadbeef`
- resolves local `workspace:` and `catalog:` references before publishing
- optionally strips development-only manifest fields
- records publish metadata in `~/.nalc/registry/state.json`

### 2. Consumer Side

When you run `nalc add` or `nalc update`, `nalc` updates the consumer manifest and then delegates the real installation to the consumer's own package manager.

Key behaviors:

- persists tracked state in `.nalc/state.json`
- remembers the consumer package manager so future installs can fall back to the same tool when lockfiles are temporarily absent
- saved entries are written to `package.json` as exact local versions such as `1.2.3-nalc.20260328.deadbeef`
- the lockfile still records the exact resolved version
- after install, `nalc` syncs the exact installed version back into consumer state
- stale tracked `.pnpm` local instances are cleaned up after install

## Versioning Strategy

Published local builds use this format:

```txt
<baseVersion>-nalc.<yyyymmdd>.<buildId>
```

Example:

```txt
0.2.0-nalc.20260328.deadbeef
```

Saved consumer manifests use the exact local version:

```json
{
  "dependencies": {
    "@scope/pkg": "0.2.0-nalc.20260328.deadbeef"
  }
}
```

Why:

- `package.json` cannot drift back to a remote stable release during install
- the lockfile captures the same exact local version that nalc requested
- `consumerState.localSpec` stores the exact installed version used by cleanup and future updates

## Installation

```bash
npm i -g nalc
# or
pnpm add -g nalc
# or
bun add -g nalc
```

## Typical Workflows

### Single package

```bash
# in the library
nalc publish

# in the consumer
nalc add my-package

# later, after changes
nalc publish --push
# or
nalc update my-package
```

### Monorepo batch publish

```bash
nalc ws ../my-monorepo --workspace-resolve
```

### Watch and auto-push

```bash
nalc watch ../my-monorepo --workspace-resolve
```

### Finish local verification

```bash
nalc pass
```

## CLI Reference

### `nalc serve`

Start or reuse the embedded Verdaccio runtime.

```bash
nalc serve
nalc serve --port 4874
```

Behavior:

- reuses the healthy runtime recorded in `~/.nalc/registry/state.json`
- nalc keeps a single Verdaccio runtime per nalc home directory
- `--port` only affects the next spawn when no healthy runtime is currently recorded
- if the chosen port is occupied, nalc scans upward for the next free port, similar to Vite

### `nalc publish [path]`

Publish a package to the local registry.

```bash
nalc publish
nalc publish ../my-package
nalc publish --no-scripts
nalc publish --push
nalc publish --changed
```

Important options:

- `--scripts`: run lifecycle scripts, default `true`
- `--dev-mod`: strip development-only manifest fields, default `true`
- `--workspace-resolve`: resolve `workspace:` dependencies before publish, default `true`
- `--content`: print packed file list
- `--private`: publish even when `private: true`
- `--changed`: skip publish if the publishable content hash did not change
- `--push`: update tracked consumers after publish
- `--ignore <pkg...>`: skip selected packages during `ws` / `watch`

Lifecycle hooks executed before publish:

- `prepublish`
- `prepare`
- `prepublishOnly`
- `prepack`
- `prenalcpublish`

Lifecycle hooks executed after publish:

- `postnalcpublish`
- `postpack`

Deliberately not executed:

- `publish`
- `postpublish`

### `nalc push [path]`

Publish and immediately push the new local version into tracked consumers.

```bash
nalc push
nalc push --changed
```

Compared with `publish`, `push` defaults to `--scripts=false` and always behaves as `--push`.

### `nalc add <package...>`

Install one or more published local packages into the current project.

```bash
nalc add my-package
nalc add my-package -D
```

Important options:

- `-D`, `--dev`, `--save-dev`: write to `devDependencies`

Behavior:

- records the original dependency spec in `.nalc/state.json`
- persists the exact `<localVersion>` to `package.json` while the project is under nalc management
- the actual install is performed by `npm`, `pnpm`, or `bun`

### `nalc update [package...]`

Update tracked consumer entries to the latest locally published versions.

```bash
nalc update
nalc update my-package
```

Behavior:

- updates tracked packages to the latest published `localVersion`
- keeps each entry's `dependencyType`
- refreshes the consumer install with the new exact local versions

### `nalc remove [package...]`

Stop tracking selected local package overrides and restore their original dependency specs.

```bash
nalc remove my-package
nalc remove --all
```

Behavior:

- restores `originalSpec` if the dependency existed before nalc management
- removes the dependency entirely if nalc introduced it from scratch
- keeps the project in nalc mode for any remaining tracked packages
- updates the consumer install after restoring the manifest

### `nalc pass`

Restore the current project to normal dependency specs and remove nalc state files.

```bash
nalc pass
```

Behavior:

- restores every tracked package back to its original dependency range
- reinstalls the consumer with the recorded package manager
- removes `.nalc/state.json` and drops the empty `.nalc` directory
- removes stale nalc-owned `.pnpm` package instances

### `nalc ws [path]`

Detect workspace packages and publish them in dependency order.

```bash
nalc ws
nalc ws ../workspace --ignore docs-site playground
```

### `nalc watch [path]`

Watch the current package or workspace and automatically republish changed packages.

```bash
nalc watch
nalc watch ../workspace --ignore app-shell
```

Behavior:

- republish is debounced
- `watch` always enables `changed: true`, `push: true`, and `workspaceResolve: true`

### `nalc refresh [path]`

Touch `tsconfig.json`, `jsconfig.json`, or `package.json` so editors rebuild their local dependency graph after `nalc add` or `nalc update`.

```bash
nalc refresh
nalc refresh ../consumer
```

Behavior:

- prefers `tsconfig.json`, then `tsconfig.base.json`, then `jsconfig.json`, then `package.json`
- prints the touched file, detected package manager, and tracked package count
- the same refresh step also runs automatically after successful consumer installs

### `nalc dir`

Print the nalc home directory.

## State Files

### Global state

Stored at:

```txt
~/.nalc/registry/state.json
```

Tracks:

- active Verdaccio runtime metadata
- published package metadata
- tracked consumer directories for each package

### Consumer state

Stored at:

```txt
<consumer>/.nalc/state.json
```

Tracks:

- `dependencyType`: target field such as `dependencies` or `devDependencies`
- `originalSpec`: dependency range before nalc took over
- `localSpec`: exact installed nalc version
- `manifestSpec`: exact local version written to `package.json` while the project is under nalc management
- `sourcePath`: source package path
- `registryUrl`: local registry URL used by the consumer
- `installedAt`: last install timestamp

## Configuration

Use `.nalcrc` in the current working directory to define defaults:

```ini
workspace-resolve=true
dev-mod=true
save=true
scripts=true
quiet=false

[ignore]
packages = docs-site, playground
files = .DS_Store, *.log
```

Supported flags read from `.nalcrc`:

- `port`
- `workspace-resolve`
- `dev-mod`
- `save`
- `scripts`
- `quiet`
- `mode`
- `ignore`

Use `--dir <path>` to override the default nalc home directory.

## Programmatic API

`nalc` also exposes a small programmable surface from `lib/index.js`.

```ts
import {
  publishPackage,
  smartPublish,
  watchPackages,
  ensureRegistryRuntime,
  addRegistryPackages,
  updateRegistryPackages,
  removeRegistryPackages,
  pushRegistryPackages,
  refreshConsumerProjectGraph,
  readGlobalRegistryState,
  writeGlobalRegistryState,
  readConsumerRegistryState,
  writeConsumerRegistryState,
} from 'nalc'
```

Main groups:

- publish pipeline: `publishPackage`, `smartPublish`, `watchPackages`
- runtime control: `ensureRegistryRuntime`
- consumer operations: `addRegistryPackages`, `updateRegistryPackages`, `removeRegistryPackages`, `pushRegistryPackages`, `refreshConsumerProjectGraph`
- state access: `read*State`, `write*State`, tracked consumer helpers

For detailed API signatures and examples, see:

- `docs/design.md`
- `docs/programmatic-api.md`

## Detailed Docs

- Chinese overview: `README_CN.md`
- Design notes: `docs/design.md`
- Programmatic API: `docs/programmatic-api.md`
- Future direction: `ROADMAP.md`

## Status

Phase 1 supports:

- `npm`
- `pnpm`
- `bun`
- monorepo detection and bulk publish
- watch and push through the registry pipeline

Phase 1 does not support:

- Yarn PnP
- legacy link, file, copy-store, or vendorized local package flows

## License

MIT
