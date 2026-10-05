# @arnilo/prism-store-jsonl

One JSONL file per session under a directory, as the `store` slot: session entries survive a process
restart without a database.

## Install

```bash
prism add @arnilo/prism-store-jsonl
```

```jsonc
// manifest entry, with every config field that has no default
{
  "name": "@arnilo/prism-store-jsonl",
  "version": "^0.12.1",
  "integrity": "sha512-…",
  "config": { "dir": ".prism/sessions" }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `dir` | `string` | none (required) | Directory holding the session files. A relative path resolves against the process cwd. Missing `dir` fails the package load with a field-naming error. |

## What it changes

Claims the `store` slot with `createJsonlSessionStore({ dir })`. Every session id gets its own file:
`<dir>/<sessionId>.jsonl`, one `SessionEntry` per line. The kernel appends through the slot, so
`suspended_run` records, `package_state` snapshots, titles, and labels all land in the file and are
read back on the next process.

Named exports: `createJsonlSessionStore`, `readJsonlSessionEntries`, `JsonlSessionStoreError`,
`JSONL_FILE_READS`/`JSONL_BYTES_READ` (test-only counters), `jsonlStore({ dir })` (the instance
shorthand), and the default package definition.

Exact-retry dedup (`idempotencyKey` with the same `expectedParentId`) is persisted in
`<dir>/.idempotency.json` next to the session files, so a retry after a restart is still rejected.

## Capabilities

`slot:store` — the package provides the agent's session store and asks for nothing else. It registers
no tools, skills, commands, providers, hooks, or services, and writes no session state of its own.

`listSessions`, `deleteSession`, and `searchSessions` are implemented, so `agent.sessions.list()`,
`.delete()`, and `.search()` are available. `mergeSessionMetadata` is not implemented: the title is
read from `metadata.title` on a session's entries.

## Cost, security, and failure behavior

Cost per call:

- `append` parses that session's file (O(session length)) and appends one line.
- `list(sessionId)` and `get(id)` parse the session's file; `get` scans the directory.
- `listSessions` reads the directory plus the **first and last line** of each session file (two chunk
  reads per file) — never the transcript. `messageCount` therefore counts the sampled message entries
  (0–2), and the scope filter and title come from those same two lines.
- `searchSessions` reads and parses the whole directory (O(corpus) per query, no index), then applies
  the kernel's linear matcher so JSONL and memory results are identical.
- `deleteSession` removes one file (`false` for an absent session or one outside the scope).

Fail-closed behavior:

- A session id outside `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` (a path separator, `..`, an absolute path)
  throws `JsonlSessionStoreError` with code `invalid_session_id`, before any filesystem call.
- A line that does not parse stays quarantined: reads skip it, and `append` refuses to touch the file
  (`Invalid JSONL at line N`) so a corrupt session never silently gains entries.
- `listSessions` and `deleteSession` apply the ownership scope from the sampled first and last lines;
  a session whose stamps do not match is invisible and cannot be deleted.
- A corrupt or missing `.idempotency.json` costs dedup only; it never blocks an append.
- Multiple processes (or two store instances) writing the same directory can still race; the store is
  single-process by design. Use a database-backed store for multi-writer or multi-tenant hosts.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import jsonlStore, { createJsonlSessionStore } from "@arnilo/prism-store-jsonl";

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [mockProvider(), jsonlStore({ dir: ".prism/sessions" })],
  slots: { store: "@arnilo/prism-store-jsonl" },
});

const session = await agent.session({ id: "s1", create: true });
await session.send("hello");
await session.close();

// The next process reads the same file.
const summary = await createJsonlSessionStore({ dir: ".prism/sessions" }).listSessions({ limit: 10 });
console.log(summary.items[0]?.sessionId, summary.items[0]?.leafId);
```
