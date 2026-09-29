# Coding Tools, Sandboxing, and Personas (@arnilo/prism-coding-tools)

The `@arnilo/prism-coding-tools` family package unifies Prism's coding agent tools, security sandboxing, document reading, OpenAPI integration, Linux desktop automation, Dev inspector, and persona extensions into explicit, import-isolated subpaths.

## Installation

```bash
bun add @arnilo/prism @arnilo/prism-coding-tools
```

For document reading or specialized integrations, install the optional peer dependencies as needed:

```bash
# PDF and DOCX document extraction
bun add pdf-parse mammoth
```

## Subpaths Map

| Subpath | Description | Optional Peers |
|---|---|---|
| `@arnilo/prism-coding-tools/agent` | Core coding tools (read, write, edit, search, bash, git, diagnostics, check, ast-grep, lsp) | — |
| `@arnilo/prism-coding-tools/security` | Sandbox execution adapters (Docker/OCI, native disposable sandbox, approval policies, egress proxy) | — |
| `@arnilo/prism-coding-tools/openapi` | OpenAPI 3.x tool generator and executor with SSRF protection and parameter validation | — |
| `@arnilo/prism-coding-tools/computer-use-linux` | Linux desktop observation and targeting tool bridge | — |
| `@arnilo/prism-coding-tools/dev` | Loopback-only developer inspector, event timeline visualizer, and local replay server | — |
| `@arnilo/prism-coding-tools/dev/cli` | Command-line entrypoint for `prism dev` | — |
| `@arnilo/prism-coding-tools/impeccable` | Impeccable high-precision frontend engineering persona extension | — |

## CLI

```bash
# Start the loopback dev inspector
bunx prism-dev --port 4311
```

## Usage Examples

### Creating Coding Tools
```ts
import { createCodingTools } from "@arnilo/prism-coding-tools/agent";

const tools = createCodingTools({
  workspaceRoot: process.cwd(),
});
```

### Task Completion: `todo_write` and the Continuation Stop Hook

`createTodoWriteTool()` is a stateless planning tool: each call replaces the full list
(`{ todos: [{ id, content, status }] }` with `pending | in_progress | completed | cancelled`) and
returns the rendered list, with the structured items on the result metadata.
`createTodoContinuationStopHook({ maxNoProgress })` reads the latest successful `todo_write` result
from the transcript at a natural loop end: open items return `continue` with a steer listing them,
closed or absent lists return `stop`, and `maxNoProgress` (default 2) consecutive continuations with
no new tool call and no list change stop the run. Both are stateless and resume-safe because the
canonical list lives in history; hosts that compact must pin that history entry out of the cut
(`todoPinnedEntryIds(entries)`) so the hook keeps seeing the plan — Prism Code does.

```ts
import { createTodoContinuationStopHook, createTodoWriteTool } from "@arnilo/prism-coding-tools/agent";

const tools = [createTodoWriteTool()];
const stopHooks = [createTodoContinuationStopHook({ maxNoProgress: 2 })];
// tools add to the agent registry; stopHooks go to AgentConfig.stopHooks or RunOptions.stopHooks.
```

Prism Code registers both by default; `loop.continueOnOpenTodos: false` disables them.

### Sandboxed Execution
```ts
import { createDockerSandbox, createSandboxCodingComposition } from "@arnilo/prism-coding-tools/security";

const composition = createSandboxCodingComposition({
  workspaceMode: "sandbox",
  sandbox: createDockerSandbox({
    image: "node:20-alpine@sha256:...",
    workspaceRoot: process.cwd(),
  }),
});
```

### Persona Extensions
```ts
import { createImpeccableExtension } from "@arnilo/prism-coding-tools/impeccable";

const impeccable = createImpeccableExtension();
```

Host-owned personas (any upstream `SKILL.md` tree) need no package subpath: load it with
`loadSkillDirectory` from `@arnilo/prism/node/contribution-discovery`, register the skills and an
instruction injector from a host extension, and persist the active mode in session entries — see
[`examples/caveman-ponytail.ts`](../examples/caveman-ponytail.ts).

## Security & Import Isolation

- Importing `@arnilo/prism-coding-tools/agent` never loads Docker sandbox adapters, desktop MCP bridges, document parser peers, or Dev inspector modules.
- Document parser peers (`pdf-parse`, `mammoth`) fail closed when absent.
- Persona extensions are pure prompt and behavior modifiers and never gain implicit host privileges.
