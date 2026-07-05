# Phase 40 — Backpressure and Performance Limits

## Objectives
- Bound live event subscriber memory for slow consumers without adding a durable queue to core.
- Add cheap regression coverage for long-session and paginated-read paths.
- Document production sizing, JSONL/dev-store limits, and database adapter expectations.

## Expected Outcome
- `session.subscribe()` uses a bounded queue by default, with documented overflow behavior and an observable overflow signal where useful.
- Runtime/session helper tests catch accidental full-session scans on paths that advertise `readBranchPath`/pagination.
- `/docs/performance.md`, event docs, and database persistence docs state practical limits and host-owned responsibilities.

## Tasks

- [x] Primitive review and current performance inventory
  - Acceptance Criteria:
    - Functional: Inventory existing `AgentSession.subscribe()`, `EventSubscriber`, `AgentEvent`, `RunLedger`, `SessionStore.readBranchPath`, JSONL store, and branch helper behavior before implementation.
    - Performance: Record current unbounded subscriber queue and existing full-scan fallback paths; do not add runtime code in this task.
    - Code Quality: Identify the smallest generic primitive change, preferring `subscribe(options)` over new broadcaster abstractions unless existing contracts cannot support it.
    - Security: Confirm overflow events and performance fixtures do not include message text, tool args, credentials, or raw prompts unless already redacted through existing `emit()`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 40.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/agent-events.md` live in-memory subscriber stream and durable event ledger notes.
      - `docs/agent-session-runtime.md` `session.subscribe()` behavior.
      - `docs/session-stores.md` and `docs/session-stores-and-branching.md` branch-read guidance.
      - `docs/node-jsonl-session-store.md` linear-read JSONL development limits.
      - `docs/database-persistence.md` indexes, cursor pagination, and event sequence guidance.
      - `docs/runs-and-usage.md` `RunLedger` write behavior.
    - Options Considered:
      - Add a full event-bus/backpressure subsystem: more flexible, but violates Phase 40's bounded-memory need with unnecessary architecture.
      - Extend the existing subscriber queue with options: smallest shared primitive and keeps durable queues host-owned.
    - Chosen Approach:
      - Start with an inventory, then change only existing runtime/contracts/docs needed to make slow consumers bounded by default.
    - API Notes and Examples:
      ```ts
      const events = session.subscribe({ maxQueuedEvents: 256, overflow: "close" });
      ```
    - Files to Create/Edit:
      - `plans/041-backpressure-and-performance-limits.md`: this plan.
      - `src/agents.ts`: current `EventSubscriber` and runtime emit path inventory.
      - `src/contracts.ts`: current `AgentSession.subscribe()` contract inventory.
      - `src/session-stores.ts`: current branch reader/full-scan fallback inventory.
      - `src/node/session-store-jsonl.ts`: tentative path; current JSONL read behavior inventory.
      - `docs/agent-events.md`, `docs/database-persistence.md`, `docs/node-jsonl-session-store.md`: current documented behavior inventory.
    - References:
      - `src/contracts.ts` `AgentSession.subscribe(): AsyncIterable<AgentEvent>` has no options today.
      - `src/agents.ts` `RuntimeAgentSession.subscribe()` creates one `EventSubscriber` per caller and stores it in a session-local `Set`.
      - `src/agents.ts` `EventSubscriber` currently stores events in an unbounded `queue: AgentEvent[]`.
      - `src/agents.ts` `emit()` redacts once with `redactAgentEvent()` before pushing to subscribers and writing `AgentEventRecord`s.
      - `src/agents.ts` `branchReader()` prefers `store.readBranchPath` before `store.list()`.
      - `src/session-stores.ts` branch reader overloads follow paginated `nextCursor` up to `MAX_BRANCH_PAGES = 64`, then reuse the same in-memory validation/order path.
      - `src/node/session-store-jsonl.ts` omits `readBranchPath`; `list()` and `get()` reread and parse the whole JSONL file.
      - `docs/agent-events.md` says subscribers are in-process, live-only, and not a durable queue.
      - `docs/node-jsonl-session-store.md` says reads are linear in file size and JSONL is not production multi-writer storage.
    - Current Performance Inventory:
      - `AgentSession.subscribe()` contract: no queue/backpressure options, so any behavior change needs a public `subscribe(options?)` addition rather than a parallel subscription API.
      - Live subscriber queue: `EventSubscriber.push()` delivers immediately to a waiting `next()` caller; otherwise it appends to `queue` with no maximum. A slow or abandoned consumer can grow memory without bound until run end or `return()`/`closeSubscribers()`.
      - Subscriber lifetime: `closeSubscribers()` closes all subscribers at run cleanup and clears the set. Subscribers are per session, in-process, and live-only; durable replay belongs to `RunLedger`/host storage.
      - Overflow event safety: existing `emit()` is the only runtime path to subscribers and ledger, and it redacts before fan-out. Any overflow notification should carry only counts/policy and must avoid recursive overflow by delivering/closing directly or by not enqueueing payload-bearing events.
      - `AgentEvent` payload size: variants may carry full messages, content deltas, tool calls/results, summaries, artifact validation metadata, and errors. Queue limits must count events, not assume payloads are tiny.
      - `RunLedger` write path: runtime appends `AgentEventRecord`s after redaction and drains pending ledger writes at safe boundaries; ledger latency can block runs, but it is durable host-owned storage, not subscriber backpressure.
      - Runtime branch reads: `entries()`, `clone()`, and `snapshot()` use `branchReader()` when `SessionStore.readBranchPath` exists; otherwise they call `store.list(sessionId)` and rebuild in memory. The fallback is correct for memory/JSONL and a full-scan risk for long production sessions.
      - Branch helper pagination: async `getSessionBranchEntries(reader, query)`/`rebuildSessionContext(reader, query)` follow `nextCursor`, collect branch entries, then validate/order via parent links. This avoids requiring full-session loads but still materializes the selected branch.
      - Memory store behavior: `createMemorySessionStore()` keeps process-local maps for O(1) id/parent lookup, but `list(sessionId)` returns all entries for that session and `readBranchPath` is absent.
      - JSONL store behavior: `append()` serializes within one process but reads the whole file to validate duplicate ids/parents before every append; `list()`/`get()` read and parse the whole file. No cross-process lock, no pagination, no production multi-writer safety.
      - Production persistence docs: `ProductionPersistenceStore` and `SessionStore.readBranchPath` are already cursor-shaped; docs recommend indexes on session/run/parent/leaf/timestamp/type/kind and recursive branch reads instead of `list(sessionId)` full scans.
    - Smallest Generic Primitive Change:
      - Add `SubscribeOptions`/`SubscriberOverflowPolicy` and change only `AgentSession.subscribe(options?)` plus existing `EventSubscriber`; no new broadcaster, worker, global queue, or durable event system.
      - Default should close slow subscribers on overflow to protect runtime memory without letting one UI stall provider/tool execution. Drop policies can remain optional if they stay small and documented.
      - Long-session coverage should use counted fake stores/readers, not benchmarks, to prove `readBranchPath` paths do not call `list(sessionId)`.
  - Test Cases to Write:
    - Inventory-only task: no product test; record exact test targets in following tasks before implementation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no direct behavior change; inventory only.
    - Docs pages to create/edit:
      - `none`: later tasks own docs changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded subscriber queue policy
  - Acceptance Criteria:
    - Functional: `session.subscribe()` accepts queue options; default subscribers cannot queue unbounded events; configured overflow behavior is deterministic (`close` default, plus `drop_oldest` or `drop_newest` only if still tiny).
    - Performance: Memory per subscriber is capped at `maxQueuedEvents`; pushing an event stays O(1) except optional single `shift()` for `drop_oldest` if chosen.
    - Code Quality: Reuses existing `EventSubscriber`; no new dependency, worker, timer, global queue, or durable storage.
    - Security: Overflow notification contains counts/policy only, not event payloads or prompt/tool content.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md` `session.subscribe()` and event union.
      - `docs/agent-session-runtime.md` live subscriber behavior.
      - `src/agents.ts` `EventSubscriber.push()` and `closeSubscribers()`.
      - `src/contracts.ts` `AgentSession`/`AgentEvent` contracts.
    - Options Considered:
      - Block `emit()` until subscribers consume: true backpressure, but one slow UI can stall provider/tool execution.
      - Close slow subscribers on overflow: simplest safe default; consumers reconnect/retry through host-owned durable ledger if needed.
      - Drop old/new events: useful for dashboards, but risks hiding terminal events unless explicitly selected.
    - Chosen Approach:
      - Added `SubscribeOptions` with default bounded queue (`maxQueuedEvents: 1024`, minimum `1`) and default `overflow: "close"`.
      - Added subscriber-local `event_subscriber_overflow` notification for the close policy; it clears queued payload events, queues only counts/policy, closes the subscriber, and avoids recursive `emit()` fan-out.
      - Kept drop policies tiny: `drop_oldest` keeps newest queued events, `drop_newest` ignores incoming events while full.
    - API Notes and Examples:
      ```ts
      import type { SubscribeOptions } from "@arnilo/prism";

      const options: SubscribeOptions = { maxQueuedEvents: 128, overflow: "close" };
      for await (const event of session.subscribe(options)) {
        console.log(event.type);
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: added `SubscribeOptions`, `SubscriberOverflowPolicy`, updated `AgentSession.subscribe(options?)`, and added `event_subscriber_overflow`.
      - `src/agents.ts`: passed options to `EventSubscriber`, capped queue, and implemented `close`/`drop_oldest`/`drop_newest` overflow behavior.
      - `src/index.ts`: no explicit edit needed; root `export type * from "./contracts.js"` exports the new public option types.
      - `src/__tests__/agents.test.ts`: added slow-subscriber close overflow and `drop_oldest` bounded-queue tests.
      - `docs/agent-events.md`: documented subscribe options and overflow event.
      - `docs/agent-session-runtime.md`: documented bounded subscriber behavior.
      - `docs/performance.md`: added performance limits page.
      - `docs/index.md`: linked performance limits.
      - `docs/public-contracts.md`: listed `SubscribeOptions`, `SubscriberOverflowPolicy`, and subscriber-overflow event behavior.
      - `src/__tests__/docs.test.ts`: added `docs/performance.md` to required API-page heading checks.
    - References:
      - `src/agents.ts` `EventSubscriber.next()` already drains FIFO events.
      - `src/agents.ts` `emit()` is the single runtime path that redacts before subscribers see events.
  - Test Cases to Write:
    - `slow subscriber closes on default overflow`: implemented; subscribe with tiny max queue, emit more events than the cap, assert one `event_subscriber_overflow` then iterator ends.
    - `drop policy preserves bounded queue`: implemented for `drop_oldest`; slow subscriber with max `2` receives only newest terminal events.
    - `active consumer unaffected`: covered by existing streaming subscriber tests plus unchanged `collect(session.subscribe())` runtime tests.
    - Verification run: `npm run build:core && node --test dist/__tests__/agents.test.js dist/__tests__/docs.test.js` passed (115 tests); full `npm test` passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; `session.subscribe()` gains options and default bounded behavior.
    - Docs pages to create/edit:
      - `docs/agent-events.md`: subscribe options, overflow behavior, overflow event if added.
      - `docs/agent-session-runtime.md`: runtime subscription example and slow-consumer guidance.
      - `docs/performance.md`: event queue sizing guidance.
    - `docs/index.md` update: yes; add/link `Performance limits` under runtime/production hardening.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add long-session and pagination regression coverage
  - Acceptance Criteria:
    - Functional: Tests/fixtures prove branch reads use `readBranchPath` when available, event ledger reads are cursor-shaped in docs/contracts, and JSONL degradation boundaries stay explicit.
    - Performance: Long-session tests avoid huge fixtures but fail if code paths that claim pagination call `store.list(sessionId)` unnecessarily.
    - Code Quality: Use tiny fake stores/readers and `node:test`; no benchmark framework or timing-sensitive assertions.
    - Security: Fixtures use synthetic messages and never real secrets, credentials, or provider payloads.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores.md` optional `readBranchPath` guidance.
      - `docs/session-stores-and-branching.md` linear fallback and DB branch reader notes.
      - `docs/database-persistence.md` cursor query/index contract.
      - `docs/node-jsonl-session-store.md` linear JSONL read warning.
      - `src/session-stores.ts` reader overloads for branch helpers.
    - Options Considered:
      - Add microbenchmarks with wall-clock thresholds: flaky and environment-dependent.
      - Add structural regression tests with counted method calls: cheap, deterministic, enough to catch full-scan regressions.
    - Chosen Approach:
      - Used counted fake `SessionStore`/`BranchReader` implementations and small synthetic entry chains to assert the intended code path, not elapsed time.
    - API Notes and Examples:
      ```ts
      const store = {
        append: async () => undefined,
        list: async () => { throw new Error("full scan"); },
        readBranchPath: async () => ({ items: page, nextCursor: undefined }),
      };
      ```
    - Files to Create/Edit:
      - `src/__tests__/session-stores.test.ts`: strengthened branch reader pagination regression to assert cursor/limit propagation and ordered ancestor output.
      - `src/__tests__/agents.test.ts`: runtime `entries()` and run history rebuild now use `readBranchPath` against a fake store whose `list()` throws.
      - `src/__tests__/persistence-contracts.types.test.ts`: event-ledger query fixture now covers cursor/limit/order shape.
      - `src/__tests__/docs.test.ts`: JSONL/performance docs boundary regression asserts long-session, cursor, event sequence, full-scan, and JSONL degradation wording stays present.
    - References:
      - `RuntimeAgentSession.entries()` and `snapshot()` prefer `branchReader()`.
      - `ProductionPersistenceStore.queryEvents()` and `readBranchPath()` are already cursor-shaped in `docs/database-persistence.md`.
  - Test Cases to Write:
    - `runtime branch snapshot uses readBranchPath`: implemented; fake store throws from `list()` and succeeds via `readBranchPath` for `entries()` and second-run history rebuild.
    - `branch helpers page through reader`: implemented; async helper preserves order and propagates cursor/limit across pages.
    - `event ledger reads stay cursor-shaped`: implemented in compile contract fixture with `AgentEventQuery.cursor`, `limit`, and `order`.
    - `jsonl docs boundary remains true`: implemented in docs test; asserts JSONL remains documented as linear/no cross-process lock and performance docs call out full-session reads and JSONL rereads.
    - Verification run: `npm run build:core && node --test dist/__tests__/agents.test.js dist/__tests__/session-stores.test.js dist/__tests__/persistence-contracts.types.test.js dist/__tests__/docs.test.js dist/__tests__/node-session-store-jsonl.test.js` passed (165 tests); full `npm test` passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; locks performance behavior and documented store expectations.
    - Docs pages to create/edit:
      - `docs/performance.md`: long-session regression scope and sizing caveats.
      - `docs/database-persistence.md`: index/pagination guidance cross-link.
      - `docs/node-jsonl-session-store.md`: explicit degradation boundary if wording is incomplete.
    - `docs/index.md` update: yes; link `Performance limits`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Document database adapter performance guidance
  - Acceptance Criteria:
    - Functional: Docs specify recommended indexes, cursor pagination, batch append guidance, event sequence allocation, run/event/usage query shapes, and host-owned sizing assumptions.
    - Performance: Guidance avoids promising JSONL/in-memory production behavior and calls out O(n) fallback paths.
    - Code Quality: Documentation reuses existing persistence contracts; no new DB adapter or ORM dependency is introduced.
    - Security: Docs reiterate redaction before persistence and no credential/provider-object storage.
  - Approach:
    - Documentation Reviewed:
      - `docs/database-persistence.md` reference schema and indexes.
      - `docs/runs-and-usage.md` `RunLedger` writes and slow-adapter blocking note.
      - `docs/session-stores.md` atomic append/readBranchPath guidance.
      - `docs/agent-events.md` live vs durable event distinction.
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
    - Options Considered:
      - Ship a reference SQL adapter: out of scope; roadmap says adapter guidance, not implementation.
      - Add concise docs and examples over current contracts: enough for hosts, no extra maintenance.
    - Chosen Approach:
      - Extended `/docs/performance.md` as sizing/limits hub and cross-linked existing persistence docs.
      - Added a dedicated database adapter performance section to `docs/database-persistence.md` instead of adding any adapter/ORM code.
    - API Notes and Examples:
      ```sql
      -- Reference only: stable event pagination within a run.
      CREATE INDEX prism_agent_events_run_sequence_idx ON prism_agent_events (run_id, sequence);
      ```
    - Files to Create/Edit:
      - `docs/performance.md`: expanded production limits page with cursor-key, page-size, event-sequence, usage-index, batching, and host-owned sizing guidance.
      - `docs/database-persistence.md`: added `Adapter performance guidance`, `(run_id, sequence)` index, run/event/usage query-shape section, and batch/sequence/redaction sizing notes.
      - `docs/runs-and-usage.md`: documented batching must preserve per-run order before acknowledgment and listed run/event/usage paging keys.
      - `docs/index.md`: already links `Performance limits`.
      - `src/__tests__/docs.test.ts`: added regressions for adapter guidance, run/event/usage keys, JSONL boundaries, and ledger batching wording.
    - References:
      - `docs/database-persistence.md` already lists indexes for sessions, entries, runs, events, tool calls, usage, definitions, retention, and migrations.
      - `docs/runs-and-usage.md` says runtime awaits ledger writes at safe boundaries.
  - Test Cases to Write:
    - `docs required headings`: existing docs test covers `/docs/performance.md` required API-page headings.
    - `docs index links performance`: existing docs index link test covers `docs/performance.md` via `docs/index.md`.
    - `database adapter guidance remains explicit`: implemented in docs test for adapter performance guidance, cursor pagination, batch appends, event sequence allocation, run/event/usage query shapes, host-owned sizing, and key indexes.
    - Verification run: `npm run build:core && node --test dist/__tests__/docs.test.js` passed (50 tests); full `npm test` passed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; documents production adapter requirements and limits.
    - Docs pages to create/edit:
      - `docs/performance.md`: new page.
      - `docs/database-persistence.md`: production performance cross-links.
      - `docs/runs-and-usage.md`: ledger batching/latency notes.
    - `docs/index.md` update: yes; add `Performance limits` navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification and release-safety checks
  - Acceptance Criteria:
    - Functional: All new public types are exported and docs examples compile or are covered by existing compile/doc checks.
    - Performance: Subscriber overflow tests and long-session path tests run in default network-free test suite without timing flake or large fixtures.
    - Code Quality: `npm test` and typecheck pass; no new dependency; no hidden global subscriber/store setting.
    - Security: Redaction path still runs before subscriber/ledger writes; overflow and performance docs do not expose secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` no-network/default test budget.
      - `docs/agent-events.md`, `docs/performance.md`, and `docs/index.md` after edits.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add separate benchmark command: useful later, but unnecessary for structural regressions.
      - Use existing `npm test`/docs checks only: simplest release gate.
    - Chosen Approach:
      - Run default project checks and update this plan's `Compromises Made`/`Further Actions` only after implementation passes.
    - API Notes and Examples:
      ```sh
      npm test
      ```
    - Files to Create/Edit:
      - `plans/041-backpressure-and-performance-limits.md`: mark completed tasks and fill final sections after execution.
      - `package.json`: tentative only if an existing script needs inclusion; avoid adding scripts if `npm test` already covers it.
    - References:
      - `docs/release-and-install.md` pins default `npm test` as network-free and under the chosen time budget.
  - Test Cases to Write:
    - Run `npm test`.
    - Run targeted tests for subscriber overflow and branch-read regressions if `npm test` is too broad during development.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior in this task; verifies earlier behavior/docs.
    - Docs pages to create/edit:
      - `none`: verification only unless drift is found.
    - `docs/index.md` update: no additional update beyond earlier tasks.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Bounded subscriber queue uses a single in-memory `EventSubscriber` per `session.subscribe()` call rather than a shared broadcaster/worker pool. Live-only by design; durable overflow is host-owned via `RunLedger`. Trade-off: a slow consumer still blocks its own queue; closing/dropping is the only in-runtime backpressure. Upgrade path: a host extension owning a durable event queue if multi-consumer fan-out is required.
- Long-session and pagination regression coverage uses counted fakes and structural assertions, not wall-clock benchmarks. Trade-off: catches O(n)/fallback regressions and contract drift, not real throughput numbers. Upgrade path: add an opt-in benchmark command behind a non-default script when hosts request throughput baselines.
- JSONL and memory stores remain O(n)/full-file-read fallbacks. Trade-off: simplest correct dev stores; not production-safe for long sessions. Upgrade path: documented as development-only; production hosts implement `ProductionPersistenceStore`.
- Default `maxQueuedEvents` is 1024 with `overflow: 'close'`. Trade-off: protects memory by closing slow subscribers; a host wanting best-effort delivery can choose `drop_oldest`. Upgrade path: hosts tune via `SubscribeOptions` per session.

## Further Actions
- [low] Consider an opt-in `npm run bench` script for real long-session/branch-read throughput baselines, behind a separate test budget so the default `npm test` stays network-free and fast. Rationale: structural regressions are sufficient today; throughput numbers only matter once hosts report scale targets.
- [low] Document a host extension recipe for a durable event queue / multi-consumer fan-out once a real host needs live broadcast beyond a single subscriber per call. Rationale: yagni until a host asks; the `RunLedger` already covers durable replay.
- [low] Revisit default `maxQueuedEvents: 1024` once telemetry from hosts indicates the right default for production event cadence. Rationale: a chosen constant is better than unbounded; tune from real measurements, not guesses.
- [low] Add a JSONL store cursor/pagination note pointer in `docs/node-jsonl-session-store.md` cross-linking `docs/performance.md` if the JSONL store ever gains a streaming reader. Rationale: current implementation is intentionally full-file; no change needed until that lands.
