# Phase 108 — Primitive Review: Failure Bridge, Exact Radius, Per-Run Counters, Limit Attribution

Plan: [108-Supervisor-Recovery-Telemetry-Follow-Ups.md](../../plans/108-Supervisor-Recovery-Telemetry-Follow-Ups.md) Task 1.
Date: 2026-09-26. Baseline: `0.10.1` WIP working tree, HEAD `7cd59941`, Node v26.8.2 (`aerynos`).
Method: read-only inventory plus a scratch probe (`.phase108-probe.mjs`, not committed; deleted after this
review) run against the working-tree `dist/` build — root `@arnilo/prism`, `packages/prism-core/dist`,
`packages/prism-coding-tools/dist` — with `node --expose-gc`, as plan 104 Task 1 did.
Scope: **gate for Tasks 2–5**. Every later task reuses a row below as-is, extends one additively, or adds
the named new seam; any primitive absent here is a review gap and must be added to §2 before implementation.

Cite convention: spans are `file:Lstart–Lend` verified in this tree (hyphens in headings, `-`/`–`
interchangeably in prose). The plan's own citations are stale in several places; each is called out inline
and the §1 span is authoritative. Every `reuse:` row names the exact exported symbol or the module-private
seam a later task calls; every `gap:` row names the file that would have to change; every `reject:` row
names the task it would have affected.

Source of the work: plan 093 `Compromises Made` + `Further Actions`
([093-Long-Lived-Background-Agents-And-Child-Event-Passthrough.md](../../plans/093-Long-Lived-Background-Agents-And-Child-Event-Passthrough.md),
items P2/P3 at `:L179–L182`), plus the current contracts in `docs/supervisors.md` (`:L31`, `:L46–L55`),
`docs/agent-events.md:L113–L115`, `docs/acp.md:L60`, `docs/coding-agent-tools.md:L617`,
`docs/runs-and-usage.md:L66`, `docs/agent-session-runtime.md:L64`, and
`scripts/phase10-freeze-manifest.json:L218–L230` (`lifecycleEventMapping` consumer gate).

---

## 1. Reuse inventory (what the later tasks build on)

### 1.1 Task 2 — failure + recovery projection on the coding lifecycle bridge

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L5–L16` | `ObserveSupervisorLifecycleOptions` | `onEvent` plus optional `delegatedAgentStep`; the extension point for the two opt-in booleans. Additive, default-off fields only. |
| `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L19–L66` | `observeSupervisorLifecycle(supervisor, options)` | Opens exactly one `supervisor.subscribe()` iterator (`:L24`), loops `next()` → `lifecycleEvent()` → `onEvent` → AG-UI projection, returns a stop closure (`:L64–L66`). Task 2 buffers the last `child_failed` inside this loop; the one-subscription shape is a constraint, not an accident (see R3). |
| `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L43–L53` | AG-UI projection | `createDelegatedAgentStep({ state, kind: "subagent", subagentType: event.childId, detail: { label: event.status } })`. Task 2 must leave these keys byte-identical (asserted in the Task 2 test). |
| `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L71–L92` | `lifecycleEvent(supervisor, event)` (module-private) | Switch over `SupervisorEvent`: `delegation_started` → `subagent_started` (`:L82`), `delegation_finished` → stopped with `event.status` (`:L83`), `delegation_rejected` → stopped `"denied"` (`:L85`), `delegation_error` → stopped `"failed"` (`:L87`), everything else (including `child_failed`) → `undefined` (`:L89`). Task 2 extends the `delegation_error` arm only. |
| `packages/prism-coding-tools/src/agent/lifecycle.ts:L68–L74` | `SubagentStoppedEvent` | `{ type, childId, delegationId, depth, status }`. Optional `failure`/`recovery` fields attach here; no union churn, no new kind. |
| `packages/prism-coding-tools/src/agent/lifecycle.ts:L59–L66` | `SubagentStartedEvent` | Unchanged in both modes. |
| `packages/prism-coding-tools/src/agent/lifecycle.ts:L88–L95` | `DEFAULT_LIFECYCLE_MAX_EVENT_BYTES` (16,384) / `HARD_…` (65,536), `DEFAULT_LIFECYCLE_MAX_REASON_BYTES` (1,024) / `HARD_…` (16,384) | The reason cap Task 2 reuses for truncation; `maxEventBytes` is the existing serialized-event ceiling. |
| `packages/prism-coding-tools/src/agent/lifecycle.ts:L149–L164` | `FROZEN_EVENT_TYPES` | Frozen shipped-kind set; `subagent_started`/`subagent_stopped` already in it. Task 2 adds **no** kind (R1). |
| `packages/prism-coding-tools/src/agent/lifecycle.ts:L188–L211` | `CodingLifecycleEmitter.emit` | Rejects unknown kinds (`:L191`) and oversized events (`:L192`); the only per-field reason cap today is `permission_denied.maxReasonBytes` (`:200`). A `subagent_stopped.failure.reason` is therefore covered by the event byte cap only — the bridge itself must truncate. |
| `scripts/phase10-freeze-manifest.json:L218–L230` | `lifecycleEventMapping` | Consumer gate: the two subagent rows name redacted ids + terminal status only (`:L229–L230`). Task 2 leaves the manifest untouched. |
| `packages/prism-core/src/runtime/supervisor/types.ts:L203–L215` | `child_failed` variant | `{ childId, delegationId, depth, reason, status?, limit?, stopReason?, usage? }`; the source of every `failure` field. `reason` is redacted at `safeError`. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L389–L419` | `settleDelegation` | Terminal seam that increments counters (`:L400–L404`) **before** publishing `child_failed` (`:L406–L418`); a stop consumer reading at `delegation_error` always sees the final row. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L1088–L1091` | `safeError` | `options.redactor?.redact(message) ?? message` — redacted but **not length-capped**. See G2. |
| `src/event-multiplexer.ts:L160` (also `:L4–L12`, `src/index.ts:L390`) | `EventMultiplexerError`, `EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE` | The supervisor stream is single-consumer; a second bridge subscription throws. |
| `packages/ag-ui/src/acp/mapper.ts:L103–L113` | ACP `subagent_started`/`subagent_stopped` mapping | Emits `agent_message_chunk` from `delegationId` + `childId` + status only. Optional fields on the stopped event cannot reach the wire. |
| `packages/ag-ui/src/ag-ui-mapper.ts:L396–L407` | `delegated_agent_step` projection | `ACTIVITY_SNAPSHOT` + `prism.delegated_agent_step` from the step object's allow-listed fields; unchanged. |
| `packages/prism-coding-tools/src/agent/__tests__/supervisor-lifecycle.test.ts:L26–L90` | bridge test fixture | Scripted `SupervisorEvent[]` with a fake `{ redact, subscribe }` source — the precedent Task 2's cases extend (and the shape the optional `summary` source must remain compatible with). |

### 1.2 Task 3 — exact `failureRadius` ancestry (delegation-id parent chain)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L47–L50` | `ChainContext` | `{ path, signal? }` only. Task 3 adds `parents?: readonly string[]` (ancestor delegation ids, oldest first). |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L70–L74` | `LiveDelegation` | `{ childId, path }`. Task 3 adds `chain` (`[...parents, delegationId]`), built once at start. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L308–L320` | `DelegationMapping` | Persisted durable mapping (`childId`, `delegationId`, `threadId`, `path`, `version`, `input`, report policy). Task 3 adds `parents` so a resumed delegation rebuilds the same chain — the same precedent as the persisted report policy. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L352–L361` | `noteDelegationStart` | Attempt/retry counters then `liveDelegations.set(delegationId, { childId, path })` at `:L360`. Task 3 records `chain` here. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L363–L366` | `hasLiveDelegation` | Linear scan over live entries; unaffected. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L368–L382` | `countLiveDescendants(path)` + the `ponytail:` comment | Prefix compare: skip shorter paths, then `path.every((step, index) => live.path[index] === step)`. The comment (`:L372–L373`) names the exact ceiling and the fix this task is. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L389–L419` | `settleDelegation` | Deletes the live row first (`:L397`), then `failureRadius += countLiveDescendants(path)` (`:L402`). |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L463` | path build | `const path = Object.freeze([...chain.path, request.childId])` — stays for cycle detection and depth; Task 3 adds the sibling `parents` build. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L476` | `noteDelegationStart` call site | Where `delegationId` becomes live. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L541` | nested delegate call site (live) | `delegate(nested, { path, signal: controller.signal })` — Task 3 adds `parents`. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L850` | nested delegate call site (resume) | `delegate(nestedRequest, { path: mapping.path, signal: controller.signal })` — Task 3 adds `parents: mapping.parents`. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L751–L760`, `:L762–L768` | `saveMapping`, `resumeNestedRun` | Where the mapping round-trips; `parents` rides the same checkpoint value (no second key, no new persistence surface). |
| `packages/prism-core/src/runtime/supervisor/limits.ts:L3–L6` | `HARD_MAX_ACTIVE_CHILDREN` (32), `HARD_MAX_DELEGATION_DEPTH` (16) | The bounds the scan is measured against in §6. |
| `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts:L999–L1028` | "counts only live descendants in the failure radius" | The existing single-subtree radius test; Task 3's concurrent-duplicate regression sits beside it. |

### 1.3 Task 4 — per-root-run counter read (`summary({ reset: true })`)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `packages/prism-core/src/runtime/supervisor/types.ts:L301` | `Supervisor.summary()` signature | No options today. Task 4 makes it `summary(options?: { readonly reset?: boolean })`, additive for every caller. |
| `packages/prism-core/src/runtime/supervisor/types.ts:L221–L232` | `SupervisorChildSummary` | `{ childId, attempts, retries, failures, failureRadius, outcome }` — the row both the read and the reset produce. |
| `packages/prism-core/src/runtime/supervisor/types.ts:L235–L238` | `SupervisorRunSummary` | `{ children }`, O(children). |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L347–L350` | `liveDelegations`, `childCounters` init | One counter row per allow-listed child, created at supervisor construction; reset writes zeroes back into these rows. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L421–L431` | `childSummary(childId)` | The single frozen-row builder both `summary()` (`:L954`) and the new reset path must reuse. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L954` | `summary: () => Object.freeze({ children: Object.freeze(children.map(...)) })` | The read; gains the optional `reset` branch. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L363–L366` + `:L404` | `hasLiveDelegation` | The only live-run signal; the reset path reuses it to report `outcome: "running"` vs `"idle"`. |
| `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts:L931–L997` | fail→retry→complete counters test | The cumulative regression pin Task 4 preserves. |
| `docs/supervisors.md:L46–L55`, `:L132` | Recovery telemetry + Related APIs | The docs the reset window and the bridge projection amend (`:L132` explicitly says the bridge "does not carry" the counters). |

### 1.4 Task 5 — carry plan-087 limit attribution on the result and `child_failed`

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/run-limits.ts:L320–L349` | `describeBudgetExhaustion(tracker, breach, recentToolCalls)` | Builds `{ limit, consumed, closestOtherAxes, recentToolCalls }`; the single attribution builder. Task 5 reuses the payload it already returns and moves it onto the result (keeping the function name). |
| `src/run-limits.ts:L297–L308` | `ATTRIBUTION_AXES`, `CLOSEST_AXIS_COUNT = 3` | The real axis bound: **3**, not the plan's "5" (see §5 refutation). |
| `src/contracts-run-state.ts:L365–L389` | `AgentRunResult` | `limit?: RunLimitBreach` at `:L378`; no `attribution`. Task 5 adds `attribution?`. (The plan cites `:L302–L330`, which is `AgentRunResumeOptions` in this tree — stale.) |
| `src/agent-session/session.ts:L534–L564` | `buildRunResult(input)` | Explicit field-by-field construction; `limit: input.limit` at `:L556`. Task 5 adds one input/output field. (Plan cites `:L394–L424`; stale.) |
| `src/agent-session/session/assemble.ts:L847–L861` | the breach block | `breach` (`:L848`), one `budget_exhausted` emit with the `describeBudgetExhaustion` spread (`:L851–L858`), then `buildRunResult({ … limit: breach … })`. Task 5 builds the payload once, emits it, and passes it to `buildRunResult`. (Plan cites `:L675–L690`; stale.) |
| `src/contracts-protocol.ts:L348–L356` | `budget_exhausted` event variant | `{ limit, consumed, closestOtherAxes, recentToolCalls }` — the field list the result type mirrors. |
| `packages/prism-core/src/governance/observability/timeline-types.ts:L96–L109` | `TimelineExhaustion` | The joined projection (`limit`/`maximum`/`observed` + the three attribution fields); the result field is the non-timeline twin, not a second shape. |
| `src/agent-session/session/tool-round.ts:L360`, `:L361–L368` | `RECENT_TOOL_CALL_LIMIT` (10), `recordRecentToolCall` | The `sha256:` argument-hash buffer (`toolEffectArgumentsHash`, same hash as the effect store). |
| `src/agent-session/session.ts:L141` | `activeRecentToolCalls?: ToolCallSummary[]` | The buffer `assemble.ts` passes in; Task 5 passes the same array into `buildRunResult`. |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L84–L90` | `ChildFailureAttribution` | The local optional-field type behind `child_failed`; Task 5 adds the three fields here. (Plan cites `:L86–L92`; off by two.) |
| `packages/prism-core/src/runtime/supervisor/supervisor.ts:L992–L1000` | `failureAttribution(result, reason)` | Copies `status`/`limit`/`stopReason`/`usage` from `result`; Task 5 adds `result.attribution`'s three fields, same pattern. |
| `packages/prism-core/src/runtime/supervisor/spawn-tool.ts:L176–L180`, `:L183–L197` | spawn/wait value projections | Explicit key lists (`childId`/`delegationId`, `status`, `usage`, `text`). Task 5 asserts these stay unchanged; no spread of the result object. |
| `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts:L931–L956` | limit-death + counters assertions | The precedent Task 5's `child_failed` attribution assertions extend. |
| `src/__tests__/public-export-contract.test.ts:L579`, `:L964–L977` | `FROZEN_TYPE_EXPORTS` | Pins `src/index.ts` type exports (`AgentRunResult`, `RunLimitBreach` are in it). See G8: a public `BudgetExhaustionAttribution` requires a deliberate array update, or the type stays module-only. |

---

## 2. Gap rows (what no current seam does)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | `lifecycleEvent` has no arm for `child_failed` (`supervisor-lifecycle.ts:L89` `default`), and the bridge keeps no state between events, so the `delegation_error` stop cannot name the failure. **Confirmed runnable, §5(a).** | `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts` | 2 |
| G2 | `child_failed.reason` is redacted but **not length-capped** (`safeError`, `supervisor.ts:L1088–L1091`; only `delegation input` has a byte bound). A pending-failure buffer that stores the event string verbatim is unbounded per entry, so the plan's "64 entries, bounded" claim is false unless the bridge truncates **at insert**. The Task 2 test with a 10 KB reason must fail a buffer that truncates only at attach. | `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts` | 2 |
| G3 | `ObserveSupervisorLifecycleOptions` has no failure/recovery options and the source type is `Pick<Supervisor, "redact" \| "subscribe">` (`:L20`), so no `summary` row is reachable from the bridge. A `summary?: …` addition must stay optional or every existing fake-source test and host stops compiling. | `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts` (+ its tests) | 2 |
| G4 | `countLiveDescendants` matches the **child-id path prefix** (`supervisor.ts:L368–L382`), so two concurrent `lead` delegations that each hold a live `writer` both match the path `[lead, writer]`. **Confirmed runnable: `failureRadius: 2` where 1 descendant exists, §5(b).** | `packages/prism-core/src/runtime/supervisor/supervisor.ts` | 3 |
| G5 | Neither `ChainContext` (`:L47–L50`), `LiveDelegation` (`:L70–L74`), the two nested call sites (`:L541`, `:L850`), nor `DelegationMapping` (`:L308–L320`) carries delegation-id ancestry; the resume path has no way to rebuild one. | `prism-core/…/supervisor.ts` | 3 |
| G6 | `summary()` takes no arguments (`types.ts:L301`, `supervisor.ts:L954`); there is no reset window, no per-window `outcome`, and no way to read "this root run" without diffing snapshots. **Confirmed runnable, §5(c).** | `prism-core/…/types.ts`, `supervisor.ts` | 4 |
| G7 | There is no root-run boundary the supervisor can observe: `activeChildren === 0` also happens between two delegations of the same root run, and a turn boundary is not a root-run boundary. No `supervisor_run_summary` event can be correct; the reset is host-driven by design. | documented non-change (`docs/supervisors.md`) | 4 |
| G8 | `AgentRunResult` has no `attribution` (`contracts-run-state.ts:L365–L389`); `describeBudgetExhaustion`'s payload is consumed only by the emit (`assemble.ts:L851–L858`); `buildRunResult` has no input for it (`session.ts:L534–L564`); `failureAttribution` copies nothing from it (`supervisor.ts:L992–L1000`). **Confirmed runnable, §5(d).** | `src/run-limits.ts`, `src/contracts-run-state.ts`, `src/agent-session/session.ts`, `src/agent-session/session/assemble.ts`, `supervisor.ts` | 5 |
| G9 | New type placement: `describeBudgetExhaustion` returns an inline structural type today. Task 5's `BudgetExhaustionAttribution` must be declared in `src/run-limits.ts`, but `src/index.ts` does **not** re-export `describeBudgetExhaustion` (only `createRunLimitTracker`, `RunLimitError`, …) and `public-export-contract.test.ts` pins `src/index.ts` type exports in `FROZEN_TYPE_EXPORTS`. Task 5 must either add the type (and update both frozen arrays deliberately) or state that it is nameable only from the module. `AgentRunResult`/`RunLimitBreach` are public today, so module-only would be the inconsistent choice. | `src/run-limits.ts`, `src/index.ts`, `src/__tests__/public-export-contract.test.ts` (decision + deliberate update) | 5 |
| G10 | Docs claim check: `docs/supervisors.md:L53` documents `failureRadius` **without** a concurrency caveat, and `docs/runs-and-usage.md:L66` already says "the three closest other axes". The plan's "the docs qualification disappears" and "5 closest axes" are stale in opposite directions — see §5 refutations. | `docs/supervisors.md` (precision edit, not caveat removal) | 3/5 |

---

## 3. Per-task decision (reuse as-is / extend / add new)

| Task | Decision | Named seams |
| --- | --- | --- |
| 2 | **Extend** (no public removal, no new kind): two default-off booleans on `ObserveSupervisorLifecycleOptions`; optional `failure`/`recovery` fields on `SubagentStoppedEvent`; a module-private pending-failure buffer (64 entries, truncate-at-insert) inside the existing observer loop; optional `summary`-capable source type; `child_failed` already arrives on the single subscription. Nothing changes in `FROZEN_EVENT_TYPES`, `lifecycleEventMapping`, the ACP mapper, or the AG-UI projection. | §1.1; G1–G3 |
| 3 | **Extend**: `ChainContext.parents`, `LiveDelegation.chain`, `noteDelegationStart` records the chain, `countLiveDescendants` becomes `chain.includes(delegationId)`, both nested call sites thread `parents`, `DelegationMapping` persists them for the resume rebuild; the `ponytail:` caveat is retired. `path` stays for cycle detection/depth/mappings. No new public type. | §1.2; G4, G5 |
| 4 | **Extend**: `summary(options?: { reset?: boolean })` — one additive signature on `types.ts:L301` and one branch at `supervisor.ts:L954`, both routed through `childSummary` (`:L421–L431`); `outcome` after reset is `hasLiveDelegation ? "running" : "idle"`. No event. | §1.3; G6, G7 |
| 5 | **Extend**: declare `BudgetExhaustionAttribution` in `src/run-limits.ts` (from the existing return shape), add `AgentRunResult.attribution?`, pass the payload through `buildRunResult` from the breach site, copy the three fields onto `ChildFailureAttribution` in `failureAttribution`. `describeBudgetExhaustion` keeps its name and call sites; the tool projections stay explicit. | §1.4; G8, G9 |

---

## 4. Rejected alternatives (frozen)

None may reappear as an implementation without a new review row.

| # | Rejected | Task | Reason |
| --- | --- | --- | --- |
| R1 | A new `subagent_failed` lifecycle kind | 2 | `FROZEN_EVENT_TYPES` (`lifecycle.ts:L149–L164`) is consumer-gated: the ACP mapper falls through to `[]` (`mapper.ts:L113`) and `lifecycleEventMapping` ships only consumed kinds. An optional field on the stopped event needs neither a consumer nor a manifest change. |
| R2 | **Always attach** failure details (no opt-in) | 2 | `docs/agent-events.md:L113` and `docs/acp.md:L60` promise delegation error text never crosses the bridge; lifecycle consumers may forward events to third-party timelines. Opt-in keeps the promise for existing hosts. |
| R3 | A **second supervisor subscription** inside the bridge for `child_failed` | 2 | The supervisor stream is single-consumer (`EventMultiplexerError`, `src/event-multiplexer.ts:L160`), and `child_failed` already arrives on the bridge's one iterator — the buffer only has to remember it until the stop. |
| R4 | **Read counters on `child_failed`** instead of at stop | 2 | Counters settle in the same publish step (`settleDelegation` `:L400–L418`), but `outcome` is only final once the delegation row is deleted; stopping is the first moment the row is terminal for that delegation. Reading earlier can also race a same-child re-dispatch. |
| R5 | Widen the source parameter to **require `summary`** | 2 | The documented `Pick<Supervisor, "redact" \| "subscribe">` (`supervisor-lifecycle.ts:L20`) is what hosts and the existing fake-source tests pass; an optional `summary` keeps them compiling and simply omits counters. |
| R6 | **Forward `usage`/`recentToolCalls`** (and `usage` again) on the lifecycle event | 2 | No lifecycle consumer needs them, `usage` already rides `child_failed`, and it is the largest field — exactly what the opt-in boundary exists to keep off third-party timelines. |
| R7 | **Keep the path prefix and dedupe by depth** | 3 | Structural, not a bug of depth: two concurrent `lead` runs at the same depth produce identical `[lead, writer]` paths. §5(b) shows `failureRadius: 2` for one descendant. |
| R8 | Store only `parentDelegationId` per entry and walk parents transitively on settle | 3 | Same information with one indirection per ancestor per scan; a recorded `chain` array is simpler, built once, and persists directly in the existing mapping. |
| R9 | Track descendants in a **reverse index** | 3 | Deletion on every settle plus index maintenance for a metric whose scan is bounded by 32 live entries and runs once per failure. |
| R10 | Key the registry by **`path + delegationId`** | 3 | `delegationId` is already unique per delegation; the child-id path is the wrong key and is exactly what overcounts. |
| R11 | A separate **`resetSummary()`** method | 4 | Two entry points for one window operation; the read+reset pair is what a host actually calls (`summary({ reset: true })` at root-run start). |
| R12 | Emitting **`supervisor_run_summary`** when `activeChildren` reaches 0 | 4 | The count also reaches 0 between two delegations of one root run, and a turn boundary is not a root-run boundary; the supervisor has no root-run seam to hook (G7). |
| R13 | `summary({ since: marker })` windows | 4 | Hosts already hold the previous snapshot; a marker adds retained state for a diff they can compute themselves. |
| R14 | **Resetting on `delegate()`** of the first child | 4 | A root run can delegate twice; implicit resets make the counters untrustworthy and the window unknowable. |
| R15 | A **supervisor-side subscription** to the child's `budget_exhausted` event | 5 | Needs an always-on subscription per delegation (against the single-consumer stream) and only works when the reporting pump already runs; the result path costs nothing extra. |
| R16 | **Re-derive** the counters from `result.usage` | 5 | `usage` has no per-axis counters, request bytes, axis ratios, or tool-call hashes (`ATTRIBUTION_AXES`, `src/run-limits.ts:L297–L308`). |
| R17 | Put the **full `TimelineExhaustion`** (`limit`/`maximum`/`observed`) on the result | 5 | `result.limit` already carries the breach (`contracts-run-state.ts:L378`); duplicating it in the attribution would give the same fact two sources. |
| R18 | Add a **second core event** (`child_failed` relayed from the pump) | 5 | `child_failed` is the single supervisor failure record; splitting it would make consumers join again — the exact problem this task closes. |
| R19 | **Prose findings** in the plan instead of an evidence file | 1 | The repo's primitive-review gate reads a file and named tokens (`scripts/plan-review-gate.test.mjs`); prose cannot be checked and drifts. |
| R20 | **Skipping the review** because the follow-ups are small | 1 | Two of the four tasks change a public shape (a coding lifecycle event, `AgentRunResult`) and need the current spans and measured costs recorded before they move. |

---

## 5. Confirmation (runnable observation)

Probe: `.phase108-probe.mjs` (not committed; deleted after this review), against the working-tree `dist/`
build, Node v26.8.2, `node --expose-gc`. Raw observations:

```
A radius-after-lead1-failure: lead={attempts:2,retries:0,failures:1,failureRadius:2,outcome:running}
  writer.outcome=running  other.failureRadius=0
B result.limit: {limit:"maxToolCalls",maximum:1,observed:2}   result.attribution: undefined
  budget_exhausted keys: closestOtherAxes,consumed,limit,recentToolCalls,runId,sessionId,type
B2 child_failed keys: childId,delegationId,depth,limit,reason,status,type,usage
C bridge kinds: subagent_started,subagent_stopped
  subagent_stopped keys: childId,delegationId,depth,status,type
D summary.length: 0
  summary({reset:true}) row: {attempts:1,retries:0,failures:1,failureRadius:0,outcome:failed}
PROBE OK
```

- **(a) CONFIRMED — `lifecycleEvent` returns nothing for `child_failed`.** With the bridge wired to a real
  supervisor and `includeFailure`/`includeRecovery` passed as extra JS keys, the bridge emitted exactly
  `subagent_started,subagent_stopped` for a limit-failed child — no third event, and the stopped event's key
  set was exactly `childId,delegationId,depth,status,type` (no `failure`, no `recovery`). The same
  supervisor's raw stream carried `child_failed` with `limit`, so the information exists and is dropped at
  `supervisor-lifecycle.ts:L89` `default`.
- **(b) CONFIRMED — the path-prefix radius overcounts concurrent duplicate subtrees.** Two concurrent
  `lead` delegations each spawned a live nested `writer`; failing the first reported
  `failureRadius: 2` for a subtree with one live descendant, because both writers carry the path
  `[lead, writer]`. The unrelated live `other` child kept `failureRadius: 0`, and the nested writer stayed
  `running` after the parent failed (no cascade), exactly as the current docs describe.
- **(c) CONFIRMED — `summary()` accepts no options.** `supervisor.summary.length === 0`, and
  `summary({ reset: true })` returned the cumulative row `{ attempts: 1, failures: 1, outcome: "failed" }`
  and left `summary()` deep-equal — the extra argument is ignored, there is no reset window.
- **(d) CONFIRMED — a limit death has `result.limit` and no attribution.** A direct run with
  `limits: { maxToolCalls: 1 }` rejected with `AgentRunError`; `error.result.limit` was
  `{ limit: "maxToolCalls", maximum: 1, observed: 2 }`, `error.result.attribution` was `undefined`, and the
  **same run's** `budget_exhausted` event carried `consumed`/`closestOtherAxes`/`recentToolCalls`
  (472 JSON bytes). Under a supervisor, `child_failed` carried
  `childId,delegationId,depth,limit,reason,status,type,usage` — the three attribution fields are absent, so
  a host must join `delegation_child_event` with `child_failed` (and only for `report: "stream"` children).

**Refuted by the same probe:**

- The plan's "5 closest axes" is stale: `CLOSEST_AXIS_COUNT = 3` (`src/run-limits.ts:L308`), the probe
  measured 3 axes, and `docs/runs-and-usage.md:L66` already documents "the three closest other axes". Task
  5's "≤ 5 axes" bound should be read as the real ≤ 3.
- The plan's claim that "the docs qualification" on `failureRadius` disappears is half stale:
  `docs/supervisors.md:L53` has no concurrency caveat to remove; the only documented qualification is the
  source `ponytail:` comment (`supervisor.ts:L372–L373`). Task 3 is a precision edit, not a removal.
- **Stale spans** (the §1 spans are authoritative): `contracts-run-state.ts:L302–L330` →
  `AgentRunResult` is `:L365–L389`; `session.ts:L394–L424` → `buildRunResult` is `:L534–L564`;
  `assemble.ts:L675–L690` → the breach block is `:L847–L861`; `run-limits.ts:L300–L334` →
  `describeBudgetExhaustion` is `:L320–L349`; `supervisor.ts:L86–L92` → `ChildFailureAttribution` is
  `:L84–L90`; `supervisor.ts:L365–L383` → `countLiveDescendants` is `:L368–L382`; `childSummary` is
  `:L421–L431`, not `:L408–L418`; `lifecycle.ts:L150–L165` → `FROZEN_EVENT_TYPES` is `:L149–L164`.

---

## 6. Measured costs (numbers, not claims)

Same probe; medians over 21 batches of 2,000–20,000 runs after warmup. Regression baselines only — the
shipping suites named per task assert bounds; the harness is not committed.

| Path | Measured | Consequence for the task |
| --- | --- | --- |
| One failure-radius scan, 32 live delegations × 16-long chain — today's path-prefix loop / the planned `chain.includes(delegationId)` loop | **75–77 ns / 547–751 ns** per scan | Both are sub-microsecond and run once per failure; the exactness fix costs ≈0.5 µs at the hard bound, not a throughput question. |
| Pending-failure buffer at its bound: 64 entries, 1,123 B JSON each (`reason` at the 1,024 B cap + `limit` + `stopReason`), distinct strings | **11,136 B retained heap, 71,872 B serialized**; `Map` replace-set **24 ns**, set+delete **127 ns** | The buffer is O(1) per event and its whole bound is ≈72 KiB serialized / ≈11 KiB retained. **G2**: this holds only if the bridge truncates `reason` at insert; a 10 KB `child_failed.reason` stored verbatim would be ≈640 KB at the bound. |
| `supervisor.summary()` (real API, no runs): 32 / 128 / 512 allow-listed children | **1,157 ns / 4,602 ns / 19,114 ns** (≈36 ns per child, linear) | O(children) confirmed; there is no children-count ceiling in code (only `≥1` at `supervisor.ts:L334`), so 32 is the hard live bound and 128/512 show the slope. |
| The planned reset, 32 rows re-zeroed through the `childSummary` shape | **485 ns** | The reset is the same O(children) loop as the read; no per-turn cost, counters stay incremental. |
| Worst-case `AgentRunResult.attribution` — real `describeBudgetExhaustion` payload with 10 `sha256:` tool hashes | **1,377 JSON bytes** (3 axes + 10 calls); the real-run `budget_exhausted` payload measured **472 B** with one dispatched call | The added result field is ≤ ~1.4 KiB worst case, copied once at the breach (no new work), and the same bytes already ride the existing event. |
| Worst-case `subagent_stopped` with `failure` (1,024 B reason) + `recovery` | **1,321 JSON bytes** vs `DEFAULT_LIFECYCLE_MAX_EVENT_BYTES` **16,384** | Comfortably inside the existing event cap with the reason bound, which is why `DEFAULT_LIFECYCLE_MAX_REASON_BYTES` is the right cap to reuse. |

---

## 7. Security confirmations and hard rejections

Every Task 2 field on the coding lifecycle event, per the source that populates it:

- `failure.reason` — the supervisor's `safeError` output (`supervisor.ts:L1088–L1091`): the child's
  **redacted** error/limit message, then truncated **at buffer insert** to
  `DEFAULT_LIFECYCLE_MAX_REASON_BYTES` (1,024) by the bridge, with no suffix so the cap is exact. It is
  never child input, output, path, tool argument, or tool result; redaction happens at the supervisor
  boundary. **G2 is a memory bound, not a disclosure bound**: storing the untruncated string would
  raise the buffer cost at the 64-entry bound, so truncate at insert.
- `failure.limit` — the fired `RunLimitName` axis (an enum string) mapped from `child_failed.limit`; the
  raw `RunLimitBreach` (`maximum`/`observed` integers) stays on the supervisor event. No child-derived
  text either way.
- `failure.stopReason` — an `AgentFinishReason` enum string.
- `recovery.attempts` / `retries` / `failures` / `failureRadius` — integers from `childCounters`
  (`supervisor.ts:L347–L350`); counts only.
- `recovery.outcome` — a `SupervisorChildOutcome` enum string.
- `childId`/`delegationId`/`depth`/`status` — unchanged from today (ids already pass `supervisor.redact` at
  `supervisor-lifecycle.ts:L76–L77`; `status` is an `AgentRunStatus`). ACP (`mapper.ts:L103–L113`) and AG-UI
  (`ag-ui-mapper.ts:L396–L407`) consume only these, so the new fields never reach a wire payload; the two
  options default off, so existing subscribers see byte-identical events.

Every Task 5 field, per the plan-087 contract it reuses:

- `attribution.consumed` — `{ turns, inputTokens, providerAttempts, requestBytes }`: integers from
  `RunLimitTracker.snapshot()`.
- `attribution.closestOtherAxes` — `{ axis: RunLimitName, usedRatio: number }` rows: enums and a rounded
  ratio; no cap values beyond the axes' own numbers.
- `attribution.recentToolCalls` — `{ id, name, argHash }` where `argHash` is `sha256:` over the canonical
  arguments (`tool-round.ts:L361–L368`, same hash as the effect store). Tool **names** are already
  model-visible; raw arguments never enter the event, the result, the transcript, or telemetry.
- The `child_failed` copy carries the same three fields, so it inherits the same hashes/counters and keeps
  its existing redacted `reason`; `usage` keeps its current source. No new persisted bytes anywhere.
- `spawn_agent`/`delegate_agent` value projections stay explicit key lists
  (`spawn-tool.ts:L176–L180`, `:L183–L197`): attribution must not be spread into a model-visible tool
  result.

---

## 8. Evidence-artifact scope

Read-only for the tree: this file adds no code, no test, and no docs navigation. `docs/index.md` is not
touched (evidence files are not navigation targets, `.agents/skills/create-plan/references/prism-wiki.md`).
Tasks 2–5 must cite a row from §1/§2; any new primitive they need that is absent here is a review gap and
must be added to §2 before implementation. Task 2 must carry G2 (truncate at insert) and Task 5 must decide
G9 (public type export) as part of their implementation; everything else in this review is an extension of
an existing seam.

**Status.** Task 3 landed (2026-09-21): G1 is retired. `countLiveDescendants` scans the delegation-id
`chain` frozen once per start (`ChainContext.parents` at both nested call sites, `DelegationMapping.parents`
for resumptions), so concurrent delegations of the same child id stay distinct and §2's 567 ns/op
`chain.includes` figure now describes the shipped scan while the 74.7 ns/op path-prefix variant is gone.
The resume path also gained the live path's terminal seam — a resumed run that dies settles, publishes its
terminal error and runs the terminal hook, with pre-run rebuild errors still silent — because a resumed
failure previously left `failures: 0`/`outcome: "running"` and could not be observed by any radius case.

**Task 5 landed (2026-09-21): G9 is decided — public.** `BudgetExhaustionAttribution` is declared in
`src/run-limits.ts` (the shape `describeBudgetExhaustion` already returned), exported from `src/index.ts`,
and pinned in `FROZEN_TYPE_EXPORTS`; the `@arnilo/prism` export ceiling was rebaselined 1458 → 1459 with a
recorded reason. The payload is built once at the timeline breach site and shared by the `budget_exhausted`
event, `AgentRunResult.attribution` (`limit` omitted — the breach stays in `result.limit`), and
`child_failed`'s `consumed`/`closestOtherAxes`/`recentToolCalls`. §1.4's `spawn-tool.ts` projection rows hold:
the model-visible values stay explicit key lists and a limit-failed child reaches the model as an error result
with no value at all. §5's refutation stands in the shipped code: the axis bound is `CLOSEST_AXIS_COUNT = 3`.
**Follow-up execution (2026-09-21): both medium items from the plan's Further Actions landed.** (1) G1's
remaining precision gap is closed for resumes: `noteLiveDelegation` registers a delegation that resumes in a
live registry (`resumeNestedRun`'s `onSession`, i.e. after the resume guardrails, so a stale or foreign resume
never registers), removed on settle, and the resumed id re-bases the instance's delegation counter — a fresh
instance numbers its first delegation `-1` again, so without the re-base a start after the resume would take
the resumed id and its settle would delete the resumed entry (the test fails on either half). §2's 567 ns
`chain.includes` scan still describes the shipped radius; the registry gains no new scan. Residual ceiling,
now stated in `docs/supervisors.md`: a suspended child that is never resumed is not counted, because nothing
runs for it in the new process. (2) Task 5's reachability gap is closed: `SupervisorLimitError` carries
`result?: AgentRunResult` and the limit-to-error conversion passes the child's terminal result, matching the
plain-failure path that already rethrows the child's `AgentRunError` with its `result` — supervisor-level
ceilings (depth, active children, timeouts, cycle, input bytes) carry none, and nothing new reaches the model
or the wire (`spawn-tool.ts` still returns only the redacted message).
