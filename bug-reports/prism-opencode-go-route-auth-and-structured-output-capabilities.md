# Bug report: OpenCode Go routing, streaming, and artifact repair failures

## Summary

Prism `0.0.6` has four defects affecting OpenCode Go authoring runs:

1. Anthropic-route requests use Bearer authentication but omit the Anthropic headers required by OpenCode Go, causing HTTP 401 for models such as `qwen3.7-plus`.
2. OpenAI-route discovery declares `structuredOutput: "json_schema"` based on route alone, causing Prism to send `response_format` to models such as `deepseek-v4-pro` that reject it with HTTP 400.
3. The OpenCode Go SSE adapter treats an incomplete response stream as successful completion, producing truncated artifacts reported as successful agent runs.
4. `generateValidateReviseLoop` stops immediately on artifact parse failure, so configured revision attempts never repair malformed or truncated output.

Together these defects prevent otherwise available OpenCode Go models from running reliably through Prism's generate/validate/revise authoring loop.

## Environment

- `@arnilo/prism`: `0.0.6`
- `@arnilo/prism-provider-opencode-go`: `0.0.6`
- OpenCode Go base URL: `https://opencode.ai/zen/go/v1`
- Models reproduced:
  - `qwen3.7-plus`
  - `deepseek-v4-pro`
  - `mimo-v2.5-pro`
- Reproduced: 2026-07-20

No credentials, prompts, generated artifacts, or provider response payloads containing user data are included in this report.

## Defect 1: Anthropic route uses insufficient authentication headers

### Reproduction

Using the same valid OpenCode Go API key:

| Request | Result |
| --- | --- |
| `GET /models` with `Authorization: Bearer <key>` | Success |
| `POST /messages` with only `Authorization: Bearer <key>` | HTTP 401 |
| `POST /messages` with `x-api-key: <key>` and `anthropic-version: 2023-06-01` | HTTP 200 |
| `POST /messages` with both header sets | HTTP 200 |

Prism routes `qwen3.7-plus` to `/messages`, matching OpenCode Go's published endpoint table, but `opencodeOwnedHeaders()` supplies content/session headers and the provider adds only Bearer authorization.

### Observed behavior

A minimal Prism request to `qwen3.7-plus` emits an error after `POST /zen/go/v1/messages` returns HTTP 401. The model produces no usable output.

### Expected behavior

Anthropic-route requests authenticate successfully using the headers required by that route.

### Required Prism fix

For the Anthropic Messages route, add provider-owned:

```http
x-api-key: <OpenCode Go API key>
anthropic-version: 2023-06-01
```

Bearer authorization may remain if OpenCode Go requires it for compatibility, but callers must not be able to override any credential-bearing provider-owned header.

### Regression tests

1. Anthropic-route request includes `x-api-key` and `anthropic-version`.
2. Caller headers cannot replace either provider-owned header.
3. OpenAI-route request does not receive Anthropic-only headers unless explicitly required by the upstream contract.
4. Error/event redaction never exposes the API key from either header.

## Defect 2: OpenAI route overstates JSON Schema structured-output support

### Reproduction

Using `deepseek-v4-pro` through Prism's OpenCode Go provider:

| Request shape | Result |
| --- | --- |
| Plain chat completion | Success |
| Chat completion with one function tool | Success |
| Chat completion with `options.structuredOutput` | HTTP 400 `invalid_request_error` |
| Chat completion with both tool and structured output | HTTP 400 `invalid_request_error` |

Discovered metadata currently reports:

```json
{
  "model": "deepseek-v4-pro",
  "compat": { "route": "openai" },
  "capabilities": { "structuredOutput": "json_schema" }
}
```

The capability appears to be inferred from OpenAI-compatible routing rather than verified model behavior. Prism's generate/validate/revise loop therefore selects native structured output and sends `response_format`, which OpenCode Go's upstream DeepSeek route rejects.

### Observed behavior

The full authoring request reaches `POST /zen/go/v1/chat/completions` and returns HTTP 400 before producing content. The same model/key/endpoint works when structured output is absent.

### Expected behavior

`ModelConfig.capabilities.structuredOutput` is advertised only when that exact model/route supports the corresponding wire contract. Unsupported models use Prism's artifact-loop parsing and validation path without `response_format`.

### Required Prism fix

Do not infer `structuredOutput: "json_schema"` solely from `compat.route === "openai"`. Use an explicit verified model capability map, discovered upstream capability data when authoritative, or leave the capability undefined by default.

For `deepseek-v4-pro`, omit/disable `structuredOutput` until OpenCode Go confirms JSON Schema response-format support.

Automatic retry without `response_format` is not recommended for arbitrary HTTP 400 responses; accurate model metadata avoids masking unrelated invalid requests.

### Regression tests

1. `deepseek-v4-pro` does not advertise JSON Schema structured output.
2. Its generate/validate/revise request uses artifact-loop mode and omits `response_format`.
3. A verified model such as `mimo-v2.5` can still advertise and serialize JSON Schema structured output.
4. Route selection and structured-output capability remain independent properties.

## Defect 3: incomplete OpenCode Go streams are reported as successful

### Reproduction

A full `mimo-v2.5-pro` authoring request returned HTTP 200 and streamed 36 SSE JSON chunks. The accumulated text stopped mid-JSON. The stream contained no `finish_reason` or usage record, but `openAIChatEvents()` yielded `providerDone()` after the iterator ended. Prism returned an `AgentRunResult` with `status: "succeeded"`; downstream parsing then failed.

A smaller canary request completed normally with `finish_reason: "stop"` and usage, proving the provider and credential were generally usable.

### Expected behavior

The provider must distinguish a confirmed terminal completion from EOF, transport truncation, or an incomplete tool-call stream. An incomplete stream must emit a bounded, secret-redacted provider error instead of `done`.

### Required Prism fix

Track terminal stream state in `openAIChatEvents()`:

1. Record terminal `finish_reason` values and the `[DONE]` sentinel where the upstream contract provides them.
2. Validate that accumulated tool-call deltas have complete IDs, names, and JSON arguments.
3. On EOF without a valid terminal state, emit a stable transport error such as `incomplete_stream`; do not emit `providerDone()`.
4. Preserve existing abort, byte-bound, and secret-redaction behavior.
5. Let Prism's bounded provider retry policy handle the resulting provider failure rather than passing truncated text to artifact parsing.

### Regression tests

1. Normal terminal stream emits `done` once.
2. EOF before terminal completion emits `incomplete_stream` and no `done`.
3. Incomplete tool-call deltas emit a stable bounded error.
4. Truncated content cannot produce a successful `AgentRunResult`.
5. Error records contain no partial content, tool arguments, prompts, or credentials.

## Defect 4: parse failures bypass configured revision attempts

### Reproduction

With `maxRevisions: 2`, a truncated first artifact caused `generateValidateReviseLoop` to execute only one provider turn. Its current parse branch returns immediately when `parsed.ok` is false or `parsed.value` is undefined. No repair message is generated and neither available revision is attempted.

This makes a “repaired” evaluation indistinguishable from first-response mode for malformed JSON, despite a three-attempt budget.

### Expected behavior

A parse failure should consume one bounded artifact attempt and, while revision budget remains, invoke a parse-aware repair path. Exhaustion should emit `artifact_failed` with a stable parse-failure reason.

### Required Prism fix

Extend `generateValidateReviseLoop` without weakening bounds:

1. Count a call-free parse failure as an artifact attempt.
2. Pass a bounded parse error to the repairer without including raw model output.
3. Append the repair message and continue while `attempt <= maxRevisions`.
4. Emit `artifact_failed` with stable metadata such as `reason: "artifact_parse_failed"` when exhausted.
5. Keep shared `maxToolRounds` and provider-turn ceiling `1 + maxRevisions + maxToolRounds` unchanged.

### Regression tests

1. Initial malformed JSON plus valid repaired JSON succeeds with `maxRevisions: 1`.
2. Initial malformed JSON performs one turn only with `maxRevisions: 0`.
3. Repeated parse failures stop after exactly `1 + maxRevisions` provider turns.
4. Tool rounds remain shared and do not reset after parse repair.
5. Repair messages expose a bounded parse category, not raw output or secrets.

## Consumer impact and workaround

Synapta currently cannot use affected models for its live authoring acceptance gate:

- `qwen3.7-plus` fails authentication before generation.
- `deepseek-v4-pro` fails native structured-output request validation upstream.
- `mimo-v2.5-pro` intermittently returns truncated JSON that Prism currently marks successful.
- Parse failures consume none of the configured repair budget.

A consumer-side model-ID/header patch would duplicate provider-specific behavior and drift from Prism's model catalog, so Synapta is not adding one. Temporary consumers can disable native structured output for affected OpenAI-route models and supply correct Anthropic headers only if they fully own and secure their provider wrapper.

## Acceptance criteria

- `qwen3.7-plus` completes a minimal `/messages` generation through the Prism provider with a valid OpenCode Go key.
- `deepseek-v4-pro` completes plain, tool-calling, and generate/validate/revise artifact-loop requests without native `response_format`.
- Verified JSON Schema-capable models retain native structured output.
- Incomplete content and tool-call streams fail with stable bounded errors and never emit `done`.
- Parse failures use, and cannot exceed, the configured revision budget.
- Credential headers, partial artifacts, tool arguments, and upstream error details remain secret-redacted.
