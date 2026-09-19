# Workspace Session Search Primitive

Release: 0.9.0 (P2). Productizes `searchSqliteSessions` + annotations into a workspace-scoped session search API so hosts (clay) delete their hand-rolled FTS subsystem.

## Objectives
- Indexed full-text search over stored sessions scoped by workspace, with transcript-data-only guarantees.
- Search results carry session/run ids, turn pointers, and annotation hits — enough for clay's workspace search to drop its own index.

## Expected Outcome
- `host.searchSessions({ workspace, query })` returns ranked hits without hosts maintaining a parallel FTS index.

## Tasks

- [x] Task 1: Productize the search surface
  - Acceptance Criteria:
    - Functional: Public `searchSessions({ workspaceRoot?, query, kind? })` over sqlite/postgres stores: FTS5 for sqlite (existing `searchSqliteSessions` in `packages/prism-core/src/sessions/sqlite/persistence.ts`), equivalent `tsvector` for postgres; results include session id, run id (`runId`), turn index (`turn`), snippet, score (`score`), and the matched `entryId`; annotation search included via the entry-kind filter. ✅
    - Performance: Index maintained at session-store write time (additive); query < 100ms p95 for 100k-turn corpus on dev hardware measured at **37.5ms p95** (`node scripts/benchmark.mjs --scenario session-search`). Sizing trade-off documented and measured: index storage **18.8%** of transcript page bytes on a 100k-turn fixture whose stored tool output is not indexed (plan target 10–20%). ✅
    - Code Quality: One interface, two store implementations, conformance test shared (store conformance suite gained a search round-trip/kind case). ✅
    - Security: Transcript-data-only contract preserved — tool args/results are not indexed at all (stricter than "redacted if present"); workspace scoping enforced at query level; snippets come from already-redacted stored entries. ✅
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/sessions/sqlite/persistence.ts` (`searchSqliteSessions`), `docs/session-stores.md`, `docs/session-store-conformance.md`, `src/contracts-core/session.ts`, `src/session-stores.ts`, `packages/prism-core/src/sessions/postgres/persistence.ts`.
    - Options Considered:
      - Keep internal, hosts build their own (status quo): rejected — clay maintains a duplicate subsystem.
      - External search engine dependency: rejected — store-native indexes suffice.
      - New `workspace` query parameter: rejected — `workspaceRoot` is the existing scope key (`SESSION_SEARCH_WORKSPACE_METADATA_KEY`) and clay already passes it; a second name for one scope would fork the contract.
      - Score-ordered hits with a score-aware cursor: rejected for this task — it would break the existing `(updated_at, id)` cursor contract used by clay's session picker; `score` is exposed so hosts rank client-side.
    - Chosen Approach: Store-native FTS behind one public API, returning the best-matching entry per session (entry pointer + score + matched-text snippet), with the existing `updatedAt` ordering/cursor untouched.
    - API Notes and Examples:
      ```ts
      const hits = await host.searchSessions({ workspaceRoot: "/repo", query: "attention folding", kind: "any" });
      // [{ sessionId, entryId, runId, turn: 14, score: 8.2, snippet: "...folding engaged at 0.75..." }]
      ```
      - `kind?: SessionEntryKind | readonly SessionEntryKind[] | "any"` filters which entries the query may match; `kind: ["label", "summary", "metadata", "custom"]` is annotation search, and a query-less `kind: "label"` lists sessions carrying an annotation entry. Unknown kinds throw `TypeError`.
      - `score` is higher-is-better (SQLite: negated `bm25()`; Postgres: `ts_rank_cd`). `turn` is the matched entry's 1-based transcript position (`(timestamp, id)` order) — session entries carry no provider-turn field, so the transcript pointer is the honest locator.
    - Files to Create/Edit (actual):
      - `src/contracts-core/session.ts`: `SessionSearchKind`, `kind` query field, `entryId`/`runId`/`turn`/`score` hit fields, `resolveSessionSearchKinds` normalization.
      - `src/session-stores.ts`: memory linear search fills the pointer fields, matches kind-scoped entries, and snippets the text that actually matched.
      - `packages/prism-core/src/sessions/sqlite/persistence.ts`: ranked FTS5 candidate CTE (bm25 + `snippet()`), one best entry per session, kind join filter; page-level display/turn lookups keep correlated subqueries out of the pre-LIMIT scan (225ms → 37ms p95 for common terms).
      - `packages/prism-core/src/sessions/postgres/persistence.ts`: equivalent `ts_rank_cd` + `ts_headline` CTE with `DISTINCT ON`, kind filter, row-comparison turn count.
      - `src/testing/session-store-conformance.ts`, `src/__tests__/session-index.test.ts`, `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts`, `src/__tests__/public-export-contract.test.ts`.
      - `docs/session-stores.md` (hit fields, kind filter, transcript-only indexing, sizing line), `docs/session-store-conformance.md` (expanded search case).
      - `scripts/benchmark-scenarios/session-search.mjs` + registry entry in `scripts/benchmark.mjs`.
    - References: clay FTS roadmap item; store conformance framework.
  - Test Cases to Write:
    - Round-trip: sessions written then found by content and annotation; snippet points at right turn. → conformance `assertSessionStoreSearchSessions` (message round-trip asserting `entryId`/`runId`/`turn`/snippet) + memory/sqlite tests.
    - Workspace isolation: query in workspace A never returns workspace B hits. → sqlite test (`/repo` vs `/elsewhere`, same query text).
    - Redaction: redacted content absent from index (search for secret value fails). → sqlite test stores a tool-result payload and asserts it is not indexed; snippets/tool payloads never enter search. Indexed entries are already redacted by the runtime before append.
    - Conformance: both stores pass the shared search conformance case. → sqlite suite green; postgres live suite green (`PRISM_TEST_POSTGRES_URL` against `postgres:16-alpine`, 73/73).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `SessionSearchQuery.kind` and `SessionSearchHit.entryId/runId/turn/score` are additive public fields; `SessionSearchKind` is a new public type (frozen-export contract updated).
    - Docs pages to create/edit: `docs/session-stores.md` (search section rewritten: fields, kind, ordering/score, transcript-only indexing, measured sizing); `docs/session-store-conformance.md` (search case).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: JSONL fallback + example
  - Acceptance Criteria:
    - Functional: JSONL store implements the same interface by scanning the file (correct, unindexed — documented as O(corpus) per query); example `examples/session-search.ts` shows workspace search across stored sessions on both the indexed and linear paths. ✅
    - Performance: JSONL scan documented cost (`docs/node-jsonl-session-store.md`, `docs/session-stores.md`); sqlite/postgres remain the recommended indexed paths. ✅
    - Code Quality: Same result shape; no interface divergence — the JSONL store reuses the memory store's matcher (`searchLinearSessions`), and the shared conformance case now pins one hit per session and the hit pointers for every store. ✅
    - Security: Same redaction and scoping rules (same matcher, same workspace/ownership filters, same transcript-only text); JSONL reads only the caller's file and quarantines corrupt lines like `list`/`get`. ✅
  - Approach:
    - Documentation Reviewed: `docs/node-jsonl-session-store.md`, `src/node/session-store-jsonl.ts`, `src/session-stores.ts` (`searchMemorySessionsLinear`), `docs/session-stores.md`.
    - Options Considered:
      - Stream the file with `readline` and a streaming matcher: rejected — a second matcher to keep in sync with the memory one for a bounded-memory win on a store prism already reads whole in `append`/`list`/`get`; documented as O(corpus) instead.
      - Fail loud on parse errors: rejected — `list`/`get` quarantine invalid lines, so search quarantines them too; only `append` fails closed.
      - Per-store JSONL scan caps override: deferred — the contract defaults apply; add `JsonlSessionStoreOptions.search` only if a host hits the cap before the file size hurts (Further Actions).
    - Chosen Approach: one shared linear matcher (`searchLinearSessions`, exported from `src/session-stores.ts`) over grouped entries; the JSONL store groups the file's entries by session, tracks the last entry per session as the leaf, and delegates. Example demonstrates SQLite FTS5 hit pointers plus annotation search, then the JSONL linear fallback returning the same hit pointers.
    - API Notes and Examples:
      ```ts
      const store = createJsonlSessionStore("./sessions.jsonl");
      const page = await store.searchSessions!({ workspaceRoot: "/repo", query: "flake", limit: 20 });
      // Same hit shape as SQLite/Postgres; no `score` (no index), O(corpus) per query.
      ```
    - Files to Create/Edit (actual):
      - `src/session-stores.ts`: exported `LinearSearchCaps` + `searchLinearSessions(bySession, leafBySession, query, caps = contract defaults)`; the memory store calls it with its resolved caps (construction-time validation unchanged).
      - `src/node/session-store-jsonl.ts`: `searchSessions` groups the parsed file by session and delegates; `SessionSearchUnsupportedError` import removed.
      - `src/testing/session-store-conformance.ts`: search case gained the one-hit-per-session probe (two matching entries in one session).
      - `packages/prism-core/src/sessions/sqlite/persistence.ts`: bug found while validating the example — the `best` CTE computed `row_number()` but never filtered it, so SQLite returned one hit per matching *entry*; now filters `rn = 1` (Postgres `DISTINCT ON` and the linear matcher already agreed).
      - `src/__tests__/session-index.test.ts` (JSONL vs memory page-for-page parity across 7 queries + conformance), `src/__tests__/node-session-store-jsonl.test.ts` (fresh-instance scan, corrupt-line quarantine), `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts` (one hit per session, positive score).
      - `docs/node-jsonl-session-store.md`, `docs/session-stores.md`, `docs/public-contracts.md`, `docs/session-store-conformance.md`.
      - `examples/session-search.ts` + `examples/README.md` bullet (docs test requires every `examples/*.ts` to be listed).
    - References: clay workspace search UI; plan 074's `SessionSearchUnsupportedError` posture for JSONL.
  - Test Cases to Write:
    - JSONL returns same hits as sqlite for identical corpus fixture. → JSONL vs **memory** (same matcher) asserted page-for-page, and sqlite/postgres run the same shared conformance case; `node examples/session-search.ts` asserts the SQLite and JSONL pointer tuples agree on a 5-session corpus.
    - JSONL-specific: fresh store instance searches a persisted file; a corrupt line is quarantined (search still returns valid hits); no-match query returns an empty page.
    - Conformance: JSONL now runs `exerciseSearchSessions: true` (invalid input, round-trip pointers, kind filter, one hit per session, ownership bounds).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — JSONL `searchSessions` is now supported (behavior change from `SessionSearchUnsupportedError`).
    - Docs pages to create/edit: `docs/node-jsonl-session-store.md` (support, cost, hit shape, example), `docs/session-stores.md` (store matrix + linear vs indexed match note + example link), `docs/public-contracts.md` (seam + unsupported-error rows), `docs/session-store-conformance.md` (one-hit probe).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

Task 1 deltas from the sketched approach (Task 2 still open):

- **`workspaceRoot`, not `workspace`.** The AC example names `workspace`; the shipped query keeps `workspaceRoot`, the existing `SESSION_SEARCH_WORKSPACE_METADATA_KEY` scope, because clay already passes `workspaceRoot` and a second name for the same scope would fork the contract. `workspaceRoot` is the documented workspace scope.
- **`kind` is an entry-kind filter, not a search mode.** `kind: SessionEntryKind | readonly SessionEntryKind[] | "any"`. Annotation search is `kind: ["label", "summary", "metadata", "custom"]`; `"any"` (default) matches every kind. This maps onto both stores' entry tables without a schema change, and prism's `"annotation"` vocabulary is already `label`/`summary`/`metadata`/`custom` entry kinds.
- **Hits stay `updatedAt`-ordered; `score` is carried, not applied.** Relevance ordering would invalidate the existing `(updated_at, id)` cursor used by clay's resume picker; hosts re-rank page hits by `score` when they want relevance order. A score-aware cursor is deferred (Further Actions).
- **`turn` is the matched entry's transcript position** (`(timestamp, id)` order), not a provider-turn number: session entries carry no turn field (`turn` lives on events/usage rows), and `entryId` is the precise pointer for reopening.
- **Index stays always-on and write-time additive.** Migration 004 creates FTS5 (Postgres `prism_session_search`) and append dual-writes; there is no runtime `searchIndex: false` toggle because the migration chain/schema model is shared and conditional index creation would make search availability depend on DB creation order. The documented cost is the opt-in decision: 18.8% of transcript page bytes on the 100k-turn fixture (stored tool output is not indexed).
- **Tool args/results are not indexed at all** — stricter than "redacted if present" and consistent with clay's "no raw tool output in FTS" decision. Search cannot leak tool payloads because they never enter the index; message/label/summary text is already redacted by the runtime before append.
- **JSONL search reads and parses the whole file per query** (documented O(corpus) time and memory). Memory/JSONL reuse one matcher over grouped entries; a streaming matcher was rejected as a second implementation to keep in sync for a store that already reads whole files in `append`/`list`/`get`.
- **Indexed and linear stores can pick a different entry for the same session** when several entries match: the indexed paths return the best-ranked match (bm25 / `ts_rank_cd`), the linear paths the first match in transcript order. One hit per session is pinned in conformance; which entry wins is store-specific and documented.
- **SQLite `score` is `-bm25`, so a non-discriminative term can legitimately score 0** (present in ~half the workspace's rows). Hosts must treat `score === undefined`/absent as "no index relevance" and `0` as a weak-but-real match — do not use `score > 0` as a match test.
- **Fixed in Task 2: SQLite returned one hit per matching entry, not per session.** The `best` CTE computed `row_number()` without filtering it; it now filters `rn = 1`, and the shared conformance case probes the invariant (it was missed because Task 1's test sessions had a single matching entry each).
- **Performance evidence is SQLite-only on dev hardware** (`node scripts/benchmark.mjs --scenario session-search`: 100k turns, 37.5ms p95, 18.8% index ratio). Postgres correctness is proven live (conformance green against `postgres:16-alpine`); a Postgres latency leg needs the protected `PRISM_TEST_POSTGRES_URL` benchmark harness (Further Actions).
- **Export-count budget gate red in the working tree.** `scripts/budget-gate.test.mjs` measures `@arnilo/prism` at 1437 exports vs the recorded 1400 ceiling. That gap is pre-existing in-flight work plus this task's one new public type (`SessionSearchKind`); it was deliberately not rebaselined here to avoid absorbing unrelated unreviewed exports. `SessionSearchKind` was added to `FROZEN_TYPE_EXPORTS` in `src/__tests__/public-export-contract.test.ts`.

## Further Actions

- Optional JSONL scan-cap override (`JsonlSessionStoreOptions.search`, mirroring `CreateMemorySessionStoreOptions.search`) if a host hits the contract linear caps before file size hurts; priority P4, the contract defaults already bound the scan.
- Relevance-ordered pagination (`order: "relevance"` with a score-aware cursor) if a host needs ranked pages rather than client-side re-ranking; priority P3, only with a named consumer.
- Optional protected Postgres search benchmark leg (100k-turn corpus, p95) when a disposable `PRISM_TEST_POSTGRES_URL` database is part of the release evidence run; priority P3.
- If hosts need tool-result search (clay's decision log keeps raw tool output out of FTS by default), extend `entrySearchFields` to index redacted result text behind an explicit option; priority P4 pending demand.
- Optional FTS index storage toggle (`searchIndex: false`) would need a conditional migration step in the shared catalog plus fail-closed `SessionSearchUnsupportedError`; only if a host reports storage pressure. Priority P4.
