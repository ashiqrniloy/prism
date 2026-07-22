# @arnilo/prism-coding-agent

Optional first-party coding tools package for [Prism](https://www.npmjs.com/package/@arnilo/prism). Provides host shell/filesystem/repository tools — `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search` — plus opt-in structured Git/check tools via `createGitTools()`, opt-in `createAskUserDecisionTool({ ask })`, and durable plan/checkpoint helpers for workflow composition — as Prism `ToolDefinition` objects. **Inert until a host imports it and registers the tools into a `ToolRegistry`.** No tool is auto-registered; hosts pick factories (or filter aggregator output) and may mix in their own `ToolDefinition`s.

Behavior is a behavioral port of the pi coding agent's `bash`/`read`/`write`/`edit` tools, adapted to Prism's `ToolDefinition` / `ToolResult` contracts (no `@earendil-works/*` or `typebox` dependencies). List/search/Git are native Prism tools.

> ⚠️ **These tools perform real shell and filesystem operations on the host. They provide no sandbox.** Gate them with Prism `PermissionPolicy` / `ToolValidator` / trust policies before registering them for any provider turn. For disposable sandbox composition with required `workspaceMode`, use `@arnilo/prism-coding-security` (`createSandboxCodingComposition`). See the [coding agent tools docs](https://github.com/ashiqrniloy/prism/blob/main/docs/coding-agent-tools.md) and the [host security guide](https://github.com/ashiqrniloy/prism/blob/main/docs/host-security.md).

## Install

```sh
npm install @arnilo/prism-coding-agent
```

`@arnilo/prism` is a peer dependency. `runCodingGoalVerify` also peers `@arnilo/prism-workflows`.

## Usage

Register the full coding set:

```ts
import { createToolRegistry } from "@arnilo/prism";
import { createCodingTools } from "@arnilo/prism-coding-agent";

const tools = createToolRegistry(createCodingTools(process.cwd()));
```

Read-only subset (inspection-only agents):

```ts
import { createReadOnlyTools } from "@arnilo/prism-coding-agent";

const tools = createToolRegistry(createReadOnlyTools(process.cwd()));
```

Shared `ToolsOptions.executionPolicy` applies to every tool returned by full, all, and read-only aggregators unless a per-tool policy overrides it.

Individual tools with options:

```ts
import { createShellTool, createWriteTool, createAskUserDecisionTool } from "@arnilo/prism-coding-agent";

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
| `shell` | `{ command, timeout? }` | Combined output + `metadata.exitCode`; 600-second default timeout and 64 MiB total-output cap. Non-zero exit is **not** an error. |
| `read` | `{ path, offset?, limit? }` | Streamed bounded text page or bounded `[note, ImageContent]`. |
| `write` | `{ path, content }` | Bounded UTF-8 input; `Successfully wrote N bytes (M lines) to <abs>`. |
| `edit` | `{ path, edits: [{oldText,newText}] }` | Bounded target/input/count; `Successfully replaced N block(s)` + diff metadata. |
| `repo_list` | `{ path?, includeHidden?, maxDepth?, maxResults?, offset? }` | Deterministic relative entries; skips hidden/excluded basenames; does not follow symlinks; paginates with `nextOffset`. |
| `repo_search` | `{ query, path?, mode?, caseSensitive?, includeHidden?, context?, maxMatches? }` | Literal (default) or bounded regex matches with context; skips binary/excluded paths; finite scan/match/time caps. |
| `git_*` / `coding_check` | via `createGitTools(cwd, { commitIdentity, checks? })` | Opt-in structured Git status/diff/branch/worktree/apply/commit/PR-handoff and named checks. Not in `createCodingTools()`. |
| `ask_user_decision` | via `createAskUserDecisionTool({ ask })` | Opt-in user choice: question + options (3 pros/3 cons); `selectionMode` single\|multiple; `allowCustom` for XOR free-text; host `ask` returns `selectedId` / `selectedIds` / `customText`. Durable: `suspendAskUserDecision` + resume validators. Not in default aggregators. |

### pi name mapping

| Prism | pi |
| --- | --- |
| `shell` | `bash` |
| `read` / `write` / `edit` | `read` / `write` / `edit` |
| `repo_list` / `repo_search` | _(native; no pi equivalent shipped)_ |

## Exports

Factories: `createShellTool`, `createReadTool`, `createWriteTool`, `createEditTool`, `createRepoListTool`, `createRepoSearchTool`, `createCodingTools`, `createReadOnlyTools`, `createAllTools`, `createGitTools`, `createCodingCheckTool`, `createAskUserDecisionTool`, `createLocalBashOperations`, `createLocalRepositoryOperations`, `createGitOperations`.

Helpers: `detectSupportedImageMimeType`, `detectSupportedImageMimeTypeFromFile`, `getShellConfig`, `killProcessTree`, `waitForChildProcess`, `withFileMutationQueue`, `resolveRepositoryLimits`, `writeCodingPlanFile`, `readCodingPlanFile`, `buildCodingCheckpointMetadata`, `validateCodingCheckpointMetadata`, `assertCodingResumeAllowed`, `fingerprintJson`, `runCodingGoalVerify`, `createCodingGoalVerifyWorkflow`, `suspendAskUserDecision`, `createAskUserDecisionResumeValidator`, `validateAskUserDecisionResume`, `validateAskUserDecisionAgentResume`. Default/hard coding, repository, Git, and plan/checkpoint limit constants are exported for host configuration.

Option/operation types: `ToolsOptions`, `ShellToolOptions`/`BashOperations`, `ReadToolOptions`/`ReadOperations`/`ReadTextOptions`/`ReadTextResult`, `WriteToolOptions`/`WriteOperations`, `EditToolOptions`/`EditOperations`/`EditToolDetails`.

Text reads stop after one page or `maxScanBytes` instead of loading the file. Custom `ReadOperations` must implement bounded `readText` and `statFile`; custom `EditOperations` must implement `statFile` and honor the supplied read cap/signal. Successful truncated shell output is retained in an exclusive Unix `0600` temp file owned by the host; timeout, abort, output-limit, and spill failures remove unpublished spill files. Hosts should delete published `metadata.fullOutputPath` files after use.

Network-free adversarial evaluation fixtures live in `src/__tests__/eval-fixtures.test.ts` and reuse `@arnilo/prism-evals` for CI thresholds. See `examples/coding-browser-evaluation.ts` and `docs/evaluations.md`.

## License

MIT
