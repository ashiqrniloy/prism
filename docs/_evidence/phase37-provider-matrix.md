# Phase 37 — First-party provider primitive review and 19-package matrix

Review-only freeze. **no core primitive** added. No production adapter, retry loop, or HTTP parser changed.

Recorded 2026-08-28. Network-free code/docs audit + fake-fetch fixtures + one local serializer/SSE microbench. Live canaries stay **protected-only**.

Cell legend: **supported** (code + offline proof) · **gap** (code exists, conformance helper missing) · **failing** (docs/API require mapping that code drops or skips) · **host-owned** (intentionally unmapped) · **protected-only** (live/`test:live` only).

## Shared primitives (reuse these)

| Primitive | Location | Decision |
| --- | --- | --- |
| SSE / bounded bodies / JSON args | `src/providers/transport.ts` (`readSseEvents`, `readSseData`, `readBoundedResponseText`, `readBoundedResponseJson`, `parseJsonObjectArguments`, `httpStatusError`, `parseRetryAfterMs`) | Reuse. Do not copy SSE/HTTP parsers. |
| OpenAI Chat serializers + usage | `src/providers/openai-primitives.ts` (`serializeOpenAIChatMessage`, `serializeOpenAITool`, `mapOpenAIChatUsage`, structured-output helpers) | Reuse on Chat Completions routes. |
| OpenAI-compatible factory | `src/providers/openai-compatible.ts` (`createOpenAICompatibleProvider`, `openAIChatEvents`) | Reuse. Sends **no** `prompt_cache_key` / `cache_control`. |
| Media capability + bounded upload | `src/providers/media.ts` | Reuse. Capability-gated; fail closed. |
| Cache intent | `src/cache-helpers.ts` (`sanitizeCacheKey`, `mapCacheRetention`, `applyCacheControl`) | Reuse. Stamps **messages**, not `tools[]` / native system arrays. |
| Conformance | `src/testing/provider-conformance.ts` | Reuse. Do not add a second assertion library. |
| Runtime retry / abort | `AgentConfig.retry` / `RunOptions.retry` / `ProviderRequest.signal` | Runtime-owned. Packages must not add HTTP retry loops. |
| Canonical JSON Schema | DeepSeek-only `packages/prism-providers/src/deepseek/cache.ts` `canonicalizeJsonSchema` | **Do not copy.** Task 2 promotes one shared primitive. Current helper also sorts every string array (too aggressive for `prefixItems` / examples). |

Rejected this freeze: provider-local SSE, extra retry loops, `VersionManager`, collapsed desktop-style APIs, Gemini `cachedContents` lifecycle, Bedrock Converse `cachePoint`, Vertex cache-resource CRUD, Changesets.

## Frozen packages (19)

Adapter identifiers are the family subpaths `@arnilo/prism-providers/<adapter>` (enforced by `scripts/phase37-provider-matrix.test.mjs`).

| Package | Dir | Protocol | Setup I/O | Credentials | Discovery |
| --- | --- | --- | --- | --- | --- |
| `@arnilo/prism-providers/ai-sdk` | `packages/prism-providers/src/ai-sdk` | Host `LanguageModelV4.doStream` | supported — wrap only, no fetch | host-owned model auth | host-owned (no `list*Models`) |
| `@arnilo/prism-providers/alibaba` | `packages/prism-providers/src/alibaba` | DashScope OpenAI-compatible Chat Completions SSE | supported — `createAlibabaProviderPackage` does not call `listAlibabaModels` | `api_key` via `resolveCredentialValue` | caller-gated `listAlibabaModels` (`GET {base}/models`); setup-zero **test gap** |
| `@arnilo/prism-providers/anthropic` | `packages/prism-providers/src/anthropic` | Native Messages SSE | supported — zero-fetch test | `x-api-key` | caller-gated `listAnthropicModels` |
| `@arnilo/prism-providers/azure` | `packages/prism-providers/src/azure` | Azure/Foundry OpenAI-compatible Chat Completions | supported — registers host models only | host Entra bearer or Azure `api-key`; credential resolved **once** | host-owned catalog |
| `@arnilo/prism-providers/bedrock` | `packages/prism-providers/src/bedrock` | Bedrock Runtime OpenAI-compatible ` /openai/v1` + SigV4 | supported — no catalog fetch | host IAM/IRSA via `signAwsRequest` | host-owned catalog |
| `@arnilo/prism-providers/clinepass` | `packages/prism-providers/src/clinepass` | OpenAI-compatible **stream-only** | supported — zero-fetch test | `api_key` (`CLINE_API_KEY`) | none (static `cline-pass/*`) |
| `@arnilo/prism-providers/deepseek` | `packages/prism-providers/src/deepseek` | OpenAI-compatible Chat Completions SSE | supported — zero-fetch test | `api_key` | caller-gated `listDeepSeekModels` |
| `@arnilo/prism-providers/google` | `packages/prism-providers/src/google` | Gemini `generateContent?alt=sse` | supported — zero-fetch test | `x-goog-api-key` | caller-gated `listGoogleModels` |
| `@arnilo/prism-providers/kimi` | `packages/prism-providers/src/kimi` | Default Anthropic `/messages`; opt-in Moonshot Chat Completions | supported — zero-fetch test | `authorization` + `x-api-key` on Coding route | caller-gated `listKimiModels` (Moonshot `GET /v1/models`) |
| `@arnilo/prism-providers/commandcode` | `packages/prism-providers/src/commandcode` | Dual: OpenAI Chat or Anthropic Messages (`compat.route`, server-enforced claude-* routing) | supported — zero-fetch test | `authorization` + `x-api-key` on messages route | caller-gated `listCommandCodeModels` |
| `@arnilo/prism-providers/hyper` | `packages/prism-providers/src/hyper` | Triple: OpenAI Chat (default), Anthropic Messages, Responses pass-through (`compat.route`) | supported — zero-fetch test | `authorization` (+ `x-api-key` on messages route) | caller-gated `listHyperModels`; operator-gated `getHyperCredits` |
| `@arnilo/prism-providers/neuralwatt` | `packages/prism-providers/src/neuralwatt` | OpenAI-compatible SSE + comment telemetry | supported — zero-fetch test | `api_key` | caller-gated `listNeuralWattModels`; `getNeuralWattQuota` also caller-gated |
| `@arnilo/prism-providers/ollama` | `packages/prism-providers/src/ollama` | OpenAI-compatible Chat Completions SSE | supported — setup does not call `listOllamaModels` | optional bearer | caller-gated `listOllamaModels`; setup-zero **test gap** |
| `@arnilo/prism-providers/model-discovery` | `packages/prism-providers/src/model-discovery` | Model-list/capability discovery only (plan 062) — no inference surface, nothing to cache | network-free tests | bearer (OpenAI-compatible) / `x-goog-api-key` (Google) | `listModels` with provenance + TTL cache; not a provider adapter |
| `@arnilo/prism-providers/openai` | `packages/prism-providers/src/openai` | Responses SSE (`store: false`); Codex + Realtime seams | supported — zero-fetch test | `api_key`; Codex host-invoked OAuth | caller-gated `listOpenAIModels` |
| `@arnilo/prism-providers/opencode-go` | `packages/prism-providers/src/opencode-go` | Dual: OpenAI Chat or Anthropic Messages (`compat.route`) | supported — zero-fetch test | `authorization` / `x-api-key` by route | caller-gated `listOpenCodeGoModels` |
| `@arnilo/prism-providers/openrouter` | `packages/prism-providers/src/openrouter` | OpenAI-compatible Chat Completions SSE | supported — zero-fetch test | `api_key` | caller-gated `listOpenRouterModels`; setup catalog is host `models:` |
| `@arnilo/prism-providers/vertex` | `packages/prism-providers/src/vertex` | Vertex OpenAPI-compatible Chat Completions | supported — registers host models only | host ADC/WIF bearer; credential **once** | host-owned catalog |
| `@arnilo/prism-providers/xai` | `packages/prism-providers/src/xai` | OpenAI-compatible Completions SSE | supported — zero-fetch test | `api_key`; SuperGrok device-code OAuth host-invoked | caller-gated `listXaiModels` |
| `@arnilo/prism-providers/zai` | `packages/prism-providers/src/zai` | OpenAI-compatible Chat Completions SSE | supported — zero-fetch test | `api_key` | caller-gated `listZaiModels` |

## Stream, abort, media, tools, reasoning, structured output

| Package | Stream completion | Abort | Media | Tools | Reasoning | Structured output |
| --- | --- | --- | --- | --- | --- | --- |
| `@arnilo/prism-providers/ai-sdk` | supported — `mapAiSdkStream` finish/error | supported (package abort tests; not `assertAbortIsObserved`) | host-declared parts | supported — client + provider-hosted authority | host-owned; `reasoning-delta` → thinking | supported — v4 mapping; `strict` fail-closed |
| `@arnilo/prism-providers/alibaba` | supported — `assertProviderStreamConforms` | **gap** — no `assertAbortIsObserved` | text + image (capability-gated) | supported — tool deltas | Qwen thinking / `reasoning_content` | OpenAI-compatible `json_schema` |
| `@arnilo/prism-providers/anthropic` | supported | supported | text, image, PDF document/file | supported — deltas + complete | thinking blocks | capability-gated native mapper |
| `@arnilo/prism-providers/azure` | inherited `strictCompletion` default | **gap** — wrapper checks aborted then inner factory; no package `assertAbortIsObserved` | host/model capability | inherited Chat Completions tools | host `compat`/`extra` | inherited Chat Completions |
| `@arnilo/prism-providers/bedrock` | inherited `strictCompletion` default | **gap** (same inner factory) | host/model capability | inherited | host `compat`/`extra` | inherited |
| `@arnilo/prism-providers/clinepass` | supported | supported (`live.test.ts` + offline headers/stream) | text | tool deltas | per-model `reasoning_effort` | `json_schema` |
| `@arnilo/prism-providers/deepseek` | supported | supported | text | tool deltas; tool-turn `reasoning_content` replay | `thinking` / `reasoning_effort` | `json_schema` |
| `@arnilo/prism-providers/google` | supported | supported | text, image, audio, document/file | complete function calls (not deltas) | `thinkingConfig` | capability-gated |
| `@arnilo/prism-providers/kimi` | supported | supported | Coding: text + PDF; Moonshot: text/image by model | deltas on both routes | route-native thinking | capability-gated |
| `@arnilo/prism-providers/neuralwatt` | supported | supported | text + image on listed models | deltas | `reasoning_effort` / thinking budget | `json_schema` |
| `@arnilo/prism-providers/ollama` | supported | **gap** — no `assertAbortIsObserved` | text + image | deltas | reasoning effort | OpenAI-compatible |
| `@arnilo/prism-providers/openai` | supported — 8-hop continuation + `incomplete_delta` | supported | text, image, audio, file, document | host + provider-hosted | Responses `reasoning` | Responses `json_schema` |
| `@arnilo/prism-providers/opencode-go` | supported | supported | OpenAI route text/image; Anthropic route PDF | deltas | route-native thinking / `reasoning_content` | `json_schema` / Anthropic mapper |
| `@arnilo/prism-providers/openrouter` | supported | supported | text, image | deltas | reasoning replay + routing metadata | `json_schema` when advertised |
| `@arnilo/prism-providers/vertex` | inherited `strictCompletion` default | **gap** | host/model capability | inherited | host `compat`/`extra` | inherited |
| `@arnilo/prism-providers/xai` | supported | supported | text, image | deltas | `reasoning_content` replay | `json_schema` |
| `@arnilo/prism-providers/zai` | supported | supported | text, image | deltas | `reasoning_content` + thinking knobs | `json_schema` |

`assertUsageAccounting` is unused as a named helper; packages pass `expect.usage` into `assertProviderStreamConforms` instead. Not a wire bug.

## Cache kind / hints / usage

| Package | Kind | Hints | Usage mapping | Multi-turn note |
| --- | --- | --- | --- | --- |
| `@arnilo/prism-providers/ai-sdk` | host-owned | no Prism cache payload | `finish.usage.inputTokens.cacheRead`/`cacheWrite` | host model owns keys |
| `@arnilo/prism-providers/alibaba` | implicit default; optional `cache_control` | `applyCacheControl` only when kind/mode opt-in; max 4 | `cached_tokens` → read; `cache_creation_input_tokens` → write | implicit prefix if no markers |
| `@arnilo/prism-providers/anthropic` | `cache_control` | message anchors + `ttl: "1h"` for long; `system_prompt` marker serializes `system` as native text blocks via shared `systemCacheControlField()` | `cache_read_input_tokens` / `cache_creation_input_tokens` | tools-schema `cache_control` (documented Anthropic tools\[\] marking) still **deferred** — `location: "tools"` anchors a message, not `tools[]` |
| `@arnilo/prism-providers/azure` | none / host-owned | no Prism cache fields | Chat Completions `cached_tokens` if Azure returns it | Azure cache policy stays host-owned |
| `@arnilo/prism-providers/bedrock` | none / host-owned | no `cachePoint` / Converse mapping | none invented | native Bedrock cache is **host-owned** (defer) |
| `@arnilo/prism-providers/clinepass` | implicit | none | `cached_tokens` / `prompt_cache_hit_tokens` when present | stream-only gateway |
| `@arnilo/prism-providers/deepseek` | implicit | none; tool JSON canonicalized locally | `prompt_cache_hit_tokens` → `cacheReadTokens` | resend prefix from token 0 |
| `@arnilo/prism-providers/google` | none (implicit upstream possible) | no Prism marker; `extra.cachedContent` host escape hatch | `cachedContentTokenCount` → `cacheReadTokens` | explicit Gemini cache resources **host-owned** |
| `@arnilo/prism-providers/kimi` | implicit default; optional `cache_control` on Coding | same Anthropic helper (system markers preserved via `systemCacheControlField()`); Moonshot sends none | Anthropic read/create tokens; Moonshot `cached_tokens` | Coding-route system markers fixed in Task 3; Moonshot clean per conformance |
| `@arnilo/prism-providers/neuralwatt` | implicit | none | `cached_tokens` → read; write never fabricated | full history resend |
| `@arnilo/prism-providers/ollama` | implicit | none | no cached-token field → `cacheReadTokens` stays undefined | KV reuse automatic |
| `@arnilo/prism-providers/openai` | `openai_key` | `prompt_cache_key` + gated `prompt_cache_retention: "24h"`; GPT-5.6+ (`explicitBreakpoints`) map `cache.breakpoints`/`cache.mode: "on"` to `prompt_cache_options: { mode: "explicit" }` + `prompt_cache_breakpoint` markers (≤4); resolved fields win over `extra` | `input_tokens_details.cached_tokens` → read; `cache_write_tokens` → write | legacy `cache.key`/`cache.retention` not read (legacy `cacheKey`/`cacheRetention` only) |
| `@arnilo/prism-providers/opencode-go` | route-specific | `x-opencode-session`; Anthropic `cache_control` (system markers preserved); OpenAI route none | per-route cached/write tokens | Anthropic-route system marker fixed in Task 3 |
| `@arnilo/prism-providers/openrouter` | `cache_control` | top-level automatic `cache_control` or selected markers; `session_id` | `cached_tokens` / `cache_write_tokens` | sticky routing; `cache.key` not read (legacy `cacheKey`/`sessionId` only) |
| `@arnilo/prism-providers/vertex` | none / host-owned | no cached-content lifecycle | none invented | Vertex explicit cache CRUD **host-owned** (defer) |
| `@arnilo/prism-providers/xai` | implicit | `x-grok-conv-id` from `cache.key` ?? `cacheKey` ?? `sessionId` | `cached_tokens` → read | replay `reasoning_content` or prefix breaks |
| `@arnilo/prism-providers/zai` | implicit | none | `cached_tokens` / `cache_write_tokens` | GLM automatic context cache |

`applyCacheControl` `location: "tools"` stamps a tool **message**, not Anthropic `tools[]`. `toTool` in Anthropic/Kimi/OpenCode Go does not emit `cache_control` on tool schemas. Tools-schema caching stays **deferred** for native Anthropic-compatible routes (out of Task 5's named-provider list; fix with Task 3-family work if hosts ask).

## Task 7 gate run (2026-08-28)

Full offline + gated run, all green unless noted; every skip explicit:

| Gate | Result |
| --- | --- |
| `npm run build` / `npm run typecheck` | pass |
| `npm run lint` / `npm run format:check` | pass (format auto-fix applied to task 4–6 edits) |
| `npm test` (root suites + all 17 provider workspaces + release/tooling/budget gates + phase37 matrix freeze) | pass, 0 fail |
| `npm run pack:dry-run` (root + all workspaces) | pass |
| `PRISM_LIVE_PROVIDER_TESTS=1 npm test --workspaces --if-present` | 2225 tests, 2179 pass, 0 fail, 46 skips |
| Protected canary script `scripts/live-canary.mjs` (`PRISM_LIVE_CANARIES=1`) | fails closed locally with explicit missing-env list (provider/MCP/A2A/Brave secrets live only in the protected `live-canaries` CI environment; scheduled workflow owns the green matrix) |
| `npm run release:gate` | blocked on `PRISM_TEST_POSTGRES_URL` (explicit; durable Postgres conformance requires a Postgres URL — no local server) |

Explicit live-run skips (env-gated, no inferred evidence): provider live probes (`PRISM_LIVE_DASHSCOPE_KEY`, compaction-LLM and observational-memory provider smokes), PostgreSQL durable suites (`PRISM_TEST_POSTGRES_URL`), Docker sandbox matrix, Playwright browser matrix.

The two documented "not implemented" claims (DeepSeek Anthropic-compatible route, xAI `grok-4.5` Responses) are intentional scope statements matching this matrix — not stale.

## Task 6 wrapper verdict (2026-08-28)

AI SDK + Azure + Bedrock + Vertex validated against their declared protocols (no native-protocol expansion):

| Package | Setup zero I/O | Abort | Truncated stream | Endpoint/credential ownership | Native cache boundary |
| --- | --- | --- | --- | --- | --- |
| `@arnilo/prism-providers/ai-sdk` | no factory/discovery by design (`createAiSdkProvider` only wraps host model) | covered (`assertAbortIsObserved`-style + mid-stream abort) | **fixed**: stream without `finish` part now fails loudly (`AiSdkProviderError model_error`), previously synthesized `done` | host-owned auth/transport | host-owned (no invented cache fields; usage `inputTokens.cacheRead/cacheWrite` → Prism) |
| `@arnilo/prism-providers/azure` | added `setup()` zero-fetch + zero-credential test | added | added | privatelink host + api-key/bearer proven | Azure cache policy host-owned; body clean via `assertNoForeignCacheFields`; `cached_tokens` → read |
| `@arnilo/prism-providers/bedrock` | added | added | added | VPCE host + SigV4 + security token proven | `Converse cachePoint` unsupported by design; body clean even with Prism cache hints |
| `@arnilo/prism-providers/vertex` | added | added | added | ADC bearer + custom host proven | cached-content lifecycle unsupported by design; body clean even with Prism cache hints |

Converse `cachePoint` and Vertex cached-content lifecycle stay host-owned per plan (separate packages only if explicitly requested).

## Task 5 parity verdict (2026-08-28)

All ten named providers verified: implicit/none routes serialize no foreign cache fields (`assertNoForeignCacheFields`), documented usage variants normalize via the shared compatible/OpenRouter usage mappers, reasoning replay keeps second-turn prefixes valid (xAI/Z.AI/DeepSeek `reasoning_content`), and provider setup performs zero fetch (`assertNoFetches` + per-package setup tests). Fixed in Task 5: OpenRouter `session_id` now reads structured `cache.key` first (parity with xAI). Alibaba provider-owned `authorization` precedence now proven with the shared assertion (was a noted gap).

## Headers, retry, secrets, live canary

| Package | Provider-owned headers win | Retry ownership | Error body bound/redact | Secrets out of metadata/events | Live canary |
| --- | --- | --- | --- | --- | --- |
| `@arnilo/prism-providers/ai-sdk` | n/a HTTP; host transport | runtime + host model | adapter redactor on errors | supported — opaque metadata omitted | protected-only host V4 model |
| `@arnilo/prism-providers/alibaba` | supported — `assertProviderOwnedHeadersWin` (added Task 5) | runtime | `readBoundedResponseText` + `redactSecrets` on discovery | supported on discovery mapper | protected-only `PRISM_LIVE_DASHSCOPE_KEY` |
| `@arnilo/prism-providers/anthropic` | supported | runtime; `parseRetryAfterMs` via `httpStatusError` | bounded + redact | supported `assertNoSecretLeak` | protected-only `PRISM_LIVE_PROVIDER_TESTS=1` + `ANTHROPIC_API_KEY` |
| `@arnilo/prism-providers/azure` | inherited inner factory (auth after caller) | runtime | bounded via compatible factory | credential not in model metadata | protected-only host workload identity |
| `@arnilo/prism-providers/bedrock` | SigV4 `authorization` applied after unsigned headers | runtime | bounded via compatible factory | IAM keys not in model metadata | protected-only host IAM/IRSA |
| `@arnilo/prism-providers/clinepass` | supported | runtime | bounded | supported | protected-only `CLINE_API_KEY` |
| `@arnilo/prism-providers/deepseek` | supported | runtime | bounded | supported | protected-only `DEEPSEEK_API_KEY` |
| `@arnilo/prism-providers/google` | supported (`x-goog-api-key` wins) | runtime | bounded | supported | protected-only `GOOGLE_API_KEY` / `GEMINI_API_KEY` |
| `@arnilo/prism-providers/kimi` | supported | runtime | bounded | supported | protected-only `KIMI_API_KEY` |
| `@arnilo/prism-providers/neuralwatt` | supported | runtime retry; **`classifyNeuralWattError` is metadata only** (Retry-After / `retry_strategy`) — no extra HTTP loop | bounded | supported | protected-only `NEURALWATT_API_KEY` |
| `@arnilo/prism-providers/ollama` | **gap** | runtime | bounded on discovery | discovery mapper redacts | protected-only host/daemon (no `live.test.ts`) |
| `@arnilo/prism-providers/openai` | supported | runtime | bounded | supported | protected-only `OPENAI_API_KEY`; hosted/Realtime separate |
| `@arnilo/prism-providers/opencode-go` | supported | runtime | bounded | supported | protected-only `OPENCODE_API_KEY` |
| `@arnilo/prism-providers/openrouter` | supported | runtime | bounded | supported | protected-only `OPENROUTER_API_KEY` |
| `@arnilo/prism-providers/vertex` | inherited inner factory | runtime | bounded via compatible factory | ADC token not in model metadata | protected-only host ADC/WIF |
| `@arnilo/prism-providers/xai` | supported | runtime | bounded | conv-id is not OAuth token | protected-only `XAI_API_KEY`; SuperGrok `PRISM_LIVE_XAI_OAUTH=1` |
| `@arnilo/prism-providers/zai` | supported | runtime | bounded | supported | protected-only `ZAI_API_KEY` |

CI `.github/workflows/live-canaries.yml` is a **restricted four-protocol** canary (generic provider URL + MCP + A2A + Brave), not the 17-package `test:live` matrix. Per-package live files skip unless `PRISM_LIVE_PROVIDER_TESTS=1` (Alibaba uses `PRISM_LIVE_DASHSCOPE_KEY`). Default `npm test` stays network-free.

## Explicit cache field claims

Status **supported** means the Source file contains the Field token. **failing** / **host-owned** still cite the official URL.

| Package | Field | Status | Source | Official |
| --- | --- | --- | --- | --- |
| `@arnilo/prism-providers/openai` | prompt_cache_key | supported | packages/prism-providers/src/openai/cache.ts | https://developers.openai.com/api/docs/guides/prompt-caching |
| `@arnilo/prism-providers/openai` | prompt_cache_retention | supported | packages/prism-providers/src/openai/cache.ts | https://developers.openai.com/api/docs/guides/prompt-caching |
| `@arnilo/prism-providers/openai` | prompt_cache_options | supported | packages/prism-providers/src/openai/cache.ts | https://developers.openai.com/api/docs/guides/prompt-caching |
| `@arnilo/prism-providers/openai` | prompt_cache_breakpoint | supported | packages/prism-providers/src/openai/cache.ts | https://developers.openai.com/api/docs/guides/prompt-caching |
| `@arnilo/prism-providers/openai` | cache_write_tokens | supported | packages/prism-providers/src/openai/responses.ts | https://developers.openai.com/api/docs/guides/prompt-caching |
| `@arnilo/prism-providers/openai` | cached_tokens | supported | packages/prism-providers/src/openai/responses.ts | https://developers.openai.com/api/docs/guides/prompt-caching |
| `@arnilo/prism-providers/anthropic` | cache_control | supported | packages/prism-providers/src/anthropic/cache.ts | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| `@arnilo/prism-providers/anthropic` | cache_read_input_tokens | supported | packages/prism-providers/src/anthropic/messages.ts | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| `@arnilo/prism-providers/anthropic` | cache_creation_input_tokens | supported | packages/prism-providers/src/anthropic/messages.ts | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| `@arnilo/prism-providers/kimi` | cache_control | supported | packages/prism-providers/src/kimi/cache.ts | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| `@arnilo/prism-providers/opencode-go` | cache_control | supported | packages/prism-providers/src/opencode-go/cache.ts | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| `@arnilo/prism-providers/opencode-go` | x-opencode-session | supported | packages/prism-providers/src/opencode-go/cache.ts | https://opencode.ai/docs |
| `@arnilo/prism-providers/openrouter` | cache_control | supported | packages/prism-providers/src/openrouter/cache.ts | https://openrouter.ai/docs/guides/best-practices/prompt-caching |
| `@arnilo/prism-providers/openrouter` | cache_write_tokens | supported | packages/prism-providers/src/openrouter/cache.ts | https://openrouter.ai/docs/guides/best-practices/prompt-caching |
| `@arnilo/prism-providers/openrouter` | session_id | supported | packages/prism-providers/src/openrouter/cache.ts | https://openrouter.ai/docs/guides/best-practices/prompt-caching |
| `@arnilo/prism-providers/alibaba` | cache_control | supported | packages/prism-providers/src/alibaba/cache.ts | https://www.alibabacloud.com/help/en/model-studio/context-cache |
| `@arnilo/prism-providers/alibaba` | cache_creation_input_tokens | supported | packages/prism-providers/src/alibaba/__tests__/alibaba.test.ts | https://www.alibabacloud.com/help/en/model-studio/context-cache |
| `@arnilo/prism-providers/deepseek` | prompt_cache_hit_tokens | supported | packages/prism-providers/src/deepseek/__tests__/deepseek.test.ts | https://api-docs.deepseek.com/guides/kv_cache/ |
| `@arnilo/prism-providers/deepseek` | canonicalizeJsonSchema | supported | packages/prism-providers/src/deepseek/cache.ts | https://api-docs.deepseek.com/guides/kv_cache/ |
| `@arnilo/prism-providers/google` | cachedContentTokenCount | supported | packages/prism-providers/src/google/generate-content.ts | https://ai.google.dev/gemini-api/docs/caching |
| `@arnilo/prism-providers/google` | cachedContent | host-owned | packages/prism-providers/src/google/generate-content.ts | https://ai.google.dev/gemini-api/docs/caching |
| `@arnilo/prism-providers/xai` | x-grok-conv-id | supported | packages/prism-providers/src/xai/cache.ts | https://docs.x.ai/docs |
| `@arnilo/prism-providers/zai` | cached_tokens | supported | packages/prism-providers/src/zai/__tests__/zai.test.ts | https://docs.z.ai/guides/capabilities/cache |
| `@arnilo/prism-providers/neuralwatt` | cached_tokens | supported | packages/prism-providers/src/neuralwatt/provider.ts | https://docs.neuralwatt.ai |
| `@arnilo/prism-providers/bedrock` | cachePoint | host-owned | packages/prism-providers/src/bedrock/provider.ts | https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html |
| `@arnilo/prism-providers/vertex` | cachedContents | host-owned | packages/prism-providers/src/vertex/provider.ts | https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview |
| `@arnilo/prism-providers/azure` | prompt_cache_key | host-owned | packages/prism-providers/src/azure/provider.ts | https://developers.openai.com/api/docs/guides/prompt-caching |
| `@arnilo/prism-providers/ollama` | cache_control | host-owned | packages/prism-providers/src/ollama/provider.ts | https://github.com/ollama/ollama/blob/main/docs/api.md |
| `@arnilo/prism-providers/clinepass` | cache_control | host-owned | packages/prism-providers/src/clinepass/provider.ts | https://docs.cline.bot |
| `@arnilo/prism-providers/ai-sdk` | cache_control | host-owned | packages/prism-providers/src/ai-sdk/provider.ts | https://sdk.vercel.ai/docs |
| `@arnilo/prism-providers/hyper` | cache_control | supported | packages/prism-providers/src/hyper/cache.ts | https://hyper.charm.land/docs/api/anthropic-messages.html |
| `@arnilo/prism-providers/hyper` | cached_tokens | supported | packages/prism-providers/src/hyper/telemetry.ts | https://hyper.charm.land/docs/api/openai-chat-completions.html |
| `@arnilo/prism-providers/commandcode` | cache_control | supported | packages/prism-providers/src/commandcode/cache.ts | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| `@arnilo/prism-providers/commandcode` | cached_tokens | supported | packages/prism-providers/src/commandcode/__tests__/commandcode.test.ts | https://commandcode.ai/docs/provider |

Official OpenAI 2026-08-28: GPT-5.6+ uses `prompt_cache_options.mode` (`implicit`/`explicit`), `prompt_cache_options.ttl` (`30m`), content `prompt_cache_breakpoint`, and usage `input_tokens_details.cache_write_tokens` in addition to `cached_tokens`. Older models keep `prompt_cache_retention` (`24h` / `in_memory`). Implemented in Task 4: explicit mode + markers gated on `ModelConfig.cache.explicitBreakpoints`, write-token usage mapping, owned fields win over `extra`. `cache.key`/`cache.retention` structured hints remain unread (legacy `cacheKey`/`cacheRetention` only).

Official Anthropic: `cache_control` on content blocks including **system arrays**; `ttl: "1h"`; usage `cache_read_input_tokens` / `cache_creation_input_tokens`. Prism stamps messages then **stringifies system**.

Official DeepSeek: automatic disk prefix cache; `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`; no request cache field.

Official OpenRouter: automatic vs Anthropic-style `cache_control`; `cached_tokens` / `cache_write_tokens`; sticky `session_id`.

Official Bedrock: Converse `cachePoint` / Claude `cache_control` / OpenAI Responses cache on **native** APIs. Current package is OpenAI-compatible only → **host-owned**.

Official Vertex/Gemini: implicit caching plus explicit `cachedContents` resource lifecycle. Google package maps usage only; explicit resources stay **host-owned**.

## Serializer / SSE microbench

Fake in-process only. Node v24.19.0, Linux x64. 4-message ~2.3 KiB bodies, 2000× `JSON.stringify` after `serializeOpenAIChatMessage`/`serializeOpenAITool`. SSE via `readSseEvents` on a generated `data:` stream (200 loops). Heap deltas are GC-noisy; treat as order-of-magnitude.

| Fixture | Body bytes | per-op | heap Δ (noisy) |
| --- | ---: | ---: | ---: |
| OpenAI-compatible Chat Completions | 2262 | 2.95 µs | +210 KiB |
| Anthropic Messages | 2298 | 2.34 µs | +490 KiB |
| Gemini generateContent | 2265 | 2.36 µs | GC |
| OpenAI Responses | 2414 | 2.70 µs | +702 KiB |
| SSE 50 events (~2.4 KiB) | 2364 | 113 µs / stream | +1.2 MiB |
| SSE 500 events (~23 KiB) | 23514 | 623 µs / stream | GC |

No serializer/SSE throughput gap. Later work is **protocol mapping**, not a new transport.

Phase 36 already showed identical assemblies are byte-stable and that dynamic context/skills currently sit before stable instructions in the prompt builder (prefix LCP diagnostic, not a provider cache guarantee).

## Implement or defer

| Item | Decision | Why |
| --- | --- | --- |
| Shared `canonicalizeJsonSchema` | **Implement** (Task 2) | DeepSeek-only; sorts all string arrays; other serializers need key-stable tools without semantic-array shuffle. |
| Anthropic-compatible `system` arrays | **Implement** (Task 3) | Three copies join system to a string and drop `cache_control`. |
| OpenAI `prompt_cache_options` + write usage + nested `cache.*` + extra-cannot-override | **Implemented** (Task 4, 2026-08-28) | Official GPT-5.6+ fields mapped; owned cache fields re-applied after `extra`. Nested `cache.key`/`cache.retention` structured hints still defer to legacy fields. |
| Implicit/gateway usage + omit foreign fields | **Implement only if Task 1 cell is failing** (Task 5) | Most implicit providers already omit foreign fields; do not churn. |
| Azure/Bedrock/Vertex/AI SDK missing named conformance helpers | **Implement tests** (Task 6) | Behavior mostly inherited; add abort/headers/zero-setup assertions, no native protocol expansion. |
| Gemini `cachedContents` / Bedrock `cachePoint` / Vertex cache CRUD | **Defer** | Separate resource lifecycle; current packages declare OpenAI-compatible or generateContent only. |
| Duplicate SSE / HTTP / retry | **Defer / reject** | Transport + runtime retry already exist. NeuralWatt classifier stays local metadata. |
| New core cache broker / VersionManager | **Reject** | **no core primitive** this freeze. |
| Tools-schema `cache_control` on Anthropic `tools[]` | **Defer unless Task 3 stays incomplete** | `applyCacheControl("tools")` marks a tool message, not `tools[]`. |
| Live 17-package canary in default CI | **Defer** | Protected env; D10 of 0.3.0 still holds. |

## Security freeze

- Provider-owned `authorization` / `x-api-key` / `x-goog-api-key` / SigV4 / `content-type` applied after caller headers in HTTP adapters that set them.
- Error bodies go through `readBoundedResponseText` (default 64 KiB) + `redactSecrets` on discovery/OAuth/quota.
- `create*ProviderPackage().setup` performs **zero** fetch in every package (code). Alibaba/Ollama lack the named setup-zero test.
- `list*Models` / quota / embeddings never embed credentials in returned `ModelConfig`.
- Cache keys sanitized; must not be credentials. xAI conv-id is not the SuperGrok token.
- ACP/image fail-closed stays a coding-agent concern; provider media uses `assertProviderMediaCapability`.

## Verification

```text
node --test scripts/phase37-provider-matrix.test.mjs
```

Plan 055 (2026-09): hyper + commandcode rows added (19 adapters); `shared/anthropic-messages.ts`
is the 055 shared primitive (see `phase55-primitive-review.md`); hyper reuses the OpenAI
Responses machinery for its pass-through route.
