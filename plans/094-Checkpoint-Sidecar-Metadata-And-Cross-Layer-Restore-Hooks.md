# Checkpoint Sidecar Metadata and Cross-Layer Restore Hooks

Release: 0.9.0 (P1). Makes clay's post-hoc discard drill (branch session + git reset + document versions in one action) a one-API-call primitive.

## Objectives
- Hosts attach opaque metadata (git commit id, document version, workspace fingerprint) to session checkpoints.
- Restore hooks: host callbacks invoked on checkpoint restore so external state trees revert consistently.
- Existing checkpoint semantics unchanged when unused.

## Expected Outcome
- One `restoreCheckpoint(id)` call reverts conversation + registered external layers; nothing is silently half-restored — a restore that cannot complete a hook rolls back with a structured error.

## Tasks

- [x] Task 1: Primitive review — checkpoint codec and restore path
  - Acceptance Criteria:
    - Functional: Inventory checkpoint create/restore path (`packages/prism-core/src/runtime/workflows/checkpoints.ts`, `checkpoint-core.ts`, `run/checkpoint.ts`, session codecs `packages/prism-core/src/sessions/codecs/checkpoint.ts`, stores `sqlite/`, `postgres/`) and where metadata + hooks attach without schema forks.
    - Performance / Code Quality / Security: analysis only.
  - Approach:
    - Documentation Reviewed: `docs/session-stores-and-branching.md`, `docs/durable-runs.md`.
    - Options Considered: n/a.
    - Chosen Approach: Additive metadata map on existing checkpoint record; hooks registered per session host.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: none.
    - References: clay discard-drill design (host repo `~/Projects/clay`, plans 120–123).
  - Findings (reviewed 2026-09-19):
    - **Three checkpoint families, one shared record shape.**
      1. Generic `CheckpointStore` — contract `src/contracts-core/persistence.ts:61` (`metadata?: Record<string, unknown>` on save), `:74` (on record), `:86` (interface). Memory `src/checkpoints.ts:33` (value capped by `maxValueBytes`; `metadata` cloned uncapped `:66`); SQLite `packages/prism-core/src/sessions/sqlite/checkpoints.ts:75` (`metadata` column in DDL `:41`, CAS upsert `:67`, bind `:100`, decode `:179`; additive-column precedent: runtime `ALTER` `:51`); Postgres `packages/prism-core/src/sessions/postgres/checkpoints.ts:54` (JSONB `:38`, bind `:91`, decode `:172`). Shared codec `packages/prism-core/src/sessions/codecs/checkpoint.ts` is key/version/CAS/JSON helpers only — no metadata shape code, so an opaque map needs no codec change.
      2. Agent run-state checkpoints (the "session checkpoint" that restores conversation) — namespace `prism.agent-run`, `src/agent-run-state.ts:31`; save `:213`, load `:195`. Write path `src/agent-session/session/persist.ts` (`persistDurable:14`, `suspendDurable:60`, `checkpointDurableTurn:118`, `checkpointDurableFold:132`). Restore path `src/agent-run-lifecycle.ts` (`resume`/`resumeStream:73/89` → `prepareAgentRunResume:186` → claim CAS `:373` → `executePreparedAgentRunResume:405` → `RuntimeAgentSession.resumeDurable`, `src/agent-session/session.ts:306` → `runInternal`).
      3. Workflow checkpoints — adapter `packages/prism-core/src/runtime/workflows/checkpoints.ts:34/39`, namespace `prism.workflow` `:26`; single write chokepoint `run/checkpoint.ts:15` (`metadata` written into the value at `:65`; serialized via `state.checkpointChain`, terminal writes ignore abort); restore `run/main.ts:141-207` (load → ownership → schema → definitionHash → resume validation → scheduler rebuild); nested child resume `run/node-execution.ts:465-500`; callers `replay.ts:34`, `commands.ts:381`, `coordinator.ts:290`.
    - **Metadata attaches with zero schema work.** Generic record `metadata` already round-trips in memory/SQLite/Postgres, yet **no caller writes it today** (all 34 `saveCheckpoint` call sites — workflow adapter, agent run state, artifacts `runtime/server/artifacts-service.ts:204`, channels, schedules — pass `value` only). Task 2 = thread the map through existing params, not new storage.
    - **Workflow metadata already exists** as `WorkflowCheckpointValue.metadata` (`runtime/workflows/types.ts:292`), fed by `RunWorkflowOptions.metadata` (`types.ts:543`), redacted+bounded by `boundCheckpointValue` (`workflows/util.ts:77`, cap `limits.ts:16-17`: default 1 MiB / hard 8 MiB). Record-level `WorkflowCheckpointSaveInput` (`types.ts:295`) has no metadata field; the map rides the value. Timeline consumption gap: `projectWorkflowTimeline` (`governance/observability/timeline.ts:738`) takes `checkpoint?: WorkflowCheckpointValue` (`timeline-types.ts:165`) but emits only `workflowId`/`workflowRevision` (`timeline.ts:911-912`) — Task 2 only needs projection exposure here.
    - **Agent run-state metadata is the real work.** `saveAgentRunState` passes no `metadata`; value is redacted + capped by `maxStateBytes` (default 256 KiB / hard 1 MiB, `src/agent-run-state.ts:33-34`) but a record `metadata` map bypasses both redactor and cap — Task 2 must enforce the 4 KiB cap + `SecretRedactor` (`src/redaction.ts:22`, `resolveRedactor:94`) at the write path, since no store caps `metadata`. Read surface also drops it: `loadAgentRunState` returns the record, but `AgentRunStatusResult` (`src/contracts-run-state.ts:276`) exposes only `state`+`version`.
    - **Restore-hook seam already exists.** `AgentRunResumeOptions.onSession` (`src/contracts-run-state.ts:261`) is invoked in `prepareAgentRunResume` at `src/agent-run-lifecycle.ts:222` — after load/validation, before the claim CAS and before `resumeDurable` replays conversation. A throw propagates and writes nothing (fail-closed), giving Task 3's two-phase semantics from existing plumbing. Task 3 adds the per-host hook registry (`session.onCheckpointRestore`) and runs hooks on the claim path only, never on deny/resuspend. Workflow equivalent: a hook would sit in `resumeWorkflow` after validation and before `executeScheduler` (`run/main.ts:141`); nested children route through the same function.
    - **Corrections to Tasks 2–3 assumptions.** (a) There is no JSONL checkpoint store — `src/node/session-store-jsonl.ts` implements `SessionStore` only (`src/contracts-core/session.ts:46`); the third round-trip leg is the memory store. (b) No shared timeout utility exists; the repo pattern is inline `AbortSignal.timeout(...)` (`run/node-execution.ts:71`, `runtime/server/webhooks.ts:434`) or `setTimeout`+abort. (c) "Existing policy events" do not exist — `ExecutionPolicy` (`src/execution-policy.ts:20-45`) is a gate, not an emitter; restore auditing means an emitted `AgentEvent`/ledger record if kept. (d) 4 KiB cap is consistent with sibling caps (search cursor 1 KiB, snippet 4 KiB).
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] Task 2: Sidecar metadata on checkpoints
  - Acceptance Criteria:
    - Functional: `checkpoint(session, { metadata: Record<string, string> })` — opaque key/value map (size-capped, default 4KiB) persisted with the checkpoint in all stores (memory/sqlite/postgres; the JSONL session store has no checkpoint capability, Task 1 finding); returned on checkpoint reads and timeline projections. Workflow checkpoints already store this map in `value.metadata` — there the task is read/projection exposure only.
    - Performance: One map per checkpoint; no per-turn cost. Sizing trade-off documented: +4KiB max per checkpoint, zero when unused.
    - Code Quality: Additive codec fields with version tolerance (older records lack metadata — readers treat as empty); no new store tables.
    - Security: Metadata is opaque strings, redaction-exempt only if host marks keys public — default run through standard redaction matcher to prevent accidental secret pinning; enforced cap.
  - Approach:
    - Documentation Reviewed: Task 1; codec versioning conventions in `packages/prism-core/src/sessions/codecs/`.
    - Options Considered:
      - Typed metadata schema per layer (git/doc): rejected — prism can't enumerate host layers; opaque chosen.
    - Chosen Approach: Opaque map + redaction + cap.
    - API Notes and Examples:
      ```ts
      const cp = await session.checkpoint({ metadata: { gitCommit: sha, docVersion: "v12", workspace: "fp-77e1" } });
      ```
    - Files to Create/Edit:
      - `src/agent-run-state.ts` (`saveAgentRunState` metadata param + cap/redact), `src/agent-session/session/persist.ts` (pass through), `src/contracts-run-state.ts` (`AgentRunStatusResult.metadata`).
      - Workflow side: `packages/prism-core/src/runtime/workflows/checkpoints.ts` + `governance/observability/timeline.ts` — expose existing `value.metadata` on records/projections; no new persistence (Task 1 finding).
      - Stores/codecs need no change: `metadata` already round-trips in memory/SQLite/Postgres.
    - References: clay post-hoc discard.
  - Delivered (2026-09-19):
    - **Public surface.** `AgentRunCheckpointMetadata` (`Readonly<Record<string, string>>`) + `AgentRunCheckpointMetadataSource` (map or `() => map`, resolved per write) in `src/contracts-run-state.ts`; `MAX_AGENT_RUN_METADATA_BYTES = 4 KiB`, `boundCheckpointMetadata` (redact → string-only → cap → freeze), `readCheckpointMetadata` (legacy-tolerant: absent/oversize/non-string entries read as absent) and `resolveCheckpointMetadata` in `src/agent-run-state.ts`, exported from the barrel (freeze list updated in `src/__tests__/public-export-contract.test.ts`).
    - **Write path.** `AgentRunStateOptions.checkpointMetadata` (per-run or `AgentConfig.runState`); `saveAgentRunState` redacts + caps and passes record `metadata` to `saveCheckpoint` — no store/codec change, no state-value change, no `maxStateBytes` charge. `AgentRunResumeOptions.checkpointMetadata` + `AgentRunLifecycleRequest.checkpointMetadata` annotate the claim write.
    - **Preservation.** Claim, deny, resumed-run and terminal writes keep the record's existing map when the host supplies no source: `loadAgentRunState` returns the normalized `metadata`, and `prepareAgentRunResume` seeds it into `ActiveDurableRun.checkpointMetadata` (`src/agent-approval.ts`) via a new optional `resumeDurable` argument (`src/agent-session/session.ts:306`); `persistDurable` resolves options provider first, seed second.
    - **Read path.** `AgentRunStatusResult.metadata` (`agent-run-lifecycle.ts` `status()`), `loadAgentRunState(...).metadata`; workflow side `ExecutionTimeline.workflowMetadata` projected from `WorkflowCheckpointValue.metadata` in `projectWorkflowTimeline` (redacted when the content policy supplies a redactor).
    - **Tests.** `src/__tests__/agent-run-checkpoint-metadata.test.ts` (bounds/redaction/legacy reads; memory round-trip proving metadata is record sidecar, not state; status before/after resume preserves it; no-metadata record reads `undefined`), SQLite + Postgres generic-checkpoint reopen tests now assert `metadata` round-trip, and `timeline.test.ts` asserts `workflowMetadata` project/absent cases.
    - **Docs.** `docs/durable-runs.md` (option row + provider example + read/preserve semantics) and `docs/execution-timeline.md` (`workflowMetadata` field).
    - **Deviations.** (a) No `checkpoint(session, { metadata })` method — none exists; checkpoints are written by the durable pipeline, so the host attaches via run/resume options (map or live provider) and reads via `status()`/`loadAgentRunState`. (b) No public-key redaction exemption: no such marker convention exists in the repo, so the whole map is redacted unconditionally (keeps secrets out; hosts hold public values outside the map). (c) Docs landed on the canonical `docs/durable-runs.md`/`docs/execution-timeline.md` pages — `docs/session-stores-and-branching.md` is a compatibility stub. (d) Fixed 4 KiB cap, no per-host override knob. (e) Caught while testing: spreading the configured `runState` object breaks the identity check in `agent-session/session/assemble.ts:548` (`RunOptions cannot replace agent durable run-state configuration`) — the resume path passes the configured object by identity and carries metadata as a session seed instead.
    - **Verification.** Root suites 1927/1929 (2 pre-existing failures unrelated to this task: plans index missing plan 106; `packages/memory/.../local-reranker.test.ts` globalThis.fetch guard), all 10 workspace suites green (incl. `@arnilo/prism-core` 680), export-freeze/doc/quality gates green.
  - Test Cases to Write:
    - Round-trip in all three stores; old records without metadata read as empty.
    - Cap enforced (over-size throws with option name); secret-shaped value redacted unless key marked public.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — checkpoint API extension.
    - Docs pages to create/edit: `docs/durable-runs.md` (option + example); `docs/execution-timeline.md` (`workflowMetadata`). The planned `docs/session-stores-and-branching.md` is a stub (Task 1 finding) so canonical pages were used instead.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Restore hooks with all-or-nothing semantics
  - Acceptance Criteria:
    - Functional: `session.onCheckpointRestore(async (cp) => {...})` — hooks receive the checkpoint (incl. metadata) and perform external restores; any hook failure aborts the conversation restore too and reports `{ hook, error }` structured; hooks have a timeout (default 10s); conversation restore applies only after all hooks succeed.
    - Performance: Hooks run sequentially, parallelism opt-in; no hook = zero overhead.
    - Code Quality: Reuses existing session callback error contract; timeout uses existing abort utilities.
    - Security: Hooks are host code (trusted); timeouts prevent dangling half-restores; restore operation emits an audit `AgentEvent` (Task 1 finding: `ExecutionPolicy` is gate-only, there are no existing policy events to reuse).
  - Approach:
    - Documentation Reviewed: Task 1; abort/timeout utilities used in provider rounds.
    - Options Considered:
      - Best-effort hooks (log and continue): rejected — half-restored external state is the exact failure this plan deletes.
    - Chosen Approach: Two-phase: prepare hooks (all must succeed) then apply conversation restore.
    - API Notes and Examples:
      ```ts
      session.onCheckpointRestore(async (cp) => {
        await git.reset(cp.metadata.gitCommit);
        await docs.restoreVersion(cp.metadata.docVersion);
      });
      await session.restoreCheckpoint(cp.id); // one call, all layers
      ```
    - Files to Create/Edit:
      - `src/agent-session/` session host: hook registration + two-phase restore (existing seam: `AgentRunResumeOptions.onSession`, `src/agent-run-lifecycle.ts:222`); hook invocation before the claim CAS in `prepareAgentRunResume`; workflow equivalent in `resumeWorkflow` (`run/main.ts:141`).
    - Task 2 hand-off: the checkpoint passed to a hook is available in `prepareAgentRunResume` as `{ record, state, metadata }` from `loadAgentRunState` (sidecar already normalized/redacted); the claim write that must stay atomic with the hook outcome is the `saveAgentRunState` call at the same site, so a hook throw naturally writes nothing.
    - References: clay discard drill (three hand-wired layers today).
  - Test Cases to Write:
    - All hooks succeed: conversation + recorded external state restored (fake git/docs layers).
    - One hook fails: conversation NOT restored, structured error names hook.
    - Hook timeout: treated as failure.
  - Delivered (2026-09-19):
    - **Hook executor** (`src/checkpoint-restore.ts`): `CheckpointRestoreHook<Context>`, `runCheckpointRestoreHooks` (sequential; per hook an `AbortController` + `AbortSignal.any([caller, timeout])`, timer cleared in `finally`; the caller signal is re-checked between hooks and an abort is re-thrown unwrapped so a cancel reads as cancelled, not as a restore failure), `CheckpointRestoreError` (`code: "ERR_PRISM_CHECKPOINT_RESTORE"`, `.hook`, `.cause`), `CheckpointRestoreAudit`/`CheckpointRestoreAuditEntry`, `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS = 10_000`.
    - **Agent wiring.** `AgentCheckpointRestoreContext` (`runId`, `sessionId`, `version`, `status`, redacted `metadata`, raw `checkpoint` record) + `AgentCheckpointRestoreHook`; `AgentRunResumeOptions.restoreHooks`/`restoreHookTimeoutMs`, the same pair on `AgentRunLifecycleOptions` (register once — a resume builds its session from stored state, so nothing session-scoped exists to attach to beforehand) and per call on `AgentRunLifecycleRequest` (lifecycle hooks first, then request hooks; `restoreHookOptions`). Execution sits in `prepareAgentRunResume` immediately before the claim `saveAgentRunState`, on the claim path only — `deny`/resuspend never run hooks, and no hooks means no call, no audit, no allocation.
    - **Audit.** Succeeding hooks ride the existing claim event: `agent_resumed.restore` (optional field, no new event variant) flows `prepare` → `ActiveDurableRunExtras` → `resumeDurable` extras → `assemble` emit. Server maps a failure to `409` + `ERR_PRISM_CHECKPOINT_RESTORE` + the message (`runtime/server/handler/respond.ts`).
    - **Workflow parity.** `WorkflowCheckpointRestoreContext`/`WorkflowCheckpointRestoreHook` and `restoreHooks`/`restoreHookTimeoutMs` on `RunWorkflowOptions`; `resumeWorkflow` runs the same executor after every validation and before the scheduler writes (so crash recovery is covered too); `workflow_resumed.restore` carries the audit. Fixed while wiring: a resume that did not re-state `metadata` used to drop the checkpoint's sidecar map (`metadata: options.metadata` at persist) — it now falls back to `record.value.metadata`, matching agent-run preservation.
    - **Surface.** Value exports `CheckpointRestoreError`, `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`, `runCheckpointRestoreHooks`; type exports `CheckpointRestoreAudit`, `CheckpointRestoreAuditEntry`, `CheckpointRestoreHook`, `RunCheckpointRestoreHooksOptions` (frozen lists updated in `src/__tests__/public-export-contract.test.ts`).
    - **Tests.** `src/__tests__/agent-run-restore-hooks.test.ts` (5): sequential order + context (recorded metadata, claimed version, `suspended` status) + `agent_resumed.restore` audit; a failing hook names the layer, aborts before the claim (later hook never runs, status/version unchanged, next resume succeeds); a timeout aborts the hook's signal with `timed out after 20ms`; `deny` runs no hooks and an unregistered restore emits no `restore`; lifecycle hooks run before request hooks and fail closed. `packages/prism-core/.../run.test.ts` (2): workflow hooks run before the resume applies, audit on `workflow_resumed`, metadata survives a resume that does not re-state it; a failing hook leaves the checkpoint `suspended` at the same version with zero node executions.
    - **Docs.** `docs/durable-runs.md` "Restore hooks (all-or-nothing)" (+ security note), `docs/workflows.md` option rows and resume paragraph, `docs/middleware-hooks.md` cross-ref to distinguish middleware from restore hooks.
    - **Deviations.** (a) No `session.onCheckpointRestore(hook)` / `session.restoreCheckpoint(id)` API: the session is constructed *inside* the resume from stored state, so a session-scoped registry could never be populated before it matters — hooks register on the lifecycle or the resume call, which is the only object that exists before the session. (b) Sequential-only: the "parallelism opt-in" knob was dropped as dead config. (c) Audit reuses `agent_resumed`/`workflow_resumed` instead of minting a new event variant, so no consumer switch needs a new case. (d) A bare workflow crash-recovery resume (checkpoint with no resume record) still runs hooks but has no `workflow_resumed` event to carry the audit; the failure path is unaffected (fail-closed, nothing written). (e) Restore is compensation, not a transaction: if hook 2 fails after hook 1 restored its layer, that layer stays restored until the host retries the whole resume — each hook should be idempotent.
    - **Verification.** Root suites 1932/1934 (2 pre-existing unrelated failures: plans index missing plan 106; `packages/memory/.../local-reranker.test.ts` globalThis.fetch guard), all 10 workspace suites green (`@arnilo/prism-core` 682 incl. the 2 new workflow cases), doc/plan/quality/host-completeness gates green, `scripts/truth-current.test.mjs` still stale for the reason recorded in Task 2 (release-cut evidence, plan 099).
  - Test Cases to Write:
    - All hooks succeed: conversation + recorded external state restored (fake git/docs layers).
    - One hook fails: conversation NOT restored, structured error names hook.
    - Hook timeout: treated as failure.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new session hook.
    - Docs pages to create/edit: `docs/session-stores-and-branching.md` (restore hooks section); `docs/middleware-hooks.md` cross-ref.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- **Hooks register on the lifecycle/resume options, not on the session.** A resume constructs its session from the stored checkpoint, so a `session.onCheckpointRestore(...)` call could never be in place before the hooks have to run. The plan's API sketch was adjusted rather than shipping a method that silently never fires.
- **Compensation, not a transaction.** Hooks run in order and a failure stops the resume before the claim write, but a layer restored by an earlier hook stays restored. Hosts should make hooks idempotent; a `compensate`/rollback affordance is deferred (Further Actions).
- **Sequential only, one timeout for the whole restore call.** The “parallelism opt-in” criterion was dropped as dead config; per-hook timeout overrides are likewise absent (`restoreHookTimeoutMs` applies to every hook of that resume).
- **Audit rides existing events.** `agent_resumed.restore` / `workflow_resumed.restore` instead of a new event variant, so no consumer switch grows. A workflow crash-recovery resume without a resume record runs hooks but emits no `workflow_resumed` event to carry the audit.
- **Hook errors cross the layer boundary verbatim.** `CheckpointRestoreError.hook` names the layer and `.cause` keeps the original error; the server returns the message as-is (redacted by the configured redactor), so hosts must not put secrets in hook error messages.
- **Workflow hooks also run on crash recovery**, not only on approve/deny resumes — deliberate (a crashed attempt's external state is stale), but hosts see hooks on a path that has no `resume` input.
- **The workflow sidecar map used to be dropped on resume** when the host did not re-state `metadata`; fixed in this task (falls back to `record.value.metadata`) because the hooks' own context reads that map.
- **Frozen SDK surfaces were extended** (3 values + 4 types) rather than hiding the executor behind an internal re-export; `prism-core` needs the same executor for workflow resumes, so it is public.

## Further Actions
- Per-hook `compensate` handler run in reverse on failure, so a partially restored world can roll back instead of waiting for a full retry (medium) — ordered in [109-Checkpoint-Restore-Follow-Ups.md](109-Checkpoint-Restore-Follow-Ups.md) Task 2 (P3, host-demand gated).
- Project the `restore` audit into `ExecutionTimeline` / workflow graph view for post-hoc review (low) — ordered in [109](109-Checkpoint-Restore-Follow-Ups.md) Task 3 (P3, reviewer-demand gated; the recorded event-only decision is its accepted fallback).
- Regenerate `docs/_evidence/phase54-package-map.md`, `scripts/package-truth.json`, and the compat baseline so `scripts/truth-current.test.mjs` is green again (low) — already owned elsewhere: plan 100 Task 1 runs `node scripts/package-truth.mjs --emit-docs`, plan 099 Tasks 1–2 own the export-count budget rebaseline (`scripts/budgets.json`) and `release.mjs gate --update-baseline`. No work left here.
- Rejected after review (not scheduled anywhere): optional parallel hook groups — a knob with no consumer, and the per-hook timeout already bounds the sequential pass; `resumeAgentRunFrom(checkpointId, { restoreHooks })` sugar — `resumeAgentRun` / `resumeAgentRunStream` already accept the same options, and a second entry point would duplicate their ownership, revision, and fingerprint validation.
