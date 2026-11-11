# Changelog

## [Unreleased]

- Add `@arnilo/prism-ai/litellm`: one Chat Completions route to a host-run LiteLLM Proxy, conservative
  per-group discovery from `/model/info` (fallback `/v1/models`), a Prism-minted `x-litellm-call-id` with
  `x-litellm-*` response telemetry on `usage.metadata.litellm`, cost from `x-litellm-response-cost` with the
  catalog as fallback, marker-free prompt caching with a per-model `anthropic-blocks` opt-in, and error mapping
  including the proxy's 422 budget refusal and 413 `context window limit` overflow (plan 214 Task 2).
- Add `litellmSpendLogs` and the pure `normalizeSpendRow`: read the proxy's `/spend/logs` for a set of call ids
  (≤20 indexed single-id reads, otherwise ≤50 paged `/spend/logs/v2` range reads), poll for rows the proxy has
  not flushed yet (default 24 s, cap 60 s), filter every row to a requested id, and return
  `{ callId, model, modelGroup, modelId, spend, promptTokens, completionTokens, cacheReadTokens, startTime,
  endTime, status }` with `messages`/`response`/`api_key`/`api_base`/`metadata` never copied (plan 214 Task 3).
