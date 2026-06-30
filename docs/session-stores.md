# Session stores

## What it does

Session stores persist `SessionEntry` records for agent sessions. The `SessionStore` contract is the runtime seam: `append(entry)`, `list(sessionId)`, and an optional `get(id)`. Everything else — branch reconstruction, compaction boundaries, redaction, pagination, retention, and multi-tenant ownership — is layered on top by the runtime or by host adapters.

This page describes the store contract, built-in helpers, and where to find the production schema reference.

## When to use it

Use `SessionStore` when you write a host adapter that keeps session entries durable across restarts. Use the built-in `createMemorySessionStore()` for tests and throwaway sessions. Use `createJsonlSessionStore()` from `@arnilo/prism/node/session-store-jsonl` only for single-process development. For production multi-tenant or multi-writer storage, implement a database-backed `SessionStore` or `ProductionPersistenceStore` using the reference schema in [Database persistence](database-persistence.md).

## Inputs / request

```ts
import type { SessionStore, SessionEntry } from "@arnilo/prism";
```

`SessionStore` methods:

| Method | Purpose |
| --- | --- |
| `append(entry, options?)` | Persist one `SessionEntry`. `SessionAppendOptions` can carry `expectedParentId` and an opaque `idempotencyKey`. Rejects duplicate ids within the store. |
| `list(sessionId)` | Return all entries for one session in stored order. Development fallback for branch reads. |
| `get?(id)` | Return one entry by id, if present. Optional. |
| `readBranchPath?(query)` | Optional DB-friendly branch read. Return one branch's ancestor chain as a `PersistencePage<SessionEntry>` so the runtime can avoid `list(sessionId)`. |

Public helpers:

| Helper | Purpose |
| --- | --- |
| `createSessionEntry(options)` | Build a `SessionEntry` with generated `id`/`timestamp` when omitted. |
| `createMemorySessionStore(initialEntries?)` | Built-in in-memory `SessionStore`. |
| `getSessionBranchEntries(entries, options)` | Return root-to-leaf entries for a leaf id (sync array path). |
| `getSessionBranchEntries(reader, query)` | Async overload for a `BranchReader` / `readBranchPath` implementation. |
| `listSessionBranches(entries)` | List every branch handle as `{ leafId, entries }`. Pair with `sessionId` for a durable `(sessionId, leafId)` branch handle. |
| `rebuildSessionContext(entries, options)` | Rebuild provider-context `messages` and `summaries` from a branch, honoring compaction entries (sync array path). |
| `rebuildSessionContext(reader, query)` | Async overload that reads one branch path without a full-session load. |

## Outputs / response / events

A `SessionStore` returns `SessionEntry` arrays. Branch helpers return deep copies. `rebuildSessionContext()` returns `{ leafId, entries, messages, summaries }` where `entries` is the raw branch, `messages` is the provider context, and `summaries` includes compaction summaries.

## Request/response example

```json
{
  "id": "entry_1",
  "sessionId": "s1",
  "timestamp": "2024-06-15T10:00:00Z",
  "kind": "message",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "Hello" }]
  }
}
```

## Implementation example

```ts
import { createMemorySessionStore, createSessionEntry } from "@arnilo/prism";

const store = createMemorySessionStore();
const entry = createSessionEntry({
  sessionId: "s1",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Hello" }] },
});
await store.append(entry);
const entries = await store.list("s1");
```

For a database-backed store, see the reference schema and query shapes in [Database persistence](database-persistence.md).

### Atomic append and branch handles

```ts
import type { SessionAppendOptions, SessionBranchHandle } from "@arnilo/prism";

const handle: SessionBranchHandle = { sessionId: "s1", leafId: "entry_1" };
const options: SessionAppendOptions = {
  expectedParentId: handle.leafId,
  idempotencyKey: "request-42", // opaque host value; never a credential
};
await store.append(entry, options);
```

`SessionAppendConflictError` carries this stable shape:

```ts
{
  code: "session_append_conflict";
  expectedParentId?: string;
  currentLeafId?: string;
  idempotencyDuplicate?: boolean;
}
```

Recognize it with `isSessionAppendConflict(error)`, not message text. Built-in stores reject duplicate entry ids, dangling `expectedParentId` values, and exact idempotency retries. They allow two distinct children of the same existing parent because that is a branch/fork, not parent-order corruption. Production stores may add a stricter branch-tip compare-and-swap when a host wants one-writer linear branches.

## Extension and configuration notes

- The runtime only requires `SessionStore`. Hosts opt into `ProductionPersistenceStore` for paginated reads and audit tables.
- Store adapters own id generation policy, ordering, duplicate detection, idempotency storage, and error handling.
- `AgentSession` uses `AgentSessionConfig.store` before `AgentConfig.store`; otherwise it falls back to a private memory store.
- Branch semantics are parent links plus a leaf id. External UIs should keep branch handles as `(sessionId, leafId)`; RPC exposes an additional `handleId` for active handles.
- Development stores can omit `readBranchPath`; the runtime falls back to `list(sessionId)` and the pure in-memory branch walk. Database-backed stores should implement `readBranchPath` so `entries()`, `clone()`, and context rebuild read only the selected ancestor chain.

## Security and performance notes

- Do not store provider credentials, credential resolvers, provider instances, or unredacted secrets in session entries, append options, idempotency keys, or branch records.
- Use `AgentConfig.redactor` or `RunOptions.redactor` to redact secrets before entries reach durable stores. Stores receive already-redacted `SessionEntry` values.
- `createMemorySessionStore()` keeps O(1) duplicate/idempotency/parent checks in process-local maps; it is not durable.
- The JSONL adapter serializes appends per store instance, has no cross-process lock, and is not suitable for production multi-writer storage.
- Database-backed stores should follow the indexes and retention guidance in [Database persistence](database-persistence.md). Implement `readBranchPath` as a single branch-path query (for example a recursive CTE) and avoid loading entire large sessions into memory when only one branch is needed.

## Related APIs

- [Session stores and branching](session-stores-and-branching.md): detailed branch helpers, compaction boundaries, and runtime branch semantics.
- [Database persistence](database-persistence.md): reference relational schema, indexes, retention, migrations, and NoSQL mapping notes.
- [Node JSONL session store](node-jsonl-session-store.md): development-only file adapter.
- [Agent/session runtime](agent-session-runtime.md): runtime sessions use stores for history, checkout, fork, and clone.
- [Public contracts](public-contracts.md): `SessionEntry`, `SessionStore`, `StoreFactory`, and production persistence contracts.
