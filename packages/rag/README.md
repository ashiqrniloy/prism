# @arnilo/prism-rag

Optional bounded text/Markdown retrieval-augmented generation primitives for Prism. Reuses `Embedder` and `VectorStore` from `@arnilo/prism-memory`; no document framework, network loader, or core activation.

## Install

```bash
npm install @arnilo/prism-rag @arnilo/prism-memory @arnilo/prism
```

## Usage

```ts
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { chunkMarkdown, createRagContextProvider, indexChunks } from "@arnilo/prism-rag";

const embedder = createHashEmbedder(); // demo/test only
const store = createMemoryVectorStore();
const scope = { tenantId: "t1", resourceId: "docs", corpusId: "handbook" };
const chunks = chunkMarkdown("# Approval\n\nRecheck policy before side effects.", {
  sourceId: "security-guide",
});
await indexChunks({ chunks, embedder, store, scope });
const context = createRagContextProvider({ embedder, store, scope, topK: 4 });
```

## API

- `chunkText()` / `chunkMarkdown()` — deterministic boundary-aware character chunks with overlap and stable citations.
- `indexChunks()` — bounded batch embedding and scoped vector upsert.
- `retrieveContext()` — bounded candidate query, shallow metadata filter, top-K hits, and citation rendering.
- `createRagContextProvider()` — explicit inert context injection through Prism's existing seam.

## Security

Every operation requires tenant/resource/corpus scope. Configure `redactor` or `secrets` before external embedding/persistence. Package performs no I/O; load remote/local sources through host-owned resource/media policies. Retrieved text is untrusted context and grants no tools or permissions.

See [RAG](../../docs/rag.md).
