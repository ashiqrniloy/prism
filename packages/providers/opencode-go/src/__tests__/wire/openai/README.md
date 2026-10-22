# OpenCode Go OpenAI Chat Completions Wire Recordings

These fixtures record the OpenCode Go `/zen/go/v1/chat/completions` endpoint for offline conformance testing via `providerConformance({ recordings })`.

## Model

Recorded against `mimo-v2.5` (curated featured model on the OpenAI Chat Completions route with tool calling, reasoning replay via `reasoning_content`, and verified `json_schema` structured output support).

## Scenarios

- `text.json`: Basic single-turn text completion with streaming and usage reporting.
- `tool-loop.json`: Two-turn tool execution loop demonstrating tool call emission and subsequent replay with `reasoning_content` preservation and tool result feedback.
- `cache.json`: Warm-prefix completion verifying `prompt_tokens_details.cached_tokens` reporting.
- `structured-output.json`: Native JSON Schema completion verifying `response_format` serialization and streaming.
- `error.json`: Standard 400 error payload for unknown model dispatch.
