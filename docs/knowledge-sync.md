# Knowledge synchronization

## What it does

`syncKnowledge` in `@arnilo/prism-memory/rag` pages an injected `KnowledgeConnector`, applies source upserts/deletes/ACL/withhold actions through existing `replaceSource` / `deleteSource` / `setSourceAccess`, and compare-and-swaps an opaque resume cursor on a host `CheckpointStore` **only after that page is fully committed**. Unchanged content hashes skip embedding. Source freshness (`current` / `stale` / `unavailable`) is recorded on ingestion status. `createGoogleDriveConnector` is the first connector: Drive `files.list` bootstrap plus `changes.list` incremental sync.

## When to use it

Use it when a host must keep a RAG corpus aligned with an enterprise file source without a full re-index and without trusting notification payloads as authorization. Do not use it as a general crawler, as a substitute for work-connector file tools, or as a way to infer group membership from Drive.

## Inputs / request

| API/field | Meaning |
| --- | --- |
| `syncKnowledge({ connector, checkpoints, checkpoint, store, embedder, scope, ... })` | Runs at most `maxPages` committed pages. |
| `KnowledgeConnector.listChanges({ cursor, limit, signal })` | Returns `{ changes, resumeCursor, done }`. `done` means caught up. |
| `KnowledgeChange` | `upsert` (text + contentHash + grants), `delete`, `acl`, or `withhold` (`stale` / `unavailable`). |
| `createGoogleDriveConnector({ tokenProvider, resolveAccess, driveId?, folderId? })` | Drive adapter. Token is resolved per request. `resolveAccess` is host-owned ACL mapping. |
| `onInvalidCursor` | `"resync"` (default) restarts bootstrap once; `"fail"` throws `RagSyncCursorError`. |
| `pageSize` / `maxPages` / `maxRetries` | Defaults 50 / 8 / 3; hard caps 200 / 64 / 8. |

`authorization` on retrieve remains host-verified RAG ACL from Task 11. Empty grants withhold. Missing ACL capability on the store fails closed.

## Outputs / response / events

- `{ pages, upserted, deleted, skipped, withheld, cursor?, exhausted }`
- Cursor value `{ v: 1, cursor }` under the host checkpoint namespace/key. Crash before CAS replays the same page; `contentHash` skip makes replay embed-free.
- Ingestion status `freshness` is `current` after a granted upsert, `stale`/`unavailable` after withhold. Deletes remove status.

No tools, no watch-channel authorization, no events.

## Delete contract

A connector `delete` change calls `deleteSource()` for that source only: the connector's own chunk rows and ingestion status go away, under exact tenant/resource/corpus scope. Connector payloads are never authorization, so sync cannot reach beyond the corpus it owns — derived artifacts (summaries, observational-memory entries, compiled wiki pages, host projections) survive sync deletes by design. Removing those is a separate privileged pass through `createDeletionPropagator().propagate(sourceId)` (see [RAG deletion propagation](rag.md#deletion-propagation)), driven by the host, not by the connector.

## Request/response example

```json
{
  "scope": { "tenantId": "t1", "resourceId": "docs", "corpusId": "drive" },
  "result": { "pages": 1, "upserted": 2, "deleted": 0, "skipped": 0, "withheld": 1, "exhausted": false }
}
```

## Implementation example

```ts
import { createMemoryCheckpointStore } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { createGoogleDriveConnector, syncKnowledge } from "@arnilo/prism-memory/rag";

const store = createMemoryVectorStore();
await syncKnowledge({
  connector: createGoogleDriveConnector({
    tokenProvider: () => process.env.DRIVE_TOKEN!, // resolved at the HTTP edge only
    resolveAccess: (permission) =>
      permission.type === "user" && permission.emailAddress ? { principalId: permission.emailAddress } : undefined,
  }),
  checkpoints: createMemoryCheckpointStore(),
  checkpoint: { namespace: "prism.rag.sync", key: "handbook", tenantId: "t1" },
  store,
  embedder: createHashEmbedder(),
  scope: { tenantId: "t1", resourceId: "docs", corpusId: "handbook" },
});
```

Drive `changes.watch` payloads are wake-ups only — call `syncKnowledge` again; never treat a notification body as ACL or content.

## Extension and configuration notes

- Any `KnowledgeConnector` can be injected; only Google Drive ships. Hosts own OAuth (`drive.readonly` via `createGoogleWorkspaceOAuthProvider({ capabilities: ["files"] })`), checkpoint durability, and `resolveAccess`.
- Shared drives: pass `driveId`. Folder-scoped bootstrap: pass `folderId` (Drive identifier charset only).
- Unsupported Google-native types (Sheets, Slides, folders) are skipped. Google Docs export as `text/plain`. Public `anyone`/`domain` permissions withhold the file unless `resolveAccess` maps them.
- Task 14 can schedule `syncKnowledge` as an ordinary workload; this package does not add a second scheduler.

## Security and performance notes

- Credentials never enter argv, cursors, status, or logs. Token header only.
- Model-supplied metadata `filter` is still not authorization. Notification payloads are not authorization. Unmapped groups are omitted, not inferred. Unmapped `anyone`/`domain` withholds the source.
- 403 on content → `unavailable` withhold (empty grants). 404/`removed`/`trashed` → delete. 400/410 page tokens → `RagSyncCursorError`. 429 → `RagSyncThrottleError` with bounded retries.
- Pages are bounded. Unchanged hashes perform no embedding. Only committed pages CAS the cursor.

## Related APIs

- [Retrieval-augmented generation](rag.md): `replaceSource`, document ACL, retrieval.
- [Work connectors](work-connectors.md): GWS CLI file tools are a different surface.
- [Credentials and redaction](credentials-and-redaction.md): OAuth token providers.
- [Live and end-to-end testing](live-testing.md): `PRISM_TEST_DRIVE_ACCESS_TOKEN` skip-not-fail probe.
