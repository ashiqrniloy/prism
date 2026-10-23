# Phase 11 Part R — delegation for coding workflows

## Objectives

- Let the model choose a child and brief it well: every child has a description, and the tool says the child sees nothing but the brief.
- Give children budgets that can finish coding work, and remove the configuration knobs that duplicate each other.
- Make a coding child safe to run in parallel: an isolated worktree per delegation, merged back deterministically.
- Stop killing a child that needs approval, and give children the parent's skills.
- Accept subagent files written for other coding agents (`.agents/agents/*.md`, `.claude/agents/*.md`).
- Keep the parent's context small (context-rot review, 2026-10-17). A child is the strongest isolation available: Context-Folding (arXiv 2510.11967) reports a 10× smaller active context at equal or better task success. That only holds if the child's answer reaching the parent is bounded, so the result is capped and paged.
- Let a host choose, per child, whether the child sees the parent's conversation (owner decision 2026-10-23). A child that starts blind sees only the parent model's brief, so it inherits the parent's blind spots. This matters most for reviewers and advisors.
- Ship a host-agnostic advisor: one model call that takes a bounded transcript slice and returns advice. It can be called by the model as a tool or triggered by hooks before named tools and before the final answer. Without it, every host rebuilds the same tool, hooks, and slicing.
- Let a host validate that a task is complete before a run ends (owner decision 2026-10-23), using either a model or a tool-using delegate child that checks the evidence. The validation is judged against the run's original task, not the newest turns. A run that ends unverified is visible to the host. Today the model decides on its own that it is done, and a host hook cannot start a delegate child.

## Expected Outcome

- The `delegate` tool's description lists `name — description` per child, and `input` is described as a self-contained brief.
- A child with no `limits` gets 50 turns, 200 tool calls, 500,000 total tokens, and 15 minutes (was 8, 32, 20,000, and 60 seconds). `budgetShare` and `lifetime` are gone: `mode: "sync"` is tied to the calling tool call, and `mode: "async"` runs as session background work.
- `isolation: "worktree"` runs the child in its own worktree and, when it finishes, merges its changes into the parent's checked-out branch. A conflict, or a dirty target, returns `merge: { status: "conflict" | "refused", files, branch }` and keeps the branch for a person to resolve.
- A child's approval request reaches the parent's `host.ui`; a child suspends only when the parent host answers `unavailable`.
- A child inherits the parent's effective skills by default (`skills: "inherit"`).
- With `agentsRoot` configured, a `.agents/agents/reviewer.md` or `.claude/agents/reviewer.md` file (Claude Code's subagent shape: `name`, `description`, `tools`, `model`, body) becomes a child named `reviewer`.
- `DelegateChildConfig.context?: "none" | "summary" | { lastTurns: number; maxChars?: number }` (default `"none"`).
  - `{ lastTurns }` seeds the child's session with the parent branch's last N turns. The copy is portable: text only, tool activity rendered as text, and reasoning, images, and non-message entries dropped. It is bounded by `maxChars`.
  - `"summary"` seeds one `summary` entry produced by one model call.
  - The `delegate` description marks each child that sees the conversation.
- A new kernel export, `selectTranscript(entries, options)`, produces that bounded, portable slice. Its `pinned` messages, such as the run's task, always survive the cut. Both the delegate and the advisor use it.
- The delegate provides a `delegate` service (`start`/`wait`), so a hook or another package can run a child from code. A child with `hidden: true` is reachable only through the service and never appears in the `delegate` tool.
- A new package, `@arnilo/prism-advisor` (`packages/integrations/advisor`):
  - an `advise` tool;
  - an opt-in `tool.call` trigger before named tools (`revise` → `deny` carrying the advice);
  - an opt-in `run.end` trigger before the final answer (`revise` → `continue` with the advice as a steer).
  - Each consult is exactly one model call on the configured advisor model, with no tools and no agent loop. A per-run cap bounds the number of consults.
  - **Completion validation:** an opt-in `validate` role on `run.end`, judged against the run's captured task and optional `criteria`.
    - Its engine is either one model call or a hidden delegate child (`engine: { child }`) that checks the evidence with its own tools.
    - `incomplete` sends the model back with what is missing, for at most `maxRounds` rounds.
    - It fails closed: it never reports `verified` without a successful verdict.
    - Every round emits `validator.verdict` (`verified | incomplete | unverified | error`), so a host can tell when a run ended unverified.

**0.13.0 release path — plan 191, step 7 of 21.** Amended 2026-10-17 by the context-rot review: Task 2 gains a bounded, paged child result and a concise-report instruction. Amended 2026-10-23 by owner decision: Task 7 adds context forwarding to delegate children plus the `selectTranscript` kernel export. Its two-user proof is the delegate (Task 7) and the advisor (Task 8). Task 8 creates `@arnilo/prism-advisor`, a lockstep package, which brings the new-package enforcement rows with it. Task 1 gains review items (h) and (i) for these two tasks. Amended again 2026-10-23 by owner decision:
- Task 7 adds the `delegate` service, `hidden` children, and `selectTranscript`'s `pinned` option.
- Task 8 adds completion validation as the advisor package's `validate` role, rather than as a second package that would duplicate the slicing, verdict parsing, and caps.
- Task 1 gains review item (j).

Neither change touches the kernel beyond `selectTranscript`. A `run.end` hook cannot fail a run, so validation reports its outcome through `validator.verdict`, and the host gates on that. Owner decision 2026-10-17 (see plan 189's header). Start this plan when plan 190 is complete; when it is complete, continue with plan 192. It depends on plan 189 (tool names for the subagent tool map, the tool set a coding child sees) and plan 190 (`parseAgentFile` returns the body; skills registered by `context-files`). It changes the `@arnilo/prism-delegate` config and result contract and adds one kernel rule (identical skill re-registration is idempotent, Task 4), so **Task 1 is the phase review**. It implements roadmap §2.9's `delegate` row ("sub-agents as a tool, inheriting a chosen package set") and §2.13.2 ("an orchestrator agent … is an `Agent` created with `prism-delegate`"); worktree isolation reuses the Phase 14 `workspace` service (§2.12.14) the same way `prism-workflows` agent nodes do. Docs go to the package README and `docs/agent.md` (skills rule). No version bump, publish, or npm deprecation. Reference host impact: the orchestrator (`apps/prism-agent/src/host/orchestrator.ts`) configures `delegate` with a research child; Task 3 updates it if it sets a removed field, and the orchestrated-workflow scenario must stay green.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Callers of the delegate surface** (`graft callers --depth all`): `DelegateChildConfig`, `DelegateLifetime`, `budgetShare`, `DEFAULT_CHILD_LIMITS`, `HARD_CHILD_LIMITS`, `resolveChildLimits`, `createDelegateRuntime` — including `apps/prism-agent/src/host/orchestrator.ts`, `examples/delegate.ts`, `scripts/e2e-coverage.json:390-393`, and the compat baseline.
      - (b) **Child construction** (`packages/integrations/delegate/src/runtime.ts:86-121`): the child gets the provider bridge plus re-instantiated inherited packages, a memory store, limits, and the principal — no `host` and no `skills`. Record what `createAgent` does with a missing `host.ui` for an `ask` (the suspension path in the README's "Safety").
      - (c) **Host port attribution.** The `HostUiRequestBase` fields (`src/host/types.ts:4`) and how a request is attributed to a package ("requests carry the owning package's name", `src/packages/api.ts:46`), so Task 4 can label a forwarded request with the child's name.
      - (d) **Worktree isolation mechanics.** A child agent re-instantiates `tools-coding`, so the parent's `workspace` service binding does not route the child's tools. Confirm that an inline package added to the child's `createAgent` can `services.consume("workspace")` from the child's own instance and bind the child session (the pattern `prism-workflows` uses, `packages/integrations/workflows/src/nodes/agent-node.ts:58-110`). Record `worktree.create`, `diff`, `merge`, and `dispose` behavior on the child's instance (`packages/tools/coding/src/workspace/service.ts`), whether disposing the child agent disposes its worktrees, and which branch `merge({ into })` should target (the parent root's current branch from `git_status`/`rev-parse`).
      - (e) **Skill duplicates.** What happens when the child receives the parent's skills through `skills.add` and an inherited package (for example `context-files` from plan 190 Task 5) registers the same skill again: today `skill_conflict` (`src/packages/api.ts:100`). The rule Task 4 adds, and its second user (two packages, or a host `skills.dirs` plus `context-files`, discovering the same `SKILL.md`), which is the kernel-addition proof required by `references/prism.md` §1.
      - (f) **Subagent file format.** Claude Code's `.claude/agents/*.md` frontmatter fields and tool names (find-docs; record the date), and whether Codex or the `skills` CLI define an equivalent. The tool-name map Task 6 needs (`Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`), checked against plan 189's final tool names.
      - (g) **The `delegations` map** (`runtime.ts`, `start`/`wait`): entries are never removed.
      - (h) **Seeding a child session (Task 7).** Record each of the following:
        - **What the parent branch looks like.** `SessionContext.entries()` (`src/session-context.ts:16-21`) returns the parent branch already redacted. It needs the `"session-state"` capability, which the delegate does not declare today (`packages/integrations/delegate/src/index.ts`, `capabilities: ["models", "background"]`). Record what the branch holds while the `delegate` tool call is in flight: is the assistant message carrying the `delegate` tool call already appended, and is its result absent?
        - **How the copy enters the child.** `createMemorySessionStore(initialEntries)` (`src/session-stores.ts:257`) seeds a store. `agent.session({ id })` (`src/contracts-core/agent.ts:260-275`) resumes it and runs `openResumedSession`, the same path `fork()` uses (`src/agent-session/session.ts:766-808`). Record which ownership metadata the seeded entries need so the child's principal scope accepts them.
        - **How summaries reach the model.** A `summary` entry is carried as `snapshot.summaries` (`src/session-stores.ts:160-170`) into assembly (`src/agent-session/session/assemble.ts:453`). Record how assembly renders it.
        - **Which content does not travel.** Which content blocks are provider-bound: `thinking` (`src/contracts-core/content.ts:73`), images, and provider metadata on messages. Then answer two questions. Does a provider accept historical `tool_call` blocks for tools absent from the request? Does a `tool`-role message survive when the provider differs? Task 7 renders tool activity as text either way. This finding only confirms that rendering is required.
        - **Existing helpers.** Whether a kernel helper already selects the last N turns under a size bound. `rebuildSessionContext` (root export) returns every message unbounded. The turn-cut helpers in `packages/memory/compaction/src/prepare.ts` live in a package that neither the delegate nor the advisor may depend on. Also whether a kernel text renderer for messages exists to reuse (`src/compaction.ts:66`, `src/input.ts:439`). Record whether it is exported.
        - **Kernel-addition proof for `selectTranscript`.** No hook, slot, `PackageAPI` member, or primitive expresses "a bounded, portable slice of a branch". It has two users: the delegate (Task 7) and the advisor (Task 8).
      - (i) **Advisor mechanics (Task 8).** Record each of the following:
        - **`tool.call` hooks.** `ToolCallDecision` (`src/hooks/types.ts:104-109`): which context a `tool.call` hook receives (`HookContext.session`, `signal`), and whether a `deny` reason reaches the model as the tool result text.
        - **`run.end` hooks.** `RunEndDecision.continue` (`src/hooks/types.ts:148-154`) and its `limits.maxContinuations` cap. `RunEndPayload.history` (`src/hooks/types.ts:135-141`) is the live transcript, so a `run.end` trigger needs no store read.
        - **Whether advisor calls re-enter the hooks.** Whether `prism.models.client(ref).generate` (`src/packages/api.ts:120`) runs `model.request`, `model.call`, or `model.response` hooks. If it does, the advisor's own call could re-trigger other packages' hooks, and Task 8 must say how that is bounded.
        - **Capabilities.** Which capabilities the package must declare to register hooks and a tool, to call models, and to read `session.entries()`.
        - **Enforcement rows.** Every row a new integration package must join, found with `grep -rln prism-delegate scripts src docs examples` and excluding `compat-baseline/`, `docs/history/`, and `docs/_evidence/`. Today that is `scripts/package-truth.{mjs,json}`, `scripts/independent-packages.json`, `scripts/coverage-thresholds.json`, `scripts/coverage-summary.json`, `scripts/release-evidence.json`, `scripts/phase24-truth.test.mjs`, `scripts/phase54-package-map.test.mjs`, `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, `docs/release.md`, and `docs/index.md`. Record which of them a new package must join.
      - (j) **Completion validation (Tasks 7 and 8).** Record each of the following:
        - **Finding the run's task.** How a package identifies the current run's input message: the user message that started the run, not a later `run.end` continuation steer, which is also a user message. Record whether `run.input` (`src/hooks/types.ts:174`, transform) sees it with the `runId` in its hook context, so the advisor can capture it per run. Also record whether message entries or `RunEndPayload.history` (`src/hooks/types.ts:135-146`) mark the run boundary on their own.
        - **Combining `run.end` decisions.** How decisions from several packages combine ("the first continue wins", `src/hooks/types.ts:148-154`). Record the hook order between the advisor and `hooks-json`'s `Stop` handler (`packages/integrations/hooks-json/src/compile.ts:407-422`), and what `payload.continuations` counts.
        - **No verdict field on the run result.** Confirm that a `run.end` hook cannot set a `RunResult` status or field, and that a run ending after `maxContinuations` reports `completed`. That is why the validator reports through a package event and adds no kernel field.
        - **A runtime as a service.** The precedent is `prism-workflows` providing its runtime (`packages/integrations/workflows/src/index.ts:240`). Record whether a `run.end` hook's context carries the `SessionContext` and `signal` that `runtime.start` needs (`packages/integrations/delegate/src/runtime.ts:192-217`).
        - **Child output.** Whether a child's answer, capped by Task 2's `resultMaxChars`, can carry a JSON verdict reliably. Record the child result shape the validator will parse.
    - Functional: The note ends with a verdict; a finding that invalidates a task stops the plan for a re-cut.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: The review confirms three things:
      - a child still never gains a package the parent did not load;
      - forwarding `host.ui` does not let a child answer its own approvals;
      - the entries `session.entries()` returns are already redacted (h). If they are not, Task 7 stops for a re-cut. It must not add its own redaction pass.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9, §2.12.14, §2.13.2; `packages/integrations/delegate/{README.md,src/*}`; `packages/integrations/workflows/src/nodes/agent-node.ts`; plan 165 (workspace service), plan 169 (agent nodes).
    - Options Considered:
      - Skip the review. Rejected: a package contract and a kernel rule change.
    - Chosen Approach:
      - Read-only inventory cited by Tasks 2–5.
    - API Notes and Examples:
      ```bash
      graft callers resolveChildLimits --depth all
      ```
    - Files to Create/Edit:
      - `plans/191-Phase-11-Part-R-Delegation-For-Coding-Workflows.md` (task note only).
    - References:
      - The 2026-10-17 evaluation §3.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit:
      - none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: A tool surface the model can choose from
  - Acceptance Criteria:
    - Functional: `DelegateChildConfig` gains `description?: string`. The `delegate` description becomes `Run a child agent on a task. The child sees only your input, not this conversation. Children:` followed by one `- <name>: <description>` line per child. A child without `description` uses the first sentence of its `instructions`, else `(no description)`, and setup notes `info` once per such child.
    - Functional: The schema describes `child` and `input` (`"A self-contained brief: the goal, the relevant files or facts, constraints, and what to return. The child cannot ask you follow-up questions."`) and `mode` (`"sync waits for the result; async returns a delegationId for delegate_wait"`).
    - Functional: The `delegate` result's text is the child's final answer followed by one status line (`[child reviewer: completed, 12 turns, 41,203 tokens]`); the structured `value` keeps its fields.
    - Functional: **Bounded result.**
      - Child config `resultMaxChars` (default 12,000, hard cap 64,000) caps the answer text the parent sees.
      - A longer answer is cut at the last paragraph break before the cap and ends with `[truncated: <shown>/<total> chars; delegate_wait { delegationId: "<id>", offset: <shown> } returns the rest]`.
      - `delegate_wait` gains optional `offset` and returns the next slice of a finished delegation's answer, with `totalChars`, `nextOffset`, and `truncated`, the same shape as plan 192's `web_fetch` paging.
      - The full answer stays in the delegation entry until that entry is removed (Task 3's removal rule).
    - Functional: The default child instruction (prepended to the child's own instructions) ends with: `Finish with a concise report for the parent: what you did, what you found, files changed, and open issues. The parent sees only this report.`
    - Performance:
      - The description grows by one line per child; nothing per call.
      - The parent's context grows by at most `resultMaxChars` per delegation; the README states it and how to raise it.
    - Code Quality: Descriptions are built once at setup from config.
    - Security: Descriptions come from host config or Task 6's trusted files, never from model output.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/tools.ts:29-45`, `src/config.ts:7-20`.
    - Options Considered:
      - Leave the choice to child names. Rejected: names alone (`reviewer`, `research`) do not say when to use a child or what to give it.
      - Return the child's whole answer. Rejected: one verbose child can add tens of thousands of tokens to every later parent request, which undoes the isolation (Context-Folding; Chroma "Context Rot", 2025).
      - Have a model summarize the child's answer. Rejected: an extra model call per delegation, and the child, which knows what matters, is already asked to report concisely.
    - Chosen Approach:
      - Per-child descriptions and documented arguments.
    - API Notes and Examples:
      ```ts
      delegate({ children: { reviewer: { description: "Reviews a diff for correctness bugs.", inherit: ["@arnilo/prism-tools-coding"] } } })
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/{tools,config,index,runtime,limits}.ts`, `src/__tests__/package.test.ts`, `packages/integrations/delegate/README.md` (Tools: `delegate_wait` `offset`; Cost: result cap), `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Task 6 (file-defined children supply `description`); Task 7 (children with `context` change the "sees only your input" sentence).
  - Test Cases to Write:
    - `delegate_description_lists_child_descriptions`; `child_without_description_uses_first_sentence`; `delegate_input_is_described_as_self_contained`; `delegate_result_text_has_status_line`.
    - `delegate_result_capped_with_paging_hint`: a 30,000-char answer shows ≤ 12,000 chars and the hint (breaks if the parent gets the whole answer).
    - `delegate_wait_offset_returns_next_slice`; `delegate_wait_offset_after_entry_removed_is_unknown_delegation`.
    - `default_child_instruction_asks_for_concise_report`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the `DelegateChildConfig` diff.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config field and tool text.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md` (Tools, Configuration); `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Budgets that finish the work, and fewer knobs
  - Acceptance Criteria:
    - Functional: `DEFAULT_CHILD_LIMITS` becomes `{ maxTurns: 50, maxToolCalls: 200, maxTotalTokens: 500_000, maxWallTimeMs: 15 * 60_000 }` and `HARD_CHILD_LIMITS` becomes `{ maxTurns: 200, maxToolCalls: 1000, maxTotalTokens: 2_000_000, maxWallTimeMs: 60 * 60_000 }` (`src/limits.ts:5-7`). A configured value is still clamped to the hard ceiling, and the parent's `limits` still bound the child through the kernel's narrow-only rule.
    - Functional: `budgetShare` is removed (config, schema, setup check at `src/index.ts:39-41`, `resolveChildLimits` parameter). `lifetime` is removed: `mode: "sync"` aborts with the calling tool call; `mode: "async"` always runs as `session.background` work that ends with the parent session (today's `lifetime: "session"` path, `runtime.ts:206-216`). Unknown keys fail `createAgent` with the kernel's config error, so a manifest that still sets them fails loudly.
    - Functional: A delegation's entry leaves the `delegations` map when `delegate_wait` returns its terminal outcome, when a sync delegation returns, and on `session.closed` for that parent session. `delegate_wait` on a removed id is the existing "Unknown delegation" error.
    - Functional: Sweep: a repo-wide grep for `budgetShare`, `DelegateLifetime`, and `lifetime:` in delegate config (exclusions: `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds nothing outside `CHANGELOG.md`.
    - Performance: The README's cost section states the new worst case per delegation (500,000 tokens by default) and how to lower it (`limits`).
    - Code Quality: One limits path; no alias for the removed fields.
    - Security: Ceilings still bound every child; the test proves a configured value above the ceiling is clamped.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/{limits,config,runtime,index}.ts`; plan 189 Task 8 (default coding tool schemas are the per-call floor); Task 1 (a), (g).
    - Options Considered:
      - Keep small defaults and document raising them. Rejected: with about 3.7k tokens of coding-tool schemas per call before plan 189 (and still several thousand after), 20,000 tokens is three or four calls, so the default child cannot finish a coding task.
      - Keep `budgetShare`. Rejected: `limits` already sets the same numbers directly.
    - Chosen Approach:
      - Workable defaults, hard ceilings, and one way to set each limit.
    - API Notes and Examples:
      ```ts
      children: { tester: { inherit: [...], limits: { maxTotalTokens: 100_000 } } }
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/{limits,config,runtime,index}.ts`, `src/__tests__/package.test.ts`, `apps/prism-agent/src/host/orchestrator.ts` (if it sets a removed field), `examples/delegate.ts` (same), `packages/integrations/delegate/README.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Task 1 (a).
  - Test Cases to Write:
    - `child_default_limits_are_workable`; `child_limit_above_ceiling_is_clamped`.
    - `budget_share_and_lifetime_fail_config_validation`.
    - `async_delegation_ends_with_parent_session`; `sync_delegation_aborts_with_tool_call`.
    - `delegation_entry_removed_after_wait_and_on_session_close`.
    - Run `bun scripts/release.mjs gate --update-baseline`; the note records the removed exports and type fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — defaults and removed config fields.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md` (Configuration, Cost, Safety); `CHANGELOG.md` (Changed, Removed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Children ask the parent's host and inherit skills
  - Acceptance Criteria:
    - Functional: `buildAgent` passes `host: { ui: <wrapped prism.host.ui> }` to the child's `createAgent`. The wrapper forwards each request unchanged except for attribution: the child's name is added where Task 1 (c) found a field for it, otherwise the request's prompt text is prefixed with `[<child name>] `. A child's `ask` now reaches the person; the child suspends (`status: "suspended"`, today's path) only when the parent host answers `unavailable`.
    - Functional: `DelegateChildConfig.skills?: "inherit" | "none" | string[]` (default `"inherit"`). The child's `createAgent` gets `skills: { add: <parent skills selected> }` from `prism.skills.list()` at delegation time.
    - Functional: Kernel rule: registering a skill whose name is taken by a skill with the same `path` and the same `instructions` is a no-op, not `skill_conflict`, for `prism.skills.register`, `AgentConfig.skills.add`, and `skills.dirs`. A same-name skill with a different path or body is still `skill_conflict`. This lets a child inherit both the parent's skills and an inherited `context-files` instance that discovers the same files.
    - Performance: `prism.skills.list()` once per delegation; skills are frozen copies, not re-read from disk.
    - Code Quality: The kernel change is one comparison in the skill registry's duplicate check (`src/skills.ts:12-38` and the loader's registration path), with the two-user proof from Task 1 (e) in the note. No new `PackageAPI` member.
    - Security: The child cannot approve its own requests: they go to the parent's host, which the child never sees. A child of a parent with no `host.ui` behaves as today (suspends). The idempotence check compares path and body, so a malicious package cannot shadow a skill by reusing its name.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/runtime.ts:86-121`; `src/skills.ts`; `src/packages/loader.ts:720-745`; Task 1 (b), (c), (e).
    - Options Considered:
      - Resume a suspended child after the parent approves. Rejected: needs a cross-agent resume protocol; forwarding the host port avoids the suspension in the first place.
      - Skip skills owned by inherited packages instead of a kernel rule. Rejected: `PackageAPI` exposes no skill owner, and the same duplicate arises without delegation (a host `skills.dirs` plus `context-files` discovery).
    - Chosen Approach:
      - Forward the host port, inherit skills, and make identical re-registration idempotent.
    - API Notes and Examples:
      ```ts
      children: { coder: { inherit: ["@arnilo/prism-tools-coding", "@arnilo/prism-approval"], skills: "inherit" } }
      // child's edit → approval ask → parent host.ui confirm "[coder] Allow edit src/a.ts?"
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/{runtime,config}.ts`, `src/__tests__/package.test.ts`, `src/skills.ts`, `src/packages/loader.ts`, `src/__tests__/skills.test.ts`, `src/__tests__/package-loader.test.ts` (or the loader's skill test file Task 1 names), `packages/integrations/delegate/README.md`, `docs/agent.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Plan 190 Task 5.
  - Test Cases to Write:
    - `child_approval_request_reaches_parent_host`: an inherited `approval` in `ask` mode, scripted host approves, the child's edit lands; fails if the child suspends.
    - `child_suspends_when_parent_host_unavailable`.
    - `forwarded_request_names_child`.
    - `child_inherits_parent_skills_by_default`, `child_skills_none`, `child_skills_named_subset`.
    - `identical_skill_reregistration_is_noop`, `same_name_different_body_is_skill_conflict`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — child behavior, config field, kernel registration rule.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md` (Safety: approvals now reach the parent host; Configuration: `skills`); `docs/agent.md` "Tools and skills": the idempotent re-registration rule; `CHANGELOG.md` (Changed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Worktree isolation for coding children
  - Acceptance Criteria:
    - Functional: `DelegateChildConfig.isolation?: "none" | "worktree"` (default `"none"`). With `"worktree"`, the delegate adds an inline package to the child's `createAgent` that consumes the child's `workspace` service; after the child session opens, it calls `worktree.create({ sessionId })` so every inherited coding tool runs in the worktree (Task 1 (d)). No `workspace` service in the child fails the delegation with `DelegateError` `isolation_unavailable` before the child runs, and the tool result says which package provides the service.
    - Functional: When the child finishes with `completed`, the delegate merges with `workspace.merge(path, { into: <parent branch>, commit: { message: "delegate(<child>): <first line of input>" } })`. A clean merge disposes the worktree and returns `merge: { status: "merged", commit, files }`. A conflict returns `merge: { status: "conflict", files, branch }`; a dirty or missing target returns `merge: { status: "refused", reason, branch }`. In both cases the worktree is disposed but its branch is kept. A child that fails, is cancelled, or hits a limit returns `merge: { status: "skipped", branch }` with its branch kept and nothing merged.
    - Functional: Parallel async children each get their own worktree (bounded by the child service's `maxWorktrees`); merges run one at a time in completion order.
    - Performance: One `git worktree add` and one merge per isolated delegation; nothing for `isolation: "none"`. The README states it.
    - Code Quality: The delegate names the `workspace` service, never the `tools-coding` package (the same service contract `prism-workflows` uses). The merge result is part of the `delegate`/`delegate_wait` `value` and summarized in the result's status line.
    - Security: The child's tools cannot write the parent's tree (the bound-session hard deny, `packages/tools/coding/README.md` "Worktree roots for one session"). The delegate never pushes, never resolves a conflict, and never deletes an unmerged branch. A sandboxed child (`workspace_sandbox_unsupported`) fails with `isolation_unavailable` instead of running unisolated.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/workspace/{service,merge}.ts`; `packages/tools/coding/README.md` "Workspace service"; `packages/integrations/workflows/src/nodes/agent-node.ts:58-140`; Task 1 (d).
    - Options Considered:
      - Leave changes on the branch and let the parent model merge with `git`. Rejected: every parent would re-implement the merge, and plan 189 removed the git tools that would do it safely.
      - A `delegate_merge` tool. Rejected: one more tool for a step that has a deterministic default.
      - Rewrite the inherited package's `root` config to the worktree. Rejected: the delegate would have to know which config key means "root" in which package.
    - Chosen Approach:
      - Bind through the child's own `workspace` service and merge with its compare-and-swap merge, keeping branches whenever anything is not clean.
    - API Notes and Examples:
      ```ts
      children: { coder: { inherit: ["@arnilo/prism-tools-coding"], isolation: "worktree" } }
      // delegate → { status: "completed", text, merge: { status: "merged", commit: "ab12…", files: ["src/a.ts"] } }
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/isolation.ts` (new), `src/{runtime,config,tools}.ts`, `src/__tests__/isolation.test.ts` (new, in a temp git repository), `examples/delegate.ts` (an isolated coding child, offline on the mock provider), `examples/README.md`, `scripts/e2e-coverage.json` (the example), `packages/integrations/delegate/README.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Plan 165 Task 7 (worktree routing), plan 169 (agent nodes).
  - Test Cases to Write:
    - `isolated_child_edits_only_its_worktree`: the parent tree is untouched until merge.
    - `isolated_child_clean_merge_lands_on_parent_branch`.
    - `isolated_child_conflict_keeps_branch_and_tree_unchanged`.
    - `isolated_child_dirty_target_refused`.
    - `failed_child_skips_merge_keeps_branch`.
    - `parallel_isolated_children_merge_in_completion_order`.
    - `isolation_without_workspace_service_fails_before_run`; `isolation_under_sandbox_fails_closed`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/delegate.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config field and result field.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md`: "Worktree isolation" (binding, merge outcomes, kept branches, cost); `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Children from subagent files
  - Acceptance Criteria:
    - Functional: New config `agentsRoot?: string` and `defaultInherit?: string[]`. When `agentsRoot` is set, setup reads `<agentsRoot>/.agents/agents/*.md` then `<agentsRoot>/.claude/agents/*.md` with `parseAgentFile` (plan 190 Task 2). Each file becomes a child: `name`, `description`, body as `instructions`, `model` when it is a model ref the parent can resolve (Claude aliases such as `sonnet` or `inherit` mean the parent session's model), `inherit: defaultInherit` (required when `agentsRoot` is set; setup fails naming the field otherwise), and `tools` mapped through Task 1 (f)'s name map into `tools.only`.
    - Functional: A configured `children` entry wins over a file with the same name; `.agents` wins over `.claude`; each skipped duplicate notes `info`. A malformed file, or a `tools` list that maps to no registered tool, notes `warn` and is skipped. Unknown tool names in a list that maps partly are dropped with one `info` note.
    - Functional: Files are read only from the configured `agentsRoot`; there is no home-directory scan.
    - Performance: One `readdir` per directory and one read per file at setup.
    - Code Quality: The tool-name map is a frozen constant in `src/agent-files.ts`; no other place translates names.
    - Security: File-defined children get only `defaultInherit` packages, narrowed by `tools`, never more; a file cannot name a package. Agent files are instructions; nothing is imported or executed.
  - Approach:
    - Documentation Reviewed:
      - `src/contribution-parsing.ts` (`parseAgentFile` after plan 190 Task 2); Task 1 (f); Claude Code subagent docs (find-docs; record the date).
    - Options Considered:
      - Prism-only `AGENT.md` directories. Rejected: the point is to accept files other agents already have.
      - Let files name packages. Rejected: a repository file could then grant itself packages the host did not choose.
    - Chosen Approach:
      - Read both directory conventions into ordinary children, with the host choosing the package set.
    - API Notes and Examples:
      ```md
      ---
      name: reviewer
      description: Reviews a diff for correctness bugs.
      tools: Read, Grep, Glob
      model: inherit
      ---
      You review diffs. Report each bug with file:line and a one-line fix.
      ```
      ```ts
      delegate({ agentsRoot: process.cwd(), defaultInherit: ["@arnilo/prism-tools-coding"], children: {} })
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/src/agent-files.ts` (new), `src/{config,index}.ts`, `src/__tests__/agent-files.test.ts` (new), `packages/integrations/delegate/README.md`, `scripts/compat-baseline/arnilo__prism-delegate.txt`, `CHANGELOG.md`.
    - References:
      - Plan 190 Task 2; plan 189 Tasks 4 and 8 (final tool names).
  - Test Cases to Write:
    - `claude_subagent_file_becomes_child`: name, description, instructions, `tools.only` mapped.
    - `configured_child_wins_over_file`; `agents_dir_wins_over_claude_dir`.
    - `model_inherit_uses_parent_model`.
    - `unmappable_tools_file_skipped_with_note`; `malformed_agent_file_skipped_with_note`.
    - `agents_root_requires_default_inherit`.
    - `file_child_cannot_exceed_default_inherit`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new config fields.
    - Docs pages to create/edit:
      - `packages/integrations/delegate/README.md`: "Children from subagent files" (directories, fields, tool-name map, precedence); `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Children that see the parent's conversation, and children run from code
  - Acceptance Criteria:
    - Functional: **Kernel export `selectTranscript`.** The signature is `selectTranscript(entries: readonly SessionEntry[] | readonly Message[], options: { lastTurns?: number; maxChars: number; maxToolChars?: number; pinned?: readonly Message[] }): TranscriptSlice`, in `src/session/transcript.ts` and exported from `@arnilo/prism`. It returns `{ summaries: string[]; pinned: Message[]; messages: Message[]; turns: number; omittedTurns: number; truncated: boolean }`.
      - **Accepted input.** It accepts branch entries or live messages. `RunEndPayload.history` is a `Message[]`.
      - **Pinned messages.** `pinned` messages are rendered with the same portability rules and always included. They are charged against `maxChars` first and cut last; a pinned message bigger than `maxChars` alone is cut from its end and sets `truncated`. A pinned message that also falls inside the selected turns is not repeated.
      - **What it keeps.** It walks the branch the way `rebuildSessionContext` does (a compaction entry's summary replaces what it covers) and keeps only `message`, `summary`, and `compaction` summaries. Every other kind is dropped: `package_state`, `custom`, `event`, `external_state`, `metadata`, `suspended_run`, `label`, and `model_change`.
      - **What a turn is.** A turn starts at a `user` message.
      - **Portability.** The output is portable to any provider and any tool set:
        - Each message keeps its role (`user` or `assistant`) and only text content.
        - A tool call becomes `[tool_call <name> <JSON args, first 200 chars>]` in its assistant message.
        - A tool result becomes `[tool_result <name>: <text, first maxToolChars chars (default 2,000)>]` in a user-role message.
        - Consecutive same-role messages are merged.
        - `thinking` blocks and provider metadata are dropped. Images become `[image omitted]`.
        - An assistant tool call with no result, such as the in-flight `delegate` call (Task 1 (h)), is dropped.
      - **Bounds.** Turns are taken newest first: up to `lastTurns`, or all of them, until `maxChars` is reached. A newest turn that alone exceeds `maxChars` is cut from its oldest end and `truncated` is set. Summaries count toward `maxChars` and are cut last.
    - Functional: **Delegate config.** `DelegateChildConfig.context?: "none" | "summary" | { lastTurns: number; maxChars?: number }` (default `"none"`).
      - `lastTurns` must be an integer from 1 to 50.
      - `maxChars` defaults to 24,000 and is capped at 120,000. A larger value is clamped, and setup notes `info` once.
      - Anything else fails config validation.
      - File-defined children (Task 6) use `"none"`. A configured child with the same name can set `context`.
    - Functional: **Seeding.** At delegation start, for a child whose `context` is not `"none"`, the delegate:
      1. reads `context.session.entries()` once;
      2. calls `selectTranscript`;
      3. seeds the child's memory store with the result, using fresh entry ids, the child session's id, and the ownership metadata Task 1 (h) names: one `summary` entry per summary, then one `message` entry per message;
      4. opens the child with `agent.session({ id })`. The child's first request carries the seeded history followed by the `input` brief.

      The delegate declares the `"session-state"` capability.
    - Functional: **`"summary"`.**
      - The delegate makes one `prism.models.client(<child model>).generate` call. Its system prompt is a fixed summarization instruction ("Summarize this conversation for a sub-agent: the goal, decisions, facts established, files touched, and open problems. Under 4,000 characters."). Its input is `selectTranscript(entries, { maxChars: 48_000 })`, rendered as one user message.
      - The answer is capped at 4,000 chars and seeded as one `summary` entry.
      - If the summary call fails, the delegation fails before the child runs: `status: "failed"`, `error: "context_unavailable: <reason>"`. It never runs blind in place of the configured context.
    - Functional: **The parent sees which children see the conversation.** Task 2's description sentence becomes `The child sees only your input unless its line says it sees this conversation.` A child line gets a suffix: ` (sees the last <N> turns of this conversation)` or ` (sees a summary of this conversation)`. Without a session (no `context.session`), a child with `context` fails with `context_unavailable` and never silently runs blind.
    - Functional: The `delegate` result value gains `context: { mode, turns, omittedTurns, truncated }` for children with `context`.
    - Functional: **`delegate` service.**
      - Setup calls `prism.services.provide("delegate", service)`. The `DelegateService` interface is exported from the package and has two methods:
        - `start({ child, input, mode, session, principal?, signal? })`, which returns the same `DelegationOutcome`, or `{ delegationId, status: "running" }`;
        - `wait(delegationId, session, signal?)`.
      - It wraps the same runtime the tools use, so concurrency, limits, `context`, approvals (Task 4), isolation (Task 5), result caps (Task 2), and entry removal (Task 3) are identical.
      - `start` without a `session` throws `DelegateError` `session_required`.
      - The service is provided even when every child is hidden.
    - Functional: **`hidden` children.**
      - With `DelegateChildConfig.hidden?: boolean` (default `false`), a hidden child is left out of the `delegate` description and its `child` enum. A `delegate` call naming it gets the existing "Unknown child" failure. Only the service can start it.
      - When every child is hidden, the `delegate`, `delegate_wait`, and `delegate_cancel` tools are not registered, and setup notes `info`. Today's "no children" warning still applies only when `children` is empty.
      - File-defined children (Task 6) are never hidden.
    - Performance:
      - `"none"` reads nothing.
      - `{ lastTurns }` costs one branch read per delegation. The child's history grows by at most `maxChars` (about `maxChars / 4` tokens), and that is re-sent on every child turn.
      - `"summary"` adds one model call per delegation, with up to 48,000 chars in and 4,000 out.
      - The README's Cost section states all three, and that `"none"` is the default.
    - Code Quality:
      - The selection and rendering rules live only in `selectTranscript`. Neither the delegate nor the advisor re-implements them.
      - Seeding reuses the `fork()` re-id pattern (`src/agent-session/session.ts:766-808`).
      - No new `PackageAPI` member.
    - Security:
      - The model cannot widen what a child sees. `context` comes from host config only, and the `delegate` tool has no argument for it.
      - Seeded entries come from the already-redacted branch (Task 1 (h)).
      - Non-message entries never reach the child. Without this, a `package_state` copy would hydrate the parent's package state into inherited packages, and a `suspended_run` copy would resume the parent's run.
      - The child cannot write to the parent's session, because it has its own store.
      - The README warns that a child on a different provider receives the parent's transcript.
      - The service runs only configured children: a caller cannot pass a package set, model, or limits, so a package holding the service gains no capability the host did not configure.
      - A hidden child cannot be reached by the model.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/src/{runtime,config,tools,index}.ts` (`buildAgent` `runtime.ts:86-121`, `run` `runtime.ts:123-190`); `src/session-context.ts:9-27`; `src/session-stores.ts:156-188, 257`; `src/agent-session/session.ts:766-808`; `src/contracts-core/agent.ts:260-275`; Task 1 (h).
    - Options Considered:
      - **Rely on the host's `tool.call` `rewrite` to paste context into `input`.** Rejected as the default. It works without SDK changes, but every host re-implements the slicing, the history arrives as one flat user message, and nothing tells the parent model which children see the conversation.
      - **`session.fork()` the parent and run the child on the fork.** Rejected for three reasons. The fork lives in the parent's store and agent, not the child's. It copies `package_state`. It keeps provider-bound blocks that a child on another provider cannot replay.
      - **Copy messages verbatim, tool calls and all.** Rejected. A child with `tools.only` or a different provider can reject historical tool calls for tools it does not have, and the in-flight `delegate` call has no result.
      - **Put the slicing in the delegate package.** Rejected. The advisor (Task 8) needs the same rules, and a package must not depend on another package's internals.
      - **Per-delegation `context` argument on the tool.** Rejected. It would let the model widen what a child sees beyond the host's choice.
      - **Hosts build their own validator agents with `createAgent` inside a hook.** Rejected. That re-implements the provider bridge, inheritance, limits, approvals, and isolation the delegate already owns.
      - **A service that accepts an ad-hoc child definition.** Rejected. A package holding the service could then grant itself packages the host did not configure.
    - Chosen Approach:
      - A kernel `selectTranscript` (two users) with pinned messages.
      - A host-configured `context` per child, seeded through the child's own store and session open.
      - The same runtime exposed as a `delegate` service, following the `prism-workflows` precedent, for hidden or visible configured children.
    - API Notes and Examples:
      ```ts
      delegate({
        children: {
          reviewer: { description: "Reviews the current change.", inherit: ["@arnilo/prism-tools-coding"], context: { lastTurns: 6 } },
          researcher: { description: "Researches a question.", inherit: ["@arnilo/prism-tools-web"], context: "summary" },
        },
      });
      // delegate → { status: "completed", text, context: { mode: "lastTurns", turns: 6, omittedTurns: 14, truncated: false } }

      // From code (a hook or another package): a hidden child the model never sees.
      // children: { verifier: { inherit: ["@arnilo/prism-tools-coding"], hidden: true, context: { lastTurns: 4 } } }
      const service = prism.services.consume<DelegateService>("delegate");
      const outcome = await service?.start({ child: "verifier", input: brief, mode: "sync", session: context.session, signal: context.signal });
      ```
    - Files to Create/Edit:
      - `src/session/transcript.ts` (new): `selectTranscript` and `TranscriptSlice`.
      - `src/index.ts`: root export.
      - `src/__tests__/transcript.test.ts` (new).
      - `src/__tests__/public-export-contract.test.ts`: root-export freeze, deliberately.
      - `packages/integrations/delegate/src/context.ts` (new): seeding and the summary call.
      - `packages/integrations/delegate/src/service.ts` (new): `DelegateService` over the runtime.
      - `packages/integrations/delegate/src/{config,runtime,tools,index}.ts`: config schema (`context`, `hidden`), capability, description suffix, result `context`, and `services.provide("delegate", …)`.
      - `packages/integrations/delegate/src/__tests__/context.test.ts` (new); `src/__tests__/service.test.ts` (new).
      - `packages/integrations/delegate/README.md`.
      - `docs/agent.md` ("Sessions": `selectTranscript`).
      - `examples/delegate.ts`: one child with `context: { lastTurns: 2 }`, offline on the mock provider.
      - `scripts/compat-baseline/arnilo__prism.txt` and `scripts/compat-baseline/arnilo__prism-delegate.txt`.
      - `CHANGELOG.md`.
    - References:
      - Task 1 (h); Task 2 (description text); Task 6 (file children default to `"none"`).
  - Test Cases to Write:
    - `select_transcript_keeps_last_n_turns`: 10 turns with `lastTurns: 3` gives 3 turns and `omittedTurns: 7`. Fails if the cut counts messages instead of turns.
    - `select_transcript_respects_max_chars_newest_first`: oldest turns drop first. A newest turn bigger than the cap is cut from its oldest end with `truncated: true`.
    - `select_transcript_drops_non_message_entries`: `package_state`, `custom`, `suspended_run`, and `event` never appear.
    - `select_transcript_uses_compaction_summary`: entries behind a compaction appear only as its summary.
    - `select_transcript_renders_tool_activity_as_text`: no `tool_call` blocks and no `tool` role in the output. A tool result longer than `maxToolChars` is cut.
    - `select_transcript_drops_dangling_tool_call_and_thinking`.
    - `select_transcript_pinned_survives_cut`: with `lastTurns: 1` on 20 turns, the pinned first-turn message is still present. It is charged first and not duplicated when it is inside the selected turns. Fails if pinning is applied after the cut.
    - `select_transcript_accepts_live_messages`: a `Message[]` input gives the same slice as the equivalent entries.
    - `delegate_service_runs_configured_child`: same outcome shape as the tool.
    - `delegate_service_shares_concurrency_and_limits`: tool and service calls together never exceed `maxConcurrent`.
    - `delegate_service_requires_session`.
    - `delegate_service_rejects_unknown_child`: no ad-hoc definition is possible.
    - `hidden_child_absent_from_tool_and_unreachable_by_model`.
    - `all_hidden_children_registers_no_tools_but_provides_service`.
    - `child_with_last_turns_sees_parent_history`: the mock provider records the child's first request. It contains the parent's earlier user text and then the brief. Fails if the child starts blind.
    - `child_without_context_starts_blind`: the default is unchanged.
    - `child_summary_context_makes_one_call_and_seeds_summary`: exactly one extra provider call, and the summary appears in the child's request.
    - `summary_failure_fails_delegation_before_child_runs`: `context_unavailable`, and the child model is never called.
    - `context_without_session_fails_closed`.
    - `seeded_child_never_hydrates_parent_package_state`: an inherited package with session state sees its `initial` value, not the parent's.
    - `delegate_description_marks_children_that_see_conversation`.
    - `context_max_chars_above_cap_clamped_with_note`; `context_invalid_shape_fails_config_validation`.
    - `secret_in_parent_history_never_reaches_child_unredacted`: a resolved secret in a parent tool result arrives in the child's request redacted.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers the updated `examples/delegate.ts`.
    - Run `bun scripts/release.mjs gate --update-baseline`. The note records the root `selectTranscript`/`TranscriptSlice` addition and the `DelegateChildConfig.context`/`hidden` and `DelegateService` diff, attributed to this task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new root export; new delegate config fields (`context`, `hidden`), a new result field, and a new capability; a new `delegate` service and `DelegateService` type.
    - Docs pages to create/edit:
      - `docs/agent.md` "Sessions": `selectTranscript` (what it keeps, rendering, bounds, `pinned`).
      - `packages/integrations/delegate/README.md`:
        - Configuration (`context`, `hidden`);
        - What it changes (the `delegate` service and its two methods);
        - Cost (three modes);
        - Safety (what is never copied; cross-provider exposure; the service runs only configured children);
        - Capabilities (`session-state`).
      - `CHANGELOG.md` (Added).
    - `docs/index.md` update: no. Both pages are already indexed and their scope sentences do not change.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: `@arnilo/prism-advisor` — a second opinion, and completion validation
  - Acceptance Criteria:
    - Functional: **Package and config.** A new package lives at `packages/integrations/advisor` (`@arnilo/prism-advisor`, `requires: { api: 1 }`). Config:
      - `model`: `ModelRef`, required. Setup fails naming the field if it is missing.
      - `instructions?`: string. A default advisor prompt applies when it is absent.
      - `context?: { lastTurns?: number; maxChars?: number }`: defaults 6 and 24,000, hard cap 120,000.
      - `adviceMaxChars?`: default 4,000, hard cap 16,000.
      - `tool?`: boolean, default `true`.
      - `triggers?: { beforeTools?: string[]; beforeFinish?: boolean }`: both off by default.
      - `maxConsultsPerRun?`: default 3, hard cap 20.
      - `validate?: { criteria?: string; engine?: "model" | { child: string }; onError?: "continue" | "end"; maxRounds?: number; context?: { lastTurns?: number; maxChars?: number } }`: off by default.
        - `engine` defaults to `"model"`.
        - `onError` defaults to `"continue"`.
        - `maxRounds` defaults to 2, hard cap 10.
        - `context` defaults to that of the advisor.
        - `triggers.beforeFinish` and `validate` together fail config validation, naming both fields. Both are `run.end` reviews, and "the first continue wins" would make one of them silently inert.

      Out-of-range values are clamped with one `info` note. Unknown keys fail config validation. A model the agent cannot resolve gives `status.note("warn", …)` and no registrations, not a throw.
    - Functional: **One consult** works like this:
      1. Take `selectTranscript(<branch>, context)` (Task 7). The branch is `session.entries()` for the tool and `tool.call` triggers, and `RunEndPayload.history` for `run.end`, which needs no store read.
      2. Render it as text in one user message, followed by the question.
      3. Make exactly one `prism.models.client(model).generate` call, with the advisor system prompt and no tools.
      4. Cap the answer at `adviceMaxChars`.

      The advisor never runs an agent loop, never calls tools, and never writes to the session.
    - Functional: **`advise` tool** (when `tool: true`):
      - Arguments: `{ question: string }`. The description reads: `Ask a second model for advice on your current approach. It sees the recent conversation; state the specific question.`
      - The result text is the advice plus `[advisor: <model>, <tokens> tokens]`.
      - Past `maxConsultsPerRun`, it returns an error result naming the cap.
    - Functional: **`beforeTools` trigger** (a `tool.call` decide hook, for the named tools only):
      - The consult asks for JSON `{ "verdict": "proceed" | "revise", "advice": string }` about the pending call (name and args).
      - `proceed` returns `"allow"`.
      - `revise` returns `{ deny: "Advisor: <advice>" }`, so the model sees the advice as the tool result (Task 1 (i)).
      - A retry of the same tool with the same arguments hash in the same run is allowed without a second consult. A `revise` therefore cannot loop.
      - An unparseable verdict, a model error, a timeout, or the cap being reached all return `"allow"` and emit the event with `status: "skipped"`.
    - Functional: **`beforeFinish` trigger** (a `run.end` decide hook):
      - At the loop's natural end, one consult reviews the final answer against the transcript.
      - `revise` returns `{ continue: { reason: "Advisor review", steer: "<advice>" } }`. It is bounded by `limits.maxContinuations` and `maxConsultsPerRun`.
      - `proceed`, an error, or the cap ends the run normally.
    - Functional: Every consult emits a `package.event` `advisor.consult` with `{ trigger: "tool" | "beforeTools" | "beforeFinish", status: "ok" | "skipped" | "capped", verdict?, totalTokens? }`. It never contains the transcript or the advice text.
    - Functional: **Run task capture.** When `validate` is set, a `run.input` transform hook records the run's input messages per `runId` in agent state (`prism.state.agent`) and returns the input unchanged (Task 1 (j)). The entry is dropped when the run ends. A run whose input was not captured, such as one resumed after a restart, uses the first user message of `RunEndPayload.history`, and the event says `task: "inferred"`.
    - Functional: **`validate` round** (a `run.end` decide hook):
      1. Build the slice with `selectTranscript(payload.history, { ...validate.context, pinned: <captured task> })`.
      2. Ask for JSON `{ "verdict": "complete" | "incomplete", "missing": string[], "evidence": string }`, judged against the task and `criteria`.
      3. With `engine: "model"`, make one `prism.models.client(model).generate` call with no tools.
      4. With `engine: { child }`, call the `delegate` service (Task 7), using `prism.services.consume` at call time, with `mode: "sync"`, the hook's session and signal, and a fixed brief. The brief holds the task, `criteria`, the final answer, the instruction to check the evidence with the child's tools before answering, and the JSON shape. The host configures that child, typically `hidden: true` with read-only tools and its own `context`.
      5. Map the verdict:
         - `complete`: end the run; emit `verified`.
         - `incomplete` with rounds left: `{ continue: { reason: "Validator: task incomplete", steer: "Missing: <missing, one per line>. Finish these, then state the evidence." } }`; emit `incomplete`.
         - `incomplete` with no rounds left: end the run; emit `unverified`.
    - Functional: **Validation fails closed.** A model or child error, a timeout, an unparseable verdict, a missing service or unknown child (`validator_engine_unavailable`), or `maxConsultsPerRun` being reached never gives `verified`.
      - With `onError: "continue"` and rounds left, the hook continues with the steer `Validation could not run (<reason code>). Check your work explicitly and state the evidence.` and emits `error`.
      - Otherwise the run ends and the event is `error`.
      - Validation rounds are counted per run, separately from `maxConsultsPerRun`, and both are bounded by `limits.maxContinuations`. The README states that the effective cap is the smaller of `maxRounds` and the continuations left.
    - Functional: **`validator.verdict` event.** Every round emits `{ round, verdict: "verified" | "incomplete" | "unverified" | "error", engine: "model" | "child", task: "captured" | "inferred", missing?: string[], reasonCode?, totalTokens? }`.
      - `missing` holds at most 5 items of at most 200 chars each, and is redacted by `events.emit`.
      - The event never carries the transcript, the evidence text, or the final answer.
      - A host treats a run as done only when the run's last `validator.verdict` is `verified`. The README shows the subscription.
    - Performance:
      - Each consult is one model call: at most about `context.maxChars / 4` tokens in, plus `adviceMaxChars / 4` tokens out. The `run.end` trigger needs no store read.
      - By default, only the `advise` tool is on, and it costs nothing until the model calls it.
      - The README states the worst case per run (`maxConsultsPerRun` calls) and that `beforeTools` adds a full model call's latency before every listed tool.
      - `validate` costs nothing unless set. With `engine: "model"`, each round is one model call. With `engine: { child }`, each round is one delegation, bounded by that child's limits (Task 3's defaults: up to 500,000 tokens). The README states both and recommends tight `limits` on a validator child.
      - Task capture keeps one message list per active run in memory.
    - Code Quality:
      - The transcript slice comes from `selectTranscript` only.
      - No kernel change beyond Task 7's export.
      - The advisor does not import `@arnilo/prism-delegate`.
      - The package follows the new-package layout in `references/prism.md` §4.
    - Security:
      - **Not a security gate.** The advisor is advisory: every failure is "allow" or "end normally", and the README says safety belongs to `@arnilo/prism-approval` and policy packages, not to the advisor. Hooks never throw from an advisor failure, so an advisor outage cannot block a run.
      - **What it sees.** The advisor sees only the redacted branch slice.
      - **What it can do.** It has no tools and cannot act.
      - **Bounded by config.** The model cannot raise `maxConsultsPerRun` or `context`.
      - **Re-entry.** If Task 1 (i) finds that `models.client` runs model hooks, the advisor's own call is marked so its triggers never fire on it.
      - **Validation is not advice.** It fails closed: no `verified` without a parsed `complete` verdict, and errors are reported, never passed.
      - **What the validator child can do.** It gets only its configured packages through the service (Task 7). The advisor cannot add tools or packages to it.
      - **Child verdicts are untrusted output.** A malformed or oversized verdict is an `error`, never `verified`.
      - **Prism cannot fail a run from `run.end`.** The README says plainly that the host must gate on `validator.verdict`, and that a run reporting `completed` alone does not mean verified.
  - Approach:
    - Documentation Reviewed:
      - `src/hooks/types.ts:104-109, 135-154, 174-185`; `src/packages/api.ts:110-170`; `packages/integrations/delegate/src/{index,tools}.ts` (package and tool shape to mirror); Task 1 (i); Task 7.
    - Options Considered:
      - **Leave it to hosts (a tool plus hooks in each host).** Rejected by owner decision 2026-10-23. Every host would rebuild the same slice, prompt, verdict parsing, retry guard, and cap.
      - **An advisor as a delegate child.** Rejected as the mechanism. A child is a full agent loop with tools and limits. An advisor is one call, and with Task 7 a reviewer child is already possible for hosts that want an advisor with tools. The README's "Advisor or delegate child?" section explains when to use which.
      - **Put it in the kernel.** Rejected. The tool, hooks, and `models.client` already express it, and it is a capability an agent may or may not have (`references/prism.md` §1).
      - **Make an advisor failure fail closed (deny).** Rejected. That would turn a second opinion into a gate whose outage blocks every listed tool, and approval and policy packages already own gating.
      - **A `stall` trigger (after N failed tool calls).** Not in this task. The two triggers above cover the requested review points.
      - **A separate `@arnilo/prism-validator` package.** Rejected by owner decision 2026-10-23. It would duplicate the slicing, verdict parsing, caps, and model resolution, and a second package would need its own enforcement rows.
      - **Reuse `beforeFinish` as the validator.** Rejected. It fails open, cannot check evidence, slices only the newest turns (so the task can be lost), and shares the advice cap.
      - **A kernel `RunResult` verdict field set from `run.end`.** Rejected. A package event already carries it, and no second user needs a kernel field (`references/prism.md` §1).
      - **Fixed checks inside the validator (run tests).** Rejected. JSON hooks' `Stop` command and the coding package's goal-verify (`packages/tools/coding/src/agent/goal-verify.ts`) already run fixed checks. A validator child with read-only coding tools covers checks that need judgment. The README shows how to combine them.
    - Chosen Approach:
      - A small integration package: one tool, two opt-in hooks, one model call per consult, capped per run.
      - A `validate` role on `run.end` with a captured task, a model or hidden-child engine through the `delegate` service, fail-closed verdicts, and a `validator.verdict` event the host gates on.
    - API Notes and Examples:
      ```ts
      import advisor from "@arnilo/prism-advisor";
      advisor({
        model: "hyper/<strong-model>",
        context: { lastTurns: 8 },
        triggers: { beforeTools: ["shell", "write"], beforeFinish: true },
        maxConsultsPerRun: 4,
      });
      // model: advise({ question: "Is patching the parser or the caller the right fix?" }) → "Patch the caller: … [advisor: hyper/<strong-model>, 3,912 tokens]"

      // Validation by a hidden child that checks the evidence:
      delegate({ children: { verifier: { inherit: ["@arnilo/prism-tools-coding"], tools: { only: ["read", "grep", "glob", "shell"] }, hidden: true, limits: { maxTotalTokens: 100_000 } } } });
      advisor({ model: "hyper/<strong-model>", tool: false, validate: { engine: { child: "verifier" }, criteria: "Tests pass and the changelog is updated.", maxRounds: 2 } });
      // host: agent.events → package.event "advisor/validator.verdict" { round: 1, verdict: "incomplete", missing: ["CHANGELOG.md not updated"] } … { round: 2, verdict: "verified" }
      ```
    - Files to Create/Edit:
      - `packages/integrations/advisor/{package.json,tsconfig.json,README.md,CHANGELOG.md,LICENSE}` (new; `package.json` mirrors `packages/integrations/delegate/package.json`).
      - `packages/integrations/advisor/src/{index,config,consult,tool,triggers,verdict,validate,task-capture}.ts` (new). `validate.ts` declares a local structural type for the two `DelegateService` methods it calls, so the package has no runtime import of `@arnilo/prism-delegate`.
      - `packages/integrations/advisor/src/__tests__/{package,consult,triggers,validate}.test.ts` (new). `validate.test.ts` loads the real delegate package as a devDependency, which also proves the structural type matches `DelegateService`.
      - Enforcement rows from Task 1 (i): `scripts/package-truth.mjs` (and the generated `scripts/package-truth.json`), `scripts/independent-packages.json` (`$comment`: lockstep until Phase 11), `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, the coverage and release-evidence rows Task 1 (i) confirms, `scripts/compat-baseline/arnilo__prism-advisor.txt` (new), `docs/index.md` (README link and package table row), and `docs/release.md` if it lists packages.
      - `examples/advisor.ts` (new, offline on the mock provider: one `advise` call and one `beforeFinish` revise→continue), `examples/README.md`, `examples/tsconfig.json`, and `scripts/e2e-coverage.json`.
      - `bun.lock` (the workspace is added by the existing `packages/integrations/*` glob).
      - `CHANGELOG.md`.
    - References:
      - Task 7 (`selectTranscript`); Task 1 (i); the 2026-10-23 advisor discussion (host-built vs SDK).
  - Test Cases to Write:
    - `advisor_package_conformance`: the package conformance suite from `@arnilo/prism/testing`.
    - `advise_tool_makes_one_call_with_transcript_slice`: the mock provider sees exactly one request, with no tools, containing recent parent text and the question.
    - `advise_result_capped_and_status_line`.
    - `consult_cap_per_run_enforced`: the fourth call with `maxConsultsPerRun: 3` returns an error result and makes no provider call.
    - `before_tools_revise_denies_with_advice`: the model receives `Advisor: …` as the tool result.
    - `before_tools_proceed_allows`; `before_tools_ignores_unlisted_tools`.
    - `before_tools_retry_same_args_skips_consult`: fails if a revise can loop.
    - `before_finish_revise_continues_with_steer`; `before_finish_respects_max_continuations`.
    - `advisor_failure_never_blocks`: a provider error or unparseable verdict gives allow or a normal end, with `status: "skipped"`.
    - `missing_model_fails_setup_naming_field`; `unresolvable_model_notes_warn_and_registers_nothing`.
    - `advisor_event_carries_no_transcript_or_advice`.
    - `advisor_never_reenters_its_own_triggers` (per Task 1 (i)).
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/advisor.ts`.
    - Run `bun scripts/release.mjs gate --update-baseline`. The note records the new `arnilo__prism-advisor.txt` baseline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new package.
    - Docs pages to create/edit:
      - `packages/integrations/advisor/README.md`, using the package page structure. It covers Install, Configuration, What it changes (tool, two hooks, `advisor.consult` event), Capabilities, "Cost, security, and failure behavior" (per-consult cost, worst case per run, not a security gate), "Advisor or delegate child?", and Example.
      - `CHANGELOG.md` (Added).
    - `docs/index.md` update: yes. One package link (`@arnilo/prism-advisor`: a second model's advice on demand or before chosen tools and the final answer) and the package table row.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun --cwd packages/integrations/delegate run build && bun --cwd packages/integrations/delegate test --timeout=0`
- `bun test --timeout=0 src/__tests__/skills.test.ts src/__tests__/transcript.test.ts src/__tests__/public-export-contract.test.ts`
- `bun --cwd packages/integrations/advisor run typecheck && bun --cwd packages/integrations/advisor test --timeout=0`
- `bun test --timeout=0 src/__tests__/packaging.test.ts`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
