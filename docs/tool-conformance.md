# Tool conformance

## What it does

Tool conformance helpers are dependency-free assertions for tool-dispatch configuration tests. They exercise the blocked-reason matrix and the success path of `dispatchToolCall` without network or credentials.

Exported from `@arnilo/prism/testing/tool-conformance`:

- `assertToolDispatchConforms(registry, options)`
- `assertToolBlocked(probe, expectedReason)`
- `dispatchAndCollect(probe)`
- `ToolConformanceOptions`, `ToolDispatchProbeOptions`

## When to use it

Use this helper when configuring a `ToolRegistry` with allow/deny filters, permission policies, and validators. It asserts the canonical blocked reasons and that blocked calls never execute:

- unknown tool → `tool_execution_blocked` with reason `unknown_tool`
- denied tool (filter) → `tool_denied`
- non-object arguments → `invalid_arguments`
- permission denial → `permission_denied`
- validator failure → `validation_failed`
- a valid call emits `tool_execution_started` and returns a result with no error

## Inputs / request

```ts
import { assertToolDispatchConforms } from "@arnilo/prism/testing/tool-conformance";
import { createToolRegistry } from "@arnilo/prism";

await assertToolDispatchConforms(createToolRegistry(), {
  tool: { name: "echo", execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }) },
  validArgs: { msg: "hi" },
  permission: myPermissionPolicy,
});
```

`ToolConformanceOptions`:
- `tool: ToolDefinition` — registered as the success-path target
- `validArgs: JsonObject` — arguments for the success probe
- `permission?: PermissionPolicy` — applied to every probe (default allow-all)
- `validate?: ToolValidator`, `filter?: ToolFilterInput`, `secrets?: readonly (string | undefined)[]`

## Outputs / response / events

`assertToolDispatchConforms` returns `Promise<void>` and throws on the first violation. `dispatchAndCollect` returns `{ result, events }` capturing the emitted `AgentEvent`s for custom assertions.

## Request/response example

```ts
import { assertToolBlocked } from "@arnilo/prism/testing/tool-conformance";

await assertToolBlocked(
  { call: { type: "tool_call", id: "c", name: "missing", arguments: {} }, registry: createToolRegistry() },
  "unknown_tool",
);
```

## Implementation example

```ts
import { assertToolDispatchConforms } from "@arnilo/prism/testing/tool-conformance";
import { createToolRegistry } from "@arnilo/prism";

await assertToolDispatchConforms(createToolRegistry(), {
  tool: { name: "echo", execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }) },
  validArgs: {},
});
```

## Extension and configuration notes

- The helper registers `options.tool` into the supplied registry; pass a fresh registry to avoid duplicate-name errors.
- Execution is observed via the `tool_execution_started`/`tool_execution_blocked` events the runtime emits — the helper does not mutate the caller's tool.
- Use `dispatchAndCollect` directly for custom probes (e.g. middleware ordering) beyond the standard matrix.

## Security and performance notes

- No credentials, no network required.
- Supply `validate` to exercise your policy; use `createJsonSchemaToolArgumentValidator()` from `@arnilo/prism-tool-validator-json-schema` for standards-based `parameters` validation.
- The helper uses an allow-all permission policy by default; supply `permission` to validate your fail-closed policy.
- Blocked calls are proven not to execute by the absence of `tool_execution_started`.

## Related APIs

- [Tools](tools.md)
- [Settings, auth, trust, security](settings-auth-trust-security.md)
- [Provider conformance](provider-conformance.md)
