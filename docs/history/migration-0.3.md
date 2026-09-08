# Migration archive — 0.3.x releases

## 0.3.3 → 0.4.0 package reorganization (breaking)


Prism 0.4 consolidates package names into explicit family subpaths. It is a dependency and import-specifier migration, not a persisted-data migration. See the complete [legacy 0.3 → 0.4 guide](migrate-to-0.4.md) for all 54 retired package mappings, profile replacements, optional peers/host binaries, security checks, rollback, and npm legacy-warning behavior.

## 0.3.1 → 0.3.2: bounded workflow loop durability (additive, no migration)


`@arnilo/prism-workflows@0.3.2` adds the bounded `loopNode` durable extension. It adds optional `WorkflowNodeCheckpoint.iterations` records, each carrying `schemaVersion: 1`, a zero-based `iteration`, stable `iterationId`, and bounded/redacted output. Existing `WorkflowCheckpointValue.schemaVersion` remains `1`; older checkpoints without `iterations` remain readable through the legacy `iteration`/`lastOutput` cursor, and older hosts ignore the additive field. No SQL or generic checkpoint-store migration is required. Replay creates a new run and never mutates source iteration evidence. Hosts using saga compensation keep one saga step/aggregate and register per-iteration compensation by `iterationId` in reverse order.

This independent package patch freezes budget accounting: `maxNodes` counts declared DAG nodes once, while loop body executions consume only the required hard-capped `maxIterations` budget. Rollback is package-version rollback; no persisted migration is needed.

## 0.3.2 → 0.3.3: run-ledger prompt provenance (additive, schema version 9)


Plan 042 adds an optional typed `promptVersion` ref (`{ name, version, hash }`) to `RunOptions` and `RunRecord`. Hosts resolve a prompt from `@arnilo/prism-prompts` and stamp the run: the ref is copied onto the start/finish ledger records and persisted by the first-party SQLite/PostgreSQL stores as a nullable `prompt_version` JSON column (shared schema migration `009_run_prompt_version`, schema version 8 → 9, forward-only and applied automatically by the adapters' checksummed `prism_migrations`). Strictly additive: unset `promptVersion` produces byte-identical rows and records, legacy rows read back without the field, and no exported declaration was removed. The ref carries identity only (`sha256:` body hash) — prompt bodies stay in the separate `@arnilo/prism-prompts` tables and out of run rows, metadata, and telemetry.

## 0.3.2 → 0.3.3: tool progressive disclosure (additive, no migration)


Plan 041 adds opt-in progressive tool loading to `@arnilo/prism`: `toolsDisclosure` (default `"all"`, byte-identical to previous releases) and `toolsSearch.topK` on `AgentConfig` / `RunOptions`, plus the generated `search_tools` tool in search mode. Strictly additive — no exported declaration removed, no persisted shape repurposed. Durable run state gains an optional `sessionState.activatedToolNames` (names only, capped at 128); stores that ignore it resume exactly as before. Set nothing and behavior is unchanged; see [Tools](../tools.md#tool-disclosure-progressive-tool-loading).

## 0.3.1 → 0.3.2 memory package: composite recall scoring (additive, no migration)


`@arnilo/prism-memory@0.3.2` adds opt-in `RecallOptions.scoring`: sum-normalized similarity/recency/importance blending, with a positive `halfLifeMs` required only when `recencyWeight > 0`. Default recall (no `scoring`) keeps its existing ordering and query count. `MemoryVectorRecord.importance?` persists through an additive nullable `importance REAL` column (`ADD COLUMN IF NOT EXISTS`); legacy NULL rows score neutral `1.0`, so no re-index or data migration is required. At write, hosts may pass a clamped `[0,1]` `entry.importance` or an `importanceFrom` hook over a redacted reflection; it runs once at write, never at recall. Rollback is package-version rollback only: old readers ignore the nullable column, and new readers treat absent values neutrally.

## 0.3.0 → 0.3.1 production RAG engine (independent patch)


Only `@arnilo/prism-rag`, `@arnilo/prism-memory`, and `@arnilo/prism-observability-opentelemetry` move to `0.3.1`. Keep every other first-party package on `^0.3.0` — those ranges already satisfy `0.3.1`.

**Required for Embedder implementers.** `Embedder.id` is now a required `readonly id: string` (stable model/deploy identity, ≤256 chars). Hosts that construct their own embedder must set it; `createHashEmbedder` defaults to `"prism-hash-embedder"` and the Alibaba embedder uses `options.model`. `retrieveContext` fails closed with `ERR_PRISM_RAG_EMBEDDER_MISMATCH` when a stored `embedderId` is missing or differs (or dimensions differ). Re-index the source after an embedder/model change. Existing 0.3.0 rows without `embedderId` also fail closed until re-indexed.

Everything else is additive and opt-in: `createPostgresVectorStore`, hybrid `lexical` retrieve, `contentHash` skip, heading metadata, generation pointers, `createRagTelemetry`, `createTeiReranker`, multi-scope retrieve (`scopes` — pass `scope` for one corpus or `scopes` for one-or-many exact corpora; `scope` stays valid, both or neither throws). Default `retrieveContext` / `replaceSource` paths without those options stay 0.3.0-compatible (vector-only, single-scope, no skip, no telemetry).

Postgres DDL is additive (`IF NOT EXISTS` columns/indexes/tables). 0.3.0 rows remain readable. Rollback = restore the 0.3.0 package versions; no down migration.
