# Retrieval-augmented generation (RAG)

## What it does

The `@arnilo/prism-memory/rag` subpath is an optional surface for deterministic text/Markdown chunking (with ATX heading-stack metadata), bounded embedding/vector indexing with embedder-identity drift guards, atomic scoped source replacement/deletion with content-hash skip and generation visibility, hybrid vector+lexical retrieval with reciprocal-rank fusion (one embed / one RRF / one rerank across one or many exact scopes), focused text/Markdown/HTML/PDF parsing, bounded reranking (host seam plus a TEI REST adapter), ingestion status, attributable citations, content-trust metadata, and explicit `ContextProvider` injection. It reuses `Embedder` and `VectorStore` from the memory root entry; Prism core input assembly is unchanged.

## When to use it

Use it when a host needs bounded replacement of one owned source, focused parsing after a host-authorized resource or host-selected web fetch, or a host-selected reranker over a finite candidate set. Do not use it for LaTeX parsing, semantic chunking, metadata extraction agents, a hosted reranker implementation, GraphRAG, crawling, URL fetching outside `@arnilo/prism-web-tools`, or filesystem discovery.

## Inputs / request

Chunking:

| API/field | Meaning |
| --- | --- |
| `chunkText(text, options)` | Character-bounded plain-text chunks |
| `chunkMarkdown(markdown, options)` | Same engine, preferring heading/paragraph boundaries |
| `sourceId` | Required stable, non-secret source identifier |
| `size` / `overlap` | Character ceiling and repeated context |
| `metadata` | JSON metadata copied to every chunk; Markdown chunking additionally stamps `heading` (ordered parent-first heading stack, e.g. `["Policy", "3.2 Leave"]`) unless the caller supplies one.

Document lifecycle:

| API/field | Meaning |
| --- | --- |
| `replaceSource({ sourceId, chunks, store, scope, ... })` | Atomically replaces one source after all bounded embedding succeeds; the store must implement scoped `getBySource()` and `transaction()`. |
| `deleteSource({ sourceId, store, scope })` | Deletes only matching IDs under exact tenant/resource/corpus scope. |
| `replaceDocument({ uri, loader, parser, store, scope, ... })` | Loads through a host seam, parses, chunks, and atomically replaces. `sourceId` is required unless loader supplies one. |
| `DocumentLoader` / `Parser` | Small host-replaceable seams. `@arnilo/prism-memory/rag/loaders` and `/rag/parsers` export reference adapters. |
| `textParser` / `markdownParser` / `htmlParser` / `pdfParser` | UTF-8 text, Markdown, script/style-stripping HTML, and uncompressed-text PDF parsers. |

Index/retrieve:

| Field | Required | Meaning |
| --- | --- | --- |
| `embedder` / `store` | yes | Phase 7 `Embedder` and `VectorStore` |
| `scope` / `scopes` | one or the other | Exact `{ tenantId, resourceId, corpusId }` (corpus → vector thread). `scope` is the single-corpus path; `scopes` is 0..`HARD_RETRIEVE_SCOPE_CAP` (8) exact scopes. Empty `scopes` returns no hits and does not embed/search/rerank. Passing both or neither throws. |
| `chunks` | indexing | `RagChunk[]` from package chunkers or compatible host parser |
| `topK` / `queryCandidates` | retrieval | Returned result count and bounded pre-filter candidates (`queryCandidates` is **per scope**) |
| `lexical` | no | `"fts"` \| `"bm25"` \| `"off"` (default `"off"`); enables the lexical retrieval leg when the store advertises it |
| `fusion` / `rrfK` | no | `"rrf"` fusion of vector+lexical legs (default `"rrf"` when `lexical` is on; `rrfK` default 60, hard cap 1,000) |
| `filter` | no | Shallow JSON metadata equality filter |
| `reranker` | no | Host-owned `Reranker` receives redacted bounded `RagHit[]` and must return the same IDs once each, in preferred order. |
| `maxRerankBytes` / `maxRerankMs` / `rerankConcurrency` | no | Reranker caps; defaults/hard limits are 64/256 KiB, 2/10 s, and 2/8 active calls per reranker object. |
| `statusStore` | no | `IngestionStatusStore` records per-source pending/indexed/failed/partial byte/chunk progress; use `listIngestionStatus()` for capped exact-scope pages. |
| `contentHash` | no | Host-computed document digest; stamped on records and enables unchanged-source skip in `replaceSource` (`skipIfUnchanged`, default true when present) |
| `reuseEmbeddings` | no | `ReadonlyMap<string, ReusableEmbedding>` — chunk id → `{ text, embedding }`; embeddings reused (no embed call) when texts match |
| `telemetry` / `telemetryParent` | no | `RagTelemetry` seam (e.g. `createRagTelemetry()` from `@arnilo/prism-core/governance/observability`); spans nest under `telemetryParent` |
| `redactor` / `secrets` | no | Redact before embedding, persistence, reranking, and injection |
| `signal` | no | Abort embedding, vector operations, reranking, and batch progression |

## Outputs / response / events

- `chunkText()` / `chunkMarkdown()` return frozen `RagChunk[]` with `sourceId`, zero-based index, offsets, and stable IDs such as `guide#0001`.
- `indexChunks()` returns `{ indexed, sourceIds }` after bounded batch upserts.
- `replaceSource()` / `deleteSource()` return `{ sourceId, deleted, indexed }`.
- `replaceDocument()` carries loader parser metadata into chunk metadata; the web loader preserves web-tools citation ID and `untrusted: true`.
- `retrieveContext()` returns `{ query, trust, text, hits, citations, truncated }`. Every hit/citation carries `{ provenance: { sourceId, chunkId, citationId, provider, tenantId, resourceId, corpusId, retrieval: "vector" | "lexical" | "hybrid", retrievedAt }, trust: { untrusted: true, inert: true, injectionCapable: true } }`; `retrieval` labels the leg(s) that surfaced the hit after RRF fusion, and `retrievalRank` preserves pre-rerank order. Rendered text uses `[citation-id] text` blocks.
- `replaceSource()` returns `{ sourceId, deleted, indexed, skipped? }` (skipped when the stored `contentHash` matched and no writes occurred). Records carry `embedderId` (from `Embedder.id`, the Task 2 identity contract) and `generation` (scope-level monotonically bumped index per replacement; `_rag` metadata carries `contentHash` when supplied). `store.getCurrentGeneration(scope)` / `store.setCurrentGeneration(scope, n)` let hosts read and roll back the visible generation; retrieval filters to the current generation while legacy generation-less rows stay visible.
- `createMemoryIngestionStatusStore()` is a bounded in-memory reference adapter. `listIngestionStatus({ store, scope, limit, cursor })` returns capped status pages; hosts supply durable stores when status must survive process restart.
- `createRagContextProvider()` returns one ordinary context provider. Empty queries/results contribute no block.
- No events, tools, permissions, provider calls, loaders, or network requests are added.

Default/hard ceilings include 1,000/16,384 chunk characters, 100/4,096 overlap, 1,048,576/8,388,608 document bytes/chars, 30 s parsing, 256 PDF pages, 2,048/8,192 chunks, 32/128 embed batch, top-K 5/32, candidates 20/128, result 64/512 KiB, context 2,000/8,000 estimated tokens, reranker input 64/256 KiB, reranker wall time 2/10 s, reranker active calls 2/8, and status pages 50/200.

## Request/response example

```json
{
  "scope": { "tenantId": "t1", "resourceId": "docs", "corpusId": "handbook" },
  "query": "How do approvals work?",
  "topK": 1,
  "result": {
    "text": "[security-guide#0001] Recheck policy before side effects.",
    "trust": { "untrusted": true, "inert": true, "injectionCapable": true },
    "citations": [{ "id": "security-guide#0001", "sourceId": "security-guide", "provenance": { "provider": "host", "retrieval": "vector" } }]
  }
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkMarkdown, createMemoryIngestionStatusStore, createRagContextProvider, indexChunks, listIngestionStatus, retrieveContext } from "@arnilo/prism-memory/rag";

const embedder = createHashEmbedder(); // deterministic demo/test helper, not production semantic quality
const store = createMemoryVectorStore();
const scope = { tenantId: "t1", resourceId: "docs", corpusId: "handbook" };
const chunks = chunkMarkdown("# Approval\n\nRecheck current policy before side effects.", {
  sourceId: "security-guide",
  metadata: { category: "security" },
});
const statusStore = createMemoryIngestionStatusStore();
await indexChunks({ chunks, embedder, store, scope, statusStore });
// For a replaceable source use `replaceSource`; it keeps previous chunks until embedding succeeds.

const found = await retrieveContext("approval policy", {
  embedder,
  store,
  scopes: [scope], // or `scope` for one corpus
  topK: 4,
  filter: { category: "security" },
  reranker: { rerank: async ({ hits }) => [...hits].sort((a, b) => b.score - a.score) },
});
console.log(await listIngestionStatus({ store: statusStore, scope }));

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Policy checked."), providerDone()]),
  context: [createRagContextProvider({ embedder, store, scope })],
});
console.log(found.text, await agent.createSession().run("How do approvals work?"));
```

Content-hash skip and hash validation:

```ts
import { isValidContentHash } from "@arnilo/prism-memory/rag";

const digest = "ab12..."; // host-computed SHA-256 hex of the document
if (!isValidContentHash(digest)) throw new Error("invalid digest");
await replaceSource({ sourceId: "doc", chunks, embedder, store, scope, contentHash: digest }); // unchanged → skipped, zero embeds
```

Hybrid retrieval, TEI reranking, and telemetry:

```ts
import { createRagTelemetry } from "@arnilo/prism-core/governance/observability";
import { createTeiReranker } from "@arnilo/prism-memory/rag";

const telemetry = createRagTelemetry({ tracer, meter }); // @opentelemetry/api instruments
const org = { tenantId: "t1", resourceId: "docs", corpusId: "org" };
const user = { tenantId: "t1", resourceId: "docs", corpusId: "user" };
const session = { tenantId: "t1", resourceId: "docs", corpusId: "session" };
const found = await retrieveContext("leave balance", {
  embedder,
  store, // a store that advertises lexicalModes: ["fts"]
  scopes: [org, user, session], // one embed, per-scope legs, one RRF, one rerank
  lexical: "fts",
  topK: 8,
  reranker: createTeiReranker({ baseUrl: "https://tei.svc:8080" }),
  telemetry, // roots a rag_request span tree; attachSession/handleAgentEvent NOT required
});
```

## Extension and configuration notes

- Supply any Phase 7-conforming embedder/vector store, including the in-memory reference or PostgreSQL/pgvector adapter.
- Metadata filtering is package-local after a bounded candidate query so existing vector contracts/adapters remain unchanged. Increase `queryCandidates` only when selective filters measurably need it.
- `Reranker` is a host seam, not a provider integration. Return each redacted candidate ID exactly once; Prism retains canonical hit/provenance/trust fields and exposes `retrievalRank` for diagnostics. Add a hosted reranker only when a host owns its credentials, quota, and retry policy.
- `createTeiReranker({ baseUrl, model?, timeoutMs?, maxResponseBytes?, ssrf?, allowLoopback?, fetch? })` (`CreateTeiRerankerOptions`) adapts a Hugging Face TEI `POST <baseUrl>/rerank` endpoint (`{query, texts, raw_scores:false}` → `{results:[{index,score}]}`) into the `Reranker` seam. It returns a permutation-only reorder of the same hit objects, so provenance/trust move untouched. Response parsing is strict — short/duplicate/out-of-range indices, non-finite scores, HTTP errors, timeouts, and oversized bodies all fail closed; the `rerankHits` caps (`maxRerankBytes`, `maxRerankMs`, `rerankConcurrency`) still apply around it. The default transport is the core DNS-pinned `pinnedFetch` (redirect-free, byte-bounded to 65,536 by default); HTTPS is required unless `allowLoopback: true` (loopback dev/test) or the host supplies `ssrf`/`fetch` for cluster networking. The adapter validates URL shape only — SSRF policy enforcement stays host-side. No credentials are ever sent; there is no SaaS default URL.
- Hosted rerank adapters over the same seam (plan 062): `createOpenAiCompatibleReranker({ baseUrl, model?, apiKey?, timeoutMs?, maxResponseBytes?, ssrf?, allowLoopback?, fetch? })` speaks the OpenAI-compatible `POST <baseUrl>/rerank` route (`{model, query, documents}` → `{results:[{index,relevance_score}]}`; pass the version segment in `baseUrl`, e.g. `https://api.jina.ai/v1`), and `createVoyageReranker({ baseUrl, model?, apiKey, … })` adapts Voyage AI (`…/v1/rerank` → `{data:[{index,relevance_score}]}`; `apiKey` required). Both send one request per rerank — no adapter-side batching — never send `top_k` (the retrieval seam owns top-K), return the same permutation-only reorder, and fail closed on the same malformed-response/HTTP/timeout/byte-bound cases. `apiKey` rides as `Authorization: Bearer …` and is never logged; errors carry status/host only. No SaaS default URL — hosts own credentials, quota, and retry policy.
- `createFakeReranker()` is a network-free deterministic reranker (query-term-overlap scoring, stable ties) and `runRerankerConformance(createReranker)` is the shared network-free conformance for any `Reranker` implementation: empty input → `[]`, output is a permutation of the exact input references (provenance/trust untouched), repeated calls are deterministic.
- Hybrid retrieval: pass `lexical: "fts"` (or `"bm25"` when the store supports it) to `retrieveContext()`; the two legs are fused with reciprocal-rank fusion (`fusion: "rrf"`, `rrfK` 60 default; the pure helper `fuseReciprocalRank()` returns `FusedCandidate[]` for custom orchestration). Stores advertise support via `lexicalModes?: readonly LexicalMode[]` and `tokenizeLexical()` is the shared tokenizer. Each hit's provenance `retrieval` field reports `vector`/`lexical`/`hybrid`; fusion internals expose `RetrievalLeg`.
- Multi-scope retrieve: `scopes: RagScope[]` searches each exact scope against that scope's current generation, then runs **one** RRF over the union and **one** rerank. The query is embedded once. `queryCandidates` is per scope. Duplicate scopes are dropped. `HARD_RETRIEVE_SCOPE_CAP` is 8.
- Embedder identity/drift guard: `Embedder.id` (memory contract) is stamped onto every vector record as `embedderId`. `retrieveContext()` fails closed with `ERR_PRISM_RAG_EMBEDDER_MISMATCH` when a stored record's `embedderId` or dimensions differ from the active embedder (for example after a model change) — re-index the source before retrieving. Legacy records without an `embedderId` also fail closed, naming the re-index path.
- Generations: `replaceSource()` stamps a scope-level generation (auto-incremented per replacement) on staged records and the vector store filters retrieval to the current generation. `setCurrentGeneration()` supports rollback; stores without generation tracking keep legacy behavior (everything visible).
- `IngestionStatusStore` is optional observability storage. It is keyed by exact scope and source ID; use `listIngestionStatus()` rather than an unbounded corpus scan. The reference memory store is process-local; implement the same capped scope behavior for durable status.
- `createRagContextProvider()` derives its query from latest user text by default; pass a fixed string or callback for host-controlled query generation.
- `createResourceDocumentLoader({ loader })` calls one host-owned `ResourceLoader`; it scans nothing and performs no filesystem or network I/O itself. Pass the host's permission/trust context to that loader.
- `createWebFetchDocumentLoader({ fetcher })` accepts an already-configured `@arnilo/prism-web-tools` fetch adapter. It never opens a socket, rejects file/local/private/IP-literal URLs, and carries normalized citation/trust metadata forward. The fetch adapter still owns DNS/SSRF policy.
- `pdfParser` is deliberately limited to bounded, uncompressed PDF text. Provide a host parser through `Parser` for compressed, scanned, or complex PDFs; do not silently index partial text.
- Package is available directly or via the `@arnilo/prism-memory` family tarball; installation does not create an embedder, vector store, loader, parser, or context provider.

## Security and performance notes

- Every index/query includes exact tenant/resource/corpus scope; returned records are rechecked and malformed/foreign records fail closed. `retrieveContext` accepts `scope` or `scopes` (never both, never neither). Empty `scopes` is the host “no allowed corpora” path — no embed, no search, no rerank. A hit whose stored scope is not in the requested list fails closed. Generation filters stay per scope.
- Embedding identity is a privacy/consistency boundary: records from a different embedder (or dimension) never silently mingle with new ones — retrieval fails closed and names the re-index path. Generation pointers are scope-scoped: a pointer row belongs to exactly one scope, and visibility is computed inside the store (SQL), never by post-filtering in JS.
- Source IDs become citation/storage IDs and must be stable non-secret identifiers. Text and user metadata can be redacted before external embedding and persistence.
- Heading metadata is document text only — it passes through the existing `maxMetadataBytes` cap as chunk metadata; no new content path is introduced.
- `contentHash` skip and `reuseEmbeddings` never leak embeddings: reused embeddings are keyed by chunk id within one replacement and only accepted when the stored text matches exactly.
- Retrieved documents are untrusted inert context. Prompt-injection text cannot activate tools, skills, credentials, permissions, or extensions.
- Remote sources must pass existing resource/media trust, SSRF, MIME, and byte policies before their decoded text reaches this package.
- `replaceSource()` stages every bounded embedding before opening the store transaction. It requires a source-aware transactional store and fails closed rather than pretending generic upserts are atomic. `createMemoryVectorStore()` supplies the reference `getBySource()` / transaction capability; durable stores must implement equivalent exact-scope behavior.
- `deleteSource()` rechecks every returned record's tenant/resource/corpus and source metadata before delete. Same source IDs in another corpus remain untouched.
- Parsers enforce byte/page/time caps, abort before and after parsing, decode UTF-8 strictly, and strip HTML script/style content. Parsed and retrieved text remains untrusted inert context; it never gains tool authority.
- Rerankers receive redacted input under byte/time/concurrency caps. Timeout, abort, unknown/duplicate/missing IDs, oversized input, and reranker failures fail closed; returned objects cannot overwrite Prism provenance/trust fields. The TEI adapter adds fail-closed response parsing (permutation completeness, finite scores) and honors the 65,536-byte response ceiling; SSRF/URL policy is host-side (see Extension notes). The hosted OpenAI-compatible and Voyage adapters carry the same guarantees and add Bearer credentials that are never logged and error messages that never contain document text or the API key.
- Telemetry is a host-owned seam: `RagTelemetry` adapter (`createRagTelemetry()`) drops anything outside a fixed span-name set and `rag.*`-shaped attribute keys, so raw chunk text never reaches the tracer unless the host's own `attributeFilter` opts it in; when the seam is absent, instrumentation costs nothing.
- Durable vector stores (PostgreSQL/pgvector path via `@arnilo/prism-memory`) run their DDL against the host's knowledge database — tables are created in a schema/table the host names (default `prism_memory.semantic_memory`), and hosts must own backup/retention of that database. See [Working and semantic memory](working-and-semantic-memory.md).
- Ingestion failure errors are redacted before status storage. Status reads reject foreign scope entries and page-limit violations; status itself creates no permission or tool authority.
- Filtering scans at most `queryCandidates` hits; rendering stops at top-K, UTF-8 result bytes, or estimated context-token ceiling.

## Related APIs

- [Working and semantic memory](working-and-semantic-memory.md): shared `Embedder`/`VectorStore` contracts and adapters.
- [Context and skills](context-and-skills.md): explicit `ContextProvider` injection and inert context semantics.
- [Resource loading](resource-loading.md): host-owned trusted source loading.
- [Multimodal content](multimodal-content.md): remote media SSRF/MIME/byte policies before text extraction.
