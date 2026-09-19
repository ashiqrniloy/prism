# Checkpoint Restore Follow-Ups: Partial-Restore Compensation and Restore Audit Surfaces

Release: 0.9.x follow-up to plan 094, recorded from that plan's Further Actions. Nothing here is part of plan 099's 0.9.0 cut unless a host pulls it forward. Both items are ceilings of shipped behavior, not gaps in the shipped contract: plan 094's executor fails closed but does not undo the layers it already restored — `runCheckpointRestoreHooks` throws on the first failure and clears its timer (`src/checkpoint-restore.ts:63-81`), pinned by `src/__tests__/agent-run-restore-hooks.test.ts` ("aborts before the claim when a hook fails, naming the hook and leaving the run resumable") — so a host restoring git → docs → workspace that fails on workspace leaves git and docs moved to the checkpoint's revision while the run stays suspended; and the successful audit rides `agent_resumed.restore` / `workflow_resumed.restore` only, while the two surfaces Prism ships for post-hoc review drop it (`packages/prism-core/src/governance/observability/timeline.ts:261-265` and `:788-791` flip status and ignore the field). Task 1 confirms both with spans and a runnable observation before anything changes.

## Objectives
- Let a restore hook declare how to undo its own layer, so a failure at hook *n* rolls back hooks *n*…1 in reverse instead of leaving a partially restored world.
- Surface the restore audit where review happens (`ExecutionTimeline`) or record the decision to keep it event-only, without minting a second event kind.
- Keep plan 094's defaults byte-identical: bare-function hooks, no `compensate`, no projected field ⇒ exactly today's behavior.

## Expected Outcome
- Restore hooks accept an object form (`{ id?, restore, compensate? }`) alongside today's bare functions; a failing restore compensates completed hooks in reverse — including the failing hook's own `compensate`, since only it can undo a half-applied layer — and `CheckpointRestoreError.compensation` names what ran and what could not be undone while `.cause` keeps the original failure. With no `compensate` anywhere, the failure path is unchanged.
- A resumed run's `ExecutionTimeline` carries the same `{ hooks: [{ hook, durationMs }], durationMs }` an event subscriber already sees, for agent and workflow resumes alike; a run that never resumed omits the field. If Task 1 finds no consumer for it, the accepted outcome is a documented event-only decision instead (Task 3's fallback), not a half-built projection.
- `docs/durable-runs.md`, `docs/workflows.md`, and `docs/execution-timeline.md` state the compensation rules and the audit surface.

## Tasks

- [ ] Task 1: Primitive review — restore, compensation, and audit surfaces (P2)
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase109-primitive-review.md` exists with three sections — (a) reuse rows for every primitive the later tasks build on, each with a `path:line` span, (b) gap rows naming what no current seam does, (c) rejected alternatives with the reason (including every rejected option in Tasks 2 and 3).
    - Functional: the review confirms or refutes, with a runnable observation, (a) that today's executor leaves an earlier layer restored when a later hook fails — drive `runCheckpointRestoreHooks` with two fake layers whose second throws and print the first layer's state — and (b) that `agent_resumed.restore` / `workflow_resumed.restore` never reaches a projection: `packages/prism-core/src/governance/observability/timeline.ts:261-265` and `:788-791` are status-only, so a host cannot read the audit off `ExecutionTimeline` today.
    - Functional: the review records exact spans for `runCheckpointRestoreHooks`, `CheckpointRestoreError`, `CheckpointRestoreAudit`, `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS` (`src/checkpoint-restore.ts:12-47`, loop `:63-81`), the agent call site and audit flow (`src/agent-run-lifecycle.ts:419-440`, `src/agent-session/session/assemble.ts:197-202`), the workflow call site and audit flow (`packages/prism-core/src/runtime/workflows/run/main.ts:256-275`, `packages/prism-core/src/runtime/workflows/run/scheduler.ts:124`), the two contexts and hook aliases (`src/contracts-run-state.ts:269-281`, `packages/prism-core/src/runtime/workflows/types.ts:514-524`, options `:567`), and the projection seams (`packages/prism-core/src/governance/observability/timeline-types.ts:113-125` for `ExecutionTimeline`, `:50-71` for `ExecutionStep.metadata`).
    - Functional: the review states per later task whether it reuses a seam as-is, extends it, or adds a new one — Task 2 (`runCheckpointRestoreHooks` normalization plus reverse pass, `CheckpointRestoreError` shape), Task 3 (`ExecutionTimeline` field vs `ExecutionStep.metadata` vs event-only).
    - Performance: the review records measured numbers, not claims — one `runCheckpointRestoreHooks` pass over three hooks before and after the object form (normalization must stay O(hooks)), bytes a `restore` audit adds to a projected timeline, and the wall-clock cost of one compensation pass.
    - Code Quality: the review is deterministic evidence, not prose; every reuse row names the exact exported symbol, every gap row names the file that would have to change, and each rejected alternative names the task it would have affected. It adds the matching `PLAN_109_TASK_1` block to `scripts/plan-review-gate.test.mjs` (plan path, evidence path, required tokens, rejected tokens) so the review cannot silently drift.
    - Security: the review states for every new persisted or projected field why it carries no host payload — the audit is `{ hook, durationMs }` by construction (`src/checkpoint-restore.ts:15-27`) — and specifies that compensation results are hook names plus a bounded reason string, with the failing hook's own message treated as untrusted text that passes the configured redactor before it reaches any event, timeline, or error body a host forwards.
  - Approach:
    - Documentation Reviewed:
      - Plan 094 `Compromises Made` + `Further Actions` (the source of both tasks); `docs/durable-runs.md:45-69,126` (the shipped restore-hooks contract), `docs/workflows.md:92-99` (workflow parity), `docs/execution-timeline.md` (the review surface), `docs/policy-and-audit.md` (what a review surface may carry).
    - Options Considered:
      - Treat the items as already-designed work and skip the review — rejected: plan 094 shipped the executor with a written-down ceiling, and both tasks change a public extension point (`CheckpointRestoreHook` consumers in two packages), so the gap needs spans before it needs code.
      - A separate `docs/_evidence/` artifact per task — rejected: one review owns the inventory; later tasks cite its rows, matching plans 102/103/104/108.
      - Registering the gate block later, with the code — rejected: the gate is the mechanism that keeps a completed review honest (`scripts/plan-review-gate.test.mjs` `PLAN_074_TASK_1` is the shape), and a Task 1 that runs without it can drift with no signal.
    - Chosen Approach: one evidence file mapping both 094 Further Actions to existing primitives or named gaps, with a runnable confirmation of both ceilings, measured costs, and the rejected list that Tasks 2 and 3 must not re-open.
    - API Notes and Examples:
      ```text
      reuse: src/checkpoint-restore.ts:63-81      runCheckpointRestoreHooks (sequential, per-hook timeout)  → Task 2 (extend: normalize handlers, reverse compensate on failure)
      reuse: src/checkpoint-restore.ts:33-42      CheckpointRestoreError { hook, cause }                    → Task 2 (extend: optional compensation report)
      reuse: src/checkpoint-restore.ts:15-27      CheckpointRestoreAudit { hooks[], durationMs }            → Task 3 (project unchanged)
      reuse: src/agent-session/session/assemble.ts:197-202  agent_resumed.restore emit                     → Task 3 (source row)
      reuse: .../run/scheduler.ts:124             workflow_resumed.restore emit                             → Task 3 (source row)
      gap:   .../observability/timeline.ts:261-265 agent_resumed projection is status-only                   → Task 3
      gap:   .../observability/timeline.ts:788-791 workflow_resumed projection is status-only                → Task 3
      gap:   src/checkpoint-restore.ts:76         failure path throws with no undo step                     → Task 2
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase109-primitive-review.md` (new).
      - `scripts/plan-review-gate.test.mjs`: `PLAN_109_TASK_1` block.
    - References:
      - `scripts/plan-review-gate.test.mjs` (gate shape), `docs/_evidence/phase74-primitive-review.md` (span-citation expectation), plan 104 Task 1 (sibling review shape), plan 094 Task 3 deliverables (`src/checkpoint-restore.ts`, `src/__tests__/agent-run-restore-hooks.test.ts`, `packages/prism-core/src/runtime/workflows/__tests__/run.test.ts`).
  - Test Cases to Write:
    - None (evidence artifact); the check is `node --test scripts/plan-review-gate.test.mjs` plus every later task's Approach citing a row from this file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence only).
    - Docs pages to create/edit:
      - `docs/_evidence/phase109-primitive-review.md`: new evidence artifact (not a navigation surface).
    - `docs/index.md` update: no (`docs/_evidence/` is not indexed).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2: Reverse-order compensation for partially restored layers (P3, host-demand gated)
  - Acceptance Criteria:
    - Functional: `CheckpointRestoreHandler<Context>` is a union of today's `CheckpointRestoreHook<Context>` function and `{ id?: string; restore: CheckpointRestoreHook<Context>; compensate?: CheckpointRestoreHook<Context> }`; `restoreHooks` on `AgentRunResumeOptions`/`AgentRunLifecycleOptions` and `RunWorkflowOptions` widens to it, so every existing bare function keeps compiling and behaving identically (no runtime branch for hosts that pass none).
    - Functional: when hook *i* throws or times out, compensation runs for *j* = *i*…0 in reverse order, each under the same per-hook timeout from `restoreHookTimeoutMs`; the audit name is `id ?? restore.name ?? hook[i]`. Compensation failures are collected, never mask the original error, and a caller abort during compensation stops the pass and rethrows the abort so a cancel still reads as cancelled.
    - Functional: `CheckpointRestoreError` gains `compensation?: { ran: readonly string[]; failed?: { hook: string; reason: string } }`; with no `compensate` handler anywhere the thrown error, its `cause`, and the untouched checkpoint are exactly plan 094's shape.
    - Functional: semantics are recorded where they are implemented — only hooks that already ran (plus the failing one) are compensated, and compensation is best-effort: the checkpoint stays unclaimed and resumable either way, so a host retries the whole resume.
    - Performance: the success path adds one normalization pass (O(hooks)) and no extra hook execution; only a failure pays the compensation pass. Measured in Task 1's review, pinned by a test that a 3-hook successful resume still calls `runCheckpointRestoreHooks` once with zero compensate calls.
    - Code Quality: normalization happens once at the executor boundary (`normalizeRestoreHandler`), not at each call site; the two context types (agent `src/contracts-run-state.ts:269-281`, workflow `packages/prism-core/src/runtime/workflows/types.ts:514-524`) are untouched because both alias `CheckpointRestoreHook<Context>`; no duplicate compensation loop in either call site.
    - Security: compensation reports only hook names and a bounded reason (message truncated, secrets never copied from hook arguments); the error still crosses the server boundary verbatim-but-redacted (`packages/prism-core/src/runtime/server/handler/respond.ts` maps `ERR_PRISM_CHECKPOINT_RESTORE` to 409), and compensation never runs host code after the caller has aborted.
  - Approach:
    - Documentation Reviewed:
      - `docs/durable-runs.md:45-69,126` (restore contract and its security note), `docs/workflows.md:92-99` (workflow parity + audit sentence), plan 094 Task 3 delivered notes (`plans/094-…md`, Task 3 `Delivered`), `src/checkpoint-restore.ts` (executor body), Task 1's evidence file rows for Task 2.
    - Options Considered:
      - Optional property on the function object (`Object.assign(fn, { compensate })` by hosts; `((ctx, signal) => …) & { readonly compensate?: … }` in the type) — rejected: the inline authoring is unreadable, and nothing today uses function-property hanging.
      - A parallel `compensateHooks` array paired by index — rejected: pairing is manual and silently misaligned when a hook list is filtered or reused; the reverse pass needs the identity the object form carries.
      - Running compensation only for hooks that *completed* — rejected: a hook that failed halfway left a half-applied layer, and its own handler is the only code that knows how to put that layer back, so it leads the reverse pass.
      - Re-running each hook with a `phase: "compensate"` flag instead of a second handler — rejected: it forces every hook to implement both directions in one closure and makes the "no compensation" default impossible.
      - A dedicated `checkpoint_restore_failed` event for compensation results — rejected: the failure path is a thrown `CheckpointRestoreError` before the claim write, and minting an event for it would create a second channel for one outcome; the report rides the error.
    - Chosen Approach: widen the hook type with an object form, normalize once inside `runCheckpointRestoreHooks`, and on failure run the reverse compensation pass above the existing throw — one executor change; both call sites inherit it and the default path is untouched.
    - API Notes and Examples:
      ```ts
      // Same handler, both layers:
      await lifecycle.resume(ref, { decision: "approve", expectedVersion }, {
        restoreHooks: [
          { id: "docs", restore: (cp) => docs.restoreVersion(cp.metadata?.docVersion),
            compensate: () => docs.restoreVersion(previousVersion) },
          { id: "git", restore: (cp) => git.reset(cp.metadata?.gitCommit),
            compensate: (cp) => git.reset(cp.metadata?.previousCommit) },
        ],
      });
      // git.restore fails → docs.compensate(), git.compensate() run in that order (reverse of [docs, git])
      // → CheckpointRestoreError { code: "ERR_PRISM_CHECKPOINT_RESTORE", hook: "git",
      //      compensation: { ran: ["git", "docs"] }, cause }
      ```
      ```text
      // src/checkpoint-restore.ts — shape (sketch)
      export type CheckpointRestoreHook<Context> = (checkpoint: Context, signal: AbortSignal) => void | Promise<void>;
      export interface CheckpointRestoreHandlerObject<Context> { readonly id?: string; readonly restore: CheckpointRestoreHook<Context>; readonly compensate?: CheckpointRestoreHook<Context>; }
      export type CheckpointRestoreHandler<Context> = CheckpointRestoreHook<Context> | CheckpointRestoreHandlerObject<Context>;
      export interface CheckpointRestoreCompensation { readonly ran: readonly string[]; readonly failed?: { readonly hook: string; readonly reason: string }; }
      ```
    - Files to Create/Edit:
      - `src/checkpoint-restore.ts`: object form + normalization, reverse compensation pass, `CheckpointRestoreCompensation`, `CheckpointRestoreError.compensation`.
      - `src/contracts-run-state.ts` (`restoreHooks` widens), `packages/prism-core/src/runtime/workflows/types.ts:567` (`restoreHooks` widens).
      - `src/index.ts` + `src/__tests__/public-export-contract.test.ts`: export `CheckpointRestoreHandler`, `CheckpointRestoreCompensation`; `scripts/budgets.json`: rebaseline the `@arnilo/prism` export count with a reason entry (plan 099 owns the release-wide regeneration; this task only keeps the number honest for its own +2).
      - `src/__tests__/agent-run-restore-hooks.test.ts`: compensation cases; `packages/prism-core/src/runtime/workflows/__tests__/run.test.ts`: one workflow-side compensation case.
      - `docs/durable-runs.md` (§Restore hooks: object form, reverse order, best-effort limits), `docs/workflows.md:92` row text.
    - References:
      - `src/checkpoint-restore.ts:63-81` (the loop to extend), `src/agent-run-lifecycle.ts:419-440` and `packages/prism-core/src/runtime/workflows/run/main.ts:256-275` (the two call sites that inherit the change), `src/__tests__/agent-run-restore-hooks.test.ts` (existing pins that must stay green: later hook never runs, status/version unchanged, next resume succeeds).
  - Test Cases to Write:
    - Second hook throws with both handlers compensated: layers are back to pre-resume state in reverse order (`["git", "docs"]` when the failing hook is `git`), error names the failing hook, `compensation.ran` is the reverse list, and the checkpoint is still `suspended` at the same version (next resume with fixed hooks succeeds).
    - Failing hook's own `compensate` runs first in the pass (half-applied layer put back), proving the "include the failing hook" rule.
    - A `compensate` that itself throws: original error preserved as `.cause`, `compensation.failed` names it, and later compensations still run.
    - No `compensate` anywhere (bare functions, today's usage): failure shape byte-identical to plan 094 — `compensation` omitted, later hook never runs, zero extra calls on the success path.
    - Caller abort during compensation: the pass stops, the abort reason is rethrown unchanged (not wrapped as `CheckpointRestoreError`), and remaining compensations do not run.
    - Workflow side: one case mirroring the agent case on `resumeWorkflow` (checkpoint untouched, `compensation.ran` reported).
    - `release:gate`: additions only — no baseline regeneration in this task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `restoreHooks` accepts a second handler shape and `CheckpointRestoreError` gains `compensation`.
    - Docs pages to create/edit:
      - `docs/durable-runs.md` (§Restore hooks): object form example, reverse-order rule, "compensation is best-effort, the checkpoint stays resumable" sentence.
      - `docs/workflows.md`: the `restoreHooks` row and the paragraph note that compensation is shared with agent resumes.
    - `docs/index.md` update: no (existing pages only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3: Restore audit on the review surface (P3, reviewer-demand gated)
  - Acceptance Criteria:
    - Functional: Task 1's review decides and records the surface with evidence: (a) `ExecutionTimeline.restore?: CheckpointRestoreAudit` — uniform for agent and workflow resumes, mirroring the `workflowMetadata` precedent (`timeline-types.ts:113-125`); (b) `ExecutionStep.metadata.restore` on the run step — rejected unless the review finds an agent-only consumer, because a workflow resume has no matching step and the two families would report differently; (c) documented event-only — the accepted fallback when no host or tool consumes it.
    - Functional: with (a) chosen, `ExecutionTimeline.restore` carries the same entries the `agent_resumed` / `workflow_resumed` event published (order preserved, `durationMs` included), is absent (not `{}`) on a run that never resumed, and renders identically for both families.
    - Functional: with (c) chosen, `docs/execution-timeline.md` states that the restore audit is event-only with the reason, and no code changes land.
    - Performance: no per-event work beyond the fields already copied; a timeline projected from a resumed run's events stays O(events), and the field adds no per-turn cost.
    - Code Quality: the projection lives in the two existing `*_resumed` cases (`timeline.ts:261-265`, `:788-791`) and `projectWorkflowTimeline`; no new event kind, no new step kind, no duplicated audit type (the core `CheckpointRestoreAudit` is imported from `@arnilo/prism`, which `prism-core` already does at `packages/prism-core/src/runtime/workflows/run/main.ts:4`).
    - Security: the projected audit carries hook names and durations only; if a redactor is configured for the projection it passes through unchanged (names are host-chosen identifiers, and Task 1's review states why no payload can ride the type); content policy still governs `input`/`output` and is untouched.
  - Approach:
    - Documentation Reviewed:
      - `docs/execution-timeline.md` (the surface's contract), `docs/workflows.md:99` (what `workflow_resumed.restore` means), `docs/durable-runs.md:69` (the event the audit already rides), plan 094 Task 2 (`workflowMetadata` projection as the precedent), `packages/prism-core/src/governance/observability/timeline-types.ts:113-125`.
    - Options Considered:
      - A new `checkpoint_restored` event so the audit has a dedicated stream — rejected: the audit is already published on the claim event, and a second kind means every consumer switch and source adapter (NATS/Postgres/JSONL) needs a new case for no new information.
      - Putting the audit in `ExecutionStep.metadata` of the run step — kept as a documented alternative, rejected as the default because only the agent projection has that step.
      - Projecting the compensation report too — rejected: a failed restore never claims, so it never emits a resume event; the report stays on the error (Task 2).
      - Leaving it event-only with no documentation change — rejected: a silent drop in the review surface is exactly the kind of gap Task 1 exists to record, so either the field lands or the decision is written down.
    - Chosen Approach: `ExecutionTimeline.restore?: CheckpointRestoreAudit` populated in the two existing `*_resumed` projection cases, unless Task 1 records that no consumer exists — then the documented event-only outcome is the deliverable.
    - API Notes and Examples:
      ```ts
      const timeline = projectTimeline(events);
      timeline.restore; // { hooks: [{ hook: "git", durationMs: 12 }, { hook: "docs", durationMs: 3 }], durationMs: 15 }
      // an unresumed run: undefined
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/governance/observability/timeline-types.ts` (`ExecutionTimeline.restore`), `timeline.ts` (agent + workflow resume cases).
      - `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts`: agent and workflow restore rows.
      - `docs/execution-timeline.md` (field row), `docs/workflows.md` (graph/review note).
    - References:
      - `packages/prism-core/src/governance/observability/timeline.ts:261-265`, `:788-791`; `src/agent-session/session/assemble.ts:197-202`; `packages/prism-core/src/runtime/workflows/run/scheduler.ts:124`; Task 1's evidence rows for Task 3.
  - Test Cases to Write:
    - Agent resume with hooks: `timeline.restore` equals the event's audit (order and durations), and `timeline.status === "running"` as today.
    - Workflow resume with hooks: same field, same shape.
    - Resume without hooks (plan 094 default): field absent, no `{}`.
    - Run that never resumed: field absent.
    - With `contentPolicy: "metadata"`: the field still projects (it is low-cardinality metadata, never content).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `ExecutionTimeline` gains an optional field.
    - Docs pages to create/edit:
      - `docs/execution-timeline.md`: field row next to `workflowMetadata`, with the "audit is metadata, never content" note.
      - `docs/workflows.md`: one sentence that the workflow graph review surface carries the same audit.
    - `docs/index.md` update: no (existing pages only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
