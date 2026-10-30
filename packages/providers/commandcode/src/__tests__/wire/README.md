# Command Code wire fixtures

Recorded against the official Provider API on 2026-10-28 (plan 205 Task 1b) and replayed offline by
`providerConformance`. Every `responseBody` is a raw gateway recording, byte-for-byte.

`requestBody` is what *this* provider sends for that scenario (serialized through the same codecs the
runtime uses), so a fixture documents the request shape Prism produces as well as the reply the
gateway returned. The capture model is in each `responseBody`'s `model` field:

| directory | capture model | shipped exemplar |
| --- | --- | --- |
| `chat/` | `reflection/beam:free` (free) | `minimax/minimax-m3.1-flash` |
| `responses/` | `reflection/beam:free` (free) | `gpt-5.6-luna` |
| `messages/` | `claude-haiku-5-5` (paid) | `claude-haiku-5-5` |

The chat and responses exemplars were captured on the free model because the wire shape is the same;
the request bodies name the exemplar so a reader sees what a user of the static catalog sends. Streams
are real: `responses/` keeps the `event:` framing, `messages/` the `message_start` … `message_stop`
sequence, and `chat/` the `data: [DONE]` terminal marker that the strict-completion check requires.

Notes on the recordings:

- `*/cache.json` are three-turn arrays; the request bodies carry the levers (`prompt_cache_key` /
  `x-client-request-id` on Responses, `cache_control` on Messages) and the replies carry the usage
  fields the codec maps.
- `messages/error-thinking-enabled.json` preserves the gateway's refusal of `thinking.type.enabled`
  on Claude 5.x — the reason the route hook sends `adaptive`.
- `chat/error-overflow.json` and `responses/error-overflow.json` preserve the over-context body with
  the upstream message wrapped as a JSON string inside `error.message`.
- `responses/structured-output.json` and `chat/structured-output.json` are larger than the rest: the
  free capture model reasons for a long time before emitting JSON.
