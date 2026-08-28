# First-Party Provider Parity and Caching

## Objectives
- Revalidate all 17 first-party provider packages against current official APIs and Prism conformance contracts.
- Fix confirmed cache-marker, cache-usage, explicit-breakpoint, and deterministic-schema gaps while keeping retries/runtime ownership and bounded streaming intact.
- Add data-driven parity gates so every provider proves stream termination, abort, usage, tools, cache intent, headers, zero setup I/O, and secret safety where applicable.

## Expected Outcome
- One current feature matrix covers AI SDK, Alibaba, Anthropic, Azure, Bedrock, ClinePass, DeepSeek, Google, Kimi, NeuralWatt, Ollama, OpenAI, OpenCode Go, OpenRouter, Vertex, xAI, and Z.AI.
- Cache-capable native routes preserve system/tool/message breakpoints and normalized read/write usage.
- Logically identical tool schemas serialize deterministically across first-party providers without changing semantic arrays.
- Unsupported cache features remain explicitly host-owned rather than guessed or sent on incompatible wire protocols.

## Tasks

- [ ] Perform provider primitive review and freeze a current 17-package matrix
  - Acceptance Criteria:
    - Functional: For every provider record protocol, setup I/O, credentials, models/discovery, stream completion evidence, abort, media, tools, reasoning, structured output, cache kind/hints/usage, headers, retry ownership, and live-canary status.
    - Performance: Record serializer/SSE throughput and heap for representative request/stream fixtures; identify only measured or protocol-confirmed gaps.
    - Code Quality: Inventory shared transport/media/OpenAI-compatible/cache helpers before adding any provider-local code; reject duplicate retry and HTTP parsing.
    - Security: Verify provider-owned auth/content/session headers win, error bodies are bounded/redacted, setup is zero-fetch, and credentials never enter model metadata/events.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md`, `docs/provider-primitives.md`, `docs/provider-conformance.md`, `docs/provider-caching.md`.
      - Provider pages under `docs/providers/*.md` and each package README.
      - OpenAI Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching.
      - Anthropic Prompt Caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching.
      - Gemini caching: https://ai.google.dev/gemini-api/docs/caching.
      - Vertex context cache: https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview.
      - Bedrock prompt caching: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html.
      - DeepSeek disk cache: https://api-docs.deepseek.com/guides/kv_cache/.
      - OpenRouter prompt caching: https://openrouter.ai/docs/guides/best-practices/prompt-caching.
    - Options Considered:
      - Trust current docs/catalog comments: rejected; APIs/model cache features changed.
      - Live-call every provider: unavailable/non-deterministic and costly.
      - Official-doc review + offline wire fixtures + protected canaries: chosen.
    - Chosen Approach:
      - Produce evidence first; mark each cell supported, intentionally host-owned, protected-only, or failing with exact source/test.
    - API Notes and Examples:
      ```ts
      await assertProviderStreamConforms({ provider, request, expect: { text: "ok", usage } });
      await assertProviderOwnedHeadersWin({ /* provider fixture */ });
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase37-provider-matrix.md`: complete matrix, official URLs, confirmed gaps.
      - No production files in this review task.
    - References:
      - `src/testing/provider-conformance.ts`.
      - `src/providers/transport.ts`, `src/providers/media.ts`, `src/providers/openai-primitives.ts`.
      - All `packages/provider-*/src` and `packages/provider-*/src/__tests__`.
  - Test Cases to Write:
    - Matrix completeness test reads all `packages/provider-*/package.json` and fails if any package lacks a row.
    - Documentation/link claim check for each explicit cache field.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; review only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase37-provider-matrix.md`: audit evidence.
    - `docs/index.md` update: no; internal evidence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Promote correct deterministic JSON Schema serialization and provider conformance
  - Acceptance Criteria:
    - Functional: Logically identical schemas with different object insertion order serialize identically; semantic array order (`prefixItems`, examples, tuple schemas) is preserved; only unordered `required` names may be sorted.
    - Performance: Canonicalization is O(schema nodes + sorted object keys), bounded by existing schema/request limits, and performed once per request/tool declaration.
    - Code Quality: Replace DeepSeek-only canonicalization with one shared exported provider primitive; all applicable first-party serializers reuse it.
    - Security: Forbidden/prototype keys and schema bounds remain enforced by validator/provider boundaries; canonicalization neither resolves refs nor mutates caller input.
  - Approach:
    - Documentation Reviewed:
      - JSON Schema 2020-12 object/array semantics: https://json-schema.org/draft/2020-12/json-schema-core.
      - `docs/tool-execution-primitives.md` and `docs/provider-caching.md`.
      - OpenAI caching guidance: tool definitions/structured schemas before breakpoints must remain unchanged.
    - Options Considered:
      - Sort `JSON.stringify` output text: cannot be reused by object-body serializers.
      - Generic deep object-key canonicalizer with schema-aware `required` handling: chosen.
      - Sort every string array as current DeepSeek helper does: rejected; array order can be semantic.
    - Chosen Approach:
      - Add one pure `canonicalizeJsonSchema` core/provider primitive and apply it in each provider's `toTool`/function declaration mapping.
    - API Notes and Examples:
      ```ts
      canonicalizeJsonSchema({ required: ["b", "a"], properties: { b: {}, a: {} } });
      // keys and required names stable; ordered schema arrays remain ordered
      ```
    - Files to Create/Edit:
      - `src/providers/schema.ts` (tentative minimal shared primitive) and public provider-primitives export.
      - `packages/provider-deepseek/src/cache.ts`: remove/re-export shared helper and preserve compatibility.
      - Tool serializers in each applicable provider package (exact list frozen by Task 1).
      - `src/testing/provider-conformance.ts`: deterministic-schema assertion.
      - Provider conformance tests and `docs/provider-primitives.md`, `docs/provider-caching.md`.
    - References:
      - `packages/provider-deepseek/src/cache.ts:1-44`.
      - `src/input.ts:469-481` existing private sorted JSON precedent.
      - `packages/tool-validator-json-schema/src/json-schema.ts:174-246` schema cache/bounds.
  - Test Cases to Write:
    - Different property insertion order -> identical wire body.
    - `required` order -> identical wire body.
    - `prefixItems`/ordered string examples remain unchanged.
    - Caller schema object remains unmodified.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if shared helper is exported; provider wire order changes without semantic change.
    - Docs pages to create/edit:
      - `docs/provider-primitives.md`: helper contract/example.
      - `docs/provider-caching.md`: schema stability.
      - `docs/provider-conformance.md`: new assertion.
    - `docs/index.md` update: no; pages already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Preserve system-prompt cache breakpoints on Anthropic-compatible routes
  - Acceptance Criteria:
    - Functional: `system_prompt` breakpoints survive serialization as native system content blocks with `cache_control`; message/tool-result markers and max-breakpoint/TTL rules remain correct for Anthropic, Kimi Coding, and OpenCode Go Anthropic routes.
    - Performance: Stable system prompts produce byte-identical native blocks; no duplicate system text or extra provider call.
    - Code Quality: Reuse one Anthropic-message serialization helper if the three copies are structurally identical; otherwise apply the same focused fix without creating a dependency cycle.
    - Security: System text remains redacted before provider call; route checks prevent Anthropic fields on Moonshot/OpenAI routes.
  - Approach:
    - Documentation Reviewed:
      - Anthropic Prompt Caching official block form and hierarchy.
      - `docs/providers/anthropic.md`, `docs/providers/kimi.md`, `docs/providers/opencode-go.md`.
      - `docs/provider-caching.md` breakpoint locations.
    - Options Considered:
      - Keep plain system string: drops per-block marker.
      - Emit native system array only when marker/block structure requires it: chosen for minimal payload change.
      - Always emit arrays: acceptable only if snapshots and official API confirm parity.
    - Chosen Approach:
      - Serialize system messages into content blocks preserving the final stamped block; keep no-marker request shape stable when possible.
    - API Notes and Examples:
      ```json
      {"system":[{"type":"text","text":"stable","cache_control":{"type":"ephemeral","ttl":"1h"}}]}
      ```
    - Files to Create/Edit:
      - `packages/provider-anthropic/src/messages.ts` and tests.
      - `packages/provider-kimi/src/provider.ts` and tests.
      - `packages/provider-opencode-go/src/anthropic-messages.ts` and tests.
      - Related provider docs and `docs/provider-caching.md`.
    - References:
      - `packages/provider-anthropic/src/messages.ts:46-72` currently joins system blocks into a string.
      - Equivalent Kimi/OpenCode Go serializers identified in Task 1.
      - `src/cache-helpers.ts:37-58` stamps selected message anchors.
  - Test Cases to Write:
    - System-only breakpoint short/long TTL on all three routes.
    - Combined system + last stable message stays within max breakpoints.
    - OpenAI/Moonshot routes never receive `cache_control`.
    - Caller input messages remain unmodified.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; cache hints now work as documented on system prompts.
    - Docs pages to create/edit:
      - `docs/providers/anthropic.md`, `docs/providers/kimi.md`, `docs/providers/opencode-go.md`.
      - `docs/provider-caching.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Implement current OpenAI Responses cache options and complete usage mapping
  - Acceptance Criteria:
    - Functional: Supported newer models map generic cache breakpoints/TTL to current `prompt_cache_options`; older models keep valid legacy retention behavior; `input_tokens_details.cache_write_tokens` maps to `Usage.cacheWriteTokens` when returned.
    - Performance: Stable key/options/prefix reuse is deterministic; no extra request or cache-management lifecycle.
    - Code Quality: Keep provider-specific wire fields in OpenAI package and generic cache intent in core; provider-owned fields override `extra` so invalid caller values cannot replace resolved policy.
    - Security: Cache keys remain sanitized/bounded and never contain credentials/raw prompts; options are model-capability gated.
  - Approach:
    - Documentation Reviewed:
      - OpenAI Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching.
      - OpenAI Responses reference and Context7 `/websites/developers_openai_api` lookup: newer explicit breakpoints, `prompt_cache_options`, TTL, `cached_tokens`, `cache_write_tokens`.
      - `docs/providers/openai.md#cache-behavior` currently records this as unimplemented.
    - Options Considered:
      - Require hosts to pass raw `extra.prompt_cache_options`: current escape hatch but defeats provider-agnostic hints.
      - Map `PromptCacheHints.breakpoints` in provider package: chosen.
      - Create/manage external cache resources: not part of Responses prompt caching and rejected.
    - Chosen Approach:
      - Extend OpenAI model cache metadata/serializer with exact documented fields and strict feature gating.
    - API Notes and Examples:
      ```ts
      options: { cache: { key: "tenant-agent", breakpoints: [{ location: "last_stable_message", ttl: "long" }] } }
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/cache.ts`: current option mapping.
      - `packages/provider-openai/src/responses.ts`: request/usage wire types and fields.
      - `packages/provider-openai/src/models.ts`: capability metadata from official model rules.
      - `packages/provider-openai/src/__tests__/openai.test.ts`.
      - `docs/providers/openai.md`, `docs/provider-caching.md`, `docs/provider-packages.md`.
    - References:
      - `packages/provider-openai/src/responses.ts:262-292`, `:416-471`.
      - `packages/provider-openai/src/models.ts:162-163`.
  - Test Cases to Write:
    - New model explicit breakpoint/TTL request.
    - Old model valid `24h` retention and no new unsupported field.
    - `cache.mode="off"`/retention none emits no explicit options.
    - Cache write/read usage mapping and malformed usage omission.
    - Caller `extra` cannot override resolved owned fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; existing generic hints gain OpenAI mapping and normalized usage is richer.
    - Docs pages to create/edit:
      - `docs/providers/openai.md`.
      - `docs/provider-caching.md`.
      - `docs/provider-packages.md`.
    - `docs/index.md` update: no; existing entries remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Close native, gateway, and implicit-cache parity gaps without inventing wire fields
  - Acceptance Criteria:
    - Functional: Alibaba, Google, OpenRouter, Z.AI, NeuralWatt, Ollama, DeepSeek, xAI, ClinePass, and Kimi Moonshot correctly map documented cache usage/reasoning/tool fields and omit unsupported cache controls; discovery metadata matches official responses.
    - Performance: Implicit-cache providers receive byte-stable full history with dynamic suffix last; no provider setup fetch or duplicate retry loop is added.
    - Code Quality: Any discovered gap gets a provider-local minimal patch plus shared conformance; providers with no gap receive evidence, not churn.
    - Security: Provider-owned headers, endpoint origin restrictions, bounded streams/errors, and secret redaction remain proven.
  - Approach:
    - Documentation Reviewed:
      - Official links captured in Task 1 matrix, including DeepSeek/OpenRouter/Gemini caching.
      - `docs/provider-caching.md#per-provider-cache-behavior`.
      - Each provider's `docs/providers/<name>.md`.
    - Options Considered:
      - Send Anthropic/OpenAI cache fields to all compatible APIs: rejected; compatibility does not imply field support.
      - Preserve implicit caching via stable request shape and usage observation: chosen.
      - Add Gemini explicit-cache lifecycle to provider: rejected unless Task 1 finds a caller-owned cached-content resource seam is insufficient; resource lifecycle is separate from generation.
    - Chosen Approach:
      - Data-driven conformance and only documented per-provider mappings; retain `extra.cachedContent` host escape hatch for caller-managed Gemini cache resources.
    - API Notes and Examples:
      ```ts
      // Implicit providers: no invented cache payload.
      assert.equal(JSON.stringify(body).includes("prompt_cache_key"), false);
      ```
    - Files to Create/Edit:
      - Exact provider source/tests determined by failing Task 1 matrix (tentative).
      - `src/testing/provider-conformance.ts`: cache omission/usage cases.
      - Corresponding `docs/providers/*.md`, `docs/provider-caching.md`.
    - References:
      - `packages/provider-google/src/generate-content.ts:233-243` maps `cachedContentTokenCount`.
      - `src/providers/openai-primitives.ts:114-149` shared compatible usage.
      - Provider cache helpers found by Task 1.
  - Test Cases to Write:
    - Every implicit/none provider serializes no foreign cache fields.
    - Documented read/write token variants normalize correctly.
    - Reasoning content replay keeps second-turn prefix valid.
    - Discovery stays caller-gated and setup performs zero fetch.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: only for confirmed provider-specific fixes.
    - Docs pages to create/edit:
      - Matching `docs/providers/*.md` pages from Task 1.
      - `docs/provider-caching.md` canonical matrix.
    - `docs/index.md` update: no unless a new provider page is created; none planned.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Validate AI SDK and enterprise cloud wrappers against their declared protocols
  - Acceptance Criteria:
    - Functional: AI SDK v4 mapping and Azure/Bedrock/Vertex OpenAI-compatible wrappers pass abort, tools, usage, header, endpoint, credential, and zero-setup-I/O conformance.
    - Performance: Wrappers add no buffering/retry/catalog call beyond shared streaming adapter; serializer/stream overhead stays within Task 1 baseline.
    - Code Quality: Do not add native Bedrock Converse or Vertex cached-content lifecycle to OpenAI-compatible packages; create a separate future package only if explicitly requested and justified.
    - Security: Azure host preservation, Bedrock SigV4 canonicalization, Vertex token ownership, and AI SDK host-owned auth remain intact.
  - Approach:
    - Documentation Reviewed:
      - `docs/providers/ai-sdk.md`, `azure.md`, `bedrock.md`, `vertex.md`.
      - AI SDK `LanguageModelV4` peer contract documented by package version.
      - AWS prompt caching docs (Converse `cachePoint`) to distinguish unsupported native protocol from current OpenAI-compatible route.
      - Vertex cache docs to distinguish cache-resource lifecycle from current OpenAPI-compatible route.
    - Options Considered:
      - Expand wrappers into multiple native protocols: rejected as scope/API bloat.
      - Verify declared protocol and document host-owned cache boundary: chosen.
    - Chosen Approach:
      - Add missing conformance only; no implementation churn when behavior already matches declared surface.
    - API Notes and Examples:
      ```ts
      // Setup remains inert; caller supplies credential/model and explicitly generates.
      const pkg = createBedrockProviderPackage({ credential, models });
      ```
    - Files to Create/Edit:
      - Provider tests for AI SDK/Azure/Bedrock/Vertex.
      - Source only if tests expose a confirmed defect.
      - `docs/providers/ai-sdk.md`, `azure.md`, `bedrock.md`, `vertex.md` for precise cache/protocol boundary.
      - `docs/_evidence/phase37-provider-matrix.md`.
    - References:
      - `packages/provider-ai-sdk/src`.
      - `packages/provider-azure/src/provider.ts`.
      - `packages/provider-bedrock/src/provider.ts`, `sigv4.ts`.
      - `packages/provider-vertex/src/provider.ts`.
  - Test Cases to Write:
    - No setup fetch/credential resolution.
    - Provider-owned headers and endpoint origin/host behavior.
    - Abort and truncated stream failure.
    - Unsupported native cache hints omitted/documented.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no unless tests expose a defect; docs clarify boundaries.
    - Docs pages to create/edit:
      - `docs/providers/ai-sdk.md`, `docs/providers/azure.md`, `docs/providers/bedrock.md`, `docs/providers/vertex.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Run all provider gates and protected live canaries
  - Acceptance Criteria:
    - Functional: All 17 package suites, root provider tests, typecheck/lint/format, pack, provider conformance, and release gates pass; protected canaries run where credentials exist and every skip is explicit.
    - Performance: Serializer/SSE/cache-prefix benchmark rows meet frozen ceilings with no >10% unexplained regression.
    - Code Quality: Feature matrix, docs, tests, model metadata, and implementation agree; no stale “not implemented” claims remain.
    - Security: No secret appears in events/errors/evidence; live canaries use bounded requests/timeouts and no automatic setup calls.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md#015-protected-live-canary-matrix`.
      - `docs/provider-conformance.md`.
      - `.github/workflows/live-canaries.yml`.
    - Options Considered:
      - Require all credentials locally: impossible.
      - Run available protected tests and record exact skips: chosen.
    - Chosen Approach:
      - Network-free suite is mandatory; protected evidence is additive and never inferred from skips.
    - API Notes and Examples:
      ```bash
      npm run build
      npm test --workspaces --if-present
      npm run typecheck && npm run lint && npm run format:check && npm run pack:dry-run
      PRISM_LIVE_PROVIDER_TESTS=1 npm test --workspaces --if-present
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase37-provider-matrix.md`: final test/canary status.
      - `docs/provider-packages.md`, `docs/provider-caching.md`: final canonical matrices.
    - References:
      - `package.json#scripts.sdk:ready`.
      - Provider package `test:live` scripts.
  - Test Cases to Write:
    - All offline provider suites.
    - Available live text/tool/abort/cache-usage probes.
    - Dry-pack import for every provider package.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional behavior beyond prior tasks.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`, `docs/provider-caching.md`.
      - `docs/_evidence/phase37-provider-matrix.md`.
    - `docs/index.md` update: no; existing provider navigation remains.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
