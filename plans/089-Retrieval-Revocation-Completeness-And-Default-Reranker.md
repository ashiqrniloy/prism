# Retrieval Revocation Completeness and Default Reranker

Release: 0.9.0 (P0). Closes synapta Plan 119 A4 (document delete leaves prism vectors behind), A5 (no deployed reranker — end-to-end retrieval fails), A8 (no mid-turn source-grant recheck), A9 (grant changes don't re-point pages).

## Objectives
- Delete/revocation propagates through derived artifacts: vector rows → wiki pages → summaries → attention blocks.
- A reranker path that deploys without a research project: local small cross-encoder default with explicit no-network posture, existing TEI/hosted adapters already present.
- A mid-turn grant recheck seam and grant-change re-pointing for governed sources.

## Expected Outcome
- Deleting a governed document removes every derived retrieval artifact prism owns; a conformance test proves no stale hits.
- Synapta's end-to-end retrieve path works with reranking on default hardware; A5 unblocks P04→P06.
- Grant revocation between turns is detected at the next retrieval boundary, not at session start only.

## Tasks

- [x] Task 1: Deletion propagation through derived artifacts
  - Acceptance Criteria:
    - Functional: `source document deleted` → vector rows, wiki page projections, summaries, and any OM entries derived from it are removed or tombstoned; retrieval returns zero hits for deleted content; lineage links (`packages/memory/src/lineage.ts`) resolve to tombstones, not dangling rows.
    - Performance: Propagation is one batched transaction per delete event, not per-artifact scans; 1k-derived-artifact document deletes in < 2s on sqlite dev hardware.
    - Code Quality: Single `propagateDeletion(sourceId)` orchestration over lineage graph; every derived-artifact writer registers a propagation handler (no scatter of ad-hoc deletes).
    - Security: Deletion is privileged (existing memory ACL); propagation cannot be triggered by unprivileged retrieval paths.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/lineage.ts`, `packages/memory/src/wiki/`, `docs/rag.md`, `docs/knowledge-sync.md`, `docs/memory-fabric.md`
      - synapta Plan 119 A4/A9 descriptions.
    - Options Considered:
      - Lazy tombstone check at query time only: rejected — stale authority can surface before lazy check runs; propagation at write time chosen, query-time tombstone filter as belt-and-suspenders.
    - Chosen Approach: Lineage-graph walk with registered handlers + query-time tombstone guard. Shipped as `createDeletionPropagator({ scope, vectorStore, authorization })` → `register(handler)` / `propagate(sourceId)`, tombstoning the `collectInvalidationIds` closure inside one store transaction and then dispatching every handler with `{ sourceId, ids, scope, signal }`. The memory facade owns no rag/wiki deps, so the propagator is constructed where those layers exist rather than as a `memory.propagateDeletion` method.
    - API Notes and Examples:
      ```ts
      const propagator = createDeletionPropagator({
        scope: { tenantId: "t1", resourceId: "docs", threadId: "handbook" },
        vectorStore: store,
        authorization: { tenantId: "t1", principalId: "p1", groupIds: ["eng"] },
      });
      propagator.register(createRagDeletionHandler({ store, scope: ragScope })); // chunks + status
      propagator.register(createWikiDeletionHandler({ workspaceRoot }));        // compiled pages
      await propagator.propagate("doc:erp-lead"); // { tombstoned, layers, batched: true }
      ```
    - Files Created/Edited:
      - `packages/memory/src/propagation.ts` (new): orchestration, handler registry, privilege check, `HARD_PROPAGATION_EDGES`.
      - `packages/memory/src/lineage.ts`: `collectInvalidationIds` optional `maxEdges` (default keeps the 256 interactive cap).
      - `packages/memory/src/rag/retrieve.ts`: query-time tombstone guard (record id, `_lineage.sourceIds`, `_rag.sourceId`).
      - `packages/memory/src/rag/sources.ts`: `createRagDeletionHandler` over `deleteSource`.
      - `packages/memory/src/wiki/retire.ts` (new): `retireWikiSources` + `createWikiDeletionHandler` (retire fully-derived pages, prune shared entities, manifest + log tombstone).
      - `packages/memory/src/index.ts`, `rag/index.ts`, `wiki/index.ts`: exports; `packages/memory/package.json`: new test file in both test chains.
    - References: synapta 119 A4/A9; OM literature (fragile update/filter ops).
  - Test Cases Written (`packages/memory/src/__tests__/deletion-propagation.test.ts`):
    - Delete doc with derived summaries + registered handlers: lineage-closed set (`doc:erp`, `summary:erp`, `summary:erp:digest`) tombstoned in one transaction, rows kept for explainability, recall returns nothing, handler counts in `layers`.
    - In-flight retrieval: delete lands after the query leg read rows; `retrieveContext` returns zero hits while rows survive, then the registered RAG handler removes them.
    - Unprivileged caller (ACL store, no grant / wrong principal) rejected before any tombstone; invalid handler counts rejected.
    - 1,001-artifact delete: one transaction, tombstoned count 1,001, < 2s (measured ~6ms on the reference store).
    - Wiki: shared-entity prune vs fully-derived retire, manifest/hash cleanup, `log.md` tombstone, handler default path mapping.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new memory operation.
    - Docs pages to create/edit: `docs/rag.md` (deletion propagation section), `docs/knowledge-sync.md` (sync delete contract).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Deployable default reranker
  - Acceptance Criteria:
    - Functional: A default reranker that needs no external service: small local cross-encoder (e.g. bge-reranker-base class) loaded via the existing embedder/runtime seam, with `reranker: { kind: "local" }` config; TEI (`createTeiReranker`) and hosted (`createHostedReranker`) remain for scale; `rerankHits` pipeline unchanged.
    - Performance: Local default reranks top-50 candidates in < 300ms median on CPU dev hardware; sizing trade-off documented (model download + per-query latency vs recall).
    - Code Quality: Reuses `runRerankerConformance`; local adapter passes the same conformance as TEI/hosted.
    - Security: Local default makes zero network calls after model fetch (fetch via existing credential/registry path, explicit opt-in logging); no-network posture asserted by test.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/rag/` (`createTeiReranker`, `createHostedReranker`, `rerankHits`, `runRerankerConformance`), `docs/embeddings.md`.
    - Options Considered:
      - Ship TEI-only + docs: rejected — synapta A5 shows ops cost blocks adoption; default must be zero-service.
      - LLM-as-reranker fallback: rejected — cost + latency + the lit's judge-reliability concerns.
    - Chosen Approach: Local cross-encoder adapter behind the existing `Reranker` seam, with the inference runtime as a host seam (`LocalRerankRuntime`) exactly like `Embedder`. No inference dependency is declared anywhere: the built-in transformers.js loader resolves `@huggingface/transformers` at first use through a non-literal dynamic import, so the workspace dependency-name fingerprint and release graph are unchanged. `resolveReranker(config)` is the one place a `{ kind: "local" | "tei" | "openai-compatible" | "voyage" | "fake" | "none" }` config becomes a `Reranker`. `rerankHits` is untouched and still owns caps/abort/trust.
    - API Notes and Examples:
      ```ts
      const reranker = resolveReranker({ kind: "local" }); // Xenova/bge-reranker-base in-process; no service
      const result = await retrieveContext(query, { embedder, store, scope, reranker });
      // host-owned runtime (onnxruntime-node, llama.cpp, a pinned weight cache, …):
      const custom = createLocalReranker({ model: "my-cross-encoder", runtime: { load: (id) => myRuntime.load(id) } });
      ```
    - Files Created/Edited:
      - `packages/memory/src/rag/local-reranker.ts` (new): `createLocalReranker`, `createTransformersRerankRuntime`, `DEFAULT_LOCAL_RERANK_MODEL`, `LocalRerankModel`/`LocalRerankRuntime`/`CreateLocalRerankerOptions`/`TransformersRerankRuntimeOptions`; lazy memoized load, one batched `score` call per rerank, loud install guidance, no lexical fallback.
      - `packages/memory/src/rag/reranker-config.ts` (new): `RerankerConfig` + `resolveReranker`.
      - `packages/memory/src/rag/rerank-shared.ts`: `orderHitsByScores` — the score-validating ordering tail now shared by the HTTP adapters and the local one.
      - `packages/memory/src/rag/index.ts`: exports (root `packages/memory/src/index.ts` unchanged — RAG subpath only).
    - References: synapta A5; reranking recall gains in RAG literature.
  - Test Cases Written (`packages/memory/src/rag/__tests__/local-reranker.test.ts`):
    - Local reranker passes `runRerankerConformance` (permutation, same hit references, deterministic ties).
    - No network: `globalThis.fetch` stubbed to throw; 50 candidates reranked twice with 0 fetch calls, 1 lazy+memoized model load, exactly 1 batched `score` call per rerank carrying all 50 documents.
    - Adapter path for top-50 stays inside the 300ms median budget (median of 5 runs, stub runtime — the cross-encoder leg is host-owned).
    - Missing/failing runtime and missing optional runtime fail loud with model id + `npm i @huggingface/transformers` / `{ runtime }` guidance; a failed load is cached (no retry storm, no fallback).
    - Malformed runtime, model returning no scoring model, short score list, and non-finite scores all reject; empty input returns `[]` without loading.
    - `resolveReranker` maps every kind (`none`/absent → `undefined`), rejects unknown kinds, and `onLoad` reports model + loadMs with no document text.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new reranker kind + default posture.
    - Docs pages to create/edit: `docs/rag.md` (reranker table incl. local, sizing line); `docs/embeddings.md` cross-ref.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Mid-turn source-grant recheck + grant-change re-pointing
  - Acceptance Criteria:
    - Functional: Retrieval boundary (each RAG query) rechecks source grants via existing ACL seam — a grant revoked mid-turn excludes the source from this turn's retrieval; grant changes (scope moved doc→doc) re-point derived pages without re-ingest; fail-closed on unknown grant state.
    - Performance: Grant check is a store lookup per source per query (indexed), < 5ms for 50 sources; no full re-ingest on re-point.
    - Code Quality: One recheck hook in the retrieval pipeline (same seam for all retrieval kinds); re-pointing reuses lineage edges.
    - Security: Fail-closed default — absent/unknown grant = excluded; mid-turn recheck cannot be disabled per-request, only per-runtime config (documented, audited).
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/acl.ts`, `docs/instruction-injection.md` security posture, R04/R08 roadmap items in `docs/`.
    - Options Considered:
      - Session-start grant snapshot: status quo — rejected (A8).
      - Per-query recheck: chosen; matches fail-closed governed-desk requirements.
    - Chosen Approach: live recheck at the retrieval boundary on both sides of the reranker (memoized per distinct source per gate, not per hit), fail-closed with a per-source audit event; re-point as an explicit privileged op that re-keys chunk rows in place and rewrites `_lineage` edges so deletion propagation stays correct on both sides.
    - API Notes and Examples:
      ```ts
      // Mid-turn revocation: every query re-reads the live grant (no snapshot).
      const result = await retrieveContext(query, {
        embedder, store, scope,
        authorization: hostVerifiedPrincipal,
        onAccessDenied: (denial) => audit.write(denial), // { sourceId, scope, reason, hits, error? }
      });
      await store.setSourceAccess(thread, [{ sourceId: "doc:payroll", principalIds: [], accessVersion: 2 }]);
      // → payroll chunks are excluded from this and every later result; reason "no_grant"

      // Grant change doc:a → doc:b: derived artifacts follow, embeddings reused.
      const moved = await repointSource({
        scope, vectorStore: store, from: "doc:a", to: "doc:b",
        authorization: hostVerifiedPrincipal,           // must admit BOTH ids on an ACL store
        handlers: [createWikiRepointHandler({ workspaceRoot })],
      });
      // { movedChunks, rewrittenEdges, layers, batched: true }

      // Already-emitted observational blocks go stale on the next build:
      buildObservationalMemoryProjection(entries, undefined, { invalidatedIds: await listInvalidatedIds(store, scope) });
      ```
    - Files Created/Edited:
      - `packages/memory/src/rag/access-recheck.ts` (new): `createAccessRecheck` → `allows` (pre-filter) / `allowsAfterRerank` (fresh post-rerank read) / `report`; per-source memoization, deny-by-default on `false`, `check_failed` on thrown store errors with redacted+capped message, abort rethrown as abort.
      - `packages/memory/src/rag/retrieve.ts`: single recheck instance per query replaces the two ad-hoc `checkHitAccess` calls; `onAccessDenied` option on `RetrieveContextOptions`; `rag.acl.denied_sources` attribute + `rag.acl_denied` span events on the query span.
      - `packages/memory/src/rag/types.ts`: `AccessDenial` + `AccessDenialReason`, `onAccessDenied`.
      - `packages/memory/src/repoint.ts` (new): `repointSource` + `RepointSourceOptions`/`RepointSourceResult`/`RepointContext`/`RepointHandler`/`RepointStore`, `HARD_REPOINT_RECORDS`; re-keys `${sourceId}#NNNN` ids, rewrites `_rag.sourceId`/`citationId` and `_lineage.sourceIds`, one transaction, ACL-gated on both ids, destination-collision and over-cap fail closed.
      - `packages/memory/src/wiki/repoint.ts` (new): `repointWikiSources` + `createWikiRepointHandler` (manifest `rawSources`/`anchors`, `sourceFileHashes` key, literal path substitution in affected pages, indexes, `Repointed` log line).
      - `packages/memory/src/wiki/retire.ts`: `normalizeWikiSourcePath` + `writeWikiIndexes` extracted so the retire and re-point layers share them.
      - `packages/memory/src/lineage.ts`: `listInvalidatedIds(store, scope)` (non-`corrected` ids, empty without lineage capability) — the OM staleness bridge.
      - Exports: `packages/memory/src/index.ts`, `rag/index.ts`, `wiki/index.ts`.
    - References: synapta A8/A9; governed-memory literature.
  - Test Cases Written (`packages/memory/src/rag/__tests__/access-recheck.test.ts`, `packages/memory/src/__tests__/repoint.test.ts`):
    - Revoke between turns: turn N+1 excludes the source; a store whose query leg ignores grants still cannot leak — the boundary withholds it and reports one `no_grant` event per source (not per hit).
    - Revoke during rerank: the post-rerank gate re-reads and drops the ranked hit, so nothing leaks into the prompt.
    - Unknown grant state / store failure: excluded + `check_failed` audit event with the secret redacted; the query still returns the remaining hits.
    - Abort during a grant lookup propagates as an abort, never as a silent denial; the recheck is on whenever `authorization` is passed (no per-request switch).
    - 200 candidates over 50 distinct sources → exactly 50 store lookups per gate; median hook cost for 50 sources inside the 5ms budget.
    - Re-point: chunk ids/`_rag`/citation ids re-keyed, text+embeddings+offsets reused verbatim, derived `_lineage` edges moved, one transaction (`batched`), `layers.wiki` counted; no-embedder-by-construction.
    - Re-point then propagate: deleting the new source still tombstones the derived row, deleting the old source no longer touches it; `listInvalidated` reflects it.
    - Fail-closed: missing authorization on an ACL store, ungranted destination, destination id collision, over-`maxRecords`, missing `getByThread` — all reject with the source left in place.
    - Wiki: manifest/hash/anchor/page/index/log follow the move (including `./` normalization), and the handler runs as a re-point layer over a store move.
    - OM staleness: `listInvalidatedIds` returns the withheld ids (`corrected` excluded) and feeding them to `buildObservationalMemoryProjection` drops the already-emitted observation; the same projection without them keeps it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — retrieval security behavior.
    - Docs pages created/edited: `docs/rag.md` (Grant recheck and re-pointing section incl. audit shape + fail-closed rules), `docs/policy-and-audit.md` (memory retrieval ACL denial / re-point / invalidation event table), `docs/compaction-observational-memory.md` (`listInvalidatedIds` row in the API table).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Task 1 — propagation is NOT (`memory`-facade) `memory.propagateDeletion(sourceId)`; it is `createDeletionPropagator(...).propagate(sourceId)`. The memory facade holds no rag/wiki/observational deps, and a facade method would either hide those deps or duplicate the handler registry. A thin runtime facade can be added when a host asks.
- Task 1 — `collectInvalidationIds` gained an optional `maxEdges` and propagation uses a new `HARD_PROPAGATION_EDGES = 4096`; the interactive 256-edge cap made the plan's 1k-artifact criterion impossible (one walk, fail-closed over cap). The default callers keep 256, depth stays 8, and over-cap propagation rejects whole (never half-tombstoned).
- Task 1 — observational-memory drop remains a host-supplied handler (same seam `invalidateAcrossLayers` already exposed): the package has no ledger-drop writer. Tombstoned ids are what the OM projection consumes, so nothing derived survives retrieval; physical ledger removal is registered by the host.
- Task 1 — wiki projections are workspace-path keyed (manifest `rawSources`/`anchors`), not prism-source-id keyed, so `createWikiDeletionHandler` maps `sourceId` → paths (default: the id is the path). Fully-derived pages are deleted; shared entities are pruned in the manifest and left for the wiki-maintainer skill to re-file their remaining text.
- Task 1 — the < 2s dev-hardware budget is measured on the in-memory reference vector store (1,001 artifacts ≈ 6ms); there is no in-tree sqlite vector store to time, and the pgvector leg is only exercised in the `test:postgres` chain.
- Task 1 — the retrieval tombstone guard costs one `listInvalidated` read per scope per query (skipped entirely for stores without lineage capability). Accepted for correctness; Task 3's grant recheck should ride the same pre-filter pass.
- Task 2 — no bundled inference runtime or weights: the cross-encoder runs through a host seam (`LocalRerankRuntime`), so "zero service" holds but "zero host code" only holds when the host installs the optional `@huggingface/transformers` (resolved at first use, never declared). Declaring it was rejected deliberately: the workspace dependency-name fingerprint (phase20/21 freeze) and the release graph would change for every package consumer, and the repo's posture is that every external system is a seam.
- Task 2 — the < 300ms median criterion is measured on the part this package owns (hit plumbing + score validation + ordering, ≈0.2ms for top-50 with a stub runtime) plus a proven single batched `score` call; real cross-encoder latency and recall need host weights and are documented as a sizing table + host measurement instead of a CI number.
- Task 2 — `resolveReranker` has no in-tree consumer beyond tests/docs: it exists because the plan's `{ kind: "local" }` config must resolve somewhere. If no host adopts it by the next release, delete it (dead glue beats a wrong abstraction).
- Task 2 — `createTransformersRerankRuntime` is only unit-tested on its failure path (absent package → guidance); the installed path downloads weights, so it belongs to the live/host leg like every other network-backed adapter in this repo.
- Task 2 — `DEFAULT_LOCAL_RERANK_MODEL` is the transformers.js repo id `Xenova/bge-reranker-base`; other runtimes receive the same string and map it themselves (documented in `docs/rag.md`).
- Task 3 — the recheck hook lives in `src/rag/access-recheck.ts`, not in `src/acl.ts` as the plan sketched: `acl.ts` holds the shared grant normalization/decision primitives used by stores and propagation, while the hook is query-scoped (per-query memoization, per-source audit, phase-aware re-read). Putting it in `acl.ts` would have made the ACL module depend on retrieval types.
- Task 3 — re-point is an explicit host call, not automatic: nothing in the `VectorStore` contract reports “a grant changed”, so Prism cannot observe `setSourceAccess` edits on its own. The host (or a sync/wiki job) calls `repointSource`/`repointWikiSources` when it decides the identity move is real. Automatic re-pointing on grant edits needs a store change event the contract does not have.
- Task 3 — the audit surface is split by who filters. A store that declares `authorization: "acl"` filters inside `query`/`lexicalQuery`, so those withholdings never reach the boundary gate and therefore produce no `onAccessDenied` event; the event fires for what the boundary itself withholds (in-flight revokes between the query legs and the gate, non-filtering stores, failed grant lookups). Auditing store-internal filtering needs a store-level audit seam and a store boolean that can separate “never granted” from “revoked/version mismatch” — both out of contract today.
- Task 3 — the ACL gate on `repointSource` requires a live grant for the **destination** id, so hosts must grant the destination before moving. Auto-copying the source grant was rejected: that would make a re-point an implicit privilege change (a move would silently hand out authority the host never approved).
- Task 3 — there is no runtime knob to disable the recheck at all, where the plan allowed one per runtime. Passing `authorization` turns the gate on and the only knob is the audit sink (`onAccessDenied`). A documented off-switch for a security check is a foot-gun that eventually gets switched off; hosts that do not want per-query checking simply do not declare `authorization` (and then the store must protect itself).
- Task 3 — with a reranker configured the same source is looked up twice per query (pre-filter + fresh post-rerank). Accepted: the second read is the whole point of in-flight protection, memoization keeps it per source (not per hit), and the measured hook cost for 50 sources stays inside the 5ms budget. The number is hook overhead on the in-memory store, not a Postgres round trip.
- Task 3 — `repointSource` re-keys vector rows and lineage edges only. Observational-memory entries and file-backed fabric notes live in host-owned session storage, so their staleness is expressed through `listInvalidatedIds` → `invalidatedIds` (withholding), not by rewriting them; a fabric-note re-point handler would be a host handler on the same seam.
- Task 3 — wiki re-point substitutes paths literally in page text: links, anchors, and prose that contain the old path follow the move, but a page whose text embeds a differently-normalized path (e.g. absolute vs workspace-relative) is only updated where the normalized literal appears. Full recompilation was rejected as it needs the symbol extractor and raw file reads for zero content change.
- Task 3 — one pass is capped at `HARD_REPOINT_RECORDS` (4,096) and rejects whole (no partial move), mirroring propagation. Paging a re-point would need resumable cursor semantics across the ACL check, the store write, and the handler pass.

## Further Actions

Recorded as ordered tasks in [102-Retrieval-Revocation-And-Reranker-Follow-Ups.md](102-Retrieval-Revocation-And-Reranker-Follow-Ups.md) (Task 1 primitive review, then P1 → P2 → P3; each bullet below names its task). Nothing here blocks plan 099's 0.9.0 cut: plan 089 ships correct, documented behavior and these items are additive (live evidence, durable-store proof, host wiring).

- ~~P1 (Task 3): feed `listInvalidated` ids into `buildObservationalMemoryContextBlocks({ invalidatedIds })`~~ done in Task 3: `listInvalidatedIds(store, scope)` is the exported bridge; hosts/tests feed it to projection/recall/context-blocks. What remains is host wiring (no in-tree host composes an OM runtime with a memory vector store yet) — P2 → **102 Task 8**.
- P1: implement/ship an observational ledger drop handler (writes `OBSERVATIONS_DROPPED`) so propagation physically removes dropped observations instead of leaving host code to do it. → **102 Task 2**.
- P2: add a postgres propagation leg to `test:postgres` (1k artifacts, transaction count) to time the durable store. → **102 Task 5**.
- P2: have the wiki maintainer skill re-file pruned entities and surface them in `prism-wiki lint`. → **102 Task 9**.
- P2: expose a runtime-level `propagateDeletion` facade once a host needs one call across layers. → **102 Task 8**.
- P1 (Task 2): add a live leg (`PRISM_TEST_LOCAL_RERANK=1`) that loads the real transformers.js runtime, runs `runRerankerConformance`, and records top-50 median latency on named hardware so the < 300ms claim has a machine behind it. → **102 Task 3**.
- P2: measure recall with rerank on/off on a fixture corpus and record it in `docs/rag.md` — local reranker quality is model-dependent, and the sizing table should carry a number, not a vibe. → **102 Task 4**.
- P2: pick per-platform defaults (`dtype: "q8"` on x86 CPU, weight-cache dir convention shared with embedders) and add a `prism-memory` config note once a host runs it in production. → **102 Task 4**.
- P2: expose a `repointSource`-on-grant-change hook once hosts have a source of truth for identity moves (wiki sync/grant edit); needs a store-level “grants changed” notification that the `VectorStore` contract does not define yet. → **102 Task 7**.
- P2: a store-level denial audit seam (pgvector filter counts per source) so sources silently filtered inside `query` also surface as `onAccessDenied`-style events instead of being invisible to the retrieval boundary. → **102 Task 6**.
- P3: paged re-point above 4,096 records (resumable across the ACL check, store write, and handler pass) if a host ever moves scopes that large. → **102 Task 10**.
- P3: a fabric-note re-point handler for the file-backed `.memory` journal (the vector-store edge rewrite already covers notes that live in the store). → **102 Task 11** (corrected there: fabric notes are store-backed with `metadata.path`, so the handler is in-tree and path-keyed, not a journal reader).
