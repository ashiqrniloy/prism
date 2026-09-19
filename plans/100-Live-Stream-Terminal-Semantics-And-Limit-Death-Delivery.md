# Live Stream Terminal Semantics and Limit-Death Delivery

Release: 0.9.0 (P1). Lands before the 0.9.0 cut (plan 099). Closes plan 087's Further Action P2: `run_limit_exceeded` was treated as a terminal record by every durable source, so a subscriber that stopped at the first terminal event could end one record early and never see the `budget_exhausted` attribution or the terminal `error` that plan 087 Task 2 emits immediately after it.

## Objectives
- One definition of the terminal-event set in the tree, shared by the in-memory/durable source, the NATS source, the Postgres source, and the AG-UI replay adapter.
- A run that dies on a run limit delivers `run_limit_exceeded` → `budget_exhausted` → `error` to `page()`, `subscribe()`, and replay consumers before the stream ends.
- The adapter contract probe (`assertAgentEventSourceConforms`) asserts that delivery order against every `AgentEventSource` implementation, so the sets cannot drift again.

## Expected Outcome
- A host tailing a session over NATS, Postgres, the in-memory source, or AG-UI replay receives the limit-death attribution and the terminal error instead of a stream that closes on the breach record.
- No literal `run_limit_exceeded` membership test survives outside the single predicate; a future source cannot re-type the set without failing conformance.
- `agent_suspended` stays non-terminal and suspension behavior is unchanged.

## Tasks

- [x] Task 1: One terminal-event predicate; limit deaths deliver their attribution before the stream ends
  - Acceptance Criteria:
    - Functional: `isTerminalAgentEventType(type)` returns `true` for exactly `agent_finished`, `agent_denied`, and `error`, and `false` for every other `AgentEvent` member — `run_limit_exceeded`, `budget_exhausted`, and `agent_suspended` included. All seven stream-ending sites route through it: `src/agent-event-source.ts` (`isTerminal`/`terminalAt`/page flag/live loop), `packages/prism-core/src/sessions/nats/event-source.ts` (page flag and live loop), `packages/prism-core/src/sessions/postgres/event-source.ts` (page flag and live loop), `packages/ag-ui/src/replay.ts` (page `terminal`), `packages/ag-ui/src/a2a-server.ts` (`isTerminalRecord`, breaks the A2A stream), `packages/ag-ui/src/handler.ts` (`filterRun`, ends the AG-UI stream), and `packages/prism-core/src/runtime/server/conversations.ts` (replay `terminal` flag). A limit death reaches page, subscribe, and replay consumers as `run_limit_exceeded` → `budget_exhausted` → `error`, and the stream ends on `error`.
    - Functional (no-hang evidence): the only `run_limit_exceeded` emission site is `RunLimitTracker.onExceeded` in `src/agent-session/session/assemble.ts`, whose catch path always emits `error` right after `budget_exhausted`; the task note records this enumeration and states the one window where the breach record can be last (a suspension race that takes the `AgentRunSuspended` branch) together with the fact that suspension is already non-terminal today, so the change adds no new hang.
    - Performance: the predicate is O(1) and allocation-free, evaluated once per record; live consumers make no extra round trip beyond the records the run already emits; the conformance additions stay inside the existing adapter test budget.
    - Code Quality: exactly one definition of the terminal set in the tree — all seven literal copies are deleted, not duplicated behind the helper; naming follows the repo's `is*` predicate convention; no new dependency; the `AgentEvent` union and `AgentEventSource` types are untouched.
    - Security: ordering, redaction, cursor, and ownership checks are unchanged; the new conformance assertion inspects event types only and never payload content.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md` (run-limit rows and the `budget_exhausted` ordering claim), `docs/agent-session-runtime.md` (stream consumption).
      - `src/testing/agent-event-source-conformance.ts` — the adapter contract probe run by `src/__tests__/agent-event-source.test.ts`, `packages/prism-core/src/sessions/nats/__tests__/nats.integration.test.ts`, and `packages/prism-core/src/sessions/postgres/__tests__/event-source.integration.test.ts`.
      - `plans/007-Release-0-0-24-Distributed-Events-and-Recoverable-Tool-Effects.md:232` — the historical terminal-set definition this plan corrects.
      - Plan 087 Tasks 2–3 (emission order in `assemble.ts`, timeline projection).
    - Options Considered:
      - Keep the copies and only drop `run_limit_exceeded` from them, pinning membership with a test — rejected: the seven copies already diverged (the three AG-UI/server sites exclude `run_limit_exceeded` while the four sources include it), and nothing stops the next source from re-typing the set.
      - Export one predicate from the root and route every site through it — chosen: one place to change, and the conformance runner can then assert delivery order against every source implementation.
      - Make `budget_exhausted` terminal instead of `error` — rejected: the terminal record is the run's outcome record; `budget_exhausted` is attribution a host may legitimately ignore.
    - Chosen Approach: `isTerminalAgentEventType(type: AgentEvent["type"]): boolean` in `src/agent-event-source.ts`, exported from the root barrel; each site passes its record's type; the conformance runner gains the limit-death ordering assertion; `docs/agent-events.md` states the terminal set and the delivery order once.
    - API Notes and Examples:
      ```ts
      import { isTerminalAgentEventType } from "@arnilo/prism";

      isTerminalAgentEventType("error");              // true
      isTerminalAgentEventType("agent_finished");     // true
      isTerminalAgentEventType("run_limit_exceeded"); // false — the run's `error` follows
      ```
      ```ts
      // src/testing/agent-event-source-conformance.ts — added assertion (sketch)
      await source.append(event("event-limit", "run_limit_exceeded", input));
      await source.append(event("event-attr", "budget_exhausted", input));
      equal((await source.page({ ...input, after: beforeLimit, limit: 10 })).terminal, false, "breach record must not close the stream");
      await source.append(event("event-error", "error", input));
      equal((await source.page({ ...input, after: beforeLimit, limit: 10 })).terminal, true, "terminal error closes the stream");
      ```
    - Files to Create/Edit:
      - `src/agent-event-source.ts`: add and export the predicate; delete the private `isTerminal` and route `terminalAt` plus the live loop through the shared one.
      - `src/index.ts`: export `isTerminalAgentEventType`.
      - `src/testing/agent-event-source-conformance.ts`: limit-death delivery assertion; extend the local `event()` helper's type union and payloads to `run_limit_exceeded`, `budget_exhausted`, and `error` with minimal valid bodies.
      - `packages/prism-core/src/sessions/nats/event-source.ts`, `packages/prism-core/src/sessions/postgres/event-source.ts`: import and use the shared predicate; delete the local copies.
      - `packages/ag-ui/src/replay.ts`, `packages/ag-ui/src/a2a-server.ts`, `packages/ag-ui/src/handler.ts`, `packages/prism-core/src/runtime/server/conversations.ts`: replace the inline terminal checks with the shared predicate (the latter three keep their current membership, so behavior there is unchanged).
      - `src/__tests__/public-export-contract.test.ts`: add the new value export to `FROZEN_VALUE_EXPORTS`.
      - `scripts/budgets.json`: rebaseline the `@arnilo/prism` export count (+1) with a reason entry; regenerate `docs/_evidence/phase54-package-map.md` and `scripts/package-truth.json` with `node scripts/package-truth.mjs --emit-docs`.
      - `docs/agent-events.md`: state the terminal set and the limit-death delivery order.
    - References:
      - Plan 087 Further Actions P2 (this plan's origin) and Task 2's emission order in `src/agent-session/session/assemble.ts`.
      - Plan 099 (0.9.0 cut) — this plan ships with 086–098; its Task 2 baseline regeneration covers the new export.
  - Test Cases to Write:
    - Predicate membership table: the three terminal members are `true`; `run_limit_exceeded`, `budget_exhausted`, `agent_suspended`, `provider_turn_finished`, and `turn_started` are `false`.
    - Conformance (memory source, NATS, Postgres through `assertAgentEventSourceConforms`): a page ending at `run_limit_exceeded` reports `terminal: false`; the page ending at the following `error` reports `true`; a `subscribe()` iterator yields `run_limit_exceeded`, `budget_exhausted`, `error` in order and then ends.
    - Root live loop (`src/__tests__/agent-event-source.test.ts`): the `run()` generator keeps paging past `run_limit_exceeded` and ends on `error`.
    - NATS and Postgres live subscriptions: the stream ends on `error`, not on the breach record (protected env; skip with a stated reason when unavailable).
    - AG-UI replay (`packages/ag-ui/src/__tests__/handler.test.ts`): a page ending at `run_limit_exceeded` reports `terminal: false`.
    - Negative control: pages ending at `agent_finished`, `agent_denied`, or `error` still report `terminal: true` — including the A2A stream break, the AG-UI `filterRun` end, and the conversations replay flag, which must not change behavior when routed through the shared predicate.
    - End-to-end ordering: a real `maxTurns` death (reusing the driver in `src/__tests__/run-limits.test.ts`) collected through a source subscription yields `run_limit_exceeded` before `budget_exhausted` before `error`.
  - Notes (executed 2026-09-19):
    - Predicate: `isTerminalAgentEventType(type: AgentEvent["type"])` lives in `src/agent-event-source.ts` and is exported from the root barrel (`src/index.ts`). All four literal copies are deleted (`src/agent-event-source.ts`, `packages/prism-core/src/sessions/nats/event-source.ts`, `packages/prism-core/src/sessions/postgres/event-source.ts`, `packages/ag-ui/src/replay.ts`) and the three sites that already excluded `run_limit_exceeded` route through it too (`packages/ag-ui/src/a2a-server.ts` — its `isTerminalRecord` is gone, `packages/ag-ui/src/handler.ts` `filterRun`, `packages/prism-core/src/runtime/server/conversations.ts` replay flag). The root live loop needed no edit: it ends on `page.terminal`, which now asks the shared predicate. `graft grep "run_limit_exceeded"` leaves only emitters, projectors, the webhook switch, and the timeline join; no stream-ending membership test survives outside the predicate.
    - Membership test: `src/__tests__/agent-event-source.test.ts` classifies every member through an exhaustive `Record<AgentEventType, boolean>` and asserts exactly three are `true`. It immediately earned its keep — it failed to compile on `delegated_agent_step`, a member the 35-line grep of the payload union had missed (36 members).
    - Conformance: `src/testing/agent-event-source-conformance.ts` gained the limit-death block — `run_limit_exceeded` + `budget_exhausted` page together with `terminal: false`, the following `error` sets `terminal: true`, and a subscriber reads `turn_started,run_limit_exceeded,budget_exhausted,error` in order and then ends. It runs for the memory source in `src/__tests__/agent-event-source.test.ts`, for Postgres in `packages/prism-core/src/sessions/postgres/__tests__/event-source.integration.test.ts` (verified locally: pgvector/pgvector:pg16 + `PRISM_TEST_POSTGRES_URL`, `npm run test:postgres` → 0 fail), and for NATS in its integration suite (CI; no NATS server in this environment).
    - Root-level behavior: `src/__tests__/agent-event-source.test.ts` adds "ends a stream on the run's outcome, never on limit attribution" (page flags plus subscribe order). `packages/ag-ui/src/__tests__/handler.test.ts` adds the replay equivalent for `createAgentEventSourceAgUiReplay` (breach pages with `terminal: false`, error ends it) — together they are the negative control for the A2A break, `filterRun`, and conversations replay flag, whose membership is unchanged.
    - Real-death evidence: `src/__tests__/run-limits.test.ts` now asserts the live order `run_limit_exceeded` < `budget_exhausted` < `error` from an actual `maxTurns` death (replacing the two-event assertion). **Compromise:** nothing in `src/` appends a session's live events into an `AgentEventSource` — hosts wire that seam themselves — so "a real death collected through a source subscription" is proven in halves that meet at the ordering contract: real emitter order from the session, and source delivery/termination from the conformance runner. Building a session→source sink inside the test would have tested the sink.
    - Surface + budgets: `@arnilo/prism` export baseline 1445 → 1446 with the reason entry (`[2026-09-19] plan 100 Task 1 live-terminal predicate: +1 (isTerminalAgentEventType, root)`); `scripts/dead-exports.mjs` not re-run (purely additive). `scripts/budget-gate.test.mjs` green; the non-null assertion count is unchanged — the conformance edit dropped the one `!` it had introduced for a checked local.
    - Compat baseline: regenerated with `node scripts/release.mjs gate --lockstep --version 0.9.0 --update-baseline`; the diff is exactly `+isTerminalAgentEventType\texport declare function isTerminalAgentEventType(type: AgentEvent["type"]): boolean` and 0 removals.
    - Tests run: `node --test dist/__tests__/agent-event-source.test.js dist/__tests__/run-limits.test.js dist/__tests__/public-export-contract.test.js` (253 pass), ag-ui `handler.test.js` (19 pass), prism-core `runtime/server/__tests__` (95 pass / 3 protected skips), `scripts/budget-gate.test.mjs` (19 pass), `npm run test:postgres` (0 fail), `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run release:gate` — all green.
  - Documentation/Wiki Assessment (executed): docs pages edited — `docs/agent-events.md` (the durable-source section names the terminal set and `isTerminalAgentEventType`; the run-limit section states the three-record delivery order and that pages/subscriptions/replays stay open across the first two). `docs/observability.md` untouched (no new pointer needed). `docs/index.md` update: no — no new page, no navigation delta. Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- The NATS leg of the new conformance assertion could not run locally (no NATS server here); the assertion is shared, so the NATS implementation is covered the moment its integration suite runs in CI, but this environment only proves memory + Postgres.
- "A real limit death collected through a source subscription" is verified in halves (session emitter order + source delivery contract) because no production seam appends session events to an `AgentEventSource`; inventing one for the test would assert the test's own plumbing rather than the shipped contract.
- The predicate is added to the root barrel only: `packages/prism-core` and `packages/ag-ui` import it from `@arnilo/prism`. That avoids a second definition and a new cross-package dependency edge, at the cost of one more root export (budget +1).
- `run_limit_exceeded`/`budget_exhausted` bodies in the conformance helper are minimal valid payloads (a `maxTurns` breach, zeroed counters, empty axis/tool-call arrays) so the probe stays dependency-free and never inspects payload content.
- The doc change states the terminal set and the delivery order but does not add a migration note: a host that stopped reading at the breach record was reading a stream that closed early, so the fix is a correction of shipped behavior rather than an opt-in surface — the 0.9.0 migration page (plan 099 Task 3) is where hosts get told to keep reading.

## Further Actions
- Run the NATS integration suite (the new conformance assertion included) in CI and confirm the breach/attribution ordering there. Priority: medium (only unproven leg of this task).
- Decide `agent_suspended` explicitly: it stays non-terminal by this predicate, and with one shared definition a future change to that choice now has a seven-site blast radius — make it a deliberate decision with a conformance assertion, not a per-site patch. Priority: low.
- `docs/agent-events.md` describes the durable source and the run-limit order in two sections; if a third consumer family appears (e.g. another protocol adapter), point it at `isTerminalAgentEventType` in the durable-source section instead of restating the set. Priority: low.
