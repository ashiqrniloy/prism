# Phase 109 — Primitive Review: Restore Hooks, Compensation, and Audit Surfaces

Plan: [109-Checkpoint-Restore-Follow-Ups.md](../../plans/109-Checkpoint-Restore-Follow-Ups.md) Task 1.
Date: 2026-09-22. Baseline: 0.10.x working tree, HEAD `3129d5cf`, Node v26.9.0.
Method: read-only inventory plus a scratch probe (`.phase109-probe.mjs`, not committed; deleted after this
review) run against the working-tree `dist/` builds of `@arnilo/prism` and `@arnilo/prism-core`, as plan
104 Task 1 and plan 108 Task 1 did.
Scope: **gate for Tasks 2–3**. Every later task reuses a row below as-is, extends one additively, or adds
the named new seam; any primitive absent here is a review gap and must be added to §2 before implementation.

Plan 109's two items are plan 094's written-down ceilings, not contract gaps. Source: plan 094
`Compromises Made` ([094-Checkpoint-Sidecar-Metadata-And-Cross-Layer-Restore-Hooks.md](../../plans/094-Checkpoint-Sidecar-Metadata-And-Cross-Layer-Restore-Hooks.md) `:L130–L132`, linked from
[109](../../plans/109-Checkpoint-Restore-Follow-Ups.md)) and its `Further Actions` (`:L139–L140`). Current
contract: `docs/durable-runs.md:L45–L69` (§Restore hooks, all-or-nothing), `docs/durable-runs.md:L127`
(security note), `docs/workflows.md:L92`, `docs/workflows.md:L99` (workflow parity + event audit),
`docs/execution-timeline.md:L65–L88` (`ExecutionTimeline` shape), `docs/policy-and-audit.md:L28`
(what a redacted review record carries).

Cite convention: spans are `file:Lstart–Lend` verified in this tree. Every `reuse:` row names the exact
exported symbol or module-private seam; every `gap:` row names the file that must change; every `reject:`
row names the task it would have affected. Plan 109's own citations were re-verified: some are exact, some
stale — each drift is called out inline and the §1 span is authoritative.

---

## 1. Reuse inventory (what the later tasks build on)

### 1.1 Task 2 — the restore executor and its error primitive

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/checkpoint-restore.ts:L12` | `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS` = `10_000` | Per-hook ceiling; `runCheckpointRestoreHooks` falls back to it when `timeoutMs` is absent. |
| `src/checkpoint-restore.ts:L15–L18` | `CheckpointRestoreAuditEntry` | `{ hook: string; durationMs: number }` — the *only* shape the audit can carry, by construction. |
| `src/checkpoint-restore.ts:L21–L24` | `CheckpointRestoreAudit` | `{ hooks: readonly CheckpointRestoreAuditEntry[]; durationMs: number }` — completed hooks, in run order. Task 3 projects this untouched. |
| `src/checkpoint-restore.ts:L30` | `CheckpointRestoreHook<Context>` | `(checkpoint: Context, signal: AbortSignal) => void \| Promise<void>`. Today's only handler shape; Task 2 widens it inside a new union, it does not change this alias. |
| `src/checkpoint-restore.ts:L33–L42` | `CheckpointRestoreError` | `code = "ERR_PRISM_CHECKPOINT_RESTORE"`, `hook` (name of the failing hook), `cause` (original error or timeout reason). Task 2 extends: optional `compensation`. |
| `src/checkpoint-restore.ts:L44–L49` | `RunCheckpointRestoreHooksOptions` | `{ timeoutMs?, signal? }` **only**. No redactor today — see G7. Task 2 may add an optional `redactor?`; adding `handler` normalization needs no new option. |
| `src/checkpoint-restore.ts:L56–L83` | `runCheckpointRestoreHooks<Context>(hooks, context, options)` | Sequential loop, one `AbortController` + `setTimeout` per hook (`:L66–L69`), combined signal (`:L69`), name = `hook.name \|\| hook[i]` (`:L66`), entries pushed after success (`:L80`), audit frozen at the end (`:L82`). |
| `src/checkpoint-restore.ts:L64–L81` | the loop to extend | `options.signal?.throwIfAborted()` is the only caller-abort check (`:L65`); the `catch` at `:L73–L76` **throws immediately — no undo step** (G1, CONFIRMED §5(a)). Plan 109 cites `:L63–L81`; the loop starts at `:L64`. |
| `src/checkpoint-restore.ts:L76` | the failure throw | The exact line G1 names: `throw new CheckpointRestoreError(...)`. Task 2 inserts the reverse compensation pass above it. |
| `src/checkpoint-restore.ts:L10–L11` module doc | documented ceiling | Explicitly states "a host that needs every layer back where they were re-runs the whole restore after fixing the failing layer" — the sentence Task 2 replaces with the object form + compensation rule. |

### 1.2 Task 2 — hook contexts and options in both packages

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/contracts-run-state.ts:L280–L289` | `AgentCheckpointRestoreContext` | `{ runId, sessionId, version, status, metadata?, checkpoint }`. Plan 109 cites `:L269–L281`; stale (that range is `AgentRunResumeOptions`'s head). |
| `src/contracts-run-state.ts:L292` | `AgentCheckpointRestoreHook` | `= CheckpointRestoreHook<AgentCheckpointRestoreContext>` — **one alias**, so widening `CheckpointRestoreHook` at the executor and re-typing the option is the whole agent-side change; the context type is untouched. |
| `src/contracts-run-state.ts:L320–L325` | `AgentRunResumeOptions.restoreHooks` | `readonly AgentCheckpointRestoreHook[]`. Task 2 widens the element type to the handler union; bare functions keep compiling. |
| `src/contracts-run-state.ts:L326–L327` | `AgentRunResumeOptions.restoreHookTimeoutMs` | Per-hook ceiling threaded into the executor. Unchanged. |
| `src/agent-run-lifecycle.ts:L43–L48` | `AgentRunLifecycleOptions.restoreHooks` / `.restoreHookTimeoutMs` | Lifecycle-registered hooks; the second registration point. Widen the same way. |
| `src/agent-run-lifecycle.ts:L62–L65` | `AgentRunLifecycleRequest.restoreHooks` / `.restoreHookTimeoutMs` | Per-request hooks. Unchanged apart from the element type. |
| `src/agent-run-lifecycle.ts:L83–L92` | `restoreHookOptions(lifecycle, request)` (module-private) | Merges lifecycle hooks first, then request hooks, returns `Pick<AgentRunResumeOptions, "restoreHooks" \| "restoreHookTimeoutMs">`; request timeout wins. The single normalization/merge point on the agent side; Task 2's executor-boundary `normalizeRestoreHandler` sits below it and does not duplicate it. |
| `packages/prism-core/src/runtime/workflows/types.ts:L514–L521` | `WorkflowCheckpointRestoreContext` | `{ workflowId, runId, version, status, metadata?, checkpoint }`. Untouched. |
| `packages/prism-core/src/runtime/workflows/types.ts:L524` | `WorkflowCheckpointRestoreHook` | `= import("@arnilo/prism").CheckpointRestoreHook<WorkflowCheckpointRestoreContext>` — the package already imports the public hook type, and `packages/prism-core/src/runtime/workflows/run/main.ts:L4` already imports `runCheckpointRestoreHooks` from the same barrel. Task 3's `CheckpointRestoreAudit` projection reuses that edge. |
| `packages/prism-core/src/runtime/workflows/types.ts:L562–L569` | `RunWorkflowOptions.restoreHooks` / `.restoreHookTimeoutMs` | `:L567` is the `restoreHooks` field plan 109 cites — exact. Widen the element type. |
| `src/index.ts:L115–L121` | public type barrel | `CheckpointRestoreAudit`, `CheckpointRestoreAuditEntry`, `CheckpointRestoreHook`, `RunCheckpointRestoreHooksOptions`. Task 2 adds `CheckpointRestoreHandler` + `CheckpointRestoreCompensation` here (G6). |
| `src/index.ts:L122` | public value barrel | `CheckpointRestoreError`, `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`, `runCheckpointRestoreHooks`. Unchanged (no new value export). |

### 1.3 Task 2 — the two call sites (both inherit the executor change)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/agent-run-lifecycle.ts:L433–L449` | agent restore block | Reads `options.restoreHooks ?? []` (`:L436`), awaits `runCheckpointRestoreHooks` with the claim context and `{ timeoutMs, signal }` (`:L437–L448`), `:L449` `: undefined` when no hooks. A throw here propagates before the claim write; the checkpoint stays suspended. Plan 109 cites `:L419–L440`; stale (the block is `:L433–L449`). |
| `packages/prism-core/src/runtime/workflows/run/main.ts:L255–L272` | workflow restore block | Same shape with the workflow context (`:L262–L269`); the throw happens before `const state: SchedulerState` is built (`:L274`), so nothing is written. Plan 109 cites `:L256–L275`; stale by one line at the start. |
| `src/agent-session/session/assemble.ts:L305–L312` | `agent_resumed` emit | Emits `version` and `...(resumed.restore ? { restore: resumed.restore } : {})` (`:L311`). The audit's only agent-side exit. Plan 109 cites `:L197–L202`; stale. |
| `packages/prism-core/src/runtime/workflows/run/scheduler.ts:L118–L127` | `workflow_resumed` emit | `...(state.restore ? { restore: state.restore } : {})` at `:L124` — the cite plan 109 gives is exact. Emitted only when `state.resume` is set, so a crash-recovery resume without a resume record runs hooks but emits no event (094 compromise `:L132`). |
| `packages/prism-core/src/runtime/workflows/run/main.ts:L46–L67` | `SchedulerState.restore` | `restore?: import("@arnilo/prism").CheckpointRestoreAudit` (`:L67`) — the workflow audit's in-memory hand-off to the scheduler. |

### 1.4 Task 3 — audit sources and projection seams

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/contracts-protocol.ts:L246–L254` | `agent_resumed` event variant | Carries `restore?: CheckpointRestoreAudit` (`:L253`). The event is the contract Task 3 would project — no new event kind needed. |
| `packages/prism-core/src/runtime/workflows/types.ts:L379–L387` | `workflow_resumed` event variant | Carries `restore?` (`:L384`). Same shape, same key name; the two families already agree. |
| `packages/prism-core/src/governance/observability/timeline-types.ts:L114–L147` | `ExecutionTimeline` | `workflowMetadata?` at `:L121` is the precedent for an optional top-level, workflow-family field; `steps`/`turns`/`exhaustion` sit after it. Task 3 adds `restore?` beside `workflowMetadata` (plan 109 cites `:L113–L125`; the interface is `:L114–L147`). |
| `packages/prism-core/src/governance/observability/timeline-types.ts:L51–L72` | `ExecutionStep` / `ExecutionStep.metadata` | `metadata?: Readonly<Record<string, unknown>>` at `:L70`, documented "low-cardinality operational metadata only". The kept-as-alternative home (R7); no run step exists on the workflow family. |
| `packages/prism-core/src/governance/observability/timeline.ts:L261–L265` | agent `agent_resumed` case | `state.status = "running"; if (state.runStep) state.runStep.status = "running"; return;` — **status-only, the `restore` payload is never read** (G4, CONFIRMED §5(b)). Plan 109's cite is exact. |
| `packages/prism-core/src/governance/observability/timeline.ts:L805–L808` | workflow `workflow_resumed` case | `state.status = "running"; break;` — status-only (G5, CONFIRMED §5(b)). Plan 109 cites `:L788–L791`; stale (that is the `workflow_finished` case). |
| `packages/prism-core/src/governance/observability/timeline.ts:L186`, `:L766` | `resolveRedactor` gate | `content !== "metadata" ? (options.redactor ?? resolveRedactor(undefined, [])) : undefined` in both projectors — the configured redactor seam Task 3's security row names. |
| `packages/prism-core/src/governance/observability/timeline.ts:L918–L948` | `buildTimeline` return | Freezes `workflowMetadata` with `redactor ? redactor.redact(...) : ...` at `:L930`; Task 3's optional `restore` spread joins the same object literal, so the field is absent (not `{}`) when there is no audit. |
| `packages/prism-core/src/governance/observability/timeline.ts:L727–L738`, `:L759–L800` | `projectAgentTimeline`, `projectWorkflowTimeline` | The two public entry points; the workflow one sorts by `sequence` (`:L768`) and folds through the same `createFoldState`. Both are covered by Task 3's tests. |
| `packages/prism-core/src/governance/observability/timeline-types.ts:L151–L169` | `TimelineProjectionOptions`, `WorkflowTimelineProjectionOptions` | `content`/`redactor`/`maxSteps` and the optional `checkpoint`. Task 3 changes neither. |

### 1.5 Verification seams later tasks extend

| Span | Seam | Behavior |
| --- | --- | --- |
| `src/__tests__/agent-run-restore-hooks.test.ts:L22–L35` | `createSuspendingAgent` fixture | Suspends on the first tool call, finishes on resume — the harness Task 2's compensation cases extend. |
| `src/__tests__/agent-run-restore-hooks.test.ts:L40–L130` | existing pins | "aborts before the claim when a hook fails, naming the hook and leaving the run resumable"; later hook never runs, status/version unchanged, next resume succeeds. Task 2 must keep every one green. |
| `packages/prism-core/src/runtime/workflows/__tests__/run.test.ts:L680–L700`, `:L755–L770` | workflow restore cases | Existing hook-failure pins on the workflow side; Task 2 adds one compensation case beside them. |
| `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts` | **no `resumed` row today** | The file has no assertion on `agent_resumed`/`workflow_resumed` (grep `resumed` → 0 hits). Task 3 adds the agent + workflow restore rows here (G5's test gap). |
| `src/__tests__/public-export-contract.test.ts:L579–L964` | `FROZEN_TYPE_EXPORTS` | Pins the root barrel's type exports. Task 2's two new public types must be added deliberately or kept module-only (G6). |
| `scripts/budgets.json:L21–L25` | `@arnilo/prism` export ceiling | `baseline: 1459` with a per-plan reason string; Task 2's +2 rebaselines with a reason entry (plan 099 owns the release-wide regeneration). |
| `scripts/plan-review-gate.test.mjs` | this review's gate | `PLAN_109_TASK_1` is appended with the tokens the evidence must name and the rejected list it must keep. |

---

## 2. Gap rows (what no current seam does)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | The failure path has no undo step: `runCheckpointRestoreHooks` `throw`s at `src/checkpoint-restore.ts:L76` and the earlier hooks' effects stay applied. **CONFIRMED runnable, §5(a).** | `src/checkpoint-restore.ts` | 2 |
| G2 | There is no handler shape that carries an identity and a second direction: `hooks` is `readonly CheckpointRestoreHook<Context>[]` (`:L56`) and the name is inferred from `hook.name \|\| hook[index]` (`:L66`). `CheckpointRestoreHandler` / `normalizeRestoreHandler` do not exist. | `src/checkpoint-restore.ts` (+ the two option types) | 2 |
| G3 | `CheckpointRestoreError` carries only `hook` + `cause` (`:L33–L42`); there is no `CheckpointRestoreCompensation` report, so a host cannot learn what was rolled back. | `src/checkpoint-restore.ts` | 2 |
| G4 | The agent projection is status-only: `packages/prism-core/src/governance/observability/timeline.ts:L261–L265` sets `status` and the run step's status and returns; the `restore` field on the event is ignored. **CONFIRMED runnable, §5(b).** | `packages/prism-core/src/governance/observability/timeline.ts` | 3 |
| G5 | The workflow projection is status-only: `packages/prism-core/src/governance/observability/timeline.ts:L805–L808` sets `status` and breaks; no `ExecutionTimeline` field exists to receive it, and `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts` has no resume row at all. **CONFIRMED runnable, §5(b).** | `packages/prism-core/src/governance/observability/timeline.ts`, `packages/prism-core/src/governance/observability/timeline-types.ts`, its test | 3 |
| G6 | `CheckpointRestoreHandler` / `CheckpointRestoreCompensation` would be new public names: `src/index.ts:L115–L121` lists exactly four restore-related types today, and `src/__tests__/public-export-contract.test.ts:L579–L964` + `scripts/budgets.json:L21–L25` pin the surface. Task 2 must add them deliberately (+2 with a reason entry) or declare them module-only — the public option fields they type make module-only the inconsistent choice, because `restoreHooks` is public on both `AgentRunResumeOptions` and `RunWorkflowOptions`. | `src/index.ts`, `src/__tests__/public-export-contract.test.ts`, `scripts/budgets.json` | 2 |
| G7 | No redactor reaches the restore executor: `RunCheckpointRestoreHooksOptions` (`:L44–L49`) has `timeoutMs` and `signal` only, and `runCheckpointRestoreHooks` has no `SecretRedactor` import. A compensation `reason` derived from a failing hook's message has no redaction seam unless Task 2 adds an optional `redactor?` and the two call sites thread one (`agent.config.redactor` is reachable at `src/agent-run-lifecycle.ts:L428`; `RunWorkflowOptions.redactor` exists at `packages/prism-core/src/runtime/workflows/types.ts:L535`). | `src/checkpoint-restore.ts` + the two call sites | 2 |
| G8 | The docs state the all-or-nothing ceiling without compensation: `docs/durable-runs.md:L45–L69` has no object-form or reverse-order rule, and `docs/workflows.md:L92` describes `restoreHooks` as bare functions only. Task 2 must amend both; Task 3 amends `docs/execution-timeline.md`. | `docs/durable-runs.md`, `docs/workflows.md`, `docs/execution-timeline.md` | 2, 3 |

---

## 3. Per-task decision (reuse as-is / extend / add new)

| Task | Decision | Named seams |
| --- | --- | --- |
| 2 | **Extend** `runCheckpointRestoreHooks` in place; **add** `CheckpointRestoreHandler`, `normalizeRestoreHandler`, `CheckpointRestoreCompensation`, and the reverse pass inside the same module. Both option types widen to the union; both contexts and both aliases (`AgentCheckpointRestoreHook`, `WorkflowCheckpointRestoreHook`) are untouched because they alias `CheckpointRestoreHook<Context>`. No duplicate loop at either call site, no new event, no new persisted field. | §1.1–§1.3; G1–G3, G6–G8 |
| 3 | **Extend** `ExecutionTimeline` with one optional field populated in the two existing `*_resumed` cases, unless this review had found no consumer — it found the event already carries the audit and the field is a pure projection of it, so (a) `ExecutionTimeline.restore?: CheckpointRestoreAudit` is the choice; (b) `ExecutionStep.metadata.restore` is **rejected as the default** because a workflow resume has no run step (R7); (c) documented event-only (R9) is the accepted fallback only if Task 3's own execution finds no host consumer. | §1.4–§1.5; G4, G5 |

---

## 4. Rejected alternatives (frozen)

None may reappear as an implementation without a new review row. R1–R5 are plan 109 Task 2's rejected
options, R6–R9 are Task 3's, R10–R12 are this task's, R13–R14 are plan 094's deferred-forever rejects.

| # | Rejected | Task | Reason |
| --- | --- | --- | --- |
| R1 | Hanging `compensate` off the function object (function-property hanging, `Object.assign(fn, { compensate })`) | 2 | Inline authoring is unreadable, nothing in this codebase hangs properties on hooks, and the declared type (`((ctx, signal) => …) & { readonly compensate?: … }`) leaks the trick into every host signature. The object form states the identity and both directions once. |
| R2 | A parallel `compensateHooks` array paired by index | 2 | Pairing is manual and silently misaligned when a hook list is filtered or reused; the reverse pass needs the identity the object form carries. `restoreHookOptions` (`src/agent-run-lifecycle.ts:L83–L92`) already concatenates two lists, which is exactly the reuse that would break index pairing. |
| R3 | Running compensation only for hooks that completed | 2 | A hook that fails halfway left a half-applied layer, and only its own `compensate` knows how to put that layer back. §5(a) shows the failing hook's layer is the one most likely to be half-applied; excluding it would leave the world less consistent than including it. |
| R4 | Re-running each hook with a `phase: "compensate"` flag instead of a second handler | 2 | Forces every hook to implement both directions in one closure and makes the "no compensation" default impossible; the default path (bare functions, no `compensate`) must stay byte-identical (plan 109 Objective). |
| R5 | A dedicated `checkpoint_restore_failed` event for compensation results | 2 | The failure path throws before the claim write, so there is no run to emit on; minting an event would create a second channel for one outcome and require every consumer switch + source adapter to learn a kind that carries only hook names. The report rides `CheckpointRestoreError.compensation`. |
| R6 | A new `checkpoint_restored` event so the audit has a dedicated stream | 3 | The audit is already published on the claim event (`agent_resumed` at `src/contracts-protocol.ts:L253`, `workflow_resumed` at `packages/prism-core/src/runtime/workflows/types.ts:L384`); a second kind adds no information and a case to every consumer and NATS/Postgres/JSONL adapter. |
| R7 | Putting the audit in `ExecutionStep.metadata` of the run step | 3 | Kept as the documented alternative, rejected as the default: only the agent projection has a run step (`packages/prism-core/src/governance/observability/timeline.ts:L261–L265` sets `state.runStep`, the workflow fold has node steps), so the two families would report the same audit in different places — or not at all. |
| R8 | Projecting the compensation report too | 3 | A failed restore never claims, so it never emits a resume event; there is nothing to project, and the report stays on the error (Task 2, R5). |
| R9 | Leaving it event-only with no documentation change | 3 | A silent drop in the review surface is exactly the gap this review exists to record; either the field lands or the decision is written down in `docs/execution-timeline.md`. |
| R10 | Treating the two items as already-designed work and skip the review | 1 | Plan 094 shipped the executor with a written-down ceiling, and both tasks change a public extension point consumed in two packages; the gap needs spans before it needs code. |
| R11 | A separate `docs/_evidence/` artifact per task | 1 | One review owns the inventory; later tasks cite its rows, matching plans 102/103/104/108. Two artifacts would let the two halves drift apart on the same primitive. |
| R12 | Registering the gate block later, with the code | 1 | The gate is the mechanism that keeps a completed review honest (`PLAN_074_TASK_1` in `scripts/plan-review-gate.test.mjs` is the shape); a Task 1 that runs without it can drift with no signal. |
| R13 | Optional parallel hook groups | 2 | Rejected in plan 094's Further Actions after review: a knob with no consumer, and the per-hook timeout already bounds the sequential pass. |
| R14 | `resumeAgentRunFrom(checkpointId, { restoreHooks })` sugar | 2 | Rejected in plan 094's Further Actions after review: `resumeAgentRun`/`resumeAgentRunStream` already accept the same options, and a second entry point would duplicate their ownership, revision, and fingerprint validation. |
| R15 | Prose findings in the plan instead of an evidence file | 1 | The repo's primitive-review gate reads a file and named tokens; prose cannot be checked and drifts. |

---

## 5. Confirmation (runnable observation)

Probe: `.phase109-probe.mjs` (not committed; deleted after this review), against the working-tree `dist/`
builds, Node v26.9.0. Raw observations:

```
A hooks: restoreGit,restoreDocs,restoreWorkspace
A error: CheckpointRestoreError ERR_PRISM_CHECKPOINT_RESTORE hook= restoreWorkspace cause= workspace service down
A layers after failure: {"git":"restored","docs":"restored","workspace":"checkpoint-fingerprint"}
A instanceof CheckpointRestoreError: true
A error keys: code,hook,name
B agent status: running
B agent timeline.restore: undefined
B agent keys: content,redacted,runId,schemaVersion,sessionId,startedAt,status,steps
B agent step keys: id,kind,name,order,startedAt,status
B workflow status: running
B workflow timeline.restore: undefined
B workflow keys: content,redacted,runId,schemaVersion,startedAt,status,steps
C 3-hook runCheckpointRestoreHooks pass (median ns): 1575
C 3-hook normalization pass (median ns): 56
C 3-hook reverse compensation pass, all no-op (median ns): 285
D audit JSON bytes (2 hooks / 3 hooks): 103 149
D projected agent timeline JSON bytes today: 263 -> with field ≈ 378
D agent_resumed event JSON bytes with audit: 180
C normalized[0].restore === noop: true id: noop
PROBE OK
```

- **(a) CONFIRMED — a later hook's failure leaves earlier layers restored.** Three fake layers; the third
  (`restoreWorkspace`) throws. The thrown error is `CheckpointRestoreError` with
  `code: "ERR_PRISM_CHECKPOINT_RESTORE"`, `hook: "restoreWorkspace"`, and `cause.message === "workspace
  service down"`; after the failure the layer map is `{"git":"restored","docs":"restored",
  "workspace":"checkpoint-fingerprint"}` — two layers moved to the checkpoint revision and the third
  untouched. `Object.keys(error)` is `code,hook,name` (`cause` is non-enumerable), so a host cannot read
  what ran or what was left behind; Task 2's `compensation` fills that hole while `.cause` keeps the
  original failure (G1, G2, G3).
- **(b) CONFIRMED — the restore audit never reaches a projection.** An `agent_resumed` event carrying
  `restore: { hooks: [{ hook: "restoreGit", durationMs: 12 }, { hook: "restoreDocs", durationMs: 3 }],
  durationMs: 15 }` projects to a timeline whose key set is
  `content,redacted,runId,schemaVersion,sessionId,startedAt,status,steps` — `timeline.restore` is
  `undefined`, and the only step projected from `agent_resumed` gains nothing (`id,kind,name,order,
  startedAt,status`). A `workflow_resumed` event with the same `restore` payload projects to the same key
  set with `timeline.restore: undefined`. Both cases are status-only exactly as cited (G4, G5); a host
  reviewing a resumed run cannot read the audit off either surface today.
- **Negative control.** A normalization function over the three bare hooks returns `{ id: "noop",
  restore: noop }` with `restore === noop` for the first entry: the planned `normalizeRestoreHandler` is
  identity-preserving for today's handlers and must not clone or wrap them.

**Refuted by the same probe:**

- Plan 109's cite `timeline.ts:788-791` for the workflow `workflow_resumed` case is stale; that range is
  the `workflow_finished` case and the resume case is `:L805–L808`.
- Plan 109's cite `src/checkpoint-restore.ts:63-81` for the loop is off by one at the start; the loop is
  `:L64–L81` and the un-undoing throw is `:L76`.
- Plan 109's cites `src/agent-run-lifecycle.ts:419-440`, `src/agent-session/session/assemble.ts:197-202`,
  `packages/prism-core/src/runtime/workflows/run/main.ts:256-275`, and
  `src/contracts-run-state.ts:269-281` are stale; the §1 spans are authoritative (`:L433–L449`,
  `:L305–L312`, `:L255–L272`, `:L280–L292`).
- Plan 109's `timeline-types.ts:113-125` / `:50-71` are one line short each; the interfaces are
  `:L114–L147` and `:L51–L72`.

---

## 6. Measured costs (numbers, not claims)

Same probe; medians over 21 batches after warmup. Regression baselines only — the shipping suites named per
task assert bounds; the harness is not committed.

| Path | Measured | Consequence for the task |
| --- | --- | --- |
| One `runCheckpointRestoreHooks` pass over 3 bare no-op hooks, today's shape (loop + 3 `AbortController`s + 3 `setTimeout`s) | **1,575 ns** per pass | The executor's dominant cost is the per-hook timer/controller, not the loop; an extra `typeof` check per hook is noise against it. |
| The planned normalization pass over the same 3 handlers (`typeof hook === "function" ? { id, restore: hook } : hook`) | **56 ns** per pass (≈19 ns per hook) | **O(hooks) confirmed**, ~3.5% of one executor pass, allocated once per restore call — not per hook execution. Plan 109 Task 2's "one normalization pass (O(hooks)) and no extra hook execution" holds. |
| One reverse compensation pass, 3 no-op handlers, `for (i = len-1; i >= 0; i--) await compensate()` | **285 ns** wall clock | The failure path pays ≈0.3 µs of loop overhead plus the handlers' own work; a success path pays nothing (Task 2's performance criterion). |
| Serializable bytes a `restore` audit adds to a projected timeline: audit JSON with 2 hooks / 3 hooks | **103 B / 149 B** | A 3-hook timeline grows 263 B → ≈378 B with the field (+1 key + the audit). Same bytes already ride the `agent_resumed`/`workflow_resumed` event (measured 180 B for the 2-hook event) — the projection copies, it does not enlarge. |
| `CheckpointRestoreError` enumerable keys today | `code,hook,name` | `compensation` adds one property; `cause` stays non-enumerable. No serialization growth anywhere except the error body a host forwards. |

---

## 7. Security confirmations and hard rejections

Field-by-field, for every new persisted or projected field:

- **`CheckpointRestoreHandler<Context>` (Task 2)** — host code, never persisted, never projected. It is a
  callable in the host's own process at the same trust level as today's `CheckpointRestoreHook`; nothing
  about it reaches a checkpoint, event, timeline, or error body.
- **`CheckpointRestoreError.compensation` (Task 2)** — `{ ran: readonly string[]; failed?: { hook: string;
  reason: string } }`. `ran` and `failed.hook` are the audit name (`id ?? restore.name ?? hook[i]`,
  `src/checkpoint-restore.ts:L66`): a host-chosen identifier of the same class as today's `.hook`, which
  already crosses the server boundary (`packages/prism-core/src/runtime/server/handler/respond.ts:L30–L31`
  maps `ERR_PRISM_CHECKPOINT_RESTORE` to `409` carrying the error message). `failed.reason` is the only
  free text: it must be **truncated at insert** to a fixed cap (reuse
  `DEFAULT_LIFECYCLE_MAX_REASON_BYTES`-style bounding, or the executor's own constant) and passed through
  the configured redactor before it reaches the error body. **G7 is a redaction gap, not a disclosure by
  design**: the executor has no redactor option today, so Task 2 adds `redactor?: SecretRedactor` to
  `RunCheckpointRestoreHooksOptions` and both call sites thread the redactor they already hold
  (`agent.config.redactor`, `RunWorkflowOptions.redactor`); with no redactor configured the reason is
  truncated only, exactly like the `.cause` message that already crosses. Hook **arguments** (checkpoint
  metadata) are never copied into the report — only names and the message.
- **`ExecutionTimeline.restore?: CheckpointRestoreAudit` (Task 3)** — the type is
  `{ hooks: [{ hook, durationMs }], durationMs }` **by construction** (`src/checkpoint-restore.ts:L15–L27`);
  there is no field a host payload can ride. Hook names are host-chosen identifiers (same class as step
  `name` today), `durationMs` is an integer. The bytes already cross the event boundary; the projection
  adds a copy, not a channel. Where a projection redactor is configured
  (`packages/prism-core/src/governance/observability/timeline.ts:L186`, `:L766`), the
  field copies through like every other metadata field; content policy governs `input`/`output` only
  (`docs/policy-and-audit.md:L28`) and is untouched.
- **No persisted field is added by either task.** Task 2 touches neither checkpoint shape nor
  `maxStateBytes`; Task 3 touches no store. The compensation report dies with the thrown error unless the
  host forwards it.

---

## 8. Evidence-artifact scope

Read-only for the tree: this file adds no code, no test, and no docs navigation. `docs/index.md` is not
touched (evidence files are not navigation targets, `.agents/skills/create-plan/references/prism-wiki.md`).
Tasks 2–3 must cite a row from §1/§2; any new primitive they need that is absent here is a review gap and
must be added to §2 before implementation. Task 2 carries G6 (public type export + budget rebaseline) and
G7 (compensation redaction seam) as implementation decisions; Task 3 carries G5's missing test row and the
§3(a) choice. All measured numbers in §6 are from the probe above; the executor pass, normalization pass,
compensation pass, and audit bytes are the four figures plan 109 asked for.

**Status.** Task 2 landed (2026-09-22): G1–G3 are retired. `CheckpointRestoreHandler<Context>` accepts
the bare function or `{ id?, restore, compensate? }`; the object interface stays module-private, so the
root surface grew by exactly the two G6 names (`CheckpointRestoreHandler`, `CheckpointRestoreCompensation`,
measured 1461 vs baseline 1459 with a reason entry) — `normalizeRestoreHandler` is the single executor-boundary
pass. On failure the reverse pass runs `failedIndex…0` (failing hook first, including a timed-out hook) under
the same `restoreHookTimeoutMs`, records only the first compensation failure as a redacted, 1 KiB-capped
`reason`, and continues; a caller abort stops the pass and rethrows the abort unchanged, and compensation
never starts after an abort (G7 threaded the configured redactor from both call sites). With no `compensate`
anywhere the error's enumerable keys stay `code,hook,name` — pinned by the existing plan-094 failure test.

**Task 3 landed (2026-09-22):** G5 is retired and §3's option (a) shipped. `ExecutionTimeline.restore?:
CheckpointRestoreAudit` (the core type imported from `@arnilo/prism`, no duplicate) is set only when the
claiming `agent_resumed` / `workflow_resumed` event carries an audit, in the two existing status-only cases
(`timeline.ts:262`, `timeline.ts:806`), and spread into both return objects — `buildTimeline` for the agent,
trace, and incremental-folder paths, and `projectWorkflowTimeline`'s own return (the workflow folder delegates
to it). No new event kind, step kind, projection option, or per-turn cost. §1.4's redactor rows hold: the
field is copied verbatim because the type is `{ hook, durationMs }` by construction; R7 (`ExecutionStep.metadata`)
and R9 (event-only) stay rejected. `timeline.test.ts` gained the two resume rows (agent + workflow: order,
durations, absent-not-`{}` for resume-without-hooks, absent for never-resumed) — 21/21 green, full `prism-core`
688 pass + 9 skipped, root `public-export-contract` green. The only review surface a compensation report could
reach remains unreachable by design (R8): a failed restore never claims and never emits.
