/**
 * Local reranker live leg (plan 102 Tasks 3 and 4): the real transformers.js runtime,
 * no injected stub, on this machine — the leg the plan 064 matrix was missing
 * (hosted/TEI endpoints are covered; in-process weights were not). Task 4 adds the recall@k
 * measurement over the inlined corpus (mention-only distractors vs answers, lexical baseline
 * vs cross-encoder) and the on-disk weight-cache layout assertion.
 *
 * Gated by `PRISM_TEST_LOCAL_RERANK=1` because a cold run downloads model
 * weights (~280 MB class int8) from the documented model id; unset, the leg
 * skips with a reason and never silently passes. With the gate set there is no
 * skip path: a missing runtime, an unreachable model, or a load failure throws
 * `RagValidationError` with install guidance and fails the run (matrix suite
 * `memory/local-rerank-live`, strict mode included).
 *
 * It also writes the generated evidence row
 * `docs/_evidence/phase102-local-rerank-latency.md`: top-50 median latency, the recall numbers
 * above, model id, dtype, device, machine, Node version, cache-vs-download, and the cache
 * layout. The report carries no absolute host paths, no document text, and no secret-shaped
 * string (asserted before it is written).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus, hostname } from "node:os";
import { dirname, join, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createHashEmbedder, createMemoryVectorStore } from "../../index.js";
import {
  chunkMarkdown,
  DEFAULT_LOCAL_RERANK_MODEL,
  indexChunks,
  type RagChunk,
  type RagHit,
  type Reranker,
  resolveReranker,
  retrieveContext,
  runRerankerConformance,
} from "../index.js";
import { reliefHit } from "./rerank-fixtures.js";

const GATED = process.env.PRISM_TEST_LOCAL_RERANK === "1";
const SKIP_REASON = "set PRISM_TEST_LOCAL_RERANK=1 to run the real local cross-encoder (downloads or reuses cached weights)";
const MODEL = process.env.PRISM_LIVE_LOCAL_RERANK_MODEL?.trim() || DEFAULT_LOCAL_RERANK_MODEL;
/** Documented default for x86 CPU hosts (docs/rag.md sizing paragraph). */
const DTYPE = "q8";
const DEVICE = "cpu";
/** Host weight cache; `node_modules/.cache` keeps a cold run off the repo checkout. */
const CACHE_DIR =
  process.env.PRISM_TEST_LOCAL_RERANK_CACHE_DIR?.trim() || join(process.cwd(), "node_modules", ".cache", "prism-local-rerank");
const TOP_K = 50;
const LATENCY_RUNS = 5;
/** Recall knobs: `k` is what the caller keeps, the measured legs score the whole corpus so the only variable is the
 * ordering, and the probe depths show what a narrow candidate pool would have capped recall at. */
const RECALL_K = 5;
const RECALL_POOL_DEPTHS = [20, 32] as const;
/** `rerankHits` default timeout is 2s; the measurement scores 20 pairs per query and reuses the already loaded model. */
const RECALL_MAX_RERANK_MS = 10_000;
const RECALL_SCOPE = { tenantId: "t1", resourceId: "rerank-recall", corpusId: "phase102" } as const;
const EVIDENCE = new URL("../../../../../docs/_evidence/phase102-local-rerank-latency.md", import.meta.url);

/** Non-sensitive probe inputs by construction. */
const QUERY = "capital of France";
const FIXTURE_TEXTS = ["Paris is the capital of France.", "The Eiffel Tower stands in Paris.", "Sourdough bread needs a long ferment."];

function fixtureHits(): RagHit[] {
  return FIXTURE_TEXTS.map((text, index) => ({ ...reliefHit(`src#000${index + 1}`, 0, index), text }));
}

/** 50 distinct candidate chunks for the latency probe (top-50 is the documented sizing unit). */
function latencyHits(): RagHit[] {
  return Array.from({ length: TOP_K }, (_, index) => ({
    ...reliefHit(`src#${String(index + 1).padStart(4, "0")}`, 0, index),
    text: `Candidate ${index + 1}: ${index % 7 === 0 ? "approval policy recheck before side effects" : "unrelated note about scheduling and tooling"}`,
  }));
}

/** Bytes under `dir` whose path names the model id — the cache-hit probe for the report. */
function cachedBytes(dir: string, model: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.split(sep).join("/").includes(model)) total += statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  assert.ok(middle !== undefined, "median requires a non-empty sample");
  return middle;
}

// --- recall corpus (plan 102 Task 4) -----------------------------------------
//
// One topic = one query + one answering chunk + three *mention-only* chunks (option-list/table-of-
// contents lines, the classic lexical false positive: they repeat the query's words and answer
// nothing). The corpus is inlined rather than a second fixture module because the export budget
// counts every `src/**` export, test helpers included — data needs no export.
//
// The baseline retriever is `createHashEmbedder` (deterministic, no download, no semantics), so the
// measured delta is the cross-encoder's contribution on mention-vs-answer. It is not a promise
// about production embedders: a semantic embedder starts higher and gains less.

interface RecallTopic {
  readonly id: string;
  readonly query: string;
  readonly answer: string;
  readonly mentionOnly: readonly [string, string, string];
}

const RECALL_CORPUS: readonly RecallTopic[] = [
  {
    id: "recheck",
    query: "How does the access recheck decide that a grant is revoked?",
    answer:
      "The recheck compares every candidate source against the grants the store currently holds; a grant that is gone counts as revoked, so the source is dropped before it reaches the context.",
    mentionOnly: [
      "Access recheck options: the grant, the revoked flag, the tenant, and the audit trail.",
      "Grants, revocations, and access rechecks for the resource appear in the operator view.",
      "A revoked grant and an access recheck are both recorded in the audit log for the retention window.",
    ],
  },
  {
    id: "propagation-delete",
    query: "What happens to indexed chunks when a source is deleted?",
    answer:
      "Deleting a source tombstones it and walks the propagation edges, so every indexed chunk, wiki page, and observation block derived from that source goes in the same pass.",
    mentionOnly: [
      "Deletion propagation: tombstones, propagation edges, indexed chunks, and wiki pages.",
      "The delete command removes a source; indexed chunks are listed next to the tombstone.",
      "Propagation edges connect a source to an indexed chunk and to the tombstone record.",
    ],
  },
  {
    id: "weight-cache",
    query: "Where do downloaded model weights live and what happens on a cache miss?",
    answer:
      "Weights live in a host cache directory, one subdirectory per model id; on a cache miss the runtime downloads the model there once, and later runs read the same files with no network.",
    mentionOnly: [
      "Cache dir, model id, download, cache miss: see the model cache options.",
      "Model weights, the download, and the cache are cached per host by the runtime.",
      "A cache miss on the model id triggers a download into the cache dir for that model.",
    ],
  },
  {
    id: "rerank-order",
    query: "Why does reranking change the order of retrieved chunks?",
    answer:
      "A cross-encoder scores each query and document pair jointly, so a chunk that answers the query outranks a chunk that merely repeats its words; the vector search keeps recall and the reranker fixes the order.",
    mentionOnly: [
      "Reranking options: the query, the retrieved chunks, the order, and the cross-encoder.",
      "The order of retrieved chunks is reranked per request by the configured reranker.",
      "Retrieved chunks and their order are listed with the query in the reranking section.",
    ],
  },
  {
    id: "invalidation-stale",
    query: "How do already emitted observation blocks become stale?",
    answer:
      "Building the projection takes the ids the scope currently withholds and drops every emitted block resting on one of them, so stale observations stop being injected on the next build instead of lingering.",
    mentionOnly: [
      "Invalidation options: emitted blocks, stale ids, and the projection build per scope.",
      "Observation blocks are invalidated per scope; the projection build rebuilds the blocks.",
      "Invalidated ids are listed per scope next to the emitted blocks and the projection.",
    ],
  },
  {
    id: "repoint-tombstone",
    query: "Does a tombstone survive a re-point of the source path?",
    answer:
      "Re-pointing moves the rows that belong to the source and rewrites the source id, and the tombstone moves with them, so a renamed source cannot be resurrected.",
    mentionOnly: [
      "Re-pointing options: the source path, the destination path, the source id, the tombstone.",
      "Re-pointing the source path rewrites the source id for the destination path.",
      "The source path and the tombstone are listed in the re-pointing section.",
    ],
  },
  {
    id: "chunking",
    query: "Why does one document become several chunks?",
    answer:
      "A document is split at heading and paragraph boundaries up to the chunk size, with a small overlap, so a sentence that crosses a boundary stays retrievable from both sides.",
    mentionOnly: [
      "Chunking options: chunk size, chunk overlap, the chunk index, and the heading stack.",
      "Chunk size and chunk overlap are configured per document in the chunking options.",
      "The chunk index and the document heading are listed with the chunks.",
    ],
  },
  {
    id: "embedder-dimensions",
    query: "What happens when an embedder's dimensions change?",
    answer:
      "Vectors are written with the embedder's dimension count, so an index built by a differently sized embedder cannot be read: retrieval fails closed with a dimension mismatch instead of comparing vectors of different shapes.",
    mentionOnly: [
      "Embedder options: dimensions, the vector store, the index, and the dimension cap.",
      "Embedder dimensions are validated against the dimension cap before the index is written.",
      "The embedder id and its dimensions are listed with the index and the store.",
    ],
  },
  {
    id: "lineage-layer",
    query: "How do I know which layer an invalidation came from?",
    answer:
      "Every invalidation record names the layer it came from — vector, wiki, or observational memory — and `explainRecord` lists the records that affect one id, so an operator can see which layer dropped it.",
    mentionOnly: [
      "Lineage options: invalidation records, layers, ids, and the recall explanation.",
      "Invalidation records are grouped by layer: vector, wiki, and observational memory.",
      "An invalidation record lists the layer, the id, and the reason.",
    ],
  },
  {
    id: "retention-expiry",
    query: "What happens to a source that reaches its retention limit?",
    answer:
      "The source expires on the next sweep: its chunks are tombstoned exactly like a manual delete, so retention never leaves a readable copy behind, and the sweep is idempotent if it runs twice.",
    mentionOnly: [
      "Retention options: the retention window, the sweep, the source, and the tombstone.",
      "The retention window is configured per source next to the sweep interval.",
      "Sources past the retention window are listed in the sweep report with their ids.",
    ],
  },
  {
    id: "redaction",
    query: "Are secrets stripped from retrieved text?",
    answer:
      "Yes: retrieved text and citation excerpts pass the configured redactor before they are returned, and a secret that the redactor recognizes is replaced in place rather than returned, so the model never sees it.",
    mentionOnly: [
      "Redaction options: secrets, the redactor, retrieved text, and citation excerpts.",
      "The redactor is configured per request and applies to retrieved text.",
      "Retrieved text, citations, and secrets are listed in the redaction notes.",
    ],
  },
  {
    id: "telemetry-span",
    query: "What does a retrieval span record?",
    answer:
      "One span per retrieval, carrying the query's scope, the hit and candidate counts, the rerank mode, and the durations of embed, search, and rerank — never query or document text.",
    mentionOnly: [
      "Telemetry options: spans, attribute values, durations, and the telemetry seam.",
      "Span attributes include the candidate count, the hit count, and the rerank mode.",
      "The retrieval span and its attributes are listed under telemetry.",
    ],
  },
  {
    id: "sandbox-scope",
    query: "What may a tool call touch on the host?",
    answer:
      "Only the paths and origins the host granted: the sandbox resolves every path inside its root and rejects the rest, so an absolute path or a parent-directory escape cannot reach outside the workspace.",
    mentionOnly: [
      "Sandbox options: the root, path containment, allowed origins, and the jail.",
      "Paths outside the sandbox root are rejected before the tool runs.",
      "The sandbox root and the allowed origins are listed in the tool options.",
    ],
  },
  {
    id: "approval-side-effect",
    query: "When does a side effect need approval?",
    answer:
      "When the host marks the tool as side-effecting: the call is parked, the approval request carries the exact arguments and their digest, and the effect runs only after a matching approval arrives.",
    mentionOnly: [
      "Approval options: the tool, the arguments, the digest, and the approval control.",
      "Approval requests list the tool, the arguments, and the digest of the call.",
      "Side-effecting tools and their approvals are listed in the tool policy.",
    ],
  },
  {
    id: "scope-required",
    query: "Why must every query name a scope?",
    answer:
      "Because a scope is the isolation boundary: retrieval only ever reads the tenant, resource, and corpus it was given, so a query that names no scope cannot accidentally widen into another tenant's data.",
    mentionOnly: [
      "Scope options: tenant, resource, corpus, and the scope cap per query.",
      "The tenant, the resource, and the corpus are set per query scope.",
      "Scopes and their tenant ids are listed in the isolation notes.",
    ],
  },
  {
    id: "citation-id",
    query: "How is a citation id formed?",
    answer:
      "A citation id is the source id plus the chunk's zero-padded index in that source, so the id points at the exact passage and stays stable across re-indexing as long as the source keeps its offset.",
    mentionOnly: [
      "Citation options: the source id, the chunk index, the citation id, and byte offsets.",
      "Citations carry the source id and the chunk index in the citation id.",
      "Source ids and citation ids are listed with the chunk offsets.",
    ],
  },
  {
    id: "trust-untrusted",
    query: "Why is retrieved text marked untrusted?",
    answer:
      "Because a retrieved document is attacker-reachable content: it is wrapped as untrusted and inert, so instructions inside it are never treated as host instructions even though the text is shown to the model.",
    mentionOnly: [
      "Trust options: untrusted content, inert text, injection-capable sources, and trust flags.",
      "Retrieved content is marked untrusted and inert before it is serialized.",
      "Trust flags and untrusted sources are listed in the trust notes.",
    ],
  },
  {
    id: "fusion-rrf",
    query: "How are the vector and lexical legs merged?",
    answer:
      "The two ranked lists are merged with reciprocal-rank fusion: each leg contributes 1/(k+rank) per document, so a document both legs agree on rises without either leg's raw score dominating.",
    mentionOnly: [
      "Fusion options: the lexical leg, the vector leg, reciprocal-rank fusion, and the smoothing constant.",
      "The lexical leg and the vector leg are merged with reciprocal-rank fusion.",
      "Fusion modes and the smoothing constant are listed in the retrieval options.",
    ],
  },
  {
    id: "result-cap",
    query: "What happens when a result exceeds the byte cap?",
    answer:
      "The result is truncated at a UTF-8 boundary, the truncation flag is set, and the citations keep pointing at the untruncated passages, so oversize context degrades visibly instead of failing or silently dropping text.",
    mentionOnly: [
      "Cap options: max result bytes, max context tokens, truncation, and UTF-8 boundaries.",
      "Max result bytes and max context tokens are configured per request.",
      "Byte caps and the truncation flag are listed in the limits section.",
    ],
  },
  {
    id: "wiki-raw-source",
    query: "How does a wiki page reference its raw source?",
    answer:
      "The page records the raw source path and the file hash it was compiled from, so a maintainer can recompile the page when the hash changes and a rename is caught by the manifest instead of silently forking the page.",
    mentionOnly: [
      "Wiki options: the raw source, the source file hash, the manifest, and anchors.",
      "The manifest lists the raw sources, the page anchors, and the source file hashes.",
      "Raw source paths and page ids are listed in the wiki index.",
    ],
  },
  {
    id: "grant-sharing",
    query: "Who may read a shared scope?",
    answer:
      "Only principals the host named in the grant: a shared scope is readable by the principals on its grant list and by nobody else, and the store enforces that per query rather than trusting the caller.",
    mentionOnly: [
      "Grant options: the principal, the shared scope, the grant list, and the access check.",
      "Shared scopes carry a grant list of principals and their access reasons.",
      "Principals and their shared scopes are listed in the work scope options.",
    ],
  },
  {
    id: "audit-log",
    query: "What does the audit log keep?",
    answer:
      "Append-only entries for the decisions that changed access: grants issued and revoked, scope merges, and denied reads, each with the principal and the reason, never document text.",
    mentionOnly: [
      "Audit options: the audit log, entries, principals, reasons, and the retention window.",
      "The audit log records entries with the principal and the reason per event.",
      "Audit entries and their retention window are listed in the operator notes.",
    ],
  },
  {
    id: "om-ledger",
    query: "How does a session ledger fold?",
    answer:
      "Folding replays the session's entries in order and keeps the newest observation per block id, so a corrected observation replaces the earlier one and the fold is idempotent when the log replays.",
    mentionOnly: [
      "Ledger options: entries, block ids, observations, and the fold.",
      "The fold replays entries in order and keeps the newest observation per block id.",
      "Session entries and their block ids are listed in the ledger notes.",
    ],
  },
  {
    id: "conformance",
    query: "What does a conformance run prove?",
    answer:
      "That an adapter obeys its contract on the host's own runtime: the same permutation, determinism, and empty-input guarantees every other adapter passes, so a green run means the seam behaves, not that the model is good.",
    mentionOnly: [
      "Conformance options: the adapter, the contract, determinism, and the empty-input case.",
      "A conformance run checks the adapter against the contract before the model is used.",
      "Adapters and their conformance runs are listed in the testing notes.",
    ],
  },
];

/** One source per corpus item: chunk ids are `${sourceId}#0001`, so the relevant ids are exact. */
const CORPUS_CHUNKS: readonly RagChunk[] = RECALL_CORPUS.flatMap((topic) => [
  ...chunkMarkdown(topic.answer, { sourceId: `${topic.id}-answer` }),
  ...topic.mentionOnly.flatMap((text, index) => chunkMarkdown(text, { sourceId: `${topic.id}-mention-${index}` })),
]);

function relevantIds(topic: RecallTopic): readonly string[] {
  const sourceId = `${topic.id}-answer`;
  return CORPUS_CHUNKS.filter((chunk) => chunk.sourceId === sourceId).map((chunk) => chunk.id);
}

/** Fraction of the relevant ids present in the first `k` hits (one relevant chunk per query here). */
function recallAtK(hits: readonly RagHit[], relevant: readonly string[], k: number): number {
  if (relevant.length === 0) return 0;
  const returned = new Set(hits.slice(0, k).map((hit) => hit.id));
  return relevant.filter((id) => returned.has(id)).length / relevant.length;
}

interface RecallMeasurement {
  readonly corpusQueries: number;
  readonly corpusChunks: number;
  readonly k: number;
  /** Depths probed for the pool bound: recall at that depth with the same vector order (no rerank). */
  readonly poolDepths: readonly number[];
  readonly poolRecall: readonly number[];
  /** Recall@k with the vector order only, every answer in the pool. */
  readonly baseline: number;
  /** Recall@k after the reranker (or the same number for an identity reranker — the negative control). */
  readonly reranked: number;
  readonly missesBaseline: readonly string[];
  readonly missesReranked: readonly string[];
}

/** End-to-end measurement over the corpus: one hash-embedder index, both legs, no model for the baseline leg. */
async function measureRecall(reranker: Reranker | undefined): Promise<RecallMeasurement> {
  const embedder = createHashEmbedder();
  const store = createMemoryVectorStore();
  await indexChunks({ chunks: CORPUS_CHUNKS, embedder, store, scope: RECALL_SCOPE });
  // The measured legs score the whole corpus, so the only variable is the ordering — every answer is
  // reachable in the pool. The probes below show what a narrow pool would have capped recall at.
  const fullPool = CORPUS_CHUNKS.length;
  assert.ok(fullPool <= 128, "the corpus must fit one queryCandidates call");
  const missesBaseline: string[] = [];
  const missesReranked: string[] = [];
  const poolRecall = RECALL_POOL_DEPTHS.map(() => 0);
  let baseline = 0;
  let reranked = 0;
  for (const topic of RECALL_CORPUS) {
    const relevant = relevantIds(topic);
    const shared = { embedder, store, scope: RECALL_SCOPE, lexical: "off" } as const;
    for (const [index, depth] of RECALL_POOL_DEPTHS.entries()) {
      const probed = await retrieveContext(topic.query, { ...shared, topK: depth, queryCandidates: depth });
      poolRecall[index] = (poolRecall[index] ?? 0) + recallAtK(probed.hits, relevant, depth);
    }
    const base = await retrieveContext(topic.query, { ...shared, topK: RECALL_K, queryCandidates: fullPool });
    const scored = await retrieveContext(topic.query, {
      ...shared,
      topK: RECALL_K,
      queryCandidates: fullPool,
      maxRerankMs: RECALL_MAX_RERANK_MS,
      ...(reranker ? { reranker } : {}),
    });
    assert.equal(scored.hits.length, RECALL_K, `retrieval must still return ${RECALL_K} hits for ${topic.id}`);
    const plain = recallAtK(base.hits, relevant, RECALL_K);
    const lifted = recallAtK(scored.hits, relevant, RECALL_K);
    baseline += plain;
    reranked += lifted;
    if (plain < 1) missesBaseline.push(topic.id);
    if (lifted < 1) missesReranked.push(topic.id);
  }
  const queries = RECALL_CORPUS.length;
  return {
    corpusQueries: queries,
    corpusChunks: CORPUS_CHUNKS.length,
    k: RECALL_K,
    poolDepths: RECALL_POOL_DEPTHS,
    poolRecall: poolRecall.map((sum) => sum / queries),
    baseline: baseline / queries,
    reranked: reranked / queries,
    missesBaseline,
    missesReranked,
  };
}

/** A reranker that keeps the vector order: the measurement's negative control. */
const identityReranker: Reranker = {
  async rerank({ hits }) {
    return hits;
  },
};

describe("rerank recall measurement (hermetic)", () => {
  it("recall_at_k_counts_a_promoted_relevant_chunk_and_an_unchanged_order_the_same_way", () => {
    const hits = Array.from({ length: 8 }, (_, index) => reliefHit(`src#${String(index + 1).padStart(4, "0")}`, 0, index));
    const relevant = ["src#0006"];
    assert.equal(recallAtK(hits, relevant, 5), 0, "rank 6 is outside the top 5");
    assert.equal(recallAtK(hits, relevant, 6), 1, "the same chunk inside k counts");
    const promoted = [hits[5], ...hits.slice(0, 5), ...hits.slice(6)].filter((hit): hit is RagHit => hit !== undefined);
    assert.equal(recallAtK(promoted, relevant, 5), 1, "promoting the relevant chunk raises recall@k");
    assert.equal(recallAtK(hits, [], 5), 0, "no relevant ids means no recall to claim");
  });

  it("an_identity_reranker_reproduces_the_baseline_number", async () => {
    const measured = await measureRecall(identityReranker);
    assert.equal(measured.corpusChunks, RECALL_CORPUS.length * 4, "one answer + three mention-only chunks per topic");
    assert.equal(measured.poolRecall.length, RECALL_POOL_DEPTHS.length);
    assert.equal(measured.reranked, measured.baseline, "an identity ordering must not move recall");
  });
});

describe("local reranker live (real transformers.js runtime)", () => {
  it("local_reranker_live_is_conformant_orders_by_relevance_and_records_evidence", { skip: !GATED && SKIP_REASON }, async () => {
    const cachedBefore = cachedBytes(CACHE_DIR, MODEL);
    const load: { model: string; loadMs: number }[] = [];
    const reranker = resolveReranker({
      kind: "local",
      model: MODEL,
      dtype: DTYPE,
      device: DEVICE,
      cacheDir: CACHE_DIR,
      onLoad: (info) => load.push(info),
    });
    assert.ok(reranker, "local reranker config must resolve");

    // Network-free conformance contract (permutation, determinism, empty input).
    await runRerankerConformance(() => reranker);

    // Ordering sanity on a fixed fixture query: the exact answer must beat the distractor.
    const ordered = await reranker.rerank({ query: QUERY, hits: fixtureHits() });
    assert.equal(ordered[0]?.id, "src#0001", "the exact answer must rank first");

    // Top-50 latency: warm-up (steady-state scoring), then timed runs.
    const hits = latencyHits();
    const warm: readonly RagHit[] = await reranker.rerank({ query: QUERY, hits });
    assert.equal(warm.length, TOP_K);
    const timings: number[] = [];
    for (let run = 0; run < LATENCY_RUNS; run += 1) {
      const started = Date.now();
      const timed: readonly RagHit[] = await reranker.rerank({ query: QUERY, hits });
      timings.push(Date.now() - started);
      assert.equal(timed.length, TOP_K);
      for (let i = 1; i < timed.length; i += 1) {
        const previous = timed[i - 1];
        const current = timed[i];
        assert.ok(previous !== undefined && current !== undefined && previous.score >= current.score, "scores must be non-increasing");
      }
    }

    // Zero network after the first load: a second runtime pinned to local files only,
    // sharing the cache dir, must score without touching the model registry.
    const offline = resolveReranker({
      kind: "local",
      model: MODEL,
      dtype: DTYPE,
      device: DEVICE,
      cacheDir: CACHE_DIR,
      allowRemoteModels: false,
    });
    assert.ok(offline);
    assert.equal((await offline.rerank({ query: QUERY, hits: fixtureHits() })).length, FIXTURE_TEXTS.length);

    // Recall@k on the fixture corpus, rerank off vs on, through the real retrieval path.
    const recall = await measureRecall(reranker);
    assert.equal(recall.corpusQueries, RECALL_CORPUS.length, "the corpus is measured whole");
    assert.equal(recall.poolDepths.length, recall.poolRecall.length);
    assert.ok(recall.baseline >= 0 && recall.baseline <= 1 && recall.reranked >= 0 && recall.reranked <= 1);
    assert.ok(existsSync(CACHE_DIR), "the documented cache dir layout must exist after a load");
    assert.ok(cachedBytes(CACHE_DIR, MODEL) > 0, "the host cache must hold the weights under a path naming the model id");

    assert.equal(load.length, 1, "one lazy load per reranker instance");
    assert.equal(load[0]?.model, MODEL);
    const cachedAfter = cachedBytes(CACHE_DIR, MODEL);
    const weights =
      cachedBefore > 0
        ? `cache hit (${megabytes(cachedBefore)} in cache before load)`
        : `downloaded on this run (${megabytes(cachedAfter)} cached)`;
    const report = [
      "# Phase 102 — Local reranker live leg (generated)",
      "",
      `Generated by \`packages/memory/src/rag/__tests__/local-reranker-live.test.ts\` on a gated run`,
      "(`PRISM_TEST_LOCAL_RERANK=1`). Re-run the leg to regenerate; never hand-edit the numbers.",
      "",
      "| field | value |",
      "| --- | --- |",
      `| model | \`${MODEL}\` |`,
      `| dtype / device | \`${DTYPE}\` / \`${DEVICE}\` |`,
      `| machine | ${hostname()} (${cpus()[0]?.model ?? "unknown CPU"}) |`,
      `| platform | ${process.platform} ${process.arch}, Node ${process.version} |`,
      `| weights | ${weights} |`,
      `| lazy load | 1 load, ${load[0]?.loadMs ?? -1} ms |`,
      "| conformance | pass (`runRerankerConformance`: permutation, deterministic, empty→empty) |",
      '| ordering | `src#0001` ranked first for "capital of France" (exact answer beat the distractor) |',
      `| top-${TOP_K} latency | median ${median(timings)} ms over ${LATENCY_RUNS} runs (min ${Math.min(...timings)}, max ${Math.max(...timings)}); one warm-up run excluded |`,
      `| recall corpus | ${recall.corpusQueries} queries / ${recall.corpusChunks} chunks (one answer + three mention-only chunks per topic), lexical \`prism-hash-embedder\` baseline, \`lexical: "off"\`, vector-only |`,
      `| recall@${recall.k} (pool = whole corpus, ${recall.corpusChunks} candidates) | ${recall.baseline.toFixed(3)} → ${recall.reranked.toFixed(3)} (vector order → \`${MODEL}\` ${DTYPE}/${DEVICE}) |`,
      `| candidate-pool bound | ${recall.poolDepths.map((depth, index) => `recall@${depth} at a ${depth}-candidate pool = ${(recall.poolRecall[index] ?? 0).toFixed(3)}`).join("; ")} — reranking cannot recover an answer the pool never returned |`,
      `| recall misses | baseline: ${recall.missesBaseline.join(", ") || "none"} | after rerank: ${recall.missesReranked.join(", ") || "none"} |`,
      `| weight cache layout | one host cache dir with a \`${MODEL}\` subdirectory (the documented convention; the same dir is reusable by local embedders) |`,
      "| offline replay | pass (`allowRemoteModels: false` shared the cache: zero network after load) |",
      "| secrets / paths | none: no credentials, no document text, no absolute host path |",
      "",
      "Latency and recall are evidence, not gates: hardware, dtype, and the embedder move them, so the leg",
      "records them and the strict live run proves the seam. Both measured legs score the whole corpus, so",
      "the recall delta is ordering only; the pool-bound row is why `queryCandidates` matters more than the",
      "reranker when recall is short. Model weights come from the documented model id into the",
      "host cache dir; nothing is declared in any manifest (`@huggingface/transformers` stays a host",
      "seam) and the run requires no credentials.",
      "",
    ].join("\n");

    assert.ok(
      !/(?:sk-|sk-ant-|xai-)[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|secret|token)\s*=/i.test(report),
      "report must not contain secret-shaped strings",
    );
    assert.ok(!report.includes(CACHE_DIR), "report must not contain an absolute host path");
    mkdirSync(dirname(fileURLToPath(EVIDENCE)), { recursive: true });
    writeFileSync(EVIDENCE, report);
    assert.ok(existsSync(fileURLToPath(EVIDENCE)), "evidence row must be written");
  });
});
