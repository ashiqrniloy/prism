# Tools

## What it does

A `ToolDefinition` declares one tool the model may call. The kernel validates it, exposes its
parameters to the provider, and dispatches it through `RunController.executeTools` (which fires the
`tool.call`, `tool.execute`, and `tool.result` hooks). Every tool is registered through
`createToolRegistry`, which is the only place definitions are validated.

`ToolDefinition.effects` is the capability annotation: it states what a tool is allowed to reach,
so a `tool.call` hook can decide from capabilities instead of the tool's name.

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Registry key and model-facing name. |
| `kind` | `ToolKind` | Optional neutral kind for ACP-style consumers. |
| `description` | `string` | Model-facing description. |
| `parameters` | `JsonObject` | JSON schema for arguments. |
| `exclusive` | `boolean` | Force any turn containing this tool to dispatch sequentially. |
| `effect` | `ToolEffectDeclaration \| ToolEffectClassifier` | Optional recovery declaration (side-effect class and idempotency). |
| `effects` | `readonly ToolCapabilityKind[]` | Optional capability annotation. |
| `elicitation` | `(args, ctx) => ToolElicitationRequest \| undefined` | Optional durable-gating contract. |
| `execute` | `(args, ctx) => ToolResult \| Promise<ToolResult>` | The implementation. |

`ToolCapabilityKind` is `"read" | "write" | "execute" | "network" | "external"`. It is independent
of `effect`: `effect` classifies how a call recovers, `effects` states what it may reach.

## When to use it

Annotate `effects` when a tool touches anything beyond its own process: files, the network, an
external system, or a mutating operation. Hosts and packages read the annotation from the
`tool.call` payload (`call.effects`) to deny, ask, or rewrite a call by capability.

## Inputs / request

`createToolRegistry` validates `effects` at registration:

- An unknown kind, a repeated kind, or a non-array value throws `ToolDefinitionError` with code
  `ERR_PRISM_TOOL_EFFECTS`.
- A tool with no `effects` is accepted and resolves to all five kinds.

```ts
const fetchTool: ToolDefinition = {
  name: "fetch",
  parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  effects: ["network"],
  execute,
};
```

## Outputs / response

`resolveToolEffects(tool)` returns the annotation, or all five kinds when the tool declares none.
The all-kinds default is fail closed: an effects-based deny matches an unannotated tool, so a
missing annotation never widens what a policy allows.

```ts
import { resolveToolEffects } from "@arnilo/prism";

resolveToolEffects({ name: "read_file", effects: ["read"], execute }); // ["read"]
resolveToolEffects({ name: "legacy", execute }); // ["read", "write", "execute", "network", "external"]
```

## Request/response example

```json
{
  "tool.call": {
    "call": { "name": "fetch", "effects": ["network"] }
  }
}
```

## Implementation example

```ts
import { createAgent, type ToolDefinition } from "@arnilo/prism";

const tools: readonly ToolDefinition[] = [
  { name: "read_file", effects: ["read"], execute },
  { name: "write_file", effects: ["write"], execute },
];

const agent = await createAgent({
  model: "openai:gpt-4.1",
  tools: { add: tools },
  hooks: {
    "tool.call": (call) => (call.effects.includes("write") ? { deny: "writes are disabled" } : "allow"),
  },
});
```

## Host tools and per-run narrowing

`AgentConfig.tools` is `{ add?: readonly ToolDefinition[] }`. The kernel merges it with package
tools, minus `disable.tools`. A duplicate name fails closed, including a host tool named
`load_skill` or `search_tools` (the kernel registers those when progressive skills disclosure or
tool search is active).

`RunOptions.tools` is `{ only?: readonly string[] }`. Omitted sends every registered tool; an empty
array sends none; an unknown name fails the run closed. A durable resume intersects the list with
the checkpointed grant, so a resumed run can never widen tool authority.

## Extension and configuration notes

- Kernel tools are annotated: `load_skill` and `search_tools` are `["read"]`.
- Family-package tools gain their annotations when each moves to its native package (roadmap
  Phase 7); until then an unannotated family tool reports all kinds.
- `effects` is validated once, at registration. Dispatch reads the resolved annotation with no
  per-call validation cost.

## Security and performance notes

- The all-kinds default for unannotated tools means a missing annotation never widens an
  effects-based policy; it can only make the tool match more denies.
- Registration is the trust boundary: a malformed annotation fails closed at `createToolRegistry`
  rather than at dispatch.
- `resolveToolEffects` is a property read plus a shared frozen fallback array; there is no per-call
  allocation.

## Related APIs

- `ToolDefinition`: the definition validated at registration.
- `createToolRegistry`: the only validation point for `effects`.
- `resolveToolEffects`: the annotation plus the fail-closed default.
- `tool.call`: the hook whose payload carries `effects`.
