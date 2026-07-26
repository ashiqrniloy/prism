# Phase 10 Review Coverage — 0.0.15 Provider, Memory, and RAG Ecosystem Parity

Frozen: 2026-07-26 at Prism `73aec95` (Release 0.0.14). This document is the Task 0 primitive-inventory, scope freeze, limit freeze, and threat/authority matrix for Plan 078. It constrains Tasks 1–9; later tasks may refine API shapes but may not widen permissions or package scope beyond what this matrix authorizes.

## 1. Capability traceability (every Phase 10 roadmap criterion → Task owner)

| Roadmap acceptance criterion | Existing primitive(s) | Minimum gap | Owner task | Test owner | Docs owner |
| --- | --- | --- | --- | --- | --- |
| OpenAI hosted tools / response continuation / realtime without hosted-tool semantics in core | `AIProvider.generate()` (`src/contracts.ts:297`), `ProviderEvent` union (`src/contracts.ts:288`), `ProviderRequest`, `src/providers/openai-compatible.ts`, `packages/provider-openai/src/{responses,codex}.ts` | `ProviderEvent` has no continuation/realtime variant; `ToolCallContent` has no `authority` field; no realtime/continuation/hosted-tool code anywhere | Task 1 | Task 1 | Task 1 + Task 8 |
| AI SDK tested supported-version matrix + complete content/tool/metadata mapping | `packages/provider-ai-sdk/src/{provider,stream,prompt,errors,types}.ts` | no supported-version matrix; mapping is not table-driven; unsupported fields drop silently | Task 2 | Task 2 | Task 2 + Task 8 |
| Kimi/ZAI/OpenRouter/OpenCode Go/Alibaba/Ollama/NeuralWatt attributable discovery/cache/reasoning/routing metadata; shared serializers only where wire-identical | per-provider `provider.ts`/`models.ts`; shared `serializeOpenAITool` (`src/providers/openai-primitives.ts:62`); per-provider message serializers (`serializeMoonshotMessage`, `serializeAlibabaMessage`, …) already diverge on `cache_control`/`reasoning_content` | audit each wire; surface routing metadata (OpenRouter) without core leak; confirm shared-serializer extractions on exact match only | Task 3 | Task 3 | Task 3 + Task 8 |
| Anthropic/Google native (0.0.11) remain under shared offline conformance + restricted live canaries | `packages/provider-{anthropic,google}/src`; `src/testing/provider-conformance.ts` | no re-open; re-confirm conformance + canary wiring | Task 3 (audit only) + Task 7 | Task 3/7 | Task 8 |
| RAG atomic source replacement, deletion | `indexChunks()` (`packages/rag/src/indexing.ts`) — `ponytail:` comment explicitly defers stale-source replacement to the host; `VectorStore.delete()` exists (`packages/memory/src/types.ts:91`) | add `replaceSource` (tx) + `deleteSource` scoped to `RagScope` | Task 4 | Task 4 | Task 4 + Task 8 |
| RAG document-loader/parser seams + text/Markdown/HTML/PDF reference adapters | `ResourceLoader` (`src/contracts.ts`), `loadTextResource`/`loadBinaryResource` (`src/resources.ts`); `chunkText`/`chunkMarkdown` (`packages/rag/src/chunk.ts`) | no `DocumentLoader`/`Parser` seam; no format adapters | Task 4 | Task 4 | Task 4 + Task 8 |
| Public web ingestion reuses bounded web-tools fetch/citations (no second crawler) | `web_fetch`/`web_extract` (`packages/web-tools/src/{exa,firecrawl}.ts`); `WebDocument`/`WebExtraction` with `untrusted: true` + `WebCitation.citationId` (`packages/web-tools/src/types.ts`); `canonicalUrl` SSRF guard (`packages/web-tools/src/normalize.ts:5`) | add a `WebFetchDocumentLoader` wrapper; no new crawler | Task 4 | Task 4 | Task 4 + Task 8 |
| RAG reranking | `retrieveContext()` (`packages/rag/src/retrieve.ts`), `RagHit`/`RetrieveContextOptions` (`packages/rag/src/types.ts`) | no `Reranker` seam; `RetrieveContextOptions` has no `reranker` | Task 5 | Task 5 | Task 5 + Task 8 |
| RAG citation provenance + content-trust metadata | `RagCitation`/`RagContextResult` (`packages/rag/src/types.ts:50,77`); web-tools `untrusted: true` precedent | `RagHit` has no provenance/trust fields; assembled context not marked untrusted/inert | Task 5 | Task 5 | Task 5 + Task 8 |
| RAG ingestion status | `indexChunks` returns `IndexChunksResult` only | no per-source pending/indexed/failed/partial status | Task 5 | Task 5 | Task 5 + Task 8 |
| Memory finite-vector validation | `assertFiniteVector` (`packages/memory/src/util.ts`); already enforced at embedder, in-memory store, and PostgreSQL/pgvector | add export/rebuild boundary validation; semantic SQLite adapter is not shipped | Task 6 | Task 6 | Task 6 + Task 8 |
| Memory retention/deletion/export | `applyRetention` + `forget` + `correct` + `grantConsent`/`revokeConsent` already shipped in 0.0.14 (`packages/memory/src/memory.ts:261,249,223,205`) | `exportMemory` (bounded+redacted) and `rebuildIndex` are absent; retention/forget/correct are DONE — do not rebuild | Task 6 | Task 6 | Task 6 + Task 8 |
| Memory source/consent metadata | `MemoryConsent`/`MemoryConsentInput`/`MemoryConsentScope`/`MemoryConsentSource` shipped 0.0.14 (`packages/memory/src/types.ts`, exported `index.ts:61-64`); `isInjectable` honors consent (`memory.ts:439`) | DONE in 0.0.14 — Task 6 only adds export/rebuild conformance, not new consent shapes | Task 6 | Task 6 | Task 6 + Task 8 |
| Memory index rebuild | `VectorStore.upsert`/`delete`/`getByThread` | no `rebuildIndex` (bounded, abortable, resumable) | Task 6 | Task 6 | Task 6 + Task 8 |
| Memory production adapter conformance | `runMemoryConformance` (`packages/memory/src/conformance.ts`); in-memory suite + PostgreSQL/pgvector integration call it | extend conformance to export/rebuild + cross-tenant/thread; confirm PostgreSQL/pgvector parity (semantic SQLite is demand-gated) | Task 6 + Task 7 | Task 6/7 | Task 8 |
| Additional vector stores demand-gated | none | no new vector-store package this phase | Task 0 (out of scope) | Task 0 guard | Task 8 |
| Performance: finite byte/token/time/concurrency limits + benchmarks | per-package `limits.ts`; `RagLimits` (`packages/rag/src/limits.ts`) already capped; `MemoryLimits` (`packages/memory/src/limits.ts`) | freeze Phase 10 caps for hosted-tool/realtime/continuation/parse/rerank/rebuild/export; `scripts/benchmark-0.0.15.mjs` | Task 7 | Task 7 | Task 7 + Task 8 |
| Code Quality: shared transport/serialization primitives; RAG/memory reuse existing contracts | `src/providers/openai-compatible.ts`, `openai-primitives.ts`, `Embedder`/`VectorStore`/`MemoryStore` (`packages/memory/src/types.ts`), `ResourceLoader` | share serializers only on exact wire match; parsers/rerankers are thin seams, not a framework | Task 3/4/5 | per task | Task 8 |
| Security: credentials host-owned; remote docs SSRF-bounded; retrieved content untrusted inert; source replace/delete scoped | `resolveCredentialValue`, `readBoundedResponseText`, `canonicalUrl`, `isInjectable`, `RagScope`, `MemoryScope` | enforce scope ownership on replace/delete; content-trust metadata on every assembled block | Task 1/4/5/6 | per task | Task 8 |

## 2. Package ownership and manifest count

- Baseline (0.0.14): **43 publishable manifests** = 42 workspace `packages/*/package.json` + root `@arnilo/prism`. Confirmed all 42 workspace packages `private !== true`.
- Phase 10 decision: **43 → 43**. No new package authorized. Every Phase 10 capability extends an existing package in place:
  - `@arnilo/prism-provider-openai` ← hosted tools, response continuation, realtime seam (Task 1).
  - `@arnilo/prism-provider-ai-sdk` ← supported-version matrix + typed mapping (Task 2).
  - `@arnilo/prism-provider-{kimi,zai,openrouter,opencode-go,alibaba,ollama,neuralwatt}` ← attributable metadata + justified shared serializers (Task 3).
  - `@arnilo/prism-provider-{anthropic,google}` ← conformance/canary re-confirm only (Task 3 audit + Task 7); no primary-adapter re-open.
  - `@arnilo/prism-rag` ← replaceSource/deleteSource, DocumentLoader/Parser seam + text/Markdown/HTML/PDF + web-fetch loader, Reranker, provenance/trust, ingestion status (Tasks 4–5).
  - `@arnilo/prism-memory` ← exportMemory, rebuildIndex, conformance parity (Task 6). Consent/retention/forget/correct are DONE (0.0.14) — not rebuilt.
  - `@arnilo/prism-web-tools` ← no change; RAG web ingestion consumes its normalized results/citations.
  - Core `@arnilo/prism` (`src/contracts.ts`, `src/providers/*`) ← minimum neutral continuation/realtime `ProviderEvent` variant + `ToolCallContent.authority` only (Task 1). No OpenAI-specific field enters core.
- Out of scope (recorded so the Task 0 scope guard rejects them): Studio/control plane; remote-browser vendors (Playwright reference remains 0.0.9); Office runtime; additional vector-store packages; Slack/Teams/voice/desktop vendor packages; GraphRAG/advanced semantic chunking (0.1.x demand-gated).
- New package split is authorized only if a later task records measured size/cohesion need in this doc; none is recorded at freeze.

## 3. Primitive inventory (reused, not duplicated)

Core (`src/`):
- `AIProvider.generate(request): AsyncIterable<ProviderEvent>` — the single provider stream contract.
- `ProviderRequest` / `ProviderRequestOptions` (cache, headers, structuredOutput, compat, extra, signal) — neutral knobs.
- `ProviderEvent` union: `message_start | content_delta | tool_call_delta | tool_call | usage | done | error`. **Gap:** no continuation cursor, no realtime audio/session event, no hosted-tool authority.
- `ToolCallContent` (`src/contracts.ts:65`). **Gap:** no `authority: "host" | "provider-hosted"` discriminator.
- `ResourceLoader` + `loadTextResource`/`loadBinaryResource`/`loadManifestResource` (`src/resources.ts`) — authorized host artifact loader; RAG `DocumentLoader` composes over this.
- `src/providers/openai-compatible.ts` (shared OpenAI-compatible transport), `openai-primitives.ts` (`serializeOpenAITool`, `serializeOpenAIChatMessage`, structured-output serializers) — provider serializer sharing candidates.
- `src/provider-request-policy.ts`, `src/provider-events.ts`, `src/redaction.ts`, `src/run-limits.ts` — reused for hosted-tool/continuation/realtime limits, redaction, and shared `RunLimits`.
- `src/testing/provider-conformance.ts` — shared offline conformance (`assertProviderStreamConforms`, `assertAbortIsObserved`, `assertNoSecretLeak`, `assertProviderOwnedHeadersWin`, …); reused by Tasks 1–3.

Memory (`packages/memory/src/`):
- `Embedder` (`types.ts:48`), `VectorStore` (`types.ts:85`: upsert/query/delete/getByThread?), `MemoryVectorRecord`/`MemoryVectorHit`.
- `createMemory()` (`memory.ts:46`) → `remember`/`recall`/`forget`/`correct`/`grantConsent`/`revokeConsent`/`applyRetention`/`createContextProvider` — **0.0.14 shipped consent + retention + forget + correct**.
- `MemoryConsent`/`MemoryConsentInput`/`MemoryConsentScope`/`MemoryConsentSource` (`types.ts`, exported `index.ts:61-64`); `isInjectable` (`memory.ts:439`) honors consent/visibility.
- `assertFiniteVector` (`util.ts`) — enforced at embedder, memory-vector, and PostgreSQL/pgvector. **Gap:** add export/rebuild path validation; no semantic SQLite adapter exists.
- `runMemoryConformance` (`conformance.ts`) — offline conformance; called by `memory.test.ts` + PostgreSQL/pgvector integration. **Gap:** extend to export/rebuild + cross-thread/tenant.

RAG (`packages/rag/src/`):
- `indexChunks` (`indexing.ts`) — embeds + upserts; `ponytail:` comment explicitly defers stale-source replacement to host. **Gap:** `replaceSource` (transactional) + `deleteSource` (scoped).
- `retrieveContext` (`retrieve.ts`), `createRagContextProvider` (`context.ts`).
- `RagScope` (tenantId/resourceId/corpusId), `RagChunk`/`RagHit`/`RagCitation`/`RagContextResult` (`types.ts`). **Gap:** `RagHit` provenance/trust; `RetrieveContextOptions.reranker`; ingestion status.
- `chunkText`/`chunkMarkdown` (`chunk.ts`); `RagLimits` (`limits.ts`) — already hard-capped (chunkSize 16 384, maxChunks 8 192, topK 32, queryCandidates 128, resultBytes 512 KiB, contextTokens 8 000, metadataBytes 64 KiB, vectorDim 4 096).

Web-tools (`packages/web-tools/src/`):
- `WebDocument`/`WebExtraction` carry `untrusted: true` + `WebCitation.citationId` (`types.ts:9,10`); `canonicalUrl` SSRF guard rejects non-http(s)/userinfo URLs (`normalize.ts:5`); `citation()` builds `web:<provider>:<sourceId|hash>` IDs (`normalize.ts:6`). RAG web ingestion wraps these — no new crawler.

## 4. Frozen finite limits (Phase 10)

RAG (existing caps retained; new caps added):
- `replaceSource`: transactional window = maxChunks (8 192); on failure prior index intact; cross-scope rejected.
- `deleteSource`: scoped to `RagScope`; cross-scope rejected; bounded by existing `VectorStore.delete`.
- `DocumentLoader`/`Parser`: per-document byte cap = `HARD_MAX_DOCUMENT_CHARS_CAP` (8 MiB); parse time cap = 30 s (abortable); page cap (PDF) = 256; concurrency cap = 4 per scope; HTML strips script/style.
- `Reranker`: query cap = 8 KiB; hits cap = `HARD_QUERY_CANDIDATES_CAP` (128); time cap = 30 s; concurrency = 4 per scope; original retrieval order recoverable.
- Ingestion status: per-source record (pending/indexed/failed/partial + byte/chunk/error counts); status query O(scope), page cap = 100.
- Provenance/trust: present on every `RagHit`; assembled context marked `untrusted: true, inert: true`; injection-capable flag set on web/loader-sourced blocks.

Memory (existing caps retained; new caps added):
- `exportMemory`: page cap = 200; byte cap = 32 MiB; time cap = 60 s; redacted via active redactor; cross-tenant rejected.
- `rebuildIndex`: bounded batch stream (batchSize = `HARD_EMBED_BATCH_SIZE_CAP` 128); abortable + resumable via scope cursor; no full-corpus scan per run.
- `assertFiniteVector` at every boundary (embedder, memory-vector, PostgreSQL/pgvector, export, rebuild); semantic SQLite remains demand-gated.

OpenAI hosted tools / continuation / realtime (new):
- Hosted-tool result bytes = 1 MiB per call; authority = `"provider-hosted"`; marked untrusted; redacted.
- Continuation window = 8 hops; cursor opaque, ≤ 4 KiB; bounded by run's `RunLimits`; abort propagates; duplicate/stale cursor rejected.
- Realtime session: audio event cap = 256/s; byte cap = 1 MiB/s; wall-time cap = 600 s; concurrent sessions cap = host-owned (default 1 per run); disconnect/budget breach fails closed; credentials never in events.

Provider discovery (existing caller-gated; retained):
- Discovery page cap = 200; byte cap = 1 MiB; time cap = 30 s; abortable; no setup-time network unless host opts in.

All new loops consume the shared turn/tool/token/cost `RunLimits` (no second budget engine).

## 5. Threat / authority matrix

| Threat | Boundary | Control | Task |
| --- | --- | --- | --- |
| Hosted tool masquerading as host-owned tool (gains host permissions) | `ToolCallContent.authority` | new `authority: "provider-hosted"` discriminator; guardrails/permissions treat provider-hosted calls as provider-side, not host-side | Task 1 |
| Unbounded continuation loop | continuation cursor | opaque cursor, ≤ 4 KiB; 8-hop window; bounded by `RunLimits`; stale/duplicate cursor rejected | Task 1 |
| Realtime audio/credential leak | realtime session | credentials never in events; audio/transcripts untrusted + redacted; disconnect/budget fail-closed; exact origin/session/ownership binding | Task 1 |
| AI SDK silent field drop | mapping | typed table-driven mapping; unsupported required field raises `ERR_PRISM_PROVIDER_MAPPING`; version-skew setup error | Task 2 |
| Serializer sharing drops provider-specific cache/reasoning markers | shared serializer extraction | extract only on recorded exact wire match; per-provider serializer retained otherwise (Kimi/Moonshot vs Alibaba already diverge on `cache_control`/`reasoning_content`) | Task 3 |
| Remote document SSRF / private origin | `DocumentLoader`/`web_fetch` | `canonicalUrl` rejects non-http(s)/userinfo/private/local/file origins; parser bombs fail closed on byte/page/time cap | Task 4 |
| Retrieved content gains tool authority | assembled context | every retrieved block marked `untrusted: true, inert: true`; injection-capable flag; never executed | Task 4/5 |
| Source replacement/deletion crosses ownership/corpus | `RagScope`/`MemoryScope` | scope ownership verified on replace/delete; cross-scope rejected | Task 4/6 |
| Revoked/invisible memory injected/exported/telemetered | `isInjectable`/consent | reuse 0.0.14 consent enforcement; export redacted + scoped; retention real-delete where policy allows | Task 6 |
| Non-finite vector corrupts store | `assertFiniteVector` | enforced at every store boundary (add sqlite/query/export/rebuild) | Task 6 |
| Reranker exfiltration | reranker I/O | redacted via active redactor; original order recoverable; concurrency capped | Task 5 |
| Permission broadening (roadmap gate 9) | whole phase | no broadening of consent/memory/network/file/browser/connector/tool permissions; Task 9 regression guard | Task 9 |

## 6. Task 0 validation matrix (scope guards)

- `src/__tests__/docs.test.ts` Phase 10 evidence test asserts: review doc headings, Task 1–9 owners, frozen tokens (hosted-tool authority, continuation cursor ≤ 4 KiB, realtime audio cap 256/s, Reranker, DocumentLoader, replaceSource, exportMemory, rebuildIndex), roadmap criteria coverage, and the scope guard rejecting `packages/{realtime,document-loaders,reranker,vector-store-*,studio,voice,desktop}`.
- Scope guard: no new package directory beyond the existing 42; `@arnilo/prism-realtime` / `@arnilo/prism-document-loaders` / `@arnilo/prism-reranker` / additional `@arnilo/prism-provider-vector-*` must not appear in the package graph or `docs/index.md`.
- Non-broadening guard: gate 9 carried into Task 9 release validation.
- Manifest count guard: 43 publishable; `release:check --version 0.0.15` validates the exact graph.

## 7. Frozen decisions (binding on Tasks 1–9)

- `43 → 43` manifests; no new package (extend in place). A split requires a recorded amendment to §2 of this doc with measured size/cohesion evidence.
- Hosted-tool authority = `"provider-hosted"` (string literal); lives on `ToolCallContent` in core (one neutral field); OpenAI-specific behavior stays in the provider package.
- Continuation cursor is an opaque provider string ≤ 4 KiB; no core field beyond the neutral `ProviderEvent` variant + `ProviderRequestOptions` hook.
- Realtime session binds to exact origin/session/ownership; audio events untrusted + redacted; no realtime field leaks into core beyond the neutral event variant.
- `DocumentLoader` composes over `ResourceLoader` for authorized host artifacts; web ingestion wraps `web_fetch`/`web_extract` (no second crawler).
- `Reranker` is a seam over `RagHit[]`; `retrieveContext({ reranker })` keeps original order recoverable.
- Memory consent/retention/forget/correct are DONE (0.0.14); Task 6 only adds `exportMemory` + `rebuildIndex` + conformance parity + remaining finite-vector boundaries — do not rebuild consent.
- No additional vector-store package; demand-gated to 0.1.x.
- Shared serializer extraction requires a recorded exact wire match in this doc §2/§5; the Kimi/Moonshot vs Alibaba divergence on `cache_control`/`reasoning_content` is the precedent for keeping per-provider serializers.
- `npm test` stays network-free; credentialed live canaries stay operator-gated and are documented in the Task 7 matrix.