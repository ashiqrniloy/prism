# Host-owned subagent spawn and parallel agents

Roadmap phase: **0.7.0**, part of the extended line (**072, 073, 074, 075, 077, 078, 079**) — **assigned to 0.7.0 on 2026-09-14 by user request** (previously an unassigned proposal). [073 Tasks 28–29](073-Release-0-7-0-Host-Completeness.md) (the 0.7.0 cut) are **deferred until this plan and the rest of the line are closed**, and must link this plan's evidence. Do not publish from this plan alone.

Research-backed proposal for what hosts still need on top of the multi-agent seams shipped in Prism 0.6.0 and extended by the 0.7.0 line. This is **not** a new runtime. Hosts already have four answers ([`docs/multi-agent-patterns.md`](../docs/multi-agent-patterns.md)); the gap is the **model-callable, host-authorized spawn path** that Claude Code, Codex, Cursor, and ACP coding hosts require.

Do **not** duplicate plan 073 R09 (external Codex/Claude/Copilot/Gemini/Cursor adapters) or R01 (parent/child usage reservation). Those stay in 073.

## Objectives

- Freeze what Prism already provides for host-owned spawn and parallel work, mapped to host products and to the scientific literature.
- Add only the missing **generic** primitive: a host-authored spawn tool that wraps `createSupervisor().delegate()`, so a parent model can request children while the **host** still owns identity, tools, budgets, and concurrency.
- Make parallel spawn race-safe against `maxActiveChildren` when several spawn tool calls run in one turn (`toolConcurrency > 1`).
- Give hosts a consumer for coding `subagent_started` / `subagent_stopped` (today deferred until a consumer exists).
- Add bounded **async spawn + wait/cancel** so hosts can match Claude/Codex background threads without a mailbox framework.
- Skip new orchestrators, agent-society runtimes, Magentic-One ledgers, MegaAgent free spawn, and MCP Tasks.

## Expected Outcome

- Hosts can register `createSpawnAgentTool({ supervisor })` on a parent agent. Unknown `childId` / `subagent_type` fails closed. Parallel spawn in one provider turn is the existing loop worker pool plus atomic child-slot reservation.
- Coding hosts and ACP/AG-UI mappers emit/consume `subagent_started`/`subagent_stopped` with redacted child ids, not tool argument bodies.
- Optional `mode: "async"` returns a host-owned handle; `wait`/`cancel` join or abort without leaking `activeChildren`.
- Optional worktree isolation reuses `createCodingWorkspaceLifecycle` (no clone manager).
- Docs decision table gains a fifth row: **in-process spawn tool**. Tests prove privilege cannot widen, caps hold under parallel dispatch, and advertised spawn capability matches enforcement.
- No second scheduler, no new package.

## Tasks

- [x] Task 1 — Primitive review and literature freeze (no code)
  - Acceptance Criteria:
    - Functional: inventory of existing spawn/parallel primitives is written into this plan’s Approach (this task); every later task cites a `covers:` span or doc page and does not invent a second supervisor, workflow runner, or loop.
    - Performance: review itself is documentation-only; no runtime budget change.
    - Code Quality: later tasks name reuse vs new code in one line each; rejected primitives listed.
    - Security: untrusted-model assumption recorded: a prompt-injected parent still cannot exceed host-delegated authority (arXiv:2609.00267).
  - Approach:
    - Documentation Reviewed:
      - **Freeze completed 2026-09-15.** Project contracts and primary sources below are the decision basis; older framework/survey papers remain background vocabulary, not API requirements.
      - [`docs/multi-agent-patterns.md`](../docs/multi-agent-patterns.md) — four patterns: handoff, hierarchical crew, supervisor, A2A.
      - [`docs/supervisors.md`](../docs/supervisors.md) — `createSupervisor` / `delegate`, limits, nested approvals, child-event passthrough (live `delegate()` only).
      - [`docs/workflows.md`](../docs/workflows.md) — `fanOutNode` / `maxFanOut` / `maxConcurrency`.
      - [`docs/agent-loops.md`](../docs/agent-loops.md) — `toolConcurrency` default 1; exclusive tools force sequential.
      - [`docs/host-compositions.md`](../docs/host-compositions.md) — personal/business readiness; **no spawn capability today**.
      - [`docs/coding-workspaces.md`](../docs/coding-workspaces.md) — worktree lifecycle already exists.
      - [`packages/prism-coding-tools/src/agent/lifecycle.ts`](../packages/prism-coding-tools/src/agent/lifecycle.ts) L1–L8 — `subagent_started`/`subagent_stopped` deferred.
      - Claude Code subagents: https://code.claude.com/docs/en/sub-agents
      - Claude Agent SDK subagents: https://code.claude.com/docs/en/agent-sdk/subagents
      - Codex subagents: https://developers.openai.com/codex/subagents
      - Anthropic engineering, 2025-06-13: https://www.anthropic.com/engineering/multi-agent-research-system
      - Cemri et al., *Why Do Multi-Agent LLM Systems Fail?*, arXiv:2503.13657 (NeurIPS 2025 D&B) — MAST 14 modes / 3 categories.
      - Dantuluri, *Delegation Without Trust*, arXiv:2609.00267 — confused deputy, token replay, prompt-injection escalation, compromised sub-agents.
      - Fourney et al., *Magentic-One*, arXiv:2411.04468 — Orchestrator + specialized workers + task/progress ledgers.
      - Li et al. CAMEL 2023; Wu et al. AutoGen 2023; Hong et al. MetaGPT 2023; Du et al. debate 2023; Wang et al. Mixture-of-Agents 2024; Guo et al. LLM-MAS survey 2024; Li et al. Vicinagearth survey 2024.
    - Options Considered:
      - New multi-agent runtime (CrewAI clone, Magentic-One port, MegaAgent SOP-free spawn): rejected — docs already forbid a fifth runtime; MAST shows framework sprawl does not raise correctness.
      - Ship only examples (handoff/crew already this): rejected — hosts must each reimplement the spawn tool and its model-facing allow-list; Task 3 must retain regression coverage for parallel dispatch caps.
      - Compose supervisor + spawn tool + existing loop concurrency (chosen).
    - Chosen Approach:
      - Treat spawn as a **host tool** over `Supervisor.delegate`, not as model-owned process creation. Literature and host products agree: the model **proposes**; the host **authorizes, isolates, budgets, and joins**.
    - Freeze findings:
      - `delegate()` checks then increments `activeChildren` synchronously before its first `await` (`packages/prism-core/src/runtime/supervisor/supervisor.ts:L138-L151`), so direct `Promise.all(delegate())` cannot cross its base cap in one JavaScript realm. Task 3 is a regression proof first (including hook-narrowed limits); add no CAS, mutex, or second scheduler unless a test finds an entry point that bypasses this invariant.
      - `dispatchToolCallsInOrder` is existing bounded parallel dispatch: default `toolConcurrency` is 1, while any `exclusive` call serializes its full batch (`src/agent-loops.ts:L301-L360`). Spawn must therefore be non-exclusive; write tools stay exclusive.
      - `fanOutNode` is the host-authored, known-list path (`packages/prism-core/src/runtime/workflows/nodes.ts:L33-L35`; execution caps list length and worker count). It does not cover model-dynamic child selection.
      - `createCodingWorkspaceLifecycle` already owns worktree creation, canonical containment, fencing, verification, and cleanup (`packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:L243-L845`); no clone manager belongs here.
      - `subagent_started` / `subagent_stopped` remain consumer-gated and deferred (`packages/prism-coding-tools/src/agent/lifecycle.ts:L1-L8`). `delegated_agent_step` already has a bounded AG-UI projection (`src/delegated-agent-step.ts:L28-L59`, `packages/ag-ui/src/ag-ui-mapper.ts:L131-L162`).
      - Claude Code, Claude Agent SDK, and Codex confirm separate contexts, host-configured tool/permission narrowing, bounded concurrent children, background/waitable work, and worktree isolation. They do **not** require Prism to duplicate their host runtimes or name their tools identically.
      - Primary literature confirms only these product decisions: use parallelism for genuinely independent work; cap depth/concurrency/budget; keep parent authorization outside the model; and reject unbounded agent teams, ledgers, or role/SOP frameworks until a host need proves the existing catalog + workflow join insufficient.
    - API Notes and Examples:
      ```ts
      // Already ships. Hosts call this today; models cannot.
      const supervisor = createSupervisor({
        ownership,
        children: { explore: { createAgent: (ctx) => createExploreAgent(ctx) } },
        limits: { maxActiveChildren: 4, maxDepth: 2 },
      });
      await Promise.all([
        supervisor.delegate({ childId: "explore", input: "a" }),
        supervisor.delegate({ childId: "explore", input: "b" }),
      ]);
      ```
    - Files to Create/Edit:
      - none (freeze only). Update this plan if later tasks discover a primitive that already covers the gap.
    - References:
      - `createSupervisor` `packages/prism-core/src/runtime/supervisor/supervisor.ts:L119-L456`
      - `dispatchToolCallsInOrder` `src/agent-loops.ts:L301-L360`
      - `fanOutNode` `packages/prism-core/src/runtime/workflows/nodes.ts:L33-L35`
      - `assertIdentityPropagation` `src/identity.ts:L232-L246`
      - Evaluation table (this freeze):

        | Host need | Prism today | Gap |
        | --- | --- | --- |
        | Allow-listed child runs with budgets/hooks | `createSupervisor` / `delegate` | Host API only; no model-facing tool |
        | Parallel independent tools | `toolConcurrency` + `exclusive` | Default 1; spawn not a tool |
        | Parallel known DAG | `fanOutNode` + `maxConcurrency` | Host-coded graph, not dynamic spawn |
        | In-session specialist swap | example `handoff` tool | Deliberately not a primitive |
        | Cross-service agents | A2A 1.0 | Not in-process spawn |
        | Identity/scope never widens | `narrowIdentity` / `assertIdentityPropagation` | Spawn tool must call it |
        | Nested HITL | `resumeNestedRun` | Child events not projected on resume |
        | Subagent UI events | `createDelegatedAgentStep`; supervisor `delegation_*` | Coding `subagent_*` deferred |
        | Worktree isolation | `createCodingWorkspaceLifecycle` | Not wired to spawn |
        | Background threads | none | `delegate()` is blocking |
        | External harnesses | plan 073 Tasks 17–18 | Out of this plan |
        | MCP Tasks | explicitly unsupported | Stay unsupported |

        **Literature → Prism mapping**

        | Source | Claim | Prism implication |
        | --- | --- | --- |
        | Anthropic Research (2025) | Orchestrator-worker; parallel subagents; 90.2% vs single Opus on internal eval; ~15× tokens vs chat; token count explains ~80% BrowseComp variance; coding is a poor fit when steps are dependent; early agents spawned 50 children | Host caps (`maxActiveChildren`, `maxDepth`, token budgets) are the product; spawn prompts must carry objective/output format/tool bounds; do not default-spawn |
        | Codex / Claude Code | Model-requested subagents; parallel independent work; isolated context; optional worktree; inherit-or-narrow tools/sandbox; wait or stop; write-heavy caution | Need model-facing tool + isolation option + join; write tools stay `exclusive` |
        | MAST (Cemri et al. 2025) | 14 modes in (1) system design (2) inter-agent misalignment (3) task verification; MAS often ≈ single-agent | Do not add roles/SOPs; add verification as an allow-listed child type; eval spawn failures |
        | Delegation Without Trust (2026) | Untrusted model; four adversaries; auth must sit **outside** the model; LangGraph/CrewAI/AutoGen/MCP fail the set | `hooks.before`, AND-composed permission, no child credentials in context — keep; spawn tool must not accept caller-supplied tool lists |
        | Magentic-One (2024) | Orchestrator + WebSurfer/FileSurfer/Coder + ledgers | Catalog of host children, not a ledger primitive |
        | MetaGPT / CrewAI / CAMEL | Role SOPs / hierarchical crew | Already `examples/crew-hierarchy.ts` on workflows |
        | LangGraph `Send` | Dynamic map-reduce | `fanOutNode` covers host-known lists; spawn tool covers model-dynamic lists under the same caps |
        | Mixture-of-Agents / debate | Parallel proposers + aggregator | Host workflow join, not a new loop |
        | MegaAgent (ACL 2025) | No predefined SOPs, large-scale spawn | **Reject** — unbounded spawn is the Anthropic 50-child failure |
    - Chosen reuse (do not reimplement):
      - Supervisor: allow-list, depth, active children, timeouts, redaction, nested `delegate`, durable nested approvals.
      - Loops: parallel tool workers, exclusive serialization, durable sibling `tool_result` rows (plan 070).
      - Identity: fail-closed tenant/account/user/scope widen.
      - Workflows: static parallel research/crew.
      - Coding workspaces: worktree isolation.
    - Rejected new primitives: agent mailbox/teams, Magentic-One task ledger, MCP Tasks, free-form `subagent_type` from the model, per-child credential injection, second scheduler.
  - Test Cases to Write:
    - none (documentation freeze). Later tasks must fail the review if they add a second `delegate` implementation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — freeze only.
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable

- [x] Task 2 — `createSpawnAgentTool` over supervisor (depends on 1)
  - Acceptance Criteria:
    - Functional: factory returns a `ToolDefinition` whose `execute` allow-lists `childId` (or `subagent_type`) against `supervisor` children, redacts input, calls `delegate()`, returns bounded text/usage/status. Unknown type → standard tool error, no child created. Model-supplied tool names, identities, or limit raises are ignored. `exclusive` is false so several spawn calls in one turn may run under `toolConcurrency`.
    - Performance: one spawn is one `delegate()`; no extra provider call; input still byte-capped by supervisor `maxMessageBytes`.
    - Code Quality: lives next to supervisor; uses `ToolDefinition` already imported in supervisor tests; no new package.
    - Security: child identity is `narrowIdentity(parent, catalog.scopes)` then `assertIdentityPropagation`; child tools come only from the host catalog factory; SoD unchanged (agent principal cannot approve).
  - Approach:
    - Documentation Reviewed:
      - [`docs/supervisors.md`](../docs/supervisors.md); [`docs/tools.md`](../docs/tools.md); Claude Agent SDK `agents` parameter; Codex subagents.
    - Options Considered:
      - Hosts keep writing ad-hoc tools (current): every host reimplements allow-list + redaction.
      - New `AgentLoopStrategy` that auto-spawns: too much magic; MAST “disobey role/spec”.
      - Factory wrapping `delegate()` (chosen) — same move as the documented handoff example, but for separate child runs.
    - Chosen Approach:
      - Catalog is host-authored `Record<childId, SupervisorChild>` already required by `createSupervisor`. The tool derives its advertised `childIds` from that supervisor; its closed schema exposes `childId` + `input` (+ optional `threadId`) only. Limits on the call can only **narrow**.
      - `SupervisorChild.scopes` is the catalog's optional host-authored identity subset. `delegate()` applies `narrowIdentity` then `assertIdentityPropagation` before the child factory; no model argument can supply tools, identity, scopes, or limits.
    - Implementation completed (2026-09-15):
      - Added non-exclusive `createSpawnAgentTool` (`packages/prism-core/src/runtime/supervisor/spawn-tool.ts:L12-L61`), exported from the supervisor entry point. Unknown/malformed calls produce standard tool errors before delegation; successful calls return only redacted text, usage, and status.
      - Added supervisor-owned `childIds` and redaction accessors plus scoped child identity enforcement (`packages/prism-core/src/runtime/supervisor/supervisor.ts:L140-L340`; `types.ts:L41-L48`). No second scheduler, catalog, or tool factory.
      - Added mock-only unit coverage and a two-child one-turn example; documented spawn in supervisor and decision-table docs.
    - API Notes and Examples:
      ```ts
      import { createSupervisor, createSpawnAgentTool } from "@arnilo/prism-core/runtime/supervisor";

      const supervisor = createSupervisor({
        ownership,
        identity,
        children: {
          explore: {
            description: "Read-only codebase search. No writes.",
            permission: readOnly,
            createAgent: (ctx) => createExploreAgent(ctx),
          },
        },
        hooks: { before: ({ input }) => ({ input, limits: { maxTokens: 8_000 } }) },
      });

      const spawn = createSpawnAgentTool({
        supervisor,
        name: "spawn_agent",
        // description lists catalog ids so the parent model can choose; keep short (Claude 15k description budget).
      });

      const parent = createAgent({
        tools: [spawn, ...parentTools],
        loop: { strategy: "single-shot", toolConcurrency: 4 },
      });
      ```
    - Files Created/Edited:
      - `packages/prism-core/src/runtime/supervisor/spawn-tool.ts` — factory
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts`, `types.ts`, `index.ts` — catalog IDs, shared redaction, scoped child identity, export
      - `packages/prism-core/src/runtime/supervisor/__tests__/spawn-tool.test.ts` — fail-closed, redaction, scope, hook, and depth coverage
      - `examples/spawn-agent-tool.ts`, `examples/README.md` — two explores in one mock turn
      - `docs/supervisors.md`, `docs/multi-agent-patterns.md`, `docs/index.md` — public contract and decision table
    - References:
      - Handoff example pattern in `docs/multi-agent-patterns.md` (allow-list tool, fail-closed unknown target).
      - `createSpawnAgentTool` `packages/prism-core/src/runtime/supervisor/spawn-tool.ts:L12-L61`
      - `DelegationRequest` / `SupervisorChild.scopes` `packages/prism-core/src/runtime/supervisor/types.ts:L15-L48`
  - Test Cases Verified:
    - unknown childId: no `activeChildren` increment, tool error
    - known child: result text redacted, usage attributed, `delegation_started/finished` emitted
    - model-supplied `tools`/`scopes`/`maxActiveChildren` fields in args: ignored and absent from the closed schema
    - catalog scope widen attempt: fails before the child factory runs
    - hook deny: `delegation_rejected`, tool error, count back to 0
    - nested spawn via child `delegate()`: depth cap still holds
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new export `createSpawnAgentTool`.
    - Docs pages edited:
      - `docs/supervisors.md`: spawn-tool section (current contract, not a new page).
      - `docs/multi-agent-patterns.md`: fifth row “in-process spawn tool”.
    - `docs/index.md` update: yes — supervisor and multi-agent-patterns blurbs mention spawn.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3 — Atomic child-slot reservation for parallel spawn (depends on 2)
  - Acceptance Criteria:
    - Functional: N concurrent `delegate()`/`spawn` calls never exceed `maxActiveChildren`; the (N+1)th fails with `SupervisorLimitError` **before** `createAgent`. Parallel spawn of exactly `maxActiveChildren` all succeed.
    - Performance: reservation is the existing in-process counter; no extra I/O; p95 of mock `delegate` unchanged vs today within noise of `scripts/benchmark-scenarios/multi-agent-runtime.mjs`.
    - Code Quality: fix in `delegate()` so every caller (tool, host, nested) is covered — not a guard only in the spawn tool.
    - Security: failed reservation does not leave a live child, timer, or signal listener.
  - Approach:
    - Documentation Reviewed:
      - [`docs/supervisors.md`](../docs/supervisors.md) limits table; `runSupervisorFanOut` in `scripts/benchmark-scenarios/multi-agent-runtime.mjs`.
    - Options Considered:
      - Serialize spawn (`exclusive: true`): kills the host requirement (Claude/Codex parallel Task calls).
      - Tool-level semaphore: misses host `Promise.all(delegate)` and nested children.
      - Keep the reservation in `delegate()` (chosen). Without a hook it still checks and increments synchronously before its first `await`; with a hook it resolves narrowed limits first, then performs that same atomic reservation before `createAgent`.
    - Chosen Approach:
      - One `reserve()` increment site: before a child exists, immediately for no-hook calls and after effective hook-narrowed limits otherwise. Tests use `toolConcurrency: N` and raw `Promise.all`; no mutex or tool-local semaphore.
    - Implementation completed (2026-09-15):
      - Kept base calls' pre-await reservation and deferred hook calls' reservation until `before` returns narrowed limits (`packages/prism-core/src/runtime/supervisor/supervisor.ts:L140-L346`). A `reserved` flag releases only acquired slots, including child-factory aborts.
      - This fixes the real hook path found by the regression: three parallel calls under a hook cap of two previously rejected all three before a child factory ran. It now admits two and rejects only the overflow, with no I/O, mutex, or second scheduler.
      - Mock benchmark remains within its 500 ms ceilings: `supervisorFanOut` p95 9.134 ms and saturation p95 9.447 ms (20 measured operations).
    - API Notes and Examples:
      ```ts
      await session.run("spawn two explores", {
        loop: { strategy: "single-shot", toolConcurrency: 4 },
      });
      // Provider emits two spawn_agent tool_calls in one turn.
      ```
    - Files Edited:
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts` — reserve after effective limits; release only reserved slots
      - `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts` — direct and hook-narrowed concurrent cap regressions; abort cleanup assertion
      - `packages/prism-core/src/runtime/supervisor/__tests__/spawn-tool.test.ts` — `toolConcurrency: 3` cap and mixed exclusive-turn regressions
    - References:
      - reservation `packages/prism-core/src/runtime/supervisor/supervisor.ts:L140-L346`
      - direct/hook regression `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts:L174-L205`
      - spawn dispatch regression `packages/prism-core/src/runtime/supervisor/__tests__/spawn-tool.test.ts:L116-L198`
      - exclusive serialization `src/agent-loops.ts:L301-L360`
  - Test Cases Verified:
    - `maxActiveChildren: 2`, three parallel `delegate()`: two run, one `SupervisorLimitError`, final `activeChildren === 0`
    - hook-narrowed `maxActiveChildren: 2`, three parallel `delegate()`: same exact admission and cleanup
    - same via spawn tool + `toolConcurrency: 3`
    - exclusive write tool in the same turn as spawn: whole turn sequential (existing exclusive rule)
    - abort during `createAgent`: count decremented
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; existing supervisor cap semantics are now regression-proven.
    - Docs pages edited: none — current limits contract remains accurate.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 4 — Consume `subagent_started` / `subagent_stopped` (depends on 2)
  - Acceptance Criteria:
    - Functional: spawn tool (and host `delegate` opt-in emitter) produces coding lifecycle `subagent_started`/`subagent_stopped` with childId, delegationId, depth, status; ACP/AG-UI mappers surface them. Manifest deferred list removes those two names once a consumer exists.
    - Performance: event payload ≤ existing `DEFAULT_LIFECYCLE_MAX_EVENT_BYTES`; no child transcript body.
    - Code Quality: reuse `createDelegatedAgentStep` where the UI step is needed; do not add a third event vocabulary.
    - Security: redacted ids only; no input/output bodies; nested path truncated as supervisor already does (≤8).
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-coding-tools/src/agent/lifecycle.ts` L1–L8
      - [`docs/agent-events.md`](../docs/agent-events.md) `delegated_agent_step`
      - [`docs/acp.md`](../docs/acp.md), [`docs/ag-ui.md`](../docs/ag-ui.md)
    - Options Considered:
      - Keep deferred forever: hosts cannot render Claude-like agent view.
      - New event type in core AgentEvent: duplicates `delegation_*`.
      - Bridge supervisor `delegation_*` → coding lifecycle + existing delegated step (chosen).
    - Chosen Approach:
      - One adapter: `observeSupervisorLifecycle(supervisor, { onEvent })` maps supervisor started/finished/rejected/error milestones to coding events. It applies the supervisor redactor, omits paths and bodies, and leaves the existing lifecycle emitter to enforce its 16 KiB default event cap.
      - The optional `delegatedAgentStep` callback constructs `createDelegatedAgentStep` records for the existing AG-UI mapper; ACP maps the coding events to bounded `agent_message_chunk` updates. No core AgentEvent or third event vocabulary was added.
    - Implementation completed (2026-09-15):
      - Added exported `observeSupervisorLifecycle` (`packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L19-L92`) and supported `SubagentStartedEvent` / `SubagentStoppedEvent` lifecycle shapes (`lifecycle.ts:L60-L74`). Direct `delegate()` and `spawn_agent` share the same supervisor stream, so a host opt-in observes both with one adapter.
      - Rejected supervisor events become stopped `denied`; errors become stopped `failed`; neither requires a prior started event. The bridge ignores reason/error bodies and applies `supervisor.redact()` to both IDs.
      - Added ACP redacted start/stop messages (`packages/ag-ui/src/acp/mapper.ts:L51-L118`). AG-UI already maps the emitted `delegated_agent_step` kind, so no mapper vocabulary changed.
      - Removed both lifecycle kinds from Phase 10’s deferred manifest list, added exports/events/mappings, and documented the current contract.
    - API Notes and Examples:
      ```ts
      const stop = observeSupervisorLifecycle(supervisor, {
        onEvent: lifecycle.emit,
        delegatedAgentStep: { sessionId, runId, adapterId: "coding-host", externalConversationId, onEvent: publishAgentEvent },
      });
      // Call stop() when the host tears down its event stream.
      ```
    - Files Created/Edited:
      - `packages/prism-coding-tools/src/agent/lifecycle.ts`, `index.ts` — supported lifecycle union and public export
      - `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts` — supervisor observer and optional AG-UI step bridge
      - `packages/prism-coding-tools/src/agent/__tests__/lifecycle.test.ts`, `supervisor-lifecycle.test.ts` — manifest, redaction, terminal, and cap tests
      - `packages/ag-ui/src/acp/mapper.ts`, `__tests__/acp-lifecycle.test.ts`, `__tests__/ag-ui-mapper.test.ts` — ACP messages and existing AG-UI activity wiring
      - `scripts/phase10-freeze-manifest.json` — remove deferred names and record mappings
      - `docs/agent-events.md`, `docs/coding-agent-tools.md`, `docs/acp.md`, `docs/ag-ui.md` — public contract
    - References:
      - observer `packages/prism-coding-tools/src/agent/supervisor-lifecycle.ts:L19-L92`
      - lifecycle events `packages/prism-coding-tools/src/agent/lifecycle.ts:L60-L74`
      - supervisor source events `packages/prism-core/src/runtime/supervisor/types.ts:L84-L128`
      - `createDelegatedAgentStep` `src/delegated-agent-step.ts:L28-L59`
      - ponytail-subagent hook is Claude Code upstream, not this runtime — do not port it
  - Test Cases Verified:
    - paired started/stopped milestones from delegate/spawn’s shared supervisor stream: redacted IDs, depth, succeeded status, no child body
    - rejected/error without a start: stopped `denied` / `failed`, with reasons omitted
    - oversized child ID: lifecycle emitter drops the event at its existing byte cap
    - ACP fixture: redacted start/stop `agent_message_chunk`, no input/output
    - AG-UI fixture: optional delegated step becomes active/done subagent activity, no transcript body
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two lifecycle kinds and `observeSupervisorLifecycle` are exported.
    - Docs pages edited: `docs/agent-events.md`, `docs/coding-agent-tools.md`, `docs/acp.md`, `docs/ag-ui.md`.
    - `docs/index.md` update: no — existing coding-tools, ACP, and AG-UI navigation remains accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 5 — Bounded async spawn, wait, cancel (depends on 3, 4)
  - Acceptance Criteria:
    - Functional: spawn tool accepts `mode: "sync" | "async"` (default `sync`). Async returns `{ delegationId, status: "running" }` without awaiting the child. `wait_agent` / `cancel_agent` tools (or the same tool with `action`) join or abort by id, ownership-scoped. Parent abort cancels running children. Wait-all is N wait calls or one wait with id list, capped.
    - Performance: default/hard cap on concurrent async children = supervisor `maxActiveChildren`; wait timeout ≤ supervisor `timeoutMs`; no unbounded promise table.
    - Code Quality: registry of in-flight delegations on the supervisor object; no second process manager.
    - Security: wait/cancel of a foreign `delegationId` fails closed with one non-enumerating error (same as nested resume).
  - Approach:
    - Documentation Reviewed:
      - Codex “wait for all, then summarize”; Claude background sessions / agent view; [`docs/supervisors.md`](../docs/supervisors.md) timeout/abort.
    - Options Considered:
      - Only sync spawn: cannot match Claude/Codex background threads.
      - Full agent-teams mailbox: YAGNI (Anthropic: coding agents are bad at live coordination).
      - Supervisor-owned in-flight map + wait/cancel tools (chosen).
    - Chosen Approach:
      - `delegateAsync` returns a handle; `delegate()` remains blocking. Spawn tool is the only new model surface.
    - Implementation completed (2026-09-15):
      - `Supervisor` gained `delegateAsync` / `wait` / `cancel` plus `DelegationHandle`, `DelegationWaitResult`, and `DelegationWaitOptions` (`packages/prism-core/src/runtime/supervisor/types.ts:L24-L37`, `L173-L184`). `delegate()` is unchanged and still blocking; async is one `runningDelegations` map on the existing supervisor object — no second process manager, no new scheduler.
      - `delegateAsync` reuses the Task 3 reservation path by handing a stable `delegationId` + `AbortController` to `delegate()` via its existing `launch` argument (`supervisor.ts:L379-L397`), so `maxActiveChildren` caps async children with no separate counter and the pre-flight no-hook cap check avoids returning a misleading `running` handle.
      - Terminal async records move to a bounded `completedDelegations` map evicted at `maxQueuedEvents` (`supervisor.ts:L399-L405`); in-flight entries are capped by `maxActiveChildren`, so no promise table is unbounded. `wait()` is idempotent for retained terminals, is capped by the supervisor `timeoutMs` (`waitFor`), and `cancel()` aborts only this supervisor's own handle.
      - Parent abort was already covered: the spawn tool forwards `ToolExecutionContext.signal` into both sync and async requests (`packages/prism-core/src/runtime/supervisor/spawn-tool.ts:L47-L61`), and `delegate()` links request/chain signals to the child controller.
      - Model surfaces are two separate non-exclusive tools, `wait_agent` and `cancel_agent`, each with a closed single-`delegationId` schema (`spawn-tool.ts:L68-L121`). Unknown **and** foreign ids throw the same `SupervisorDeniedError: Unknown async delegation`, matching nested-resume non-enumeration; wait/cancel results and failures pass through `supervisor.redact()`. Wait-all is N `wait_agent` calls (one per handle) rather than a new id-list schema.
      - Performance: ad-hoc 4-child `delegateAsync` + join benchmark (5 warmups, 20 iterations, mock provider) — p50 0.437 ms, p95 1.008 ms, `activeChildren` back to 0 every iteration.
    - API Notes and Examples:
      ```ts
      // Parent turn 1
      spawn_agent({ childId: "explore", input: "auth", mode: "async" })
      spawn_agent({ childId: "explore", input: "payments", mode: "async" })
      // Parent turn 2 (one wait_agent call per handle)
      wait_agent({ delegationId: "…" })
      wait_agent({ delegationId: "…" })
      ```
    - Files Created/Edited:
      - `packages/prism-core/src/runtime/supervisor/types.ts` — handle/wait types + three `Supervisor` methods
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts` — `delegateAsync` / `wait` / `cancel` over the existing reservation and timeout path
      - `packages/prism-core/src/runtime/supervisor/spawn-tool.ts` — `mode` argument + `createWaitAgentTool` / `createCancelAgentTool`
      - `packages/prism-core/src/runtime/supervisor/index.ts` — export the two new tool factories
      - `packages/prism-core/src/runtime/supervisor/__tests__/supervisor.test.ts`, `spawn-tool.test.ts` — async join, cancel, parent-abort, unknown-id, and cap tests
      - `examples/spawn-agent-tool.ts` — async spawn turn + wait turn
      - `docs/supervisors.md`, `docs/multi-agent-patterns.md`, `docs/index.md` — public contract
    - References:
      - `delegateAsync` / `wait` / `cancel` `packages/prism-core/src/runtime/supervisor/supervisor.ts:L379-L428`
      - `createWaitAgentTool` / `createCancelAgentTool` `packages/prism-core/src/runtime/supervisor/spawn-tool.ts:L68-L121`
      - abort/timeout already cover hooks and child creation (`docs/supervisors.md`)
  - Test Cases Verified:
    - async spawn then wait: same redacted result as sync, repeated wait idempotent, spawn-tool cap still enforced while one async child holds the only slot
    - cancel: child signal aborted, `activeChildren` 0, `wait` returns `{ status: "cancelled" }`, second `cancel` returns false, unknown id non-enumerating on both tools
    - parent session abort: aborting the tool context signal aborts the running child and releases its slot
    - wait after already-finished: retained terminal result returns; evicted terminal throws the same non-enumerating error
    - timeout: `wait` rejects at the supervisor `timeoutMs` and leaves `activeChildren` 0
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — supervisor + spawn tool.
    - Docs pages to create/edit: `docs/supervisors.md`, `docs/multi-agent-patterns.md`
    - `docs/index.md` update: yes — supervisors sentence includes async wait/cancel
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 6 — Optional worktree isolation on spawn (depends on 2)
  - Acceptance Criteria:
    - Functional: catalog entry may set `isolation: "worktree"`. Spawn then `create`s a coding workspace keyed by `delegationId`, passes `cwd` into the child factory, `cleanup`s on child terminal (success/fail/cancel). Default remains shared cwd.
    - Performance: one `git worktree add` per isolated child; cleanup idempotent; no clone.
    - Code Quality: call `createCodingWorkspaceLifecycle` from the child factory helper; supervisor stays git-agnostic.
    - Security: worktree roots stay inside host-approved `worktreeRoots`; child cannot `cd` back to main checkout (coding-workspaces verify). Write-heavy parallel isolated children allowed; write-heavy parallel **shared** cwd still serialized via `exclusive` tools.
  - Approach:
    - Documentation Reviewed:
      - [`docs/coding-workspaces.md`](../docs/coding-workspaces.md); Claude Code worktrees; Codex subagent sandbox guidance.
    - Options Considered:
      - Always isolate: too expensive for explore-only children.
      - New sandbox type: duplicates workspaces + process sessions.
      - Opt-in catalog flag using existing workspace lifecycle (chosen).
    - Chosen Approach:
      - Helper `createWorktreeChildFactory(baseFactory, workspaces)` in coding-tools, not in supervisor.
    - Implementation completed (2026-09-15):
      - Added `createWorktreeChildFactory(factory, { workspaces, repositoryId, branch? })` in `packages/prism-coding-tools/src/agent/spawn-worktree.ts:L33-L57` (exported from `agent/index.ts`). It returns `{ createAgent, after }`: `createAgent` calls `workspaces.create({ taskId: delegationId, repositories: [{ repositoryId, branch: branch ?? `agent/${delegationId}` }] })` before the child exists and passes the record's `worktreePath` as `cwd` in an extended child context; `after` is the supervisor terminal hook.
      - Supervisor core stayed git-agnostic and unchanged. Opt-in is the wrapping helper on one catalog entry plus `hooks: { after: isolated.after }`; unwrapped children keep the shared cwd with no Git call. The `isolation: "worktree"` catalog flag in the acceptance criteria is realized as this wrapper rather than dead config on `SupervisorChild`.
      - Terminal coverage uses the existing `hooks.after` (fired on success, failure, abort, and pre-spawn rejection; not on suspension), so `cleanup({ taskId: delegationId })` is one-shot and idempotent. Suspended children keep their worktree, and resume re-creates the identical workspace (same task id and default branch). Resume-path terminal hooks are a known gap tracked by Task 7.
      - Containment/limits are inherited from `createCodingWorkspaceLifecycle`: `worktreeRoots` and repository validation run before the child factory, so a misconfigured host fails closed with `ERR_PRISM_WORKSPACE_LIMIT`/`ERR_PRISM_WORKSPACE_UNKNOWN` and no Git mutation. Dirty isolated worktrees still refuse removal unless the host sets `policy.allowDirtyCleanup`; host restarts lose in-process ownership and reconcile through `list`/`cleanup`.
    - API Notes and Examples:
      ```ts
      const isolated = createWorktreeChildFactory((ctx) => createExploreAgent(ctx, ctx.cwd), { workspaces, repositoryId: "app" });
      createSupervisor({
        children: { explore: { createAgent: isolated.createAgent } },
        hooks: { after: isolated.after },
      });
      ```
    - Files Created/Edited:
      - `packages/prism-coding-tools/src/agent/spawn-worktree.ts` — helper + `WorktreeChildContext`/`WorktreeChildFactory` types
      - `packages/prism-coding-tools/src/agent/index.ts` — public export
      - `packages/prism-coding-tools/src/agent/__tests__/spawn-worktree.test.ts` — helper, cleanup, resume, and fail-closed tests
      - `docs/coding-workspaces.md` — spawn isolation section; `docs/supervisors.md` — pointer + Related APIs; `docs/index.md` — coding-workspaces blurb
    - References:
      - `createCodingWorkspaceLifecycle` `packages/prism-coding-tools/src/agent/workspace-lifecycle.ts:L243-L845`
      - `SupervisorHooks.after` `packages/prism-core/src/runtime/supervisor/types.ts:L92-L95`
  - Test Cases Verified:
    - isolated child writes: the child receives its own `cwd` (the record `worktreePath`); construction of the helper performs no Git or store work, and a shared-cwd sibling never cleans another helper's tree
    - cleanup on success and on abort: `after` calls `cleanup({ taskId: delegationId })` once per created workspace; repeat calls and foreign delegation ids are no-ops
    - resumed delegation re-creates the identical workspace (same task id and default branch, no second one)
    - cleanup refusal (dirty worktree) rejects out of `after` and surfaces as the supervisor's terminal-hook error
    - missing `worktreeRoots`: real lifecycle fails closed with `ERR_PRISM_WORKSPACE_LIMIT` before the child factory runs and before any Git call
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — coding-tools helper.
    - Docs pages to create/edit: `docs/coding-workspaces.md`, `docs/supervisors.md`
    - `docs/index.md` update: no if pages already exist and blurbs stay accurate; yes if coding-workspaces blurb should mention spawn isolation
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 7 — Child-event passthrough on `resumeNestedRun` (depends on 4)
  - Acceptance Criteria:
    - Functional: with `childEvents: true`, resume of a nested child projects the same milestone subset as live `delegate()` (`docs/supervisors.md` currently says it does not). Resume also runs the terminal `hooks.after` with the same `delegationId`, which is what lets Task 6's worktree isolation clean up a child that suspended before deciding.
    - Performance: same caps `maxChildEventsPerDelegation` / `maxChildEventBytes`; overflow marker once.
    - Code Quality: one projection helper used by both live and resume paths.
    - Security: redactor applied; no per-token deltas.
  - Approach:
    - Documentation Reviewed:
      - [`docs/supervisors.md`](../docs/supervisors.md) “Resume-path rebuilds (`resumeNestedRun`) do not currently project child events”.
    - Options Considered:
      - Leave gap: ACP reconnects go blind after HITL.
      - Full transcript replay: out of scope (ACP already has bounded replay).
      - Milestone passthrough on resume (chosen).
    - Chosen Approach:
      - Extract projection from `delegate()`; call from resume rebuild.
    - Implementation completed (2026-09-15):
      - No new projection code: the existing `startChildEventPump` is now attached by both paths (one helper, `packages/prism-core/src/runtime/supervisor/supervisor.ts:L95-L133`).
      - Core gained the smallest possible seam: `AgentRunResumeOptions.onSession?: (session: AgentSession) => void` (`src/contracts-run-state.ts:L235-L240`), called once in `prepareAgentRunResume` right after the `RuntimeAgentSession` is constructed (`src/agent-run-lifecycle.ts:L191-L194`), before any subscription, checkpoint write, or tool work. A throwing observer fails that resume closed. Resume already rebuilt the session internally, so without this seam the supervisor had no session handle to subscribe to.
      - `resumeNestedRun` (`packages/prism-core/src/runtime/supervisor/supervisor.ts:L441-L545`) passes `onSession` and starts the pump only when `options.childEvents === true`, with the resumed run's narrowed `limits` and the supervisor redactor. The pump is stopped in a `finally`, so a failed rebuild cannot leak a subscription.
      - Terminal symmetry with live `delegate()`: a non-suspended result publishes `delegation_finished` and runs `hooks.after` once through `toCompletion` with the original `childId`/`delegationId` (this is what closes Task 6's resume gap); a denied rebuild publishes `delegation_rejected`, runs the hook with status `rejected`, and returns the same `delegation_denied` outcome; a suspension stays non-terminal (no event, no hook) with the mapping re-saved as before.
      - Deliberate scope choice: a rebuild that throws before the run starts (stale version, fingerprint drift, unknown id) publishes nothing and runs no terminal hook. Only the raised reason does that — a duplicate/stale resume attempt must never clean up a live suspended child's worktree.
      - Budget bookkeeping this task forced: `scripts/budgets.json` export ceilings rebaselined for plan 078's public surface (+8 `@arnilo/prism-core`, +8 `@arnilo/prism-coding-tools`) with recorded reasons; `docs/_evidence/phase54-package-map.md` regenerated; comma-operator lint sites in the supervisor tests replaced with block bodies; two non-null assertions in `supervisor.ts` removed instead of raising the ratchet.
    - API Notes and Examples:
      ```ts
      createSupervisor({ childEvents: true, checkpoints, definitionRevision: "1" });
      ```
    - Files Created/Edited:
      - `packages/prism-core/src/runtime/supervisor/supervisor.ts` — resume-path pump, terminal event + hook parity
      - `src/contracts-run-state.ts`, `src/agent-run-lifecycle.ts` — `onSession` resume observer seam
      - `packages/prism-core/src/runtime/supervisor/__tests__/nested-approvals.test.ts` — four resume-passthrough cases
      - `docs/supervisors.md`, `docs/agent-session-runtime.md` — resume passthrough + `onSession`
    - References:
      - `docs/supervisors.md` child event passthrough section; `docs/agent-session-runtime.md` durable runs
  - Test Cases Verified:
    - child suspends on tool → resume → `delegation_child_event` for `tool_execution_started` (plus `agent_finished`); `agent_started` appears once per attempt, tags stay `{childId, delegationId, depth}`, and no message deltas leak
    - cap still emits exactly one `delegation_child_events_capped` on the resumed pump (`maxChildEventsPerDelegation: 2`)
    - `childEvents: false` resume stream stays free of child events while `hooks.after` still runs once
    - a denied rebuild is terminal: one `delegation_rejected` event and one `after` completion with status `rejected`
  - Verification: `node --test packages/prism-core/dist/runtime/supervisor/__tests__/*.test.js` 45/45, `node --test packages/prism-coding-tools/dist/agent/__tests__/spawn-worktree.test.js` 5/5, full `npm test` all 5 stages green (root suites, gate suites incl. budget/lint/phase54 map, build race, workspace suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented resume limitation removed.
    - Docs pages to create/edit: `docs/supervisors.md` (delete the “not currently” sentence; state live+resume).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 8 — Spawn eval pack (MAST + untrusted-model) (depends on 2, 3, 5)
  - Acceptance Criteria:
    - Functional: scenario pack grades (a) advertised spawn vs actual allow-list (capability-truth, plan 072 invariant), (b) parallel cap, (c) identity/tool non-widen, (d) cancel, (e) a critic/verify child type that can fail the parent (MAST category 3). No SWE-bench, no new metric zoo.
    - Performance: mock providers only in default CI; live optional.
    - Code Quality: `defineScorer` / `runScenario` from plan 072; do not invent `trajectory.ts`.
    - Security: injected parent that requests a non-catalog child or extra scope scores 0.
  - Approach:
    - Documentation Reviewed:
      - [`docs/evaluations.md`](../docs/evaluations.md); plan 073 Task 31 activity packs; MAST arXiv:2503.13657; arXiv:2609.00267.
    - Options Considered:
      - Port MAST-Data 1600 traces: out of scope.
      - Small host-owned scenario pack on Prism primitives (chosen).
    - Chosen Approach:
      - Four scenarios, one scorer each, packed eval manifest additive fields only.
    - Implementation completed (2026-09-15):
      - One new fixture module, no new runner and no new public export: `packages/prism-core/src/governance/evals/__tests__/spawn-pack.test.ts` (prism-core governance/evals tree, the plan 072 primitives) over `defineScorer` + `runScenario` + structured host facts. No `trajectory.ts` change, no extra harness, no SWE-bench, no dataset store.
      - Five hard 0/1 invariants (`metadata.invariant: true`, so no weighted average can hide one): `spawn.capability-truth` (every child that ran was both advertised by the real tool schema and present in the host catalog), `spawn.parallel-cap` (`maxConcurrent <= maxActiveChildren` high-water mark from the supervisor's child factories/completions), `spawn.non-widen` (no child received scopes outside the parent identity and no declared-denied tool executed inside a child), `spawn.cancel` (the child's abort signal fired and `supervisor.activeChildren` is 0 after the join), `spawn.critic-gate` (a failed verification child blocks parent effects until the host join policy reads the verdict — MAST category 3).
      - Grading reads only structured host facts (child ids, scopes, counters, supervisor getters) from the run environment, never model prose, and each scenario is graded by all five invariants: non-applicable invariants score 1 on declared observation fields, so the pack is a matrix instead of five isolated checks. Spec-deviation note: the plan sketched the `defineScorer` input as a raw `timeline`; the shipped 072 contract is `score({ result, timeline, environment })`, so the pack uses `environment` and keeps timeline projection off (advertisement truth is read from `tool.parameters.properties.childId.enum`, which is the actual model-facing allow-list).
      - All five scenarios run the shipped composition with mock providers only: injected parent asking for an uncatalogued `deploy` child plus `scopes: ["admin"]`/`tools: ["write"]` spawn arguments, three concurrent spawns against `maxActiveChildren: 2`, a catalog child declaring `scopes: ["write"]` under a `["read"]` parent next to an explore child told to use the write tool, async spawn → `cancel_agent` → `wait_agent`, and critic-verdict-join-then-ship.
      - Six negative controls wire deliberately vulnerable host compositions and assert the matching grader reports 0 *naming the violation*: a host tool spawning outside the catalog, a spawn path skipping the reservation (`toolConcurrency: 3` → high-water 3 against cap 2), a host honouring model-supplied `scopes`, a child granted a write tool it should not have, a cancel path that reports cancellation without aborting, and a parent shipping after a failed critic without joining. Each control also asserts the vulnerable composition really produced the violation (the child really ran, the overshoot really happened), so a control cannot pass for the wrong reason. The cancel control settles its deliberately-stranded child in a `finally` cleanup instead of leaking a supervisor delegation timeout.
    - API Notes and Examples:
      ```ts
      defineScorer({ id: "spawn.capability-truth", score: ({ environment }) => … });
      ```
    - Files Created/Edited:
      - `packages/prism-core/src/governance/evals/__tests__/spawn-pack.test.ts` (new — pack, fixtures, controls)
      - `docs/evaluations.md` — subagent spawn pack section
    - References:
      - plan 073 Task 21/31: nested/subagent cannot broaden grant; delegation capability-truth was deferred there as out of 0.7.0 and now exists as this core fixture (wiring it into the packed release journey, if claimed, belongs to the release cut, not here)
  - Test Cases Verified (11 passing in `spawn-pack.test.js`, 150 ms, no lingering timers):
    - five shipped-composition scenarios pass every invariant with `status: "scored"` and `score: 1`
    - unknown child advertised in the tool schema but absent from the catalog: score 0 when it runs
    - parallel 3 vs cap 2: overshoot is failure
    - injected scope escalation and injected "use write tools": score 0
    - critic child returns fail → parent effect without a host join: score 0
    - fake cancel (no abort): score 0
  - Verification: `node --test packages/prism-core/dist/governance/evals/__tests__/spawn-pack.test.js` 11/11; full `npm test` all 5 stages green (root suites, gate suites incl. budget/lint/docs, build race, workspace suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new runtime API — eval fixture only.
    - Docs pages to create/edit: `docs/evaluations.md` subagent spawn pack section added (the page lists curated network-free adversarial packs).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 9 — Docs and example wiring (depends on 2–7 as shipped)
  - Acceptance Criteria:
    - Functional: current-contract docs match shipped APIs; decision table has spawn-tool row; example runs under mock provider.
    - Performance: example stays network-free.
    - Code Quality: no release narrative, no plan numbers in `/docs` bodies; index blurbs one sentence.
    - Security: examples use `narrowIdentity`, read-only explore child, fail-closed unknown type.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; `docs/api-page-template.md`; `docs/index.md` Multi-agent heading.
    - Options Considered:
      - New `docs/subagent-spawn.md`: extra page for one factory.
      - Extend `supervisors.md` + `multi-agent-patterns.md` (chosen).
    - Chosen Approach:
      - Update those two plus index blurbs; example `examples/spawn-agent-tool.ts`.
    - Implementation completed (2026-09-15):
      - No new page: `docs/supervisors.md` + `docs/multi-agent-patterns.md` carry the spawn contract, so the wiki structure stays as-is. Index blurbs already matched the planned wording from Task 2 (`docs/index.md:162-163`), so Task 9 changed only what was stale.
      - `examples/spawn-agent-tool.ts` rewritten to the full Task 9 security story: verified host `AgentIdentity` → `narrowIdentity(host, { scopes: ["read"] })` for the child grant (plus `assert.throws` on a widening `["admin"]` grant), one read-only `read` tool as the explore child's whole tool set, the child factory asserting the identity it receives is `["read"]`, two explores spawned in parallel in one tool turn, an uncatalogued `deploy` request refused, then both handles joined. `demo()` asserts `spawned === 2`, `peak === 2` (real parallelism high-water from the factory + terminal hook, not a timing guess), `refused === ["deploy"]`, `handles.length === 2`, `activeChildren === 0`; it also gained the repo's self-run guard so `node examples/spawn-agent-tool.ts` prints the demo result.
      - Contract accuracy pass against shipped APIs: added the `Supervisor.childIds` row to the `docs/supervisors.md` inputs table (the spawn tool's schema enum source — what makes “advertised capability” a host fact rather than prose) and a Related APIs link to `observeSupervisorLifecycle`.
      - Added “How the in-process spawn tool works” to `docs/multi-agent-patterns.md` (handoff and crew each had a section; spawn had only a bullet + decision-table row): closed schema and fail-closed unknown ids, parallel dispatch under `toolConcurrency` with supervisor reservation against `maxActiveChildren`, async handles with `wait_agent`/`cancel_agent` and parent-abort propagation, worktree isolation and lifecycle-event visibility cross-links, and the live demo link.
      - Doc-quality fixes for this plan's own additions (accepted criterion: no plan numbers, no release narrative in `/docs` bodies): dropped “(Task 6)” from `docs/supervisors.md`, dropped “(plan 078 Task 7)” from `docs/agent-session-runtime.md`, and corrected `docs/coding-workspaces.md` — the suspended-children sentence still said resume parity was pending, but Tasks 6+7 shipped it, so it now states that a suspended child is not cleaned while non-terminal and the resume attempt's terminal outcome runs the cleanup hook. Plan-number mentions belonging to earlier plans were left untouched (repo-wide convention, out of scope here).
      - `examples/README.md`: spawn entry updated to describe the narrowed read-only explores, the refused uncatalogued child, and the joined handles.
    - API Notes and Examples:
      ```md
      | In-process spawn tool | Parent model must request children; host still owns catalog/budgets | Separate child runs via supervisor | Same as supervisor |
      ```
    - Files Created/Edited:
      - `examples/spawn-agent-tool.ts` (rewritten)
      - `examples/README.md`
      - `docs/supervisors.md`, `docs/multi-agent-patterns.md`, `docs/coding-workspaces.md`, `docs/agent-session-runtime.md`
      - (`docs/index.md` was already current from Task 2; no edit needed)
    - References:
      - prism-wiki.md API page structure if any new page is forced; prefer not to add one
  - Test Cases Verified:
    - `node examples/spawn-agent-tool.ts` → `{"spawned":2,"refused":["deploy"],"status":"succeeded"}`; asserts two parallel explores (`peak === 2`) and the unknown child fail-closed
    - `tsc -p examples` (strict, noEmit) and `biome check` clean; demo stays network-free (mock provider only)
    - docs gates: `dist/__tests__/docs.test.js` (README lists every example, index/pattern-page tokens, cross-links) green in the full `npm test` run
  - Verification: `npm test` all 5 stages green. One transient workspace-stage failure was observed once under load (timing-sensitive `prism-coding-tools` process tests, 30 ms–600 ms budgets) and did not reproduce in two further full `npm test` runs plus three targeted runs of the two suspect files; doc/example-only edits cannot reach that stage. `graft build` refreshed after the example change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — docs for Tasks 2–7.
    - Docs pages to create/edit: listed above
    - `docs/index.md` update: yes
      - Multi-agent and interoperability: supervisors blurb = “Child allow-lists, spawn tool, narrowed permissions, finite budgets, nested delegation, async wait/cancel.”
      - multi-agent-patterns blurb = “Decision table for handoff, crew, supervisor spawn, and A2A.”
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Compromises Made

- Known constraint: no fifth runtime. Spawn is a tool over `createSupervisor`.
- Known constraint: plan 073 keeps R09 external harness adapters and R01 aggregate parent/child accounting.
- Known constraint: MCP Tasks remain unsupported (plan 063).
- Known constraint: Magentic-One ledgers, Claude agent-teams mailboxes, MegaAgent SOP-free spawn, and debate primitives are out of scope until a host shows a seam the catalog+workflow join cannot express.
- Known constraint: `subagent_*` lifecycle ships only with Task 4’s consumer, matching the Phase 10 freeze rule.

## Further Actions

- After execution: measure whether hosts still wrap `delegate()` themselves; if two hosts need different spawn schemas, *then* consider a thinner helper.
- Agent-teams / mailbox: add only if live inter-child messages are required; Anthropic found coding agents weak at real-time coordination.
- CitationAgent (Anthropic research) is an allow-listed child type + RAG citations (plan 073 R10), not a spawn primitive.
- Host composition profiles do not require spawn; keep opt-in.
