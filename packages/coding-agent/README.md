# @arnilo/prism-coding-agent

Optional first-party coding tools package for [Prism](https://www.npmjs.com/package/@arnilo/prism). Provides host shell/filesystem tools — `shell`, `read`, `write`, `edit` — as Prism `ToolDefinition` objects. **Inert until a host imports it and registers the tools into a `ToolRegistry`.**

Behavior is a behavioral port of the pi coding agent's `bash`/`read`/`write`/`edit` tools, adapted to Prism's `ToolDefinition` / `ToolResult` contracts (no `@earendil-works/*` or `typebox` dependencies).

> ⚠️ **These tools perform real shell and filesystem operations on the host. They provide no sandbox.** Gate them with Prism `PermissionPolicy` / `ToolValidator` / trust policies before registering them for any provider turn. See the [coding agent tools docs](https://github.com/ashiqrniloy/prism/blob/main/docs/coding-agent-tools.md) and the [host security guide](https://github.com/ashiqrniloy/prism/blob/main/docs/host-security.md).

## Install

```sh
npm install @arnilo/prism-coding-agent
```

`@arnilo/prism` is a peer dependency.

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
import { createShellTool, createWriteTool } from "@arnilo/prism-coding-agent";

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
```

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `shell` | `{ command, timeout? }` | Combined output + `metadata.exitCode`; 600-second default timeout and 64 MiB total-output cap. Non-zero exit is **not** an error. |
| `read` | `{ path, offset?, limit? }` | Streamed bounded text page or bounded `[note, ImageContent]`. |
| `write` | `{ path, content }` | Bounded UTF-8 input; `Successfully wrote N bytes (M lines) to <abs>`. |
| `edit` | `{ path, edits: [{oldText,newText}] }` | Bounded target/input/count; `Successfully replaced N block(s)` + diff metadata. |

### pi name mapping

| Prism | pi |
| --- | --- |
| `shell` | `bash` |
| `read` / `write` / `edit` | `read` / `write` / `edit` |

## Exports

Factories: `createShellTool`, `createReadTool`, `createWriteTool`, `createEditTool`, `createCodingTools`, `createReadOnlyTools`, `createAllTools`, `createLocalBashOperations`.

Helpers: `detectSupportedImageMimeType`, `detectSupportedImageMimeTypeFromFile`, `getShellConfig`, `killProcessTree`, `waitForChildProcess`, `withFileMutationQueue`. Default/hard coding limit constants are exported for host configuration.

Option/operation types: `ToolsOptions`, `ShellToolOptions`/`BashOperations`, `ReadToolOptions`/`ReadOperations`/`ReadTextOptions`/`ReadTextResult`, `WriteToolOptions`/`WriteOperations`, `EditToolOptions`/`EditOperations`/`EditToolDetails`.

Text reads stop after one page or `maxScanBytes` instead of loading the file. Custom `ReadOperations` must implement bounded `readText` and `statFile`; custom `EditOperations` must implement `statFile` and honor the supplied read cap/signal. Successful truncated shell output is retained in an exclusive Unix `0600` temp file owned by the host; timeout, abort, output-limit, and spill failures remove unpublished spill files. Hosts should delete published `metadata.fullOutputPath` files after use.

## License

MIT
