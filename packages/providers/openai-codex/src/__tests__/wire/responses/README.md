# OpenAI Codex Responses Wire Recordings

These fixtures record the Sign in with ChatGPT `/v1/responses` route for offline conformance testing via
`providerConformance({ recordings })`.

## Model

Recorded against `gpt-6.1-sol` on a sign-in grant on 2026-10-25 (plan 204 Tasks 1 and 5). Every exchange uses
`store: false` and `stream: true`; the successful ones carry `include: ["reasoning.encrypted_content"]` where the
client asked for reasoning. The `encrypted_content` payloads are replaced with a synthetic marker so no account-bound
blob is committed; the event shapes, ids, usage numbers, and text are the captured ones.

## Scenarios

- `text.json`: one plain turn (`Say exactly: Hello, world!`), 13 events, usage `input_tokens: 13`.
- `tool-loop.json`: two turns. Turn 1 answers with an empty message plus a `function_call` for `get_weather`;
  turn 2 sends the `function_call` and its `function_call_output` back and answers `21°C and sunny`. The captured
  turn 1 reasoned to the call without emitting a reasoning item, so the replay turn carries no reasoning input —
  that is what the live wire did.
- `structured-output.json`: `text.format` `json_schema` (`capital`), answered with valid JSON plus a real encrypted
  reasoning item.
- `image.json`: one `input_image` (an 8×8 PNG, `data:` URL) answered `Gray`, with a real encrypted reasoning item.
- `cache.json`: three turns sharing one byte-identical ~7 KB prefix with `prompt_cache_key` set; cached/input was
  `2048/2196 → 2048/2224 → 2048/2243` (0.921 and 0.913 reuse). The same probe without a key measured 0.0 reuse on
  all three turns.
- `error-usage-limit.json`: **hand-built** from the documented 429 body (plan 204 Task 1 research table,
  `subscription_sharing_usage_limit_exceeded`). A plan usage limit cannot be reproduced on demand without spending
  the account's allowance, so it is marked rather than captured.
- `error-unsupported-capability.json`: **hand-built** 400. The captured rejection for a refused field is
  `{"detail":"Unsupported parameter: <name>"}`; the fixture adds the documented `code` and `param` so the mapper is
  exercised on both shapes.
- `error-invalid-user.json`: **hand-built** 401 `subscription_sharing_invalid_user`, the code that asks for a new
  sign-in rather than a retry.

Encrypted reasoning replay is asserted in `package.test.ts` from the real item in `structured-output.json`, so the
byte-equal round trip is covered without a recorded turn that never happened.
