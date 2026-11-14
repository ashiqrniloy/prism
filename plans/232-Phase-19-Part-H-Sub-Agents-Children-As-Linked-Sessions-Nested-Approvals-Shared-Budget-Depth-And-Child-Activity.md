# Phase 19 Part H — sub-agents: children as linked sessions, nested approvals, shared budget, depth, and child activity

## Objectives

- Stop building and tearing down a whole agent per delegation. `createDelegateRuntime` calls `createAgent` for every delegation with the inherited package instances (`packages/extensions/delegate/src/runtime.ts:275-312`) and disposes it afterwards (`:423`), so each child re-runs every inherited package's `setup` (MCP connections, stores, language servers).
- Keep a child's transcript. The child agent's store is `createMemorySessionStore()` (`runtime.ts:302`); the transcript is discarded when the delegation ends and cannot be inspected or resumed.
- Make an approval inside a child answerable. A child that needs approval with no UI returns `suspended` and is then disposed, and the kernel refuses nested suspensions outright: "this kernel has no nested-run resume hook" (`src/agent-session/session/tool-round.ts:352-357`, `:496`). The machinery that once routed them is still shipped, deprecated and unreachable (`applyNestedRun`, `:131`; `suspendNested`, `:262`).
- Bound a child's spend by the parent's budget. Child usage appears only in the tool result's status line (`packages/extensions/delegate/src/tools.ts`).
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

- [ ] Task 1: Phase review (read-only)
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

- [ ] Task 2: Kernel — a package can open a linked session, and a run can charge a parent run
  - Acceptance Criteria:
    - Functional:
      - `PackageAPI.sessions.open(options)` opens a session on the same agent. It needs the new capability `"sessions"`. `options.parent.sessionId` is required and must name an open session of this agent; the kernel stamps the links entry (`SessionLinks`, including `delegationId`), inherits the parent's ownership scope, and refuses a wider one. Calling it during `setup` throws `state_not_ready`.
      - The returned object is a `Session`; closing the parent closes its open children.
      - `RunOptions.chargeTo?: SessionContext`: each usage the run records is also recorded on that session's active run (limits, run usage, ledger scope `child_run`). The target must be a session of the same agent and an ancestor by links, else the run fails closed before any turn. A breach on the parent aborts the child run.
      - A session's link depth is available to packages as `SessionContext.depth` (0 for a root).
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
      - `src/session-context.ts` (`depth`), `src/agent-session/session.ts`, `session/provider-round.ts` (mirrored usage), `src/models/ref.ts` (`RunOptions.chargeTo`)
      - `src/contracts-protocol.ts` (`UsageScope`)
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a `PackageAPI` member, a capability, a run option
    - Docs pages to create/edit:
      - `docs/packages.md`: `sessions.open`, the capability
      - `docs/agent.md`: `RunOptions.chargeTo`, session depth
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Kernel — a suspension inside a tool call suspends the parent and resumes through the tool
  - Acceptance Criteria:
    - Functional:
      - `ToolDefinition.resumeNested?(ref, decisions, context)` is the carrier the retired run-state surface used to provide. A tool that throws `AgentDelegationSuspendedError` (with the child run ref and its pending decisions) and defines `resumeNested` suspends the parent run: the parent's `run.suspended` lists the child's decisions with `attribution.path` naming the tool call and the child.
      - `session.resume(decisions)` on the parent calls `resumeNested` with the decisions for that child. It returns a tool result (the call settles and the parent continues) or a new suspension (the parent suspends again). Sticky `allow_for_run` / `reject_for_run` decisions are applied to later nested asks without a prompt, as for direct asks.
      - A tool that throws the error without `resumeNested` fails the call closed with the existing `ERR_PRISM_DECISION_INVALID`.
      - The deprecated functions are either used by this path or deleted: `applyNestedRun` and `suspendNested` lose `@deprecated` if used, and whatever remains unused is removed in this task and added to the retirement sweep.
      - Limits: attribution depth stays capped (`MAX_ATTRIBUTION_DEPTH`), pending decisions stay capped (`HARD_MAX_PENDING_DECISIONS`).
    - Performance: No cost on a run with no nested suspension.
    - Code Quality: One nested path; no parallel "legacy pending" branch left behind.
    - Security: A decision is routed only to the child named in its attribution; a decision for an unknown child fails closed. Decisions carry hashes and scopes, never arguments.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/tool-round.ts:37-48`, `:131-185`, `:262-300`, `:352-357`, `:450-520`
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

- [ ] Task 4: Delegate — a child is a linked session of the parent agent
  - Acceptance Criteria:
    - Functional:
      - A delegation opens a child session with `prism.sessions.open` and runs it with the child's model, instructions (the report contract plus the child's text), tool allow-list, limits, and `chargeTo` the parent. No `createAgent`, no provider bridge, no `packages.instances`.
      - `inherit` keeps its meaning for tools: the child's allow-list is the tools registered by the inherited packages (from the agent's tool→package view), narrowed by `tools.only`. The README states that hooks of every loaded package apply to a child, and how a package skips child sessions.
      - `skills`, `context` seeding, `isolation: "worktree"`, `resultMaxChars`, `hidden`, and `agentsRoot` children keep their behavior.
      - The child's transcript is in the agent's store and survives the delegation. `delegate_wait` on a finished child still pages its answer.
      - A child that suspends: a synchronous call throws `AgentDelegationSuspendedError` and implements `resumeNested` (Task 3); an asynchronous call reports `suspended` with the child session id, and the host resumes that session directly.
      - `ownership` in the package config is retired (the child inherits the parent session's scope); the config key fails the load with a message naming the replacement, and the name goes into the retirement sweep.
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
      - `apps/prism-agent/src/host/orchestrator.ts` and its scenarios
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
    - `sync_child_approval_suspends_and_resumes_through_the_parent`.
    - `async_child_suspension_reports_the_child_session_id`.
    - `child_usage_counts_against_parent_limits`.
    - `worktree_isolation_still_merges`.
    - `retired_ownership_key_fails_the_load`.
    - Package conformance and the reference host suite pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package behavior, capabilities, one retired config key
    - Docs pages to create/edit:
      - `packages/extensions/delegate/README.md`: rewritten "What it changes", capabilities, cost, failure behavior
      - `apps/prism-agent/README.md`: the orchestrator's child
      - `CHANGELOG.md`: `## [Unreleased]`, Changed and Removed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Delegate — depth, queueing, and visible child activity
  - Acceptance Criteria:
    - Functional:
      - `maxDepth` accepts 1–3 (default 1). A child sees `delegate` only when its depth is below `maxDepth` (a `when` predicate on `SessionContext.depth`). Every level charges its ancestors.
      - `maxConcurrent` counts running children across the tree. A call over the limit waits up to `queueTimeoutMs` (default 30,000; `0` restores the immediate error), in call order, and ends with the same `DelegateError` on timeout or abort.
      - `report: "stream"` emits `delegate.activity` package events on the parent session: child tool start and finish (name, call id, status, duration) and child text, flushed at most once per second and capped at 2 KiB per event, each with the delegation's `origin`. `milestones` and `on-complete` are unchanged.
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
      - `packages/hosts/ag-ui/src/…`, `devtools`: render `delegate.activity` if they render `delegate.step` today (Task 1 lists them)
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
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

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
