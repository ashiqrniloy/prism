# Kilo wire fixtures

Recorded through the Kilo AI Gateway on 2026-10-31 (plan 213 Tasks 1b and 2) and replayed offline by
`providerConformance`. Every `responseBody` is a raw gateway SSE recording, byte-for-byte, with
credentials and request headers removed.

`requestBody` is the request Prism sends for that scenario, so a fixture documents both directions.
Because the reference account has no credit, every capture used the free
`nvidia/nemotron-3.5-super-vl:free` model while `requestBody.model` names the shipped exemplar for that
wire (`google/gemma-4-26b-a4b-it`, `openai/gpt-6-luna`, `anthropic/claude-haiku-5.5`). The reply's own
`model` field therefore names the free capture model. Wire shape is endpoint-determined, not
model-determined, on this gateway (plan 213 Task 1b).

| directory | capture model | shipped exemplar |
| --- | --- | --- |
| `chat/` | `nvidia/nemotron-3.5-super-vl:free` | `google/gemma-4-26b-a4b-it` |
| `responses/` | `nvidia/nemotron-3.5-super-vl:free` | `openai/gpt-6-luna` |
| `messages/` | `nvidia/nemotron-3.5-super-vl:free` | `anthropic/claude-haiku-5.5` |

Notes:

- `*/text.json` and `*/thinking.json` share one capture per wire; it streams reasoning and text.
- `*/tool-loop.json` records a real streamed tool call. Tool-result continuation was verified live but
  is not replayed here.
- `*/cache.json` is a three-turn array over one fresh ~6.4k-token prefix; the warm turns report 8672
  cached tokens on every wire. The gateway places the breakpoints itself, so the levers in the request
  are parity, not causation.
- `messages/image.json` stores the image as Prism's `{type:"image", mimeType, data}` block so the
  offline replayer can reconstruct it; the provider serializes the Anthropic `source` block.
- `chat/error-unauthorized.json` (401, `error` is an object), `chat/error-credits.json` (402 with a
  negative balance) and `*/error-overflow.json` (400 with `context_length_exceeded`) are raw captures.
  403, 413 and 429 are covered by synthetic responses in `kilo.test.ts` because the free account
  cannot produce them.
