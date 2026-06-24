# Tools

## What it does

The tool harness gives hosts a small active registry, exact allow/deny filtering, and explicit dispatch for host-owned tools. Prism stores tool definitions and JSON Schema-compatible `parameters` metadata, but does not ship app tools, sandbox host code, or interpret schemas.

APIs:

- `createToolRegistry()` / `ToolRegistry`
- `filterTools()`
- `dispatchToolCall()`
- `ToolFilter`, `ToolFilterInput`, `ToolValidator`, `DispatchToolCallOptions`

## When to use it

Use `createToolRegistry()` when a host has selected the tools that may be active for an agent, session, or run. Use `dispatchToolCall()` when provider output or host code requests one of those tools and the host wants Prism to enforce lookup, filtering, object arguments, validation, middleware order, and lifecycle events. `session.run()` uses these same primitives for its bounded tool loop.

Do not use the harness as a sandbox, package loader, app-tool pack, permission policy engine, provider loop, or schema validator.

## Inputs / request

```ts
createToolRegistry(tools?: readonly ToolDefinition[]): ToolRegistry
filterTools(tools: readonly ToolDefinition[], filter?: ToolFilter | readonly ToolFilter[]): readonly ToolDefinition[]
dispatchToolCall(options: DispatchToolCallOptions): Promise<ToolResult>
```

`ToolRegistry` methods:

| Method | Input | Result |
| --- | --- | --- |
| `register(tool)` | `ToolDefinition` | Stores or replaces by `tool.name`. |
| `get(name)` | tool name | Returns the tool or `undefined`. |
| `resolve(name)` | tool name | Returns the tool or throws `Unknown tool: <name>`. |
| `list()` | none | Returns tools in insertion order. |

`ToolFilter` fields:

| Field | Purpose |
| --- | --- |
| `allow` | Exact tool names allowed by this scope. Empty or missing means no allow restriction. |
| `deny` | Exact tool names denied by this scope. Deny wins over allow. |

When multiple filters are provided, each non-empty allow list must include the tool, and any deny list excludes it.

`DispatchToolCallOptions` fields:

| Field | Purpose |
| --- | --- |
| `call` | `ToolCallContent` to dispatch. Runtime checks still reject non-object arguments. |
| `registry` | Active host `ToolRegistry`. |
| `context` | `ToolExecutionContext` with session/run/tool call ids, signal, metadata, and optional progress callback. |
| `filter` | Optional exact allow/deny filter or ordered filters. |
| `middleware` | Optional `MiddlewareRegistry`; `tool_call` runs before validation/execution and `tool_result` runs after execution. |
| `validate` | Optional host validator returning `void`, a message string, or `ErrorInfo`. |
| `emit` | Optional `AgentEvent` callback for lifecycle events. |
| `secrets` | Known secret values to redact from thrown tool errors. |

## Outputs / response / events

Registry calls return plain `ToolDefinition` objects. `resolve()` fails closed for unknown names before any tool can execute. Filtering returns only tools already present in the input list; it never creates or enables new tools.

`dispatchToolCall()` returns a `ToolResult`. Unknown tools, denied tools, invalid arguments, validator failures, and thrown tool errors return a result with `error` and do not throw by default.

Dispatch can emit these `AgentEvent` types:

| Event | When |
| --- | --- |
| `tool_execution_blocked` | Unknown, denied, invalid-argument, or validator-blocked call. |
| `tool_execution_started` | Immediately before `tool.execute()`. |
| `tool_execution_progress` | When the tool calls `context.progress()`. |
| `tool_execution_finished` | After successful execution and `tool_result` middleware. |
| `tool_execution_error` | When `tool.execute()` throws. |

## Request/response example

```json
{
  "call": { "type": "tool_call", "id": "call_1", "name": "echo", "arguments": { "text": "hi" } },
  "filter": { "allow": ["echo"] },
  "result": { "toolCallId": "call_1", "name": "echo", "value": { "text": "hi" } }
}
```

## Implementation example

```ts
import { createToolRegistry, dispatchToolCall, filterTools, type ToolDefinition } from "@arnilo/prism";

const echo: ToolDefinition = {
  name: "echo",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  execute(args, context) {
    return { toolCallId: context.toolCallId, name: "echo", value: args };
  },
};

const registry = createToolRegistry([echo]);
const active = filterTools(registry.list(), { allow: ["echo"] });

const result = await dispatchToolCall({
  call: { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } },
  registry,
  context: { sessionId: "s1", runId: "r1", toolCallId: "call_1" },
  filter: { allow: active.map((tool) => tool.name) },
  validate: (_tool, args) => typeof args.text === "string" ? undefined : "text is required",
});

console.log(result.value);
```

## Extension and configuration notes

Extensions can contribute tool definitions through `ExtensionAPI.registerTool()`, which stores them in `ContributionRegistries.tools`. Contributions are inert until the host explicitly selects/registers them in a tool registry and calls dispatch.

```ts
import { createContributionRegistries, createToolRegistry } from "@arnilo/prism";

const contributions = createContributionRegistries();
contributions.tools.register("echo", echo);

const activeTools = createToolRegistry([contributions.tools.resolve("echo")]);
```

Middleware can transform `tool_call` and `tool_result` payloads, but dispatch re-checks active registry lookup, filters, and object arguments after `tool_call` middleware. Middleware cannot grant permission by changing a tool name.

Configuration can carry allow/deny names, but Prism does not define a policy class or hidden global active tool set. Skills may reference `toolNames`, but `resolveActiveSkills()` only checks those names against the host-active tool list; it does not register, allow, or execute tools.

## Security and performance notes

- Tool lookup uses a `Map` for O(1) name lookup.
- Filtering is exact-name matching over the provided tools and rules.
- Unknown, denied, malformed, and validator-blocked calls fail closed.
- Tool arguments must be JSON object-shaped before validation or execution.
- `parameters` is pass-through metadata; hosts own schema interpretation and validation.
- Prism does not sandbox host tools and does not include built-in app tools.
- Contribution registration and registry/filter calls do not perform provider calls, credential resolution, resource loading, network, filesystem discovery, or tool execution.
- Dispatch performs explicit in-memory checks and executes only the selected host-active tool; it adds no retries, queues, timers, or new dependencies.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): dispatches complete provider tool calls through the host-active tool harness and returns tool results on the next provider turn.
- [Public contracts](public-contracts.md): `ToolDefinition`, `ToolRegistry`, `ToolExecutionContext`, `ToolResult`, and tool `AgentEvent` contracts.
- [Contribution registries](contribution-registries.md): inert extension/package tool contribution storage.
- [Extension kernel and event bus](extensions.md): `ExtensionAPI.registerTool()` contribution registration.
- [Context and skills](context-and-skills.md): skill `toolNames` validation against host-active tools.
- [Middleware hooks](middleware-hooks.md): `tool_call` and `tool_result` middleware used during dispatch.
- [Credentials and redaction](credentials-and-redaction.md): redaction helpers used for tool execution errors.
- [Observational memory compaction package](compaction-observational-memory.md): optional exact-id recall tool factory.

`DispatchToolCallOptions.permission` can provide a `PermissionPolicy`; denial emits `tool_execution_blocked` before validation or `execute()`. Middleware cannot bypass this guard. Prism does not sandbox tools. See [Security/auth/trust](settings-auth-trust-security.md).
