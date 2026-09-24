# Phase 111 — Primitive Review: Deletion-Handler Reason Seam and Semantic Reranker Evidence

Plan: [111-Deletion-Handler-Reason-Seam-And-Reranker-Embedder-Evidence.md](../../plans/111-Deletion-Handler-Reason-Seam-And-Reranker-Embedder-Evidence.md) Task 1.
Date: 2026-09-22. Baseline: working tree at HEAD `3129d5cf` (0.10.1 WIP), Node v26.9.0, machine
`arn-cachyos` (AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics), linux x64. Reviewed sources are the
working tree; every span below was re-verified there.
Method: read-only inventory plus scratch probes (four files, not committed) against the
`packages/memory` `dist/` build compiled from this tree. Probe commands and printed
output are in §4; the semantic leg in §4.4 is a gated live run (downloads the named weights once).
Scope: **gate for Tasks 2–3**. Task 2 extends a row in §1.1 additively; Task 3 parameterizes a row in §1.2.
The rest of plan 102's Further Actions has no in-tree consumer and stays recorded there — §4.6 is the demand
evidence for that gate. Any primitive absent here is a review gap and must be added to §2 before implementation.

Source of the work: plan 102 `Compromises Made` + `Further Actions`
([102-Retrieval-Revocation-And-Reranker-Follow-Ups.md](../../plans/102-Retrieval-Revocation-And-Reranker-Follow-Ups.md)),
`docs/_evidence/phase102-primitive-review.md` (reuse inventory and gaps G1–G10, all owned by shipped tasks),
and `docs/_evidence/phase102-local-rerank-latency.md` (the hash-embedder row set this plan extends).

Cite convention: spans are `file:Lstart–Lend` verified in this tree. Every reuse row names the exact exported
symbol or the module-private seam inside one. Every gap row names the file that must change. Every rejected
alternative names the task or plan it would have changed.

---

## 1. Reuse inventory (what Tasks 2–3 build on)

### 1.1 Task 2 — the reason seam

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `packages/memory/src/propagation.ts:L18` | `DELETION_REASON` = `"forgotten"` | The default reason, duplicated (not imported) by the fabric handler. |
| `packages/memory/src/propagation.ts:L32–L38` | `DeletionPropagationContext` | `{ sourceId, ids, scope, signal? }` — four fields today, no `reason`. Task 2 adds `reason?: MemoryInvalidationReason` here. **CONFIRMED absent §4.1/§4.2.** |
| `packages/memory/src/propagation.ts:L74` | `createDeletionPropagator` | One registry (`register`/`kinds`), one privilege check, one `propagate`. |
| `packages/memory/src/propagation.ts:L89` | `const reason = options.reason ?? DELETION_REASON` | The single resolution point Task 2 forwards into the context. |
| `packages/memory/src/propagation.ts:L128–L133` | tombstone entry build | `{ id, reason, at, ...(reason === "legal_hold" ? { hold: true } : {}) }` — the walk's own rows. |
| `packages/memory/src/propagation.ts:L150` | handler dispatch | `handler.delete({ sourceId, ids, scope, signal })` — the only handler call path; Task 2 adds `reason` to this one object. |
| `packages/memory/src/types.ts:L100` | `MemoryInvalidationReason` | `"corrected" \| "revoked" \| "forgotten" \| "legal_hold"`, reused as-is. |
| `packages/memory/src/fabric/repoint.ts:L52–L57` | `createFabricRepointHandler` options | `{ scope, vectorStore, reason? }`; returns `RepointHandler & DeletionPropagationHandler`. |
| `packages/memory/src/fabric/repoint.ts:L28–L29` | stale comment | "a host that passes `reason` there should pass it here" — the double-entry instruction Task 2 deletes. |
| `packages/memory/src/fabric/repoint.ts:L62` | `const reason = options.reason ?? DELETION_REASON` | The handler's only reason source today; Task 2 makes `context.reason` the first source. |
| `packages/memory/src/fabric/repoint.ts:L129–L134` | retire leg | Selected note ids → entries `{ id, reason, at, hold? }` → `store.invalidate`. The stamping code the effective reason feeds. |
| `packages/memory/src/lineage.ts:L145–L155` | `listInvalidatedIds` | The read path for tombstone ids; stores without lineage return `[]`. |
| `packages/memory/src/vector-memory.ts:L381–L397` | store `invalidate` / `listInvalidated` | `invalidate` keeps `hold` sticky and lets a prior `legal_hold` reason win (`:L386–L389`); the probe reads rows back through `listInvalidated` (§4.1). |
| `packages/memory/src/__tests__/deletion-propagation.test.ts:L96` | default-reason pin | `tombstones.every((entry) => entry.reason === "forgotten" && entry.hold !== true)` — must stay byte-identical. |
| `packages/memory/src/__tests__/deletion-propagation.test.ts:L183–L204` | 1k-artifact budget | 1,001 tombstoned, one transaction, `< 2_000ms`; measured baseline in §4.5. |
| `packages/memory/src/__tests__/deletion-propagation.test.ts:L108–L129` | fail-closed ACL cases | Denied propagation writes nothing; untouched by the additive field. |
| `packages/memory/src/fabric/__tests__/repoint.test.ts:L219–L231` | current workaround | `reason: "legal_hold"` passed to **both** the propagator and the handler — the double-entry the fix removes. |
| `packages/memory/src/rag/sources.ts:L178` | `createRagDeletionHandler` | Built-in handler. Grep for `reason` in its body: zero hits — it never reads the field. |
| `packages/memory/src/wiki/retire.ts:L124` | `createWikiDeletionHandler` | Same: zero `reason` reads. |
| `packages/memory/src/compaction/observational-memory/drop-invalidated.ts:L24` | `createObservationalMemoryDropHandler` | Same: zero `reason` reads. All three keep their results/statements unchanged. |
| `docs/rag.md:L112` | handler-context sentence | Documents `{ sourceId, ids, scope, signal }`; Task 2 adds `reason`. |
| `docs/memory-fabric.md:L80–L82` | retire bullet | "`legal_hold` when **both** the handler and the propagator are given it" — the sentence Task 2 replaces. |
| `docs/policy-and-audit.md:L121` | invalidation reason vocabulary | `corrected \| revoked \| forgotten \| legal_hold`; handler tombstones stay inside it. |
| `scripts/compat-baseline/arnilo__prism-memory.txt` | compat baseline | Gate input for the exported interface statement; an optional property is an additions-only diff if the gate reports it. |

### 1.2 Task 3 — the semantic reranker leg

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L422–L471` | `measureRecall(reranker)` (file-private) | Constructs `createHashEmbedder()` **internally** at `:L423`; one fresh store per call. Task 3 parameterizes the embedder; the corpus, `relevantIds`, `recallAtK`, and pool probes stay. |
| `packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L121–L386` | `RECALL_CORPUS` | 24 topics × (1 answer + 3 mention-only) = 96 chunks; inlined because the export budget counts `src/**` exports. Reused verbatim (§4.4 extracts the compiled array and counts 24/96). |
| `packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L394–L397` | `relevantIds` | `sourceId = `${topic.id}-answer``; chunk ids are exact. |
| `packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L400–L404` | `recallAtK` | Fraction of relevant ids in the first `k` hits. |
| `packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L473–L477` | `identityReranker` | The negative control Task 3 must also run on the semantic leg. |
| `packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L499–L607` | live leg + evidence writer | Gated by `PRISM_TEST_LOCAL_RERANK`; writes `docs/_evidence/phase102-local-rerank-latency.md` and asserts it is secret- and path-free. Task 3 extends this block. |
| `packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L59` | `EVIDENCE` URL | The generated evidence path. |
| `packages/memory/src/embedder.ts:L15` | `createHashEmbedder` | The deterministic 32-dim baseline; unchanged and still the cheap control. |
| `packages/memory/src/rag/local-reranker.ts:L22` | `DEFAULT_LOCAL_RERANK_MODEL` = `Xenova/bge-reranker-base` | Not moved. |
| `packages/memory/src/rag/local-reranker.ts:L45–L54` | `TransformersRerankRuntimeOptions` | `cacheDir?`, `allowRemoteModels?`, `dtype?`, `device?` — all optional, none defaulted. |
| `packages/memory/src/rag/local-reranker.ts:L70–L98` | `createTransformersRerankRuntime` | `AutoTokenizer` + `AutoModelForSequenceClassification`, one batched `score`. |
| `packages/memory/src/rag/local-reranker.ts:L74–L78` | settings forwarding | Each key forwarded only when set; `allowRemoteModels: false` → `local_files_only: true`. No `cache_dir` key when `cacheDir` is unset. **CONFIRMED §4.3.** |
| `packages/memory/src/rag/local-reranker.ts:L146` | `createLocalReranker` | Lazy memoized load; no I/O before the first `rerank` (§4.3). |
| `packages/memory/src/rag/reranker-config.ts:L32–L50` | `resolveReranker` | `{ kind: "local" } & CreateLocalRerankerOptions`; `none`/absent → `undefined`; unknown kind throws. **CONFIRMED §4.3.** |
| `packages/memory/src/rag/limits.ts:L19–L22` | `DEFAULT_TOP_K`, `HARD_TOP_K_CAP`, `DEFAULT_QUERY_CANDIDATES`, `HARD_QUERY_CANDIDATES_CAP` | 5 / 32 / 20 / 128 — none moves. |
| `packages/memory/src/rag/limits.ts:L79–L84` | `resolveRagLimits` | `queryCandidates` defaults to `max(20, topK)`; `queryCandidates >= topK` enforced. |
| `packages/memory/src/rag/indexing.ts:L12` | `indexChunks` | Indexes the corpus with any `Embedder`; the semantic leg's index-build timing uses it (§4.4). |
| `packages/memory/src/rag/retrieve.ts:L27` | `retrieveContext` | The measured path: `lexical: "off"`, `topK`, `queryCandidates`, `reranker`, `maxRerankMs`. |
| `packages/memory/src/rag/chunk.ts:L10` | `chunkMarkdown` | Builds the 96 chunks in the probe exactly as the suite does. |
| `packages/memory/src/rag/__tests__/rerank-fixtures.ts:L8` | `reliefHit` | The 50-candidate latency fixture reused for the semantic comparison (§4.4). |
| `docs/_evidence/phase102-local-rerank-latency.md` | hash row set | The row set the new semantic table mirrors; measured 0.208 → 0.792 (whole-corpus pool), pool@20 0.625 / pool@32 0.792, top-50 median 121 ms. |
| `docs/rag.md:L263` | sizing paragraph | Cite-and-extend target after Task 3: currently hash-baseline only. |
| `docs/embeddings.md:L94–L98` | shared weight-cache convention | One `cacheDir` per host, one subdirectory per model id; already names local embedders, so Task 3's line is only needed if the wording implies rerankers only. |
| `scripts/live-matrix.json:L786` | `memory/local-rerank-live` row | `requires: PRISM_TEST_LOCAL_RERANK`, `PRISM_TEST_LOCAL_RERANK_CACHE_DIR` optional; notes/cost name the existing corpus. Task 3 updates the notes/cost for the longer run. |
| `docs/live-testing.md` | generated matrix table | Regenerated by `scripts/live-matrix.mjs` if the row notes change. |
| `scripts/plan-review-gate.test.mjs` | this review's gate | `PLAN_111_TASK_1` names the tokens this file must keep. |

---

## 2. Gap rows (what no current seam does)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | `DeletionPropagationContext` carries no reason, and the propagator drops the reason it already resolved when it builds the context: four declared fields, one hand-built object per handler. Measured: a probe handler sees keys `[ids, scope, signal, sourceId]`, no `reason`. **CONFIRMED §4.1/§4.2.** | `packages/memory/src/propagation.ts` (`:L32–L38`, `:L150`) | 2 |
| G2 | The fabric retire leg resolves only its own option, so a `legal_hold` walk plus an unconfigured handler leaves the note id `forgotten` with no `hold` while the walk's own row is `legal_hold`+hold. **CONFIRMED §4.1(a).** | `packages/memory/src/fabric/repoint.ts` (`:L62`, `:L129–L134`) | 2 |
| G3 | The recall measurement hard-codes the deterministic hash embedder inside `measureRecall`; there is no embedder input and no semantic leg in the live suite. | `packages/memory/src/rag/__tests__/local-reranker-live.test.ts` (`:L422–L471`, `:L499–L607`) | 3 |
| G4 | The documented sizing advice rests on one lexical fixture embedder; the semantic baseline, the semantic pool bound, and the semantic reranker lift are unmeasured. **CONFIRMED §4.4.** | `docs/rag.md:L263` + the evidence table | 3 |
| G5 | No library default `cacheDir` exists (by design): with no `cacheDir`, the runtime forwards `{}` and uses its own package-local default. The per-host directory stays a documented host convention. **CONFIRMED §4.3.** | none (documented convention, not a code change) | 3 (docs only) |
| G6 | Demand-gated remainder: no `propagateDeletion` facade, no store ranged read (`afterId`/`limit`), and the re-point/rename/fabric surfaces have test consumers only. **CONFIRMED §4.6.** | plan 102 (stays recorded) | none |

---

## 3. Per-task verdict (reuse as-is / extend / add new)

| Task | Verdict | Seam | New surface |
| --- | --- | --- | --- |
| 2 — propagator's reason reaches handlers | **Extend `DeletionPropagationContext` additively** | The existing context object and the one handler call (`packages/memory/src/propagation.ts:L32–L38`, `:L150`); the fabric handler's existing resolution gains the context as first source (`packages/memory/src/fabric/repoint.ts:L62`); `MemoryInvalidationReason` reused | `readonly reason?: MemoryInvalidationReason` — no new type name, no new option, no second construction path, no second tombstone plane |
| 3 — semantic reranker evidence | **Parameterize the existing measurement** | `measureRecall` (`packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L422–L471`) takes the embedder as input; the corpus, `relevantIds`, `recallAtK`, the pool probes, the identity control, and the live-matrix row are reused; `createLocalReranker`/`resolveReranker` unchanged | One small embedder factory next to the existing runtime wiring in the same test file; a second evidence table; no dependency name in any manifest; no default moved |

Neither task adds a store method, a handler type, or an event.

---

## 4. Runnable confirmations

All probes ran against `packages/memory/dist/` built from this tree (Node v26.9.0). Probes are scratch files,
not committed; the harness is not part of the tree. The semantic probe in §4.4 is the gated live path: it
downloads the named weights once into the documented host cache directory and needs no credential.

### 4.1 (a) The reason trap — measured, not asserted — CONFIRMED

Probe: in-memory store holding one `kind: "file"` note (`metadata.fabric.path = "docs/a.md"`, id
`ce0821a0a5cc`), `createDeletionPropagator({ reason: "legal_hold" })` plus
`createFabricRepointHandler({ scope, vectorStore })` built without a reason. Printed `listInvalidated` rows,
sorted; `+hold` marks `hold: true`.

```text
A. propagator reason=legal_hold, handler reason=(unset), handler registered
   rows: ce0821a0a5cc:forgotten docs/a.md:legal_hold+hold
   layers: { "context-probe": 0, "fabric": 1 }, tombstoned: 1
B. propagator reason=legal_hold, handler reason=legal_hold (the workaround hosts use)
   rows: ce0821a0a5cc:legal_hold+hold docs/a.md:legal_hold+hold
C. propagator reason=(unset), handler reason=(unset) — the default path pinned by :L96
   rows: ce0821a0a5cc:forgotten docs/a.md:forgotten
```

The run reproduces the transcript recorded while the plan was written: the walk's own tombstone is
`legal_hold`+hold in both A and B, while the note tombstone is `forgotten` in A and only reaches
`legal_hold`+hold in B because the host repeated the reason. The plan's example id hashes differ; the shape
does not.

### 4.2 The gap is in the seam, not in a handler — CONFIRMED

Same probe, printing the context object every handler receives.

```text
context keys: ["ids", "scope", "signal", "sourceId"]
Object.hasOwn(context, "reason"): false
context JSON: {"sourceId":"docs/a.md","ids":["docs/a.md"],
  "scope":{"tenantId":"t1","resourceId":"docs","threadId":"fabric"},"signal":null}
```

Vacuity controls (the mismatch disappears when either side of the seam is removed, so the printout comes
from the propagator-to-handler seam, not from the fixture):

```text
V1. propagator reason=legal_hold, fabric handler NOT registered
    rows: docs/a.md:legal_hold+hold          (only the walk's row)
V2. fabric handler alone, no propagator walk
    rows: ce0821a0a5cc:forgotten, removed: 1 (only the handler's row)
```

### 4.3 The library owns no host path — CONFIRMED

`createTransformersRerankRuntime` was probed with a recording stub for the optional
`@huggingface/transformers` module, so the exact settings object forwarded to `from_pretrained` is printed:

```text
createTransformersRerankRuntime({}):
  [{loader:"AutoTokenizer",options:{}},{loader:"AutoModelForSequenceClassification",options:{}}]
createTransformersRerankRuntime({ cacheDir: "<host-cache-dir>" }):
  [{...,options:{"cache_dir":"<host-cache-dir>"}},{...,options:{"cache_dir":"<host-cache-dir>"}}]
createTransformersRerankRuntime({ dtype: "q8", device: "cpu" }):
  [{...,options:{"dtype":"q8","device":"cpu"}},{...,options:{"dtype":"q8","device":"cpu"}}]
createTransformersRerankRuntime({ allowRemoteModels: false }):
  [{...,options:{"local_files_only":true}},{...,options:{"local_files_only":true}}]
createTransformersRerankRuntime({ cacheDir, dtype, device, allowRemoteModels: false }):
  [{...,options:{"cache_dir":"<host-cache-dir>","dtype":"q8","device":"cpu","local_files_only":true}}, ...]

resolveReranker(undefined): undefined
resolveReranker({ kind: "none" }): undefined
resolveReranker({ kind: "local" }) exposes rerank: function
resolveReranker({}): throws RagValidationError: unknown reranker kind ""
createLocalReranker({}) loads before first rerank: 0
after one rerank, load calls: [{loader:"AutoTokenizer",options:{}},{loader:"AutoModelForSequenceClassification",options:{}}]
onLoad: [{"model":"Xenova/bge-reranker-base","loadMs":0}]
```

Decision (recorded, not a task): the per-host cache directory stays a documented host convention
(`docs/embeddings.md:L94–L98`, `docs/rag.md`), **not** a library default. With no `cacheDir` the runtime
forwards no `cache_dir` at all and uses its package-local default; a library-chosen home-directory path is a
policy decision with permissions implications (plan 102's recorded G3 half). `resolveReranker({})` is not a
valid call — `kind` is required; `{ kind: "local" }` is the zero-config path.

### 4.4 The semantic reranker evidence, re-measured cheaply — CONFIRMED

Probe: the compiled test file's own `RECALL_CORPUS` array extracted verbatim (24 topics / 96 chunks), one
index per embedder, `lexical: "off"`, vector-only, whole-corpus pool, `k=5`, pool probes at 20 and 32, the
same `Xenova/bge-reranker-base` q8/cpu reranker, one warm-up plus five timed top-50 runs.

```text
corpus: 24 topics / 96 chunks (one answer + three mention-only each)
hash  leg: indexBuildMs 3,   pool@20 0.625, pool@32 0.792, baseline 0.208, reranked 0.792
semantic embedder load: 11283 ms (Xenova/all-MiniLM-L6-v2, q8/cpu)
semantic leg: indexBuildMs 106, pool@20 1.000, pool@32 1.000, baseline 0.792, reranked 0.792
semantic misses (baseline): sandbox-scope, fusion-rrf, result-cap, wiki-raw-source, audit-log
semantic misses (reranked): telemetry-span, sandbox-scope, wiki-raw-source, audit-log, conformance
hash misses (baseline): 19 topics; (reranked): telemetry-span, sandbox-scope, wiki-raw-source, audit-log, conformance
top-50 rerank latency: median 122 ms over 5 runs (min 120, max 122), warm-up excluded
offline replay reranker (allowRemoteModels: false): 2 hits, first src#0001
offline replay embedder (local_files_only: true): 384 dims
harness wall clock: 171336 ms (cold weights: ~283 MB reranker + ~23 MB embedder)
```

Side by side with the 102 file:

| Leg | Embedder | baseline recall@5 | reranked recall@5 | pool@20 | pool@32 | top-50 median |
| --- | --- | --- | --- | --- | --- | --- |
| 102 | `createHashEmbedder` (32d) | 0.208 | 0.792 | 0.625 | 0.792 | 121 ms |
| 111 | `Xenova/all-MiniLM-L6-v2` q8/cpu (384d) | 0.792 | 0.792 | 1.000 | 1.000 | 122 ms |

The plan's premise is now a number: with a semantic embedder the baseline starts at the hash leg's
*reranked* number (0.792 = 0.792) and the reranker's lift is **0.000** on this corpus, while the five
residual misses are unchanged in count and move topic-for-topic (the reranker recovers `fusion-rrf` and
`result-cap`, loses `telemetry-span` and `conformance`). The pool bound at the package default
`DEFAULT_QUERY_CANDIDATES = 20` is **1.000** for a semantic host: the pool is not the binding constraint at 20;
the binding constraint is retrieval quality on the 5/24 topics neither leg fixes. Task 3's sizing sentence
must read the pool bound per embedder and say the hash-baseline advice ("the pool bound matters more than the
reranker") does not hold for the semantic leg at 20; that is a Task 3 compromise candidate, not a default move.
The reranker's own latency is unchanged within noise (122 ms vs 121 ms).

### 4.5 The 1k-artifact propagation budget Task 2 must not regress — CONFIRMED

Probe: same shape as `packages/memory/src/__tests__/deletion-propagation.test.ts:L183–L204` (1 source +
1,000 derived rows, one transaction), five fresh runs.

```text
1k-artifact propagation: 1,001 tombstoned, 1 transaction,
  5 runs [8.2, 1.9, 2.8, 1.2, 1.8]ms, median 1.9ms (assert < 2000ms)
```

Plan 102's review measured median 3.9 ms for the same path; the working-tree build is at least as fast. Task 2
adds one property to an object that is already built per handler, so no read or write is added; the suite's
`elapsed < 2_000ms`, `tombstoned === 1_001`, and `transactions === 1` assertions stay untouched.

### 4.6 Demand evidence for the gated remainder — CONFIRMED

Grep commands ran over `src packages examples scripts` (`--include=*.ts|*.mjs|*.js`, excluding `dist/` and
`node_modules/`), then over `docs plans` for mentions. The consumer conclusion is per plan 102 Further Action:

| Plan 102 item | Grep | In-repo consumers | Conclusion |
| --- | --- | --- | --- |
| Task 7 upgrade path — `applySourceRenames` | `applySourceRenames` | Definition + export (`packages/memory/src/repoint.ts:L429`, `packages/memory/src/index.ts:L84`) and tests (`packages/memory/src/__tests__/repoint.test.ts`); docs only otherwise | no host consumer → stays recorded in plan 102 |
| Task 10/11 upgrade path — `repointSource(` | `repointSource(` | The helper's own loop (`packages/memory/src/repoint.ts:L392`) and tests only; no host runtime/example | no host consumer → stays recorded in plan 102 |
| Task 11 — `createFabricRepointHandler` | `createFabricRepointHandler` | Definition + fabric subpath export and tests; `packages/memory/src/__tests__/host-wiring.test.ts:L175` is an executed composition recipe, not a shipped host | no shipped host consumer → stays recorded in plan 102 |
| Task 8 upgrade path — `propagateDeletion facade` | `propagateDeletion` | **zero hits** in code; only `docs plans` mentions | no facade exists and none is asked for → stays recorded in plan 102 |
| Task 10 upgrade path — `store-level ranged read` | `afterId` | **zero hits** in code; only `docs plans` mentions | no ranged read exists and none is asked for → stays recorded in plan 102 |
| Task 7 upgrade path — rename push notification | `onSourceAccessChanged` | zero hits in code (plan 102 review R15 already rejected the store event) | no consumer → stays recorded in plan 102 |
| Task 6 follow-up — per-rule denial detail | — | Boundary `AccessDenial.reason` is `no_grant \| check_failed`; no host reads a rule detail | no consumer → stays recorded in plan 102 |
| Task 5 follow-up — store-level source-owned invalidation | — | No host measures boundary filtering as a bottleneck | no consumer → stays recorded in plan 102 |
| Task 7 follow-up — batch renames as one transaction | — | No host batches renames | no consumer → stays recorded in plan 102 |

Task 3 takes the semantic half of the reranker-sizing item (the non-CPU/fp16 half is host-provisioned, §6);
no other item is promoted by this review.

---

## 5. Rejected alternatives (frozen)

| # | Rejected | Reason | Would have changed |
| --- | --- | --- | --- |
| R1 | [second tombstone plane] | Two invalidation writers per record is the failure mode this plan's objectives rule out (one store invalidation path stays, and plan 102 R12 already rejected a store-level audit sink/event bus). | Task 2 |
| R2 | [required field] on `DeletionPropagationContext` | Breaks every hand-built handler context for a field only one built-in needs; the point is optional/additive. | Task 2 |
| R3 | Accept the `legal_hold` → `forgotten` mismatch as documented behavior (plan 102's recorded compromise) | A hold that lands as a forget is an audit/retention error in a compliance path; the fix is one optional field, and the compromise stays recorded as the reason the field is additive rather than required. | Task 2 |
| R4 | A `handlerReason`/`propagatorReason` pair | Two sources of truth and an ambiguity to resolve at every call site; the propagator already resolves once (`packages/memory/src/propagation.ts:L89`). | Task 2 |
| R5 | Have the propagator stamp the handler's count with its reason | The gap is what the handler writes, not what the walk records; the walk already carries the reason. | Task 2 |
| R6 | [raising the pool] (`queryCandidates`/`HARD_TOP_K_CAP`) from the semantic numbers | The pool is a host cost decision and the numbers are one machine; at the default 20 the semantic pool bound is already 1.000, so raising it buys nothing on this corpus. | Task 3, plan 102 sizing |
| R7 | A [GPU default] / fp16 default from the measurement | Not provisioned on this machine and a GPU number without a host that has one changes nothing; the non-CPU leg stays host-provisioned and documented. | Task 3, package defaults |
| R8 | Re-tune `DEFAULT_LOCAL_RERANK_MODEL`, `dtype`, or `device` | One corpus, one machine; the task is evidence, not tuning, and the measured latency/quality did not contradict the shipped defaults. | Task 3 |
| R9 | Replace the hash-embedder baseline entirely | It is the cheap deterministic control that keeps the measurement honest without a download, and the comparison is the point of the evidence. | Task 3 |
| R10 | A second gated suite file for the semantic leg | A new live-matrix row, a duplicated corpus, and a second place for the numbers to drift. | Task 3 |
| R11 | Assume the semantic case from the lexical numbers | The fixture's own caveat (`packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L110–L112`) says the two differ, and the measurement confirms it (0.792 baseline vs 0.208). | Task 3 |
| R12 | Measure with a large embedder or on GPU | The leg must stay cheap (small `q8`/`cpu` model, ~30 MB class); the corpus is short technical text where a small model is representative. | Task 3 |
| R13 | A library default `cacheDir` (home directory) | Permissions/policy decision, not a library choice; the per-host convention (`docs/embeddings.md:L94–L98`) stands. | Task 3, plan 102 G3 |
| R14 | A [propagateDeletion facade] now | No in-repo consumer (§4.6); the propagator already owns registration, privilege, and the id set. | plan 102 Task 8 (stays recorded) |
| R15 | [directory-move expansion] (`pathsFor` mapper) for the fabric handler | No host re-points a directory of noted files; one re-point per path is the shipped call. | plan 102 Task 11 (stays recorded) |
| R16 | A [store-level ranged read] (`afterId`/`limit`) for paged re-point | No host drives scopes far above the page size; the whole-scope read is correct if not free. | plan 102 Task 10 (stays recorded) |
| R17 | Skip the review and write Tasks 2–3 directly | Task 2 changes an exported context type and Task 3 re-states a shipped default's evidence; the reuse/gap/reject rows are what a later reader re-decides from. | Task 1 |
| R18 | One evidence file per task | One review owns the inventory and later tasks cite its rows, matching plans 102/103/104/108/109/110. | Task 1 |
| R19 | Register the gate block later | The gate precedes the code so the review cannot silently drift. | Task 1 |

---

## 6. Security confirmations

- **A reason can only make a tombstone stricter.** In one propagation the walk's rows are written before any
  handler runs (`packages/memory/src/propagation.ts:L150`), and the store's `invalidate` keeps `hold` sticky
  and a prior `legal_hold` reason (`packages/memory/src/vector-memory.ts:L386–L389`). Task 2's precedence
  (`context.reason` first) lets a `legal_hold` propagator raise a handler's default `forgotten`; a handler's
  stronger reason cannot fire under a weaker propagator because the propagator's value wins — nothing
  weakens a hold and nothing invents one. Asserted in both directions by Task 2's mirror cases.
- **No handler gains write privileges.** `reason` is a label on an invalidation row. The handler call path,
  its scope assertion (`packages/memory/src/fabric/repoint.ts:L69–L73`), and the privileged ACL check that
  runs before any write (`packages/memory/src/propagation.ts:L102–L108`) are untouched; the fail-closed cases
  at `packages/memory/src/__tests__/deletion-propagation.test.ts:L108–L129` stay green.
- **The semantic leg is the gated live path.** `PRISM_TEST_LOCAL_RERANK=1` is required; a cold run touches
  the network once to download the named weights into the documented host cache dir; replay is offline —
  measured with `allowRemoteModels: false` (reranker) and `local_files_only: true` (embedder), §4.4 — and
  `createTransformersRerankRuntime` forwards `local_files_only: true` whenever `allowRemoteModels: false`
  (§4.3). With the gate unset the leg skips with its named reason and downloads nothing.
- **No content, credentials, or host paths in either evidence file.** The semantic probe embeds generated
  corpus text only, never host or captured content. The evidence rows record model ids, dtype/device, counts,
  numbers, and cache *layout*, never an absolute path; the existing writer already asserts secret-shape and
  absolute-path absence (`packages/memory/src/rag/__tests__/local-reranker-live.test.ts:L597–L602`), and this
  review's semantic table follows the same rule.
- **No declared inference dependency.** The semantic leg uses the same non-literal dynamic-import runtime seam
  (`packages/memory/src/rag/local-reranker.ts:L120–L136`), and the embedder factory Task 3 adds lives in the
  test file; no manifest gains a dependency name.

---

## 7. Evidence-artifact scope

Read-only for the tree: this review adds no code and no docs navigation. `docs/index.md` is untouched
(evidence files are not navigation targets, `.agents/skills/create-plan/references/prism-wiki.md`). Tasks 2
and 3 must cite a row from §1/§3; any new primitive they need that is absent here is a review gap and must be
added to §2 before implementation. The gate entry `PLAN_111_TASK_1` in `scripts/plan-review-gate.test.mjs`
freezes this file's required tokens and rejected list.
