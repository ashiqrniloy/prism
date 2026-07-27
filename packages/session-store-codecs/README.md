# @arnilo/prism-session-store-codecs

Shared row codecs for the Prism SQL session stores (`@arnilo/prism-session-store-sqlite`, `@arnilo/prism-session-store-postgres`). Maps session/run/event/tool-call/usage records to flat SQL rows and back. The only store-specific seam is the `redacted` boolean representation, injected via `createSessionRowMappers(codec)`:

- SQLite stores rows with `INTEGER` booleans: `createSessionRowMappers({ encode: (b) => (b ? 1 : 0), decode: (v) => v === 1 })`
- Postgres stores native `BOOLEAN`: `createSessionRowMappers({ encode: (b) => b, decode: (v) => v })`

Internal implementation detail of the session stores; not part of `@arnilo/prism-all`.
