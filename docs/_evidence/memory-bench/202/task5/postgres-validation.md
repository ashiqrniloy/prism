# Task 5.6: PostgreSQL Memory Validation and Durable-Store Evidence

Recorded 2026-11-01 against real PostgreSQL 16.15 with `pgvector` 0.8.7.

## Executive Summary

Task 5.6 validates Task 5's memory extensions (archive session addressing, `memory.read` `around` and `session` paging, lexical enrichment and unmatched-term feedback) against PostgreSQL. Because PostgreSQL does not provide `listBySession`, session navigation operates through the memory-fabric status-emitting `scanMetadata` fallback. All functional, concurrency, isolation, and propagation invariants pass on PostgreSQL with zero failures.

Separately, the broader PostgreSQL service and conformance legs were executed, refreshing `scripts/postgres-evidence.json` (57 pass / 0 fail) and `scripts/release-evidence.json` (64 surfaces, `blocked=false`). The release gate (`bun scripts/release.mjs gate`) passes the release-evidence check; unrelated release blockers (pre-existing compat baselines and kernel budget growth) remain documented.

## Validation Environment

- **PostgreSQL Version:** PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2) on x86_64-pc-linux-gnu, 64-bit
- **pgvector Version:** 0.8.7 (extension installed and verified)
- **Container Runtime:** Podman 6.1.4 (rootless container on disposable loopback port, unique per-test schemas dropped in `finally`)
- **Connection Security:** Read from `PRISM_TEST_POSTGRES_URL` in the environment; URL masked and excluded from logs/artifacts.
- **Git HEAD:** `e227450322518338025467d20b376a8432912b50`

## Memory Integration Suites (26 pass, 0 fail)

Command:
```bash
bun test --timeout=0 \
  packages/memory/fabric/src/__tests__/postgres-memory.integration.test.ts \
  packages/memory/fabric/src/__tests__/postgres-vector.integration.test.ts \
  packages/memory/fabric/src/__tests__/postgres-propagation.integration.test.ts \
  packages/memory/fabric/src/__tests__/postgres-navigation.integration.test.ts
```

| Suite | Tests | Result | Duration | Scope Verified |
| --- | ---: | :---: | ---: | --- |
| `postgres-navigation.integration.test.ts` | 5 | **pass** | ~0.8s | Task 5 session & keyword persistence across reopen, directory category retrieval, recall unmatched terms, `around` & `session` parity with SQLite, 200-row scan cursor crossing, scope/consent/hold/deletion/redaction enforcement |
| `postgres-memory.integration.test.ts` | 4 | **pass** | ~0.5s | Shared memory conformance with pgvector, tenant isolation across reopen, scope isolation, and OKF roundtrip |
| `postgres-vector.integration.test.ts` | 14 | **pass** | ~0.9s | DDL injection resistance, tsvector FTS lexical leg, cosine vector ranking, generation rollback, atomic transaction rollback & commit, ACL denial reporting |
| `postgres-propagation.integration.test.ts` | 3 | **pass** | ~0.9s | 1k derived row durable tombstones in 1 transaction, re-pointing across lineage edges, fail-closed grant enforcement |
| **Total Memory Integration** | **26** | **pass** | **~3.0s** | **Zero failures / zero skips** |

### Task 5 Navigation Test Cases

1. `postgres_exchange_session_and_keywords_survive_reopen`:
   - Archives an exchange pair with deterministic keywords on PostgreSQL.
   - Disconnects and destroys the connection pool completely.
   - Reopens via a new connection pool with `skipMigrations: true`.
   - Confirms `metadata.session` (`"persisted-session"`) and category keywords (`"travel"`) survive intact and remain queryable.
2. `postgres_lexical_enrichment_and_unmatched_terms`:
   - Proves category keyword (`"travel"`) is stored and retrieved through directory `topTags`.
   - Proves `memory.recall` tool feedback: full match (content + keyword) returns 0 unmatched terms; partial match isolates unmatched terms; full miss reports all terms.
3. `postgres_read_around_and_session_pages_match_sqlite`:
   - Seeds 12 exchange notes across both PostgreSQL and SQLite stores.
   - Compares `read({ session: "past", page: 0/1/2 })` and `read({ around: ... })` (middle, start, and end of session).
   - Proves identical page slicing, zero-based 8-note reference-time ordering, and not-found semantics.
4. `postgres_navigation_scan_emits_status_and_honours_abort`:
   - Seeds 466 rows (16 exchange notes + 450 filler notes), crossing PostgreSQL's 200-row cursor boundary.
   - Measures scan performance: 3 pages scanned (466 rows returned), session page retrieved in 9 ms.
   - Confirms `memory-fabric: store has no listBySession; session navigation uses a metadata scan` status warning is emitted.
   - Confirms navigation honours `AbortSignal` and throws immediately when aborted.
5. `postgres_navigation_enforces_scope_consent_holds_deletion_and_redaction`:
   - Proves deletions, legal hold tombstones, and revoked consent (`visible: false`) drop out of both `around` and `session` queries.
   - Proves cross-tenant, cross-resource, and cross-thread isolation with identical session ids.
   - Proves secret redaction (`createSecretRedactor`) redacts canary secrets before returning note content.

## Navigation Fallback Performance Metrics

| Metric | Measured Value | Requirement |
| --- | ---: | --- |
| Fixture Rows | 466 rows | > 200 cursor boundary |
| Scan Cursor Pages | 3 pages | Confirms cursor paging |
| Paged Rows Scanned | 466 rows | Accurate row accounting |
| Page 1 Retrieval Latency | 9 ms | Bounded within interactive limits |
| Fallback Status Notification | Emitted | Discloses unindexed scan |

## Broader PostgreSQL Conformance & Release Evidence

### 1. `bun run test:postgres` (57 pass, 0 fail)
- `@arnilo/prism-store-postgres`: 50 pass (session store conformance, migrations v1–v8, atomic leases, branch queries, version CAS).
- `@arnilo/prism-channels`: 2 pass (durable journal conformance against PostgreSQL).
- `phase7-conformance.test.mjs`: 2 pass (16-process protected producer timeline, LISTEN reconnection).
- `phase22-conformance.test.mjs`: 3 pass (state concurrency conformance against PostgreSQL).
- Output recorded in `scripts/postgres-evidence.json` (`gitHead: e227450322518338025467d20b376a8432912b50`, 57 pass / 0 fail).

### 2. `bun run release:evidence`
- Validated all 64 release surfaces.
- Result: `release evidence: 64 surfaces, blocked=false`.
- Refreshed in `scripts/release-evidence.json`.

### 3. `bun scripts/release.mjs gate`
- The PostgreSQL release evidence check (`checkReleaseEvidence`) **passed**.
- Unrelated pre-existing release blockers remain:
  - Compat baseline: `createFabricContext` in `@arnilo/prism-memory-fabric`, kilo and ollama-cloud provider types.
  - Kernel budget ceilings (packed/unpacked bytes, file count, root exports, source lines) pending Phase 11 release baseline rebaseline.
