# Guardrails

## What it does

Guardrails are typed, fail-closed checks at input, completed provider output, tool input, and raw tool output boundaries. `session.run()` evaluates configured stages through one core runner; `dispatchToolCall()` uses same runner for direct, MCP-server, and workflow tool calls.

## When to use it

Use guardrails to block unsafe prompts, model responses, tool arguments, or tool results before their next boundary. Use a redactor for known secrets. Do not treat guardrails as a sandbox, secret detector, permission policy, or validation replacement.

## Inputs / request

```ts
import type { Guardrail, Guardrails } from "@arnilo/prism";

const pii: Guardrail<"input"> = {
  name: "pii",
  stage: "input",
  evaluate: ({ value }) => JSON.stringify(value).includes("SSN")
    ? { action: "tripwire", reason: "pii" }
    : { action: "allow" },
};

const guardrails: Guardrails = { input: [pii], maxConcurrency: 1 };
```

Set `AgentConfig.guardrails` for every session run or `RunOptions.guardrails` to append checks for one run. `DispatchToolCallOptions.guardrails`, workflow `RunWorkflowOptions.guardrails`, and MCP server `CreatePrismMcpServerOptions.guardrails` apply tool stages to direct calls. A stage has `Guardrail<"input" | "output" | "tool_input" | "tool_output">`, a name, optional revision, and `evaluate(context)` result.

Decisions are `allow`, `block`, `tripwire`, or `interrupt`. Evaluation defaults to declaration-order sequential. `maxConcurrency` may be 1–16; records are emitted in declaration order. Thrown or malformed decisions become a fail-closed tripwire. Decision reasons are capped at 4 KiB and metadata at 16 KiB after JSON normalization and optional redaction.

## Outputs / response / events

Every evaluated guard produces a redacted `guardrail_decision` `AgentEvent` with a bounded `GuardrailRecord`. An input or output terminal decision rejects the run with `GuardrailError`; `tripwire` stops remaining evaluation. A tool-input or tool-output `block` returns a redacted blocked `ToolResult`; a `tripwire` rejects the enclosing run. `interrupt` is reserved for durable runs and currently fails closed with `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`.

Ordering is fixed:

1. input before session append, compaction, or provider work;
2. provider output is privately collected, then output checks run before any assistant message event or persistence;
3. tool input runs after tool-call middleware normalization and before lookup, permission, validation, execution policy, and side effect;
4. tool output runs after the side effect but before redaction, tool events, ledger rows, transcript append, or next turn.

With no output guardrails, provider streaming retains existing behavior. With output guardrails, message events are buffered until the completed provider turn is allowed.

## Request/response example

```json
{
  "event": {
    "type": "guardrail_decision",
    "record": { "guardrail": "pii", "stage": "input", "action": "tripwire", "reason": "pii" }
  }
}
```

## Implementation example

```ts
const agent = createAgent({ model, provider, guardrails: { input: [pii], output: [responseGuard] } });
await agent.createSession().run("Draft reply", { guardrails: { toolInput: [commandGuard] } });
```

## Extension and configuration notes

Guardrails are callbacks supplied by the host. Prism does not discover, load, retry, or persist callback code. `createSecureAgent()` keeps configured guardrails and only appends run-level checks; it never lets a run remove secure defaults. Custom loops receive guarded `LoopContext.generate()` and `LoopContext.dispatchToolCall()`; host code that directly calls a provider or `ToolDefinition.execute()` is outside the runtime boundary.

## Security and performance notes

Output buffering prevents blocked provider content from reaching subscribers, session entries, ledgers, parsers, delegation, or tools. Tool-output checks receive raw results but Prism discards blocked raw output before event, ledger, transcript, or MCP exposure. Redaction replaces exact known values only; it is not general secret detection. Parallel checks receive an abort signal, but callback code must honor it to stop in-flight work.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md)
- [Tools](tools.md)
- [Agent events](agent-events.md)
- [Host security](host-security.md)
