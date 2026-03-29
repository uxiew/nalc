# Nalc changelog

## 1.0.0-beta.01

- hard fork into `nalc` with a registry-first architecture
- remove copy-store, `file:`, `link:`, and lockfile-based local package flows
- switch the product to registry-first local package development
- embed Verdaccio as the local registry runtime
- add `serve`, `publish`, `push`, `add`, `update`, `remove`, `detect`, and `watch` around the registry pipeline
- store global runtime state under `~/.nalc/registry`
- store consumer state under `.nalc/state.json`
- generate unique local prerelease versions in the form `<base>-nalc.<timestamp>.<buildId>`
- rewrite repository metadata to `https://github.com/uxiew/nalc`
- rewrite documentation and examples around the `nalc` workflow

## Notes

- Phase 1 supports `npm`, `pnpm`, and `bun`
- Phase 1 does not support Yarn PnP
