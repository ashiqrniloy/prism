# Release 0.0.19 — Complete observational memory lifecycle and source-faithful retrieval

Roadmap phase: Phase 2 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.18** (Phase 1 exit gate passed 2026-07-30).
Target: `@arnilo/prism` **0.0.19**.

## Objectives

- Upgrade `@arnilo/prism-compaction-observational-memory` from manually coordinated primitives into one explicitly activated session-memory composition.
- Match Mastra’s useful four-part floor: recent exact messages, incremental observation log, reflections over that log, bounded retrieval of exact raw sources behind compressed memory.
- Close every confirmed observational-memory correctness, coverage, lifecycle, configuration, branch-isolation, genericity, and resource-bound gap without a second session store or deleting raw history.

## Expected Outcome

- Host calls one activation/`attach` path; completed turns drive observation; configured token pressure drives reflection and compaction—no separate `flush()` + `session.compact()` choreography required for the happy path.
- Observation covers only eligible unobserved user/assistant/tool messages; memory/compaction/bookkeeping entries advance scan coverage without re-entering the observer.
- Successful empty observer/reflector passes advance durable coverage; restart/duplicate delivery does not re-observe or duplicate logical records.
- Provider context shows bounded exact recent messages (original role/tool order) plus active observation/reflection projection; older raw entries remain in the session store.
- Reflection recall after drops still returns supporting observations and raw sources with dropped/missing status; exact-id recall plus current-branch cursor paging exist.
- Observer and reflector may use separate providers/models/instructions/credentials; every public setting has an observable effect or is removed; `fullFold` cannot merely relabel an oversized payload.
- Import/extension setup stay inert until explicit attach/activation; workers cannot take arbitrary tools/credentials; secrets redacted at worker/persist/tool boundaries.

## Tasks

- [x] Task 0 — Primitive review and freeze public API deltas for Phase 2
  - Acceptance Criteria:
    - Functional: inventory states whether existing middleware (`session_start`/`session_shutdown`/`compaction`/`input_assembly`/`context`), `AgentSession.append` + `expectedParentId`, compaction strategy registry, `ContextProvider`, and tools can meet post-run observation + token compaction without new core hooks.
    - Functional: written freeze lists exact public deltas: composition export name/shape, settings split (observation/reflection/context/retrieval), legacy single-worker mapping, recall tool paging surface, any core middleware/hook addition (only if package-only composition fails ordering/ownership), retained low-level `flush()` primitive.
    - Performance: no import-time workers/timers; no second memory database; no background idle/provider-change schedulers in 0.0.19 unless freeze proves same durable coverage/CAS (default: synchronous thresholds only).
    - Code Quality: review cites file:line evidence; rejects parallel store, deleting compacted messages, Mastra resource-scope/semantic search, and speculative core contribution types.
    - Security: freeze requires current-branch/ownership checks on all source loads; model-supplied ids allow-listed; workers tool-scoped to memory record tools only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 Chosen Approach + Observational memory gaps.
      - Package: `runtime.ts:71-211` (manual flush; empty observer does not append coverage; `newEntries` includes all kinds after coverage id), `settings.ts` (`compactAfterTokens` unused), `recall.ts:36-37` (active-only reflection support), `workers/observer.ts:50` (coding-specific system prompt), `strategy.ts` (`fullFold` flag without hard reduction), `extension.ts` (inert register only), `projection.ts`/`render.ts`/`tool.ts`.
      - Core: `src/middleware.ts:4-14` (no run-complete hook), `src/agents.ts:503` + `:1262-1316` (`thresholdEntries` auto-compact only), `src/agents.ts:1318-1325` (append + `expectedParentId`), `src/contributions.ts` (compactionStrategies/contextProviders/tools), `src/session-stores.ts` tip/parent notes.
      - Docs: `docs/compaction-observational-memory.md`, `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/session-stores-and-branching.md`, `docs/middleware-hooks.md`.
      - Mastra OM guide + API (fetched 2026-07-30): four-part model; `observation.messageTokens` default 30k; `reflection.observationTokens` default 40k; separate `observation.model`/`reflection.model`; `retrieval` for raw-source pointers; thread-scoped default; resource/vector deferred. Sources: <https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/docs/memory/observational-memory.mdx>, <https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/reference/memory/observational-memory.mdx>.
    - Options Considered:
      - Keep manual `flush()`+`compact()` as only path: reject as default composition (retain as advanced primitive).
      - Start workers from extension `setup`: reject (explicit-activation).
      - Parallel memory DB / delete compacted raw entries: reject.
      - Clone Mastra resource-scope + semantic vector recall in 0.0.19: defer (roadmap non-goal).
      - Prefer package `attach`/session wrapper + existing context provider/tool/strategy; add one generic core lifecycle hook only if review proves package cannot observe completed turns safely: **package-only chosen; no core hook**.
      - Rely on `session_start`/`session_shutdown` middleware for post-run work: reject (hooks defined but never invoked by core).
      - Delete compacted raw messages from the session store: reject (raw entries remain listable; only provider context omits them).
    - Chosen Approach (executed freeze):
      - Treat current-branch session messages as immutable source of truth; OM records + standard compaction entries only.
      - Two durable cursors: raw-source observation coverage + observation-log reflection coverage; empty success advances coverage.
      - Provider view = active reflections/observations + configurable exact recent-message suffix via `ContextProvider` from attach.
      - Post-run observation + token-threshold compaction via package session proxy on `run`/`prompt`/`stream`/`compact`; durable resume covered by `wrapResumeRun` / `wrapResumeStream` helpers (no core `run_finished` hook).
      - Synchronous token thresholds only in 0.0.19; no idle/provider-change schedulers.
      - Exact-id recall + current-branch paging; no cross-thread semantic search.
    - API Notes and Examples:
      ```ts
      import { createObservationalMemory } from "@arnilo/prism-compaction-observational-memory";

      const om = createObservationalMemory({
        observation: { provider: observerProvider, model: observerModel, messageTokens: 10_000 },
        reflection: { provider: reflectorProvider, model: reflectorModel, observationTokens: 20_000 },
        context: { recentMessages: 8, compactAfterTokens: 81_000 },
        retrieval: { pageLimit: 20 },
      });

      const attached = om.attach(baseSession, {
        appendEntry: boundAppend, // required: session-owned store callback (existing runtime contract)
        sessionModel: agent.config.model,
      });

      // Host wires returned helpers (attach does not mutate Agent config silently):
      const agent = createAgent({
        context: [attached.contextProvider],
        compaction: { strategy: attached.compactionStrategy, ...tokenThresholdFrom(attached.settings) },
      });

      await attached.session.run("Continue"); // post-run observe + due reflect/drop + compact

      // Durable resume path:
      await om.wrapResumeRun(resumeAgentRun)(agent, ref, resume, options);

      // Advanced / tests:
      await attached.runtime.flush();
      ```
    - Files to Create/Edit:
      - `plans/002-Release-0-0-19-Observational-Memory.md`: freeze table (this task).
      - No production code in Task 0.
    - References:
      - Roadmap Phase 2 files list + API sketch.
      - Existing example: `examples/observational-memory-recall-status-view.ts`.
  - Primitive inventory (file:line evidence):

    | Primitive | Post-run observe + token compact? | Evidence |
    | --- | --- | --- |
    | `session_start` / `session_shutdown` middleware | **No** — never invoked | `src/middleware.ts:13-14`; zero `middleware.run("session_*")` call sites under `src/` |
    | `compaction` middleware | **Partial** — transform compaction result only, not post-run observe | `src/agents.ts:1296` (after strategy, before append) |
    | `input_assembly` / `context` middleware | **Yes** — provider input injection | `src/input.ts:127,207,217` |
    | `ContextProvider` | **Yes** — memory + recent-message suffix each turn | `src/contracts.ts:923-926`; `src/agents.ts:508-512` |
    | `CompactionStrategy` registry | **Yes** — render folded memory; attach supplies strategy | `packages/.../strategy.ts:24-70`; `src/extensions.ts:168` |
    | `AgentSession` append + `expectedParentId` | **Yes** — OM custom entries with tip CAS | `src/agents.ts:1318-1325`; `src/session-stores.ts:218-223` |
    | `thresholdEntries` auto-compact | **Partial** — entry count before run, not OM token budget | `src/agents.ts:1262-1267` (`compactAfterTokens` unused in package `settings.ts:22`) |
    | `agent_finished` event | **Yes** — attach proxy can await run completion | `src/agents.ts:722`; `src/contracts.ts:707` |
    | `createObservationalMemoryRuntime().flush` | **Yes** — retained low-level primitive | `packages/.../runtime.ts:80-211` |
    | `InstructionInjector` | **Yes** — alternative to ContextProvider for memory block | `src/contracts.ts:965-968` |
    | `resumeAgentRun` / `resumeAgentRunStream` | **Needs wrapper** — creates fresh `RuntimeAgentSession` | `src/agents.ts:105-139,178` (not the same object as pre-suspend attach) |
    | Extension `setup` | **Inert only** — registers strategy/tool/commands, no workers | `packages/.../extension.ts:14-22` |
    | Recall tool + `getEntries` | **Yes** — extend schema; host supplies current-branch entries | `packages/.../tool.ts:13-31` |
    | Worker tool surface | **Yes** — memory record tools only, allow-listed source ids | `packages/.../workers/observer.ts:22-44` |

    **Verdict:** package-only composition is sufficient. **No new core middleware hook in 0.0.19.** Attach proxy + resume wrappers cover ordering/ownership; `appendEntry` + `expectedParentId` + `runtime.ts:225-237` checkout guard cover branch safety.

  - Freeze table (public deltas only):

    | Surface | Before 0.0.18 | After 0.0.19 | Breaking? |
    | --- | --- | --- | --- |
    | Host happy path | manual `flush` + `compact` | `createObservationalMemory()` + `attach()`; post-run observe/compact coordinated | additive; docs migrate hosts |
    | Composition exports | `createObservationalMemoryRuntime`, extension, strategy, recall | **add** `createObservationalMemory`, `AttachedObservationalMemorySession`, `wrapResumeRun`, `wrapResumeStream` | additive |
    | `createObservationalMemoryRuntime().flush` | required choreography | retained on `attached.runtime` and standalone | no |
    | Settings shape | flat `ObservationalMemorySettings` (`observeAfterTokens`, `reflectAfterTokens`, `compactAfterTokens` unused, single `workerModel`) | nested `observation` / `reflection` / `context` / `retrieval` (+ optional `dropper`); every key effective or removed | yes (pre-1.0) |
    | Settings key map | — | `observeAfterTokens` → `observation.messageTokens`; `reflectAfterTokens` → `reflection.observationTokens`; `compactAfterTokens` → `context.compactAfterTokens`; `keepRecentEntries` → `context.recentMessages`; flat `workerModel` maps to both workers when nested models absent; **throw** if flat and nested models conflict | yes (pre-1.0) |
    | Settings defaults | 10k / 20k / 81k / pool 20k→10k | unchanged numeric defaults; nested names only | no (values) |
    | Observer prompt | coding-specific default (`workers/observer.ts:50`) | domain-neutral base + optional `observation.instruction` | behavior |
    | Reflection recall | active observations only (`recall.ts:36-37`) | full ledger lookup + `dropped` / `missingSourceEntryIds` on supports | fix |
    | Recall tool schema | `{ id: string }` only | `{ id }` **or** `{ cursor, limit?, direction?: "forward" \| "backward" }`; `pageLimit` default 20, hard cap frozen in `limits.ts` | additive |
    | Recall pure API | `recallObservationalMemory(entries, id)` | **add** `recallObservationalMemoryBranchPage(entries, request)` (name frozen) | additive |
    | Coverage on empty observe | no coverage append (`runtime.ts:148-155`) | append `om.observations.recorded` with `observations: []` + `coversUpToId` | behavior fix |
    | Eligible observer input | all entries after coverage id (`runtime.ts:131`) | eligible `message` roles only; bookkeeping/compaction/custom OM still advance scan | behavior fix |
    | `fullFold` compaction | flag only, no hard reduction (`strategy.ts:43-63`) | enforce bounded fold or typed failure before provider input | behavior fix |
    | Core hooks | none | **none** — package attach + resume wrappers | n/a |
    | Core contribution types | unchanged | unchanged | no |
    | New packages | — | none | n/a |
    | Import/setup side effects | inert extension | unchanged: no workers/timers until `attach`/`flush` | no |
    | Schedulers | — | **deferred**: no idle/provider-change activation in 0.0.19 | n/a |
    | Mastra parity deferred | — | resource-scope, vector/semantic recall, extractors, async buffer activation | n/a |

  - Frozen type sketch (implementation names; export from package `index.ts` in Tasks 2–5):

    ```ts
    export interface CreateObservationalMemoryOptions {
      readonly observation?: ObservationalMemoryObservationConfig;
      readonly reflection?: ObservationalMemoryReflectionConfig;
      readonly dropper?: ObservationalMemoryDropperConfig;
      readonly context?: ObservationalMemoryContextConfig;
      readonly retrieval?: ObservationalMemoryRetrievalConfig;
      readonly settings?: SettingsProvider;
      readonly secrets?: readonly (string | undefined)[];
    }

    export interface ObservationalMemoryObservationConfig {
      readonly provider: AIProvider;
      readonly model?: ModelConfig;
      readonly messageTokens?: number;
      readonly instruction?: string;
      readonly thinkingLevel?: string;
      readonly providerOptions?: ProviderRequestOptions;
    }

    export interface ObservationalMemoryReflectionConfig {
      readonly provider: AIProvider;
      readonly model?: ModelConfig;
      readonly observationTokens?: number;
      readonly instruction?: string;
      readonly thinkingLevel?: string;
      readonly providerOptions?: ProviderRequestOptions;
    }

    export interface ObservationalMemoryContextConfig {
      readonly recentMessages?: number;
      readonly compactAfterTokens?: number;
      readonly observationsPoolMaxTokens?: number;
      readonly observationsPoolTargetTokens?: number;
    }

    export interface ObservationalMemoryRetrievalConfig {
      readonly pageLimit?: number; // default 20; hard cap in limits.ts
    }

    export interface ObservationalMemoryAttachOptions {
      readonly appendEntry: (entry: SessionEntry) => Promise<void>;
      readonly sessionModel?: ModelConfig;
      readonly credential?: CredentialValueSource;
      readonly credentialRequest?: CredentialRequest;
      readonly requireExplicitModel?: boolean;
      readonly signal?: AbortSignal;
    }

    export interface AttachedObservationalMemorySession {
      readonly session: AgentSession;
      readonly runtime: ObservationalMemoryRuntime;
      readonly contextProvider: ContextProvider;
      readonly compactionStrategy: CompactionStrategy;
      readonly settings: ObservationalMemorySettings; // resolved nested shape
    }

    export interface ObservationalMemory {
      attach(session: AgentSession, options: ObservationalMemoryAttachOptions): AttachedObservationalMemorySession;
      wrapResumeRun(
        resume: typeof resumeAgentRun,
      ): typeof resumeAgentRun;
      wrapResumeStream(
        resumeStream: typeof resumeAgentRunStream,
      ): typeof resumeAgentRunStream;
    }

    export function createObservationalMemory(options: CreateObservationalMemoryOptions): ObservationalMemory;
    ```

  - Rejected abstractions: second session store, OM-owned tip-CAS fork of store, deleting compacted raw entries, Mastra extractors/working-memory managers, idle timer service, resource-scope vector index, core `run_finished` middleware hook (attach + resume wrappers suffice), invoking `session_start`/`session_shutdown` (no core call sites today).
  - Test Cases to Write (for later tasks; none run in Task 0):
    - Listed under Tasks 1–6; freeze must not invent surfaces without matching tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (freeze only; docs land with implementation tasks).
    - Docs pages to create/edit:
      - none in Task 0; freeze feeds Tasks 1–6 docs.
    - `docs/index.md` update: no in Task 0.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 1 — Eligible sources, dual coverage, empty-pass advancement, reflection coverage
  - **Completion evidence (2026-07-30):** `coverage-helpers.ts` + `runtime.ts` dual-cursor logic; empty observe/reflect coverage append; `flush({ fullReflectionRebuild })`; exports + docs; 55/55 package tests green (`coverage.test.ts`, `runtime-coverage.test.ts`).
  - Acceptance Criteria:
    - Functional: observer input includes only eligible unobserved `message` entries (user/assistant/tool roles as defined in freeze); OM custom types, compaction, summary, and unrelated bookkeeping are excluded from worker input while scan coverage still advances past them.
    - Functional: successful observer pass with zero facts appends coverage (or equivalent durable marker) through last scanned id; restart/duplicate flush does not re-feed covered range or duplicate logical observation ids.
    - Functional: reflector processes only observations newer than durable reflection coverage unless explicit full rebuild; repeated flush with no new observations makes no reflector provider call.
    - Functional: drop coverage remains recorded; dropping does not erase ledger observations used for recall.
    - Performance: source selection + ledger fold remain O(branch entries); no full-store scan beyond current branch entries already loaded.
    - Code Quality: eligibility/coverage helpers unit-testable without provider; no agent-loop duplication.
    - Security: model-supplied `sourceEntryIds` remain allow-listed to eligible ids in the current batch.
  - Approach:
    - Documentation Reviewed:
      - `runtime.ts:128-156` coverage slice; `ledger.ts:22-62` coverage fields; Mastra observer/reflector coverage semantics (guide).
      - `docs/compaction-observational-memory.md` custom entry types table.
    - Options Considered:
      - Advance coverage only when observations.length > 0: current bug; reject.
      - Feed all entry kinds to observer and hope prompt ignores them: reject (recursive self-observation).
      - Separate eligible filter + always-append coverage on success (including empty): chosen.
    - Chosen Approach:
      - Add pure helpers for eligible message selection and coverage advance markers.
      - Observer/reflector success paths append `coversUpToId` even when arrays empty.
      - Reflector input = active observations after `latestReflectionCoverageId` (rebuild flag bypasses).
    - API Notes and Examples:
      ```ts
      // After successful empty observe:
      // entries include om.observations.recorded { observations: [], coversUpToId: lastScannedId }
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/coverage-helpers.ts`, `runtime.ts`, `ledger.ts`, `types.ts` (if coverage payload shape changes), workers if needed.
      - `packages/compaction-observational-memory/src/__tests__/coverage.test.ts`, `runtime-coverage.test.ts`, `runtime.test.ts`, `ledger.test.ts`.
    - References:
      - Roadmap gaps: recursive self-observation; empty pass; unused reflection coverage.
  - Test Cases to Write:
    - Observer sees only eligible messages after OM/compaction entries; bookkeeping skipped in prompt.
    - Zero-observation success advances `latestObservationCoverageId`; second flush skips worker.
    - Reflection coverage: second flush with no new observations → zero reflector calls; new observations → reflector once.
    - Explicit full rebuild reflects entire active pool deterministically.
    - Duplicate/idempotent append does not create duplicate logical observation content ids for same sources.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (coverage semantics).
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: coverage/eligibility rules.
    - `docs/index.md` update: no until composition ships (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Explicit attach/lifecycle composition and run-safe append/compaction
  - **Completion evidence (2026-07-30):** `compose.ts` ships `createObservationalMemory`, `attach`, `wrapResumeRun`, `wrapResumeStream`; proxied session runs post-turn `flush` + `compactAfterTokens` compact; `run_active` guard + `expectedParentId` append; `attach.test.ts` + 61/61 package tests green.
  - Acceptance Criteria:
    - Functional: one host activation connects completed agent turns to observation and connects `compactAfterTokens` (or freeze-named equivalent) to reflection/compaction; happy path needs no manual `flush`+`compact`.
    - Functional: `flush()` remains available for advanced hosts; extension `setup` still starts no workers/timers/providers.
    - Functional: lifecycle work cannot append/checkout concurrently with an active conflicting run; appends use session-owned parent/`expectedParentId`, abortable, safe across checkout/fork/clone/restart/duplicate invocation.
    - Functional: import of package and extension registration alone cause zero provider calls.
    - Performance: at most one in-flight OM job per attached session (existing `inFlight` or stronger); soft/default + hard caps on concurrent jobs remain enforced.
    - Code Quality: orchestration lives in package composition; core gains a generic hook only per Task 0 freeze.
    - Security: attach cannot escalate credentials; workers use host-selected credential policies only.
  - Approach:
    - Documentation Reviewed:
      - `extension.ts`, `runtime.ts` inFlight guard, `agents.ts` append/compact, middleware hooks list, Task 0 freeze.
      - Mastra: end-of-turn observation activation (sync threshold path only for 0.0.19).
    - Options Considered:
      - Wrap `session.run` / return proxied session from `attach`: likely sufficient if freeze agrees.
      - Add `run_finished` middleware hook in core: only if wrap cannot see completions for all run entrypoints (`run`/`resume`/stream).
      - Timer-based idle activation: defer unless freeze requires.
    - Chosen Approach:
      - Implement frozen attach composition (`createObservationalMemory` + `attach` + `wrapResumeRun`/`wrapResumeStream`); wire post-run observe + due reflect/drop + `context.compactAfterTokens` compact via returned `compactionStrategy`.
      - Guard: skip or queue OM append while run owns tip; never checkout to unowned append.
    - API Notes and Examples:
      ```ts
      const session = observationalMemory.attach(agent.createSession({ id: "s1" }));
      await session.run("…"); // observe/compact coordinated
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/compose.ts` + exports in `index.ts`.
      - `packages/compaction-observational-memory/src/runtime.ts` (`run_active`, `expectedParentId` append).
      - `packages/compaction-observational-memory/src/__tests__/attach.test.ts`.
    - References:
      - Roadmap: no concurrent append during active run; inert import/setup.
  - Test Cases to Write:
    - Attach + completed turn → observation without manual flush.
    - Token pressure → reflection/compaction without manual compact.
    - Unattached/passive/extension-only → zero provider calls.
    - Concurrent run vs flush/checkout/fork/clone + failed CAS → one valid branch; no unowned checkout.
    - Abort mid-OM job fails closed; session usable afterward.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (activation surface).
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`, `docs/agent-session-runtime.md`, `docs/agent-events.md` if events emitted.
    - `docs/index.md` update: defer to Task 6 nav rewrite.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Recent exact-message window + memory projection in provider context
  - **Completion evidence (2026-07-30):** `recent-messages.ts` + `buildObservationalMemoryContextBlocks`; `keepRecentEntries` / `recentMessageMaxTokens` settings; context provider + compaction strategy share `selectRecentMessageEntryIds`; `recent-messages.test.ts` + 67/67 package tests green.
  - Acceptance Criteria:
    - Functional: provider context includes bounded exact recent-message window in original role/tool-call/tool-result order plus active observation/reflection projection.
    - Functional: older raw entries remain listable in session storage; omitted only from normal provider context.
    - Functional: recent window honors configured count and/or token limits via one documented token-counting seam with deterministic fallback.
    - Performance: building projection is O(branch entries) with hard caps on rendered projection bytes/tokens.
    - Code Quality: reuse `buildObservationalMemoryProjection` / `renderObservationalMemory` / `ContextProvider` rather than a second prompt assembler.
    - Security: secrets redacted in rendered memory and recent-message serialization before provider input.
  - Approach:
    - Documentation Reviewed:
      - `projection.ts`, `render.ts`, `strategy.ts` `keepRecentEntries`, `docs/context-and-skills.md`, Mastra recent-history suffix behavior.
    - Options Considered:
      - Only rely on compaction `keepRecentEntries` without per-turn projection: incomplete for pre-compact turns; reject alone.
      - ContextProvider (or attach-injected instructions) supplying memory + recent suffix each turn: chosen.
    - Chosen Approach:
      - Ship context contribution that renders reflections/observations then exact recent messages; align compact strategy keep window with same settings.
    - API Notes and Examples:
      ```ts
      context: { recentMessages: 8, compactAfterTokens: 81_000 }
      // Provider sees: rendered OM block + last N eligible messages in order
      ```
    - Files to Create/Edit:
      - `projection.ts` / `render.ts` / new context helper; `strategy.ts` alignment; tests.
      - Possibly `serialize.ts` for message-window formatting.
    - References:
      - Roadmap functional criteria for recent exact messages.
  - Test Cases to Write:
    - Ordering preserved for user/assistant/tool-call/tool-result.
    - Count/token limits truncate oldest of the window first (or freeze-documented policy); raw store still lists older entries.
    - Multimodal/metadata selection matches freeze (placeholders vs drop).
    - Redaction applies to memory + recent window.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (provider context shape).
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md` four-layer context section; `docs/context-and-skills.md` cross-link if needed.
    - `docs/index.md` update: Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Source-faithful recall and bounded current-branch raw paging
  - **Completion evidence (2026-07-30):** reflection recall uses full ledger + dropped/missing support metadata; `recallObservationalMemoryBranchPage` + extended recall tool (`cursor`/`limit`/`direction`/`detail`); `resolveRecallPageLimit` hard cap 100; recall/tool tests + 72/72 package tests green.
  - Acceptance Criteria:
    - Functional: recalling a reflection after supporting observations are dropped still returns those observations and available raw sources with dropped/missing status (no fabrication).
    - Functional: exact observation/reflection id lookup remains; add bounded current-branch raw-message paging around a source cursor with optional full-detail part selection.
    - Functional: unknown id, sibling branch, wrong session/tenant, malformed cursor, oversized page fail closed.
    - Performance: page limit soft default + immutable hard cap; O(page) serialization after O(branch) index.
    - Code Quality: recall pure functions stay separately testable; tool is thin host-entries wrapper.
    - Security: `getEntries` must be session-owned current branch; tool ignores model-supplied session ids that disagree with `context.sessionId` policy in freeze.
  - Approach:
    - Documentation Reviewed:
      - `recall.ts:36-37` bug; `tool.ts`; Mastra `retrieval` option (thread-scoped paging only this phase).
    - Options Considered:
      - Active-only support map: current bug; reject.
      - Full ledger lookup + explicit dropped flags + paging API: chosen.
      - Vector/semantic retrieval: defer.
    - Chosen Approach:
      - Fix reflection support resolution via full observation map + dropped set.
      - Extend recall tool schema for page mode (`cursor`, `limit`, `direction`, optional part detail) behind `retrieval` settings.
    - API Notes and Examples:
      ```ts
      // exact
      await recall.execute({ id: "aaaaaaaaaaaa" }, ctx);
      // page (shape per freeze)
      await recall.execute({ cursor: entryId, limit: 20, direction: "backward" }, ctx);
      ```
    - Files to Create/Edit:
      - `recall.ts`, `tool.ts`, `serialize.ts`, types/exports, `recall.test.ts`, `tool.test.ts`.
    - References:
      - Roadmap: dropped observations remain recoverable; fail closed cross-branch.
  - Test Cases to Write:
    - Reflection recall after all supports dropped → supports + sources + dropped status.
    - Missing/pruned raw ids reported; no invented content.
    - Forward/backward paging bounds; sibling branch / wrong session / bad cursor fail closed.
    - Oversized page rejected by hard cap.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (recall tool).
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md` retrieval section + API tables.
    - `docs/index.md` update: Task 6 (Raw-source retrieval bullet).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Split workers, domain-neutral prompts, effective settings, hard resource bounds
  - Acceptance Criteria:
    - Functional: observer and reflector may use separate host-selected providers/models/instructions/thinking/model settings/token thresholds/credential policies; dropper separately configurable or explicit non-model pool policy; legacy single-worker config has documented compatibility mapping or migration error.
    - Functional: every public setting has observable effect or is removed—including `compactAfterTokens` consuming path from Task 2.
    - Functional: exceeding memory limits forces bounded synchronous reduction or typed failure before provider input; `fullFold` cannot merely relabel oversized payload; compaction never emits unbounded summary.
    - Functional: default observer instructions domain-neutral and host-customizable.
    - Performance: soft/default + immutable hard caps on worker I/O, rendered projection, folded payload, recent window, source page, tool result, turn count, concurrent jobs.
    - Code Quality: workers remain separately testable; token seam shared (`tokens.ts` or freeze-named).
    - Security: workers cannot activate arbitrary tools/credentials; secrets redacted before worker/provider/persistence/tool output.
  - Approach:
    - Documentation Reviewed:
      - `settings.ts`, `limits.ts`, `tokens.ts`, `workers/*`, `strategy.ts` fullFold, Mastra observation/reflection nested config.
      - `docs/use-case-model-selection.md` / `resolveUseCaseModel`.
    - Options Considered:
      - Keep one worker forever: fails acceptance; reject.
      - Nested settings + legacy map/error + hard caps on fold/render: chosen.
    - Chosen Approach:
      - Reshape settings; wire separate `runObserver`/`runReflector`/`runDropper` option bags; neutralize observer system string; enforce fold/render caps with typed errors.
    - API Notes and Examples:
      ```ts
      observation: { model, provider, instruction?, messageTokens },
      reflection: { model, provider, instruction?, observationTokens },
      // legacy: workerModel alone → map both or throw (freeze picks one)
      ```
    - Files to Create/Edit:
      - `settings.ts`, `runtime.ts`, `limits.ts`, `strategy.ts`, `workers/observer.ts`, `reflector.ts`, `dropper.ts`, settings/runtime/strategy/workers tests.
    - References:
      - Roadmap: separate models; every setting effective; hard caps.
  - Test Cases to Write:
    - Separate observer/reflector routing; legacy mapping or error cases.
    - Threshold edges below/at/above observe/reflect/compact/pool/hard-block using configured counter + fallback.
    - Oversized active pool / no-op reflector / huge tool result / repeated compaction stay within caps.
    - Missing credentials/timeout/abort/overflow → bounded redacted errors.
    - Default observer prompt has no coding-only wording; custom instruction appended.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (settings/workers).
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`, package README/CHANGELOG, `docs/migration.md` (with Task 6).
    - `docs/index.md` update: Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Docs, packed example, migration, version 0.0.19
  - **Completion evidence (2026-07-30):** four-layer docs + index/migration/release/readiness updates; `examples/observational-memory-lifecycle.ts`; workspace version **0.0.19** (manifests, lockfile, `src/index.ts`, changelogs); docs tripwire `phase2_observational_memory_docs_cover_four_layers_migration_and_lifecycle_example`.
  - Acceptance Criteria:
    - Functional: docs describe four layers (recent exact messages, observation log, reflections, raw-source retrieval), attach activation, coverage rules, retrieval fail-closed behavior, and legacy settings migration.
    - Functional: one complete packed public example demonstrates attach → turn → memory → recall/page.
    - Functional: workspace versions, `src/index.ts` version, changelogs, manifests, lockfile agree on **0.0.19**.
    - Performance: example stays within frozen worker/prompt budgets in CI dry sense (no live provider required for pack).
    - Code Quality: API pages follow prism-wiki required sections.
    - Security: docs state secrets redaction, branch isolation, no import side effects.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`, current `docs/compaction-observational-memory.md`, `docs/index.md` Compaction/session memory group, `docs/migration.md` 0.0.18 section, `examples/observational-memory-recall-status-view.ts`.
    - Options Considered:
      - Docs-only without version bump: reject (phase is a release).
      - Coordinated 0.0.19 bump after code tasks: chosen.
    - Chosen Approach:
      - Rewrite OM docs to four-layer model; update index bullets; migration 0.0.18→0.0.19; extend or replace example; bump release metadata.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs check --version 0.0.19
      ```
    - Files to Create/Edit:
      - `docs/compaction-observational-memory.md`, `docs/compaction-and-retry.md`, `docs/agent-session-runtime.md`, `docs/agent-events.md` (if needed), `docs/migration.md`, `docs/index.md`, `docs/0.1.0-readiness.md` current line, package README/CHANGELOG, root CHANGELOG, manifests/lockfile/`src/index.ts`.
      - `examples/observational-memory-*.ts` (+ fixtures if needed).
    - References:
      - Roadmap Documentation/Wiki Assessment for Phase 2.
  - Test Cases to Write:
    - Docs tripwires for four-layer index text + migration heading.
    - Example packs/imports under existing example gate if present.
    - `node scripts/release.mjs check --version 0.0.19`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release documentation.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — Compaction/session memory entry must list Recent exact messages, Observation log, Reflections, Raw-source retrieval.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Phase 2 exit gate verification
  - Acceptance Criteria:
    - Functional: primitive review accepted (Task 0 freeze filled); package unit/integration tests green; core lifecycle/compaction regressions green if touched; branch/ownership/adversarial/resource tests from Tasks 1–5 pass.
    - Functional: protected live canary verifies one real observer model and one separately configured reflector when credentials present; absence is blocked protected gate, not unexplained skip (`PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` or freeze-named env).
    - Functional: `npm run sdk:ready`, package budget, docs links, declarations, changelog/migration, release check for 0.0.19 pass with no unexplained OM skip.
    - Performance: hard-cap tests pass; no unbounded fold/summary regressions.
    - Code Quality: roadmap Phase 2 checkbox updated with completion evidence only after this gate (when releasing).
    - Security: redaction/ownership/adversarial tests pass; audit policy clean for this release line.
  - Approach:
    - Documentation Reviewed:
      - Roadmap Phase 2 Exit Gate; Release Validation Checklist; `packages/compaction-observational-memory/src/__tests__/live.test.ts` (currently empty placeholder).
    - Options Considered:
      - Ship with empty live placeholder: reject.
      - Full listed gate including live canary or explicit blocked-without-creds policy: chosen.
    - Chosen Approach:
      - Replace live placeholder with real dual-model canary; run full local gate commands; record results in this plan.
    - Gate results (2026-07-30):
      - `npm test -w @arnilo/prism-compaction-observational-memory`: 78/78 pass (live suite skipped by default).
      - `npm run sdk:ready`: green (typecheck, lint, format, full test, coverage, pack, `release:gate`).
      - `node scripts/release.mjs check --version 0.0.19 --allow-dirty --allow-untagged`: 44 packages available.
      - `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` without `OPENAI_API_KEY`: fails closed; with key runs observer `gpt-4.1-mini` + reflector `gpt-5.1` canary.
    - API Notes and Examples:
      ```bash
      npm test -w @arnilo/prism-compaction-observational-memory
      npm run sdk:ready
      node scripts/release.mjs check --version 0.0.19
      PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1 npm test -w @arnilo/prism-compaction-observational-memory
      ```
    - Files to Create/Edit:
      - `live.test.ts` implementation; this plan checkboxes + Compromises/Further Actions; `roadmap.md` completion evidence when gate passes.
    - References:
      - Roadmap Phase 2 Exit Gate list.
  - Test Cases to Write:
    - Live: one observer + distinct reflector model end-to-end on tiny fixture; skip only when env unset, fail when env set without usable creds (per freeze).
    - No new unit tests beyond fixing gate failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new impact beyond prior tasks.
    - Docs pages to create/edit: none unless gate finds doc drift.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Task 1: reflection/drop empty-pass coverage markers append only when the worker runs (threshold met); bookkeeping-only unscanned ranges advance observation coverage without a provider call. Dropper still runs only after a reflection records at least one fact (`reflectionCount > 0`); revisit in Task 5 if empty-reflection + pool-pressure needs drop.
- Task 2: `wrapResumeRun`/`wrapResumeStream` call lifecycle by `sessionId` registry; fork/clone re-attach with same options. No core hook added.

## Further Actions

- Phase 3: execute skills/context progressive disclosure plan (Release 0.0.20).
