# Prism bug report: terminal tool-call stream failures and empty-candidate success

**Reported against:** `@arnilo/prism@0.0.8`, `@arnilo/prism-provider-opencode-go@0.0.8`
**Reporter:** Synapta (Prism consumer) — found via the live authoring-agent evaluation harness
**Severity:** High — both defects make otherwise-recoverable model behavior terminally fail a run, or report a run as successful when no artifact exists.

Related earlier report (all four defects fixed in 0.0.8 — thank you):
`prism-opencode-go-route-auth-and-structured-output-capabilities.md`

---

## Defect 1 — Tool-call stream failures are terminal; the model never gets a chance to self-correct

Two variants, same root problem: a malformed or truncated streamed tool call throws out of the provider stream parser / agent runtime and kills the run. No `ToolResult` error is fed back to the model, no revision budget is consumed, and the failure class is indistinguishable from a hard transport error.

### 1a. Malformed streamed tool-call arguments → terminal `ProviderTransportError`

`parseJsonObjectArguments` throws inside the SSE parsers when the model emits
tool arguments that are not valid JSON:

- `@arnilo/prism-provider-opencode-go/dist/openai-chat.js:71`
- `@arnilo/prism-provider-opencode-go/dist/anthropic-messages.js:70`
- `@arnilo/prism/dist/providers/openai-compatible.js:69`
- thrown from `@arnilo/prism/dist/providers/transport.js` (`ProviderTransportError("invalid_json_arguments")`)

Observed live (qwen3.7-plus, Anthropic route): the model called
`validate_workflow_ir` with malformed arguments; the run ended
`status: "failed"`, error `Invalid tool arguments JSON for tool validate_workflow_ir`.
With `maxRevisions >= 1` the failure consumed nothing and the model got no
feedback — the turn never completed, so `generateValidateReviseLoop` could not
route it anywhere.

### 1b. Truncated tool-call deltas → terminal bare `Error`

`reconstructToolCallDeltas` throws `Error("Incomplete tool call delta at index N")`
(`@arnilo/prism/dist/provider-events.js:36`, reached from `agents.js:966`
`reconstructMissingToolCalls`) when a stream ends with tool-call deltas missing
`id`/`name`. Observed live with glm-5.2 and mimo-v2.5-pro (OpenCode Go gateway
truncates tool-call SSE deltas mid-call). The 0.0.8 stream-completion checks
correctly refuse to report these as successful — but the surfaced failure is an
untyped `Error` from deep in the runtime, again with no recovery path.

### Expected behavior

1. Malformed tool-call arguments should produce a **failed tool result**
   (`isError`, bounded message) in place of the call, letting the turn complete
   so the model can correct itself within existing `maxToolRounds`/`maxTurns`
   budgets. This mirrors how tool *execution* errors are already handled.
2. If (1) is rejected for protocol-purity reasons, throw a **typed, catchable
   error** (e.g. `ProviderToolCallError` with `code: "invalid_arguments" |
   "incomplete_delta"`) so hosts can distinguish "model emitted garbage, retry
   the turn" from "transport is broken, abort the run".
3. Truncated streams (1b) should surface through the same typed channel, not a
   bare `Error`.

### Minimal repro sketch (1a)

```ts
const provider = mockProvider([
  // single turn: one tool_call whose argumentsText is "{invalid"
  toolCallDelta({ index: 0, id: "c1", name: "my_tool" }),
  toolCallDelta({ index: 0, argumentsText: "{invalid" }),
  done(),
]);
// session.run(...) rejects; expected: turn completes with a failed
// ToolResult for c1 and the loop continues within budget.
```

---

## Defect 2 — `generateValidateReviseLoop` can resolve `succeeded` with empty text and zero artifact events

Observed live (qwen3.7-plus, Anthropic route, reasoning model, tools bounded,
`maxRevisions: 2`):

- `session.run` resolved with `status: "succeeded"`
- `result.text === ""` (length 0)
- **no** `artifact_started` / `artifact_failed` / `artifact_finished` /
  `artifact_revision_requested` events were emitted
- the artifact parser ("no JSON object found in model output") was never
  routed through the revision budget

A plausible mechanism: the model's final assistant message contained only
thinking/reasoning content blocks, so the call-free candidate had empty text.
The 0.0.8 parse-repair fix routes parse *failures* through the budget, but an
empty candidate appears to bypass artifact processing entirely and be accepted
as the run result.

### Expected behavior

For an artifact loop, a call-free candidate whose text fails parsing —
**including empty text** — must emit `artifact_failed` (reason `parse_error`)
and consume revision budget exactly like any other parse failure. A run using
`generateValidateReviseLoop` must never report `succeeded` without a validated
artifact.

### Minimal repro sketch

```ts
const provider = mockProvider([
  // turn 1: assistant message with only a thinking block, no text, no tool calls
  content({ type: "thinking", text: "..." }),
  done(usage),
]);
// generateValidateReviseLoop with maxRevisions >= 1
// expected: artifact_failed reason=parse_error, repairer invoked;
// observed: run resolves succeeded with text === "".
```

---

## Enhancement request (non-blocking) — structured output on the final turn only

When `model.capabilities.structuredOutput === "json_schema"`, Prism applies the
`response_format` JSON-schema constraint to **every** provider turn, including
turns where the model is expected to emit tool calls. Observed with mimo-v2.5
(OpenCode Go): with native JSON Schema enabled the model made zero tool calls
and produced weak single-shot output; the same model with structured output
disabled attempts tool calls. An opt-in `structuredOutput: "final_turn_only"`
mode (constraint applied only once the model produces a call-free candidate)
would resolve the tension for tool-using artifact loops.

---

## Environment

- `@arnilo/prism` 0.0.8, `@arnilo/prism-provider-opencode-go` 0.0.8, Node 24
- Loop: `generateValidateReviseLoop`, `toolCalls: "bounded"`, `maxToolRounds: 2`
- Models observed: qwen3.7-plus (defects 1a, 2), glm-5.2 / mimo-v2.5-pro (1b),
  mimo-v2.5 (enhancement)
- Full sanitized event transcripts available on request.
