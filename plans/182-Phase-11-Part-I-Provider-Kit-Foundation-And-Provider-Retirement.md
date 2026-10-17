# Phase 11 Part I — provider-kit foundation and provider retirement

## Objectives

- Ship four provider packages in 0.13.0: `hyper`, `opencode-go`, `typesafe` (Jev), and `laya`. These are the providers the owner can test live. Delete the other 17 provider packages and every reference to them.
- Reduce `@arnilo/prism/provider-kit` to what a provider package needs: the package shell, transport, three wire codecs (OpenAI Chat Completions, Anthropic Messages, System One), a routed-provider builder, a cache planner, one usage contract, and the conformance and recorded-wire tests. Remove vendor-specific modules and OpenAI Responses.
- Fix the Anthropic Messages codec defects found in the 2026-10-16 review, using fixtures recorded from real responses instead of hand-written mocks.
- Give `Usage` one meaning across codecs so cost, limits, and cache hit rate are correct on every route.
- Let a host write a provider package for any vendor that uses these formats from the kit alone, and prove it with a conformance suite the host can run.

## Expected Outcome

- `packages/providers/` holds `hyper`, `opencode-go`, `typesafe`, `laya` and nothing else. No live-tree file names a deleted package, except the retired-name list (plan 187 Task 1) and `CHANGELOG.md`.
- `src/provider-kit/` has no `openai-responses`, `openai-uploads`, `openai-cache`, `openai-thinking`, `openai-compat`, `oauth`, `oauth-device-code`, `image-generation`, or `model-discovery` module. The kept modules are grouped by role: `package`, `transport`, `codecs/{openai-chat,anthropic-messages,systemone}`, `routed-provider`, `cache`, `usage`, `conformance`, `wire-replay`.
- `anthropicMessagesEvents` handles `message_delta`, merges usage, captures `signature_delta` and `redacted_thinking`, maps `error` events, and survives malformed frames. It is tested against recorded Hyper and OpenCode Go streams.
- `Usage.inputTokens` is the total prompt token count, with cache reads and writes as subsets, on every codec. `cacheHitRate` and the catalog cost formula follow that rule.
- `createRoutedProvider({ id, baseUrl, apiKey, routes, routeFor })` builds a working dual-route provider in about 30 lines. `docs/provider-kit.md` shows one, and `examples/custom-provider.ts` runs it offline.
- The default cache breakpoints mark the system prompt and the newest message, which matches Claude Code.
- `bun scripts/wire-proxy.mjs --record <dir>` records real response streams with secrets removed, for fixtures and for plan 184.

**0.13.0 release path — plan 182 of 181–187.** Start it when plan 181 is complete; when this plan is complete, continue with plan 183. Plans 181–188 run strictly in step order (see `plans/README.md`), and nothing runs in parallel.

This plan is a pre-publish part of roadmap **Phase 11**, made necessary by the owner's decision of 2026-10-16: only providers the owner can test live ship in 0.13.0; the other 17 are deleted and rewritten on the new kit later (git history keeps the code). It changes a kernel contract (the `provider-kit` subpath and the meaning of `Usage`), so **Task 1 is the phase review**. It **changes roadmap §2.8** (the 21-package provider row) and Phase 5 "Provider packages" (Task 2). It comes before the surface freeze (plan 185), so the freeze sees the reduced kit and only four provider packages to migrate off `CredentialValueSource`. No version bump, publish, or npm deprecation here. The deprecation entries for the 16 deleted packages already published at 0.3.1 are applied by plan 187 Task 2. Lab impact: n/a (`packages/prism-code` was deleted by plan 173).

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Package inventory.** Every file outside the 17 deleted packages that names one of them, from the repo-wide grep (the review on 2026-10-16 counted about 60: `examples/*` (12 files), `scripts/*` (about 25 files, including `live-matrix.json`, `package-truth.json`, `coverage-thresholds.json`, `e2e-coverage.json`, `phase54-package-map.mjs`, `provider-{toolcall,thinking}-conformance.test.mjs`, `provider-tool-result-wire.test.mjs`, `provider-discovery-gate.test.mjs`), `src/__tests__/{docs,install-smoke,packaging,release,package-setup-boundaries}.test.ts`, `templates/init/providers.json`, `.github/workflows/coding-journey.yml`, `packages/credentials/keyring/{package.json,src/__tests__/package.test.ts}`, `packages/memory/rag/README.md`, `docs/{index,models,migrate-to-0.13,migration,peer-dependencies,performance,release}.md`, `README.md`, `PRODUCT.md`, `roadmap.md`, and `scripts/compat-baseline/arnilo__prism-provider-*.txt`). Each file gets a disposition: edit, delete, or regenerate.
      - (b) **Kit symbol inventory.** For each export of `src/provider-kit/index.ts`, its callers after the deletion (`graft callers <symbol> --depth all`), and a verdict: *keep* (used by the kernel, `/testing`, or at least one of the four packages), *move into a codec*, or *delete*. Expected deletes: `openai-responses.ts` (Hyper's opt-in `responses` route is its last non-OpenAI user, `packages/providers/hyper/src/provider.ts:30-36`), `openai-uploads.ts`, `openai-cache.ts`, `openai-thinking.ts`, `openai-compat.ts`, `oauth.ts`, `oauth-device-code.ts`, `image-generation.ts` (and `runImageGenerationConformance`), `model-discovery.ts`, and the OpenAI Responses helpers in `media.ts:88-115`. Expected keeps: `structured-output` (used by `src/agent-session/session/assemble.ts`), `schema`, `media` (PDF/image resolve for Anthropic), `thinking`, `retry-http`, `transport`, `cache-helpers`, `provider-request-policy`, `package`, `provider-package`, `systemone*`, `conformance` (without image generation), `openai-compatible` (the kernel's built-in provider, `src/models/builtin.ts:3`), and `openai-primitives`.
      - (c) **Usage consumers.** Every reader of `Usage.inputTokens`/`cacheReadTokens`/`cacheWriteTokens` and the meaning it assumes: `src/agent-session/session/provider-round.ts:110-115` (catalog cost assumes input *excludes* cache, which overcharges on OpenAI-style usage), `src/provider-kit/cache-helpers.ts:92-96` (`cacheHitRate = read / input`, which is wrong for Anthropic usage), `src/run-limits.ts:275`, `src/agent-session/helpers.ts:165`, `src/driver-kit/normalize/usage.ts:20-27`, `packages/integrations/observability/src/{summary,timeline}.ts`, `packages/hosts/ag-ui/src/ag-ui-mapper.ts:464`, `src/usage-estimation.ts`, and the context meter. Also the codec mappers: `openai-primitives.ts:128-151` (inclusive) and `anthropic-messages.ts:236-245` (exclusive). Verdict: confirm **inclusive** (`inputTokens` = every prompt token, with cache read and write as subsets). Reason: the kernel's built-in provider, `maxInputTokens`, and context meters already read it that way. Name each line that changes.
      - (d) **Anthropic codec defects**, checked against Anthropic's streaming reference (find-docs, record the date): `"message.delta"` vs the wire `message_delta` (`anthropic-messages.ts:88,109`, and the fixtures that copy it: `hyper.test.ts:482`, `src/__tests__/anthropic-messages.test.ts:143`); usage replaced rather than merged (`:110`); no `signature_delta` (thinking replay without a signature fails on Claude-backed models); `redacted_thinking` dropped; no `error` event (an overload mid-stream is reported as truncation); unguarded `JSON.parse` (`:86`); `ping` ignored (correct, but assert it).
      - (e) **Cache planner.** `last_stable_message` resolves to `messages.length - 2` (`cache-helpers.ts:130`), so the newest tool result is never written to the cache. `tools` resolves to the first tool *message*, not the tool definitions (`:124-127`). Record Claude Code's breakpoint placement (system block plus the last message, rolling) from its published docs, and how Anthropic's 20-block lookback reads earlier writes. Decide the new defaults.
      - (f) **Duplication to fold into the kit**: `serializeHyperChatMessage` vs `serializeOpenCodeGoChatMessage` (`hyper/src/openai-chat.ts:37-95`, `opencode-go/src/openai-chat.ts:45-104`), the `*PreserveThinking`/`*Thinking`/`*ReasoningEffort`/`strip*OwnedCompat` helpers in both `thinking.ts` files, `*AnthropicCacheEnabled`/`apply*AnthropicCacheControl` in both `cache.ts` files, and the two `generate()` loops (`hyper/src/provider.ts:38-86`, `opencode-go/src/provider.ts:35-79`). List the real differences, which become route options: Hyper's `max_tokens` handling and absent session header; OpenCode Go's required session, `reasoning` object merge, image-capability gate, and `ttl: "1h"`.
      - (g) **Embeddings gap.** After the deletion no shipped provider declares `embeddings` (today only `alibaba`, `google`, `openai`). Confirm `packages/memory/rag` and `memory/fabric` work with any host-registered `EmbeddingsProvider` and their tests use the mock. The README change goes in Task 2; a shared OpenAI-compatible embeddings codec goes to Further Actions.
      - (h) **Roadmap edits** for Task 2: §2.8 row (`roadmap.md:594`), Phase 5 Scope "Provider packages" and Done "Each provider package passes provider conformance" (`roadmap.md:1789-1800`), Part 2 subpath list (`roadmap.md:188`), and `PRODUCT.md:59,101`.
      - (i) **Published names.** npm `latest` for the 17 deleted names on the review date. The 2026-10-16 survey found 16 at `0.3.1` (all except `commandcode`), plus `opencode-go@0.3.1`. Also `scripts/deprecations-0.13.json:35-37`, whose `prism-providers` successor text points at `@arnilo/prism-provider-*`.
      - Verdict: proceed, or re-cut the plan.
    - Performance: n/a — read-only.
    - Code Quality: Every finding cites `file:line`; every kit export has a verdict.
    - Security: The review lists the secret-handling paths the codec rewrite must keep: `providerError(error, secrets)`, `readBoundedResponseText({ secrets })`, and provider-owned auth headers applied last.
  - Notes (executed 2026-10-17):
    - **(a) Package inventory & dispositions:**
      Repo-wide grep identified 53 active files outside `packages/providers/{the 17}` referencing the 17 retired packages, plus 17 compat baselines, 4 test/gate files, and deprecations JSON:
      - *Deleted packages (17 directories)*: `packages/providers/{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,commandcode,deepseek,google,kimi,neuralwatt,ollama,openai,openrouter,vertex,xai,zai}` -> **delete** (`git rm -r`).
      - *Compat baselines (17 files)*: `scripts/compat-baseline/arnilo__prism-provider-{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,commandcode,deepseek,google,kimi,neuralwatt,ollama,openai,openrouter,vertex,xai,zai}.txt` -> **delete**.
      - *Vendor-specific examples (9 files)*: `examples/{ai-sdk-provider,anthropic-model-switch,neuralwatt-agent-run,oauth-login,openrouter-model-cache-override,provider-clinepass,provider-deepseek,provider-xai,provider-xai-oauth}.ts` -> **delete**.
      - *Shared examples (4 files)*: `examples/README.md`, `examples/cache-aware-prompt-assembly.ts`, `examples/provider-registration.ts`, `examples/provider-resolver.ts` -> **edit** (switch to `hyper`, `opencode-go`, or mock).
      - *Workflow & documentation (9 files)*: `.github/workflows/coding-journey.yml` (switch to `hyper({ apiKey: "env:HYPER_API_KEY" })`), `PRODUCT.md` (lines 59, 101), `README.md` (quickstart & provider list), `roadmap.md` (§2.8, Phase 5 Scope/Done, Part 2 subpaths), `docs/{index,migrate-to-0.13,migration,models,peer-dependencies,performance,release}.md` -> **edit**.
      - *Live docs generation (1 file)*: `docs/live-testing.md` -> **regenerate** (`node scripts/generate-live-docs.mjs --write`).
      - *Package templates & source references (2 files)*: `templates/init/providers.json` (offer `mock`, `hyper`, `opencode-go`), `src/provider-kit/provider-package.ts` (line 89 doc comment: change sample to `@arnilo/prism-provider-hyper`) -> **edit**.
      - *Kernel & package tests (8 files)*:
        - `src/__tests__/packaging.test.ts`: remove 17 providers from list; rewrite neuralwatt export/peer checks -> **edit**.
        - `src/__tests__/install-smoke.test.ts`: update sample tarball and package matrix to 4 providers -> **edit**.
        - `src/__tests__/docs.test.ts`: remove deleted packages from doc list -> **edit**.
        - `src/__tests__/provider-kit-wire-helpers.test.ts`: replace `@arnilo/prism-provider-openai` context with `@arnilo/prism-provider-hyper` -> **edit**.
        - `src/__tests__/package-setup-boundaries.test.ts`: reduce `providerPackages` table to the 4 kept packages -> **edit**.
        - `src/__tests__/release.test.ts`: update package count from 60 to 43 (60 - 17), replace alibaba existence assertion with hyper -> **edit**.
        - `packages/credentials/keyring/package.json`: remove `devDependencies` entry on `@arnilo/prism-provider-openai`, replace with `@arnilo/prism-provider-hyper` -> **edit**.
        - `packages/credentials/keyring/{README.md,src/__tests__/package.test.ts}`: switch test suite from `openai` to `hyper` -> **edit**.
        - `packages/memory/rag/README.md`: clarify embeddings provider is registered by host -> **edit**.
      - *Scripts & test gates (16 files)*:
        - `scripts/live-matrix.json`: drop 17 rows and google-discovery -> **edit**.
        - `scripts/package-truth.json`: remove 17 packages -> **edit**.
        - `scripts/coverage-thresholds.json`: remove 17 packages -> **edit**.
        - `scripts/e2e-coverage.json`: drop deleted examples and 17 packages -> **edit**.
        - `scripts/phase54-package-map.mjs` & `scripts/phase54-package-map.test.mjs`: drop 17 providers from map & assertions -> **edit**.
        - `scripts/version-literal-gate.test.mjs`: update manifest count expectation (43) -> **edit**.
        - `scripts/packaging-current.test.mjs`: switch openai case to hyper -> **edit**.
        - `scripts/e2e-full-surface.test.mjs` & `scripts/fixtures/e2e-full-surface-journey.mjs`: remove imports of 17 providers -> **edit**.
        - `scripts/benchmark-multi-agent.test.mjs`: remove deleted provider branches -> **edit**.
        - `scripts/tooling-gate.test.mjs`: remove `packages/providers/bedrock/src/sigv4.ts` and `openai/src/oauth.ts` from allowlist -> **edit**.
        - `scripts/phase21-security.test.mjs`: remove deleted provider imports & tests -> **edit**.
        - `scripts/phase24-truth.test.mjs`: remove deleted provider assertions -> **edit**.
        - `scripts/provider-thinking-conformance.test.mjs`: adjust to cover hyper/opencode-go -> **edit**.
        - `scripts/provider-toolcall-conformance.test.mjs`: adjust to cover hyper/opencode-go -> **edit**.
        - `scripts/provider-tool-result-wire.test.mjs`: adjust to cover hyper/opencode-go -> **edit**.
        - `scripts/provider-discovery-gate.test.mjs`: update cases to cover hyper, opencode-go, typesafe, laya -> **edit**.
      - *Deprecations hand-off (1 file)*: `scripts/deprecations-0.13.json`: update line 35 `@arnilo/prism-providers` successor message to name `@arnilo/prism-provider-{hyper,opencode-go,typesafe,laya}` and `@arnilo/prism/provider-kit` -> **edit**.
      - *Historical freeze files (2 files)*: `scripts/phase14-baseline.json`, `scripts/phase29-freeze-manifest.json` -> **allowlist** in the retired provider sweep test.
    - **(b) Kit symbol inventory & verdicts:**
      For every export in `src/provider-kit/index.ts`, traced post-deletion callers via `graft callers <symbol> --depth all`:
      - `openai-responses.ts` (`createOpenAIResponsesProvider`): only callers are `packages/providers/openai`, `packages/providers/hyper/src/provider.ts:34` (Hyper `responses` route), and `src/__tests__/openai-responses.test.ts`. Verdict: **delete**.
      - `openai-uploads.ts` (`createOpenAIFileUploadManager`): callers are `packages/providers/openai` and `openai-responses.ts:73`. Verdict: **delete**.
      - `openai-cache.ts` (`promptCacheKey`, `promptCacheRetention`, `promptCacheOptions`, `applyPromptCacheBreakpoints`): callers are `openai-responses.ts:284` and `src/__tests__/provider-kit-wire-helpers.test.ts`. Verdict: **delete**.
      - `openai-thinking.ts` (`openAIThinkingLevels`, `openAIDefaultEffort`, `isGpt51Family`, `isGpt52Family`): callers are `packages/providers/openai`, `openai-compat.ts:9`, and `provider-kit-wire-helpers.test.ts`. Verdict: **delete**.
      - `openai-compat.ts` (`openAICompatThinkingExtra`, `declaredThinkingLevelsFor`): callers are `packages/providers/vertex` and `provider-kit-wire-helpers.test.ts`. Verdict: **delete**.
      - `oauth.ts` (`oauthCredentialsToSecret`, `secretToOAuthCredentials`, `refreshOAuthCredential`, `revokeOAuthCredential`): callers are `packages/providers/openai`, `packages/providers/xai`, and `provider-kit-wire-helpers.test.ts`. Verdict: **delete**.
      - `oauth-device-code.ts` (`pollDeviceCodeToken`): callers are `packages/providers/openai`, `packages/providers/xai`, `scripts/phase21-security.test.mjs`, and `src/__tests__/oauth-device-code.test.ts`. Verdict: **delete**.
      - `image-generation.ts` (`ImageGenerationError`, interfaces): callers are `conformance.ts:436` (`runImageGenerationConformance`) and tests in deleted `alibaba`/`openai`. Verdict: **delete**.
      - `model-discovery.ts` (`createOpenAiCompatibleModelDiscovery`, `createFakeModelDiscovery`, `runModelDiscoveryConformance`): callers are `packages/providers/google` and `src/__tests__/model-discovery.test.ts`. Neither Hyper nor OpenCode Go uses it (each maps custom vendor catalog envelopes). Verdict: **delete**.
      - `media.ts:88-115` (`openAIAudioFormat`, `serializeOpenAIResponsesInputFile`, `serializeOpenAIResponsesInputAudio`): callers are `openai-responses.ts` and `src/__tests__/provider-media.test.ts`. Verdict: **delete helpers** from `media.ts`.
      - `anthropic-messages.ts`: callers are `hyper`, `opencode-go`, and tests. Verdict: **move into codec** `src/provider-kit/codecs/anthropic-messages.ts` (Task 6).
      - `openai-compatible.ts` / `openai-primitives.ts`: callers are kernel built-in provider (`src/models/builtin.ts:3`), `hyper`, `opencode-go`. Verdict: **move/fold into codec** `src/provider-kit/codecs/openai-chat.ts` and `src/provider-kit/routed-provider.ts` (Task 7).
      - *Kept kit symbols*: `structured-output.ts` (used by `session/assemble.ts`), `schema.ts`, `media.ts` (base64 and PDF/image resolvers for Anthropic), `thinking.ts`, `retry-http.ts`, `transport.ts`, `cache-helpers.ts`, `provider-request-policy.ts`, `package.ts`, `provider-package.ts`, `systemone.ts`, `systemone-decisions.ts`, `systemone-provider.ts`, `systemone-schema.ts`, `conformance.ts` (with `runImageGenerationConformance` removed). Verdict: **keep**.
    - **(c) Usage consumers & inclusive contract:**
      Confirmed **inclusive** definition: `Usage.inputTokens` equals total prompt token count; `cacheReadTokens` and `cacheWriteTokens` are non-negative subsets (`cacheReadTokens + cacheWriteTokens <= inputTokens`).
      - *Rationale*: Kernel's built-in provider, `maxInputTokens` enforcement in `src/run-limits.ts:282`, and `contextMeter()` in `src/agent-session/session.ts:448,462` (`usedRatio: inputTokens / inputCap`) evaluate against total context window capacity. Exclusive input tokens artificially under-report context window pressure and break hit rate formulas.
      - *Consumers analyzed*:
        - `src/agent-session/session/provider-round.ts:108-113`: Catalog cost formula overcharges cached tokens under inclusive semantics. Changes to price uncached input: `(Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)) * (quote.input ?? 0) + (usage.cacheReadTokens ?? 0) * (quote.cacheRead ?? 0) + (usage.cacheWriteTokens ?? 0) * (quote.cacheWrite ?? 0) + (usage.outputTokens ?? 0) * (quote.output ?? 0)) / 1_000_000`.
        - `src/provider-kit/cache-helpers.ts:92-96`: `cacheHitRate(usage) = read / input` is correct and bounded in `[0, 1]` under inclusive semantics.
        - `src/run-limits.ts:275-284`: charges `maxInputTokens` from `usage.inputTokens`. Confirmed correct.
        - `src/agent-session/helpers.ts:165-174`: accumulates fields and derives `totalTokens = usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))`. Confirmed correct.
        - `src/driver-kit/normalize/usage.ts:20-27`: derives `totalTokens = inputTokens + outputTokens`. Confirmed correct.
        - `packages/integrations/observability/src/{summary,timeline}.ts`: sums fields independently. Confirmed correct.
        - `packages/hosts/ag-ui/src/ag-ui-mapper.ts:464`: bounds and serializes fields. Confirmed correct.
        - `src/usage-estimation.ts`: estimates total input tokens for context meter. Confirmed correct.
        - `src/agent-session/session.ts:448`: reads `activeInputMeter` (set from `effective.inputTokens` in `provider-round.ts:138`). Confirmed correct.
        - `src/provider-kit/openai-primitives.ts:128-151`: maps `prompt_tokens` directly (already inclusive on OpenAI wire). Confirmed correct.
        - `src/provider-kit/anthropic-messages.ts:236-245`: currently exclusive (`inputTokens: usage.input_tokens`). Must change to `inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)`.
        - `src/provider-kit/systemone.ts:217-221`: returns `{ inputTokens, outputTokens: 0, totalTokens: inputTokens }`. Confirmed correct.
        - `src/provider-kit/conformance.ts:260`: `assertUsageAccounting` adds check `cacheReadTokens + cacheWriteTokens <= inputTokens`.
        - `src/contracts-core/content.ts:211`: update JSDoc on `Usage` contract.
        - `src/provider-kit/usage.ts` (new): introduce shared `normalizeUsage`.
    - **(d) Anthropic codec defects:**
      Checked against official Anthropic Messages streaming API documentation via Context7 (`/anthropics/anthropic-sdk-typescript`) on 2026-10-17:
      1. *Event name typo*: Wire SSE event is `event: message_delta`, but `anthropic-messages.ts:88,109` checks `event.type === "message.delta"`. Fixed fixtures in `hyper.test.ts:482` and `src/__tests__/anthropic-messages.test.ts:143` copied this bug.
      2. *Usage overwrite*: `message_start` supplies `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`; `message_delta` carries cumulative `output_tokens` and omits input/cache fields when unchanged. Line 108 replaces the whole usage object instead of merging delta fields into start fields.
      3. *Missing signature delta*: Thinking blocks require capturing `delta.type === "signature_delta"` into the block's `signature`. Replaying Claude thinking blocks without a valid signature results in HTTP 400 `invalid_request_error`.
      4. *Dropped redacted thinking*: Claude extended thinking can emit content blocks of `type: "redacted_thinking"` with encrypted `data`. Line 89 drops all blocks except `tool_use`. Redacted blocks must be preserved and replayed verbatim.
      5. *Missing error event handling*: Anthropic emits `event: error` with `{ type: "error", error: { type: string, message: string } }` mid-stream. The parser currently falls through to loop termination, yielding a misleading "Anthropic messages stream ended without completion evidence" error instead of classifying transient vs permanent vendor error codes (`overloaded_error`, `api_error`).
      6. *Unguarded JSON parse*: Line 86 calls `JSON.parse(data)` without error handling; malformed SSE frames throw instead of yielding `providerError`.
      7. *Ping events*: `event: ping` frames must be acknowledged as keepalives and ignored.
    - **(e) Cache planner:**
      - Defect: `last_stable_message` maps to `messages.length > 1 ? messages.length - 2 : messages.length - 1` (`cache-helpers.ts:130`), omitting the newest message and preventing the most recent tool result from being cached.
      - Defect: `tools` breakpoint maps to the first tool *message* in `messages` (`:124-127`), rather than tool definitions in `tools[]`.
      - Claude Code placement & 20-block lookback: Claude Code places cache markers on the system prompt block and on the latest turn (rolling `last_message`). Anthropic matches prefix checkpoints up to 20 content blocks back, allowing earlier cached prefixes to serve as cache reads while writing only the new turn's delta.
      - Decision: Add `last_message` (`messages.length - 1`) to `PromptCacheBreakpointLocation`. Update `DEFAULT_CACHE_BREAKPOINTS` in `provider-request-policy.ts:26-29` to `[{ location: "system_prompt" }, { location: "last_message" }]`. Retain `last_stable_message` for explicit host use. In Anthropic codec, place `tools` breakpoint on the last entry of `tools[]`.
    - **(f) Duplication to fold into the kit:**
      - `serializeHyperChatMessage` (`hyper/src/openai-chat.ts:37-95`) and `serializeOpenCodeGoChatMessage` (`opencode-go/src/openai-chat.ts:45-104`) share identical logic for `role: "tool"`, thinking block folding into `reasoning_content`, `tool_calls` serialization, and base64/URL image blocks. The only variance is OpenCode Go's image capability check (`capabilities.input?.includes("image")`), which becomes the `imageInput: "capability-gated" | "always"` codec option.
      - Helpers in `thinking.ts` (`*PreserveThinking`, `*Thinking`, `*ReasoningEffort`, `strip*OwnedCompat`) and `cache.ts` (`*AnthropicCacheEnabled`, `apply*AnthropicCacheControl`) are duplicate across both packages.
      - Both `generate()` loops share abort checking, key resolution, bounded error body reading with redaction, empty body checks, and SSE dispatch.
      - Real package differences abstracted as routed provider options:
        - `require.sessionId`: required for OpenCode Go before fetch; optional/absent for Hyper.
        - `headers(req)` / affinity: OpenCode Go injects `x-opencode-session` from sanitized `sessionId`/`cacheKey`.
        - `maxTokensField`: `max_tokens` (Hyper) vs `max_completion_tokens`.
        - `mapHttpError`: Hyper HTTP error classifier vs generic status error.
        - `mapUsage`: custom cost fields (Hyper).
        - Cache TTL: `ttl: "1h"` for OpenCode Go Anthropic route.
    - **(g) Embeddings gap:**
      Verified `packages/memory/rag` (`src/embedder.ts`, `src/__tests__/package.test.ts`) accepts any `EmbeddingsProvider` and tests with an in-memory `embeddingsFixture()`. Verified `packages/memory/fabric` (`src/index.ts`, `src/__tests__/package.test.ts`) resolves `services.consume<Embedder>("embeddings")` and tests with `createHashEmbedder`. Neither package imports or requires a specific shipped provider. `packages/memory/rag/README.md` will be updated in Task 2 to document host provider registration. A shared OpenAI embeddings codec is noted for Further Actions.
    - **(h) Roadmap and product edits for Task 2:**
      - `roadmap.md:594`: §2.8 table row updated from 21 provider packages to `@arnilo/prism-provider-{hyper, opencode-go, typesafe, laya}`.
      - `roadmap.md:188`: Part 2 subpath list updated.
      - `roadmap.md:1789-1800`: Phase 5 Scope ("Provider packages") and Done updated to reflect the 4 shipped providers.
      - `PRODUCT.md:59`: replace `@arnilo/prism-provider-anthropic` in example with `@arnilo/prism-provider-hyper`.
      - `PRODUCT.md:101`: update native package table row to `{hyper, opencode-go, typesafe, laya}`.
    - **(i) Published names:**
      Queried npm registry on 2026-10-17:
      - 16 packages published at `0.3.1`: `@arnilo/prism-provider-{ai-sdk, alibaba, anthropic, azure, bedrock, clinepass, deepseek, google, kimi, neuralwatt, ollama, openai, openrouter, vertex, xai, zai}`.
      - `@arnilo/prism-provider-commandcode`: 404 (never published).
      - `@arnilo/prism-provider-opencode-go`: 0.3.1.
      - `@arnilo/prism-provider-{hyper, typesafe, laya}`: 404.
      - `scripts/deprecations-0.13.json:35-37`: `@arnilo/prism-providers` successor message to be updated to name `@arnilo/prism-provider-{hyper,opencode-go,typesafe,laya}` and `@arnilo/prism/provider-kit`.
    - **Security paths verified:**
      `providerError(error, secrets)`, `readBoundedResponseText({ secrets })`, and provider-owned auth headers applied last are preserved across all codecs and the routed provider builder.
    - **Verdict:** Proceed with Task 2.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.1 (models row), §2.8, Phase 5, Phase 11; `PRODUCT.md`; `docs/provider-kit.md`; `src/provider-kit/*.ts`; the four kept packages; plans 174 Task 4 (helpers moved into the kit), 179 Task 1 (d) (credential migration inventory, 36 provider files).
      - Anthropic Messages streaming and prompt-caching references, OpenAI Chat Completions streaming `usage` (find-docs at execution time; record the dates).
    - Options Considered:
      - Keep all 21 packages and mark 17 "experimental". Rejected by the owner: an untested package must not ship.
      - Move the 17 into an unpublished `packages/_retired/` folder. Rejected: they are written against the kit being replaced and would be rewritten anyway (owner, 2026-10-16). Git history keeps them; Task 2 records the last commit that has them.
    - Chosen Approach:
      - One read-only inventory that every later task reads, so no task finds a caller late.
    - API Notes and Examples:
      ```bash
      graft callers createOpenAIResponsesProvider --depth all
      rg -l 'prism-provider-(ai-sdk|alibaba|anthropic|azure|bedrock|clinepass|commandcode|deepseek|google|kimi|neuralwatt|ollama|openai|openrouter|vertex|xai|zai)\b' \
        src packages apps scripts examples docs templates .github README.md PRODUCT.md roadmap.md \
        -g '!dist' -g '!docs/history' -g '!docs/_evidence' -g '!plans'
      ```
    - Files to Create/Edit:
      - this plan (task note only).
    - References:
      - owner decisions of 2026-10-16 (ship hyper, opencode-go, Jev, Laya; delete the 17; drop Responses; cache parity against pi run headless).
  - Test Cases to Write:
    - n/a — read-only review.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: none — the findings feed Tasks 2–8.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2: Delete the 17 provider packages and every reference
  - Execution Notes:
    - **Recovery Point Commit SHA:** `72a4f9df477f21b67d8af58ab1a1cd3ba0dfb975` (parent commit before Task 2 deletions).
    - **Packages and Baselines Deleted:**
      - Deleted 17 provider packages: `packages/providers/{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,commandcode,deepseek,google,kimi,neuralwatt,ollama,openai,openrouter,vertex,xai,zai}` via `git rm -r`.
      - Deleted 17 compat baselines: `scripts/compat-baseline/arnilo__prism-provider-{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,commandcode,deepseek,google,kimi,neuralwatt,ollama,openai,openrouter,vertex,xai,zai}.txt` via `git rm`.
      - Removed retired example tests and dead code: `examples/{ai-sdk-provider,anthropic-model-switch,neuralwatt-agent-run,oauth-login,openrouter-model-cache-override,provider-clinepass,provider-deepseek,provider-xai,provider-xai-oauth}.ts`, `src/__tests__/anthropic-model-switch-example.test.ts`, and dead file `packages/memory/wiki/src/package-command.ts`.
      - Removed stale compiled `.js` files from `examples/` and `packages/stores/jsonl/src/`.
      - Cleaned up unused `answeringUi` and `HostUiRequest` in `packages/credentials/keyring/src/__tests__/package.test.ts`.
      - Added `/.gate-fixture-*/` to `.gitignore` to prevent transient gate-fixture directory leakage during parallel test runs.
    - **Repo-Wide File Sweep Completed:**
      - `examples/`: Updated `examples/README.md` and `scripts/e2e-coverage.json`; switched remaining examples to `hyper` and `opencode-go`.
      - `scripts/live-matrix.json` & `docs/live-testing.md`: Dropped all 17 provider rows + `providers/google-discovery`; regenerated docs via `node scripts/generate-live-docs.mjs --write`.
      - Package Truth & Thresholds: Regenerated `scripts/package-truth.json`, updated `scripts/coverage-thresholds.json`, `scripts/phase54-package-map.mjs`, and `scripts/phase54-package-map.test.mjs`. Ran `bun scripts/package-truth.mjs --emit-docs`.
      - Gates & Tests:
        - Created `scripts/retired-providers.test.mjs` verifying no live tree references and valid deprecation messages naming only supported providers; added to `scripts/run-all-tests.mjs`.
        - Updated `scripts/release-gate.test.mjs`, `scripts/host-completeness-evidence.test.mjs`, `scripts/phase37-provider-matrix.test.mjs`, and `scripts/examples-execution.test.mjs`.
      - Templates & Workflows: `templates/init/providers.json` offers `mock`, `hyper`, `opencode-go`; `.github/workflows/coding-journey.yml` switched to `hyper` with `apiKey: "env:HYPER_API_KEY"`.
      - Credentials Keyring: Switched devDependency and tests from `openai` to `hyper` in `packages/credentials/keyring`.
      - Documentation: Updated `README.md`, `PRODUCT.md` (lines 59, 101), `roadmap.md` (§2.7, §2.9, Phase 5 Scope & Done), `docs/index.md`, `docs/models.md`, `docs/migrate-to-0.13.md`, `docs/migration.md`, `docs/peer-dependencies.md`, `docs/performance.md`, and `CHANGELOG.md` ("Removed: 17 provider packages; 0.13.0 ships hyper, opencode-go, typesafe, laya").
      - Plan 187 Handoff: Added deprecation notices to `scripts/deprecations-0.13.json` pointing to `@arnilo/prism/provider-kit` docs; registry deprecations remain un-applied until owner-gated plan 187.
      - Repo-wide grep: Zero matches across `src packages apps scripts examples docs templates .github README.md PRODUCT.md roadmap.md` outside allowed files (`CHANGELOG.md`, `scripts/deprecations-0.13.json`, historical baseline manifests, and retirement tests).
    - **Verification Results:**
      - `bun install`: Clean resolution across remaining 42 workspaces.
      - `bun run typecheck`: Exited 0 across all 42 workspaces, root, and app host.
      - `bun test scripts/retired-providers.test.mjs`: 2/2 pass.
      - `bun run test` (all 8 stages): All passed (build, performance budget, root suites [1896 pass], gate suites [425 pass], build race, workspace suites [278 pass], examples execution [43 spawned], branch coverage).
      - **Wall Time Performance:** Full `bun run test` wall time decreased from ~165s prior to provider retirement to ~138s (2m 18s).
  - Acceptance Criteria:
    - Functional: `git rm -r packages/providers/{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,commandcode,deepseek,google,kimi,neuralwatt,ollama,openai,openrouter,vertex,xai,zai}` and their `scripts/compat-baseline/arnilo__prism-provider-*.txt`. The task note records the parent commit SHA as the recovery point.
    - Functional: Every file from Task 1 (a) is updated per its disposition:
      - examples that exist only to show a deleted vendor are deleted (`examples/{ai-sdk-provider,anthropic-model-switch,neuralwatt-agent-run,oauth-login,openrouter-model-cache-override,provider-clinepass,provider-deepseek,provider-xai,provider-xai-oauth}.ts`); examples that show a kernel feature (`provider-registration`, `provider-resolver`, `cache-aware-prompt-assembly`) switch to `hyper` or `opencode-go` or the mock provider; `examples/README.md` and `scripts/e2e-coverage.json` follow.
      - `scripts/live-matrix.json` drops the 17 rows (and `providers/google-discovery`); `docs/live-testing.md` table is regenerated (`node scripts/generate-live-docs.mjs --write`).
      - `scripts/package-truth.json`, `scripts/coverage-thresholds.json`, `scripts/phase54-package-map.mjs` and its test, `scripts/version-literal-gate.test.mjs` (manifest count), the `provider-*-conformance`/`provider-tool-result-wire`/`provider-discovery-gate` scripts (rewritten over the four packages or deleted when they only covered deleted vendors), `src/__tests__/{packaging,install-smoke,release,docs,package-setup-boundaries}.test.ts`.
      - `templates/init/providers.json` offers `mock`, `hyper`, `opencode-go`; `.github/workflows/coding-journey.yml` materializes the Hyper provider (`hyper({ apiKey: "env:HYPER_API_KEY" })`) instead of `createOpenAIResponsesProvider`.
      - `packages/credentials/keyring` tests use `hyper` instead of `openai`; its `package.json` dev dependency follows.
      - `docs/index.md` "Providers" lists four packages; `docs/{models,peer-dependencies,performance,release,migration}.md` and `docs/migrate-to-0.13.md` (family-to-native map: the 17 vendors map to "not shipped in 0.13.0; write a package on `@arnilo/prism/provider-kit`") are updated; `packages/memory/rag/README.md` says embeddings come from a host-registered provider (Task 1 (g)).
      - `README.md` and `PRODUCT.md:59,101` use `hyper` in the quickstart and list the four packages.
      - `roadmap.md` §2.8 row, Phase 5 Scope and Done, and the Part 2 subpath list record the owner decision (dated 2026-10-16): four shipped providers, others are host-written or later packages.
    - Functional: Hand-off to plan 187: its Task 1 curated list gains the 17 package names (they are not in the 0.12.1 baseline diff, so the generator cannot find them), and its Task 2 deprecation list gains the 16 names published at `0.3.1`. The message is "Not shipped in Prism 0.13.0. Build a provider on @arnilo/prism/provider-kit: <docs link>". The `prism-providers` entry in `scripts/deprecations-0.13.json:35-37` gets a successor message that names the four packages and the kit. Plan 187's task text already names these entries; the deprecations file is edited here, and `registry-deprecate` is not run.
    - Functional: Repo-wide grep (Task 1 (a) command) returns only `CHANGELOG.md`, `scripts/deprecations-0.13.json`, and plan 187's lists.
    - Performance: `bun install` resolves 17 fewer workspaces; record the root `bun run test` wall time before and after.
    - Code Quality: No stub packages or aliases; the root `workspaces` glob (`packages/providers/*`) needs no edit.
    - Security: The `coding-journey` workflow passes the key as an `env:` ref, never inline.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (a), (g), (h), (i); `scripts/package-truth.mjs:150-190`; `scripts/registry-deprecate.mjs`; plan 175 Task 8 notes (deprecation file format).
    - Options Considered:
      - Delete the kit modules in the same task. Rejected: a smaller diff per task, and Task 3 needs the deletion done first to prove the kit modules have no callers.
    - Chosen Approach:
      - Delete the packages first, with the full sweep, so the tree is green with the old kit and only four consumers.
    - API Notes and Examples:
      ```bash
      git rm -r packages/providers/{ai-sdk,alibaba,...,zai} scripts/compat-baseline/arnilo__prism-provider-{ai-sdk,...,zai}.txt
      node scripts/generate-live-docs.mjs --write
      bun scripts/release.mjs gate --update-baseline
      ```
    - Files to Create/Edit:
      - every file in Task 1 (a); `scripts/deprecations-0.13.json`; `CHANGELOG.md` (`## [Unreleased]`: "Removed: 17 provider packages; 0.13.0 ships hyper, opencode-go, typesafe, laya").
    - References:
      - owner decision 2026-10-16; plan 173 Task 8 (Prism Code sweep pattern).
  - Test Cases to Write:
    - `only_supported_provider_packages_exist` (`src/__tests__/packaging.test.ts`): the provider directory set equals `{hyper, opencode-go, typesafe, laya}`; fails if a package is added without its live suite (plan 183 Task 6 tightens this).
    - `no_live_tree_reference_to_retired_provider` (`scripts/retired-providers.test.mjs`, folded into plan 187 Task 1's `retired-names.test.mjs` when that lands): the Task 1 grep finds nothing outside the allow-list.
    - `deprecation_messages_name_supported_providers`: every new entry in `scripts/deprecations-0.13.json` has the docs link and no package that no longer exists.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — 17 packages are no longer shipped.
    - Docs pages to create/edit:
      - `docs/index.md`, `docs/models.md`, `docs/migrate-to-0.13.md`, `docs/migration.md`, `docs/peer-dependencies.md`, `docs/performance.md`, `docs/release.md`, `docs/live-testing.md` (generated), `README.md`, `PRODUCT.md`, `packages/memory/rag/README.md`, `examples/README.md`, `CHANGELOG.md`.
    - `docs/index.md` update: yes — the Providers list shrinks to four entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Remove vendor-specific modules and OpenAI Responses from the kit
  - Acceptance Criteria:
    - Functional: The Task 1 (b) *delete* modules and their tests (`src/__tests__/{openai-responses,oauth-device-code,model-discovery}.test.ts`, the Responses cases in `provider-media.test.ts`, `runImageGenerationConformance` and its tests) are removed. Hyper's `responses` route is removed (`packages/providers/hyper/src/provider.ts:27-36`, `HyperRoute` loses `"responses"`, the live probe `live_responses_route_*` and the unit `hyper responses route` suite are deleted). A model with `compat.route: "responses"` is rejected by Hyper at `generate()` with `ProviderRequirementError { requirement: "route" }`, not silently sent to chat.
    - Functional: `src/provider-kit/index.ts` exports only *keep* symbols; the root-export freeze (`src/__tests__/public-export-contract.test.ts`) and the `provider-kit` subpath baseline are regenerated (`bun scripts/release.mjs gate --update-baseline`, rewriting `scripts/compat-baseline/arnilo__prism.txt` and `arnilo__prism-provider-hyper.txt`); the note lists every removal attributed to this plan.
    - Functional: Repo-wide grep for every deleted symbol (`createOpenAIResponsesProvider`, `pollDeviceCodeToken`, `createOpenAIFileUploadManager`, `promptCacheKey`, `openAIThinkingLevels`, `openAICompatThinkingExtra`, `ImageGenerationError`, `createOpenAiCompatibleModelDiscovery`, …) over `src/ packages/ apps/ scripts/ examples/ docs/` finds nothing.
    - Performance: Record the kit's line count and the `provider-kit` entry size before and after; the size budget in `scripts/budgets.json` is lowered to the new value with the reason.
    - Code Quality: No re-export shims. If a deleted helper has one remaining caller in a kept module, it is inlined into that module.
    - Security: The redaction paths in Task 1's security list are unchanged (asserted by the existing `credentials-redaction` and `runtime-redaction` suites).
  - Approach:
    - Documentation Reviewed:
      - Task 1 (b); `src/provider-kit/index.ts`; `scripts/budgets.json`; `src/__tests__/public-export-contract.test.ts`.
    - Options Considered:
      - Keep `openai-responses` for a future `openai` package. Rejected by the owner (drop Responses for 0.13.0); git history keeps it.
      - Keep `model-discovery` as a shared `/models` helper for Hyper and OpenCode Go. Decided in Task 1 (b): keep only if both packages adopt it in plan 183; otherwise delete. The plan assumes delete, because the two catalogs map vendor-specific fields.
    - Chosen Approach:
      - Delete by verdict, regenerate baselines, sweep.
    - API Notes and Examples:
      ```bash
      bun scripts/release.mjs gate --update-baseline
      git diff --stat scripts/compat-baseline/
      ```
    - Files to Create/Edit:
      - `src/provider-kit/{openai-responses,openai-uploads,openai-cache,openai-thinking,openai-compat,oauth,oauth-device-code,image-generation,model-discovery}.ts` (delete), `src/provider-kit/{index,media,conformance}.ts`, their tests, `packages/providers/hyper/src/{provider,models,index}.ts` and tests, `scripts/compat-baseline/*`, `scripts/budgets.json`, `src/__tests__/public-export-contract.test.ts`, `docs/provider-kit.md` ("Removed" section), `CHANGELOG.md`.
    - References:
      - Task 1 (b).
  - Test Cases to Write:
    - `hyper_rejects_responses_route` (hyper unit): `compat.route: "responses"` yields `ProviderRequirementError` and no fetch.
    - `provider_kit_exports_match_inventory` (`src/__tests__/provider-kit.test.ts`): the exported names equal the Task 1 (b) keep list.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — kit exports removed.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: remove the deleted APIs and list them under "Removed"; `packages/providers/hyper/README.md`: two routes.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: One usage contract across codecs
  - Acceptance Criteria:
    - Functional: `Usage` (`src/contracts-core/content.ts:211`) documents the rule chosen in Task 1 (c): `inputTokens` is every prompt token; `cacheReadTokens` and `cacheWriteTokens` are subsets of it; `totalTokens = inputTokens + outputTokens` when the vendor omits it.
    - Functional: The Anthropic mapper reports `inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. The Chat mapper keeps `prompt_tokens`. The System One mapper (`systemone.ts` `mapSystemOneUsage`) is checked against the rule. A shared `normalizeUsage` in `src/provider-kit/usage.ts` is the only place a codec builds `Usage`.
    - Functional: Consumers follow the rule. The catalog cost (`provider-round.ts:110-115`) prices `(input − read − write) × input + read × cacheRead + write × cacheWrite + output × output`. `cacheHitRate` is `read / input`, now correct on both codecs. `cacheSavings` is unchanged in form. Every other consumer from Task 1 (c) is checked, and each one that changes is named in the note.
    - Functional: `assertUsageAccounting` (`conformance.ts:260`) also asserts `cacheReadTokens + cacheWriteTokens ≤ inputTokens`, so a codec that breaks the rule fails provider conformance.
    - Performance: n/a — arithmetic on one object per turn.
    - Code Quality: One normalizer; no per-codec arithmetic elsewhere.
    - Security: n/a — no secret-bearing fields.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (c); Anthropic usage fields and OpenAI `prompt_tokens_details` (find-docs).
    - Options Considered:
      - Exclusive (Anthropic-style) `inputTokens`. Rejected in Task 1 (c): `maxInputTokens`, context meters, and the built-in provider already read it as inclusive, and changing them all is the larger diff.
      - Leave per-codec semantics and document them. Rejected: hit rate and cost are wrong on one codec, and plan 184's comparison would mislead.
    - Chosen Approach:
      - Inclusive totals, normalized in one function, enforced by conformance.
    - API Notes and Examples:
      ```ts
      // Anthropic: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 40 }
      // → { inputTokens: 1000, cacheReadTokens: 900, cacheWriteTokens: 90, outputTokens: 40, totalTokens: 1040 }
      ```
    - Files to Create/Edit:
      - `src/provider-kit/usage.ts` (new), `src/provider-kit/{anthropic-messages,openai-primitives,systemone,cache-helpers,conformance,index}.ts`, `src/agent-session/session/provider-round.ts`, `src/contracts-core/content.ts` (doc comment), the consumers Task 1 (c) names, tests, `scripts/compat-baseline/arnilo__prism.txt` if a signature changes, `docs/models.md` ("Usage"), `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - Task 1 (c).
  - Test Cases to Write:
    - `anthropic_usage_is_inclusive_of_cache` and `chat_usage_is_inclusive_of_cache` (`src/__tests__/provider-usage.test.ts`).
    - `catalog_cost_does_not_double_charge_cached_tokens` (`src/__tests__/provider-round-cost.test.ts`): fails on the old formula.
    - `cache_hit_rate_is_at_most_one`: fails on the old Anthropic mapping.
    - `usage_accounting_rejects_cache_above_input` (conformance self-test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the meaning of `Usage.inputTokens` on Anthropic-format routes.
    - Docs pages to create/edit:
      - `docs/models.md`: Usage section; `docs/provider-kit.md`: `normalizeUsage`; `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Wire recorder and replay harness
  - Acceptance Criteria:
    - Functional: `scripts/wire-proxy.mjs` is a Bun HTTP proxy: `--upstream <url> --listen 127.0.0.1:<port>`. It forwards requests unchanged, including auth headers, and streams responses back unchanged. With `--record <dir>` it writes one `<n>.json` per exchange: method, path, request body, status, the `content-type` header, and the raw response body. No other request or response header is ever written. With `--usage-log <file>` it appends one JSONL line per exchange with the raw upstream usage object, parsed by a small format-aware reader that is independent of the kit codecs (so it can check them). Plan 183 relies on this.
    - Functional: Before writing, a recorded exchange is scanned for the values of every variable named by `--secret-env` (for example `HYPER_API_KEY`). A hit aborts the write and exits 3. Response ids and request ids are kept: they are not secrets.
    - Functional: `src/provider-kit/wire-replay.ts` exports `replayFetch(exchanges)`, a `fetch` that serves recorded exchanges in order and fails a test that sends an unexpected path. It also exports `assertRecordedStreamConforms({ provider, request, recording, expect })` on top of `assertProviderStreamConforms`. Both are public, so a host can record its own vendor and test its package the same way.
    - Functional: Fixture layout: `packages/providers/<vendor>/src/__tests__/wire/<route>/<scenario>.json`, plus a `README.md` naming the recording date, model, and command.
    - Performance: The proxy adds no buffering: responses are piped, and recording tees the stream.
    - Code Quality: The proxy is offline-testable with an injected upstream (`Bun.serve` fixture); no dependency added.
    - Security: Listens on loopback only and refuses a non-loopback `--listen`. Never logs headers. The secret scan is mandatory whenever `--record` is set: no `--secret-env` means exit 2.
  - Approach:
    - Documentation Reviewed:
      - `src/provider-kit/conformance.ts:54-73,148-171`; `src/provider-kit/transport.ts:186-260`; Bun `Bun.serve` streaming responses (find-docs).
    - Options Considered:
      - mitmproxy or a third-party recorder. Rejected: an extra tool for operators and harder secret control.
      - Recording inside the provider via an injected `fetch`. Rejected for plan 184: the reference harness (pi) cannot take an injected `fetch`; a base-URL proxy measures Prism and pi the same way.
    - Chosen Approach:
      - One loopback proxy for fixtures and for the cache benchmark, and a replay `fetch` in the kit.
    - API Notes and Examples:
      ```bash
      bun scripts/wire-proxy.mjs --upstream https://hyper.charm.land/v1 --listen 127.0.0.1:8787 \
        --record packages/providers/hyper/src/__tests__/wire/anthropic --secret-env HYPER_API_KEY
      ```
      ```ts
      const provider = createHyperProvider({ apiKey: async () => "k", fetch: replayFetch(load("wire/anthropic/tool-loop.json")) });
      ```
    - Files to Create/Edit:
      - `scripts/wire-proxy.mjs` (new), `scripts/wire-proxy.test.mjs` (new), `src/provider-kit/wire-replay.ts` (new), `src/provider-kit/index.ts`, `src/__tests__/wire-replay.test.ts` (new), `scripts/compat-baseline/arnilo__prism.txt` (new exports), `docs/provider-kit.md`, `docs/live-testing.md` ("Recording wire fixtures"), `CHANGELOG.md`.
    - References:
      - Task 1 (d) (why recorded fixtures are needed).
  - Test Cases to Write:
    - `proxy_records_body_and_content_type_only`, `proxy_aborts_write_on_secret_hit`, `proxy_requires_secret_env_when_recording`, `proxy_refuses_non_loopback_listen`, `proxy_usage_log_reads_both_formats`.
    - `replay_fetch_fails_on_unexpected_path`, `recorded_stream_conforms_helper_reports_mismatch`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new kit exports and an operator script.
    - Docs pages to create/edit:
      - `docs/provider-kit.md` (`replayFetch`, `assertRecordedStreamConforms`), `docs/live-testing.md` (recording procedure).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Anthropic Messages codec, correct against real streams
  - Acceptance Criteria:
    - Functional: `anthropicMessagesEvents` (moved to `src/provider-kit/codecs/anthropic-messages.ts`):
      - reads `message_start.message.usage` and merges each later `message_delta.usage` field by field (a field the delta omits keeps its earlier value);
      - takes `stop_reason` from `message_delta` and yields `providerUsage` on it;
      - accumulates `signature_delta` into the thinking block's `signature` (thinking deltas carry it on the block's final event) and emits `redacted_thinking` as a thinking block with `redacted: true` and its `data`, which the encoder replays verbatim;
      - maps an `error` event to `providerError` with the vendor `error.type` as `code` (`overloaded_error` and `api_error` are transient; the rest are not);
      - turns a malformed frame into a terminal `providerError` instead of a throw;
      - ignores `ping`.
    - Functional: The encoder replays thinking only with its signature. A thinking block with no signature is sent as text when `preserveThinking` is on, never as an unsigned `thinking` block. The rule is taken from the Anthropic docs, and Task 1 (d) records it.
    - Functional: Fixtures: the hand-written `"message.delta"` fixtures (`src/__tests__/anthropic-messages.test.ts:143`, `packages/providers/hyper/src/__tests__/hyper.test.ts:482`) are replaced by recorded streams (Task 5) from Hyper `qwen3.6-plus` and OpenCode Go `minimax-m3` on the Anthropic route: text, tool loop (two turns), thinking with replay, cache write then read, and one error (invalid model). The owner provides the keys through `~/.config/prism/live.env` (plan 186 Task 1); the executor never asks for a key in chat.
    - Functional: The `kimi`/`anthropic` private copies are gone (Task 2), so this module is the only Anthropic parser in the repo (a grep for `content_block_delta` outside it and its tests finds nothing).
    - Performance: No extra buffering; the parser stays a single pass over SSE frames.
    - Code Quality: The `ThinkingContent` additions (`redacted`, `data`) go in `src/contracts-core/content.ts` with the baseline regenerated. No vendor names in the codec.
    - Security: The `error` event message goes through `providerError(error, secrets)`; a recorded error fixture is scanned with `assertNoSecretLeak`.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (d); `src/provider-kit/anthropic-messages.ts:75-121,236-245`; Anthropic streaming events and extended-thinking docs (find-docs; record the dates).
    - Options Considered:
      - Fix the event name and keep the hand-written fixtures. Rejected: the fixtures were written from the code, which is how the bug survived.
    - Chosen Approach:
      - Fix every defect at once, proven by recorded streams.
    - API Notes and Examples:
      ```ts
      for await (const event of anthropicMessagesEvents(body, signal)) { /* … */ }
      // message_start {usage:{input_tokens:12, cache_read_input_tokens:900}} + message_delta {usage:{output_tokens:40}}
      // → done.usage { inputTokens: 912, cacheReadTokens: 900, outputTokens: 40 }
      ```
    - Files to Create/Edit:
      - `src/provider-kit/codecs/anthropic-messages.ts` (moved from `src/provider-kit/anthropic-messages.ts`), `src/provider-kit/index.ts`, `src/contracts-core/content.ts`, `src/__tests__/anthropic-messages.test.ts`, `packages/providers/{hyper,opencode-go}/src/__tests__/wire/anthropic/*` (recorded), `packages/providers/hyper/src/__tests__/hyper.test.ts`, `scripts/compat-baseline/arnilo__prism.txt`, `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - Tasks 4–5.
  - Test Cases to Write:
    - `anthropic_message_delta_sets_stop_reason_and_usage`, `anthropic_usage_merges_start_and_delta`, `anthropic_signature_delta_is_captured_and_replayed`, `anthropic_unsigned_thinking_replays_as_text`, `anthropic_redacted_thinking_round_trips`, `anthropic_error_event_maps_transient_codes`, `anthropic_malformed_frame_is_terminal_error`.
    - `recorded_hyper_anthropic_*` and `recorded_opencode_go_anthropic_*` (one per recorded scenario).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — stop reasons, usage, and thinking replay on the Anthropic route.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: Anthropic Messages codec section; `CHANGELOG.md` (Fixed).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: OpenAI Chat codec options and the routed-provider builder
  - Acceptance Criteria:
    - Functional: `src/provider-kit/codecs/openai-chat.ts` absorbs the duplicated serializer from Task 1 (f) as codec options: `reasoningReplay: "reasoning_content" | "fold" | "drop"`, `imageInput: "capability-gated" | "always"`, `maxTokensField: "max_tokens" | "max_completion_tokens"`, plus the shared `preserveThinking`, `reasoningEffort` (snapped to declared levels), `thinkingObject`, `reasoningObject`, and `stripOwnedCompat(keys)` resolvers. The Anthropic codec takes the same resolvers through its hooks (`AnthropicMessagesRouteHooks` gets defaults, so a package passes only what differs).
    - Functional: `createRoutedProvider(options)` in `src/provider-kit/routed-provider.ts`:
      - `routes: Record<string, { format: "openai-chat" | "anthropic-messages"; path: string; auth: "bearer" | "x-api-key+bearer" | "none"; headers?(req): Record<string,string>; codec?: … }>`
      - `routeFor(request)`, which by default reads `model.compat.route` and falls back to the first route; an unknown route throws `ProviderRequirementError { requirement: "route" }`.
      - `require?: { sessionId?: boolean }`, which fails closed before any fetch (OpenCode Go).
      - `mapHttpError?`, and `mapUsage?` for vendor extras such as Hyper's cost fields.

      It owns: the abort pre-check, key resolution once per request, provider-owned headers applied after caller headers, the bounded error body with redaction, the "no body" error, and dispatch to the codec's encoder and stream decoder. `createOpenAICompatibleProvider` (the kernel's built-in) becomes a one-route `createRoutedProvider`, and its tests stay green.
    - Functional: The System One provider (`systemone-provider.ts`) stays a separate builder (non-streaming, decision-only) but uses the same key resolution, abort, and redaction helpers, so all three formats share one transport path.
    - Performance: No added awaits per request compared with today's loops (asserted by counting `fetch` and credential-resolve calls in tests).
    - Code Quality: The builder has no vendor branches; anything vendor-specific is an option. This task updates Hyper's and OpenCode Go's imports to the moved codec modules so the tree stays green, with no aliases left at the old paths. Moving their `generate()` loops onto the builder is plan 183 Tasks 2–3.
    - Security: Provider-owned auth and `content-type` headers are applied last (`assertProviderOwnedHeadersWin` in the builder's tests). A literal key never appears in errors (`assertNoSecretLeak`).
  - Approach:
    - Documentation Reviewed:
      - Task 1 (f); `src/provider-kit/openai-compatible.ts:166-237`; `packages/providers/{hyper,opencode-go}/src/{provider,openai-chat,thinking,cache}.ts`; `src/provider-kit/systemone-provider.ts:31-73`.
    - Options Considered:
      - A class hierarchy (`BaseProvider` with overrides). Rejected: routes as data are smaller, and a host package becomes configuration.
      - Keep per-package `generate()` loops and share only codecs. Rejected: the loop carries the security-sensitive parts (header order, redaction), which should exist once.
    - Chosen Approach:
      - Codec options plus a routes table, one loop.
    - API Notes and Examples:
      ```ts
      // `apiKey` is `CredentialValueSource` today; plan 185 Task 3 renames it to `SecretSource`.
      export function createAcmeProvider(o: { apiKey: CredentialValueSource; baseUrl?: string; fetch?: typeof fetch }) {
        return createRoutedProvider({
          id: "acme",
          baseUrl: o.baseUrl ?? "https://api.acme.example/v1",
          apiKey: o.apiKey,
          fetch: o.fetch,
          routes: {
            openai: { format: "openai-chat", path: "/chat/completions", auth: "bearer", codec: { reasoningReplay: "reasoning_content" } },
            anthropic: { format: "anthropic-messages", path: "/messages", auth: "x-api-key+bearer" },
          },
        });
      }
      ```
    - Files to Create/Edit:
      - `src/provider-kit/codecs/openai-chat.ts` (from `openai-compatible.ts` and `openai-primitives.ts`), `src/provider-kit/routed-provider.ts` (new), `src/provider-kit/openai-compatible.ts` (thin wrapper or deleted with `src/models/builtin.ts` calling the builder directly), `src/provider-kit/systemone-provider.ts`, `src/provider-kit/index.ts`, `src/models/builtin.ts`, tests (`src/__tests__/{openai-compatible,openai-primitives,routed-provider}.test.ts`), `packages/providers/{hyper,opencode-go}/src/*` (imports only), `examples/custom-provider.ts` (new, offline with `replayFetch`), `examples/README.md`, `scripts/e2e-coverage.json`, `scripts/compat-baseline/arnilo__prism.txt`, `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - Tasks 4–6.
  - Test Cases to Write:
    - `routed_provider_unknown_route_fails_closed`, `routed_provider_requires_session_before_fetch`, `routed_provider_owned_headers_win`, `routed_provider_resolves_key_once`, `routed_provider_redacts_error_body`.
    - `chat_codec_reasoning_replay_modes`, `chat_codec_image_gate_rejects_without_capability`, `chat_codec_effort_snaps_to_declared_levels`.
    - `builtin_provider_on_routed_builder_unchanged` (existing built-in tests, unchanged expectations).
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/custom-provider.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new builder and codec options.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: rewritten around "write a provider package": package shell → routes → codec options → catalog → conformance and recorded fixtures; the Acme example.
    - `docs/index.md` update: no — the page is indexed; its one-line entry is updated if its scope sentence changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Cache planner defaults
  - Acceptance Criteria:
    - Functional: Using the Task 1 (e) decision, `DEFAULT_CACHE_BREAKPOINTS` (`provider-request-policy.ts:26-29`) becomes `system_prompt` plus `last_message`, where the new `last_message` location marks the newest message. `last_stable_message` keeps its meaning for hosts that ask for it. `tools` marks the last tool *definition* on codecs that support it (Anthropic: `cache_control` on the last tool), not a tool message. `maxBreakpoints` is applied after de-duplication.
    - Functional: The Anthropic encoder places tool markers on `tools[]`. The system marker is unchanged. Markers never land on an empty block.
    - Functional: Both codecs accept an affinity option, `routes[x].affinity?: (req) => Record<string,string>`, which the cache planner fills from `options.cacheKey` (sanitized, `sanitizeCacheKey`). OpenCode Go uses it for `x-opencode-session` (plan 183). Hyper uses it only if Task 1 (e) or plan 183 Task 1 finds a documented key.
    - Performance: In a scripted ten-turn tool loop on the replay harness, the number of prompt tokens left outside any marked prefix drops to the size of the newest assistant turn. The test computes this from the encoded bodies.
    - Code Quality: Breakpoint resolution stays in `cache-helpers.ts`; codecs only place markers.
    - Security: The affinity value is the sanitized cache key, which is never a credential or prompt text (existing `sanitizeCacheKey` rules, asserted).
  - Approach:
    - Documentation Reviewed:
      - Task 1 (e); `src/provider-kit/cache-helpers.ts:43-64,120-138`; `src/provider-kit/provider-request-policy.ts:26-42`; Anthropic prompt-caching docs (breakpoints, 20-block lookback, minimum cacheable length).
    - Options Considered:
      - Four breakpoints (tools, system, penultimate, last). Rejected unless Task 1 (e) shows a measurable gain: each marker on a new block is a cache write.
    - Chosen Approach:
      - Match the reference harness's placement; prove it by the encoded bodies here and by measured hit rate in plan 184.
    - API Notes and Examples:
      ```ts
      // default when model.cache.kind === "cache_control"
      { cache: { breakpoints: [{ location: "system_prompt" }, { location: "last_message" }] } }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/provider.ts` (`PromptCacheBreakpointLocation` gains `last_message`), `src/provider-kit/{cache-helpers,provider-request-policy}.ts`, `src/provider-kit/codecs/anthropic-messages.ts`, `src/provider-kit/routed-provider.ts`, `src/__tests__/{cache-helpers,provider-request-policy,provider-cache}.test.ts`, `scripts/compat-baseline/arnilo__prism.txt`, `docs/models.md` (cache hints), `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - Task 1 (e); plan 184 (measurement).
  - Test Cases to Write:
    - `default_breakpoints_mark_newest_message`: fails on the `length - 2` default.
    - `tools_breakpoint_marks_last_tool_definition`.
    - `uncached_tail_is_one_turn_in_ten_turn_loop`.
    - `affinity_header_is_sanitized_cache_key`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default cache markers and a new breakpoint location.
    - Docs pages to create/edit:
      - `docs/models.md`: prompt-cache hints and defaults; `docs/provider-kit.md`: cache planner; `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Provider conformance a host can run
  - Acceptance Criteria:
    - Functional: `providerConformance` (`conformance.ts:242`) gains a `recordings` option. With it, the suite replays every recorded scenario through the package's provider and checks: event order, the usage rule (Task 4), tool-call reconstruction, `done` stop reason, that thinking replay round-trips with its signature (Anthropic route), the abort pre-check, header ownership, and no secret leak. A package passes by pointing it at its `wire/` directory.
    - Functional: `prism new package --provider <name>` (the existing scaffolder, roadmap Phase 4) generates a provider skeleton: `createRoutedProvider`, a one-model catalog, a `package.test.ts` calling `providerConformance({ recordings })`, an empty `wire/` folder with a README that gives the recording command, and a `live.test.ts` skeleton that skips without credentials. If the scaffolder has no provider template today, this task adds one.
    - Performance: Conformance over 10 recorded scenarios runs in under 1 s.
    - Code Quality: The suite is the same one the four first-party packages run (plan 183); no first-party-only checks.
    - Security: The generated package's config schema uses `secretRefProperty`, and the literal-key rejection test is part of the skeleton.
  - Approach:
    - Documentation Reviewed:
      - `src/provider-kit/conformance.ts:218-258`; the scaffolder (`graft ask "prism new package scaffold" --source`); `packages/providers/laya/src/__tests__/package.test.ts` (current package-test shape).
    - Options Considered:
      - Document the checks and let hosts write them. Rejected: the owner's goal is that a host-written package is tested the same way as a first-party one.
    - Chosen Approach:
      - Recordings-driven conformance plus a scaffold that wires it.
    - API Notes and Examples:
      ```ts
      await providerConformance(() => createAcmeProvider({ apiKey: async () => "k" }), {
        recordings: new URL("./wire/", import.meta.url),
        models: acmeModels,
      });
      ```
    - Files to Create/Edit:
      - `src/provider-kit/conformance.ts`, `src/__tests__/provider-conformance.test.ts`, the scaffolder module and its template files (paths from the graft lookup; tentative until then), `docs/provider-kit.md` ("Test your package"), `docs/testing.md` (link), `CHANGELOG.md`, `scripts/compat-baseline/arnilo__prism.txt`.
    - References:
      - Tasks 5–8.
  - Test Cases to Write:
    - `conformance_replays_recordings_and_reports_scenario`, `conformance_fails_on_usage_rule_break`, `conformance_fails_on_unsigned_thinking_replay`.
    - `scaffolded_provider_package_passes_its_own_tests` (generates into a temp dir, runs `bun test`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — conformance option and scaffold template.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`, `docs/testing.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/{provider-kit,provider-usage,anthropic-messages,routed-provider,cache-helpers,provider-request-policy,provider-conformance,wire-replay,public-export-contract,packaging}.test.ts`
- `bun test --timeout=0 scripts/wire-proxy.test.mjs scripts/retired-providers.test.mjs scripts/live-matrix.test.mjs scripts/live-doc-check.test.mjs`
- `bun run --filter '@arnilo/prism-provider-*' test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`
- `bun run test`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
