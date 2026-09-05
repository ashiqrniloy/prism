# Bug: `reconstructToolCallDeltas` clobbers captured tool-call identity with `null` continuation deltas, failing every streaming tool call on conformant OpenAI-compatible providers

**Package:** `@arnilo/prism` 0.4.0
**File:** `dist/provider-events.js` → `reconstructToolCallDeltas`
**Severity:** high — all streaming tool calls fail on affected providers
**Related docs:** the `incomplete_delta` fail-closed behavior added in the CHANGELOG ("Incomplete tool-call deltas (missing id/name) fail with typed `ProviderTransportError`")

## Symptom

Any tool-bearing streaming request against OpenCode Go (`opencode-go` / `mimo-v2.5`) fails the provider turn:

```
ProviderTransportError: Incomplete tool call delta at index 0
```

No tool is executed; the run errors out. Other providers that emit `null` identity on continuation chunks will hit the same failure.

## Root cause

OpenAI-compatible SSE streams send the tool-call identity (id + function name) in the **first** `tool_calls` fragment and repeat the fields as `null` in continuation fragments that only append `function.arguments`. `reconstructToolCallDeltas` then rebuilds the call from the emitted `tool_call_delta` events:

```js
const partial = partials.get(event.index) ?? { argumentsText: "" };
if (event.id !== undefined)
    partial.id = event.id;          // null !== undefined → overwrites!
if (event.name !== undefined)
    partial.name = event.name;      // same
if (event.argumentsText !== undefined)
    partial.argumentsText += event.argumentsText;
```

`event.id` is `null` (present field, null value) on continuation chunks, and `null !== undefined` is `true`, so the identity captured from the first fragment is **overwritten with `null`**. The final check `if (!partial.id || !partial.name)` then throws `ProviderTransportError("incomplete_delta")` even though a fully-identified call was streamed.

Note the inconsistency with Prism's own stream accumulator in `dist/providers/openai-compatible.js`, which handles the same wire shape correctly using null-coalescing:

```js
current.id = tool.id ?? current.id;
current.name = tool.function?.name ?? current.name;
```

## Evidence (raw wire capture)

Direct SSE capture against `https://opencode.ai/zen/go/v1/chat/completions`, `model: "mimo-v2.5"`, `stream: true`, one tool definition, prompt forcing a tool call. The `tool_calls` deltas on the wire:

```
chunk #1: [{"index":0,"id":"call_1e94afd18e3447039c72c642","type":"function",
            "function":{"name":"list_files","arguments":""}}]
chunk #2: [{"index":0,"id":null,"type":"function",
            "function":{"name":null,"arguments":"{}"}}]
```

The stream is well-formed: identity in fragment 1, `null` continuation in fragment 2. Via Prism the turn still fails with `Incomplete tool call delta at index 0`, because fragment 2's nulls erase the identity before the reconstruction check.

Capture script (Node, prints every `delta.tool_calls` chunk):

```js
const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: "mimo-v2.5",
    stream: true,
    messages: [{ role: "user", content: "Use the list_files tool to list the current directory. You must call the tool." }],
    tools: [{ type: "function", function: { name: "list_files", description: "List files", parameters: { type: "object", properties: {} } } }],
  }),
});
const reader = res.body.getReader();
// … print every choices[].delta.tool_calls chunk (see above for output)
```

## Suggested fix

Coalesce instead of presence-checking, matching `openai-compatible.js`:

```js
const partial = partials.get(event.index) ?? { argumentsText: "" };
partial.id = event.id ?? partial.id;
partial.name = event.name ?? partial.name;
if (event.argumentsText !== undefined)
    partial.argumentsText += event.argumentsText;
```

This preserves the intended fail-closed contract for genuinely missing identity (no fragment ever carrying id/name) while accepting the standard null-continuation shape.

## Environment

- `@arnilo/prism` 0.4.0 (also present in `@arnilo/prism-providers` `opencode-go` route, which delegates to `sharedOpenAIChatEvents`)
- Provider: `opencode-go`, model `mimo-v2.5` (OpenAI-compatible chat completions route, `strictCompletion: true`)
- Observed from a host application (Clay desktop) and reproduced with a direct SSE capture independent of the host
