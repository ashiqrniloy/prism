# Coding agent tools (first-party package)

## What it does

`@arnilo/prism-coding-agent` is an optional first-party package that provides host shell/filesystem/repository tools as Prism `ToolDefinition` objects. It ships six default coding tools — `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search` — plus opt-in structured Git/check set (`createGitTools`), opt-in `createAskUserDecisionTool({ ask })`, and bounded coding-plan/checkpoint helpers. The tools are **inert** until a host imports them and registers them into a `ToolRegistry`. Hosts may register any subset, omit aggregators entirely, or mix first-party tools with host-owned `ToolDefinition`s. Behavior for shell/read/write/edit is a behavioral port of the pi coding agent's tools, adapted to Prism's `ToolDefinition` / `ToolResult` contracts (no `@earendil-works/*` or `typebox` dependencies; only `diff` plus the Node standard library). List/search/Git are native Prism tools with no glob/ripgrep/Git-library dependency.

| Export | Purpose |
| --- | --- |
| `createShellTool(cwd, options?)` | `shell` tool: run a shell command and return combined output + exit code. |
| `createReadTool(cwd, options?)` | `read` tool: read a text or image file into `TextContent` / `ImageContent`. |
| `createWriteTool(cwd, options?)` | `write` tool: create or overwrite a file, creating parent directories. |
| `createEditTool(cwd, options?)` | `edit` tool: precise exact-then-fuzzy text replacement in an existing file. |
| `createRepoListTool(cwd, options?)` | `repo_list` tool: bounded deterministic repository listing. |
| `createRepoSearchTool(cwd, options?)` | `repo_search` tool: bounded literal/regex text search. |
| `createCodingTools(cwd, options?)` | Default six tools (`shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`). |
| `createReadOnlyTools(cwd, options?)` | Read-only subset: `read`, `repo_list`, `repo_search`. |
| `createAllTools(cwd, options?)` | Identical to `createCodingTools` (Git tools remain opt-in via `createGitTools`). |
| `createGitTools(cwd, options?)` | Opt-in Git tools (`git_status`/`git_diff`/`git_branch`/`git_worktree`/`git_apply`/`git_commit`/`git_pr_handoff`) plus optional `coding_check`. |
| `createCodingCheckTool(cwd, options)` | Named host-declared checks; model selects only a name. |
| `createAskUserDecisionTool(options)` | Opt-in user decision tool (`ask_user_decision`); host supplies `ask` callback. Not in default aggregators. |
| `createLocalRepositoryOperations(limits?)` | Default streaming Node filesystem backend for list/search. |
| `createGitOperations(options)` | Typed Git operations backend (argument arrays, safe config, finite output). |
| `buildCodingCheckpointMetadata` / `validateCodingCheckpointMetadata` / `assertCodingResumeAllowed` | Bounded durable coding-task metadata for workflow `state.coding` (no second runtime). |
| `writeCodingPlanFile` / `readCodingPlanFile` / `createCodingPlanMarkdown` / `parseCodingPlanTodos` | Workspace plan/todo Markdown helpers with finite byte/todo caps and hash verification. |
| `fingerprintJson` / `CODING_STATE_KEY` | Stable tool/policy fingerprints and the shared-state key for coding metadata. |
| `detectSupportedImageMimeType(buf)` / `detectSupportedImageMimeTypeFromFile(path)` | Magic-byte image MIME detection (PNG/JPEG/GIF/WebP/BMP) used by `read`. |
| `DEFAULT_MAX_IMAGE_BYTES` | Default `read` image size ceiling (10 MB). |
| `DEFAULT_*` / `HARD_*` coding limit constants | Published text-scan, image, write/edit, shell, repository, Git, check, handoff, and plan/checkpoint ceilings. |
| `ReadTextOptions` / `ReadTextResult` | Bounded text-page contract required by custom `ReadOperations`. |
| `RepositoryOperations` / `RepositoryLimitOptions` | Pluggable list/search backend and finite caps. |
| `TransformImage` / `TransformImageInput` | Types for the optional `read` `transformImage` callback. |
| `withFileMutationQueue(path, fn)` | Per-path serialization primitive re-exported for hosts. |

Each factory returns a plain `ToolDefinition` (no auto-registration). Register what you need:

```ts
import { createToolRegistry } from "@arnilo/prism";
import { createCodingTools } from "@arnilo/prism-coding-agent";

const tools = createToolRegistry(createCodingTools(process.cwd()));
```

## When to use it

Use this package when a host wants ready-made coding tools for an agent, session, or run, registered explicitly into a `ToolRegistry` and dispatched through the normal Prism tool harness. The tools perform **real** shell and filesystem operations on the host — they are not mocked or sandboxed. Use the individual factories when you need per-tool options or custom operation backends; use the aggregators when you want the default set.

Do not use this package as a sandbox, permission policy, secret store, or provider loop. Prism gates tool dispatch with `PermissionPolicy` / `ToolValidator` / trust policies; pass an optional `ExecutionPolicy` (for example from `@arnilo/prism-coding-security`) for path/command approval before side effects. Do not register these tools for an untrusted provider.

```ts
import { createCodingTools } from "@arnilo/prism-coding-agent";
import { createCodingApprovalPolicy } from "@arnilo/prism-coding-security";

const tools = createCodingTools(workspaceRoot, {
  executionPolicy: createCodingApprovalPolicy({
    roots: [workspaceRoot],
    approve: async ({ action }) => host.confirm(action),
  }),
});
```

### pi name mapping

| Prism (`@arnilo/prism-coding-agent`) | pi coding agent |
| --- | --- |
| `shell` | `bash` |
| `read` | `read` |
| `write` | `write` |
| `edit` | `edit` |
| `repo_list` / `repo_search` | _(native; no pi equivalent)_ |

## Inputs / request

### `shell`

Run a shell command and return combined stdout+stderr.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `command` | `string` | Shell command to execute (required). |
| `timeout` | `number` | Timeout in **seconds** (optional; defaults to 600, hard maximum 3600). |

**Outputs:** a `ToolResult` whose `content[0]` is a `TextContent` with the combined output. Non-zero exit is **not** a tool error: it is returned as a normal result with `[Command exited with code N]` appended to the content and `exitCode` in metadata. Timeout and abort are error results that still carry the partial output captured so far.

`shell` result `metadata`:

| Field | Present when | Purpose |
| --- | --- | --- |
| `exitCode` | always | Process exit code, or `null` when the process was killed by timeout/abort. |
| `truncation` | always | `TruncationResult` from the bounded output accumulator. |
| `fullOutputPath?` | successful and truncated only | Host-owned path to retained output. Failed/aborted/timed-out/output-limited calls remove unpublished spills. |
| `totalOutputBytes` | shell executed | Raw bytes retained, never above `maxTotalOutputBytes`. |
| `outputLimitExceeded` / `outputStorageFailed` | shell executed | Attributable resource failure flags. |

Shell resolution honors `options.shellPath` → `SHELL` env → `/bin/bash` → `sh`. The process group is killed on timeout, caller abort, spill failure, or total-output overflow (`process.kill(-pid)` on Unix, `taskkill /F /T` on Windows). Combined output defaults to a 64 MiB total cap (1 GiB hard cap). Spill files use random exclusive creation and Unix mode `0600`; hosts own and must delete a successful result's `fullOutputPath` after consumption.

### `read`

Read a text or image file.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Path to the file (relative or absolute; `~` and `file://` expanded). Required. |
| `offset` | `number` | Line to start reading from (1-indexed). |
| `limit` | `number` | Maximum number of lines to read. |

**Outputs:** text files are scanned incrementally until one requested page, `maxLines`/`maxBytes`, EOF, or `maxScanBytes` (default 64 MiB scanned per call; 1 GiB hard cap). The default path never loads the complete file and returns a `Use offset=N to continue` footer when more remains. Exact total line count is reported only when EOF was already reached in the bounded scan. Image files (PNG/JPEG/GIF/WebP/BMP by **magic bytes**, not extension) become `[TextContent note, ImageContent]` with base64 `data` and `mimeType`. Oversize images are rejected by `stat` (when available) or `buffer.length` against `maxImageBytes` (default 10 MB) before base64 encoding. An optional `transformImage` callback lets hosts resize or re-encode images without adding image-processing dependencies to the base package. Read failures (missing file, offset beyond end, oversize image, abort) are error results.

`read` tool options (via `createReadTool(cwd, options)` or `ToolsOptions.read`):

| Option | Default | Purpose |
| --- | --- | --- |
| `maxImageBytes` | `DEFAULT_MAX_IMAGE_BYTES` (10 MB) | Reject image reads larger than this many bytes. |
| `transformImage` | — | Host callback `( { buffer, mimeType } ) => Promise<Buffer>` run after read, before base64. |
| `autoResizeImages` | — | **Deprecated.** Ignored unless `transformImage` is also set (use `transformImage` instead). |
| `maxLines` / `maxBytes` | 2000 / 50 KiB | Text page display limits (hard: 100,000 / 1 MiB). |
| `maxScanBytes` | 64 MiB | Raw bytes scanned to reach one page (hard: 1 GiB). |
| `operations` | local fs | Pluggable bounded `ReadOperations` backend. |
| `executionPolicy` | — | Structured pre-execution policy (see [Coding security](coding-security.md)). |

```ts
import { createReadTool, DEFAULT_MAX_IMAGE_BYTES } from "@arnilo/prism-coding-agent";

const read = createReadTool(cwd, {
  maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
  transformImage: async ({ buffer, mimeType }) => host.resizeImage(buffer, mimeType),
});
```

`read` result `metadata`:

| Field | Present when | Purpose |
| --- | --- | --- |
| `truncation` | text reads | `TruncationResult`. |
| `image` | image reads | `{ mimeType, resized, bytes }`. `resized` is `true` when `transformImage` ran. |

> `autoResizeImages` is deprecated. It has no effect without `transformImage`; use `transformImage` for host-owned resizing.

### `write`

Create or overwrite a file, creating parent directories as needed.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Path to the file to write (relative or absolute). Required. |
| `content` | `string` | Content to write (empty string creates an empty file). Required. |

**Outputs:** a `TextContent` confirmation naming the **absolute path** with UTF-8 byte and line counts (e.g. `Successfully wrote 42 bytes (3 lines) to /abs/path.txt`). `maxInputBytes` defaults to 8 MiB (64 MiB hard cap); oversized UTF-8 input fails before policy evaluation, directory creation, or write. Write failures and abort are error results. Empty `content` is valid.

`write` result `metadata`: `{ bytes, lines, path }` (absolute path). Concurrent writes to the same path serialize through `withFileMutationQueue`; writes to different paths run in parallel.

### `edit`

Precise text replacement in an existing file via exact-then-fuzzy matching.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Path to the file to edit. Required. |
| `edits` | `Array<{ oldText: string, newText: string }>` | Targeted replacements, each matched against the **original** file (not incrementally). No overlapping/nested edits. Required, non-empty. |

Each `edits[].oldText` must match a unique, non-overlapping region of the original file. Matching is exact first, then fuzzy (unicode normalization / whitespace collapse). A BOM is stripped before matching and re-prepended on write; original line endings are restored. Defaults reject targets over 8 MiB, aggregate old/new UTF-8 input over 2 MiB, or more than 100 edits (hard caps: 64 MiB, 16 MiB, and 1,000). Stat and bounded read checks run before matching or mutation.

**Outputs:** a `TextContent` confirmation (`Successfully replaced N block(s) in {path}.`) plus `metadata`. Any failure — missing/unreadable file, no match, duplicate (non-unique) match, overlap, empty `oldText`, no-op edit, or abort — is an error result, and the file is left **unchanged** (the match runs before the write).

`edit` result `metadata`: `{ diff, patch, firstChangedLine }` — a display-oriented diff, a standard unified patch, and the first changed line in the new file. These are host-readable; the model only sees the short confirmation (keeps model context small).

### `repo_list`

List repository entries with deterministic relative paths. Uses Node `opendir`/`lstat` only — no glob dependency. Does not follow symlinks; rejects path escapes outside the workspace root. Hidden names and excluded basenames (default `.git`, `node_modules`, `dist`) are skipped unless `includeHidden` is set / host `exclude` is overridden.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Workspace-relative directory or file to list (default root). |
| `includeHidden` | `boolean` | Include dot names (default false). |
| `maxDepth` | `number` | Directory depth cap (default 32, hard 128). |
| `maxResults` | `number` | Page size (default 1,000, hard 10,000). |
| `offset` | `number` | Entries to skip before retaining (default 0). |

**Outputs:** text lines `kind\trelative/path[\tsize]` plus metadata (`truncated`, `truncatedBy`, `nextOffset`, `entries`, scan counts). Continue with `offset=nextOffset` when truncated by results.

### `repo_search`

Search text files under the workspace. Default mode is literal substring match; `mode: "regex"` enables length-bounded regular expressions. Binary files (NUL in a bounded prefix) and oversize files are skipped. Aggregate scanned bytes, matches, line bytes, pattern bytes, and wall time are finite.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `query` | `string` | Literal or regex pattern (required). |
| `path` | `string` | Workspace-relative start path. |
| `mode` | `"literal" \| "regex"` | Default `literal`. |
| `caseSensitive` | `boolean` | Default false. |
| `includeHidden` | `boolean` | Default false. |
| `context` | `number` | Context lines before/after each match (default 5, hard 20). |
| `maxMatches` | `number` | Match cap (default 1,000, hard 10,000). |

**Outputs:** ripgrep-like lines `path:line:column:text` with optional `path-` / `path+` context, plus metadata (`matches`, `truncated`, scan/skip counts).

### Structured Git tools (`createGitTools`)

Opt-in tools over a host-pinned Git executable (`gitPath`, default `/usr/bin/git`) or sandbox `execFile`. Every invocation uses argument arrays with safe config (`core.hooksPath=/dev/null`, empty credential helper, pager disabled, `GIT_TERMINAL_PROMPT=0`). Shell is never used internally. Git tools are **not** included in `createCodingTools()` / `createAllTools()`.

| Tool | Purpose |
| --- | --- |
| `git_status` | `status --porcelain=v2 -z --branch` → structured branch + entries + `dirty`. |
| `git_diff` | Bounded `--no-ext-diff --no-textconv` diff; oversized output may spill via `artifactWriter`. |
| `git_branch` | `validate` / `list` / `create` / `switch` with `git check-ref-format --branch`. Switch refuses unrelated dirty trees unless `createCheckpoint=true`. |
| `git_worktree` | `list` / `add` / `remove` within finite worktree caps. |
| `git_apply` | `check` / `apply` / `reverse`; always `--check` before mutating apply. Apply requires clean/checkpoint; failures restore. |
| `git_commit` | Explicit-path `add` + `commit --no-verify -F <tempfile>`; requires host `commitIdentity`. Allows dirty entries that are exactly the requested paths; unrelated dirt requires checkpoint. Never pushes. |
| `git_pr_handoff` | Bounded `{ base, head, commits, changedPaths, diffstat, checks, artifact? }` for host PR creation. Never authenticates or opens a PR. |
| `coding_check` | Included when `checks` are declared: model selects only a name; executable/args/env are host-fixed. |

```ts
import { createGitTools } from "@arnilo/prism-coding-agent";

const gitTools = createGitTools(workspaceRoot, {
  gitPath: "/usr/bin/git",
  commitIdentity: { name: "Prism Bot", email: "bot@example.com" },
  checks: {
    test: { file: "/usr/bin/npm", args: ["test"] },
  },
});
```

### Ask-user decision (`createAskUserDecisionTool`)

Opt-in `ask_user_decision` for ambiguous, high-impact direction choices. Model must pass a question plus 2+ options, each with **exactly 3 pros and 3 cons**. Host supplies `ask` (blocks until the user picks). Not in `createCodingTools` / `createAllTools` / `createReadOnlyTools`.

| Mode | How |
| --- | --- |
| Single (default) | `selectionMode: "single"` → host returns `{ selectedId }` (or length-1 `selectedIds`) |
| Multi | `selectionMode: "multiple"` → `{ selectedIds: [...] }` (non-empty, known ids) |
| Free-text | `allowCustom: true` → host may return `{ customText }` **XOR** selection (never both) |
| Blocking tool | `createAskUserDecisionTool({ ask })` — in-process UI callback |
| Durable workflow | `suspendAskUserDecision(request)` + `createAskUserDecisionResumeValidator()` / `validateAskUserDecisionResume` on `resumeWorkflow` |
| Agent durable adapter | `validateAskUserDecisionAgentResume({ request, answer })` — same validation; **no** new `AgentRunInterruption` kinds in 0.0.11 |

Custom-text caps match question defaults (2 KiB / hard 8 KiB). Options default max 6 (hard 16).

```ts
import { createToolRegistry } from "@arnilo/prism";
import {
  createAskUserDecisionTool,
  createCodingTools,
  suspendAskUserDecision,
  createAskUserDecisionResumeValidator,
} from "@arnilo/prism-coding-agent";

const tools = createToolRegistry([
  ...createCodingTools(workspaceRoot),
  createAskUserDecisionTool({
    ask: async ({ question, options, selectionMode, allowCustom }) =>
      ui.ask({ question, options, selectionMode, allowCustom }),
  }),
]);

// Workflow node:
return suspendAskUserDecision({
  question: "Ship sqlite or postgres?",
  options: [/* ≥2 with 3 pros + 3 cons each */],
  selectionMode: "single",
  allowCustom: false,
});
// resumeWorkflow(..., { validateResume: createAskUserDecisionResumeValidator() })
```

### Goal → verify helper (`runCodingGoalVerify`)

Thin composition over existing plan Markdown, named checks, workflow `suspend`/`resumeWorkflow`, and bounded PR handoff. **No Goal table / second runtime.** Peer `@arnilo/prism-workflows`. Example: `examples/coding-goal-verify.ts`.

```ts
import { runCodingGoalVerify } from "@arnilo/prism-coding-agent";

const result = await runCodingGoalVerify({
  goal: "Fix the flake",
  cwd: process.cwd(),
  taskId: "flake-1",
  baseBranch: "main",
  branch: "fix/flake",
  checkNames: ["test"],
  checkDefinitions: { test: { file: "/usr/bin/npm", args: ["test"] } },
  runCheck: hostRunCheck,
  buildHandoff: hostBuildHandoff,
  approval: { validateResume: hostValidate },
  checkpoints,
  ownership,
  redactor,
});
```

### Durable coding plans and checkpoints

There is no `CodingRun`, todo database, or second approval engine. Persist executable plan/todos as ordinary workspace Markdown (for example `plans/<task>.md`) and store only bounded metadata under workflow `state.coding`:

| Field group | Stored in checkpoint | Not stored |
| --- | --- | --- |
| Plan / workspace export / patch artifacts | URI + SHA-256 + byte count | File contents, credentials, raw command output |
| Branch / worktree / base | Paths and ref names | Full diffs |
| Named checks | Name + exit code + short summary | Full stdout/stderr |
| Fingerprints | Workflow revision, definition hash, tool/policy fingerprints, optional image digest | Browser storage state, secrets, env |

Use `writeCodingPlanFile` / `readCodingPlanFile` for the workspace artifact, `buildCodingCheckpointMetadata` before `ctx.updateState({ coding })`, and `assertCodingResumeAllowed` before import/resume. Wrong owner/revision/hash/fingerprint fails closed. See `examples/durable-coding-workflow.ts` for a network-free plan → branch → edit → check → approval → handoff composition over `runWorkflow` / `resumeWorkflow` / `startWorkflowBackground`.

## Outputs / response / events

Every tool returns a `ToolResult` with `toolCallId`, `name`, `content` (`readonly ContentBlock[]`), optional `error`, and optional `metadata`. `write` and `edit` serialize per realpath through `withFileMutationQueue` so concurrent calls targeting one file do not interleave. `shell` is marked `exclusive`; tool dispatch serializes it at the turn level. The package emits no events of its own; hosts observe tool execution through the normal Prism `AgentEvent` stream via `dispatchToolCall`.

## Request/response example

```json
// edit request
{ "path": "src/app.ts", "edits": [{ "oldText": "const x = 1;", "newText": "const x = 2;" }] }
```

```json
// edit success result
{
  "toolCallId": "call_1",
  "name": "edit",
  "content": [{ "type": "text", "text": "Successfully replaced 1 block(s) in src/app.ts." }],
  "metadata": { "diff": "...", "patch": "--- src/app.ts\n+++ src/app.ts\n...", "firstChangedLine": 3 }
}
```

```json
// edit no-match result (file unchanged)
{
  "toolCallId": "call_2",
  "name": "edit",
  "error": { "message": "Could not find edits[0] in src/app.ts. The oldText must match exactly including all whitespace and newlines." }
}
```

## Implementation example

Minimal drop-in for any Prism app:

```ts
import { createToolRegistry } from "@arnilo/prism";
import { createCodingTools, createReadOnlyTools } from "@arnilo/prism-coding-agent";

// Full coding set (shell + read + write + edit + repo_list + repo_search) against the project root:
const tools = createToolRegistry(createCodingTools(process.cwd()));

// Or a read-only set for inspection-only agents (read + repo_list + repo_search):
const ro = createToolRegistry(createReadOnlyTools(process.cwd()));
```

Customizing a single tool (force bash, cap output, delegate writes to a remote backend):

```ts
import { createShellTool, createWriteTool } from "@arnilo/prism-coding-agent";

const shell = createShellTool("/repo", {
  shellPath: "/bin/bash",
  commandPrefix: "set -euo pipefail",
  maxLines: 500,
  timeout: 600,
  maxTotalOutputBytes: 64 * 1024 * 1024,
});

const remoteWrite = createWriteTool("/repo", {
  operations: {
    writeFile: async (abs, content) => { /* ship to remote */ },
    mkdir: async (dir) => { /* mkdir -p remotely */ },
  },
});
```

## Extension and configuration notes

- **Long coding sessions.** Use `createCodingCompactionStrategy()` from optional `@arnilo/prism-compaction-llm` when history needs a bounded coding handoff. It is selected explicitly through normal `session.compact()` / agent compaction configuration, preserves raw session entries, and prioritizes file paths, patch intent, checks, plan/todo state, blockers, and verification steps. It does not read files, retain full diffs, or create a second coding runtime.
- **Pluggable operation backends.** Every tool accepts an `operations` seam. Custom `ReadOperations` must implement bounded `readText` plus `statFile`; custom `EditOperations` must implement `statFile`; read/write methods receive caps/signals. `BashOperations` must stream through `onData` and honor `signal`/`timeout`. Custom `RepositoryOperations` must honor depth/entry/file/match/scan/time caps and abort. A hostile custom backend can still violate its host-owned contract, so isolate it separately.
- **Per-tool options.** `ShellToolOptions` adds `timeout` and `maxTotalOutputBytes`; `ReadToolOptions` adds `maxScanBytes`; `WriteToolOptions` adds `maxInputBytes`; `EditToolOptions` adds `maxFileBytes`, `maxInputBytes`, and `maxEdits`; list/search accept `repository` limits and shared aggregator `ToolsOptions.repository`.
- **Aggregator options.** `ToolsOptions` (`{ executionPolicy?, shell?, read?, write?, edit?, list?, search?, repository? }`) threads each sub-object to the matching tool. `createCodingTools()`, `createAllTools()`, and `createReadOnlyTools()` apply the shared policy unless that tool has an explicit per-tool override. Read-only membership is deliberately `read` + `repo_list` + `repo_search` (0.0.9 behavior change).
- **Sandbox composition.** Prefer `@arnilo/prism-coding-security` `createSandboxCodingComposition(cwd, { workspaceMode, sandbox, ... })` (or tools-only wrappers). `workspaceMode` is required: `"sandbox"` keeps shell/read/write/edit/list/search on one disposable tree; `"host"` runs against host cwd and never claims containment. Mixed sandbox-shell + host-FS wiring throws unless `allowMixedWorkspaceWiring: true`. Same-tree Git: `createGitTools(composition.workspaceRoot, { execFile: sandbox.execFile, commitIdentity })`.
- **`ToolsOptions`** and the per-tool option types are exported from the package barrel for host configuration.
- No auto-discovery or manifest registration: import and register explicitly. This package registers no extensions and owns no globals (the mutation queue is a process-wide per-path map — see `ponytail:` note in the source).

## Security and performance notes

- **Host shell/filesystem access.** These tools run real commands and read/write/list/search real files. They provide **no sandbox**. Gate them with Prism `PermissionPolicy` / `ToolValidator` / trust policies before registering them for any provider turn. Shared `executionPolicy` applies to both full and read-only aggregators before filesystem/process side effects. See [Host security guide](host-security.md) and [Security/auth/trust](settings-auth-trust-security.md).
- **Non-zero exit is not an error.** A failing command is a normal `shell` result (exit code in metadata); only timeout/abort/spawn failures are error results. Do not assume `error == undefined` means the command succeeded.
- **Bounded I/O.** `read` streams one page and bounds scan bytes; image/edit reads use stat plus a shared cap-enforcing reader; write/edit inputs are measured before mutation. `repo_list`/`repo_search` stream walks and charge depth/entry/file/match/scan/time before retention. Structured Git tools use argument arrays with finite output/path/ref/message/patch caps, disable hooks/credential prompts/external diff by default, and never push or open PRs. `shell` retains only a rolling display tail and synchronously spills accepted raw chunks so stream backpressure cannot grow heap; wall time and total raw output remain finite.
- **Per-path serialization.** Concurrent mutations to the same file serialize; concurrent mutations to different files do not block each other. The queue is a process-wide map — across sessions in one process, same-path writes still serialize (upgrade path: scope per registry if throughput matters).
- **Bounded image reads.** `read` rejects images over `maxImageBytes` (default 10 MB) by `stat` before read when possible; MIME is detected from magic bytes only. Optional `transformImage` is host-owned — the base package has no image-processing dependency.

### Resource-limit defaults and hard caps

| Boundary | Default | Hard cap | Failure point |
| --- | ---: | ---: | --- |
| Display lines / bytes | 2,000 / 50 KiB | 100,000 / 1 MiB | tool construction |
| Text scan per read | 64 MiB | 1 GiB | bounded scan before more input is retained |
| Image | 10,000,000 bytes | 32 MiB | stat and bounded read before base64/transform result use |
| Write UTF-8 input | 8 MiB | 64 MiB | before policy/filesystem mutation |
| Edit target / input / count | 8 MiB / 2 MiB / 100 | 64 MiB / 16 MiB / 1,000 | before target read/matching/write |
| Shell wall time | 600 seconds | 3,600 seconds | process-tree kill |
| Shell total stdout+stderr | 64 MiB | 1 GiB | process-tree kill; spill removal |
| Repo depth / entries / files / page | 32 / 10,000 / 10,000 / 1,000 | 128 / 100,000 / 100,000 / 10,000 | before descending/retaining next entry |
| Search scan / file / matches | 64 MiB / 8 MiB / 1,000 | 1 GiB / 64 MiB / 10,000 | before next file/match retention |
| Search pattern / line / context / time | 512 B / 50 KiB / 5 / 30 s | 4 KiB / 1 MiB / 20 / 300 s | before regex compile / line retain / deadline |
| Git paths / refs / message | 1,000 / 1 KiB / 64 KiB | 10,000 / 4 KiB / 256 KiB | before process/temp-file creation |
| Git output / diff lines / changed files / patch | 4 MiB / 10,000 / 1,000 / 16 MiB | 64 MiB / 100,000 / 10,000 / 64 MiB | stream before retain; artifact spill optional |
| Worktrees | 4 | 16 | before add |
| Named checks (names / concurrency / time / lines / output) | 8 / 1 / 10 min / 2,000 / 4 MiB | 32 / 4 / 60 min / 100,000 / 64 MiB | construction / before start / line retention |
| PR handoff JSON / commits | 256 KiB / 100 | 1 MiB / 1,000 | before result exposure |
| Plan markdown / todos / todo text | 256 KiB / 1,000 / 512 B | 1 MiB / 10,000 / 4 KiB | before write/parse/checkpoint |
| Coding checkpoint metadata / artifact refs / artifact bytes | 64 KiB / 16 / 256 MiB | 512 KiB / 64 / 2 GiB | before state save / resume verify |
| Check summary text | 1 KiB | 8 KiB | before checkpoint retention |

Every configurable value is a positive safe integer (context may be zero); Prism rejects rather than clamps invalid values. Limits control resources, not authority: they do not replace root containment, approval, validation, or a sandbox.

## Related APIs

- [Tools](tools.md): the host-owned tool harness — `createToolRegistry`, `dispatchToolCall`, filtering, and the `ToolDefinition` contract these factories satisfy.
- [Public contracts](public-contracts.md): `ToolDefinition`, `ToolResult`, `ToolExecutionContext`, `ContentBlock`, and `JsonObject` shapes.
- [Host security guide](host-security.md): fail-closed checklist for permission policies, tool validation, and trust boundaries that must gate these tools.
- [Tool conformance](tool-conformance.md): assertions for the tool-dispatch blocked-reason matrix these tools participate in.
- [LLM compaction package](compaction-llm.md): optional `createCodingCompactionStrategy()` retains bounded paths, patch intent, checks, plan/todo state, blockers, and next verification—not complete diffs or raw command output.
