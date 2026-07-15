# Coding agent tools (first-party package)

## What it does

`@arnilo/prism-coding-agent` is an optional first-party package that provides host shell/filesystem tools as Prism `ToolDefinition` objects. It ships four tools — `shell`, `read`, `write`, `edit` — plus aggregator factories. The tools are **inert** until a host imports them and registers them into a `ToolRegistry`. Behavior is a behavioral port of the pi coding agent's `bash`/`read`/`write`/`edit` tools, adapted to Prism's `ToolDefinition` / `ToolResult` contracts (no `@earendil-works/*` or `typebox` dependencies; only `diff` plus the Node standard library).

| Export | Purpose |
| --- | --- |
| `createShellTool(cwd, options?)` | `shell` tool: run a shell command and return combined output + exit code. |
| `createReadTool(cwd, options?)` | `read` tool: read a text or image file into `TextContent` / `ImageContent`. |
| `createWriteTool(cwd, options?)` | `write` tool: create or overwrite a file, creating parent directories. |
| `createEditTool(cwd, options?)` | `edit` tool: precise exact-then-fuzzy text replacement in an existing file. |
| `createCodingTools(cwd, options?)` | All four tools (`shell`, `read`, `write`, `edit`). |
| `createReadOnlyTools(cwd, options?)` | Read-only subset: `read` only. |
| `createAllTools(cwd, options?)` | Every tool the package provides (currently identical to `createCodingTools`). |
| `detectSupportedImageMimeType(buf)` / `detectSupportedImageMimeTypeFromFile(path)` | Magic-byte image MIME detection (PNG/JPEG/GIF/WebP/BMP) used by `read`. |
| `DEFAULT_MAX_IMAGE_BYTES` | Default `read` image size ceiling (10 MB). |
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

## Inputs / request

### `shell`

Run a shell command and return combined stdout+stderr.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `command` | `string` | Shell command to execute (required). |
| `timeout` | `number` | Timeout in **seconds** (optional; no default). |

**Outputs:** a `ToolResult` whose `content[0]` is a `TextContent` with the combined output. Non-zero exit is **not** a tool error: it is returned as a normal result with `[Command exited with code N]` appended to the content and `exitCode` in metadata. Timeout and abort are error results that still carry the partial output captured so far.

`shell` result `metadata`:

| Field | Present when | Purpose |
| --- | --- | --- |
| `exitCode` | always | Process exit code, or `null` when the process was killed by timeout/abort. |
| `truncation` | always | `TruncationResult` from the bounded output accumulator. |
| `fullOutputPath?` | truncated only | Path to the spilled temp file holding the full output. |

Shell resolution honors `options.shellPath` → `SHELL` env → `/bin/bash` → `sh`, and the process group is killed on timeout/abort (`process.kill(-pid)` on Unix, `taskkill /F /T` on Windows).

### `read`

Read a text or image file.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Path to the file (relative or absolute; `~` and `file://` expanded). Required. |
| `offset` | `number` | Line to start reading from (1-indexed). |
| `limit` | `number` | Maximum number of lines to read. |

**Outputs:** text files become a single `TextContent`, truncated to `maxLines`/`maxBytes` (defaults 2000 lines / 50 KB) with a `Use offset=N to continue` footer when more remains. Image files (PNG/JPEG/GIF/WebP/BMP by **magic bytes**, not extension) become `[TextContent note, ImageContent]` with base64 `data` and `mimeType`. Oversize images are rejected by `stat` (when available) or `buffer.length` against `maxImageBytes` (default 10 MB) before base64 encoding. An optional `transformImage` callback lets hosts resize or re-encode images without adding image-processing dependencies to the base package. Read failures (missing file, offset beyond end, oversize image, abort) are error results.

`read` tool options (via `createReadTool(cwd, options)` or `ToolsOptions.read`):

| Option | Default | Purpose |
| --- | --- | --- |
| `maxImageBytes` | `DEFAULT_MAX_IMAGE_BYTES` (10 MB) | Reject image reads larger than this many bytes. |
| `transformImage` | — | Host callback `( { buffer, mimeType } ) => Promise<Buffer>` run after read, before base64. |
| `autoResizeImages` | — | **Deprecated.** Ignored unless `transformImage` is also set (use `transformImage` instead). |
| `maxLines` / `maxBytes` | 2000 / 50 KB | Text head truncation limits. |
| `operations` | local fs | Pluggable `ReadOperations` backend. |
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

**Outputs:** a `TextContent` confirmation naming the **absolute path** with UTF-8 byte and line counts (e.g. `Successfully wrote 42 bytes (3 lines) to /abs/path.txt`). Write failures and abort are error results. Empty `content` is valid.

`write` result `metadata`: `{ bytes, lines, path }` (absolute path). Concurrent writes to the same path serialize through `withFileMutationQueue`; writes to different paths run in parallel.

### `edit`

Precise text replacement in an existing file via exact-then-fuzzy matching.

**Inputs:**

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Path to the file to edit. Required. |
| `edits` | `Array<{ oldText: string, newText: string }>` | Targeted replacements, each matched against the **original** file (not incrementally). No overlapping/nested edits. Required, non-empty. |

Each `edits[].oldText` must match a unique, non-overlapping region of the original file. Matching is exact first, then fuzzy (unicode normalization / whitespace collapse). A BOM is stripped before matching and re-prepended on write; original line endings are restored.

**Outputs:** a `TextContent` confirmation (`Successfully replaced N block(s) in {path}.`) plus `metadata`. Any failure — missing/unreadable file, no match, duplicate (non-unique) match, overlap, empty `oldText`, no-op edit, or abort — is an error result, and the file is left **unchanged** (the match runs before the write).

`edit` result `metadata`: `{ diff, patch, firstChangedLine }` — a display-oriented diff, a standard unified patch, and the first changed line in the new file. These are host-readable; the model only sees the short confirmation (keeps model context small).

## Outputs / response / events

Every tool returns a `ToolResult` with `toolCallId`, `name`, `content` (`readonly ContentBlock[]`), optional `error`, and optional `metadata`. Mutating tools (`shell` with same cwd, `write`, `edit`) serialize per realpath through `withFileMutationQueue` so concurrent calls targeting one file do not interleave. The package emits no events of its own; hosts observe tool execution through the normal Prism `AgentEvent` stream via `dispatchToolCall`.

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

// Full coding set (shell + read + write + edit) against the project root:
const tools = createToolRegistry(createCodingTools(process.cwd()));

// Or a read-only set for inspection-only agents:
const ro = createToolRegistry(createReadOnlyTools(process.cwd()));
```

Customizing a single tool (force bash, cap output, delegate writes to a remote backend):

```ts
import { createShellTool, createWriteTool } from "@arnilo/prism-coding-agent";

const shell = createShellTool("/repo", {
  shellPath: "/bin/bash",
  commandPrefix: "set -euo pipefail",
  maxLines: 500,
});

const remoteWrite = createWriteTool("/repo", {
  operations: {
    writeFile: async (abs, content) => { /* ship to remote */ },
    mkdir: async (dir) => { /* mkdir -p remotely */ },
  },
});
```

## Extension and configuration notes

- **Pluggable operation backends.** Every tool accepts an `operations` seam so a host can delegate to a remote system (e.g. SSH) while keeping the tool's matching/serialization behavior: `BashOperations` (`shell`), `ReadOperations` (`read`), `WriteOperations` (`write`), `EditOperations` (`edit`).
- **Per-tool options.** `ShellToolOptions` (`shellPath`, `commandPrefix`, `maxLines`, `maxBytes`, `tempFilePrefix`, `operations`, `spawnHook`, `executionPolicy`); `ReadToolOptions` (`operations`, `maxImageBytes`, `transformImage`, `maxLines`, `maxBytes`, `executionPolicy`; `autoResizeImages` deprecated); `WriteToolOptions` (`operations`, `executionPolicy`); `EditToolOptions` (`operations`, `executionPolicy`).
- **Aggregator options.** `ToolsOptions` (`{ shell?, read?, write?, edit? }`) threads each sub-object to the matching tool.
- **`ToolsOptions`** and the per-tool option types are exported from the package barrel for host configuration.
- No auto-discovery or manifest registration: import and register explicitly. This package registers no extensions and owns no globals (the mutation queue is a process-wide per-path map — see `ponytail:` note in the source).

## Security and performance notes

- **Host shell/filesystem access.** These tools run real commands and read/write real files. They provide **no sandbox**. Gate them with Prism `PermissionPolicy` / `ToolValidator` / trust policies before registering them for any provider turn. See [Host security guide](host-security.md) and [Security/auth/trust](settings-auth-trust-security.md).
- **Non-zero exit is not an error.** A failing command is a normal `shell` result (exit code in metadata); only timeout/abort/spawn failures are error results. Do not assume `error == undefined` means the command succeeded.
- **Bounded output.** `shell`/`read` accumulate output into a rolling tail bounded by `maxLines`/`maxBytes`; oversized output spills to a temp file (`fullOutputPath`), so memory use is bounded regardless of command output size.
- **Per-path serialization.** Concurrent mutations to the same file serialize; concurrent mutations to different files do not block each other. The queue is a process-wide map — across sessions in one process, same-path writes still serialize (upgrade path: scope per registry if throughput matters).
- **Bounded image reads.** `read` rejects images over `maxImageBytes` (default 10 MB) by `stat` before read when possible; MIME is detected from magic bytes only. Optional `transformImage` is host-owned — the base package has no image-processing dependency.

## Related APIs

- [Tools](tools.md): the host-owned tool harness — `createToolRegistry`, `dispatchToolCall`, filtering, and the `ToolDefinition` contract these factories satisfy.
- [Public contracts](public-contracts.md): `ToolDefinition`, `ToolResult`, `ToolExecutionContext`, `ContentBlock`, and `JsonObject` shapes.
- [Host security guide](host-security.md): fail-closed checklist for permission policies, tool validation, and trust boundaries that must gate these tools.
- [Tool conformance](tool-conformance.md): assertions for the tool-dispatch blocked-reason matrix these tools participate in.
