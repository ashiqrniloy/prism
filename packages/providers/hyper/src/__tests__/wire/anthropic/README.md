# Hyper Anthropic Route Wire Fixtures

- Recording Date: 2026-10-17
- Model: `qwen3.6-plus`
- Route: `/v1/messages` (Anthropic Messages wire format)
- Recording Command:
  ```bash
  bun scripts/wire-proxy.mjs --upstream https://hyper.charm.land/v1 --listen 127.0.0.1:8787 \
    --record packages/providers/hyper/src/__tests__/wire/anthropic --secret-env HYPER_API_KEY
  ```
- Scenarios:
  - `text.json`: Single-turn streaming completion with ping event and usage merging.
  - `tool-loop.json`: Two-turn function calling loop (`lookup` tool invocation then synthesis).
  - `thinking.json`: Extended thinking block with signature delta and assistant replay.
  - `cache.json`: Ephemeral prompt caching write turn followed by cache read turn.
  - `error.json`: Invalid model request yielding HTTP 400 `invalid_request_error`.
