# Phase 19 Part A — run-path integrity: session event routing, tool-round settlement, metered package model calls, and the 0.14.0 release

## Objectives

- Fix the three defects of the 2026-11-13 evaluation that corrupt or misreport state without any error, and release them before any other hardening work.
  - **Defect 1: hook events reach the wrong session.** Each `RuntimeAgentSession` constructor replaces the agent's single event sink (`src/agent-session/session.ts:252`, `src/agent-session/create-agent.ts:90`, `:335`). Probe `p1-sink`: a `ctx.emit` raised in session A never reached A's stream, and session B's subscriber received it carrying A's session id.
  - **Defect 2: a stopped tool round poisons the session.** The serial path of `dispatchToolCallsInOrder` appends no result for the calls it never reached (`src/loop/dispatch.ts:33-41`). Probe `p2-orphan`: after a `maxToolCalls` breach the branch held three tool calls and one result, and the next run sent that history unchanged.
  - **Defect 3: package model calls are outside the hook and budget plane.** `PackageAPI.models.client().generate` calls the provider directly (`src/packages/loader.ts:710-746`). Probe `p8-sidecall`: seven provider calls, `model.call` fired twice, the run completed under a 5,000-token cap after spending 14,000 and reported 4,000.
- Publish the fixes as `@arnilo/prism` **0.14.0** (owner decision 2026-11-13: a minor release goes out after these three fixes and before the rest of Phase 19).

## Expected Outcome

- An event raised by a hook (`hook.error`, `ctx.emit`) is delivered to the session whose dispatch raised it, and to no other session. An event raised outside any session reaches `agent.subscribe()` only.
- Every tool call of an assistant message has exactly one tool result in the branch once its round ends, however the round ends: limit breach, abort, tool-round ceiling, or a thrown run-control error. An approval-pending call is the one exception and is settled by `session.resume`.
- A branch that already holds unanswered tool calls (written by 0.13.0, or by a process that died) is sent to the provider with a synthetic result after each such call. The store is not rewritten.
- A model call a package makes through `prism.models.client(...)`:
  - fires `model.request` and `model.call`, with `request.origin` naming the package
  - is charged to the active run's token and cost limits when the package passes its `SessionContext`, appears in `RunResult.usage`, and is written to the run ledger
  - is reported as one kernel `package.event` (`model.call`) either way
- `@arnilo/prism` and `@arnilo/prism-hosts` are published at 0.14.0, with each changed bundle bumped on its own line.

This plan implements roadmap **Phase 19 Part A** (owner decision 2026-11-13). Phase 19 does not exist in `roadmap.md` yet: Task 2 writes it, from the evaluation of 2026-11-13 and the owner's scope (every finding except first-party provider packages). It changes kernel contracts (the hook bus binding, a tool-result error code, `ModelClient.generate`, `ProviderRequest.origin`, the `model.call` hook context), so **Task 1 is the phase review**. Unlike plans 226–238 it ends in a version bump and a publish (Task 6), which the owner asked for; the tag push stays owner-gated.

The probe scripts that reproduced the defects are in the evaluation session's scratchpad and are not in the repo. Each task below turns its probe into a named kernel test first.

Known constraint: the memory-track packages (`packages/memory`, plans 216–223) also call `models.client`. `generate`'s new second argument is optional, so they compile and run unchanged; passing their session is left to the memory track.

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Event sink.** Every writer and reader of the agent sink: `sink` (`src/agent-session/create-agent.ts:90`), both `createHookBus({ onEvent })` sites (`:152`, `:265`), `setEventSink` (`:335`), the constructor call (`src/agent-session/session.ts:252`), the fork construction (`:811`), the bus's two emit paths (`emitError` at `src/hooks/bus.ts:123`, `viewOf` at `:218`), and `bound` (`:370`). Whether `HookBus` or `bound` is on any published surface (`scripts/compat-baseline/`).
      - (b) **Every way a tool round ends early.** For each, whether the assistant message is already in the branch and which calls have results: the serial loop (`src/loop/dispatch.ts:33-41`), the concurrent path's synthetic rows (`:68-90`), the tool-round ceiling stop taken after the assistant message is appended (`src/loop/run-controller.ts:183`), the round charge (`bindChargeToolRound`, `src/agent-session/session/tool-round.ts`), the per-call charge that throws (`src/tools.ts:252`), an abort between the gate and dispatch (`src/loop/run-controller.ts:253-300`), and a throwing `tool.result` transform.
      - (c) **Suspended runs.** What `session.run()` does today on a session whose branch holds a pending `suspended_run` entry (`pendingSuspensionOf`, `src/suspended-run.ts:111`), and which calls `session.resume` settles (`replayDurableNestedAndPending`, `src/agent-session/session/tool-round.ts`). The repair in Task 4 must not answer a call that a pending suspension still owns.
      - (d) **Package model calls.** Every caller of `models.client` outside `packages/memory`, with whether a `SessionContext` is in reach at the call site: `packages/extensions/compaction/src/index.ts:87-88`, `advisor/src/index.ts:95`, `context-engineering/src/index.ts:119`, `delegate/src/context.ts:85`, `delegate/src/runtime.ts:294`, `model-router/src/around.ts:239`, `packages/tools/web/src/index.ts:213-214`, `packages/knowledge/wiki/src/extension.ts:310-314`, `examples/side-call.ts:29`.
      - (e) **Hook handlers on `model.request` and `model.call`.** What each first-party handler does with a request, so Task 5 can say what changes when a package call reaches it: `model-router` (candidate selection, budgets), `governance` (`hooks.modelRequest`), `observability` (chat spans, `propagateTraceContext`), `context-engineering`, the memory packages.
      - (f) **Usage accounting seams.** `recordProviderUsage` (`src/agent-session/session/provider-round.ts:124`), `RunLimitTracker.recordUsage` (`src/run-limits.ts`), the usage accumulator, `UsageRecord.scope` (`src/contracts-protocol.ts:792`), and how a `RunLimitError` raised outside a provider turn ends the run.
    - Performance: n/a — read-only.
    - Code Quality: Each finding that changes Tasks 3–5 is written as "Task N assumed X; the code does Y; Task N changes to Z".
    - Security: Records whether a cross-session event can carry another tenant's data today (payload fields of `hook.error` and `package.event`), for the changelog's security note.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4 ("Model calls go only through `RunController.turn`…"), §2.4 (hooks), §2.5 (loop primitives), §2.6 (`PackageAPI`)
      - `docs/hooks.md`, `docs/events.md`, `docs/packages.md`, `docs/tools.md`
      - The evaluation findings K1, K3, K18 and the `models.client` path
    - Options Considered:
      - Skip the review because the defects are reproduced — rejected: Tasks 4 and 5 add contract surface, and (c) and (e) can change both.
    - Chosen Approach:
      - Read the code, write the inventory into this task's note, then confirm or re-cut Tasks 3–5.
    - API Notes and Examples:
      ```bash
      graft callers setEventSink --depth all
      graft callers dispatchToolCallsInOrder --depth all
      graft grep "models.client("
      ```
    - Files to Create/Edit:
      - `plans/225-…md`: the task note only
    - References:
      - `src/agent-session/session.ts:252`, `src/loop/dispatch.ts:33`, `src/packages/loader.ts:710`
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none — the review changes no behavior
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-14): read-only; no source file changed. A scratch probe (outside the repo) confirmed one behavior the plan had wrong (see (a) last bullet).
    - **(a) Event sink.**
      - Writers: `let sink` (`src/agent-session/create-agent.ts:90`); `setEventSink` (`:335-337`, declared at `src/agent-session/runtime-registry.ts:32`, whose own comment at `:28-31` already says "one sink per agent — concurrent runs share it"); the only caller is the session constructor (`src/agent-session/session.ts:252`). The constructor runs for every `agent.session()` (`create-agent.ts:206`) and every fork (`session.ts:811`), so each new or forked session steals routing from every other. The closure also keeps the last-opened session alive for the agent's lifetime.
      - Readers: both buses are built with `onEvent: (event) => sink?.(event)` (`create-agent.ts:152`, and `:265` for `reload()`); the bus calls `options.onEvent` from `emitError` (`src/hooks/bus.ts:123-132`), from `viewOf(...).emit` (`:223`) and from the `RAW_EMIT` symbol (`:226`).
      - Binding: `bound(sessionFor)` is `bus.ts:370`; the session binds at `session.ts:249` and re-binds at `:279` after `agent.reload()`. A session built with no runtime falls back to `createHookBus()` (`session.ts:247`) which has no `onEvent`, so events raised there are dropped today.
      - Every run path dispatches through `session.hooks()` (the bound bus): `assemble.ts:355,547,583`, `persist.ts:143`, `provider-round.ts:348`, and `RunController` through `internals.hooks` (`assemble.ts:583`). The unbound bus is used only by the package loader (`loader.ts:430`, `:753`) and `agent.inspect`. So per-binding sinks cover the whole run path.
      - Published surface: none. `createHookBus`, `HookBus`, `HookBusOptions` are not exported from `src/index.ts` (it exports only `HOOK_CATALOG`, the error classes, `askEveryTool` and the hook types), and `scripts/compat-baseline/arnilo__prism.txt` has no `HookBus`/`createHookBus`/`setEventSink`; `bound` appears in the baselines only as `WORK_SCOPE_BOUND` and `WorkspaceService.worktree.bound`, both unrelated. Changing the `bound` signature and deleting `setEventSink` needs no baseline update and no retirement-sweep entry.
      - **Correction.** Task 3 assumed a package event emitted "during `setup`" reaches the agent sink. It does not: `prism.events.emit` (`loader.ts:979` → `emitPackageEvent`, `:748-754`) calls `bus.observe("package.event", …)` only. It runs observe handlers and reaches no stream and no subscriber, today or after Task 3. Probe: an observer on `run.started` calling `prism.events.emit` produced no `package.event` on `session.stream()`, while `ctx.emit` from the same observer did. Only a handler's `ctx.emit` uses the sink.
    - **(b) Every way a tool round ends early.** In every case below the assistant message is already in the branch (`run-controller.ts:178`, appended before the round starts) and its calls have no result, except where noted.
      - Serial loop (`src/loop/dispatch.ts:33-41`): any throw out of `dispatchToolCall` leaves the current call and every later call without a result. It also never checks the signal between calls (the concurrent path does, `:60`), so after a limit breach aborts the controller (`assemble.ts:714`) the remaining calls still run.
      - Concurrent path (`:68-90`): settles every call with a synthetic row, skipping only a call whose failure is a run-control error (`isRunControlError`, `:96-102`: `ERR_PRISM_AGENT_RUN_SUSPENDED`, `ERR_PRISM_DELEGATION_SUSPENDED`, `ERR_PRISM_LOOP_*`). The claimed call gets the thrown error's name/message/code; unclaimed calls get `tool_call_not_dispatched`. These rows emit no `tool.completed`.
      - Round charge: `chargeToolRound` (`dispatch.ts:31`, bound at `tool-round.ts:359-363` to `limits.charge("maxToolRounds")`) throws before the first call, so no call is answered on either path.
      - Per-call charge: `limitTracker.charge("maxToolCalls")` (`src/tools.ts:252`) runs before `tool.started` and outside every `try`, so it escapes `dispatchToolCall` with no event and no result. Tool errors do not escape: `tool.execute` throws become error results (`tools.ts:355-380`). Only these escape: the charge, a `beforeExecute` suspension or loop-state error (`:311`), and a delegation suspension (`:358`).
      - Gate phase (`run-controller.ts:261-279`): `gateCall`, a throwing `tool.call` handler, or `internals.ask` raise before `dispatchToolCallsInOrder` is entered, so nothing is settled. `toolRounds` is already incremented.
      - Dispose: `executeTools` returns `calls.map(disposedResult)` at `run-controller.ts:259` without appending them, so the branch keeps the calls unanswered. A per-call dispose inside `dispatchOne` (`:327`) does append, because the seam appends returned results.
      - `tool.execute` around hook or `tool.result` transform throwing (`run-controller.ts:340-373`): `dispatchOne` rethrows, same as a charge: serial strands the rest; concurrent settles it.
      - Tool-round ceiling (`run-controller.ts:182-186`): returns `{ stopped: true, toolCalls: dispatchable }` after the append at `:178`; `default-loop.ts:14` then returns. `executeTools` is never called, so a fix inside the dispatch seam cannot reach it. The same is true of any custom loop that drops `turn.toolCalls`.
      - **Change for Task 4:** Task 4 assumed settlement in the dispatch seam plus the ceiling stop. The code also strands calls at the gate phase (`:261-279`), at the dispose early return (`:259`), and in any loop that does not call `executeTools`. Task 4 changes to: wrap `executeTools` from `:261`, and make `RunController` track the dispatchable calls of its last `turn()` until each has a result appended; the ceiling stop and the run's non-suspended end settle what remains. The dispatch seam stays the primary path.
    - **(c) Suspended runs.**
      - `session.run()` has no suspension guard (`session.ts:503-505`; `runInternal` checks only reloading and scope). A fresh run on a suspended session appends its input after the `suspended_run` entry, which moves the tip, so `pendingSuspensionOf` (`src/suspended-run.ts:111-119`, which requires the entry to be the tip, `package_state` aside) no longer finds it: the suspension is abandoned and a later `session.resume` throws `ERR_PRISM_DECISION_STALE` (`session.ts:622`). `pendingSuspendedRun` is cleared only by `continueSuspendedRun` (`:544`), so it stays stale on a fresh run; nothing else reads it.
      - A resume goes through `executeRun` too, so `session.rebuildHistory()` at `assemble.ts:324` runs on resume. `replayDurableNestedAndPending` (`tool-round.ts:470-560`) then settles, in order: rejected calls (`replayRejected`, appends a result and emits a blocked `tool.completed`), elicitation answers (`replayToolResult`), and approved calls (`executeApproved` → `executeTools`, so they get real results appended after any later results). A call is therefore answered by a result anywhere later in the branch, not only directly after it.
      - Calls a suspension owns, by state field: `state.pendingCalls[].call.id` (`src/agent-run-state.ts:42`, any status), the legacy `state.pending.call.id` (`:39-40`), and `state.nestedRuns[].toolCallId` (`tool-round.ts:488-498`).
      - **Change for Task 4:** the repair skips those ids on a resume only. A fresh run repairs every unanswered call, including those of a pending suspension, because starting it abandons that suspension. The acceptance criterion is rewritten to say so. `rebuildHistory` takes no parameter today; the repair reads `session.activeDurable?.state` (the field `tool-round.ts` reads), so no signature change.
    - **(d) `models.client` callers** (each passes no session today; `SessionContext` in reach as noted).
      - `compaction/src/index.ts:87-88` + `strategy.ts:164`: `CompactionContext` carries `session?` (`context.session?.model` is read at `:86`), optional because `agent.commands`/host compaction has none. Pass it when present.
      - `advisor/src/index.ts:95` builds the client once at setup; `consult.ts:15` makes the call from the `advise` tool, the `beforeTools`/`beforeFinish` hooks and `validate`, all of which hold `context.session`. Thread it through `generateText`.
      - `context-engineering/src/index.ts:119` + `fold.ts:341`: `summarizeFor(session)` has the session, but `createModelSummarize` takes only a `ToolResultFoldInput`; add the session to the closure it builds per call. It runs inside `context.build`, mid-run.
      - `delegate/src/context.ts:85`: `buildSeededContext` already has `input.session`; `summarize()` does not. `delegate/src/runtime.ts:294`: the child provider bridge is created in `buildAgent` (`:~273`), called at `:355` from `run()` where `input.session` (`DelegateStartInput.session?`, `:70`) is in scope; pass it into `buildAgent` and the bridge closure. The session is optional (an async child outlives the call), so a child started without one is unmetered.
      - `model-router/src/around.ts:239`: the cross-provider onward call. It has `context` (a `model.call` hook context), not a `SessionContext`; it moves to `context.call` (Task 5), not to `models.client`.
      - `tools/web/src/index.ts:213-214` + `prompt-fetch.ts:61`: the answerer is built once at setup; the call is made from the `web_fetch` tool, whose `ToolExecutionContext.session` is set by `toolSession` (`tool-round.ts:375-378`). Pass it per call through `PromptFetch.answer(…, request)`.
      - `knowledge/wiki/src/extension.ts:310-314` + `consolidate/pass.ts:261`: the curator builds a client per pass; `wiki:consolidate` (`commands/consolidate.ts:32`) and the background pass (`curator.opened/turn(session)`) both hold a `SessionContext`. The task note lists it as in scope for Task 5 but it was not in the plan's caller list; add it.
      - `examples/side-call.ts:29` and its host-builder copy: the tool's `execute(args, context)` has `context.session`.
      - Outside this plan (memory track): `packages/memory/system/src/ltm/index.ts:168`, `packages/memory/system/src/session/setup.ts:234`. Both compile unchanged.
    - **(e) Handlers on `model.request` / `model.call`.**
      - `model-router` (`around.ts:44-363`): builds `candidateList` from its configured candidates for every request (`:62-66`), ignoring `request.model`, and resolves budgets, rate limits and circuit state per attempt (`router.resolve`, `:92`). A package call would therefore be rerouted to the first candidate. Its onward call for a different provider is `prism.models.client(selectedModel).generate(...)` (`:239`); once package calls run `model.call`, that re-enters this same handler. It must use `context.call`. The same-provider first attempt uses `next` once (`calledNext`, `:236-238`).
      - **Change for Task 5:** for `request.origin.kind === "package"` the router uses `[request.model]` as its only candidate, with no fallbacks, and still runs `resolve`/`recordOutcome`/`recordUsage`. Router tests pin this.
      - `context.sessionId` is `""` in every `model.call` handler today: `around` builds its context with `contextFor(payload)` and no identity (`bus.ts:306`), while `transform` accepts one (`:~258`). The router's `governance.identity.get(context.sessionId)` (`around.ts:51-52`) therefore never finds a verified identity and falls back to the session principal. **Change for Task 5:** `around` takes the same optional `identity` argument; run turns and package calls both pass it. This is an intended behavior change for run turns (the verified identity starts applying to routing) and goes in the changelog.
      - `governance` `hooks.modelRequest` (`governance/src/index.ts:311-322`, off by default): evaluates `model.request` against policy with `actorFor(context)` (`:241-242`, `identity?.active(...) ?? sessionIdentity(context.session)`). With no session `sessionIdentity(undefined)` applies. Task 5's governance test must pin that this denies or labels as the policy defines for a sessionless call, not allows silently.
      - `observability` (`observability/src/index.ts:177-184`, only with `propagateTraceContext`): injects trace headers from `activeTraceSpan(tracker.active, context.runId)`. Package calls on a bound bus carry the run id, so they join the run's span with no code change. Chat spans come from `turn.*` events, which package calls do not emit; the span "labeled with the package" in Task 5 is the kernel `package.event` (`model.call`) handler's job, not a new transform. Task 5 narrows to that.
      - `context-engineering` (`context-engineering/src/index.ts:155-165`): its `model.request` handler measures every request against the run's input cap and emits `context.accounted`. For a package call it would account a summarizer request against the run's cap and emit misleading events. **Change for Task 5:** it returns early for `origin.kind === "package"`.
      - Memory packages register `context.build` only (`memory/system/src/session/setup.ts:120`, `ltm/provider.ts:32`), which package calls skip by design.
    - **(f) Usage accounting seams.**
      - `recordProviderUsage` (`provider-round.ts:124-160`) takes a `RoundContext` and prices with `ctx.model`, the run's model, so it cannot price a package call to another model as it stands. Steps: `withCatalogCost` (module-private, `:100`) → `limits.recordUsage` → `session.activeInputMeter` → `runUsage.add` → one ledger `UsageRecord` with `scope: "provider_turn"` (`:147`).
      - `RunLimitTracker.recordUsage` (`src/run-limits.ts:270-293`) charges input, output and total tokens and cost; on a breach `exceed` calls the tracker's `onExceeded`, which aborts the run controller with a `RunLimitError` (`assemble.ts:711-716`). A `RunLimitError` thrown inside a tool is converted to a tool error result (`tools.ts:355-380`); the run ends because the controller is aborted and the next `throwIfAborted` raises it, and the run's catch turns it into one `run.failed { limit }` (`assemble.ts:771`).
      - Seam that already exists: `addUsage` on the run controller internals (`assemble.ts:562-566`: `limits.recordUsage(usage); runUsage.add(usage)`), used by loops that pass a model through. `session.activeLimits` is on the session (`session.ts:143`); `runUsage` is a local in `executeRun` (`assemble.ts:701`) and the ledger is `session.activeLedger`.
      - `UsageScope` is `"provider_turn" | "run_total"` (`src/contracts-protocol.ts:784`), documented "prevents provider-turn and aggregate totals from being summed together". A third member `package_call` is additive for readers but any host that sums rows by scope must add it; the changelog says so.
      - **Change for Task 5:** it assumed "an internal record-usage entry the loader calls through the session view". The view is a plain object built in `sessionContextFor` (`session.ts:285-`) and the loader (`loader.ts`) holds only the unbound `bus`. Task 5 changes to: a kernel-internal, symbol-keyed seam on the session view (not exported from any barrel, like `RAW_EMIT`, `src/hooks/emit.ts`) that exposes the session's bound bus, its `emit`, and an optional `recordUsage(model, usage)` that is defined only while a run is active (the session sets `activeAddUsage` in `executeRun` and clears it where `activeLimits` is cleared, `persist.ts:261-263`). `recordUsage` reuses the shared price/limit/accumulate/ledger steps, factored out of `recordProviderUsage` and parameterized by model and scope. A call with no session emits its `package.event` through `options.emitAgentEvent` (the path `package.status` uses, `loader.ts:430-431`).
      - Neither `embeddings` nor `decisions` goes through this seam; recorded as outside this fix.
    - **Security note for the changelog.** A cross-session event carries another tenant's data today. `hook.error` carries `{ hook, owner, error }` where `error.message` is a handler's thrown message (redacted only for agent-resolved secrets, `bus.ts:121`); `package.event` carries `{ package, name, data }` with arbitrary package JSON (e.g. `router.decision`, `guardrail.decision`, `memory.session.status`, `context.accounted`). Session B receives A's event through `session.emit` → `dispatchEvent` (`session.ts:888-896`), so it reaches B's subscribers, B's observe hooks, and B's run ledger (`recordToLedger`, `:914-925`, which stamps B's ownership on a row keyed by A's session id); it is redacted with B's redactor, not A's. The effect needs two sessions of different tenants open on one agent, which is the normal server-host shape.
    - **Verdict:** Tasks 3–5 stand, with the amendments recorded in each task below.

- [x] Task 2: Roadmap amendment — Phase 19, post-0.13.0 hardening (docs only)
  - Acceptance Criteria:
    - Functional:
      - `roadmap.md` Part 4 gains **Phase 19 — Post-0.13.0 hardening**, with Goal, Why, Scope, Depends on and Done, and one Scope entry per part: A (this plan), B tool dispatch, C provider turns, D event delivery, E workable defaults, F session stores, G run recovery, H sub-agents, I coding-tool safety, J MCP, K structured output, L interop, M guardrails. Part N (Node.js) is written by plan 238's own amendment task, because it reverses a §1.4 rule.
      - The header's `Updated:` line names the owner decision of 2026-11-13 and the one exclusion: first-party provider packages.
      - Part 3 "Version targets" gains a row: kernel and `@arnilo/prism-hosts` 0.14.0 after Part A; later parts carry no version of their own.
      - "Order" gains: Phase 19 follows Phase 11; Part A, then the 0.14.0 publish, then Parts B–N in plan-number order.
      - `PRODUCT.md` is unchanged in this task (Tasks 4–5 change no product statement; plan 226 corrects "schema validation").
    - Performance: n/a — docs only.
    - Code Quality: Scope entries state outcomes, not tasks; no plan numbers inside the phase body beyond the part-to-plan table.
    - Security: n/a — docs only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Part 3, Part 4 (Phase 18 as the shape to follow, `:2315`), "Order" (`:2508`), "Out of scope" (`:2547`)
      - Plan 224 Task 2 (the last roadmap amendment task)
    - Options Considered:
      - Append the parts to Phase 11 — rejected: Phase 11 is recorded done and 0.13.0 is published.
      - One roadmap entry per plan, written by each plan — rejected: plans 226–237 would each start by editing the same section.
    - Chosen Approach:
      - One Phase 19 entry written here; each later plan cites its part.
    - API Notes and Examples:
      ```markdown
      ### Phase 19 — Post-0.13.0 hardening
      **Goal.** The run path, defaults, stores and sub-agent model hold up in production.
      ```
    - Files to Create/Edit:
      - `roadmap.md`: header line, Part 3 row, Phase 19 entry, Order
    - References:
      - `plans/README.md` "Post-0.13.0 hardening path"
  - Test Cases to Write:
    - none new; `bun test --timeout=0 src/__tests__/docs.test.ts` and `scripts/phase24-truth.test.mjs` stay green
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - `roadmap.md`: as above
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-14): docs only; `roadmap.md` is the only file changed besides this plan.
    - Header `Updated:` now leads with the 2026-11-13 owner decision (Phase 19, the first-party-provider exclusion, Part A then 0.14.0, Part N owner-gated); the 2026-11-10 text follows as "Previously".
    - Part 3 "Version targets" gained one row: `@arnilo/prism` and `@arnilo/prism-hosts` 0.14.0 after Part A; changed stable bundles on their own lines; Parts B–N carry no version.
    - Part 4 gained `### Phase 19 — Post-0.13.0 hardening` after Phase 11 (where Phase 18's entry is the shape followed): Goal, Why, Scope (parts A–N, outcomes only), a part-to-plan table (the only plan numbers in the body), Depends on, Out of scope (first-party providers), Done.
    - "Order" gained a paragraph: Phase 19 follows Phase 11; Part A, the 0.14.0 publish, then B–N in plan-number order; Part N waits for the owner.
    - Part N's Scope entry says §1.4 and "Out of scope" (Node.js) stand until plan 238's own amendment task changes them; neither was edited here. `PRODUCT.md` unchanged, as specified.
    - Added beyond the acceptance list: an "Out of scope" line inside the Phase 19 entry, to carry the owner's exclusion in the phase body and not only in the header.
    - Checks: `src/__tests__/docs.test.ts` 69 pass; `scripts/phase24-truth.test.mjs` 13 pass.

- [x] Task 3: Hook events are delivered to the session that raised them
  - Acceptance Criteria:
    - Functional:
      - A `ctx.emit(...)` or a `hook.error` raised while session A dispatches a hook is pushed to A's subscribers, A's ledger, and A's observe hooks. No other session receives it.
      - A session opened, forked, or closed later does not change where A's events go.
      - An event raised with no session bound (a handler's `ctx.emit` on a hook the package loader dispatches on the unbound bus, such as an observer of `package.status`) reaches `agent.subscribe()` and no session. A session built with no agent runtime (`session.ts:247`) delivers its own hook events too. (Task 1(a): `prism.events.emit` is observe-only and is not changed by this task.)
      - A closed session receives nothing and is not kept alive by the bus.
      - `AgentRuntime.setEventSink` is deleted with its one caller. It is internal, so no retirement sweep entry is needed; the task note records the `scripts/compat-baseline/` check from Task 1(a).
    - Performance: Dispatch allocates nothing new per event; `bound` is still created once per session (and once more after `agent.reload()`).
    - Code Quality: The session passes its own sink to the bus it binds; there is no agent-level mutable sink and no lookup of a session by id.
    - Security: A subscriber of one session can no longer read another session's `package.event` or `hook.error`, and one session's ledger no longer records another session's events under its own ownership (Task 1 security note). The changelog entry is filed under Security.
  - Approach:
    - Documentation Reviewed:
      - `src/hooks/bus.ts:123` (`emitError`), `:218` (`viewOf`), `:370` (`bound`)
      - `src/agent-session/session.ts:245-252` (bus binding in the constructor), `:280-287` (`hooks()` re-binding after reload)
      - `src/agent-session/create-agent.ts:90`, `:152`, `:265`, `:335`
      - `docs/hooks.md`, `docs/events.md`
    - Options Considered:
      - Route by `event.sessionId` through a map of open sessions — rejected: two session objects can hold the same id, and a lookup keeps the indirection that caused the bug.
      - Keep one sink and set it at each run start — rejected: two sessions running at once still collide.
    - Chosen Approach:
      - `bound(sessionFor, onEvent)` takes the sink for that binding. `dispatchers` uses it for `emitError`, `viewOf(...).emit` and the raw emit. The unbound bus keeps the agent-level sink, which becomes `emitAgentEvent` only.
    - API Notes and Examples:
      ```ts
      // kernel-internal
      bound(sessionFor: (owner: string) => SessionContext, onEvent: (event: AgentEvent) => void): HookBus;
      // session.ts
      this.boundHooks = this.hookBusInstance.bound((owner) => this.sessionContextFor(owner), (event) => this.emit(event));
      ```
    - Files to Create/Edit:
      - `src/hooks/bus.ts`: `dispatchers` takes the event sink; `bound` passes it
      - `src/hooks/types.ts`: `HookBus.bound` signature
      - `src/agent-session/session.ts`: both `bound(...)` call sites; drop `setEventSink`
      - `src/agent-session/create-agent.ts`: remove `sink` and `setEventSink`; the unbound bus emits to `emitAgentEvent`
      - `src/agent-session/runtime-registry.ts`: `AgentRuntime` loses `setEventSink`
      - `src/__tests__/session-event-routing.test.ts`: new
    - References:
      - Evaluation probe `p1-sink`
  - Test Cases to Write:
    - `hook_emit_reaches_its_own_session_stream`: session A's `stream()` yields the `package.event` its `turn.before` handler emitted. Fails if the sink is agent-wide.
    - `no_cross_session_event_delivery`: with A and B open, B's `acrossRuns` subscriber receives nothing while only A runs.
    - `hook_error_routes_to_dispatching_session`: a throwing observer in A's run produces `hook.error` on A only.
    - `fork_and_later_sessions_do_not_steal_events`: forking A, then opening C, leaves A's routing unchanged.
    - `sessionless_package_event_reaches_agent_subscribers_only`: after `createAgent`, a package calls `prism.status.note(...)`; its observer of `package.status` calls `ctx.emit(...)`; the event reaches `agent.subscribe()` and no open session. (Not `prism.events.emit`, which reaches no stream — Task 1(a).)
    - `session_without_runtime_delivers_its_hook_events`: a session built with no agent runtime receives a `ctx.emit` raised in its own dispatch.
    - `routing_survives_reload`: after `agent.reload()`, A's next run still receives its own hook events.
    - `custom_loop_routes_the_same_way`: the same assertions on a loop registered through `slot:loop`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — which stream carries hook-raised events
    - Docs pages to create/edit:
      - `docs/events.md`: one sentence under `package.event` and `hook.error` on delivery scope
      - `CHANGELOG.md`: `## [Unreleased]`, Security
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-14):
    - **What changed.** `HookBus.bound(sessionFor, onEvent)` (`src/hooks/types.ts`, `src/hooks/bus.ts`) now takes the sink for that binding; `dispatchers` and `emitError` use it for `ctx.emit`, `hook.error` and the raw emit. The unbound bus keeps `HookBusOptions.onEvent`, which `createAgent` now points at `emitAgentEvent` (`create-agent.ts`), so a session-less event reaches `agent.subscribe()` only. Both session binding sites (`session.ts` constructor and the re-bind in `hooks()` after `agent.reload()`) pass `(event) => this.emit(event)`. `let sink`, `setEventSink` and its `AgentRuntime` declaration are deleted. No new allocation per event: the sink is a closure created once per binding.
    - **Baseline check (Task 1(a)).** `HookBus`, `createHookBus`, `bound` and `setEventSink` are on no published surface, so no `scripts/compat-baseline/` change and no retirement-sweep entry. `bun run typecheck` is green.
    - **Closed sessions.** The agent holds no reference to a session through the bus any more (the old `sink` closure kept the last-opened session alive). A closed session's bound bus is no longer reachable from the shared bus, and `closed_session_receives_nothing…` pins that B's events never reach a closed A. That test passes on the old code too, because a closed session's subscribers are closed; it guards the retention fix rather than the routing.
    - **Tests.** `src/__tests__/session-event-routing.test.ts`, 9 tests: the 8 behaviour tests fail on the old source (checked by reverse-applying the patch) and pass now. `session_without_runtime…` builds a `RuntimeAgentSession` over a stub agent and registers through its private `hookBusInstance`, since there is no public way to register on a runtime-less session's bus. Affected suites (`hook-bus`, `hook-invariants`, `agent-reload`, `agent-dispose`, `session-subscriber-ownership`, `agent-event-source`, `package-loader`, `agents`, `docs`): 265 pass.
    - **Docs.** `docs/events.md` (`hook.error`, `package.event` delivery scope); `CHANGELOG.md` `## [Unreleased]` has no category headings, so the entry is a bullet that leads with "Security:" and carries the Task 1 security note.
    - **Finding for later tasks.** Task 5's session-view seam can rely on the per-session bound bus now existing as `session.hooks()`; a package call that passes its session emits through that bus's sink (`session.emit`), and one without a session through `emitAgentEvent`, as Task 5 already says.
    - **Incident (no effect on the tree).** While checking the tests against the old source I ran a `git stash push` whose pathspec did not match, and the following `git stash pop` popped a pre-existing stash (`stash@{0}`, "WIP on main: 12192d66 fix(prism-code): keep picker rows on one line"). The pop aborted on tracked files and wrote only untracked files from that stash that did not already exist; I deleted those 15 files (all identified by the stash's untracked tree and a fresh mtime) and left the stash entry in place. `git status` now shows only this task's changes. The owner may want to drop that old stash.

- [x] Task 4: Every tool call is answered when its round ends, and unanswered calls are repaired in the provider view
  - Acceptance Criteria:
    - Functional:
      - When `executeTools` returns or throws, every call it was given has one appended tool result, in call order, except a call whose result carries `approvalPending` (settled by `session.resume`).
        - A call that never started gets `error.code: "tool_call_not_dispatched"` (the existing code, `src/loop/dispatch.ts:110`).
        - This holds on the serial path, on the concurrent path, when the round charge or a per-call charge throws `RunLimitError`, when the gate phase (`run-controller.ts:261-279`) throws or the run is aborted there, when the dispose early return (`:259`) answers the calls, and when a `tool.result` transform or `tool.execute` around hook throws.
        - The call whose failure raised keeps the concurrent path's current result (the thrown error's name, message and code); calls after it get `tool_call_not_dispatched`. A call whose failure is a run-control error (`ERR_PRISM_AGENT_RUN_SUSPENDED`, `ERR_PRISM_DELEGATION_SUSPENDED`, `ERR_PRISM_LOOP_*`) is not settled, because its machinery writes the real result on resume.
        - The serial path checks the signal before each call, as the concurrent path does, so a call after an abort never starts.
        - The `agent_disposed` results that `executeTools` returns at `:259` are appended, not only returned.
      - **Run-level backstop.** `RunController` tracks the dispatchable calls of its last `turn()` until a result is appended for each. The tool-round ceiling stop (`run-controller.ts:183`) settles what remains with `tool_call_not_dispatched` before it returns `stopped`, and the run's non-suspended end does the same, so a custom loop that drops `turn.toolCalls` is covered (Task 1(b)).
      - Each synthetic result emits one `tool.completed { status: "blocked", reason: <the result's error code> }`, so the event stream and the transcript agree. The `blocked` helper at `run-controller.ts:304` is generalized to take the code instead of fixing `hook_denied`.
      - **Repair.** When history is rebuilt from the branch (`replaceHistory`, `session.ts:1227`, the one funnel for run start, `checkout` and mid-run compaction), an assistant tool call with no tool result anywhere later in the branch is followed, in the provider view, by a synthetic result with `error.code: "tool_call_interrupted"`. The store is not written, and `session.messages()` keeps showing the stored branch. Calls a pending suspension owns (`state.pendingCalls[].call.id`, the legacy `state.pending.call.id`, `state.nestedRuns[].toolCallId`, read from `session.activeDurable?.state`) are skipped when the run is a resume. A fresh run repairs them too: starting it moves the tip and abandons the suspension (Task 1(c)).
      - The repair is a pure function of the branch: the same branch yields byte-identical synthetic rows, so cached prefixes stay valid.
      - A run that repaired at least one call emits one kernel `package.event` (`history.repaired`, with the count and the call ids).
      - Provider-hosted calls (`authority: "provider-hosted"`) are never settled or repaired.
    - Performance: Settlement adds no store read. Repair is one pass over messages already in memory during `rebuildHistory`, with no extra store call; a branch with no orphan allocates nothing.
    - Code Quality: One settlement helper used by both dispatch paths and the ceiling stop; the repair lives beside `snapshotFromBranch`'s consumers in the session, not in a codec.
    - Security: Synthetic results carry no arguments and no tool output. `history.repaired` carries ids and a count only.
  - Approach:
    - Documentation Reviewed:
      - `src/loop/dispatch.ts:26-126`, `src/loop/run-controller.ts:160-200`, `:253-300`
      - `src/tools.ts:252` (the charge that throws before any event)
      - `src/agent-session/session/assemble.ts:324` (`rebuildHistory` at run start), `src/agent-session/session.ts` (`replaceHistory`, `rebuildHistory`)
      - `src/testing/prefix-stability-conformance.ts`
      - `docs/tools.md`, `docs/events.md`, `docs/loop.md`
    - Options Considered:
      - Roll the assistant message back when a round stops — rejected: the store is append-only and the message is already streamed.
      - Persist a repair entry at the next run start — rejected: a result appended at the tip lands after later messages, and providers require it directly after the call.
      - Repair in each codec — rejected: three codecs, and `session.messages()` would still show the gap.
    - Chosen Approach:
      - Settle at write time in the dispatch seam (`try`/`finally` around the round), and repair at read time where history is rebuilt. The first stops new orphans; the second covers 0.13.0 branches and process death.
    - API Notes and Examples:
      ```ts
      // synthetic result written at round end
      { toolCallId, name, error: { code: "tool_call_not_dispatched", message: "…the round stopped before this call ran." } }
      // synthetic result in the provider view only
      { toolCallId, name, error: { code: "tool_call_interrupted", message: "…no result was recorded for this call." } }
      ```
    - Files to Create/Edit:
      - `src/loop/dispatch.ts`: settle the remaining calls on every exit of both paths; check the signal between serial calls
      - `src/loop/run-controller.ts`: track unanswered calls of the last turn; settle on the ceiling stop and at run end; wrap `executeTools` from `:261` so a gate-phase throw or abort still settles; append the dispose results
      - `src/agent-session/transcript.ts` (tentative — or a new `src/agent-session/history-repair.ts` if the helper does not fit): the pure repair
      - `src/agent-session/session.ts`: apply the repair in `replaceHistory` (`:1227`); emit `history.repaired` once per run, after `run.started`
      - `src/__tests__/tool-round-settlement.test.ts`, `src/__tests__/history-repair.test.ts`: new
      - `src/testing/loop-conformance.ts`: a settlement case, so a custom loop is held to it
    - References:
      - Evaluation probe `p2-orphan`; `src/loop/dispatch.ts:68-90` (the concurrent path already does this)
  - Test Cases to Write:
    - `serial_round_limit_breach_settles_every_call`: three calls, `maxToolCalls: 1`; the branch ends with three results. Fails on today's serial loop.
    - `round_charge_breach_settles_every_call`: `maxToolRounds` exceeded by the charge; all calls answered.
    - `tool_round_ceiling_stop_settles_calls`: the `turn_limit` stop leaves no unanswered call.
    - `abort_between_gate_and_dispatch_settles_calls`.
    - `gate_phase_throw_settles_calls`: a throwing `tool.call` handler leaves every call of the round answered.
    - `serial_round_stops_after_abort`: a limit breach on call 1 means calls 2 and 3 do not run and are answered `tool_call_not_dispatched`.
    - `dispose_results_are_appended`.
    - `custom_loop_that_drops_tool_calls_is_settled_at_run_end`.
    - `approval_pending_call_is_not_settled`: a staged ask keeps no result until `resume`.
    - `settlement_emits_one_blocked_tool_completed_per_call`.
    - `legacy_unanswered_calls_are_repaired_in_provider_view`: a branch fixture in the probe's shape; the next request carries a result after each call, and `store.list` is unchanged.
    - `repair_is_deterministic_and_prefix_stable`: two rebuilds give identical bytes; `prefix-stability-conformance` passes.
    - `resume_does_not_repair_calls_a_suspension_owns`.
    - `fresh_run_repairs_calls_of_a_pending_suspension`: `session.run()` on a suspended session sends a result after each pending call, and a later `session.resume` is stale.
    - `provider_hosted_calls_are_untouched`.
    - `loop_conformance_settlement`: the conformance case fails a loop that swallows a round error without settling.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new error code, a new kernel package event, and a transcript guarantee
    - Docs pages to create/edit:
      - `docs/tools.md`: "A call always has a result" with both codes
      - `docs/events.md`: `history.repaired`
      - `docs/loop.md`: what `executeTools` guarantees on a throw
      - `CHANGELOG.md`: `## [Unreleased]`, Fixed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-14):
    - **What changed.**
      - `src/loop/dispatch.ts`: both paths settle on every exit. A shared `settleUnanswered` answers calls `from..` of a stopped round, in call order, and never throws (a failing store leaves the read-time repair to cover it). The call whose dispatch threw keeps the thrown error's name, message and code; every later call, and any call stopped before it started, gets `tool_call_not_dispatched`; a run-control error (`ERR_PRISM_AGENT_RUN_SUSPENDED`, `ERR_PRISM_DELEGATION_SUSPENDED`, `ERR_PRISM_LOOP_*`) leaves its own call alone. The round charge failing settles every call. The serial path checks the signal before each call. New optional `ToolDispatchContext.settled(result)` lets the caller emit the event; `isRunControlError`, `syntheticFailureResult` and `appendToolResultMessage` are exported inside the kernel.
      - `src/loop/run-controller.ts`: `executeTools` wraps the gate phase (`tool.call`, `ask`) so a throw settles every call unless it is a suspension; the dispose early return now appends its `agent_disposed` results; `emitSettled` emits one `tool.completed { status: "blocked", reason: <error code> }` per synthetic result. The controller tracks the dispatchable calls of its last `turn()` in `outstanding`; `executeTools` clears its round on every exit (the dispatch seam answered them, or a suspension owns them), so what remains is a call no `executeTools` ever saw. It is answered at the next `turn()`, at the tool-round ceiling stop, and at the run's end. `settleOutstandingToolCalls(controller)` (a WeakMap-backed kernel-internal, exported from `src/loop/index.ts`, not from the package root) is called from `runLoopUntilSettled` (`tool-round.ts`) after `loop.run` and on a non-run-control error.
      - `src/agent-session/history-repair.ts` (new): `repairUnansweredToolCalls(messages, skip?)`, a pure backward pass that inserts one `tool_call_interrupted` row per unanswered, non-provider-hosted call after the tool rows already following its assistant message; returns the same array when nothing needs repair.
      - `src/agent-session/session.ts`: `replaceHistory` applies it (the one funnel for run start, `checkout` and mid-run compaction) and `rebuildHistory()` now resolves the repaired ids (the plan said no signature change; the return type went from `void` to `readonly string[]`, internal to `SessionHost`). `callsOwnedBySuspension()` skips `activeDurable.state.pendingCalls[].call.id`, the legacy `pending.call.id`, `nestedRuns[].toolCallId` and `activeGatedRound` ids. A fresh run has no `activeDurable`, so it repairs a pending suspension's calls too. `assemble.ts` emits one `package.event` `history.repaired { count, callIds }` right after the run-start rebuild, after `run.started`.
      - `src/testing/loop-conformance.ts`: new `assertToolRoundSettlement(loop)` (three calls under `maxToolCalls: 1`; throws naming the unanswered ids), exported from `@arnilo/prism/testing`.
    - **Findings that differ from the task text.**
      - Task 4 assumed the `agent_disposed` per-call denial of plan 177 stays reachable on the serial path. With the new signal check it threw instead (`custom_loop_ignoring_abort_is_denied` in `agent-dispose.test.ts` failed). The serial check now skips a dispose abort (`isDisposeAbort`): that call goes to `dispatchOne`, which returns the `agent_disposed` denial, and the seam appends it. Every other abort still throws before the call.
      - A resumed run whose subscriber overflows aborts the run before its approved call starts. `agent-run-state.test.ts` "aborts before claiming and closes an overflowing resume subscriber" asserted the tool still ran once; it now asserts 0 (the call is answered `tool_call_not_dispatched`). This is the serial abort check the task asks for, applied to a resume; the behavior change goes in the changelog.
      - A throwing `tool.call` handler does not reach the gate-phase catch: `decide` fails it closed into a denial, so `gate_phase_throw_settles_calls` throws from `host.ui.request` (the `ask` leg) instead. A `tool.result` transform or `tool.execute` around hook that throws is covered by the dispatch seam (`dispatchOne` rethrows), not by a separate test.
      - `loop_conformance_settlement` fails a loop that leaves a call unanswered by its own appends; a loop that merely drops `turn.toolCalls` cannot fail it, because the kernel backstop answers those (pinned by `custom_loop_that_drops_tool_calls_is_settled_at_run_end`).
    - **Tests.** `src/__tests__/tool-round-settlement.test.ts` (11) and `src/__tests__/history-repair.test.ts` (7), all pass. Mutation checks: disabling the repair fails 3 of the history tests, dropping the suspension skip fails `resume_does_not_repair…`, disabling `settleUnanswered` fails 6 of the settlement tests. I did not run the tests against the pre-task source tree. `repair_is_deterministic_and_prefix_stable` covers determinism and byte-prefix stability on the pure function; I did not run `prefix-stability-conformance`. Affected suites (`loop-dispatch`, `run-controller`, `durable-loops`, `session-resume`, `resume-gate-integrity`, `tool-gate-integrity`, `agents`, `run-limits`, `agent-dispose`, `agent-run-state`, `public-export-contract`, `docs`, `hook-bus`, `session-event-routing`) pass; `bun run typecheck` and `biome lint .` are clean.
    - **Baseline diff (attributed to this task).** `scripts/compat-baseline/arnilo__prism.txt`: `+ ./testing assertToolRoundSettlement function assertToolRoundSettlement(strategy: LoopStrategy): Promise<void>`. `FROZEN_TESTING_EXPORTS` in `public-export-contract.test.ts` gained the name. `gate --update-baseline` also rewrote `arnilo__prism-memory-system.txt` from the memory track's uncommitted edits; I reverted that file, so the memory track regenerates its own.
    - **Left for Task 6.** `scripts/budget-gate.test.mjs` fails on kernel size (`packedBytes` +5,543, `unpackedBytes` +17,643, `fileCount` +1, `rootExports` +8, `sourceLines` +281 against `budgets.json`). That is the cumulative growth of Tasks 3–4 and the memory/other uncommitted work, not attributable to Task 4 alone; Task 6 records the byte delta and rebaselines with a reason.
    - **Whole-suite state (`bun run test`, 2026-11-14).** Fixed by this task: `agent-dispose` and `agent-run-state` (above), `testing_surface_is_frozen`, `lint clean`, `host_builder_index_is_fresh` (I ran `bun scripts/host-builder-index.mjs`; the regenerated `packages/hosts/host-builder/data/{api,errors}.json` also carry the memory track's uncommitted `MemoryObservation`/`runMemoryWorkerLoop` changes, which any regeneration would). Still failing, none from this task: the kernel size and export-count budgets (Task 6 rebaselines), the non-null-assertion budget and `observational_names_absent_repo_wide` (memory package edits), `every annotated suite file exists on disk` (`reflection-replacement.test.ts` is annotated but absent, memory track), and the generated-evidence checks (`package-truth`, `phase54`, `packed-install`, `host_builder_eval_criteria_preregistered`), which Task 6 regenerates with `node scripts/package-truth.mjs --emit-docs`.
    - **Docs.** `docs/tools.md` ("A call always has a result"), `docs/loop.md` (`executeTools` guarantee, `assertToolRoundSettlement`), `docs/events.md` (`history.repaired`), `CHANGELOG.md` `## [Unreleased]` Fixed.

- [x] Task 5: Package model calls run on the hook plane and are charged to the run
  - Acceptance Criteria:
    - Functional:
      - `ModelClient.generate(request, options?)` accepts `{ session?: SessionContext }`. Every call:
        - sets `request.origin = { kind: "package", package: <owner> }` (kernel-set; a caller's value is overwritten)
        - runs `model.request` then `model.call`, on the session's bound bus when a session is passed, else on the unbound bus
        - does **not** run `context.build`
        - emits one kernel `package.event` named `model.call` when it settles: package, provider, model, usage, latency, outcome
      - With a session that has an active run, the call's final usage is recorded on that run: `RunLimitTracker.recordUsage`, the run usage accumulator, and one ledger `UsageRecord` with scope `package_call`. A breach aborts the run with the usual `run.failed { limit }`. Cost is priced through `AgentConfig.costCatalog` exactly as a turn's is.
      - With no session, or a session with no active run, nothing is charged to a run; hooks and the event still fire.
      - A `model.call` handler reaches another model through `context.call(request)`, present only on `model.call` dispatches: the terminal for any model, unhooked and unmetered, callable more than once. The enclosing call accounts for it. `model-router` uses it instead of `models.client` (`packages/extensions/model-router/src/around.ts:239`), so routing never re-enters `model.call`.
      - `model-router` applies budgets, rate limits and circuit state to package calls and does not reselect their model: for `origin.kind === "package"` its only candidate is `request.model`, with no fallbacks. `governance`'s `hooks.modelRequest` gate sees them, and a sessionless call is pinned by a test to deny or label as `sessionIdentity(undefined)` defines, never to allow silently. `context-engineering`'s accounting handler skips them. `observability` needs no new transform: package calls on a bound bus carry the run id, so trace headers join the run's span, and the kernel `model.call` package event is the per-call record (Task 1(e)).
      - `HookBus.around` takes the optional `identity` argument that `transform` has, and both run turns and package calls pass it, so `context.sessionId` and `context.runId` are set in `model.call` handlers (today they are `""`). This also makes the router's verified-identity lookup work for run turns; the changelog lists it as a behavior change.
      - Callers that have a session pass it, in this task: `compaction` (when its `CompactionContext` has one), `advisor`, `context-engineering` fold, `web` prompt fetch (per call), `wiki` consolidation, both `delegate` call sites (the bridge only when the delegation has a session), `examples/side-call.ts`. A `delegate` child's provider bridge passes the parent's session, so a synchronous child's turns are charged to the parent's run.
      - A throwing `model.request` or `model.call` handler fails the package call closed with `HookError`, naming the package and hook.
      - `embeddings` and `decisions` are unchanged; the task note records them as outside this fix.
    - Performance: A package call with no handler registered on either hook adds no await beyond today's path. Metering is O(1) per call.
    - Code Quality: One code path for "a model call" shared by run turns and package calls where the steps are the same (transform, around, usage record). No ambient state: the run is found from the `SessionContext` the caller passes, never from async context.
    - Security: The agent redactor is applied to the request after `model.request`, as for a run turn, so a transform cannot un-redact. `request.origin` cannot be forged by a package. The kernel event carries no message content.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4, §2.4, §2.6; `docs/packages.md` (`models.client`), `docs/hooks.md` (`model.request`, `model.call`), `docs/models.md`
      - `src/packages/loader.ts:700-746`, `:858-876`; `src/packages/api.ts:69-83`
      - `src/loop/request-draft.ts` (`applyRequestTransforms`), `src/agent-session/session/provider-round.ts:124`
      - `src/hooks/types.ts` (`HookContext`), `src/session-context.ts`
      - `packages/extensions/model-router/src/around.ts:226-240`
    - Options Considered:
      - Find the active run through `AsyncLocalStorage` — rejected: background tasks would inherit a finished run, and the kernel has no ambient state today.
      - A `raw: true` flag or a new capability for the router's onward call — rejected: it recreates the bypass for any package that sets it.
      - Fire `context.build` too — rejected: memory and fold handlers would rewrite a summarizer's request.
      - Charge `maxTurns` and `maxProviderAttempts` — rejected: those axes count the loop's turns; tokens and cost are the budget a package call spends.
    - Chosen Approach:
      - An optional, explicit `session` on the call; hooks always; a `model.call`-only terminal on the hook context for onward calls. The 0.13.0 call shape keeps working, and gains hook visibility.
    - API Notes and Examples:
      ```ts
      export interface ModelCallOptions { readonly session?: SessionContext }
      interface ModelClient {
        generate(request: Omit<ProviderRequest, "model">, options?: ModelCallOptions): AsyncIterable<ProviderEvent>;
      }
      interface ProviderRequest { readonly origin?: { readonly kind: "package"; readonly package: string } }
      // model.call dispatches only
      interface HookContext { readonly call?: (request: ProviderRequest) => AsyncIterable<ProviderEvent> }
      // a tool that makes a side call
      for await (const event of client.generate({ messages }, { session: context.session })) { /* … */ }
      ```
    - Files to Create/Edit:
      - `src/packages/api.ts`, `src/contracts-core/provider.ts`, `src/hooks/types.ts`, `src/contracts-protocol.ts` (`UsageScope`): the types above
      - `src/packages/loader.ts`: `generateWithRetry` runs the transforms and the around hook, meters, and emits the event
      - `src/agent-session/session.ts`, `session/assemble.ts`, `session/provider-round.ts`, `session/persist.ts`: a kernel-internal symbol-keyed seam on the session view (`sessionContextFor`, `session.ts:285`) exposing the bound bus, `emit`, and `recordUsage(model, usage)` that exists only while a run is active (`activeAddUsage`, set in `executeRun`, cleared with `activeLimits`). The price → limit → accumulate → ledger steps are factored out of `recordProviderUsage` and parameterized by model and scope. `context.call` supplied to `model.call`. A call with no session emits its event through `emitAgentEvent`, as `package.status` does (`loader.ts:430`).
      - `src/hooks/bus.ts`: the `model.call` context field
      - `packages/extensions/{compaction,advisor,context-engineering,delegate,model-router,governance}/src/…`: pass the session; router terminal and package-origin candidate; the context-engineering accounting skip; handler adjustments from Task 1(e). `observability` source is unchanged (README only).
      - `packages/tools/web/src/{index,prompt-fetch}.ts`: pass the session to the prompt fetch per call
      - `packages/knowledge/wiki/src/{extension,consolidate/pass}.ts`: pass the session to the consolidation client when the pass has one
      - `src/hooks/bus.ts`, `src/hooks/types.ts`: `around(name, payload, terminal, identity?)`
      - `examples/side-call.ts`, `packages/hosts/host-builder/data/examples/side-call.ts` (regenerated by `bun scripts/host-builder-index.mjs`)
      - `src/__tests__/package-model-calls.test.ts`: new; `src/__tests__/public-export-contract.test.ts`: `ModelCallOptions`
      - `scripts/compat-baseline/*.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`; the diff, attributed to this plan, goes in the task note (additive: `ModelCallOptions`, `ProviderRequest.origin`, `HookContext.call`, `UsageScope` member)
    - References:
      - Evaluation probe `p8-sidecall`
  - Test Cases to Write:
    - `package_call_fires_model_request_and_model_call`: one package call, each hook fires once with `origin.package` set. Fails on the direct provider call.
    - `package_call_does_not_fire_context_build`.
    - `package_call_is_charged_to_the_active_run`: the probe's shape; the run fails with `limit: "maxTotalTokens"` and `RunResult.usage` includes the side calls.
    - `package_call_without_session_charges_no_run_and_still_emits`.
    - `package_call_usage_is_in_the_ledger`: one `UsageRecord` with scope `package_call`.
    - `router_onward_call_does_not_reenter_model_call`: a cross-provider route fires `model.call` once.
    - `router_budget_counts_package_calls_and_keeps_their_model`.
    - `origin_cannot_be_forged`: a caller-supplied `origin` is replaced.
    - `throwing_model_request_fails_the_package_call_closed`.
    - `delegate_sync_child_turns_are_charged_to_the_parent_run`.
    - `package_call_event_carries_no_content_or_secret`.
    - `package_call_with_no_session_reaches_agent_subscribers`: the kernel `model.call` event is delivered through `agent.subscribe()` when no session is passed.
    - `model_call_handlers_see_session_and_run_ids`: a run turn's and a package call's `model.call` context carry `sessionId` and `runId`.
    - `governance_model_request_gate_sees_sessionless_package_call`.
    - `context_engineering_accounting_skips_package_calls`.
    - `usage_scope_package_call_is_additive`: a host summing `provider_turn` rows is unchanged by `package_call` rows.
    - `examples_demos_run_to_completion_and_emit_no_secret` still passes with `examples/side-call.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `ModelClient.generate`, `ProviderRequest.origin`, `model.call` context, a usage scope, a kernel event, and which hooks fire
    - Docs pages to create/edit:
      - `docs/packages.md`: `models.client` — hooks, metering, the `session` option, cost of a package call
      - `docs/hooks.md`: `model.request` / `model.call` rows — "also fired for package calls", `origin`, `context.call`
      - `docs/events.md`: the kernel `model.call` package event
      - `packages/extensions/model-router/README.md`, `observability/README.md`, `governance/README.md`, `delegate/README.md`, `compaction/README.md`, `context-engineering/README.md`: what each does with package calls
      - `CHANGELOG.md`: `## [Unreleased]`, Changed (behavior) and Fixed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-14):
    - **What changed.**
      - Types: `ModelCallOptions { session? }` and `ModelClient.generate(request, options?)` (`src/packages/api.ts`, exported from `src/index.ts` and `src/packages/index.ts`); `ProviderRequest.origin` (`src/contracts-core/provider.ts`); `HookContext.call` (`src/hooks/types.ts`); `UsageScope` gained `"package_call"` (`src/contracts-protocol.ts`).
      - `HookBus.around(name, payload, terminal, identity?, call?)` (`src/hooks/bus.ts`, `types.ts`): it takes the identity `transform` has, and a fifth `call` that becomes `context.call` on that dispatch only. The run turn (`provider-round.ts`) now passes `{ sessionId, runId }` and `call` (the agent's `resolveProvider(request.model).generate`), so `context.sessionId`/`context.runId` are set in every `model.call` handler.
      - Seam: new `src/package-call-seam.ts` (`PACKAGE_CALL_SEAM`, `PackageCallSeam`, not exported from any barrel). `sessionContextFor` (`session.ts`) defines it, non-enumerable, as getters over the session: the bound bus (follows a reload), `emit`, `redactRequest`, the active `runId`, and `recordUsage`. `recordUsage` is `session.activePackageUsage`, set in `executeRun` right after `assembleRoundContext` and cleared with `activeLimits` in `persist.ts`, so it exists only while a run is active. A hand-built `SessionContext` has no seam and is treated as no session.
      - Metering: `recordProviderUsage` is now a thin wrapper over a shared `meterUsage` (price → `limits.recordUsage` → run usage → ledger, `provider_turn` or `package_call`); `recordPackageCallUsage` prices with the call's own model and estimates usage when the provider reported none, like a turn. The input meter is set only for `provider_turn`.
      - `src/packages/loader.ts`: `generateWithRetry` is replaced by `generatePackageCall(owner, model, request, options)`. Order: stamp `origin` (stamped again after `model.request`, so neither the caller nor a transform can forge it) → `model.request` transform → agent redactor, then the run's (`seam.redactRequest`) → `model.call` around inside the existing retry loop, with `HookError` passed through the retry untouched → stream. Settlement runs once per call, at `done`, at stream end, or in `finally` when the caller abandons the stream: it emits the kernel `package.event` `model.call` (session's `emit`, else `bus.observe` plus `emitAgentEvent`, redacted with the agent's redactor) and then charges the run. A `RunLimitError` from the charge is rethrown to the caller; any other failure after the first event becomes an `error` event as before. No handler on either hook means no hook dispatch.
      - Packages: `model-router` uses `[request.model]` as the only candidate for package origin (no fallbacks) and `context.call` for its onward call; `context-engineering` accounting returns early for package origin; session passed in `compaction` (strategy), `advisor` (consult, both triggers, tool, validator), `context-engineering` fold (`ModelSummarizeOptions.session`), `web` prompt fetch (`PromptFetch.answer(..., { session })`, both call sites, per call), `wiki` (`WikiPassInput.session`, set by the curator, forwarded by `observing`), `delegate` (summary, and the child's provider bridge via a new `buildAgent(..., session)` parameter), `examples/side-call.ts` (and its host-builder copy, regenerated).
    - **Findings that differ from the task text.**
      - A tool a host adds through `AgentConfig.tools` gets no `context.session`: `toolSession` (`tool-round.ts:376`) returns `{}` when no package owns the tool. Only package tools can pass a session today. My first test registered a host tool and charged nothing; the tests now register the tool from a package. Not changed here; Task 1(d) read this as "the tool's `context.session`", which holds for package tools only.
      - The plan said `context.call` is present on `model.call` dispatches only; it is also supplied to run turns (not only package calls), which `model-router` needs for its cross-provider route.
      - `model-router` still declares the `models` capability although it no longer calls `models.client`. I left it: dropping it changes the package's declared capabilities and `package-truth` evidence, which Task 6 regenerates. A follow-up can narrow it.
      - The unmetered `usage` of a package call whose provider reports none is estimated (the turn's rule), so a `maxCost` run fails closed on it as a turn would.
      - `session_manual_compact_with_llm_strategy_appends_compaction_entry` (`compaction/src/__tests__/runtime.test.ts`) took the first two session events after `compact()`; the summary call now adds its `model.call` `package.event` between `compaction.started` and `compaction.completed`, so it takes three. This is the visible form of "a package call reports on the session's stream".
      - `embeddings` and `decisions` are unchanged and unmetered, as planned.
    - **Tests.** `src/__tests__/package-model-calls.test.ts` (14): the plan's `package_call_fires_model_request_and_model_call`, `…does_not_fire_context_build`, `…is_charged_to_the_active_run` (the probe's shape: three 4,000-token calls under a 5,000 cap → `run.failed` `maxTotalTokens`), `…without_session_charges_no_run_and_still_emits`, `…with_no_session_reaches_agent_subscribers`, `origin_cannot_be_forged` (plus a transform variant), `throwing_model_request_fails_the_package_call_closed` (plus a `model.call` variant), `model_call_handlers_see_session_and_run_ids`, `package_call_event_carries_no_content_or_secret`; added `…usage_is_in_the_run_result_and_the_ledger` (which also pins `usage_scope_package_call_is_additive`: `provider_turn` rows still sum to the run turns only), `model_call_context_call_reaches_any_model_without_reentering_hooks`, `package_call_to_another_model_is_priced_with_its_own_model`. Package tests: `model-router` `router_onward_call_does_not_reenter_model_call` and `router_budget_counts_package_calls_and_keeps_their_model`; `governance` `governance_model_request_gate_sees_sessionless_package_call` (deny-by-default refuses it, allow lets it through); `context-engineering` `context_engineering_accounting_skips_package_calls`; `delegate` `delegate_sync_child_turns_are_charged_to_the_parent_run`. Mutation checks: reverting the router's `context.call` and package-origin candidate fails both router tests; removing the accounting skip fails its test; removing the bridge session fails the delegate test (usage 4 instead of 6). The kernel tests were written after the implementation, not before; I did not run them against the pre-task tree. `examples_demos_run_to_completion_and_emit_no_secret` is part of `docs.test.ts` and passes.
    - **Checks.** `bun run typecheck` and `biome lint .` clean; I ran `biome format --write` only on the 34 files I touched (all were format-clean at `HEAD`). Affected suites pass: `docs`, `public-export-contract`, `hook-bus`, `models-client-resolve`, `session-event-routing`, `tool-round-settlement`, and each touched package's suite (`model-router`, `governance`, `delegate`, `context-engineering`, `compaction`, `advisor`, `web`, `wiki`).
    - **Baseline diff (attributed to this task).** `arnilo__prism.txt`: `HookContext` gained `call?`; `+ ModelCallOptions`; `ModelClient.generate` gained `options?: ModelCallOptions`; `ProviderRequest` gained `origin?`; `UsageScope` gained `"package_call"` (all additive). `arnilo__prism-extensions.txt`: `context-engineering` `ModelSummarizeOptions.client.generate` gained `options?` and the interface gained `session?`. `arnilo__prism-tools.txt`: `web` `PromptFetch.answer` gained `session?`. `arnilo__prism-memory-system.txt` also changed on regeneration; those lines are the memory track's own uncommitted edits (the file was already modified before this task), not this task's. `FROZEN` export lists: `ModelCallOptions` added to `public-export-contract.test.ts`.
    - **Left for Task 6.** `bun run test` (2026-11-14) still fails only on what Task 4 recorded plus nothing new from this task: kernel size and export budgets (this task adds to the cumulative overage: `packedBytes` +10,919, `unpackedBytes` +33,943, `fileCount` +2, `rootExports` +12, `sourceLines` +497 against `budgets.json`, shared with Tasks 3–4 and the uncommitted memory work), the memory track (`observational_names_absent_repo_wide`, the non-null assertion budget, the missing `reflection-replacement.test.ts` annotated suite), and the generated-evidence checks Task 6 regenerates (`package-truth`, `phase54`, `packed-install`, `host_builder_eval_criteria_preregistered`). `tools_browser_*` and `shell_output_drains_every_accumulated_chunk` fail only under whole-suite load and pass on their own.
    - **Docs.** `docs/packages.md` (`models.client`), `docs/hooks.md` (`model.request`, `model.call`), `docs/events.md` (kernel `model.call`); READMEs of `model-router`, `observability`, `governance`, `delegate`, `compaction`, `context-engineering`; `CHANGELOG.md` `## [Unreleased]` (one Fixed / Changed entry with the behavior changes). Not covered by a test: that `observability`'s trace headers join the run's span for a package call; the README says it because the run id is now on the context, and the plan specified no test.

- [ ] Task 6: Release 0.14.0 (owner-gated)
  - Acceptance Criteria:
    - Functional:
      - **Amended 2026-11-14 (owner): no 0.14.0.** Every package this plan changed takes a patch bump from its published version (0.13.1 → 0.13.2, 0.13.0 → 0.13.1); the `0.14.0` and `[0.14.0]` wording below is superseded. `@arnilo/prism` and `@arnilo/prism-hosts` go 0.13.0 → 0.13.1 (the hosts bundle stays on the kernel's line). `@arnilo/prism-extensions` and `@arnilo/prism-tools` go 0.13.1 → 0.13.2 (the registry already holds 0.13.1 from `release/0.13.1`). An unchanged bundle (`@arnilo/prism-ai`) is not republished. Experimental bundles move by `prerelease` only: `@arnilo/prism-knowledge` and `@arnilo/prism-memory-system` go to `0.13.0-experimental.1`.
      - `CHANGELOG.md` has a `## [0.14.0]` section assembled from `## [Unreleased]`, with the security note from Task 3 and the behavior change from Task 5 (package calls now fire hooks and count against limits).
      - `docs/migration.md` gains a 0.13 → 0.14 note: nothing to change for hosts; what a package author gains by passing `session`.
      - `bun run sdk:ready` is green on the release commit. The tag push, and with it the publish, happens only after the owner confirms.
      - Post-publish: `bun run post-publish:smoke` passes against the registry.
    - Performance: `bun scripts/release.mjs gate` kernel size budget passes; the task note records the kernel byte delta of Tasks 3–5.
    - Code Quality: No version literal outside `package.json` files (`scripts/version-literal-gate.test.mjs`).
    - Security: Publish uses the existing OIDC trusted-publishing workflow; no token is added.
  - Approach:
    - Documentation Reviewed:
      - `docs/release.md` ("The pipeline", "What the gate runs", "The compat gate")
      - `.claude/skills/prism-execution/references/release.md`
      - `scripts/independent-packages.json`, `scripts/bundles.json`
    - Options Considered:
      - 0.13.1 — rejected: the owner asked for a minor release, and Task 5 changes behavior (hooks fire, limits apply) and adds API.
      - Lockstep every bundle to 0.14.0 — rejected: plan 224 Task 10 put the stable bundles on their own lines.
    - Chosen Approach:
      - Follow `docs/release.md` unchanged: `changed`, `bump`, `check`, the gate, then the owner's tag.
    - API Notes and Examples:
      ```bash
      bun scripts/release.mjs changed
      bun scripts/release.mjs bump   # per docs/release.md for each line
      bun run sdk:ready
      bun scripts/release.mjs check
      ```
    - Files to Create/Edit:
      - `package.json`, `packages/*/package.json`: versions, by the release script
      - `CHANGELOG.md`, `docs/migration.md`
      - generated truth: `node scripts/package-truth.mjs --emit-docs`, `bun scripts/host-builder-index.mjs`
    - References:
      - Plan 224 Task 10 (the 0.13.0 publish and the switch to per-bundle lines)
  - Test Cases to Write:
    - none new; `src/__tests__/release.test.ts`, `packaging.test.ts`, `scripts/release-gate.test.mjs`, `scripts/truth-current.test.mjs` pass on the release commit
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a release
    - Docs pages to create/edit:
      - `CHANGELOG.md`: `## [0.14.0]`
      - `docs/migration.md`: the 0.14 note
      - `README.md`: the generated package table
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - **Notes (executed 2026-11-14, partial: everything except the tag push, publish and the green `sdk:ready`).**
    - **Decision recorded.** The owner asked for patch bumps instead of 0.14.0. Registry check (`npm view`): `@arnilo/prism` 0.13.0, `-extensions` 0.13.1, `-tools` 0.13.1, `-hosts` 0.13.0, `-ai` 0.13.0, `-knowledge` and `-memory-system` 0.13.0-experimental.0.
    - **Found: `main` lacked the published 0.13.1.** `release/0.13.1` (advisor independent validation, `agentNode` worktree reuse, workspace session binding; manifests at 0.13.1) was never merged, so `main` still said 0.13.0 and a 0.13.2 built from it would have dropped those changes. With the owner's go-ahead I merged it (`f2356dca`; conflicts in `CHANGELOG.md` and the generated host-builder data, resolved by keeping both and regenerating). My uncommitted work went in through a stash; the one real conflict was `advisor/src/validate.ts`, where I re-applied the `session` pass-through on the new `judge`/`validateWithModel` shape. A backup of the tree is in the session scratchpad (`backup/tracked.patch`, `untracked.tgz`).
    - **Bumps (`release.mjs bump`).** `@arnilo/prism` 0.13.0 → 0.13.1 (also `src/version.ts`, and by hand `src/index.ts` `version`); `-hosts` 0.13.0 → 0.13.1; `-extensions` 0.13.1 → 0.13.2; `-tools` 0.13.1 → 0.13.2; `-knowledge` 0.13.0-experimental.0 → .1; `-memory-system` 0.13.0-experimental.0 → .1 (repins knowledge). Why memory-system moved: its plan-225 relevance is nil, but `knowledge`'s own test requires its exact pin to equal its version (`package_metadata_ships_one_entry_and_no_bin_or_skills`), the release gate flagged it as changed since `v0.13.0`, and the version bump publishes nothing. Its content is the memory track's uncommitted work, not this plan's. The peer window stays `>=0.13.0 <1.0.0` as the plan said; `model-router` throws a clear error (`the hook context carries no onward call`) against a 0.13.0 kernel, and the bundle changelogs say 0.13.1 is required.
    - **Docs and generated files.** `CHANGELOG.md`: new `## [0.13.1] - 2026-11-14` (versions note, Task 3 security entry, Tasks 4–5 entries, `models.client` resolve, the 0.13.1 extensions/tools entry); memory-system and older entries stay in `[Unreleased]`. `packages/extensions/CHANGELOG.md` and `packages/tools/CHANGELOG.md`: `## [0.13.2]`. `docs/migration.md`: `## 0.13.0 → 0.13.1` (nothing to change for hosts; what a package author gains by passing `session`). `docs/index.md` current-line banner. Regenerated with `node scripts/package-truth.mjs --emit-docs` (README, `docs/index.md`, `docs/release.md`, phase54 map, `package-truth.json`), `bun scripts/host-builder-index.mjs`, `bun scripts/release.mjs gate --update-baseline`. `host-builder-evals/criteria.lock.json`: `indexes` hash only, as `016af339` did.
    - **Gate fixes found on the way.** `scripts/version-literal-gate.test.mjs` assumed a subpath of an independent bundle (`@arnilo/prism-ai/hyper`) carries the kernel's version, so the first kernel bump past the independent lines failed it; it now resolves the bundle's own version, and the positive control's `>= 10` stale-surface count (which those 11 false positives were satisfying) is `>= 7`, one per named surface. `scripts/post-publish-smoke.test.mjs` hardcoded `@0.13.0`; it reads the kernel manifest. Three tests I added in Task 5 used `!` and tripped the non-null budget; they use `assert.ok` now.
    - **Kernel byte delta (Tasks 3–5), rebaselined in `scripts/budgets.json` with a reason.** `packedBytes` 1262228 → 1274415 (+12,187), `unpackedBytes` 4093533 → 4131100 (+37,567), `fileCount` 367 → 369 (+2), `rootExports` 1530 → 1542 (+12), `sourceLines` 41171 → 41669 (+498); export-count baseline `@arnilo/prism` 1530 → 1542. No dependency added.
    - **State.** `bun scripts/release.mjs gate` exits 0. Typecheck, lint, and the named release suites (`release`, `packaging`, `release-gate`, `truth-current`, `version-literal-gate`, `docs`, `public-export-contract`, `host-builder-index`, `host-builder-evals`, `post-publish-smoke`, the wiki package test) pass.
    - **Not done, and why.** (1) `bun run sdk:ready` is not green: `bun run test` still fails the memory track's items (`observational_names_absent_repo_wide`; the missing `reflection-replacement.test.ts` annotated suite; the non-null budget and the `@arnilo/prism-memory-system` export-count budget (+70) for `packages/memory/system`; `scripts/memory-bench/feature-ledger.mjs` format) and the packed-install host-completeness journey (`the observer recorded an observation`), which fails identically on committed `HEAD` in a clean worktree, so it predates this work. (2) `release.mjs check` and a tag need a clean tree, and the tree carries the memory track's uncommitted edits, which are not this plan's to commit. (3) The tag push, publish and `post-publish:smoke` stay owner-gated. `arnilo__prism-memory-system.txt` was regenerated and carries the memory track's own lines.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/session-event-routing.test.ts src/__tests__/tool-round-settlement.test.ts src/__tests__/history-repair.test.ts src/__tests__/package-model-calls.test.ts`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-tools test`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`
- `bun run sdk:ready` (Task 6)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
