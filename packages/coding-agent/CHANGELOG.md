# Changelog

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.

## [0.0.27] - 2026-08-07

### Added
- `createCodingLifecycleEmitter(options?)` — consumer-gated coding lifecycle events (Phase 10): ships `process_*` (reuses `CodingProcessEvent`) plus `file_changed`, `worktree_changed`, `permission_denied`, `configuration_changed`; synchronous bounded `emit`/`on`; drops unknown/oversized events without breaking producer paths; invalid limits fail closed with `CodingLifecycleError` (`ERR_PRISM_LIFECYCLE_LIMIT`); frozen `DEFAULT_LIFECYCLE_MAX_*` / `HARD_LIFECYCLE_MAX_*` caps.
- `onEvent` option on `createWriteTool` / `createEditTool` / `createMoveTool` / `createDeleteTool` / `createGitWorktreeTool` — tools emit `file_changed` (write/edit/move/delete) and `worktree_changed` (add/remove) after successful mutation, and `permission_denied` via the shared `enforceExecutionPolicy` deny hook (never raw tool arguments).
- `enforceExecutionPolicy(..., onDenied?)` — optional callback invoked once per policy denial (additive; existing callers unaffected).

## [0.0.26] - 2026-08-06

### Added
- `createGitHubForge(options)` — reference GitHub adapter: issue context, authenticated push (`GIT_CONFIG_*` credential injection, never argv), PR create/update, review comments, checks/status, bounded `reconcileHandoff`; every mutation gated by `ExecutionPolicy` and recorded in `ToolEffectStore` (retry never duplicates PRs/comments); typed `ERR_PRISM_FORGE_*` codes; frozen `DEFAULT_MAX_FORGE_*` / `HARD_MAX_FORGE_*` caps; no octokit dependency.
- `createGitAwareRepositoryOperations(cwd, options?)` — ignore-aware enumeration via fixed `git ls-files` with native walker fallback; host-only `includeIgnored`; `DEFAULT_MAX_LS_FILES_OUTPUT_BYTES` / `HARD_MAX_LS_FILES_OUTPUT_BYTES`.
- `createLanguageIntelligence(options)` — host-selected LSP 3.17 client (Content-Length framing); symbols/definitions/references/diagnostics/hover/rename; lazy spawn; `ERR_PRISM_LSP_*`; frozen `DEFAULT_MAX_LSP_*` / `HARD_MAX_LSP_*` caps.
- `createProcessSessions(options)` — managed process sessions (start/output/input/wait/signal/kill/release); optional sandbox `startProcess` backend + `reconcile`/sandbox-loss → `unknown`; ownership/identity + expiry sweep; `CodingProcessEvent`; `ERR_PRISM_PROCESS_*`; frozen `DEFAULT_MAX_PROCESS_*` / `HARD_MAX_PROCESS_*` caps; `OutputAccumulator.readRaw` for cursor paging.
- `CreateGitHubForgeOptions.fetch?` — host-injectable fetch (defaults to `globalThis.fetch`); enables routing forge traffic through an egress proxy and mock-fetch tests.

## [0.0.25] - 2026-08-06

### Added
- `ask_user_decision` durable elicitation hook maps onto shared pending decisions (blocking `ask()` unchanged for process-local path).

### Changed
- Released with exact 0.0.25 graph.

See [migration guide](../../docs/migration.md) for the 0.0.24 → 0.0.25 notes.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Released with exact 0.0.23 graph.

## [0.0.22] - 2026-07-31

### Changed
- Released with exact 0.0.22 graph.

## [0.0.21] - 2026-07-31

### Added
- `repo_search` `outputMode` (`content` | `files_with_matches` | `count`).
- Bounded `glob` tool (`*`/`?`/`**`; no brace expansion).
- Optional session-scoped `requireReadBeforeWrite` + `ReadPathSet` + `force` on write/edit.
- Bounded `delete` (file or empty dir) and `move` tools with dual-path mutation queue.

### Changed
- `createCodingTools` returns 9 tools; `createReadOnlyTools` returns 4 (includes `glob`).

## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.

## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- `repo_search` is literal-only: `mode: "regex"` removed from the tool schema; `compileSearchPattern` no longer compiles `RegExp` (ReDoS mitigation).
- Default `write`/`edit` local `writeFile` uses same-directory temp + `rename` for crash-safe replacement.

## [0.0.17] - 2026-07-29

### Added
- `ShellToolOptions.envAllowlist` restricts the environment the spawn hook and child process see (secret scrubbing without re-implementing the hook).

### Changed
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Docs

- Documented ask_user_decision multi/free-text/suspend glue + `runCodingGoalVerify` in `docs/coding-agent-tools.md` / README.

### Added

- `runCodingGoalVerify` / `createCodingGoalVerifyWorkflow`: thin goal→verify composition over plan Markdown, named checks, workflow suspend/approve, and bounded PR handoff (peer `@arnilo/prism-workflows`). No Goal table / second runtime.
- Opt-in `createAskUserDecisionTool({ ask })`: model proposes 2+ options with exactly 3 pros + 3 cons each; host `ask` returns `selectedId` / `selectedIds` / `customText`. Supports `selectionMode: "single" | "multiple"` and `allowCustom` (custom XOR selection; default/hard custom bytes match question caps). Not in `createCodingTools` / `createAllTools` / `createReadOnlyTools`.
- Durable ask-user helpers: `suspendAskUserDecision`, `createAskUserDecisionResumeValidator`, `validateAskUserDecisionResume`, `validateAskUserDecisionAgentResume` (workflow-first; agent path reuses same validator without new `AgentRunInterruption` kinds).

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

### Notes

- Sandbox composition / workspace-mode contract lives in `@arnilo/prism-coding-security` (required `workspaceMode`, same-tree Git via `createGitTools(composition.workspaceRoot, { execFile })`). Coding-agent tool surfaces unchanged for 0.0.10.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Added bounded native `repo_list` / `repo_search` tools with streaming walks, literal/regex search, finite depth/entry/match/scan/time caps, and pluggable `RepositoryOperations`.
- `createCodingTools()` / `createAllTools()` now include list/search; `createReadOnlyTools()` deliberately expands to `read` + `repo_list` + `repo_search`.
- Added opt-in structured Git tools via `createGitTools()` / `createGitOperations()`: status (porcelain v2), bounded diff, branch validate/create/switch, worktree add/list/remove, patch check/apply/reverse with rollback, explicit-path commit (host `commitIdentity`), and bounded PR handoff artifacts. Named `coding_check` runs host-declared executables only. Git uses argument arrays with hooks/credential prompts/external diff disabled and never pushes.
- Added bounded durable coding-plan/checkpoint helpers (`writeCodingPlanFile`, `buildCodingCheckpointMetadata`, `assertCodingResumeAllowed`, `fingerprintJson`) so hosts compose plans/todos/background resume from existing workflow primitives without a second runtime.
- Added network-free adversarial evaluation fixtures (`eval-fixtures.test.ts`) grading safe native list vs shell, Git injection, dirty-tree rollback, named-check failure, PR-handoff artifacts, and prompt-injection file content via `@arnilo/prism-evals`.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

### Added

- Finite validated defaults/hard caps for text scans, image/file/input/edit counts, shell wall time, display output, and total shell output.
- Exported coding limit constants plus bounded `ReadOperations.readText` page contracts.

### Changed

- Text reads stream one bounded page instead of loading the entire file; edit/image reads use a shared bounded file reader after stat checks.
- Shell defaults to a 600-second timeout, kills the operation at 64 MiB combined output, and creates exclusive Unix `0600` spill files.
- Failed/aborted/timed-out/output-limited shell calls delete unpublished spill files; successful truncated output remains host-owned at `metadata.fullOutputPath`.
- Custom `ReadOperations` now require `readText` and `statFile`; custom `EditOperations` require `statFile` and receive byte/signal options.
- Removed non-exported filesystem edit-preview helpers that duplicated the edit tool's file read path.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.

## [0.0.4] - 2026-07-14

### Added

- `read` tool image bounds: `maxImageBytes` (default 10 MB), optional `transformImage` callback, `DEFAULT_MAX_IMAGE_BYTES`, and `ReadOperations.statFile` for stat-first rejection.

### Changed

- Shell tools expose `exclusive: true`; all coding tools can apply host `ExecutionPolicy` checks before side effects.
- `autoResizeImages` on `read` is deprecated; it is ignored unless `transformImage` is also provided.
- Image read metadata now includes `image.bytes` and `image.resized` reflects whether `transformImage` ran.

## [0.0.3] - 2026-07-08

### Added

- Initial release of `@arnilo/prism-coding-agent`: first-party optional coding tools package for Prism.
- `shell` tool: run host shell commands with bounded output, timeout, abort support, and cross-platform process-tree cleanup.
- `read` tool: read text files with offset/limit/continuation and truncation, or read supported image files (PNG/JPEG/GIF/WebP/BMP) as `ImageContent`.
- `write` tool: create or overwrite files, creating parent directories as needed, with UTF-8 byte-correct confirmation.
- `edit` tool: precise exact-then-fuzzy text replacement in existing files, returning diff/patch metadata.
- Aggregator factories: `createCodingTools`, `createReadOnlyTools`, `createAllTools`.
- Pluggable operation backends for every tool (`BashOperations`, `ReadOperations`, `WriteOperations`, `EditOperations`).
- Behavioral ports of pi coding-agent primitives: `truncate`, `edit-diff`, `path-utils`, `output-accumulator`, `file-mutation-queue`.
- Runtime dependency on `diff` for unified patch generation; otherwise Node standard library only.
