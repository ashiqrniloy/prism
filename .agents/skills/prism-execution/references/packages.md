# Packages — definePackage, loader, manifest, authoring

The package system (`definePackage`, `PackageAPI`, config, capabilities, services, session state, background tasks, commands, status notes, `inspect()`), the manifest and `prism` CLI, and how to author a native package.

## Target

- [roadmap.md](../../../../roadmap.md) §2.6 (packages), §2.7 (manifest and installation), §2.10 (repo structure). Built in roadmap Phases 2 and 4.
- **Lifecycle:**
  1. Resolve inputs from code, the manifest, or both.
  2. Merge config: defaults, then manifest, then `packageConfig`.
  3. Validate it against the JSON Schema; secret fields accept refs only.
  4. Check `requires` (kernel range, required packages, services), in topological order.
  5. Run `setup` in order.
  6. Resolve slot owners.
  7. Build the agent.
  8. On shutdown, dispose packages in reverse order.
- **Failure:** a `setup` failure fails closed and names the package. Manifest entries marked `"optional": true` are skipped with a status note instead.
- **Manifest:** `.prism/packages.json` (project) and `~/.prism/packages.json` (user). The user file merges first, then the project file overrides it per package. Packages install via `bun add` into a Prism-managed directory, and integrity is verified before import. A project manifest loads only after the host's trust callback approves it.

## Package layout (every native package)

```
packages/<group>/<name>/
  package.json        "exports": { ".": "./src/index.ts" }  (Bun runs TS source; no build step)
  src/index.ts        export default definePackage({ name, version, requires: { prism }, capabilities, config, setup })
  src/__tests__/      package conformance + behavior tests on the mock provider
  README.md           package page structure (.agents/skills/create-plan/references/prism-wiki.md)
```

- **Capabilities:** declare the minimum. They are enforced on SDK-mediated APIs: `models.client` needs `"models"`; `slots.X.provide` needs `"slot:X"`.
- **When the package cannot operate** (missing key, missing binary): register nothing and call `prism.status.note(...)`. Do not throw.
- **Session state:** `prism.state.session(key, initial)` values must be JSON; they are persisted, restored on resume, and copied on fork.
- **Background work:** use `session.background(name, task)`. Never leave a promise untracked.
- **Commands and tools:** a name collision fails closed. Use `tools.register(tool, { when })` for per-session visibility.

## Today

- Package system: `src/packages/{define,loader,api,config,capabilities,schema,semver,errors}.ts` (`definePackage`, the loader, `PackageAPI`, `requires: { api }` checked against `KERNEL_API_LEVEL`).
- Manifest: `src/manifest/{load,install,integrity,merge,maintain,store,format,schema}.ts` (`@arnilo/prism/manifest`; `.prism/packages.json` project and user scopes, dependency-closure integrity, project trust).
- CLI: `src/cli.ts`, `src/cli-manifest.ts` (`prism add`, `remove`, and the manifest commands).
- File contributions: `src/node/contribution-discovery.ts` and `src/contribution-parsing.ts` (`SKILL.md` and agent files; inert data, never code).
- Current docs: [packages.md](../../../../docs/packages.md), [manifest.md](../../../../docs/manifest.md) (manifest and the `prism` CLI), [agent.md](../../../../docs/agent.md), [hooks.md](../../../../docs/hooks.md), [testing.md](../../../../docs/testing.md) (package conformance).

## Graft queries

- `graft ask "package loader setup unwind dispose capabilities" --source`
- `graft ask "manifest install integrity dependency closure" --source`
- `graft callers definePackage --depth 2`

## Tests

- `src/__tests__/package-loader.test.ts`, `package-config.test.ts`, `package-contributions.test.ts`, `package-api-reads.test.ts`, `package-api-freeze.test.ts`, `package-setup-boundaries.test.ts`, `package-conformance.test.ts`
- Manifest and CLI: `manifest-load.test.ts`, `manifest-install.test.ts`, `manifest-integrity.test.ts`, `manifest-maintain.test.ts`, `manifest-format.test.ts`, `cli-manifest.test.ts`, `cli-bin.test.ts`
- Published conformance: `packageConformance` in `@arnilo/prism/testing` (idempotent setup and dispose, no leak after dispose, a valid config schema, capabilities covering the APIs used, no secret in `inspect()`)

## Rules

- Never reintroduce host-activated contributions. A package that has loaded is active.
- **A new package** needs: an entry in the root `workspaces`, the `scripts/package-truth.mjs` counts, the `packaging.test.ts` package list, a compat baseline file, a decision in `scripts/independent-packages.json` (empty until the 0.13.0 publish: everything ships lockstep), `requires: { api: 1 }`, and a `docs/index.md` link to its README.
- A package must not import another package's internals. It depends only through `requires.packages` plus `services`.
- A manifest config value that looks like a literal secret is rejected; do not relax that check.
