# Changelog

## [Unreleased]

### Added

- **`delegating-work` skill (plan 215 Tasks 9 and 11).** The package registers a bundled skill from `skills/delegating-work` with `skills.addDir` (first in `setup`), and `package.json` `files` lists `skills`. It declares `prism-requires-tools: delegate delegate_wait delegate_cancel`, so a config with only hidden children, or a request without the tools, does not list it. The body is eight lines: a child sees only the brief, never put a secret in it, do a one- or two-call job yourself, read the status line, check a claim before repeating it, send a second brief rather than the same one, cancel what you no longer need. Kept on a measured hazard effect, not a pooled gain: `delegate-trivial-no-child` 9/9 with the skill against 1/9 without across three runs, the other 14 items at ceiling (owner override of the pooled ship rule; evidence in `docs/_evidence/skill-evals/211/v3/`).
- `children.<name>.skills: "inherit"` (the default) now leaves out a parent skill that requires `delegate`: a child never sees that tool, and an inherited skill would add the `load_skill` bridge to a child that could not use it.

- Delegate children are choosable and bounded (plan 191 Task 2): `children.<name>.description` turns the `delegate` description into one `- <name>: <description>` line per child (falling back to the first sentence of `instructions`, else `(no description)` with a setup note), the schema documents `child`, `input` (a self-contained brief) and `mode`, the child's instructions always start with the report contract, and every result is the child's answer plus one status line.
- `children.<name>.resultMaxChars` (default 12,000, at most 64,000) caps the answer the parent sees; a longer one ends with a `delegate_wait { offset }` hint and the delegation keeps up to 256,000 chars (`HARD_RETAINED_RESULT_CHARS`) to page. New exports: `DEFAULT_RESULT_MAX_CHARS`, `HARD_MAX_RESULT_MAX_CHARS`, `HARD_RETAINED_RESULT_CHARS`, `resolveResultMaxChars`, `DEFAULT_CHILD_INSTRUCTIONS`.
- `@arnilo/prism-delegate` (plan 160 Task 4): native package adding `delegate`, `delegate_wait`, and `delegate_cancel` tools. Each child runs as its own `createAgent` over the packages named in its `inherit`, reports `delegate.step` package events, and ends or is disposed with the delegation or the parent session. Replaces the in-process supervisor, `createSpawnAgentTool`, and `createDelegatedAgentStep`.
- `@arnilo/prism-observability` (plan 160 Task 3): native package turning run, turn, and tool events into OpenTelemetry spans and metrics through observe handlers. Moved the agent-event instrumentation (`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, `createInMemoryTelemetry`) out of `@arnilo/prism-core/governance/observability`. Exports nothing itself.

### Added

- Children can see the parent's conversation (plan 191 Task 7): `children.<name>.context` is `"none"` (default), `"summary"`, or `{ lastTurns, maxChars? }`. A `lastTurns` child is seeded from the parent's branch with the kernel's new `selectTranscript` (portable text, tool activity rendered inline, dangling calls and thinking dropped), under its own session id in its own memory store; a `"summary"` child gets one summarization call instead. Only messages and summaries travel, so inherited package state never hydrates from the parent. A child configured with `context` fails `context_unavailable` instead of running blind, and the tool description marks which children see the conversation. New exports: `DelegateContextConfig`, `resolveChildContext`, `DEFAULT_CONTEXT_MAX_CHARS`, `HARD_CONTEXT_MAX_CHARS`, `HARD_CONTEXT_LAST_TURNS`, `SUMMARY_INSTRUCTION`, `ContextUsed`.
- The delegate runtime is provided as the `"delegate"` service (`DelegateService`: `start`, `wait`) for a package that runs a configured child the model never sees. `children.<name>.hidden: true` keeps a child out of the tool and its `child` enum; when every child is hidden the tools are not registered and the service still is. The package declares `session-state` for the branch read.
- Children from subagent files (plan 191 Task 6): `agentsRoot` reads `<root>/.agents/agents/*.md` then `<root>/.claude/agents/*.md` with `parseAgentFile`, so an existing Claude Code subagent file becomes a delegate child; `defaultInherit` (required with `agentsRoot`) is the only package set such a child gets. `name`, `description`, and the body are the child; `tools` maps through the frozen `AGENT_TOOL_NAMES` (`Read`→`read`, `Write`→`write`, `Edit`→`edit`, `Grep`→`grep`, `Glob`→`glob`, `Bash`→`shell`) into `tools.only`; `model` is `provider/model`, and an alias or bare id means the parent's model. Configured children win, then `.agents`, then `.claude`; duplicates are an `info` note. A malformed file or a `tools` list that maps to nothing is skipped with a `warn` note, and a mapped tool the agent does not register is dropped at the first run with one note.
- `children.<name>.isolation: "worktree"` (plan 191 Task 5): the child runs in its own worktree of the inherited coding package's repository, bound to its session, and its branch is merged into the parent's checked-out branch when it completes. The merge outcome (`merged`/`conflict`/`refused`/`skipped`, with the kept branch) is summarized in the result's status line. `WorkspaceWorktree.parentBranch` records the merge target; `workspace.commit` records a kept worktree's pending changes on its branch. A child without a `workspace` service, or a sandboxed one, fails with `isolation_unavailable` before running.
- `ownership` config: the scope child agents append under.

### Changed

- Children reach the parent's host (plan 191 Task 4): `buildAgent` passes `host: { ui }` built from `prism.host.ui`, prefixing `[<child>] ` into the request's `title`, `detail`, and `message`. An `ask` inside a child is now answered by the person instead of suspending the child, and the package declares the `host-ui` capability.
- `children.<name>.skills` (default `"inherit"`): the child gets the parent's skills at delegation time, `"none"`, or the named subset. An unknown name fails the delegation.
- Kernel: registering a skill whose name is taken by a skill with the same `path` and the same `instructions` is a no-op instead of `skill_conflict`, for `prism.skills.register`, `AgentConfig.skills.add`, and `skills.dirs`. A same-name skill with a different path or body is still a conflict.

- Delegation budgets finish the work (plan 191 Task 3): `DEFAULT_CHILD_LIMITS` is now 50 turns / 200 tool calls / 500,000 tokens / 15 minutes and `HARD_CHILD_LIMITS` 200 / 1,000 / 2,000,000 / 60 minutes. The old defaults could not complete a coding task: plan 189's tool schemas alone cost several thousand tokens per call.
- `mode: "async"` always runs as the parent session's background work and ends with it; `mode: "sync"` stays part of the calling tool call and aborts with it.
- A delegation entry leaves the map when its retained answer was fully served (a `delegate_wait` with no `nextOffset`, or an untruncated sync return) and when the parent session closes. A truncated sync result keeps its entry so the paging hint can be followed.

### Removed

- `children.<name>.budgetShare` (use `limits` directly) and `children.<name>.lifetime` (use `mode`), plus the `DelegateLifetime` type and `resolveChildLimits`'s `budgetShare` parameter. A config that still sets either fails `createAgent` with the kernel's config error.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
