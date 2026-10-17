# Phase 16 Part B — Agent nodes, gates, fanOut, the merged stream, and the build workflow

## Objectives

- Make a workflow run a parent session. Persist node transitions on it, and emit them as `workflow.node.started`, `workflow.node.completed`, `workflow.node.failed`, `workflow.gate`, and `workflow.suspended`.
- Ship the orchestration node kinds from §2.12.13: `agentNode` (any `Agent`, `parent` links, optional `worktree`), `gateNode` (deterministic, routes on failure), `humanGate` (`host.ui`, or durable suspension without a UI), and `fanOut` (per-item routing, and concurrency that respects each subscription profile's `maxConcurrentRuns`).
- Give the UI one stream: `workflowRun.stream()` merges every child session's events with `origin`, and `steer(nodeId)` and `abort()` reach the children.
- Make the workflow durable: after a process kill, finished nodes are not re-run, suspended children resume, and unfinished nodes re-run under their idempotency policy.
- Ship `workflowCommand` and `workflowLoop`. Add origin-aware observability. Prove the phase with `examples/build-workflow.ts` and `examples/workflow-loop.ts`, and record the Phase 16 Done criteria.

## Expected Outcome

- A host registers `/build` with `workflowCommand` and starts it with `agent.commands.run("build", { goal }, { session })`. The workflow opens a parent session, runs Prism agents and driver agents as child sessions linked by `parent: { sessionId, agentId, workflowRunId }`, and emits `workflow.*` events.
- `run.stream()` yields every agent's events with the correct `origin`, including text and thinking deltas, tool calls, `agent.skill`, `agent.file` (`source: "diff"` for worktree nodes), vendor sub-agents, and notices.
- `fanOut` never runs more items on one profile than its `maxConcurrentRuns`. Items wait instead of failing with `profile_busy`.
- A failing `gateNode` routes back and is bounded by `maxSupersteps`. A `humanGate` without a UI suspends durably, and a later answer resumes it.
- A killed process resumes the workflow without re-running completed nodes.
- `workflowLoop(def)` fills the `loop` slot for single-agent workflows, and its tools are gated by `@arnilo/prism-approval`.
- Spans carry `origin` attributes, workflow spans parent their child sessions' spans, and the timeline groups steps by `origin`.
- `examples/build-workflow.ts` runs offline end to end on the mock provider and the `stream-cli` and `rpc-server` reference adapters over `createScriptedCli`, with all state in one SQLite file.

This plan implements roadmap **Phase 16 — Graph workflows across agents**, Part B. It depends on plan 168 (Part A), which ported the engine into `@arnilo/prism-workflows`, made `checkpoints` and `leases` service contracts, deleted the kernel copies, and recorded the phase review (plan 168 Task 1). Task 1 here is an **entry check**, not a second review: it confirms Part A landed as recorded and applies the review's decisions to Tasks 2–10. The approaches below follow plan 168 Task 1's *recommended* answers. Where the review decided otherwise, Task 1 amends the affected task before it starts. Running the build workflow live on real vendor binaries is the host's job, on its own adapters. This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`.

## Tasks

- [x] Task 1: Entry check — Part A as landed, and the review's decisions applied (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 168's Notes that each item below holds, citing `file:line`:
      - the ported engine's exports, the kept node kinds, `checkpoints`/`leases` contracts and conformance, the store services, the kernel deletions, the observability move, and the `runtime/workflows` deletion
      - the decisions recorded in plan 168 Task 1 on: services from a workflow (the three-argument `workflowCommand(prism, name, def, { args? })`), parent-session persistence (`prism.state.log`, **not** `session.subscribe`) and `workflow.*` emission (package events via `prism.events.emit`, live through Task 6's `run.stream()`), profile pacing (the cap is per agent instance, and `profile_busy` is message-only today), and observability (`rag-telemetry.ts` moves to `@arnilo/prism-observability`).
    - Functional: Record whether the user approved the optional one-line kernel change that would let `session.subscribe(parent)` carry `workflow.*` (plan 168 Task 1). If not approved, Task 2 stays on `prism.state.log` + Task 6's stream.
    - Functional: Amend Tasks 2–10 in place wherever a recorded decision differs from the approach written here. In particular:
      - the `workflowCommand` signature (Task 8)
      - the persistence mechanism (Task 2)
      - the `profile_busy` structured detail and any driver-kit change (Task 5)
    - Functional: Record the failing-test baseline (`bun run typecheck`, `packages/integrations/{workflows,observability}`, `packages/stores/sqlite`, `packages/drivers/process`, `src/driver-kit`, `src/__tests__/docs.test.ts`, `bun scripts/release.mjs gate`) and compare it with plan 168's close.
    - Functional: Record a verdict. If Part A left a contract different from what a task assumes, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every confirmation cites its span.
    - Security: Confirm the ported engine's checkpoint redaction still runs on node outputs before they reach the `checkpoints` service.
  - Approach:
    - Documentation Reviewed:
      - plan 168 (Notes, Compromises, Further Actions); roadmap §2.11, §2.12.13, §2.12.15, Phase 16
    - Options Considered:
      - A second full review. Rejected: plan 168 Task 1 reviewed both parts.
    - Chosen Approach:
      - Check, apply amendments, and record the baseline.
    - API Notes and Examples:
      ```bash
      graft skeleton packages/integrations/workflows/src/index.ts
      rg -n "CheckpointStore|LeaseStore" src   # must be empty
      ```
    - Files to Create/Edit:
      - `plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md`: Notes and amendments only.
    - References:
      - plan 167 Task 1 (entry check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Verdict: proceed with Part B on the amended contracts.** Part A's seven tasks are checked; its Task 7 verification (`plans/168-Phase-16-Part-A-Workflow-Engine-Checkpoint-And-Lease-Services.md:477-488`) records the landed engine and remaining inherited failures. This entry check changes only this plan; no runtime, tests, exports, baselines, or released docs were edited. Part A's Postgres restart proof remains deferred, so this is not a claim that its release gate is green.
    - **Engine and services confirmed.** The workflows barrel exports definitions/errors/events/graph/limits at `packages/integrations/workflows/src/index.ts:18-102`, the six kept node kinds plus the transitional `agentNode`/`fanOutNode` at `:103-112`, memory defaults at `:113-119`, replay/run/resume at `:120-130`, and service names/runtime at `:131-138`. `CheckpointStore`/`LeaseStore` and ownership/CAS/fencing shapes live in `packages/integrations/workflows/src/contracts.ts:29-112`; conformance entry points are `packages/integrations/workflows/src/testing.ts:148,257`. Store setup provides both services from the same persistence instance at `packages/stores/sqlite/src/index.ts:82-83` and `packages/stores/postgres/src/index.ts:132-133`; their conformance consumers are `packages/stores/sqlite/src/__tests__/workflow-services.test.ts:61-66` and `packages/stores/postgres/src/__tests__/workflow-services.integration.test.ts:56-61`. Runtime service lookup and memory fallback remain `packages/integrations/workflows/src/services.ts:26-36`.
    - **Retirements and observability confirmed.** `src/checkpoints.ts`, `src/leases.ts`, `src/agent-run-lifecycle.ts`, `packages/prism-core/src/runtime/workflows/`, and `packages/prism-core/src/governance/observability/` are absent, and both retired subpaths are absent from `packages/prism-core/package.json`. The literal `CheckpointStore|LeaseStore` sweep of `src/` has only retirement-test strings/comments and an install-smoke import of the workflows factory, not a kernel contract. The regression guard is `src/__tests__/kernel-no-checkpoints.test.ts:31-57`; Part A's removal notes are at `plans/168-Phase-16-Part-A-Workflow-Engine-Checkpoint-And-Lease-Services.md:490-501`. Workflow instrumentation, timeline/types, summaries, and the RAG tracer adapter are exported from `packages/integrations/observability/src/index.ts:63-104`. Task 9 extends these moved modules; it does not move them again.
    - **Security confirmed.** Before `store.saveCheckpoint`, `packages/integrations/workflows/src/checkpoints.ts:30-44` resolves the configured redactor and calls `prepareCheckpointRecord`; `packages/integrations/workflows/src/checkpoint-core.ts:87-100` bounds/redacts the checkpoint value through `packages/integrations/workflows/src/util.ts:78-81`. The output-specific helper also covers output, lastOutput, iteration outputs, and workflowInput (`packages/integrations/workflows/src/checkpoints.ts:203-230`). Ownership and fences are forwarded to the service (`:38-47`). Redaction is conditional on the configured redactor/secrets, as before; no redactor is silently invented by the runtime service getter.
    - **Review decisions applied.** Keep `workflowCommand(prism, name, def | () => def, { args? })` in Task 8; `PackageAPI.services` resolves at call time (`src/packages/api.ts:153-159`) and commands obtain their package-bound session (`src/agent-session/create-agent.ts:195-202`). Parent persistence stays `prism.state.log("workflow").append(ctx.session, record)` (`src/packages/api.ts:143-149`, `src/session/state.ts:222-228`). `prism.events.emit` remains the redacted package observe-hook path (`src/packages/loader.ts:619-627`), not parent-session delivery. **No user approval for the optional kernel subscriber change is recorded in plan 168 or this session; it is not authorized by this entry-check request and is not required.** Tasks 2 and 6 now consistently retire the old bus/callback consumers into a bounded package transition channel merged with public child `Session.subscribe`; the queue must apply transition redaction itself.
    - **Profile pacing decision applied.** Admission is still per guard instance (`src/driver-kit/guard.ts:72-77,129-138`; each agent constructs its guard at `src/driver-kit/define.ts:259-268`). `profile_busy` is message-only at `guard.ts:131`; `DriverError` exposes only code/control (`src/driver-kit/errors.ts:37-47`). Task 5 now requires the process-wide profile-home admission fix, structured profile detail, driver-kit regression test, and drivers documentation instead of calling them tentative. Task 7 explicitly preserves Part A's complete-decision-batch `session.resume` contract and avoids the retired nested approval carrier. Tasks 3, 4, 8, and 10 need no further review-decision amendment; Task 10 retains the roadmap/PRODUCT signature correction.
    - **Baseline (2026-10-13).** `bun run typecheck` exit **0**. `bun run --filter @arnilo/prism-workflows test`: **126 pass / 0 fail**; observability: **56/0**; SQLite: **41 pass / 1 fail**, the inherited `names the Bun runtime when the sqlite modules are imported under node`; process driver: **125/0**; `bun test --timeout=0 src/driver-kit`: **65/0**. `bun test --timeout=0 src/__tests__/docs.test.ts`: **149 pass / 21 fail**. `bun scripts/release.mjs gate`: exit **1**, `PRISM_TEST_POSTGRES_URL not set at release-evidence time`. Compared with Part A Task 7's close (`:487`) and Task 6's detailed debt list (`:423`), workflows/observability counts and the 21 docs failures match; the SQLite failure and release blocker are inherited. Process-driver and driver-kit totals establish the explicit Part B entry baseline. No new workflow contract failure was found. Logs: `/tmp/169-task1-{typecheck,workflows,observability,sqlite,process}-host.log`, `/tmp/169-task1-driverkit-unsandboxed.log`, `/tmp/169-task1-{docs,release}.log`.
    - **Docs failure inventory (21 inherited legs).** `all shipped markdown links resolve locally`; `phase 10 docs reconcile provider compatibility and RAG/memory trust surfaces`; `phase 6 docs cover SessionIndex, contextBudget, providers, steer, ask_user_decision, and goal/verify`; `phase 10 docs link security auth trust surfaces`; `sdk_readiness_gate_is_one_network_free_command_and_docs_separate_live_tests`; `current install, coverage, and SQL adapter docs match manifests and migrations`; `release_and_install_docs_list_every_core_export_subpath_and_current_session_api`; `system_prompt_docs_cover_agents_md_and_system_md_files_phase_31`; `provider conformance docs cover testing subpath and no network`; `docs_manifest_kinds_include_current_provider_primitives`; `readme_describes_current_runtime_provider_packages_cli_and_examples`; `081 open connector sidecar stays out of core and documents admission`; `phase48 release validation gates neuralwatt docs links and example presence`; `examples_demos_run_to_completion_and_emit_no_secret`; `tools_docs_cover_runtime_validator_seam_and_per_run_tool_scoping`; `context_and_skills_docs_cover_runtime_selection_and_activation`; `phase48 provider cache matrix covers every first-party provider and caveat`; `phase29_new_providers_cache_thinking_oauth_docs`; `ai_sdk_adapter_contract_is_documented`; `provider_validation_final_contract_covers_all_adapters_and_binding_sites`; `offer reset: README pointer`.
    - **Environment and limits.** Initial sandbox driver-kit socket failures disappeared outside the sandbox. Sandbox build/test lock checks used isolated PIDs and could not establish a valid baseline; those processes were stopped and their stale lock/reader marker cleared with approval, then the successful host runs above were used. Postgres integration/restart fixtures and the whole-plan examples were not run for this read-only entry check. Inherited docs/SQLite/release failures are recorded, not repaired here.

- [x] Task 2: The workflow run as a parent session, with `workflow.*` events
  - Acceptance Criteria:
    - Functional: Starting a workflow takes the caller's bound parent `SessionContext` on the host agent. The run id is the `workflowRunId`. `workflowCommand` (Task 8) opens/binds a parent when the caller has not supplied one; the public `Session` handle cannot itself be passed to `state.log`.
    - Functional: Each node transition is persisted, and survives a process restart, through the mechanism plan 168 Task 1 chose. It is emitted as a package event from `@arnilo/prism-workflows` named `workflow.node.started`, `workflow.node.completed`, `workflow.node.failed`, `workflow.gate`, or `workflow.suspended`. The payload is bounded JSON: `workflowRunId`, `nodeId`, `attempt`, `superstep`, and `status`, plus `childSessionId`, `route`, or `reason` where they apply.
    - Functional: Persistence uses `prism.state.log("workflow").append(ctx.session, record)` on the parent session's branch (plan 168 Task 1: `prism.state.log` persists a `package_state` entry and works from `workflowCommand.run`'s bound `ctx.session`; `prism.events.emit` is dropped outside a run, so it is the host-observe-hook channel only). Live delivery is Task 6's `run.stream()`, which merges the workflows package's own transition channel with the child sessions' events. **`session.subscribe(parent)` is not a delivery path** and this clause is dropped; if the user requires it, the kernel needs `prism.events.emit` to reach agent subscribers plus a session-scoped variant (plan 168 Task 1), approved before this task starts.
    - Functional: The 0.12 `WorkflowEventBus` (`createWorkflowEventBus`) and `onEvent` callback are retired in this task if the ported engine still exposes them, and their callers move to the workflows package's transition channel plus child session subscriptions (Task 6). Sweep: `rg -n "createWorkflowEventBus|WorkflowEventBus|onEvent" packages/integrations/workflows examples`.
    - Performance: One persisted record per node transition, never one per child event. The README states the per-node write count.
    - Code Quality: No new catalog event. The names live in one exported constant (`WORKFLOW_EVENTS`).
    - Security: Payloads carry ids and statuses only, never node inputs or outputs, and pass through the package-event redaction (`src/packages/loader.ts:619-627`).
  - Approach:
    - Documentation Reviewed:
      - plan 168 Task 1 decision on persistence and emission; `src/packages/loader.ts:619-627`; `PackageAPI.state.log` (`src/packages/api.ts:137-148`); `docs/next/events.md` (package events)
    - Options Considered:
      - Catalog events `workflow.*`. Rejected: the catalog is frozen, and §2.12.13 adds no catalog rows.
      - Persist only to the `checkpoints` service. Rejected unless plan 168 chose it: the parent session's transcript should show node transitions for search and replay.
    - Chosen Approach:
      - Package events, persisted through `prism.state.log` as the review decided. Emission and persistence go through one helper so they cannot diverge, and Task 6's merged stream carries the live side.
    - API Notes and Examples:
      ```ts
      const run = startWorkflow(build, { goal }, { prism, session: ctx.session, checkpoints: runtime.checkpoints });
      for await (const e of run.stream()) if (e.type === "package.event" && e.name.startsWith("workflow.")) render(e);
      await run.result();
      ```
    - Files to Create/Edit:
      - `packages/integrations/workflows/src/{parent-session,events,services,types,index}.ts`: parent handle, bounded channels, runtime-owned log/emission, options, exports, and capability.
      - `packages/integrations/workflows/src/run/*.ts`: emit on each transition.
      - `packages/integrations/workflows/src/__tests__/parent-session.test.ts`: new.
      - `packages/integrations/workflows/README.md`: "Events" section.
      - Workflow callback consumers in `src/__tests__/docs.test.ts`, workflows/observability tests, six workflow examples, `examples/README.md`, the two workflow benchmark scenario modules, and coding's `goal-verify.ts`: async channel subscriptions/options.
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`: regenerated; tools-coding baseline regenerated and unchanged.
    - References:
      - roadmap §2.12.13 ("The workflow run is a parent session")
  - Test Cases to Write:
    - `node_transitions_emitted_in_order`: started → completed for a two-node DAG. Fails on a missing or reordered event.
    - `node_failure_emits_failed_with_reason`.
    - `transitions_persisted_across_restart`: a new agent over the same SQLite file reads the transitions.
    - `workflow_event_payload_has_no_node_io`: fails if an input or output value appears in a payload.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new events and a new parent-session behavior.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`: events table and per-node write cost.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Completed on the entry-check contracts.** `startWorkflow(def, input, { prism, session: ctx.session, ...options })` takes the caller's bound host context and returns `WorkflowRun` (`id`, `parentSessionId`, `stream()`, `result()`). This is the Task 6 handle's initial transition-only implementation. A public `Session` is not a `SessionContext`; automatic parent opening/binding belongs to Task 8's command, rather than a kernel change or an internal-session cast. The headless `runWorkflow` entry point remains available.
    - **Persistence and ownership.** `parent-session.ts` centralizes Kahn/superstep transitions. Each record appends through the workflows runtime's lazily declared `state.log("workflow")`, then supplies the stored/redacted data to that runtime's own `prism.events.emit` and the bounded package channel. Calling from another package's command therefore still writes/emits under `@arnilo/prism-workflows`. Writes serialize per bound parent context, including concurrent workflows. An append rejection prevents the node from executing and prevents that live event. No kernel catalog or subscriber change was made.
    - **Payload and cost.** The five names are exported in `WORKFLOW_EVENTS`. Metadata is limited to 16 KiB and contains ids, attempts, supersteps, statuses, selected successor ids, and fixed reason codes (`node_failed`, `review_required`); error messages, review text/data, inputs, and outputs never enter the parent event. Successful, failed, and suspended executed nodes cost two parent records; skipped nodes cost one; current conditional/route decisions add one gate record. Checkpoint writes are separate, and child events add no parent writes. The README documents the cost, close-on-overflow behavior, restoration, and the two channels. Task 4 adds the new gate node kinds and their pass/failure codes; Task 6 adds child merging/steering/abort; Task 7 adds kill/resume orchestration.
    - **Retirement.** Removed the engine's `onEvent` option and the old event-bus export/type with no aliases. Scheduler diagnostics now flow through `createWorkflowTransitionChannel(...).subscribe()`; persisted package events flow through `.stream()`. Child diagnostic events use public child subscriptions. Migrated the tests, examples, workflow benchmark consumers, observability test, coding goal/verify option, and the docs example guard. Local collector helpers consume an async subscription rather than giving the engine a callback. The requested workflow/examples sweep leaves only `examples/docker-process-session.ts`'s unrelated process-session `onEvent`. The repo-wide retired-name sweep leaves released `docs/workflows.md`, the historical plan-168 removal notes in `docs/migration.md`, and the prism-core changelog; these released/history statements were not rewritten. The old example guard in `docs.test.ts` was updated to require the new channel, `for await`, and `transitions` instead.
    - **Checks.** `bun run typecheck`: exit **0** (includes core/family builds, workspace checks, and example compilation); final workflows package typecheck: **0**. Workflows: **135 pass / 0 fail**, including the nine new parent tests; the final concurrent-parent variant also passes in the focused **9/0** rerun. Observability: **56/0**. Coding goal/verify: **3/0**. Focused workflow-loop benchmark: **3/0**; parallel workflow agent-node benchmark: **1/0**; docs workflow-example guard: **1/0**. All six migrated examples exit **0** (`workflow-event-sink`, `workflow-sqlite-resume`, `execution-timeline`, `workflow-research-and-review`, `workflow-parallel-research`, `cyclic-reflection`). New tests prove transition order, failure reasons, no node I/O, SQLite close/reopen with a new agent, suspension privacy, redaction, gate routing ids, failed-write admission, and correct namespace/payloads for concurrent host-command runs.
    - **Inherited/broader failures.** SQLite stays **41 pass / 1 fail**, the same Node import/runtime-name test as Task 1. `bun scripts/release.mjs gate --update-baseline` stops at the same missing `PRISM_TEST_POSTGRES_URL` preflight. A broader two-file benchmark run was **10 pass / 2 fail**: its manifest evidence matrix misses `@arnilo/prism-acp`, and unrelated independent-session/history p95 budgets fail on this loaded host. The workflow cases pass both there and in focused reruns. No benchmark thresholds or evidence inventory were changed. The full docs suite and Postgres integration were not rerun for this task; Task 1's 21 inherited docs failures remain the recorded baseline. Logs are `/tmp/169-task2-*.log`.
    - **Compatibility.** Because release preflight blocks before declaration checks, ran the existing lower-level `runGates` with `updateBaseline: true`, `skipTarball: true`, and `packageName` separately for workflows and tools-coding. Both pass. Tools-coding's regenerated baseline is byte-for-byte unchanged. The workflows declaration delta is below; the two removals implement this task's explicit retirement, and the helper signature changes await persistence:
      ```text
      - WorkflowEventBus
      - createWorkflowEventBus
      + WORKFLOW_EVENTS
      + WorkflowTransitionChannel
      + createWorkflowTransitionChannel
      + startWorkflow
      + WorkflowRun, StartWorkflowOptions, WorkflowParentSession, WorkflowPackageEvent
      + createWorkflowEmitter (internal module declaration, not a root export)
      ~ applyConditionalSkip, applyRouteSkip, skipNode: async emission
      ~ persistCheckpoint, releaseSuccessors, runNode: Promise-returning emitter/channel types
      ```
      Runtime contracts additionally expose the owning `log` and `events`; `RunWorkflowOptions` replaces `onEvent`/`eventBus` with `parent`/`transitions`. The baseline's existing one-line interface serializer does not report member-only changes, so they are recorded explicitly here. Full release/tarball/Postgres verification remains blocked/deferred as above; this is not a green release claim.

- [x] Task 3: `agentNode` with `parent` links and `worktree`
  - Acceptance Criteria:
    - Functional: `agentNode({ agent, session?, input, runOptions?, worktree?, output? })` runs any `Agent`, including driver agents. It opens the child session with `parent: { sessionId: <parent>, agentId: agent.id, workflowRunId }` (K4), unless `session` supplies one. `input(ctx)` builds the prompt. `output(result, ctx)` maps the `RunResult` to the node output, defaulting to the final assistant text.
    - Functional: With `worktree: true`, the node:
      - creates a worktree through the `workspace` service (`worktree.create({ sessionId: child.id })`)
      - binds it so the child's tools and driver resolve `prism.workspace.root` to it
      - on completion, records `workspace.diff(path)` as `agent.file` events with `source: "diff"` on the child session through the driver kit's file-activity shape
      - records the worktree path and branch in the node output for the merge gate
    - Functional: `worktree: true` without a `workspace` service fails the node with `WorkflowRuntimeError` code `missing_service` naming `workspace`. It never silently runs in the main tree.
    - Functional: A child run that suspends (an approval) suspends the workflow with `workflow.suspended` naming the node and child session.
    - Functional: The 0.12 `agentNode` machinery (ported internally in plan 168 Task 2) is deleted. Sweep: `rg -n "AgentNodeDefinition" packages/integrations/workflows` matches only the new type.
    - Performance: One child session per node attempt. One `diff` call per worktree node, bounded by the service's `maxFiles`/`maxBytes`.
    - Code Quality: The node sees only the public `Agent`/`Session` API. No adapter or vendor name appears in `packages/integrations/workflows/src/`, enforced by a grep test.
    - Security: Diff content goes through the child session's redaction as an observed event. The worktree is disposed per the node's policy (`keep` until the merge gate by default), and the README states who disposes it.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/README.md` "Workspace service" and "Worktree roots for one session"; `src/contracts-core/session.ts:102-151`; `src/driver-kit/normalize/diff.ts` (`mapDiff`); plan 165 Further Actions ("a worktree is not disposed when its session closes")
    - Options Considered:
      - The node calls the driver directly. Rejected: the engine sees only `Agent`s (§2.12.7).
      - The workflow emits `agent.file` itself. Rejected: §1.4 says only `RunController` primitives emit catalog-shaped activity. Recommended: route through the child's driver capture when the child is a driver agent, and through a documented `package.event` otherwise. Confirm the path in Task 1.
    - Chosen Approach:
      - Open the session with links. Bind the worktree before the run and diff after it.
    - API Notes and Examples:
      ```ts
      agentNode({ agent: uiEngineer, worktree: true, input: (ctx) => ctx.item.prompt, output: (r) => ({ text: r.text }) })
      ```
    - Files to Create/Edit:
      - `packages/integrations/workflows/src/nodes/agent-node.ts`: new.
      - `packages/integrations/workflows/src/run/node-execution.ts`: dispatch.
      - `packages/integrations/workflows/src/__tests__/agent-node.test.ts`: new.
      - `packages/integrations/workflows/README.md`.
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`: regenerated.
    - References:
      - roadmap §2.12.13 `agentNode`; §2.12.14
  - Test Cases to Write:
    - `agent_node_child_session_has_parent_links`: `createSessionIndex(store).list({ workflowRunId })` returns the child.
    - `agent_node_runs_driver_agent`: on the `stream-cli` reference adapter over `createScriptedCli`.
    - `worktree_node_records_diff_as_agent_file`: a scripted edit produces an `agent.file` with `source: "diff"`.
    - `worktree_without_workspace_service_fails_closed`.
    - `child_suspension_suspends_workflow`.
    - `workflows_source_names_no_vendor`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new node kind.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`: `agentNode` section with the worktree lifecycle.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Implemented.** `agentNode({ agent: Agent, session?, input?, runOptions?, worktree?, output?(result, ctx) })` replaces the 0.12 string-named node. The executor is `packages/integrations/workflows/src/nodes/agent-node.ts` (dispatched from `run/node-execution.ts`; input coercion moved to `nodes/agent-input.ts`). `RunWorkflowOptions.agentFactory` is deleted with no alias, and `scoped.ts` maps the new `session`/`output` shapes. The child session opens with `parent: { sessionId: <host parent session>, agentId: agent.id, workflowRunId }`; the `sessionId` is omitted for a headless `runWorkflow`. A suspended child returns the engine's `suspend({ reason: "child_session_suspended", data: { nodeId, childSessionId } })`, which the existing path turns into `workflow.suspended`.
    - **Worktree path (amends the approach).** The `workspace` service is consumed through the host parent's `PackageAPI` and typed structurally (`WorkspaceLike`), so this package imports no tools package. Missing service or no host parent fails with `WorkflowRuntimeError` code `missing_service`. A session cannot emit `agent.file` outside a run (only `RunController.observe` can, `src/loop/types.ts:102-111`), so the diff is emitted as `agent.file` **package events** from the workflows runtime (`source: "diff"`, plus `sessionId`/`workflowRunId`/`nodeId`), not as events on the child session. Task 6's merged stream must pick them up from the package channel. The node output becomes `{ output, worktree: { path, branch, truncated } }`. Disposal: `keep` by default, `{ dispose: "dispose" }` force-disposes at node end.
    - **Tests deferred.** `agent_node_runs_driver_agent` (stream-cli over `createScriptedCli`) and a real-git `agent.file` diff are not in `agent-node.test.ts`: the scripted-CLI harness lives in `@arnilo/prism-driver-process`, and importing it would add a package dependency this task does not authorize. They are covered by Task 6's `merged_stream_carries_every_agent_with_origin` and Task 10's example. Added instead: `agent_node_child_session_has_parent_links`, `worktree_node_records_diff_as_agent_file` (fake `workspace` service; asserts create/diff/dispose order and one `source: "diff"` event), `worktree_without_workspace_service_fails_closed`, `child_suspension_suspends_workflow` (an `askEveryTool` child), and `workflows_source_names_no_vendor` (word-boundary scan of `src/`, excluding tests).
    - **Callers migrated.** Three workflow test files, nine examples (`execution-timeline`, `workflow-event-sink`, `workflow-multimodal-document`, `workflow-research-and-review`, `workflow-parallel-research`, `workflow-sqlite-resume`, `crew-hierarchy` (now `createCrewWorkflow(managerAgent)`), `cyclic-reflection` (now `createCyclicReflectionWorkflow(reviewerAgent, maxSupersteps)`)), `scripts/benchmark-scenarios/multi-agent-runtime.mjs`, and `scripts/obscura-host-conformance.test.mjs`. Output mappers that read `ctx.session.entries()` now read `result.text`. Sweeps: `agentFactory` in `packages/integrations examples scripts src` is empty; `AgentNodeDefinition` appears only as the new type and its users.
    - **Checks.** `bun run typecheck` exit **0**. Workflows: **140 pass / 0 fail** (135 + 5 new). All eight migrated examples exit **0**. `scripts/obscura-host-conformance.test.mjs`: **5/0**. Docs workflow-example guard: **1/0**. `scripts/benchmark-multi-agent.test.mjs`: **8 pass / 1 fail**, the inherited evidence-matrix `@arnilo/prism-acp` miss from Task 2. Not rerun: full docs suite, Postgres, `release.mjs gate` (blocked on `PRISM_TEST_POSTGRES_URL`).
    - **Baseline.** Ran `runGates` with `updateBaseline`, `skipTarball`, `packageName: "@arnilo/prism-workflows"`; only `arnilo__prism-workflows.txt` changed (file mtimes confirm). Delta: `+ AgentNodeWorktree`, `+ AgentNodeWorktreeOutput`; `~ AgentNodeDefinition` (`agent: string` → `Agent`, new `session`/`runOptions`/`worktree`, `output(result, ctx)`); `~ RunWorkflowOptions` (`- agentFactory`). The serializer's one-line interface format does not show the member-level change, so it is recorded here.
    - **README.** Added an `agentNode` section (links, worktree lifecycle, who disposes, cost) and the node-kind table row.

- [x] Task 4: `gateNode` and `humanGate`
  - Acceptance Criteria:
    - Functional: `gateNode({ check, onFail? })` runs a deterministic function `check(ctx) → { pass: true, output? } | { pass: false, reason, route? }`. A failure routes to `route`, or by default to the gate's predecessor. Each failure emits `workflow.gate` with `pass` and `reason`. The loop is bounded by `limits.maxSupersteps` and the node's `maxIterations`. Exceeding either fails the run with `WorkflowSuperstepLimitError` or `WorkflowLoopLimitError`.
    - Functional: A gate never calls a model. The gate context has no model client, and a test with a provider that throws on any call proves it.
    - Functional: `humanGate({ request })` sends `request` (any `HostUi` kind except `terminal`) through `host.ui`. `answered` stores the answer as the node output. `dismissed` fails the gate, which then routes like a failed `gateNode`. With no UI, or an `unavailable` answer, the workflow suspends durably with `workflow.suspended`. `resumeWorkflow(runId, { [nodeId]: answer })` continues it.
    - Functional: A `humanGate` on an agent without the `host-ui` capability fails at definition time with `WorkflowDefinitionError`.
    - Performance: A gate adds no store write beyond its transition record.
    - Code Quality: A check that throws counts as a failed gate with reason `check_threw`, never as a passed one (fail closed, §1.4).
    - Security: The `humanGate` request carries the workflows package name (kernel-stamped). An answer of kind `secret` is rejected: a gate never collects secrets.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.13 `gateNode`/`humanGate`, §2.3 `HostUi` kinds; `docs/next/host.md`; the ported `routeNode`/`loopNode` cycle logic and `limits.ts`
    - Options Considered:
      - Build gates on `conditionalNode`. Rejected: a gate needs fail-closed throw semantics and its own event, so it gets its own node kind that reuses the cycle scheduler.
    - Chosen Approach:
      - Two node kinds on the ported superstep scheduler. `humanGate` reuses the engine's `suspend` primitive (`run/main.ts:81`).
    - API Notes and Examples:
      ```ts
      planOk: gateNode({ check: (ctx) => validatePlan(ctx.outputs.plan) }),
      approve: humanGate({ request: { kind: "confirm", title: "Execute this plan?" } }),
      ```
    - Files to Create/Edit:
      - `packages/integrations/workflows/src/nodes/{gate-node,human-gate}.ts`: new.
      - `packages/integrations/workflows/src/__tests__/{gate-node,human-gate}.test.ts`: new.
      - `packages/integrations/workflows/README.md`.
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`: regenerated.
    - References:
      - roadmap "Out of scope": gates that use a model's judgment
  - Test Cases to Write:
    - `gate_failure_routes_back_once_then_passes`: the Done criterion "routes back within `maxSupersteps`".
    - `gate_loop_exceeds_max_supersteps`.
    - `gate_never_calls_model`.
    - `gate_check_throw_is_failure`.
    - `human_gate_answered_inline` (scripted `HostUi`).
    - `human_gate_without_ui_suspends_then_resumes`.
    - `human_gate_rejects_secret_kind`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two node kinds.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`: gate sections and the suspension behavior.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Implemented.** Two new node kinds on the superstep scheduler: `gate` and `human_gate` (`types.ts`, `define.ts`, factories `gateNode`/`humanGate` in `nodes.ts`, execution in `nodes/gate.ts`, dispatch in `run/node-execution.ts`). A graph with either kind runs on supersteps, like one with a `routeNode`. A gate's stored output is `{ pass: true, output? }` or `{ pass: false, reason, route: [ids] }`. Activation: a pass activates the declared successors except the failure target; a failure activates only the failure target (`route`, else `onFail`, else the predecessor). The target must be a declared successor (the back edge), else `WorkflowRuntimeError` `ERR_PRISM_WORKFLOW_ROUTE_TARGET`. The node it returns to needs `activation: "any"` and an entry node upstream (findings that the plan's example did not show; the README says so).
    - **Bounds and fail-closed.** A back edge already requires `limits.maxSupersteps` (`WorkflowSuperstepLimitError`); the gate's own `maxIterations` (default and cap `HARD_MAX_LOOP_ITERATIONS` = 64) throws `WorkflowLoopLimitError`. A throwing or malformed `check` is a failed gate (`check_threw` / `check_invalid`, error text dropped). No model client reaches a gate.
    - **`humanGate`.** Requests go through the workflows package's own `host.ui` (`WorkflowRuntime` gained `host`; the manifest now declares `host-ui`), so the kernel stamps the package name. `humanGate()` throws `WorkflowDefinitionError` for `terminal` and `secret` kinds. `answered` becomes the output; `dismissed` fails the gate; no UI or `unavailable` suspends with reason `human_gate_unavailable`; `resumeWorkflow` with `resume.input` is the answer (the existing resume contract, rather than the plan's `{ [nodeId]: answer }` shape).
    - **Deviations from the task text.** (1) The "no `host-ui` capability" check cannot run at `defineWorkflow` (a definition has no package); it runs when the gate first asks, converting the kernel's `capability_missing` into `WorkflowDefinitionError`. That path has no dedicated test. (2) A `confirm` answer of `false` is a failed gate with reason `declined`, not a pass with output `false` (fail closed). (3) `workflow.gate` is emitted on every gate finish with `pass`, and with `reason` (256 chars, redacted) and `route` on failure; the reason is author text, so a check must not put node I/O in it (documented). Task 2's `workflow_event_payload_has_no_node_io` covers function nodes only.
    - **Tests (11 new).** `gate-node.test.ts`: `gate_failure_routes_back_once_then_passes`, `gate_loop_exceeds_max_supersteps`, `gate_exceeds_max_iterations`, `gate_never_calls_model`, `gate_check_throw_is_failure`, `gate_without_back_edge_fails_closed`, `human_gate_rejects_secret_kind`. `human-gate.test.ts`: `human_gate_answered_inline` (scripted `HostUi`, asserts the stamped package), `human_gate_declined_routes_back`, `human_gate_dismissed_fails_gate_and_routes`, `human_gate_without_ui_suspends_then_resumes`. `gate_never_calls_model` proves the throwing provider is never reached by a gates-only workflow, which is the structural guarantee (the context has no model), not a runtime interception.
    - **Checks.** `bun run typecheck` exit **0**. Workflows: **151 pass / 0 fail** (140 + 11). Docs workflow guard **1/0**, obscura script **5/0**, examples `workflow-event-sink`, `cyclic-reflection`, `crew-hierarchy` exit **0**. Not rerun: full docs suite, Postgres, `release.mjs gate` (blocked on `PRISM_TEST_POSTGRES_URL`).
    - **Baseline.** `runGates` with `updateBaseline`/`skipTarball`/`packageName` for the workflows package only. Added root exports: `gateNode`, `humanGate`, types `GateCheckResult`, `GateNodeDefinition`, `GateNodeOutput`, `HumanGateNodeDefinition`, `HumanGateRequest`; changed types `WorkflowNodeKind` (`+ "gate" | "human_gate"`), `WorkflowNodeDefinition` (two members), `WorkflowRuntime` (`+ host`). The one-line serializer also lists the internal `nodes/gate` module declarations. No removals.
    - **README.** Added a Gates section and the two node-table rows; the Capabilities section now lists `session-state` and `host-ui`.

- [x] Task 5: `fanOut` with routing and profile pacing
  - Acceptance Criteria:
    - Functional: `fanOut({ items, route, maxConcurrency })` evaluates `items(ctx)` to a bounded list (at most `maxFanOut`) and calls `route(item, index)`, which returns an `agentNode` (or another node definition). It runs at most `maxConcurrency` items at once, and its output is the item results in item order.
    - Functional: Profile pacing. An item whose run start fails with `DriverError` code `profile_busy` is re-queued, not failed. It starts when a node holding that profile finishes, or after a bounded backoff when the holder is outside the workflow. The workflow never surfaces `profile_busy`, and never has more runs active on one profile than its `maxConcurrentRuns`.
    - Functional: Plan 168 Task 1 **confirmed** the cap is counted per agent instance (`active` is local to `createPolicyGuard`, `src/driver-kit/guard.ts:76`; each `driverPackage` builds its own guard, `src/driver-kit/define.ts:261`). The driver kit's admission count therefore becomes process-wide and keyed by the profile's home in this task, so two agents on one profile share one cap, with a driver-kit test.
    - Functional: Plan 168 Task 1 **confirmed** `profile_busy` carries the profile only in its message (`src/driver-kit/guard.ts:131`) and `DriverError` has no profile field (`src/driver-kit/errors.ts:40-49`). Add the structured detail in this task — recommended: an optional `profile?: string` on `DriverError`, set at `guard.ts:131` — so the engine never parses a message.
    - Functional: The old `fanOutNode` machinery is deleted. Sweep: `rg -n "fanOutNode|FanOutNodeDefinition" packages examples`.
    - Performance: Waiting items hold no process and no session. A bounded backoff (documented default) avoids a busy loop.
    - Code Quality: The engine imports `DriverError` only as a type guard on `code`, through `@arnilo/prism/driver-kit`. No vendor names.
    - Security: Admission is checked before spawn (`guard.ts:110-149`), so a waiting item never starts a vendor process. A profile bound to another principal still fails, and is not retried.
  - Approach:
    - Documentation Reviewed:
      - `src/driver-kit/guard.ts:72-175`, `src/driver-kit/define.ts:246-270`, `src/driver-kit/errors.ts:2-34`; plan 168 Task 1 profile-pacing decision; the ported `run/scheduler.ts` concurrency
    - Options Considered:
      - Read the cap ahead of time through `agent.inspect()`. Rejected: `AgentInspection` has no driver section (`src/agent/inspect.ts:42-69`), and adding one is a kernel addition that the retry path does not need.
      - Fail the item with `profile_busy`. Rejected: §2.12.13 says the item waits.
    - Chosen Approach:
      - Retry on a structured `profile_busy`, woken by sibling completion, plus the required process-wide driver-kit cap fix confirmed by the review.
    - API Notes and Examples:
      ```ts
      execute: fanOut({ items: (ctx) => ctx.outputs.plan.tasks, maxConcurrency: 3,
        route: (task) => agentNode({ agent: task.ui ? uiEngineer : host, worktree: true, input: () => task.prompt }) }),
      ```
    - Files to Create/Edit:
      - `packages/integrations/workflows/src/nodes/fan-out.ts`: new.
      - `packages/integrations/workflows/src/__tests__/fan-out.test.ts`: new.
      - `src/driver-kit/{guard,errors}.ts` and `src/driver-kit/__tests__/auth.test.ts`: required by the confirmed review findings.
      - `docs/next/drivers.md`: document the changed cap scope and structured error detail.
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`, and `arnilo__prism.txt` if driver-kit types change: regenerated.
    - References:
      - roadmap §2.12.13 `fanOut`; §2.12.16 "Concurrency"
  - Test Cases to Write:
    - `fan_out_never_exceeds_profile_cap`: six items on a `maxConcurrentRuns: 2` profile. A counter in the scripted CLI records peak concurrency ≤ 2. This is the Done criterion.
    - `fan_out_item_waits_instead_of_profile_busy`.
    - `fan_out_respects_max_concurrency`.
    - `fan_out_routes_per_item`: UI items to one agent, others to another.
    - `two_agents_share_profile_cap` (required driver-kit regression test).
    - `profile_principal_mismatch_not_retried`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new node kind, and possibly driver-kit error detail.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`: `fanOut` and pacing.
      - `docs/next/drivers.md`: `profile_busy` detail and the cap scope, if changed.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Driver kit.** The admission count is now one process-wide map keyed by the profile's home (`src/driver-kit/guard.ts`, `activeByHome`), so two agents or guards on one profile share one `maxConcurrentRuns` cap; `inspect().activeRuns` reads the same map. `DriverError` gained an optional 4th constructor argument and `profile?: string` field, set on `profile_busy`. `docs/next/drivers.md` documents both. New regression test `two_agents_share_profile_cap` in `src/driver-kit/__tests__/auth.test.ts`. `src/driver-kit`: **66 pass / 0 fail** (was 65); process driver: 125/0.
    - **Engine.** `fanOut({ items, route, maxConcurrency, maxFanOut, maxProfileBackoffMs })` (`packages/integrations/workflows/src/nodes.ts`, kind stays `fan_out`) replaces `fanOutNode` with no alias; `map` is gone and `mapPool` was deleted. `route(item, index, ctx)` must return an `agent`, `function`, or `workflow` node (anything else fails with `ERR_PRISM_WORKFLOW_FANOUT`); an item that suspends fails the node. Items run as `<nodeId>[<index>]` so concurrent agent items keep distinct child-session entries. The pool is `nodes/fan-out.ts` (`runFanOutPool`): a `profile_busy` item (detected by structured `code`, also through `cause`) is re-queued behind the others and holds no slot, process, or session; when every queued item has met a busy profile the runner waits for a sibling completion or a backoff (100 ms doubling to `maxProfileBackoffMs`, default 2000), leaving no timer behind. Any other error (including `profile_principal_mismatch`) stops further starts and fails the node. `DriverError` is used only as a type through `@arnilo/prism/driver-kit`.
    - **Migrations.** Tests in `run.test.ts` and `cyclic-execution.test.ts`, `examples/workflow-parallel-research.ts` (local const renamed `topicFan`; node id unchanged), `examples/crew-hierarchy.ts`, and `scripts/benchmark-scenarios/multi-agent-runtime.mjs` now use `fanOut` with `functionNode` routes. README gained a `fanOut` section with pacing. Released `docs/workflows.md` still names `fanOutNode` (released doc, not rewritten); the retirement sweep otherwise finds no `fanOutNode` in `src/ packages/ examples/ scripts/`.
    - **Tests.** New `fan-out.test.ts` (7): `fan_out_never_exceeds_profile_cap` (six items, cap 2, real `createPolicyGuard`, peak 2), `fan_out_item_waits_instead_of_profile_busy` (holder outside the workflow), a two-guard shared-cap case, `fan_out_respects_max_concurrency`, `fan_out_routes_per_item`, `profile_principal_mismatch_not_retried` (one attempt), and route/definition validation. Items there are function nodes that acquire real guard leases; an end-to-end scripted-CLI agent-item run is left to Task 10's example.
    - **Checks.** Workflows **158 pass / 0 fail**; `bun run typecheck` exit 0; both examples exit 0; docs suite unchanged at 149/21 (inherited). Root `bun run build` was needed first so the workflows tests see the rebuilt driver-kit dist.
    - **Baseline.** `runGates({ updateBaseline, skipTarball, packageName })` for workflows: removed `fanOutNode`; added `fanOut`, `FanOutItemNode`, and the module-level `DEFAULT_MAX_PROFILE_BACKOFF_MS`, `isProfileBusy`, `runFanOutPool` (the baseline lists per-module exports, not only the barrel; they are not re-exported from `index.ts`). `arnilo__prism.txt` is unchanged by this task (driver-kit is not in that baseline). Release preflight itself still blocks on `PRISM_TEST_POSTGRES_URL`.

- [x] Task 6: The merged `stream()`, `steer(nodeId)`, and `abort()`
  - Acceptance Criteria:
    - Functional: `startWorkflow(...)` returns a `WorkflowRun` with:
      - `id` and `parentSessionId`
      - `stream()`: an async iterator that merges the workflows package's own `workflow.*` transition channel (Task 2) with every child session's events in arrival order. Each child event keeps its `origin` (K3), including external sub-agent scopes and thinking deltas.
      - `steer(nodeId, input)`: calls `session.steer()` on that node's active child sessions. An inactive node fails with `WorkflowRuntimeError` code `node_not_running`.
      - `abort(reason?)`: aborts every active child and marks the run aborted. Each driver child stops within its abort ladder.
      - `result()`: the final `WorkflowRunResult`.
    - Functional: A child that starts after `stream()` was opened is subscribed when it starts. No child event is lost between session open and subscription.
    - Functional: A slow consumer is bounded by the kernel's `SubscribeOptions` (`maxQueuedEvents`, `overflow`, `src/contracts-core/agent.ts:285-296`). The workflow chooses `close` on overflow and emits a `workflow.notice`, or another documented policy.
    - Functional: `steer_unsupported` from a child surfaces as that child's `agent.notice`, and does not fail the workflow.
    - Performance: One subscription per child session, closed when the child's node completes.
    - Code Quality: Child events use only public `Session.subscribe`; workflow transitions use the bounded package-owned channel from Task 2. Parent-session subscription is not a transition source (`src/packages/loader.ts:619-627`).
    - Security: The merged stream forwards events already redacted by each child session. The package-owned transition channel applies the same bounded, id/status-only payload and redaction rules as Task 2; it cannot rely on `prism.events.emit` to redact a separate queue.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/agent.ts:280-300` (`SubscribeOptions`); `docs/next/events.md` (`origin`); plan 166 notes on `steer` modes
    - Options Considered:
      - Children forward into a shared bus through hooks. Rejected: hooks are per agent, and the children belong to different agents.
    - Chosen Approach:
      - Subscribe to each child session at open, before its first run, and merge with Task 2’s transition channel using a bounded fan-in queue. Do not subscribe to the parent for `workflow.*`.
    - API Notes and Examples:
      ```ts
      const run = await startWorkflow(build, { goal }, opts);
      for await (const e of run.stream()) ui.render(e.origin?.agent ?? "workflow", e);
      await run.steer("execute", "prefer the existing Button component");
      ```
    - Files to Create/Edit:
      - `packages/integrations/workflows/src/{parent-session,events}.ts`: extend Task 2's existing `WorkflowRun` and transition channel; `merge-stream.ts` if a separate merge module is needed.
      - `packages/integrations/workflows/src/__tests__/merged-stream.test.ts`: new.
      - `packages/integrations/workflows/README.md`.
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`: regenerated.
    - References:
      - roadmap §2.12.13 "One stream for the UI"
  - Test Cases to Write:
    - `merged_stream_carries_every_agent_with_origin`: a mock host agent and a `stream-cli` driver agent with a nested sub-agent and thinking deltas. Each event's `origin.agent`, `kind`, and `subagentId` match. This is the Done criterion.
    - `late_child_events_not_lost`.
    - `steer_reaches_active_child`, `steer_inactive_node_fails`.
    - `abort_stops_driver_child_within_grace`.
    - `slow_consumer_overflow_policy`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the `WorkflowRun` API.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`: "Running a workflow" with `stream`/`steer`/`abort`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Completed on Task 2's channel; no new module.** `WorkflowRun` gained `steer(nodeId, input)` and `abort(reason?)`, and `stream()` now yields `WorkflowStreamEvent = WorkflowPackageEvent | AgentEvent` (`parent-session.ts`, `events.ts`). `observeAgentNode` (called at child open, before its first run) iterates one public `Session.subscribe` per child through a tee that publishes to the stream queue and to the existing `subscribe()` diagnostic queue, so each child costs one subscription, released when the attempt ends. The channel also tracks active child sessions per node id (a `Set`, so every active `fanOut` item is steerable; the scheduler's `activeSessions` map is keyed by node id and would have lost siblings).
    - **Behavior.** `steer` calls `session.steer()` on each active child of the node and rejects with `WorkflowRuntimeError` `node_not_running` if none accepted (idle, finished, or unknown). A driver child that cannot take steering emits its own `agent.notice` (`steer_unsupported`) and the workflow continues. `abort` aborts a run-owned `AbortController` combined with the caller's `signal` (the existing scheduler abort path then marks the run `aborted`) and aborts the active children directly. Overflow policy is **close with one stream-only `workflow.notice`** (`reason: "slow_consumer"`, never persisted), via the multiplexer's `overflowEvent`; `StartWorkflowOptions.maxQueuedEvents` bounds it. `WORKFLOW_EVENTS.notice` is the sixth name.
    - **Findings.** Native (non-driver) child events carry no `origin`; it is stamped only for external/delegated scopes, so the Done criterion's per-event `origin` assertions apply to the driver child (`origin.kind: "external"`, nested sub-agent `depth: 1` / `subagentId`, thinking delta present) and the native child is asserted by absence. Task 3's `agent_node_runs_driver_agent` test is not in `agent-node.test.ts`; the driver-agent coverage now lives in `merged-stream.test.ts` (stream-cli over `createScriptedCli`, reference adapter loaded by computed import like the process-driver tests). Existing `run.stream()` consumers in tests now narrow on `type === "package.event"`; no example used `stream()`.
    - **Checks.** `tsc --noEmit` for the package: clean. Workflows: **164 pass / 0 fail** (six new tests: `merged_stream_carries_every_agent_with_origin`, `late_child_events_not_lost`, `steer_reaches_active_child`, `steer_inactive_node_fails`, `abort_stops_driver_child_within_grace`, `slow_consumer_overflow_policy`). Observability: **56/0**. `bun run typecheck`: exit **0**. Release gate not run (Postgres preflight blocker, inherited); baseline regenerated with the lower-level `runGates({ updateBaseline: true, skipTarball: true, packageName })`, and only the workflows file changed.
    - **Baseline delta.** `+ WorkflowStreamEvent` (root type export). Member-only changes the serializer does not list: `WorkflowRun.stream()` return type widened, `WorkflowRun.steer`/`abort` added, `StartWorkflowOptions.maxQueuedEvents`, `WorkflowTransitionChannel.steer`/`abort`, `WorkflowEventMergeOptions.parentSessionId`, `WORKFLOW_EVENTS.notice`.

- [x] Task 7: Durable resume after a process kill
  - Acceptance Criteria:
    - Functional: After `SIGKILL` mid-run, `resumeWorkflow(runId, { agents, prism })` in a new process does three things:
      - It claims the run through the `leases` service (one resumer wins, and a second gets `LeaseConflictError`).
      - It does not re-run completed nodes, whose outputs come from the `checkpoints` service.
      - It resumes suspended children through `session.resume` with the complete pending decision batch (Part A deliberately rejects partial batches), and re-runs unfinished nodes under their idempotency policy. Cross-agent child approvals use the public child session, not the retired `resumeNestedRun` carrier (plan 168 Further Actions).
    - Functional: The idempotency policy is per node: `idempotent: "rerun"` (default for `gateNode` and `functionNode`), `"resume-session"` (default for `agentNode`: reopen the same child session, so the transcript continues), or `"fail"` (the run fails with `WorkflowRuntimeError` code `not_idempotent`).
    - Functional: A worktree node that was mid-run resumes in its recorded worktree. A worktree whose path no longer exists fails the node with `worktree_lost`, and never silently uses the main tree.
    - Functional: The definition's revision hash must match the checkpoint. A mismatch fails closed with `WorkflowCheckpointError`.
    - Performance: Resume reads one checkpoint per node and holds one lease for the run, renewed at `ttlMs/2`. The README states the trade-off.
    - Code Quality: Resume uses only the `checkpoints`, `leases`, and `workspace` services and the public `Agent` API.
    - Security: Ownership scope on resume must match the original run, and a foreign tenant cannot claim it. The lease token is never logged.
  - Approach:
    - Documentation Reviewed:
      - the ported `resumeWorkflow` (`run/main.ts:173-390` before the port), `cyclic-durability.test.ts`; `checkpointConformance`/`leaseConformance`; `docs/next/agent.md` (`session.resume`)
    - Options Considered:
      - Resume without a lease. Rejected: two hosts could resume the same run and double-run nodes, and §2.12.13 lists leases for exactly this.
    - Chosen Approach:
      - Lease claim, then read checkpoints, then the per-node policy. The test kills a real subprocess.
    - API Notes and Examples:
      ```ts
      const run = await resumeWorkflow(build, runId, { agents: { host, planner, uiEngineer, validator }, prism });
      ```
    - Files to Create/Edit:
      - `packages/integrations/workflows/src/resume.ts`: new or edited.
      - `packages/integrations/workflows/src/__tests__/{kill-resume.test.ts,fixtures/kill-worker.ts}`: new.
      - `packages/integrations/workflows/README.md`: durability section.
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`: regenerated.
    - References:
      - roadmap §2.12.13 "Durability"; `scripts/fixtures/phase12-restart-worker.mjs` (subprocess-kill pattern)
  - Test Cases to Write:
    - `kill_and_resume_skips_completed_nodes`: a counter per node proves completed nodes ran once. This is the Done criterion.
    - `kill_and_resume_resumes_suspended_child`.
    - `resume_claim_is_exclusive`.
    - `resume_revision_mismatch_fails_closed`.
    - `not_idempotent_node_fails_on_resume`.
    - `worktree_lost_fails_closed`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — resume semantics and the per-node policy field.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`: durability, idempotency, and cost.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-13):
    - **Implemented.** `resumeWorkflow(def, runId | { runId, workflowId? }, options)` (`packages/integrations/workflows/src/run/main.ts`) now claims the run first. With `options.leases`, or `options.prism` (resolves the registered `checkpoints`/`leases` services through `createWorkflowRuntime`), it takes lease `workflow-run` / `<workflowId>/<runId>` scoped by `ownership`; a second resumer gets `LeaseConflictError`. The lease renews at `leaseTtlMs / 2` (default 30 s, timer unref'd), its fencing token replaces the checkpoint fence, a renewal failure aborts the run and trips `checkpointGuard`, and release runs in `finally`. The token is never logged. Without `leases`/`prism` the old lease-free behaviour is unchanged; nested workflow resumes (`nestedDepth`) skip the claim, and the nested deny path calls the unleased inner function so it cannot conflict with its own parent's lease. The plan's `{ agents, prism }` shape is not needed: agents are inside the definition's `agentNode`s, so `prism` alone resolves services.
    - **Per-node policy.** `idempotent?: "rerun" | "resume-session" | "fail"` on every node (`NodeIdempotency`, `types.ts`; default via `nodeIdempotency()` in `util.ts`: `resume-session` for `agent`, `rerun` otherwise; `resume-session` on a non-agent is a `WorkflowDefinitionError`). The old "interrupted node has an unknown outcome" `WorkflowCheckpointError` is gone. `fail` persists a `failed` node with code `not_idempotent` (CAS on the loaded version), throws `WorkflowRuntimeError`, and any later resume refuses again rather than retrying it as an ordinary failed node. The policy is not part of the definition hash.
    - **Agent nodes are durable mid-run.** After the child session (and worktree) exist and before the agent runs, the node records `sessionId`, `leafId`, and `worktree: { path, branch }` and writes one checkpoint (`AgentNodeDurability`, `nodes/agent-node.ts`). Only a top-level agent node does this; fan-out items and loop bodies run under derived ids and are re-run whole with their parent node. A resumed `resume-session` node reopens `agent.session({ id })`, then either `session.resume(decisions)` (an approved suspended node: `resume.input` must be the complete `Decision[]`, else `invalid_resume`; the batch check is the session's) or runs the node input again on the same transcript. The next attempt in an ordinary retry still opens a new session (`resumeSession` is set only by resume).
    - **Worktree.** A recorded worktree resumes only if `workspace.worktree.bound(sessionId)` still returns the same path; otherwise `worktree_lost`, with no fresh worktree and no main tree. Finding: the coding workspace service keeps worktree bindings in process memory (`workspace/service.ts` `records`), so after a real process kill `bound()` is empty and a mid-run worktree node fails closed with `worktree_lost` even when the path still exists. The rebind API now exists (`workspace.worktree.rebind`; see Further Actions); the `worktree_lost` test uses a fake service and `worktree_rebound_after_kill` covers the success path.
    - **Superstep fix found on the way.** A wave emptied `state.ready`, so a mid-wave checkpoint dropped the wave's unstarted nodes (they would be skipped as "unmet dependencies" after a resume). `readyNodeIds` now also lists nodes still `ready` (`run/checkpoint.ts`), and resume pushes interrupted nodes into `ready`. On supersteps a `fail` node writes a start checkpoint (the DAG path already did).
    - **Security.** Resume now uses `ownershipExactlyMatches` (was one-directional `ownershipMatches`, which let a resumer with no ownership claim a tenant's run); the lease key carries the ownership fields too. Revision-hash mismatch was already fail-closed and is now covered by a test.
    - **Tests (7 new, `kill-resume.test.ts`; fixtures `fixtures/{kill-fixture,kill-worker}.ts`).** `kill_and_resume_skips_completed_nodes` (a real subprocess over a SQLite file, SIGKILLed while node `b` runs; counter file proves `a`, `c` ran once and `b` reran once), `kill_and_resume_resumes_suspended_child` (subprocess suspends on a gated child, is killed, a new process approves the batch; the child's tool ran once and the same session finished), `resume_claim_is_exclusive`, `resume_revision_mismatch_fails_closed`, `not_idempotent_node_fails_on_resume` (also a second resume still refuses), `foreign_tenant_cannot_resume`, `worktree_lost_fails_closed`. Two `run.test.ts` cases that asserted the retired "unknown outcome" error now assert `not_idempotent` (`idempotent: "fail"`) and the default rerun respectively.
    - **Checks.** `bun run typecheck` exit **0**. Workflows **171 pass / 0 fail** (164 + 7). Observability **56/0**. `bun scripts/release.mjs gate` still blocks on `PRISM_TEST_POSTGRES_URL` (inherited), so the Postgres restart proof and the full release gate were not run. Docs suite, SQLite, and benchmarks were not rerun. Logs: `/tmp/169-task7-*`.
    - **Baseline.** `runGates({ updateBaseline, skipTarball, packageName: "@arnilo/prism-workflows" })`; only `arnilo__prism-workflows.txt` changed. `+ NodeIdempotency` (root type), `+ nodeIdempotency` (module-level, not re-exported), `~ resumeWorkflow` (`ref: string | {...}`, `options: RunWorkflowOptions`), `~ executeAgentNode` (`+ durable?`). Member-only changes the serializer does not list: `WorkflowNodeBase.idempotent`, `WorkflowNodeCheckpoint.worktree`, `RunWorkflowOptions.{prism,leases,leaseTtlMs,ownerId}`, `WorkspaceLike.worktree.bound?`.
    - **README.** New "Durable resume after a process kill" section (claim, read, per-node policy table, suspended child, worktree, cost) and the Failure bullet.

- [x] Task 8: `workflowCommand`, `workflowLoop`, and `examples/workflow-loop.ts`
  - Acceptance Criteria:
    - Functional: `workflowCommand(...)`, in the form plan 168 Task 1 settled (recommended: `workflowCommand(prism, name, def | () => def, { args? })`), returns a `PackageCommand`. Its `run(args, ctx)`:
      - starts the workflow with `ctx.session` as the parent (or opens one)
      - resolves `checkpoints`, `leases`, `workspace`, and `host` through the registering package's `PackageAPI`
      - returns `{ workflowRunId, status }`
      - A lazy `() => def` is resolved on first run, so the definition can reference agents created later (§2.11).
    - Functional: `workflowLoop(def)` returns a package that claims `slot:loop` and runs `def` inside one agent's run. Its agent steps call `run.turn()` and `run.executeTools()`, so every tool goes through `tool.call` and `@arnilo/prism-approval` gates it. Generate-validate-revise is expressible as a `workflowLoop` with a `gateNode` validator.
    - Functional: Under `workflowLoop`, an `agentNode` naming another agent fails at definition time with `WorkflowDefinitionError`: a loop is one agent, one session.
    - Functional: `examples/workflow-loop.ts` (moved from Phase 9) runs offline on the mock provider: a generate-validate-revise loop whose tool call is denied under `approval({ mode: "deny" })` and allowed under `ask` with a scripted `HostUi`.
    - Functional: Decide, with the backlog item "Decide the fate of the five `artifact_*` `AgentEventPayload` variants" (P2, plan 145): `workflowLoop` emits them, or this task retires them from the catalog. Recommended: retire them, since `workflow.*` package events cover the loop's progress. The removal goes with a sweep and a baseline update.
    - Performance: `workflowLoop` adds no model call beyond the definition's nodes.
    - Code Quality: Placement is the `@arnilo/prism-workflows` package. The loop uses only `RunController` primitives, and loop conformance from `/testing` passes.
    - Security: `workflowLoop` cannot bypass `tool.call`, shown by the approval-deny test. `workflowCommand` args are validated against `args` before the run starts.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/api.ts:44-58` (`PackageCommand`, `PackageCommandContext`); `docs/next/loop.md`; `src/testing/loop-conformance.ts`; plan 144 notes on the retired `generate-validate-revise`
    - Options Considered:
      - `workflowLoop` as a nested `runWorkflow` inside a tool. Rejected: tools would run outside the loop's `executeTools`.
    - Chosen Approach:
      - The command opens/binds the host parent and delegates to Task 2's `startWorkflow`, extended by Task 6. The loop adapts node steps onto `RunController`.
    - API Notes and Examples:
      ```ts
      setup: (prism) => prism.commands.register(workflowCommand(prism, "build", () => build)),
      // single agent:
      packages: [workflowLoop(generateValidateRevise), approval({ mode: "ask" })]
      ```
    - Files to Create/Edit:
      - `packages/integrations/workflows/src/{command,loop}.ts`: new.
      - `packages/integrations/workflows/src/__tests__/{command,loop}.test.ts`: new.
      - `examples/workflow-loop.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`: rows.
      - `src/contracts-core/events*.ts` and `docs/next/events.md`: tentative, if the `artifact_*` variants are retired.
      - `scripts/compat-baseline/arnilo__prism-workflows.txt`, and `arnilo__prism.txt` if catalog types change: regenerated.
    - References:
      - roadmap Phase 9 ("Workflows moved to Phase 16"), Phase 1 (generate-validate-revise "moves to workflows")
  - Test Cases to Write:
    - `workflow_command_starts_run_with_parent_session`.
    - `workflow_command_lazy_definition`.
    - `workflow_command_invalid_args_rejected`.
    - `workflow_loop_gates_tools_under_approval`: this is the Done criterion.
    - `workflow_loop_passes_loop_conformance`.
    - `workflow_loop_rejects_foreign_agent_node`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `workflow-loop.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`: "Commands" and "Single-agent loops".
      - `docs/next/events.md`: if catalog variants are retired.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Retirement sweep (if the `artifact_*` variants go): `rg -n "artifact_validation_started|artifact_validation_finished|artifact_revision_started|artifact_finished|artifact_failed" src packages apps scripts examples docs --glob '!**/dist/**' --glob '!docs/history/**' --glob '!docs/_evidence/**'`.

  - Notes (executed 2026-10-13):
    - **`workflowCommand(prism, name, def | () => def, { args?, description? })`** (`packages/integrations/workflows/src/command.ts`) returns a `PackageCommand`. `args` is the command schema, so the kernel rejects bad arguments (`command_args_invalid`) before `run`; the validated arguments are the workflow input. `run` calls Task 2's `startWorkflow` with the bound `ctx.session`; services resolve through the `prism` passed in. With no caller session it opens `ctx.agent.session()`, re-enters `ctx.agent.commands.run(name, args, { session })` so the run gets a bound `SessionContext`, and closes the session (no kernel change). The `() => def` thunk is resolved once, on first run. Returns `{ workflowRunId, status }`.
    - **`workflowLoop(def, { name? })`** (`src/loop.ts`) is a `definePackage` with `slot:loop` whose strategy runs `def` through `runWorkflow` on the loop's `run.signal`. **Design finding that amends the plan:** the plan's "agent steps" needed a node that runs on a `RunController`, but `agentNode` names an `Agent`. Added `loopAgentNode({ input?, tools?, system?, maxToolRounds?, output?, activation? })`, a `function` node tagged in a `WeakMap`. The loop rebinds each tagged top-level node to a step that appends the optional input, then loops `run.turn()` / `run.executeTools()` until no tool calls (default 16 rounds), and returns the last assistant text. Outside a loop it throws `loop_step_outside_loop`. Steps of parallel branches are serialized on one promise queue. A tagged node inside a `fanOut` route or loop body is not rebound (documented). Exported `workflowLoopStrategy(def)` for `loopConformance`.
    - **Definition-time check.** `assertNoForeignAgents` throws `WorkflowDefinitionError` at `workflowLoop(def)` for any `agent` node, recursing into nested `workflow` nodes. A `fanOut` route is dynamic, so it cannot be checked there.
    - **Limits found.** The loop is not resumable (no `snapshot`/`restore`): an `ask` with no `host.ui` denies. It runs the workflow in memory with no checkpoints. A cyclic gate-back needs a seed node and `activation: "any"` on the re-entered step (`loopAgentNode({ activation })` added for this); `RunResult.text` is the last turn's text, so `workflow_loop_revises_through_gate` passes.
    - **`artifact_*` decision: nothing to retire.** The five variants are no longer in the event catalog or any `src/` path (`rg` over `src` finds only the orphan `ArtifactValidation` interface in `src/contracts-core/loop.ts:9` and its stale comment). The remaining sweep hits are released 0.12.1 docs (`docs/agent-events.md`, `agent-loops.md`, `structured-output.md`, `tools.md`) and the docs guard `agent_events_docs_cover_artifact_variants`, which stay until Phase 11. `workflowLoop` emits none of them; `workflow.*` package events cover progress. No catalog or `arnilo__prism.txt` change. The orphan `ArtifactValidation` type is left for the backlog item.
    - **Tests (8 new).** `command.test.ts`: `workflow_command_starts_run_with_parent_session` (caller session and the opened-parent path; the probe reads the `workflow` log), `workflow_command_lazy_definition`, `workflow_command_invalid_args_rejected`. `loop.test.ts`: `workflow_loop_gates_tools_under_approval` (a `tool.call` hook denies, then asks with a scripted `HostUi`; the tool runs 0 and 1 times), `workflow_loop_revises_through_gate` (3 provider turns), `workflow_loop_passes_loop_conformance`, `workflow_loop_rejects_foreign_agent_node` (also nested), `loop_agent_node_fails_outside_loop`. The package's tests do not import `@arnilo/prism-approval` (no new devDependency); the example uses the real package.
    - **Example.** `examples/workflow-loop.ts` runs offline on the mock provider with `approvalPackage({ mode })`: `deny` leaves `saved: []`, `ask` saves once, both end `final answer` after one gate revision; it throws on any mismatch. Registered in the `examples_demos_run_to_completion_and_emit_no_secret` list (`src/__tests__/docs.test.ts`), `examples/README.md`, and the workflows suites in `scripts/e2e-coverage.json`.
    - **Checks.** Workflows **179 pass / 0 fail** (171 + 8). `bun run typecheck` exit **0**. `docs.test.ts -t examples_demos_run_to_completion_and_emit_no_secret`: pass. `bun scripts/release.mjs gate` not run (inherited `PRISM_TEST_POSTGRES_URL` blocker). Observability, SQLite, and the full docs suite not rerun.
    - **Baseline.** Lower-level `runGates({ updateBaseline, skipTarball, packageName: "@arnilo/prism-workflows" })` wrote the baseline and then stopped on an unrelated `bun.lock` version check; only `arnilo__prism-workflows.txt` was touched by this task, and the diff is additions only: `+ loopAgentNode`, `+ workflowCommand`, `+ workflowLoop`, `+ workflowLoopStrategy`, `+ LoopAgentStepConfig`, `+ WorkflowLoopOptions`, `+ WorkflowCommandOptions`, `+ WorkflowCommandResult`. No removals.
    - **Docs.** README gained "Commands" and "Single-agent loops" and the corrected "What it changes"; `CHANGELOG.md` `[Unreleased]` has an Added entry. `docs/next/events.md` needs no change.

- [x] Task 9: Origin-aware observability and the timeline by origin
  - Acceptance Criteria:
    - Functional: Every span `@arnilo/prism-observability` creates carries the `origin` attributes when the event has `origin`: `prism.origin.agent`, `.vendor`, `.profile`, `.executed_by`, `.delegation_id`, and `.subagent_id` (§2.12.15).
    - Functional: Workflow spans (from `workflow.*` events) parent their child sessions' `invoke_agent` spans through the child's `parent.workflowRunId`/`sessionId` link. One trace covers the whole `/build` run.
    - Functional: The moved timeline projector (plan 168 Task 6, including the RAG tracer adapter already exported at `packages/integrations/observability/src/index.ts:63-64`) groups steps by `origin` (agent, then sub-agent), and marks `executedBy: "external"` steps as observed, not executed.
    - Performance: Observe handlers stay unawaited, and each event still costs one span operation. Origin attributes are bounded scalars.
    - Code Quality: Attribute names are one exported constant. No vendor-specific branch.
    - Security: `profile` is a profile name, never a credential or home path. The field-policy drop and hash rules apply to origin attributes. No message text becomes an attribute.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/observability/src/instrumentation.ts`, the moved workflow instrumentation and timeline; `EventOrigin` (roadmap §2.12.9 K3)
    - Options Considered:
      - Separate workflow and agent traces linked by span links. Rejected: §2.12.15 says workflow spans parent child spans.
    - Chosen Approach:
      - Keep a map from `workflowRunId` and node to the active span, and parent each child `invoke_agent` span on its link.
    - API Notes and Examples:
      ```ts
      const telemetry = createInMemoryTelemetry();
      // run the workflow with observability() listed on every agent
      expect(telemetry.spans.find((s) => s.name === "invoke_agent" && s.attributes["prism.origin.agent"] === "ui-engineer")?.parent).toBe(workflowNodeSpanId);
      ```
    - Files to Create/Edit:
      - `packages/integrations/observability/src/{instrumentation,workflow-instrumentation,timeline}.ts`: edited.
      - `packages/integrations/observability/src/__tests__/{origin-attributes,workflow-parenting,timeline-origin}.test.ts`: new.
      - `packages/integrations/observability/README.md`: "Spans and metrics" with the origin attributes.
      - `scripts/compat-baseline/arnilo__prism-observability.txt`: regenerated.
    - References:
      - roadmap Phase 9 ("Phase 16 adds `origin` attributes and the timeline projector"); backlog "Move prism-core workflow observability into the observability package" (closed by plan 168 Task 6 and this task)
  - Test Cases to Write:
    - `spans_carry_origin_attributes`.
    - `workflow_span_parents_child_session_spans`.
    - `timeline_groups_by_origin`.
    - `origin_profile_is_name_only`: fails if a home path or credential appears.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new span attributes and parenting.
    - Docs pages to create/edit:
      - `packages/integrations/observability/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Origin attributes.** New `src/origin.ts` exports `ORIGIN_ATTRIBUTES` and `originAttributes(origin)`. `handleAgentEvent` computes them once per event and merges them into every span it opens (`run.started`, `startChild` for chat/tool, guardrail), through `policyAttrs`, so `fieldPolicy` drop/hash applies (`run.started` and guardrail attributes previously bypassed the policy; they now go through it). Values are capped at 128 chars; `profile` is kept only if it matches a plain-name pattern (no `/`, `\\`, `~`, spaces), otherwise omitted. `executed_by` defaults from `kind`. No vendor branch.
    - **Parenting.** The plan's "through `parent.workflowRunId`" link is not on agent events, so the link is the child's session id: the tracker gained `linkSession(sessionId, span)` (bounded to 1024, dropped at `run.completed`), the workflow instrumentation links it from the `agent_event` wrapping a child `run.started` to its `workflow_node` span, and `run.started` uses that as `parent`. Tool and chat spans then nest under the child's agent span; one trace id covers the run. Limit: a child instrumented only on its own agent (not fed through `handleWorkflowEvent`) starts its own trace; documented in the README.
    - **Timeline.** `ExecutionStep.origin` (`StepOrigin`, `observed` = external) is stamped in `addStep` from the event being folded; `ExecutionTimeline.byOrigin` (`TimelineOriginGroup`, agent then sub-agent, `stepIds`) is present only when some step has an origin. Applies to agent and workflow projections (child `agent_event`s); workflow node steps stay unattributed.
    - **Tests (8 new, observability 56 → 64).** `origin-attributes.test.ts`: `spans_carry_origin_attributes`, no-origin case, `origin_profile_is_name_only`, field-policy drop/hash. `workflow-parenting.test.ts`: `workflow_span_parents_child_session_spans`. `timeline-origin.test.ts`: `timeline_groups_by_origin` plus two. Observability **64 pass / 0 fail**; package `tsc` clean. Full `bun run typecheck`, the docs suite, and `release.mjs gate` were not rerun (gate still blocked by `PRISM_TEST_POSTGRES_URL`).
    - **Baseline.** `runGates` lower-level update for `@arnilo/prism-observability` stopped at the unrelated `bun.lock` version check after writing the baseline. `arnilo__prism-observability.txt` diff is additions only: `+ ORIGIN_ATTRIBUTES`, `+ originAttributes`, `+ StepOrigin`, `+ TimelineOriginGroup`. No removals.
    - **Docs.** README "Spans and metrics" documents the attributes, parenting, and `byOrigin`; `CHANGELOG.md` `[Unreleased]` Added entry.

- [x] Task 10: `examples/build-workflow.ts`, final READMEs, and the Phase 16 Done record
  - Acceptance Criteria:
    - Functional: `examples/build-workflow.ts` runs the §2.11 orchestration offline:
      - the host agent on the mock provider
      - the planner and the UI engineer on the `stream-cli` reference adapter (`examples/adapters/stream-cli.ts`), and the validator on the `rpc-server` reference adapter (`examples/adapters/rpc-server.ts`), all over `createScriptedCli`
      - all state in one SQLite file through `@arnilo/prism-store-sqlite` (sessions, vendor state, checkpoints, leases)
      - a temp git repository for the `workspace` service
    - Functional: The workflow runs these steps in order:
      1. research
      2. plan
      3. a gate that fails once and routes back
      4. `humanGate` (scripted `HostUi`)
      5. `fanOut`: tasks 2, 5, and 6 to the UI engineer in worktrees, the rest to the host
      6. a merge gate over `workspace.merge`
      7. validate
      8. a tests gate
    - Functional: The example asserts each Done criterion it can and exits non-zero on any failure:
      - `createSessionIndex(store).search({ text, workflowRunId })` finds both an external agent's message and the host's.
      - The merged stream carries every agent's events, including external sub-agents and thinking, with the correct `origin`.
      - `fanOut` peak concurrency per profile stays within `maxConcurrentRuns`.
      - The gate routed back once within `maxSupersteps`.
    - Functional: The Done criteria the example does not cover are proven by named tests, cited in the task note:
      - kill-and-resume: Task 7 `kill_and_resume_skips_completed_nodes`
      - `workflowLoop` under approval: Task 8 `workflow_loop_gates_tools_under_approval`
      - no kernel checkpoints or leases: plan 168 Task 5 `kernel_contains_no_checkpoints_or_leases`
    - Functional: `examples/README.md` and `scripts/e2e-coverage.json` list `build-workflow.ts`, and it runs under the execution gate.
    - Functional: `packages/integrations/workflows/README.md` is complete in the package page structure: Install with a manifest entry, Configuration, What it changes (commands, the loop slot for `workflowLoop`, events, consumed services), Capabilities, Cost, security, and failure behavior, and an Example. `PRODUCT.md` and the roadmap §2.11/§2.12.13 example are amended for the `workflowCommand(prism, name, def, { args? })` signature (plan 168 Task 1; the roadmap's `workflowCommand(name, def)` is superseded).
    - Functional: Record the Phase 16 Done table in the task note: each roadmap Done bullet with its proving test or example and the result.
    - Performance: The example completes in under 30 seconds offline, using no network.
    - Code Quality: The example imports only public entry points: `@arnilo/prism`, `/driver-kit`, `/testing`, `@arnilo/prism-workflows`, `@arnilo/prism-driver-process`, the store, tools-coding, approval, and the reference adapters under `examples/adapters/`.
    - Security: The example's output passes the no-secret check. No profile home or credential path is printed.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.11 (the orchestration example), Phase 16 Done; `examples/custom-adapter.ts`, `examples/external-agent.ts`, `examples/serve-tools.ts`; `examples/adapters/conformance.ts`
    - Options Considered:
      - Prove each Done criterion only in unit tests. Rejected: the roadmap names the example as the end-to-end proof.
    - Chosen Approach:
      - One example with built-in assertions, plus cross-references to the tests for the criteria it cannot exercise in one process.
    - API Notes and Examples:
      ```bash
      bun examples/build-workflow.ts   # exits 0 and prints the Done checklist
      ```
    - Files to Create/Edit:
      - `examples/build-workflow.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`: rows.
      - `packages/integrations/workflows/README.md`: final.
      - `PRODUCT.md`, `roadmap.md`: only where a signature changed.
      - `CHANGELOG.md`: `## [Unreleased]` Phase 16 entry.
      - `plans/README.md`: status for plans 168 and 169.
    - References:
      - plan 167 Task 7 (Done-record pattern)
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `build-workflow.ts`.
    - `build_workflow_session_search_spans_agents` (inside the example).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the phase's public surface is complete.
    - Docs pages to create/edit:
      - `packages/integrations/workflows/README.md`, `examples/README.md`, `CHANGELOG.md`.
      - Released `docs/workflows.md` stays on 0.12.1 until Phase 11.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-13):
    - **Example.** `examples/build-workflow.ts` runs the §2.11 orchestration offline in about 2 s: a mock host, `stream-cli` planner and UI engineer, an `rpc-server` validator (all over `createScriptedCli`), one SQLite file (`sqliteStore` on every agent, so sessions, vendor state, checkpoints, and leases share it), and a temp git repo behind one `createWorkspaceService` provided to every agent (so the driver resolves the worktree the workflow created). Steps: research → plan → `planOk` gate (fails once, routes back) → `humanGate` (scripted `confirm`) → `fanOut` of six tasks (2, 5, 6 to the UI engineer under `maxConcurrentRuns: 2`, the rest to the host, all in worktrees) → merge gate over `workspace.merge` → validate → tests gate. It throws on any miss and prints a one-line JSON summary. Deviations: (1) it registers its own `build` command around `startWorkflow` rather than `workflowCommand`, because the Done assertions need the `WorkflowRun` handle (`workflowCommand` returns only `{ workflowRunId, status }`); (2) the scripted binaries edit nothing, so each item's `output` mapper writes `task-N.txt` into the bound worktree, which the merge gate then merges; (3) the plan gate fails on an attempt counter, since the scripted planner returns the same plan each turn.
    - **Bugs the example found, fixed here.** (a) `agentNode` treated a child run with `status: "failed"` as a success with an empty output, so a driver's `profile_busy` (returned as a failed `RunResult`, not thrown) never reached `fanOut`'s pacing and the item was merged empty. A failed child now throws `WorkflowRuntimeError` carrying the child's error code, and a run refused with `profile_busy` releases its worktree (`agent-node.ts`; test `failed_child_run_fails_node`). Task 5's pacing tests used function nodes that threw, so none covered this. (b) `createWorkspaceService({ maxWorktrees })` was ignored by the git layer (default 4, and the main tree counts), so a fifth worktree failed with `worktree count would exceed 4 limit`. The service now passes `maxWorktrees + 1` (capped at the hard limit); test `max_worktrees_above_default_is_honored_by_the_git_layer` (`tools-coding` workspace suite 23/0). No export changed, so no baseline moved.
    - **Findings.** A gate (and `humanGate`) fails at runtime unless its failure target is a declared successor, so every gate in a linear flow still needs a back edge, and the node it points back to needs `activation: "any"`; a `fanOut` or `agentNode` that is both re-entered and has a second predecessor never runs without it (the run "succeeds" with those nodes skipped). `upstream` holds only direct predecessors, so `fanOut.items` read the plan from a closure. Native children carry no `origin`; an external child's `origin.agent` is the adapter name, with no `profile` field, so per-profile concurrency is measured by mapping child `sessionId` to `agentId` through `sessions.list({ workflowRunId })`. A refused-then-retried item opens a new session, so the UI engineer shows more than three sessions. README: added "A multi-agent build".
    - **Docs.** `examples/README.md` row, `scripts/e2e-coverage.json` (the example and the seven Part B workflow suites), `src/__tests__/docs.test.ts` demo list, `CHANGELOG.md` Phase 16 Part B entry, `roadmap.md` (`workflowCommand(prism, name, def, { args? })`), workflows README. `PRODUCT.md` never names `workflowCommand`, so it needed no change. `plans/README.md`: 169 complete (168 was already all-checked).
    - **Checks.** Example exits 0, five consecutive runs; `docs.test.ts -t examples_demos_run_to_completion_and_emit_no_secret` pass; `bun run typecheck` clean; workflows **180 pass / 0 fail**; observability **64/0**; `docs.test.ts` **149 pass / 21 fail** (the 21 inherited from Task 1); `kernel-no-checkpoints` 2/0. Not run: SQLite and driver-process suites (untouched), `bun scripts/release.mjs gate` (blocked on `PRISM_TEST_POSTGRES_URL`, inherited).
    - **Phase 16 Done record.**

      | Done criterion | Proof | Result |
      | --- | --- | --- |
      | One search finds an external agent's and the host's messages across the run | `examples/build-workflow.ts` (`build_workflow_session_search_spans_agents`) | pass |
      | Merged stream carries every agent's events with `origin`, incl. sub-agents and thinking | the example; `merged_stream_carries_every_agent_with_origin` | pass |
      | `fanOut` never exceeds a profile's `maxConcurrentRuns` | the example (peak 2 of 2, six items); `fan_out_never_exceeds_profile_cap`, `two_agents_share_profile_cap` | pass |
      | A failing gate routes back within `maxSupersteps` | the example (`planOk` runs twice); `gate_failure_routes_back_once_then_passes`, `gate_loop_exceeds_max_supersteps` | pass |
      | Kill mid-run, resume without re-running completed nodes | `kill_and_resume_skips_completed_nodes` (real SIGKILL over SQLite), `kill_and_resume_resumes_suspended_child`, `resume_claim_is_exclusive` | pass; Postgres restart proof deferred (no URL) |
      | `workflowLoop` tools gated by approval | `workflow_loop_gates_tools_under_approval`; `examples/workflow-loop.ts` | pass |
      | No kernel checkpoints or leases | `kernel_contains_no_checkpoints_or_leases` | pass |
      | Origin attributes, workflow spans parent child spans, timeline by origin | `spans_carry_origin_attributes`, `workflow_span_parents_child_session_spans`, `timeline_groups_by_origin` | pass |
      | Release gate | `bun scripts/release.mjs gate` | blocked: `PRISM_TEST_POSTGRES_URL` unset, as at Task 1 |

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-workflows test`
- `bun run --filter @arnilo/prism-observability test`
- `bun run --filter @arnilo/prism-driver-process test && bun test --timeout=0 dist/driver-kit/__tests__`
- `bun run --filter @arnilo/prism-store-sqlite test`
- `bun examples/build-workflow.ts && bun examples/workflow-loop.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- Part A's Postgres restart proof and the release gate stay unrun (no `PRISM_TEST_POSTGRES_URL`), so the phase is verified on SQLite only; the 21 docs-suite failures and the SQLite Node-import test are inherited, not fixed.
- Driver-kit pacing is per profile home inside one process. A second process on the same profile is still invisible to the cap, so cross-process pacing relies on `profile_busy` backoff.
- `workflowLoop` is not resumable (no `snapshot`/`restore`) and runs in memory with no checkpoints.
- `build-workflow.ts` registered its own command around `startWorkflow` to hold the run handle. Resolved: `workflowCommand` now takes `onRun(run)` and the example uses it.
- Scripted binaries edit no files; the example writes each task's file from the node's `output` mapper.

Recorded in plans/backlog.md.

## Further Actions

- ~~**P1** Let `workflowCommand` return or register the `WorkflowRun` (or expose a stream hook)~~ Done: `workflowCommand(..., { onRun(run) })` hands the live `WorkflowRun` over before the command awaits the result; a throw aborts the run and fails the command. `examples/build-workflow.ts` uses it; tests `workflow_command_on_run_*`.
- ~~**P1** Give the coding `workspace` service a rebind API~~ Done: `workspace.worktree.rebind({ path, sessionId, branch?, base? })` re-adopts a service-locked worktree under the root (fails closed with `workspace_unknown` otherwise); `agentNode` calls it on resume when `bound()` is empty. Tests `workspace_rebind_*`, `worktree_rebound_after_kill`.
- **P2** Stamp `origin.profile` on external events (the attribute exists in observability but the driver kit never sets it), so per-profile concurrency and spans can be attributed without a session-id lookup.
- **P2** Make a gate whose failure target is not a declared successor a `defineWorkflow` error, not a run-time `ERR_PRISM_WORKFLOW_ROUTE_TARGET`, and warn when a re-entered node lacks `activation: "any"` (the run currently "succeeds" with the node skipped).
- **P3** Run the Postgres restart and release-gate legs once `PRISM_TEST_POSTGRES_URL` is available, and clear the inherited docs-suite failures.

Recorded in plans/backlog.md.
