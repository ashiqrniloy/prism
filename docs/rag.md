# Retrieval-augmented generation (RAG)

## What it does

`@arnilo/prism-rag` is an optional package for deterministic text/Markdown chunking, bounded embedding/vector indexing, atomic scoped source replacement/deletion, focused text/Markdown/HTML/PDF parsing, bounded reranking, ingestion status, attributable citations, content-trust metadata, and explicit `ContextProvider` injection. It reuses `Embedder` and `VectorStore` from `@arnilo/prism-memory`; Prism core input assembly is unchanged.

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
| `metadata` | JSON metadata copied to every chunk |

Document lifecycle:

| API/field | Meaning |
| --- | --- |
| `replaceSource({ sourceId, chunks, store, scope, ... })` | Atomically replaces one source after all bounded embedding succeeds; the store must implement scoped `getBySource()` and `transaction()`. |
| `deleteSource({ sourceId, store, scope })` | Deletes only matching IDs under exact tenant/resource/corpus scope. |
| `replaceDocument({ uri, loader, parser, store, scope, ... })` | Loads through a host seam, parses, chunks, and atomically replaces. `sourceId` is required unless loader supplies one. |
| `DocumentLoader` / `Parser` | Small host-replaceable seams. Root and `@arnilo/prism-rag/loaders` / `@arnilo/prism-rag/parsers` export reference adapters. |
| `textParser` / `markdownParser` / `htmlParser` / `pdfParser` | UTF-8 text, Markdown, script/style-stripping HTML, and uncompressed-text PDF parsers. |

Index/retrieve:

| Field | Required | Meaning |
| --- | --- | --- |
| `embedder` / `store` | yes | Phase 7 `Embedder` and `VectorStore` |
| `scope` | yes | `{ tenantId, resourceId, corpusId }`; corpus maps to vector thread isolation |
| `chunks` | indexing | `RagChunk[]` from package chunkers or compatible host parser |
| `topK` / `queryCandidates` | retrieval | Returned result count and bounded pre-filter candidates |
| `filter` | no | Shallow JSON metadata equality filter |
| `reranker` | no | Host-owned `Reranker` receives redacted bounded `RagHit[]` and must return the same IDs once each, in preferred order. |
| `maxRerankBytes` / `maxRerankMs` / `rerankConcurrency` | no | Reranker caps; defaults/hard limits are 64/256 KiB, 2/10 s, and 2/8 active calls per reranker object. |
| `statusStore` | no | `IngestionStatusStore` records per-source pending/indexed/failed/partial byte/chunk progress; use `listIngestionStatus()` for capped exact-scope pages. |
| `redactor` / `secrets` | no | Redact before embedding, persistence, reranking, and injection |
| `signal` | no | Abort embedding, vector operations, reranking, and batch progression |

## Outputs / response / events

- `chunkText()` / `chunkMarkdown()` return frozen `RagChunk[]` with `sourceId`, zero-based index, offsets, and stable IDs such as `guide#0001`.
- `indexChunks()` returns `{ indexed, sourceIds }` after bounded batch upserts.
- `replaceSource()` / `deleteSource()` return `{ sourceId, deleted, indexed }`.
- `replaceDocument()` carries loader parser metadata into chunk metadata; the web loader preserves web-tools citation ID and `untrusted: true`.
- `retrieveContext()` returns `{ query, trust, text, hits, citations, truncated }`. Every hit/citation carries `{ provenance: { sourceId, chunkId, citationId, provider, retrieval: "vector", retrievedAt }, trust: { untrusted: true, inert: true, injectionCapable: true } }`; `retrievalRank` preserves pre-rerank order. Rendered text uses `[citation-id] text` blocks.
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
import { chunkMarkdown, createMemoryIngestionStatusStore, createRagContextProvider, indexChunks, listIngestionStatus, retrieveContext } from "@arnilo/prism-rag";

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
  scope,
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

## Extension and configuration notes

- Supply any Phase 7-conforming embedder/vector store, including the in-memory reference or PostgreSQL/pgvector adapter.
- Metadata filtering is package-local after a bounded candidate query so existing vector contracts/adapters remain unchanged. Increase `queryCandidates` only when selective filters measurably need it.
- `Reranker` is a host seam, not a provider integration. Return each redacted candidate ID exactly once; Prism retains canonical hit/provenance/trust fields and exposes `retrievalRank` for diagnostics. Add a hosted reranker only when a host owns its credentials, quota, and retry policy.
- `IngestionStatusStore` is optional observability storage. It is keyed by exact scope and source ID; use `listIngestionStatus()` rather than an unbounded corpus scan. The reference memory store is process-local; implement the same capped scope behavior for durable status.
- `createRagContextProvider()` derives its query from latest user text by default; pass a fixed string or callback for host-controlled query generation.
- `createResourceDocumentLoader({ loader })` calls one host-owned `ResourceLoader`; it scans nothing and performs no filesystem or network I/O itself. Pass the host's permission/trust context to that loader.
- `createWebFetchDocumentLoader({ fetcher })` accepts an already-configured `@arnilo/prism-web-tools` fetch adapter. It never opens a socket, rejects file/local/private/IP-literal URLs, and carries normalized citation/trust metadata forward. The fetch adapter still owns DNS/SSRF policy.
- `pdfParser` is deliberately limited to bounded, uncompressed PDF text. Provide a host parser through `Parser` for compressed, scanned, or complex PDFs; do not silently index partial text.
- Package is available directly or through `@arnilo/prism-all`; installation does not create an embedder, vector store, loader, parser, or context provider.

## Security and performance notes

- Every index/query includes exact tenant/resource/corpus scope; returned records are rechecked and malformed/foreign records fail closed.
- Source IDs become citation/storage IDs and must be stable non-secret identifiers. Text and user metadata can be redacted before external embedding and persistence.
- Retrieved documents are untrusted inert context. Prompt-injection text cannot activate tools, skills, credentials, permissions, or extensions.
- Remote sources must pass existing resource/media trust, SSRF, MIME, and byte policies before their decoded text reaches this package.
- `replaceSource()` stages every bounded embedding before opening the store transaction. It requires a source-aware transactional store and fails closed rather than pretending generic upserts are atomic. `createMemoryVectorStore()` supplies the reference `getBySource()` / transaction capability; durable stores must implement equivalent exact-scope behavior.
- `deleteSource()` rechecks every returned record's tenant/resource/corpus and source metadata before delete. Same source IDs in another corpus remain untouched.
- Parsers enforce byte/page/time caps, abort before and after parsing, decode UTF-8 strictly, and strip HTML script/style content. Parsed and retrieved text remains untrusted inert context; it never gains tool authority.
- Rerankers receive redacted input under byte/time/concurrency caps. Timeout, abort, unknown/duplicate/missing IDs, oversized input, and reranker failures fail closed; returned objects cannot overwrite Prism provenance/trust fields.
- Ingestion failure errors are redacted before status storage. Status reads reject foreign scope entries and page-limit violations; status itself creates no permission or tool authority.
- Filtering scans at most `queryCandidates` hits; rendering stops at top-K, UTF-8 result bytes, or estimated context-token ceiling.

## Related APIs

- [Working and semantic memory](working-and-semantic-memory.md): shared `Embedder`/`VectorStore` contracts and adapters.
- [Context and skills](context-and-skills.md): explicit `ContextProvider` injection and inert context semantics.
- [Resource loading](resource-loading.md): host-owned trusted source loading.
- [Multimodal content](multimodal-content.md): remote media SSRF/MIME/byte policies before text extraction.
