# @arnilo/prism-memory-core

The memory contracts, in-memory, SQLite, Postgres, and markdown vector stores, lineage, deletion propagation, source
repointing, recall scoring, limits, and JSON-schema helpers that `@arnilo/prism-memory-rag`,
`@arnilo/prism-memory-fabric`, `@arnilo/prism-memory-wiki`, and `@arnilo/prism-memory-observational`
share, so four packages cannot drift on how a memory record is scoped, scored, invalidated, or
stored.

This is a **plain library**: it is not an agent package, default-exports no `definePackage`, claims
no slot, and changes nothing on its own. Nothing in the kernel imports it, and installing it with
`prism add` is meaningless — a host gets it transitively through the memory packages.

## Install

```bash
bun add @arnilo/prism-memory-core
```

A host needs it only when it imports a memory package directly; the memory packages depend on it
themselves.

## Usage

```ts
import { createHashEmbedder, createInMemoryVectorStore, type VectorStore } from "@arnilo/prism-memory-core";
// The Postgres stores are the one heavy dependency, so they live behind a subpath.
const { createPostgresVectorStore } = await import("@arnilo/prism-memory-core/postgres");
```

## What it provides

| Export group | Symbols | Purpose |
| --- | --- | --- |
| Contracts | `Memory`, `Embedder`, `VectorStore`, `WorkingMemoryStore`, `MemoryScope`, `MemoryVectorRecord`, `MemoryLimits` | The types every memory package implements or consumes. |
| Embeddings | `createHashEmbedder`, `embedBatched`, `HashEmbedderOptions` | The deterministic hash embedder (tests and offline hosts) and bounded batching over any `Embedder`. |
| Vector stores | `createMemoryVectorStore`, `createInMemoryVectorStore`, `selectAdjacentRecords`, `tokenizeLexical` | The in-memory vector store with lexical and vector queries. |
| Lexical analysis | `lexicalTerms`, `stemLexical`, `lexicalCoverage`, `lexicalMatches`, `lexicalDice`, `lexicalKeys`, `recordLexicalTerms`, `lexicalTermString` | The one analyzer every lexical leg uses: Unicode letter/number terms, stopwords dropped, conservative English stemming. Index, query, and coverage use the same terms. |
| Postgres (`./postgres`) | `createPostgresVectorStore`, `createPostgresMemoryStores`, `queryPostgres`, `buildMemoryDdl`, `buildVectorSearchDdl`, `qualifyTable`, `quoteIdentifier`, `validateIdentifier` | The `pg`-backed vector and memory stores, DDL builders, and identifier validation. `pg` loads only here. |
| SQLite (`./sqlite`) | `createSqliteMemoryStores`, `buildSqliteMemoryDdl`, `SqliteMemoryStoresOptions`, `SqliteMemoryStores` | Durable vector and working memory using Bun SQLite, exact cosine, and FTS5 BM25 over analyzed terms, with note keys weighted 3× the body. Schema version 2. The driver loads only when constructing the stores. |
| Markdown (`./fabric`) | `createMarkdownMemoryStores`, `CreateMarkdownMemoryStoresOptions`, `MarkdownMemoryStores`, `MarkdownReconcileReport` | OKF v0.2 markdown files as the canonical store with a derived, rebuildable SQLite index. Notes are human-readable and greppable under `<tenant>/<resource>/<kind-dir>/` (`facts`, `preferences`, `procedures`, `episodes`); control state lives in `.state.json`; `reconcile()`/`rebuild()` re-derive the index, and `updateResourceFile()` writes a resource-level file such as `project.md` under the store lock. |
| Lineage and deletion | `stampLineage`, `parseLineage`, `invalidateAcrossLayers`, `recordBlocked`, `listInvalidatedIds`, `revokedIdsAbsent`, `createDeletionPropagator` | Append-only invalidation records, layer ordering, and the deletion propagator over `DeletionPropagationHandler`s. |
| Repointing | `repointSource`, `applySourceRenames`, `HARD_REPOINT_RECORDS` | Move or rename an indexed source without re-embedding. |
| Scoring | `resolveRecallScoring`, `rerankRecallHits`, `clampImportance`, `deriveEntryImportance`, `recencyOf` | Composite recall scoring (similarity, recency, importance) with the documented tie-break. |
| Limits and validation | `resolveMemoryLimits`, `HARD_*` caps, `estimateTokens`, `validateAgainstJsonSchema`, `mergeJsonObjects`, `assertFiniteVector`, `assertRecordEmbedding` | The shared caps, token estimate, and JSON validation the packages bound their inputs with. |
| Errors | `MemoryError`, `MemoryValidationError`, `MemoryLimitError`, `MemoryScopeError`, `MemoryConflictError`, `MemoryAbortError` | The one error family every memory package throws. |

## Cost, security, and failure behavior

- **No model calls and no network.** The library embeds only through the `Embedder` it is handed;
  the default `createHashEmbedder` is local and deterministic. The Postgres stores open a connection
  only when a caller constructs one.
- **No secret reads.** The library never reads `process.env`. A Postgres connection, reranker key,
  or connector token is supplied already resolved by the consuming package.
- **`pg` is optional and lazy.** The root entry imports no `pg`; only `@arnilo/prism-memory-core/postgres`
  does, and it loads the driver dynamically. An agent that never touches the Postgres store never
  loads it.
- **Bounded by construction.** Every input is checked against the shared `HARD_*` caps before it
  reaches a store, and `assertFiniteVector` rejects a non-finite or wrong-dimension vector.
- **Fail closed.** A scope mismatch, an invalid identifier, a malformed cursor, an unsafe JSON key,
  or a non-JSON merge value throws the typed memory error instead of writing a partial record.
- **Deletion is append-only.** Invalidation is recorded as lineage metadata; a record is never
  mutated in place, so a revoked id stays revoked across layers and a resume.

## Batched lookup

`Memory.get(ids, { signal? })` returns redacted records from the bound tenant/resource/thread,
excluding invalidated, held, and revoked records and enforcing strict consent when configured.
Empty ids return an empty array; duplicates are collapsed; batches cap at 1,000 ids.
The in-memory, SQLite, and Postgres stores implement `VectorStore.getByIds(scope, ids, options)`;
custom stores must supply it for fabric link expansion. Raw store lookup returns stored records;
the `Memory` layer applies consent and invalidation before exposing them.

## Lexical retrieval and embedding-less records

A record may carry `embedding: []` (and no `embedderId`): a lexical-only record. All three stores
accept it, skip it in the vector leg, and return `[]` for a vector query with an empty embedding.
Every `lexicalQuery` matches any analyzed query term (OR) and sets `coverage`, the share of the
query's terms the record's text and keys contain, in [0,1]. Keys are the fabric note's keywords,
tags, context, and path (`lexicalKeys`). SQLite ranks by BM25 with keys weighted 3× the body;
Postgres ranks by `ts_rank` over its english `tsvector` of the text only; the in-memory store ranks
by coverage. The Postgres store allows a NULL embedding column for lexical-only rows.

`createMemory` derives its retrieval mode from the embedder: an embedder means `hybrid`
(vector + lexical fused with `fuseRankings`), no embedder means `lexical` (the store's
`lexicalQuery` alone). The mode is exposed as `Memory.retrieval`. `minSimilarity` checks the
active mode's [0,1] similarity: vector cosine before fusion in hybrid mode, query-term coverage
in lexical mode. Hybrid hits expose the vector cosine as `similarity` and their retrieval leg;
lexical hits expose `coverage`.
`fuseRankings` exposes each candidate's RRF `score` separately from the original hit score.

## Directory aggregates

`Memory.countByKind({ asOf?, signal? })` and `Memory.topTags({ asOf?, limit?, signal? })` summarize the
bound thread's active fabric notes (`metadata.fabric.kind`) for the fabric's memory directory. A note is
active when it is inside its `validFrom`/`validTo` window at `asOf` (default now; a malformed timestamp
excludes it), has visible consent, is not invalidated, and is not `metadata.status: "candidate"`.
`topTags` unions each note's `tags` and `keywords`, counts a tag once per note, and orders by count
descending then tag ascending; `limit` defaults to 20 and caps at 500.

The in-memory store scans; SQLite and Postgres run one `GROUP BY` (SQLite over `json_extract` /
`json_each`, Postgres over `jsonb`). Both are optional `VectorStore` members (`countByKind`, `topTags`);
a custom store without them makes the `Memory` methods throw `MemoryScopeError`, and the directory
then omits counts. The shared memory conformance suite checks all three stores against the same fixture.

## Lifecycle scan, resources, and the scope clock

Three optional `VectorStore` members serve the fabric's maintenance pass (plan 188.4):

- `scanMetadata({ scope, limit, cursor? })` pages `{ id, metadata, createdAt, lastAccessedAt }` over
  every thread of one resource, ordered by `(threadId, id)`. It never returns text or embeddings, so
  a pass over a project costs metadata only. `scope` is `{ tenantId, resourceId }` — no thread — and
  `nextCursor` is opaque. Rows follow export rules: explicit `consent.visible: true` and not blocked
  by an invalidation (a legal hold or a forgotten derived note stays out).
- `listResources({ tenantId, prefix? })` returns the distinct resource ids of a tenant, optionally
  narrowed to a literal id prefix, for scope widening across projects.
- `scopeCounter.get` / `scopeCounter.increment({ tenantId, resourceId, name })` is one atomic,
  non-negative integer per resource. The only name is `"sessions"`: the fabric ticks it once per
  session per active scope, so decay and archival count sessions worked rather than calendar days.

Each is optional, and the shared conformance suite skips the blocks a store does not declare. The
fabric's `maintain()` fails closed with `MemoryValidationError("maintenance requires scanMetadata")`
on a store without the scan; recall and writes are unaffected. SQLite keeps the counter in
`memory_scope_counter` and mirrors `status`, `storage` (`importance`), and `last_use_ordinal` as
columns so the scan never parses record JSON; schema v3 migrates a v2 index and backfills those
columns. The markdown store keeps the counter in `<resource>/.state.json` (the index cannot rebuild
it) and delegates the scan and listing to its index. Postgres adds
`<table>_scope_counter` with `CREATE TABLE IF NOT EXISTS`, so reopening is idempotent.

## SQLite persistence

```ts
const { createSqliteMemoryStores } = await import("@arnilo/prism-memory-core/sqlite");
const stores = await createSqliteMemoryStores({ path: "./memory.sqlite", dimensions: 64 });
// Pass stores.vectorStore and stores.workingStore to the memory consumer.
// Close after all memory operations finish.
stores.close();
```

Requires Bun >=1.4.2 and an existing parent directory. New files use mode 0600; existing
file permissions are preserved. Unknown schemas and corrupt files fail with
`MemoryValidationError`. Optional dimensions are persisted and checked on reopen.
Each write batch and working-memory version check commits atomically. Scope, ACLs,
invalidation (including legal holds), generation pointers, consent metadata, and share
grants survive reopening. Share grants are isolated by tenant, resource, and parent thread.

Vector search scores every row in the exact scope: O(rows × dimensions) for cosine
scoring, followed by sorting. This is intended for about 50k notes per scope; use
Postgres+pgvector beyond that scale. Lexical search uses the FTS5 index and BM25, with
larger returned scores ranking first. Query text is treated as literal Unicode tokens
joined with OR, rather than FTS operators. Both searches apply ACL and invalidation
filters before selecting topK. The caller controls path containment; this library does
not enforce a filesystem root.

## Markdown stores (`./fabric`)

```ts
const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
const stores = await createMarkdownMemoryStores({ root: "./memory/notes" });
// stores.vectorStore / stores.workingStore satisfy the same contracts as the SQLite stores.
// stores.reconcile() re-indexes changed files; stores.rebuild() re-indexes every file.
await stores.close();
```

The files are canonical and the SQLite index at `<root>/.index.sqlite` is a derived, rebuildable
cache. Each durable record is an OKF v0.2 markdown file at
`<root>/<tenant>/<resource-path>/<dir>/<slug>--<id8>.md`, where `<resource-path>` is `resourceId`
split on `/` (1–4 validated, percent-escaped segments) and `<dir>` is `facts`, `procedures`,
`episodes`, or `entries` (`archive/<dir>` for superseded, expired, `status: archived`, or
invalidated notes). The thread is never a path segment: it is `prism.thread_id` in the frontmatter
and an index column, and every query still filters by it. `file`-kind records are index-only; the
user's file is the source and file reconcile re-derives them.

Frontmatter carries the OKF fields (`type`, `title`, `description`, `tags`, `keywords`, `status`,
`valid_from`, `valid_to`, `supersedes`, `sources[]`, `generated`) plus a `prism:` map with `id`,
`scope`, `thread_id`, `sequence`, `created_at`, `importance`, `consent`, `last_accessed_at`,
`embedder_id`, `generation`, `flags`, and the remaining record metadata. An editable OKF field wins
over its `prism` duplicate on read, and records round-trip exactly. Values are emitted as JSON (a
YAML 1.2 subset) and parsed with `Bun.YAML`. Embeddings are never written to files; with
`dimensions` set they live only in the index, so a rebuild without an embedder leaves them empty and
recall degrades to lexical.

Working memory is `<resource-path>/working/<thread>.md` (a header plus one fenced `json` block;
malformed content fails closed naming the file). Control state — invalidations, ACL grants, share
grants, and generation pointers — is `<resource-path>/.state.json`, keyed by thread inside and
written atomically; it is the source of truth and is replayed into a rebuilt index.

Writes take a cross-process `<root>/.lock` (`open wx`, 5 s retry, stale after 30 s when the owner
pid is gone) and are queued in-process. A write puts the file first (temp file + `rename`) and then
the index transaction; a delete unlinks the file then the row. `index.md` (OKF §8 root) and `log.md`
(newest first, ids and verbs only, capped at 2,000 entries with older ones rotated to
`log-<yyyy>.md`) are rewritten under the lock after each batch. Open creates (or migrates to) the schema-v3 index and
reconciles in bounded batches; a missing or corrupt index is rebuilt from files plus `.state.json`.

Every path resolves under `root` with a `realpath` check, files are written `0o600` and directories
`0o700`, and `log.md` never contains note text. Legal-hold notes refuse `forget` and keep their files.

## License

MIT

## Scoring and shared context

Unrated importance is neutral `0.5`. With `recencyWeight > 0`, `halfLifeMs` is required;
`recencyBasis` defaults to `"accessed"` and decays from `lastAccessedAt`, falling back to
`createdAt`. Choose `"created"` to retain creation-based decay.

`Memory.touch(ids)` marks used entries with one batched upsert and preserves their content,
consent, and importance. Recall never touches automatically: passive injection must not
reinforce irrelevant memories. Call touch only for explicit recall or cited ids when using
access-based recency (at most one write batch per recall and one per turn with citations).

`fuseRankings(lists, { k: 60 })` merges `{ hits, leg: "vector" | "lexical" }` rankings by RRF;
`k` defaults to 60. Scope is part of identity, ties are deterministic, and the first hit's
original score is preserved. This replaces RAG's `fuseReciprocalRank` export.

`withTailContext(draft, blocks)` inserts one system message before the latest user message,
or appends when there is no user. It preserves the prefix and later tool rounds and attaches
`metadata.contextBlocks` with each block's title, source, itemIds, and token estimate.
Pass source/itemIds/tokens in each block's metadata; absent tokens are estimated.
Apply it on every model call with a `context.build` hook priority below `-1000`, after
context engineering's fold/budget handler. The helper changes only the provider view.
