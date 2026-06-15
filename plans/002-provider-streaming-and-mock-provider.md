# Phase 2 — Provider and Model Layer

## Objectives
- Add the smallest runtime layer for provider/model lookup and normalized provider streaming.
- Keep credentials host-owned and prevent secrets from entering events, history, errors, or tests.
- Provide a mock provider for tests/examples and an optional OpenAI-compatible adapter using native `fetch`.

## Expected Outcome
- Hosts can register providers and models, resolve a `ModelConfig`, and fail closed before any network call when a provider/model is unknown.
- Provider calls receive `AbortSignal` and emit normalized async `ProviderEvent` values for text, thinking, tool calls, usage, done, and errors.
- Tests cover mock streaming, tool-call streaming, abort propagation, secret redaction, and OpenAI-compatible fetch/SSE mapping without real network calls.

## Tasks

- [x] Primitive review: inventory Phase 1 contracts and provider/model gaps
  - Acceptance Criteria:
    - Functional: Existing `src/contracts.ts`, `src/index.ts`, `package.json` exports, and Phase 1 tests are reviewed before runtime edits.
    - Performance: Review identifies O(1) registry primitives and avoids work queues, global singletons, or background polling.
    - Code Quality: New primitives are generic provider/model utilities, not agent-session runtime or app-specific adapter code.
    - Security: Review records how credentials stay out of registries, events, history, and error messages.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 provider/model deliverables and acceptance.
      - `plans/001-public-contracts.md` completed contract decisions and compromises.
      - `src/contracts.ts` current `AIProvider`, `ProviderRequest`, `ProviderEvent`, `ModelConfig`, `Usage`, and `CredentialResolver` shapes.
      - `package.json` current root export and no subpath exports.
      - Context7 `/nodejs/node` docs query on 2026-06-15: native `fetch` accepts `AbortSignal`; stream cancellation raises `AbortError`.
      - Context7 OpenAI docs query on 2026-06-15: Chat Completions streaming uses `stream: true`, SSE `data:` chunks, optional `stream_options.include_usage`, and streamed tool-call fragments.
    - Options Considered:
      - Add a full provider framework: rejected as premature.
      - Add tiny registries plus adapters: chosen; enough for Phase 2 and easy to replace later.
    - Chosen Approach:
      - Document current gaps, then implement only reusable primitives: provider registry, model registry, redaction helper, stream helpers, mock provider, optional adapter.
    - API Notes and Examples:
      ```ts
      const providers = createProviderRegistry();
      providers.register(provider);
      const provider = providers.resolve({ provider: "mock", model: "demo" });
      ```
    - Files to Create/Edit:
      - `plans/002-provider-streaming-and-mock-provider.md`: add execution notes before checking this task.
    - References:
      - `roadmap.md` Phase 2.
      - `src/contracts.ts`.
      - Node native `fetch`/`AbortSignal` docs from Context7 `/nodejs/node`.
      - OpenAI streaming/tool-call docs from Context7 OpenAI docs.
  - Test Cases to Write:
    - `provider_phase_primitive_inventory_recorded`: manual plan check for existing primitives, gaps, and rejected complexity.
  - Execution Notes:
    - Existing contracts: `src/contracts.ts` already has `AIProvider.generate(request): AsyncIterable<ProviderEvent>`, `ProviderRequest.model/messages/tools/context/metadata/signal`, `ProviderEvent` variants for `message_start`, `content_delta`, `tool_call`, `usage`, `done`, and `error`, plus `ModelConfig`, `Usage`, `CredentialResolver`, `Credential`, and `ErrorInfo`.
    - Existing exports: `src/index.ts` re-exports contracts with `export type *` and keeps only value constants; `package.json` exposes only the root export and has no provider subpath yet.
    - Existing tests: Phase 1 tests prove compile-only host wiring and scan public contracts for app-specific leaks; no provider runtime tests exist yet.
    - Provider/model gaps: no `createProviderRegistry`, no `createModelRegistry`, no runtime provider lookup, no fail-closed unknown provider/model path, no mock provider, no normalized event helpers, no redaction helper, and no OpenAI-compatible subpath/export.
    - Registry primitive decision: use explicit factory-returned objects backed by `Map` for O(1) lookup; no global registry, work queue, background polling, or provider invocation during lookup.
    - Credential boundary: registries must store only provider/model metadata, never `CredentialResolver`, API keys, headers, or resolved tokens. Adapter-local auth resolution must pass secrets only into the HTTP request path and redact known values from thrown/emitted errors.
    - Runtime boundary: Phase 2 should not implement agent/session loops, tool dispatch, persistence, settings loading, env scanning, or app-specific adapter behavior.

- [x] Add provider and model registries
  - Acceptance Criteria:
    - Functional: `createProviderRegistry()` can register/list/get/resolve providers; `createModelRegistry()` can register/list/get/resolve model configs.
    - Performance: Lookup is O(1) with `Map`; no network call or provider invocation happens during lookup failure.
    - Code Quality: Registries are small factory-returned objects, no classes unless needed, no hidden global registry.
    - Security: Registries do not store credentials, credential resolvers, API keys, or provider secrets.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 unknown provider/model fail-closed acceptance.
      - `src/contracts.ts` `AIProvider` and `ModelConfig`.
    - Options Considered:
      - Global singleton: rejected because host-controlled embedding requires explicit state.
      - Factory with internal `Map`: chosen for O(1), testable lookup.
    - Chosen Approach:
      - Implement `src/providers.ts` and `src/models.ts` with minimal registry interfaces inferred from runtime objects.
    - API Notes and Examples:
      ```ts
      const models = createModelRegistry();
      models.register({ provider: "mock", model: "demo" });
      const model = models.resolve("mock", "demo");
      ```
    - Files to Create/Edit:
      - `src/providers.ts`: provider registry.
      - `src/models.ts`: model registry.
      - `src/index.ts`: export factories and any needed registry types.
      - `src/contracts.ts`: only minimal contract tweaks if tests expose a real gap.
    - References:
      - `src/contracts.ts` provider/model contracts.
  - Test Cases to Write:
    - `provider_registry_register_get_list_resolve`: same provider instance returns by id.
    - `provider_registry_unknown_provider_fails_before_generate`: fail closed without provider call.
    - `model_registry_register_get_list_resolve`: model lookup works by provider/model key.
    - `model_registry_unknown_model_fails_before_provider_call`: fail closed.
  - Execution Notes:
    - Added `src/providers.ts` with `createProviderRegistry()` and explicit `ProviderRegistry` backed by `Map`.
    - Added `src/models.ts` with `createModelRegistry()` and explicit `ModelRegistry` backed by `Map` using provider/model keys.
    - Exported registry factories and types from `src/index.ts`; no global registry or credential storage was added.
    - Added `src/__tests__/registries.test.ts` covering register/get/list/resolve and fail-closed unknown provider/model behavior before provider calls.
    - Ran `npm run typecheck` and `command npm test` successfully.

- [x] Add credential resolution boundary and redaction helper
  - Acceptance Criteria:
    - Functional: Provider adapter options can accept a `CredentialResolver` or direct token callback; resolved auth is passed only to the adapter request path.
    - Performance: Redaction is a small string/object helper with linear scan over provided secret values only.
    - Code Quality: Keep helper generic; no credential storage, cache, env scanning, or settings loader in Phase 2.
    - Security: Known secret values are removed from thrown errors and emitted provider errors; tests prove API keys do not appear in event/error text.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2/9 secret boundary requirements.
      - `src/contracts.ts` `CredentialResolver`, `Credential`, and `ProviderEvent` error shape.
    - Options Considered:
      - Build auth storage now: rejected; Phase 9 owns settings/auth storage.
      - Add `redactSecrets(value, secrets)`: chosen because adapters only need local redaction now.
    - Chosen Approach:
      - Add a tiny `src/redaction.ts` utility and adapter-local credential resolution.
    - API Notes and Examples:
      ```ts
      const message = redactSecrets(String(error), [apiKey]);
      ```
    - Files to Create/Edit:
      - `src/redaction.ts`: secret redaction helper.
      - `src/providers/openai-compatible.ts`: adapter uses resolver/callback and redaction.
      - `src/index.ts`: export redaction only if useful for host adapters; otherwise keep internal.
    - References:
      - `roadmap.md` host-owned credentials boundary.
  - Test Cases to Write:
    - `redact_secrets_replaces_known_values`: validates local helper.
    - `provider_registry_does_not_accept_or_store_credentials`: validates registry boundary.
    - `adapter_error_redacts_api_key`: validates no secret in error event/message.
  - Execution Notes:
    - Added `src/credentials.ts` with `resolveCredentialValue()` for direct string, callback, or `CredentialResolver` sources; it stores nothing.
    - Added `src/redaction.ts` with `redactSecrets()` and `errorToErrorInfo()` for adapter-local error/event hygiene.
    - Exported credential/redaction helpers from `src/index.ts` for host adapter authors.
    - Added `src/__tests__/credentials-redaction.test.ts` covering credential source resolution, registry credential boundary, string/object redaction, and error redaction.
    - Adapter-specific redaction will be wired when the OpenAI-compatible adapter task creates the adapter.
    - Ran `npm run typecheck` and `command npm test` successfully.

- [x] Normalize provider streaming helpers
  - Acceptance Criteria:
    - Functional: Helpers produce/consume normalized `ProviderEvent` streams for text deltas, thinking deltas, tool-call deltas/calls, usage, done, and error.
    - Performance: Streaming yields chunks as they arrive and does not buffer full assistant text.
    - Code Quality: Use native async generators and small helpers; no event emitter or stream library dependency.
    - Security: Error events use `ErrorInfo` and do not include request headers, credentials, or raw secret-bearing response bodies.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ProviderEvent` discriminated union.
      - Context7 OpenAI docs: streamed content arrives as incremental chunks, tool calls may arrive fragmented.
    - Options Considered:
      - Implement stream normalization only inside the OpenAI adapter: duplicates later provider code.
      - Add tiny generic async-generator helpers: chosen for reuse by mock and adapter.
    - Chosen Approach:
      - Add the minimum helper code in `src/provider-events.ts`; extend `ProviderEvent` only if tool-call deltas need a distinct event.
    - API Notes and Examples:
      ```ts
      yield providerTextDelta("Hello");
      yield providerDone({ outputTokens: 1 });
      ```
    - Files to Create/Edit:
      - `src/provider-events.ts`: tiny event constructors/normalizers.
      - `src/contracts.ts`: optional `tool_call_delta` addition if needed.
      - `src/index.ts`: export helpers only if host provider authors need them.
    - References:
      - `roadmap.md` normalized async event stream requirement.
  - Test Cases to Write:
    - `text_delta_helper_returns_content_delta`: validates normalized text event.
    - `thinking_delta_helper_returns_content_delta`: validates thinking event.
    - `error_helper_returns_redacted_error_event`: validates safe error shape.
  - Execution Notes:
    - Added `src/provider-events.ts` with tiny provider event constructors for text, thinking, content, tool-call delta, final tool call, usage, done, error, and tool-call content.
    - Extended `ProviderEvent` with `tool_call_delta` so adapters can represent streamed function-call fragments without buffering the full call early.
    - Exported provider event helpers from `src/index.ts` for host provider authors.
    - Added `src/__tests__/provider-events.test.ts` covering text/thinking deltas, tool-call deltas/final calls, usage/done, and redacted error events.
    - Ran `npm run typecheck` and `command npm test` successfully.

- [x] Add mock provider for tests and examples
  - Acceptance Criteria:
    - Functional: `createMockProvider()` can stream text, thinking, tool calls, usage, done, and errors from scripted events.
    - Performance: Mock streaming is deterministic and uses no timers unless a test explicitly asks for delay.
    - Code Quality: Mock provider uses the same `AIProvider` contract as real adapters and stays dependency-free.
    - Security: Mock provider performs no network calls and carries no credentials.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 mock provider acceptance.
      - Existing `src/__tests__/public-contracts.test.ts` node:test style.
    - Options Considered:
      - Test registries with hand-written providers only: less code, but examples need a reusable mock.
      - Add `createMockProvider`: chosen because it supports Phase 2 and later agent-session tests.
    - Chosen Approach:
      - Implement a scripted async generator provider in `src/mock-provider.ts`.
    - API Notes and Examples:
      ```ts
      const provider = createMockProvider([
        { type: "content_delta", content: { type: "text", text: "Hello" } },
        { type: "done" }
      ]);
      ```
    - Files to Create/Edit:
      - `src/mock-provider.ts`: mock provider factory.
      - `src/index.ts`: export `createMockProvider`.
      - `src/__tests__/providers.test.ts`: registry/mock tests.
    - References:
      - `src/contracts.ts` `AIProvider`.
  - Test Cases to Write:
    - `mock_provider_streams_text_and_done`: validates scripted text path.
    - `mock_provider_streams_tool_call`: validates tool call event path.
    - `mock_provider_receives_abort_signal`: validates signal reaches provider request.
    - `mock_provider_can_emit_error`: validates error event path.
  - Execution Notes:
    - Added `src/mock-provider.ts` with `createMockProvider()` returning a scripted `AIProvider`.
    - Mock provider supports deterministic event scripts, optional id, optional request observer, abort checks, and no timers/network/credentials.
    - Exported mock provider factory and options from `src/index.ts`.
    - Added `src/__tests__/mock-provider.test.ts` covering text/done, tool calls, abort signal receipt, and error events.
    - Ran `npm run typecheck` and `command npm test` successfully.

- [x] Add OpenAI-compatible adapter subpath using native fetch
  - Acceptance Criteria:
    - Functional: `prism/providers/openai-compatible` exports `createOpenAICompatibleProvider()` that maps normalized requests to Chat Completions streaming and maps SSE chunks back to `ProviderEvent`.
    - Performance: Adapter reads `response.body` incrementally and does not buffer the full stream before yielding events.
    - Code Quality: Use native `fetch`, `ReadableStream` reader, and `TextDecoder`; no OpenAI SDK or SSE dependency.
    - Security: Adapter accepts credentials from host options/resolver, sends them only in the HTTP header, redacts them from errors, and tests use mocked `fetch` only.
  - Approach:
    - Documentation Reviewed:
      - Context7 `/nodejs/node`: native `fetch` can receive `signal`; aborts surface as `AbortError`.
      - Context7 OpenAI docs: Chat Completions streaming POST to `/v1/chat/completions`, `stream: true`, SSE `data:` chunks, optional usage, function tools, and fragmented tool-call chunks.
      - `package.json` current root export shape.
    - Options Considered:
      - Official OpenAI SDK: rejected to avoid dependency/version coupling.
      - Native fetch adapter: chosen and explicitly allowed by roadmap.
    - Chosen Approach:
      - Implement one adapter subpath with a tiny SSE parser and conservative mapping for text, usage, done, errors, and tool-call fragments.
    - API Notes and Examples:
      ```ts
      import { createOpenAICompatibleProvider } from "prism/providers/openai-compatible";

      const provider = createOpenAICompatibleProvider({
        baseUrl: "https://api.openai.com/v1",
        apiKey: () => process.env.OPENAI_API_KEY ?? ""
      });
      ```
    - Files to Create/Edit:
      - `src/providers/openai-compatible.ts`: adapter and SSE parser.
      - `package.json`: add `./providers/openai-compatible` subpath with `types` and `default`.
      - `src/__tests__/openai-compatible.test.ts`: mocked-fetch tests.
    - References:
      - OpenAI streaming/tool docs from Context7 OpenAI docs.
      - Node native `fetch` docs from Context7 `/nodejs/node`.
  - Test Cases to Write:
    - `openai_adapter_maps_streaming_text_to_provider_events`: mocked SSE text chunks.
    - `openai_adapter_maps_usage_and_done`: mocked `stream_options.include_usage` style chunk.
    - `openai_adapter_reconstructs_tool_call_fragments`: mocked streamed tool-call chunks.
    - `openai_adapter_passes_abort_signal_to_fetch`: validates cancellation path.
    - `openai_adapter_redacts_api_key_from_errors`: validates secret safety.
    - `openai_adapter_never_uses_real_network_in_tests`: fetch is injected/mocked.
  - Execution Notes:
    - Added `src/providers/openai-compatible.ts` with `createOpenAICompatibleProvider()` using native/injected `fetch`, `ReadableStream` reader, and `TextDecoder` SSE parsing.
    - Added package subpath export `./providers/openai-compatible` with generated declaration path.
    - Adapter maps normalized requests to Chat Completions streaming payloads, passes `AbortSignal` to fetch, emits text/usage/done/error events, and reconstructs fragmented tool calls into final `tool_call` events.
    - Adapter resolves credentials only at request time via direct value/callback/`CredentialResolver`, sends them only as an authorization header, and redacts known API key values from error events.
    - Added `src/__tests__/openai-compatible.test.ts` with injected-fetch tests for text streaming, usage/done, tool-call fragments, abort signal, redaction, and no real network use.
    - Ran `npm run typecheck` and `command npm test` successfully.

- [x] Verify Phase 2 and refresh README/provider docs
  - Acceptance Criteria:
    - Functional: `npm run build`, `npm run typecheck`, and `command npm test` pass; README documents provider/model layer status and mock/OpenAI-compatible usage.
    - Performance: Test suite remains under 10 seconds and no test performs real network I/O.
    - Code Quality: Docs match actual exports/subpaths and avoid promising agent-session runtime behavior from Phase 3.
    - Security: Docs state hosts own credentials and that secrets must not be placed in prompts, messages, events, or stores.
  - Approach:
    - Documentation Reviewed:
      - `README.md` current Phase 1 contract scope.
      - `package.json` scripts and export metadata.
      - `roadmap.md` Phase 2 acceptance.
    - Options Considered:
      - Defer docs to release: rejected because new public runtime exports need a minimal example.
      - Add concise README section only: chosen; full API docs wait for Phase 10.
    - Chosen Approach:
      - Add short provider/model examples and run existing verification commands.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `README.md`: add provider registry, mock provider, and optional OpenAI-compatible adapter notes.
      - `plans/002-provider-streaming-and-mock-provider.md`: mark tasks complete only after checks pass and record actual compromises/follow-ups.
    - References:
      - Existing package scripts.
  - Test Cases to Write:
    - `npm run build`: validates emitted JS/declarations/subpath declarations.
    - `npm run typecheck`: validates strict TypeScript.
    - `command npm test`: validates registry/mock/adapter tests and no-network behavior.
  - Execution Notes:
    - Updated `README.md` to describe provider/model registries, provider event helpers, credential redaction helpers, mock provider, and the OpenAI-compatible subpath.
    - README examples match current exports: `createProviderRegistry`, `createModelRegistry`, `createMockProvider`, and `createOpenAICompatibleProvider` from `prism/providers/openai-compatible`.
    - README states agent/session loops, tool dispatch, persistence adapters, and CLI/RPC runtime are deferred to later phases.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test` successfully.

## Compromises Made
- The OpenAI-compatible adapter targets Chat Completions streaming only; Responses API support can wait until a real consumer needs it.
- Tool-call fragments are emitted as `tool_call_delta` and also reconstructed into final `tool_call` events; full provider-specific edge cases are deferred until integration tests expose them.
- Credential handling resolves per request and redacts known values, but does not add credential storage, env scanning, or settings integration; those belong to Phase 9.

## Further Actions
- Priority high: Phase 3 should build the minimal agent/session runtime on top of `AIProvider`, `ProviderEvent`, the registries, and `createMockProvider`.
- Priority medium: Add provider adapter conformance tests if more adapters are added.
- Priority low: Revisit OpenAI-compatible request mapping for multimodal content after image-capable runtime examples exist.
