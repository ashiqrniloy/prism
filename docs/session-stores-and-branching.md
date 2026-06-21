# Session stores and branching

## What it does

Session store helpers define branch-aware session entries and pure utilities for creating entries, listing branch leaves, reading a leaf path, and rebuilding provider context from a selected leaf.

Public helpers:

- `createSessionEntry(options)`
- `createMemorySessionStore(initialEntries?)`
- `getSessionBranchEntries(entries, options)`
- `listSessionBranches(entries)`
- `rebuildSessionContext(entries, options)`

## When to use it

Use these helpers when a host, runtime session, or store adapter needs durable, branch-aware session data without coupling stores to providers, tools, credentials, or files.

Do not use them as a database layer, migration system, lock service, compaction strategy, retry policy, CLI/RPC protocol, or hidden global store registry.

## Inputs / request

`SessionEntry` has stable branch fields plus typed payloads:

| Field | Purpose |
| --- | --- |
| `id` | Unique entry id. |
| `parentId` | Previous entry on the branch, if any. |
| `sessionId` | Session that owns the entry. |
| `timestamp` | ISO timestamp chosen by the caller/helper. |
| `kind` | `message`, `event`, `summary`, `metadata`, `model_change`, `label`, `custom`, or `compaction`. |
| `runId` | Optional run id. |
| `message`, `event`, `model`, `previousModel`, `label`, `summary`, `data`, `metadata` | Optional payload fields for the entry kind. |

`rebuildSessionContext()` and `getSessionBranchEntries()` accept an optional `leafId`. If omitted, the last entry is used as the leaf. `createMemorySessionStore()` accepts optional initial entries.

## Outputs / response / events

| Helper | Output |
| --- | --- |
| `createSessionEntry()` | A `SessionEntry` with generated `id` and `timestamp` when omitted. |
| `getSessionBranchEntries()` | Ordered entries from root to selected leaf (deep copies). |
| `listSessionBranches()` | Leaf ids and their root-to-leaf entry paths (deep copies). |
| `rebuildSessionContext()` | `{ leafId, entries, messages, summaries }` for provider input rebuild; with a compaction entry, raw `entries` stay intact while `messages` becomes recent context and `summaries` includes the compaction summary. All arrays and objects are deep copies. |
| `createMemorySessionStore()` | Async `SessionStore` with `append()`, `list(sessionId)`, and `get(id)`. `list()` and `get()` return deep copies. |

Helpers throw on duplicate entry ids, unknown leaves, or missing parents. They do not mutate input arrays.

For `kind: "compaction"`, `data` may contain `throughEntryId`, `keepEntryIds`, `strategy`, and `trigger`. The latest valid compaction entry on a branch is used as the provider-context boundary; raw history remains in `entries`.

## Request/response example

```json
{
  "leafId": "entry_2",
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Hi" }] }]
}
```

## Implementation example

```ts
import { createMemorySessionStore, createSessionEntry, rebuildSessionContext } from "prism";

const first = createSessionEntry({
  id: "entry_1",
  sessionId: "s1",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Hi" }] },
});
const label = createSessionEntry({
  id: "entry_2",
  parentId: first.id,
  sessionId: "s1",
  kind: "label",
  label: "investigation",
});

const store = createMemorySessionStore([first]);
await store.append(label);

const context = rebuildSessionContext(await store.list("s1"), { leafId: label.id });
```

## Extension and configuration notes

Stores and extensions can use these data helpers directly. Store adapters only need append/list/get behavior; branch queries are derived in memory from listed entries.

`createMemorySessionStore()` is the built-in in-memory implementation. It preserves append order per session, isolates session ids, returns entries by id in O(1), rejects duplicate entry ids, and returns deep copies from `list()` and `get()`. It is process memory only; hosts that need durability should pass another `SessionStore`.

`getSessionBranchEntries()` and `rebuildSessionContext()` also return deep copies of entries and messages, so callers cannot mutate the input arrays or the memory store by editing returned objects.

`AgentSession` uses `AgentSessionConfig.store` before `AgentConfig.store`, otherwise a private memory store. It appends user, assistant, tool-result, and model-change entries, resumes from `leafId`, rebuilds provider history from the selected branch, checks out old leaves, forks by selecting a leaf in the same session, and clones the selected branch to a new session id.

Node hosts that need simple file durability can import `createJsonlSessionStore()` from the explicit `prism/node/session-store-jsonl` subpath.

Use `createDefaultCompactionStrategy()` to create compaction entries that `rebuildSessionContext()` understands. Compaction adds summaries; it does not delete or rewrite raw store entries.

`createSessionEntry()` accepts injectable `createId` and `now` functions for deterministic tests or host id policy. Prism does not create a global store or id service.

## Security and performance notes

- Helpers are pure data functions: no provider calls, tool calls, settings reads, credential resolution, filesystem access, network access, timers, or dependencies.
- Store only host-approved session entries. Do not put provider credentials, credential resolvers, provider objects, full provider requests, or secrets in entries.
- Branch rebuild is linear over listed entries and uses `Map`, `Set`, and arrays only.
- Compaction-aware rebuild keeps raw branch entries in `entries`; only provider-context `messages`/`summaries` are reduced.
- Memory store lookup by id is O(1); list is O(n) for that session.
- Duplicate ids and missing parents fail clearly instead of guessing a branch.

## Related APIs

- [Public contracts](public-contracts.md): `SessionEntry`, `SessionStore`, `StoreFactory`, and session contracts.
- [Agent/session runtime](agent-session-runtime.md): runtime sessions use these branch helpers for store-backed history, checkout, fork, and clone.
- [Node JSONL session store](node-jsonl-session-store.md): optional Node filesystem store for caller-named JSONL files.
- [Compaction and retry policies](compaction-and-retry.md): default strategy for creating compaction entries.
- [Input and prompt assembly](input-and-prompt-assembly.md): provider input assembly consumes rebuilt `messages` and `summaries`.
- [Credentials and redaction](credentials-and-redaction.md): security boundary for secrets that must not enter session entries.

Session stores persist the entries they receive. Configure `AgentConfig.redactor` or `RunOptions.redactor` before a run when known secrets must be removed before entries reach durable stores.
