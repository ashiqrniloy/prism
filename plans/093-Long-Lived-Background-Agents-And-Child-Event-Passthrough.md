# Long-Lived Background Agents and Child Event Passthrough

Release: 0.9.0 (P1). Closes clay E4 (supervisor child event streaming) and brings Muse-Code-style persistent background agents with cascade/recovery telemetry.

## Objectives
- Session-persistent child agents with a communication policy (milestone or ready reporting), budget share, and optional redacted per-turn event passthrough.
- Supervisor telemetry: failure radius, retry counts, cascade metrics per child.
- One-shot `spawn_agent` behavior unchanged.

## Expected Outcome
- Clay's validation-loop UI renders live child activity from prism events; its passthrough workaround is deleted.
- A host can start a background researcher at session open that reports at milestones without occupying the conversation.

## Tasks

- [x] Task 1: Primitive review — supervisor/spawn surface
  - Acceptance Criteria:
    - Functional: Inventory `packages/prism-core/src/runtime/supervisor/` (`supervisor.ts`, `spawn-tool.ts`, `types.ts`, `observeSupervisorLifecycle`), child budget/limit plumbing, and existing event fan-out; identify the minimal extension for persistence + passthrough.
    - Performance / Code Quality / Security: analysis only.
  - Approach:
    - Documentation Reviewed: `docs/multi-agent-patterns.md`, supervisor module.
    - Options Considered: n/a.
    - Chosen Approach: Extend supervisor child records with lifetime + communication policy; events routed through existing supervisor event seam.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: none.
    - References: Muse Code persistent subagents; multi-agent lit — agents-as-tools works, long-lived peers stumble → keep tool-call semantics, add lifetime policy.
    - Findings (review outcome):
      - Surface: `createSupervisor` (`packages/prism-core/src/runtime/supervisor/supervisor.ts:146`) returns `Supervisor` (`types.ts:171-192`): `delegate` / `delegateAsync` / `wait` / `cancel` / `resumeNestedRun` / `subscribe` / `redact` / `childIds` / `activeChildren`. **No `close`/`dispose`, no live-delegation registry, no session reuse.** `DelegationRequest` (`types.ts:26-33`) has only `childId/input/threadId/metadata/limits/signal`; `SupervisorChild` policies (`types.ts:56-63`) are static per child. `spawn_agent` schema is closed (`spawn-tool.ts:18-67`: `childId/input/threadId/mode`, `additionalProperties:false`). Child session is created fresh per delegation (`supervisor.ts:274-278`, id `${delegationId}-session`); `threadId` is id metadata, not session reuse.
      - Limits/budget: `resolveSupervisorLimits`/`narrowSupervisorLimits` (`limits.ts:44-85`) enforce defaults/hard caps and clamp children to parent. `delegate` maps them to `RunOptions.limits` (`supervisor.ts:286-296`) and coercion of `AgentRunError.result.limit` (`RunLimitBreach`, `contracts-core/run-limits.ts:56-60`) to a `SupervisorLimitError` string (`supervisor.ts:287-317`). Plan-087 shapes (`RunLimitName`, `BudgetConsumedCounters`, `BudgetAxisUsage`) already exist; supervisor events carry no structured limit attribution. **`ToolExecutionContext` (`src/contracts-protocol.ts:459-470`) exposes no parent usage/budget snapshot**, so a live parent-run budget share is not derivable at the tool boundary — Task 2 `budgetShare` must be a fraction of the inherited `ResolvedSupervisorLimits` (clamped by `narrowSupervisorLimits`), or accept a core contract addition. Decision point.
      - Existing passthrough: `createSupervisor({ childEvents: true })` (`types.ts:155-160`) feeds `startChildEventPump` (`supervisor.ts:95-133`): milestone type filter (`supervisor.ts:85-94`), supervisor redactor, per-delegation count/byte caps, `delegation_child_event` with `childId/delegationId/depth` tags, one `delegation_child_events_capped` marker. Pump stops in the run `finally` (`supervisor.ts:317-319`); resume path re-attaches it with fresh counters (`supervisor.ts:544-556`). Missing for Task 2/3: per-child policy, milestone cadence, rate coalescing, origin tag (wrapper tags only; no `child` field on `AgentEvent`, `contracts-protocol.ts:211`), and any parent-session routing.
      - Event transport: `createEventMultiplexer` (`src/event-multiplexer.ts:41`), bounded 128/4096, `drop_oldest` (`supervisor.ts:158`), **single consumer** — a second concurrent `subscribe()` throws `EventMultiplexerError` (`event-multiplexer.ts:6-13`). `observeSupervisorLifecycle` (`packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:19-69`) consumes that one slot, projecting `delegation_*` → `subagent_started/stopped` + `delegated_agent_step` (an `AgentEvent` member) and ignoring child events. `Supervisor` exposes no `close()`, so the multiplexer's close/abort path is unreachable (docs/supervisors.md already claims graceful close — surface gap).
      - Parent session stream: `AgentSession` (`src/contracts-run-state.ts:360-393`) has `subscribe`/`stream` but **no `emit`/`publish`**; only concrete `RuntimeAgentSession.emit` (`src/agent-session/session.ts:516-541`) fans out and writes the ledger. Supervisor→parent-session passthrough therefore needs either an `AgentSession` interface addition or a bridge helper typed on the concrete session — and that bridge must be the multiplexer's single consumer, with lifecycle observers/hosts fanning out from it. Decision point for Task 3.
      - Async lifetime: `delegateAsync` (`supervisor.ts:379-397`) links the caller signal (`supervisor.ts:193-195`), so parent-run abort kills background children; the run promise continues across parent turns but `activeChildren` holds a slot for the child's whole life (`supervisor.ts:184-190`, released `supervisor.ts:368-371`) against `maxActiveChildren` 4/32; terminal records are bounded by `maxQueuedEvents` (`finishAsyncDelegation`, `supervisor.ts:399-408`). Session lifetime minimally means: supervisor-owned controller not linked to caller signal, a `liveDelegations` registry (session + pump + controller), no terminal completion at run end, explicit `endChild(delegationId)`, and a `signal`/`close` on `CreateSupervisorOptions` wired to `events.close()` for session end.
      - Telemetry: no `child_failed`/`child_milestone`/`failureRadius`/per-child counters exist repo-wide. Failure radius is computable from the immutable delegation `path` already carried on every request/launch (`supervisor.ts:191-197`) with a small in-flight registry (needed anyway for session lifetime); `retries` needs a definition — `delegate()` never retries, so it can only mean durable-resume/rebuild attempts per `delegationId` or repeated `(childId, threadId)` delegations. `summary.children` needs a new surface: `delegate()`/`wait()` return fixed `AgentRunResult`, so it must be `Supervisor.summary()` or a terminal supervisor event.
      - Minimal extension (all additive; one-shot semantics untouched): `lifetime`/`report`/`budgetShare` on `DelegationRequest` + `spawn_agent` schema; per-child policy threaded into `startChildEventPump` (cadence needs `turn_started` counting before the milestone filter; coalescing is a token bucket in the pump); `liveDelegations` registry + `endChild` + optional abort signal on `createSupervisor`; optional origin tag reused from the `delegation_child_event` wrapper; structured limit/counter fields on the failure event following plan-087 shapes. No new files required; edits stay in `types.ts`, `limits.ts`, `supervisor.ts`, `spawn-tool.ts` (plus docs and tests).
      - Docs correction: child-event passthrough is documented in `docs/supervisors.md#child-event-passthrough` and the supervisor row of `docs/multi-agent-patterns.md` — the Task 2/3/4 doc targets should include `docs/supervisors.md` alongside `docs/agent-events.md`/`docs/multi-agent-patterns.md`.
  - Outcome: review recorded above; no code, no tests (analysis-only task).
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] Task 2: Child lifetime + communication policy
  - Acceptance Criteria:
    - Functional: `spawn_agent` gains `lifetime: "task" | "session"` (default `task`, current behavior) and `report: "on-complete" | "milestones" | "stream"`; milestone children emit `child_milestone` events (host-defined predicate or every-N-turns); session-lifetime children survive across parent turns until explicitly ended; budget share declared at spawn (fraction of run budgets) and enforced.
    - Performance: Passthrough events coalesced (configurable max rate, default 10/s per child) to protect host event loops; milestone evaluation O(predicate).
    - Code Quality: Policy types in supervisor contracts; no changes to one-shot semantics when options absent.
    - Security: Child credentials/permissions are a subset of parent (existing supervisor rule) — budget share and tool scopes cannot exceed parent; child events pass through existing redaction before emission.
  - Approach:
    - Documentation Reviewed: Task 1; `docs/multi-agent-patterns.md`.
    - Options Considered:
      - Free-form pub/sub between peers: rejected — lit says long-lived peers without hierarchy stumble; parent-mediated reporting chosen.
    - Chosen Approach: Lifetime + report policy on child record; supervisor mediates.
    - API Notes and Examples:
      ```ts
      spawn_agent({ task: "watch build", lifetime: "session", report: "milestones", milestone: { everyTurns: 5 }, budgetShare: 0.2 });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/supervisor/types.ts`: `ChildLifetime`, `ChildReportPolicy`, `SupervisorMilestonePolicy`, `SupervisorChildPolicy`, request fields, `child_milestone` / `delegation_child_events_coalesced` / `child_failed` events, `CreateSupervisorOptions.signal`.
      - `packages/prism-core/src/runtime/supervisor/limits.ts`: `maxChildEventsPerSecond` (10/1000), `HARD_MILESTONE_EVERY_TURNS`.
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts`: policy resolution/narrowing, session-lifetime signal detach + session-end abort, budget-share scaling, milestone/rate-coalescing pump, resume replay, plan-087 limit attribution, `abortable` unhandled-rejection fix.
      - `packages/prism-core/src/runtime/supervisor/spawn-tool.ts`: schema/validation/routing (session lifetime → async handle).
      - Tests: `__tests__/supervisor.test.ts`, `__tests__/spawn-tool.test.ts`.
      - Docs: `docs/supervisors.md`, `docs/agent-events.md`, `docs/multi-agent-patterns.md`.
    - References: clay E4; Muse background agents; OrchestraBench recovery metrics.
    - Deviations from plan text (actual implementation):
      - `budgetShare` scales the inherited `ResolvedSupervisorLimits` (steps/tool calls/tokens/timeout) and is clamped by `narrowSupervisorLimits`; live parent-run budget share is not derivable at the tool boundary (no parent usage snapshot in `ToolExecutionContext`), per Task 1 findings.
      - Host `SupervisorChild.policy` is authoritative: session lifetime is a capability (host must set `lifetime: "session"`; an omitted request still runs as a task child), report is clamped to the host ceiling, `everyTurns` can only be raised (chattier requests are clamped to the host cadence), and share takes the lower of host/request. Model args can never widen policy (fail closed).
      - Session-lifetime children are background by construction: `delegate()` rejects them, `delegateAsync` (and `spawn_agent` with `lifetime: "session"`) is the entry. Explicit end reuses `cancel(delegationId)` / `cancel_agent` — no new `endChild` API; session end uses the new `CreateSupervisorOptions.signal`.
      - `child_failed` (plan-087 `RunLimitBreach` + usage) ships here because the Task 2 budget-share attribution test requires it; Task 4 extends it with retries/failureRadius/outcome. It publishes before `delegation_error` so consumers that stop at the terminal event still see attribution.
      - Root-cause fix included: `abortable` now observes the abandoned promise on its already-aborted early return (pre-existing unhandled rejection exposed by abort/cleanup tests).
  - Test Cases to Write:
    - Session-lifetime child persists across parent turns; ends cleanly on session end. **Done** — caller-abort survives, supervisor-signal abort ends it and closes the stream, task-lifetime contrast, host-policy denial.
    - Milestone policy: events at right cadence, coalesced under rate cap. **Done** — `everyTurns: 2` on a 4-turn child emits turns `[2, 4]`; a chattier request clamps to the host cadence (`[3]`); host `predicate` emits per matched event (turns `[1, 2, 3]`); rate 1/s coalesces with a dropped-count marker (Date frozen).
    - Budget share: child hitting its share is stopped with attribution event (plan 087 shape). **Done** — `child_failed.limit.maximum` equals the scaled axis cap; host ceiling clamps a request's share/report.
    - Default options: byte-identical behavior to 0.8 spawn (fixture). **Done** — default spawn request carries only `childId`/`input`/`signal`; default stream events stay `delegation_started`/`delegation_finished` (existing test) and malformed policy args fail closed.
  - Checks: `npm run typecheck --workspace @arnilo/prism-core`, full `npm run test --workspace @arnilo/prism-core` (673 tests, 0 fail), `npm run test --workspace @arnilo/prism-coding-tools` (693 pass), `node --test scripts/live-doc-check.test.mjs` (6 pass).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — spawn options, new events.
    - Docs pages to create/edit: `docs/multi-agent-patterns.md` (background agents section incl. event-rate sizing line) **done**; `docs/supervisors.md` (lifetime/report/budgetShare options, child-event caps) **done**; `docs/agent-events.md` (`child_milestone`, coalescing, `child_failed`) **done**.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Per-turn child event passthrough (redacted, opt-in)
  - Acceptance Criteria:
    - Functional: `report: "stream"` forwards child provider/tool events to the parent session event stream with `child: true` origin tagging, after existing redaction; opt-in per child; parent stream ordering deterministic (child events interleave at emission, tagged).
    - Performance: Coalescing from Task 2 applies; no passthrough cost when opt-in absent.
    - Code Quality: Tagging at the supervisor event seam — no per-event-type special cases.
    - Security: Redaction applied before passthrough (secrets policy identical to parent events); host can cap stream depth.
  - Approach:
    - Documentation Reviewed: redaction pipeline (`docs/credentials-and-redaction.md`), event fan-out seam.
    - Options Considered: Polling API for child state — rejected; clay needs live UI.
    - Chosen Approach: Tagged passthrough at supervisor seam.
    - API Notes and Examples:
      ```ts
      const supervisor = createSupervisor({
        ownership,
        childEvents: true, // opt-in ceiling; per-child policy.report can lower it
        childEventSink: (event) => session.emit(event), // parent stream, already redacted + capped
        children: { watch: { policy: { report: "stream" }, createAgent: () => watchAgent() } },
      });
      // parent subscriber:
      session.on("provider_turn_started", (e) => e.child); // { childId, delegationId, depth }
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts`: `ChildEventOrigin` + `AgentEvent` gains the additive optional `child?: ChildEventOrigin` tag (payload union split into `AgentEventPayload`; `AgentEvent["type"]`, `Extract<AgentEvent, …>`, and exhaustiveness all unchanged).
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts`: `PASSTHROUGH_CHILD_EVENT_TYPES` (milestone subset + turn/provider-turn), one tagged projection shared by the stream and the sink, `childEventSink` wiring on the live and resume pumps.
      - `packages/prism-core/src/runtime/supervisor/types.ts`: `CreateSupervisorOptions.childEventSink`.
      - Tests: `__tests__/supervisor.test.ts` (sink routing/redaction/nesting), `__tests__/nested-approvals.test.ts` (cap-per-pump expectation).
      - Docs: `docs/agent-events.md`, `docs/supervisors.md`, `docs/multi-agent-patterns.md`.
    - References: clay E4 workaround description.
    - Deviations from plan text (actual implementation):
      - The tag is the three-field `ChildEventOrigin` (`childId`, `delegationId`, `depth`), not `child: true` — a boolean loses the origin needed to route and de-duplicate on the parent stream. The supervisor stamps the same object on `delegation_child_event.childEvent` and on the sink payload, so a host never re-tags.
      - Routing is `childEventSink` (host callback) rather than the supervisor reaching the parent session: the supervisor holds no parent-session reference, and its event multiplexer is single-consumer (Task 1 findings — `observeSupervisorLifecycle` already occupies `subscribe()`), so a second subscription is not available. The sink is called synchronously by the pump, after `publish`, so sink order is exactly stream order.
      - `report: "stream"` is the per-turn passthrough set (milestone subset + `turn_started`/`turn_finished`/`provider_turn_started`/`provider_turn_finished`), never per-token `message_delta` or full `message_*` payloads. The legacy supervisor-wide `childEvents: true` resolves to the same set, so caps fill faster; `nested-approvals` now expects one overflow marker per pump attempt (live + resume).
      - Redaction/caps/rate happen once, before both publish and sink: the sink cannot see a secret the stream would not, and it is advisory (a throwing sink never stops the pump).
      - Stream depth is capped by the existing `limits.maxDepth`; nested children are tagged with their real depth (tested at depth 2).
  - Test Cases to Write:
    - Passthrough redaction: secret in child tool args never reaches parent stream. **Done** — canary tool arguments never appear in the sink payloads.
    - Opt-in default off: no child events on parent stream for `task` children. **Done** — a supervisor with a sink but no `childEvents`/policy never calls it.
    - Ordering: interleaved events carry child id; replay deterministic. **Done** — sink payloads deep-equal the published stream payloads in order, `turn_started` turns replay `[1, 2]`, nested children carry `depth 2` on the same sink.
  - Checks: `npm run build` (root + workspaces), `npm run test --workspace @arnilo/prism-core` (677 tests, 0 fail), `npm run test --workspace @arnilo/prism-coding-tools` (693 pass), `npm run test --workspace @arnilo/prism-ag-ui` (236 pass), root `dist/__tests__` (1925/1926 — the one failure is the pre-existing `network-free default test guard` hit on `packages/memory/src/rag/__tests__/local-reranker.test.ts` from unrelated in-flight work), `scripts/live-doc-check.test.mjs` + `scripts/import-hygiene.test.mjs` (9 pass), biome format/lint clean on touched files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — event origin tags. **Done**
    - Docs pages to create/edit: `docs/agent-events.md` (origin tag + `childEventSink`); `docs/supervisors.md#child-event-passthrough` (per-child opt-in, coalescing, single-consumer routing / host sink); `docs/multi-agent-patterns.md` (passthrough section). **Done**
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Cascade and recovery telemetry
  - Acceptance Criteria:
    - Functional: Supervisor run summary includes per-child `{ retries, failures, failureRadius: <downstream children affected>, outcome }`; failures emit `child_failed` with attribution (which limit/error, using plan 087 taxonomy).
    - Performance: Counters maintained incrementally; summary O(children).
    - Code Quality: Same event/summary shapes as plan 087 attribution for consistency.
    - Security: Error details follow existing error-redaction rules.
  - Approach:
    - Documentation Reviewed: plan 087 attribution design; supervisor lifecycle observation.
    - Options Considered: Host-side aggregation — rejected (OrchestraBench: nobody measures recovery; prism can, cheaply).
    - Chosen Approach: Incremental counters + terminal summary.
    - API Notes and Examples:
      ```ts
      supervisor.summary().children;
      // [{ childId: "worker", attempts: 2, retries: 1, failures: 1, failureRadius: 0, outcome: "succeeded" }]
      // child_failed: { childId, delegationId, depth, reason, status?, limit?, stopReason?, usage? }
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/supervisor/types.ts`: `SupervisorChildOutcome`, `SupervisorChildSummary`, `SupervisorRunSummary`, extended `child_failed` variant, `Supervisor.summary()`.
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts`: live-delegation registry, per-child counters, one `settleDelegation` terminal seam (live `delegate()` and `resumeNestedRun`), failure attribution.
      - Tests: `__tests__/supervisor.test.ts` (`cascade and recovery telemetry`).
      - Docs: `docs/supervisors.md` (Recovery telemetry + failure event), `docs/agent-events.md` (`child_failed` attribution), `docs/multi-agent-patterns.md` (telemetry attribution).
    - References: OrchestraBench cascade-radius metrics.
    - Deviations from plan text (actual implementation):
      - Summary contracts live in the existing `types.ts` next to the rest of the supervisor surface rather than in a new run-summary module; the counting logic is one registry + one settle seam inside `supervisor.ts`, so a module would only hold three types.
      - `child_failed` keeps Task 2's `limit: RunLimitBreach` and adds the plan-087 terminal vocabulary (`status`, `stopReason`) instead of plan 087's full `{ limit, consumed, closestOtherAxes, recentToolCalls }` block: that block needs the child's `RunLimitTracker`, which never crosses the supervisor boundary. The child's own `budget_exhausted` already carries it and reaches hosts as `delegation_child_event` for `report: "stream"` children.
      - `child_failed` now fires for every genuine failure, not only limit deaths; host cancels (`aborted`), hook rejections, and `denied` runs are excluded so the recovery counters are not polluted.
      - `failureRadius` is the blast radius at failure time — task-lifetime descendants still live when the child failed — not the result of a new abort cascade. The supervisor never aborted a failed child's descendants (task-lifetime children follow the caller/ancestor turn signal), and inventing that cascade is a behavior change this telemetry task does not need. `ponytail:` ancestry is the child-id path prefix; concurrent duplicate-path subtrees can overcount.
      - Counters are cumulative for the supervisor's lifetime (no per-run reset API); a host diffs snapshots. `retries` counts attempts started after `failed`/`aborted`; resuming a suspended run updates `outcome` but is not a new attempt.
      - No `supervisor_run_summary` event: the supervisor has no root-run end seam, and `summary()` is the O(children) terminal read.
  - Test Cases to Write:
    - Child fails → retries → completes: counters correct. **Done** — a `maxToolCalls` limit death leaves `{ attempts: 1, retries: 0, failures: 1, failureRadius: 0, outcome: "failed" }`, `child_failed` precedes `delegation_error` with `status: "failed"` + `limit.limit: "maxToolCalls"`; the re-dispatch lands `{ attempts: 2, retries: 1, failures: 1, outcome: "succeeded" }`.
    - Failure with downstream children: radius counts affected descendants only. **Done** — a failing `lead` with a live nested `writer` reports `failureRadius: 1`; the unrelated live `other` sibling keeps `0`.
    - Extra: a plain provider failure emits `child_failed` with the redacted `reason` and no breach; a host `cancel()` counts `failures: 0` / `outcome: "aborted"`.
  - Checks: `npm run build` (root + workspaces), `npm run test --workspace @arnilo/prism-core` (680 tests, 0 fail), `npm run test --workspace @arnilo/prism-coding-tools` (693 pass), `npm run test --workspace @arnilo/prism-ag-ui` (236 pass), root `dist/__tests__` (1924/1926 — the two failures are unrelated in-flight work: the `network-free default test guard` hit on `packages/memory/src/rag/__tests__/local-reranker.test.ts` and `plans/README.md` not yet linking another session's plan 106), `scripts/live-doc-check.test.mjs` + `scripts/import-hygiene.test.mjs`, biome format/lint clean on touched files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `summary()` shape, `child_failed` event. **Done**
    - Docs pages to create/edit: `docs/supervisors.md` (per-child counters, failure event, summary surface); `docs/multi-agent-patterns.md` (telemetry section); `docs/agent-events.md` (`child_failed`). **Done**
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- `child_failed` carries Task 2's `limit: RunLimitBreach` plus the plan-087 terminal vocabulary (`status`, `stopReason`) rather than the full plan-087 attribution block (`consumed`, `closestOtherAxes`, `recentToolCalls`). Those fields are built from the child's `RunLimitTracker`, which never crosses the supervisor boundary; the child's own `budget_exhausted` event already carries them and reaches hosts as `delegation_child_event` for `report: "stream"` children.
- `failureRadius` measures the blast radius at failure time (task-lifetime descendants still live when the child failed). The supervisor never aborted a failed child's descendants — task-lifetime children follow the caller/ancestor turn signal — so the metric reports the affected set instead of a cascade that does not exist. Ancestry is the child-id path prefix: concurrent delegations of the same child id at the same depth could overcount a radius (a `ponytail:` ceiling, not a correctness issue for the metric).
- Counters are cumulative for the supervisor's lifetime with no reset API; a host diffs snapshots per root run. `retries` counts attempts started after a `failed`/`aborted` outcome, and a suspended→resume cycle updates `outcome` without counting a new attempt.
- No `supervisor_run_summary` event: the supervisor has no root-run end seam, so `summary()` is the terminal read.
- Child lifetime/passthrough/telemetry remain core-only in this plan: `observeSupervisorLifecycle` in prism-coding-tools still projects only `delegation_started`/`finished`/`rejected`/`error`, so coding hosts do not yet surface `child_failed` or the recovery counters.

## Further Actions
- P2 — **Placed: plan 108 Task 2.** Project `child_failed` (redacted `reason`, `limit`, `stopReason`) and the per-child recovery counters through `observeSupervisorLifecycle` as opt-in `includeFailure` / `includeRecovery` fields on the `subagent_stopped` event it already emits, so coding hosts get failure attribution and recovery telemetry on their lifecycle stream instead of subscribing to the supervisor directly — bounded, default-off, and without adding a new lifecycle event kind.
- P3 — **Placed: plan 108 Task 3.** Exact `failureRadius` ancestry via the delegation-id parent chain instead of child-id path prefixes, so concurrent same-child subtrees can no longer overcount a radius.
- P3 — **Placed: plan 108 Task 4.** `summary({ reset: true })` starts a new counter window for per-root-run reads; no `supervisor_run_summary` event is added, because the supervisor has no root-run end seam.
- P3 — **Placed: plan 108 Task 5.** Retain the child's own `budget_exhausted` attribution (`consumed`, `closestOtherAxes`, `recentToolCalls`) on `AgentRunResult.attribution` at the breach site and copy it onto `child_failed` for limit deaths, so a host no longer joins `delegation_child_event` with `child_failed`.

