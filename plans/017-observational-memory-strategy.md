# Phase 14 — Observational Memory Compaction Package

## Objectives
- Add `@prism/compaction-observational-memory` as an optional, replaceable observational-memory package based on `pi-observational-memory` V3.
- Keep Prism core defaults unchanged: no hidden workers, package discovery, provider calls, credential resolution, semantic search, vector store, or app tools.
- Store observations, reflections, and drops as append-only session custom ledger entries, then make compaction fast by rendering prepared memory instead of summarizing during compaction.
- Provide explicit recall/status/view surfaces that work from known 12-character ids and current-branch source evidence only.

## Expected Outcome
- `@prism/compaction-observational-memory` builds, typechecks, tests, packs, and exports package helpers with no import side effects.
- Hosts can explicitly activate observational memory with a selected session/store, worker provider/model, settings, credentials, and compaction strategy.
- Observer, reflector, and dropper workers append JSON-serializable custom memory ledger entries only after explicit activation and credential availability.
- Compaction is O(n) over branch entries, makes no provider call, preserves raw history, and appends one standard Prism compaction entry with folded memory details in `data`.
- Recall returns exact source evidence for a known observation/reflection id on the current branch and fails closed for invalid, missing, or unavailable ids.

## Tasks

- [x] Review primitives and lock the minimal Phase 14 surface
  - Acceptance Criteria:
    - Functional: Existing Prism session, store, compaction, extension, tool, command, settings, credential, provider, and package primitives are inventoried against `pi-observational-memory` V3; the task records whether package-only activation is enough or names the smallest generic core primitive if one is unavoidable.
    - Performance: Review adds no runtime code, provider call, worker, queue, filesystem scan, package discovery, network test, tokenizer dependency, or semantic index.
    - Code Quality: The design rejects mode-specific core logic, hidden global session stores, automatic extension loading, vector/semantic search, and making observational memory the core default.
    - Security: Design keeps credentials at the worker-provider edge, requires explicit host activation, redacts exact known secrets before ledger append/compaction, and forbids resolved credentials in entries/events/docs/fixtures.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 14 deliverables/acceptance and non-negotiable boundaries.
      - `plans/011-compaction-strategies-and-retry.md`, `plans/016-llm-compaction-strategy.md`, and Phase 13 closeout for optional compaction-package shape.
      - `src/contracts.ts`: `SessionEntry`, `SessionStore`, `AgentSession`, `CompactionStrategy`, `CompactionContext`, `ToolDefinition`, `CommandDefinition`, `SettingsProvider`, `CredentialResolver`, `AIProvider`, and `ProviderRequest`.
      - `src/session-stores.ts`, `src/agents.ts`, `src/tools.ts`, `src/rpc.ts`, `src/extensions.ts`, `src/contributions.ts`, `src/settings.ts`, and `src/credentials.ts`.
      - `docs/agent-session-runtime.md`, `docs/session-stores-and-branching.md`, `docs/compaction-and-retry.md`, `docs/tools.md`, `docs/cli-rpc.md`, `docs/extensions.md`, `docs/contribution-registries.md`, `docs/settings-auth-trust-security.md`, `docs/provider-layer.md`, `docs/credentials-and-redaction.md`, and `docs/index.md`.
      - `pi-observational-memory` V3 references: `/home/arn/.pi/agent/npm/node_modules/pi-observational-memory/README.md`, `src/session-ledger/types.ts`, `projection.ts`, `fold.ts`, `progress.ts`, `recall.ts`, `render-summary.ts`, `serialize.ts`, `config.ts`, `runtime.ts`, hooks, commands, recall tool, and observer/reflector/dropper agents.
      - `.agents/skills/create-plan/references/prism-wiki.md`; project pattern/wiki directories are not present.
    - Options Considered:
      - Add observational memory to core compaction/runtime: rejected; roadmap requires an optional package and unchanged core defaults.
      - Add a vector database or semantic search API: rejected; Phase 14 recall is exact-id only.
      - Add Pi-style `customType` directly to core entries: rejected; `SessionEntry.kind: "custom"` plus `data.type` is sufficient.
      - Package-only activation with explicit `SessionStore`/`AgentSession`/settings/provider options: chosen; branch advancement is possible by appending to the host-supplied `SessionStore` with parent `session.entries().at(-1)?.id`, then calling `session.checkout(newEntry.id)` while idle.
    - Chosen Approach:
      - Start with existing `SessionEntry.kind: "custom"` and store package-specific type markers in `entry.data.type`.
      - Use Prism compaction `data` for folded details, e.g. `{ throughEntryId, keepEntryIds, strategy, trigger, memory: { type: "om.folded", ... } }`, because `isCompactionEntryData()` allows extra JSON fields.
      - Require explicit host activation for workers. The extension helper can register inert strategy/tool/command contributions; background work starts only through a runtime/controller the host creates with session/store/provider/model/credential inputs.
      - No core primitive is needed for Phase 14. If later host ergonomics justify one, it must be a generic session custom-entry append helper, not observational-memory-specific runtime logic.
    - API Notes and Examples:
      ```ts
      import {
        createObservationalMemoryRuntime,
        createObservationalMemoryCompactionStrategy,
      } from "@prism/compaction-observational-memory";

      const memory = createObservationalMemoryRuntime({
        session,
        store,
        workerProvider,
        workerModel: { provider: "mock", model: "memory" },
        settings,
      });

      await session.compact({ strategy: createObservationalMemoryCompactionStrategy() });
      await memory.flush();
      ```
    - Files to Create/Edit:
      - `plans/017-observational-memory-strategy.md`: record primitive inventory and locked surface.
      - Package/docs files listed in later tasks.
      - No core files are planned from this primitive review.
    - References:
      - `roadmap.md` Phase 14.
      - `pi-observational-memory` V3 README and source files listed above.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - Review-only task: no runtime test; validation is source/docs inspection plus a written primitive decision in this plan before implementation tasks are marked complete.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by review alone; yes if a generic core primitive is proven necessary, in which case this task must update docs before package tasks proceed.
    - Docs pages to create/edit:
      - `none`: review notes live in this plan unless core API changes are made.
    - `docs/index.md` update: No for review alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Primitive inventory complete: existing `SessionEntry.kind: "custom"`, `SessionStore.append/list/get`, `AgentSession.entries()/checkout()`, `CompactionStrategy`, extension/contribution registries, tools, commands, settings, credentials, provider requests, and redaction helpers cover Phase 14.
    - Locked surface: package-only implementation. Workers require explicit runtime activation with a host-supplied idle `AgentSession`, matching `SessionStore`, worker provider/model, settings, credential source, and secrets/redactor inputs.
    - Append rule: custom memory entries append to the supplied store under the current branch leaf and then `checkout()` that new entry; workers must not mutate during active runs.
    - Compaction rule: use a package strategy that renders folded memory from existing entries and returns standard Prism compaction data with extra `memory` details; no provider call during compaction.
    - Recall/status/view rule: exact-id current-branch utilities/factories only; no semantic search, global transcript browser, vector store, hidden package discovery, or core default changes.
    - Validation: source/docs inspection only; no runtime code or tests were added for this review task.

- [x] Add the `@prism/compaction-observational-memory` workspace skeleton
  - Acceptance Criteria:
    - Functional: Package metadata, strict TypeScript config, README, public barrel, skipped live-test convention, placeholder tests, docs page, and docs index entry exist; root workspace handling remains compatible with existing `packages/compaction-*`.
    - Performance: Default build/test remains network-free and uses only TypeScript plus `node:test`; package import performs no worker/provider/credential/store work.
    - Code Quality: Package has no runtime dependencies beyond peer `prism`, no provider SDK, no postinstall script, no import side effects, and follows existing first-party package layout.
    - Security: Skeleton includes no real credentials, env auto-read, filesystem discovery, live provider call, or project-local extension loading.
  - Approach:
    - Documentation Reviewed:
      - Existing package pattern: `packages/compaction-llm/package.json`, `tsconfig.json`, README, `src/index.ts`, `src/__tests__/live.test.ts`, and Phase 13 boundary tests.
      - Root `package.json` workspaces/scripts and `package-lock.json` workspace metadata.
      - `docs/compaction-llm.md` and `docs/index.md` for optional compaction-package docs placement.
      - npm workspace behavior as already used by this repository: `npm run <script> --workspaces --if-present`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add a new root workspace glob: rejected unless missing; root already has `packages/compaction-*`.
      - Put observational memory under `packages/provider-*`: rejected; it is not a provider.
      - Create all implementation files immediately: rejected; start with a compiling skeleton and add behavior in focused tasks.
    - Chosen Approach:
      - Create `packages/compaction-observational-memory` with metadata matching `@prism/compaction-llm`.
      - Add a tiny exported `packageName` first, then replace/extend it in later tasks.
      - Add `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` skipped placeholder; all default tests remain mock-only.
    - API Notes and Examples:
      ```bash
      npm run build --workspace=@prism/compaction-observational-memory
      npm run test --workspace=@prism/compaction-observational-memory
      npm run pack:dry-run --workspace=@prism/compaction-observational-memory
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/package.json`: package metadata, exports, scripts, files, peer dependency.
      - `packages/compaction-observational-memory/tsconfig.json`: strict workspace config.
      - `packages/compaction-observational-memory/README.md`: initial usage/security stub.
      - `packages/compaction-observational-memory/src/index.ts`: temporary public barrel.
      - `packages/compaction-observational-memory/src/__tests__/index.test.ts`: entrypoint/package metadata tests.
      - `packages/compaction-observational-memory/src/__tests__/live.test.ts`: skipped live-test placeholder.
      - `package-lock.json`: workspace lock metadata.
      - `docs/compaction-observational-memory.md`: initial API page stub.
      - `docs/index.md`: add package under Compaction/session memory.
    - References:
      - `plans/016-llm-compaction-strategy.md` workspace skeleton task.
      - `docs/api-page-template.md` and Prism wiki requirements.
  - Test Cases to Write:
    - `observational_memory_package_entrypoint_exists`: imports the built package public entrypoint.
    - `observational_memory_live_tests_are_skipped_by_default`: verifies the env guard and `skip:` usage.
    - `observational_memory_package_metadata_is_minimal`: asserts peer `prism`, no runtime dependencies, no postinstall, and `files: ["dist", "README.md"]`.
    - `npm run typecheck` and `command npm test`: remain green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds a new first-party package name and docs page.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: create package API page stub.
      - `docs/index.md`: add `Observational memory compaction package` under Compaction/session memory.
    - `docs/index.md` update: Yes; add navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Created the `packages/compaction-observational-memory` workspace with package metadata, strict package tsconfig, inert `packageName` export, README, entrypoint tests, and opt-in skipped live-test placeholder.
    - Added `docs/compaction-observational-memory.md` and linked it from `docs/index.md` under Compaction/session memory.
    - Updated `package-lock.json` via `npm install --package-lock-only --ignore-scripts`; no root workspace glob change was needed.
    - Validation passed: `npm run build --workspace=@prism/compaction-observational-memory`, `npm run test --workspace=@prism/compaction-observational-memory`, `npm run pack:dry-run --workspace=@prism/compaction-observational-memory`, `npm run typecheck`, and `command npm test`.

- [x] Implement memory ledger data, projections, rendering, and exact-id recall utilities
  - Acceptance Criteria:
    - Functional: Package exports V3-inspired observation/reflection/drop types, 12-character lowercase hex ids, relevance values, coverage tiers, JSON validators, token estimates, ledger fold, active/full/visible projections, folded compaction detail helpers, memory rendering, and exact-id recall over current-branch entries.
    - Performance: All utilities are pure O(n) over supplied entries, use `Map`/`Set`/arrays/strings only, and perform no provider call, credential resolution, filesystem access, timers, or workers.
    - Code Quality: Utilities are Prism-shaped (`SessionEntry.kind: "custom"`, `data.type` markers, Prism `Message`/content blocks) and JSON-serializable; invalid/old/unknown custom entries are ignored, not thrown.
    - Security: Recall only accepts `^[a-f0-9]{12}$`, never searches semantically, returns only source entries on the current branch, and redaction helpers remove exact known secrets before records are stored/rendered.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `SessionEntry`, `Message`, `ContentBlock`, `ToolCallContent`, `ToolResultContent`, `CompactionEntryData`, and `JsonValue`.
      - `src/session-stores.ts` branch rebuild and compaction data behavior.
      - `src/redaction.ts` exact known-secret helpers.
      - `pi-observational-memory/src/session-ledger/types.ts`, `fold.ts`, `projection.ts`, `progress.ts`, `render-summary.ts`, `recall.ts`, `serialize.ts`, `ids.ts`, and `tokens.ts`.
      - `docs/session-stores-and-branching.md`, `docs/compaction-and-retry.md`, `docs/credentials-and-redaction.md`, and `docs/compaction-observational-memory.md`.
    - Options Considered:
      - Copy Pi entry shape with `customType`/`details`: rejected for Prism; use `entry.data.type` and compaction `data.memory`.
      - Generate random ids: rejected; content-hash ids are source-backed and stable enough, with collision handling in recall.
      - Expose semantic search: rejected; recall is exact known-id only.
      - Throw on unknown custom data: rejected; session stores may contain unrelated package entries.
    - Chosen Approach:
      - Define constants: `om.observations.recorded`, `om.reflections.recorded`, `om.observations.dropped`, and `om.folded`.
      - Use SHA-256 content hashes sliced to 12 lowercase hex characters for observation/reflection ids.
      - Store observation/reflection/drop ledger entries as `kind: "custom"` with data payloads containing `type`, records, and `coversUpToId`.
      - Store folded compaction state in standard compaction entry `data.memory` so `rebuildSessionContext()` still sees `throughEntryId`/`keepEntryIds`.
      - Render memory with Pi's usage instructions, reflection lines, observation lines, and recall guidance adapted to Prism's `recall` tool.
    - API Notes and Examples:
      ```ts
      const folded = foldObservationalMemoryLedger(entries);
      const projection = buildObservationalMemoryProjection(entries, firstKeptEntryId);
      const summary = renderObservationalMemory(projection.reflections, projection.observations);
      const evidence = recallObservationalMemory(entries, "a1b2c3d4e5f6");
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/types.ts`: constants, data types, validators.
      - `packages/compaction-observational-memory/src/ids.ts`: 12-character hash ids and id guard.
      - `packages/compaction-observational-memory/src/tokens.ts`: cheap token estimates.
      - `packages/compaction-observational-memory/src/serialize.ts`: Prism branch/source/recall serialization.
      - `packages/compaction-observational-memory/src/ledger.ts`: fold/progress helpers.
      - `packages/compaction-observational-memory/src/projection.ts`: active/full/visible/folded projections.
      - `packages/compaction-observational-memory/src/render.ts`: compaction/view rendering.
      - `packages/compaction-observational-memory/src/recall.ts`: exact-id source recovery.
      - `packages/compaction-observational-memory/src/index.ts`: exports.
      - `packages/compaction-observational-memory/src/__tests__/ledger.test.ts`: ledger/projection tests.
      - `packages/compaction-observational-memory/src/__tests__/recall.test.ts`: recall/source tests.
      - `docs/compaction-observational-memory.md`: document data model, projections, rendering, and recall.
    - References:
      - `pi-observational-memory` V3 session-ledger source.
      - `roadmap.md` Phase 14 data model and recall acceptance.
  - Test Cases to Write:
    - `observational_memory_validates_memory_ids_and_records`: validates ids, relevance, coverage tier, and data guards.
    - `observational_memory_fold_ignores_invalid_unknown_entries`: validates first-valid-record-wins and tombstone drops.
    - `observational_memory_projection_tracks_visible_full_and_folded_details`: validates active/full projections and `data.memory` folded payload.
    - `observational_memory_render_includes_reflections_observations_and_recall_guidance`: validates summary format.
    - `observational_memory_recall_observation_returns_current_branch_sources`: validates source entries, missing/non-source markers, and dropped status.
    - `observational_memory_recall_reflection_returns_supporting_observation_sources`: validates reflection support traversal and partial results.
    - `observational_memory_recall_invalid_or_missing_id_fails_closed`: validates no search/browse behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds package data-model and recall utility exports.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: fill data model, projection, render, and recall sections.
      - `docs/compaction-and-retry.md`: add related optional package link if not already present.
    - `docs/index.md` update: No if skeleton link exists; verify link text still matches behavior.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Added pure ledger/data utilities in `types.ts`, `ids.ts`, `tokens.ts`, `serialize.ts`, `ledger.ts`, `projection.ts`, `render.ts`, and `recall.ts`, exported from the package entrypoint.
    - Implemented Prism-shaped custom memory markers, 12-character id checks/hash ids, data guards, token estimates, fold/projection helpers, folded compaction details, memory rendering, and current-branch exact-id recall.
    - Updated `docs/compaction-observational-memory.md` with data model, projections, rendering, recall, security, and performance notes; added the related link in `docs/compaction-and-retry.md`.
    - Validation passed: `npm run build --workspace=@prism/compaction-observational-memory`, `npm run test --workspace=@prism/compaction-observational-memory`, `npm run typecheck`, and `command npm test`.

- [x] Implement settings and observer/reflector/dropper worker runtime
  - Acceptance Criteria:
    - Functional: Package resolves `observational-memory` settings, runs observer/reflector/dropper workers only when explicitly activated, records observations/reflections/drops with coverage ids, supports passive mode, worker model/thinking level, pool targets, max turns, debug logging hooks, and host-supplied credentials/provider/model.
    - Performance: Workers run only when token thresholds are due, serialize only branch/source chunks, enforce `agentMaxTurns`, use simple token estimates, and never start more than one consolidation pipeline per runtime.
    - Code Quality: Worker loop is generic over Prism `AIProvider`/`ProviderRequest`, uses package-local in-memory tools for record/drop operations, separates pure prompt/normalization code from runtime scheduling, and appends JSON-only ledger entries.
    - Security: No worker runs without explicit activation and a resolved worker provider/model/credential path; exact known secrets are redacted before prompts, tool records, debug logs, and session entries; credentials are never stored.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `AIProvider`, `ProviderRequest`, `ToolDefinition`, `CredentialResolver`, `SettingsProvider`, and `AgentSession`.
      - `src/provider-events.ts`, `src/mock-provider.ts`, `src/credentials.ts`, `src/settings.ts`, and `src/session-stores.ts`.
      - `pi-observational-memory/src/config.ts`, `runtime.ts`, `hooks/consolidation-trigger.ts`, `agents/observer/agent.ts`, `agents/reflector/agent.ts`, `agents/dropper/agent.ts`, `agents/dropper/coverage.ts`, `agents/dropper/pool.ts`, and prompts.
      - `docs/provider-layer.md`, `docs/settings-auth-trust-security.md`, `docs/credentials-and-redaction.md`, and `docs/tools.md`.
    - Options Considered:
      - Depend on Pi's `agentLoop`/`typebox`: rejected; package should depend only on peer `prism` and use Prism provider/tool contracts.
      - Run workers from import/extension setup: rejected; explicit host activation only.
      - Auto-read `process.env` or settings files: rejected; use host-supplied `SettingsProvider`/credential source.
      - One worker for all phases: rejected; keep observer/reflector/dropper separated because their prompts, tools, and acceptance differ.
    - Chosen Approach:
      - Add `resolveObservationalMemorySettings(settings?, overrides?)` with Pi V3 defaults adapted to Prism model shape.
      - Add a small bounded provider-tool loop used by observer, reflector, and dropper. The loop sends Prism tool definitions, executes only package-local record/drop tools, and stops at `agentMaxTurns` or no calls.
      - Add `createObservationalMemoryRuntime(options)` that receives explicit `session`, `store`, `workerProvider`, `workerModel`, optional credential source, settings, secrets, and debug callback.
      - Runtime checks branch token progress after runs/turn events or explicit `flush()`, appends ledger entries under the current branch leaf, and advances the session branch only through public safe mechanisms chosen by the primitive review.
    - API Notes and Examples:
      ```ts
      const memory = createObservationalMemoryRuntime({
        session,
        store,
        workerProvider,
        workerModel: { provider: "mock", model: "memory" },
        credential: credentials,
        credentialRequest: { provider: "mock", name: "apiKey" },
        settings,
        secrets: [apiKey],
      });

      await memory.flush(); // runs due observer/reflector/dropper work, if any
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/settings.ts`: defaults, normalization, settings-provider resolution.
      - `packages/compaction-observational-memory/src/worker-loop.ts`: bounded Prism provider/tool loop.
      - `packages/compaction-observational-memory/src/workers/observer.ts`: observation prompt/tool/normalization.
      - `packages/compaction-observational-memory/src/workers/reflector.ts`: reflection prompt/tool/coverage normalization.
      - `packages/compaction-observational-memory/src/workers/dropper.ts`: drop prompt/tool/pool selection.
      - `packages/compaction-observational-memory/src/workers/coverage.ts`: coverage tier helpers.
      - `packages/compaction-observational-memory/src/runtime.ts`: explicit activation, threshold checks, locks, append handling, debug callback.
      - `packages/compaction-observational-memory/src/index.ts`: exports.
      - `packages/compaction-observational-memory/src/__tests__/settings.test.ts`: settings tests.
      - `packages/compaction-observational-memory/src/__tests__/workers.test.ts`: worker prompt/tool tests with mock providers.
      - `packages/compaction-observational-memory/src/__tests__/runtime.test.ts`: activation/passive/append/redaction/lock tests.
      - `docs/compaction-observational-memory.md`: settings and worker runtime docs.
      - `packages/compaction-observational-memory/README.md`: activation example.
    - References:
      - `pi-observational-memory` V3 config/runtime/worker source.
      - `roadmap.md` Phase 14 worker/settings deliverables.
  - Test Cases to Write:
    - `observational_memory_settings_resolve_defaults_and_overrides`: validates thresholds, target derivation, passive, model, thinking, debug flags.
    - `observer_records_source_backed_observations_with_allowed_source_ids_only`: validates invalid/invented ids are rejected.
    - `reflector_records_reflections_with_valid_support_ids_and_coverage_context`: validates support ids and coverage tiers.
    - `dropper_records_safe_drops_after_reflection_and_pool_pressure`: validates pool target, max drops, and coverage-aware selection.
    - `runtime_does_not_start_workers_when_passive_not_due_in_flight_or_missing_credentials`: validates explicit activation and fail-closed gates.
    - `runtime_appends_custom_ledger_entries_append_only_and_redacted`: validates parent/branch behavior and secret removal.
    - `runtime_worker_errors_are_recorded_without_corrupting_branch`: validates last-error/debug state and no partial invalid entries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds settings namespace, runtime activation API, worker behavior, and ledger append behavior.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: settings table, activation lifecycle, worker model/credential selection, passive mode, debug logging, security/performance notes.
      - `docs/settings-auth-trust-security.md`: related link to package settings if examples mention settings provider integration.
      - `docs/credentials-and-redaction.md`: related link if worker credential examples are added.
    - `docs/index.md` update: No if package page already linked; verify description mentions settings/workers.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Added settings resolution, bounded worker loop, observer/reflector/dropper workers, coverage helper, and explicit `createObservationalMemoryRuntime()` activation API.
    - Runtime gates passive mode, missing worker model, missing explicitly requested credentials, and in-flight consolidation; worker errors are captured in runtime status without appending partial entries.
    - Runtime appends redacted JSON custom ledger entries through the supplied `SessionStore` and advances the idle session via `checkout()`; imports/setup remain inert.
    - Updated package README and `docs/compaction-observational-memory.md` with runtime activation, settings defaults, worker behavior, and safety/performance notes.
    - Validation passed: `npm run build --workspace=@prism/compaction-observational-memory`, `npm run test --workspace=@prism/compaction-observational-memory`, `npm run typecheck`, and `command npm test`.

- [x] Implement fast compaction strategy and extension registration helpers
  - Acceptance Criteria:
    - Functional: `createObservationalMemoryCompactionStrategy()` renders existing memory immediately, returns one standard `kind: "compaction"` entry with `throughEntryId`, `keepEntryIds`, strategy/trigger, and folded memory details; `createObservationalMemoryExtension()` registers inert strategy/tool/command contributions without starting workers.
    - Performance: Compaction is O(n), uses no model/provider call, no credential resolution, no timers, no background jobs, and no filesystem/network access.
    - Code Quality: Strategy uses pure ledger/projection utilities, keeps raw history append-only, supports repeated compactions and branch-specific projections, and keeps package extension code separate from runtime worker activation.
    - Security: Summary and compaction data redact exact known secrets; extension setup does not resolve credentials, call providers, or mutate active sessions.
  - Approach:
    - Documentation Reviewed:
      - `src/compaction.ts`, `src/agents.ts` `compactBranch()`, and `src/session-stores.ts` compaction boundary behavior.
      - `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/extensions.md`, `docs/contribution-registries.md`, and `docs/session-stores-and-branching.md`.
      - `pi-observational-memory/src/hooks/compaction-hook.ts`, `hooks/compaction-trigger.ts`, `session-ledger/projection.ts`, and `render-summary.ts`.
      - Phase 13 `packages/compaction-llm/src/extension.ts` strategy registration pattern.
    - Options Considered:
      - Call a model during compaction: rejected; Phase 14 compaction must render prepared memory.
      - Use core default compaction summary plus memory: rejected initially; package strategy can render memory as the summary and keep recent entries through standard compaction data.
      - Auto-trigger compaction from core: rejected; package runtime may call `session.compact({ strategy })` only after explicit activation and idle/safe checks.
      - Register workers in extension setup: rejected; setup remains inert.
    - Chosen Approach:
      - Implement cut/keep entry selection with existing `keepRecentEntries` defaults and branch entries supplied by `CompactionContext`.
      - Build compaction projection using folded ledger entries through the first kept entry; include full-fold behavior when active observations exceed the configured pool max.
      - Return a package-created compaction entry so Prism runtime copies its compatible `data` onto the stored entry.
      - Extension helper registers strategy plus optional recall/status/view contributions when factories/options are supplied, but worker runtime remains a direct explicit activation.
    - API Notes and Examples:
      ```ts
      const strategy = createObservationalMemoryCompactionStrategy({
        keepRecentEntries: 8,
        observationsPoolMaxTokens: 20_000,
        secrets: [apiKey],
      });

      await session.compact({ strategy });
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/strategy.ts`: compaction strategy factory and cut/keep data.
      - `packages/compaction-observational-memory/src/extension.ts`: inert extension helper.
      - `packages/compaction-observational-memory/src/index.ts`: exports.
      - `packages/compaction-observational-memory/src/__tests__/strategy.test.ts`: compaction behavior tests.
      - `packages/compaction-observational-memory/src/__tests__/extension.test.ts`: inert setup/registration tests.
      - `docs/compaction-observational-memory.md`: strategy/extension examples and compaction handoff.
      - `docs/compaction-and-retry.md`: optional package link and fast-render note.
      - `docs/extensions.md`: related link to optional observational-memory extension helper.
    - References:
      - `roadmap.md` Phase 14 fast compaction and extension acceptance.
      - `pi-observational-memory` compaction hook/trigger source.
  - Test Cases to Write:
    - `observational_memory_strategy_renders_existing_memory_without_provider_call`: validates no provider/credential calls and summary content.
    - `observational_memory_strategy_returns_standard_compaction_data_with_folded_memory`: validates `throughEntryId`, `keepEntryIds`, and `data.memory`.
    - `observational_memory_strategy_preserves_raw_history_and_rebuilds_recent_context`: validates store branch behavior through `rebuildSessionContext()`.
    - `observational_memory_strategy_handles_repeated_compactions_and_full_fold`: validates visible/full projection carry-forward.
    - `observational_memory_strategy_redacts_known_secrets`: validates summary/data redaction.
    - `observational_memory_extension_registers_inert_contributions`: validates setup registers but does not start workers/call provider.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds main compaction strategy and extension helper APIs.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: strategy options, output data, extension registration, compaction handoff, failure/no-memory behavior.
      - `docs/compaction-and-retry.md`: related optional package link and no-model-during-compaction note.
      - `docs/extensions.md`: related optional package link/example if extension helper is documented there.
    - `docs/index.md` update: No if package page already linked; verify link text.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Added `createObservationalMemoryCompactionStrategy()` in `src/strategy.ts`; it selects recent message ids, renders existing folded memory with no model/provider call, returns a standard compaction entry, and stores folded details in `data.memory`.
    - Added `createObservationalMemoryExtension()` in `src/extension.ts`; setup registers only the inert compaction strategy by default and can skip registration. Tool/command registration remains for the next planned task when those factories exist.
    - Added strategy and extension tests covering no-provider rendering, standard compaction data, raw-history preservation/rebuilt context, repeated compaction/full fold, redaction, and inert extension registration.
    - Updated package README, `docs/compaction-observational-memory.md`, `docs/compaction-and-retry.md`, and `docs/extensions.md` with strategy/extension behavior and no-model compaction notes.
    - Validation passed: `npm run build --workspace=@prism/compaction-observational-memory`, `npm run test --workspace=@prism/compaction-observational-memory`, `npm run typecheck`, and `command npm test`.

- [x] Implement recall tool plus memory status/view command factories
  - Acceptance Criteria:
    - Functional: Package exports optional `recall` tool and `om:status`/`om:view` command factories that recover/render memory from host-supplied current-branch entries; recall requires a known 12-character id and returns observation/reflection evidence, source entries, partial/missing-source details, and no semantic search.
    - Performance: Tool/commands fold or recall in O(n), perform no provider call, worker run, filesystem access, clipboard access, timer, or network call by default.
    - Code Quality: Factories are inert until host registers/selects them; command/tool code shares ledger/render/recall utilities and works with RPC `CommandDefinition` and active host tool registries.
    - Security: Invalid ids fail closed, source output is current-branch only, known secrets are redacted when a redactor/secrets option is supplied, and command/tool metadata contains no credentials.
  - Approach:
    - Documentation Reviewed:
      - `src/tools.ts`, `src/rpc.ts`, `src/contracts.ts` `ToolDefinition`, `ToolExecutionContext`, `CommandDefinition`, and `CommandExecutionContext`.
      - `docs/tools.md`, `docs/cli-rpc.md`, `docs/contribution-registries.md`, and `docs/extensions.md`.
      - `pi-observational-memory/src/tools/recall-observation.ts`, `commands/status.ts`, `commands/view.ts`, `session-ledger/recall.ts`, and `serialize.ts`.
      - Prism wiki requirements for public behavior docs.
    - Options Considered:
      - Add recall as a core tool: rejected; no built-in app tools in core.
      - Let recall search by text/topic: rejected; exact id only.
      - Require clipboard/TUI integration: rejected; Prism package returns text/JSON content only.
      - Make commands read global sessions: rejected; factories require host-supplied `getEntries(sessionId)`.
    - Chosen Approach:
      - Export `createRecallMemoryTool({ getEntries, secrets? })`, `createMemoryStatusCommand({ getEntries, settings? })`, and `createMemoryViewCommand({ getEntries })`.
      - Use `ToolExecutionContext.sessionId` and `CommandExecutionContext.sessionId` to fetch current-branch entries from a host callback.
      - Return concise text content plus structured `value`/`metadata` for status, view, and recall details.
      - Extension helper registers these contributions only when the needed host callbacks/options are provided.
    - API Notes and Examples:
      ```ts
      const recall = createRecallMemoryTool({
        getEntries: (sessionId) => sessions.get(sessionId)?.entries() ?? [],
      });

      const commands = createObservationalMemoryCommands({ getEntries });
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/tool.ts`: recall `ToolDefinition` factory.
      - `packages/compaction-observational-memory/src/commands.ts`: status/view command factories.
      - `packages/compaction-observational-memory/src/index.ts`: exports.
      - `packages/compaction-observational-memory/src/__tests__/tool.test.ts`: recall tool tests.
      - `packages/compaction-observational-memory/src/__tests__/commands.test.ts`: status/view command tests.
      - `packages/compaction-observational-memory/README.md`: recall/status/view examples.
      - `docs/compaction-observational-memory.md`: tool/command docs and exact-id guidance.
      - `docs/tools.md` and `docs/cli-rpc.md`: optional related links if examples are added.
    - References:
      - `roadmap.md` Phase 14 recall/status/view deliverables.
      - `pi-observational-memory` recall tool and commands.
  - Test Cases to Write:
    - `recall_tool_rejects_invalid_id_without_entry_lookup`: validates fail-closed validation.
    - `recall_tool_returns_observation_sources_from_current_branch`: validates source rendering/details.
    - `recall_tool_returns_reflection_supporting_observations_and_sources`: validates reflection evidence.
    - `recall_tool_reports_missing_non_source_and_dropped_evidence`: validates partial statuses.
    - `status_command_reports_counts_progress_visible_full_and_in_flight_state`: validates status output/value.
    - `view_command_renders_visible_and_full_memory`: validates modes and usage errors.
    - `tool_and_commands_are_inert_until_registered_by_host`: validates no global registration/side effects.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds optional tool and command factory exports plus command names/behavior.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: recall tool, status/view commands, exact-id constraints, outputs, examples.
      - `docs/tools.md`: related link if recall tool factory is referenced.
      - `docs/cli-rpc.md`: related link if command use through RPC is documented.
      - `docs/contribution-registries.md`: optional related link for inert command/tool contributions.
    - `docs/index.md` update: No if package page already linked; verify description mentions recall/status/view.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Added `createRecallMemoryTool()` in `src/tool.ts`; invalid ids fail before entry lookup, exact-id recall returns text plus structured details, and supplied secrets redact structured/tool text output.
    - Added `createMemoryStatusCommand()`, `createMemoryViewCommand()`, and `createObservationalMemoryCommands()` in `src/commands.ts` for host-supplied current-branch entries.
    - Extended `createObservationalMemoryExtension()` to optionally register the recall tool and status/view commands while remaining inert by default.
    - Added tool, command, and extension tests covering fail-closed invalid ids, current-branch recall, reflection/dropped/missing-source details, status output, visible/full view modes, usage errors, and inert contribution factories.
    - Updated package README, `docs/compaction-observational-memory.md`, `docs/tools.md`, `docs/cli-rpc.md`, and `docs/index.md` for recall/status/view APIs.
    - Validation passed: `npm run build --workspace=@prism/compaction-observational-memory`, `npm run test --workspace=@prism/compaction-observational-memory`, `npm run typecheck`, and `command npm test`.

- [x] Verify docs, package exports, boundaries, and pack output
  - Acceptance Criteria:
    - Functional: All Phase 14 package exports and behavior are documented, root/workspace builds and tests pass, pack dry-run includes only intended files, and `/docs/index.md` links the package docs.
    - Performance: Default test suite remains network-free, no live provider tests run by default, and no import/setup path starts workers, provider calls, credential resolution, filesystem discovery, timers, or semantic indexing.
    - Code Quality: `npm run build`, `npm run typecheck`, `command npm test`, workspace tests, and pack dry-runs pass; root boundary tests guard core-default and package-inertness boundaries.
    - Security: Tests scan docs/README/fixtures for real-looking secrets, verify exact-secret redaction in worker prompts/ledger/compaction/recall output, and prove recall fails closed for invalid/missing ids.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md`, `.agents/skills/create-plan/references/prism-wiki.md`, `docs/index.md`, `docs/compaction-observational-memory.md`, and package README after implementation.
      - `package.json`, `package-lock.json`, package `package.json`, package `exports`/`files`, and generated declarations.
      - Existing root boundary tests: `src/__tests__/phase13-boundaries.test.ts` and provider package boundary tests.
    - Options Considered:
      - Rely only on package tests: rejected; root tests should catch core default/import/docs drift.
      - Run live worker/provider tests by default: rejected; live tests stay opt-in.
      - Add docs generator/API extractor: rejected; focused docs and declaration checks are enough for this phase.
    - Chosen Approach:
      - Add one root Phase 14 boundary test covering public entrypoint imports, docs links, no core imports/default selection, inert setup, skipped live tests, minimal package files, and secret scan.
      - Run root validation commands after implementation.
      - Fill this plan's closeout sections only after checks pass.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      npm run test --workspace=@prism/compaction-observational-memory
      npm run pack:dry-run --workspace=@prism/compaction-observational-memory
      npm run pack:dry-run --workspaces --if-present
      ```
    - Files to Create/Edit:
      - `src/__tests__/phase14-boundaries.test.ts`: package exports, docs, inertness, no-core-default, live-test skip, pack files, and secret scan checks.
      - `docs/compaction-observational-memory.md`: final API page.
      - `docs/compaction-and-retry.md`, `docs/tools.md`, `docs/cli-rpc.md`, `docs/extensions.md`, `docs/index.md`: final related links as needed.
      - `packages/compaction-observational-memory/README.md`: final examples/security notes.
      - `plans/017-observational-memory-strategy.md`: mark tasks complete during execution and fill closeout.
    - References:
      - `roadmap.md` Phase 14 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `phase14_observational_memory_imports_from_public_entrypoint`: validates exported factories/utilities.
    - `phase14_observational_memory_setup_is_inert`: validates extension/runtime construction does not start workers or provider calls.
    - `phase14_docs_index_links_observational_memory_page`: validates navigation.
    - `phase14_package_exports_files_are_minimal`: validates metadata and pack include list.
    - `phase14_live_tests_are_skipped_by_default`: validates env guard.
    - `phase14_core_does_not_default_to_observational_memory`: scans core runtime/default compaction for package imports/default selection.
    - `phase14_no_real_secrets_in_docs_or_fixtures`: scans docs/package tests/README for real-looking tokens.
    - Final commands: `npm run build`, `npm run typecheck`, `command npm test`, workspace tests, and pack dry-runs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; finalizes package exports and docs for all Phase 14 public behavior.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: final API page.
      - `docs/compaction-and-retry.md`: final related optional package link.
      - `docs/tools.md`: final related link if recall tool docs are cross-linked.
      - `docs/cli-rpc.md`: final related link if commands are documented for RPC hosts.
      - `docs/extensions.md`: final related link if extension helper is documented.
      - `docs/index.md`: final Compaction/session memory navigation entry.
    - `docs/index.md` update: Yes if link text is missing/stale; otherwise verify unchanged.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Added `src/__tests__/phase14-boundaries.test.ts` covering public entrypoint exports, inert runtime/extension construction, docs/index coverage, package metadata/files, skipped live tests, core-default boundaries, and secret scanning.
    - Verified final docs/README cross-links and updated `docs/index.md` description to mention source-backed memory, fast compaction, recall tool, and status/view commands.
    - Validation passed: `npm run build`, `npm run typecheck`, `command npm test`, `npm run pack:dry-run --workspace=@prism/compaction-observational-memory`, and `npm run pack:dry-run --workspaces --if-present`.

## Compromises Made
- Recall/status/view factories require host-supplied `getEntries(sessionId)` instead of reading a global session registry; this keeps the package inert and core-default-free.
- Worker/runtime activation remains explicit via `createObservationalMemoryRuntime().flush()`; no automatic extension hook or timer was added to avoid hidden background work.
- Token counts use lightweight estimates rather than a tokenizer dependency; sufficient for thresholds/pool pressure, replace only if measured drift matters.

## Further Actions
- Medium: add host-level cookbook examples once an application chooses a concrete session registry and command/tool wiring pattern.
- Low: add opt-in live worker/provider smoke tests behind `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` if a real provider fixture is later maintained.
- Low: consider a generic session custom-entry append helper only if multiple packages need the same host ergonomics; do not add observational-memory-specific core logic.
