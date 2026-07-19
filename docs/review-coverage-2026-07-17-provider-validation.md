# Review coverage — 2026-07-17 provider validation

Working evidence page for Plan 067. Freezes the 2026-07-14 P0–P2 re-verification map, first-party provider validation owners, official-doc priority URLs, Pi secondary references, cache/thinking/discovery surfaces, credential notes, and use-case model-binding inventory.

**Evidence frozen:** 2026-07-17 (offline inventory; no live provider calls).
**Priority rule:** official provider documentation wins; Pi (`badlogic/pi-mono`) is secondary when official docs are silent or ambiguous.

Related: [2026-07-14 coverage](review-coverage-2026-07-14.md) (0.0.4), [2026-07-15 coverage](review-coverage-2026-07-15.md) (0.0.5), [provider caching](provider-caching.md), [provider packages](provider-packages.md).

## Status legend

| Status | Meaning |
| --- | --- |
| `verify` | Prior plan marked fixed; Plan 067 must re-verify with regression tests. |
| `gap` | Known missing or incorrect behavior/docs relative to official sources. |
| `fixed` | Closed in this plan (updated as tasks complete). |
| `by-design` | Intentional absence (document; do not “fix” into a catalog). |

## P0–P2 finding → Plan 067 owner matrix

Source: `code-reviews/2026-07-14.md`. Prior Plans 053 / 054 / 058 marked these implemented for 0.0.4; this plan re-verifies rather than skipping.

| Review ID | Priority | Finding | 0.0.4 owner | Plan 067 task | Current status | Credential / redaction notes |
| --- | --- | --- | --- | --- | --- | --- |
| R-001 | P0 | Revision request duplicated + corrupted by redaction | 053-1 | 1 | fixed | Secret canaries must not appear in repair requests, events, or redacted graphs. Re-verified 2026-07-17: `pendingHistory` + active-path redaction; revision+redactor suite asserts one repair and no `[Circular]`. |
| R-002 | P1 | Multi-round tool transcript chronologically invalid | 053-2 | 1 | fixed | N/A. Re-verified 2026-07-17: two rounds × two calls keep `user → assistant → tool → tool → …` order in history and assembled request. |
| R-003 | P1 | Redactor leaks secrets in object/Map keys | 053-1 | 1 | fixed | Object/Map string keys redact; collisions use deterministic `__N` suffixes. |
| R-004 | P1 | Event-ledger writes lack backpressure | 053-3 | 1 | fixed | Ledger appends serialized (concurrency 1), order preserved, append failures reject run completion. |
| R-008 | P1 | Unbounded SSE / error bodies; multiline `data:` | 054-1/2 | 2 | fixed | Bounded readers; error text redacted. |
| R-009 | P1 | OpenAI device-code OAuth does not poll | 054-3 | 2 | fixed | Redact device/user/access/refresh codes from OAuth errors. |
| R-010 | P2 | Duplicated provider protocol utilities | 054-1/2 | 2 | fixed | Shared transport/primitives remain authoritative. |
| R-005 | P2 | JSONL append silent on corrupt lines | 053-4 | 2 | fixed | Dev-only store; fail closed on corrupt lines. |
| R-011 | P2 | Coding-agent image read unbounded / resize no-op | 055-5 | 2 | fixed | Enforce `maxImageBytes`; deprecate `autoResizeImages` honestly. |
| R-006 | P2 | Optional config ENOENT detected by message text | 053-5 | 2 | fixed | Typed `code === "ENOENT"`. |
| R-012 | P2 | Release tag/version mismatch; no provenance | 058-7/9 | 2 | fixed | Tag/version gate + `--provenance`; no secrets in artifacts. |

Bug-report fixes A–D remain covered by R-001 / R-003 / R-007 (malformed message shape was Plan 053; re-check under Task 1 if touched).

## Provider package validation matrix

| Package | Plan 067 task | Official cache | Prism `cache.kind` | Thinking / reasoning (official → Prism) | Discovery endpoint | Static catalog (bootstrap only) | Pi secondary ref | Credential surface | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `@arnilo/prism-provider-openai` | 6 | `prompt_cache_key`; older models `prompt_cache_retention` (`24h` / `in_memory`); GPT-5.6+ `prompt_cache_options` / breakpoints tracked (host may pass via compat/extra; discovery sets `longRetention: false`) | `openai_key` (+ `longRetention`, `maxKeyLength`) | Official: Responses top-level `reasoning.effort` (+ `summary`). Prism: merges `model.compat.reasoning` + `options.compat.reasoning` (request wins); `applyThinkingLevel(..., "openai_reasoning")` | Official: `GET /models` | Featured `openAIModels` / `openAICodexModels` + **`listOpenAIModels`**; factory accepts `models?` / `codexModels?` | `packages/ai/src/api/openai-responses.ts`, `openai-responses-shared.ts` | API key; Codex OAuth device-code (`oauth.ts`) — poll + redact codes | **fixed** 2026-07-17: Responses P0s + discovery + reasoning + models override |
| `@arnilo/prism-provider-kimi` | 7 | Anthropic-style `cache_control` on `/messages` when supported; OpenAI Moonshot route none | default implicit; opt-in `cache_control` | Official K2.x: `thinking.type` (`enabled`/`disabled`/`keep`); K2.7-code always enabled; K3: top-level `reasoning_effort`. Prism: `kimiThinking`/`kimiReasoningEffort`/`kimiPreserveThinking` (request wins); Coding Anthropic + Moonshot Chat Completions both callable | Official: `GET https://api.moonshot.ai/v1/models` (also `.cn`); Coding has no public list API | Featured Coding (`kimi-for-coding`, `kimi-for-coding-highspeed`, `k3`) + Moonshot (`kimi-k2.7-code`, `kimi-k3`) + **`listKimiModels`** | `kimi-coding*.ts`, `moonshotai*.ts`, `api/anthropic-messages.ts` | API key (`KIMI` / Moonshot, not interchangeable); redacted from errors | **fixed** 2026-07-17: discovery + Moonshot provider + thinking + official Coding ids |
| `@arnilo/prism-provider-zai` | 8 | Implicit (no client `cache_control` / `prompt_cache_key`); official `usage.prompt_tokens_details.cached_tokens` | `implicit` | Official: `thinking` (`{type, clear_thinking?}`), `reasoning_effort` (GLM-5.2+), `tool_stream` (GLM-4.6+). Prism: `zaiThinking`/`zaiReasoningEffort`/`zaiToolStream`/`zaiClearThinking`/`zaiPreserveThinking` (request wins); Preserved Thinking replays `reasoning_content`. Obsolete `thinkingFormat`/`developerRoleFallback` docs removed | No first-class docs.z.ai list page; OpenAI-compatible `GET {baseUrl}/models` best-effort + curated featured set from Chat Completions enum / overview | Featured `zaiModels` (`glm-5.2`…`glm-4.5`) + **`listZaiModels`**; default base `https://api.z.ai/api/paas/v4` | `zai.ts`, `zai.models.ts` (Pi secondary ids only) | API key; redacted from errors / discovery | **fixed** 2026-07-17: docs drift closed; catalog + discovery + clear_thinking/preserve |
| `@arnilo/prism-provider-openrouter` | 9 | Official prompt caching via `cache_control` + sticky `session_id` routing; top-level automatic when no breakpoints | `cache_control` (legacy `compat.openRouterCache`) | Official: `reasoning: { effort | max_tokens }`. Prism: `resolveOpenRouterReasoning` merge + `preserveThinking` replay as body `reasoning` | Official: `GET https://openrouter.ai/api/v1/models` | **App-controlled** `models:` + optional **`listOpenRouterModels`** (no bundled mega-catalog) | `openrouter.models.ts` (do not vendor), `api/openai-completions.ts` | API key; sanitize session/cache ids | **fixed** 2026-07-17: discovery + reasoning merge/preserve + automatic top-level cache_control |
| `@arnilo/prism-provider-opencode-go` | 10 | Anthropic route: selected `cache_control`; OpenAI route: none; `x-opencode-session` from cache/session key | route-specific (`cache_control` on Anthropic; `implicit` on OpenAI) | Dual-route: Anthropic thinking blocks + OpenAI `reasoning_content`; upstream `thinking`/`reasoning_effort`/`reasoning` passthrough (request wins); `preserveThinking` default for reasoning models | Official `GET https://opencode.ai/zen/go/v1/models` (sparse) | Featured official Go ids (Grok/GLM/Kimi/MiMo/MiniMax/Qwen/DeepSeek) + **`listOpenCodeGoModels`**; default base `https://opencode.ai/zen/go/v1` | `opencode-go.ts`, `opencode-go.models.ts` (Pi secondary ids/limits only) | API key; redacted from errors / discovery | **fixed** 2026-07-18: catalog + discovery + base URL + thinking preserve |
| `@arnilo/prism-provider-neuralwatt` | 11 | Implicit vLLM prefix caching; `prompt_tokens_details.cached_tokens` | `implicit` | Official: `reasoning_effort` when `capabilities.reasoning_effort` (GLM-5.2 default `max`); `thinking_token_budget`; `chat_template_kwargs` (`preserve_thinking`/`clear_thinking`/`enable_thinking`). Prism: `thinking.ts` resolves owned fields + `stripNeuralWattOwnedCompat`; `applyThinkingLevel(..., "reasoning_effort")`; Preserved Thinking replays `reasoning_content` | Official: `GET https://api.neuralwatt.com/v1/models` (auth optional for public models) | Featured `neuralWattModels` (official aliases incl. `gemma-4-31b`; no guessed pricing) + **`listNeuralWattModels()`** | **No Pi NeuralWatt provider** — official docs only | Optional API key on discovery; quota helper; redact secrets in error bodies | **fixed** 2026-07-18: catalog refresh + kwargs routing + owned-compat strip |
| `@arnilo/prism-provider-ai-sdk` | 12 | Host model owns request caching; adapter maps usage only | host-owned / N/A | Host `LanguageModelV4` owns reasoning; Prism maps stream `reasoning` parts | **None by design** (host supplies model) | None | N/A (AI SDK official spec > Pi) | No package credentials; host model may hold secrets | **fixed** 2026-07-18: host-owned catalog/cache/reasoning validated; usage mapping + docs |

## Frozen official evidence sources (priority)

| Provider | Frozen URLs (official) | Notes frozen 2026-07-17 |
| --- | --- | --- |
| OpenAI | [List models](https://developers.openai.com/api/reference/resources/models/methods/list); [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching); [Reasoning](https://developers.openai.com/api/docs/guides/reasoning); [Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create/); [Models guide](https://developers.openai.com/api/docs/models) | `GET /models`. Caching: `prompt_cache_key`; pre-5.6 `prompt_cache_retention`; 5.6+ `prompt_cache_options` / breakpoints. Reasoning: `reasoning.effort`. |
| Kimi / Moonshot | [List models](https://platform.kimi.ai/docs/api/list-models); [API overview](https://platform.kimi.ai/docs/api/overview); [Model parameter reference](https://platform.kimi.ai/docs/api/models-overview); [Thinking mode](https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model); [Thinking effort](https://platform.kimi.ai/docs/guide/use-thinking-effort) | `GET /v1/models` on `api.moonshot.ai` / `.cn`. K2.x `thinking`; K3 `reasoning_effort: "max"`. Anthropic `/messages` compat remains under-documented — record empirical gaps in Task 7. |
| Z.AI | [Deep thinking](https://docs.z.ai/guides/capabilities/thinking); [Thinking mode](https://docs.z.ai/guides/capabilities/thinking-mode); [Tool streaming](https://docs.z.ai/guides/capabilities/stream-tool); [Context caching](https://docs.z.ai/guides/capabilities/cache); [Chat completion](https://docs.z.ai/api-reference/llm/chat-completion); [Migrate to GLM-5.2](https://docs.z.ai/guides/overview/migrate-to-glm-new); [Overview](https://docs.z.ai/guides/overview/overview) | Code + `docs/providers/zai.md` match official `thinking` / `reasoning_effort` / `tool_stream` / `clear_thinking`. Historical mismatch (`thinkingFormat`) closed in Task 8. |
| OpenRouter | [Get models](https://openrouter.ai/docs/api/api-reference/models/get-models); [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching); [Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) | `GET /api/v1/models`. Cache via `cache_control` + sticky routing. Reasoning via `reasoning` object. |
| OpenCode Go | [Go](https://opencode.ai/docs/go/); [Providers](https://opencode.ai/docs/providers/) | Dual OpenAI + Anthropic compatible APIs. Official `GET /zen/go/v1/models`. Featured: Grok 4.5, GLM-5.2/5.1, Kimi K3/K2.7 Code/K2.6, MiMo, MiniMax, Qwen3.7/3.6, DeepSeek V4. Default base `https://opencode.ai/zen/go/v1`. |
| NeuralWatt | [Models](https://portal.neuralwatt.com/docs/api/models); [Chat completions](https://portal.neuralwatt.com/docs/api/chat-completions); [API overview](https://portal.neuralwatt.com/docs/api/overview); [Quickstart](https://portal.neuralwatt.com/docs/quickstart) | `GET /v1/models` returns pricing/capabilities/limits metadata. Prefix caching automatic; `reasoning_effort` when capability flagged. |
| AI SDK | [Custom provider / LanguageModelV4](https://ai-sdk.dev/providers/community-providers/custom-providers); AI SDK usage types (`inputTokens` / cache details) | Adapter validates `specificationVersion`; maps cache read/write from usage. No Prism catalog. |

## Frozen Pi secondary references

Repo: `https://github.com/badlogic/pi-mono` (`packages/ai`).

| Area | Path / note |
| --- | --- |
| OpenAI Responses | `packages/ai/src/providers/openai-responses.ts` (also Codex / Azure variants) |
| OpenAI Completions | `packages/ai/src/providers/openai-completions.ts` / `api/openai-completions.ts` |
| Anthropic Messages | `packages/ai/src/providers/anthropic-messages.ts` / `api/anthropic-messages.ts` |
| Generated catalogs | `packages/ai/src/providers/*.models.ts` via `scripts/generate-models.ts` — **not** copied as Prism’s sole strategy |
| Provider registry docs | Pi mintlify “LLM Providers” / README provider list |

Use Pi only to fill gaps or cross-check wire shapes after official docs.

## Shared discovery pattern (Task 3 decision — frozen)

**Status (2026-07-17 Task 3):** pattern documented; no new core list-models primitive. Shared reuse is limited to existing transport/credential helpers.

### Inventory

| Primitive | Location | Role |
| --- | --- | --- |
| `listNeuralWattModels({ apiKey?, fetch?, baseUrl?, signal?, headers? })` | `packages/provider-neuralwatt/src/models.ts` | **Template** — only shipped `list*Models` today |
| `mapNeuralWattModel(entry)` | same | Provider-specific entry → `ModelConfig` |
| `neuralWattModels` featured aliases | same | Offline bootstrap; no guessed pricing |
| `readBoundedResponseText` | `@arnilo/prism/providers/transport` | Bounded error-body read + optional secret redaction |
| `resolveCredentialValue` / `redactSecrets` | `@arnilo/prism` | Auth resolution + error redaction |
| Package `models?: readonly ModelConfig[]` | Kimi/Z.AI/OpenRouter/OpenCode Go/NeuralWatt/**OpenAI** factories | Host override of registered catalog |
| OpenAI factory `models?` / `listOpenAIModels` | **done** Task 6 | Fixed |
| OpenRouter / OpenCode Go `list*Models` | OpenRouter **`listOpenRouterModels` done** Task 9; OpenCode Go **`listOpenCodeGoModels` done** Task 10; Z.AI **`listZaiModels` done** Task 8; Kimi **`listKimiModels` done** Task 7 | Per-package work |
| AI SDK catalog | N/A | Host-owned `LanguageModelV4` — no discovery export |

### Decisions

- Template options + return: NeuralWatt `listNeuralWattModels(...) → ModelConfig[]`.
- **Never** call discovery from `create*ProviderPackage()` / extension setup.
- Static catalogs = offline bootstrap / featured aliases only.
- OpenRouter stays app-registration-first; **`listOpenRouterModels`** (done Task 9) feeds `models:` only.
- AI SDK: no discovery export.
- Prefer **package-local** helpers. Do **not** add a core model-discovery registry or OpenAI-compatible mega-mapper in Task 3. Extract a shared HTTP/list helper later only if ≥2 packages share identical parsing (unlikely: OpenRouter/NeuralWatt/OpenAI response shapes and cache/cost mapping diverge).
- Discovery may populate `ModelConfig.cache` / `ModelConfig.cost` from live metadata when officially documented; static catalogs must not invent those fields.
- Docs: [Provider packages — Caller-gated model discovery](provider-packages.md#caller-gated-model-discovery), [Provider caching — Discovery and live cache/cost metadata](provider-caching.md#discovery-and-live-cache-cost-metadata), [Provider conformance — Model discovery checklist](provider-conformance.md#model-discovery-checklist).

## Shared thinking / per-turn override (Task 4 decision — frozen)

| Layer | Contract |
| --- | --- |
| Model default | `ModelConfig.compat` (+ `capabilities.reasoning` where declared) |
| Per-turn override | `ProviderRequestOptions.compat` via existing `mergeProviderRequestOptions` (request wins) |
| Shared helpers | Core `applyThinkingLevel` / `thinkingCompatFor` / `thinkingFamilyForModel` → official compat fields; **not** a second options tree |
| Families | `openai_reasoning` (`reasoning.effort`), `reasoning_effort`, `thinking_type` (`thinking.type`), `noop` (host-owned) — only shapes shared by ≥2 packages (or explicit no-op) |
| Use-case wiring | LLM compaction + OM workers map `thinkingLevel` into `compat` via helpers (no longer inert `extra.thinkingLevel`) |
| Docs | [Thinking and reasoning](thinking-and-reasoning.md) |

**Decision (2026-07-17):** Implement thin core helpers; keep unique knobs (NeuralWatt budgets/kwargs, Kimi keep/all, Z.AI `tool_stream`) package-local. Core must not name forbidden provider literals (`openrouter`/`zai`/`kimi`/…). Hosts pick a family explicitly when inference is ambiguous. Per-provider first-class field hardening remains Tasks 6–12.

## Use-case model binding inventory (Task 5 — done 2026-07-17)

| Site | Current binding | Session fallback today? | Thinking path today |
| --- | --- | --- | --- |
| `AgentSession.run` / `RunOptions.model` | Per-run override; writes `model_change` | Explicit override of session model | Host `providerOptions` / `applyThinkingLevel` |
| Observational memory workers | `resolveUseCaseModel({ configured: workerModel, sessionModel })` | **Yes** — host passes `sessionModel`; `requireExplicitModel` restores skip | `thinkingLevel` → `compat` via `applyThinkingLevel` |
| LLM compaction | `resolveUseCaseModel({ configured: summaryModel, sessionModel: model })` | **Yes** — `model` is the fallback slot | `thinkingLevel` → `compat` via `applyThinkingLevel` |
| Supervisor children | Child `Agent` owns its own `model` | Independent | Child config |
| Declarative agents | `resolveAgentDefinition` model string / `ModelConfig` | Definition-scoped | Definition / run options |
| Evaluations | `runOptions` including model | Eval-owned | Via run options |
| Workflows / RPC / CLI | Pass-through `runOptions.model` | Caller-owned | Via run options |
| Structured output | Reuses session/run model | Yes | Same as run |
| Memory / RAG embedders | Host `Embedder` — separate from chat LLM | N/A (not chat) | N/A |

**Decision (2026-07-17):** Core exports `UseCaseModelBinding`, `resolveUseCaseModel`, `resolveUseCaseModelBinding`, `useCaseCredentialProviderId`. Docs: [use-case-model-selection.md](use-case-model-selection.md). OM behavior change: session fallback when `sessionModel` supplied and worker model omitted; `requireExplicitModel` preserves historical `missing_model` skip.

Desired Plan 067 outcome: every use-case accepts `{ provider, model, thinking }` with **explicit session-model fallback** when no use-case default is set — **done** for OM + LLM compaction; other sites documented as already-separate.

## Known doc / code mismatches (frozen)

| Item | Docs claim | Code / official | Owner task |
| --- | --- | --- | --- |
| Z.AI thinking | Was: `thinkingFormat: "zai"`, `developerRoleFallback` in `docs/providers/zai.md` | **fixed** Task 8 — docs+code match official `thinking` / `reasoning_effort` / `tool_stream` / `clear_thinking` | 8 (done) |
| OpenAI reasoning | Was capabilities-only + opaque compat spread | Task 6 merges `model`/`options` `compat.reasoning` into body `reasoning`; Task 4 helper writes `compat.reasoning.effort` | 4 (done) / 6 (done) |
| Kimi Moonshot | Was metadata-only (`provider: "moonshot"` without provider) | **fixed** Task 7: `createMoonshotProvider` registered when `includeMoonshotModels`; official Coding ids + `listKimiModels` | 7 (done) |
| OpenCode Go catalog | Featured official Go open models + `listOpenCodeGoModels` | **done** Task 10 (removed stale `gpt-5.1-go` / `claude-sonnet-4.5-go`) | 10 (done) |
| Z.AI catalog | Was: `glm-4.7` / `glm-4.5` only | **fixed** Task 8 — featured GLM-5.2…4.5 + `listZaiModels` | 8 (done) |
| OM/LLM `thinkingLevel` + session fallback | Was inert `extra.thinkingLevel`; OM skipped without workerModel | Task 4 maps into `compat`; Task 5 session fallback + `requireExplicitModel` | 4 (done) / 5 (done) |

## Credential and redaction canaries (per package)

| Package | Secrets in flight | Redaction canary expectation |
| --- | --- | --- |
| openai | API key; OAuth device/user/access/refresh | Absent from errors, events, requests, discovery failures |
| kimi | API key | Absent from errors / cache keys |
| zai | API key | Absent from errors / model metadata |
| openrouter | API key; session/cache ids | Sanitize length; never treat cache key as secret storage |
| opencode-go | API key | Absent from errors |
| neuralwatt | Optional API key; quota responses | Discovery/quota error bodies redacted |
| ai-sdk | Host-owned | Adapter must not echo host secrets in Prism errors |

No secrets are committed in this matrix.

## Plan 067 task map (evidence owners)

| Task | Owns |
| --- | --- |
| 0 | This page + evidence freeze — **done** |
| 1 | R-001–R-004 re-verify — **fixed** 2026-07-17 |
| 2 | R-005–R-006, R-008–R-012 re-verify — **fixed** 2026-07-17 |
| 3 | Shared discovery pattern — **done** 2026-07-17 (package-local NeuralWatt template; no core list helper) |
| 4 | Shared thinking / per-turn surface — **done** 2026-07-17 (core helpers + OM/LLM compat wiring; see thinking-and-reasoning.md) |
| 5 | Use-case model selection + session fallback — **done** 2026-07-17 (`resolveUseCaseModel`, OM session fallback, use-case-model-selection.md) |
| 6 | OpenAI validate/harden — **done** 2026-07-17 (Responses P0s, `listOpenAIModels`, `models?`, reasoning merge) |
| 7 | Kimi validate/harden — **done** 2026-07-17 (`listKimiModels`, Moonshot provider, thinking, official Coding ids) |
| 8 | Z.AI validate/harden — **done** 2026-07-17 (`listZaiModels`, GLM-5.x catalog, docs drift closed, clear_thinking/preserve) |
| 9 | OpenRouter validate/harden — **done** 2026-07-17 (`listOpenRouterModels`, reasoning merge/preserve, automatic top-level `cache_control`) |
| 10 | OpenCode Go validate/harden — **done** 2026-07-18 (`listOpenCodeGoModels`, official Go catalog, `zen/go/v1` base, thinking preserve) |
| 11 | NeuralWatt validate/harden — **done** 2026-07-18 (featured catalog refresh, kwargs routing, owned-compat strip, applyThinkingLevel) |
| 12 | AI SDK validate — **done** 2026-07-18 (host-owned catalog/cache/reasoning; usage mapping + docs) |
| 13 | Cross-provider conformance + final verification — **done** 2026-07-18 (`sdk:ready`; 1,089 core tests + workspace suites + pack dry-runs) |

Exact task titles live in `plans/067-provider-doc-validation-caching-discovery-and-review-hardening.md`.

## Verification for this page

- Final verification completed 2026-07-18 without live provider HTTP.
- Lists all seven first-party provider packages; every provider row is `fixed` or intentional by-design behavior.
- Lists every 2026-07-14 P0–P2 id (R-001–R-006, R-008–R-012); all are `fixed`.
- Distinguishes official-doc priority vs Pi secondary.
- `phase12-boundaries.test.ts` verifies all six HTTP package discovery exports and setup zero-fetch; AI SDK no-catalog behavior has its own adapter contract test.
- `provider_validation_final_contract_covers_all_adapters_and_binding_sites` verifies provider docs, cache kinds, thinking rows, use-case sites, matrix statuses, and index navigation.
- `npm run sdk:ready` passes: typecheck/build, 1,089 core tests, all workspace suites, packaging/provenance guards, and publish-graph pack dry-runs.
- Linked from `docs/index.md` under Release and install.
