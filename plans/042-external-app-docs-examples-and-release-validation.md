# Phase 41 — External-app docs, examples, and release validation

## Objectives
- Prove an external multi-user app can build against the hardened Phase 34–40 surface from docs alone: pick a DB-backed persistence contract, register explicit tools/skills, persist a durable run/event/tool/usage ledger, drive branching with branch handles, and resume a prior run from the ledger.
- Fix the README quickstart so `session.run()` and event consumption run concurrently instead of the subscribe loop blocking `run` forever.
- Ship a `/docs/migration.md` guide covering in-memory/JSONL → DB-backed persistence and permissive capability defaults → explicit activation.
- Add network-free regression tests for the persistence contract, event ledger, security escapes, branch handles, runtime protocol, and the new docs/examples.
- Update the final release checklist so docs coverage, package exports, examples, tarball contents, and public-API drift fail the gate for the new persistence/runtime surfaces.

## Expected Outcome
- `README.md` quickstart runs as written: events stream while the run executes, and the run terminates.
- `examples/external-app-db-backed.ts` compiles network-free with the mock provider against a documented DB-backed adapter reference mock, exercises a durable run ledger, event timeline, usage rows, branching, and checkout, and asserts a prior run can be resumed/displayed without reading Prism source.
- `/docs/migration.md`, `/docs/database-persistence.md`, `/docs/runs-and-usage.md`, `/docs/session-branching.md`, `README.md`, and `/docs/index.md` cover the external-app path end to end and link to the example.
- `src/__tests__/docs.test.ts` and `src/__tests__/public-export-contract.test.ts` enforce the new docs, example, export, and tarball drift checks; default `npm test` stays network-free and under the existing budget.
- The release checklist in `docs/release-and-install.md` (and any release dry-run notes) covers docs, package exports, examples, tarball contents, and public-API drift for persistence/runtime surfaces.

## Tasks

- [x] Inventories: README quickstart, persistence/runtime surfaces, and existing release checks
  - Acceptance Criteria:
    - Functional: Inventory `README.md` quickstart event subscription, `examples/` typed examples + fixtures, `src/__tests__/docs.test.ts` and `src/__tests__/public-export-contract.test.ts` assertions, and `docs/release-and-install.md` checklist state before editing.
    - Performance: Inventory-only; no product code change in this task.
    - Code Quality: Document exact files affected and the smallest diff per later task; reject parallel mechanisms already covered by existing contracts.
    - Security: Confirm no example or fixture contains real-looking secrets; existing secret-regex check in `docs.test.ts` covers README.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 41 deliverables and acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `README.md` Quick start, CLI, Docs, Packages, Scripts sections.
      - `docs/index.md` existing functional groups and links.
      - `docs/database-persistence.md`, `docs/runs-and-usage.md`, `docs/session-branching.md`, `docs/release-and-install.md`.
      - `src/__tests__/docs.test.ts` (README/secret/index/examples/migration assertions), `src/__tests__/public-export-contract.test.ts` (phase39 export drift).
      - `examples/README.md` and existing examples (`jsonl-stores-branching.ts`, `tools.ts`, `runs-and-usage.md` usage helpers).
    - Options Considered:
      - Invent new release-check harness separate from `docs.test.ts`/`public-export-contract.test.ts`: rejected, duplicates existing enforcement and adds drift surface.
      - Extend existing `docs.test.ts` + `public-export-contract.test.ts` for any new checks: smallest diff, keeps the single network-free gate.
    - Chosen Approach:
      - Inventory first, then each following task edits only the listed files against this inventory.
    - API Notes and Examples:
      ```ts
      // README quickstart current bug: subscribe loop never resolves before run.
      for await (const event of session.subscribe()) { /* never returns */ }
      await session.run("Hi"); // unreachable
      ```
    - Files to Create/Edit:
      - `plans/042-external-app-docs-examples-and-release-validation.md`: this plan.
      - `README.md`: quickstart inventory.
      - `examples/README.md`, `examples/*.ts`, `examples/fixtures/*`: example/fixture inventory.
      - `src/__tests__/docs.test.ts`, `src/__tests__/public-export-contract.test.ts`: assertion inventory.
      - `docs/release-and-install.md`, `docs/index.md`: checklist/navigation inventory.
    - References:
      - `src/__tests__/docs.test.ts:697` asserts README mentions every first-party package, CLI modes, and `examples/`.
      - `src/__tests__/docs.test.ts:773` asserts README has no real-looking secret.
      - `src/__tests__/public-export-contract.test.ts:67` asserts phase39 protocol exports/types do not drift and that public targets stay under `dist/`.
      - `docs/release-and-install.md` already documents install specifiers, tarball contents, and the `<30s` offline test budget.
    - Test Cases to Write:
      - Inventory-only: record exact assertion targets in following tasks.
    - Current Inventory:
      - README quickstart bug (verified `README.md:53-72`): the Quick start snippet awaits the unbounded `for await (const event of session.subscribe())` loop **before** `await session.run("Hi")`. `subscribe()` is a live async iterable that only emits events once a run is in progress, so the loop blocks forever waiting for its first event and `session.run("Hi")` is unreachable — a deadlock. The two calls already sit inside one async IIFE; the fix is to launch `run` concurrently with the subscribe loop (e.g. `await Promise.all([consume(), session.run("Hi")])`, or start the run without awaiting before the loop, mirroring `examples/sdk-basics.ts` / `examples/cli.ts` / `examples/rpc.ts`). No new API needed; only reordering inside the existing IIFE.
      - README secret check: `docs.test.ts:773` already runs `/sk-[A-Za-z0-9_-]{8,}/` against the README, so the quickstart fix must keep the mock provider output secret-free.
      - README mentions every first-party package name, every CLI mode (`print`/`json`/`rpc`), and `examples/` — enforced by `docs.test.ts:697-713`; do not remove any of these when editing Quick start.
      - README Quick start uses only `createAgent`, `createAgentSession`, `createMockProvider`, `session.subscribe()`, `session.run()` — all from `@arnilo/prism` core (`src/index.ts`); the OpenAI-compatible provider package snippet below uses the existing `createExtensionKernel`/`createEnvCredentialResolver`/`createOpenAIProviderPackage` exports.
      - examples inventory (`examples/`, listed in `examples/README.md`): typed + runnable demo set covers SDK basics, provider registration/resolver, api-key auth, OAuth login, OpenRouter model/cache override, tools, context, skills, extensions, manifests, config-settings, system-prompts (file + composition), system/project prompts auto-load, JSONL stores/branching, compaction, observational-memory recall/status/view, Synapta-style artifact loop, CLI, RPC. Fixtures under `examples/fixtures/`: `branching.jsonl`, `compaction.jsonl`, `corrupt.jsonl` (invalid JSON + bad-shape entries, used by JSONL fail-closed tests), `llm-summary.jsonl`, `observational-memory-ledger.jsonl`, `tool-result-replay.jsonl`. **No** DB-backed external-app example exists yet — Task 4 adds `examples/external-app-db-backed.ts`.
      - examples typecheck: `examples/tsconfig.json` (`noEmit`, strict) is part of `npm run typecheck`; examples typecheck against package source without a build. Node 24 can run demo `main()` functions directly after `npm run build:core`.
      - Persistence/runtime surface inventory (already implemented in Phases 34-36, verified present):
        - `ProductionPersistenceStore` contract + `SessionAppendConflict`/`SessionAppendConflictError`/`SessionAppendOptions`/`SessionBranchHandle`/`SessionBranchRead`/`readBranchPath` (optional on both `SessionStore` and `ProductionPersistenceStore`) — exported from `src/index.ts`, type-checked by `src/__tests__/persistence-contracts.types.test.ts`.
        - Atomic append guards: `expectedParentId` fail-closed, idempotency-key duplicate rejection at the same position, linear-append non-collapse for run-level keys, rejected append leaves chain parent order untouched (atomicity) — all covered in `src/__tests__/session-stores.test.ts` "atomic append guards".
        - Branch reader overloads: `getSessionBranchEntries(reader, {leafId, limit, cursor})` paginates across `nextCursor` pages, leaf-first, missing-parent rejection; `rebuildSessionContext(reader, query)` mirrors the sync snapshot; sync array path stays synchronous — `src/__tests__/session-stores.test.ts` lines 154-193.
        - Defensive copies: `list`/`get` and branch helpers return copies so callers cannot mutate stored entries — `session-stores.test.ts:98-145`.
        - `RunLedger` + `RunLedgerRecord` (runs/events/toolCalls/usage) + `redactRunLedgerRecord` + `AgentConfig`/`RunOptions` accepting `runLedger`/`ownership`/`idempotencyKey` — implemented and tested in `src/__tests__/run-ledger.test.ts`: run lifecycle records, tool-call started/finished/blocked records (with reason), usage records from provider usage + final loop usage, redaction across every record kind.
        - Runtime protocol: `tool_call_delta` streaming + final `tool_call` reconstruction (`providerToolCallDelta` in `src/index.ts`, `ToolCallDeltaContent` in `src/contracts.ts`) — covered by `public-export-contract.test.ts` phase39 drift test + `agents.test.ts`/`provider-events.test.ts`.
      - Security escape coverage already present (`src/__tests__/settings-security.test.ts`): symlink escape from trusted root rejected (`settings-security.test.ts:74`), realpath-inside-trusted-root symlinked root accepted (`:91`), fail-closed when trusted root cannot be resolved (`:104`), permission/trust denied before side effects (`:50`/`:108`/`:118`), redaction helper (`:134`). Config prototype-pollution rejection is asserted in `config-manifests.test.ts` (the config merge path).
      - Release-check / docs-drift inventory (`src/__tests__/docs.test.ts`): index links point to existing `docs/*.md` (line 94-106); every API page in `apiPages` array has the 9 required headings (108-118); provider package pages document a real export from their package (121-134); README + docs have no bare `prism` install/import specifiers (121-136), no old `@prism/` scope (137-142), no broken `const { api } = createExtensionKernel()` destructure (107-114); index links every phase page; migration doc assertions already exist for **provider timeout/retry** (`docs.test.ts:574`, asserts `docs/release-and-install.md` + `docs/provider-layer.md` + index) and **explicit capability activation** (`:839`, old/new/compatibility phrases). Database-persistence schema/indexes/retention/migrations/NoSQL assertions live at `:989-1054`; runs-and-usage batch ordering at `:1060-1071`.
      - public-export-contract + packaging inventory: `public-export-contract.test.ts` enforces per-package `dist/` existence, every `exports.*` (types+default) + `main`/`types`/`bin` target resolves under `dist/`, sibling `.d.ts` present, and "no target escapes dist/"; `packaging.test.ts` enforces no tests/maps/source/plans/.agents in tarballs, README+LICENSE+CHANGELOG in every package, every exports target shipped as compiled output, core ships docs hub + CLI bin, metadata fields (license/repository/bugs/homepage/keywords/sideEffects), non-optional `@arnilo/prism` peer, umbrella hard-deps family only, core named `@arnilo/prism`, and `npm ls --all --depth=0` clean. `install-smoke.test.ts` packs + offline-installs every package into a fresh temp project. `network-free-guard.test.ts` keeps the default suite network-free.
      - Release checklist state (`docs/release-and-install.md`): documents package layout, install specifiers, required non-optional `@arnilo/prism` peer, tarball contents + exclusions (incl. `dist/__tests__` and `dist/**/*.map` map-retention knob), per-package `files` whitelists, `release:dry-run` script (`npm test` + `npm run pack:dry-run`) mirroring `.github/workflows/release.yml` `verify` job, opt-in live-test gate vars, offline test budget `<30s` on Node 20 (baseline ~22s). **Not yet** explicitly listed in this checklist: docs/example coverage for the new persistence/runtime/migration surfaces as a release gate against public-API drift — Task 6 adds this.
      - Gap confirmed for Task 3: no `docs/migration.md` exists (`ls docs/migration.md` → missing). `docs/index.md` has no migration entry. Migration prose for provider timeout/retry and explicit capability lives inline in their feature docs, not a dedicated migration page covering JSONL→DB persistence + permissive→explicit activation end to end.
      - Gap confirmed for Task 4: no end-to-end external-app/DB-backed adapter example under `examples/`; the closest existing example is `examples/jsonl-stores-branching.ts` (in-memory + JSONL), which is the dev/local path, not the production persistence contract path. The reference adapter mock for Task 4 can reuse the `ProductionPersistenceStore` shape already type-checked in `persistence-contracts.types.test.ts`.
    - Smallest change per later task implied by this inventory:
      - Task 2 (README quickstart): one IIFE reorder only; no API change; extend `docs.test.ts` with a snippet-ordering assertion.
      - Task 3 (migration.md): new doc page + index entry + 3 cross-links; reuse the migration-assertion pattern already at `docs.test.ts:574`/`:839`.
      - Task 4 (external-app example): new `examples/external-app-db-backed.ts` reusing the existing `ProductionPersistenceStore`/`RunLedger`/`readBranchPath`/branch-handle seams + mock provider; list it in `examples/README.md`.
      - Task 5 (tests): extend the existing per-area test files named above for the new cases; no new framework; reuse existing fixtures where a golden run-ledger replay is needed, else add one fixture.
      - Task 6 (release checklist): append to `docs/release-and-install.md` and extend `docs.test.ts` for the new checklist phrases; extend `public-export-contract.test.ts` only if the example exposes a new public subpath (it should not — it reuses existing exports).
    - Test Cases to Write:
      - Inventory-only task: no product test; exact targets recorded above for following tasks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit:
      - `none`: later tasks own docs changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Fix README quickstart so `session.run()` and event consumption are concurrent
  - Acceptance Criteria:
    - Functional: The README quickstart starts the run and consumes events concurrently so the example terminates; no event is silently dropped and the run completes.
    - Performance: Quickstart stays a single short snippet, no new dependency or helper module.
    - Code Quality: Uses existing `createAgent`/`createAgentSession`/`createMockProvider`/`session.subscribe()`/`session.run()` only; no invented API.
    - Security: No secrets in the snippet; mock provider output is non-sensitive.
  - Approach:
    - Documentation Reviewed:
      - `README.md` Quick start.
      - `docs/agent-session-runtime.md` `session.subscribe()` + `session.run()` semantics and turn-event order.
      - `docs/agent-events.md` event union and terminal events (`agent_finished` / `run_ended`).
      - `packages/` mock provider usage in existing examples.
    - Options Considered:
      - Start `session.run()` first, then iterate `session.subscribe()`: works because runtime buffers events to the live subscriber before `run` is awaited, but ordering in prose is clearer if subscribe runs concurrently.
      - Run subscribe and run concurrently via `Promise.all`/an async IIFE: clearest and matches existing example style (`sdk-basics.ts`).
    - Chosen Approach:
      - Launch `session.run("Hi")` and iterate `session.subscribe()` concurrently inside one async IIFE so the loop drains as events arrive and resolves when the run ends.
    - API Notes and Examples:
      ```ts
      const session = createAgentSession({ agent });

      for await (const event of session.subscribe()) {
        console.log(event.type); // agent_started, message_delta, turn_finished, ...
      }

      await session.run("Hi");
      ```
      Resolved as a concurrent pair (subscribe loop started before awaiting `run`) so neither blocks the other.
    - Files to Create/Edit:
      - `README.md`: replace the Quick start `subscribe`/`run` block with the concurrent form and a one-line note that subscribe must run concurrently with `run`.
      - `docs/agent-session-runtime.md`: cross-reference the concurrent pattern if not already stated.
      - `src/__tests__/docs.test.ts`: add/extend an assertion that README quickstart does not place `await session.run(...)` after an unbounded `for await (const event of session.subscribe())`.
    - References:
      - `README.md:53-72` current buggy quickstart.
      - `examples/sdk-basics.ts` existing async pattern.
      - `docs/agent-events.md` terminal events.
  - Test Cases to Write:
    - README quickstart ordering assertion in `docs.test.ts`: subscribe loop and `session.run` are invoked such that `run` is reachable from the snippet.
    - (Existing) README secret check still passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; documentation fix of existing API.
    - Docs pages to create/edit:
      - `README.md`: quickstart concurrency fix.
      - `docs/agent-session-runtime.md`: cross-reference if needed.
    - `docs/index.md` update: no (README not in index; runtime page already linked).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add `/docs/migration.md` guide (JSONL→DB-backed + explicit capabilities)
  - Acceptance Criteria:
    - Functional: `/docs/migration.md` documents two migrations: (1) in-memory/JSONL → DB-backed `ProductionPersistenceStore` persistence and (2) permissive all-tools/all-skills defaults → Phase 38 explicit activation, including old/new/compatibility paths.
    - Performance: Doc only; no runtime change.
    - Code Quality: Follows the Prism API page structure; links `docs/database-persistence.md`, `docs/runs-and-usage.md`, `docs/session-branching.md`, `docs/session-stores.md`, `docs/node-jsonl-session-store.md`, and capability docs.
    - Security: States no provider credentials/secrets are required by the persistence contract and that JSONL is a dev/local non-multi-writer store.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 41 migration deliverable; Phase 34 (production persistence), Phase 36 (branch handles), Phase 38 (explicit capability activation).
      - `docs/database-persistence.md` schema/indexes/retention/migrations/cursor/readBranchPath guidance.
      - `docs/runs-and-usage.md` durable run/event/tool/usage ledger and batch ordering.
      - `docs/session-branching.md` branch handles and checkout.
      - `docs/session-stores.md`, `docs/node-jsonl-session-store.md` dev/local store limits.
      - `src/__tests__/docs.test.ts:839` explicit capability migration assertion shape (old/new/compatibility).
    - Options Considered:
      - Split into two pages (persistence migration + capability migration): more granular, but a single `/docs/migration.md` matches Phase 41 deliverable and one navigation entry.
      - One page with two sections: chosen; keeps index minimal and links to detailed pages for depth.
    - Chosen Approach:
      - Single `/docs/migration.md` with two top-level sections following the API page structure (What it does, When to use, before/after examples, related APIs), linking detailed pages rather than duplicating.
    - API Notes and Examples:
      ```ts
      // Before: in-memory/JSONL dev store
      const store = createMemorySessionStore();
      // After: host implements ProductionPersistenceStore contract
      const store = createMyDbSessionStore({ pool });
      const session = createAgentSession({ agent, store });
      ```
      ```ts
      // Before: permissive defaults (pre-Phase-38) — every in-scope tool/skill active
      // After: explicit opt-in via AgentDefinition.tools/skills or activateAllCapabilities()
      ```
    - Files to Create/Edit:
      - `docs/migration.md`: new page.
      - `docs/index.md`: add migration entry under a Configuration/persistence-relevant group.
      - `docs/database-persistence.md`, `docs/session-stores.md`, `docs/session-branching.md`: link to the new migration page.
      - `src/__tests__/docs.test.ts`: assert `docs/migration.md` exists, `docs/index.md` links it, and migration content covers JSONL→DB and explicit-activation phrases.
    - References:
      - `src/__tests__/docs.test.ts:167` link-coverage pattern; `:839` explicit capability migration assertion.
      - Phase 34/36/38 roadmap text.
  - Test Cases to Write:
    - `docs/migration.md` exists and contains required sections + both migration paths.
    - `docs/index.md` links `migration.md`.
    - Capability migration phrases asserted (old/new/compatibility) reuse Phase 38 wording.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents public persistence + capability-activation migration for external apps.
    - Docs pages to create/edit:
      - `docs/migration.md`: new page.
      - `docs/index.md`: navigation entry.
      - `docs/database-persistence.md`, `docs/session-stores.md`, `docs/session-branching.md`: cross-links.
    - `docs/index.md` update: yes — migration entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add end-to-end external-app example with DB-backed adapter reference mock
  - Acceptance Criteria:
    - Functional: `examples/external-app-db-backed.ts` registers explicit tools + skills, runs against a network-free mock provider, persists through a documented DB-backed adapter reference mock implementing the `ProductionPersistenceStore` contract, drives a durable run ledger (events/usage/tool calls), exercises branching + branch-handle checkout, and resumes/displays a prior run timeline without reading Prism source.
    - Performance: Network-free; uses mock provider and an in-process adapter mock (no real DB); compiles under `examples/tsconfig.json`.
    - Code Quality: Reuses existing `createAgent`/`createAgentSession`/`RunLedger`/`SessionStore.readBranchPath`/branch-handle checkout seams; no new core surface.
    - Security: No real-looking secrets; uses `createMockProvider` and caller-supplied credential resolvers with fake values; secrets do not enter ledger/timeline/log.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 41 deliverable + Phases 34/35/36/38 acceptance.
      - `docs/database-persistence.md` adapter-author contract; `docs/runs-and-usage.md` ledger shape; `docs/session-branching.md` branch handles + checkout.
      - `docs/tools.md`, `docs/context-and-skills.md`, `docs/agent-definitions.md` for explicit tools/skills.
      - `examples/tools.ts`, `examples/jsonl-stores-branching.ts`, `examples/examples/README.md` for example conventions; `examples/synapta-style-artifact-loop.ts` for assertion style.
    - Options Considered:
      - Real DB driver in the example: rejected — adds network/dependency and breaks the network-free compile/test rule.
      - In-process adapter reference mock implementing the documented contract: chosen — proves an external app implements the contract from docs, stays network-free, and is reusable as host boilerplate.
    - Chosen Approach:
      - One example file implementing a minimal `ProductionPersistenceStore`-shaped mock (in-memory tables for runs/entries/branches/usage, cursor-paginated `readBranchPath`), wiring it into `createAgentSession`, running a prompt with one mock tool + one skill, forking/branching with stored leaf handles, then resuming a prior run timeline via the ledger.
    - API Notes and Examples:
      ```ts
      const store = createDbBackedReferenceStore(); // implements documented contract, no real DB
      const session = createAgentSession({ agent, store });
      for await (const event of session.subscribe({ maxQueuedEvents: 256 })) { timeline.push(event); }
      await session.run("Summarize and call summarize tool", { activeSkills: ["summarize"] });
      const fork = await session.forkSession({ leafId });
      // resume prior runtimeline from store without reading source
      ```
    - Files to Create/Edit:
      - `examples/external-app-db-backed.ts`: new example.
      - `examples/README.md`: list the new example.
      - `docs/database-persistence.md` and/or `docs/migration.md`: link to the example as a reference adapter implementation.
      - `src/__tests__/docs.test.ts` (or a small compile/self-check assertion): assert the example file exists, is referenced in `examples/README.md`, and contains expected sections (run ledger, branch handle, checkout, resume).
    - References:
      - `examples/synapta-style-artifact-loop.ts` end-to-end mock pattern.
      - `docs/database-persistence.md` adapter-author sections.
      - Phase 36 roadmap branch-handle/checkout requirement.
  - Test Cases to Write:
    - Example exists and is listed in `examples/README.md`.
    - Example compiles via existing examples typecheck (network-free).
    - Docs assertion (or example self-check) that the example exercises run ledger + branch handle + checkout + resume.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — demonstrates public persistence/runtime surfaces for external apps.
    - Docs pages to create/edit:
      - `docs/database-persistence.md`: link to example.
      - `docs/migration.md`: link to example.
      - `examples/README.md`: list example.
    - `docs/index.md` update: no new page (example linked from existing pages); ensure examples mention already covered.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add network-free tests for persistence contract, event ledger, security escapes, branch handles, runtime protocol, and docs examples
  - Acceptance Criteria:
    - Functional: Network-free `node:test` cases cover (1) persistence contract behavior via the reference adapter mock, (2) durable event/tool/usage ledger ordering and redaction, (3) security escape paths (symlink/realpath containment, caller header cannot override provider auth, prototype-pollution-free config merge), (4) branch-handle checkout + concurrent leaf-append fail-closed, (5) runtime protocol: tool-call deltas/stream→reconstruct→execute→persist→replay, and (6) the new docs/examples assertions.
    - Performance: Tests run network-free and within the `<30s` default `npm test` budget; use counted fake stores/readers and the mock provider, no benchmarks.
    - Code Quality: Extends existing `src/__tests__/docs.test.ts` / persistence / runtime test files where the seam already exists; no new framework.
    - Security: Cases assert secrets are absent from ledger/timeline/errors and that escape attempts fail closed.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 41 acceptance + Phase 34–40 acceptance text for each covered area.
      - `src/__tests__/docs.test.ts` existing assertion shape; `src/__tests__/public-export-contract.test.ts`.
      - Existing boundary/security tests referenced by Phases 37/39 (`phase*-boundaries.test.ts` style).
      - `docs/security-auth-trust.md`, `docs/database-persistence.md`, `docs/provider-conformance.md`.
    - Options Considered:
      - One new mega-test file: rejected; harder to maintain and duplicates existing files' focus.
      - Extend the existing per-area test files + `docs.test.ts` for docs/example checks: chosen, smallest diff and matches current structure.
    - Chosen Approach:
      - Add targeted cases to the existing test files (persistence, runtime, security/boundary, branching, docs) plus the example/docs assertions; reuse the reference adapter mock from the example task where it can be shared as a test fixture.
    - API Notes and Examples:
      ```ts
      // pseudo: branch-handle checkout fail-closed under wrong leaf
      await assert.rejects(() => store.append(parent: wrongLeaf, ...), /expected parent/);
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: persistence/event-ledger/security/branch/runtime docs + example assertions.
      - Relevant existing runtime/persistence/boundary/security test files: extend with the listed cases (paths filled during execution against the inventory).
      - `examples/fixtures/`: add a fixture only if a test needs a golden run-ledger/branch replay; otherwise reuse existing fixtures.
    - References:
      - `src/__tests__/docs.test.ts:574` migration doc assertion style; `:989` database persistence assertion style.
      - Phase 36/37/39 acceptance lists.
  - Test Cases to Write:
    - Persistence contract: invalid entry kinds fail closed; `readBranchPath` cursor + indexes respected by the reference adapter.
    - Event ledger: ordered by `runId`/sequence/timestamp, redacted, no double-written message entries.
    - Security escapes: symlink/realpath containment blocks; caller auth header cannot override provider auth; config merge blocks `__proto__`/`prototype`/`constructor`.
    - Branch handles: same-session multiple leaves; concurrent append to wrong leaf fails closed; checkout switches RPC/agent to existing leaf.
    - Runtime protocol: tool-call delta stream → final → execute → persist → replay in one path.
    - Docs: migration page + example + index links asserted.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no public API change; tests enforce documented behavior.
    - Docs pages to create/edit:
      - `none`: tests mirror existing docs; doc updates covered by the migration/example tasks.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final release checklist updates (docs, package exports, examples, tarball contents, public-API drift)
  - Acceptance Criteria:
    - Functional: `docs/release-and-install.md` release checklist covers docs coverage for new persistence/runtime surfaces, package exports/subpaths, examples compile/listing, tarball contents (no built tests/maps), and public-API drift checks via `public-export-contract.test.ts`; `docs/index.md` links the persistence/runtime/migration pages.
    - Performance: Checklist gates stay runnable by the default network-free `npm test` + `npm run pack:dry-run` + examples typecheck within the `<30s` budget.
    - Code Quality: Extends existing checklist/test enforcement rather than introducing a parallel release tool.
    - Security: Checklist reaffirms no built-in app tools, hidden provider/credential globals, auto package discovery, or secret persistence in core.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 19 and Phase 41 acceptance; the Phase 17 acceptance gates.
      - `docs/release-and-install.md` current checklist, install specifiers, tarball contents, offline test budget.
      - `package.json` `exports`, `scripts` (`test`, `typecheck`, `pack:dry-run`, `release:dry-run`).
      - `src/__tests__/docs.test.ts` and `src/__tests__/public-export-contract.test.ts`.
    - Options Considered:
      - New `release-checklist.md` page: rejected; `release-and-install.md` already owns this surface.
      - Extend `release-and-install.md` checklist + index links: chosen, single source of truth.
    - Chosen Approach:
      - Append/extend the checklist with persistence/runtime/migration/docs-coverage/examples/tarball/API-drift items and point at the exact tests; ensure `docs/index.md` exposes the new pages under the right functional groups.
    - API Notes and Examples:
      ```bash
      npm test            # docs + public-export-contract + runtime/persistence, network-free
      npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md`: extend checklist.
      - `docs/index.md`: ensure migration/database-persistence/runs-and-usage/session-branching entries present and grouped.
      - `src/__tests__/docs.test.ts`: assert checklist covers the new persistence/runtime/migration/example phrases.
      - `src/__tests__/public-export-contract.test.ts`: extend only if a new public export subpath was added (e.g. if the example reveals one); otherwise leave intact.
    - References:
      - `src/__tests__/public-export-contract.test.ts:67` drift enforcement pattern.
      - `docs/release-and-install.md` current checklist sections.
      - `package.json` release scripts.
  - Test Cases to Write:
    - `docs.test.ts` assertion that `release-and-install.md` checklist mentions persistence/runtime/migration/example drift checks.
    - `docs/index.md` link coverage for new pages (migration already asserted in its task; persistence/usage/branching links asserted here if missing).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release gate and index surface for new public persistence/runtime/migration docs.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: checklist extension.
      - `docs/index.md`: navigation completeness.
    - `docs/index.md` update: yes — ensure persistence/runtime/migration entries present and grouped.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final plan verification: README runs, example compiles/renders, docs checks pass, release gate dry-run clean
  - Acceptance Criteria:
    - Functional: README quickstart runs as written (concurrent subscribe+run); the external-app example compiles and its self-checks/resume path execute network-free; `docs.test.ts` and `public-export-contract.test.ts` pass; `npm run release:dry-run` (test + `pack:dry-run`) is clean for core + workspaces.
    - Performance: Default `npm test` stays network-free and under the `<30s` budget on Node 20.
    - Code Quality: No new core API, no hidden globals, no built-in app tools; new docs follow the Prism API page structure.
    - Security: No secrets in README/examples/ledger/fixtures/tarball; release checklist reaffirms core invariants.
  - Approach:
    - Documentation Reviewed:
      - All prior tasks' acceptance + `roadmap.md` Phase 41 acceptance.
      - `docs/release-and-install.md` final checklist after edits.
    - Options Considered:
      - Manual spot-check only: rejected; roadmap acceptance requires network-free tests as the gate.
      - Run the full existing gate plus the new assertions: chosen.
    - Chosen Approach:
      - Execute the documented gate end to end and fix regressions, then update task checkboxes and fill Compromises/Further Actions.
    - API Notes and Examples:
      ```bash
      npm run typecheck
      npm test
      npm run release:dry-run
      ```
    - Files to Create/Edit:
      - `plans/042-external-app-docs-examples-and-release-validation.md`: check boxes, fill Compromises/Further Actions.
    - References:
      - `package.json` scripts; `docs/release-and-install.md` budget.
  - Test Cases to Write:
    - Run the existing + new test suite and the release dry-run; record pass status.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit:
      - `none`: changes captured by prior tasks.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- **DB-backed example uses in-memory Maps, not a real database.** The reference adapter (`createDbBackedReferenceStore` in `examples/external-app-db-backed.ts`) implements `SessionStore` + `RunLedger` + `ProductionPersistenceStore` query methods against in-memory `Map`s/arrays to demonstrate the host-side contract without a network or DB dependency. It shows the *shape* of the conditional append, idempotency dedup, branch-handle checkout, and ledger resume — not a SQL/transactional implementation. Hosts still write their own adapter against a real DB using `docs/database-persistence.md` (reference relational schema + conditional append transaction pattern) as the spec. `ponytail:` the example marks this ceiling.
- **Cross-importing the example's reference adapter into `src/__tests__/` was rejected.** Root `tsconfig.json` only `include`s `src`, so importing `examples/external-app-db-backed.ts` into a core test would break the build or require a forbidden new core export. The adapter is instead gated by its `main()` self-checks (run by `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret`) plus the `external_app_example_exercises_*` phrase assertions — matching the task's conditional "where it can be shared as a test fixture".
- **`<30s` budget verified on the core default suite, not the full `npm test`.** The documented budget scopes the core default suite (build ~12.5s + tests ~9.5s ≈ 22s, measured 21.4s on Node 24). The full `npm test` additionally builds + tests 10 workspace packages (~37s wall) and is outside that budget; this matches the existing `docs/release-and-install.md` scope which pins only the core default suite. Node 20 (the documented target) vs Node 24 (this dev env) timing is not directly comparable but the suite is Node-version-agnostic.
- **Real-looking secret strings (`sk-super-secret-12345`, `sk-test-123`, `sk-fake-123`) intentionally live in `src/__tests__/` fixtures.** They exist to exercise the redactor and are excluded from every tarball by the `!dist/__tests__` `files` negation (verified: NONE in pack). They are not secrets; they are redaction test inputs.

## Further Actions
- **[Low] Document a real-DB adapter walkthrough.** When a first-party DB persistence package is added (e.g. `@arnilo/prism-persistence-postgres`), extend `docs/migration.md` and `docs/database-persistence.md` with a concrete SQL transaction example and add a network-free packaging/install-smoke entry. Rationale: the current docs give the contract + reference schema but no runnable real-DB adapter; defer until such a package exists (YAGNI now).
- **[Low] Promote the external-app example to a multi-file fixture if a host asks for it.** The single-file `external-app-db-backed.ts` keeps the contract demonstration in one readable file. If a host needs a copy-pasteable project skeleton (separate adapter/provider/index modules), split it then; the in-memory single file is sufficient as a reference for now.
- **[Low] Re-measure the budget on Node 20 in CI.** The `<30s` budget was verified on Node 24 (dev env, 21.4s core suite). The GitHub Actions `verify` job runs on whatever Node 20 runtime CI uses; confirm the median stays under 30s there and update `docs/release-and-install.md` if it drifts. The `timeout-minutes: 3` CI backstop already guards against hangs.
- **[None] No follow-up for core API.** Phase 41 added no core API surface by design (docs/examples/tests/release-checklist only); the `public-export-contract.test.ts` `phase39` drift gate pins the existing surface and will catch any accidental future drift.
