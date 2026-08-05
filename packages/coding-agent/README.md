# @arnilo/prism-coding-agent

Optional first-party coding tools package for [Prism](https://www.npmjs.com/package/@arnilo/prism). Provides host shell/filesystem/repository tools — `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move` — plus opt-in structured Git/check tools via `createGitTools()`, opt-in `createAskUserDecisionTool({ ask })` (durable runs surface as shared elicitation decisions), and durable plan/checkpoint helpers for workflow composition — as Prism `ToolDefinition` objects. **Inert until a host imports it and registers the tools into a `ToolRegistry`.** No tool is auto-registered; hosts pick factories (or filter aggregator output) and may mix in their own `ToolDefinition`s.

Behavior is a behavioral port of the pi coding agent's `bash`/`read`/`write`/`edit` tools, adapted to Prism's `ToolDefinition` / `ToolResult` contracts (no `@earendil-works/*` or `typebox` dependencies). List/search/glob/Git are native Prism tools (hand-rolled glob; no picomatch/ripgrep).

> ⚠️ **These tools perform real shell and filesystem operations on the host. They provide no sandbox.** Gate them with Prism `PermissionPolicy` / `ToolValidator` / trust policies before registering them for any provider turn. For disposable sandbox composition with required `workspaceMode`, use `@arnilo/prism-coding-security` (`createSandboxCodingComposition`). See the [coding agent tools docs](https://github.com/ashiqrniloy/prism/blob/main/docs/coding-agent-tools.md) and the [host security guide](https://github.com/ashiqrniloy/prism/blob/main/docs/host-security.md).

## Install

```sh
npm install @arnilo/prism-coding-agent
```

`@arnilo/prism` is a peer dependency. `runCodingGoalVerify` also peers `@arnilo/prism-workflows`.

## Usage

Register the full coding set (nine tools):

```ts
import { createToolRegistry } from "@arnilo/prism";
import { createCodingTools } from "@arnilo/prism-coding-agent";

const tools = createToolRegistry(createCodingTools(process.cwd()));
```

Read-only subset (inspection-only agents — includes `glob`):

```ts
import { createReadOnlyTools } from "@arnilo/prism-coding-agent";

const tools = createToolRegistry(createReadOnlyTools(process.cwd()));
```

Shared `ToolsOptions.executionPolicy` applies to every tool returned by full, all, and read-only aggregators unless a per-tool policy overrides it.

Individual tools with options:

```ts
import {
  createShellTool,
  createWriteTool,
  createAskUserDecisionTool,
  createReadPathSet,
  createReadTool,
  createEditTool,
} from "@arnilo/prism-coding-agent";

const shell = createShellTool(process.cwd(), {
  shellPath: "/bin/bash",        // force bash; default: SHELL env → /bin/bash → sh
  commandPrefix: "set -euo pipefail",
  maxLines: 500,
  timeout: 600,
  maxTotalOutputBytes: 64 * 1024 * 1024,
});

const remoteWrite = createWriteTool(process.cwd(), {
  operations: {
    writeFile: async (abs, content) => { /* ship to remote */ },
    mkdir: async (dir) => { /* mkdir -p remotely */ },
  },
});

// Optional soft guard: share one ReadPathSet across read/write/edit.
const readPaths = createReadPathSet();
const read = createReadTool(process.cwd(), { readPathSet: readPaths });
const write = createWriteTool(process.cwd(), { requireReadBeforeWrite: true, readPathSet: readPaths });
const edit = createEditTool(process.cwd(), { requireReadBeforeWrite: true, readPathSet: readPaths });

// Opt-in: not in createCodingTools(). Host owns the UI.
const askUser = createAskUserDecisionTool({
  ask: async ({ question, options }) => {
    const selectedId = await host.promptChoice(question, options);
    return { selectedId };
  },
});
```

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `shell` | `{ command, timeout? }` | Combined output + `metadata.exitCode`; 600-second default timeout and 64 MiB total-output cap. Non-zero exit is **not** an error. Prefer dedicated tools when they fit. |
| `read` | `{ path, offset?, limit? }` | Streamed bounded text page or bounded `[note, ImageContent]`. Continue with suggested offset when truncated. |
| `write` | `{ path, content, force? }` | Full overwrite; bounded UTF-8 input; optional read-before-write. |
| `edit` | `{ path, edits: [{oldText,newText}], force? }` | Exact-then-fuzzy replace; **fuzzy may succeed silently** — prefer exact `oldText`; duplicates fail closed. |
| `repo_list` | `{ path?, includeHidden?, maxDepth?, maxResults?, offset? }` | Deterministic relative entries; paginates with `nextOffset`. Prefer `glob` for patterns. |
| `repo_search` | `{ query, path?, mode?, caseSensitive?, includeHidden?, context?, maxMatches?, outputMode? }` | Literal search; `outputMode`: `content` \| `files_with_matches` \| `count`. |
| `glob` | `{ pattern, path?, includeHidden?, maxDepth?, maxResults?, offset? }` | Filename match (`*`/`?`/`**`; no braces). Files only. |
| `delete` | `{ path }` | High-risk: file or empty dir only; **no trash**. |
| `move` | `{ from, to, overwrite? }` | High-risk rename/move; `overwrite` default false; **no trash**. |
| `git_*` / `coding_check` | via `createGitTools(cwd, { commitIdentity, checks? })` | Opt-in structured Git + named checks. Not in `createCodingTools()`. |
| `ask_user_decision` | via `createAskUserDecisionTool({ ask })` | Opt-in user choice. Not in default aggregators. |

### pi name mapping

| Prism | pi |
| --- | --- |
| `shell` | `bash` |
| `read` / `write` / `edit` | `read` / `write` / `edit` |
| `repo_list` / `repo_search` / `glob` / `delete` / `move` | _(native; no pi equivalent shipped)_ |

### Phase 4 non-goals

No PDF reader, trash daemon, PTY, or LSP tools in 0.0.21. See [coding agent tools docs](https://github.com/ashiqrniloy/prism/blob/main/docs/coding-agent-tools.md).

## Exports

Factories: `createShellTool`, `createReadTool`, `createWriteTool`, `createEditTool`, `createRepoListTool`, `createRepoSearchTool`, `createGlobTool`, `createDeleteTool`, `createMoveTool`, `createCodingTools`, `createReadOnlyTools`, `createAllTools`, `createGitTools`, `createCodingCheckTool`, `createAskUserDecisionTool`, `createLocalBashOperations`, `createLocalRepositoryOperations`, `createGitOperations`, `createReadPathSet`.

Helpers: `detectSupportedImageMimeType`, `detectSupportedImageMimeTypeFromFile`, `getShellConfig`, `killProcessTree`, `waitForChildProcess`, `withFileMutationQueue`, `resolveRepositoryLimits`, `matchGlobPattern`, `validateGlobPattern`, `writeCodingPlanFile`, `readCodingPlanFile`, `buildCodingCheckpointMetadata`, `validateCodingCheckpointMetadata`, `assertCodingResumeAllowed`, `fingerprintJson`, `runCodingGoalVerify`, `createCodingGoalVerifyWorkflow`, `suspendAskUserDecision`, `createAskUserDecisionResumeValidator`, `validateAskUserDecisionResume`, `validateAskUserDecisionAgentResume`. Default/hard coding, repository, Git, and plan/checkpoint limit constants are exported for host configuration.

Option/operation types: `ToolsOptions`, `ShellToolOptions`/`BashOperations`, `ReadToolOptions`/`ReadOperations`/`ReadTextOptions`/`ReadTextResult`, `WriteToolOptions`/`WriteOperations`, `EditToolOptions`/`EditOperations`/`EditToolDetails`, `DeleteToolOptions`/`DeleteOperations`, `MoveToolOptions`/`MoveOperations`, `GlobToolOptions`, `ReadPathSet`.

Text reads stop after one page or `maxScanBytes` instead of loading the file. Custom `ReadOperations` must implement bounded `readText` and `statFile`; custom `EditOperations` must implement `statFile` and honor the supplied read cap/signal. Successful truncated shell output is retained in an exclusive Unix `0600` temp file owned by the host; timeout, abort, output-limit, and spill failures remove unpublished spill files. Hosts should delete published `metadata.fullOutputPath` files after use.

Network-free adversarial evaluation fixtures live in `src/__tests__/eval-fixtures.test.ts` and reuse `@arnilo/prism-evals` for CI thresholds. See `examples/coding-browser-evaluation.ts`, `examples/coding-tools-capability-gaps.ts`, and `docs/evaluations.md`.

## License

MIT
