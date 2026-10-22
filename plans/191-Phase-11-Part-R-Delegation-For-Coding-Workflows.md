# Phase 11 Part R — delegation for coding workflows

## Objectives

- Let the model choose a child and brief it well: every child has a description, and the tool says the child sees nothing but the brief.
- Give children budgets that can finish coding work, and remove the configuration knobs that duplicate each other.
- Make a coding child safe to run in parallel: an isolated worktree per delegation, merged back deterministically.
- Stop killing a child that needs approval, and give children the parent's skills.
- Accept subagent files written for other coding agents (`.agents/agents/*.md`, `.claude/agents/*.md`).
- Keep the parent's context small (context-rot review, 2026-10-17). A child is the strongest isolation available: Context-Folding (arXiv 2510.11967) reports a 10× smaller active context at equal or better task success. That only holds if the child's answer reaching the parent is bounded, so the result is capped and paged.

## Expected Outcome

- The `delegate` tool's description lists `name — description` per child, and `input` is described as a self-contained brief.
- A child with no `limits` gets 50 turns, 200 tool calls, 500,000 total tokens, and 15 minutes (was 8, 32, 20,000, and 60 seconds). `budgetShare` and `lifetime` are gone: `mode: "sync"` is tied to the calling tool call, and `mode: "async"` runs as session background work.
- `isolation: "worktree"` runs the child in its own worktree and, when it finishes, merges its changes into the parent's checked-out branch. A conflict, or a dirty target, returns `merge: { status: "conflict" | "refused", files, branch }` and keeps the branch for a person to resolve.
- A child's approval request reaches the parent's `host.ui`; a child suspends only when the parent host answers `unavailable`.
- A child inherits the parent's effective skills by default (`skills: "inherit"`).
- With `agentsRoot` configured, a `.agents/agents/reviewer.md` or `.claude/agents/reviewer.md` file (Claude Code's subagent shape: `name`, `description`, `tools`, `model`, body) becomes a child named `reviewer`.

**0.13.0 release path — plan 191, step 7 of 21.** Amended 2026-10-17 by the context-rot review: Task 2 gains a bounded, paged child result and a concise-report instruction. Owner decision 2026-10-17 (see plan 189's header). Start this plan when plan 190 is complete; when it is complete, continue with plan 192. It depends on plan 189 (tool names for the subagent tool map, the tool set a coding child sees) and plan 190 (`parseAgentFile` returns the body; skills registered by `context-files`). It changes the `@arnilo/prism-delegate` config and result contract and adds one kernel rule (identical skill re-registration is idempotent, Task 4), so **Task 1 is the phase review**. It implements roadmap §2.9's `delegate` row ("sub-agents as a tool, inheriting a chosen package set") and §2.13.2 ("an orchestrator agent … is an `Agent` created with `prism-delegate`"); worktree isolation reuses the Phase 14 `workspace` service (§2.12.14) the same way `prism-workflows` agent nodes do. Docs go to the package README and `docs/agent.md` (skills rule). No version bump, publish, or npm deprecation. Reference host impact: the orchestrator (`apps/prism-agent/src/host/orchestrator.ts`) configures `delegate` with a research child; Task 3 updates it if it sets a removed field, and the orchestrated-workflow scenario must stay green.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Callers of the delegate surface** (`graft callers --depth all`): `DelegateChildConfig`, `DelegateLifetime`, `budgetShare`, `DEFAULT_CHILD_LIMITS`, `HARD_CHILD_LIMITS`, `resolveChildLimits`, `createDelegateRuntime` — including `apps/prism-agent/src/host/orchestrator.ts`, `examples/delegate.ts`, `scripts/e2e-coverage.json:390-393`, and the compat baseline.
      - (b) **Child construction** (`packages/integrations/delegate/src/runtime.ts:86-121`): the child gets the provider bridge plus re-instantiated inherited packages, a memory store, limits, and the principal — no `host` and no `skills`. Record what `createAgent` does with a missing `host.ui` for an `ask` (the suspension path in the README's "Safety").
      - (c) **Host port attribution.** The `HostUiRequestBase` fields (`src/host/types.ts:4`) and how a request is attributed to a package ("requests carry the owning package's name", `src/packages/api.ts:46`), so Task 4 can label a forwarded request with the child's name.
      - (d) **Worktree isolation mechanics.** A child agent re-instantiates `tools-coding`, so the parent's `workspace` service binding does not route the child's tools. Confirm that an inline package added to the child's `createAgent` can `services.consume("workspace")` from the child's own instance and bind the child session (the pattern `prism-workflows` uses, `packages/integrations/workflows/src/nodes/agent-node.ts:58-110`). Record `worktree.create`, `diff`, `merge`, and `dispose` behavior on the child's instance (`packages/tools/coding/src/workspace/service.ts`), whether disposing the child agent disposes its worktrees, and which branch `merge({ into })` should target (the parent root's current branch from `git_status`/`rev-parse`).
      - (e) **Skill duplicates.** What happens when the child receives the parent's skills through `skills.add` and an inherited package (for example `context-files` from plan 190 Task 5) registers the same skill again: today `skill_conflict` (`src/packages/api.ts:100`). The rule Task 4 adds, and its second user (two packages, or a host `skills.dirs` plus `context-files`, discovering the same `SKILL.md`), which is the kernel-addition proof required by `references/prism.md` §1.
      - (f) **Subagent file format.** Claude Code's `.claude/agents/*.md` frontmatter fields and tool names (find-docs; record the date), and whether Codex or the `skills` CLI define an equivalent. The tool-name map Task 5 needs (`Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`), checked against plan 189's final tool names.
      - (g) **The `delegations` map** (`runtime.ts`, `start`/`wait`): entries are never removed.
    - Functional: The note ends with a verdict; a finding that invalidates a task stops the plan for a re-cut.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: The review confirms a child still never gains a package the parent did not load, and that forwarding `host.ui` does not let a child answer its own approvals.
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
    - Security: Descriptions come from host config or Task 5's trusted files, never from model output.
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
      - Task 5 (file-defined children supply `description`).
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

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun --cwd packages/integrations/delegate run build && bun --cwd packages/integrations/delegate test --timeout=0`
- `bun test --timeout=0 src/__tests__/skills.test.ts`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
