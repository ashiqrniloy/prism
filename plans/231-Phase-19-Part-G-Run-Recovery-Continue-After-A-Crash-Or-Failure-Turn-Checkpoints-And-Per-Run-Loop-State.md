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

- [x] Task 1: Phase review (read-only)
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
  - Notes (executed 2026-11-16):
    - **(a) What ends a run in the branch.** Nothing. `persistSucceeded` (`src/agent-session/session/persist.ts:153-204`) writes only the run's private memory cell (`session.activeDurable`, present only on a resumed run) and the ledger usage row. `cleanupRun` (`persist.ts:206-272`) writes the ledger finish record and clears run fields. The failure path in `executeRun` (`src/agent-session/session/assemble.ts:777-841`) also appends nothing. The only run-scoped entries are `message`, `model_change` (`assemble.ts:349-360`) and `suspended_run` (`persist.ts:135-149`). The ledger does mark the end: `assembleRoundContext` appends a `status: "running"` `RunRecord` (`assemble.ts:311-323`), and `cleanupRun` appends the terminal one (`succeeded`/`failed`/`aborted`/`suspended`, `persist.ts:232-249`) under the same id. SQLite and Postgres upsert by run id (`store-sqlite/src/persistence.ts:225-227`, `store-postgres/src/persistence.ts:674-690`) and keep the first `started_at`. So in the branch, "interrupted" can only be told from "finished" by the tail's shape. A provider failure, a limit breach, an abort, a `turn_limit` stop, a `hook_stop`, and a process death all leave a tail that owes a model turn: a user message, tool results, or an assistant message with unanswered calls. A naturally finished run leaves a completed assistant message. A suspension leaves `suspended_run` as the tip (`pendingSuspensionOf`, `src/suspended-run.ts:111-118`, skips only `package_state`). **Outcome:** `continue` needs no run-end entry kind. The tail-shape precondition is enough. Only the ledger can tell a crash (`running`, no `finishedAt`) from a failure. Task 5 uses that.
    - **(b) Empty-input runs.** `session.run([])` works end to end today. `inputToMessages([])` returns `[]` (`src/agent-session/helpers.ts:31-35`). `run.input` fires with `[]` and nothing is appended (`assemble.ts:361-368`). `assembleProviderInput` builds instructions + summaries + history + `[]` (`src/input.ts:168-182`, `:235-297`). `createRunController` pushes no input (`src/loop/run-controller.ts:228-232`). `continueSuspendedRun` already relies on this: it passes `state.input ?? []` (`src/agent-session/session.ts:625`). I checked three branch shapes with a mock provider (scratch script, not committed):
      - User-message tail (first run's provider threw): `run([])` completed. The request was `["user"]`. The branch became `[user, assistant]`.
      - Completed-assistant tail: `run([])` sent a request whose last message is the assistant reply and appended a **second** assistant message. So `run([])` is not a safe continuation: `continue` must reject this tail with `nothing_to_continue`.
      - Assistant tool call with no result (written straight to the store to simulate a crash): `rebuildHistory` → `repairUnansweredToolCalls` (`session.ts:1385-1406`, `src/agent-session/history-repair.ts:32-65`) added a synthetic `tool_call_interrupted` result **in the provider view only**. It emitted `history.repaired` (`assemble.ts:325-331`). The request ended `assistant:tool_call, tool:tool_result`. The branch and `messages()` still hold the unanswered call. Task 2's persisted settlement is therefore new behavior, and it can reuse `TOOL_CALL_INTERRUPTED` and `interruptedResult`'s wording.
      - Events on an empty-input run match a normal run: `run.started, [history.repaired], turn.started, message.delta, turn.completed, message.completed, run.completed`.
    - **(c) Durable state today.** `StoredAgentRunState` (`src/agent-run-state.ts:37-69`) holds `input`, `pending`/`pendingCalls`, `nestedRuns`, `stickyDecisions`, `counters`, `deadlineAt`, `loopState {name, revision, snapshot}`, `sessionState` (loaded skills), `toolNames` and `stopReason`. `saveAgentRunState` (`:162-171`) redacts, then bounds the state (`boundState`, `:317-328`: depth 32, 256 properties per object, default 256 KiB, hard 1 MiB), and versions it through a `RunStateCell`. The cell is a private in-memory map (`src/run-state-cell.ts:33-45`), never public. `suspendDurable` (`persist.ts:72-151`) allocates it with `definitionRevision: KERNEL_SUSPENSION_REVISION` (`persist.ts:28`, `:97-99`). It reads `loop.snapshot()` from the **strategy** (`:102`) and appends the self-contained `suspended_run` entry (`src/suspended-run.ts:32-58`). That entry carries the loop snapshot twice: `data.loop.snapshot` and `state.loopState`. `agentFingerprint` (`agent-run-state.ts:110-146`) hashes id, revision, model, instructions, system prompt, skills, tools (name/parameters/exclusive/effect), hook ids, and loop name + revision. `prepareResume` (`session.ts:680-726`) checks scope, then the pending suspension, the active run, sticky decisions (`resolveRunDecisions`) and the fingerprint. It then claims a fresh memory cell with `status: "running"`. `executeRun` restores the following (`assemble.ts:667-771`):
      - counters and `deadlineAt`, through `RunLimitTracker` (`:726-734`)
      - `toolNames`, through `selectRunTools` (`:333`)
      - loop state, by checking name and revision against `ERR_PRISM_LOOP_REVISION`, then calling `ctx.loop.restore?.(…)` on the **shared strategy** (`:762-771`)
      - pending and nested calls, through `replayDurableNestedAndPending` (`:760`)
      - loaded skills, through `restoreRunSessionState` (`session.ts:698`)

      A resumed run also rejects `RunOptions.model` and `RunOptions.effectStore` (`assemble.ts:671-672`), and it re-checks the fingerprint (`:682-684`). Turn numbering restarts at 1: `RunControllerInternals.startTurn` exists (`run-controller.ts:86`, `:136`) but nothing sets it.
    - **(d) Effects.** `ToolEffectStatus` is `pending | dispatched | completed | failed_retryable | failed_terminal | unknown` (`src/contracts-protocol.ts:605`), and the store contract is at `:643-674`. `prepareToolEffect` (`src/tools.ts:559-608`) keys an effect on `{ownership, sessionId, runId, toolCallId, toolName, argumentsHash}` (`src/tool-effects.ts:56-66`), so the key includes the **original run id**. `begin` returns `existing` for anything except an absent record or a retryable failure (`tool-effects.ts:96-113`). `replayEffectResult` (`tools.ts:634-643`) returns a stored `completed` result. It throws `ERR_PRISM_TOOL_EFFECT_UNKNOWN` for `dispatched`/`unknown` and `ERR_PRISM_TOOL_EFFECT_CONFLICT` otherwise. After a crash, a `dispatched` record means the tool was invoked and nobody recorded its outcome. `markUnknown` needs the record's `claimToken` and `version` (`requireClaim`, `tool-effects.ts:255-263`), and `get` returns both. The memory store already reads an expired claim (default TTL 15 min, `:30`) as `unknown` (`expire`, `:242-253`). Only the in-process memory store implements the contract. No first-party store package ships a durable `ToolEffectStore`; `packages/tools/work` keeps its own idempotency. So a cross-process `dispatched` record exists only when the host supplies a durable adapter. Tests use one memory store shared across two "process" agents.
    - **(e) Loop state users.** No first-party loop package defines `snapshot`/`restore`. `workflowLoopStrategy` (`packages/extensions/workflows/src/loop.ts:107-147`) declares neither, so it is not resumable. `driver-process` keeps its state in `external_state` through `run.state(…)` (`packages/hosts/driver-process/src/session.ts:14-57`), which is already per session. `loopConformance` (`src/testing/loop-conformance.ts`) never exercises snapshot. Strategy-level users are `examples/durable-loops-and-approvals.ts:19-33`, its copy `packages/hosts/host-builder/data/examples/durable-loops-and-approvals.ts`, and tests (`src/__tests__/durable-loops.test.ts`, `session-resume.test.ts`, `host-ui.test.ts`, `driver-primitives.test.ts`). `isDurableLoop` (`helpers.ts:102-106`) is a **static** check on the strategy object, made before `loop.run` starts: `resumable` is set at controller construction (`assemble.ts:596`), the durable-resume guard runs at `:674`, and the suspension guard at `persist.ts:91`. `ERR_PRISM_LOOP_*` codes are `NOT_DURABLE | SNAPSHOT | REVISION` (`src/contracts-run-state.ts:217`); `tools.ts:725` and `loop/dispatch.ts:155` match on the prefix. `RunControllerInternals.restoredLoopState` is plumbed from `resumed.state.loopState.snapshot` (`assemble.ts:495`, `run-controller.ts:84`) but is never read.
    - **(f) Ledger queries.** `RunLedger` is write-only (`appendRun`/`appendEvent`/`appendToolCall`/`appendUsage`, `src/contracts-protocol.ts:821-826`). Listing is `ProductionPersistenceStore.queryRuns(RunQuery)` (`src/contracts-core/persistence.ts:326-337`, `:422`). The query filters on ownership, `sessionId`, `status`, `toStartedAt` and `isFinished`. SQLite's `queryRuns` applies only `sessionId`, `branchId` and `status` (and ownership/cursor via `queryTable`), and orders by `started_at` (`store-sqlite/src/persistence.ts:1044-1061`). `RunRecord` has no last-activity field, only `startedAt`/`finishedAt` (`contracts-protocol.ts:679-700`). `createSqlitePersistence` returns one object that is a `SessionStore`, a `RunLedger` and a `ProductionPersistenceStore` (`store-sqlite/src/persistence.ts:117`). The reference host configures **no** `runLedger` (`apps/prism-agent/src/host/store.ts`, `start.ts`). `HeadlessError` has no unsupported-capability code (`packages/hosts/headless/src/errors.ts`).
    - **Entry kinds and codecs (for Task 3).** `SessionEntryKind` and `SESSION_ENTRY_KINDS` are a closed kernel list (`src/contracts-core/session.ts:7-39`). JSONL rejects unknown kinds through `isSessionEntryKind` (`store-jsonl/src/jsonl-store.ts:577`). SQLite and Postgres store `kind TEXT NOT NULL` with no check constraint (`store-sqlite/src/ddl.ts:76`, `store-postgres/src/ddl.ts:84`), and the codec schema types it as `text` (`store-codecs/src/persistence-schema.ts:266`). So adding `"run_checkpoint"` to the kernel list needs no DDL or codec change, only conformance coverage. `snapshotFromBranch` takes only `message`/`summary` entries into `messages`/`summaries` (`src/session-stores.ts:302-334`), so a checkpoint never reaches `messages()` or provider input. Tail snapshots (plan 230) keep entries after the newest compaction's `throughEntryId`, plus `pinnedEntryIds` (`session-stores.ts:131-156`). `compactionCheckpoint` pins **message** entries only (`session.ts:1474-1488`), so a `run_checkpoint` older than `throughEntryId` would drop out of the tail.
    - **Security.** Every entry, including a future `run_checkpoint`, goes through `appendNow` → `redactSessionEntry` (`session.ts:1330-1338`, `src/redaction.ts:41-43`, a deep `afterSecrets`), and gets ownership stamps. A checkpoint built through `saveAgentRunState` is redacted and bounded a second time. It may contain only: run id, session id, agent id, definition revision, fingerprint, `counters`, `deadlineAt`, `toolNames`, loop `{name, revision, snapshot}`, and `status`. It holds no messages, no `input`, no pending calls, no sticky decisions, and no loaded skill bodies.
    - **Changes to later tasks** (amended in place below):
      - Task 2:
        - The `Session` contract lives in `src/contracts-run-state.ts:305-353`, not `contracts-core/session.ts`. `resume` is stream-only, so `continue` mirrors `run` and `continueStream` mirrors `resume`/`stream`.
        - The precondition reads the snapshot's `messages` tail.
        - Settlement runs inside the run: after `run.started`, the scope check and the active-run claim, and before `rebuildHistory`. The repair then finds nothing to answer.
        - Effect lookup uses the **unanswered call's entry `runId`** and the run's ownership, not the new run id.
        - A `completed` record with a stored result persists that real result.
        - A `dispatched` record is moved to `unknown` with the record's own claim token. A version conflict still yields the outcome-unknown result. An `unknown` record yields the same text.
      - Task 3:
        - The checkpoint data is a `StoredAgentRunState` bounded by `saveAgentRunState` under `KERNEL_SUSPENSION_REVISION`.
        - `compactionCheckpoint` pins the newest `run_checkpoint`.
        - Restoring makes the continuation a durable resume, so the `RunOptions.model`/`effectStore` restriction at `assemble.ts:671` applies and is documented.
        - The kind is added to `SESSION_ENTRY_KINDS`, with no DDL or codec change.
      - Task 4:
        - `isDurableLoop` and `resumable` are decided before `run()` starts, so the loop must **declare** per-run state statically. The declaration is a new optional `LoopStrategy.state?: "run"`. A call to `run.checkpoint` cannot be detected in time.
        - `run.restored` surfaces the already-plumbed `restoredLoopState`.
        - `suspendDurable` reads the controller's last checkpoint instead of `loop.snapshot()`.
        - "First-party loops" reduces to the two example copies.
        - The shared-state guard must count active runs per strategy object across agents.
      - Task 5:
        - The helper takes a `queryRuns` capability, not a `RunLedger`.
        - `olderThanMs` is measured from `startedAt` and filtered in the helper, because SQLite ignores `toStartedAt`.
        - A new `HeadlessError` code `ledger_query_unsupported` is added.
        - The reference host gains an opt-in SQLite run ledger, so the sweep has something to read.

- [x] Task 2: `session.continue()` picks up a run that stopped partway
  - Acceptance Criteria:
    - Functional:
      - `session.continue(options?: RunOptions)` returns a `RunResult`; `session.continueStream(options?)` is the streaming form, mirroring `resume`.
      - It runs when the branch tail owes a model turn. It rejects with `SessionContinueError` (`code: "nothing_to_continue"`) when the tail is a completed assistant message, and with `AgentDecisionError` when a suspension is pending.
      - Before the first turn, each unanswered tool call at the tip gets a persisted result. The effect record is looked up by the call's own entry `runId` and the run's ownership (the effect key includes the original run id, Task 1(d)):
        - No record: the result is `tool_call_interrupted`.
        - A `completed` record with a stored result: that real result.
        - A `dispatched` record: it is moved to `unknown` with the record's own claim token, and the result says the outcome is unknown and must be verified before repeating. A version conflict on that move, or a record already `unknown`, gets the same result.

        No tool is re-dispatched automatically. Settlement runs inside the run, after `run.started`, the scope check and the active-run claim, and before `rebuildHistory`, so the provider-view repair finds nothing left to answer.
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
      - `src/contracts-run-state.ts` (`Session`, `:305`): `Session.continue`, `continueStream`, `SessionContinueError`. `continue` mirrors `run`; `continueStream` mirrors the stream-only `resume`
      - `src/agent-session/session.ts`, `session/assemble.ts`
      - `src/contracts-protocol.ts` / events: `run.started.continued`
      - `packages/hosts/remote/src/session-proxy.ts` (`start("run" | "sessions.resume")`, `:135`), `protocol.ts`, `serve.ts`: a `sessions.continue` method over `prism.remote/1` (the proxy implements `Session`)
      - `src/__tests__/session-continue.test.ts`: new
      - `examples/continue-after-failure.ts`: new; `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/*.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note; `src/__tests__/public-export-contract.test.ts`
    - References:
      - Evaluation finding K19
  - Test Cases to Write:
    - `continue_after_provider_failure_completes_the_task`: the first run fails on turn 2; `continue()` finishes with no new user message in the branch.
    - `continue_after_simulated_crash_settles_in_flight_calls`: a branch ending in an assistant tool call; results are persisted, then the model turn runs.
    - `dispatched_effect_is_marked_unknown_and_not_rerun`: one memory effect store shared by two agents standing in for two processes.
    - `completed_effect_settles_with_its_stored_result`.
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
  - Notes (executed 2026-11-16):
    - **What changed.**
      - Contract (`src/contracts-run-state.ts`): `Session.continue(options?: RunOptions): Promise<RunResult>` and `Session.continueStream(options?: RunOptions & SubscribeOptions)`. Also `SessionContinueError` (`code: "nothing_to_continue"`) and `SESSION_NOTHING_TO_CONTINUE_CODE`, both exported from the root. `run.started` gains `continued?: boolean` (`src/contracts-protocol.ts`).
      - New `src/agent-session/continue.ts`:
        - `owesModelTurn(messages)` is the precondition. The last message must be a user message, a tool row, or an assistant message with a non-provider-hosted call.
        - `settleContinuationTip(session, runId)` settles the newest assistant message's unanswered calls, but only when nothing other than tool rows follows it. Older unanswered calls stay with the provider-view repair. The effect key is built from the call's entry `runId`, `session.activeOwnership` and the stored arguments' hash.
        - Settlement outcomes:
          - no store, no ownership, no record, or a `pending` record: `tool_call_interrupted`. `interruptedResult` is now exported from `history-repair.ts`.
          - `completed` with a result: that result.
          - `dispatched`: `markUnknown` with the record's claim token. A conflict is swallowed. The result is `tool_call_outcome_unknown`.
          - `unknown`, `completed` without a result, or a store `get` that throws: `tool_call_outcome_unknown`.
          - `failed_*`: the stored failure code.
      - Session (`src/agent-session/session.ts`): `continue()` does `ready()`, then the scope check (`SessionNotFoundError`), then the pending-suspension check (`AgentDecisionError` `ERR_PRISM_DECISION_STALE`, "use resume"), then the owes-a-turn check. Only then does it call `runInternal([], …, continued = true)`. `stream` and `continueStream` share a new private `ownedStream` helper. Both stay lazy async generators, so a pre-flight error still surfaces on the first `next()`.
      - `executeRun`/`assembleRoundContext` (`session/assemble.ts`) take a `continued` flag. They emit `run.started { continued: true }` and call `settleContinuationTip` after the ledger start record and before `rebuildHistory`, so `history.repaired` does not fire.
      - Remote (`@arnilo/prism-hosts/remote`):
        - `sessions.continue` was added to `CLIENT_METHODS`/`RemoteMethods`, with the same `options` subset and busy guard as `run`.
        - The new `RemoteErrorCode` `nothing_to_continue` (`-32014`) is mapped from the kernel error in `mapOwnershipError`.
        - The proxy implements `continue` and `continueStream`, and turns `nothing_to_continue` back into `SessionContinueError`.
      - Tests:
        - `src/__tests__/session-continue.test.ts`: 10 tests. They cover every listed case, plus `unknown_effect_and_version_conflict_settle_as_outcome_unknown` and the hooks test on both loops.
        - `remote_proxy_continue_round_trips` in `packages/hosts/remote/src/__tests__/connect.test.ts`.
        - The `Session` member lists in `agents.test.ts` and `agent-surface-freeze.test.ts`.
      - Example `examples/continue-after-failure.ts`, registered in `examples/README.md`, in the `docs.test.ts` demo list with an exact-output assertion, and in `scripts/e2e-coverage.json` (with the new suite).
      - Docs:
        - `docs/agent.md`: a "Continuing a run" section, a Session table row, and the frozen-surface row.
        - `docs/events.md`: `run.started.continued`.
        - `docs/disaster-recovery.md`: "Process death mid-run".
        - `packages/hosts/remote/README.md`.
        - `CHANGELOG.md`.
      - `scripts/budgets.json`: kernel ceilings re-baselined, with a dated reason. The growth is +4,288 packed, +14,201 unpacked, +1 file, +6 counted exports and +222 source lines. `exportCounts["@arnilo/prism"]` went 1586 → 1592: +2 root exports, plus 4 internal ones (`owesModelTurn`, `settleContinuationTip`, `TOOL_CALL_OUTCOME_UNKNOWN`, `interruptedResult`).
      - Gate chores:
        - `scripts/host-surface-allowlist.json` allows `SessionContinueError` and `SESSION_NOTHING_TO_CONTINUE_CODE` (for the remote host).
        - Both names were added to the frozen root list in `public-export-contract.test.ts`.
        - Regenerated with `bun scripts/host-builder-index.mjs`: `packages/hosts/host-builder/data/{api,errors,examples}.json` and the example copy.
        - The `indexes` hash in `scripts/host-builder-evals/criteria.lock.json` was updated to match, as in commit 0d11738e. Only that hash changed. The criteria, the hidden tests, the workspaces and the registration are unchanged.
        - `bun scripts/package-truth.mjs --emit-docs` (`docs/release.md`, `docs/_evidence/phase54-package-map.md`, `scripts/package-truth.json`).
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`). This task's lines are all additive:
      - `@arnilo/prism`: `Session` gains `continue` and `continueStream`; `AgentEventPayload` `run.started` gains `continued?`; `+ SessionContinueError` and `+ SESSION_NOTHING_TO_CONTINUE_CODE`.
      - `@arnilo/prism-hosts`: `./remote CLIENT_METHODS` gains `"sessions.continue"`, `RemoteMethods` gains `"sessions.continue"`, and `RemoteErrorCode` gains `"nothing_to_continue"`.

      The same regeneration also picked up lines from earlier uncommitted work in the tree, none of them removed by this task: plans 226–230 (`DEFAULT_RUN_LIMITS`, `RunLimits.bufferOutput`, compaction defaults, `appendMany`/`tipCheck`/`from: "compaction"`, retry `afterOutput`, `fetchWithStreamTimeouts`, store-conformance steps, ag-ui `DEFAULT_MAX_QUEUED_EVENTS`). The `@arnilo/prism-extensions` and `@arnilo/prism-memory-system` baseline changes are all from that earlier work. No removals are attributable to this task.
    - **Checks.**
      - Passing: `bun run typecheck`; `bun test src/__tests__/session-continue.test.ts` (10 pass); `bun run --filter @arnilo/prism-hosts test` (928 pass, 2 skip).
      - `bun scripts/release.mjs gate`: the only failure left is `ranges: @arnilo/prism-ai changed since v0.13.0 but version is still 0.13.0 (bump required)`. That failure predates this task, no file under `packages/ai` changed here, and the plan rules out a bump.
      - `bun run test`: every failure this task caused is fixed. The failures left predate this task or come from load:
        - The `@arnilo/prism-memory-system` export budget (1146 vs 1124) and the non-null budget (`packages/memory/system/src/session` 159 vs 114) come from the uncommitted memory-system work already in the tree. This task did not touch that code.
        - `remote_conformance_passes_on_stdio` (a 2 s stream timeout) and the document-reader max-page timing envelope failed under full-suite load. Both pass in isolation: remote conformance passed 6/6 twice, and the document reader 10/10.
    - **Findings for later tasks.**
      - Task 3: `continue()` passes `resumed: undefined` today. Restoring from a checkpoint means passing an `ActiveDurableRun` built from it into `runInternal(…, resumed, true)`. `settleContinuationTip` must still run on that path. It runs whenever `continued` is set and is independent of `resumed`, and `callsOwnedBySuspension` adds nothing for a checkpoint state, because a checkpoint has no `pendingCalls`.
      - Task 5: `continueInterrupted` can skip a session by catching `SessionContinueError` (`isSessionContinueError` is not exported; match `code === SESSION_NOTHING_TO_CONTINUE_CODE`).
      - The effect lookup hashes the arguments **as stored in the assistant message**. A `tool.call` hook that rewrote the arguments before dispatch keyed the effect under the rewritten arguments. The lookup then misses, and the call settles as `tool_call_interrupted`, not `tool_call_outcome_unknown`. Recorded under Compromises.

- [x] Task 3: Turn checkpoints keep counters, deadline, and loop state
  - Acceptance Criteria:
    - Functional:
      - `AgentConfig.durability: "suspension" | "turn"` (default `"suspension"`). With `"turn"`, after each completed tool round the kernel appends one `run_checkpoint` entry: run id, limit counters, `deadlineAt`, the run's tool grant, the loop name and revision, and the loop state from Task 4.
      - `continue()` finds the newest checkpoint for the interrupted run. If the agent fingerprint, loop name, and revision match, it resumes that run id with the stored counters and deadline and passes the loop state as `run.restored`. A mismatch fails closed with the existing `AgentRunStateError` / `ERR_PRISM_LOOP_REVISION`.
      - The checkpoint's `data` is a `StoredAgentRunState` (`status: "running"`), saved through `saveAgentRunState` under `KERNEL_SUSPENSION_REVISION`. That keeps one serialization, one redaction, and one byte bound. Restoring from it makes the continuation a durable resume, so `RunOptions.model`/`effectStore` are rejected as on `resume` (`assemble.ts:671`), and the docs say so.
      - Checkpoint entries are excluded from `session.messages()` and from provider input (`snapshotFromBranch` takes only `message`/`summary`). `fork()` copies them like other entries, but a fork never restores one: `continue()` ignores a checkpoint whose `sessionId` is another session's. They are included in tail snapshots (plan 230): the kernel adds the newest `run_checkpoint` older than `throughEntryId` to the compaction's `keepEntryIds` (so a store's tail read returns it), and `compactionCheckpoint` pins it, because before it pinned only message entries.
      - `continue()` restores a checkpoint only with `durability: "turn"`, and only the newest one, when it belongs to the run that wrote the branch's newest message. With `"turn"`, a custom loop without `snapshot`/`restore` fails at run start with `ERR_PRISM_LOOP_NOT_DURABLE` (Task 4's `state: "run"` will also qualify).
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
      - `src/contracts-core/session.ts`: add `"run_checkpoint"` to `SessionEntryKind` and `SESSION_ENTRY_KINDS`. Task 1 confirmed SQLite and Postgres store `kind` as unconstrained `TEXT`, and JSONL validates through `isSessionEntryKind`, so there is no DDL or codec change.
      - `src/agent-session/session.ts` (`compactionCheckpoint`): pin the newest `run_checkpoint`
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
    - `checkpoint_survives_a_tail_snapshot_after_compaction`.
    - `store_conformance_run_checkpoint_kind`: memory, JSONL, SQLite, Postgres.
    - `continue_restores_loop_state_and_starts_fresh_without_durability`, `a_custom_loop_without_snapshot_and_restore_rejects_turn_durability` (added during execution).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a config field and an entry kind
    - Docs pages to create/edit:
      - `docs/agent.md`: `durability`, with the write cost
      - `docs/slots.md`: the `run_checkpoint` entry kind for store authors
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-17):
    - **What changed.**
      - Contract: `AgentConfig.durability?: "suspension" | "turn"` (`src/contracts-core/agent.ts`), checked at create (`oneOf` in `src/agent-session/config-shape.ts`). `"run_checkpoint"` was added to `SessionEntryKind` and `SESSION_ENTRY_KINDS` (`src/contracts-core/session.ts`).
      - Writing (`src/agent-session/session/persist.ts`): `writeRunCheckpoint` builds a running `StoredAgentRunState` through `initialAgentRunState`. It holds the run id, counters, `deadlineAt`, `toolNames`, and the loop snapshot (`loop.snapshot()` today; Task 4 switches it to the controller's checkpoint). It saves through `saveAgentRunState` (redacted, 256 KiB bound) under the active durable revision or `KERNEL_SUSPENSION_REVISION`, then appends the entry without the cell `version`. `parseRunCheckpoint` reads it back through `parseAgentRunState` and fails closed on a run id or status mismatch.
      - The seam (`src/loop/run-controller.ts`): a new internal `RunControllerInternals.onToolRoundComplete`, called at the end of `executeTools` once the round's results are appended. It runs for every loop, because every tool runs through `executeTools`. `assembleRoundContext` sets it only with `durability: "turn"`, and it skips a round that staged an ask, because the `suspended_run` entry follows. A throw (append failure, oversize) fails the run before its next turn.
      - Run start (`executeRun`): with `"turn"`, a configured custom loop that is not durable throws `ERR_PRISM_LOOP_NOT_DURABLE` before the run claims the session.
      - Restoring (`src/agent-session/continue.ts`, `session.ts`): `continuationCheckpoint(entries, sessionId)` returns the newest checkpoint only when its `runId` is the newest message's `runId` and its `sessionId` is this session's. `continue()` checks the fingerprint (`AgentRunStateError` "…mismatch on continue"), claims the state into a fresh memory cell, and calls `runInternal([], …, checkpoint.runId, { options, state }, true)`. The existing durable-resume path then restores counters and deadline (`RunLimitTracker`), the tool grant (`selectRunTools`), and loop state (`ERR_PRISM_LOOP_REVISION`, then `restore`), and it rejects `RunOptions.model`/`effectStore`. `settleContinuationTip` still runs (Task 2's finding held).
      - Compaction (`session.ts`): `keepNewestRunCheckpoint` adds the newest `run_checkpoint` older than `throughEntryId` to the compaction's `keepEntryIds`, and `compactionCheckpoint` now pins `run_checkpoint` entries among the kept ids as well as messages. Adding it to `keepEntryIds` is needed: `snapshotFromTail` fails over to a whole-branch read when a pinned id is missing from the store's tail, and stores pin by `keepEntryIds` (`collectBranchTail`, `readBranchTail`). Only messages among kept entries reach provider input, so nothing else changes.
      - Stores: JSONL accepts the kind in its line validator (`case "run_checkpoint"` next to `suspended_run`). `storeConformance` gains the `run-checkpoint` leg (`STORE_CONFORMANCE_STEPS`). No DDL or codec change.
      - Tests: `src/__tests__/run-checkpoint.test.ts` has 10 tests. They cover every listed case. `continue_restores_counters_and_deadline_from_checkpoint` uses 3 of 5 turns, and the continuation breaches `maxTurns` after 2 more with the same `deadlineAt`. The tests added beyond the list are `continue_restores_loop_state_and_starts_fresh_without_durability` and `a_custom_loop_without_snapshot_and_restore_rejects_turn_durability`. The compaction test fails if the `keepEntryIds` pin is removed (checked). `store_conformance_run_checkpoint_kind` runs the memory store. JSONL and SQLite run the leg in their package suites, and Postgres ran it against a throwaway local server (`PRISM_TEST_POSTGRES_URL`, 58 pass).
      - Docs: `docs/agent.md` has a new "Turn checkpoints (`durability`)" section with the cost, and its entry-kind list now includes `run_checkpoint`. `docs/slots.md` covers the store-author note. `CHANGELOG.md` has an Unreleased entry.
      - Gate chores: `scripts/budgets.json` kernel ceilings were re-baselined with a dated reason (+3,129 packed, +12,276 unpacked, +3 counted exports, +166 source lines, no new file). The +3 exports are the kernel-internal `writeRunCheckpoint`, `parseRunCheckpoint` and `continuationCheckpoint`, with no root export. I regenerated `packages/hosts/host-builder/data/*` (`bun scripts/host-builder-index.mjs`) and updated only the `indexes` hash in `scripts/host-builder-evals/criteria.lock.json` to match. I also ran `bun scripts/package-truth.mjs --emit-docs`.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`). It is all additive, with no removals:
      - `@arnilo/prism`: `AgentConfig` gains `durability?: "suspension" | "turn"`; `SessionEntryKind` gains `"run_checkpoint"`; `./testing STORE_CONFORMANCE_STEPS` gains `"run-checkpoint"`.
    - **Checks.** These pass: `bun run typecheck`; `bun test src/__tests__/run-checkpoint.test.ts` (10 pass); session-continue, session-resume, durable-loops, session-tail-snapshot, agents, run-controller, agent-run-state, agent-surface-freeze, public-export-contract and fork (193 pass); the store-jsonl/sqlite/postgres/codecs and compaction package suites; `docs.test.ts` (69 pass); and `scripts/host-builder-evals/run.test.mjs` (18 pass). `bun scripts/release.mjs gate` fails only on `ranges: @arnilo/prism-ai … bump required`, which predates this task (see Task 2). `bun run test`: 8 of 9 stages pass. The budget stage fails only on the `@arnilo/prism-memory-system` export budget (1146 vs 1124) and the `packages/memory/system/src/session` non-null budget (159 vs 114), both from the uncommitted memory-system work (as in Task 2). The kernel's own `exportCounts["@arnilo/prism"]` was re-baselined 1592 → 1595 with a dated reason.
    - **Findings for later tasks.**
      - Task 4: `writeRunCheckpoint` and `suspendDurable` both read `loop.snapshot()` (persist.ts). Both must switch to the controller's `run.checkpoint` value for a `state: "run"` loop. The run-start guard in `executeRun` and the durable-resume guard use `isDurableLoop`, so extending `isDurableLoop` to accept `state: "run"` covers both.
      - Task 5: a continuation restored from a checkpoint reuses the run id. The ledger then gets a second `status: "running"` start record under the same id, and SQLite and Postgres keep the first `startedAt`. `olderThanMs` measured from `startedAt` is therefore the age of the original run.
      - Turn numbering restarts at 1 on a restored continuation (`RunControllerInternals.startTurn` is still unset), while the `turns` counter carries on. This is documented.

- [x] Task 4: Loop state belongs to the run
  - Acceptance Criteria:
    - Functional:
      - `RunController.checkpoint(value: JsonValue): void` records the loop's state for the current run; the kernel reads the latest value when it suspends or writes a turn checkpoint. `RunController.restored: JsonValue | undefined` carries the state of the run being resumed or continued.
      - A loop declares per-run state with a new optional `LoopStrategy.state?: "run"`. Such a loop needs no `snapshot`/`restore` and counts as durable (`isDurableLoop`). The declaration has to be static: `isDurableLoop` and the controller's `resumable` flag are decided before `loop.run` starts (Task 1(e)), so the kernel cannot wait to see a `run.checkpoint` call.
      - `run.restored` exposes the already-plumbed `RunControllerInternals.restoredLoopState` (`src/loop/run-controller.ts:84`). `suspendDurable` and Task 3's `writeRunCheckpoint` (both in `persist.ts`) read the controller's last `checkpoint` value for a `state: "run"` loop instead of `loop.snapshot()`.
      - Strategy-level `snapshot()`/`restore()` keep working. When a strategy that defines them has an active run and a second run starts on it, the second run fails closed with `AgentLoopStateError` (`ERR_PRISM_LOOP_SHARED_STATE`) unless the loop declares `state: "run"`. Active runs are counted per strategy object in a module-level `WeakMap`, because one strategy object can be shared across agents.
      - Task 1(e) found no first-party loop package with strategy-level state, but execution found one: the kernel's driver-kit loop (`createDriverLoop`, `src/driver-kit/define.ts`) used `snapshot`/`restore` to carry the binary's major version, so every driver package would have hit the shared-state guard on concurrent sessions. It moves to `state: "run"`. The migration also covers `examples/durable-loops-and-approvals.ts` and its copy under `packages/hosts/host-builder/data/examples/`.
      - `assertConcurrentLoopResume(strategy)` in `@arnilo/prism/testing` (next to `loopConformance`) covers two concurrent resumed runs keeping separate state.
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
        name: "phased", revision: "2", state: "run",
        async run(run) {
          let phase = (run.restored as { phase: number } | undefined)?.phase ?? 0;
          for (; phase < 3; phase++) { run.checkpoint({ phase }); await step(run, phase); }
        },
      };
      ```
    - Files to Create/Edit:
      - `src/loop/types.ts`, `src/loop/run-controller.ts`, `src/agent-session/helpers.ts`, `session/assemble.ts`, `session/persist.ts`
      - `src/contracts-core/…` (`AgentLoopStateError` code)
      - `examples/durable-loops-and-approvals.ts` and `packages/hosts/host-builder/data/examples/durable-loops-and-approvals.ts`: move to the per-run members. `driver-process` keeps its `external_state` and needs no change (Task 1(e)).
      - `src/testing/loop-conformance.ts`, `src/testing/index.ts`: `assertConcurrentLoopResume`
      - `src/driver-kit/define.ts` and its test: the driver loop moves to `state: "run"` (found during execution)
      - `src/contracts-run-state.ts` (`:217`): add `ERR_PRISM_LOOP_SHARED_STATE`
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding K11
  - Test Cases to Write:
    - `per_run_loop_state_survives_suspend_and_resume`.
    - `two_sessions_resume_with_separate_loop_state`.
    - `shared_strategy_state_fails_closed_on_second_run`.
    - `legacy_snapshot_restore_still_works_for_one_run`.
    - `loop_conformance_concurrent_resume`.
    - `turn_checkpoint_carries_run_checkpoint_value` (added during execution).
    - `revision_major_mismatch_on_resume` in `src/driver-kit/__tests__/driver-kit.test.ts` (rewritten for `state: "run"`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two `RunController` members, a `LoopStrategy` field, an error code and a testing export
    - Docs pages to create/edit:
      - `docs/loop.md`: "Loop state", with the example above and the shared-state rule
      - `docs/agent.md`: the `durability: "turn"` loop requirement; `docs/drivers.md`: the driver loop's per-run state
      - `packages/hosts/driver-process/README.md`: if its state handling is described (it is not; no change)
      - `CHANGELOG.md`: `## [Unreleased]`, Added
  - Notes (executed 2026-11-17):
    - **What changed.**
      - Contract (`src/loop/types.ts`): `RunController.checkpoint(value: JsonValue): void` and `readonly restored: JsonValue | undefined`; `LoopStrategy.state?: "run"`, with doc comments on the one-run-at-a-time rule for `snapshot`/`restore`. `AgentLoopStateError` gains `ERR_PRISM_LOOP_SHARED_STATE` (`src/contracts-run-state.ts`).
      - Controller (`src/loop/run-controller.ts`): `checkpoint` calls the new internal `RunControllerInternals.recordLoopState`, and `restored` exposes `restoredLoopState`. `assembleRoundContext` wires `recordLoopState` to store the value by reference in `session.activeLoopCheckpoint`. `executeRun` seeds that field from the resumed state's `loopState`, so a resume that records nothing new persists the restored value again. `cleanupRun` clears it.
      - Persist (`src/agent-session/session/persist.ts`): the new `currentLoopState(session)` returns the `activeLoopCheckpoint` for a `state: "run"` loop and `snapshot()` otherwise, bounded through `boundedLoopSnapshot`. `suspendDurable` and `writeRunCheckpoint` both use it.
      - Restore (`assemble.ts`): the strategy's `restore` is called only when the loop is not `state: "run"`. The name and revision check still runs first.
      - Durability: `isDurableLoop` accepts `state: "run"` (`src/agent-session/helpers.ts`). The three `ERR_PRISM_LOOP_NOT_DURABLE` messages now name both options.
      - Shared-state guard (`assemble.ts`): a module-level `WeakMap<LoopStrategy, number>` counts active runs per strategy object that defines `snapshot` or `restore` without `state: "run"`. The check runs in `executeRun` after the active-run check and before the session is claimed, so a rejected run claims and emits nothing. The count goes up just before the run's `try` and down in its `finally`, so a suspended or failed run frees the strategy.
      - Driver kit (`src/driver-kit/define.ts`): `createDriverLoop` drops `snapshot`/`restore` and declares `state: "run"`. `run()` first checks `run.restored.binaryMajor` against the current binary (`driver_revision_mismatch`, before `driver_unavailable` as before), then calls `run.checkpoint({ binaryMajor })`. `packages/hosts/driver-process` needed no change: its own resume check reads `external_state` and still passes (928 pass).
      - Testing: `assertConcurrentLoopResume(strategy)` (`src/testing/loop-conformance.ts`) runs two sessions on one strategy under `askEveryTool`. Both first runs must suspend and both concurrent resumes must complete. It returns each session's stored `suspended_run` loop snapshot. A strategy-level loop fails it with `ERR_PRISM_LOOP_SHARED_STATE`.
      - Examples: `examples/durable-loops-and-approvals.ts` (and the host-builder copy) uses `state: "run"`, `run.checkpoint` and `run.restored`. Its output is unchanged: `{"status":"completed","executed":["a","b"],"loopRestored":true,"loopTurns":2,"pendingCount":2}`.
      - Tests: `src/__tests__/loop-state.test.ts` has 6 tests: the five listed and `turn_checkpoint_carries_run_checkpoint_value` (a `durability: "turn"` checkpoint stores the `run.checkpoint` value, and `continue()` delivers it as `run.restored`). `shared_strategy_state_fails_closed_on_second_run` shares one strategy object across two agents. The controller key lists in `run-controller.test.ts` and `hook-invariants.test.ts` gain `checkpoint` and `restored`, and `public-export-contract.test.ts` freezes `assertConcurrentLoopResume`.
      - Docs: `docs/loop.md` adds a "Loop state" section, the two controller rows, `state` in the interface, and updates the suspension, `ask` and durability text. `docs/agent.md` covers the `durability: "turn"` requirement, `docs/drivers.md` the driver loop, and `CHANGELOG.md` has an Unreleased entry.
      - Gate chores:
        - `scripts/budgets.json` kernel ceilings were re-baselined with a dated reason: +3,403 packed, +11,015 unpacked, +1 counted export, +156 source lines (after `biome format`), no new file. `exportCounts["@arnilo/prism"]` went 1595 → 1596. JSON was rewritten with `ensure_ascii=False`, so no other line changed.
        - `bun scripts/host-builder-index.mjs` was regenerated, and only the `indexes` hash in `scripts/host-builder-evals/criteria.lock.json` was updated to match (18 pass).
        - `bun scripts/package-truth.mjs --emit-docs` was run.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`). It is all additive, with no removals:
      - `@arnilo/prism`: `AgentLoopStateError` code union gains `"ERR_PRISM_LOOP_SHARED_STATE"`; `LoopStrategy` gains `readonly state?: "run"`; `RunController` gains `checkpoint(value: JsonValue): void` and `readonly restored: JsonValue | undefined`; `./testing` gains `assertConcurrentLoopResume`.
    - **Checks.** These pass: `bun run typecheck`; `bun test src/__tests__/loop-state.test.ts` (6 pass); public-export-contract, docs, durable-loops, session-resume, host-ui, driver-primitives, run-controller, hook-invariants, run-checkpoint, session-continue, agents, agent-surface-freeze, mid-stream-retry, `src/driver-kit`, `scripts/phase8-conformance.test.mjs` and `scripts/retired-names.test.mjs` (403 pass); `bun run --filter @arnilo/prism-hosts test` (928 pass); `scripts/host-builder-evals/run.test.mjs` (18 pass). `bun scripts/release.mjs gate` fails only on `ranges: @arnilo/prism-ai … bump required`, which predates this plan (see Task 2). `bun run test`: the first full run failed `biome lint` on three diagnostics from this task (an unused `loop` in `writeRunCheckpoint`, the unused `JsonValue` import in `define.ts`, and an unsafe optional chain in the new test). I fixed them and ran `biome format` on the touched kernel files. That reflowed two Task 3 lines in `persist.ts`/`assemble.ts` and added 10 source lines and 37 bytes, so the kernel `unpackedBytes`/`sourceLines` ceilings were raised to match (4,357,095 / 44,615). Lint and the touched suites now pass. The failures left are not from this task:
      - The budget stage still fails on the `@arnilo/prism-memory-system` export budget (1146 vs 1124) and the non-null budget (`packages/memory/system/src/session` 159 vs 114, total 2352 vs 2261), as in Tasks 2–3. The two `!` this task first added in `assertConcurrentLoopResume` were replaced with `?.`.
      - These timing checks failed only under full-suite load (load/cpu 2.78) and passed in isolation: `contextBudget-10k-history` p95 in `benchmark-multi-agent.test.mjs` (24 pass with `hard-deny.test.ts`), `hard_deny_decision_budget`, and `validates a large argument object quickly`.
    - **Findings for later tasks.**
      - Task 5: none. The sweep calls `continue()` and is unaffected by where loop state lives.
      - A host that shares one strategy-level (`snapshot`/`restore`) loop object across concurrent sessions now gets `ERR_PRISM_LOOP_SHARED_STATE` on the second run. Before this, it silently overwrote state. This is the intended fail-closed change, and it is recorded under Compromises.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 5: A host can find and continue interrupted runs at startup
  - Acceptance Criteria:
    - Functional:
      - `findInterruptedRuns(runs, { ownership, olderThanMs })` in `@arnilo/prism-hosts/headless` takes a `Pick<ProductionPersistenceStore, "queryRuns">`, because `RunLedger` is write-only (Task 1(f)). It pages `queryRuns({ status: "running", ...ownership })` and keeps records whose `startedAt` is older than `olderThanMs`. `RunRecord` has no last-activity field, and SQLite ignores `toStartedAt`, so the helper does that filtering itself. It returns session and run ids (one per session, its newest run, with `startedAt`). Without a `queryRuns` function it throws a new `HeadlessError("ledger_query_unsupported")`; without an ownership object it throws `HeadlessError("invalid_ownership")` (added during execution).
      - `continueInterrupted(agent, runs, { concurrency })` opens each session and calls `continue()`, collecting results; a session that no longer owes a turn (or that the agent cannot open) is skipped, and any other error is collected as `failed`, never thrown.
      - The reference host configures no `runLedger` today (Task 1(f)). This task adds an opt-in one: a `recovery` config block puts `createSqlitePersistence` on the host's SQLite file into every worker's `runLedger` (`apps/prism-agent/src/host/store.ts`). The host's start for this sweep is a new `prism-agent recover [--agent] [--config]` command, which calls both helpers for one agent's sessions. A scenario proves it: a run is killed after a tool round, the host restarts with `recover`, and the task completes.
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
      - `packages/hosts/headless/src/recover.ts`: new; `src/index.ts`; `src/errors.ts` (`ledger_query_unsupported`); `README.md`
      - `apps/prism-agent/src/host/store.ts` (`runLedgerConfig`), `config.ts` (`recovery`), `coding.ts`, `research.ts`, `orchestrator.ts`: the opt-in run ledger
      - `packages/hosts/headless/src/__tests__/recover.test.ts`: new
      - `apps/prism-agent/src/cli/recover.ts` and `args.ts`, `bin/prism-agent.ts`: the `recover` command (replaces the `start.ts` edit: `startAgent` only creates one agent)
      - `apps/prism-agent/src/scenarios/recover-after-crash.ts`, the `write-then-crash` script in `mock-seam.ts`, `src/__tests__/recover.test.ts`: new
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
    - `a_second_sweep_skips_the_recovered_session`, `recover_command_takes_only_agent_and_config` (added during execution).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two host-library exports
    - Docs pages to create/edit:
      - `packages/hosts/headless/README.md`: "Recovering interrupted runs"
      - `apps/prism-agent/README.md`: the startup sweep
      - `docs/disaster-recovery.md`: link to the helper
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-17):
    - **What changed.**
      - New `packages/hosts/headless/src/recover.ts`, exported from `./headless`:
        - `findInterruptedRuns(runs: RunListing, { ownership, olderThanMs?, pageSize?, now? })`. `RunListing` is `Pick<ProductionPersistenceStore, "queryRuns">`. It pages `queryRuns({ status: "running", ...scope, limit, cursor })`. It then re-checks every row: status `running`, no `finishedAt`, the **exact** ownership scope (a row with a `tenantId` the scope leaves unset is dropped), and `startedAt` at least `olderThanMs` (default 60 000) before `now`. It keeps the newest run per session and sorts by `startedAt`.
        - `continueInterrupted(agent, runs, { concurrency? })` (default 2) runs a small worker pool over `agent.session({ id })` + `session.continue()`. Each outcome is `continued` (with the `RunResult`), `skipped` with `reason: "nothing_to_continue"` (matched on `SESSION_NOTHING_TO_CONTINUE_CODE`, as Task 2 recorded) or `"session_not_found"` (`isSessionNotFound`), or `failed` (with the error). It never throws for one run.
        - New `HeadlessErrorCode`s: `ledger_query_unsupported` and `invalid_ownership`. Bad `olderThanMs`/`pageSize`/`concurrency` reuse `invalid_limit`.
        - Only frozen or allowlisted kernel names are imported (`Agent`, `OwnershipScope`, `ProductionPersistenceStore`, `RunRecord`, `RunResult`, `isSessionNotFound`, `SESSION_NOTHING_TO_CONTINUE_CODE`), so `scripts/host-surface-allowlist.json` is unchanged.
      - Reference host (`apps/prism-agent`):
        - `HostConfig.recovery?: { olderThanMs? }`, validated in `loadHostConfig` (unknown keys and a negative or non-finite `olderThanMs` are rejected).
        - `runLedgerConfig(config)` in `src/host/store.ts` adds `runLedger: createSqlitePersistence({ filename: storePath })` to the coding, research and orchestrator workers only when `recovery` is set. Without it nothing changes.
        - The new `prism-agent recover [--agent] [--config]` command (`src/cli/recover.ts`) opens the named agent, lists the ledger under `agent.config.ownership ?? {}`, keeps the sessions whose index `actor.agent` is that agent (the ledger records no agent name), and calls `continueInterrupted`. It writes one `prism-agent.recovery` JSON line per run and then the exit line. The exit code follows `run`'s table over the continued runs. Without the `recovery` block it exits 2.
        - Plan deviation: the sweep is a command, not a step inside `startAgent`. `start.ts` only wraps one agent's creation, and running the sweep inside `run` would mix a recovery with a new prompt's events. A host with a long-lived process (the `schedule` command) is not wired to sweep. See Further Actions.
      - Scenario `recover-after-crash` (`src/scenarios/recover-after-crash.ts`). It drives the real bin as two processes on one SQLite file. The `write-then-crash` mock script answers turn 1 with a `write` tool call (`approval: "auto"`) and `SIGKILL`s its own process on the second model request, after the tool round's results are appended. The ledger row is then `running`. `prism-agent recover --agent coding` completes the run: the branch becomes `user, assistant, tool, assistant` with no new user message. A second `recover` skips the session as `nothing_to_continue`.
      - Tests:
        - `packages/hosts/headless/src/__tests__/recover.test.ts` (4 tests) has `find_interrupted_runs_returns_stale_running_records_in_scope` (paging with `pageSize: 2`, a too-young run, two out-of-scope rows, the newest run per session), `finished_and_suspended_runs_are_not_returned`, `ledger_without_listing_fails_closed` (and `invalid_ownership`, `invalid_limit`), and `continue_interrupted_skips_sessions_that_owe_nothing`. The last one uses a real agent with an in-memory ledger: a provider failure tail is continued, a finished session is skipped, and a missing session is skipped.
        - `apps/prism-agent/src/__tests__/recover.test.ts` (3 tests) has `reference_host_completes_a_killed_run_after_restart`, `a_second_sweep_skips_the_recovered_session` and `recover_command_takes_only_agent_and_config`.
      - Docs: `packages/hosts/headless/README.md` "Recovering interrupted runs" (and the new error codes under Failures and security), `apps/prism-agent/README.md` (the `recover` entry point, the `recovery` block, and the scenario row), the `docs/disaster-recovery.md` link, and a `CHANGELOG.md` Unreleased entry.
      - Gate chores:
        - `scripts/budgets.json`: `exportCounts["@arnilo/prism-hosts"]` went 1015 → 1022 (+7 `./headless` exports) with a dated reason. The kernel `packedBytes`/`unpackedBytes` ceilings went to 1,345,491 / 4,358,437 (+461 / +1,342), from CHANGELOG and `docs/disaster-recovery.md` text only, with a dated reason.
        - `bun scripts/host-builder-index.mjs` was regenerated (after the doc edits), and only the `indexes` hash in `scripts/host-builder-evals/criteria.lock.json` was updated to match.
        - `bun scripts/package-truth.mjs --emit-docs` was run.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`). It is all additive, with no removals:
      - `@arnilo/prism-hosts`: `./headless` gains `findInterruptedRuns`, `continueInterrupted`, `FindInterruptedRunsOptions`, `ContinueInterruptedOptions`, `ContinueInterruptedOutcome`, `InterruptedRun` and `RunListing`; `HeadlessErrorCode` gains `"ledger_query_unsupported" | "invalid_ownership"`.
    - **Checks.** These pass: `bun run typecheck`; `bun run --filter @arnilo/prism-hosts test` (932 pass, 2 skip); `bun run --filter @arnilo/prism-agent test` (69 pass, 1 skip); `bun run --filter @arnilo/prism-extensions test` (1095 pass); session-continue, run-checkpoint and loop-state (26 pass); `docs.test.ts` (69 pass); `scripts/host-builder-index.test.mjs` (7 pass); `scripts/host-builder-evals/run.test.mjs` (18 pass); `biome lint` and `biome format` on the touched files. `bun scripts/release.mjs gate` fails only on `ranges: @arnilo/prism-ai … bump required`, which predates this plan (see Task 2). `bun run test`: the first run failed the root tarball budget and `host_builder_index_is_fresh`, both from this task and both fixed above. The only failures left are the `@arnilo/prism-memory-system` export budget (1146 vs 1124) and the `packages/memory/system/src/session` non-null budget (159 vs 114, total 2352 vs 2261), from the uncommitted memory-system work, as in Tasks 2–4.

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

- Task 2: continuation settlement keys the effect lookup on the arguments stored in the assistant message. A call whose arguments a `tool.call` hook rewrote before dispatch is not found, and it settles as `tool_call_interrupted` even when its effect was dispatched. Fixing this needs the dispatched arguments hash (or the effect key) persisted with the call. Today it is held only in the effect store, under a key derived from those arguments. (P3)
- Task 3: `durability: "turn"` with a custom loop that defines neither `snapshot`/`restore` (nor, after Task 4, `state: "run"`) fails every run at start, rather than writing checkpoints that carry counters only. That keeps "a checkpoint can always be restored" true, but a host must drop `"turn"` for such a loop (for example `workflowLoopStrategy`). (P4)
- Task 3: a restored continuation restarts turn numbering at 1 while its `turns` counter carries on. Wiring `startTurn` from the counter was left out, so turn-indexed hooks see restarted numbers. (P3)
- Task 4: the shared-state guard is a behavior change for hosts that run one strategy-level (`snapshot`/`restore`) loop object across concurrent sessions. The second run now fails closed with `ERR_PRISM_LOOP_SHARED_STATE` instead of silently sharing state. The fix for such a loop is to declare `state: "run"`. A loop that is stateless but defines `snapshot`/`restore` (as the driver-kit loop did) is also caught, because the kernel cannot tell stateless from stateful. (P4)
- Task 5: a continuation without a turn checkpoint runs under a new run id, so the killed run's ledger row stays `running` forever. Each later sweep lists it again, and `continue()` skips it as `nothing_to_continue`. That costs one session open per stale row per sweep and never re-runs work, but the rows accumulate. (P3)
- Task 5: `olderThanMs` is the only guard against continuing a run another live process is still driving. The ledger holds no lease or heartbeat, and `RunRecord` has no last-activity field, so a run longer than `olderThanMs` in a second process can be continued twice. The kernel's active-run claim protects only within one process. (P2)
- Task 5: the reference host's sweep is the explicit `prism-agent recover` command. The long-lived `schedule` process does not sweep at start. (P3)

Recorded in plans/backlog.md.

## Further Actions

- None beyond the follow-ups recorded with each item under Compromises Made: each backlog entry is titled by the work that revisits it.

Recorded in plans/backlog.md.
