# Node JSONL session store

## What it does

The optional `prism/node/session-store-jsonl` subpath stores `SessionEntry` records in a caller-named JSONL file: one JSON object per line.

APIs:

- `createJsonlSessionStore(pathOrOptions)`
- `JsonlSessionStoreOptions`

## When to use it

Use it in Node hosts that want a small durable `SessionStore` without adding a database.

Do not use it for browser code, automatic discovery, shared multi-process locking, migrations, compaction, credentials, or app-specific tools.

## Inputs / request

```ts
import { createJsonlSessionStore } from "prism/node/session-store-jsonl";
```

`pathOrOptions` can be a string path or:

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Explicit JSONL file path to read/write. |
| `createDirectory` | `boolean` | Create parent directories before append. Defaults to `true`. |

## Outputs / response / events

`createJsonlSessionStore()` returns a `SessionStore`:

- `append(entry)` appends one JSON line and rejects duplicate entry ids.
- `list(sessionId)` reads the file and returns entries for that session id.
- `get(id)` reads the file and returns the matching entry, if any.

Missing files read as empty stores. Invalid JSON or non-entry lines fail with the line number and do not include file contents.

## Request/response example

```json
{
  "path": "./sessions.jsonl",
  "createDirectory": true
}
```

## Implementation example

```ts
import { createAgent } from "prism";
import { createJsonlSessionStore } from "prism/node/session-store-jsonl";

const store = createJsonlSessionStore("./sessions.jsonl");
const session = createAgent({
  model: { provider: "mock", model: "demo" },
  store,
}).createSession({ id: "s1" });

await session.entries();
```

Use `createMemorySessionStore()` for tests or throwaway sessions; use the JSONL store when entries should survive a process restart.

## Extension and configuration notes

- This adapter is an explicit Node subpath. Importing `prism` does not touch the filesystem.
- Hosts choose the file path. Prism does not discover, watch, rotate, compact, or migrate files.
- The adapter stores only `SessionEntry` data passed to `append()`.

## Security and performance notes

- Reads and writes use only the caller-provided path.
- Errors include path/reason or line number, not file contents.
- Do not put secrets in messages, metadata, summaries, labels, or custom entries.
- Reads are linear in file size. Appends are serialized per store instance.
- There is no cross-process lock; add a database or external lock if multiple processes write the same file.

## Related APIs

- [Session stores and branching](session-stores-and-branching.md): `SessionStore`, entries, branch helpers, and runtime branch semantics.
- [Agent/session runtime](agent-session-runtime.md): sessions that append user, assistant, tool-result, and model-change entries.
- [Node filesystem config loader](node-filesystem-config.md): similar explicit Node subpath pattern.
