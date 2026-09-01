# Antigravity delegated agent

## What it does

`@arnilo/prism-antigravity-agent` provides a delegated agent adapter for the official [Google Antigravity CLI (`agy`)](https://github.com/google/antigravity). It enables Prism applications to delegate complex, multi-step coding tasks to an authenticated Antigravity CLI runner while exposing host-owned Prism tools, resources, and prompts over a per-run Model Context Protocol (MCP) server.

The package handles the end-to-end delegated execution lifecycle:
- Spawns the official headless CLI (`agy --agent <name> --workspace <dir>`) as a managed subprocess.
- Starts a run-bound loopback HTTP MCP server (`http://127.0.0.1:<port>/mcp`) authorized with an ephemeral Bearer token.
- Writes ephemeral workspace configuration (`.agents/mcp_config.json` and custom agent instructions) with automatic backup and fail-safe restoration.
- Parses the CLI's NDJSON output stream and projects steps into standard Prism `AgentEvent`s and [AG-UI](ag-ui.md) timeline activities.
- Persists and resumes multi-turn conversations via `--conversation <id>`.
- Provides an optional `createAntigravityDelegationTool` for Prism [supervisors](supervisors.md) and orchestrating agents.

Prism does not manage Google OAuth tokens, cookies, or credentials; the host environment owns the official `agy` binary and interactive authentication state (`agy login` / Google AI Pro subscription).

## When to use it

Use `@arnilo/prism-antigravity-agent` when:
- You want to delegate autonomous coding sessions to Google Antigravity while exposing host-owned Prism tools and capabilities via MCP.
- You need structured event streaming, token telemetry, and [AG-UI](ag-ui.md) visual timeline integration for Antigravity executions.
- You are orchestrating multi-agent workflows where a Prism supervisor or coding agent needs to delegate specialized subtasks to Antigravity.
- You want conversation continuation across multiple user turns in a persistent session.

Do **not** use it:
- As a generic LLM model provider. For direct Gemini API or Vertex AI foundation model inference without an autonomous loop, use [`@arnilo/prism-providers/google`](providers/google.md) or [`@arnilo/prism-providers/vertex`](providers/vertex.md).
- If you require step-by-step turn replacement of Antigravity's internal model loop, compaction, or planning strategy.
- If you require unreleased raw internal chain-of-thought text. Antigravity reasoning effort is projected as token counts and timeline activity steps, not raw hidden thoughts.

## Inputs / request

`createAntigravityCliAgent(options)` accepts agent configuration:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `command` | `string` | `"agy"` | Path to the official `agy` executable on the host. |
| `args` | `readonly string[]` | `[]` | Additional command-line arguments passed to the CLI. |
| `cwd` | `string` | `process.cwd()` | Working directory for the runner process. |
| `env` | `Record<string, string | undefined>` | `process.env` | Process environment variables. |
| `timeoutMs` | `number` | `300000` (5m) | Maximum process execution time. |
| `toolPolicy` | `AntigravityToolPolicy` | `"hybrid"` | Built-in CLI tool permissions (`"hybrid"`, `"all"`, `"none"`, or custom). |
| `tools` | `ToolDefinition[]` | `[]` | Prism tools exposed to the agent via loopback MCP. |
| `resources` | `ResourceDefinition[]` | `[]` | Prism resources exposed via loopback MCP. |
| `prompts` | `PromptDefinition[]` | `[]` | Prism prompt templates exposed via loopback MCP. |
| `exposure` | `AntigravityMcpExposure` | auto-created | Custom MCP server exposure handle if sharing an external server. |
| `conversationStore` | `AntigravityConversationStore` | in-memory | Store for persisting conversation IDs across turns. |
| `redactor` | `SecretRedactor` | auto | Secret redactor applied to events and process output. |
| `agentName` | `string` | `"prism-agent"` | Ephemeral agent definition identifier. |
| `systemPrompt` | `string` | built-in instructions | Custom instructions appended to the agent definition. |

`agent.run(runOptions)` executes a prompt run:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `prompt` | `string` | required | User task or instruction for Antigravity. |
| `workspace` | `string` | `agent.cwd` | Target workspace directory path for file modifications. |
| `sessionId` | `string` | auto-generated | Prism session identifier for conversation persistence. |
| `branchId` | `string` | `"main"` | Branch identifier for conversation isolation. |
| `conversationId` | `string` | auto-resolved | Existing Antigravity conversation ID to resume. |
| `signal` | `AbortSignal` | omitted | Cancellation signal to abort execution and clean up. |
| `eventSink` | `(event: AgentEvent) => void` | omitted | Real-time event listener for streaming UI updates. |
| `toolPolicy` | `AntigravityToolPolicy` | agent default | Per-run override for built-in tool policy. |

## Outputs / response / events

`agent.run()` returns a promise resolving to an `AntigravityRunResult`:

| Field | Type | Purpose |
| --- | --- | --- |
| `text` | `string` | Final synthesized response text from the Antigravity CLI. |
| `conversationId` | `string` | Antigravity conversation ID for subsequent multi-turn resumption. |
| `exitCode` | `number` | Process exit status code (0 for success). |
| `durationMs` | `number` | Total elapsed execution time in milliseconds. |
| `events` | `readonly AgentEvent[]` | Complete sequence of projected Prism events emitted during the run. |
| `usage` | `UsageReport` | Aggregated prompt, completion, total, and thinking token counts. |
| `subagents` | `readonly AntigravitySubagentSummary[]` | Subagents spawned and completed during execution. |

### Streamed events

The runner emits standardized Prism `AgentEvent` objects to the provided `eventSink`:
- `delegated_agent_step`: High-level step progression with step name, status, and duration.
- `message_delta`: Incremental response text chunks.
- `tool_call_start` / `tool_call_delta` / `tool_call_result`: MCP tool invocations and results.
- `agent_thought_chunk`: Thinking activity indicators with token counts.
- `usage`: Token usage telemetry updates.
- `subagent_spawn` / `subagent_finish`: Internal subagent hierarchy lifecycle.

## Request/response example

```json
{
  "prompt": "Inspect the repository and add unit tests for the auth helper.",
  "workspace": "/home/user/project",
  "sessionId": "session-101",
  "toolPolicy": "hybrid"
}
```

```json
{
  "text": "Added 4 unit tests covering token refresh and validation in auth.test.ts.",
  "conversationId": "conv_9876543210",
  "exitCode": 0,
  "durationMs": 4250,
  "usage": {
    "promptTokens": 1520,
    "completionTokens": 380,
    "totalTokens": 1900,
    "thinkingTokens": 640
  },
  "subagents": []
}
```

## Implementation example

### Direct runner

```ts
import { createAntigravityCliAgent } from "@arnilo/prism-antigravity-agent";
import { createReadTool, createWriteTool } from "@arnilo/prism-coding-agent";

// Configure agent with host-owned Prism tools exposed over MCP
const agent = createAntigravityCliAgent({
  command: "agy",
  tools: [
    createReadTool({ workspaceRoot: "/home/user/project" }),
    createWriteTool({ workspaceRoot: "/home/user/project" }),
  ],
  toolPolicy: "hybrid", // Built-in bash/editor tools enabled; Prism MCP tools added
});

// Run a task with real-time event streaming
const result = await agent.run({
  prompt: "Refactor error handling in src/utils.ts to use typed AppError",
  workspace: "/home/user/project",
  sessionId: "session-42",
  eventSink: (event) => {
    if (event.type === "message_delta") {
      process.stdout.write(event.delta.text);
    }
  },
});

console.log(`\nCompleted in ${result.durationMs}ms with conversation ${result.conversationId}`);
```

### Supervisor delegation tool

```ts
import { createSupervisor } from "@arnilo/prism-supervisor";
import {
  createAntigravityCliAgent,
  createAntigravityDelegationTool,
} from "@arnilo/prism-antigravity-agent";

const antigravity = createAntigravityCliAgent({
  workspace: "/home/user/project",
  toolPolicy: "hybrid",
});

const supervisor = createSupervisor({
  tools: [
    createAntigravityDelegationTool({
      agent: antigravity,
      name: "delegate_to_antigravity",
      description: "Delegate complex coding tasks to Google Antigravity CLI",
    }),
  ],
});
```

## Extension and configuration notes

### Ephemeral workspace configuration

During each execution, the adapter dynamically constructs:
1. `.agents/mcp_config.json`: Configures the local loopback MCP server endpoint (`http://127.0.0.1:<port>/mcp`) and authorization header.
2. `.agents/agents/<name>/agent.md`: Configures custom instructions and tool permissions.

If pre-existing configuration files exist in `.agents/`, they are backed up before the run and restored atomically upon completion, failure, or cancellation.

### Tool policies

The `toolPolicy` setting controls built-in CLI capabilities:
- `"hybrid"` (default): Enables built-in editor, terminal, and search tools while exposing configured Prism MCP tools.
- `"all"`: Enables all built-in CLI tools and MCP tools.
- `"none"`: Disables built-in tools; the agent relies exclusively on exposed Prism MCP tools.
- Custom object `{ allow?: string[], deny?: string[] }`: Explicit allow/deny lists for fine-grained governance.

## Security and performance notes

- **Host-owned authentication**: Prism does not read, store, or forward Google credentials. Authentication state resides in the official `agy` CLI's session store managed via `agy login`.
- **Loopback isolation**: The ephemeral MCP HTTP server binds exclusively to `127.0.0.1` on a dynamically assigned port, secured with a cryptographically random Bearer token.
- **Fail-safe cleanup**: Workspace configuration files and HTTP listener ports are cleaned up in `finally` blocks under all exit conditions, including `SIGINT`, timeouts, and unhandled errors.
- **Secret redaction**: All stdout, stderr, event payloads, and tool arguments are processed through Prism's secret redactor before event emission.
- **Terms and quota**: Antigravity CLI execution utilizes Google AI Pro subscription quotas through the authenticated official binary. Host operators should verify compliance with their organization's terms of service.

## Related APIs

- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): Connect Antigravity event streams to AG-UI and web interfaces.
- [MCP client bridge and server exposure](mcp-tools.md): Core Model Context Protocol integration in Prism.
- [Supervisor delegation](supervisors.md): Hierarchical multi-agent delegation patterns.
- [Coding agent tools](coding-agent-tools.md): Native Prism file, edit, and terminal tools.
- [Google Gemini provider](providers/google.md): Direct Gemini API model inference without CLI delegation.
- [Google Vertex AI provider](providers/vertex.md): Enterprise cloud Vertex AI model inference.
- [Public contracts](public-contracts.md): Core message, event, tool, and session types.
