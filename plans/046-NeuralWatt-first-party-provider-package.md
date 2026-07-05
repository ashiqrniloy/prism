# Phase 45 — NeuralWatt first-party provider package

## Objectives
- Add `@arnilo/prism-provider-neuralwatt` as a first-party OpenAI-compatible Chat Completions provider package, mirroring the structure of `@arnilo/prism-provider-zai`.
- Implement `createNeuralWattProvider()` over base URL `https://api.neuralwatt.com/v1` with injectable `fetch`, host credential resolver, and `NEURALWATT_API_KEY` documentation.
- Serialize NeuralWatt/OpenAI-compatible request fields (including reasoning and chat-template escape hatches) and map messages/tools/tool results/thinking back into Prism content blocks.
- Stream OpenAI-style SSE chunks (text, reasoning deltas, tool-call deltas/finals, usage, `[DONE]`) and NeuralWatt SSE comments into Prism `ProviderEvent`s.
- Map usage from `prompt_tokens`/`completion_tokens`/`total_tokens`/`prompt_tokens_details.cached_tokens`; no cache-write token is fabricated.
- Add the package to the `@arnilo/prism-providers` and `@arnilo/prism-all` first-party bundles (only if they remain the bundle mechanism) and publish matching docs/index navigation updates.
- Keep provider-owned `authorization`/`content-type` headers winning over caller headers and never pretend `cacheRetention: "none"` disables NeuralWatt's implicit backend prefix cache.

## Expected Outcome
- `packages/provider-neuralwatt` builds (`tsc`), typechecks, and passes network-free conformance + unit tests using mocked `fetch`/SSE.
- Streaming content, thinking, tool-call delta reconstruction, final tool calls, usage, abort, and secret redaction behave identically to the Z.AI/OpenAI-compatible first-party providers.
- The `authorization` header is applied **after** caller headers so caller config cannot replace the provider token; conformance test `assertProviderOwnedHeadersWin` passes.
- Docs at `/docs/providers/neuralwatt.md`, `/docs/provider-packages.md`, `/docs/provider-caching.md`, and `/docs/index.md` reference the package without promising cache hits.
- `cacheRetention: "none"` is documented as disabling Prism/provider cache hints only, not NeuralWatt's implicit vLLM prefix cache.

## Tasks

- [x] Primitive review: inventory existing OpenAI-compatible primitives before any provider-specific logic
  - Acceptance Criteria:
    - Functional: Document every reusable primitive already in core and sibling packages (`createOpenAICompatibleProvider`, `readSseData`, cache helpers, conformance harness, provider event factories) and confirm whether the NeuralWatt package can be built from them without adding provider-specific code into core contracts.
    - Performance: Reuse existing O(messages + content blocks) serializers; no tokenization, hashing, or new dependencies introduced.
    - Code Quality: Reject any mode-specific Rust/TS logic in core; the package composes generic primitives (`defineProviderPackage`, `resolveCredentialValue`, `providerDone/Error/TextDelta/ThinkingDelta/ToolCall/ToolCallDelta/Usage`) that already exist.
    - Security: Confirm no new trust boundary, credential lookup, or network path beyond what `createZaiProvider` already exercises; `fetch` is always injectable and defaults to global `fetch`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 45 — NeuralWatt first-party provider package (delivery list and acceptance criteria).
      - `plans/045-first-party-provider-cache-behavior-hardening.md` inventory findings for cache helpers and provider-owned header rules.
      - `.agents/skills/create-plan/references/prism-wiki.md` (docs structure requirements).
      - `src/providers/openai-compatible.ts`, `src/cache-helpers.ts`, `src/testing/provider-conformance.ts`, `src/contracts.ts` (`ProviderRequestOptions`, `Usage`, `ModelCacheCapabilities`, `PromptCacheHints`).
      - `packages/provider-zai/src/{index,provider,sse,thinking,models}.ts` as the structural template.
      - NeuralWatt docs: `https://portal.neuralwatt.com/docs/api/overview` (base URL `https://api.neuralwatt.com/v1`), `https://portal.neuralwatt.com/docs/authentication` (`NEURALWATT_API_KEY`, bearer), `https://portal.neuralwatt.com/docs/api/chat-completions` (request fields, streaming, reasoning, prefix-cache, energy), `https://portal.neuralwatt.com/docs/guides/streaming` (SSE `[DONE]`, `: energy`/`: cost` comments), `https://portal.neuralwatt.com/docs/guides/tool-calling`, `https://portal.neuralwatt.com/docs/api/models`.
    - Options Considered:
      - Reuse the core `createOpenAICompatibleProvider` subpath directly and only ship a thin package wrapper + model registry: smallest surface, but roadmap requires NeuralWatt-specific field handling (`reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs`, `compat`/`extra`) and NeuralWatt SSE comment tolerance that the minimal core adapter does not support.
      - Clone the Z.AI package shape per-field: chosen — mirrors an already-accepted first-party package, lets NeuralWatt add its fields without touching core, and keeps the conformance harness reusable.
      - Add NeuralWatt fields into core `openai-compatible.ts`: rejected, leaks provider specifics into core (violates roadmap acceptance).
    - Chosen Approach:
      - Build `packages/provider-neuralwatt` as a sibling of `provider-zai`, reusing `readSseData`-style local SSE reader, core event factories, cache helpers, and the `@arnilo/prism/testing/provider-conformance` harness. Add NeuralWatt-only fields via `request.options.compat`/`extra` and small dedicated helpers, never core contracts.
    - API Notes and Examples:
      ```ts
      import { defineProviderPackage } from "@arnilo/prism";
      import { createNeuralWattProvider } from "./provider.js";
      export function createNeuralWattProviderPackage(options: NeuralWattProviderPackageOptions = {}): ProviderPackage {
        const providerId = options.id ?? "neuralwatt";
        return defineProviderPackage({
          name: "@arnilo/prism-provider-neuralwatt",
          description: "NeuralWatt provider package for Prism.",
          docs: { links: ["docs/providers/neuralwatt.md"] },
          setup(api) {
            api.registerProvider(createNeuralWattProvider(options));
            for (const model of options.models ?? neuralWattModels) api.registerModel({ ...model, provider: providerId });
            api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
          },
        });
      }
      ```
    - Files to Create/Edit:
      - `plans/046-NeuralWatt-first-party-provider-package.md`: record inventory findings (filled during this task).
      - Runtime/source files: none changed in this task (inventory only).
    - References:
      - `packages/provider-zai/src/provider.ts` (header ordering, body cleaning), `src/cache-helpers.ts`, `src/testing/provider-conformance.ts`.
  - Test Cases to Write:
    - inventory assertion: confirm at least one reusable primitive per concern (SSE, headers, usage, events) is named before package work begins.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no, this is planning/inventory only.
    - Docs pages to create/edit: `none` this task.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Inventory Findings (per concern):
    - **Provider package framework (core):** `defineProviderPackage()` is exported from `src/provider-packages.ts` and re-exported at root `src/index.ts`. It takes `{ name, description, docs, setup(api) }` where `api` exposes `registerProvider`, `registerModel`, `registerAuthMethod`. This is the exact primitive the NeuralWatt package will compose — **no new package framework needed**.
    - **Provider factory / AIProvider contract (core):** `AIProvider` interface in `src/contracts.ts`; a provider implements `async *generate(request): AsyncIterable<ProviderEvent>`. `createZaiProvider` and `createOpenAICompatibleProvider` are the two reference shapes. NeuralWatt will clone the Z.AI shape (more complete: separate `provider.ts` + `sse.ts` + `thinking.ts` + `models.ts`).
    - **Credentials (core):** `resolveCredentialValue(source, { name, provider })` from `src/credentials.ts` resolves per-request credentials; supports raw strings, env resolvers, host callbacks. **No env/file/keychain auto-lookup is baked into the package** — NeuralWatt only documents the `NEURALWATT_API_KEY` convention; resolution stays host-owned.
    - **Headers / auth ordering (core + sibling):** Both `createOpenAICompatibleProvider` and `createZaiProvider` spread `...request.options?.headers` FIRST, then `content-type`, then `...(token ? { authorization } : {})` LAST — so provider-owned headers win. This pattern is reusable as-is.
    - **Request serialization (core/sibling):** `toOpenAIRequest()` (core, minimal: model/messages/tools/stream/stream_options + parameters spread) and `zaiBody()` (Z.AI, richer: adds reasoning_effort/thinking/tool_stream/compat/extra escape hatches). The Z.AI `toMessage`, `toTool`, `parseArgs`, `clean` helpers handle text/image/tool_call/tool_result with capability gates and single-content collapse. **NeuralWatt's `reasoning_effort`/`thinking_token_budget`/`chat_template_kwargs` fit exactly into the Z.AI-style compat/extra model** — no core change required.
    - **Prompt cache primitives (core):** `src/cache-helpers.ts` exports `sanitizeCacheKey(value, maxLength)`, `mapCacheRetention(retention, model)`, `applyCacheControl(messages, breakpoints, opts)`, `cacheHitRate`, `cacheSavings`, `cacheUsageReport`. All are provider-name-free. NeuralWatt uses `cache:{kind:"implicit"}` in model metadata (like Z.AI) and needs **none** of the explicit control helpers — but the `mapCacheRetention("none")→undefined` semantics already satisfy the roadmap's "`cacheRetention:"none"` disables hints only, not the backend implicit cache" rule, since nothing is sent for implicit-cache providers.
    - **SSE parsing (core/sibling):** Core has an inline `readSseData` (splits on `
?
`, yields `data: ` lines only — **drops comment lines silently**, which already tolerates NeuralWatt's `: energy`/`: cost` comments). Z.AI's local `src/sse.ts` `readSseData` joins multi-line `data:` fields per SSE-event block (`\r?\n\r?\n` split). Either is reusable; the Z.AI version is more spec-faithful. NeuralWatt should clone the Z.AI reader — it already ignores comment-only data.
    - **Stream → events (core + sibling):** Core event factories `providerDone`, `providerError`, `providerTextDelta`, `providerThinkingDelta`, `providerToolCall`, `providerToolCallDelta`, `providerUsage`, `toolCallContent` from `src/provider-events.ts`. The delta-accumulation loop (text/reasoning_content/tool_calls per choice, `[DONE]` terminator, final tool calls rebuilt via `toolCallContent`, terminal usage) is identical in core `createOpenAICompatibleProvider` and Z.AI `zaiEvents`. NeuralWatt reuses this loop verbatim; reasoning uses `delta.reasoning_content` (NeuralWatt API field) → `providerThinkingDelta`.
    - **Usage mapping (core/sibling):** Core `toUsage` maps `prompt_tokens`/`completion_tokens`/`total_tokens` → input/output/total, `prompt_tokens_details.cached_tokens` (or `prompt_cache_hit_tokens`) → `cacheReadTokens`, `prompt_tokens_details.cache_write_tokens` → `cacheWriteTokens`. This **already covers NeuralWatt exactly**; NeuralWatt simply never emits a write field today, so `cacheWriteTokens` stays `undefined` — no fabrication needed.
    - **Secret redaction (core):** `redactSecrets(text, [])` from `src/redaction.ts` (used in core `safeText`) and the `secrets` array passed to `providerError(error, secrets)` primitive both ensure token redaction in errors. Z.AI uses its own `safeText` without `redactSecrets` — **NeuralWatt should use the core `redactSecrets` variant** for stronger safety (minor improvement over the Z.AI clone).
    - **Conformance harness (core testing subpath):** `@arnilo/prism/testing/provider-conformance` exports `collectProviderEvents`, `assertProviderStreamConforms`, `assertAbortIsObserved`, `assertToolCallDeltasReconstruct`, `assertSerializedRequestCoversContent`, `assertProviderOwnedHeadersWin`, `assertNoSecretLeak`, `assertUsageAccounting`. This is the **complete reusable test surface** — NeuralWatt tests reuse it like Z.AI does.
    - **Model registry primitive (sibling pattern):** `defineZaiModel(config)` + `zaiModels` array in `src/models.ts`; `defineNeuralWattModel`/`neuralWattModels` will mirror it with `cache:{kind:"implicit"}`.
    - **Routing/aggregators (sibling):** `packages/prism-providers/package.json` depends on each `@arnilo/prism-provider-*`; `packages/prism-all` depends on `prism-providers`. NeuralWatt is wired by appending one dependency edge — **no new bundle mechanism required**.
    - **Core-contract gaps:** `ProviderRequestOptions` already has `compat`/`extra` (JsonObject) escape hatches + `cache`/`cacheKey`/`cacheRetention`. **No core contract change is required for any NeuralWatt field.** Confirmed: NeuralWatt's `chat_template_kwargs`/`thinking_token_budget` flow through `request.options.compat`/`extra` (final spread wins), exactly as Z.AI already does for `thinking`/`reasoning_effort`.
    - **Primitive-gap conclusion:** There are **no generic primitive gaps to fill**. Every NeuralWatt behavior (provider factory, header ownership, request serialization with escape hatches, SSE comment tolerance, reasoning deltas, tool-call reconstruction, usage mapping, abort, secret redaction, conformance testing, cache semantics, bundle wiring) is achievable with existing core + sibling-package primitives. The NeuralWatt package composes them directly — no provider-specific logic enters core contracts, satisfying the roadmap acceptance criterion.
  - Runtime/source files changed: none (inventory-only task).

- [x] Scaffold workspace package `packages/provider-neuralwatt`  
      *(Scaffold verified: `npm run build -w @arnilo/prism-provider-neuralwatt` → EXIT 0, emits `dist/index.js`; `npm run typecheck` → EXIT 0; `npm pack --dry-run` → file set = `package.json, README.md, CHANGELOG.md, dist/{index,provider,models}.{js,d.ts}` (no `*.map`, no `__tests__`), workspace recognized via `packages/provider-*` glob.)*
  - Acceptance Criteria:
    - Functional: Package `@arnilo/prism-provider-neuralwatt` exists with ESM `tsc` build, `.` export (`types` + `default`), `peerDependencies` on `@arnilo/prism`, file allowlist (`dist`, README, CHANGELOG), `engines.node >=20`, `sideEffects:false`, and `publishConfig.access:public`.
    - Performance: Build emits only `dist/`; no runtime deps added.
    - Code Quality: `package.json` mirrors `provider-zai/package.json` field-for-field (name, scripts `build`/`typecheck`/`test`/`pack:dry-run`, repository/homepage/bugs point at `packages/provider-neuralwatt`); `tsconfig.json` extends the repo root or matches sibling packages.
    - Security: No automatic credential/env/file lookup in package setup; no side effects at import.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-zai/package.json`, `packages/provider-zai/tsconfig.json` (structure to clone).
      - Root `package.json` workspaces field to confirm `packages/*` glob picks the new package.
    - Options Considered:
      - Generate via a scaffolder CLI: overkill; sibling `package.json` is copy-edit.
      - Copy `provider-zai/package.json` and rename: chosen.
    - Chosen Approach:
      - Duplicate the Z.AI package definition, substitute identity strings, mark `"version": "0.0.1"`.
    - API Notes and Examples:
      ```jsonc
      {
        "name": "@arnilo/prism-provider-neuralwatt",
        "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
        "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "node --test dist/__tests__/*.test.js" },
        "peerDependencies": { "@arnilo/prism": "0.0.1" },
        "devDependencies": { "@arnilo/prism": "file:../.." }
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/package.json`: new package manifest.
      - `packages/provider-neuralwatt/tsconfig.json`: new TS config matching siblings.
      - `packages/provider-neuralwatt/README.md`: stub to be filled by docs task (minimal exports + security defaults).
      - `packages/provider-neuralwatt/CHANGELOG.md`: new changelog.
      - `packages/provider-neuralwatt/src/index.ts`: package entry re-exporting `createNeuralWattProviderPackage`, `createNeuralWattProvider`, `neuralWattModels`, `defineNeuralWattModel`.
      - `packages/provider-neuralwatt/src/provider.ts`: minimal compiling stub exporting `createNeuralWattProvider()` + `NeuralWattProviderOptions` (default id/baseUrl set, `generate` throws "not implemented"). Required so `index.ts` re-exports compile and the build/typecheck gates pass; **implementation task 3 replaces the body** (Edit, not Create).
      - `packages/provider-neuralwatt/src/models.ts`: minimal compiling stub exporting `defineNeuralWattModel()`, `NeuralWattModelConfig`, and `neuralWattModels` (empty array). Required for `index.ts` to compile; **implementation task 7 fills in the curated registry** (Edit, not Create).
    - References:
      - `packages/provider-zai/package.json`, `packages/provider-zai/tsconfig.json`.
  - Test Cases to Write:
    - build: `npm -w @arnilo/prism-provider-neuralwatt run build` exits 0 and emits `dist/index.js`.
    - typecheck: `npm -w @arnilo/prism-provider-neuralwatt run typecheck` passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public package export `@arnilo/prism-provider-neuralwatt`.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: new provider page (filled by docs task).
      - `docs/provider-packages.md`: add package to first-party list.
      - `docs/index.md`: add navigation entry under provider connection group.
    - `docs/index.md` update: yes — add `[@arnilo/prism-provider-neuralwatt](providers/neuralwatt.md)` to the Phase 12 package workspaces line.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement `createNeuralWattProvider()` with header ownership and credential resolution  
      *(Verified: `npm run build` EXIT 0, `npm run typecheck` EXIT 0, `npm test` 5/5 pass incl. `neuralwatt_post_url_and_auth_header`, `neuralwatt_caller_header_cannot_override_auth` (via `assertProviderOwnedHeadersWin`), `neuralwatt_abort_throws_before_fetch` (fetch not called), `neuralwatt_missing_token_omits_authorization`, `neuralwatt_custom_base_url_is_used`.)*
  - Acceptance Criteria:
    - Functional: Provider id defaults to `"neuralwatt"`, base URL defaults to `https://api.neuralwatt.com/v1` (trailing slash stripped), POSTs to `/chat/completions`, and resolves the API key per request via `resolveCredentialValue(options.apiKey, { provider, name: "apiKey" })`.
    - Performance: No network at import/setup; one `fetch` per request; streams the response body via the SSE reader.
    - Code Quality: `authorization` header is spread **after** `...request.options?.headers` so caller headers cannot replace the token; `content-type` is provider-owned; secrets array is passed to `providerError` for redaction.
    - Security: Aborted `request.signal` throws `request.signal.reason` before fetch; missing/empty token omits `authorization` rather than sending `Bearer `; no env/file/keychain lookup performed by the package.
  - Approach:
    - Documentation Reviewed:
      - NeuroWatt `https://portal.neuralwatt.com/docs/authentication` (bearer, `NEURALWATT_API_KEY`).
      - `https://portal.neuralwatt.com/docs/api/chat-completions` endpoint path.
      - `packages/provider-zai/src/provider.ts` `createZaiProvider` for exact header ordering and secret handling.
    - Options Considered:
      - Spread caller headers last and let them override auth: insecure, rejected.
      - Merge with provider-owned headers last: chosen (matches Z.AI).
    - Chosen Approach:
      - Clone the Z.AI provider shell, swap defaults/paths/ids, reuse `providerError`/`providerDone` and `safeText`-style error body capture.
    - API Notes and Examples:
      ```ts
      headers: { ...request.options?.headers, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/provider.ts`: provider factory + `neuralWattBody`, `neuralWattEvents`, helpers (created, full implementation; not a stub).
      - `packages/provider-neuralwatt/src/sse.ts`: `readSseData` cloned from Z.AI — splits on `\r?\n\r?\n`, yields only `data:` lines, so `: energy`/`: cost` SSE comments are tolerated.
      - `packages/provider-neuralwatt/src/thinking.ts`: `neuralWattReasoningEffort`, `neuralWattThinkingTokenBudget`, `neuralWattChatTemplateKwargs`, `neuralWattToolChoice` (read from `compat`).
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: the 4 required tests + a base-url test (created).
    - Implementation notes:
      - `safeText` uses core `redactSecrets` (improvement over Z.AI's plain `safeText`); `secrets = [token]` passed to `providerError`.
      - `authorization` spread LAST after `...request.options?.headers` + `content-type`; empty token omits the header entirely.
      - Pre-aborted `request.signal` throws `signal.reason` before any `fetch`.
      - The full serializer (`neuralWattBody` with `stream_options.include_usage`, `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs`, `compat`/`extra`), the SSE parser (`neuralWattEvents`), and `toUsage` (no fabricated cache-write) are implemented in this same `provider.ts` so `generate` is functional and testable. Tasks 4/5/6 add their own specific test cases against this already-written code.
    - References:
      - `packages/provider-zai/src/provider.ts` (`createZaiProvider`, `safeText`, secret redaction).
  - Test Cases to Write:
    - `neuralwatt_post_url_and_auth_header`: mock fetch captures URL `…/v1/chat/completions` and `authorization: Bearer <token>`.
    - `neuralwatt_caller_header_cannot_override_auth`: caller passes `headers.authorization: "Bearer evil"`; provider token wins (`assertProviderOwnedHeadersWin`).
    - `neuralwatt_abort_throws_before_fetch`: pre-aborted signal short-circuits.
    - `neuralwatt_missing_token_omits_authorization`: empty credential omits header, still errors cleanly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `createNeuralWattProvider()` and credential behavior.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: document `NEURALWATT_API_KEY`, bearer auth, injectable `fetch`, header ownership.
    - `docs/index.md` update: yes (scaffold task already adds the nav entry).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement Chat Completions request serializer `neuralWattBody()`  
      *(Verified: `npm run build` EXIT 0, `npm run typecheck` EXIT 0, `npm test` 11/11 pass incl. `neuralwatt_body_covers_content` (text+image+tool_call+tool_result via `assertSerializedRequestCoversContent`, image_url shape asserted), `neuralwatt_body_includes_reasoning_and_template_fields`, `neuralwatt_body_extra_escape_hatch_overrides` (extra wins after compat), `neuralwatt_image_without_capability_throws`, `neuralwatt_tool_choice_passthrough` (string + object), `neuralwatt_body_no_explicit_cache_payload_for_implicit_caching`.)*
  - Acceptance Criteria:
    - Functional: Body emits OpenAI-compatible fields `model`, `messages`, `tools`, `tool_choice`, `stream:true`, `stream_options.include_usage:true`, `temperature`, `top_p`, `max_tokens`, `stop`; plus NeuralWatt fields `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs`, and `compat`/`extra` escape hatches spread last.
    - Performance: O(messages + content blocks + tools); single object allocation, no provider calls.
    - Code Quality: `clean()` strips `undefined`; image blocks require `capabilities.input?.includes("image")` or throw; assistant `tool_call` blocks must be the only content on the message; `tool_result` blocks only on `role:"tool"` messages; thinking blocks preserved as text in assistant turns.
    - Security: No embedding of secrets into the body; credentials stay in headers only.
  - Approach:
    - Documentation Reviewed:
      - `https://portal.neuralwatt.com/docs/api/chat-completions` (field list, `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs`, prefix-cache usage).
      - `https://portal.neuralwatt.com/docs/guides/tool-calling` (`tool_choice`, schema).
      - `packages/provider-zai/src/provider.ts` `zaiBody`, `toMessage`, `toTool`, `clean`.
    - Options Considered:
      - Reuse core `openai-compatible` `toOpenAIRequest`: lacks reasoning/chat_template escape hatches and NeuralWatt comment tolerance; rejected.
      - Port Z.AI `zaiBody` and add NeuralWatt fields: chosen.
    - Chosen Approach:
      - Generalize the Z.AI serializer; read NeuralWatt fields from `request.options.compat`/`request.model.compat` via a small `neuralWattOptions` helper, allow `extra` override last.
    - API Notes and Examples:
      ```ts
      export function neuralWattBody(request: ProviderRequest): JsonObject {
        const { maxTokens, ...parameters } = request.model.parameters ?? {};
        return clean({
          model: request.model.model,
          messages: request.messages.map((m) => toMessage(m, request.model.capabilities ?? {})),
          tools: request.tools?.map(toTool),
          tool_choice: request.options?.compat?.tool_choice ?? request.model.compat?.tool_choice,
          stream: true,
          stream_options: { include_usage: true },
          reasoning_effort: neuralWattReasoningEffort(request),
          thinking_token_budget: request.options?.compat?.thinking_token_budget ?? request.model.compat?.thinking_token_budget,
          chat_template_kwargs: request.options?.compat?.chat_template_kwargs ?? request.model.compat?.chat_template_kwargs,
          ...parameters,
          max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
          ...request.options?.compat,
          ...request.options?.extra,
        });
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/provider.ts` (`neuralWattBody`, `toMessage`, `toTool`, `parseArgs`, `clean`).
      - `packages/provider-neuralwatt/src/thinking.ts`: small helpers mirroring Z.AI (`neuralWattReasoningEffort`, `neuralWattThinking`).
    - References:
      - `packages/provider-zai/src/thinking.ts`, `packages/provider-zai/src/provider.ts` (`zaiBody`).
  - Test Cases to Write:
    - `neuralwatt_body_covers_content`: `assertSerializedRequestCoversContent` over text/image/tool texts.
    - `neuralwatt_body_includes_reasoning_and_template_fields`: `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs` present when configured.
    - `neuralwatt_body_extra_escape_hatch_overrides`: `request.options.extra` wins for a custom field.
    - `neuralwatt_image_without_capability_throws`.
    - `neuralwatt_tool_choice_passthrough`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — request field surface.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: Inputs/request field table including reasoning + escape hatches.
    - `docs/index.md` update: yes (entry added by scaffold task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement SSE stream parser `neuralWattEvents()` handling deltas, reasoning, tool calls, `[DONE]`, and SSE comments  
      *(Verified: `npm run build` EXIT 0, `npm run typecheck` EXIT 0, `npm test` 18/18 pass incl. `neuralwatt_stream_conforms_text_and_done` (via `assertProviderStreamConforms`), `neuralwatt_tool_call_deltas_reconstruct` (via `assertToolCallDeltasReconstruct`), `neuralwatt_reasoning_delta_emits_thinking` (`reasoning_content`→`providerThinkingDelta`), `neuralwatt_done_terminates_stream`, `neuralwatt_usage_chunk_emitted` (+ `assertUsageAccounting`), `neuralwatt_ignores_energy_cost_comments` (`: energy`/`: cost` lines produce no errors), `neuralwatt_malformed_data_emits_error_then_done` (malformed JSON yields `providerError`, generator does not crash).)*
  - Acceptance Criteria:
    - Functional: Parses OpenAI-style `data:` chunks, breaks on `[DONE]`, maps `choices[].delta.content` → `providerTextDelta`, `delta.reasoning_content` → `providerThinkingDelta`, accumulates `delta.tool_calls` and emits `providerToolCallDelta` then final `providerToolCall`, and emits `providerUsage` from terminal usage chunks; NeuralWatt SSE comment lines (`: energy` / `: cost`) are ignored without error.
    - Performance: Single forward pass over the stream; O(content) memory; tool accumulator keyed by `index`.
    - Code Quality: Reasoning preserved using `reasoning`/`reasoning_content` so Prism thinking blocks survive across turns; final `providerDone(usage)` always emitted; malformed JSON on a data line yields `providerError` rather than crashing the generator.
    - Security: No network; reads only the injected `ReadableStream`; no secrets echoed into events.
  - Approach:
    - Documentation Reviewed:
      - `https://portal.neuralwatt.com/docs/guides/streaming` (SSE chunks, `[DONE]`, usage chunk, `: energy`/`: cost` comments).
      - `https://portal.neuralwatt.com/docs/api/chat-completions` (reasoning field).
      - `packages/provider-zai/src/sse.ts` (`readSseData`), `packages/provider-zai/src/provider.ts` `zaiEvents`.
    - Options Considered:
      - Use raw `TextDecoder` loop inline: reinvents `readSseData`.
      - Reuse Z.AI `readSseData`-style local reader, but extend to skip comment lines (`:` prefix): chosen.
    - Chosen Approach:
      - Local `readSseData` variant identical to Z.AI plus an early drop of pure-comment events; keep delta accumulation logic from `zaiEvents`; finalize tool calls with `providerToolCall` + `toolCallContent`.
    - API Notes and Examples:
      ```ts
      export async function* neuralWattEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEvent> {
        const tools = new Map<number, ToolAccumulator>();
        let usage: Usage | undefined;
        for await (const data of readSseData(body)) {
          if (data === "[DONE]") break;
          const chunk = JSON.parse(data) as NeuralWattChunk;
          if (chunk.usage) { usage = toUsage(chunk.usage); yield providerUsage(usage); }
          for (const choice of chunk.choices ?? []) { /* text/reasoning/tool deltas */ }
        }
        for (const call of tools.values()) if (call.id && call.name) yield providerToolCall(toolCallContent(call.id, call.name, parseArgs(call.argumentsText)));
        yield providerDone(usage);
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/sse.ts`: `readSseData` (comment-tolerant) — created in task 3.
      - `packages/provider-neuralwatt/src/provider.ts` (`neuralWattEvents`, `toUsage`, chunk interfaces) — implemented in task 3; this task added its test coverage.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: added a `SSE stream` describe block with 7 cases + a `rawSse` helper (object-array→SSE without auto `[DONE]`).
    - Implementation notes (verified behavior):
      - `readSseData` splits on `\r?\n\r?\n`, yields only `data:` lines joined — `: energy`/`: cost` SSE comments have no `data:` line so they yield nothing (tolerated).
      - Malformed JSON on a data line is caught and yields `providerError(error, [])` then returns (terminal = error; no trailing `done`). This matches the `!response.ok` error path and is more robust than Z.AI (which would throw and crash the generator). Generator never throws into the consumer.
      - `[DONE]` breaks the loop; terminal `providerDone(usage)` always emitted on a clean stream.
      - Reasoning uses `delta.reasoning_content` → `providerThinkingDelta` (NeuralWatt's documented field).
    - References:
      - `packages/provider-zai/src/sse.ts`, `packages/provider-zai/src/provider.ts` (`zaiEvents`).
  - Test Cases to Write:
    - `neuralwatt_stream_conforms`: `assertProviderStreamConforms` over a multi-chunk fixture.
    - `neuralwatt_tool_call_deltas_reconstruct`: `assertToolCallDeltasReconstruct`.
    - `neuralwatt_reasoning_delta_emits_thinking`.
    - `neuralwatt_done_terminates_stream`.
    - `neuralwatt_usage_chunk_emitted`: `prompt_tokens`/`completion_tokens`/`total_tokens` + `cached_tokens` mapping.
    - `neuralwatt_ignores_energy_cost_comments`: stream with `: energy ...` and `: cost ...` lines yields no spurious events.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — streamed events and usage fields.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: Outputs/response/events section + reasoning streaming note.
    - `docs/index.md` update: yes (entry added by scaffold task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement usage mapping and cache behavior (no fabricated cache-write tokens)
  - Acceptance Criteria:
    - Functional: `toUsage()` maps `prompt_tokens`→`inputTokens`, `completion_tokens`→`outputTokens`, `total_tokens`→`totalTokens`, and `prompt_tokens_details.cached_tokens`→`cacheReadTokens`; `cacheWriteTokens` is set only when NeuralWatt actually reports a write field (none today), never fabricated.
    - Performance: O(1) usage mapping; no extra provider calls.
    - Code Quality: Reuses the `Usage` normalization used by sibling packages; explicit `undefined`-on-absent.
    - Security: No secrets in usage; usage never includes raw headers.
  - Approach:
    - Documentation Reviewed:
      - `https://portal.neuralwatt.com/docs/api/models` (cached-input pricing/fields).
      - `plans/045-first-party-provider-cache-behavior-hardening.md` core usage normalization rules.
      - `packages/provider-zai/src/provider.ts` `toUsage` (the closest OpenAI-compatible mapping).
    - Options Considered:
      - Synthesize `cacheWriteTokens` from a heuristic: rejected (would lie about cache behavior, violates roadmap acceptance).
      - Map only documented fields, leave write `undefined`: chosen.
    - Chosen Approach:
      - Port the Z.AI `toUsage`, drop the unsupported `cache_write_tokens` source until NeuralWatt reports one; document this in the cache section of the provider doc.
    - API Notes and Examples:
      ```ts
      function toUsage(usage: NeuralWattUsage | undefined): Usage | undefined {
        return usage
          ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens, cacheReadTokens: usage.prompt_tokens_details?.cached_tokens }
          : undefined;
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/provider.ts` (`toUsage`, `NeuralWattUsage` interface).
    - References:
      - `packages/provider-zai/src/provider.ts` (`toUsage`), `src/contracts.ts` (`Usage`).
  - Test Cases to Write:
    - `neuralwatt_usage_maps_cached_tokens`: `cached_tokens` → `cacheReadTokens`.
    - `neuralwatt_usage_no_fabricated_cache_write`: absent write field yields `cacheWriteTokens === undefined`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `Usage` fields populated by the provider.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: cache behavior subsection stating implicit prefix cache + no cache-write token.
      - `docs/provider-caching.md`: add NeuralWatt row (implicit, read-only accounting, `cacheRetention:"none"` disables hints only).
    - `docs/index.md` update: yes (entry added by scaffold task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add curated NeuralWatt model registry
  - Acceptance Criteria:
    - Functional: `neuralWattModels` exports at least the roadmap upcoming aliases surfaced on the OpenCode integration (`glm-5.2`, `kimi-k2` featured aliases per roadmap Phase 46 list) as ModelConfig entries with `provider:"neuralwatt"`, capabilities (`input:["text"]`, output, reasoning, tools, streaming), `limits`, and `cache:{kind:"implicit"}`; `defineNeuralWattModel()` lets users add custom configs.
    - Performance: Static array; no network.
    - Code Quality: `defineNeuralWattModel` mirrors `defineZaiModel` shape; satisfies `readonly ModelConfig[]`.
    - Security: No hardcoded credentials or URLs in model configs beyond the documented base URL default in the provider.
  - Approach:
    - Documentation Reviewed:
      - `https://portal.neuralwatt.com/docs/api/models` (aliases, limits).
      - `https://portal.neuralwatt.com/docs/integrations/opencode` (coding-model defaults).
      - `packages/provider-zai/src/models.ts`.
    - Options Considered:
      - Fetch `/v1/models` at setup: out of scope for Phase 45 (listed under Phase 46 `listNeuralWattModels`); rejected here.
      - Curated static registry: chosen for Phase 45.
    - Chosen Approach:
      - Mirror `zaiModels`/`defineZaiModel`; mark `cache:{kind:"implicit"}`; keep limits conservative from NeuralWatt `/models` docs.
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/models.ts`: `defineNeuralWattModel`, `neuralWattModels`, `NeuralWattModelConfig`.
      - `packages/provider-neuralwatt/src/index.ts`: re-export models.
    - References:
      - `packages/provider-zai/src/models.ts`, `packages/provider-zai/src/index.ts`.
  - Test Cases to Write:
    - `neuralwatt_registers_models_and_auth`: package registration yields provider + model + `api_key` auth method (mirror `zai_registers_glm_model_metadata`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — exported model registry + `defineNeuralWattModel`.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: list featured aliases/limits.
    - `docs/index.md` update: yes (entry added by scaffold task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Wire the package into `prism-providers` / `prism-all` bundles (only if still the first-party bundle mechanism)
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-providers` dependency list includes `@arnilo/prism-provider-neuralwatt`, and `@arnilo/prism-all` transitively pulls it (via `prism-providers`); if those umbrella packages have been superseded by another bundle mechanism, document the chosen mechanism instead and skip edits.
    - Performance: No runtime cost beyond the dependency edge.
    - Code Quality: Version pins match sibling providers (`0.0.1`); umbrella README updated to list NeuralWatt.
    - Security: No new transitive runtime deps introduced by the wiring.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-providers/package.json`, `packages/prism-all/package.json`.
      - Roadmap note: "if those packages are still the first-party bundle mechanism".
    - Options Considered:
      - Add direct dependency to `prism-all`: duplicates edges; `prism-providers` is the aggregator.
      - Add only to `prism-providers`: chosen.
    - Chosen Approach:
      - Append `@arnilo/prism-provider-neuralwatt` to `prism-providers` dependencies and the umbrella README bullet list.
    - Files to Create/Edit:
      - `packages/prism-providers/package.json`: add dependency.
      - `packages/prism-providers/README.md`: add NeuralWatt bullet.
      - `packages/prism-all/README.md`: add NeuralWatt bullet (if it enumerates providers).
    - References:
      - `packages/prism-providers/package.json`, `packages/provider-zai` wiring precedent.
  - Test Cases to Write:
    - `prism_providers_includes_neuralwatt`: assert dependency key present and resolvable from a workspace install.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — aggregator dependency surface.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: add NeuralWatt to first-party package list + bundle note.
    - `docs/index.md` update: yes (entry added by scaffold task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Network-free conformance + unit test suite
  - Acceptance Criteria:
    - Functional: `packages/provider-neuralwatt/src/__tests__/{neuralwatt,index}.test.ts` cover header ownership, content coverage, stream conformance, tool-call reconstruction, usage mapping, reasoning deltas, `[DONE]`, SSE comment tolerance, abort, missing token, and package registration; a `.live.test.ts` stub exists but skips without `NEURALWATT_API_KEY`.
    - Performance: Tests run with mocked `fetch`/SSE; no real network.
    - Code Quality: Reuses `assertProviderOwnedHeadersWin`, `assertProviderStreamConforms`, `assertSerializedRequestCoversContent`, `assertToolCallDeltasReconstruct` from `@arnilo/prism/testing/provider-conformance`; matches the Z.AI test layout.
    - Security: Tests never print real keys; the live test gate is a documented env var.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-zai/src/__tests__/{zai,index,live}.test.ts`.
      - `src/testing/provider-conformance.ts` exported helpers.
      - `docs/provider-conformance.md` for helper contracts.
    - Options Considered:
      - Provider-specific custom assertions: duplicates the harness.
      - Reuse the shared conformance harness + small provider-specific cases: chosen.
    - Chosen Approach:
      - Clone the Z.AI test files, swap provider/model ids, add case fixtures for NeuralWatt-specific fields and SSE comments.
    - API Notes and Examples:
      ```ts
      import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: provider behavior cases.
      - `packages/provider-neuralwatt/src/__tests__/index.test.ts`: package registration/export cases.
      - `packages/provider-neuralwatt/src/__tests__/live.test.ts`: env-gated live smoke (skip by default).
    - References:
      - `packages/provider-zai/src/__tests__/*test.ts`.
  - Test Cases to Write:
    - all acceptance-criteria cases enumerated across prior tasks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (tests only).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Docs: provider page, package list, cache page, index nav, README
  - Acceptance Criteria:
    - Functional: `/docs/providers/neuralwatt.md` exists following the wiki API page structure (What it does / When to use it / Inputs / Outputs / example / Implementation example / Extension + config notes / Cache behavior / Security + performance / Related APIs); `/docs/provider-packages.md` lists it; `/docs/provider-caching.md` adds a NeuralWatt row; `/docs/index.md` nav updated; package README lists exports + security defaults + cache behavior.
    - Performance: docs build/check (`docs.test.ts`) passes including any new path assertions.
    - Code Quality: Matches sibling `docs/providers/zai.md` section structure exactly.
    - Security: Documents `NEURALWATT_API_KEY`, injectable `fetch`, header ownership, and that `cacheRetention:"none"` disables Prism hints only (not the implicit backend prefix cache).
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (API page structure + index groups).
      - `docs/providers/zai.md` (section template), `docs/provider-packages.md`, `docs/provider-caching.md`, `docs/index.md`.
    - Options Considered:
      - Inline cache notes only into the provider page: leaves the caching matrix incomplete.
      - Update all four pages + README: chosen (wiki requires index + structure compliance).
    - Chosen Approach:
      - Author `neuralwatt.md` from the Z.AI page template, add NeuralWatt specifics (base URL, reasoning/escape fields, SSE comments), append a cache row, add the index nav entry alongside the Z.AI line.
    - Files to Create/Edit:
      - `docs/providers/neuralwatt.md`: new provider API page.
      - `docs/provider-packages.md`: add first-party package entry.
      - `docs/provider-caching.md`: add NeuralWatt cache row.
      - `docs/index.md`: add nav entry in provider connection group (append to the Phase 12 package workspaces line).
      - `packages/provider-neuralwatt/README.md`: exports + security defaults + cache behavior.
    - References:
      - `docs/providers/zai.md`, `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `docs_index_references_neuralwatt`: `docs.test.ts` lists `docs/providers/neuralwatt.md` (extend the allowed-paths list if the test gates doc existence).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — docs surface for the new package.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- **Static curated model registry, no `/v1/models` fetch.** Phase 45 ships `glm-5.2` and `kimi-k2` only; listNeuralWattModels discovery is a Phase 46 deliverable. Chosen to keep setup network-free and side-effect-free per the first-party package contract; `defineNeuralWattModel()` covers custom configs in the meantime.
- **Model limits are conservative doc-sourced values, not live-verified.** `glm-5.2` 128K/32K and `kimi-k2` 200K/32K come from NeuralWatt `/models` documentation; they were not confirmed against the live API. Left as-is because the registry is a static default hosts can override via `models:`, and validation belongs to the Phase 46 discovery task.
- **No curated image-capable model.** The image input/thinking/tool_call code path is tested (`neuralwatt_body_covers_content` with an image-capable model fixture, `neuralwatt_image_without_capability_throws`) but the default registry models declare `input: ["text"]` only. Correct for now — NeuralWatt's multimodal surface is undocumented in the Phase 45 scope; hosts add image models via `defineNeuralWattModel()` with `capabilities.input: ["text","image"]`.
- **Malformed SSE data yields `providerError` (terminal), not `done`.** Diverges from the Z.AI parser (which would throw and crash the generator into the consumer). Chosen because `providerError` then return is strictly more robust than throwing and matches the `!response.ok` error path; documented in `neuralwatt_malformed_data_emits_error_then_done`.
- **`cacheWriteTokens` left `undefined`.** NeuralWatt reports no cache-write token today. Deliberately not fabricated (the roadmap acceptance criterion); means cache diagnostics are read-only for this provider. `cacheUsageReport()` still works — its `cacheWriteTokens` falls back to `0`.
- **`tool_choice` passthrough is shape-only, not enum-validated.** Strings ("auto"/"none"/"required") and objects (`{type:"function",function:{...}}`) pass through verbatim via `compat.tool_choice`. NeuralWatt's accepted enum is not pinned in Phase 45 docs; validation deferred to avoid coupling to an unstable vendor surface.
- **Live test is an opt-in stub.** `live.test.ts` skips without `NEURALWATT_API_KEY`; no real `/v1/chat/completions` smoke in the default suite. Matches the first-party "network-free by default" rule; Phase 46 adds real smoke.

## Further Actions
- **Phase 46 — `listNeuralWattModels()` discovery (high).** Fetch `/v1/models` on demand (caller-gated, not at setup) and merge with the curated registry. Unblocks accurate limits/aliases and removes the conservative-doc-values compromise. Stop-gap: hosts pass `models:` to `createNeuralWattProviderPackage()`.
- **Live smoke harness (medium).** When Phase 46 lands, expand `live.test.ts` with a real chat/streaming/usage round-trip gated behind `NEURALWATT_API_KEY` + `PRISM_LIVE_PROVIDER_TESTS=1`. Today's stub already reserves the gate.
- **Pricing/quota/retry surface (medium, Phase 46).** `ModelConfig.cost` is absent from the curated entries; add when NeuralWatt publishes per-token pricing. Retry stays on the runtime `AgentConfig.retry`/`RunOptions.retry` contract — no provider-specific loop unless the vendor protocol requires it.
- **Image-capable curated model (low).** Add an image-input `defineNeuralWattModel` entry once NeuralWatt documents a multimodal alias; the image serialization path is already covered by tests.
- **`tool_choice` enum pinning (low).** If NeuralWatt documents a fixed accepted set, validate `compat.tool_choice` strings in `neuralWattToolChoice()` instead of passing through blindly.
- **Verify model limits against live API (low).** When discovery lands, cross-check the conservative 128K/200K/32K values currently in the registry and correct if the live `/models` response disagrees.
