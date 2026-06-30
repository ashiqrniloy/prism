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
| `validate` | Optional host validator returning `void`, a message string, or `ErrorInfo`. A non-`void` return blocks dispatch with reason `validation_failed` (redacted). Runs after the permission assertion and before `tool.execute()`. |
| `emit` | Optional `AgentEvent` callback for lifecycle events. |
| `secrets` | Known secret values to redact from thrown tool errors. |
| `redactor` | Optional `SecretRedactor` used to redact tool-call ledger records. |
| `ledger` | Optional `RunLedger` adapter; when set, `dispatchToolCall` appends `ToolCallRecord` rows. |
| `ownership` | Optional `OwnershipScope` copied into each `ToolCallRecord`. |

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

### Tool-call ledger rows

When `options.ledger` is set, `dispatchToolCall()` also appends a `ToolCallRecord` for each lifecycle transition. The runtime passes each record through `redactRunLedgerRecord(record, options.redactor)` before handing it to the adapter. Rows are written for:

| Status | When | Extra fields |
| --- | --- | --- |
| `started` | After `tool_execution_started` | `startedAt`, `arguments` |
| `started` (progress snapshot) | On each `context.progress()` call | `progress`, `progressMetadata`, `progressAt` |
| `finished` | After `tool_execution_finished` | `finishedAt`, `result` |
| `error` | After `tool_execution_error` | `finishedAt`, `result` with `error` |
| `blocked` | On any blocked path | `finishedAt`, `reason`, `result` with `error` |

Blocked reasons are `unknown_tool`, `tool_denied`, `invalid_arguments`, `permission_denied`, and `validation_failed`. Progress snapshots reuse status `started` because the tool call is still in flight.

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

### Runtime-supplied validators

`AgentConfig.validator?` and `RunOptions.validate?` expose the same `ToolValidator` seam that `DispatchToolCallOptions.validate` already uses. The runtime threads `validate: RunOptions.validate ?? AgentConfig.validator` into every `dispatchToolCall` it issues during the tool loop, so an app can supply argument validation without taking ownership of dispatch itself. `RunOptions.validate` overrides `AgentConfig.validator` on a per-run basis (RunOptions wins). When neither is set, dispatch runs unmodified.

The validator runs after the permission assertion and before `tool.execute()`. A `void` return lets the tool run. A non-`void` return (a string message or `ErrorInfo`) blocks the call: `dispatchToolCall` emits `tool_execution_blocked` with reason `validation_failed` and a redacted error, and the tool is not executed. This is the same redaction path as thrown tool errors, so a validator that echoes a secret is scrubbed through the active `SecretRedactor`. Composition of multiple validators is deferred (YAGNI); wrap or call both in a host-supplied function if needed.

```ts
import { createAgent, createSecretRedactor, type ToolValidator } from "@arnilo/prism";

const validator: ToolValidator = (_tool, args) =>
  typeof args.query === "string" && args.query.length <= 1000
    ? undefined
    : "query too long";

const agent = createAgent({
  model,
  provider,
  tools,
  // applied to every run of this agent
  validator,
  // redacts validator output (and tool errors) the same way as secrets
  redactor: createSecretRedactor([process.env.APP_KEY!]),
});

// override per run only
await session.run(input, { validate: (_t, args) => args.dry ? "dry-run blocked" : undefined });
```

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

`DispatchToolCallOptions.permission` can provide a `PermissionPolicy`; denial emits `tool_execution_blocked` before validation or `execute()`. Middleware cannot bypass this guard. `AgentConfig.validator`/`RunOptions.validate` run after this guard; their output is redacted through the active `SecretRedactor`. Prism does not sandbox tools. See [Security/auth/trust](settings-auth-trust-security.md).
