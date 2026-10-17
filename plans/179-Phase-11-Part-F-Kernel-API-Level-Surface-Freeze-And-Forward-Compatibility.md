# Phase 11 Part F — kernel API level, surface reduction, shape freeze, and forward compatibility

## Objectives

- Decouple package compatibility from the kernel's release number: the kernel declares an integer **API level**, packages declare the level they target, and a kernel minor release no longer refuses every installed package.
- Reduce the root `@arnilo/prism` export surface to what hosts and packages need, moving domain modules and network plumbing to subpaths and deleting unused internals, before the surface is frozen.
- Retire the migration-era shapes that would otherwise be frozen (`CredentialValueSource`, `"legacy"` layouts, `AgentDefinition.create`, `activateAllCapabilities`, the 0.12 `CommandDefinition`), and make channels' credentials ref-only.
- Freeze the **shape** of the public surface, not just its names: interface members, type alias bodies, and function signatures are diffed by the release gate.
- Write the forward-compatibility rules hosts and stores follow (unknown events, host-UI kinds, entry kinds), and make the JSONL store tolerate unknown entry kinds.

## Expected Outcome

- `KERNEL_API_LEVEL` (value `1`) is exported from `@arnilo/prism`. `PackageRequires` is `{ api: number; prism?: string; packages?; services? }`. The loader fails closed with `kernel_api` when `requires.api` is not a level the kernel supports, and keeps `prism` as an optional minimum-version range (`>=0.13.2`).
- Every first-party `definePackage` declares `requires: { api: 1 }`. Every package's `peerDependencies["@arnilo/prism"]` is `>=0.13.0 <1.0.0`. A synthetic kernel version `0.14.0` loads every first-party package (`api_level_admits_next_minor`).
- Roadmap Part 3 (Version targets), `docs/packages.md`, `README.md`, and `PRODUCT.md` describe the API-level rule; no doc shows the rejected `^0.13` partial range.
- The root export list shrinks by the Task 3 table; `@arnilo/prism/artifacts` and `@arnilo/prism/net` subpaths exist.
- `scripts/compat-baseline/*.txt` records full declaration bodies; changing a member of `AgentConfig` fails `bun scripts/release.mjs gate` (`compat_detects_member_change`).
- `docs/compatibility.md` states the stability promise and the forward-compatibility rules; the JSONL store reads a session containing an unknown entry kind.

This plan is a pre-publish part of roadmap **Phase 11**. It **depends on plans 177 and 178** (their surface additions must exist before the shape freeze) and **blocks plan 175 Task 10**. It changes kernel contracts (`PackageRequires`, the export surface, credential shapes) and so starts with the phase review. **It changes the roadmap**: Part 3's "a kernel 0.14 needs each package to widen its range" is replaced by the API-level rule. The owner chose the API-level option on 2026-10-15 over shipping 1.0.0 or documenting wide 0.x ranges; Task 1 records that decision. No version bump or publish. Lab impact: n/a (plan 173 deleted `packages/prism-code`); `apps/prism-agent` is a caller of every moved export and is updated in the same task. Cost knobs: n/a.

**Closed at Task 2 (2026-10-16).** Tasks 3–6 moved to plan 185 (Tasks 2–5, after a new entry check) when the 0.13.0 release plans were put in execution order (181 → 187).

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) the owner decision (API level, 2026-10-15) and the roadmap Part 3 text it replaces (`roadmap.md:1597`);
      - (b) the loader's range check (`src/packages/loader.ts:292-325`), `PackageRequires` (`src/packages/api.ts`), the manifest fields that record kernel ranges (if any), and every `requires.prism` and `peerDependencies["@arnilo/prism"]` in the repo (`graft grep "requires: { prism"`);
      - (c) the export-surface table for Task 3: every root export whose non-test callers are only the kernel barrel, only one package group, or none, with counts from `graft callers <name> --depth all`. Starting evidence from the review: `artifacts.ts` and `context-build.ts` are imported only by `src/index.ts`; `requestPinned`, `raceAbort`, `resolvePinnedAddress`, `defaultResolver` have one package caller each; `MODEL_FAMILY_TOKENS`, `EventSubscriber` (as a value), and `RunLimitTracker` (as a value) have none; `trimTrailingSlashes` has 42 callers;
      - (d) the retirement table for Task 4 with every caller: `resolveCredentialValue` / `CredentialValueSource` (44 files across `packages/providers/*`), `InputAssemblyLayout "legacy"` (`src/input.ts:126,171`), `toolCallStrictness "legacy"` (`src/contracts-core/content.ts:153`), `AgentDefinition.create`, `AgentDefinitionResolutionContext.activateAllCapabilities`, `CommandDefinition` / `CommandExecutionContext` / `CommandDrivers` / `CommandResult` (9 files), `ProductionPersistenceStore` (9 files: decide keep or rename), the `maxToolRounds` shim (`assemble.ts:558-561`), and channels' `CredentialValueSource` + literal `webhookSecret` (`packages/hosts/channels/src/telegram.ts:31,123,1082`);
      - (e) what `extractDeclaredSurface` records today (`scripts/release-gates.mjs:61-132`: a declaration's text up to its first `{` or `;`, and re-exports as the export statement only), proving member changes are invisible;
      - (f) how each store treats an unknown entry kind (kernel rebuild ignores it, `src/session-stores.ts:160-190`; SQLite and Postgres have no `CHECK` on `kind`; JSONL rejects it, `packages/stores/jsonl/src/jsonl-store.ts:495-501`).
    - Functional: A verdict per task; a finding that invalidates one stops the plan for re-cut.
    - Performance: n/a — read-only.
    - Code Quality: n/a — read-only.
    - Security: The review confirms that no Task 3 move drops a security helper hosts rely on without a subpath replacement.
  - Approach:
    - Documentation Reviewed:
      - roadmap Part 3, §1.4, Phase 11; `docs/packages.md`; `src/__tests__/public-export-contract.test.ts`; `scripts/release-gates.mjs`; the 2026-10-15 review.
    - Options Considered:
      - Skipping the review. Rejected: this plan changes `PackageRequires` and the root surface.
    - Chosen Approach:
      - Read-only tables built with graft.
    - API Notes and Examples:
      ```bash
      graft callers resolveCredentialValue --depth all
      graft grep "requires: { prism"
      ```
    - Files to Create/Edit:
      - this plan (Notes only)
    - References:
      - plan 174 Tasks 8–9 (TypeScript-source publish, surface freeze)
  - Test Cases to Write:
    - n/a — read-only task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16): read-only; no source edited. Tables (a)–(f) below. Four later-task amendments were made in place (Task 2 sweep + manifest + no-`requires` case; Task 3 `node:http` edge + `context.ts` file; Task 4 `CredentialRecord`/keyring and the stale `maxToolRounds` line). No finding invalidates a task's premise, so the plan proceeds without re-cut.

    **(a) Owner decision and the roadmap text it replaces.** On 2026-10-15 the owner chose the API-level rule over shipping 1.0.0 or documenting wide `>=0.13.0 <1.0.0-0` ranges (review finding "the version rule breaks every package on the next minor release"). `roadmap.md:1597` is the replaced sentence, inside the Part 3 row `roadmap.md:1594-1597`: "On a 0.x kernel a caret range pins the minor (`^0.13` is `>=0.13.0 <0.14.0`), so a kernel 0.14 needs each package to widen its range." Task 2 rewrites that row as the `requires.api` rule.

    **(b) Kernel-range surfaces.**
      - `PackageRequires` is `src/packages/api.ts:173-180`: `prism: string` (required), `packages?`, `services?`. Root re-export is `src/index.ts:483`; `src/packages/index.ts:24`.
      - Loader check is `src/packages/loader.ts:291-302` (kernel range → `kernel_range`); the plan's "292-325" also covers the `requires.packages` loop at 303-325. `if (!requires) continue` at `loader.ts:296` means a definition with no `requires` at all skips the check — so `api` cannot be truly required without also rejecting that case.
      - **No manifest field records a kernel range.** `ManifestInstall` is `{ version, integrity, capabilities }` (`src/manifest/format.ts:11-18`), where `version` is the installed package's *own* range; `ManifestEntryFields` adds `name/config/enabled/optional`. `requires` is read from the imported default export at load (`src/manifest/definition.ts:39`) and re-defined through `definePackage`. **Verdict: Task 2's manifest clauses are n/a and were deleted.**
      - `requires: { prism: … }` literal sites (excluding `plans/`, baselines, `dist/`): 95; 68 are `"^0.13.0"`, 20 are `"*"` (examples/tests), the rest are range-rejection fixtures (`^9.0.0` ×2, `latest`, `1.x`, `1.2`, `1.0.0 - 2.0.0`, `{{kernelVersion}}`). `graft grep "requires: { prism"` reports 99 hits in 82 symbols across 77 files (the delta is `.js`/`.d.ts` companions).
      - `peerDependencies["@arnilo/prism"]`: 61 `package.json` files name the dependency; 59 set `"^0.13.0"` (plan's count confirmed); `apps/prism-agent/package.json` uses `"file:../.."`.
      - `scripts/package-truth.mjs:157-169`: `independent` is true when *any* internal workspace range starts with `^`/`~`. Internal `@arnilo/prism-*` dependency ranges still use `^0.13.0` (e.g. `packages/memory/wiki`, `packages/stores/sqlite`, `packages/integrations/mcp`), so changing only the 59 peer ranges keeps `peerPolicy.decision === "B"`; no package-truth logic change beyond accepting the new peer string.
      - **Verdict: Task 2's sweep `rg '"\^0\.13"'` was over-broad** — it also matches the internal `"@arnilo/prism-*": "^0.13.0"` dependency ranges this plan does not change. Task 2 text amended to scope the second pattern to the peer key.

    **(c) Root-export table for Task 3.** Non-test callers under `packages/`, `apps/`, `examples/`; counts are files (`rg -l`, cross-checked with `graft callers --depth all`).

    | root export(s) | non-test callers | decision |
    | --- | --- | --- |
    | `pinnedFetch` | 11: `integrations/mcp/transport`, `providers/alibaba` ×2, `providers/openai/images`, `memory/rag` ×3, `policy/governance/opa`, `tools/openapi/specs`, `tools/work` ×2 | move `/net` |
    | `requestPinned`, `raceAbort`, `resolvePinnedAddress`, `isLoopbackAddress` | 1 each: `integrations/mcp/transport` | move `/net` |
    | `defaultResolver` | 3: `tools/web/obscura` ×2, `integrations/mcp/transport` | move `/net` |
    | `boundResponse` | 2: `hosts/mcp-server/server`, `integrations/mcp/transport` | move `/net` |
    | `isLoopbackHostname` | 5: `hosts/remote/transports/network`, `hosts/devtools/serve`, `integrations/mcp` ×2, `tools/openapi/compile` | move `/net` |
    | `normalizeHostname` | 2: `integrations/mcp/transport`, `tools/web/obscura/cli` | move `/net` |
    | `PinnedFetchOptions` | 0 | move `/net` (`pinnedFetch` signature) |
    | `assertSsrfAllowedUrl` | 7: `tools/web` ×2, `memory/wiki/ingest`, `integrations/mcp/transport`, `tools/work/mistral-ocr`, `policy/governance/opa` | **keep root** — multi-group; leaf module `media-types.ts` imports only `node:net` |
    | `MODEL_FAMILY_TOKENS`, `ModelFamilyTokens`, `resolveModelFamily` | 0 (internal only: `src/models/estimate.ts`) | delete from root |
    | `EventSubscriber`, `SubscriberOverflowError` | 0 (internal: `agent-session/{session,create-agent}.ts`) | drop value export; keep the type where signatures use it |
    | `RunLimitTracker` (value) | 0 external; `createRunLimitTracker` has 1 test caller (`packages/hosts/ag-ui/src/__tests__/public-api.test.ts`) | drop value export; keep the type and factory |
    | `trimTrailingSlashes` | 42: 39 provider files + `tools/web` | keep root |
    | artifacts (`ArtifactRecord`, `ArtifactBodyStore`, `ArtifactCitation`, `ArtifactRevision`, `ArtifactApproval`, `ArtifactError`, `ArtifactBodyStoreError`, `ARTIFACT_*`, `artifactApprovalState`, `artifactCheckpointKey`, `citationBindingDigest`, `HARD_CITATION_EXCERPT_BYTES`) | 4 consumers: `tools/work` (12 files, `ArtifactBodyStore`), `tools/coding` (`ArtifactRecord`), `tools/web` (`HARD_CITATION_EXCERPT_BYTES`), `evals` (citation types + `citationBindingDigest`) | move `/artifacts` |
    | `registerContextSources`, `withContextBlocks`, `ContextSource` | `registerContextSources` 3 examples; `withContextBlocks` 6 (4 examples, `memory/fabric`, `memory/rag`); `ContextSource` 2 (examples, `context/files`) | **keep root** — three package groups, no single owning package |
    | `src/artifacts.ts`, `src/context-build.ts` imported only by `src/index.ts` inside `src/` | confirmed (plus one kernel test each) — leaf modules | — |

    **Task 3 blocker — the `node:http` claim.** `src/content.ts:14` statically imports `pinnedFetch` from `./pinned-fetch.js`, and `src/content.ts` is a root module (most `./content.js` exports are at the root). `src/pinned-fetch.ts:19-22` imports `node:dns/promises`, `node:http`, `node:https`, `node:net`. So the root entry transitively pulls `node:http`/`node:https` through `content.ts` no matter what the root re-exports; moving the re-exports to `/net` alone cannot satisfy Task 3's performance criterion or `root_entry_does_not_import_node_http`. Task 3 text amended to add `src/content.ts` (lazy `import("./pinned-fetch.js")` inside the default media fetch, or inject the fetch). `assertSsrfAllowedUrl` needs no move: root already gets it from `./content.js`, which re-exports the leaf `./media-types.js`.

    **(d) Retirement table for Task 4.**

    | retired shape | definition | consumers / callers | verdict |
    | --- | --- | --- | --- |
    | `resolveCredentialValue` | `src/credentials/legacy.ts:24` | 36 provider source files + `packages/tools/web/src/types.ts`; kernel use in `provider-kit/{openai-compatible,openai-responses,openai-uploads,systemone*,model-discovery}.ts` and `credentials/index.ts`; tests `credentials-redaction`, `docs`, `public-export-contract` | delete; migrate to `SecretSource` |
    | `CredentialValueSource` | `src/credentials/legacy.ts:8` | 48 provider files (incl. type-only `clinepass`, `laya`, `typesafe`) + `tools/web/types` + `channels/telegram` + provider-kit files | delete; replace with `SecretSource = () => Promise<string \| undefined>` |
    | **`CredentialRecord`** | `src/credentials/legacy.ts:14` | **`packages/credentials/keyring`: `vault.ts:1,24,25,44`, `file-store.ts:3,47,52,119,140`, `encrypted-store.ts`** — imported from `@arnilo/prism` and used in the public store API | **NOT safe to delete as written**; keep it (move out of `legacy.ts`) or move it to a credentials subpath and update keyring in the same task |
    | `InputAssemblyLayout = "legacy" \| "cache_aware"` | `src/contracts-protocol.ts:67`; switch `src/input.ts:126`; gate `src/input.ts:171` | no package sets `"legacy"`; `src/__tests__/public-contracts.test.ts:293` uses `"cache_aware"` | make `"cache_aware"` only; delete the branch |
    | `toolCallStrictness: "legacy"` | `src/contracts-core/content.ts:153` | `packages/providers/neuralwatt/src/models.ts` + its test; `scripts/provider-toolcall-conformance.test.mjs` | drop the union member (neuralwatt does not emit it) |
    | `AgentDefinition.create` | declared `src/contracts-core/agent.ts:38` | **zero callers** | safe delete |
    | `activateAllCapabilities` | declared `src/contracts-core/agent.ts:51` | **zero callers** | safe delete |
    | 0.12 `CommandDefinition` family | — | already retired by **plan 176 Task 5** (`src/__tests__/retired-command-names.test.ts` green); only frozen baselines and the allowed docs/tests name them | Task 4 only confirms the sweep stays empty |
    | `maxToolRounds` shim | `src/agent-session/session/assemble.ts:600-602` (plan said 558-561 — **stale**) | nothing consumes the shim; `maxToolRounds` as a *limit axis* stays (`run-limits.ts`, `contracts-core/run-limits.ts`) | delete the shim only; leave the axis |
    | `ProductionPersistenceStore` | `src/contracts-core/persistence.ts` | implemented by `packages/stores/{sqlite,postgres}/src/persistence.ts`; read by `hosts/{ag-ui,evals}`, `examples/external-app-db-backed.ts`, `src/testing/{query,state-concurrency}-conformance.ts`, `scripts/host-surface-allowlist.json` | **keep** — a production contract, not a migration alias; add the doc comment |
    | channels `CredentialValueSource` + literal `webhookSecret` | `packages/hosts/channels/src/telegram.ts:31` type, `:68,:122,:578` `botToken`, `:123` `webhookSecret: string`, `:1082,:1121` validation, `:1191` options | channels package + tests | ref-only as planned |

    **(e) `extractDeclaredSurface` today.** `scripts/release-gates.mjs:61-108` (`parseDeclarationFile`) records a local declaration only up to its first `{` or `;`, named re-exports as the whole `export … from` statement, and resolves `export * from` targets by file. Proof it is names-only: `scripts/compat-baseline/arnilo__prism.txt:85` records `PackageRequires` as `export type { Capability, …, PackageRequires, … } from "./packages/index.js"` (no member list); `:596` records `ToolCapabilityKind` as `export type { ToolCapabilityKind } from "./contracts.js"`; and `AgentConfig` has **no baseline line at all** (it appears only inside function signatures). Adding/removing/renaming a member of any of them cannot fail the gate. `diffSurface` already computes `removed/changed/added` (`:218-237`), and `allowBreak` + `migrationMentionsVersion(root, version)` (`:240-243`) gate breakage on `docs/migration.md`. Task 5's premise holds; the frozen-array test (`src/__tests__/public-export-contract.test.ts:993-1018`) is a separate name-only check.

    **(f) Unknown entry kind per store.** Kernel rebuild ignores it: `src/session-stores.ts:160-190` (`snapshotFromBranch`) only branches on `kind === "compaction" | "message" | "summary"`; any other kind stays in `entries` and never reaches `messages`. SQLite: `packages/stores/sqlite/src/ddl.ts:76` `kind TEXT NOT NULL` — no `CHECK`. Postgres: `packages/stores/postgres/src/ddl.ts:83` `kind TEXT NOT NULL` — no `CHECK`. JSONL: `packages/stores/jsonl/src/jsonl-store.ts:485-492` rejects `schemaVersion !== SESSION_ENTRY_SCHEMA_VERSION` and `!isSessionEntryKind(kind)` per line. Task 6's JSONL change + conformance addition are the right, minimal fix.

    **Verdicts.** Task 2: go — sweep scope fixed, manifest clauses deleted, no-`requires` case added. Task 3: go — `content.ts` added to break the `node:http` edge; `context-build` stays at root with the recorded reason. Task 4: go — `CredentialRecord` kept and keyring added; `maxToolRounds` line corrected; `ProductionPersistenceStore` kept. Task 5: go — premise proven. Task 6: go. Security: the only security helper at the root (`assertSsrfAllowedUrl`) stays at the root, and `/net` gains `pinnedFetch`/`PinnedFetchOptions` without loss; no security helper is dropped without a subpath. `docs/compatibility.md` and `docs/net.md` do not exist yet, as the plan assumes.

- [x] Task 2: Kernel API level
  - Acceptance Criteria:
    - Functional: `src/version.ts` exports `KERNEL_API_LEVEL = 1` and `SUPPORTED_API_LEVELS: readonly number[] = [1]`; the root re-exports `KERNEL_API_LEVEL`.
    - Functional: `PackageRequires.api: number` is required; `PackageRequires.prism?: string` becomes an optional minimum-version range checked as today. The loader rejects:
      - a missing or non-integer `api` → `definition_invalid`;
      - an `api` not in `SUPPORTED_API_LEVELS` → `kernel_api` (`Package X targets kernel API 2; this kernel supports 1`);
      - a `prism` range the kernel version does not satisfy → `kernel_range` (unchanged);
      - a definition with no `requires` at all → `definition_invalid`; `src/packages/loader.ts:296`'s `if (!requires) continue` must not admit it (Task 1 (b)).
    - Functional: Every first-party `definePackage` (and `defineProviderPackage`/`providerPackage` helpers in `src/provider-kit/`) declares `requires: { api: 1 }` and drops `prism: "^0.13.0"`. Every `package.json` sets `peerDependencies["@arnilo/prism"]` to `>=0.13.0 <1.0.0` (59 files). `scripts/package-truth.mjs`/`release.mjs validate` accept that range for the lockstep and independent modes.
    - Functional: n/a for the manifest — Task 1 (b) found the manifest records no kernel range (`ManifestInstall` is `{ version, integrity, capabilities }`, the package's own version; `requires` is read from the imported definition at `src/manifest/definition.ts:39`). No `api_unsupported` path is added.
    - Functional: Rule text, written once in `docs/compatibility.md` (Task 6) and referenced from `docs/packages.md`: the API level changes only with a breaking change to a contract packages implement or call; additive changes (new optional fields, hooks, events, `PackageAPI` members, subpaths) keep the level; a kernel may support several levels at once during a transition.
    - Functional: Retirement sweep: `rg 'prism: "\^0\.13'` and `rg '"@arnilo/prism": "\^0\.13'` over `src/ packages/ apps/ scripts/ examples/ docs/ templates/ README.md PRODUCT.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) return nothing. Do not grep a bare `"\^0\.13"`: the internal `"@arnilo/prism-*": "^0.13.0"` dependency ranges stay (Task 1 (b)).
    - Performance: n/a — one integer comparison at load.
    - Code Quality: No alias: `requires.prism` as the only field is not accepted silently; a package declaring only `prism` fails with a message naming `requires.api`.
    - Security: A package written for a future incompatible API never loads half-working.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/semver.ts`, `src/packages/loader.ts:292-325`, `src/packages/api.ts` (`PackageRequires`), `src/provider-kit/provider-package.ts`, roadmap Part 3, `docs/packages.md:18-60`.
    - Options Considered:
      - Ship 1.0.0. Rejected by the owner (2026-10-15).
      - Document `>=0.13.0 <1.0.0-0` ranges. Rejected by the owner: a third party who writes the usual `^0.13.0` still breaks.
    - Chosen Approach:
      - An explicit API level, with `prism` kept as an optional minimum for packages that need a fix from a specific release.
    - API Notes and Examples:
      ```ts
      export default definePackage({
        name: "@acme/prism-crm",
        version: "1.4.0",
        requires: { api: 1, prism: ">=0.13.2" },
        setup(prism) { /* … */ },
      });
      ```
    - Files to Create/Edit:
      - `src/version.ts`, `src/index.ts`, `src/packages/api.ts`, `src/packages/loader.ts`, `src/packages/define.ts`, `src/provider-kit/provider-package.ts`, `src/provider-kit/package.ts`, `src/manifest/*` (per Task 1 (b)).
      - every `packages/*/*/src/index.ts` (and other `definePackage` call sites from `graft grep "definePackage("`), `apps/prism-agent/src/**`, `examples/**`, `templates/**`.
      - every `packages/*/*/package.json` (peer range), `scripts/package-truth.mjs`, `scripts/release.mjs` (range validation), their tests.
      - `src/__tests__/package-loader.test.ts`, `src/__tests__/public-export-contract.test.ts`.
      - `scripts/compat-baseline/*.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`; the note records the diff (additions `KERNEL_API_LEVEL`; changed `PackageRequires`), attributed to this plan.
      - `roadmap.md` Part 3 row for native packages; `docs/packages.md`, `README.md`, `PRODUCT.md`, `docs/migrate-to-0.13.md`, `CHANGELOG.md`.
    - References:
      - review finding "The version rule breaks every package on the next minor release" (2026-10-15).
  - Test Cases to Write:
    - `api_level_admits_next_minor`: load every first-party package with `kernelVersion: "0.14.0"`; fails under the old `^0.13.0` ranges.
    - `api_level_mismatch_fails_closed`: `requires.api: 2` → `kernel_api`.
    - `api_missing_fails_closed`: `requires: { prism: ">=0.13.0" }` only → `definition_invalid` naming `requires.api`; a definition with no `requires` at all → `definition_invalid` from the loader.
    - `prism_minimum_still_checked`: `api: 1, prism: ">=9.0.0"` → `kernel_range`.
    - `peer_ranges_are_wide`: every `package.json` peer range admits `0.14.0` and rejects `1.0.0`.
    - `no_caret_013_left`: the sweep as a test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `PackageRequires` and loader errors.
    - Docs pages to create/edit:
      - `docs/packages.md`: `requires` table (`api`, optional `prism`).
      - `README.md`, `PRODUCT.md`: package examples.
      - `docs/migrate-to-0.13.md`: package authors section.
      - `roadmap.md`: Part 3.
      - `CHANGELOG.md`.
      - `scripts/budgets.json` (kernel ceilings rebaselined with a reason), `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, `src/__tests__/provider-package.test.ts`, `scripts/version-literal-gate.test.mjs`, `scripts/phase24-truth.test.mjs`, and every fixture/test that defined a package without `requires` (the manifest fixtures, `src/testing/driver-conformance.ts`, `packages/drivers/process/src/testing.ts`, the examples' hello/mock fixtures, and ~30 test helpers).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - **What changed.** `src/version.ts` exports `KERNEL_API_LEVEL = 1` and `SUPPORTED_API_LEVELS = [KERNEL_API_LEVEL]`; the root re-exports `KERNEL_API_LEVEL`. `PackageRequires.api` is required and `prism?` is an optional minimum. `src/packages/errors.ts` adds the `kernel_api` code. `src/packages/define.ts` rejects a present-but-non-integer `api` (`definition_invalid`, naming `requires.api`) and only parses `prism` when present; `src/packages/loader.ts` rejects a definition with no `requires`, then an unsupported level (`kernel_api`, `Package X targets kernel API 2; this kernel supports 1`), then an unsatisfied optional `prism` (`kernel_range`). `provider-kit`/`driver-kit` declare `requires: { api: KERNEL_API_LEVEL }`; 52 non-test source files and 176 occurrences in total now declare `requires: { api: 1 }`.
    - **Peer window.** All 59 `peerDependencies["@arnilo/prism"]` are `>=0.13.0 <1.0.0`. `scripts/release.mjs` `validateRelease` and `validateReleaseIndependent` accept that window for the kernel peer (floor at or below the cut version); `rewriteInternalRanges` never touches it. Internal `@arnilo/prism-*` ranges stay `^0.13.0` — a bare `"\^0\.13"` sweep would fail on those, so the peer sweeps are scoped (Task 1 (b)).
    - **Tests.** New `api_level_admits_next_minor`, `api_level_mismatch_fails_closed`, `api_missing_fails_closed`, `prism_minimum_still_checked` in `src/__tests__/package-loader.test.ts`; `every_package_declares_api_level` (scans `requires: { api:` and asserts no `requires: { prism:` survives, covering `no_caret_013_left`) and `peer_ranges_are_wide` (every peer admits 0.14.0 and rejects 1.0.0) in `src/__tests__/packaging.test.ts`; `FROZEN_VALUE_EXPORTS` gains `KERNEL_API_LEVEL`. Updated `scripts/version-literal-gate.test.mjs`, `scripts/phase24-truth.test.mjs` (`assertCorePin`), `src/__tests__/install-smoke.test.ts`, `src/__tests__/provider-package.test.ts`, the compaction/wiki package assertions, and every fixture that built a package without `requires`.
    - **Baseline diff.** `bun scripts/release.mjs gate --update-baseline` regenerated 12 compat baselines (12 files, +772/-900) and rebaselined `scripts/budgets.json`'s kernel ceilings (packed 1049175→1050435, unpacked 3415133→3418938, rootExports 1436→1438, sourceLines 35406→35438; each row carries the reason). Plan-relevant delta in `scripts/compat-baseline/arnilo__prism.txt`: **added `KERNEL_API_LEVEL`** (`export declare const KERNEL_API_LEVEL = 1`). `PackageRequires` is still recorded as a names-only re-export line, so this task's `api`-required change is invisible to the current extractor — Task 5's premise, re-confirmed live. The rest of the baseline churn is pre-existing drift: the committed baselines predated the untracked 0.13 WIP tree (removed modules such as `identity`, `attention-compiler`, `persistence-lifecycle`), so a regen was required for `release.mjs gate` to pass at all.
    - **Sweep.** `rg 'prism: "\^0\.13'` and `rg '"@arnilo/prism": "\^0\.13'` over `src/ packages/ apps/ scripts/ examples/ docs/ templates/ README.md PRODUCT.md` (excluding `dist/`, `docs/history/`, `docs/_evidence/`) return nothing.
    - **Docs.** `docs/packages.md` (requires table, validation rule, loader step 4, both error lists), `docs/migrate-to-0.13.md` (new "Package authors" section), `docs/migration.md`, `docs/provider-kit.md`, `docs/testing.md`, `docs/manifest.md`, `README.md`, `PRODUCT.md`, `roadmap.md` (Part 3 row + three examples), `CHANGELOG.md`.
    - **Pre-existing failures (not this task).** The tree was not green at its start point and is unchanged by this task: `host surface gate > host_libraries_import_only_allowlisted_kernel_names` (the untracked `scripts/host-surface-allowlist.json` lacks `packages/hosts/remote`'s names), `om token fixtures pin this site's columns` (35 vs 36), `tripwire: docs page documents the composite scoring surface it ships` (`docs/working-and-semantic-memory.md` absent), `retired memory family workspace` (`scripts/deprecations-0.13.json` names the family), `zai_public_docs_omit_obsolete_thinkingFormat_fields` (`docs/providers/zai.md`), `names the Bun runtime when the sqlite modules are imported under node`, plus `scripts/budget-gate.test.mjs`'s export-count/non-null-assertion rows and `scripts/release-gate.test.mjs > no_compat_baseline_without_workspace` (orphan `arnilo__prism-agent-sdk.txt`/`arnilo__prism-work.txt`).
    - **Findings for later tasks.** Task 3 is unchanged, but its `node:http` criterion still needs the `content.ts` decoupling from Task 1 (c), and a further `scripts/budgets.json` kernel rebaseline will follow exported-surface movement. Task 5 is re-confirmed: the regenerated baseline still hides member changes.

- Task 3: Reduce the root surface — **moved to plan 185 Task 2 on 2026-10-16** (not executed here; the full task text lives there).

- Task 4: Retire migration-era shapes — **moved to plan 185 Task 3 on 2026-10-16** (not executed here; the full task text lives there).

- Task 5: Freeze the shape of the surface — **moved to plan 185 Task 4 on 2026-10-16** (not executed here; the full task text lives there).

- Task 6: Compatibility promise and forward-compatibility rules — **moved to plan 185 Task 5 on 2026-10-16** (not executed here; the full task text lives there).

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/package-loader.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts src/__tests__/kernel-constraints.test.ts src/__tests__/docs.test.ts`
- `bun test --timeout=0 scripts/release-gate.test.mjs scripts/package-truth.test.mjs`
- `bun run --filter @arnilo/prism-store-jsonl test && bun run --filter @arnilo/prism-store-sqlite test && bun run --filter @arnilo/prism-channels test && bun run --filter @arnilo/prism-agent test`
- `bun run test`
- `bun scripts/release.mjs gate --update-baseline` (Task 5 only), then `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
