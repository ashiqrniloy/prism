# Node JSONL session store

## What it does

The optional `@arnilo/prism/node/session-store-jsonl` subpath stores `SessionEntry` records in a caller-named JSONL file: one JSON object per line. `searchSessions` is supported as an unindexed linear scan of the file: the memory-store matcher (workspace/label/summary/`kind` filters, text `query`, cursor pagination, hit pointers) with the contract linear scan caps. Every query reads and parses the whole file (O(corpus) time and memory), so indexed SQLite/Postgres adapters remain the recommended path for search over large corpora.

APIs:

- `createJsonlSessionStore(pathOrOptions)`
- `JsonlSessionStoreOptions`

## When to use it

Use it in Node hosts that want a small durable `SessionStore` without adding a database.

Do not use it for browser code, automatic discovery, shared multi-process locking, migrations, compaction, credentials, app-specific tools, or production multi-writer storage. Use a database-backed `SessionStore` adapter for multi-process or multi-writer durability.

## Inputs / request

```ts
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
```

`pathOrOptions` can be a string path or:

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Explicit JSONL file path to read/write. |
| `createDirectory` | `boolean` | Create parent directories before append. Defaults to `true`. |

## Outputs / response / events

`createJsonlSessionStore()` returns a `SessionStore`:

- `append(entry, options?)` appends one JSON line, rejects duplicate entry ids, honors `expectedParentId` existence checks, and deduplicates exact idempotency retries within this store instance (latest 4,096 keys; an older replay appends as a new entry). Append **fails closed** when the file already contains any corrupt or shape-invalid line (`Invalid JSONL at line N: …`) so writers cannot extend a damaged log.
- `list(sessionId)` reads the file and returns valid entries for that session id. Corrupt or shape-invalid lines are skipped; they do not poison the whole file.
- `get(id)` reads the file and returns the matching valid entry, if any.
- `searchSessions(query)` reads the file and runs the shared linear session matcher. Corrupt or shape-invalid lines are quarantined exactly as in `list()`/`get()`, the contract linear caps bound sessions/entries/bytes scanned, and hits carry the same shape as the indexed adapters (`sessionId`, `leafId`, `entryId`, `runId`, `turn`, `snippet`) — without `score`, since a linear scan has no index relevance.
- `readJsonlSessionEntries(path)` returns `{ entries: SessionEntry[]; errors: SessionEntryParseError[] }` so hosts/tests can inspect per-line parse errors.

Missing files read as empty stores (typed Node `ENOENT`). Invalid JSON, missing required fields, unsupported `schemaVersion`, unknown `kind`, or wrong per-kind shapes (`message`, `summary`, `model_change`, `custom`, `compaction`, `label`, `event`, `metadata`, or non-string `parentId`) are quarantined per line with line number and reason; the raw line is included in `SessionEntryParseError.raw`. Unknown entry kinds and future schema versions fail closed for reads: the line is skipped and never returned by `list()` or `get()`. For writes, any parse error blocks `append()` until the host repairs or replaces the file.

## Request/response example

```json
{
  "path": "./sessions.jsonl",
  "createDirectory": true
}
```

## Implementation example

```ts
import { createJsonlSessionStore, readJsonlSessionEntries } from "@arnilo/prism/node/session-store-jsonl";

const store = createJsonlSessionStore("./sessions.jsonl");
const { entries, errors } = await readJsonlSessionEntries("./sessions.jsonl");
if (errors.length) console.warn("quarantined lines", errors);

// Linear search (unindexed): the same query API as the SQLite/Postgres adapters.
const page = await store.searchSessions!({ workspaceRoot: "/repo", query: "flake", kind: "any", limit: 20 });
// [{ sessionId, leafId, entryId, runId, turn, snippet, ... }]
```

Use `createMemorySessionStore()` for tests or throwaway sessions; use the JSONL store when entries should survive a process restart.

## Extension and configuration notes

- This adapter is an explicit Node subpath. Importing `@arnilo/prism` does not touch the filesystem.
- Hosts choose the file path. Prism does not discover, watch, rotate, compact, or migrate files.
- The adapter stores only `SessionEntry` data passed to `append()`.
- `SessionAppendOptions` idempotency tracking is in memory for the store instance. It resets on process restart and is a development guard, not a durable cross-process coordination mechanism.

## Security and performance notes

- Reads and writes use only the caller-provided path.
- Errors include path/reason or line number, not file contents.
- Do not put secrets in messages, metadata, summaries, labels, or custom entries.
- Each store instance caches the parsed array keyed by `(size, mtimeMs)`. A stat match reuses it; a stat miss re-reads. Reads are linear in file size on a miss. `append()` refreshes the cache after a successful write so the next `list()` / `snapshot()` does not re-parse. A same-size rewrite inside one filesystem timestamp tick is not detected. `readJsonlSessionEntries()` does not use this cache.
- Appends still re-read and re-parse the whole file for duplicate/parent/corruption checks before writing one line, and are serialized per store instance. A rejected append does not poison later appends; the rejected line is not written.
- `searchSessions` has no index. A cache hit reuses the parsed array; a miss reads and parses the whole file before the capped scan, so latency and peak memory still grow with the corpus. Use a SQLite/Postgres `SessionStore` when search latency matters, and treat search here as resume/filter tooling on small stores.
- There is no cross-process lock or durable idempotency table; two processes writing the same file can race. Add a database or external lock if multiple processes write the same file.
- Treat this adapter as development/single-process storage. Production multi-writer hosts should use an indexed database `SessionStore` adapter.

## Related APIs

- [Session stores and branching](session-stores-and-branching.md): `SessionStore`, entries, branch helpers, and runtime branch semantics.
- [Agent/session runtime](agent-session-runtime.md): sessions that append user, assistant, tool-result, and model-change entries.
- [Node filesystem config loader](node-filesystem-config.md): similar explicit Node subpath pattern.
