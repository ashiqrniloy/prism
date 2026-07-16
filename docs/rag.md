# Retrieval-augmented generation (RAG)

## What it does

`@arnilo/prism-rag` is an optional package for deterministic plain-text/Markdown chunking, bounded embedding/vector indexing, filtered semantic retrieval, stable citations, and explicit `ContextProvider` injection. It reuses `Embedder` and `VectorStore` from `@arnilo/prism-memory`; Prism core input assembly is unchanged.

## When to use it

Use it when a host already owns trusted document text and needs small retrieval primitives without a document framework. Do not use it for PDF/HTML/LaTeX parsing, semantic chunking, metadata extraction agents, reranker pipelines, GraphRAG, crawling, URL fetching, or filesystem discovery.

## Inputs / request

Chunking:

| API/field | Meaning |
| --- | --- |
| `chunkText(text, options)` | Character-bounded plain-text chunks |
| `chunkMarkdown(markdown, options)` | Same engine, preferring heading/paragraph boundaries |
| `sourceId` | Required stable, non-secret source identifier |
| `size` / `overlap` | Character ceiling and repeated context |
| `metadata` | JSON metadata copied to every chunk |

Index/retrieve:

| Field | Required | Meaning |
| --- | --- | --- |
| `embedder` / `store` | yes | Phase 7 `Embedder` and `VectorStore` |
| `scope` | yes | `{ tenantId, resourceId, corpusId }`; corpus maps to vector thread isolation |
| `chunks` | indexing | `RagChunk[]` from package chunkers or compatible host parser |
| `topK` / `queryCandidates` | retrieval | Returned result count and bounded pre-filter candidates |
| `filter` | no | Shallow JSON metadata equality filter |
| `redactor` / `secrets` | no | Redact before embedding, persistence, and injection |
| `signal` | no | Abort embedding, vector operations, and batch progression |

## Outputs / response / events

- `chunkText()` / `chunkMarkdown()` return frozen `RagChunk[]` with `sourceId`, zero-based index, offsets, and stable IDs such as `guide#0001`.
- `indexChunks()` returns `{ indexed, sourceIds }` after bounded batch upserts.
- `retrieveContext()` returns `{ query, text, hits, citations, truncated }`. Rendered text uses `[citation-id] text` blocks.
- `createRagContextProvider()` returns one ordinary context provider. Empty queries/results contribute no block.
- No events, tools, permissions, provider calls, loaders, or network requests are added.

Default hard ceilings include 1,000/16,384 chunk characters, 100/4,096 overlap, 1,048,576/8,388,608 document characters, 2,048/8,192 chunks, 32/128 embed batch, top-K 5/32, candidates 20/128, result 64/512 KiB, and context 2,000/8,000 estimated tokens.

## Request/response example

```json
{
  "scope": { "tenantId": "t1", "resourceId": "docs", "corpusId": "handbook" },
  "query": "How do approvals work?",
  "topK": 1,
  "result": {
    "text": "[security-guide#0001] Recheck policy before side effects.",
    "citations": [{ "id": "security-guide#0001", "sourceId": "security-guide" }]
  }
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkMarkdown, createRagContextProvider, indexChunks, retrieveContext } from "@arnilo/prism-rag";

const embedder = createHashEmbedder(); // deterministic demo/test helper, not production semantic quality
const store = createMemoryVectorStore();
const scope = { tenantId: "t1", resourceId: "docs", corpusId: "handbook" };
const chunks = chunkMarkdown("# Approval\n\nRecheck current policy before side effects.", {
  sourceId: "security-guide",
  metadata: { category: "security" },
});
await indexChunks({ chunks, embedder, store, scope });

const found = await retrieveContext("approval policy", {
  embedder,
  store,
  scope,
  topK: 4,
  filter: { category: "security" },
});

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
- `createRagContextProvider()` derives its query from latest user text by default; pass a fixed string or callback for host-controlled query generation.
- Load source text separately with a host-owned `ResourceLoader`. The RAG package intentionally accepts text, not URLs or filesystem paths.
- Package is available directly or through `@arnilo/prism-all`; installation does not create an embedder, vector store, or context provider.

## Security and performance notes

- Every index/query includes exact tenant/resource/corpus scope; returned records are rechecked and malformed/foreign records fail closed.
- Source IDs become citation/storage IDs and must be stable non-secret identifiers. Text and user metadata can be redacted before external embedding and persistence.
- Retrieved documents are untrusted inert context. Prompt-injection text cannot activate tools, skills, credentials, permissions, or extensions.
- Remote sources must pass existing resource/media trust, SSRF, MIME, and byte policies before their decoded text reaches this package.
- Indexing is bounded per batch and checks abort between embed/upsert operations. A failure can leave completed batches persisted; retry is idempotent for the same stable source/chunk IDs.
- Filtering scans at most `queryCandidates` hits; rendering stops at top-K, UTF-8 result bytes, or estimated context-token ceiling.

## Related APIs

- [Working and semantic memory](working-and-semantic-memory.md): shared `Embedder`/`VectorStore` contracts and adapters.
- [Context and skills](context-and-skills.md): explicit `ContextProvider` injection and inert context semantics.
- [Resource loading](resource-loading.md): host-owned trusted source loading.
- [Multimodal content](multimodal-content.md): remote media SSRF/MIME/byte policies before text extraction.
