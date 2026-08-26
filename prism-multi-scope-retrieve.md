# Prism multi-scope retrieve (one embed, global RRF + rerank)

Status: **requested** — filed against Prism `@arnilo/prism-rag` (published `0.3.0` and the unpublished P1–P8 working tree). Sibling of [`prism-production-rag.md`](prism-production-rag.md) (P1–P8). Synapta Plan 082 cannot implement the architecture query pipeline until a release accepts `RagScope[]` on one `retrieveContext` call. Architecture: [`docs/architecture/knowledge-rag.md`](../architecture/knowledge-rag.md) § Query pipeline.

## Summary

P1–P8 make one exact `RagScope` production-shaped. Synapta Ask/Do retrieve is **three corpora on every turn**:

```text
allowed = [org if knowledge.view, user, current session]
```

`retrieveContext` still takes one `scope`. Host fan-out (one call per corpus) is not an engine:

- embeds the same query N times
- RRF and TEI rerank run **per corpus**, not over the union
- CitationList rank becomes host-invented
- `retrieveContext` does not return pre-fusion legs, so the host cannot fuse correctly

Synapta will not write a second ranker. Prism should search every allowed exact scope in one call.

## Why Synapta wants it

Plan 082 / Decision OS plane F: one `retrieve_knowledge` tool, top 8, hybrid + TEI rerank, `CitationList` from that list. Worker builds allowed `RagScope[]` from trusted context and OpenFGA; Prism must not see OpenFGA. Without a multi-scope API the host either:

1. retrieves three independent top-8s and guesses a merge, or
2. reimplements embed → vector + lexical → RRF → rerank outside Prism.

Both violate “Prism owns the RAG engine.”

Demand: one embed, per-scope search, **one** RRF, **one** rerank, top 8. p95 still in the low hundreds of ms at ~100k chunks.

## Requested behavior

`retrieveContext` accepts one or many exact scopes. Singular `scope` stays (compat). `scopes` is the production path.

```ts
retrieveContext(query, {
  embedder, store,
  scopes: RagScope[],          // 1..N exact scopes; empty → no hits, no embed
  // scope?: RagScope          // still valid; equivalent to scopes: [scope]
  lexical?: "fts" | "bm25" | "off",
  fusion?: "rrf",
  rrfK?: number,
  topK: 8,
  queryCandidates?: number,
  reranker?,
  telemetry?,
  signal?,
});
```

Rules:

- **Reject both `scope` and `scopes`.** One or the other.
- **Empty `scopes`:** return `{ hits: [], citations: [], truncated: false }` (or the existing empty result). Do not embed. Do not search. This is the host’s “no allowed corpora” path (`knowledge.view` missing and no user/session rows).
- **Each scope is still exact.** `tenantId` / `resourceId` / `corpusId` (`threadId` on the store). A hit whose stored scope is not in the requested list fails closed, same as today for a foreign row.
- **One query embed.** Reuse that vector for every scope’s vector leg.
- **Per-scope legs.** Vector (and lexical when requested) run per scope against that scope’s current generation + embedder assert (P3/P6). Do not UNION the tables first and filter later.
- **One fusion.** RRF over the union of all legs. `retrievalRank` is the global pre-rerank rank.
- **One rerank.** Optional `Reranker` sees the fused candidate list once, then `topK` cuts.
- **Provenance.** Every hit/citation keeps the scope it came from (`tenantId`, `corpusId` / thread). Host maps that to org / user / session on `CitationList`.
- **Caps unchanged.** `queryCandidates` is per scope (or document a single global cap — pick one and test it). Byte / topK / rerank caps stay.

OTel (P7): same `rag_request` tree. Add `rag.scope_count`. `chunk_retrieved` already has `sourceId`; include enough to recover which requested scope produced the hit (tenant + corpus / thread). Still no raw text by default.

## Existing behavior to keep

- Fail-closed foreign-scope rows.
- `trust: { untrusted: true, inert: true, injectionCapable: true }` on every hit/citation.
- Reranker cannot overwrite provenance / trust / scope.
- Embedder mismatch still throws `ERR_PRISM_RAG_EMBEDDER_MISMATCH` (any scope).
- Generation filter still `generation === current` **per scope**. Scopes may have different current generations.
- `createRagContextProvider` keeps working. If it grows a `scopes` option, fine; Synapta Ask uses a host tool, not auto-inject.
- Single-`scope` callers and tests stay green.

## Out of scope (do not add)

- OpenFGA / host ACL predicates inside retrieve. Worker still drops leftovers after Prism returns.
- Cross-tenant retrieve. Every scope’s `tenantId` is the host’s current org; Prism does not need a “same tenant” assertion beyond exact-scope match.
- Graph / parent-document expansion across corpora.
- Changing default `topK` or adding a second ranker API.
- Anything in [`prism-production-rag.md`](prism-production-rag.md) P1–P8 (ship those; this request assumes they exist).

## Acceptance criteria

- `retrieveContext` with three scopes, one distinctive chunk per corpus: fused+reranked `hits.length <= topK`, all three sources can appear, each hit’s scope matches exactly one requested scope.
- Query embed is invoked **once** (spy on `embedder.embed`) for N>1 scopes.
- Reranker (fake permutation) is invoked **once** on the fused union, not once per scope.
- `scopes: []` returns no hits and does not call `embed` / `store.query` / `lexicalQuery` / `reranker`.
- Passing both `scope` and `scopes` throws a validation error.
- A row stored under `{ tenantId: "org_a", corpusId: "user_other" }` never appears when `scopes` is org + `user_self` + session.
- Embedder-B query against embedder-A vectors in **any** requested scope still throws `ERR_PRISM_RAG_EMBEDDER_MISMATCH`.
- Single-`scope` tests from P2/P3/P6/P7 stay green. Memory store + hash embedder stay enough for this FR.

## Suggested package surface

```ts
// @arnilo/prism-rag
retrieveContext(query, {
  scope?: RagScope,
  scopes?: readonly RagScope[],
  lexical?: "fts" | "bm25" | "off",
  fusion?: "rrf",
  ...
})
```

Exact option names may change; Synapta 082 will pin the shipped names. Do not add a second function (`retrieveContextMulti`) unless `scope` cannot be extended.

## Reproduction (current gap)

```ts
import { retrieveContext } from "@arnilo/prism-rag";

// Published 0.3.0 and the unpublished P1–P8 tree both require:
retrieveContext(query, { embedder, store, scope: oneScope, topK: 8 });

// Architecture needs:
// retrieveContext(query, { embedder, store, scopes: [org, user, session], lexical: "fts", fusion: "rrf", topK: 8, reranker });

// Host workaround today: N retrieveContext calls → N embeds, N RRFs, N reranks, broken CitationList rank.
```
