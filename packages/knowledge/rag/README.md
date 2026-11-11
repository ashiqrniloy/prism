# @arnilo/prism-knowledge/rag

> **Experimental in 0.13.0.** Install with `bun add @arnilo/prism-knowledge@experimental`. Outside the
> [stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md) of the stable packages: its API,
> config, preset contents and defaults may change or be removed in any release until it graduates.
> Graduation is the memory track's final step, which sets the first stable version.

Retrieval-augmented generation for Prism agents: index local files or URLs, query them with the
`rag_search` tool, optionally inject the result as one `context.build` block, and provide the
`embeddings` service the other memory packages consume.

The package owns the whole 0.12 RAG library — chunking, hybrid retrieval, reciprocal-rank fusion,
reranking (TEI, hosted, local), connectors, knowledge sync, and the ingestion-status store — behind
one entry point. It consumes `web.fetch` from `@arnilo/prism-tools/web` for URL sources and never
fetches a URL itself.

## Install

```bash
bun add @arnilo/prism-knowledge@experimental @arnilo/prism
```

An embedding model comes from a host-registered provider (registered via
`prism.providers.register(...)` or a host provider package); a URL source needs `@arnilo/prism-tools/web` for `web.fetch`.

## Usage

```ts
import { createAgent } from "@arnilo/prism";
import memoryRag from "@arnilo/prism-knowledge/rag";
import hyper from "@arnilo/prism-ai/hyper";

const agent = await createAgent({
  model: "hyper/hyper",
  packages: [
    hyper({ apiKey: "env:HYPER_API_KEY" }),
    memoryRag({
      sources: [{ path: "./docs", glob: "**/*.md" }],
      embeddings: { service: "embeddings" },
      context: false, // the model queries with rag_search; set true to inject one block per turn
    }),
  ],
});
const session = await agent.session();
const answer = await session.run("How does approval protect tool execution?");
```

`rag:reindex` re-reads every source on demand.

## Configuration

| Key | Meaning |
| --- | --- |
| `sources` | `{ path, glob? }` local files or `{ url }` HTTP(S) pages. |
| `embeddings` | `{ model, dimensions?, batchSize? }` builds an `Embedder` over the model's kernel embeddings adapter, or `{ service }` consumes another package's `Embedder`. |
| `store` | `"memory"` (default) or `{ postgres: { connection, schema?, table? } }`. `connection` is a ref. |
| `context` | Register the `context.build` block. Default `false`. |
| `scope` | `{ tenantId?, resourceId?, corpusId? }`; defaults `prism`/`rag`/`default`. |
| `topK` | Hits per retrieval. |
| `reranker` | `{ kind: "none" \| "fake" \| "local" \| "tei" \| "openai-compatible" \| "voyage", … }`. A hosted `apiKey` is a ref. |

## Tools, services, hooks

- `rag_search` (`effects: ["read"]`) — one retrieval per call.
- `embeddings` service — the configured `Embedder`; long-term memory in `@arnilo/prism-memory-system` consumes it.
- `context.build` — registered only when `context: true`; retrieved blocks stay `untrusted`, `inert`, and `injectionCapable`.

## Cost, security, and failure behavior

- **Cost.** Embedding calls happen per indexed chunk batch and per query — never per turn unless
  `context: true`, which adds one retrieval (one query embedding plus an optional rerank request) per
  turn. Indexing runs once, lazily, on the first `rag_search` or `context.build` call; `createAgent`
  makes no network request. The local reranker runtime (`@huggingface/transformers`) is imported only
  when a local reranker is configured.
- **Secrets stay refs.** The hosted-reranker `apiKey` and the Postgres `connection` are `env:` /
  `keyring:` refs resolved through `prism.credentials.resolve`; a literal fails config validation and
  a resolved value never appears in events, `inspect()`, errors, tool results, or persisted entries.
- **Untrusted content.** Retrieved text is stamped `untrusted`, `inert`, and `injectionCapable`; a
  URL source is fetched only through the `web.fetch` service, and a URL source with no service is
  skipped with a note.
- **Bounded.** File walks cap at `HARD_MAX_SOURCE_FILES`; documents, chunks, results, and rerank
  bodies are bounded by the shared `HARD_*` caps; ACL constraints are enforced on retrieval results.
- **Fail closed.** An unknown reranker kind, an unresolvable ref, or a model without
  `capabilities.embeddings` writes a `warn` status note and registers nothing rather than running
  half-configured.

## License

MIT
