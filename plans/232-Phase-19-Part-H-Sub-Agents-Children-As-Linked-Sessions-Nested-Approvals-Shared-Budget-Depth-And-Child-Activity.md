# Phase 19 Part H — sub-agents: children as linked sessions, nested approvals, shared budget, depth, and child activity

## Objectives

- Stop building and tearing down a whole agent per delegation. `createDelegateRuntime` calls `createAgent` for every delegation with the inherited package instances (`packages/extensions/delegate/src/runtime.ts:275-312`) and disposes it afterwards (`:423`), so each child re-runs every inherited package's `setup` (MCP connections, stores, language servers).
- Keep a child's transcript. The child agent's store is `createMemorySessionStore()` (`runtime.ts:302`); the transcript is discarded when the delegation ends and cannot be inspected or resumed.
- Make an approval inside a child answerable. A child that needs approval with no UI returns `suspended` and is then disposed, and the kernel refuses nested suspensions outright: "this kernel has no nested-run resume hook" (`src/agent-session/session/tool-round.ts:370-375`, `:520-525`). The machinery that once routed them is still shipped, deprecated and unreachable (`applyNestedRun`, `:148`; `suspendNested`, `:279`).
- Bound a child's spend by the parent's budget. A sync child's turns are charged to the parent run only through the provider bridge (`runtime.ts:295-298`, plan 225 Task 5). An async child is not charged, and the child's limits are enforced only inside its own agent (Task 1(e)).
- Allow more than one level, and let a caller wait for a slot instead of failing. `maxDepth` is fixed at 1 (`packages/extensions/delegate/src/config.ts:134`), and a call over `maxConcurrent` throws (`runtime.ts:442`).
- Show what a child is doing. The parent stream carries only `delegate.step` milestones.

## Expected Outcome

- A child is a session on the parent's own agent, linked to the parent session, run with per-run options (model, instructions, tool allow-list, limits). No second agent, no provider bridge, one `setup` per package for the life of the agent.
- The child's transcript is in the agent's store, listed under its parent (`agent.sessions.list({ parentSessionId })`).
- A child that suspends inside a synchronous `delegate` call suspends the parent run with the child's pending decisions, attributed to the child. `session.resume(decisions)` on the parent routes them to the child and continues both.
- A child run's usage is also recorded on the parent's active run, so the parent's token and cost limits bound the tree.
- `maxDepth` up to 3. A call over `maxConcurrent` waits up to `queueTimeoutMs` for a slot.
- With `report: "stream"`, the parent stream carries bounded `delegate.activity` package events for the child's tool calls and text. An async child that finishes while the parent run is ending is announced to the model through a `run.end` continuation.

This plan implements roadmap **Phase 19 Part H**. It adds kernel contracts (`PackageAPI.sessions`, a capability, `RunOptions.chargeTo`, `ToolDefinition.resumeNested`) and reshapes a package, so **Task 1 is the phase review**. It depends on plan 225 (metering, settlement), plan 226 Task 4 (parallel rounds, so synchronous children overlap) and plan 231 (continuation). It reshapes work planned in plan 191; that plan is complete, so nothing is dropped there, and the config fields this plan retires are swept in Task 4. No version bump or publish.

Cost knobs: `report: "stream"` emits one bounded event per child tool call and per text flush (default flush 1 s); the default `on-complete` emits none. A queued delegation holds no model call while it waits. Both are stated in the delegate README.

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **What a child needs that only `createAgent` gives today.** For each `DelegateChildConfig` field (`packages/extensions/delegate/src/config.ts:8-45`): whether `SessionOptions` plus `RunOptions` can express it on the parent agent — `model` (`RunOptions.model`), `instructions` (`RunOptions.systemPrompt`), `tools.only`, `limits`, `skills`, `context` seeding (`buildSeededContext`, `context.ts`), `isolation: "worktree"` (the `workspace` service binds by session id), `inherit`.
      - (b) **What `inherit` isolates.** Which hooks of non-inherited packages would now fire for a child session (approval, governance, memory, context-files, compaction), and for each whether that is wanted. How a package can tell a child session (`SessionLinks`, `SESSION_LINKS_DATA_KEY`).
      - (c) **Package access to sessions.** `PackageAPI` has no member that opens a session or reads the store (`src/packages/api.ts:86-160`); commands receive `agent` (`AgentCommandRunOptions`), tools do not. The written proof that no hook, slot, service, or primitive can open a linked session from a tool.
      - (d) **Nested-run machinery.** Every symbol and its callers: `AgentDelegationSuspendedError` (`src/contracts-run-state.ts:144`), `NestedRunRef` (`:106`), `ResumeNestedRun` (`:134`), `applyNestedRun`, `suspendNested`, `matchNestedSticky`, `handleNestedSignal`, `nestedApprovalId`, `nestedOutcomeToolResult`, `replayDurableNestedAndPending`'s nested branch, and the `nestedRuns` field of `StoredAgentRunState`. Which parts work if a carrier for the resume callback exists.
      - (e) **Usage flow.** How a run records usage (`recordProviderUsage`), and what plan 225 Task 5 added for package calls, so a child run's usage can be mirrored onto a parent run through one entry point.
      - (f) **Other users of in-process children**: `workflows` `agentNode` (separate agents by design), `advisor`, the reference host's orchestrator (`apps/prism-agent/src/host/orchestrator.ts`).
    - Performance: Records the cost of one delegation today (agent build time with the reference host's inherited set) as the baseline.
    - Code Quality: Findings are written against the task they change. If (a) or (b) shows a child cannot be a linked session, stop and re-cut Tasks 2 and 4 around a cached child agent instead.
    - Security: Records the trust change: a child session runs under the parent agent's hooks and principal; a child can no longer be given a narrower package set than the parent, only a narrower tool set.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.6 (`PackageAPI`), §2.11 (delegation example), §2.12.13 (workflows), §2.3 (session links); `docs/packages.md`, `docs/agent.md`
      - Plan 191 (delegation), plan 168 Task 5 (run-state surface retired)
    - Options Considered:
      - Skip — rejected: Task 4's design rests on (a) and (b).
    - Chosen Approach:
      - Inventory, the written proof, then confirm or re-cut.
    - API Notes and Examples:
      ```bash
      graft callers AgentDelegationSuspendedError --depth all
      graft callers createDelegateRuntime --depth all
      ```
    - Files to Create/Edit:
      - `plans/232-…md`: the task note
    - References:
      - Evaluation findings K12, D1–D7
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-17):
    - **Verdict: a child can be a linked session.** Neither (a) nor (b) forces the cached-child-agent re-cut. Three fields need kernel additions, which are now in Task 2: per-run skill selection, seeded entries on open, and the tool→package owner for packages. Plans 225, 226 Task 4 and 231 are complete.
    - **Line drift.** `RunOptions` is in `src/contracts-protocol.ts:73-120`, not `src/models/ref.ts`. In `tool-round.ts`: `applyNestedRun` is at `:148-201` (not `:131`), `suspendNested` at `:279-324` (not `:262`), `handleNestedSignal` at `:370-375`, the nested branch of `replayDurableNestedAndPending` at `:493-563`, and `runLoopUntilSettled` at `:598-614`. Tasks 2 and 3 cite the corrected spans.
    - **(a) `DelegateChildConfig` → `SessionOptions` + `RunOptions` on the parent agent** (`packages/extensions/delegate/src/config.ts:9-38`; `buildAgent` `runtime.ts:275-316`):
      - `model`: yes, through `RunOptions.model` (`contracts-protocol.ts:75`). The run appends a `model_change` entry when the model differs from the agent's (`assemble.ts:357-368`), which is harmless in a child transcript. The bridge (`runtime.ts:290-301`) goes away.
      - `instructions`: yes, through `RunOptions.systemPrompt: { id: "delegate-child", source: "run", mode: "replace", text: childInstructions(...) }`. `composeSystemPrompt` (`src/system-prompts.ts:18-38`) ranks `run` highest (`:14`), and `replace` drops both the `base` (`AgentConfig.instructions`) and every agent `systemPrompt` layer (`assemble.ts:381-383`). Package `context.build` contributions (context-files, memory) are context, not system prompt, so they still apply. This is the form Task 2's example refers to.
      - `tools.only`: yes, through `RunOptions.tools.only` (`contracts-protocol.ts:110-115`), enforced by `selectRunTools` (`assemble.ts:340-343`) and the dispatch filter (`tool-round.ts:395-405`). Unknown names fail closed, so `resolveToolNames` (`runtime.ts:203-216`) stays.
      - `limits`: yes, through `RunOptions.limits`, which only narrows the agent's limits (`contracts-protocol.ts:76`). `resolveChildLimits` stays as the clamp.
      - `skills`: **no.** A run's skills are `resolveAllActiveSkills(agentSkillSource(agent), tools)` (`session.ts:990-992`, `assemble.ts:345`). They are filtered only by `requiresTools` against the run's tools, and there is no run option to name a subset or choose `"none"`. Added to Task 2: `RunOptions.skills?: false | { only: readonly string[] }`, intersected with the agent's skills, with unknown names failing closed.
      - `context` seeding: **not directly.** `buildSeededContext` (`context.ts:111-141`) builds `summary` and `message` entries under a fresh id and opens them through a memory store (`runtime.ts:306`, `:373`). On a shared store, `agent.session({ id, create: true })` opens an empty session (`create-agent.ts:224-227`), and `AgentInput` (`src/input.ts:30`) cannot carry a `summary` entry. Added to Task 2: `sessions.open({ ..., seed })`. It accepts only `message` and `summary` entries; the kernel stamps the id, chain and scope and appends them after the links entry.
      - `isolation: "worktree"`: yes. Coding tools route by `context.sessionId` through `workspace.worktree.bound(sessionId)` (`packages/tools/coding/src/targets.ts:96`, `workspace/routing.ts:50`), so a worktree bound to the child session id redirects the child's tools on the shared agent. The probe package (`isolation.ts:44-53`) is replaced by `prism.services.consume("workspace")` at call time, which resolves late (`api.ts` `services.consume`).
      - `inherit`: **only via a new read.** `PackageAPI.tools.list()` returns bare `ToolDefinition`s (`api.ts` `tools.list`). The owner exists only in `toolInfos` (`src/agent/views.ts:16-25`, `ToolInfo.package` `contracts-core/agent.ts:174`), which packages cannot reach. Added to Task 2: `PackageAPI.tools.list()` entries carry `package` (the owner), or a sibling `tools.owners()`. An `inherit: []` child must run with `tools: { only: [] }`, never `undefined`, because `undefined` means every tool (`contracts-protocol.ts:107-109`).
      - Also: `principal` → `RunOptions.principal`. `hostUi` labelling (`runtime.ts:111-122`) is no longer needed, because the kernel stamps `sessionId` on host requests. `interactive` is not passed today. On a shared agent the child's approval asks reach the host's `HostUi` directly unless the run sets `interactive: false`. Task 4 must decide (recommended: inherit the parent run's interactivity, read from the tool context, so a headless parent gives a suspending child).
    - **(b) Hooks of non-inherited packages that now fire for a child session.** Today only the inherited instances run inside the child. On the parent agent, every loaded package's hooks run (hook inventory below from `hooks.on(...)` in each `src/`):
      - approval (`tool.call`): **wanted.** This is what makes Task 3 needed and useful.
      - governance (`run.input` ×3, `model.request`, `tool.call`, `tool.completed`, `decision.resolved`): **wanted.** Policy should bind the whole tree. This was a gap today whenever governance was not inherited.
      - hooks-json (`session.opened`, `run.input`, `tool.call`, `tool.result`): **wanted**, matching Claude Code firing user hooks for subagents. `session.opened` fires once per child.
      - context-files (`context.build` ×2, `run.started`): **wanted.** The child sees `AGENTS.md`. It costs prompt tokens, and a child that should not see them needs the package to skip child sessions.
      - compaction and context-engineering (`compaction.when`, the compaction slot): **wanted.** Child sessions are bounded the same way.
      - memory system (`packages/memory/system`: `session.opened`, `context.build`, `turn.completed`, `message.*`, `compaction.*`, `session.closed`): **unwanted by default.** It would build STM/WM tiers per child session and add recall cost per child. It must skip sessions with a parent link unless configured otherwise. Record for Task 4 (README) and the memory track backlog.
      - advisor (`run.input`, `tool.call`, `run.end` ×2): **unwanted by default.** An advisor per child multiplies model calls. It must skip child sessions.
      - coding (`tool.call` ×2, `session.closed` ×3, the todo `run.end` continuation `packages/tools/coding/src/agent/todo.ts:310-340`): wanted. The child's todos gate the child's own run.
      - observability (`model.request`): wanted. Child turns are traced under their own session id.
      - How a package tells a child session today: only by reading its branch (`SessionContext.entries()`, needs `"session-state"`, one store read per call, `session-context.ts`) and calling `sessionLinksOf` (`src/session-stores.ts:817`). The session holds its links in memory (`session.ts:263`, persisted at `:389` under `SESSION_LINKS_DATA_KEY` `contracts-core/session.ts:134`), but `SessionContext` does not expose them. Added to Task 2: `SessionContext.parentSessionId` next to `depth`, both synchronous. `depth` is persisted in the links entry at open, so a resumed child does not walk the store.
    - **(c) Proof that no package can open a linked session from a tool today.**
      - `PackageAPI` (`src/packages/api.ts:96-209`) has `packages.instances`, `hooks`, `slots`, `tools`, `skills`, `providers`, `commands`, `models`, `credentials`, `state`, `services`, `host`, `events`, `status`, `log` and `onDispose`. None returns a `Session` or the store.
      - `ToolExecutionContext` (`contracts-protocol.ts:583-596`) carries ids, signal, metadata, principal, idempotency key and `session?: SessionContext`. `SessionContext` (`session-context.ts`) exposes `entries()` and `background()` only.
      - `slots` registers an implementation and never reads one back. A `slot:store` owner holds the store but cannot construct a `RuntimeAgentSession`, which only `agent.session` builds (`create-agent.ts:196-234`).
      - `services` passes only what a package itself provides, and the kernel provides none.
      - Only commands receive `agent` (`PackageCommandContext.agent`, `api.ts:45-50`), and `workflows` uses it (`packages/extensions/workflows/src/command.ts:47`). A tool has no path to it. The capability list (`capabilities.ts:8-18`) has no session member.
    - **(d) Nested-run machinery and callers** (`graft grep` on each symbol):
      - `AgentDelegationSuspendedError` (`contracts-run-state.ts:144-156`), exported at `src/index.ts:112`. It propagates as a run-control error:
        - `src/tools.ts:467` rethrows it from `beforeExecute`.
        - `src/tools.ts:514-521` marks the effect unknown or retryable and rethrows.
        - `loop/dispatch.ts:109`, `:138`, `:151-155` write no synthetic result for it.
        - `tool-round.ts:484` attaches `toolCall`.
        - `runLoopUntilSettled` (`:607-611`) and the replay path (`:589-590`) catch it and call `handleNestedSignal`, which throws `ERR_PRISM_DECISION_INVALID`.
        - **Everything up to that handler works.**
      - `NestedRunRef` (`:106-115`), `NestedRunApproval`, `AgentRunRef`, `NestedRunOutcome` and `ResumeNestedRun` (`:134-137`): exported types. `ResumeNestedRun`'s signature (`ref`, `toolCallId`, `path`, decisions → outcome) is the shape `ToolDefinition.resumeNested` should take, plus the tool context.
      - `applyNestedRun` (`tool-round.ts:148-201`, 0 callers, `@deprecated`) attributes decisions with `nestedApprovalId` (`agent-approval.ts:208-210`). It enforces `MAX_ATTRIBUTION_DEPTH` and runs the sticky auto-apply loop via `matchNestedSticky` (`:38-46`). It returns a tool result through `nestedOutcomeToolResult` (`agent-approval.ts:230-238`) or a `NestedRunRef` plus pending decisions. **It works as is with `hook = tool.resumeNested`.**
      - `suspendNested` (`:279-324`, 0 callers, `@deprecated`) persists the nested entry and a placeholder `nr_<runId>` pending call for the tool call, enforcing `HARD_MAX_PENDING_DECISIONS`. **It works as is.**
      - The nested branch of `replayDurableNestedAndPending` (`:493-563`) groups resumed decisions per nested entry and maps them back to `childApprovalId`. It then throws at `:520-525` where the hook call belongs. `resolvedToolCallIds` (`:499`) is never filled. **Bug to fix in Task 3:** once the hook settles a call, its placeholder `nr_` pending call must be dropped. Otherwise the generic replay at `:569-583` finds no decision for `nr_<runId>`, pushes the call to `approved`, and **re-executes the `delegate` tool.**
      - `nestedRuns` on `StoredAgentRunState` (`agent-run-state.ts:44`) is live:
        - `parseAgentRunState` validates it (`:272-282`).
        - `publicState` strips it (`:178`).
        - `suspendDurable` writes it (`persist.ts:100`, `:146`).
        - `persistSucceeded` (`persist.ts:252`) and `executeRun` (`assemble.ts:879`) clear it.
        - `callsOwnedBySuspension` keeps the hosting call out of history repair (`session.ts:1469`).
      - **Gaps for Task 3:**
        1. **Parallel rounds** (plan 226 Task 4): `dispatchToolCallsInOrder` keeps only the first failure (`loop/dispatch.ts:85-117`). A second `delegate` call that suspends in the same round gets a synthetic failure, so its child's suspension is lost. Task 3 must collect every nested suspension of a round into one parent suspension.
        2. `resolveRunDecisions` (`agent-approval.ts:57-110`) validates `modifiedArguments` and elicitation payloads against the parent's registry and state using `target.toolCallId`. For an attributed decision that id is the child's call. Task 3 must forward such payloads to the child unvalidated at the parent and let the child's resume validate them, or refuse them, but never validate them against the parent's tools.
        3. `MAX_ATTRIBUTION_DEPTH` is **8** (`contracts-run-state.ts:187`), not 3. A path of two entries per level (tool call id, child) fits 3 levels in 6 entries. The 3-level cap is the delegate's choice (Task 5), not a kernel cap.
        4. The sticky loop's `depth >= 4` (`tool-round.ts:172`) is an unnamed bound and should become a constant.
    - **(e) Usage flow.**
      - `meterUsage` (`provider-round.ts:120-152`) is the one path. It prices through the cost catalog, then calls `limits.recordUsage` (a breach aborts the run and throws), `runUsage.add`, and one ledger row of `scope`.
      - `recordProviderUsage` (`:155-163`, from `assemble.ts:550`) and `recordPackageCallUsage` (`:170-177`) both use it.
      - Plan 225 Task 5 binds `session.activePackageUsage` per active run (`assemble.ts:809-812`, cleared at `persist.ts:337`). It exposes it on every `SessionContext` view through the symbol-keyed `PACKAGE_CALL_SEAM.recordUsage` (`session.ts:340-355`, `src/package-call-seam.ts`).
      - **`chargeTo` should reuse this seam:**
        - Read the target view's seam and call a scope-taking `recordUsage`. Today scope is fixed to `"package_call"`, so Task 2 adds the scope parameter and `UsageScope` `"child_run"` (`contracts-protocol.ts:806`).
        - Walk up by calling the parent's own `chargeTo` in turn: O(depth).
        - With no active run on the target (an async child outliving the parent run), nothing is charged. Task 2 documents this.
      - **Ledger double count:** the child run also writes its own `provider_turn` rows. Any total that sums all rows across sessions counts child turns twice. Task 2 documents that `child_run` rows mirror `provider_turn` rows of another session and are excluded from cross-session totals, and tests it.
      - **Correction to Objectives:** sync children are already charged to the parent run today, through the bridge's `models.client(...).generate(rest, { session })` (`runtime.ts:295-298`). Async children are not (the parent run has usually ended). The child's own `maxTotalTokens` is enforced only by the child agent.
    - **(f) Other in-process child users.**
      - `workflows` `agentNode` runs host-supplied agents and opens linked sessions from a command (`command.ts:47`). It does not build agents and is unaffected.
      - `advisor` makes `models.client` calls only (`packages/extensions/advisor/src/index.ts:140`, `:170`), already charged through the package-call seam, and builds no agent. It is unaffected, but see (b) for its hooks on child sessions.
      - The reference host's orchestrator (`apps/prism-agent/src/host/orchestrator.ts:24-59`) loads `delegate({ children: { "research-brief": { inherit: [] } } })`. After Task 4 that child's transcript lands in the shared SQLite store, and its doc comment (`:16-20`, "Its store is delegate's memory store") must change. With `inherit: []` it runs with `tools: { only: [] }`. No other host agent loads `delegate` (`coding.ts`, `research.ts`, `external.ts`).
      - `delegate.step` is rendered by `observability` (`instrumentation.ts:518-527`) only. Neither `ag-ui` nor `devtools` renders it, so Task 5 edits `observability`, not those hosts.
    - **Performance baseline** (`bun` on this machine, mock provider, 20 sync delegations after one warm-up; script `bench-delegate.ts` in the session scratchpad). The parent agent loads coding tools, approval (`auto`), context-files, compaction, context-engineering, a `setup` spy and delegate. Each run is two parent turns plus one child run:

      | Child inherits | Median per run with delegation | p90 | Spy `setup` calls |
      | --- | --- | --- | --- |
      | `[]` (provider bridge only) | 4.5 ms | 8.7 ms | 0 |
      | the five-package coding set plus the spy | 7.0 ms | 10.9 ms | 21 over 21 delegations |

      So `setup` re-runs once per delegation. About 2.5 ms per delegation is the agent build for a set with no I/O in `setup`. Hosts whose inherited packages open MCP connections, language servers or stores pay their full setup cost each time. Task 4 compares against these numbers.
    - **Trust change (Security).**
      - A child session runs under the parent agent's hooks, slots, store, ledger, ownership scope and principal.
      - Every loaded package's gates (approval, governance, hooks-json) now apply to children. That is stricter than today, where an uninherited governance package does not bind the child.
      - Every observer (memory, advisor, observability) also sees child sessions unless it skips them.
      - A child can no longer get a narrower **package** set than the parent, only a narrower **tool** and **skill** set (`RunOptions.tools.only`, the new `RunOptions.skills`).
      - The `ownership` config key becomes redundant: `sessions.open` inherits the parent session's scope, and the narrowing rule (`narrowScope`, `create-agent.ts:206`) refuses a wider one.
    - **Amendments made from these findings:**
      - Task 2: file path for `RunOptions`, plus `RunOptions.skills`, `sessions.open` `seed`, `SessionContext.parentSessionId`, the tool owner in `PackageAPI.tools.list()`, `recordUsage` scope, the async-child charging rule and the ledger double count, with their tests.
      - Task 3: corrected spans, the placeholder re-execution bug, collecting every nested suspension in a parallel round, routing nested `modifiedArguments`, the `MAX_ATTRIBUTION_DEPTH` fact, and the named sticky-loop bound.
      - Task 4: `inherit: []` → `tools: { only: [] }`, late `workspace` consume, `interactive`, memory and advisor skipping child sessions, the orchestrator comment.
      - Task 5: renderer files.

- [x] Task 2: Kernel — a package can open a linked session, and a run can charge a parent run
  - Acceptance Criteria:
    - Functional:
      - `PackageAPI.sessions.open(options)` opens a session on the same agent. It needs the new capability `"sessions"`. `options.parent.sessionId` is required and must name an open session of this agent; the kernel stamps the links entry (`SessionLinks`, including `delegationId`), inherits the parent's ownership scope, and refuses a wider one. Calling it during `setup` throws `state_not_ready`.
      - The returned object is a `Session`; closing the parent closes its open children.
      - `RunOptions.chargeTo?: SessionContext`: each usage the run records is also recorded on that session's active run (limits, run usage, ledger scope `child_run`). The target must be a session of the same agent and an ancestor by links, else the run fails closed before any turn. A breach on the parent aborts the child run.
      - A session's link depth is available to packages as `SessionContext.depth` (0 for a root), and its parent as `SessionContext.parentSessionId`. Both are synchronous. `depth` is persisted in the links entry at open, so a resumed child reads it without walking the store.
      - `sessions.open({ ..., seed })` accepts `message` and `summary` entries only. The kernel stamps their id, chain, session id and scope and appends them after the links entry, which replaces the delegate's seeded memory store (Task 1(a)).
      - `RunOptions.skills?: false | { only: readonly string[] }` narrows the run's skills to a subset of the agent's. Unknown names fail closed, and `false` means none (Task 1(a)).
      - `PackageAPI.tools.list()` entries name their registering package (`package`, `host` for the host's own), as `toolInfos` does (Task 1(a), `inherit`).
      - The package-call seam's `recordUsage` takes the ledger scope. `chargeTo` with no active run on the target charges nothing and is documented as such: an async child outliving the parent run is uncharged. `child_run` rows mirror another session's `provider_turn` rows, and the docs say cross-session totals exclude them (Task 1(e)).
      - Without the capability, `sessions.open` throws `capability_missing`.
    - Performance: Opening a child reads nothing from the store (it is a new session); charging is O(depth) per recorded usage.
    - Code Quality: `sessions.open` reuses `agent.session`'s path; there is no second session constructor.
    - Security: A package cannot open a session under another principal or scope, cannot charge a run outside its ancestry, and the capability is shown by `inspect()` and at install.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/api.ts`, `src/packages/capabilities.ts`, `src/packages/loader.ts` (how capability-gated members are built)
      - `src/agent-session/create-agent.ts:190-230` (`agent.session`), `src/agent/sessions.ts` (`narrowScope`), `src/contracts-core/session.ts` (`SessionLinks`)
      - `src/session-context.ts`
    - Options Considered:
      - Give tools the `Agent` in their context — rejected: it hands every tool the whole host API, ungated.
      - Charge through `models.client` only (plan 225) — rejected: a child session's turns are run turns, not package calls.
    - Chosen Approach:
      - One capability-gated member and one run option, both scoped to the session's own ancestry.
    - API Notes and Examples:
      ```ts
      // capabilities: ["sessions"]
      const child = await prism.sessions.open({ parent: { sessionId: context.sessionId, delegationId } });
      // `systemPrompt` takes the existing `SystemPromptConfig`; Task 1(a) records the exact form that replaces the base prompt.
      await child.run(input, { model, systemPrompt, tools: { only }, limits, chargeTo: context.session });
      ```
    - Files to Create/Edit:
      - `src/packages/api.ts`, `capabilities.ts`, `loader.ts`
      - `src/session-context.ts` (`depth`, `parentSessionId`), `src/agent-session/session.ts`, `session/provider-round.ts` (mirrored usage via `meterUsage`), `src/package-call-seam.ts` (scope parameter), `session/assemble.ts` (`RunOptions.skills` at the `resolveRunSkills` call)
      - `src/contracts-protocol.ts` (`RunOptions.chargeTo`, `RunOptions.skills`, `UsageScope`), `src/contracts-core/session.ts` (`SessionLinks.depth`)
      - `src/agent/views.ts` / `src/packages/loader.ts` (tool owner in `tools.list()`)
      - `src/testing/package-conformance.ts`: the capability
      - `src/__tests__/package-sessions.test.ts`: new
      - `scripts/compat-baseline/*.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note; `src/__tests__/public-export-contract.test.ts`
    - References:
      - Task 1(c)'s proof
  - Test Cases to Write:
    - `package_opens_a_linked_child_session`: the child lists under the parent in `agent.sessions`.
    - `sessions_open_needs_the_capability`.
    - `child_cannot_widen_ownership_scope`.
    - `child_usage_is_charged_to_the_parent_run`: the parent fails on `maxTotalTokens` from child turns.
    - `charge_to_must_be_an_ancestor`.
    - `parent_breach_aborts_the_child_run`.
    - `closing_the_parent_closes_children`.
    - `works_from_a_custom_loop`: the parent runs on a `slot:loop` loop.
    - `seeded_child_starts_with_summary_and_messages`: the seed is in the store, scope-stamped, after the links entry; another entry kind is refused.
    - `run_skills_only_narrows_and_false_disables`: an unknown skill name fails closed.
    - `tools_list_names_the_registering_package`.
    - `child_run_rows_are_scoped_and_no_charge_without_parent_run`.
    - `depth_and_parent_session_id_survive_resume`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a `PackageAPI` member, a capability, a run option
  - Notes (executed 2026-11-17):
    - **What changed.**
      - `PackageAPI.sessions.open(PackageSessionOpenOptions)`, behind the capability `sessions` (`src/packages/api.ts`, `capabilities.ts`, `loader.ts`). The loader reaches the agent through a new `registry.openSession` closure from `create-agent.ts`.
      - `agent.session` and the child path share one function, `openAgentSession(options, internals)` (`create-agent.ts`). `openChildSession` handles the child: it finds the parent among the agent's open sessions (a closing one does not count), stamps `depth = parent.depth + 1` (at most `MAX_SESSION_LINK_DEPTH`, 16), narrows the parent's scope, and registers the child in `parent.children`.
      - `closeSession` closes the children first (`session.ts`). The options are checked by `assertChildSessionOptions`:
        - parent links: only `sessionId`, `delegationId` and `workflowRunId`
        - seed: at most `MAX_SESSION_SEED_ENTRIES` (512), and only user, assistant or tool messages and `summary` entries
      - `SessionLinks.depth` is stamped whenever a session opens with `parent.sessionId`, including through `agent.session`, where a parent that is not open gives 1. A caller's value is dropped (`sessionLinksOption`).
      - A resumed session reads its links back from its snapshot (`openResumedSession`). A compaction now adds the links entry to `keepEntryIds` and to the checkpoint's `pinnedEntryIds` (`keepLinksEntry`, the same pattern as plan 231's `keepNewestRunCheckpoint`), so a tail read still returns it.
      - `SessionContext.depth` and `parentSessionId` are getters on every kernel view. `depth` is **optional** in the type, so hand-built contexts in tests and packages stay valid; kernel views always set it, and the docs say to read it as `depth ?? 0`.
      - `RunOptions.chargeTo`:
        - `runInternal` checks the target before any event (`assertChargeTarget`). It must be a kernel view (a `WeakMap` from view to session), on the same agent, and an ancestor, found by walking `openParent`/open sessions for at most 16 hops.
        - `executeRun` binds `session.activeChargeTo` to the target's `PACKAGE_CALL_SEAM`, and `cleanupRun` clears it.
        - `meterUsage` ends with `chargeAncestor`, which calls the target seam's `recordUsage(model, usage, undefined, "child_run")`. That runs the ancestor's own `meterUsage`, which charges its own `chargeTo` in turn: O(depth).
        - The seam's `recordUsage` gained the `scope` parameter (`PackageUsageScope`). `UsageScope` gained `child_run`.
      - `RunOptions.skills` is checked in `config-shape.ts`, its names are checked in `runInternal` (fail before any event), and it is applied in `resolveRunSkills`.
      - `PackageAPI.tools.list()` returns `PackageToolListing` (`ToolDefinition` plus `package`; `host` for host tools).
      - The conformance recorder treats `sessions.open` as gated by `sessions`.
    - **Findings for later tasks.**
      - Task 4: `inherit` should filter `tools.list()` by `package`. A child run's usage also lands in the parent's `run_total` and `RunResult.usage`, so delegate's "child usage" report should read the child's own `RunResult`.
      - Task 4/5: `chargeTo`'s ancestor walk needs every intermediate parent to be open in this agent. That holds for sync children; an async grandchild whose parent closed cannot charge the grandparent and fails closed.
      - Task 5: the `when` predicate should read `session.depth ?? 0`.
      - A parent-limit breach reaches the child as the error `limits.recordUsage` throws, so the child run fails (asserted as failed-or-threw in `parent_breach_aborts_the_child_run`).
    - **Tests.** `src/__tests__/package-sessions.test.ts`, 17 cases: the 13 listed, plus setup `state_not_ready`, parent-must-be-open and link-field refusal, the host-link depth stamp, and the child_run ledger total. Updated: `package-api-freeze.test.ts` (member and capability), `package-api-reads.test.ts` (listing type), `public-export-contract.test.ts` (+`MAX_SESSION_LINK_DEPTH`, `MAX_SESSION_SEED_ENTRIES`).
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism.txt`; this task's lines only):
      - Added:
        - `MAX_SESSION_LINK_DEPTH`
        - `MAX_SESSION_SEED_ENTRIES`
        - `SessionSeedEntry`
        - `PackageSessionOpenOptions`
        - `PackageToolListing`
      - Changed:
        - `Capability` (+`sessions`)
        - `PackageAPI` (+`sessions`, `tools.list` type)
        - `RunOptions` (+`chargeTo`, `skills`)
        - `SessionContext` (+`depth?`, `parentSessionId?`)
        - `SessionLinks` (+`depth?`)
        - `UsageScope` (+`child_run`)
      - Removals: none.
      - The regenerated baselines (kernel, extensions, hosts, memory-system) also pick up export changes from plans 229–231 that were in the tree but never baselined (store-codecs `BranchTailSource`/`SESSION_ENTRIES_*`, `Session.continue`, `SessionAppendManyOptions`, the storeConformance steps). Those are not attributed to this plan.
    - **Budgets.** `scripts/budgets.json` kernel ceilings were rebaselined with a dated reason: 1353503 packed / 4384286 unpacked / 1604 counted exports / 44986 source lines (prior 1345491 / 4358437 / 1596 / 44615).
    - **Gate.** `release.mjs gate` still fails on `ranges: @arnilo/prism-ai changed since v0.13.0 but version is still 0.13.0`. That predates this task, and this plan does no version bump.
    - **Sweep.** Nothing retired.
    - **Checks run.**
      - `bun run typecheck` passes.
      - Kernel suite (`bun test src` without `packages/**` and `apps/**`): 2251 of 2253 pass. The 2 failures:
        - `agent-surface-freeze` needed `skills` and `chargeTo` in the frozen `RunOptions` list. Fixed, and the `docs/agent.md` count corrected to 23 (it said 26, which was already stale).
        - `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` exceeds its hard 60 s cap (`docs.test.ts:1956`), failing at a different demo each run. Every listed demo exits 0 when run from source (about 37 s in total, before the test's `tsc` emit). No demo uses this task's APIs. This is a time budget, not a regression, and is left for the whole-plan verification.
      - delegate, workflows and advisor tests: 310 of 310 pass.
    - Docs pages to create/edit:
      - `docs/packages.md`: `sessions.open`, the capability
      - `docs/agent.md`: `RunOptions.chargeTo`, session depth
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3: Kernel — a suspension inside a tool call suspends the parent and resumes through the tool
  - Acceptance Criteria:
    - Functional:
      - `ToolDefinition.resumeNested?(nested, decisions, context)` (type `ResumeNestedRun`, now with the hosting call's `ToolExecutionContext`) is the carrier the retired run-state surface used to provide. A tool that throws `AgentDelegationSuspendedError` (with the child run ref and its pending decisions) and defines `resumeNested` suspends the parent run: the parent's `run.suspended` lists the child's decisions with `attribution.path` naming the tool call and the child.
      - `session.resume(decisions)` on the parent calls `resumeNested` with the decisions for that child. It returns a tool result (the call settles and the parent continues) or a new suspension (the parent suspends again). Sticky `allow_for_run` / `reject_for_run` decisions are applied to later nested asks without a prompt, as for direct asks.
      - A tool that throws the error without `resumeNested` fails the call closed: the call's result is an `ERR_PRISM_DECISION_INVALID` tool error and the parent run continues.
      - The deprecated functions are either used by this path or deleted: `applyNestedRun` and `suspendNested` lose `@deprecated` if used, and whatever remains unused is removed in this task and added to the retirement sweep.
      - Limits: attribution depth stays capped (`MAX_ATTRIBUTION_DEPTH`, 8 entries; two per level), pending decisions stay capped (`HARD_MAX_PENDING_DECISIONS`). The sticky auto-apply loop's unnamed `depth >= 4` bound (`tool-round.ts:172`) becomes the named constant `MAX_NESTED_STICKY_RESUMES`.
      - A settled nested call is never re-executed on resume. Today `resolvedToolCallIds` (`tool-round.ts:499`) is never filled, and the generic replay would re-execute the hosting tool through its placeholder `nr_<runId>` pending call (Task 1(d)). The placeholder is removed rather than filtered.
      - Several nested suspensions in one parallel round become one parent suspension listing every child's decisions. Today `dispatchToolCallsInOrder` keeps only the first failure (`loop/dispatch.ts:85-117`).
      - `modifiedArguments` and elicitation payloads on an attributed decision are never validated against the parent's registry (`resolveRunDecisions`, `agent-approval.ts:57-110`). They pass to `resumeNested`, and the child's resume validates them.
    - Performance: No cost on a run with no nested suspension.
    - Code Quality: One nested path; no parallel "legacy pending" branch left behind.
    - Security: A decision is routed only to the child named in its attribution; a decision for an unknown child fails closed. Decisions carry hashes and scopes, never arguments.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/tool-round.ts:38-46` (`matchNestedSticky`), `:148-201` (`applyNestedRun`), `:279-324` (`suspendNested`), `:370-375` (`handleNestedSignal`), `:484`, `:490-614` (replay, `runLoopUntilSettled`); `src/loop/dispatch.ts:85-155`; `src/tools.ts:467`, `:514-521`
      - `src/contracts-run-state.ts:100-160`, `src/agent-approval.ts` (`nestedApprovalId`, `nestedOutcomeToolResult`, `resolveRunDecisions`)
      - `docs/agent.md` ("RunResult and session.resume"), `docs/tools.md`
    - Options Considered:
      - Have the host resume the child session directly and re-run the parent — rejected: the parent's tool call would have no result, and the host would need to know the tree.
      - A hook instead of a tool method — rejected: the tool that started the child is the only code that can resume it.
    - Chosen Approach:
      - Put the resume callback on the tool definition and reuse the attribution machinery already in the tree.
    - API Notes and Examples:
      ```ts
      const delegate: ToolDefinition = {
        name: "delegate",
        async execute(args, ctx) { /* … */ throw new AgentDelegationSuspendedError(ref, pending); },
        async resumeNested(ref, decisions, ctx) { return resumeChild(ref, decisions); },
      };
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts` (`ToolDefinition.resumeNested`), `src/contracts-run-state.ts`
      - `src/agent-session/session/tool-round.ts`, `src/tools.ts`, `src/agent-approval.ts`
      - `src/__tests__/nested-suspension.test.ts`: new
      - `scripts/retired-names.json` via `bun scripts/retired-names.mjs --generate` for anything removed
      - `scripts/compat-baseline/*.txt`: regenerated; the diff with removals attributed to this plan in the task note
    - References:
      - Evaluation finding K12
  - Test Cases to Write:
    - `nested_ask_suspends_the_parent_with_attributed_decisions`.
    - `parent_resume_routes_decisions_to_the_child_and_settles_the_call`.
    - `nested_resume_can_suspend_again`.
    - `sticky_allow_for_run_covers_later_nested_asks`.
    - `tool_without_resume_nested_fails_closed`.
    - `decision_for_unknown_child_fails_closed`.
    - `attribution_depth_limit_holds_at_three_levels`.
    - `settled_nested_call_is_not_re_executed_on_resume`.
    - `two_nested_suspensions_in_one_parallel_round_suspend_together`.
    - `nested_modified_arguments_are_not_validated_against_the_parent_registry`.
    - `no_retired_name_in_live_tree` stays green.
    - The same flow on a custom loop.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a `ToolDefinition` member and resume behavior
    - Docs pages to create/edit:
      - `docs/tools.md`: "Tools that run a child"
      - `docs/agent.md`: nested pending decisions and attribution
      - `CHANGELOG.md`: `## [Unreleased]`, Added and Removed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-17):
    - **Design: a nested suspension is staged like a gated `ask`.**
      - The error no longer propagates through the loop. `bindDispatchToolCall` (`src/agent-session/session/tool-round.ts`) catches `AgentDelegationSuspendedError` and calls `surfaceNested`, then:
        - it stages the call in the new `session.activeNestedRound` and returns the `approvalPending` marker, so no transcript row is written;
        - or, when stickies settle it at once, it returns the tool's result and emits one `tool.completed`.
      - `suspendGatedRound` suspends on gated asks and nested calls together, so every child that suspends in a parallel round lands in one parent suspension. This fixes gap 1 of Task 1(d) at the root: `dispatchToolCallsInOrder` never sees the error.
      - `runLoopUntilSettled` lost its retry loop, and `executeApproved` lost its catch. `handleNestedSignal` is deleted.
      - The turn-durability checkpoint (`onToolRoundComplete`), `callsOwnedBySuspension`, `executeRun` and `cleanupRun` treat `activeNestedRound` like `activeGatedRound`.
    - **Attribution.**
      - Each level writes `[hostingCallId, childSessionId ?? childRunId]` and prefixes the child's own `attribution.path`, so a grandchild's decision names both hops root first.
      - Root-visible ids are `nestedApprovalId(childRunId, childApprovalId)` (`sub_<sha256>`).
      - Over `MAX_ATTRIBUTION_DEPTH` (8), the run fails with `ERR_PRISM_DECISION_LIMIT`.
      - `AgentDelegationSuspendedError` lost its unused third `path` argument: the kernel writes the path.
    - **Resume.**
      - `replayDurableNestedAndPending` clears `nestedRuns` on the claimed state, then runs `resumeNestedEntry` per entry:
        - It looks up `resumeNested` by the new `NestedRunRef.toolName`, and fails closed when the tool or a decision is missing.
        - It maps the decisions back to the child's ids through `entry.approvals`, never through attribution text.
        - It calls the tool, then `driveNested`, which settles the call (`replayToolResult` plus `tool.completed`) or stages it again.
      - The run's own pending calls replay afterwards, unchanged.
      - No `nr_<runId>` placeholder pending call is written any more, so the hosting tool cannot be re-executed. `NestedRunRef.decisions` (partial batches) is removed because `prepareResume` requires a decision for every pending id.
      - `parseAgentRunState` now also checks `toolName` and that every `path` entry is a string.
    - **Stickies.**
      - `driveNested` resumes through the tool without a prompt while every new ask matches a nested sticky (same full path and scope), at most `MAX_NESTED_STICKY_RESUMES` (4, exported) times in a row. That is the named constant for the old `depth >= 4`.
      - Because the path contains the hosting call id, a nested sticky covers later asks of that call's child only, not a later `delegate` call.
    - **Payload routing.** `resolveRunDecisions` (`src/agent-approval.ts`) skips registry, validator and elicitation-schema checks for an attributed decision. It only bounds the payload to 16 KiB (`assertBoundedPayload`). The child's resume validates it.
    - **A tool without `resumeNested`** gets an `ERR_PRISM_DECISION_INVALID` tool result and the run continues. The acceptance text was changed from "fails the call closed" to state this. The child stays suspended.
    - **Findings for Task 4.**
      - `delegate`'s sync path must run the child with `interactive: false` (or the inherited setting) so a child ask suspends instead of prompting. On `status: "suspended"` it throws `new AgentDelegationSuspendedError({ runId: result.runId, sessionId: child.id }, result.pending ?? [])`. `resumeNested` resumes that child session with the given decisions and maps the stream's end to `NestedRunOutcome`. `nested-suspension.test.ts` (`a_real_child_session_suspends_and_resumes_through_the_parent`) is a working template.
      - A parent resumed in a new process needs `resumeNested` to reach an existing child session by id. `sessions.open` (Task 2) opens a new session only. Task 4 must check whether a package can reopen a stored child (`sessions.open` with an existing child id, or a new read). If it cannot, add the kernel member there.
    - **Tests.** `src/__tests__/nested-suspension.test.ts`, 13 cases:
      - the 11 listed, plus `sticky_resumes_are_bounded`;
      - `nested_flow_runs_on_a_custom_loop` (a `state: "run"` loop);
      - `a_real_child_session_suspends_and_resumes_through_the_parent`: one agent, a linked child session, a real `tool.call` ask in the child;
      - `public-export-contract.test.ts` (+`MAX_NESTED_STICKY_RESUMES`).
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism.txt`; this task's lines only):
      - Added: `MAX_NESTED_STICKY_RESUMES`.
      - Changed:
        - `ToolDefinition` (+`resumeNested?`)
        - `ResumeNestedRun` (+`context` parameter)
        - `NestedRunRef` (+`toolName`, −`decisions`)
        - `AgentDelegationSuspendedError` (−constructor `path`, −`path` field)
      - Removals of exports: none. `applyNestedRun`, `suspendNested` and `handleNestedSignal` were not public exports (`tool-round.ts` internals) and were already listed in `scripts/retired-names.json` from the 0.12.1 diff.
      - The regeneration also picked up in-tree export changes from other uncommitted plans (store-codecs schema 13, headless interrupted runs, ag-ui queue default, compaction `maxChunks`). Those are not attributed to this task.
    - **Budgets.** `scripts/budgets.json` kernel ceilings rebaselined with a dated reason: 1356488 packed / 4392784 unpacked / 45031 source lines (prior 1353503 / 4384286 / 44986).
    - **Sweep.** `bun scripts/retired-names.mjs`: 0 hits.
    - **Checks run.**
      - `bun run typecheck` passes.
      - `bun test src/__tests__/nested-suspension.test.ts`: 13 of 13 pass.
      - `bun test src` (kernel plus packages, 7091 tests): 6939 pass and 6 fail, none in code this task touches:
        - `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` hits its hard 60 s cap. This is known from Task 2.
        - `hard_deny_decision_budget`, the two `tools/browser` cases, `enrichment stays below two milliseconds`, and the document-reader max-page envelope are timing or isolation tests. Each passes when run on its own or with its package.
      - `release.mjs gate` fails only on the existing `@arnilo/prism-ai` version range.

- [x] Task 4: Delegate — a child is a linked session of the parent agent
  - Acceptance Criteria:
    - Functional:
      - A delegation opens a child session with `prism.sessions.open` and runs it with the child's model, instructions (the report contract plus the child's text), tool allow-list, limits, and `chargeTo` the parent. No `createAgent`, no provider bridge, no `packages.instances`.
      - `inherit` keeps its meaning for tools: the child's allow-list is the tools registered by the inherited packages, read from `PackageAPI.tools.list()`'s owner (Task 2), narrowed by `tools.only`. `inherit: []` runs with `tools: { only: [] }`, never `undefined`, because `undefined` means every tool. `skills` maps to `RunOptions.skills`, and `instructions` to `systemPrompt: { source: "run", mode: "replace" }` (Task 1(a)). The README states that hooks of every loaded package apply to a child, and how a package skips child sessions (`SessionContext.depth > 0`).
      - The child run inherits the parent run's interactivity (the new kernel field `ToolExecutionContext.interactive`), so a headless parent gets a suspending child instead of a child that prompts the host directly. `childHostUi` labelling is removed, because host requests carry the child's `sessionId`.
      - `isolation: "worktree"` consumes the parent agent's `workspace` service at call time, and the isolation probe package is deleted.
      - `advisor` skips child sessions (Task 1(b)). The memory system (`packages/memory/system`) does not yet: it goes to `plans/backlog.md` with the reason (its sources are pinned by the plan 218.1 benchmark fingerprints).
      - `skills`, `context` seeding, `isolation: "worktree"`, `resultMaxChars`, `hidden`, and `agentsRoot` children keep their behavior.
      - The child's transcript is in the agent's store and survives the delegation. `delegate_wait` on a finished child still pages its answer.
      - A child that suspends: a synchronous call throws `AgentDelegationSuspendedError` and implements `resumeNested` (Task 3); an asynchronous call reports `suspended` with the child session id, the `finished` `delegate.step` carries the child session id and its approval ids, and the host resumes that session directly.
      - `resumeNested` works after the parent is resumed in a new process, where the child session is no longer open. `sessions.open` could not reopen a stored child, so this task adds `PackageSessionOpenOptions.id` (Task 3 finding).
      - `ownership` in the package config is retired (the child inherits the parent session's scope); the config key fails the load with a message naming the replacement. The name does not go into the retirement sweep: `ownership` is a live kernel field (`AgentConfig.ownership`, `SessionOptions.ownership`), so a sweep entry would hit the whole tree.
    - Performance: Starting a delegation costs one session open; the task note records the time against Task 1's baseline.
    - Code Quality: `runtime.ts` loses the agent-building and bridge code; child options are assembled in one function.
    - Security: A child cannot call a tool outside its allow-list (`RunOptions.tools.only` is enforced at dispatch), and runs under the parent's principal and scope.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/delegate/src/{runtime,context,isolation,tools,service,agent-files,config}.ts`, `README.md`
      - `src/agent/views.ts` (`toolInfos`: tool → package), `src/tools.ts` (`selectRunTools`)
      - Task 1(a), (b)
    - Options Considered:
      - Cache one child agent per child name — rejected (unless Task 1 forces it): it keeps the bridge, double hook firing, and a separate store.
    - Chosen Approach:
      - Linked sessions on the parent's agent.
    - API Notes and Examples:
      ```jsonc
      { "name": "@arnilo/prism-extensions/delegate",
        "config": { "children": { "explore": { "inherit": ["@arnilo/prism-tools/coding"], "tools": { "only": ["read", "grep", "glob"] } } } } }
      ```
    - Files to Create/Edit:
      - `packages/extensions/delegate/src/*.ts`, `README.md`, `skills/`
      - `packages/extensions/delegate/src/__tests__/*.test.ts`
      - `packages/extensions/package.json`: capability list if declared there
      - `apps/prism-agent/src/host/orchestrator.ts` (the doc comment at `:16-20` says the child's store is delegate's memory store) and its scenarios
      - `packages/memory/system/src/*.ts`, `packages/extensions/advisor/src/index.ts`: skip child sessions (Task 1(b))
      - `examples/delegate.ts`
      - `scripts/retired-names.json` (the `ownership` config key as vocabulary with a reason, if the sweep needs it)
      - `scripts/compat-baseline/*.txt`: regenerated for `@arnilo/prism-extensions`, diff attributed in the task note
    - References:
      - Plan 191; evaluation findings D1, D3, D4
  - Test Cases to Write:
    - `delegation_builds_no_agent_and_runs_no_setup`: a package `setup` spy fires once across three delegations.
    - `child_transcript_is_in_the_parent_store`.
    - `child_allow_list_comes_from_inherited_packages`.
    - `child_cannot_call_a_tool_outside_its_allow_list`.
    - `sync_child_approval_suspends_and_resumes_through_the_parent`, and `sync_child_resumes_after_the_parent_is_reopened_by_a_new_agent`.
    - `async_child_suspension_reports_the_child_session_id`.
    - `child_usage_counts_against_parent_limits`.
    - `worktree_isolation_still_merges`: covered by the existing `isolation.test.ts` merge cases, which run unchanged on the shared agent.
    - `retired_ownership_key_fails_the_load`.
    - `inherit_empty_child_gets_no_tools`.
    - `headless_parent_child_suspends_instead_of_prompting`.
    - Package conformance and the reference host suite pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package behavior, capabilities, one retired config key
    - Docs pages to create/edit:
      - `packages/extensions/delegate/README.md`: rewritten "What it changes", capabilities, cost, failure behavior
      - `apps/prism-agent/README.md`: the orchestrator's child
      - `CHANGELOG.md`: `## [Unreleased]`, Changed and Removed
      - Done as well: `docs/packages.md` (`sessions.open({ id })`), `docs/tools.md` (`context.interactive`, resuming after a restart), `examples/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-17):
    - **What changed in the delegate** (`packages/extensions/delegate/src/runtime.ts`, rewritten):
      - A delegation opens the child with `prism.sessions.open({ parent: { sessionId, delegationId }, seed? })` and runs it with `childRunOptions`, the one function that assembles every per-run option: `model` (the child's, else the parent session's), `systemPrompt: { id: "delegate-child", source: "run", mode: "replace" }`, `tools.only`, `skills`, `limits`, `interactive`, `principal` and `chargeTo: context.session`.
      - `buildAgent`, the provider bridge, `childHostUi`, `selectSkills` and the `packages.instances` rebuild are gone. `createAgent` is no longer called.
      - The allow-list is `tools.list()` filtered by `package ∈ inherit`, narrowed by `tools.only`; never `undefined`. `packages.instances(inherit)` is still called once per delegation, only to fail an unloaded package closed.
      - `skills: "inherit"` keeps the agent skills whose `requiresTools` the allow-list holds. `resolveAllActiveSkills` does not filter on `requiresTools`, so without this the `delegating-work` skill added a `load_skill` bridge to every child.
      - `context` seeding returns `SessionSeedEntry[]` for `sessions.open({ seed })`; `buildSeededContext` lost its `ownership` parameter and the stamped store entries.
      - `isolation: "worktree"` consumes the agent's `workspace` service at call time. The probe package (`isolationProbe`) is deleted.
      - The package declares `sessions` and no longer declares `host-ui`.
      - `ownership` stays in the schema only so `setup` can throw `ownership is retired: a child is a session linked to the parent session and inherits its ownership scope; remove the key`.
    - **Suspension.**
      - Sync: on `status: "suspended"`, the tool throws `AgentDelegationSuspendedError({ runId, sessionId }, pending)`. The runtime records `{ child, delegationId, brief }` under the child session id in a `prism.state.session("suspended-children")` value on the **parent** session, so a parent resumed in a new process still knows which child config to use.
      - `resumeNested` calls `runtime.resume`, which reads that record, reopens the child with `sessions.open({ parent, id })`, iterates `session.resume(decisions, options)` to its end event and returns `completed` with the same text result (status line, paging) or `suspended`. A missing record, an unconfigured child or a lost worktree returns `failed` (`ERR_PRISM_DELEGATE`).
      - Async: the outcome carries `sessionId`/`runId`; the status line reads `[child reviewer: suspended, 1 turn, 1 pending, session <id>]`, and the `finished` step carries `sessionId` and `approvalIds` (at most `MAX_DELEGATE_STEP_APPROVALS`, 16). No kernel read returns a stored session's pending decisions, so the step is the host's path (backlog).
      - An isolated child that suspends keeps its worktree bound in process memory; its resume continues there, and the parent session's close records and releases it. A resume without the worktree (a new process) fails closed with `isolation_unavailable`.
    - **Kernel additions** (both additive):
      - `ToolExecutionContext.interactive` (`src/contracts-protocol.ts`), set from `RunOptions.interactive ?? true` in `toolExecutionContext` (`tool-round.ts`). The tool context had no other way to learn the run's interactivity.
      - `PackageSessionOpenOptions.id` (`src/packages/api.ts`; `reopenChildSession` in `create-agent.ts`): returns the child already open under the parent, else opens the stored session (missing or out of scope → `SessionNotFoundError`) and refuses one whose links name another parent. `seed`, `actor` and `metadata` are refused with `id`.
    - **Findings.**
      - A durable resume refuses `RunOptions.model`, and the suspended state does not record it, so a resumed child continues on the agent's model. The delegate omits `model` on resume (`leg: "resume"`); README and backlog record it.
      - Agent-level subscribers get lifecycle events only, not a child's `run.suspended`; hence the step fields above.
      - `PackageSessionOpenOptions` is not exported from the kernel root (it appears only inside `PackageAPI`), so the `id` field shows in no baseline line. Task 2 notes listed it as added; a package names the type through `Parameters<PackageAPI["sessions"]["open"]>[0]`. Left as is.
      - The delegate's `active` count now includes a resume leg, so a resume counts toward `maxConcurrent` while it runs. It is not refused when the limit is reached: a resume continues a call that already holds its place in the round.
      - `origin.agentId` stays the `delegate-<name>` label; the child no longer has an agent of its own.
    - **Advisor.** `packages/extensions/advisor/src/child.ts` `isChildSession(context)`; the `run.input`, `tool.call` and both `run.end` hooks return early for `depth > 0`. Not configurable. Test: `triggers.test.ts` `child_sessions_are_skipped`.
    - **Tests.**
      - `delegate/src/__tests__/package.test.ts`: the 11 listed (the `worktree` case is `isolation.test.ts`), plus `sync_child_resumes_after_the_parent_is_reopened_by_a_new_agent` (a second agent over the same store) and `child_approval_request_reaches_parent_host` rewritten to assert the request's `sessionId` is the child's. `forwarded_request_names_child` (the `[<child>] ` prefix) is deleted with the prefix. `delegate_child_inherits_only_named_packages` is renamed `child_allow_list_comes_from_inherited_packages`.
      - `context.test.ts` and `service.test.ts` now pass the kernel's own session view (captured through a command), since `chargeTo` refuses a hand-built `SessionContext`. `isolation.test.ts` moves `ownership` to `AgentConfig`, and its no-service case loads no coding package (the service is the agent's now). `agent-files.test.ts`: the drop note's wording.
      - Kernel: `package-sessions.test.ts` `reopens_a_stored_child_of_its_parent_by_id` and `tool_context_carries_the_run_interactivity`.
    - **Performance** (`bench-delegate-232.ts` in the session scratchpad: the Task 1 package set plus approval, 20 sync delegations after one warm-up, each set measured twice). Median per run with delegation: 6.6–12.2 ms (p90 9.4–23.6 ms; this machine was noisy), against Task 1's 4.5 ms (`inherit: []`) and 7.0 ms (coding set). The spy's `setup` ran **once for the agent's life**, against 21 over 21 delegations before. With no I/O in any `setup`, the saved agent build is roughly offset by every loaded package's per-run hooks now running for the child (context-files re-reads `AGENTS.md`). The saving is real for packages whose `setup` opens MCP connections, language servers or stores.
    - **Baseline diff** (this task's lines only, against a copy taken before the task):
      - `arnilo__prism.txt`: `ToolExecutionContext` (+`interactive?`).
      - `arnilo__prism-extensions.txt`: added `./delegate MAX_DELEGATE_STEP_APPROVALS`; changed `DelegateConfig` (−`ownership`), `DelegateStepInput` (+`sessionId?`, `approvalIds?`), `DelegationOutcome` (+`sessionId?`, `runId?`), `delegateConfigSchema` (`ownership` is a retired placeholder, `maxDepth` unchanged).
      - Removals of exports: none (`isolationProbe` and `childHostUi` were not exported).
    - **Budgets.** Kernel ceilings 1358128 packed / 4398422 unpacked / 45071 source lines (prior 1356488 / 4392784 / 45031). `extensions.packedBytes` baseline 511331 (prior 483889, over its 5% tolerance after plans 229–232). Both with dated reasons.
    - **Sweep.** 0 hits. Nothing added (see the `ownership` criterion).
    - **Checks run.**
      - `bun run typecheck` passes.
      - `bun test ./src/` (kernel, including `docs.test.ts` this time): 2266 of 2266.
      - `@arnilo/prism-extensions` test: 1157 run, 1104 pass, 0 fail (the rest skipped).
      - `@arnilo/prism-hosts` test: one failure in the first run, then a clean rerun (934 run, 0 fail); this task changes no hosts code.
      - `@arnilo/prism-agent` test: 69 of 70 pass, 0 fail.
      - `bun examples/delegate.ts` completes: the reviewer gets only the coding tools, the worktree merge lands, and `childSessions: 1`.
      - `release.mjs gate` fails only on the existing `@arnilo/prism-ai` version range.

- [x] Task 5: Delegate — depth, queueing, and visible child activity
  - Acceptance Criteria:
    - Functional:
      - `maxDepth` accepts 1–3 (default 1). A child sees `delegate` only when its depth is below `maxDepth` (a `when` predicate on `SessionContext.depth`). A `when` predicate alone is not enough: since Task 4 the child's `tools.only` is the inherited packages' tools, and this package can never be inherited, so the runtime must also append `delegate`, `delegate_wait` and `delegate_cancel` to the allow-list (and let the `delegating-work` skill through) when the child's depth is below `maxDepth`. Every level charges its ancestors.
      - `maxConcurrent` counts running children across the tree. A call over the limit waits up to `queueTimeoutMs` (default 30,000; `0` restores the immediate error), in call order, and ends with the same `DelegateError` on timeout or abort. An async call returns `running` only once it holds a slot; a `resumeNested` leg takes its slot without waiting.
      - `report: "stream"` emits `delegate.activity` package events for the parent session: child tool start and finish (name, call id, status, duration) and child text, flushed at most once per second and capped at 2 KiB per event, each with the delegation's `origin` and `parentSessionId`. Package events are agent-wide (`PackageAPI.events.emit` sets an empty `sessionId`), so `parentSessionId` is how a host routes them to the parent; no kernel change. `milestones` and `on-complete` are unchanged.
      - When the parent run reaches `run.end` while async children of that session are still running or finished but unread, the package asks for one continuation naming them. It is bounded by the kernel's `maxContinuations` and can be turned off with `announceAsync: false`.
    - Performance: Stated in the README: events per child tool call and per second of child text under `stream`; none otherwise.
    - Code Quality: The queue is a small FIFO with abort handling, unit-tested alone.
    - Security: Activity events carry tool names, ids, status and redacted text, never arguments or results.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/delegate/src/runtime.ts:430-470`, `step.ts`, `config.ts:120-140`, `limits.ts`
      - `docs/hooks.md` (`run.end`), `src/contracts-core/content.ts` or where `EventOrigin` is defined
      - `packages/tools/coding/src/agent/todo.ts` (the existing `run.end` continuation pattern)
    - Options Considered:
      - Forward the child's catalog events onto the parent stream — rejected: only `RunController` primitives may emit catalog events (roadmap §1.4).
      - Unlimited depth — rejected: attribution and budgets are capped at three levels.
    - Chosen Approach:
      - Bounded package events, a bounded queue, and the existing `run.end` continuation.
    - API Notes and Examples:
      ```jsonc
      { "config": { "maxDepth": 2, "maxConcurrent": 4, "queueTimeoutMs": 30000,
                    "children": { "worker": { "inherit": ["@arnilo/prism-tools/coding"], "report": "stream" } } } }
      ```
    - Files to Create/Edit:
      - `packages/extensions/delegate/src/{runtime,config,step,tools,index}.ts`, `README.md`
      - `packages/extensions/delegate/src/__tests__/{depth,queue,activity}.test.ts`: new
      - `packages/extensions/observability/src/instrumentation.ts:518-527`: handle `delegate.activity` like `delegate.step`. Task 1(f) found that `ag-ui` and `devtools` do not render `delegate.step`, so they are not changed.
      - `examples/delegate.ts`: a two-level tree under `report: "stream"`
    - References:
      - Evaluation findings D2, D5, D6
  - Test Cases to Write:
    - `grandchild_runs_at_depth_two_and_is_refused_at_depth_three_when_max_is_two`.
    - `grandchild_usage_charges_both_ancestors`.
    - `call_over_limit_waits_for_a_slot_in_order`.
    - `queued_call_times_out_and_aborts_cleanly`.
    - `stream_report_emits_bounded_activity_events`.
    - `activity_events_carry_no_arguments_or_results`.
    - `finished_async_child_is_announced_at_run_end_once`.
    - `announce_async_false_adds_no_continuation`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config fields and events
    - Docs pages to create/edit:
      - `packages/extensions/delegate/README.md`: depth, queueing, `delegate.activity`, the continuation
      - `CHANGELOG.md`: `## [Unreleased]`, Added
      - Done as well: `packages/extensions/observability/README.md` (the span event), `docs/tools.md` (round concurrency and the queue), `examples/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-17):
    - **Depth** (`packages/extensions/delegate/src/runtime.ts`, `index.ts`, `config.ts`):
      - `maxDepth` accepts 1–3 (`DEFAULT_MAX_DEPTH`, `HARD_MAX_DEPTH`). The three tools are registered with `when: (session) => (session.depth ?? 0) < maxDepth`.
      - `allowListFor` takes the child's depth and appends this package's registered tools (`DELEGATE_TOOL_NAMES`, read from `tools.list()` by `package`) when `childDepth < maxDepth`. `skills: "inherit"` then keeps `delegating-work` by its `requiresTools`, with no extra code.
      - `start` refuses `depth_exceeded` when the calling session's depth is already `maxDepth`. That covers the `delegate` service, which no `when` predicate guards.
      - `origin.depth` is the child session's depth (was fixed at 1).
      - Charging needed no change: each level passes its own `context.session` as `chargeTo`, and Task 2's `meterUsage` walks up.
    - **Queue** (`src/queue.ts`, `createSlotQueue`): a FIFO with `acquire({ signal })`, `force()` and `release()`. A new caller never overtakes a waiter, and a timed-out or aborted waiter leaves without a slot. One queue per runtime, and every depth runs through the one runtime of the agent, so `maxConcurrent` counts the tree. `start` became `async`; the tool and the service already awaited it. Setup notes (`warn`) when `maxConcurrent < maxDepth`, because a sync child holds its slot while its grandchild waits for one.
    - **Activity** (`src/activity.ts`): `createActivityReporter` turns the child's `tool.started`, `tool.completed` and text `message.delta` events (from the existing `watch` subscription) into `delegate.activity` payloads.
      - `delegateActivityData` validates `origin` and the session id through `delegateStepData` and cuts text to `MAX_DELEGATE_ACTIVITY_TEXT_BYTES` (2,048) by code point.
      - The text buffer holds at most one event's worth. The rest is counted in `droppedChars`.
      - Text flushes on a timer at most once per `DEFAULT_ACTIVITY_FLUSH_MS`, before each tool event, and at the leg's end.
    - **Announcement**: a `run.end` hook (`id: "announce-async"`) calls `runtime.takeUnannounced(sessionId)`, which returns each async, tool-started delegation of the session once. A cancelled one and one already served (released) are never named. At most `MAX_ANNOUNCED_DELEGATIONS` (8) are named, then a count. `announceAsync: false` skips registration.
    - **Observability**: `instrumentation.ts` treats `delegate.activity` like `delegate.step`, and also keeps `kind` and `tool`. The text never reaches a span (`delegate_activity_becomes_a_bounded_span_event`).
    - **Findings.**
      - The default `announceAsync: true` changed what the scripted parents of four older async tests saw. The `package.test.ts` helper now sets `announceAsync: false` unless a test overrides it. `service.test.ts` passes `queueTimeoutMs: 0` to keep its immediate refusal. `delegate_cancel_disposes_child` showed that a cancelled delegation was announced, which is fixed in `cancel`.
      - Package events carry no session. A per-session package emit would be a kernel addition. It is not needed here, and it goes to the backlog with the whole-plan handoff.
    - **Tests.**
      - `depth.test.ts` (4): the two listed, plus `max_depth_one_keeps_the_child_away_from_delegate` and `max_depth_above_three_fails_the_load`.
      - `queue.test.ts` (6): 4 unit cases of the FIFO, plus the two listed.
      - `activity.test.ts` (7): the four listed, plus `other_reports_emit_no_activity`, `text_is_flushed_at_most_once_per_window` and `sync_delegations_are_never_announced`.
      - `observability/instrumentation.test.ts` (+1).
    - **Example.** `examples/delegate.ts` `demoTree`: root → `lead` (depth 1) → `worker` (depth 2) under `report: "stream"`. The run reports `totalTokens: 25` (all three levels), 1 grandchild, and activity attributed to `lead`/1 and `worker`/2.
    - **Baseline diff** (`arnilo__prism-extensions.txt`, this task only):
      - Added (`./delegate`): `DEFAULT_ACTIVITY_FLUSH_MS`, `DEFAULT_MAX_DEPTH`, `DEFAULT_QUEUE_TIMEOUT_MS`, `DELEGATE_TOOL_NAMES`, `DelegateActivityInput`, `DelegateActivityKind`, `HARD_MAX_DEPTH`, `HARD_MAX_QUEUE_TIMEOUT_MS`, `MAX_ANNOUNCED_DELEGATIONS`, `MAX_DELEGATE_ACTIVITY_TEXT_BYTES`, `SlotQueue`, `createActivityReporter`, `createSlotQueue`, `delegateActivityData`.
      - Changed: `DelegateConfig` (+`queueTimeoutMs?`, `announceAsync?`), `delegateConfigSchema` (`maxDepth` maximum 1 → 3, +`queueTimeoutMs`, +`announceAsync`).
      - Removals: none. Kernel baseline: no change.
    - **Budgets.**
      - Kernel ceilings: 1358833 packed / 4400376 unpacked / 45076 source lines (prior 1358128 / 4398422 / 45071). No kernel source changed; the growth is the CHANGELOG entry and the `docs/tools.md` text.
      - `extensions.unpackedBytes` baseline: 2096614 (prior 1977383). It was over its 5% tolerance after plans 229–232, since Task 4 rebaselined only `packedBytes`.
      - Both have dated reasons.
    - **Sweep.** `bun scripts/retired-names.mjs`: 0 hits. Nothing retired.
    - **Checks run.**
      - `bun run typecheck` passes.
      - `@arnilo/prism-extensions` test: 1122 pass, 0 fail, 53 skipped.
      - delegate, observability and advisor together: 225 of 225.
      - `@arnilo/prism-hosts` test: 932 pass, 0 fail.
      - `@arnilo/prism-agent` test: 69 pass, 0 fail.
      - `bun examples/delegate.ts` completes all three demos.
      - `biome lint` is clean on the touched files.
      - `release.mjs gate` fails only on the existing `@arnilo/prism-ai` version range.
      - The whole-plan verification (`bun run test`, `docs.test.ts`) and `Compromises Made` / `Further Actions` are not run yet.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/package-sessions.test.ts src/__tests__/nested-suspension.test.ts`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-agent test`
- `bun scripts/retired-names.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
