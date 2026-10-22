# Hyper OpenAI Route Wire Fixtures

- Recording Date: 2026-10-18
- Model: `deepseek-v4-pro`
- Route: `/v1/chat/completions` (OpenAI Chat wire format)
- Recording Command:
  ```bash
  bun scripts/wire-proxy.mjs --upstream https://hyper.charm.land/v1 --listen 127.0.0.1:8787 \
    --record packages/providers/hyper/src/__tests__/wire/openai --secret-env HYPER_API_KEY
  ```
- Scenarios:
  - `text.json`: Single-turn streaming completion with delta tokens and usage reporting.
  - `tool-loop.json`: Two-turn function calling loop (`get_weather` tool invocation with reasoning replay then synthesis).
  - `cache.json`: Warm-prefix replay with `cached_tokens` reporting.
  - `structured-output.json`: Structured JSON Schema output completion.
  - `error.json`: Invalid model request yielding HTTP 400 `invalid_request_error`.
  - `error-402.json`: Insufficient credits yielding HTTP 402 `billing_error`.
