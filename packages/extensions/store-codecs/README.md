# @arnilo/prism-extensions/store-codecs

The row codecs, cursor codecs, ownership-scope helpers, and SQL query-semantics helpers that the
SQL session-store packages (`@arnilo/prism-extensions/store-sqlite`, `@arnilo/prism-extensions/store-postgres`) share, so
two adapters cannot drift on how a session entry becomes a row and back.

This is a **plain library**: it is not an agent package, default-exports no `definePackage`, claims
no slot, and changes nothing on its own. Nothing in the kernel imports it.

## Install

```bash
bun add @arnilo/prism-extensions
```

Hosts and evals also use its evaluation codecs and memory stores; `@arnilo/prism-extensions/store-sqlite`
and `@arnilo/prism-extensions/store-postgres` depend on it themselves.

## Usage

```ts
import { createSessionRowMappers, entrySearchFields, ownershipColumns } from "@arnilo/prism-extensions/store-codecs";

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

- **No I/O.** Codecs are pure; the optional memory stores hold detached, frozen records. The package opens no database and holds no client.
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

## Evaluation records and experiment summaries

`prepareEvaluationRecord` and `prepareExperimentReportRecord` validate and freeze JSON snapshots,
apply an optional `{ redactor }` to content/metadata, and cap each row at 1 MiB.
`HARD_EVALUATION_RECORD_BYTES` and `HARD_EXPERIMENT_REPORT_BYTES` expose these fixed ceilings.
Evaluation ids, statuses, timestamps, scores and sampled flags are validated; experiment means
must be finite scores in [0, 1]. Aggregate text is limited to statistic methods and currency labels.
`EvaluationStoreError.code` distinguishes store validation (`ERR_PRISM_EVAL_STORE`), evaluation size
(`ERR_PRISM_EVAL_STORE_BOUNDS`), and summary size (`ERR_PRISM_EVAL_REPORT_BOUNDS`) failures.

`createMemoryEvaluationStore(initial = [], options = {})` and
`createMemoryExperimentReportStore(initial = [], options = {})` use these codecs for initial rows
and appends, reject duplicate ids, and enforce exact ownership on every query. Optional ownership
supports isolated unowned records; omitted owner fields never act as wildcards. Queries sort by
`createdAt` then `id`, support ascending/descending cursor pages (default 100, hard 1,000), and
honor abort signals. Experiment `latest({ datasetId, ...ownership, manifestMatch? })` returns the
newest matching summary, or `undefined`. Summary `metadata` is capped/redacted when explicitly
provided; evals' converter excludes per-record metadata and content.

`evaluationStoreConformance(factory)` exercises both evaluation and experiment capabilities
against the same ownership, filter, pagination, duplicate, bounds and summary contract.
