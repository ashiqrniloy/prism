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

- [ ] Task 1: One terminal-event predicate; limit deaths deliver their attribution before the stream ends
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new root export and a stream-termination behavior change for limit deaths.
    - Docs pages to create/edit:
      - `docs/agent-events.md`: terminal set (which records end a subscription) plus the limit-death delivery order, replacing the current implied claim.
      - `docs/observability.md`: only if the live-consumption note needs the pointer; otherwise `none`.
    - `docs/index.md` update: no — no new page, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
