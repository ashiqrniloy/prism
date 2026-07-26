# Phase 10 — Release 0.0.15: Provider, Memory, and RAG Ecosystem Parity

## Objectives

- Close remaining provider ecosystem gaps: OpenAI hosted tools, response continuation, and realtime APIs without leaking hosted-tool semantics into core; an AI SDK adapter with a tested supported-version matrix and complete supported content/tool/metadata mapping; attributable model discovery/cache/reasoning/routing metadata for Kimi, ZAI, OpenRouter, OpenCode Go, Alibaba, Ollama Cloud, and NeuralWatt, sharing serializers only where wire semantics are truly identical.
- Keep the 0.0.11 native Anthropic and Google provider packages under shared offline conformance and restricted live canaries; Phase 10 does not re-open their primary adapters.
- Add RAG lifecycle and ecosystem parity: atomic source replacement and deletion, document-loader/parser seams with focused text/Markdown/HTML/PDF reference adapters, reranking, citation provenance, ingestion status, and prompt-injection/content-trust metadata; public web ingestion reuses bounded `@arnilo/prism-web-tools` fetch results/citations rather than a second crawler.
- Add memory production conformance: finite-vector validation, retention/deletion/export, source/consent metadata, index rebuild, and production adapter conformance; additional vector stores stay demand-gated (no new vector-store package in this phase).
- Run primitive and wire-semantic review before each adapter change; share only exact behavior; keep parsers/loaders/rerankers optional and bounded; ship minimal reference adapters rather than a document framework.
- Version, document, benchmark, and release-validate the graph as **0.0.15** without broadening user consent, memory, network, file, browser, connector, or tool permissions (roadmap gate 9).

## Expected Outcome

- `@arnilo/prism-provider-openai` supports justified hosted tools, response continuation, and a realtime API seam; hosted-tool/realtime code lives in the provider package (not core); core `AIProvider`/transport contracts grow only the minimum neutral seam required to express continuation and realtime events.
- `@arnilo/prism-provider-ai-sdk` carries a documented supported-AI-SDK-version matrix and a tested mapping for every supported content type, tool-call/delta, usage/cache, reasoning, structured-output, and error/abort field; unsupported fields fail explicitly rather than silently dropping.
- Kimi, ZAI, OpenRouter, OpenCode Go, Alibaba, Ollama Cloud, and NeuralWatt pass the shared offline conformance suite and expose attributable discovery/cache/reasoning/routing metadata; serializers are shared only where two providers share the exact wire shape.
- `@arnilo/prism-rag` exposes `replaceSource`, source deletion, a `DocumentLoader`/`Parser` seam, text/Markdown/HTML/PDF reference parsers, a `Reranker` seam, citation provenance, ingestion status, and content-trust metadata; web ingestion routes through `web_fetch`/`web_extract` normalized results and citations.
- `@arnilo/prism-memory` exposes retention/deletion/export, source/consent metadata, index rebuild, finite-vector validation, and production adapter conformance (SQLite/Postgres/pgvector parity); no new vector-store package ships.
- Network-free provider/realtime/parsing/chunking/embedding/reranking/retrieval/index-rebuild benchmarks, `npm run sdk:ready`, supply-chain checks, exact pack graph, and 0.0.15 publish dry-runs pass; credentialed live canaries remain operator-gated.

## Tasks

- [x] 0. Freeze Phase 10 scope, package ownership, primitive inventory, limits, and evidence matrix
  - Acceptance Criteria:
    - Functional: map every Phase 10 roadmap criterion to an existing primitive, minimum gap, owning task, test, docs page, and release gate; freeze package/subpath ownership (extend `@arnilo/prism-provider-openai`, `@arnilo/prism-provider-ai-sdk`, the remaining first-party provider packages, `@arnilo/prism-rag`, `@arnilo/prism-memory`, `@arnilo/prism-web-tools` in place; new packages only if this review records measured need); mark additional vector stores, Studio/control plane, remote-browser vendors, and Office runtime out of scope.
    - Performance: freeze finite caps for hosted-tool/realtime sessions, response continuation windows, document parse/chunk/emit bytes, embedding/reranking concurrency, retrieval topK/candidates, index-rebuild batches, memory retention sweeps, and export pages; confirm all new loops consume shared turn/tool/token/cost `RunLimits`.
    - Code Quality: inventory core `AIProvider`/`ProviderRequest`/`ProviderEvent`/transport, provider-request policies, `Embedder`/`VectorStore`/`MemoryStore`, `ResourceLoader`, redactor, `RunLimits`, web-tools normalized documents/citations/trust metadata, existing provider serializers (OpenAI/Anthropic/Google/Kimi/ZAI/OpenRouter/OpenCode Go/Alibaba/Ollama/NeuralWatt), and the AI SDK adapter; authorize only generic reusable gaps; no second provider runtime, second RAG framework, or mandatory document framework.
    - Security: record roadmap gate 9 — no permission broadening; provider credentials stay host-owned and late-bound; remote documents use SSRF/content bounds; retrieved content stays untrusted inert context; source replacement/deletion cannot cross ownership/corpus scope; hosted-tool/realtime sessions bind authorization to exact origin/session/ownership.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 10, Product Boundaries, Release Order gate 9/11, Persona Outcomes, Package Coverage Ledger rows for provider-*/rag/memory/web-tools/ai-sdk.
      - `docs/provider-conformance.md`, `docs/provider-packages.md`, `docs/provider-caching.md`, `docs/provider-primitives.md`, `docs/provider-request-policies.md`, `docs/provider-layer.md`, `docs/multimodal-content.md`, `docs/rag.md`, `docs/working-and-semantic-memory.md`, `docs/resource-loading.md`, `docs/host-security.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-25-phase-9.md`.
      - Current official OpenAI (Responses, Realtime, hosted tools, continuation), AI SDK, and existing first-party provider API documentation at implementation time.
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns` or `.agents/skills/project-wiki`.
    - Options Considered:
      - Depend only on AI SDK for hosted-tool/realtime gaps: hides OpenAI-specific continuation/realtime semantics; rejected (mirrors the 0.0.11 Anthropic/Google decision).
      - Add every provider/vector/parser/reranker: maintenance burden; rejected.
      - New `@arnilo/prism-realtime` / `@arnilo/prism-reranker` / `@arnilo/prism-document-loaders` packages: rejected unless Task 0 size/cohesion evidence requires a split; extend the owning packages in place first.
      - Close remaining hosted-tool/realtime/AI-SDK/RAG/memory gaps with narrow reusable seams over existing primitives: chosen.
    - Chosen Approach:
      - Produce a frozen evidence matrix (criterion → primitive → gap → task → test → docs → gate) in this plan; record publishable manifest count (baseline 43 from 0.0.14) and any justified delta.
      - Freeze hosted-tool/realtime event shapes, continuation cursor semantics, loader/parser/reranker contract shapes, and memory consent/retention token shapes so Tasks 1–7 cannot widen permissions.
    - API Notes and Examples:
      ```ts
      // Freeze shapes (finalized in implementation):
      type HostedToolInvocation = { tool: string; args: JsonObject; callId: string; authority: "provider-hosted" };
      type RealtimeSession = { id: string; ownerId: string; provider: string; audioEventCap: number; ... };
      type DocumentLoader = { load(uri: string, scope: RagScope): Promise<LoadedDocument> };
      type Reranker = { rerank(query: string, hits: readonly RagHit[], opts?: RerankOptions): Promise<readonly RagHit[]> };
      type SourceReplace = { sourceId: string; loader: DocumentLoader; chunker: Chunker; embedder: Embedder; store: VectorStore; scope: RagScope };
      ```
    - Files to Create/Edit:
      - This plan (evidence matrix, frozen caps, manifest count).
      - `docs/review-coverage-2026-07-26-phase-10.md`: frozen scope, primitive, limit, threat, and revision evidence.
    - References:
      - Plan 074 Tasks 0–13 (Anthropic/Google native providers, session index, context budget), Plan 075 (AG-UI/ACP adapter), Plan 077 Tasks 8–11 (Alibaba/Ollama provider pattern), roadmap Phase 10.
  - Test Cases to Write:
    - Matrix completeness assertion: every roadmap Phase 10 acceptance bullet has task + test + docs owner.
    - Scope guard: no Studio/remote-browser-vendor/Office/additional-vector-store artifact appears in package graph or docs index.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (planning artifact); freeze document constrains later tasks.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-26-phase-10.md`: frozen scope/primitive/limit/threat matrix.
    - `docs/index.md` update: no until Tasks 1–7 land public surfaces; review doc linked from Phase 10 evidence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - `docs/review-coverage-2026-07-26-phase-10.md` frozen at Prism `73aec95` (Release 0.0.14): capability traceability (every Phase 10 roadmap criterion → Task 1–9 owner with test/docs owner), §2 package ownership, §3 primitive inventory (core `AIProvider`/`ProviderEvent`/`ProviderRequest`/`ResourceLoader`/`openai-compatible`/`openai-primitives`/`provider-conformance`; memory `Embedder`/`VectorStore`/`createMemory` + 0.0.14 consent/retention/forget/correct + `assertFiniteVector`; RAG `indexChunks`/`retrieveContext`/`RagScope`/`RagLimits`; web-tools `untrusted`/`WebCitation`/`canonicalUrl`), §4 frozen finite limits (hosted-tool/continuation/realtime/parse/rerank/rebuild/export), §5 threat/authority matrix, §6 Task 0 validation matrix, §7 binding frozen decisions.
    - Frozen decisions: **43 → 43 manifests** (42 workspace packages + root `@arnilo/prism`; all 42 confirmed `private !== true`); no new package authorized — every capability extends an existing package in place (`provider-openai`, `provider-ai-sdk`, `provider-{kimi,zai,openrouter,opencode-go,alibaba,ollama,neuralwatt}`, `rag`, `memory`; Anthropic/Google conformance/canary re-confirm only; web-tools unchanged). Core grows only the minimum neutral `ProviderEvent` continuation/realtime variant + `ToolCallContent.authority = "provider-hosted"` (Task 1); no OpenAI-specific field enters core.
    - Real-grounded gaps recorded: `ProviderEvent` (union at `src/contracts.ts:288`) has no continuation/realtime variant and `ToolCallContent` (`src/contracts.ts:65`) has no `authority` field — genuinely new neutral seams (Task 1). RAG `indexChunks` (`packages/rag/src/indexing.ts`) carries a `ponytail:` comment explicitly deferring stale-source replacement to the host — `replaceSource`/`deleteSource`/`DocumentLoader`/`Parser`/`Reranker`/provenance/ingestion-status are all absent (Tasks 4–5). Memory `exportMemory` and `rebuildIndex` are absent, but `MemoryConsent`/`applyRetention`/`forget`/`correct`/`grantConsent`/`revokeConsent` + `assertFiniteVector` at embedder/memory-vector/postgres already shipped in 0.0.14 (`packages/memory/src/memory.ts:205,223,249,261` + `util.ts:101`) — Task 6 adds only export/rebuild + remaining finite-vector boundaries + conformance parity, not new consent shapes.
    - Serializer precedent: Kimi/Moonshot (`serializeMoonshotMessage`) and Alibaba (`serializeAlibabaMessage`) already keep separate message serializers because their `cache_control`/`reasoning_content` wire semantics differ; both share only `serializeOpenAITool` from `src/providers/openai-primitives.ts`. Task 3 extracts shared serializers only on a recorded exact wire match in §2/§5 of the review doc.
    - Scope guard (binding): no `packages/{realtime,document-loaders,reranker,vector-store-*,studio,voice,desktop}` directory, nav entry, or graph node appears; additional vector stores, Studio/control plane, remote-browser vendors, Office runtime, and Slack/Teams/voice/desktop vendor packages are out of scope (0.1.x demand-gated). `npm test` stays network-free; credentialed live canaries stay operator-gated (Task 7 matrix).
    - Review doc linked from this plan and `docs/index.md` (Phase 10 review coverage entry added next to Phase 8/9 entries — the "exactly one navigation link per page" guard enforces it now, matching Phase 8/9 Task 0 precedent); other `docs/index.md` navigation entries for new public surfaces remain deferred until Tasks 1–7 land per Task 0 acceptance.

- [x] 1. OpenAI hosted tools, response continuation, and realtime API seam
  - Acceptance Criteria:
    - Functional: OpenAI supports justified hosted tools (e.g. web search, code interpreter, file search) as attributable provider-hosted tool invocations surfaced through the existing tool-event stream; hosted-tool semantics stay in `@arnilo/prism-provider-openai` and never enter core contracts or other providers.
    - Functional: response continuation (long Responses/completions that require a follow-up fetch) is bounded, resumable via an opaque provider cursor, and observable as continuation events; a continuation cannot exceed the run's shared `RunLimits` or spawn an unbounded loop.
    - Functional: a realtime API seam supports session create/audio-in/audio-out/interruption/close with finite event/byte/time/audio caps; realtime sessions bind authorization to exact origin/session/ownership and fail closed on disconnect/budget breach.
    - Performance: hosted-tool result bytes, continuation windows, realtime audio events, and concurrent realtime sessions have frozen caps; abort propagates to the provider stream; no unbounded buffering of audio or tool output.
    - Code Quality: hosted-tool/continuation/realtime code composes through existing `AIProvider`/`ProviderRequest`/`ProviderEvent`/transport, redactor, `RunLimits`, and provider-request policies; core grows only the minimum neutral seam required to express continuation and realtime events; no OpenAI-specific field leaks into core.
    - Security: hosted-tool calls are marked `authority: "provider-hosted"` so downstream guardrails/permissions treat them as provider-side, not host-side, tool calls; realtime audio/ transcripts are untrusted content subject to redaction; credentials never enter tool args, events, or telemetry.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-conformance.md`, `docs/provider-packages.md`, `docs/provider-primitives.md`, `docs/provider-request-policies.md`, `docs/multimodal-content.md`, `docs/host-security.md`; existing `packages/provider-openai/src/{responses,codex,cache,oauth,uploads}.ts`.
      - Current OpenAI Responses API (hosted tools, `previous_response_id`/continuation) and Realtime API documentation at implementation time.
    - Options Considered:
      - Expose hosted tools as generic MCP/remote tools: coarsens authority and bypasses provider-hosted attribution; rejected.
      - Reimplement realtime transport in core: duplicates a provider-specific protocol; rejected.
      - Provider-package-owned hosted-tool/continuation/realtime over the minimum neutral core seam: chosen.
    - Chosen Approach:
      - Add the minimum neutral core seam for continuation cursor and realtime event types; implement OpenAI-specific hosted-tool, continuation, and realtime behavior in `@arnilo/prism-provider-openai`.
      - Mark hosted-tool invocations with `authority: "provider-hosted"` so guardrails/permissions/redaction treat them distinctly from host-owned tools.
      - Reuse existing transport, bounded body readers, SSE, abort, and redaction primitives; add realtime-specific finite caps.
    - API Notes and Examples:
      ```ts
      const provider = createOpenAIProvider({ credentials, model });
      // Hosted tool authority + continuation cursor flow through the same event stream.
      for await (const event of provider.stream(request)) {
        if (event.type === "tool_call" && event.authority === "provider-hosted") { /* provider-side */ }
        if (event.type === "continuation_required") { /* resume with opaque cursor */ }
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/{responses,realtime,index}.ts`, tests, README, changelog.
      - Core neutral continuation/realtime event seam + tests only where required (do not add OpenAI-specific fields to core).
    - References:
      - Existing OpenAI provider transport/SSE/cache/oauth/uploads; Plan 074 Task 5–6 (Anthropic/Google native provider pattern); provider-conformance helpers.
  - Test Cases to Write:
    - Hosted-tool invocation authority attribution, result byte cap, abort, and redaction of args/output.
    - Continuation cursor resume across boundary, budget exhaustion, duplicate/stale cursor, abort mid-continuation.
    - Realtime session create/audio-in/audio-out/interrupt/close, event/audio/byte/time caps, disconnect fail-closed, credential-free events.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new OpenAI hosted-tool/continuation/realtime surface and minimum neutral core seam.
    - Docs pages to create/edit:
      - `docs/providers/openai.md` (extend hosted tools/continuation/realtime), `docs/provider-conformance.md`, `docs/multimodal-content.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Provider/model connection entry for OpenAI hosted tools/realtime.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Core: `ToolCallContent` / `ToolCallDeltaContent` carry neutral `authority: "host" | "provider-hosted"`; `ProviderEvent` carries opaque `continuation_required`; `ProviderRequestOptions.continuation` and `RealtimeSession` / `RealtimeEvent` / `RealtimeCaps` are exported from `@arnilo/prism`. Agent loops filter provider-hosted calls before round charging, dispatch, and tool-result append.
    - Responses: `packages/provider-openai/src/responses.ts` detects server tool items ending in `_call` (excluding host `function_call`), marks them provider-hosted, omits them from replay serialization, self-resumes `incomplete` responses with `previous_response_id`, skips prompt-history replay, rejects empty/oversized (over 4 KiB) and duplicate cursors, and ends the eight-hop ceiling with a redacted error.
    - Realtime: `packages/provider-openai/src/realtime.ts` uses documented header auth (never API-key URL params), a required host `ownerId`, server `session.created` binding, one active session per owner, bounded audio/event/byte queues, wall timeout, interruption, redaction, and fail-closed disconnect/budget/identity handling. Node 22 hosts may inject a header-capable transport; Node 24 global WebSocket uses the same header shape.
    - Docs: updated `docs/providers/openai.md`, `docs/provider-conformance.md`, `docs/multimodal-content.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`, package README, and changelog. Existing OpenAI docs were verified through Context7 (`/websites/developers_openai`): Realtime WebSocket header authentication / `session.created` / `response.output_audio.delta`, and Responses hosted-tool / `previous_response_id` semantics.
    - Checks passed: `npm run -s build`; `npm test --workspace @arnilo/prism-provider-openai` (48 pass, 4 env-gated skips); `node --test dist/__tests__/agent-loops.test.js` (40 pass); `node --test dist/__tests__/docs.test.js dist/__tests__/public-export-contract.test.js` (249 pass); `git diff --check`.

- [x] 2. AI SDK adapter supported-version matrix and content/tool/metadata mapping
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-provider-ai-sdk` documents a supported-AI-SDK-version matrix and tests against each pinned supported version; every supported content type, tool-call/delta, usage/cache, reasoning, structured-output, and error/abort field is mapped to Prism normalized events; unsupported fields fail explicitly (typed error) rather than silently dropping.
    - Functional: version skew between the matrix and an installed AI SDK is detected at setup with an explicit, attributable error; no silent degradation when an upstream minor/major changes a field shape.
    - Performance: AI SDK streams stay within existing run limits; mapping adds no unbounded buffering; abort propagates to the underlying AI SDK stream.
    - Code Quality: mapping is a typed, table-driven converter (not a chain of `any` spreads); AI-SDK-specific shapes stay in the package; core sees only normalized Prism events.
    - Security: AI SDK credentials remain host-owned and late-bound; mapped events never embed raw provider secrets; error redaction reuses the active redactor.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-conformance.md`, `docs/provider-packages.md`; existing `packages/provider-ai-sdk/src/{provider,stream,prompt,errors,types}.ts`.
      - Current AI SDK (Vercel `ai`) provider/streaming/tool/usage documentation at implementation time; pinned supported version range.
    - Options Considered:
      - Single pinned version, no matrix: silent break on upstream minor; rejected.
      - Generic `any`-passthrough mapping: loses typing and hides dropped fields; rejected.
      - Pinned supported-version matrix + typed table-driven mapping with explicit unsupported-field failure: chosen.
    - Chosen Approach:
      - Record the exact supported AI SDK version matrix in package README + `docs/providers/ai-sdk.md`; test every pinned matrix row in the offline conformance suite and reject installed-version skew at setup.
      - Build a typed mapping table (content/tool/usage/reasoning/structured-output/error/abort → Prism events); raise typed `AiSdkProviderError` for any unrecognized or unmappable required field.
    - API Notes and Examples:
      ```ts
      const provider = createAiSdkProvider({ model });
      // Mapping table is the source of truth; unsupported fields raise AiSdkProviderError.
      ```
    - Files to Create/Edit:
      - `packages/provider-ai-sdk/src/{provider,stream,prompt,types,errors,index}.ts`, matrix test, README, changelog.
      - `docs/providers/ai-sdk.md` (supported-version matrix + mapping table).
    - References:
      - Existing AI SDK adapter; provider-conformance helpers; Plan 074 provider pattern.
  - Test Cases to Write:
      - Per-supported-version content/tool/usage/reasoning/structured-output/error/abort mapping; unsupported-field explicit failure; version-skew setup error; abort propagation; secret-free events.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; AI SDK mapping surface and supported-version matrix.
    - Docs pages to create/edit:
      - `docs/providers/ai-sdk.md` (matrix + mapping), `docs/provider-conformance.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Provider/model connection entry for AI SDK matrix.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Version matrix: `@arnilo/prism-provider-ai-sdk` now pins the peer and dev dependency to `@ai-sdk/provider@4.0.3`; `SUPPORTED_AI_SDK_VERSION_MATRIX` is the public source of truth. `createAiSdkProvider()` resolves the installed peer package metadata at setup and rejects any unlisted ABI with typed `AiSdkProviderError { code: "unsupported_version" }`, in addition to the existing `LanguageModelV4` / `doStream` gate.
    - Mapping: `AI_SDK_STREAM_PART_MAPPINGS` is a typed exhaustive V4 table. It maps safe normalized text/reasoning/tool deltas, client/provider-hosted tool authority, `response-metadata.id` → `message_start`, usage/cache accounting, finish, errors, and abort. Control/raw/private metadata stays out of Prism events; output files/sources/custom/approval requests and `structuredOutput.strict` fail typed `unsupported_mapping` rather than silently dropping or coercing fields. Provider-executed results remain provider-side and never trigger host dispatch.
    - Security: optional `AiSdkProviderOptions.redactor` redacts direct-provider error events; normal agents continue to use their active run redactor. No credentials, opaque provider metadata, raw chunks, or provider results enter normalized events.
    - Docs: updated `docs/providers/ai-sdk.md`, `docs/provider-conformance.md`, `docs/migration.md`, `docs/index.md`, package README, and changelog with exact matrix, mapping/disposition table, upgrade behavior, redaction, and no-catalog ownership.
    - Checks passed: `npm run -s build`; `npm test --workspace @arnilo/prism-provider-ai-sdk` (12 pass); `node --test dist/__tests__/docs.test.js dist/__tests__/public-export-contract.test.js` (249 pass); `git diff --check`.

- [x] 3. Remaining provider parity: attributable metadata and shared serializers
  - Acceptance Criteria:
    - Functional: Kimi, ZAI, OpenRouter, OpenCode Go, Alibaba, Ollama Cloud, and NeuralWatt expose attributable model discovery/cache/reasoning/routing metadata through the existing provider-package contracts; discovery is caller-gated (no setup-time network unless the host opts in); routing metadata (e.g. OpenRouter route) is surfaced without leaking into core.
    - Functional: serializers are shared only where two providers share the exact wire shape; where wire semantics differ (cache markers, reasoning envelopes, usage fields), each provider keeps its own serializer to avoid silent field loss.
    - Functional: all listed providers pass the shared offline `testing/provider-conformance` suite; Anthropic/Google native packages from 0.0.11 remain under the same offline conformance and restricted live canaries (no re-open of their primary adapters).
    - Performance: provider streams stay within run limits; discovery is bounded (page/byte/time) and abortable; cache/reasoning metadata adds no unbounded buffering.
    - Code Quality: shared serializer extraction is justified by an exact wire-shape match recorded in Task 0 evidence; no speculative shared-transport abstraction; provider-owned compat keys stripped before normalization.
    - Security: credentials remain host-owned and late-bound; error bodies read through bounded `readBoundedResponseText`; routing/discovery metadata never includes credentials or local paths.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-conformance.md`, `docs/provider-caching.md`, `docs/provider-packages.md`; existing `packages/provider-{kimi,zai,openrouter,opencode-go,alibaba,ollama,neuralwatt}/src`.
      - Plan 077 Tasks 8–11 (Alibaba/Ollama pattern), Plan 071 (OpenCode Go/Kimi alignment), and current OpenRouter router-metadata/routing documentation (Context7 `/websites/openrouter_ai`).
    - Options Considered:
      - Force one shared serializer across all OpenAI-compatible providers: drops cache/reasoning markers for providers that need them; rejected.
      - Per-provider serializers with shared only on proven exact match: chosen.
      - Hard-coded model catalogs: rejected (dynamic discovery per Plan 077 pattern).
    - Chosen Approach:
      - For each provider, audit wire semantics (cache markers, reasoning envelope, usage fields, routing fields); share a serializer only when Task 0 evidence records an exact match.
      - Surface discovery/cache/reasoning/routing metadata through the existing `ModelConfig`/`Usage`/provider-event contracts; add no new core field for provider-specific routing.
    - API Notes and Examples:
      ```ts
      const kimi = createKimiCodingProvider({ apiKey });
      // request.model selects a model; usage/reasoning map only where Kimi exposes them.
      ```
    - Files to Create/Edit:
      - `packages/provider-{kimi,zai,openrouter,opencode-go,alibaba,ollama,neuralwatt}/src/{models,provider,index}.ts`, shared-serializer extraction (only where justified), tests, READMEs, changelogs.
      - `docs/providers/{kimi,zai,openrouter,opencode-go,alibaba,ollama,neuralwatt}.md` metadata sections.
    - References:
      - Existing provider serializers; provider-conformance helpers; Plan 071, Plan 077 Tasks 8–11.
  - Test Cases to Write:
    - Per-provider text/tool/reasoning/cache/media/structured-output/usage/error/abort/discovery/credential conformance plus restricted live smoke (env-gated).
    - Shared-serializer parity test (where extracted): both providers produce byte-identical requests for the shared field set.
    - Routing-metadata surfacing (OpenRouter) without core leak; discovery abort + byte cap.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider metadata surfaces expand.
    - Docs pages to create/edit:
      - `docs/providers/{kimi,zai,openrouter,opencode-go,alibaba,ollama,neuralwatt}.md`, `docs/provider-caching.md` matrix, `docs/provider-conformance.md`, `docs/migration.md`.
    - `docs/index.md` update: yes if any provider nav entry changes; otherwise no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Audit result: all seven packages already expose caller-gated `list*Models()` APIs with abortable fetch, bounded/redacted errors, and setup zero-fetch tests. Model metadata stays package-owned: Kimi/Moonshot, Z.AI, Alibaba, Ollama, and NeuralWatt attach upstream identity/capability metadata under their provider `compat` keys; OpenCode Go records `compat.route`; OpenRouter keeps request routing in `compat.openRouterRouting` and maps discovered pricing/cache/reasoning metadata into `ModelConfig` without a core routing field.
    - Wire decision: retained provider-local serializers. Kimi/OpenCode Go have dual Anthropic/OpenAI routes; Kimi/Alibaba differ in cache/reasoning envelopes; Z.AI, OpenRouter, Ollama, and NeuralWatt have distinct reasoning/cache semantics. The sole exact shared wire shape remains existing `serializeOpenAITool`; no speculative serializer or transport extraction was added.
    - Existing package docs already cover each public metadata surface, provider caching matrix, caller-gated discovery, compat stripping, credential ownership, and env-gated canaries. No public API or docs-index change was needed from this verification-only task.
    - Checks passed: `npm run -s build`; provider workspace suites for Kimi, Z.AI, OpenRouter, OpenCode Go, Alibaba, Ollama, NeuralWatt, Anthropic, and Google (232 pass; 27 credential-gated live skips); `git diff --check`.

- [x] 4. RAG atomic source replacement, deletion, loader/parser seams, and reference adapters
  - Acceptance Criteria:
    - Functional: RAG supports atomic source replacement (replace all chunks for a `sourceId` under a scope, or fail and leave the prior index intact) and source deletion scoped to ownership/corpus; replacement cannot cross `RagScope` (tenant/resource/corpus) boundaries.
    - Functional: a `DocumentLoader`/`Parser` seam loads and parses documents into bounded text for chunking; focused reference adapters ship for text, Markdown, HTML, and PDF; each adapter is optional and bounded (byte/page/time/abort).
    - Functional: authorized host artifacts enter through `ResourceLoader`/`DocumentLoader`, never implicit local-file discovery; public web ingestion reuses `@arnilo/prism-web-tools` `web_fetch`/`web_extract` normalized results/citations rather than a second crawler.
    - Performance: parse, chunk, embed, and index have frozen byte/token/time/concurrency caps; atomic replacement uses a bounded transactional window; index rebuild is a bounded batch stream.
    - Code Quality: `replaceSource`/delete compose over existing `Embedder`/`VectorStore`/`indexChunks`/chunker; parsers are thin adapters, not a document framework; the loader seam reuses `ResourceLoader` where the source is an authorized host artifact.
    - Security: remote documents use SSRF/content bounds (private/local/file origins rejected); parsed content is untrusted inert context; source replacement/deletion verifies scope ownership; parser bombs/oversize/abort fail closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md`, `docs/resource-loading.md`, `docs/host-security.md`; existing `packages/rag/src/{indexing,retrieve,chunk,context,types,limits}.ts`, `packages/memory` `Embedder`/`VectorStore`.
      - Plan 061 (small optional RAG package); existing web-tools `normalize`/`citation` helpers.
    - Options Considered:
      - Add a full document framework with every format: maintenance burden; rejected.
      - Reimplement web fetch inside RAG: duplicates web-tools SSRF/citation/trust; rejected.
      - Bounded `DocumentLoader`/`Parser` seam + four reference adapters + web ingestion via web-tools: chosen.
    - Chosen Approach:
      - Add `DocumentLoader`/`Parser`/`Chunker` contract types and `replaceSource`/`deleteSource` over existing `indexChunks`/`VectorStore`; ship text/Markdown/HTML/PDF reference parsers as optional subpaths.
      - Web ingestion: a `WebFetchDocumentLoader` wraps `web_fetch`/`web_extract` normalized results and citations; no new crawler.
    - API Notes and Examples:
      ```ts
      await replaceSource({ sourceId, loader: textLoader, chunker, embedder, store, scope });
      await deleteSource({ sourceId, store, scope });
      const webLoader = createWebFetchDocumentLoader({ fetcher, scope });
      ```
    - Files to Create/Edit:
      - `packages/rag/src/{loaders,parsers,sources,indexing,index,types,limits}.ts`, tests, README, changelog.
      - `packages/memory/src/vector-memory.ts`: reference source-aware transactional store capability reused by RAG replacement.
      - `packages/rag/package.json`: `./loaders` and `./parsers` public subpaths; docs and migration coverage.
    - References:
      - Existing `indexChunks`/`retrieveContext`/`VectorStore`; web-tools `normalize`/`citation`; `ResourceLoader`.
  - Test Cases to Write:
    - Atomic replace success/failure-retry (prior index intact), cross-scope replace rejected, delete scoped + cross-scope rejected.
    - Parser bombs/oversize/abort/Unicode; HTML script/style strip; PDF page/byte cap; loader SSRF (private/local/file origin rejected).
    - Web-fetch loader reuses web-tools citations/trust metadata; no second crawler code path.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new RAG lifecycle + loader/parser surface.
    - Docs pages to create/edit:
      - `docs/rag.md` (lifecycle + loaders/parsers), `docs/resource-loading.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Input/context/RAG entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Lifecycle: `replaceSource()` first bounds/embeds every replacement batch, then performs exact-source delete plus upsert in the required store transaction. It fails closed unless the store supplies `getBySource()` and `transaction()`; `deleteSource()` rechecks tenant/resource/corpus and `_rag.sourceId` on every returned record. The in-memory reference `createMemoryVectorStore()` now provides copy-on-write transactions and scoped source lookup. A failed embedding leaves the old source intact; identical IDs in another corpus remain untouched.
    - Documents: `DocumentLoader` / `Parser` / `Chunker` / `replaceDocument()` are package-local contracts. `createResourceDocumentLoader()` delegates exactly once to a host `ResourceLoader`; `createWebFetchDocumentLoader()` delegates only to a supplied normalized web-tools fetch adapter, rejects file/local/private/IP-literal input, and propagates citation + `untrusted: true` metadata. No crawler, filesystem discovery, or package dependency was added.
    - Parsers: root plus `@arnilo/prism-rag/{loaders,parsers}` expose strict UTF-8 text/Markdown, script/style-stripping HTML, and bounded uncompressed-text PDF parsing. All enforce 8 MiB document bytes, 30 s wall check, abort, and the 256-page PDF ceiling; compressed/scanned PDFs fail closed for a host parser rather than indexing partial content.
    - Docs: updated `docs/rag.md`, `docs/resource-loading.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`, package README, and changelog. Added a docs regression asserting lifecycle, ownership, parser, loader, trust, and migration coverage.
    - Checks passed: `npm run -s build`; `npm test --workspace @arnilo/prism-rag` (12 pass); `npm test --workspace @arnilo/prism-memory` (13 pass); `node --test dist/__tests__/docs.test.js dist/__tests__/public-export-contract.test.js` (250 pass); `git diff --check`.

- [x] 5. RAG reranking, citation provenance, ingestion status, and content-trust metadata
  - Acceptance Criteria:
    - Functional: a `Reranker` seam reorders retrieved hits with bounded query/hit/byte/time/concurrency; reranker timeout/abort fail closed; the original retrieval order remains recoverable for diagnostics.
    - Functional: every retrieved hit carries citation provenance (sourceId, chunkId, citationId, provider, retrieval/retrievalTime) and content-trust metadata (untrusted/inert, injection-capable); assembled context marks retrieved content as untrusted inert context for the model and downstream guardrails.
    - Functional: ingestion exposes status (pending/indexed/failed/partial) per source, with byte/chunk/error counts, so hosts can observe and retry without rescanning the whole corpus.
    - Performance: reranking and status queries are finite; reranker concurrency capped; status reads are O(scope) with frozen page caps.
    - Code Quality: reranker is a seam over `RagHit[]`, not a retrieval reimplementation; provenance/trust metadata extend `RagHit`/`RagContextResult` without a parallel event system.
    - Security: retrieved content is never executed or granted tool authority; injection-capable metadata is present on every assembled block; reranker input/output is redacted with the active redactor.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md`, `docs/host-security.md`; existing `packages/rag/src/{retrieve,context,types}.ts`, `RagHit`/`RagCitation`/`RagContextResult`.
    - Options Considered:
      - Bake a reranker into retrieval: removes the seam and forces one strategy; rejected.
      - Separate trust/provenance event stream: duplicates context assembly; rejected.
      - `Reranker` seam + provenance/trust fields on existing hit/context types + ingestion status per source: chosen.
    - Chosen Approach:
      - Add `Reranker` contract + `retrieveContext({ reranker, topK, scope })`; carry provenance + content-trust metadata on `RagHit`/`RagContextResult`; mark assembled blocks untrusted/inert.
      - Add optional scoped `IngestionStatusStore` records per source (pending/indexed/failed/partial, completed byte/chunk/error counts). A separate status seam is required because failed ingestion has no vector metadata to query; the process-local reference adapter is intentionally non-durable.
    - API Notes and Examples:
      ```ts
      const context = await retrieveContext(query, { reranker, embedder, store, topK: 5, scope });
      // context.hits[i].provenance + context.hits[i].trust.untrusted === true
      ```
    - Files to Create/Edit:
      - `packages/rag/src/{rerank,retrieve,context,indexing,sources,types,limits,ingestion-status,index}.ts`, tests, README, changelog.
      - `docs/{rag,host-security,migration,index}.md`, `src/__tests__/docs.test.ts`: public API, boundary, migration, navigation, and documentation regression.
    - References:
      - Existing `retrieveContext`/`RagHit`/`RagCitation`; redactor; context assembly trust model.
  - Test Cases to Write:
    - Reranker reorder + timeout/abort fail-closed; original order recoverable; concurrency cap.
    - Provenance present on every hit; assembled context marked untrusted/inert; redaction of reranker I/O.
    - Ingestion status pending/indexed/failed/partial with byte/chunk/error counts; retry without full rescan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; reranker/provenance/trust/ingestion-status surface.
    - Docs pages to create/edit:
      - `docs/rag.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Input/context/RAG entry (reranking, trust).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Reranking: added host-owned `Reranker` seam over redacted `RagHit[]`. Candidate input has hard 256 KiB / 10 s / 8-active-call caps (64 KiB / 2 s / 2 defaults); timeout, external abort, oversized input, concurrent saturation, unknown/duplicate/missing IDs, and upstream failures fail closed. Prism validates exact ID permutation then restores canonical hit objects, so rerankers cannot forge text, provenance, trust, or retrieval rank. An ignored abort continues occupying its per-reranker slot until it settles.
    - Provenance/trust: every retrieved hit and citation now carries source/chunk/citation identity, provider (`web.provider` or `host`), vector retrieval timestamp/method, and immutable `{ untrusted: true, inert: true, injectionCapable: true }`. `retrievalRank` preserves original vector ordering. RAG context blocks repeat trust fields alongside citations; retrieved content remains inert and has no tool authority.
    - Status: `statusStore` is optional on indexing/replacement/deletion. It records scoped per-source pending/indexed/failed/partial progress with completed redacted bytes/chunks and redacted error text. `listIngestionStatus()` enforces 50/200-page bounds and rechecks every returned scope; `createMemoryIngestionStatusStore()` uses scope-partitioned maps for O(scope) pages. Durable hosts implement the small store contract; failed source IDs permit targeted retry without corpus rescan.
    - Docs: updated `docs/rag.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`, package README/changelog, plus docs regression coverage.
    - Checks passed: `npm run -s build`; `npm test --workspace @arnilo/prism-rag` (14 pass); `node --test dist/__tests__/docs.test.js dist/__tests__/public-export-contract.test.js` (251 pass); `git diff --check`.

- [x] 6. Memory retention/deletion/export, source/consent metadata, index rebuild, and production adapter conformance
  - Acceptance Criteria:
    - Functional: memory entries carry source/consent metadata with per-user/profile/thread controls (reusing the 0.0.14 consent shapes where they exist); users can apply retention, delete (real, not tombstone-only where retention policy allows), and export (bounded, identity-checked, redacted); injection honors consent/visibility at assembly time.
    - Functional: index rebuild re-embeds/re-indexes a corpus under frozen byte/time/concurrency caps without a full-corpus scan per run; rebuild is abortable and resumable.
    - Functional: finite-vector validation rejects non-finite/NaN/oversized vectors (existing `assertFiniteVector`) at every store boundary; the shipped PostgreSQL/pgvector production adapter passes shared conformance. SQLite remains session/run persistence rather than a semantic-vector adapter; additional vector stores remain demand-gated (no new vector-store package this phase).
    - Performance: retention sweeps are bounded batches; export has frozen page/byte/time caps; rebuild is a bounded stream; no unbounded scan per run/reconnect.
    - Code Quality: retention/delete/export/rebuild extend `@arnilo/prism-memory` stores and `runMemoryConformance`; no second memory runtime; conformance covers the in-memory reference and PostgreSQL/pgvector.
    - Security: revoked/invisible/non-consented memories never enter prompts, events, exports, or telemetry; deletion is real where retention policy allows; export payloads are redacted; cross-tenant/corpus isolation enforced at every store boundary.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md`, `docs/host-security.md`; existing `packages/memory/src/{memory,vector-memory,working-memory,conformance,postgres}.ts`, 0.0.14 memory consent shapes (Plan 077 Task 2). SQLite is a session/run adapter, not semantic storage.
    - Options Considered:
      - Add a new vector-store package: demand-gated; rejected this phase.
      - Separate retention/rebuild runtime: duplicates memory stores; rejected.
      - Extend existing memory stores + conformance suite with retention/delete/export/rebuild + finite-vector validation at boundaries: chosen.
    - Chosen Approach:
      - Add retention/delete/export/rebuild over existing `MemoryStore`/`VectorStore`; reuse 0.0.14 consent metadata; enforce `assertFiniteVector` at every store boundary.
      - Extend `runMemoryConformance` to cover retention/delete/export/rebuild + cross-tenant/thread isolation; run it for the in-memory reference and PostgreSQL/pgvector adapter. Do not invent a semantic SQLite adapter.
    - API Notes and Examples:
      ```ts
      await memory.applyRetention({ maxEntries: 500 });
      await memory.exportMemory({ identity: { tenantId, resourceId, threadId } }); // bounded + redacted
      await memory.rebuildIndex({ cursor, signal });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/{memory,vector-memory,pagination,conformance,limits,types,index,postgres}.ts`, tests, README, changelog.
      - `docs/{working-and-semantic-memory,host-security,migration,index,review-coverage-2026-07-26-phase-10}.md`, `src/__tests__/docs.test.ts`: lifecycle API, production boundary, migration, navigation, evidence, and docs regression.
    - References:
      - Existing `runMemoryConformance`/`MemoryStore`/`VectorStore`/`assertFiniteVector`; Plan 077 Task 2 consent shapes.
  - Test Cases to Write:
    - Retention sweep bounded + real delete where policy allows; export redacted + cross-tenant rejected; rebuild abort/resume + bounded stream.
    - Finite-vector rejection at every store boundary (NaN/Infinity/oversized); in-memory + PostgreSQL/pgvector parity via `runMemoryConformance` (credential-gated for PostgreSQL).
    - Cross-tenant/corpus isolation; revoked/invisible/non-consented memory never injected/exported/telemetered.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; memory lifecycle/consent/rebuild/conformance surface.
    - Docs pages to create/edit:
      - `docs/working-and-semantic-memory.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; update Memory entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Existing 0.0.14 consent/source/visibility, correct/forget, and real deletion were retained. `applyRetention()` now requires bounded `listByThread()` + `countByThread()` storage, uses oldest-first pages plus a scoped count, and removes at most the existing 500/5000 batch. It fails closed rather than loading a whole thread through a generic store.
    - Export: `memory.exportMemory({ identity, cursor?, limit?, maxBytes?, maxMs?, signal? })` requires exact tenant/resource/thread identity matching the facade. It returns only explicitly consented visible records, redacts every returned record, validates stored finite dimensions before response, and caps defaults/hard limits at 100/200 entries, 4/32 MiB, and 10/60 seconds. Missing paging support, scope mismatch, abort, overflow, or timeout rejects.
    - Rebuild: `memory.rebuildIndex({ cursor?, batchSize?, maxMs?, signal? })` reads one stable sequence page, validates stored vectors, re-embeds and upserts the same records, and returns `nextCursor` for host-owned resume. It is 32/128 records and 10/60 seconds by default/hard cap; no background worker or corpus scan was added.
    - Store/conformance: added optional `VectorStore.listByThread()` / `countByThread()` contracts, stable opaque cursors, in-memory reference implementation, and indexed PostgreSQL/pgvector implementation. `runMemoryConformance` now exercises identity-bound export and paged rebuild alongside consent/retention/isolation. SQLite remains session/run persistence, not an invented semantic-vector adapter; this preserves Task 0's no-new-vector-store decision.
    - Docs: updated working-memory API/security/migration/index pages, package README/changelog, Task 0 evidence, and docs regression coverage.
    - Checks passed: `npm run -s build`; `npm test --workspace @arnilo/prism-memory` (14 pass); `npm run test:postgres --workspace @arnilo/prism-memory` (14 pass, PostgreSQL integration credential-gated skip because `PRISM_TEST_POSTGRES_URL` is unset); `node --test dist/__tests__/docs.test.js dist/__tests__/public-export-contract.test.js` (252 pass); package-root import; `git diff --check`.

- [x] 7. Provider/memory/RAG benchmarks and credentialed live-canary matrix
  - Acceptance Criteria:
    - Functional: `scripts/benchmark-0.0.15.mjs` reports network-free scenarios for provider streams (incl. hosted-tool/continuation/realtime envelopes), AI SDK mapping, remaining-provider metadata, RAG parse/chunk/embed/rerank/retrieve/replace/rebuild, and memory retention/export/rebuild against frozen Phase 10 budgets; every `resourceLimitSignals` is 0 (no consent leak, no unredacted event, credentials always resolve late).
    - Functional: a credentialed live-canary matrix records which providers/features require live keys (OpenAI hosted tools/realtime, AI SDK, Kimi/ZAI/OpenRouter/OpenCode Go/Alibaba/Ollama/NeuralWatt, Anthropic/Google restricted canaries, PostgreSQL/pgvector memory); default `npm test` stays network-free; canaries run only in protected scheduled/release environments.
    - Performance: benchmarks publish throughput, p95 latency, memory/disk, and backpressure for each scenario within frozen budgets; package/install deltas recorded.
    - Code Quality: benchmark scenarios reuse existing fake/embedder/hash/transport fakes; no new benchmark framework; one parameterized runner if the per-release script count keeps growing (else YAGNI).
    - Security: benchmark fixtures contain no real credentials or local paths; live canaries use least-privilege keys; telemetry/benchmark output is metadata-safe.
  - Approach:
    - Documentation Reviewed:
      - `docs/performance.md`, `docs/release-and-install.md`; prior `scripts/benchmark-0.0.{9..14}.mjs` patterns; provider-conformance live-test gates.
    - Options Considered:
      - Skip network-free benchmarks: loses release-gate evidence; rejected.
      - One benchmark per feature: script sprawl; consolidate where possible.
      - Network-free benchmark suite + documented credentialed live-canary matrix: chosen.
    - Chosen Approach:
      - Add `scripts/benchmark-0.0.15.mjs` (+ schema test) covering all Phase 10 scenarios against frozen budgets; record the live-canary matrix in `docs/release-and-install.md`.
    - API Notes and Examples:
      ```bash
      node scripts/benchmark-0.0.15.mjs
      PRISM_LIVE_PROVIDER_TESTS=1 PRISM_OPENAI_API_KEY=... npm test -- --filter provider-openai/live
      ```
    - Files to Create/Edit:
      - `scripts/benchmark-0.0.15.mjs`, `scripts/benchmark-0.0.15.test.mjs`, `docs/performance.md`, `docs/release-and-install.md`, `docs/index.md`, `src/__tests__/docs.test.ts`.
    - References:
      - Prior per-release benchmark scripts; provider-conformance live-test gate convention.
  - Test Cases to Write:
    - Benchmark schema + budget assertions (network-free); `resourceLimitSignals` all 0.
    - Live-canary matrix completeness: each advertised live feature has a documented env-gated canary.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; benchmark + release-canary matrix.
    - Docs pages to create/edit:
      - `docs/performance.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes; Performance/Release entries to 0.0.15.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Added `scripts/benchmark-0.0.15.mjs` and schema test. Its six no-I/O scenarios use existing fake Responses SSE/WebSocket, fake AI SDK v4 model, provider-package setup, hash embedder, in-memory vector store, and existing RAG/memory APIs: `openai-hosted-continuation`, `openai-realtime-envelope`, `ai-sdk-v4-stream-mapping`, `provider-package-metadata`, `rag-parse-replace-rerank-retrieve`, and `memory-retention-export-rebuild`.
    - The benchmark freezes existing continuation, Realtime, RAG, and memory caps; emits throughput/p50/p95/heap/disk/backpressure/safety fields; fails the schema test if any `resourceLimitSignals` or backpressure signal is nonzero. It asserts provider credentials resolve only during generated requests, never package registration; no package/runtime dependency was added and the 43-manifest graph is unchanged.
    - `docs/performance.md` records a 100-iteration Node v24.18.0/Linux x64 baseline. `docs/release-and-install.md` now has a protected live-canary matrix for OpenAI hosted/Realtimes, host-owned AI SDK integration, Kimi/Z.AI/OpenRouter/OpenCode Go/Alibaba/Ollama/NeuralWatt, Anthropic/Google, and PostgreSQL/pgvector; it explicitly distinguishes checked-in gates from host-owned account/region/daemon probes and keeps all live work outside `npm test`/`sdk:ready`.
    - Checks passed: `npm run -s build`; `node scripts/benchmark-0.0.15.mjs` (100 iterations, all six rows `resourceLimitSignals=0` and backpressure=0); `node --test scripts/benchmark-0.0.15.test.mjs` (2 pass); `node --test dist/__tests__/docs.test.js` (103 pass); `git diff --check`.

- [x] 8. Docs: provider compatibility matrix, conformance, multimodal, RAG, memory, resource-loading, host-security, migration, index
  - Acceptance Criteria:
    - Functional: `docs/provider-conformance.md` documents the shared offline conformance suite + restricted live canaries for every first-party provider (incl. OpenAI hosted tools/realtime, AI SDK matrix, remaining providers, Anthropic/Google); `docs/provider-packages.md`/`docs/provider-caching.md` carry the full compatibility matrix; `docs/multimodal-content.md` covers provider content-type mapping; `docs/rag.md` covers lifecycle/loaders/parsers/reranking/provenance/trust/ingestion status; `docs/working-and-semantic-memory.md` covers retention/delete/export/rebuild/consent/finite-vector/conformance; `docs/resource-loading.md` covers the `DocumentLoader` seam + web-tools ingestion; `docs/host-security.md` covers content-trust/SSRF/scope isolation; `docs/migration.md` has a 0.0.15 section; `docs/index.md` navigation updated.
    - Performance: no runtime change (docs/metadata only).
    - Code Quality: every new public surface has exactly one navigation link in `docs/index.md`; provider docs follow the 9-heading wiki API-page structure; counts/phrases reconciled with `docs.test.ts` guards.
    - Security: docs secret-scan stays clean; no literal secrets or local paths in examples.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md`, `docs/provider-conformance.md`, `docs/provider-packages.md`, `docs/provider-caching.md`, `docs/multimodal-content.md`, `docs/rag.md`, `docs/working-and-semantic-memory.md`, `docs/resource-loading.md`, `docs/host-security.md`, `docs/migration.md`; `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Scatter docs across tasks: risks stale/inconsistent matrix; consolidated docs task chosen.
    - Chosen Approach:
      - One docs task reconciles provider compatibility matrix, conformance, multimodal, RAG, memory, resource-loading, host-security, migration, and `docs/index.md` navigation after Tasks 1–7 land.
    - Files to Create/Edit:
      - `docs/provider-conformance.md`, `docs/provider-packages.md`, `docs/provider-caching.md`, `docs/multimodal-content.md`, `docs/rag.md`, `docs/working-and-semantic-memory.md`, `docs/resource-loading.md`, `docs/host-security.md`, `docs/migration.md`, `docs/index.md`, package READMEs/changelogs, `src/__tests__/docs.test.ts`.
    - References:
      - Wiki structure reference; existing provider/rag/memory docs.
  - Test Cases to Write:
    - Docs guards: every new provider/RAG/memory surface indexed; matrix completeness; exactly one nav link per page; secret-scan clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; docs navigation + compatibility matrix.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes; update Provider/model connection, Input/context/RAG, Memory, and Security entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Reconciled the canonical provider matrix across `provider-packages`, `provider-caching`, `provider-conformance`, and multimodal docs. All fourteen first-party packages now state protocol/model source, declared content boundary, tool/reasoning behavior, cache policy, and network-free versus protected-canary evidence. The matrix corrects the former misleading universal `live.test.ts` statement: account/region/daemon/workload-identity checks stay host-owned, protected probes; default tests remain no-I/O.
    - Expanded the content mapping table for OpenAI Responses, AI SDK v4, Anthropic, Google, Kimi, Z.AI, OpenRouter, OpenCode Go, Alibaba, Ollama, NeuralWatt, and enterprise OpenAI-compatible endpoints. It keeps `ModelConfig.capabilities.input` authoritative and documents AI SDK role/media limits and typed unsupported output parts.
    - Revalidated existing RAG lifecycle/loader/parser/reranker/provenance/trust/status, memory consent/retention/export/rebuild/finite-vector/conformance, resource loader/web-tools, and host-security ownership/SSRF/content-trust pages; added explicit `MemoryConsent` field coverage. Migration now corrects the stale AI SDK `^4` install advice to exact `@ai-sdk/provider@4.0.3`; index summaries point to all Phase 10 documentation.
    - Added one Phase 10 documentation regression checking all 14 providers in both compatibility/conformance matrices; full cache matrix entries; multimodal mappings; RAG/memory/resource/security trust boundaries; migration; and index summaries. Package READMEs/changelogs from Tasks 1, 2, 4, 5, and 6 already cover their changed public packages and required no duplicate prose.
    - Checks passed: `npm run -s build`; `node --test dist/__tests__/docs.test.js` (104 pass, including secret-scan and navigation checks); `git diff --check`.

- [x] 9. Version graph to 0.0.15, release validation, and publish dry-run
  - Acceptance Criteria:
    - Functional: all publishable manifests, internal `@arnilo/*` ranges, lockfile, profile/package/install/export guards, and changelogs target `0.0.15` (including any packages authorized in Task 0); new surfaces enrolled per the Task 0 freeze; roadmap Phase 10 marked complete only after gates pass.
    - Functional: `npm run sdk:ready` passes; packed offline consumer tests pass; restricted live canaries (OpenAI hosted tools/realtime, AI SDK, remaining providers, Anthropic/Google, PostgreSQL/pgvector memory, keychain) remain operator-gated.
    - Performance: `scripts/benchmark-0.0.15.mjs` passes its schema + budget assertions (network-free); package/install deltas recorded.
    - Code Quality: publishable package count matches the Task 0 freeze matrix; no Studio/remote-browser-vendor/Office/additional-vector-store scope enters the graph.
    - Security: `npm audit`, SBOM/license, tracked/tarball secret scans, dependency review, exact dependency graph, tarball review, `git diff --check`, RAG/memory hostile-input fixtures, and permission-non-broadening regression pass.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, roadmap gates 9/11 + Release Validation Checklist, Plan 077 Task 12 command matrix, Task 0 freeze count.
    - Options Considered:
      - Auto-tag/publish: requires operator OIDC; rejected.
      - Exact graph bump + network-free matrix + dry-run publish only: chosen.
    - Chosen Approach:
      - Bump 0.0.15 graph; run sdk:ready, Node 20 compat, packs, benchmark, supply-chain, release check/publish dry-run; record evidence in this plan and `roadmap.md`; stop before commit/tag/publication unless separately authorized.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node scripts/benchmark-0.0.15.mjs
      npm audit --audit-level=high
      git diff --check
      npm run release:check -- --version 0.0.15 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.15 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - Root and all 42 workspace `package.json` versions/ranges; `package-lock.json`; profile manifests; root and workspace `CHANGELOG.md` files.
      - `src/index.ts`, package/index/package/install/release graph guards, `README.md`, `docs/release-and-install.md`, `docs/index.md`, and `roadmap.md` Phase 10 completion evidence.
      - This plan Task 9 evidence; Task 7's finalized `scripts/benchmark-0.0.15.mjs` and schema test are release-gated without duplicate changes.
    - References:
      - Prior 0.0.14 release validation pattern (Plan 077 Task 12).
  - Test Cases to Write:
    - Exact package count/export/install guards for 0.0.15 graph.
    - Benchmark schema + budget assertions (network-free).
    - Secret scan clean on packed tarballs; RAG/memory fakes have no real credentials or local paths.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release graph and install docs.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`, `docs/performance.md`, `docs/migration.md`, `roadmap.md`.
    - `docs/index.md` update: yes; Release entry to 0.0.15 / Phase 10 evidence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Versioned root + 42 workspaces, all exact internal dependency/optional/peer ranges, lockfile workspace records, root runtime version, profile manifests, and all 43 changelogs to `0.0.15`. The frozen graph remains 43 publishable manifests; no package or runtime dependency was added. Release/package/install/phase-boundary assertions now pin the 0.0.15 peer and tarball graph; a release regression validates all 43 manifests and changelog headers with `validateRelease()`.
    - Updated root README and release/install/index docs with Phase 10 scope, exact peers/tarball names, current release commands, and a 0.0.15 handoff. npm CLI behavior was confirmed through Context7 `/npm/cli`: `npm pack --dry-run` enumerates pack contents and `npm publish --dry-run` performs package/registry validation without publication.
    - Release gates passed: `npm run sdk:ready` (typecheck, full network-free suite, 43 package dry-run packs, fresh packed consumer/import checks); Node 20.20.2 import of all 21 root public export targets; `node scripts/benchmark-0.0.15.mjs` and schema test (six 100-iteration scenarios; every resource-limit/backpressure signal zero); `npm audit --audit-level=high` (no high/critical; two pre-existing moderate MCP-transitive advisories); SPDX/license verify (202 packages, 8 licenses); tracked-plus-untracked secret scan (1,153 files, zero findings); `git diff --check`; docs/export/release graph checks.
    - Release preflight `/tmp/prism-0.0.15-preflight.json` confirmed all 43 registry versions available. Dependency-ordered `npm run release:publish -- --version 0.0.15 --dry-run --allow-dirty --allow-untagged` completed 43/43 dry runs with public/latest/provenance arguments and no publication. npm warned authentication is absent only because this was a dry-run; the command completed. Protected provider, hosted-tool/Realtime, host-AI-SDK, PostgreSQL/pgvector, and keychain probes remain intentionally operator-gated; tag, OIDC attestation, and real publication were not attempted.

## Compromises Made
- No release package was added: source/document/vector-store/Realtime work extends existing owners under the 43-manifest freeze.
- Local release evidence excludes protected credentialed/live and signing/OIDC gates; CI/release operators own those credentials and attestations.

## Further Actions
- **P0 release operator:** merge cleanly, run protected live-canary and PostgreSQL/keychain gates, sign/push `v0.0.15`, then let the tag workflow attest and publish.
- **P1 maintenance:** resolve the two moderate `@modelcontextprotocol/sdk` transitive audit advisories in the next isolated dependency update; do not force its breaking remediation into this release.