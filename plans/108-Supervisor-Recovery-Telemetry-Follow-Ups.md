# Supervisor Recovery Telemetry Follow-Ups: Failure Bridge, Exact Radius, Per-Run Counters, Limit Attribution

Release: 0.9.x follow-up to plan 093, recorded from that plan's Further Actions. Not part of plan 099's 0.9.0 cut unless a host pulls it forward first: plan 093 already ships correct, documented behavior (redacted `child_failed` attribution, blast-radius counters, a coding-lifecycle bridge), and these tasks close the four seams it named — the coding bridge drops `child_failed` and the recovery counters, `failureRadius` ancestry is a child-id path prefix, `summary()` has no per-root-run reset, and `child_failed` omits the child's own `budget_exhausted` counters.

## Objectives
- Let a coding host read supervisor child failure and recovery without subscribing to the supervisor directly: `observeSupervisorLifecycle` gains opt-in, bounded, redacted failure attribution and per-child counters on the `subagent_stopped` event it already emits — default-off, no new lifecycle event kind, no change to the ACP/AG-UI payloads.
- Make `failureRadius` exact: ancestry becomes the delegation-id parent chain instead of the child-id path prefix, so concurrent same-child subtrees at the same depth cannot overcount a blast radius.
- Give hosts a per-root-run counter read (`summary({ reset: true })`) instead of snapshot diffing, without inventing a root-run end event the supervisor cannot observe.
- Carry the child's own plan-087 limit attribution (`consumed`, `closestOtherAxes`, `recentToolCalls`) onto `child_failed`, so a host no longer joins `delegation_child_event` with `child_failed` to answer "which axis fired and how close were the others".

## Expected Outcome
- With `includeFailure: true`, the `subagent_stopped` for a failed child carries `failure: { reason, limit?, stopReason? }` (the supervisor's redacted reason, truncated to `DEFAULT_LIFECYCLE_MAX_REASON_BYTES`); with `includeRecovery: true`, it carries `recovery: { attempts, retries, failures, failureRadius, outcome }` read from `supervisor.summary()`. Both default off, so existing subscribers see byte-identical events, and no new `CodingLifecycleEvent` kind is added.
- `failureRadius` counts the live task-lifetime descendants of the failed **delegation** (delegation-id ancestry), not of any live delegation sharing the child-id path prefix; the `ponytail:` caveat in `supervisor.ts` and the docs qualification disappear.
- `supervisor.summary({ reset: true })` zeroes `attempts`/`retries`/`failures`/`failureRadius` and reports `outcome` as `running` (a delegation is live) or `idle`; `summary()` without the flag keeps today's cumulative contract, and no `supervisor_run_summary` event is added.
- `AgentRunResult.attribution` (`consumed`, `closestOtherAxes`, `recentToolCalls`) is set on a limit death at the same site that emits `budget_exhausted`, and `child_failed` copies it; model-visible `spawn_agent`/`delegate_agent` tool results are unchanged.

## Tasks

- [x] Task 1: Primitive review — the four follow-up seams
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase108-primitive-review.md` exists with three sections — (a) reuse rows for every primitive the later tasks build on, each with a `path:line` span, (b) gap rows naming what no current seam does, (c) rejected alternatives with the reason (including every Rejected item below).
    - Functional: the review states, per later task, whether it reuses a seam as-is, extends it, or adds a new one — Task 2 (`lifecycleEvent` at `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L71-L92`, `ObserveSupervisorLifecycleOptions` at `:L5-L16`, `SubagentStoppedEvent` at `packages/prism-coding-tools/src/agent/lifecycle.ts:L68-L74`, the frozen kind list at `:L150-L165`, `lifecycleEventMapping` in `scripts/phase10-freeze-manifest.json`), Task 3 (`ChainContext` at `packages/prism-core/src/runtime/supervisor/supervisor.ts:L47-L50`, `noteDelegationStart` at `:L352-L362`, `countLiveDescendants` at `:L365-L383`, `settleDelegation` at `:L389-L407`, the nested call sites at `:L541` and `:L850`, `DelegationMapping` at `:L308-L320`), Task 4 (`summary()` at `packages/prism-core/src/runtime/supervisor/types.ts:L301`, `summary: () =>` at `supervisor.ts:L954`, `childSummary` at `:L408-L418`), Task 5 (`AgentRunResult` at `src/contracts-run-state.ts:L302-L330`, `buildRunResult` at `src/agent-session/session.ts:L394-L424`, the breach block at `src/agent-session/session/assemble.ts:L675-L690`, `describeBudgetExhaustion` at `src/run-limits.ts:L300-L334`, `ChildFailureAttribution`/`failureAttribution` at `supervisor.ts:L86-L92`/`:L992-L1000`, the spawn tool's value projection at `packages/prism-core/src/runtime/supervisor/spawn-tool.ts:L179`/`:L189-L196`).
    - Functional: the review confirms or refutes, with a runnable observation, that (a) `lifecycleEvent` returns nothing for a `child_failed` event, (b) the path-prefix radius overcounts two concurrent `[lead, writer]` subtrees when one `lead` fails, (c) `summary()` accepts no options, and (d) a child that died on a limit has `result.limit` and no attribution counters because `assemble.ts:L683` computes `describeBudgetExhaustion` only for the event.
    - Performance: the review records measured numbers, not claims — the bridge's pending-failure buffer cost at its bound, one radius scan over `HARD_MAX_ACTIVE_CHILDREN` (32) live delegations × `HARD_MAX_DELEGATION_DEPTH` (16) chain length, one `summary()` read plus one reset at the allow-list maximum, and the bytes a worst-case `AgentRunResult.attribution` adds to a result (5 closest axes, 10 `sha256:` tool hashes).
    - Code Quality: the review is deterministic evidence, not prose; every reuse row names the exact exported symbol, every gap row names the file that would have to change, and each rejected alternative names the task it would have affected. It also adds the matching `PLAN_108_TASK_1` block to `scripts/plan-review-gate.test.mjs` (plan path, evidence path, required tokens, rejected tokens) so the review cannot silently drift.
    - Security: the review states, for every field Task 2 adds to a coding lifecycle event and every field Task 5 adds to a result, why it carries no child input, output, path, or tool argument (counts and enums; the reason is the supervisor's redacted `safeError` string; `recentToolCalls` are hashes).
  - Approach:
    - Documentation Reviewed:
      - Plan 093 `Compromises Made` + `Further Actions` (the source of every task here); `docs/supervisors.md` (Recovery telemetry, `child_failed`, Related APIs); `docs/agent-events.md:L110-L112` (child reporting and `child_failed`); `docs/acp.md:L60` (ACP subagent row); `docs/coding-agent-tools.md:L617`; `docs/runs-and-usage.md:L66` (`result.limit` and the `budget_exhausted` attribution); `scripts/phase10-freeze-manifest.json` (`lifecycleEventMapping` consumer gate).
    - Options Considered:
      - Prose findings in the plan instead of an evidence file — rejected: the repo's primitive-review gate reads a file and named tokens, so prose cannot be checked and drifts.
      - Skipping the review because the follow-ups are small — rejected: two of the four tasks change a public shape (a coding lifecycle event field, `AgentRunResult`) and need the current spans recorded before they move.
    - Chosen Approach: one evidence file mapping every 093 Further Action to an existing primitive, a gap, or an extension, with spans and measured costs, plus the `PLAN_108_TASK_1` gate block, before any task touches code.
    - API Notes and Examples:
      ```text
      reuse: packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L71-L92   lifecycleEvent switch        → Task 2 (extend: buffer + failure/recovery fields)
      reuse: packages/prism-coding-tools/src/agent/lifecycle.ts:L68-L74            SubagentStoppedEvent          → Task 2 (extend: optional fields, no new kind)
      gap:   supervisor-lifecycle.ts:L88                                           delegation_error → status "failed", attribution dropped → Task 2
      gap:   supervisor.ts:L365-L383                                              radius by child-id path prefix → Task 3
      gap:   supervisor.ts:L954                                                   summary() has no reset window  → Task 4
      gap:   src/agent-session/session/assemble.ts:L683                            describeBudgetExhaustion() is event-only → Task 5
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase108-primitive-review.md` (new).
      - `scripts/plan-review-gate.test.mjs`: `PLAN_108_TASK_1` block.
    - References:
      - `scripts/plan-review-gate.test.mjs` (evidence gate shape), plan 104 Task 1 (the closest sibling review shape), `docs/_evidence/` naming (`phase74-primitive-review.md`).
  - Test Cases to Write:
    - The gate block itself: `scripts/plan-review-gate.test.mjs` fails when the evidence file is missing or stops naming a required token. **Done** — `PLAN_108_TASK_1` (plan path, evidence path, 33 required tokens, 20 rejected tokens); `node --test scripts/plan-review-gate.test.mjs` passes 3/3.
    - Runnable observation for the radius overcount and the dropped attribution: done as a scratch `.phase108-probe.mjs` probe (not committed, deleted after the review) against the working-tree `dist/` build; raw output and the four confirmations are the evidence §5. The permanent regressions stay Task 3 ("concurrent duplicate subtrees") and Task 5 ("limit death carries attribution") cases.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — the evidence file and the gate block are internal review artifacts.
    - Docs pages to create/edit: none (`docs/_evidence/` is not a navigation surface).
    - `docs/index.md` update: no — no behavior delta, and evidence files are not navigation targets.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (evidence files are not navigation targets).

- [x] Task 2: Project child failures and recovery counters onto the coding lifecycle stream
  - Acceptance Criteria:
    - Functional: `ObserveSupervisorLifecycleOptions` (`supervisor-lifecycle.ts:L5-L16`) gains `includeFailure?: boolean` and `includeRecovery?: boolean`, both default `false`; with both absent the emitted events are byte-identical to today.
    - Functional: with `includeFailure: true`, the `subagent_stopped` produced from a `delegation_error` that followed a `child_failed` carries `failure: { reason: string; limit?: RunLimitName; stopReason?: AgentFinishReason }`, populated from that `child_failed` event. The reason is the supervisor's already-redacted string and is truncated to `DEFAULT_LIFECYCLE_MAX_REASON_BYTES`; `delegation_finished` and `delegation_rejected` never carry `failure` even when the option is on.
    - Functional: with `includeRecovery: true`, that same event carries `recovery: { attempts, retries, failures, failureRadius, outcome }` read from `summary()` for the stopped `childId`; when the source object exposes no `summary` the field is omitted instead of throwing. `subagent_started` is unchanged in both modes.
    - Functional: no new `CodingLifecycleEvent` kind is added (the frozen list at `lifecycle.ts:L150-L165` and `lifecycleEventMapping` stay as they are), so the ACP mapping (`docs/acp.md:L60`) and the AG-UI `delegated_agent_step` projection (`supervisor-lifecycle.ts:L52`) keep carrying only ids, depth, and status.
    - Performance: one buffered `child_failed` per delegation id, O(1) insert and delete, bounded to 64 pending entries (oldest dropped) and cleared on stop; the bridge keeps exactly one supervisor subscription; one `summary()` read per stop, O(children).
    - Code Quality: the two options are independent, default-off booleans; the new event fields live on `SubagentStoppedEvent` as optional fields (no union churn); the bridge maps supervisor types into locally declared coding-tool types so the lifecycle module keeps no core-supervisor type import; types are exported from the coding-tools agent surface with the rest of the lifecycle events.
    - Security: the default-off path preserves the documented promise that no delegation error text crosses the bridge; when enabled, the carried reason is the supervisor's redacted `safeError` output, bounded, and never child input, output, paths, tool arguments, or tool results; counters are integers and enums; ACP and AG-UI payload keys are asserted unchanged.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md:L110-L112` (bridge sentence and the child reporting paragraph); `docs/coding-agent-tools.md:L617` (Related APIs); `docs/acp.md:L60` and `:L119` (ACP mapping and wiring); `docs/supervisors.md` (`child_failed` fields, Recovery telemetry, Related APIs); `packages/prism-coding-tools/src/agent/lifecycle.ts:L1-L6` (consumer-gated freeze note); `scripts/phase10-freeze-manifest.json` (`lifecycleEventMapping`).
    - Options Considered:
      - A new `subagent_failed` lifecycle kind — rejected: the phase-10 freeze ships only kinds with a consumer, the ACP mapper has no mapping for a new kind, and an optional field on the stopped event needs neither a consumer nor a manifest change.
      - Always attach failure details (no opt-in) — rejected: the docs promise error text never crosses this bridge, and lifecycle consumers may forward events to third-party timelines; opt-in keeps that promise true for existing hosts.
      - A second supervisor subscription inside the bridge for `child_failed` — rejected: the supervisor stream is single-consumer (`EventMultiplexerError`), and `child_failed` already arrives on the bridge's one subscription.
      - Read counters on `child_failed` instead of at stop — rejected: the counters settle in the same publish step, and stopping is the only point where the row is final for that delegation.
      - Widen the source parameter to require `summary` — rejected: the documented `Pick<Supervisor, "redact" | "subscribe">` shape is what hosts and tests pass; an optional `summary` keeps them compiling and simply omits counters.
      - Forward `usage`/`recentToolCalls` — rejected: no lifecycle consumer needs them and they are the largest fields.
    - Chosen Approach: buffer the last `child_failed` per delegation id inside the existing observer loop, attach it (opt-in) to the stopped event that `delegation_error` produces, and read the per-child summary row (opt-in) at that same moment.
    - API Notes and Examples:
      ```ts
      // packages/prism-coding-tools
      observeSupervisorLifecycle(supervisor, {
        onEvent: lifecycle.emit,
        includeFailure: true,
        includeRecovery: true,
      });
      // onEvent receives, for a failed child:
      // {
      //   type: "subagent_stopped", childId, delegationId, depth, status: "failed",
      //   failure: { reason: "run limit: maxToolCalls", limit: "maxToolCalls", stopReason: "turn_limit" },
      //   recovery: { attempts: 2, retries: 1, failures: 1, failureRadius: 0, outcome: "failed" },
      // }
      // `failure.limit` is the fired `RunLimitName` axis; the raw `child_failed.limit` keeps the full
      // `RunLimitBreach` (maximum/observed). `stopReason` is an `AgentFinishReason` (`turn_limit`,
      // `token_limit`, `refusal`, `host_policy`, `hook_limit`) — there is no `"tool_calls"` member.
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts`: options, pending-failure buffer, `lifecycleEvent` failure/recovery attachment, `summary`-capable source type.
      - `packages/prism-coding-tools/src/agent/lifecycle.ts`: optional `failure`/`recovery` fields on `SubagentStoppedEvent` plus their local types (reuse `DEFAULT_LIFECYCLE_MAX_REASON_BYTES`).
      - `packages/prism-coding-tools/src/agent/index.ts`: export `SubagentFailure`, `SubagentRecovery`, `SubagentRecoveryOutcome` with the rest of the lifecycle surface.
      - `packages/prism-coding-tools/src/agent/__tests__/supervisor-lifecycle.test.ts`: the new cases.
      - `packages/ag-ui/src/__tests__/acp-lifecycle.test.ts`: the mapper ignores the opt-in fields.
      - `docs/agent-events.md`, `docs/coding-agent-tools.md`, `docs/acp.md`, `docs/supervisors.md`: option and field documentation.
      - `docs/_evidence/phase54-package-map.md` + `scripts/package-truth.json`: regenerated (`node scripts/package-truth.mjs --emit-docs`) because the coding-tools declared surface grew 887 → 890 (dist) / 936 → 939 (src gate), still under the 1022 `exportCounts` ceiling, so `scripts/budgets.json` needs no rebaseline.
    - References:
      - Plan 093 Task 3 (the `child_failed` event shape), `packages/prism-coding-tools/src/agent/supervisor-lifecycle.test.ts` (fixture style), `docs/agent-events.md:L110` (the sentence the new fields amend).
    - Completed Notes:
      - `recovery` is attached to every `subagent_stopped` (finished/rejected/error), not only the error stop: the counters describe the child at stop and the option stays the carrier; `failure` is attached to the `delegation_error` stop only.
      - The pending-failure buffer truncates the reason at **insert** (byte-bounded `truncateReason`, no ellipsis suffix so the cap is exact), which is what keeps the 64-entry bound meaningful for an oversized `child_failed.reason`.
      - `recoveryFor` omits the field when `summary()` is absent **or throws**: a broken recovery source never ends the advisory subscription.
      - No production call site passes the new options yet; they are host-facing defaults-off options (ACP wiring docs show `observeSupervisorLifecycle(supervisor, { onEvent: lifecycle.emit })`, unchanged).
  - Test Cases to Write:
    - `child_failed` then `delegation_error` with `includeFailure: true`: the stopped event carries the redacted reason, `limit`, and `stopReason`; with the option off the event JSON equals today's (assert the exact key set). **Done** — "attaches a buffered child_failed to the error stop only when includeFailure is on" (both runs asserted by deepEqual).
    - `delegation_finished` and `delegation_rejected` with `includeFailure: true`: no `failure` field. **Done** — "never attaches failure to finished or rejected stops" (a same-id `child_failed` precedes each stop).
    - `includeRecovery: true` with a source exposing `summary`: the row matches `summary().children` for that child; without `summary` on the source: no `recovery` field and no throw. **Done** — "attaches recovery counters from summary() only when includeRecovery is on" (option off, source without `summary`, and a throwing `summary` all omit the field).
    - A 10 KB `child_failed.reason`: the carried reason is bounded to `DEFAULT_LIFECYCLE_MAX_REASON_BYTES` and the event still fits `maxEventBytes`. **Done** — "bounds the carried reason to the lifecycle reason cap and the event byte cap" (10 KB ASCII → exactly 1 024 bytes; 1 000× `é` → ≤ 1 024 bytes; both delivered through `createCodingLifecycleEmitter()` with default limits).
    - 100 failures without stops: the pending-failure buffer stays at its bound (64) and does not leak. **Done** — "keeps the pending-failure buffer bounded to 64 entries" (64 → oldest carried; 65 and 100 → oldest dropped, newest carried).
    - ACP/AG-UI: with both options on, the ACP mapper output keys and the generated `delegated_agent_step` payload are unchanged. **Done** — coding-tools "keeps the AG-UI delegated_agent_step payload free of the opt-in fields" plus `packages/ag-ui/src/__tests__/acp-lifecycle.test.ts` mapping an attributed `subagent_stopped` to the same `agent_message_chunk`.
    - Verification: `npm run build` clean; `node --test packages/prism-coding-tools/dist/agent/__tests__/supervisor-lifecycle.test.js` 9/9; `npm test --workspace @arnilo/prism-coding-tools` 646 pass / 1 skipped; `npm test --workspace @arnilo/prism-ag-ui` 237/237; `scripts/phase10-conformance.test.mjs`, `scripts/budget-gate.test.mjs`, `scripts/live-doc-check.test.mjs`, `scripts/truth-current.test.mjs`, `scripts/phase54-package-map.test.mjs`, `scripts/phase23-quality-gates.test.mjs`, `scripts/packaging-current.test.mjs`, `scripts/tooling-gate.test.mjs` all green; `npx biome format` clean on the changed files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two new options on `ObserveSupervisorLifecycleOptions` and two optional fields on `SubagentStoppedEvent`.
    - Docs pages to create/edit:
      - `docs/agent-events.md`: extend the lifecycle-bridge paragraph with the two opt-ins, what each carries, and that ACP/AG-UI payloads are unchanged.
      - `docs/coding-agent-tools.md`: the `CodingLifecycleEvent` / Related APIs entries name the new optional fields.
      - `docs/acp.md`: state that ACP still maps only ids/depth/status, so the failure fields stay host-side.
      - `docs/supervisors.md`: Related APIs line notes the failure and recovery projection.
    - `docs/index.md` update: no — existing pages only, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Exact `failureRadius` ancestry via the delegation-id parent chain
  - Acceptance Criteria:
    - Functional: `ChainContext` (`supervisor.ts:L47-L50`) gains `parents?: readonly string[]` (the ancestor **delegation** ids); `noteDelegationStart` records `chain: [...(parents ?? []), delegationId]` for each live delegation; `countLiveDescendants(delegationId)` counts live delegations whose chain contains that id. The child-id `path` stays for cycle detection, depth, and mappings.
    - Functional: both nested call sites pass the ancestry — `delegate: (nested) => delegate(nested, { path, parents: [...(chain.parents ?? []), delegationId], signal: controller.signal })` at `:L541` and `:L850` — and `DelegationMapping` (`:L308-L320`) persists `parents`, so a resumed delegation rebuilds the same chain.
    - Functional: a failure of `lead#1` with a live nested `writer` under it reports `failureRadius: 1` even when a concurrent `lead#2` also has a live `writer` with the identical child-id path `[lead, writer]`; an unrelated live sibling still counts 0; depths ≥ 2 count every live descendant.
    - Functional: the `ponytail:` ancestry caveat (`:L374-L383`) and the docs qualification on the metric are removed, because the metric is now exact.
    - Performance: the radius scan stays O(live × chain length) with chain length ≤ `HARD_MAX_DELEGATION_DEPTH` (16) and live ≤ `HARD_MAX_ACTIVE_CHILDREN` (32); the chain array is built once per delegation start, not per scan.
    - Code Quality: one ancestry representation (delegation ids) replaces the path-prefix heuristic; no second lookup structure; `summary()` stays O(children).
    - Security: the persisted ancestry carries opaque delegation ids only — never child input, paths, or producer identities.
  - Approach:
    - Documentation Reviewed:
      - `docs/supervisors.md` (`failureRadius` definition, Recovery telemetry); plan 093 `Compromises Made` (the `ponytail:` ceiling this task retires); `packages/prism-core/src/runtime/supervisor/supervisor.ts:L365-L407` (current radius and settle seam).
    - Options Considered:
      - Keep the path prefix and dedupe by depth — rejected: two concurrent delegations of the same child id at the same depth keep identical paths, so the overcount is structural.
      - Store only `parentDelegationId` per entry and walk parents transitively on settle — rejected: same information, one indirection per ancestor per scan; a recorded chain array is simpler and persists directly.
      - Track descendants in a reverse index — rejected: deletion on every settle plus index maintenance for a metric that only needs a scan bounded by 32 live entries.
      - Key the registry by `path + delegationId` — rejected: `delegationId` is already unique; the path is the wrong key.
    - Chosen Approach: thread the ancestor delegation ids through `ChainContext`, persist them in `DelegationMapping`, and count live delegations whose chain contains the failed delegation id.
    - API Notes and Examples:
      ```ts
      // supervisor.ts (internal)
      interface ChainContext {
        readonly path: readonly string[];
        readonly parents?: readonly string[]; // ancestor delegation ids, oldest first
        readonly signal?: AbortSignal;
      }
      // liveDelegations: delegationId → { childId, chain: [...parents, delegationId] }
      // failureRadius for `lead#1` = live entries whose chain includes "lead#1"
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts`: `ChainContext`, `LiveDelegation`, `noteDelegationStart`, `countLiveDescendants`, both nested call sites, `DelegationMapping` + resume rebuild.
      - `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts`: the concurrent-duplicate regression and ancestor cases.
      - `packages/prism-core/src/runtime/supervisor/__tests__/nested-approvals.test.ts`: the resume case (harness gains a post-resume `resumeSpawn` behavior) and the persisted-`parents` assertion.
      - `docs/supervisors.md`: exact-ancestry wording.
    - References:
      - Plan 093 Task 4 (the metric and its caveat), plan 093 `Compromises Made` (`ponytail:` note), `supervisor.ts:L308-L320` (`DelegationMapping` precedent for persisted policy).
    - Completed Notes:
      - `LiveDelegation` carries only `chain` (the child-id `path` is gone from it): `noteDelegationStart(childId, delegationId, parents?)` freezes `[...(parents ?? []), delegationId]` once per start, and `settleDelegation` drops its `path` parameter and counts `countLiveDescendants(delegationId)` after deleting the settled entry (so an entry never matches itself). Live ≤ 32 × chain ≤ 16 keeps the worst case at the 567 ns/op measured in the Task 1 review, versus 74.7 ns/op for the retired path-prefix variant.
      - The resume call site passes `[...(mapping.parents ?? []), mapping.delegationId]` rather than `[...(chain.parents ?? []), delegationId]`: `mapping.parents` *are* the resumed delegation's ancestors, so the two expressions are the same ancestry and only the named fields are in scope there.
      - `DelegationMapping.parents` is persisted only when non-empty, matching the file's existing optional-field spreads (`report`/`everyTurns`/`budgetShare`), so top-level mappings and legacy records keep their exact stored shape.
      - **Discovered gap fixed to satisfy the resume case:** the resume path had no terminal seam, so an `AgentRunError` out of `resumeAgentRun` (a run that died, including a limit death) propagated without settling counters, publishing `child_failed`/`delegation_error`, or running the terminal hook — a resumed failure left `outcome: "running"` and `failures: 0` forever. The resume path now mirrors the live catch: settle, publish the terminal error, run `hooks.after` once under the original delegation id, then rethrow. The catch is gated on `error instanceof AgentRunError` so a pre-run rebuild error (stale version, fingerprint drift, non-`Agent` factory) still publishes nothing and never cleans up a live suspended child, as `docs/supervisors.md` promises.
      - Docs: `docs/supervisors.md` `failureRadius` now states delegation-level ancestry (concurrent same-child delegations stay distinct) instead of the child-id path qualification, and `failures` names a resumed death as one of the counted failures.
  - Test Cases to Write:
    - Concurrent duplicate subtrees: two top-level `lead` delegations each holding a live nested `writer`; failing `lead#1` reports `failureRadius: 1`, not 2. **Done** — "counts exact ancestry for concurrent delegations of the same child" (the failing delegation has its own live writer and the concurrent subtree's writer exists at the same `[lead, writer]` path; the old prefix scan would report 2).
    - Depth ≥ 2: failing the root `lead` counts a live `writer` and a live `researcher` under different branches (2); an already-settled sibling counts 0. **Done** — "counts every live descendant across branches, depth, and lifetimes": `lead` → live `mid` → live `writer` counts 2 (depths 2 and 3) while the awaited `researcher` sibling is `succeeded` and uncounted.
    - Resume: a suspended delegation resumes with its `parents` intact, and a failure after resume still counts its new live descendants. **Done** — two-level test asserts the persisted mapping for the suspended leaf (`delegationId: "lead-2"`, `parents: ["lead-1"]`); "keeps the delegation ancestry across a resume so the failure radius stays exact" resumes a gated child whose post-resume turn spawns a live descendant and then fails, reporting `failureRadius: 1`.
    - Session-lifetime: a failing session-lifetime child with a live task-lifetime descendant counts it (the descendant is task-lifetime and visibly live); the inverse (a task-lifetime failure with a live session-lifetime descendant) cannot occur because nested delegation is synchronous and is asserted by the existing lifetime test. **Done** — "counts the live descendant of a failed session-lifetime child".
    - No live descendants: `failureRadius: 0` and `failures` still increments. **Done** — already covered by "counts attempts, retries, failures, and outcome across fail, retry, complete" (the failing `worker` has no descendants).
    - Verification: `npm run build` clean; `node --test packages/prism-core/dist/runtime/supervisor/__tests__/supervisor.test.js` 31/31; `.../nested-approvals.test.js` 12/12; `npm test --workspace @arnilo/prism-core` 682 pass / 9 skipped; the remaining workspace suites, `scripts/` gates, and `npx biome format` re-run after the change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the documented `failureRadius` number becomes exact for concurrent same-child subtrees.
    - Docs pages to create/edit:
      - `docs/supervisors.md`: `failureRadius` definition states delegation-level ancestry and drops the concurrency caveat; Recovery telemetry bullet updated.
    - `docs/index.md` update: no — existing page, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Per-root-run counter read — `summary({ reset: true })`
  - Acceptance Criteria:
    - Functional: `Supervisor.summary(options?: { readonly reset?: boolean }): SupervisorRunSummary` (`types.ts:L301`); `reset: true` zeroes `attempts`, `retries`, `failures`, and `failureRadius` for every child and reports `outcome` as `"running"` when that child has a live delegation, otherwise `"idle"`. Absent or `false` keeps today's cumulative contract byte-identical.
    - Functional: retry semantics are documented relative to the window: after a reset, a re-dispatch counts `attempts: 1`, and `retries` counts only when the previous `failed`/`aborted` outcome happened after the reset; resuming a suspended run never counts as a retry.
    - Functional: no `supervisor_run_summary` event is added; `docs/supervisors.md` gives the host recipe (`summary({ reset: true })` at root-run start, `summary()` at root-run end) and states why the supervisor cannot emit a root-run event itself (it has no root-run boundary; a turn boundary or `activeChildren === 0` is not one).
    - Performance: `O(children)` for both the read and the reset, with no per-turn work — counters stay incremental, and the reset writes five numbers per child.
    - Code Quality: one row builder (`childSummary`, `supervisor.ts:L408-L418`) serves both paths; the signature change is additive for every existing no-argument caller; the doc comment on `summary()` names the window.
    - Security: counters are integers and child ids only; no new event, no new persisted bytes.
  - Approach:
    - Documentation Reviewed:
      - `docs/supervisors.md` (Recovery telemetry and its snapshot-diffing note); plan 093 `Further Actions` (the item this task places); `packages/prism-core/src/runtime/supervisor/types.ts:L221-L240` (row shape) and `:L298-L303` (`summary()` doc comment).
    - Options Considered:
      - A separate `resetSummary()` method — rejected: two entry points for one window operation, and the read+reset pair is what a host actually calls.
      - Emitting `supervisor_run_summary` when `activeChildren` reaches 0 — rejected: between two delegations of one root run the count also reaches 0, and a turn boundary is not a root-run boundary; the supervisor has no root-run seam to hook.
      - `summary({ since: marker })` windows — rejected: hosts already hold the previous snapshot; the marker would add state for a diff they can compute.
      - Resetting on `delegate()` of the first child — rejected: a root run can delegate twice, and implicit resets make the counters untrustworthy.
    - Chosen Approach: an optional `reset` flag on the existing read that starts a new counting window and leaves `outcome` describing the present state.
    - API Notes and Examples:
      ```ts
      // Root run start: new window. Root run end: this run's counters.
      supervisor.summary({ reset: true });
      const run = await agent.run(input);
      const perChild = supervisor.summary().children;
      // [{ childId: "worker", attempts: 2, retries: 1, failures: 1, failureRadius: 0, outcome: "succeeded" }]
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/supervisor/types.ts`: `summary(options?)` signature + window doc comment.
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts`: reset branch in `summary` (`:L954`) reusing `childSummary`.
      - `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts`: reset window cases.
      - `docs/supervisors.md`: reset contract and host recipe.
    - References:
      - Plan 093 Task 4 (`summary()` implementation and row shape), `docs/options-index.md` (`SupervisorRunSummary` is generated from the type).
    - Completed Notes:
      - `summary` is now an arrow that takes `(options?: { readonly reset?: boolean })` — the AC's inline type, so no new exported type and no export-count budget rebaseline. The reset branch loops `childCounters` in place (five writes per child) and restates `counters.outcome = hasLiveDelegation(childId) ? "running" : "idle"`, then the unchanged `children.map(childSummary)` read returns the fresh window; both paths share the one row builder, and `reset: false`/absent never enters the branch, so the cumulative contract is byte-identical.
      - Retry semantics fall out of restating `outcome` rather than needing extra state: `noteDelegationStart` increments `retries` only when the stored outcome is `failed`/`aborted`, and a reset has already replaced that with `idle`/`running`, so a dispatch after a pre-window failure counts `attempts: 1` with no retry bump while a failure inside the window still yields `retries: 1`. Resumption keeps its existing rule (no `noteDelegationStart` retry for a suspended resume, since `outcome` is `suspended`).
      - Live delegations are deliberately not touched: the entry lives in `liveDelegations`, not the counters, so zeroing a child mid-flight leaves the settle to record its own `failures`/`failureRadius`/outcome in the new window (test: reset during a live `lead` + live nested `writer` → row zeroed and `running`, then `{ failures: 1, failureRadius: 1, outcome: "failed" }` after the lead dies).
      - Docs: `docs/supervisors.md` gains the window contract, the two-line host recipe (reset at root-run start, read at root-run end), the `outcome` restatement and live-delegation guarantee, and the reason there is no `supervisor_run_summary` event (no root-run boundary; a turn boundary or a momentary `activeChildren === 0` is not one). `SupervisorChildSummary`'s doc note still describes the cumulative read; the window is named on `summary()`.
  - Test Cases to Write:
    - No-argument `summary()` after a fail→retry→complete sequence returns the same cumulative row as today (regression pin). **Done** — existing "counts attempts, retries, failures, and outcome across fail, retry, complete" is the pin and stayed untouched; the new window test also pins `summary({ reset: false })` to the cumulative row.
    - `summary({ reset: true })` after that sequence returns zeroed counters with `outcome: "idle"`, and a later delegation counts `attempts: 1` with `retries: 1` only when the prior failure happened inside the new window. **Done** — "summary({ reset: true }) opens a new counting window, and retries count only inside it": count-limit failure → `{ attempts: 1, failures: 1, outcome: "failed" }` → reset (all zeros, `idle`) → dispatch → `{ attempts: 1, retries: 0 }` (pre-window failure does not count as a retry) → in-window failure → dispatch → `{ attempts: 3, retries: 1, failures: 1, outcome: "succeeded" }`.
    - Reset while a delegation is live: counters zero, `outcome: "running"`, and the live run's settle still records its failure radius and outcome. **Done** — "reset while a delegation is live keeps that delegation's settle in the new window".
    - Reset before any delegation: all rows `{ attempts: 0, retries: 0, failures: 0, failureRadius: 0, outcome: "idle" }`. **Done** — the first assertion of the window test.
    - Verification: `npm run build` clean; `node --test packages/prism-core/dist/runtime/supervisor/__tests__/supervisor.test.js` 33/33; `npm test` all 6 stages; `scripts/plan-review-gate.test.mjs` + `scripts/live-doc-check.test.mjs` 9/9; `npx biome format`/`lint` clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `summary()` gains an option and a windowed reset contract.
    - Docs pages to create/edit:
      - `docs/supervisors.md`: Recovery telemetry describes the reset window, the `outcome` meaning, and the root-run recipe; Related APIs unchanged.
    - `docs/index.md` update: no — existing page, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Carry the child's own limit attribution on `child_failed`
  - Acceptance Criteria:
    - Functional: `AgentRunResult` (`src/contracts-run-state.ts:L302-L330`) gains optional `attribution?: BudgetExhaustionAttribution`, a new exported type in `src/run-limits.ts` — `{ consumed: BudgetConsumedCounters; closestOtherAxes: readonly BudgetAxisUsage[]; recentToolCalls: readonly ToolCallSummary[] }` — and `describeBudgetExhaustion` returns that shape plus `limit`, so the event, the result, and the timeline projection share one field list.
    - Functional: `assemble.ts` builds it once at the breach site (`:L675-L690`): the `describeBudgetExhaustion` payload used for the `budget_exhausted` event is passed into `buildRunResult` as `attribution` with `limit` omitted (`AgentRunResult.limit` already carries the `RunLimitBreach`); a run that succeeds or is host-aborted without a breach has `attribution === undefined`. The durable-resume path reaches the same code, so a resumed limit death carries it too.
    - Functional: `child_failed` gains `consumed?`, `closestOtherAxes?`, `recentToolCalls?`, copied in `failureAttribution` (`supervisor.ts:L992-L1000`) from `result.attribution`; `limit`, `status`, `stopReason`, and `usage` keep their current sources.
    - Functional: model-visible tool results are unchanged — `spawn_agent`/`delegate_agent` value projections (`spawn-tool.ts:L179`, `:L189-L196`) stay explicit key lists, and a test pins the exact key set of a limit-failed delegation's tool result.
    - Performance: no new work per breach (the payload is already computed); the added result field copies ≤ 5 axes and ≤ 10 hashed tool calls; no per-turn cost, and `budget_exhausted` remains one event.
    - Code Quality: one attribution type reused everywhere; no duplicated field list between the event, the result, and `TimelineExhaustion`; `describeBudgetExhaustion` keeps its name and call sites.
    - Security: `recentToolCalls` stay `sha256:` argument hashes (plan 087 contract), `closestOtherAxes` are numbers, `consumed` are counters; none of it reaches the model, the transcript, or telemetry beyond the paths plan 087 already defines; `child_failed.reason` keeps its redaction.
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md:L66` (breach, `result.limit`, `budget_exhausted`); `docs/agent-events.md` (`child_failed` sentence and the run-limit events section); `docs/supervisors.md` (`child_failed` fields); `docs/agent-session-runtime.md:L61` (`AgentRunResult` field list); plan 087 (attribution contract); plan 093 `Compromises Made` (why this field was left out initially).
    - Options Considered:
      - Supervisor-side subscription to the child's `budget_exhausted` event — rejected: it needs an always-on subscription per delegation and only works when the reporting pump already runs; the result path costs nothing extra.
      - Re-derive the counters from `result.usage` — rejected: `usage` has no per-axis counters, request bytes, axis ratios, or tool-call hashes.
      - Put the full `TimelineExhaustion` (limit/maximum/observed) on the result — rejected: `result.limit` already carries the breach; only the counters are missing.
      - Add a second core event (`child_failed` relayed from the pump) — rejected: `child_failed` is the single supervisor failure record; splitting it would make consumers join again.
    - Chosen Approach: keep the plan-087 payload as the single attribution shape, retain it on the run result at the site that already builds it, and copy it onto `child_failed` in `failureAttribution`.
    - API Notes and Examples:
      ```ts
      // AgentRunResult after a limit death
      result.limit;        // { limit: "maxToolCalls", maximum: 32, observed: 32 }
      result.attribution;  // { consumed, closestOtherAxes, recentToolCalls } — same fields as budget_exhausted
      // supervisor events
      // child_failed: { childId, delegationId, depth, reason, status, limit, stopReason, usage,
      //                 consumed, closestOtherAxes, recentToolCalls }
      ```
    - Files to Create/Edit:
      - `src/run-limits.ts`: export `BudgetExhaustionAttribution`; `describeBudgetExhaustion` returns it plus `limit`.
      - `src/contracts-run-state.ts`: `AgentRunResult.attribution?`.
      - `src/agent-session/session.ts`: `buildRunResult` input + output field.
      - `src/agent-session/session/types.ts`: the same field on the `SessionHost.buildRunResult` contract the assembler calls through (the run loop only sees the interface).
      - `src/agent-session/session/assemble.ts`: build the payload once, emit it, pass it to `buildRunResult`.
      - `src/index.ts` + `src/__tests__/public-export-contract.test.ts`: publish the type and pin it in `FROZEN_TYPE_EXPORTS` (G9 decision).
      - `packages/prism-core/src/runtime/supervisor/types.ts` + `supervisor.ts`: `child_failed` fields and `failureAttribution` copy.
      - `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts`, `.../spawn-tool.test.ts`, and `src/__tests__/run-limits.test.ts`: new assertions.
      - `docs/runs-and-usage.md`, `docs/agent-events.md`, `docs/supervisors.md`, `docs/agent-session-runtime.md`: field documentation.
      - `scripts/budgets.json`: recorded `@arnilo/prism` export-count rebaseline (+1).
    - References:
      - Plan 087 Task 2 (`describeBudgetExhaustion`, `budget_exhausted`, `TimelineExhaustion`), `packages/prism-core/src/governance/observability/timeline-types.ts:L99-L112` (the joined projection this result field mirrors), plan 093 Task 4 (`child_failed` and the documented gap).
    - Completed Notes:
      - G9 decided **public**: `BudgetExhaustionAttribution` is declared in `src/run-limits.ts` (as the review's §3 row requires), re-exported from `src/index.ts` next to `RunLimitTrackerOptions`, pinned in `FROZEN_TYPE_EXPORTS`, and the `@arnilo/prism` export-count ceiling was rebaselined 1458 → 1459 with a recorded reason — module-only would leave `AgentRunResult.attribution` unnameable while `RunLimitBreach` is public. `describeBudgetExhaustion` itself stays module-internal (no value export) and keeps its name, signature, and single call site; it now returns `BudgetExhaustionAttribution & { limit }` instead of an inline structural type.
      - The payload is built once at the breach site and shared: `assemble.ts` computes `exhaustion` from the same `describeBudgetExhaustion` call, spreads it into the `budget_exhausted` emit, and passes `{ consumed, closestOtherAxes, recentToolCalls }` — the same array references, no copy, `limit` deliberately omitted because `result.limit`/`child_failed.limit` already carry the `RunLimitBreach` — into `buildRunResult`.
      - `SessionHost.buildRunResult` (`src/agent-session/session/types.ts`) had to gain the field too: the assembler calls the method through that interface, so the class signature alone did not type-check. That is the only extra seam this task needed; the durable-resume path reaches the same breach block, so a resumed limit death carries the field without a second site.
      - Supervisor: `ChildFailureAttribution` gains the three optional fields, `failureAttribution` copies them from `result.attribution` in the same additive-spread pattern as `limit`/`usage`, and `settleDelegation` spreads them onto `child_failed`. At task time `delegate()` converted a child limit death into `SupervisorLimitError` and dropped `error.result`, so the supervisor test asserted the copied counters/hashes directly while `src/__tests__/run-limits.test.ts` pins the value equality (`result.attribution` ≡ the `budget_exhausted` payload) and a plain-failure `child_failed` asserts the three fields are absent (the wiring proof); the error now carries the result too (Further Actions, executed below), so both surfaces read the same payload.
      - Test-shape corrections against the plan text: the real tool names are `spawn_agent`/`wait_agent` (this tree has no `delegate_agent`), and a limit-failed child surfaces to the model as an **error** tool result with no `value` at all (the sync path rethrows through the tool's catch, the async `wait` likewise), so the key pin covers the value-producing paths — async launch `{ childId, delegationId, status }` and a successful sync spawn `{ childId, status, text, usage }` — plus a `value === undefined` assertion for both limit-failed paths: the new field cannot reach the model either way.
      - The durable-resume case needs two things the plan did not name: a `store: createMemorySessionStore()` on the agent (otherwise the resumed session cannot resolve the suspended leaf — `Unknown session leaf`) and the ceiling on `AgentConfig.limits`, because `AgentRunResumeOptions` carries no `limits` (`resolveRunLimits(config.limits, undefined)` on resume). The durable counter snapshot still restores, so the resumed run breaches deterministically; the test drives `resumeAgentRunStream`, collects the `budget_exhausted` event, and compares the resumed `AgentRunError.result.attribution` with it.
  - Test Cases to Write:
    - Limit death: `result.attribution` equals the `budget_exhausted` event's `consumed`/`closestOtherAxes`/`recentToolCalls`; `result.limit` still carries the breach. **Done** — "attributes a maxTurns death with counters, closest axes, and the last ten tool calls" now captures the `AgentRunError` and asserts the three deep-equalities, `result.limit.limit === "maxTurns"`, and that `attribution`'s own key set is exactly the three fields.
    - Supervisor: `child_failed` for that death carries the same three fields, and the event still precedes `delegation_error`. **Done** — "counts attempts, retries, failures, and outcome across fail, retry, complete" asserts `consumed.turns === 2`, `requestBytes > 0`, the two `noop` `sha256:` hashes, and a non-empty `closestOtherAxes`, with the existing ordering assertion; "attributes a plain failure, and a host cancel is not a failure" asserts the three fields are absent without a breach.
    - Host cancel and clean success: `result.attribution === undefined`, and no `child_failed` for the cancel. **Done** — "carries no attribution for a host abort" (new) and the clean-run case in "does not attribute a clean run" (`limit` and `attribution` both undefined); the cancel `child_failed` assertion stays in the supervisor cancel test.
    - Durable resume: a resumed run that dies on a limit carries `attribution` on the resumed result and on `child_failed`. **Done** — "carries attribution on a durable resumed run that dies on a limit" (new): suspend → approve → resumed `maxToolCalls` death, `budget_exhausted` ≡ resumed `result.attribution`. The supervisor-side `child_failed` copy on a *resumed* delegation is the same `failureAttribution(result)` call the live test covers, and the resume-path terminal seam that publishes it is covered by the Task 3 resume tests.
    - Tool results: `spawn_agent` (sync and async) value keys are unchanged for a limit-failed child (`delegationId`/`childId`/`status`/`usage`/`text` only). **Done** — "keeps tool-result value keys stable for a limit-failed child" (new, `spawn-tool.test.ts`): async launch keys exactly `childId`/`delegationId`/`status`, a successful sync spawn keys exactly `childId`/`status`/`text`/`usage`, and both limit-failed paths return an error result with `value === undefined`.
    - `release:gate`: the `AgentRunResult` change is additive (additions-only, no baseline regeneration). **Done** — `npm test` gate suites pass (`release-gate`, `packaging-current`, `public-export-contract` with the new frozen type export, `phase54-package-map` after `node scripts/package-truth.mjs --emit-docs`); the only baseline touched is the recorded export-count ceiling.
    - Verification: `npm run build` / `npm run build:core` clean; `dist/__tests__/run-limits.test.js` 21/21; `packages/prism-core` supervisor suite 33/33 + spawn-tool 15/15; `npm test` all 6 stages; `scripts/plan-review-gate.test.mjs` + `scripts/live-doc-check.test.mjs` 9/9; biome format/lint clean on every touched file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `AgentRunResult` gains a field and `child_failed` gains three.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: the run-limit paragraph states that the attribution also rides `AgentRunResult.attribution` on a breach.
      - `docs/agent-session-runtime.md`: the `AgentRunResult` field list gains `attribution`.
      - `docs/supervisors.md`: `child_failed` field table adds `consumed`/`closestOtherAxes`/`recentToolCalls`.
      - `docs/agent-events.md`: the `child_failed` sentence notes the carried attribution.
    - `docs/index.md` update: no — existing pages only, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- `failureRadius` ancestry is exact and a resumed delegation re-enters the live registry, but liveness is still per supervisor instance: a child that was live before a restart and is never resumed counts for nothing, because nothing runs for it in the new process. Ceiling: restart-exact radius covers resumed delegations only; upgrade by persisting live entries and enumerating them at start if a host needs dangling-suspended children counted (low).
- The lifecycle bridge's pending-failure buffer is per `observeSupervisorLifecycle` subscription (a module-private `Map`, 64 pending `child_failed` keyed by delegation id, oldest dropped), not per supervisor. Ceiling: two bridges over one supervisor keep separate buffers, and a failure whose stop never arrives is dropped after 64 newer ones; a supervisor-owned buffer would be needed for multi-bridge hosts (low).
- `includeRecovery` reads `summary()` at each stop instead of a cached row, because the row is only final after `settleDelegation` ran in the same publish step. Ceiling: O(children) per stopped child; upgrade to a per-delegation cached row if a supervisor ever allow-lists thousands of children and every stop carries recovery (low).
- The per-root-run window is host-declared (`summary({ reset: true })`), not observable by the supervisor: a turn boundary or a momentary `activeChildren === 0` between two delegations is not a root-run boundary, so no `supervisor_run_summary` event exists and the counters reflect the host's reset discipline (by design, recorded in Task 4).
- `child_failed` attribution is copied from the child's `AgentRunResult.attribution`, so it is present only for deaths the timeline breach block produced (a child run ceiling). A supervisor-level limit (`maxDepth`, `maxActiveChildren`, supervisor wall time) rejects or aborts before a child result exists and carries no `consumed`/`closestOtherAxes`/`recentToolCalls` — the breach stays on the supervisor error. Ceiling: a host cannot attribute a supervisor-level rejection with counters; upgrade only if the supervisor ever counts its own axes (low).
- Durable attribution coverage is in-process: the resume test uses one memory checkpoint store and one memory session store in one process. Ceiling: a true process restart is untested for this field, though the resumed run reaches the identical breach block; upgrade with a second-process resume test if a host restarts mid-run in production (medium).

## Further Actions
- (done, 2026-09-21) Restart-exact radius: a resumed delegation re-enters the live registry (`noteLiveDelegation` from the resume seam, after the resume guardrails, removed on settle) and the resumed id re-bases the instance's delegation counter, so a fresh-instance supervisor counts a delegation that was live across the restart and a delegation started after that resume can never take the resumed id. `packages/prism-core/src/runtime/supervisor/supervisor.ts`; `docs/supervisors.md` states the semantics plus the ceiling below. Test: `__tests__/nested-approvals.test.ts` "registers a delegation resumed by a fresh supervisor instance as live" — fails on either half of the fix.
- (done, 2026-09-21) Child result on a supervisor limit death: `SupervisorLimitError` carries `result?: AgentRunResult` (`__tests__`-verified) and the limit-to-error conversion passes the child's terminal result, so a host reads the breach and the exhaustion attribution from the catch without joining `child_failed`; supervisor-level ceilings (depth, active children, timeouts, cycle, bytes) still carry none. `packages/prism-core/src/runtime/supervisor/errors.ts` + `docs/supervisors.md`. Test: `__tests__/supervisor.test.ts` "carries the child result on a limit error, and none on a supervisor-level ceiling".
- (low) Supervisor-owned failure buffer for the lifecycle bridge: move the 64-entry pending-failure map onto the supervisor (or let the bridge consume `child_failed` directly) so multiple bridges over one supervisor share one buffer and a stop can never miss its failure.
- (low) Plan-prose audit for named symbols and counts: this plan's text carried three stale references the primitive review had to refute (`delegate_agent` does not exist, "5 closest axes" vs `CLOSEST_AXIS_COUNT = 3`, Task 5's source spans at `:L302-L330`/`:L675-L690`). Rationale: a cheap pre-implementation sweep of plan prose against the tree would have removed the implementation-time corrections.
- (low) CHANGELOG bullet at the 0.10.x release cut: the plan's docs assessment deferred release notes to the cut (the repo's standing convention), so Tasks 1-5 added no CHANGELOG entry; the five behavior changes should be summarized there with the rest of the phase.