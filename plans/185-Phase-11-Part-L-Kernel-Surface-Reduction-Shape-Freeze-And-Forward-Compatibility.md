# Phase 11 Part L — kernel surface reduction, shape freeze, and forward compatibility

## Objectives

- Reduce the root `@arnilo/prism` export surface to what hosts and packages need, moving domain modules and network plumbing to subpaths and deleting unused internals, before the surface is frozen.
- Retire the migration-era shapes that would otherwise be frozen (`CredentialValueSource`, `"legacy"` layouts, `AgentDefinition.create`, `activateAllCapabilities`), and make channels' credentials ref-only.
- Freeze the **shape** of the public surface, not just its names: interface members, type alias bodies, and function signatures are diffed by the release gate.
- Write the forward-compatibility rules hosts and stores follow (unknown events, host-UI kinds, entry kinds), and make the JSONL store tolerate unknown entry kinds.

## Expected Outcome

- The root export list shrinks by plan 179 Task 1 (c)'s table; `@arnilo/prism/artifacts` and `@arnilo/prism/net` subpaths exist.
- `CredentialValueSource` and `resolveCredentialValue` are gone; the four provider packages and `@arnilo/prism/provider-kit` take `SecretSource`.
- `scripts/compat-baseline/*.txt` records full declaration bodies; changing a member of `AgentConfig` fails `bun scripts/release.mjs gate` (`compat_detects_member_change`).
- `docs/compatibility.md` states the stability promise and the forward-compatibility rules; the JSONL store reads a session containing an unknown entry kind.

**0.13.0 release path — plan 185 of 181–187.** Start it when plan 184 is complete; when this plan is complete, continue with plan 186. Plans 181–194 run strictly in step order (see `plans/README.md`), and nothing runs in parallel.

This plan is a pre-publish part of roadmap **Phase 11**. **Tasks 2–5 moved here unchanged from plan 179 Tasks 3–6 on 2026-10-16**, when the release plans were put in execution order. Plan 179 Tasks 1 (the phase review) and 2 (the kernel API level) were complete and stay there. Inside Tasks 2–5, "plan 179 Task 1 (c)/(d)" means that review's tables. The plan starts with an entry check (Task 1), because plans 182–184 changed the tree the review inventoried. Plan 182 deleted 17 provider packages and shrank `@arnilo/prism/provider-kit`, and plan 183 rebuilt `hyper`, `opencode-go`, `typesafe`, and `laya`. The plan changes kernel contracts (the export surface, credential shapes). **It changes the roadmap** only as plan 179 already recorded (Part 3 API-level rule, done in plan 179 Task 2). No version bump or publish. Lab impact: n/a (plan 173 deleted `packages/prism-code`); `apps/prism-agent` is a caller of every moved export and is updated in the same task. Cost knobs: n/a.

## Tasks

- [ ] Task 1: Entry check against plan 179's review (read-only)
  - Acceptance Criteria:
    - Functional: The task note re-runs plan 179 Task 1's inventories on the current tree and records the differences:
      - (c) the root-surface table: rows whose callers vanished with the 17 provider packages (for example `pinnedFetch`'s `providers/alibaba` and `providers/openai/images` callers, `trimTrailingSlashes`' 39 provider files), and any export plan 182 added to the kit (`createRoutedProvider`, `normalizeUsage`, `replayFetch`, codec options);
      - (d) the retirement table: `resolveCredentialValue` / `CredentialValueSource` callers, now the four provider packages, the kit (`routed-provider`, `systemone*`), `packages/tools/web`, and `packages/hosts/channels`; `toolCallStrictness: "legacy"`, whose only caller (`neuralwatt`) was deleted, so the union member may have no caller left;
      - each `graft callers <symbol> --depth all` result Tasks 2–3 will edit.
      - Verdict: Tasks 2–5 proceed as written with the updated tables, or the plan is re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every changed row cites `file:line`.
    - Security: n/a — read-only.
  - Approach:
    - Documentation Reviewed:
      - plan 179 Task 1 notes; plans 182–183 notes; `src/index.ts`; `src/provider-kit/index.ts`.
    - Options Considered:
      - Run the moved tasks on the old tables. Rejected: plans 182–183 removed about 40 of the listed callers and added kit exports, so the tables are stale.
    - Chosen Approach:
      - Refresh the inventory once, then execute the moved tasks.
    - API Notes and Examples:
      ```bash
      graft callers CredentialValueSource --depth all
      graft callers resolveCredentialValue --depth all
      ```
    - Files to Create/Edit:
      - this plan (task note only).
    - References:
      - plan 179 Task 1; plans 182–183.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Reduce the root surface
  - Acceptance Criteria:
    - Functional: Apply plan 179 Task 1 (c)'s table:
      - `artifacts.ts` exports move to a new subpath `@arnilo/prism/artifacts` (plan 179 Task 1 (c): four consumers — `tools-work`, `tools-coding`, `tools-web`, `evals`);
      - network plumbing moves to `@arnilo/prism/net`: `pinnedFetch`, `requestPinned`, `resolvePinnedAddress`, `defaultResolver`, `raceAbort`, `boundResponse`, `isLoopbackAddress`, `isLoopbackHostname`, `normalizeHostname`, `PinnedFetchOptions` (the root keeps `assertSsrfAllowedUrl`, which hosts call directly, unless plan 179 Task 1 finds otherwise);
      - zero-caller exports are removed from the root: `MODEL_FAMILY_TOKENS`, `ModelFamilyTokens`, `resolveModelFamily` (if unused), the `EventSubscriber` and `RunLimitTracker` classes as values (their types stay exported where public signatures use them);
      - `context-build.ts` (`registerContextSources`, `withContextBlocks`, `ContextSource`): **kept at the root** — plan 179 Task 1 (c) found three package groups consume it (`memory/fabric`, `memory/rag`, `context/files`) plus examples, so no single owning package exists.
    - Functional: Every caller in `packages/`, `apps/`, `examples/`, and tests is updated in this task; `bun run typecheck` is green at the end.
    - Functional: `package.json` `exports` gains `./artifacts` and `./net`; `src/__tests__/packaging.test.ts` and `public-export-contract.test.ts` list them; the freeze arrays drop the removed names deliberately.
    - Functional: Retirement sweep for each removed root name over `src/ packages/ apps/ scripts/ examples/ docs/`.
    - Performance: The root entry no longer pulls `node:http`/`node:https`. plan 179 Task 1 (c) found `src/content.ts:14` statically imports `pinnedFetch` from `./pinned-fetch.js`, so moving the root re-exports alone does not clear the edge: decouple `content.ts` (lazy `import("./pinned-fetch.js")` inside the default media fetch, or inject the fetch) and record the root import graph before and after (`scripts/phase16-tree-shake.mjs` or the kernel import-boundary test) in the note.
    - Code Quality: Subpath modules are thin re-export files under `src/artifacts/index.ts` and `src/net/index.ts`; no duplicate implementations.
    - Security: `@arnilo/prism/net` documents that it is the only supported SSRF-safe fetch; no security helper disappears without a subpath.
  - Approach:
    - Documentation Reviewed:
      - `src/index.ts`, `src/pinned-fetch.ts`, `src/artifacts.ts`, `src/context-build.ts`, `src/usage-estimation.ts`, `package.json` `exports`, roadmap §1.4 ("the kernel knows no package names") and §2 kernel scope.
    - Options Considered:
      - Leaving everything at the root. Rejected: every export is a permanent promise; domain modules contradict the kernel's stated scope.
      - Moving artifacts into `tools-work`. Rejected: `evals` would then depend on a tool package.
    - Chosen Approach:
      - Subpaths for multi-consumer plumbing and domain types; deletion for unused internals.
    - API Notes and Examples:
      ```ts
      import { pinnedFetch } from "@arnilo/prism/net";
      import type { ArtifactRecord } from "@arnilo/prism/artifacts";
      ```
    - Files to Create/Edit:
      - `src/index.ts`, `src/net/index.ts` (new), `src/artifacts/index.ts` (new; `src/artifacts.ts` moves under it), `src/content.ts` (lazy-import the pinned fetch, per the performance criterion), `package.json` `exports`.
      - callers from plan 179 Task 1 (c) in `packages/tools/{work,openapi,web}`, `packages/integrations/mcp`, `packages/memory/rag`, `packages/policy/governance`, `packages/hosts/evals`, `packages/hosts/remote`, `apps/prism-agent`, `examples/`.
      - `src/__tests__/public-export-contract.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/kernel-constraints.test.ts` (import boundary).
      - `scripts/compat-baseline/arnilo__prism.txt` and each touched package's baseline: regenerated; the note lists removals attributed to this plan.
      - `docs/net.md` (new API page) or a section in `docs/host-security.md` (the review picks; a new page needs its `docs/index.md` link and the `apiPages` entry in `src/__tests__/docs.test.ts`), `docs/migrate-to-0.13.md`, `CHANGELOG.md`.
    - References:
      - review finding "Domain and implementation code would be frozen into the kernel" (2026-10-15).
  - Test Cases to Write:
    - `root_surface_matches_reviewed_table`: the freeze arrays equal the plan 179 Task 1 table.
    - `net_subpath_exports_pinned_fetch`, `artifacts_subpath_exports_records`.
    - `root_entry_does_not_import_node_http`: import graph of `src/index.ts` excludes `node:http`/`node:https`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — exports move.
    - Docs pages to create/edit:
      - `docs/net.md` (new, API page structure) or `docs/host-security.md` section.
      - `docs/migrate-to-0.13.md`: moved imports table.
      - `CHANGELOG.md`.
    - `docs/index.md` update: yes if `docs/net.md` is created — one-sentence entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Retire migration-era shapes
  - Acceptance Criteria:
    - Functional: Credentials: `resolveCredentialValue` and `CredentialValueSource` are deleted from the kernel (`src/credentials/legacy.ts`). `CredentialRecord` is **kept** — plan 179 Task 1 (d) found `packages/credentials/keyring` imports it from `@arnilo/prism` and uses it in its public store API; move it out of `legacy.ts` (e.g. `src/credentials/record.ts`) and keep its export. Every low-level provider factory (`createAnthropicMessagesProvider`, the OpenAI family factories, and the rest from plan 179 Task 1 (d)) takes `apiKey?: SecretSource` where `SecretSource = () => Promise<string | undefined>` is exported from `@arnilo/prism/provider-kit` (the shape `refSource` already returns, `src/provider-kit/provider-package.ts:72`). A literal string `apiKey` no longer type-checks.
    - Functional: Channels: `webhookSecret` and the bot token accept `env:`/`keyring:` refs only (literal → `literal_secret`), resolved through the credentials slot; channels' private `CredentialValueSource` type is deleted.
    - Functional: Layout and strictness: `InputAssemblyLayout` becomes `"cache_aware"` only (or the option is removed if plan 179 Task 1 finds no other value planned); `toolCallStrictness` drops `"legacy"`. Every input-assembly test expecting `legacy` order is updated.
    - Functional: Agent definitions: `AgentDefinition.create` and `AgentDefinitionResolutionContext.activateAllCapabilities` are removed. (The 0.12 `CommandDefinition` family is retired earlier by plan 176 Task 5, which needs it gone to turn the kernel vocabulary gate green; this task only confirms the sweep stays empty.)
    - Functional: The `maxToolRounds` shim at `src/agent-session/session/assemble.ts:600-602` is deleted (0.1.5 removal is long past; the run-options type already rejects it). Leave the `maxToolRounds` *limit axis* (`src/run-limits.ts`, `src/contracts-core/run-limits.ts`) untouched — plan 179 Task 1 (d).
    - Functional: `ProductionPersistenceStore`: kept (plan 179 Task 1 (d) — it is the production persistence contract implemented by `packages/stores/{sqlite,postgres}`); its doc comment states which packages implement it.
    - Functional: Retirement sweep for every removed name and the string `"legacy"` in kernel contracts over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`; the MCP `protocolVersion: "legacy"` era is out of scope and stays).
    - Performance: n/a.
    - Code Quality: No aliases or deprecated re-exports; `docs/migrate-to-0.13.md` carries the replacement table.
    - Security: Every secret-bearing field in first-party packages is ref-only (asserted by a test that walks package config schemas and channel options for `secretRefProperty` or ref validation).
  - Approach:
    - Documentation Reviewed:
      - `src/credentials/legacy.ts`, `src/provider-kit/provider-package.ts:60-90`, `packages/hosts/channels/src/telegram.ts:25-40,115-130,1075-1125`, `src/input.ts:120-180`, `src/contracts-core/agent.ts:31-60,240-300`.
    - Options Considered:
      - Marking them `@deprecated` and removing in a later release. Rejected: after the freeze, removal is a breaking change, and the roadmap forbids compatibility aliases.
    - Chosen Approach:
      - Delete before the freeze, with one migration table.
    - API Notes and Examples:
      ```ts
      import { refSource } from "@arnilo/prism/provider-kit";
      createAnthropicMessagesProvider({ apiKey: refSource(resolve, "env:ANTHROPIC_API_KEY") });
      ```
    - Files to Create/Edit:
      - `src/credentials/legacy.ts` (delete `CredentialValueSource`/`resolveCredentialValue`; `CredentialRecord` moves to `src/credentials/record.ts` and stays exported), `src/credentials/index.ts`, `src/index.ts`, `src/provider-kit/*`.
      - the 36 provider source files (plus type-only `clinepass`/`laya`/`typesafe`) from plan 179 Task 1 (d) and their tests; `packages/credentials/keyring/src/{vault,file-store,encrypted-store}.ts`; `packages/hosts/channels/src/{telegram,signal,secret-ref}.ts` and tests.
      - `src/input.ts`, `src/contracts-protocol.ts`, `src/contracts-core/content.ts`, `src/contracts-core/agent.ts`, `src/agent-session/session/assemble.ts` and affected tests.
      - `src/__tests__/public-export-contract.test.ts`; all affected `scripts/compat-baseline/*.txt` regenerated; removals listed in the note.
      - `docs/provider-kit.md`, `docs/credentials-and-redaction.md`, `docs/migrate-to-0.13.md`, `packages/hosts/channels/README.md`, `CHANGELOG.md`.
    - References:
      - review finding "Leftover migration surface would also be frozen" (2026-10-15).
  - Test Cases to Write:
    - `provider_factories_reject_literal_keys` (type-level test file plus runtime check on a manifest-built instance).
    - `channels_secret_fields_are_ref_only`.
    - `all_first_party_secret_fields_are_refs`.
    - `input_layout_has_no_legacy`.
    - `retired_names_absent` (sweep as a test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removals.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`, `docs/credentials-and-redaction.md`, `docs/migrate-to-0.13.md`, `packages/hosts/channels/README.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Freeze the shape of the surface
  - Acceptance Criteria:
    - Functional: `extractDeclaredSurface` records, per exported name, the full normalized declaration: interface and class bodies (members sorted, whitespace collapsed, comments stripped), type alias right-hand sides, function overload signatures, and enum members. A re-exported name resolves to its declaration in the package's declaration graph instead of recording the `export … from` statement.
    - Functional: The gate reports, per name, `removed`, `changed` (with a unified diff of the normalized text), and `added`. Changes that are additive by rule are classified `compatible` and do not fail: a new optional interface member, a new union member on a type the kernel only produces (listed in a `producerOnlyTypes` table in `scripts/release-gates.mjs`: `AgentEventPayload`, `HostUiRequest`, `AgentFinishReason`, …), a new overload. Everything else fails unless `--allow-break` and a migration note.
    - Functional: Baselines for the kernel and every package are regenerated in the new format with `bun scripts/release.mjs gate --update-baseline`; the note records that every diff line is format-only (no surface change).
    - Performance: The gate's declaration emit runs once per package as today; record total gate time before and after in the note (budget: ≤ +20%).
    - Code Quality: The normalizer is a pure function with unit tests; no TypeScript compiler API beyond what `declarationDir` already uses (plan 179 Task 1 confirms; using `typescript`'s printer is allowed if the emit already loads it).
    - Security: n/a — tooling.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release-gates.mjs:29-230`, `scripts/release-gate.test.mjs`, `docs/release.md` (compat gate).
    - Options Considered:
      - API Extractor. Rejected: a new heavy dev dependency and a build step for a TypeScript-source package; the existing emit already produces `.d.ts`.
      - Snapshotting whole `.d.ts` files. Rejected: any comment or reorder would fail the gate; per-name normalized declarations are stable.
    - Chosen Approach:
      - Extend the existing extractor to full, normalized, resolved declarations with an additive-change classifier.
    - API Notes and Examples:
      ```text
      AgentConfig	interface AgentConfig { readonly compaction?: false | CompactionOptions; readonly disable?: AgentDisable; … }
      ```
    - Files to Create/Edit:
      - `scripts/release-gates.mjs`, `scripts/release-gate.test.mjs`.
      - `scripts/compat-baseline/*.txt` (all, regenerated).
      - `docs/release.md`: compat gate rules; `CHANGELOG.md`.
    - References:
      - review finding "The freeze test checks names only, not shapes" (2026-10-15).
  - Test Cases to Write:
    - `compat_detects_member_change`: removing `AgentConfig.disable` in a fixture fails the gate.
    - `compat_detects_type_alias_change`: narrowing `ToolCapabilityKind` fails.
    - `compat_allows_optional_member_add`: adding an optional field passes as `compatible`.
    - `compat_allows_producer_union_growth`: a new `AgentEventPayload` member passes.
    - `compat_resolves_reexports`: a re-exported interface's body is recorded.
    - `normalizer_is_stable`: comments and member order do not change the output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release tooling.
    - Docs pages to create/edit:
      - `docs/release.md`: compat gate section.
      - `CHANGELOG.md`: tooling entry.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Compatibility promise and forward-compatibility rules
  - Acceptance Criteria:
    - Functional: `docs/compatibility.md` (API page structure) states:
      - what is stable (the root exports, every subpath in `exports`, the hook catalog, slot contracts, `PackageAPI`, `HostPort`, event payloads, the manifest format, the session entry schema);
      - what may change in a minor release (additive changes per Task 4's classifier) and what needs a new API level;
      - host rules: ignore unknown `AgentEvent` types and unknown fields; answer an unknown `HostUi` request kind with `{ status: "unavailable" }`; treat unknown `stopReason`/`finishReason` values as opaque strings;
      - package rules: never exhaustively switch on producer-only unions without a default; declare `requires.api`;
      - store rules: persist and return entries of unknown kinds unchanged; never reject a session because of one.
    - Functional: The kernel follows its own rule: the host-UI dispatcher (`src/host/*`) passes any response through validation that maps an unexpected `status` to `unavailable` (fail closed), and `isKnownAgentEventType(type)` is exported for hosts that want to filter.
    - Functional: JSONL store: a line with an unknown `kind` and a valid envelope (`id`, `sessionId`, `parentId`, `timestamp`) is kept and returned as an opaque entry; `schemaVersion` greater than `SESSION_ENTRY_SCHEMA_VERSION` is returned unchanged and the store emits a one-time warn through its logger; a structurally invalid line is still an error.
    - Functional: The store conformance suite (`src/testing/store-conformance.ts`) gains `unknown_entry_kind_round_trips`, and the SQLite, Postgres, JSONL, and memory stores pass it.
    - Functional: `docs/host.md`, `docs/events.md`, `docs/packages.md` link to the page.
    - Performance: n/a.
    - Code Quality: The opaque-entry shape is the existing `SessionEntry` with its `kind` widened to `SessionEntryKind | (string & {})` in the store-facing type only if plan 179 Task 1 shows that is compatible; otherwise the JSONL store keeps unknown kinds in a `data` envelope. The review decides; the note records it.
    - Security: Unknown entries never reach `session.messages()` or a provider request (asserted).
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/session.ts:15-40`, `packages/stores/jsonl/src/jsonl-store.ts:480-560`, `src/testing/store-conformance.ts`, `src/host/*`, `docs/host.md`, `docs/events.md`.
    - Options Considered:
      - A `HostUi.kinds` capability declaration. Deferred to Further Actions: it is additive and can ship in a minor release under Task 4's rules.
    - Chosen Approach:
      - Document the rules, make the kernel and stores follow them, and enforce stores through conformance.
    - API Notes and Examples:
      ```ts
      for await (const event of session.stream(input)) {
        switch (event.type) {
          case "message.delta": render(event); break;
          default: break; // unknown types are expected in later minors
        }
      }
      ```
    - Files to Create/Edit:
      - `docs/compatibility.md` (new) and its `docs/index.md` entry and `apiPages` entry in `src/__tests__/docs.test.ts`.
      - `src/host/*`, `src/index.ts` (`isKnownAgentEventType`), `src/__tests__/public-export-contract.test.ts`, `scripts/compat-baseline/arnilo__prism.txt` (regenerated; one addition).
      - `packages/stores/jsonl/src/jsonl-store.ts` and tests; `src/testing/store-conformance.ts`; `packages/stores/{sqlite,postgres}` conformance runs.
      - `docs/host.md`, `docs/events.md`, `docs/packages.md`, `CHANGELOG.md`.
    - References:
      - review finding "Closed lists that hosts implement or switch on" (2026-10-15).
  - Test Cases to Write:
    - `unknown_entry_kind_round_trips` (conformance, all stores).
    - `unknown_entry_never_reaches_provider`.
    - `future_schema_version_is_readable_with_warning` (JSONL).
    - `unexpected_host_ui_status_is_unavailable`.
    - `docs_compatibility_page_indexed` (docs suite).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a published stability promise and store behavior.
    - Docs pages to create/edit:
      - `docs/compatibility.md` (new).
      - `docs/host.md`, `docs/events.md`, `docs/packages.md` (links), `CHANGELOG.md`.
    - `docs/index.md` update: yes — "What stays stable across releases and how hosts, packages, and stores stay compatible with later minors."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/package-loader.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts src/__tests__/kernel-constraints.test.ts src/__tests__/docs.test.ts`
- `bun test --timeout=0 scripts/release-gate.test.mjs scripts/package-truth.test.mjs`
- `bun run --filter @arnilo/prism-store-jsonl test && bun run --filter @arnilo/prism-store-sqlite test && bun run --filter @arnilo/prism-channels test && bun run --filter @arnilo/prism-agent test`
- `bun run test`
- `bun scripts/release.mjs gate --update-baseline` (Task 4 only), then `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
