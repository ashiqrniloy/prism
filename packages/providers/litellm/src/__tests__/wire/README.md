# LiteLLM wire fixtures

Recorded against a host-run LiteLLM Proxy (`ghcr.io/berriai/litellm-database:v1.106.6`, digest
`sha256:7ef0e78fe00ad5ea7ea45666cc1d1f02cb7076aee69091543bf397de52db33ce`) on 2026-10-31, plan 214
Task 2. The backends were Cloudflare Workers AI free-plan models behind a `cloudflare/*` deployment; the
group names (`prism-free/chat`) come from the scratch pool config in Task 1b.

Every `responseBody` is a raw capture (SSE for successes, JSON for refusals). Credentials and request
headers are removed; response `headers` keep only the `x-litellm-*` values Prism reads. `requestBody` is
the request the capture sent, with Prism's own shape for the content blocks the offline replayer rebuilds
(`image.json` stores the image as `{type:"image", mimeType, data}`).

| file | exchange |
| --- | --- |
| `text.json` | streamed text, usage chunk, `x-litellm-call-id`/`-model-id`/`-model-group` headers |
| `stream.json` | second streamed text capture (different prompt), same shape |
| `tool-loop.json` | two turns: a streamed `tool_calls` reply, then the same conversation with the tool result |
| `thinking.json` | streamed `reasoning_content` deltas plus the final text |
| `image.json` | streamed vision request (1×1 PNG) |
| `cache.json` | three turns over one ~21 kB identical prefix; `cached_tokens` is `0` on all three |
| `error-unauthorized.json` | 401 `token_not_found_in_db`, body prints the key fingerprint and hash |
| `error-unknown-model.json` | 400 `invalid_request_error`, unknown model group |
| `error-budget.json` | 422 `budget_exceeded` |
| `error-rate-limit.json` | 429 `throttling_error` with `Retry-After: 60`, body prints the key hash |
| `error-cooldown.json` | 429 from the router with no usable deployment |
| `error-overflow.json` | 413 whose body says `context window limit` |

`model-info.json` is a `GET /model/info` response from the same instance, trimmed to the fields Prism
reads (`model_name`, `litellm_params.model`, and the `model_info` window/cost/capability flags). It holds
three real rows: two deployments of `prism-free/chat` and one `prism-free/priced` deployment.

Notes:

- The free pool reports `supports_vision`, `supports_reasoning` and `supports_response_schema` as `null`,
  so discovery claims none of them; `litellm.test.ts` proves the conservative rules with hand-built rows
  instead of inventing capability flags in this fixture.
- No `cache-blocks` recording exists: the free pool answers `cached_tokens: 0` on every turn and the
  policy is marker-free by default. The opt-in route is asserted from the captured request body in
  `litellm.test.ts`.
- `error-overflow.json`'s request body is shortened to one message; the 108 kB prompt was only there to
  trigger the backend refusal, and the response is the raw capture.

`spend-logs/` holds the `/spend/logs` responses used by `spend-logs.test.ts`. The probe in plan 214 Task 1b
recorded only aggregates for the spend endpoint (`results/spend-scope.json`: one row per key, owners, and an
11.8 s first-visibility delay), not a raw row, so these files are **derived from the pinned schema** rather
than captured: `LiteLLMSpendLogs` / `SpendLogsPayload` at `v1.106.6`
(`litellm/proxy/_types.py:4346-4380`, `litellm/proxy/spend_tracking/spend_tracking_utils.py:794-838`). Every
column, the `{request_id}_cache_hit{epoch}` suffix rule and the two envelopes (`/spend/logs` → bare list,
`/spend/logs/v2` → `{data,total,page,page_size,total_pages}`) come from that source; the canary strings
(`PROMPT-CANARY-…`, `HASHED-KEY-CANARY`) are ours, and `by-request-id.json` deliberately contains a row for
another tenant so the test can prove the local id filter drops it.
