# Phase 19 Part G — run recovery: continue after a crash or failure, turn checkpoints, and per-run loop state

## Objectives

- Let a host continue a run that stopped partway. Durable run state is written only when a run suspends for an approval (`suspendDurable`, `src/agent-session/session/persist.ts:72`). After a process death, a provider failure, or a limit breach, the branch holds the work so far and the only way forward is a new `run()` with a new user message.
- Keep limit counters, the wall deadline, and a custom loop's state across such a continuation, for hosts that need it.
- Give a loop per-run state. `LoopStrategy.snapshot()` and `restore()` are methods on the one strategy object the slot registry returns (`src/loop/types.ts:177-178`; `ctx.loop.restore?.(…)` in `executeRun`, `src/agent-session/session/assemble.ts`), so two sessions running a stateful custom loop share and overwrite each other's state.

## Expected Outcome

- `session.continue(options?)` starts a run with no new input when the branch "owes a model turn": its tail is a user message, tool results, or an assistant message with unanswered calls. Unanswered calls at the tip are settled first with persisted results. It rejects with `nothing_to_continue` otherwise, and with the existing decision error when a suspension is pending (use `resume`).
- A call that was in flight when the process died and has a durable effect record in `dispatched` state is marked unknown, and its result tells the model the outcome is unknown.
- `AgentConfig.durability: "turn"` writes one checkpoint entry per completed tool round. `continue()` then restores the run id, counters, deadline, and loop state from the newest checkpoint. The default, `"suspension"`, writes nothing extra, and a continuation starts fresh counters.
- A loop saves and reads its state through the run: `run.checkpoint(value)` and `run.restored`. Strategy-level `snapshot`/`restore` keep working for one run at a time and fail closed when a second run would share them.
- `@arnilo/prism-hosts/headless` can list interrupted runs from a run ledger so a host can continue them at startup.

This plan implements roadmap **Phase 19 Part G**. It adds kernel contracts (a `Session` method, an `AgentConfig` field, a session entry kind, two `RunController` members), so **Task 1 is the phase review**. It depends on plan 225 Task 4 (settlement and repair) and plan 230 (tail snapshots must include the newest checkpoint). No version bump or publish.

Cost knobs: `durability: "turn"` costs one extra store append per tool round. The default costs nothing. `docs/agent.md` states both.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **What ends a run in the branch.** Whether any entry marks a run's end (`persistSucceeded`, `cleanupRun`, `src/agent-session/session/persist.ts:153`, `:206`), what the run ledger records (`appendRun` status transitions), and therefore how "interrupted" can be told from "finished" without a marker.
      - (b) **Empty-input runs.** What `session.run([])` does today end to end (`inputToMessages`, `run.input`, `assembleProviderInput`, the `pushedInput` branch in `src/loop/run-controller.ts`), and whether a provider request whose last message is a tool result or user message is assembled correctly with no new input.
      - (c) **Durable state today.** `StoredAgentRunState` and `saveAgentRunState` (`src/agent-run-state.ts`), the memory cell (`src/run-state-cell.ts`), the `suspended_run` entry (`src/suspended-run.ts`), `agentFingerprint`, and what `continueSuspendedRun` restores (counters, `deadlineAt`, `toolNames`, loop state, sticky decisions).
      - (d) **Effects.** `ToolEffectStore` states and `replayEffectResult` (`src/tools.ts`), and what a `dispatched` record means after a crash.
      - (e) **Loop state users.** Every `LoopStrategy` with `snapshot`/`restore` in the repo (`packages/hosts/driver-process`, `packages/extensions/workflows/src/loop.ts`, examples, `src/testing/loop-conformance.ts`), `isDurableLoop` (`src/agent-session/helpers.ts`), and the `ERR_PRISM_LOOP_*` errors.
      - (f) **Ledger queries.** What `RunLedger` can list (`src/contracts-core/persistence.ts`), for the headless sweep.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change.
    - Security: Records what a checkpoint entry may contain (counters, ids, loop JSON) and confirms it passes the session redactor like every entry.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 (session, `resume`), §2.5 (loop slot, `snapshot`/`restore`), §2.12.9 (external state); `docs/agent.md`, `docs/loop.md`, `docs/disaster-recovery.md`
    - Options Considered:
      - Skip — rejected: (a) and (b) decide whether `continue` needs a new entry kind at all.
    - Chosen Approach:
      - Inventory, then confirm or re-cut Tasks 2–5.
    - API Notes and Examples:
      ```bash
      graft callers suspendDurable --depth all
      graft grep "snapshot?()"
      ```
    - Files to Create/Edit:
      - `plans/231-…md`: the task note
    - References:
      - Evaluation findings K11, K19
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `session.continue()` picks up a run that stopped partway
  - Acceptance Criteria:
    - Functional:
      - `session.continue(options?: RunOptions)` returns a `RunResult`; `session.continueStream(options?)` is the streaming form, mirroring `resume`.
      - It runs when the branch tail owes a model turn. It rejects with `SessionContinueError` (`code: "nothing_to_continue"`) when the tail is a completed assistant message, and with `AgentDecisionError` when a suspension is pending.
      - Before the first turn, each unanswered tool call at the tip gets a persisted result: `tool_call_interrupted`, or for a call whose durable effect record is `dispatched`, the effect is marked unknown and the result says the outcome is unknown and must be verified before repeating. No tool is re-dispatched automatically.
      - The continuation is a new run id with fresh counters (unless Task 3's checkpoint applies). It fires `run.input` with an empty list, `run.started { continued: true }`, and every hook a normal run fires.
      - Ownership, principal, fingerprint and active-run checks match `run()`.
    - Performance: One tail read (plan 230); settlement adds one append per unanswered call.
    - Code Quality: `continue` shares `runInternal`; the only new logic is the precondition and the tip settlement.
    - Security: A continuation cannot run under a wider scope than the entries carry; the scope check runs before any append.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts` (`run`, `resume`, `prepareResume`, `runInternal`), `session/assemble.ts` (`executeRun`, `assembleRoundContext`)
      - Plan 225 Task 4's repair helper
      - `docs/agent.md` ("RunResult and session.resume")
    - Options Considered:
      - Tell hosts to send "continue" as a user message — rejected: it changes the transcript and cannot settle in-flight effects.
      - Re-dispatch interrupted calls automatically — rejected: a non-idempotent effect would run twice.
    - Chosen Approach:
      - An explicit, state-checked continuation that settles the tip and lets the model decide what to redo.
    - API Notes and Examples:
      ```ts
      const session = await agent.session({ id });
      const result = await session.continue({ limits: { maxTurns: 20 } });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/session.ts`: `Session.continue`, `continueStream`, `SessionContinueError`
      - `src/agent-session/session.ts`, `session/assemble.ts`
      - `src/contracts-protocol.ts` / events: `run.started.continued`
      - `packages/hosts/remote/src/…`: `continue` over `prism.remote/1` (the proxy implements `Session`)
      - `src/__tests__/session-continue.test.ts`: new
      - `examples/continue-after-failure.ts`: new; `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/*.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note; `src/__tests__/public-export-contract.test.ts`
    - References:
      - Evaluation finding K19
  - Test Cases to Write:
    - `continue_after_provider_failure_completes_the_task`: the first run fails on turn 2; `continue()` finishes with no new user message in the branch.
    - `continue_after_simulated_crash_settles_in_flight_calls`: a branch ending in an assistant tool call; results are persisted, then the model turn runs.
    - `dispatched_effect_is_marked_unknown_and_not_rerun`.
    - `continue_rejects_when_nothing_is_owed`.
    - `continue_rejects_on_pending_suspension`.
    - `continue_fires_the_same_hooks_as_run`: on the default loop and a custom loop.
    - `continue_respects_ownership_scope`.
    - `remote_proxy_continue_round_trips`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers the new example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two `Session` methods, an error, an event field
    - Docs pages to create/edit:
      - `docs/agent.md`: "Continuing a run"
      - `docs/events.md`: `run.started.continued`
      - `docs/disaster-recovery.md`: process death mid-run
      - `packages/hosts/remote/README.md`
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Turn checkpoints keep counters, deadline, and loop state
  - Acceptance Criteria:
    - Functional:
      - `AgentConfig.durability: "suspension" | "turn"` (default `"suspension"`). With `"turn"`, after each completed tool round the kernel appends one `run_checkpoint` entry: run id, limit counters, `deadlineAt`, the run's tool grant, the loop name and revision, and the loop state from Task 4.
      - `continue()` finds the newest checkpoint for the interrupted run. If the agent fingerprint, loop name, and revision match, it resumes that run id with the stored counters and deadline and passes the loop state as `run.restored`. A mismatch fails closed with the existing `AgentRunStateError` / `ERR_PRISM_LOOP_REVISION`.
      - Checkpoint entries are excluded from `session.messages()` and from provider input, are copied by `fork()` like other entries, and are included in tail snapshots (plan 230).
      - A checkpoint write failure fails the run before the next turn, as a failed message append does.
    - Performance: One extra append per tool round with `"turn"`; zero with the default. The entry is bounded (loop state capped at 256 KiB, fail closed above).
    - Code Quality: The checkpoint reuses `StoredAgentRunState`'s counter and deadline shapes; no second serialization of limits.
    - Security: The entry passes the session redactor; loop state is JSON-normalized and bounded before it is stored.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-run-state.ts`, `src/suspended-run.ts`, `src/run-limits.ts` (`snapshot`, `deadlineAt`)
      - `src/contracts-core/session.ts` (entry kinds), `src/session-stores.ts` (`snapshotFromBranch`)
    - Options Considered:
      - Checkpoint every append — rejected: several writes per turn for no extra recoverability.
      - Store checkpoints in the `checkpoints` service — rejected: that service is optional and owned by store packages; the branch is always there.
    - Chosen Approach:
      - One bounded branch entry per tool round, opt-in.
    - API Notes and Examples:
      ```ts
      createAgent({ model, durability: "turn" });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/contracts-core/session.ts`: the field and the entry kind
      - `src/agent-session/session/persist.ts`, `tool-round.ts`, `assemble.ts`
      - `packages/extensions/store-codecs/src/persistence-schema.ts`, `store-{sqlite,postgres}/src/…`: the entry kind in codecs (no schema change if kinds are open text; Task 1 confirms)
      - `src/testing/store-conformance.ts`: the kind round-trips
      - `src/__tests__/run-checkpoint.test.ts`: new
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - `src/agent-session/session/persist.ts:72` (`suspendDurable`)
  - Test Cases to Write:
    - `turn_durability_writes_one_checkpoint_per_tool_round`.
    - `default_durability_writes_no_checkpoint`.
    - `continue_restores_counters_and_deadline_from_checkpoint`: a run that used 30 of 50 turns continues with 20 left.
    - `fingerprint_drift_fails_closed_on_continue`.
    - `checkpoints_are_not_messages_and_not_sent_to_the_provider`.
    - `oversized_loop_state_fails_closed`.
    - `store_conformance_run_checkpoint_kind`: memory, JSONL, SQLite, Postgres.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a config field and an entry kind
    - Docs pages to create/edit:
      - `docs/agent.md`: `durability`, with the write cost
      - `docs/slots.md`: the `run_checkpoint` entry kind for store authors
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Loop state belongs to the run
  - Acceptance Criteria:
    - Functional:
      - `RunController.checkpoint(value: JsonValue): void` records the loop's state for the current run; the kernel reads the latest value when it suspends or writes a turn checkpoint. `RunController.restored: JsonValue | undefined` carries the state of the run being resumed or continued.
      - A loop that uses them needs no `snapshot`/`restore` and counts as durable (`isDurableLoop`).
      - Strategy-level `snapshot()`/`restore()` keep working. When a strategy that defines them has an active run and a second run starts on it, the second run fails closed with `AgentLoopStateError` (`ERR_PRISM_LOOP_SHARED_STATE`) unless the loop has adopted the per-run members.
      - First-party loops with state move to the per-run members in this task (Task 1(e) lists them).
      - `loopConformance` covers two concurrent resumed runs keeping separate state.
    - Performance: `checkpoint` stores a reference and normalizes only when the kernel persists.
    - Code Quality: API level 1 stays compatible: nothing is removed from `LoopStrategy`.
    - Security: Loop state is bounded and redacted when persisted (Task 3).
  - Approach:
    - Documentation Reviewed:
      - `src/loop/types.ts:120-180`, `src/loop/run-controller.ts`, `src/agent-session/helpers.ts` (`isDurableLoop`), `session/assemble.ts` (the restore call)
      - `roadmap.md` §2.5; `docs/loop.md`
      - `src/testing/loop-conformance.ts`
    - Options Considered:
      - Make the slot hold a factory (`create(): LoopStrategy`) — rejected: it changes the slot's provided type for every loop package at API level 1.
      - Pass the run id to `snapshot(runId)` — rejected: the strategy would have to keep a map and clean it up.
    - Chosen Approach:
      - State travels on the `RunController`, which is already per run.
    - API Notes and Examples:
      ```ts
      const loop: LoopStrategy = {
        name: "phased", revision: "2",
        async run(run) {
          let phase = (run.restored as { phase: number } | undefined)?.phase ?? 0;
          for (; phase < 3; phase++) { run.checkpoint({ phase }); await step(run, phase); }
        },
      };
      ```
    - Files to Create/Edit:
      - `src/loop/types.ts`, `src/loop/run-controller.ts`, `src/agent-session/helpers.ts`, `session/assemble.ts`, `session/persist.ts`
      - `src/contracts-core/…` (`AgentLoopStateError` code)
      - `packages/hosts/driver-process/src/…`, other loops from Task 1(e)
      - `src/testing/loop-conformance.ts`
      - `examples/custom-loop.ts`: use the per-run members
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding K11
  - Test Cases to Write:
    - `per_run_loop_state_survives_suspend_and_resume`.
    - `two_sessions_resume_with_separate_loop_state`.
    - `shared_strategy_state_fails_closed_on_second_run`.
    - `legacy_snapshot_restore_still_works_for_one_run`.
    - `loop_conformance_concurrent_resume`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two `RunController` members and an error code
    - Docs pages to create/edit:
      - `docs/loop.md`: "Loop state", with the example above and the shared-state rule
      - `packages/hosts/driver-process/README.md`: if its state handling is described
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: A host can find and continue interrupted runs at startup
  - Acceptance Criteria:
    - Functional:
      - `findInterruptedRuns(ledger, { ownership, olderThanMs })` in `@arnilo/prism-hosts/headless` pages through run records still marked `running` whose last activity is older than `olderThanMs`, and returns session and run ids. It needs a ledger that can list runs; without that capability it throws the existing unsupported-capability error.
      - `continueInterrupted(agent, runs, { concurrency })` opens each session and calls `continue()`, collecting results; a session that no longer owes a turn is skipped.
      - The reference host calls both at start when a ledger is configured, and a scenario proves it: a run is killed after a tool round, the host restarts, and the task completes.
      - Nothing runs unless the host calls the helper.
    - Performance: Paged ledger read; at most `concurrency` (default 2) continuations at once.
    - Code Quality: The helper uses only the public `Agent`, `Session`, and ledger APIs (`scripts/host-surface-allowlist.json`).
    - Security: Ownership scope is required and applied to the ledger query; a run outside the scope is never returned.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/headless/src/index.ts`, `README.md`; `src/contracts-core/persistence.ts` (`RunLedger`, list capabilities)
      - `apps/prism-agent/src/host/start.ts`, `store.ts`, `src/scenarios/`
    - Options Considered:
      - Scan every session's tail — rejected: no store can index "owes a turn".
      - Continue automatically inside the kernel — rejected: starting model calls is the host's decision.
    - Chosen Approach:
      - A ledger-driven sweep the host opts into.
    - API Notes and Examples:
      ```ts
      const runs = await findInterruptedRuns(ledger, { ownership, olderThanMs: 60_000 });
      await continueInterrupted(agent, runs, { concurrency: 2 });
      ```
    - Files to Create/Edit:
      - `packages/hosts/headless/src/recover.ts`: new; `src/index.ts`; `README.md`
      - `packages/hosts/headless/src/__tests__/recover.test.ts`: new
      - `apps/prism-agent/src/host/start.ts`, a new scenario under `src/scenarios/`, its test
      - `scripts/host-surface-allowlist.json`: if a new public import is used
      - `scripts/compat-baseline/*.txt`: regenerated for `@arnilo/prism-hosts`
    - References:
      - `packages/hosts/channels/src/runtime-reconcile.ts` (the existing explicit-recovery pattern)
  - Test Cases to Write:
    - `find_interrupted_runs_returns_stale_running_records_in_scope`.
    - `finished_and_suspended_runs_are_not_returned`.
    - `continue_interrupted_skips_sessions_that_owe_nothing`.
    - `reference_host_completes_a_killed_run_after_restart`.
    - `ledger_without_listing_fails_closed`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two host-library exports
    - Docs pages to create/edit:
      - `packages/hosts/headless/README.md`: "Recovering interrupted runs"
      - `apps/prism-agent/README.md`: the startup sweep
      - `docs/disaster-recovery.md`: link to the helper
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/session-continue.test.ts src/__tests__/run-checkpoint.test.ts`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
