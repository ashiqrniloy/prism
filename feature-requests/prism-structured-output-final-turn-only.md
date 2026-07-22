# Prism structured output on the final artifact turn only (tool-calling loops)

Status: **shipped in 0.0.11** (pre-tag). Filed against Prism `0.0.96`; implemented as
opt-in `structuredOutputTiming: "final-turn-only"` (keeps existing
`structuredOutput: StructuredOutputOptions` for the schema payload).

## Summary

When a host enables native structured output (`structuredOutput` schema options),
`generateValidateReviseLoop` historically attached `response_format` to **every**
provider request in the loop: draft turns, tool-calling turns, and revision turns
alike. Forced-JSON mode structurally competes with tool calling — a tool-call turn
has empty/short content plus a `tool_calls` array, while `response_format` instructs
the model that its message content must conform to the schema. Models resolve the
conflict by emitting JSON directly and never calling tools.

**Shipped API (0.0.11):**

```ts
generateValidateReviseLoop({
  // ...
  toolCalls: "bounded",
  structuredOutputTiming: "final-turn-only", // default: "every-turn"
});
// or via AgentLoopOptions on session.run({ loop: { strategy: "generate-validate-revise", ... } })
```

Semantics when `"final-turn-only"` (requires `toolCalls: "bounded"`):

1. Turns that may dispatch tools are sent **without** `response_format`, so the
   model may choose tool calls freely.
2. When the model returns a call-free candidate (or tool rounds are exhausted),
   the next turn goes out with `response_format` and tools withdrawn.
3. Revision requests are also "final turns" (schema on, tools off).
4. `maxToolRounds` accounting is unchanged; the mode only changes which requests
   carry `response_format` (plus one promote turn after a tool-phase call-free draft).

Hosts that never offer tools see no behavioral change. Default stays
`"every-turn"` for backward compatibility.

## Acceptance criteria (upstream tests)

1. With `final-turn-only` and tools registered, a first turn containing tool calls
   is requested without `response_format` and dispatches normally.
2. The artifact turn (call-free) is requested with `response_format` and without
   tools; the structured-output support gate
   (`assertStructuredOutputRequestSupported`) applies only to that turn.
3. `every-turn` (default) behavior is unchanged from prior releases.
4. Revision turns follow the same rule: schema on, tools off.
5. Bounded invariants unchanged aside from the optional promote turn under
   `final-turn-only`.

## Non-goals

- No change to stream parsing, tool-call delta handling, or the `0.0.9`
  recovery semantics (all fixed and adopted).
- No Synapta-side fork or provider shim.
- No change for providers/models that do not advertise `structuredOutput`.

## Environment (original filing)

- Prism `0.0.96` (all first-party packages exact); OpenCode Go provider
  (`@arnilo/prism-provider-opencode-go`), `mimo-v2.5` (verified json_schema
  model), `generateValidateReviseLoop` with `toolCalls: "bounded"`,
  `maxToolRounds: 3`, explicit `RunLimits`.
- Synapta evidence logs: A10 live eval reports `2026.07.a10.4` (four models),
  sanitized per-item failure stages; contact the Synapta maintainers for the
  full reports.
