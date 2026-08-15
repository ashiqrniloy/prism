# @arnilo/prism-session-store-codecs

Shared row codecs for the Prism SQL session stores (`@arnilo/prism-session-store-sqlite`, `@arnilo/prism-session-store-postgres`). Maps session/run/event/tool-call/usage records to flat SQL rows and back. The only store-specific seam is the `redacted` boolean representation, injected via `createSessionRowMappers(codec)`:

- SQLite stores rows with `INTEGER` booleans: `createSessionRowMappers({ encode: (b) => (b ? 1 : 0), decode: (v) => v === 1 })`
- Postgres stores native `BOOLEAN`: `createSessionRowMappers({ encode: (b) => b, decode: (v) => v })`

Since 0.2.5 the package also holds the dependency-free mechanics shared by both SQL adapters (deduplicated from the Postgres/SQLite stores): the cross-tenant ownership-scope comparison/presence/normalizer helpers (`assertOwnershipScope`, `assertOwnershipRequired`, `ownershipScope`), checkpoint conflict + cursor codecs (`staleCheckpoint*`, `encodeCheckpointJson`, `decodeCheckpointCursor`, `encodeBranchCursor`, `decodeBranchCursor`), lifecycle row/limit/reason helpers (`rowToTenantQuota`, `lifecyclePageLimit`, `assertHoldReason`), session-search field/snippet/metadata parsers (`entrySearchFields`, `clipSearchSnippet`, `parseSessionMetadata`, `safeSearchMetadata`), and small utilities (`deepFreeze`, `parseStringArray`, `throwIfAborted`, `rowToRunFeedbackRecord`). These are pure (stdlib + `@arnilo/prism` types only); SQL dialect and query execution stay per-adapter — no SQL string is emitted here.

Internal implementation detail of the session stores; not part of `@arnilo/prism-all`.
