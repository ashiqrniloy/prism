# @arnilo/prism-store-codecs

The row codecs, cursor codecs, ownership-scope helpers, and SQL query-semantics helpers that the
SQL session-store packages (`@arnilo/prism-store-sqlite`, `@arnilo/prism-store-postgres`) share, so
two adapters cannot drift on how a session entry becomes a row and back.

This is a **plain library**: it is not an agent package, default-exports no `definePackage`, claims
no slot, and changes nothing on its own. Nothing in the kernel imports it.

## Install

```bash
bun add @arnilo/prism-store-codecs
```

A host needs it only when it imports a SQL store package directly; `@arnilo/prism-store-sqlite`
and `@arnilo/prism-store-postgres` depend on it themselves.

## Usage

```ts
import { createSessionRowMappers, entrySearchFields, ownershipColumns } from "@arnilo/prism-store-codecs";

// The one store-specific seam is how the dialect represents the `redacted` boolean.
const mappers = createSessionRowMappers<number>({ encode: (redacted) => (redacted ? 1 : 0), decode: (row) => row === 1 });
const row = mappers.sessionEntryToRow(entry);
const roundTripped = mappers.rowToSessionEntry(row);
```

## What it changes

Nothing on an agent. It now also owns `prepareRunFeedback`, the in-memory feedback store, and the shared persistence-schema contract the SQL stores migrate against.

## What it provides

| Export group | Symbols | Purpose |
| --- | --- | --- |
| Row codecs | `createSessionRowMappers`, `canonicalSessionTimestamp`, `SessionEntryRow`, `RunRow`, `AgentEventRow`, `ToolCallRow`, `UsageRow`, `SessionRowMappers`, `RedactedCodec` | Session/run/event/tool-call/usage row encoding, with the dialect's `redacted` representation injected. |
| Cursors | `encodeBranchCursor`, `decodeBranchCursor` (entry cursors ride on the mappers) | Opaque keyset-pagination cursors used by entry, branch, and session pages. |
| Ownership | `ownershipColumns`, `ownershipScopeMatches`, `assertOwnershipScope`, `assertOwnershipRequired`, `ownershipScope` | The single ownership-scope comparison both SQL adapters route through. |
| Search | `entrySearchFields`, `clipSearchSnippet`, `parseSessionMetadata`, `safeSearchMetadata` | FTS dual-write fields and the safe (title/workspace-only) metadata subset in search hits. |
| Companion rows | `assertCheckpointInput`, `assertLeaseInput`, `encodeCheckpointJson`, `decodeCheckpointCursor`, `parseStringArray`, `deepFreeze`, `throwIfAborted`, … | Checkpoint, lease, feedback, and lifecycle row helpers. |

## Cost, security, and failure behavior

- **No I/O and no state.** Every function is pure; the package opens no database and holds no client.
- **Bounded search fields.** `entrySearchFields` caps the indexed message body at 64 KiB and
  `clipSearchSnippet` caps snippets at the contract's byte limit, so a huge message cannot inflate the
  FTS index or a search page.
- **Safe metadata only.** `safeSearchMetadata` reduces session metadata to `title` and
  `workspaceRoot`, so a search hit can never carry another metadata key (or a credential) that a host
  wrote.
- **Fail closed.** `decodeEntryCursor`/`decodeBranchCursor` reject malformed cursors with a
  `TypeError`/`Error` instead of guessing, and a row whose JSON does not parse throws rather than
  returning a partial entry.

## License

MIT
