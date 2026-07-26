# @arnilo/prism-rag

Optional bounded source lifecycle, document parsing, host reranking, ingestion status, and retrieval-augmented generation primitives for Prism. Reuses `Embedder` and `VectorStore` from `@arnilo/prism-memory`; no document framework, network loader, or core activation.

## Install

```bash
npm install @arnilo/prism-rag @arnilo/prism-memory @arnilo/prism
```

## Usage

```ts
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkMarkdown, createMemoryIngestionStatusStore, createRagContextProvider, listIngestionStatus, replaceSource } from "@arnilo/prism-rag";

const embedder = createHashEmbedder(); // demo/test only
const store = createMemoryVectorStore();
const scope = { tenantId: "t1", resourceId: "docs", corpusId: "handbook" };
const chunks = chunkMarkdown("# Approval\n\nRecheck policy before side effects.", {
  sourceId: "security-guide",
});
const statusStore = createMemoryIngestionStatusStore();
await replaceSource({ sourceId: "security-guide", chunks, embedder, store, scope, statusStore }); // atomic with the reference store
console.log(await listIngestionStatus({ store: statusStore, scope }));
const context = createRagContextProvider({ embedder, store, scope, topK: 4 });
```

## API

- `chunkText()` / `chunkMarkdown()` — deterministic boundary-aware character chunks with overlap and stable citations.
- `indexChunks()` — bounded batch embedding and scoped vector upsert.
- `replaceSource()` / `deleteSource()` — exact-scope source lifecycle; replacement requires transactional `getBySource()` storage.
- `replaceDocument()` + `DocumentLoader` / `Parser` — host-authorized load, bounded parse, chunk, and replacement.
- `textParser` / `markdownParser` / `htmlParser` / `pdfParser` — focused reference parsers (`./parsers`); `createResourceDocumentLoader` / `createWebFetchDocumentLoader` are in `./loaders`.
- `retrieveContext()` — bounded candidate query, optional host `Reranker`, shallow metadata filter, top-K hits, attributable citations, and untrusted/inert/injection-capable trust metadata.
- `createMemoryIngestionStatusStore()` / `listIngestionStatus()` — optional capped exact-scope pending/indexed/failed/partial source progress; implement `IngestionStatusStore` for durable status.
- `createRagContextProvider()` — explicit inert context injection through Prism's existing seam.

## Security

Every operation requires tenant/resource/corpus scope. Configure `redactor` or `secrets` before external embedding/persistence. Package performs no I/O: resource loading delegates to a host `ResourceLoader`, and web loading delegates to an existing web-tools adapter. Replacement fails closed without a scoped transaction; rerankers get redacted finite candidates and cannot alter canonical provenance/trust; HTML/PDF/web output is untrusted inert context and grants no tools or permissions.

See [RAG](../../docs/rag.md).
