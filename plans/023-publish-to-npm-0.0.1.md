# Publish Prism 0.0.1 to npm

## Objectives
- Resolve the `prism` core name conflict on the npm registry (`prism@4.1.2` already exists; verified live).
- Make all 8 code packages (`@arnilo/prism` + 7 first-party `@arnilo/prism-*` workspaces) publishable and installable by third-party projects via plain `npm install`.
- Add 3 umbrella convenience packages (`@arnilo/prism-providers`, `@arnilo/prism-compaction`, `@arnilo/prism-all`) so consumers can install the core, the provider family, the compaction family, or everything with one specifier.
- Fix the broken public quickstart snippet that throws on copy-paste (deferred from plan 022 Further Actions).
- After executing the plan (code work + manual account/registry steps), tag `v0.0.1` and publish.

## Expected Outcome
- `npm view @arnilo/prism version` returns `0.0.1` (and so do all 10 other packages).
- A third party can run `npm install @arnilo/prism-all` (or `npm install @arnilo/prism @arnilo/prism-provider-openai`) in a fresh project and the documented quickstart runs end-to-end without errors.
- `npm run release:dry-run` exits 0 against the renamed specifiers and produces 11 tarballs.
- Tag `v0.0.1` pushed to GitHub triggers the existing `release.yml` `publish` job, which publishes core first then all 10 workspaces (7 individuals + 3 umbrellas) with public access.

## Tasks

- [x] Task 1 — Rename core package `prism` → `@prism/core`
  - Acceptance Criteria:
    - Functional: root `package.json` `"name": "@prism/core"`; the `bin` still resolves (`prism` bin name can stay since bin names are independent of package name — verify the CLI still builds to `dist/cli.js` and `prism` command works after install). All 7 workspace `package.json` files declare `"@prism/core"` in `peerDependencies` (replacing `"prism": "0.0.1"`) and in `devDependencies` (`"@prism/core": "file:../.."`). `tsconfig.packages.json` and `examples/tsconfig.json` `paths` keys renamed from `prism`/`prism/*`/`prism/testing/*`/`prism/node/*` to `@prism/core`/`@prism/core/*`/etc. `npm run release:dry-run` exits 0.
    - Performance: `npm test` still under the < 30s offline budget (baseline ~22s on Node 20); no new work introduced.
    - Code Quality: No bare `"prism"` specifier left in any runtime/example/config file (only in `dist/`, `node_modules/`, and `%22prism%22` API search examples that are illustrative text). TypeScript `paths` exact subpaths (`@prism/core/node/config`, etc.) preserved so subpath imports typecheck.
    - Security: No real secrets introduced; the rename is identifier-only.
  - Approach:
    - Documentation Reviewed:
      - `package.json` (root): `name`, `exports` subpaths, `bin`, `workspaces`.
      - `packages/*/package.json`: `peerDependencies`, `devDependencies`, `repository.directory`, `homepage`.
      - `docs/release-and-install.md`: peer-dep + install table.
      - `tsconfig.packages.json`, `examples/tsconfig.json`: `paths` mappings consumed by `npm run typecheck` (the build verifies examples compile).
      - npm docs: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#name — scoped name format `@scope/pkg`; `bin` field is independent of `name`, so the `prism` CLI binary name can stay.
    - Options Considered:
      - Rename to `@prism/core`: unifies all 8 packages under one scope, removes the `prism@4.1.2` conflict, matches the existing `@prism/provider-*` / `@prism/compaction-*` naming. Chosen.
      - Keep `prism` and negotiate a name transfer with the existing owner: not viable (owner is unrelated, `prism@4.1.2` is actively published). Rejected.
      - Rename to a non-scoped alternative like `prism-agent`: loses scope unification with workspaces and the `prism` brand; worse. Rejected.
    - Chosen Approach:
      - Scope everything under `@prism`. Core = `@prism/core`. Bin name `prism` stays (npm lets `bin` differ from `name`), so `npx prism ...` and `npm install -g` CLI usage documented in `docs/cli-rpc.md` keeps working.
    - API Notes and Examples:
      ```json
      // root package.json
      {
        "name": "@prism/core",
        "bin": { "prism": "./dist/cli.js" },
        "exports": {
          ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
          "./providers/openai-compatible": { "types": "./dist/providers/openai-compatible.d.ts", "default": "./dist/providers/openai-compatible.js" }
        }
      }
      ```
      ```json
      // packages/provider-openai/package.json
      {
        "peerDependencies": { "@prism/core": "0.0.1" },
        "devDependencies": { "@prism/core": "file:../.." }
      }
      ```
    - Files to Create/Edit:
      - `package.json`: `name` → `@prism/core`.
      - `packages/provider-openai/package.json`, `packages/provider-opencode-go/package.json`, `packages/provider-openrouter/package.json`, `packages/provider-zai/package.json`, `packages/provider-kimi/package.json`, `packages/compaction-llm/package.json`, `packages/compaction-observational-memory/package.json`: `peerDependencies` and `devDependencies` key `prism` → `@prism/core`.
      - `tsconfig.packages.json`: rename `paths` keys `prism` → `@prism/core`, `prism/testing/provider-conformance` → `@prism/core/testing/provider-conformance`, `prism/*` → `@prism/core/*`.
      - `examples/tsconfig.json`: same `paths` rename for `prism`, `prism/testing/*`, `prism/node/*`, `prism/*`.
    - References:
      - npm name rules: https://docs.npmjs.com/package-name-guidelines
      - plan 022 `## Further Actions` "publish-readiness verdict" (the false-green gate that never checked the registry).
  - Test Cases to Write:
      - Extend `src/__tests__/packaging.test.ts` (already runs in `npm test`, 41/41 per plan 022) to assert core `name === "@prism/core"` and every workspace `peerDependencies["@prism/core"] === "0.0.1"`. Preserve the existing deny-list + metadata completeness assertions.
      - Reuse existing `install-smoke.test.ts` (installs all packed tarballs into a fresh temp project) — after rename it validates `@prism/core` resolves and every workspace `@prism/*` dynamic-imports. No new test needed; the assert below makes the rename enforceable.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package name and all import specifiers are public surface.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: install table + peer-dep example + import lines (covered in Task 4).
    - `docs/index.md` update: yes — add/adjust the "Installation" heading to point consumers at `@prism/core`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Fix the broken `createExtensionKernel()` quickstart snippet
  - Acceptance Criteria:
    - Functional: No `const { api } = createExtensionKernel(); api.registerProviderPackage(...)` remains in README, `docs/`, or `examples/`. The corrected snippet uses `const kernel = createExtensionKernel(); await kernel.load([createProviderPackage({...})])` because `createExtensionKernel()` returns `{ registries, middleware, events, load }` (no `api` property; `api` is the internal object passed to `extension.setup(api)`). A copy-paste-and-run of the README quickstart executes without throwing.
    - Performance: n/a (docs only).
    - Code Quality: Snippets match `examples/provider-registration.ts` (the working reference). Markdown code fences preserved.
    - Security: Fake/placeholder credentials only (`"fake-openai-key"`, `createEnvCredentialResolver` with fake env); no real keys.
  - Approach:
    - Documentation Reviewed:
      - `src/extensions.ts` lines 89–175: `createExtensionKernel()` returns `{ registries, middleware, events, async load(extensions) }`; `registerProviderPackage` lives on the internal `api` object passed to `extension.setup(api)`.
      - `examples/provider-registration.ts`: working pattern `kernel.load([createOpenAIProviderPackage({...})])`.
      - Live grep (6 occurrences): `README.md:77-78`, `docs/providers/openai.md`, `docs/providers/openrouter.md`, `docs/providers/kimi.md`, `docs/providers/zai.md`, `docs/providers/opencode-go.md`.
    - Options Considered:
      - Replace the destructure with `kernel.load([...])`: matches the real extension API and the working example; minimal edit. Chosen.
      - Expose an `api`-style helper from the kernel: would expand public surface for a docs fix. Rejected.
    - Chosen Approach:
      - Replace each broken block with the `kernel.load([createProviderPackage({...})])` pattern, keeping the same options object and credential resolver in each doc.
    - API Notes and Examples:
      ```ts
      import { createExtensionKernel, createEnvCredentialResolver } from "@prism/core";
      import { createOpenAIProviderPackage } from "@prism/provider-openai";

      const kernel = createExtensionKernel();
      await kernel.load([
        createOpenAIProviderPackage({
          apiKey: createEnvCredentialResolver({ OPENAI_API_KEY: "fake" }, { openai: "OPENAI_API_KEY" }),
        }),
      ]);
      ```
    - Files to Create/Edit:
      - `README.md`: quick-start "Register a first-party provider package" snippet.
      - `docs/providers/openai.md`, `docs/providers/openrouter.md`, `docs/providers/kimi.md`, `docs/providers/zai.md`, `docs/providers/opencode-go.md`: the `api.registerProviderPackage(...)` blocks.
    - References:
      - plan 022 `## Further Actions` (the "Docs bug found by Task 5 walk-through (priority: high)").
      - `examples/provider-registration.ts`.
  - Test Cases to Write:
      - Extend `src/__tests__/docs.test.ts` (already runs in `npm test`, 27 tests per plan 021) with an assertion that no file under `README.md` or `docs/` contains the string `const { api } = createExtensionKernel()`. Cheap substring deny-check; fails if the bug regresses.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the documented usage of `createExtensionKernel()` + provider packages.
    - Docs pages to create/edit: listed in Files to Create/Edit.
    - `docs/index.md` update: no (snippet fix, not navigation).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Add `publishConfig: { access: "public" }` to every first-party manifest
  - Acceptance Criteria:
    - Functional: All 8 `package.json` files (core + 7 workspaces) declare `"publishConfig": { "access": "public" }`. A manual `npm publish` (without `--access public`) on a scoped package succeeds publicly. The existing `release.yml` `--access public` flags remain as belt-and-suspenders.
    - Performance: n/a.
    - Code Quality: Consistent across all 8 manifests; placed after `sideEffects` for readability.
    - Security: `access: "public"` is correct for an open-source MIT package; no `restricted`/paid exposure risk.
  - Approach:
    - Documentation Reviewed:
      - https://docs.npmjs.com/cli/v10/commands/npm-publish#access — scoped packages default to `restricted`; `publishConfig.access` overrides the default so a forgotten flag can't produce a private publish.
    - Options Considered:
      - Rely solely on the workflow `--access public` flag (current state): works for CI, fails for a manual publish that forgets the flag. Rejected.
      - Add `publishConfig.access: public` to manifests: survives manual + CI publish. Chosen.
    - Chosen Approach:
      - Add `"publishConfig": { "access": "public" }` to all 8 manifests.
    - API Notes and Examples:
      ```json
      "publishConfig": { "access": "public" }
      ```
    - Files to Create/Edit:
      - `package.json`, `packages/provider-openai/package.json`, `packages/provider-opencode-go/package.json`, `packages/provider-openrouter/package.json`, `packages/provider-zai/package.json`, `packages/provider-kimi/package.json`, `packages/compaction-llm/package.json`, `packages/compaction-observational-memory/package.json`.
    - References:
      - npm publish access docs (link above).
      - plan 020 `## Compromises Made` (the `file:../..` devDependency note; `publishConfig.access` is additive and compatible).
  - Test Cases to Write:
      - Extend `src/__tests__/packaging.test.ts` to assert every tarball's manifest (via `npm pack --dry-run --json` metadata or by reading each `package.json`) contains `publishConfig.access === "public"`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — publish-time config only.
    - Docs pages to create/edit: `docs/release-and-install.md` — add one bullet under the release-workflow section noting `publishConfig.access: public` is set so manual publishes stay public.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Update install/import specifiers across docs and examples
  - Acceptance Criteria:
    - Functional: Every `import ... from "prism"`, `import ... from "prism/..."`, `npm install prism`, and `"prism": "..."` (non-`@prism/*`) in `README.md`, `docs/**/*.md`, `examples/**/*.ts`, and any catalog text resolves to `@prism/core` / `@prism/core/...`. `npm run typecheck` (which compiles `examples/`) exits 0. `npm test`'s `docs.test.ts` ("no bare `prism` specifier outside illustrative text") passes.
    - Performance: no impact (text edits).
    - Code Quality: Subpath specifiers preserved exactly (`@prism/core/providers/openai-compatible`, `@prism/core/node/config`, `@prism/core/node/settings`, `@prism/core/node/trust`, `@prism/core/node/session-store-jsonl`, `@prism/core/testing/provider-conformance`). No accidental `@prism/core/` prefix added to the already-scoped `@prism/provider-*` / `@prism/compaction-*` imports.
    - Security: fake credentials only.
  - Approach:
    - Documentation Reviewed:
      - Grep inventory: 427 `prism`/`prism/` specifier occurrences across `*.ts`/`*.json`/`*.md` (excluding `plans/`, `dist/`, `node_modules/`).
      - `docs/release-and-install.md` lines 11, 29, 30, 72, 91, 93, 95, 109: install table, peer-dep block, import examples.
      - `README.md` lines 37, 44, 53, 74, 75: install + import snippets.
      - `examples/*.ts`: all import from `"prism"` or `"prism/..."`.
      - `docs/public-contracts.md`, `docs/provider-layer.md`, `docs/cli-rpc.md`, etc.: illustrate imports.
    - Options Considered:
      - Global `sed` rename then targeted review: fastest for 427 hits; risk of touching inside-fences where `prism` is a word not a specifier. Mitigate by anchoring on `"prism"`/`prism/`/`from "prism` patterns and excluding `plans/`. Chosen with a follow-up grep audit.
      - Hand-edit each file: too slow for 427 occurrences, no benefit over sed+audit. Rejected.
    - Chosen Approach:
      - 1) `sed` replace `from "prism"` → `from "@prism/core"`, `<install prism>` → `<install @prism/core>`, `"prism":` specifiers → `"@prism/core":`, and `prism/` subpaths → `@prism/core/` across `README.md`, `docs/`, `examples/`, `tsconfig*.json`, root `package.json` (non-`bin` field). 2) Grep audit for stray `"prism"` / `from "prism"` outside illustrative prose; fix individually. 3) Run `npm run typecheck` to confirm `examples/` compiles against the renamed tsconfig `paths`.
    - API Notes and Examples:
      ```ts
      import { createAgent, createAgentSession } from "@prism/core";
      import { createOpenAICompatibleProvider } from "@prism/core/providers/openai-compatible";
      import { loadConfigFile } from "@prism/core/node/config";
      ```
    - Files to Create/Edit:
      - `README.md`, all `docs/**/*.md`, all `examples/**/*.ts`, all `packages/*/README.md` (workspace READMEs ship in their tarballs; e.g. `packages/compaction-llm/README.md:23` still imports bare `prism`), `tsconfig.packages.json`, `examples/tsconfig.json` (paths touched in Task 1; verify here).
    - References:
      - Task 1 (manifest + tsconfig rename is the foundation).
      - `docs/release-and-install.md`.
  - Test Cases to Write:
      - Extend `src/__tests__/docs.test.ts` to assert no `from "prism"` or `npm install prism` (bare) remains in `README.md` or `docs/`. (Illustrative mentions of the `prism` CLI binary name are allowed since the bin name stays `prism`.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented import specifiers.
    - Docs pages to create/edit: all of `docs/` plus `README.md` (the bulk of this task).
    - `docs/index.md` update: yes — ensure the installation line uses `@prism/core`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Update the release workflow and `release-and-install.md` for the rename
  - Acceptance Criteria:
    - Functional: `.github/workflows/release.yml` `publish` job still publishes core first then workspaces; works unchanged because the `npm publish` commands are workspace-aware (root + `--workspaces`). The README + `docs/release-and-install.md` "Required peer" / install-table / peer-range widening note references `@prism/core`. `npm run pack:dry-run` produces 8 tarballs named `prism-core` ... wait, scoped tarballs are named `prism-core-0.0.1.tgz` for the core (npm strips the `@scope/` in the tarball filename). Verify all 8 tarballs produced and named as expected.
    - Performance: n/a.
    - Code Quality: workflow YAML unchanged except any comment referencing the old name; keep `permissions.id-token: write` for future `--provenance`.
    - Security: `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN`; no token in the repo.
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/release.yml` (full file): `verify` runs `npm ci` → `npm test` → `npm run pack:dry-run`; `publish` runs on `refs/tags/v*` after `verify`, executes `npm publish --access public` then `npm publish --workspaces --access public` (now `--access public` is belt-and-suspenders with Task 3).
      - `docs/release-and-install.md`: workflow description at line ~111, peer-range note at line ~109.
    - Options Considered:
      - Leave the workflow as-is (commands are name-agnostic): works, but the prose describing "Required `prism` peer" must update to `@prism/core`. Chosen (workflow YAML needs at most comment edits; the publish commands are correct).
      - Add `--provenance` now: requires public repo + OIDC; leave for a follow-up per plan 022 Further Actions. Deferred.
    - Chosen Approach:
      - Update the prose in `docs/release-and-install.md` (peer name, install table handled in Task 4, workflow bullets here referencing the `prism` peer → `@prism/core` peer). Leave the workflow file functionally as-is; only update a comment if it names `prism`.
    - API Notes and Examples:
      ```yaml
      # release.yml publish step — unchanged commands, name-agnostic
      - npm publish --access public          # publishes @prism/core first
      - npm publish --workspaces --access public  # publishes the 7 @prism/* packages
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md`: workflow bullet + peer-dep bullet referencing the renamed peer.
      - `.github/workflows/release.yml`: comment-only if any references the core name (verify; likely none needed).
    - References:
      - `.github/workflows/release.yml`.
      - plan 020 (release mechanics).
  - Test Cases to Write:
      - The existing `install-smoke.test.ts` (runs in `npm test`, 3/3 per plan 022) already packs all 8 tarballs and installs them offline into a fresh project; after rename it asserts `@prism/core` + workspaces resolve. Extend it to also assert the core tarball filename is `prism-core-0.0.1.tgz` (npm strips scope) so a future rename regresses loudly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented release/publish behavior.
    - Docs pages to create/edit: `docs/release-and-install.md`.
    - `docs/index.md` update: no (already covered in Task 4).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Final verification against the registry
  - Acceptance Criteria:
    - Functional: `npm run release:dry-run` exits 0 (runs `npm test` + `npm run pack:dry-run`). The new assertions in `packaging.test.ts` (rename + `publishConfig.access`) and `docs.test.ts` (no broken snippet, no bare `prism` specifier) pass. `npm view @prism/core` returns 404 (name now free to claim) — confirming the rename target is clear; the old `prism` name still returns `4.1.2` (confirming it was taken, justifying the rename).
    - Performance: `npm test` < 30s; `npm run release:dry-run` ~50s as measured in plan 022.
    - Code Quality: 8 clean tarballs; 0 secrets in shipped files (re-run the secret scan from plan 022 Task 4: `sk-…`/`AIza…`/`ghp_…`/PEM).
    - Security: 0 hits; live-test gate code still excluded (`!dist/__tests__`).
  - Approach:
    - Documentation Reviewed:
      - plan 022 `## Compromises Made` (the measured release gate: 541 tests / 0 fail / 6 documented skips, 246 shipped files, 0 secret hits).
    - Options Considered:
      - Re-run only `npm test`: insufficient, because the gating risk is the registry name conflict which `pack --dry-run` never caught. Add the live `npm view` check. Chosen.
    - Chosen Approach:
      - Run `npm view @prism/core` (expect 404 → clear) and `npm view prism` (expect 4.1.2 → was taken). Run `npm run release:dry-run`. Run the secret scan over the 8 packed tarballs. Record actual numbers in `Compromises Made`.
    - API Notes and Examples:
      ```bash
      npm view @prism/core            # expect E404 (free to claim)
      npm view prism                  # expect 4.1.2 (why rename was needed)
      npm run release:dry-run         # full gate
      ```
    - Files to Create/Edit:
      - none (verification only; fill `Compromises Made` / `Further Actions` here).
    - References:
      - plan 022 `## Compromises Made`, `## Further Actions`.
  - Test Cases to Write:
      - No new test; uses the extended `packaging.test.ts` + `docs.test.ts` + `install-smoke.test.ts` from Tasks 1–5. The `npm view` checks are manual command-line confirmations recorded in the plan, not unit tests (they hit the network).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification only).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 7 — Re-scope to personal `@arnilo` scope + add umbrella meta packages (`prism-providers`, `prism-compaction`, `prism-all`)
  - Acceptance Criteria:
    - Functional: Core package renamed `@prism/core` → `@arnilo/prism` (the `prism` leaf keeps the brand; CLI bin `prism` unchanged). All 7 individual first-party packages renamed `@prism/*` → `@arnilo/prism-*` (branded leaf names): `@arnilo/prism-provider-{openai,opencode-go,openrouter,zai,kimi}` and `@arnilo/prism-compaction-{llm,observational-memory}`; their `peerDependencies` / `devDependencies` point at `@arnilo/prism`. Three NEW pure-manifest umbrella packages created: `@arnilo/prism-providers` (depends on the 5 `@arnilo/prism-provider-*` packages), `@arnilo/prism-compaction` (depends on the 2 `@arnilo/prism-compaction-*` packages), `@arnilo/prism-all` (depends on `@arnilo/prism` + `@arnilo/prism-providers` + `@arnilo/prism-compaction`, the clean transitive tree). Umbrella packages have NO `dist`, NO `exports`, NO `bin` — they are install convenience manifests only. `npm install @arnilo/prism-all` transitively installs all 8 code packages; `npm install @arnilo/prism-providers` installs core (via peers) + 5 providers; `npm install @arnilo/prism-compaction` installs core (via peers) + 2 compaction. `npm install @arnilo/prism` installs core only. `npm run release:dry-run` exits 0 and produces 11 tarballs named `arnilo-prism-0.0.1.tgz`, `arnilo-prism-provider-*.tgz`, `arnilo-prism-compaction-*.tgz`, `arnilo-prism-providers-0.0.1.tgz`, `arnilo-prism-compaction-0.0.1.tgz`, `arnilo-prism-all-0.0.1.tgz`. `npm view @arnilo/prism` → E404 (free); `npm view @arnilo/prism-all` → E404 (free).
    - Performance: `npm test` < 30s offline budget; `npm run release:dry-run` ~30s. Umbrella metas add ~3 tarballs but no build/test step (`--if-present` skips them).
    - Code Quality: No bare `@prism/` specifier remains in any runtime/example/config/docs file (regression guard extended in `docs.test.ts` to deny both bare `prism` AND bare `@prism/`). Umbrella metas use `dependencies` (hard deps, standard umbrella idiom) NOT `peerDependencies`; the individuals keep `peerDependencies: { "@arnilo/prism": "0.0.1" }`. Workspaces array lists metas LAST so `npm publish --workspaces` publishes individuals before metas (belt-and-suspenders; npm does not resolve deps at publish time, but keeps the install graph shallow). Each umbrella has `publishConfig.access: public`, `sideEffects: false`, `files: ["README.md"]`.
    - Security: `@arnilo` is the owner's personal npm scope (username confirmed `arnilo`); no org creation needed. No secrets introduced. Umbrella metas pull no new code, only manifest deps.
  - Approach:
    - Documentation Reviewed:
      - `package.json` (root): `workspaces: ["packages/provider-*", "packages/compaction-*"]` — metas land in `packages/prism-*` and need explicit array entries (the existing globs will NOT match `prism-*`).
      - `packages/*/package.json`: `peerDependencies`/`devDependencies` currently `@prism/core` (post Task 1) → repoint to `@arnilo/prism`.
      - `tsconfig.packages.json`, `examples/tsconfig.json`: `paths` keys `@prism/core*` → `@arnilo/prism*`.
      - `src/__tests__/packaging.test.ts`, `install-smoke.test.ts`, `docs.test.ts`, `phase13/14-boundaries.test.ts`, the 7 workspace `index.test.ts` files: all assert `@prism/core` post Task 1 → repoint.
      - `.github/workflows/release.yml`: comment references `@prism/core` peer (Task 5) → `@arnilo/prism`; publish commands are workspace-agnostic and unchanged.
      - npm docs: scoped package `bin` may differ from `name` (already used); umbrella packages with only `dependencies` are a standard idiom (e.g. `@types/...`, `react-all`-style kits); npm does NOT resolve dependencies at `publish` time, only at `install` time.
      - Tasks 1/4/5: the rename playbook (manifests → tsconfig paths → ~66 src files via the `@prism/core`-literal sweep → tests → docs → release.yml comment) is already proven; Task 7 re-runs the same sweep with `@prism/core`/`@prism/` as the source tokens and `@arnilo/prism`/`@arnilo/` as the targets.
    - Options Considered:
      - Individual package leaf names: `@arnilo/provider-openai` (shorter, matches existing workspace dirs) vs `@arnilo/prism-provider-openai` (branded, self-identifying outside the scope). **`@arnilo/prism-provider-*` / `@arnilo/prism-compaction-*` chosen** (owner decision): the `prism-` prefix makes each package self-identifying in an `npm install` line or `node_modules` listing even outside the `@arnilo` scope context, and brands the family consistently. Shorter form rejected.
      - `@arnilo/prism-all` dependency graph: depend on (core + prism-providers + prism-compaction) vs re-list all 8 individuals. Chosen: depend on the two sub-umbrellas + core — cleaner, no duplication, shallow transitive tree. Rejected: flat re-list (duplicate dep declarations, drift risk).
      - Umbrella `dependencies` vs `peerDependencies`: `dependencies` chosen — umbrellas exist to transitively install their family; peers would defeat the one-command convenience. Individuals keep peers on core (Phase-19 opt-in boundary preserved).
      - Bundling all provider code into one `@arnilo/prism-providers` package (monolith) vs umbrella-over-individuals: umbrella chosen — preserves the dep-free-core / opt-in-provider Phase-19 boundaries and keeps tarballs small; monolith rejected (contradicts the documented design and bloats one giant tarball).
    - Chosen Approach:
      - Re-run the proven rename sweep (Tasks 1/4/5 playbook) with scope `@prism` → `@arnilo` and core leaf `core` → `prism`. Then add 3 umbrella manifests under `packages/prism-providers`, `packages/prism-compaction`, `packages/prism-all`, each a pure `package.json` + `README.md` with `dependencies` on its family. Extend the guard tests to cover the metas. Umbrellas are zero-code: no `dist`, no `exports`, skip dynamic-import in install-smoke (`isMeta` flag).
    - API Notes and Examples:
      ```jsonc
      // packages/prism-all/package.json — pure umbrella, no code
      {
        "name": "@arnilo/prism-all",
        "version": "0.0.1",
        "description": "Umbrella: core + all provider and compaction packages for @arnilo/prism.",
        "license": "MIT",
        "sideEffects": false,
        "publishConfig": { "access": "public" },
        "files": ["README.md"],
        "dependencies": {
          "@arnilo/prism": "0.0.1",
          "@arnilo/prism-providers": "0.0.1",
          "@arnilo/prism-compaction": "0.0.1"
        }
      }
      ```
      ```jsonc
      // packages/prism-providers/package.json
      { "name": "@arnilo/prism-providers", /* ...same shape... */
        "dependencies": {
          "@arnilo/prism-provider-openai": "0.0.1",
          "@arnilo/prism-provider-opencode-go": "0.0.1",
          "@arnilo/prism-provider-openrouter": "0.0.1",
          "@arnilo/prism-provider-zai": "0.0.1",
          "@arnilo/prism-provider-kimi": "0.0.1"
        } }
      ```
      ```bash
      npm view @arnilo/prism        # E404 (free)
      npm view @arnilo/prism-all    # E404 (free)
      npm install @arnilo/prism-all # pulls all 8 code packages
      ```
    - Files to Create/Edit:
      - `package.json` (root): `name` → `@arnilo/prism`; `workspaces` add `packages/prism-providers`, `packages/prism-compaction`, `packages/prism-all` (last).
      - `packages/{provider-openai,provider-opencode-go,provider-openrouter,provider-zai,provider-kimi,compaction-llm,compaction-observational-memory}/package.json`: `name` `@prism/*` → `@arnilo/prism-*` (branded); `peerDependencies`/`devDependencies` `@prism/core` → `@arnilo/prism`. (Workspace dir names stay as-is — dir ≠ package name, no churn.)
      - `packages/prism-providers/package.json` + `README.md` (NEW, pure umbrella).
      - `packages/prism-compaction/package.json` + `README.md` (NEW, pure umbrella).
      - `packages/prism-all/package.json` + `README.md` (NEW, pure umbrella).
      - `tsconfig.packages.json`, `examples/tsconfig.json`: `paths` `@prism/core*` → `@arnilo/prism*`.
      - ~66 `packages/*/src/**/*.ts` imports: `@prism/core` → `@arnilo/prism`.
      - `src/__tests__/packaging.test.ts`: packages array rename + add 3 metas; asserts umbrella `dependencies` resolve to the right family; `publishConfig.access: public` on metas.
      - `src/__tests__/install-smoke.test.ts`: packages array rename + add 3 metas with `isMeta: true`; skip dynamic-import for metas (no exports); assert `prism-all` install pulls all 8 code packages into `node_modules`.
      - `src/__tests__/docs.test.ts`: extend deny-check to also reject bare `@prism/` specifiers (old-scope regression guard); update subpath assertions to `@arnilo/prism/*`.
      - `src/__tests__/phase13-boundaries.test.ts`, `phase14-boundaries.test.ts`, the 7 `packages/*/src/__tests__/index.test.ts`: repoint `@prism/core` assertions → `@arnilo/prism`.
      - `README.md` + `docs/**/*.md` + `examples/**/*.ts` + `packages/*/README.md`: `@prism/core`/`@prism/*` → `@arnilo/prism`/`@arnilo/prism-*`; add umbrella install table to `docs/release-and-install.md`.
      - `.github/workflows/release.yml`: comment `@prism/core` → `@arnilo/prism`.
    - References:
      - Tasks 1, 4, 5 (the rename playbook + guard-test additions).
      - `docs/release-and-install.md` install matrix.
      - npm umbrella-package idiom and `dependencies` vs `peerDependencies` semantics.
  - Test Cases to Write:
    - packaging: each of 3 umbrellas has `publishConfig.access === public`, `sideEffects === false`, `files` minimal, and `dependencies` resolving to exactly its family members (no extras, no missing).
    - install-smoke: `@arnilo/prism-all` tarball install (offline, all 11 tarballs staged) results in all 8 code packages present in `node_modules`; metas themselves pack and install without error; metas are NOT dynamic-imported (no exports).
    - docs: no bare `prism` specifier AND no bare `@prism/` specifier anywhere in README/docs (double regression guard against re-scoping drift).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published package names + install surface change from `@prism/core` to `@arnilo/prism`; 3 new umbrella packages added.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: rewrite package list + install table to `@arnilo/*`; add an "Umbrella packages" subsection documenting `prism-providers`/`prism-compaction`/`prism-all` and when to use each (core-only / +providers / +compaction / everything).
      - `README.md`: quickstart install commands → `@arnilo/prism`; add the one-liner `@arnilo/prism-all` option.
      - `packages/prism-{providers,compaction,all}/README.md` (NEW): minimal "what this pulls in" doc.
    - `docs/index.md` update: yes — bump the "Release and install" line's peer name.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Manual Account & Registry Steps (owner — step-by-step, no task structure)

These must be done by a human with npm/GitHub credentials. They cannot be automated by the agent.

**Scope is `@arnilo` — a personal npm scope tied to your npm username `arnilo`. No npm organization creation is needed.** (The original plan's "create an @prism org" step is obsolete: `@prism` was unavailable on the registry because the existing unscoped `prism` package blocks org names that collide with package names. Task 7 changed the strategy to a personal scope.) npm lets you publish to `@<your-username>/*` immediately once authenticated — there are 11 packages to publish under `@arnilo`: core `@arnilo/prism`, 5 providers `@arnilo/prism-provider-*`, 2 compaction `@arnilo/prism-compaction-*`, and 3 umbrellas `@arnilo/prism-providers` / `@arnilo/prism-compaction` / `@arnilo/prism-all`.

1. **Sign in to your npm account.** Go to https://www.npmjs.com/login. Confirm your username is exactly `arnilo` (this owns the `@arnilo` scope). Verify your email if you have not. Run `npm whoami` locally after `npm login` to confirm it prints `arnilo`.
2. **Generate an npm access token.** Go to https://www.npmjs.com/settings/arnilo/tokens → "Generate New Token". Recommended: a **Granular Access Token** scoped to packages matching `@arnilo/*` with read+publish permissions (this covers all 11 packages including the 3 umbrellas). Expiration: your call, 90 days is sane. Alternatively a classic **Automation** token (publishes to any scope your account owns). Copy it — shown once.
3. **Add the token to GitHub.** Repo → Settings → Secrets and variables → Actions → New repository secret. Name: `NPM_TOKEN`. Value: the token. Your `release.yml` already reads `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, so once the secret exists the `publish` job does a real publish; until then it falls back to `--dry-run` (per the existing `if: env.NPM_TOKEN == ''` guard).
4. **Confirm publish rights.** Because `@arnilo` is your personal scope, your account can publish to it by default — no org membership step. (If you later want collaborators to publish to `@arnilo/*` without sharing your token, you would need to move to an npm org — defer, YAGNI for 0.0.1.)
5. *(Optional, recommended for trust)* **Enable provenance later.** If you want npm to show a "Verified" SLSA provenance badge, ensure the GitHub repo is public and add `--provenance` to both `npm publish` commands in `release.yml` (`publishConfig.access: public` + scoped package + public repo + OIDC `permissions.id-token: write` already set). Defer if not ready for 0.0.1.

## Publish Execution (owner — step-by-step)

After Tasks 1–7 are complete (Task 7 covered the re-scope to `@arnilo` and the 3 umbrella metas), all tests green, and the account/secret steps done:

1. **Local smoke before tagging.** From the repo root:
   ```bash
   npm run release:dry-run          # full gate: build + test + pack all 11
   npm view @arnilo/prism           # expect E404 right up until publish
   npm view @arnilo/prism-all       # expect E404 (umbrella not yet published)
   ```
   Confirm **11 tarballs** are produced (`arnilo-prism-0.0.1.tgz`, 5× `arnilo-prism-provider-*`, 2× `arnilo-prism-compaction-*`, and the 3 umbrellas `arnilo-prism-providers` / `arnilo-prism-compaction` / `arnilo-prism-all`), 0 secret hits, and the umbrella tarballs ship only `README.md` + `package.json`.
2. **Confirm version `0.0.1` is uniform** across all 11 `package.json` files (core + 7 individuals + 3 umbrellas). Already true after Task 7; re-check with:
   ```bash
   grep -rl '"version": "0.0.1"' package.json packages/*/package.json | wc -l   # expect 11
   ```
3. **Commit the re-scope + fixes** on a branch, then merge to `main`:
   ```bash
   git checkout -b chore/publish-0.0.1
   git add -A
   git commit -m "chore: re-scope to @arnilo, add umbrella metas, fix quickstart snippet, add publishConfig"
   git push -u origin chore/publish-0.0.1
   # open a PR, merge to main
   ```
   The rename sweep touched 159 files + created 3 new packages — review the diff before merge. (Or commit directly to `main` if that's your flow — the `release.yml` `verify` job runs on push to `main`.)
4. **Wait for the `verify` job** on `main` to go green (it runs `npm ci`, `npm test` with a 3-minute timeout, `npm run pack:dry-run`).
5. **Tag and push the release tag** (this is what triggers the publish job):
   ```bash
   git tag v0.0.1
   git push origin v0.0.1
   ```
   The `publish` job runs only on `refs/tags/v*`. It builds, then publishes `@arnilo/prism` first (core), then `npm publish --workspaces --access public` which publishes the 7 individuals + 3 umbrellas (workspaces are published in `workspaces`-array order; the 3 umbrellas are listed last so their dependencies publish first — belt-and-suspenders, npm does not resolve deps at publish time).
6. **Confirm publish.** Then:
   ```bash
   npm view @arnilo/prism                     # expect 0.0.1
   npm view @arnilo/prism-provider-openai      # expect 0.0.1
   npm view @arnilo/prism-compaction-llm       # expect 0.0.1
   npm view @arnilo/prism-providers             # expect 0.0.1 (umbrella)
   npm view @arnilo/prism-all                  # expect 0.0.1 (umbrella)
   ```
   (Repeat for the remaining 6.) If any returns 404, re-run that package's publish manually from the `publish` job logs or locally with `npm publish --access public --workspace @arnilo/<name>`.
7. **Third-party install smoke** (the validation that actually matters). Use the umbrella for the cleanest one-line install:
   ```bash
   mkdir /tmp/use-prism && cd /tmp/use-prism
   npm init -y
   npm install @arnilo/prism-all
   node -e "import('@arnilo/prism').then(m => console.log('exports:', Object.keys(m).slice(0,5)))"
   node -e "import('@arnilo/prism-provider-openai').then(m => console.log('provider import ok'))"
   ```
   Then run the README quickstart end-to-end (it uses `kernel.load([...])` with `import { createExtensionKernel } from '@arnilo/prism'`). If it completes without throwing, 0.0.1 is released. Also verify the graduated install ladder: `npm install @arnilo/prism` (core only), `npm install @arnilo/prism @arnilo/prism-providers` (core + providers), `npm install @arnilo/prism-all` (everything) — each should leave `node_modules` with exactly the right subset.

## Compromises Made
- Task 1 executed and verified: root manifest renamed to `@prism/core`; all 7 workspace manifests moved `peerDependencies` + `devDependencies` from `prism` to `@prism/core`; `tsconfig.packages.json` + `examples/tsconfig.json` `paths` keys renamed (`prism`/`prism/*`/`prism/testing/*`/`prism/node/*` → `@prism/Core`/...); all 66 source/test files across `packages/*/src/**` updated to import from `@prism/core` instead of bare `prism` (required for NodeNext runtime resolution + build). The `prism` CLI bin name deliberately stays (`bin` is name-independent), so `npx prism` / `docs/cli-rpc.md` usage is unchanged. `npm install` recreated `node_modules/@prism/Core` symlink and updated `package-lock.json`. `npm run release:dry-run` exits 0; 8 tarballs produced, core now `prism-core-0.0.1.tgz` (npm strips the `@scope/`).
- Boundary test assertions in `phase13-boundaries.test.ts` + `phase14-boundaries.test.ts` and each workspace's `src/__tests__/index.test.ts` updated to assert `@prism/Core` peer + devDependency instead of `prism`.
- Existing public export `export const name = "prism"` in `src/index.ts` (and its `index.test.ts` assertion `name === "prism"`) intentionally left as the brand string `"prism"` — it is a brand label, not a module specifier, so it does not block publish and is not part of the rename. No public-API break.
- The `appName = "prism"` default param in `src/node/config.ts` + `src/node/settings.ts` (drives `~/.prism` config dir naming) left unchanged by design — brand on-disk path, not a specifier.
- The bulk `prism`→`@prism/core` import rename across `packages/*/src/**` was not originally itemized in the plan's Task 1 "Files to Create/Edit" list (which only named manifests + tsconfig). Added during execution because the build cannot pass without it under NodeNext resolution — this is the root-cause scope of the rename, not an extra task. Recorded here so the plan matches reality.
- Task 2 executed and verified: replaced every broken `const { api } = createExtensionKernel(); api.registerProviderPackage(...)` top-level snippet with `const kernel = createExtensionKernel(); await kernel.load([createProviderPackage({...})])`. 7 code blocks fixed across `README.md` + `docs/providers/{openai,openrouter,kimi,zai,opencode-go}.md` + `docs/provider-packages.md`. Prose mentions of `api.registerProviderPackage()` ("What it does" sections + bullet notes) rewritten to `createExtensionKernel().load([...])`. Left intact: the legitimate `setup(api)` blocks in `docs/extensions.md` + `docs/provider-packages.md` (`api` there is the `extension.setup(api)` parameter — correct usage). Added `docs.test.ts` regression assertion denying `const { api } = createExtensionKernel()` in README + all `docs/**`. 28 docs tests pass (was 27). Core `tsc` clean.
- Task 3 executed and verified: added `"publishConfig": { "access": "public" }` to all 8 manifests (core + 7 workspaces). Added a `packaging.test.ts` assertion that enforces `publishConfig.access === "public"` for every package; 42 packaging tests pass (was 41). Updated `docs/release-and-install.md` Extension and configuration notes: rewrote the `prism` peer bullet to `@prism/core` peer, added a new `Public access` bullet documenting `publishConfig.access: public` as the default + `--access public` workflow flag as belt-and-suspenders. Core `tsc` clean. `npm run release:dry-run` exits 0; 8 tarballs, core manifest ships `package.json` (so `publishConfig` reaches the registry). All scoped `@prism/*` packages will now publish public by default — a manual `npm publish` forgetting the flag cannot accidentally produce a `restricted` (paid) publish.
- Task 4 executed and verified: bulk-renamed every bare `prism` specifier across `README.md` + all 50 `docs/**/*.md` + all 17 `examples/**/*.ts` + `packages/compaction-llm/README.md`. Replaced: `from "prism"` / `from "prism/..."` → `from "@prism/core"` / `from "@prism/core/..."`; `npm install prism` → `npm install @prism/core`; `"prism":` peer/devDep specifiers → `"@prism/core":`; prose subpath mentions `prism/providers/...`, `prism/testing/...`, `prism/node/...` → `@prism/core/...`; the npm-error example block + `Required ... peer` bullets in `docs/release-and-install.md`; the root-export prose in `docs/public-contracts.md` + `docs/provider-layer.md`; the `@prism/core` references in `docs/index.md`, `docs/node-filesystem-config.md`, `docs/node-jsonl-session-store.md`. Left intact deliberately: brand `# prism` title + intro, the `prism` CLI bin name (`npx prism`, `prism --provider ...`, `bin: prism -> ./dist/cli.js`), `~/.prism`/`.config/prism` on-disk paths, `appName = "prism"` default param, and example filenames (`prism-demo-*.jsonl`, `prism.manifest.json`, `prism.config.json`). `npm run typecheck` exits 0 (examples compile against the renamed tsconfig `paths`). `docs.test.ts` extended with a deny-check for bare `prism` specifiers; 3 existing docs tests updated to assert `@prism/core/...` subpaths + `required \`@prism/core\` peer` phrase (their old assertions referenced the now-renamed specifiers). 29 docs tests pass (was 28). `npm test` green across core + workspaces (0 fail); `npm run release:dry-run` exit 0; 8 tarballs.
- Task 5 executed and verified: `.github/workflows/release.yml` comment updated from "first-party packages declare prism as a required peer" → "declare @prism/core as a required peer"; publish commands left functionally as-is (workspace-aware `npm publish --access public` then `npm publish --workspaces --access public`, both belt-and-suspenders with Task 3's `publishConfig.access: public`). `permissions.id-token: write` retained for future `--provenance`. `docs/release-and-install.md` workflow + peer bullets were already renamed in Task 4; added a new **Tarball filenames** bullet documenting that npm strips `@scope/` (core → `prism-core-0.0.1.tgz`, first-party → `prism-provider-<name>-0.0.1.tgz` / `prism-compaction-<name>-0.0.1.tgz`) and that the `prism` CLI bin name is unaffected by the package rename. Extended `install-smoke.test.ts` with a 4th assertion: core tarball filename is exactly `prism-core-0.0.1.tgz` and tarball count (8) matches package count — regression guard so a future rename can't silently re-mangle the published filename. `install-smoke.test.ts` 4/4 green (was 3/3). `npm test` exit 0; `npm run release:dry-run` exit 0; all 8 tarballs named as expected (`prism-core`, `prism-provider-*`, `prism-compaction-*`).
- Task 6 executed and verified (all gates green, recorded numbers below):
  - **Registry name checks:** `npm view @prism/core` → E404 (free to claim, rename target clear). `npm view prism` → `4.1.2` (taken — confirms the rename was necessary; this is the conflict no prior `pack --dry-run`-only gate caught).
  - **Full gate:** `npm run release:dry-run` exit 0 in **27.1s wall** (< 30s Node-20 offline budget; plan 022 baseline was ~50s for the full `release:dry-run` script, ~22s for `npm test` alone).
  - **Tests:** **545 total, 539 pass, 0 fail, 6 skipped** (all 6 skips are documented opt-in live-test placeholders gated by `PRISM_LIVE_*` env vars). Per-suite: core 435 pass / 0 skip; workspaces: provider-openai + opencode-go + openrouter + compaction-llm skipped 1 each, kimi skipped 1, zai skipped 1, compaction-observational-memory 34/34. The 6 skips are the same `@prism/provider-*` / `@prism/compaction-*` live-test placeholders as plan 022.
  - **Guard tests added by Tasks 1–5 all green:** `packaging.test.ts` 42/42 (core name `@prism/core`, `publishConfig.access: public`, peer `@prism/core@0.0.1`); `docs.test.ts` 29/29 (deny `const { api } = createExtensionKernel()`, deny bare `prism` specifiers); `install-smoke.test.ts` 4/4 (core tarball filename `prism-core-0.0.1.tgz`, tarball count == package count).
  - **8 clean tarballs, all correctly scoped-named:** `prism-core-0.0.1.tgz` (106 files), `prism-provider-openai` (18), `prism-provider-opencode-go` (18), `prism-provider-openrouter` (14), `prism-provider-zai` (14), `prism-provider-kimi` (12), `prism-compaction-llm` (20), `prism-compaction-observational-memory` (44). **246 shipped files total** (matches plan 022 Task 4).
  - **Tarball hygiene:** `dist/` ships only `.js` (66) + `.d.ts` (66) pairs; **0 `.map`**, **0 `__tests__`**, **0 source `.ts`** (non-`.d.ts`) in shipped dist.
  - **Secret scan:** extracted all 8 tarballs and scanned 246 shipped files for `sk-…` / `AIza…` / `ghp_…` / PEM private-key headers → **0 hits**. Live-test gate code still excluded via `!dist/__tests__`.
  - **Verdict:** no code, packaging, hygiene, or name-clearance change blocks publish. Only the manual owner steps (create `@prism` npm org, NPM_TOKEN, tag `v0.0.1`) remain before `npm publish`.
- Task 7 executed and verified (re-scope + umbrella metas):
  - **Re-scope:** `@prism/core` → `@arnilo/prism` (core leaf keeps the `prism` brand); `@prism/provider-*` → `@arnilo/prism-provider-*`, `@prism/compaction-*` → `@arnilo/prism-compaction-*` (branded leaf names, owner decision). 3 sed substitutions (`@prism/core`, `@prism/provider-`, `@prism/compaction-`) covered all 159 files. One prose `@prism/*` glob in release-and-install.md fixed manually. CLI bin `prism`, brand title, `~/.prism` paths, `appName` default all unchanged.
  - **3 umbrella metas created:** `packages/prism-providers`, `packages/prism-compaction`, `packages/prism-all` — pure manifests (no dist/exports/bin), `files: ["README.md"]`, hard `dependencies` on their family, `publishConfig.access: public`, `sideEffects: false`. `@arnilo/prism-all` → (core + prism-providers + prism-compaction) → individuals, clean transitive tree.
  - **Root `workspaces`** extended with the 3 explicit meta dirs (placed last so individuals publish first; npm does not resolve deps at publish time, belt-and-suspenders only).
  - **Guard tests extended:** `packaging.test.ts` +15 assertions (3 metas × 5: no-junk, README, metadata, publishConfig, and a per-meta "dependencies exactly equal its family" assertion); `install-smoke.test.ts` adds 3 metas with `isMeta` (skip dynamic-import, no exports) + asserts all 3 meta tarball names; `docs.test.ts` adds an old-scope `@prism/` deny-check (double regression guard). The metas got a `pack:dry-run` script so `release:dry-run` packs all 11 tarballs (`--if-present` had skipped them).
  - **Docs:** `docs/release-and-install.md` package list + install table rewritten for the umbrella ladder; README quickstart got an umbrella one-liner + the package table gained 3 umbrella rows.
  - **Registry:** `npm view @arnilo/{prism,prism-providers,prism-compaction,prism-all,prism-provider-openai,prism-compaction-llm}` all → E404 (free, personal scope; no org needed).
  - **Numbers:** 561 tests total, 555 pass, 0 fail, 6 skipped (same 6 opt-in live-test placeholders); `npm run release:dry-run` exit 0; 11 tarballs (`arnilo-prism-0.0.1.tgz`, 5× `arnilo-prism-provider-*`, 2× `arnilo-prism-compaction-*`, 3 umbrellas); 168 shipped files; dist hygiene intact (66 `.js` + 66 `.d.ts`, 0 maps, 0 __tests__); secret scan 0 hits; umbrellas ship only `README.md` + `package.json`.
  - **Verdict:** no code, packaging, hygiene, or name-clearance change blocks publish. Only the manual owner steps (npm login as `arnilo`, `NPM_TOKEN` GitHub secret, tag `v0.0.1`) remain before `npm publish`.


## Further Actions
- Workspace READMEs (e.g. `packages/compaction-llm/README.md:23` still has `import ... from "prism"`) were NOT touched in Task 1. They are shipped in each workspace tarball (`files: ["README.md"]`), so they belong to the Task 2/Task 4 docs-specifier sweep. Priority: high — must not ship with bare `prism` imports at publish. Folded into Task 4 scope (add `packages/*/README.md` to its Files list).
  - **Resolved in Task 4:** `packages/compaction-llm/README.md` bare `prism` imports renamed to `@prism/core`. Other workspace READMEs already used `@prism/*` self-references and a bare `prism` peer line where applicable — verified no bare-`prism` specifiers remain in any shipped `packages/*/README.md`.
- The `examples/**` TypeScript imports still reference bare `prism`; `npm run typecheck` (which compiles `examples/`) does NOT run as part of `release:dry-run`, so Task 1 verified green on `npm test` + `pack:dry-run` only. `npm run typecheck` is expected to fail until Task 4 completes. Priority: medium — fix in Task 4 before tag.
  - **Resolved in Task 4:** all `examples/**/*.ts` imports renamed; `npm run typecheck` exits 0.
- `npm view @prism/core` registry confirmation (Task 6) pending after the manual org/token steps.
  - **Resolved in Task 6:** `npm view @prism/core` → E404 (free to claim); `npm view prism` → `4.1.2` (taken). Rename target clear. The post-publish re-check (`npm view @prism/core` returns `0.0.1`) belongs to the owner's "Publish Execution" section below — it cannot run until the org/token/tag steps are done.
- **All 6 plan tasks complete.** No automated work remains in this plan. The only outstanding items are the manual owner steps: create the `@prism` npm org, add `NPM_TOKEN` as a GitHub repo secret, then tag `v0.0.1` to trigger the `publish` job (or run `npm publish` locally). After publish, the owner re-runs `npm view @prism/core` (expect `0.0.1`) and `npm view @prism/compaction-observational-memory` etc. for all 8 packages, then runs the consumer install smoke from a fresh project ("Publish Execution" step-by-step below).

