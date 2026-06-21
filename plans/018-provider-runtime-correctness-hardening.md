# Phase 15 — Provider and Runtime Correctness Hardening

## Objectives
- Preserve Prism content blocks across provider request/response round trips instead of silently dropping non-text content.
- Make provider conformance tests catch serializer, SSE, tool-call, usage/cache, abort, and redaction regressions before live use.
- Keep RPC responsive to abort/state/control requests while a prompt is running.
- Make public middleware, manifest, docs, and exported types match the implemented runtime.

## Expected Outcome
- Core OpenAI-compatible support and first-party provider packages either serialize text, thinking, tool-call, tool-result, and supported image blocks correctly or fail/downgrade explicitly with tests.
- Mock end-to-end runtime tests prove tool calls are stored, replayed as provider input, and followed by final assistant output.
- RPC can process abort/state/control requests during an active stream and keeps event/response ids correlated.
- Docs and tests prove middleware hooks and manifest contribution kinds match current registries.

## Tasks

- [x] Review provider/runtime primitives and lock the minimal hardening surface
  - Acceptance Criteria:
    - Functional: Inventory current `ContentBlock`, `ProviderRequest`, provider serializers, provider conformance helpers, runtime tool replay, RPC request loop, middleware hook names, manifest contribution kinds, and model capability metadata against Phase 15 deliverables.
    - Performance: Review adds no runtime code, dependency, provider SDK, worker, queue, tokenizer, filesystem scan, or live network test.
    - Code Quality: The decision records which fixes stay package-local, which testing helpers become public on `prism/testing/provider-conformance`, and whether `provider_response` is invoked or removed.
    - Security: The review preserves explicit credential boundaries, fake-only fixtures, redacted provider errors, no hidden provider globals, and network-free default tests.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 15 deliverables/acceptance and non-negotiable boundaries.
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/` directory is present.
      - `docs/provider-layer.md`, `docs/provider-conformance.md`, `docs/provider-packages.md`, `docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`, `docs/middleware-hooks.md`, `docs/configuration-and-manifests.md`, `docs/contribution-registries.md`, `docs/cli-rpc.md`, `docs/system-prompts.md`, and provider package docs under `docs/providers/`.
      - `src/contracts.ts`, `src/agents.ts`, `src/input.ts`, `src/rpc.ts`, `src/middleware.ts`, `src/manifests.ts`, `src/contributions.ts`, `src/extensions.ts`, `src/testing/provider-conformance.ts`, and current tests.
      - `src/providers/openai-compatible.ts` plus provider package serializers/models/tests in `packages/provider-openai`, `packages/provider-opencode-go`, `packages/provider-openrouter`, `packages/provider-zai`, and `packages/provider-kimi`.
      - Node.js docs from `code_search`: `node:readline` `createInterface()` and async iterator behavior; `node:stream` `Readable`/`Writable` and `AbortSignal` notes for RPC control-loop work.
    - Options Considered:
      - Add a new public provider serializer abstraction: rejected unless implementation proves it unavoidable; Phase 15 can be fixed with adapter-local serializers and conformance helpers.
      - Keep `provider_response` documented and add a new runtime payload: rejected by default because no payload contract exists and no current call site uses it.
      - Remove `provider_response` from hook docs/types: chosen; review found it in `src/contracts.ts`, `src/middleware.ts`, and docs, but no runtime call site.
      - Add an RPC scheduler/queue: rejected; current `AgentSession` intentionally allows one active run, so RPC should process controls immediately and fail concurrent prompts clearly.
    - Chosen Approach:
      - Keep core `ContentBlock`, `ProviderRequest`, `ProviderEvent`, `ModelCapabilities`, `AgentSession`, and contribution registry contracts unchanged unless a later failing test proves a narrow addition is required.
      - Add exactly two public conformance helpers on `prism/testing/provider-conformance`: one serialized-content canary assertion and one secret-leak assertion; keep malformed SSE/JSON fixtures package-local.
      - Harden each existing serializer route directly: OpenAI-compatible Chat, OpenAI Responses, OpenCode Go OpenAI route, OpenCode Go Anthropic route, OpenRouter, Z.AI, and Kimi Anthropic route.
      - Fix RPC with one in-memory active-run record, not a queue/scheduler; concurrent prompts should fail clearly while controls continue.
      - Extend manifest kinds to match current data-only registries: `providerPackage`, `authMethod`, `providerRequestPolicy`, and `systemPromptContribution`.
      - Prefer explicit provider errors or documented text downgrade over silent content loss.
    - API Notes and Examples:
      ```ts
      const replay: ProviderRequest = {
        model,
        messages: [
          { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
          { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
        ],
      };
      ```
    - Files to Create/Edit:
      - `plans/018-provider-runtime-correctness-hardening.md`: record primitive review decision and any scope correction before implementation tasks proceed.
      - Implementation files listed in later tasks.
    - References:
      - `roadmap.md` Phase 15.
      - Previous provider/runtime plans: `plans/014-provider-auth-cache-and-system-prompt-primitives.md`, `plans/015-real-provider-packages.md`, `plans/016-llm-compaction-strategy.md`, and `plans/017-observational-memory-strategy.md`.
    - Primitive Review Result:
      - Current primitives are sufficient: no new core content block, provider request shape, runtime event, serializer abstraction, RPC protocol command, or contribution registry primitive is needed for Phase 15.
      - Serializer gaps are package-local: current routes mostly join text blocks and drop/flatten thinking, tool calls, tool results, and images; fix each provider adapter where it serializes requests.
      - Runtime gap is test/fix-local: `generateProviderTurn()` handles final `tool_call` events but not `tool_call_delta`; Phase 15 should either reconstruct deltas in runtime or require providers to emit final calls, then prove replay with one mock E2E test.
      - RPC gap is loop-local: `runRpcServer()` awaits prompt/follow-up inside the readline loop, so abort/state cannot be processed until the run finishes; fix `src/rpc.ts` only.
      - Middleware gap is contract drift: `provider_response` has no runtime call site, so remove it from typed/public hook docs instead of inventing a payload.
      - Manifest gap is validator drift: registries include provider package/auth/request policy/system prompt primitives that manifests reject today.
      - Security boundary remains unchanged: fake-only fixtures, caller-owned credentials, explicit redaction checks, no live provider calls, no hidden SDK/global discovery.
  - Test Cases to Write:
    - Review-only task: no runtime test; validation is source/docs inspection plus this plan's recorded primitive decisions before marking the task complete.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by review alone; later tasks update docs when public testing helpers, behavior, middleware hooks, manifests, or provider package behavior changes.
    - Docs pages to create/edit:
      - `none`: review notes live in this plan unless implementation changes public behavior.
    - `docs/index.md` update: No for review alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Expand provider conformance checks for serialization, malformed streams, usage/cache accounting, abort, and redaction
  - Acceptance Criteria:
    - Functional: Conformance coverage catches missing terminal events, malformed SSE/JSON paths, invalid tool-argument recovery, cache usage mapping, abort propagation, redacted provider errors, and request bodies that drop required non-text content canaries.
    - Performance: Helpers stay dependency-free, network-free, fixture-sized, and O(n) over collected events/request JSON.
    - Code Quality: New helpers are small assertions on the existing testing subpath; provider-specific mocked fetch/SSE fixtures remain in package tests.
    - Security: Helpers and fixtures use fake secrets only and include an assertion path that fails if known secret strings appear in events/errors/bodies.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-conformance.md` current helper list and testing subpath contract.
      - `docs/provider-layer.md` provider event, usage/cache, mock provider, and redaction boundaries.
      - `src/testing/provider-conformance.ts` and `src/__tests__/provider-conformance.test.ts`.
      - Provider package tests that already use `assertProviderStreamConforms()` and `assertToolCallDeltasReconstruct()`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Build a full provider simulator: rejected; provider packages already have mocked fetch/SSE fixtures.
      - Add one generic serialized-body coverage assertion that scans for canary values from Prism content blocks: chosen; it catches text-only serializers without knowing every provider's JSON shape.
      - Put all checks only in package-local tests: rejected for repeated redaction/coverage assertions that every adapter should share.
    - Chosen Approach:
      - Extend `prism/testing/provider-conformance` with `assertSerializedRequestCoversContent()` and `assertNoSecretLeak()`.
      - Keep malformed stream construction provider-local; adapters test their own SSE/JSON paths with the existing stream and redaction helpers.
      - Update docs and tests for the new testing subpath helpers.
    - API Notes and Examples:
      ```ts
      const body = JSON.parse(String(fetchInit.body));
      assertSerializedRequestCoversContent(request, body, {
        unsupported: ["image"],
      });
      assertNoSecretLeak(events, ["fake-provider-key"]);
      ```
    - Files to Create/Edit:
      - `src/testing/provider-conformance.ts`: added `assertSerializedRequestCoversContent()` and `assertNoSecretLeak()`.
      - `src/__tests__/provider-conformance.test.ts`: added passing/failing content canary and secret leak tests.
      - `docs/provider-conformance.md`: documented new helpers and content-preservation example.
      - `docs/provider-layer.md`: linked conformance coverage to provider adapter expectations.
    - References:
      - `roadmap.md` Phase 15 provider conformance deliverables.
      - Current provider package tests under `packages/provider-*/src/__tests__/`.
  - Test Cases to Write:
    - `conformance_serialized_request_covers_text_thinking_tool_result_and_images`: validates canary scanning on a representative serialized body.
    - `conformance_serialized_request_fails_when_non_text_block_is_dropped`: proves a text-only serializer body fails.
    - `conformance_no_secret_leak_fails_on_known_secret`: validates event/body/error redaction checks.
    - `conformance_still_checks_terminal_events_tool_delta_usage_and_abort`: guards existing helper behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds testing-subpath helper exports.
    - Docs pages to create/edit:
      - `docs/provider-conformance.md`: add new helper names, inputs, outputs, examples, and security notes.
      - `docs/provider-layer.md`: mention that adapters should run conformance coverage for content preservation and redaction.
    - `docs/index.md` update: No; existing Provider conformance entry remains correct unless link text needs a short wording update.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Harden provider serializers and model capability metadata across core and first-party provider packages
  - Acceptance Criteria:
    - Functional: Core OpenAI-compatible and all first-party provider package routes preserve text, thinking, `tool_call`, `tool_result`, and supported image blocks in provider-native request shape; unsupported blocks fail before fetch or downgrade with an explicit marker covered by tests.
    - Performance: Serialization remains linear in messages/content/tools, uses no SDK dependency, performs no provider/model catalog fetch, and does not duplicate large binary data beyond the provider JSON payload.
    - Code Quality: Serializer behavior is route-local, tested with captured mocked request bodies, and keeps provider-specific compat logic out of Prism core.
    - Security: Tests use fake secrets only; provider error paths redact known credentials; serialized request tests do not put real secrets or live URLs in fixtures.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `ContentBlock`, `Message`, `ToolCallContent`, `ToolResultContent`, `ImageContent`, `ModelCapabilities`, and `ProviderRequest`.
      - Provider docs in `docs/providers/openai-compatible.md`, `docs/providers/openai.md`, `docs/providers/opencode-go.md`, `docs/providers/openrouter.md`, `docs/providers/zai.md`, and `docs/providers/kimi.md`.
      - Serializer files: `src/providers/openai-compatible.ts`, `packages/provider-openai/src/responses.ts`, `packages/provider-opencode-go/src/openai-chat.ts`, `packages/provider-opencode-go/src/anthropic-messages.ts`, `packages/provider-openrouter/src/provider.ts`, `packages/provider-openrouter/src/cache.ts`, `packages/provider-zai/src/provider.ts`, and `packages/provider-kimi/src/provider.ts`.
      - Model metadata files: `packages/provider-openai/src/models.ts`, `packages/provider-opencode-go/src/models.ts`, `packages/provider-openrouter/src/model.ts`, `packages/provider-zai/src/models.ts`, and `packages/provider-kimi/src/models.ts`.
      - New conformance helpers from the previous task.
    - Options Considered:
      - Downgrade every non-text block to JSON text: rejected because tool and image providers have native shapes and silent semantic loss caused this phase.
      - Fail every unsupported block: safe but too strict for thinking history where a provider can accept an explicit text downgrade.
      - Provider-native mapping for tool/image plus explicit text downgrade only where documented: chosen.
    - Chosen Approach:
      - OpenAI-compatible/OpenRouter/OpenCode OpenAI/Z.AI chat-style routes map assistant tool calls to `tool_calls`, tool results to provider tool messages, and image blocks to content arrays only when the provider/model claims image input.
      - OpenAI Responses maps tool calls/results to Responses input items and images to Responses image input blocks.
      - Anthropic-style OpenCode/Kimi maps tool calls to `tool_use` and tool results to `tool_result`; thinking is preserved only when `model.compat.preserveThinking` is true, otherwise downgraded to text.
      - First-party model capabilities remain unchanged: only `openAIModels` `gpt-5.1` claims image input; other first-party models are text-only and their serializers reject image blocks explicitly.
    - API Notes and Examples:
      ```ts
      const request: ProviderRequest = {
        model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["text", "image"], tools: true } },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image", url: "https://example.invalid/image.png" },
          ],
        }],
      };
      ```
    - Files to Create/Edit:
      - `src/providers/openai-compatible.ts` and `src/__tests__/openai-compatible.test.ts`: Chat Completions serializer hardening and content-drop tests.
      - `packages/provider-openai/src/responses.ts`, `packages/provider-openai/src/models.ts`, and `packages/provider-openai/src/__tests__/openai.test.ts`: Responses serializer/capability coverage.
      - `packages/provider-opencode-go/src/openai-chat.ts`, `packages/provider-opencode-go/src/anthropic-messages.ts`, `packages/provider-opencode-go/src/models.ts`, and `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`.
      - `packages/provider-openrouter/src/provider.ts`, `packages/provider-openrouter/src/cache.ts`, `packages/provider-openrouter/src/model.ts`, and `packages/provider-openrouter/src/__tests__/openrouter.test.ts`.
      - `packages/provider-zai/src/provider.ts`, `packages/provider-zai/src/models.ts`, and `packages/provider-zai/src/__tests__/zai.test.ts`.
      - `packages/provider-kimi/src/provider.ts`, `packages/provider-kimi/src/models.ts`, and `packages/provider-kimi/src/__tests__/kimi.test.ts`.
      - Provider docs under `docs/providers/` and `docs/provider-packages.md`: document supported blocks, downgrade/fail behavior, and capability alignment.
    - References:
      - `roadmap.md` Phase 15 provider round-trip and capability acceptance.
      - `plans/015-real-provider-packages.md` provider package boundaries.
  - Test Cases to Write:
    - `openai_compatible_serializes_tool_result_replay_and_images_or_fails_explicitly`: captured body coverage for core adapter.
    - `openai_responses_serializes_full_prism_content_replay`: text/thinking/tool_call/tool_result/image body assertions.
    - `opencode_go_openai_and_anthropic_routes_cover_tool_result_replay`: route-specific body assertions.
    - `openrouter_body_covers_non_text_blocks_when_model_claims_them`: model/capability and cache-control body assertions.
    - `zai_text_only_serializer_rejects_image_blocks`: fail-closed image test when metadata says text-only.
    - `kimi_anthropic_preserves_thinking_tool_use_and_tool_result`: Kimi replay body assertion.
    - `first_party_model_capabilities_match_serializer_support`: static metadata test for image/tool claims.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; changes first-party provider package request behavior and model capability metadata.
    - Docs pages to create/edit:
      - `docs/providers/openai-compatible.md`: supported content blocks and explicit failures.
      - `docs/providers/openai.md`, `docs/providers/opencode-go.md`, `docs/providers/openrouter.md`, `docs/providers/zai.md`, `docs/providers/kimi.md`: provider-specific serializer/capability notes.
      - `docs/provider-packages.md`: provider package authoring guidance for content block preservation.
      - `docs/provider-conformance.md`: link provider package tests to content-drop assertions.
    - `docs/index.md` update: No new page; verify existing provider links still describe current behavior.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Prove runtime tool-call/tool-result replay end to end and remove the stale provider-response hook surface
  - Acceptance Criteria:
    - Functional: A mock runtime test proves a provider emits a tool call, Prism executes the registered tool, appends user/assistant/tool/final assistant entries in order, and the second provider request contains both the assistant tool call and provider-ready tool result before final text.
    - Performance: Runtime still uses the existing bounded loop, no scheduler, no durable event queue, no extra store scans beyond current branch rebuild/snapshot behavior.
    - Code Quality: Runtime history/tool result handling is fixed in the smallest place needed; `provider_response` is either actually invoked with documented payload or removed from public hook types/docs/tests.
    - Security: Tool errors and results remain redacted through the active redactor; unknown tools still fail closed and cannot be enabled by middleware.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md` bounded tool loop, store append, abort, and middleware timing.
      - `docs/input-and-prompt-assembly.md` `toolResults` message assembly.
      - `docs/tools.md` fail-closed dispatch behavior.
      - `docs/middleware-hooks.md` current hook list and missing `provider_response` call site.
      - `src/agents.ts`, `src/input.ts`, `src/tools.ts`, `src/middleware.ts`, and `src/__tests__/agents.test.ts`.
    - Options Considered:
      - Add a generic provider-response middleware payload now: rejected unless review found a real consumer; it would define a new public contract without a proven need.
      - Remove `provider_response` from `MiddlewareHookName` and docs: chosen as the lazy correctness fix.
      - Rebuild history after every tool result append: use only if required by the failing replay test; otherwise keep current `toolResults` path.
    - Chosen Approach:
      - Add two end-to-end runtime tests: one asserting the second provider request contains the assistant `tool_call` followed by the role `tool` `tool_result` before final assistant text, and one asserting tool errors are replayed as `tool_result` blocks with `error`.
      - Remove `provider_response` from `MiddlewareHookName` in `src/contracts.ts` and `src/middleware.ts`, from `docs/middleware-hooks.md`, and align runtime/agent/input docs to describe exact replay ordering.
    - API Notes and Examples:
      ```ts
      const provider: AIProvider = { id: "mock", async *generate(request) {
        if (!request.messages.some((m) => m.content.some((b) => b.type === "tool_result"))) {
          yield providerToolCall(toolCallContent("call_1", "lookup", { q: "x" }));
        } else {
          yield providerTextDelta("done");
        }
        yield providerDone();
      }};
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: minimal replay/history fix if the new test exposes one.
      - `src/input.ts`: minimal tool-result assembly fix if needed.
      - `src/middleware.ts`: remove `provider_response` from `MiddlewareHookName` unless it is implemented.
      - `src/__tests__/agents.test.ts`: add end-to-end replay/store assertions.
      - `src/__tests__/middleware.test.ts` and/or `src/__tests__/public-contracts.test.ts`: adjust hook expectations.
      - `docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`, and `docs/middleware-hooks.md`: align runtime/hook documentation.
    - References:
      - `roadmap.md` Phase 15 runtime replay and middleware mismatch deliverables.
  - Test Cases to Write:
    - `runtime_replays_provider_tool_call_and_tool_result_before_final_response`: validates request replay, store entries, events, and final text.
    - `runtime_tool_replay_preserves_tool_error_result`: validates tool error replay shape without executing unknown tools.
    - `middleware_hook_names_match_runtime_call_sites`: validates no documented typed hook lacks a call site, or documents intentional inert custom hook strings.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; runtime tool replay behavior is clarified and the stale typed middleware hook is removed or implemented.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: exact replay/store/order behavior.
      - `docs/input-and-prompt-assembly.md`: tool-result assembly expectations.
      - `docs/middleware-hooks.md`: remove `provider_response` or document the implemented call site.
      - `docs/public-contracts.md`: update hook inventory if needed.
    - `docs/index.md` update: No new page; existing Agent/session runtime and Middleware hooks links remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Make RPC process abort, state, and control requests while a prompt is active
  - Acceptance Criteria:
    - Functional: `runRpcServer()` continues reading JSONL while a prompt/follow-up run is active; `abort` cancels the active run, `state`/`messages` respond immediately, events stay correlated to the prompt request id, and concurrent prompt/follow-up requests receive an immediate clear response instead of blocking the input loop.
    - Performance: Uses one in-memory active-run record and existing `AgentSession` APIs; no job queue, worker, timer loop, or persistent RPC state store.
    - Code Quality: Request parsing/response writing remains line-oriented Node stdlib code; prompt completion responses are written exactly once and active state is cleaned up on success, failure, abort, or stdin close.
    - Security: Unknown/malformed commands still fail closed, abort does not execute tools, command contributions remain explicit, and no credentials or provider objects enter RPC envelopes.
  - Approach:
    - Documentation Reviewed:
      - `docs/cli-rpc.md` RPC envelopes, command list, and security boundaries.
      - `docs/agent-session-runtime.md` single active run and `session.abort()` behavior.
      - `src/rpc.ts` current sequential `for await (line of readline)` loop.
      - `src/__tests__/rpc.test.ts` current request/response correlation tests.
      - Node.js docs from `code_search`: `readline.createInterface()` line iteration over `Readable` streams and stream `Writable` behavior.
    - Options Considered:
      - Queue follow-up prompts behind the active prompt: rejected; `AgentSession` has no queue and Phase 15 only requires processing controls while active.
      - Spawn a worker per prompt: rejected; one active run is enough.
      - Start prompt runs asynchronously, keep a single `active` promise/request id, and process later lines immediately: chosen.
    - Chosen Approach:
      - Change prompt/followUp handling to start `session.run()` without blocking the readline loop.
      - Keep the event pump tied to the prompt request id until that run closes.
      - Make `abort`, `state`, `messages`, `setModel`, `switchSession`, and `command` respond while active when safe; keep `compact` fail-closed if the active session rejects compaction during a run.
      - Await any active prompt before `runRpcServer()` returns after stdin closes so tests do not lose final envelopes.
    - API Notes and Examples:
      ```json
      {"id":"run-1","command":"prompt","params":{"input":"Hi"}}
      {"id":"abort-1","command":"abort","params":{"reason":"stop"}}
      {"type":"event","id":"run-1","event":{"type":"error"}}
      {"id":"abort-1","ok":true,"result":{"sessionId":"s1"}}
      ```
    - Files to Create/Edit:
      - `src/rpc.ts`: nonblocking active prompt/control handling.
      - `src/__tests__/rpc.test.ts`: active abort/state/follow-up/control correlation tests.
      - `docs/cli-rpc.md`: document active-run behavior and concurrent prompt response.
    - References:
      - `roadmap.md` Phase 15 RPC deliverable.
  - Test Cases to Write:
    - `rpc_abort_cancels_active_provider_stream_before_stdin_closes`: sends prompt then abort while provider is blocked and expects original prompt error plus abort success.
    - `rpc_state_responds_while_prompt_is_running`: state response appears before prompt completion.
    - `rpc_followup_during_active_prompt_is_processed_without_blocking`: returns immediate active-run failure or documented control response.
    - `rpc_events_remain_correlated_to_prompt_request_id_after_abort`: streamed events keep the original prompt id, not the abort id.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; changes RPC protocol runtime behavior during active prompts.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: active prompt/control semantics, abort behavior, and id correlation.
    - `docs/index.md` update: No new page; existing CLI/RPC link remains.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Sync manifest contribution kinds, public contracts, and docs with current registries
  - Acceptance Criteria:
    - Functional: `ManifestContributionKind` accepts every current contribution registry kind, including provider packages, auth methods, provider request policies, and system prompt contributions; docs and examples use the same names as types/tests.
    - Performance: Manifest parsing remains JSON-only and O(n) over contribution declarations with no imports, package discovery, credential resolution, or registry mutation.
    - Code Quality: The accepted kind list is tested once and kept close to the typed union; docs mention registry categories without inventing inactive or missing kinds.
    - Security: Manifests remain data-only; auth method declarations never contain resolved credentials or tokens.
  - Approach:
    - Documentation Reviewed:
      - `docs/configuration-and-manifests.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/provider-packages.md`, and `docs/system-prompts.md`.
      - `src/manifests.ts`, `src/contributions.ts`, `src/extensions.ts`, `src/provider-packages.ts`, `src/contracts.ts`, and related tests.
      - `src/__tests__/config-manifests.test.ts`, `src/__tests__/contributions.test.ts`, `src/__tests__/extensions.test.ts`, and `src/__tests__/public-contracts.test.ts`.
    - Options Considered:
      - Keep manifests at older Phase 3 kinds only: rejected; roadmap requires current registries and manifests to agree.
      - Add separate manifest schemas per contribution family: rejected; current simple `kind` union is enough.
      - Extend the existing union and docs with missing registry kinds: chosen.
    - Chosen Approach:
      - Add missing kinds: `providerPackage`, `authMethod`, `providerRequestPolicy`, and `systemPromptContribution`.
      - Add tests that compare manifest-accepted kinds with `createContributionRegistries()` categories that are representable in data-only manifests.
      - Update docs examples to include provider package/auth/cache/system prompt declaration shapes without implying execution.
    - API Notes and Examples:
      ```ts
      definePrismManifest({
        name: "demo-provider-package",
        contributions: [
          { kind: "providerPackage", name: "demo" },
          { kind: "authMethod", name: "demo.api-key" },
          { kind: "providerRequestPolicy", name: "demo.cache" },
          { kind: "systemPromptContribution", name: "demo.prompt" },
        ],
      });
      ```
    - Files to Create/Edit:
      - `src/manifests.ts`: union and validator list.
      - `src/__tests__/config-manifests.test.ts`: missing-kind acceptance and invalid-kind rejection.
      - `src/__tests__/docs.test.ts`: docs/export/kind drift checks if cheap.
      - `docs/configuration-and-manifests.md`: update manifest kind table/examples.
      - `docs/contribution-registries.md`, `docs/extensions.md`, `docs/provider-packages.md`, and `docs/system-prompts.md`: align wording and related APIs.
    - References:
      - `roadmap.md` Phase 15 manifest contribution deliverable.
      - `plans/014-provider-auth-cache-and-system-prompt-primitives.md` provider package/auth/cache/system prompt primitives.
  - Test Cases to Write:
    - `manifest_accepts_current_provider_package_auth_policy_and_prompt_kinds`: parses all missing kinds.
    - `manifest_kind_list_matches_current_data_only_registry_categories`: guards future drift.
    - `manifest_auth_method_examples_do_not_allow_secret_values`: ensures docs/fixtures use fake names, not credential values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; expands accepted manifest contribution kind values.
    - Docs pages to create/edit:
      - `docs/configuration-and-manifests.md`: manifest kinds and examples.
      - `docs/contribution-registries.md`: registry/kind alignment.
      - `docs/extensions.md`: extension API registration names.
      - `docs/provider-packages.md`: provider package/auth/request policy manifest notes.
      - `docs/system-prompts.md`: system prompt contribution manifest note.
    - `docs/index.md` update: No new page; verify Configuration/manifests and Provider packages entries still cover the changed behavior.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Run final docs/export verification for Phase 15 hardening
  - Acceptance Criteria:
    - Functional: Final verification proves provider conformance tests, provider package tests, runtime tests, RPC tests, manifest tests, docs checks, typecheck, and default network-free test suite pass.
    - Performance: Default verification remains network-free and uses existing npm scripts; no live provider tests run unless explicit env vars are set.
    - Code Quality: Public exports, docs, and package behavior agree; no built test artifacts or release packaging changes are made in this phase unless required by touched exports.
    - Security: Final scans/tests confirm fake-only secrets, no known secret leakage in events/errors/docs fixtures, and no hidden env/config/package discovery was added.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts and workspace layout.
      - `src/__tests__/docs.test.ts` docs heading/link/export checks.
      - Provider package README/docs and skipped live-test conventions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Run only touched unit tests: rejected for final task; provider/runtime/RPC changes cross package boundaries.
      - Add a new test runner/dependency: rejected; existing `node:test` and npm workspace scripts are enough.
      - Use existing build/typecheck/test scripts plus targeted workspace tests during development: chosen.
    - Chosen Approach:
      - Run targeted tests while implementing each task, then run the full existing network-free suite.
      - Update docs tests only for Phase 15 public surfaces; provider-specific required heading enforcement remains Phase 18 unless it is cheap and directly touched.
    - API Notes and Examples:
      ```bash
      npm run typecheck
      command npm test
      npm run test --workspace=@prism/provider-openai
      npm run test --workspace=@prism/provider-opencode-go
      npm run test --workspace=@prism/provider-openrouter
      npm run test --workspace=@prism/provider-zai
      npm run test --workspace=@prism/provider-kimi
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: add drift checks only if needed for new/changed public docs.
      - Provider/core docs touched in previous tasks: final consistency edits.
      - `plans/018-provider-runtime-correctness-hardening.md`: mark completed tasks, record actual compromises and further actions after checks pass.
    - References:
      - `roadmap.md` Phase 15 acceptance.
      - `docs/index.md` Prism navigation map.
  - Test Cases to Write:
    - `docs_provider_conformance_lists_new_helpers`: docs/export drift check for new testing helper names.
    - `docs_middleware_hooks_match_runtime_supported_hooks`: docs/type drift check for `provider_response` removal or implementation.
    - `docs_manifest_kinds_include_current_provider_primitives`: docs/type drift check for manifest kinds.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; final verification ensures all public API/behavior changes from Phase 15 are documented.
    - Docs pages to create/edit:
      - `docs/provider-conformance.md`, `docs/provider-layer.md`, `docs/provider-packages.md`, `docs/providers/openai-compatible.md`, `docs/providers/openai.md`, `docs/providers/opencode-go.md`, `docs/providers/openrouter.md`, `docs/providers/zai.md`, `docs/providers/kimi.md`, `docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`, `docs/middleware-hooks.md`, `docs/configuration-and-manifests.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/system-prompts.md`, and `docs/cli-rpc.md`: verify/update as changed by implementation tasks.
    - `docs/index.md` update: No new page expected; verify link descriptions still match changed behavior.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Malformed SSE/JSON recovery checks remain package-local instead of adding a generic helper; the generic helpers cover terminal events, content preservation, usage/cache, abort, and redaction. A reusable malformed-stream helper would need to know each adapter's wire format.
- No new shared serializer abstraction was added. Each adapter has its own small serializer; duplication is accepted because provider-native request shapes differ and a generic serializer would need to understand every provider's wire format.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
