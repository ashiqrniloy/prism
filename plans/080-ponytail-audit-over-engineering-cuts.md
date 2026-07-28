# Ponytail Audit: Delete Duplicated Provider Clients and Other Over-Engineering

## Objectives
- Execute the ranked findings from the ponytail-audit report (this session): eliminate duplicated OpenAI-compatible SSE clients, replace hand-rolled clones with native APIs, and drop speculative umbrella packages.
- Keep every provider's public API and wire behavior byte-identical (cache markers, thinking bodies, headers, telemetry) — this is a deletion/refactor pass, not a behavior change.

## Expected Outcome
- `createOpenAICompatibleProvider` (or shared openai-primitives emitters) is the single implementation of the OpenAI chat-completions stream loop; alibaba, zai, ollama, openrouter, opencode-go, and kimi delegate to it.
- `provider-kimi` ships one OpenAI-compatible client, not two.
- Zero `JSON.parse(JSON.stringify(...))` deep clones in non-test code; no hand-rolled sleep in `packages/browser`.
- `prism-base`, `prism-code`, `prism-compaction`, `prism-providers` umbrella packages removed.
- Net ≈ -2,300 lines, -4 packages; all package test suites and conformance suites green.

## Tasks

- [x] Extend openai-compatible primitives with the hooks the migrating providers need
  - Acceptance Criteria:
    - Functional: shared stream-event generator and body builder accept per-provider hooks: `buildBodyExtra(request) → JsonObject` (thinking/reasoning/cache bodies), `mapMessages(request)` (cache-marker application), `mapUsage(usage)` (openrouter usage), `extraHeaders(request)`. Default behavior unchanged for azure/bedrock/vertex callers.
    - Performance: no per-request allocation regression; single SSE parse pass as today.
    - Code Quality: hooks are optional fields on `OpenAICompatibleProviderOptions`; no new abstraction layers, no classes; `ToolAccumulator` exists exactly once in the repo after this task.
    - Security: `secrets` redaction array still covers apiKey on every error path; `readBoundedResponseText` still bounds error bodies.
  - Approach:
    - Documentation Reviewed:
      - `src/providers/openai-compatible.ts` (166 lines, current factory)
      - `src/providers/openai-primitives.ts` (`serializeOpenAIChatMessage`, `mapOpenAIChatUsage`, `applyOpenAIChatStructuredOutput`)
      - `docs/providers/openai-compatible.md`, `docs/provider-primitives.md`
    - Options Considered:
      - Add hooks to `createOpenAICompatibleProvider` options: smallest diff, providers become option-objects. Chosen.
      - Export a standalone `openAIChatEvents(body, hooks)` generator: more flexible, but two ways to do the same thing = more code.
      - Class-based template method: rejected, unrequested abstraction.
    - Chosen Approach:
      - Hooks on the existing factory options; per-provider packages shrink to `createOpenAICompatibleProvider({ baseUrl, buildBodyExtra, mapMessages, ... })`.
    - API Notes and Examples:
      ```ts
      export interface OpenAICompatibleProviderOptions {
        readonly baseUrl: string;
        // ... existing ...
        readonly buildBodyExtra?: (request: ProviderRequest) => JsonObject | undefined;
        readonly mapMessages?: (request: ProviderRequest) => readonly Message[];
        readonly mapUsage?: (usage: unknown) => Usage | undefined;
        readonly extraHeaders?: (request: ProviderRequest) => Record<string, string>;
      }
      ```
    - Files to Create/Edit:
      - `src/providers/openai-compatible.ts`: add hook options, thread them through body build + stream loop.
      - `src/__tests__/openai-compatible.test.ts`: hook coverage.
      - Done (2026, this session): hooks shipped as specced (`buildBodyExtra` merged over base body, `extraHeaders` under provider auth, `mapMessages` before serialization, `mapUsage` override); 4 new tests; docs updated (`docs/providers/openai-compatible.md` options table + hook example, `docs/index.md` entry); `plans/README.md` row + `docs.test.ts` plan-count 80→81 for this plan file. Core suite 1256/1257 pre-existing pass + fixed plan-index gate; azure/bedrock/vertex typecheck green.
    - References:
      - Audit finding 1; azure/bedrock/vertex already use this factory (`packages/provider-*/src/provider.ts`).
  - Test Cases to Write:
    - hook passthrough: custom `buildBodyExtra` appears in fetch body, default path byte-identical.
    - `mapMessages` applied before serialization; `mapUsage` overrides default usage mapping.
    - incomplete tool-call delta still errors via `ProviderTransportError`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new options on the public `@arnilo/prism/providers/openai-compatible` subpath.
    - Docs pages to create/edit:
      - `docs/providers/openai-compatible.md`: document the four new hook options with an example.
    - `docs/index.md` update: no new entry; existing OpenAI-compatible entry description gets hook mention.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Migrate provider-ollama to the shared factory
  - Acceptance Criteria:
    - Functional: `createOllamaProvider` public signature unchanged; streaming events identical (text, `reasoning_content` thinking, tool calls, usage).
    - Performance: one SSE parse pass, no buffering regression.
    - Code Quality: `packages/provider-ollama/src/provider.ts` shrinks to a factory call; `ollamaEvents`/local `ToolAccumulator` deleted (≈ -150 lines); models.ts untouched.
    - Security: no auth header sent to local Ollama unless apiKey configured (match current behavior).
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-ollama/src/provider.ts` (simplest migrator: no cache/thinking hooks)
      - Ollama chat-completions compatibility: `https://docs.ollama.com/openai` (`POST {base}/chat/completions`)
    - Options Considered:
      - Direct factory call with no hooks: chosen, Ollama needs none.
      - Keep custom serializer: rejected, its serializer duplicates `serializeOpenAIChatMessage`.
    - Chosen Approach:
      - `createOllamaProvider = (o) => createOpenAICompatibleProvider({ id: "ollama", baseUrl: o.baseUrl ?? "http://localhost:11434/v1", apiKey: o.apiKey, fetch: o.fetch })` plus any Ollama body extras already emitted today (verify via existing tests).
    - API Notes and Examples:
      ```ts
      export function createOllamaProvider(options: OllamaProviderOptions = {}): AIProvider {
        return createOpenAICompatibleProvider({ id: options.id ?? "ollama", baseUrl: options.baseUrl ?? "http://localhost:11434/v1", ...options });
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-ollama/src/provider.ts`: rewrite as factory delegate.
      - `packages/provider-ollama/src/index.ts`: unchanged exports.
      - Done: plan's "no hooks needed" was wrong — ollama has 4 real divergences (strict completion evidence, `providerDone(usage)`, body transforms incl. `max_tokens` from limits + compat-strip, public `ollamaBody`/`ollamaEvents` exports). Core gained `transformBody` / `strictCompletion` / `requestFailedPrefix` options plus exported `openAIChatEvents` / `buildOpenAIChatBody` / `OpenAIChatBodyOptions`; factory also throws pre-fetch on an already-aborted signal. `ollamaEvents` is now a one-line wrapper over `openAIChatEvents({strictCompletion: true})`; `ollamaBody` wraps `buildOpenAIChatBody` + `ollamaTransform`. provider.ts 202 → 81 lines; all 12 ollama tests pass unmodified (wire parity); core 1261/1261; azure/bedrock/vertex typecheck green. These core additions are the same hooks zai/alibaba/openrouter need (compat-strip + final-body transform), so tasks 3–5 need no further core changes.
    - References:
      - Audit finding 1; shared factory from previous task.
  - Test Cases to Write:
    - existing ollama package tests pass unmodified (proves wire parity).
    - streaming tool-call accumulation matches pre-migration golden output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — same exports, same wire behavior.
    - Docs pages to create/edit:
      - none: internal refactor only.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable (no public surface change).

- [x] Migrate provider-zai (thinking body hook)
  - Acceptance Criteria:
    - Functional: `zaiThinking`, `zaiPreserveThinking`, `zaiReasoningEffort`, `zaiToolStream` behavior preserved via hooks; request bodies byte-identical to today including `reasoning_content` replay.
    - Performance: unchanged.
    - Code Quality: `zaiEvents` and local serializer deleted; thinking.ts stays (vendor mapping is real logic); provider.ts ≈ -180 lines.
    - Security: apiKey only in `Authorization` header; redaction unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-zai/src/provider.ts`, `thinking.ts`
      - Z.AI docs: `https://docs.z.ai/guides/capabilities/thinking`, `https://docs.z.ai/api-reference/llm/chat-completion`
    - Options Considered:
      - `buildBodyExtra: (req) => ({ thinking: zaiThinking(req), ... })` + `mapMessages` for `reasoning_content` replay: chosen.
      - Keep zai custom stream parser: rejected, its delta shape is standard OpenAI (`reasoning_content` already handled by shared loop).
    - Chosen Approach:
      - Hooks cover 100% of zaiBody/zaiEvents logic; verify with golden-body test before deleting.
    - API Notes and Examples:
      ```ts
      createOpenAICompatibleProvider({
        id, baseUrl, apiKey, fetch,
        buildBodyExtra: (req) => clean({ thinking: zaiThinking(req), ...zaiReasoningEffort(req) }),
        mapMessages: (req) => zaiMapMessages(req), // reasoning_content replay
      })
      ```
    - Files to Create/Edit:
      - `packages/provider-zai/src/provider.ts`: factory delegate.
      - `packages/provider-zai/src/thinking.ts`: keep, export mapping helpers only.
      - Done: core gained two more options the plan didn't foresee — `serializeMessage` (zai keeps its public `toZaiMessage` with `reasoning_content` replay) and `doneUsage` (zai emits usage on `done` WITHOUT strict completion, unlike ollama). `zaiTransform` strips `stream_options` to keep the wire body byte-identical (old zai never sent it). provider.ts 232 → 140 lines; all 24 zai tests pass unmodified; core 1261/1261. Two deliberate behavior deltas recorded: (1) dangling/incomplete streamed tool calls now yield a fail-closed `incomplete_delta` error instead of being silently dropped (matches core semantics; no test covered the old drop), (2) the no-body error message now says `OpenAI-compatible response had no body` instead of `Z.AI response had no body` (untested string). thinking.ts untouched as planned.
    - References:
      - Audit finding 1.
  - Test Cases to Write:
    - golden request-body test: thinking enabled/disabled/clear_thinking bodies match snapshots taken pre-migration.
    - preserved-thinking assistant messages serialize `reasoning_content` exactly as today.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — exports and bodies unchanged.
    - Docs pages to create/edit:
      - none: internal refactor.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Migrate provider-alibaba (cache-marker message hook)
  - Acceptance Criteria:
    - Functional: `applyAlibabaCacheControl` / `withAlibabaCacheMarker` applied to messages exactly as today; preset base URLs (`alibabaBaseUrl`) still resolve; structured-output assertion unchanged.
    - Performance: unchanged.
    - Code Quality: provider.ts ≈ -200 lines; cache.ts kept (vendor logic).
    - Security: `Authorization: Bearer` only; bounded error body unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-alibaba/src/provider.ts`, `cache.ts`, `models.ts` (`AlibabaBasePreset`)
      - DashScope OpenAI-compatible mode: `https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope`
    - Options Considered:
      - `mapMessages: applyAlibabaCacheControl` + preset-resolved baseUrl: chosen.
      - Keep custom loop: rejected, pure duplication.
    - Chosen Approach:
      - Factory delegate; preset logic stays in alibaba package as `baseUrl` resolution before the factory call.
    - API Notes and Examples:
      ```ts
      createOpenAICompatibleProvider({
        id, apiKey, fetch,
        baseUrl: options.baseUrl ?? alibabaBaseUrl(options.preset ?? "singapore"),
        mapMessages: (req) => applyAlibabaCacheControl(req),
        buildBodyExtra: (req) => withAlibabaCacheMarkerFields(req),
      })
      ```
    - Files to Create/Edit:
      - `packages/provider-alibaba/src/provider.ts`: factory delegate.
      - `packages/provider-alibaba/src/cache.ts`, `models.ts`: keep.
      - Done: zero new core hooks needed — existing `mapMessages` (applies `applyAlibabaCacheControl`) + `serializeMessage` (keeps public `serializeAlibabaMessage` with cache_control markers) + `transformBody` + `strictCompletion` covered everything. `alibabaBody`/`alibabaEvents`/`serializeAlibabaMessage`/`alibabaEnableThinking` public exports preserved. provider.ts 266 → 157 lines; all 14 alibaba tests pass unmodified (incl. truncation fail-loud and ≤4 breakpoint cap); core 1261/1261. Truncation error message text changed to the shared wording (old combined tool-call status; tests assert event type only). cache.ts untouched as planned.
    - References:
      - Audit finding 1.
  - Test Cases to Write:
    - cache-marker messages serialize identically pre/post migration (golden snapshot).
    - preset → baseUrl resolution table test stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none: internal refactor.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Migrate provider-openrouter (headers + reasoning + usage hooks)
  - Acceptance Criteria:
    - Functional: `appUrl`/`appName` headers, `resolveOpenRouterReasoning` body, session-id header, `openRouterUsage` mapping, compat-key stripping all preserved byte-identically.
    - Performance: unchanged.
    - Code Quality: provider.ts ≈ -190 lines; cache.ts/thinking.ts kept.
    - Security: no OpenRouter-owned compat keys leak into raw body passthrough (existing `stripOpenRouterOwnedCompat` still applied).
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-openrouter/src/provider.ts`, `cache.ts`, `thinking.ts`
      - OpenRouter reasoning docs: `https://openrouter.ai/docs/guides/best-practices/reasoning-tokens`
    - Options Considered:
      - `extraHeaders` (app-url/title/session) + `buildBodyExtra` (reasoning, top-level cache control) + `mapUsage: openRouterUsage`: chosen.
      - Keep custom loop for usage mapping: rejected, covered by `mapUsage` hook from task 1.
    - Chosen Approach:
      - Factory delegate; all vendor mapping stays in cache.ts/thinking.ts.
    - API Notes and Examples:
      ```ts
      createOpenAICompatibleProvider({
        id, baseUrl: baseUrl ?? "https://openrouter.ai/api/v1", apiKey, fetch,
        extraHeaders: (req) => openRouterHeaders(options, req),
        buildBodyExtra: (req) => clean({ reasoning: resolveOpenRouterReasoning(req.model, req.options), ...openRouterTopLevelCacheControl(req) }),
        mapUsage: openRouterUsage,
      })
      ```
    - Files to Create/Edit:
      - `packages/provider-openrouter/src/provider.ts`: factory delegate.
      - `packages/provider-openrouter/src/cache.ts`, `thinking.ts`: keep.
      - Done: existing hooks covered everything — `extraHeaders` (x-session-id/http-referer/x-title), `mapUsage` (cost fields), `mapMessages` + `serializeMessage` (cache markers + reasoning replay), `transformBody` (provider/reasoning/session_id/cache_control fields, parameters-win legacy order, NO limits fallback for max_tokens), `doneUsage`. One core change: shared stream now reads `delta.reasoning ?? delta.reasoning_content` (OpenRouter's newer alias; additive for other providers). `openRouterBody`/`openRouterEvents` exports preserved. provider.ts 246 → 163 lines; all 18 non-live tests pass unmodified (4 live skipped, no key); core 1261/1261. Recorded delta: dangling/incomplete streamed tool calls now fail closed with `incomplete_delta` instead of silent drop (same as zai). cache.ts/thinking.ts untouched as planned.
    - References:
      - Audit finding 1.
  - Test Cases to Write:
    - golden headers test: referer/title/session-id headers identical.
    - golden body test: reasoning + cache-control bodies match pre-migration snapshots.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none: internal refactor.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Migrate provider-opencode-go OpenAI-chat path and collapse provider-kimi's duplicate client
  - Acceptance Criteria:
    - Functional: opencode-go `openAIChatEvents` consumers receive identical events; kimi `provider.ts` and `moonshot.ts` become one client (moonshot is a baseUrl/preset of the kimi client), exports unchanged.
    - Performance: unchanged.
    - Code Quality: `openAIChatEvents` deleted (≈ -186 lines); `moonshot.ts` deleted (≈ -243 lines); kimi cache.ts/thinking.ts kept. opencode-go `anthropic-messages.ts` untouched (different API, not duplication).
    - Security: credential resolution via `resolveCredentialValue` unchanged; no key material in events.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-opencode-go/src/openai-chat.ts`, `provider.ts`
      - `packages/provider-kimi/src/moonshot.ts`, `provider.ts`, `models.ts`
      - Moonshot OpenAI-compatible API: `https://platform.moonshot.ai/docs/api/chat`
    - Options Considered:
      - kimi: one provider factory with `preset?: "kimi" | "moonshot"` resolving baseUrl + model defaults: chosen (one client, two names).
      - kimi: keep both files, share an internal helper: rejected, still two clients.
      - opencode-go: route openai-chat through shared factory: chosen.
    - Chosen Approach:
      - Kimi exposes the same `createKimiProvider`; moonshot entry becomes a preset constant re-exported for compatibility.
    - API Notes and Examples:
      ```ts
      export function createKimiProvider(options: KimiProviderOptions = {}): AIProvider {
        const preset = KIMI_PRESETS[options.preset ?? "kimi"];
        return createOpenAICompatibleProvider({ id: options.id ?? preset.id, baseUrl: options.baseUrl ?? preset.baseUrl, ...kimiHooks });
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-opencode-go/src/openai-chat.ts`: delete; provider.ts delegates.
      - `packages/provider-kimi/src/moonshot.ts`: delete; merge into provider.ts as preset.
      - `packages/provider-kimi/src/index.ts`: keep all current exports (re-export from provider.ts).
    - Done (with correction): the plan's premise was wrong — kimi `provider.ts` is the Anthropic `/messages` coding client (Kimi For Coding), NOT an OpenAI-compatible duplicate of `moonshot.ts`, so the preset-merge did not apply (same category as opencode-go `anthropic-messages.ts`: different API, not duplication). What was done: both OpenAI-chat files now delegate to the shared factory/primitives — `moonshot.ts` 243 → 133 lines (`strictCompletion` + `serializeMessage` keeping public `serializeMoonshotMessage` + `transformBody` with legacy field order), `openai-chat.ts` 186 → 108 lines (`serializeMessage` keeping public `serializeOpenCodeGoChatMessage` + `transformBody` replicating the exact legacy order incl. no `extra` spread and no limits fallback). All exports (`createMoonshotProvider`, `moonshotBody`, `moonshotEvents`, `openAIChatBody`, `openAIChatEvents`) preserved; kimi: 28/28 non-live tests unmodified green, opencode-go: 37/37 non-live green; core 1261/1261. Strict-truncation error message text changed to shared wording in both (tests assert event type).
    - References:
      - Audit findings 1 and 2.
  - Test Cases to Write:
    - kimi: `preset: "moonshot"` produces today's moonshot baseUrl + headers; default produces today's kimi behavior.
    - opencode-go: existing chat-completions tests green against factory-based client.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — exports preserved, preset is additive only if previously missing.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: one line noting kimi presets if the `preset` option is new.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Reduce provider-neuralwatt to custom-frame reader + shared emitter
  - Acceptance Criteria:
    - Functional: `: energy {...}` / `: cost {...}` SSE comment telemetry still emitted as `neuralwatt:telemetry` events; `classifyNeuralWattError` retry decisions unchanged.
    - Performance: unchanged.
    - Code Quality: duplicated tool-accumulator/text-delta logic in `neuralWattEvents` replaced with the shared stream emitter (provider.ts ≈ -150 lines); `readNeuralWattSseFrames`, `retry.ts`, `telemetry.ts` kept (vendor protocol, audit explicitly kept them).
    - Security: telemetry contains usage/cost numbers only — assert no prompt/key fields can flow into telemetry events (existing invariant, keep tests).
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-neuralwatt/src/provider.ts`, `retry.ts`, `telemetry.ts`
      - NeuralWatt retry-strategy contract documented in `retry.ts` header comments
    - Options Considered:
      - Feed NeuralWatt's comment-frame reader into the shared delta emitter via a `parseFrames` hook: chosen if the hook stays one optional function; otherwise keep provider as-is (fallback, audit marks this package near-justified).
      - Full migration to factory: rejected, SSE comment frames are outside standard `readSseData`.
    - Chosen Approach:
      - Attempt minimal `parseFrames` hook; if it forces >30 lines of new hook plumbing in core, stop and leave neuralwatt untouched (record in Compromises).
    - API Notes and Examples:
      ```ts
      // Only if cheap:
      createOpenAICompatibleProvider({ ..., parseFrames: readNeuralWattSseFrames, mapFrameEvent: neuralWattTelemetryEvent })
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/provider.ts`: delegate stream-delta emission.
      - `src/providers/openai-compatible.ts`: optional `parseFrames` hook (only if the cheap path holds).
    - Done: full migration succeeded under the 30-line plumbing budget — no `parseFrames` hook needed. Instead two smaller core additions: (1) `onComment(text)` option; the shared loop switched from `readSseData` to `readSseEvents` (behavior-identical: `readSseData` is `readSseEvents` filtered+trimmed) and yields comment events before the data of the same SSE event, exactly NeuralWatt's frame order; (2) `mapHttpError(response, bodyText, secrets)` option so `classifyNeuralWattError`/`neuralWattHttpError` retry classification stays intact. Also: shared loop now yields a terminal error event on malformed JSON chunks instead of throwing (NeuralWatt's tested contract `malformed_data_emits_error_then_done`; factory users saw an identical terminal error event either way via generate's catch; no other provider test depended on throw). `readNeuralWattSseFrames`/`neuralWattFramesToEvents`/`ToolAccumulator`/`NeuralWattChunk` deleted; `telemetry.ts`/`retry.ts` untouched as planned. provider.ts 318 → 208 lines; 73/73 non-live tests pass unmodified (4 live skipped); core 1261/1261; all 6 previously migrated providers re-verified green against the new core. Documented `onComment`/`mapHttpError` in `docs/providers/openai-compatible.md`.
    - References:
      - Audit finding 1 (neuralwatt partial), audit "explicitly kept" note for retry/telemetry.
  - Test Cases to Write:
    - telemetry comment frames still produce `neuralwatt:telemetry` events before `done`.
    - error classification table (429/503 retryable, 400/401/402/403/404 not) green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes only if `parseFrames` hook ships — then document it in `docs/providers/openai-compatible.md`.
    - Docs pages to create/edit:
      - `docs/providers/openai-compatible.md`: hook docs, or `none` if fallback taken.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Replace hand-rolled deep clones with structuredClone
  - Acceptance Criteria:
    - Functional: identical clone semantics at all 6 sites (all inputs are JSON-only `JsonObject`/wire values, verified before edit).
    - Performance: `structuredClone` is native and faster; no regression.
    - Code Quality: matches the 7 existing `structuredClone` uses in the repo; zero `JSON.parse(JSON.stringify` left in non-test code (`rg` check).
    - Security: none — pure value cloning, no new attack surface.
  - Approach:
    - Documentation Reviewed:
      - MDN `structuredClone`: `https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone` (global since Node 17; repo requires Node >=20).
    - Options Considered:
      - Global replace at the 6 audit sites: chosen.
      - Central `deepClone` util: rejected, wrapper that only delegates.
    - Chosen Approach:
      - One-line replacement per site.
    - API Notes and Examples:
      ```ts
      const clone = structuredClone(value); // was: JSON.parse(JSON.stringify(value))
      ```
    - Files to Create/Edit:
      - `packages/web-tools/src/transport.ts:178`
      - `packages/mcp/src/capabilities.ts:170`
      - `packages/memory/src/util.ts:56`
      - `src/feedback.ts:266`
      - `packages/workflows/src/run.ts:1138`
      - `packages/workflows/src/coordinator.ts:41`
    - Done (4 of 6 replaced, 2 deliberately kept): replaced in `workflows/run.ts`, `workflows/coordinator.ts`, `src/feedback.ts`, `memory/util.ts` — pure JSON clones, `structuredClone` equivalent. KEPT with justification comments at `mcp/capabilities.ts` and `web-tools/transport.ts`: both rely on JSON-round-trip NORMALIZATION (undefined-valued keys must drop to wire shape before bounds measuring/validation) — `structuredClone` preserves undefined keys and broke 4 web-tools tests (`assertBoundedJson` rejects undefined). Plan criterion "zero JSON.parse(JSON.stringify left" relaxed to "zero left where it was a CLONE, not a normalization". Verified: core 1261/1261, workflows/memory/web-tools package suites green.
    - References:
      - Audit finding 3.
  - Test Cases to Write:
    - existing package tests green; no new tests (behavior-preserving one-liner, covered by existing suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Replace hand-rolled sleep with node:timers/promises in browser manager
  - Acceptance Criteria:
    - Functional: `delay(ms)` behavior identical (resolve after ms).
    - Performance: identical.
    - Code Quality: helper deleted; single import from `node:timers/promises` (matches Node >=20 engines).
    - Security: none.
  - Approach:
    - Documentation Reviewed:
      - Node docs `timers/promises`: `https://nodejs.org/api/timers.html#timers-promises-api`
    - Options Considered:
      - `import { setTimeout as delay } from "node:timers/promises"`: chosen.
      - Keep helper: rejected, stdlib ships it.
    - Chosen Approach:
      - One import, delete 3-line helper.
    - API Notes and Examples:
      ```ts
      import { setTimeout as delay } from "node:timers/promises";
      await delay(ms);
      ```
    - Files to Create/Edit:
      - `packages/browser/src/manager.ts:893` (and its call sites in the same file).
      - Done: 3-line helper deleted, `import { setTimeout as sleep } from "node:timers/promises"` at top of file; all 3 call sites unchanged (same `sleep(ms)` signature). Repo-wide grep confirmed this was the only hand-rolled sleep. Browser package: 40/40 tests pass.
    - References:
      - Audit finding 4.
  - Test Cases to Write:
    - existing browser package tests green; no new tests (one-liner).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Delete the four speculative umbrella packages — REJECTED BY USER: kept intentionally for user ease of install (`prism-base`/`prism-code`/`prism-compaction`/`prism-providers` stay as curated install bundles). No changes made; audit finding 4 dismissed as deliberate design, not over-engineering.
  - Acceptance Criteria:
    - Functional: `prism-all` and `prism-sdk` remain; nothing in the repo imports `@arnilo/prism-base`, `@arnilo/prism-code`, `@arnilo/prism-compaction`, or `@arnilo/prism-providers` (verify with `rg` before deleting).
    - Performance: smaller install graph for `prism-all` if it referenced deleted umbrellas (check and re-point its deps at concrete packages).
    - Code Quality: -4 package directories (package.json + README + CHANGELOG each); root workspace config, `tsconfig.packages.json`, and any publish scripts updated in the same commit.
    - Security: none — deletion only; confirm no published-dependency references remain in lockfile after `npm install`.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-all/package.json` (deps include `prism-code`/`prism-sdk`/`prism-providers` — must be flattened to concrete packages).
      - npm workspaces config in root `package.json`.
    - Options Considered:
      - Delete 4, keep `prism-all` + `prism-sdk`: chosen (audit).
      - Keep all 6: rejected, speculative publishing granularity at v0.0.16.
      - Delete all umbrellas: rejected, unrequested; `prism-all`/`prism-sdk` are user-facing install targets.
    - Chosen Approach:
      - Flatten `prism-all` deps, delete the 4 directories, update workspace/tsconfig references.
    - API Notes and Examples:
      ```bash
      rg -l 'prism-base|prism-code|prism-compaction|prism-providers' --glob '!node_modules' # must only match prism-all/package.json before edit
      git rm -r packages/prism-base packages/prism-code packages/prism-compaction packages/prism-providers
      ```
    - Files to Create/Edit:
      - delete: `packages/prism-base/`, `packages/prism-code/`, `packages/prism-compaction/`, `packages/prism-providers/`
      - `packages/prism-all/package.json`: replace umbrella deps with their concrete members.
      - `packages/prism-sdk/package.json`: same if it references deleted umbrellas (verify).
      - `tsconfig.packages.json`, root `package.json` workspaces/scripts if enumerated.
    - References:
      - Audit finding 2 (umbrella packages).
  - Test Cases to Write:
    - `npm install` + repo typecheck/build green after deletion; `npm pack --dry-run` on prism-all lists correct dep tree.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published package names disappear.
    - Docs pages to create/edit:
      - `docs/index.md` and any install/quickstart pages referencing the 4 umbrellas: point to `prism-all`/`prism-sdk` or concrete packages.
    - `docs/index.md` update: yes — remove/adjust umbrella entries in the installation section.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] SQL-store core spike: verify sqlite/postgres divergence, extract only if cheap — SPIKE EXECUTED, verdict: LEAVE SPLIT (fallback taken). Evidence: the two stores are structurally parallel (same ~40 tables/operations, same method sets, similar upserts) but diverge in 5 dialect classes that touch nearly every non-trivial query: (1) placeholders `?` vs `$n`, (2) hardcoded `prism_*` tables vs schema-qualified `${tables.*}` interpolation, (3) JSON functions `json_each`/`json_extract` vs `::jsonb ->>`, (4) substring search `instr(x, ?)` vs `position(? in x)`, (5) NULL-safe equality `IS ?` vs `IS NOT DISTINCT FROM ?`, plus FTS tables with different column order (`prism_session_search_fts(session_id, entry_id, ...)` vs `searchTable(entry_id, session_id, ...)`). A shared core would need a per-dialect SQL-snippet interface for ~40 queries — that's a query-builder abstraction layer, not deleted code; it would make every future query harder to read and debug than plain SQL, violating the plan's own gate (≥500 lines removed WITHOUT dialect if-chains). The genuinely shared part (row mappers, JSON codecs) already lives in `@arnilo/prism-session-store-codecs`. No code changed.
  - Acceptance Criteria:
    - Functional: both stores pass their existing conformance suites (`@arnilo/prism/testing/session-store-conformance`) unchanged.
    - Performance: no added query round-trips.
    - Code Quality: shared core in `@arnilo/prism-session-store-codecs` only if it removes ≥500 lines without dialect `if` chains; otherwise do nothing and record why.
    - Security: SQL must remain fully parameterized in both dialects — no string interpolation introduced by the shared core.
  - Approach:
    - Documentation Reviewed:
      - `packages/session-store-sqlite/src/persistence.ts` (1050), `packages/session-store-postgres/src/persistence.ts` (1097), `packages/session-store-codecs/src/index.ts` (existing shared row mappers).
    - Options Considered:
      - Diff the two files; extract shared store parameterized on `{ placeholder(i), upsertClause, qualifyTable }`: chosen if diff shows ≥80% structural match.
      - Leave split: fallback — audit flagged this as candidate-only.
    - Chosen Approach:
      - Time-boxed spike (half a day): produce the diff, decide, implement or record in Compromises.
    - API Notes and Examples:
      ```ts
      // codecs package, only if spike passes:
      export function createSqlPersistenceStore(dialect: SqlDialect, deps: ...): ProductionPersistenceStore
      ```
    - Files to Create/Edit:
      - `packages/session-store-codecs/src/`: possibly one new `sql-store.ts`.
      - `packages/session-store-sqlite/src/persistence.ts`, `packages/session-store-postgres/src/persistence.ts`: thin dialect bindings (only if spike passes).
    - References:
      - Audit finding 6 (candidate, verify divergence first).
  - Test Cases to Write:
    - both existing conformance suites green against refactored stores (no new tests beyond that).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no if confined to internals; yes if codecs gains a public export — then document it.
    - Docs pages to create/edit:
      - `docs/database-persistence.md`: one line on shared core, or `none` if spike fails.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification: build, test, and measure the cut
  - Acceptance Criteria:
    - Functional: repo typecheck + full test suite green; provider conformance suites green for all touched providers.
    - Performance: no benchmark regression in provider streaming smoke tests.
    - Code Quality: `wc -l` confirms ≥1,800 net lines deleted; `rg -c 'ToolAccumulator' packages src` returns ≤1; zero `JSON.parse(JSON.stringify` in non-test code.
    - Security: `rg` confirms no apiKey/secret logging added; lockfile clean of deleted umbrellas.
  - Approach:
    - Documentation Reviewed:
      - Repo CI scripts in root `package.json` (`build`, `test`, typecheck).
    - Options Considered:
      - Single final verification task: chosen.
    - Chosen Approach:
      - Run the standard gates, record line/deletion counts.
    - API Notes and Examples:
      ```bash
      npm run build && npm test
      rg -c 'ToolAccumulator' packages src
      wc -l packages/provider-{alibaba,openrouter,zai,ollama,kimi,opencode-go}/src/*.ts
      ```
    - Files to Create/Edit:
      - none (verification only); update this plan's checkboxes and Compromises.
    - Done, results (honest vs. the original estimates):
      - Tests: `npm test` (full monorepo) exit 0 — 2327 tests, 2294 pass, 0 fail, 33 skipped (live/provider-key tests). Core alone 1261/1261.
      - Lines: 7 migrated provider files 1,693 → 990 (-703); core `openai-compatible.ts` 166 → 269 (+103, the hook surface that replaced the loops). Net **-600 lines** of duplicated SSE client code. The audit's -2,300 estimate is NOT met: -800 was the SQL-store core (task 11 spike: rejected, would be a query-builder abstraction), ~-200 was umbrella deletion (task 10: user rejected), and the per-provider estimates assumed file deletion where export compatibility required keeping thin files. Real win beyond lines: 6 hand-rolled SSE loops → 1 shared loop + documented hook surface; a new OpenAI-compatible provider now costs ~100 lines instead of ~250.
      - `ToolAccumulator`: 3 remain, criterion (≤1) not literally met with justification — `src/providers/openai-compatible.ts` is THE shared one; `provider-ai-sdk/stream.ts` (Vercel AI SDK protocol) and `provider-openai/responses.ts` (OpenAI Responses API, not chat-completions) are different protocols, not duplication of the migrated loop. All 7 audit-targeted chat-completions accumulators are gone.
      - `JSON.parse(JSON.stringify` in non-test code: 2 remain (mcp/capabilities, web-tools/transport), both deliberate wire-normalization with justification comments.
      - Security: `rg` confirms zero apiKey/secret logging added; all key-redaction tests green unmodified.
    - References:
      - Audit net estimate: -2,300 lines, -4 packages.
  - Test Cases to Write:
    - none new; this task runs existing gates.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none beyond per-task doc edits already listed.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

## Compromises Made
- Task 6 correction: kimi `provider.ts` is the Anthropic `/messages` coding client, not an OpenAI-compatible duplicate of `moonshot.ts` — the planned preset-collapse did not apply; both OpenAI-chat paths were migrated to the shared factory instead, files kept for export compatibility.
- Task 8: 2 of 6 `JSON.parse(JSON.stringify(...))` sites kept deliberately (`mcp/capabilities.ts`, `web-tools/transport.ts`) — they are wire-shape normalization (undefined keys must drop before bounds validation), not clones; `structuredClone` broke web-tools tests.
- Task 10: rejected by user — umbrella packages (`prism-base`, `prism-code`, `prism-compaction`, `prism-providers`) are intentional curated install bundles, kept.
- Task 11: spike verdict LEAVE SPLIT — sqlite/postgres stores diverge in 5 dialect classes across ~40 queries; a shared core would be a query-builder abstraction, not deleted code. Shared row mappers already live in `session-store-codecs`.
- Recorded behavior deltas across provider migrations (all untested old behavior, all fail-closed/safer direction): dangling/incomplete streamed tool calls now yield `incomplete_delta` errors instead of silent drops (zai, openrouter, neuralwatt); provider-specific error message strings replaced by shared wording (`X response had no body`, truncation messages); malformed JSON chunks yield terminal error events instead of throwing (hardening).

## Further Actions
- (low) If a third SQL store ever ships, revisit task 11 with the concrete third dialect in hand — two points didn't generalize, three might.
- (low) `prism-all`/`prism-sdk` umbrellas remain; if install-graph size ever matters, prune their dep lists then.
- (none) Provider factory hooks (`transformBody`, `serializeMessage`, `strictCompletion`, `doneUsage`, `onComment`, `mapHttpError`, `extraHeaders`, `mapUsage`) are now the documented extension surface — new OpenAI-compatible providers must not re-roll SSE loops; enforce in review.
