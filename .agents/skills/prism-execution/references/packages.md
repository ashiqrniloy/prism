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

## Today (0.12 code being replaced)

- `src/extensions.ts` (`createExtensionKernel`, `activateKernel`, `forwardAgentEvents`), `src/contributions.ts`, `src/manifests.ts` (`PrismManifest`), `src/provider-packages.ts`, `src/node/contribution-discovery.ts`. All of these are removed once `definePackage` lands.
- `packages/agent-sdk/src/` (`defineAgent`, planes, presets): replaced by the kernel `createAgent`.
- `packages/hooks`: the first package to port; it becomes `packages/integrations/hooks-json`.
- CLI: `src/cli.ts`, `src/cli-init.ts`, `src/cli-provider-add.ts`. These are replaced by the manifest CLI; scaffolding survives as `prism new package`.
- Current docs (released contract): [extensions.md](../../../../docs/extensions.md), [extension-authoring.md](../../../../docs/extension-authoring.md), [contribution-registries.md](../../../../docs/contribution-registries.md), [configuration-and-manifests.md](../../../../docs/configuration-and-manifests.md), [agent-sdk.md](../../../../docs/agent-sdk.md), [hooks.md](../../../../docs/hooks.md), [cli-rpc.md](../../../../docs/cli-rpc.md).

## Graft queries

- `graft ask "extension kernel load setup unwind dispose" --source`
- `graft ask "defineAgent planes assemble tool registry" --source`
- `graft callers activateKernel --depth all` (every consumer to migrate)

## Tests

- `src/__tests__/extensions.test.ts`, `contributions*.test.ts`, `middleware.test.ts`; `packages/agent-sdk/src/__tests__/`; `packages/hooks/src/__tests__/`
- Target suite: the package conformance suite in `@arnilo/prism/testing`. It checks that setup and dispose are idempotent, nothing leaks after dispose, the config schema is valid, declared capabilities cover the APIs used, and no secret appears in `inspect()`.

## Rules

- Never reintroduce host-activated contributions. A package that has loaded is active.
- **Tooling owned by the first plan that creates `packages/<group>/<name>`:**
  - add the nested layout to the root `workspaces`
  - update `scripts/package-truth.mjs` `workspacePackageCounts()`, `packaging.test.ts`, and `public-export-contract.test.ts` for TypeScript-source exports
  - regenerate the compat baseline
- Each new publishable package also needs a decision in `scripts/independent-packages.json` and a compat baseline file.
- A package must not import another package's internals. It depends only through `requires.packages` plus `services`.
- A manifest config value that looks like a literal secret is rejected; do not relax that check.
