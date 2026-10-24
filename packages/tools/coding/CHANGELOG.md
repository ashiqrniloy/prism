# Changelog

## [Unreleased]

### Added

- **Background waits are event-driven (plan 189 follow-up).** `ProcessSession` gains `onOutput(listener)`, which publishes a chunk or the terminal transition (unsubscribe with the returned function; a throwing listener never fails the process). `shell({ background: true })` therefore returns as soon as the first output arrives instead of always paying the one-second window, and `shell_output({ waitSeconds })` wakes on the publication instead of polling every 50 ms. One `shell_output` call now drains everything that accumulated, in whole chunks up to twice the tail cap, instead of returning only the first chunk. The internal session record carries the listener set; no cap changed.

- **The `workspace` service emits `worktree_changed` (plan 189 follow-up).** `createWorkspaceService({ onEvent })` emits `{ type: "worktree_changed", action: "add", path }` after `worktree.create` succeeds and `{ action: "remove", path }` after `dispose()` removed one, through `createCodingLifecycleEmitter` (so the frozen kind's path/byte caps apply). No new export: `WorkspaceServiceOptions` gains the field. Worktree movement keeps a producer at the layer that still owns worktrees, after the `git_worktree` tool was removed, and nothing is emitted when no sink is passed. `createCodingLifecycleEmitter` also swallows a listener that throws now, so a failing consumer cannot fail the operation that produced the event.

- **`diagnostics` tool (plan 189 Task 10).** `language.servers` (name → `{ command, args?, languages, env? }`) registers `diagnostics({ path })`, which refreshes the document and returns the language server's diagnostics as `path:line:col severity message` (1-based, capped at 500 per file / 4 KiB per message). No servers means no tool and no process; a configured server starts on the first call for its language and stops when the last open session closes. A server that cannot start is a tool error naming it plus one `status.note("warn", …)`. New exports: `createDiagnosticsTool`, `DiagnosticsToolHandle`, `DiagnosticsToolOptions`, `ToolsCodingLanguageConfig`, `ToolsCodingLanguageServerConfig`, `languageIdForPath`.

- **Background processes (plan 189 Task 9).** `shell` takes `background: true` and returns `Started process <id>` plus the output that arrived within one second; `shell_output({ id, waitSeconds?, kill? })` reads the increment since the last call, waits for new output or exit (max 60 s), or kills the process. Processes run on the process-session library, are owned by the calling session (another session's id is an error), are capped by `shell.background.maxProcesses` (default 4, hard 16), and are killed on `session.closed` and `agent.dispose()`. The hard-deny `commandRules` and built-in denies, the environment allow-list, `commandPrefix`, and `spawnHook` all apply to background commands. A backend without `startProcess` (the native `unshare` sandbox) offers no `background` argument and no `shell_output`. New exports: `createBackgroundProcesses`, `createShellOutputTool`, `BackgroundProcesses`, `BackgroundProcessOptions`, `BackgroundRead`, `BackgroundReadInput`, `BackgroundStarted`, `BackgroundStartInput`, `ShellOutputToolOptions`, `DEFAULT_MAX_BACKGROUND_PROCESSES`, `HARD_MAX_BACKGROUND_PROCESSES`, `HARD_MAX_BACKGROUND_WAIT_SECONDS`, `BACKGROUND_FIRST_OUTPUT_MS`.

- **`examples/serve-tools.ts`: serving a run's tools to an external agent (plan 165 Task 8).** The Phase 14 end-to-end example, offline. Inside one `session.run` an inline `defineDriver` driver binds a `workspace` worktree for the run's session, writes the vendor's MCP configuration into it with `excludeOverlay`, and serves `read`, `edit`, and the permission tool with `serveTools` over `loopback-http` and then `stdio-relay`, driving the scripted `jsonl-stream` CLI as the vendor binary through `--mcp-endpoint`. It shows an allowed `edit` that changes the file in the worktree, a declined `edit` under `@arnilo/prism-approval` in `ask` mode, the permission tool's deny and allow, an unserved name as a JSON-RPC error, a call after `close()` refused, the served calls' `origin` on the run's events, the worktree diff with the overlay excluded, and a conflicting `merge` reported unresolved.
- **Per-session worktree routing (plan 165 Task 7).** A worktree bound with `worktree.create({ sessionId })` now routes that session's tool calls into the worktree: one wrapper at registration (`createWorktreeRouting({ base, create, workspace })`) wraps each registered tool's `execute` with a lookup of the calling session's worktree and dispatches to the tool instance built for it, so relative paths resolve inside the worktree and the tools' own containment follows it. Tool names, descriptions, and schemas are unchanged. The binding lives only in the service's memory, keyed by session id, and is never read from tool arguments or model output. Instances are built once per bound worktree, dropped on `dispose`, and dropped on the `session.closed` hook. A session rebound to another worktree rebuilds. New exports: `createWorktreeRouting`, `WorktreeRouting`, `WorktreeRoutingOptions`, `CodingTargetsContext`.

### Removed

- The unregistered patch-review module and its four limits constants: `createCodingPatchReviewManifest`, `assertCodingPatchAccepted`, `CodingPatchReviewError`, `resolveCodingReviewLimits`, `CodingPatchReview*`/`CodingReview*`/`ReviewDiagnosticSeverity` types, `DEFAULT_/HARD_MAX_REVIEW_REVISIONS`, `DEFAULT_/HARD_MAX_REVIEW_MANIFEST_BYTES`. `lifecycle.ts` and `coding-checkpoint.ts` stay (shipped tools type-import the former; `goal-verify.ts` uses the latter).

- **Fewer tools, one job each (plan 189 Task 8, breaking).** `repo_list`, `git_branch`, `git_worktree`, and `git_apply` are gone, with `createRepoListTool`, `ListToolOptions`, `createGitBranchTool`, `createGitWorktreeTool`, `createGitApplyTool`, and `classifyGitBranchEffect`/`classifyGitWorktreeEffect`/`classifyGitApplyEffect`. `createGitTools` returns `git_status`, `git_diff`, `git_commit`, `git_pr_handoff`. Directory listing is the `glob` walk (the repository `list` operation stays), worktrees are the `workspace` service's job, and `git branch`/`git apply`/`git worktree` are `shell` calls. `delete`/`move` are registered only when `shell` is absent — `createCodingTools(cwd, { shellAvailable: false })` — so the default set is 12 tools instead of 18 and the read subset is `read`/`grep`/`glob`. `GitToolsOptions.onEvent` is removed; the `workspace` service emits `worktree_changed` instead (see Added).

### Changed

- **Skill directories are read-only extra roots for read-effect coding tools (plan 190 Task 6).** `coding.targets` now reports `dirname(skill.path)` for every effective skill with an absolute path, but only for `read`, `glob`, `grep`, and `diagnostics`. A skill's `references/` file outside the workspace is therefore readable without adding a root that would also grant writes, and approval sees the same read-only roots. `write`, `edit`, `delete`, `move`, and `shell` keep the coding roots, so a write under a skill directory is still hard-denied. The skill list is read lazily after setup and the derived directories are cached until its paths change. `createCodingTargets` gains an optional fourth argument, `() => readonly Skill[]`; without it behavior is unchanged. No kernel change; `CodingTargets.roots` and the function's signature are the additive package surface.

- **Schemas describe only what the model controls (plan 189 Task 7).** `write` and `edit` include `force` — and the read-before-write sentence in their description — only when the tool was created with `requireReadBeforeWrite`; without the guard `force` is an unknown key and the description is silent about it. `ask_user_decision`'s `pros`/`cons` are optional 0–3 string arrays (were exactly 3), `AskUserDecisionOption.pros`/`.cons` are `readonly string[]`, and a 4-bullet list still fails. Guard behavior when enabled is unchanged.


- **`edit` is exact-match only and reports what it changed (plan 189 Task 6).** Breaking: `normalizeForFuzzyMatch`, `fuzzyFindText`, `applyReplacementsPreservingUnchangedLines`, `AppliedEditsResult.usedFuzzyMatch` and `EditToolDetails.fuzzy` are gone, and a near-miss oldText (trailing whitespace, smart quotes, en-dash, NBSP) now fails loudly with the `Nearby` hint instead of editing a nearby region. A success returns `Edited <path>: N block(s).` followed by the changed lines with their new numbers, two lines of context and a 40-line cap with a `(… N more changed lines)` note. New export `generateChangedLinePreview` shares `read`'s `N\ttext` format; CRLF/BOM preservation is unchanged.


- **`glob` accepts brace patterns by default (plan 189 Task 5).** `braceExpansion` defaults to `true`: `src/**/*.{ts,tsx}` expands on the first call, with the same bounds (128 alternatives / 4096 expanded bytes; unbalanced, nested, or empty braces are errors). The argument is removed from the schema; `createGlobTool(cwd, { braceExpansion: false })` rejects braces and the error says so. `compileGlob(pattern, braceExpansion?)` is exported and used by the `grep` `glob` filter and both sandbox paths, so brace filters expand everywhere.


- **`repo_search` is now `grep`: regex by default, in a terminate-able worker (plan 189 Task 4).** Breaking: the renamed tool takes `pattern` (not `query`), `caseSensitive` defaults to `true`, `context` defaults to `0`, and content output is ripgrep-style (`path:line:text`, `path-line-text` for context, `--` between groups, each line once). A pattern is a JavaScript regex unless `literal: true`; regex matching runs in `agent/grep-worker.ts` and the main thread terminates it at the search time limit, so a catastrophic pattern returns the matches so far with `truncatedBy: "time"` instead of blocking the loop. New `glob` argument filters files by path, `mode` is only in the schema when `modes` enables an index, and `createRepoSearchTool`/`SearchToolOptions` become `createGrepTool`/`GrepToolOptions` (`ToolsOptions.search` stays as a deprecated alias). `RepositorySearchRequest` gains `matcher` and `glob`; `matchLines`/`literalMatcher` are exported and shared by the worker, literal mode, and the sandbox backend.


- `coding.targets`' `CodingTargetsFn` takes an optional third argument, `{ sessionId? }`, and `createCodingTargets(root, roots, workspace?)` takes the `workspace` service. For a bound session it reports the worktree as the session's root and resolves relative paths against it, so approval and the hard-deny hook follow the session; unbound sessions are unchanged. The hard-deny hook now passes the `tool.call` payload's `sessionId`.
- `worktree.create({ sessionId })` fails with the new `workspace_sandbox_unsupported` when `sandbox` is other than `none`, because a routed worktree path is outside the sandbox root. `create` without `sessionId` still works.

- `@arnilo/prism-tools-coding` (plan 154 Task 3): the coding tools moved out of
  `@arnilo/prism-coding-tools/{agent,security}` into a source-exported package on the lockstep line.
  The default export is a `definePackage` definition whose `setup` registers `read`, `write`, `edit`,
  `delete`, `move`, `repo_list`, `repo_search`, `glob`, and `shell` (or the read subset with
  `readOnly: true`, and without `shell` when `shell.enabled` is `false`). Every registered tool now
  declares `effects` — `["read"]` for the read/search tools, `["write"]` for the mutating tools, and
  `["execute"]` for `shell` — so `tool.call` hooks and approval can decide from the capability
  annotation. Config is `{ root, roots?, readOnly?, shell?, repository? }`; a missing `root` fails the
  load with a field-naming error rather than a schema `required` (plan 152 Task 6's config rule).
- The moved module surface keeps its names as named exports behind the single entry point: the tool
  factories and aggregators, the opt-in Git/check/todo/`ask_user` tools, the workspace/process/
  language/review helpers, and the sandbox, command-rule, path-containment, and egress modules.
- `tool.call` hard denies (plan 154 Task 4): one decide handler, id
  `@arnilo/prism-tools-coding:tool.call#hard-deny`, denies a path outside `root` ∪ `roots` after
  realpath/symlink resolution, a `shell` command matching a deny `commandRules` entry or a built-in
  deny pattern, and any mutating tool under `readOnly`. The kernel's any-deny-wins rule makes it hold
  under every approval mode and from a custom loop.
- The `coding.targets` service, `targets(name, args) → { paths, roots } | undefined`, reporting the
  absolute paths and roots of each own-tool call.
- Config gains `sandbox` (`"none"` default, `"native"`, `"docker"`, `"e2b"`), `commandRules`, and
  `egress`. `e2b` is reached only through a dynamic import of the optional peer; a backend that
  cannot be built notes a warning and withholds `shell` instead of throwing or running unsandboxed.
- Git, checks, todo, and `ask_user` (plan 154 Task 5). `git` (default on) registers the seven git
  tools with declared effects. `checks` registers `coding_check` only when at least one check is
  configured. `todo` registers `todo_write` and a `run.end` handler, id
  `@arnilo/prism-tools-coding:run.end#todo`, unless `continueOnOpen` is `false`. `ask_user_decision`
  asks through `host.ui`; `unavailable` suspends and `session.resume(decisions)` delivers the answer.
  Durable-effect tools fail closed with `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` or
  `ERR_PRISM_CODING_PRINCIPAL_MISMATCH`. `forge.token` is an `env:`/`keyring:` ref resolved through
  `prism.credentials.resolve`.

### Added

- The `workspace` service (plan 165 Task 6): disposable git worktrees for delegated coding work,
  provided whenever `root` is inside a git repository (otherwise a `status.note` and no service).
  `worktree.create({ branch?, base?, sessionId? })` adds and locks a linked worktree under
  `worktreeRoot` and returns `{ path, branch, base, sessionId?, dispose }`; `worktree.bound(sessionId)`
  is the plan 165 Task 7 routing lookup. `diff(path, bounds?)` returns `{ changes, truncated }` — the
  driver kit's `FileActivity` shape — for tracked changes against the worktree's base plus untracked
  files, with overlay files excluded and per-file byte bounds. `merge(path, { into, commit? })`
  probes with `git merge-tree --write-tree` so a conflict reports `{ status: "conflict", files }` with
  both trees, the index, and every ref unchanged; a clean merge returns `{ status: "merged", commit }`.
  `excludeOverlay(path, files)` writes overlay files and excludes them through one marked block in the
  git common directory's `info/exclude` (the driver kit's `writeExcludeBlock`). `dispose({ force? })`
  removes the overlays, unlocks and removes the worktree, drops the session binding, and deletes the
  branch only when git considers it fully merged. New config: `workspace`
  (`enabled`, `worktreeRoot`, `maxWorktrees`, `diff.maxFiles`, `diff.maxBytes`) with defaults and
  schema bounds. `GitOperations` gains `mergeTree`, `commitTree`, `updateRef`, `fastForward`,
  `stageAll`, `writeTree`, `readTree`, and `untrackedFiles`, plus a `base` option on `diff`/`worktree`
  and a `delete` action on `branch` — all through the existing bounded runner.

### Removed

- The durable multi-repository workspace lifecycle (plan 165 Task 6): `createCodingWorkspaceLifecycle`,
  `resolveWorkspaceLimits`, `WorkspaceError`, the `WORKSPACE_NAMESPACE`/`WORKSPACE_SCHEMA_VERSION`/
  `WORKSPACE_LOCK_REASON_PREFIX`/`WORKSPACE_STATES` constants, the `CodingWorkspaceRecord`/`Workspace*`
  record and limit types, and the ten `*_MAX_WORKSPACE_*` caps, with no alias. Durable records, leases,
  checkpoints, and multi-repository identity move to `@arnilo/prism-workflows` in Phase 16; the
  in-process `workspace` service replaces the rest. The phase26 coding-journey fixture's workspace leg
  now uses the service and drops its Postgres verify/cleanup calls.
- `createCodingApprovalPolicy` and its `CodingApprovalFn`, `CodingApprovalRequest`,
  `CodingApprovalPolicyOptions`, and `ApprovalCacheScope` types (plan 154 Task 4). Prompting moves to
  `@arnilo/prism-approval` (plan 154 Task 6); containment and command-rule evaluation stay as
  internal checks behind the `tool.call` hard deny.
- The host ask callback, the workflow suspend/resume validators, and the mutable todo-continuation
  handler (plan 154 Task 5). Asking goes through `host.ui` and `session.resume`. Continuation is
  `createTodoContinuationDecision` on `run.end`.

### Changed

- `@arnilo/prism-coding-tools` no longer exports `./agent` or `./security`; the two subpaths are
  deleted with no alias. Its remaining surface is `./openapi`, `./computer-use-linux`, `./dev`,
  `./dev/cli`, and `./impeccable`. Its `diff` dependency moved with the coding tools.
- Every importer migrates to `@arnilo/prism-tools-coding`: `@arnilo/prism-code`,
  `@arnilo/prism-ag-ui`, `@arnilo/prism-acp-agent`, `@arnilo/prism-agent-sdk`, the examples, and the
  scripts.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The coding tools shipped inside `@arnilo/prism-coding-tools` before this package existed; see that
package's changelog for the pre-split history.
