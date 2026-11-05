/**
 * Plan 208 Task 3: the ontology arm in the campaign machinery. Everything runs on the mock provider: no network, no
 * paid call. The arm installs `memory-wiki` next to the fabric, settles its background passes within a bound, writes
 * the private claim bundles the Task 2 audit reads, and accounts the curator's calls as their own usage role.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryConfigs, resolvedMemoryConfigs } from "./ablations.mjs";
import { assertOntologyManifestPin, ONTOLOGY_PREFIX_PROBE, ontologyManifestBlockers, ontologyManifestPins } from "./audit/readiness.mjs";
import { buildOntologyManifest, ontologyJobArgs, ontologyTwin } from "./campaign.mjs";
import { ONTOLOGY_SETTLE_MS, seriesPartition, summarizeOntology } from "./ontology-arm.mjs";
import { flattenClaims, loadClaimBundles } from "./ontology-audit.mjs";
import { summarize } from "./report.mjs";
import { threeTierCriteriaHash } from "./robustness.mjs";
import { parseArgs, protocolFingerprint, runBench } from "./run.mjs";
import { ONTOLOGY_CACHE_KEY, roleUsage, usageRole } from "./usage.mjs";

const ARM = "conversational+O";

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "prism-ontology-arm-"));
  return {
    root,
    claims: join(root, "ontology-claims"),
    options: (extra = {}) => ({
      offline: true,
      config: "fabric-x",
      maxQuestions: 4,
      answersDir: join(root, "answers"),
      judgeCacheDir: join(root, "judge"),
      ontologyClaimsDir: join(root, "ontology-claims"),
      ontologyArm: ARM,
      ...extra,
    }),
    done: () => rm(root, { recursive: true, force: true }),
  };
}

/** The deterministic part of a result row: counts and ids, never wall time. */
const stable = (row) => {
  const { ontologySettleMs: _ms, ...ontology } = row.ontology ?? {};
  return { id: row.id, correct: row.correct, recalledIds: row.recalledIds?.length, ontology };
};

test("ontology_arm_offline_campaign_completes_deterministically", async () => {
  const a = await scratch();
  const b = await scratch();
  try {
    // Both arms of the pair complete on the same fixture histories: the base arm, then its +O twin.
    const base = await runBench({ ...a.options(), ontology: undefined, ontologyArm: undefined });
    assert.equal(base.results.length, 4);
    assert.ok(base.results.every((row) => row.ontology === undefined));
    assert.equal(base.ontologySummary, undefined);
    assert.equal(base.roleUsage?.["product-ontology"], undefined);

    const first = await runBench({ ...a.options(), ontology: true });
    const second = await runBench({ ...b.options(), ontology: true });
    for (const report of [first, second]) {
      assert.equal(report.results.length, 4);
      assert.ok(report.results.every((row) => row.outcome === "scored"));
      assert.equal(report.threeTierCriteriaHash, threeTierCriteriaHash());
      assert.deepEqual(report.ontology, { arm: ARM, settleMs: ONTOLOGY_SETTLE_MS });
    }
    assert.deepEqual(first.results.map(stable), second.results.map(stable));
    // The concept pass ran on the product path: concepts exist, with cited claims and bound notes.
    const summary = first.ontologySummary;
    assert.equal(summary.histories, 4);
    assert.ok(summary.concepts >= 4 && summary.claims >= 4, "each history built a concept with a claim");
    assert.ok(summary.boundNoteShare > 0 && summary.boundNoteShare <= 1);
    assert.equal(summary.curator.calls, summary.modelCalls);
    assert.equal(summary.settle.timeouts, 0);
    assert.deepEqual(summary.deviations, []);
    // The same answers, apart from the ontology: the +O arm adds a tier, not a different harness.
    assert.deepEqual(
      first.results.map((row) => row.id),
      base.results.map((row) => row.id),
    );
  } finally {
    await a.done();
    await b.done();
  }
});

test("an_ontology_arm_builds_each_history_once_and_restores_it_for_later_questions", async () => {
  const a = await scratch();
  const b = await scratch();
  const cache = join(a.root, "ontology-stores");
  try {
    // The four fixture questions share one history: the first builds it, the other three restore it.
    const built = await runBench({ ...a.options(), ontology: true, ontologyStoreCache: cache });
    assert.ok(built.results.every((row) => row.outcome === "scored"));
    const [first, ...later] = built.results;
    assert.equal(first.ontology.ontologyReused, undefined);
    assert.ok(first.ontology.curator.calls > 0, "the first question on a history pays the build");
    assert.ok(later.length > 0 && later.every((row) => row.ontology.ontologyReused === true && row.ontology.curator.calls === 0));
    assert.equal((await readdir(cache)).filter((name) => !name.includes(".")).length, 1, "one store per history");
    // A later question on the same history (here: the same questions in a fresh answer cache) restores the memory.
    const restored = await runBench({ ...b.options(), ontology: true, ontologyStoreCache: cache });
    assert.ok(restored.results.every((row) => row.outcome === "scored" && row.ontology.ontologyReused === true && row.ingest.ontologyReused === true));
    assert.ok(restored.results.every((row) => row.ontology.curator.calls === 0), "no curator call on a restored history");
    const memory = (row) => ({ id: row.id, correct: row.correct, concepts: row.ontology.concepts, claims: row.ontology.claims, passes: row.ontology.passes });
    assert.deepEqual(restored.results.map(memory), built.results.map(memory));
  } finally {
    await a.done();
    await b.done();
  }
});

test("curator_usage_reported_under_product_ontology_role", () => {
  assert.equal(ONTOLOGY_CACHE_KEY, "prism-wiki-consolidate");
  const row = (role, cacheKey, inputTokens, extra = {}) => ({
    role,
    cacheKey,
    inputTokens,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    rate: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
    ...extra,
  });
  const rows = [
    row("product", undefined, 100),
    row("product", "prism-fabric-extract", 200),
    row("product", ONTOLOGY_CACHE_KEY, 300),
    row("product", `${ONTOLOGY_CACHE_KEY}:project`, 50),
    row("evaluation", ONTOLOGY_CACHE_KEY, 7),
  ];
  assert.deepEqual(rows.map(usageRole), ["product", "product-extract", "product-ontology", "product-ontology", "evaluation"]);
  const usage = roleUsage(rows);
  assert.equal(usage["product-ontology"].exchanges, 2);
  assert.equal(usage["product-ontology"].inputTokens, 350);
  assert.equal(usage["product-ontology"].outputTokens, 20);
  assert.equal(usage.product.exchanges, 1, "the answer role excludes the curator");
  assert.equal(usage.evaluation.exchanges, 1, "a judge that shares the cache key is still evaluation");
  // An arm with no curator call keeps its old shape.
  assert.equal(roleUsage(rows.slice(0, 2))["product-ontology"], undefined);
  assert.equal(roleUsage(rows.slice(0, 2), usage)["product-ontology"].exchanges, 2, "a resumed arm keeps the prior role");
  // The report shows it next to `product` and `product-extract`.
  const report = summarize({
    results: [],
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    roleUsage: usage,
    rate: null,
    config: "fabric-x",
    judge: "mock/judge",
  });
  assert.equal(report.cost.productOntology.exchanges, 2);
  assert.equal(report.cost.productExtract.exchanges, 1);
  assert.ok(report.cost.product);
});

test("settle_timeout_is_recorded_deviation", async () => {
  const dir = await scratch();
  try {
    // Every mock call takes 300 ms, so the first concept pass cannot finish within the 40 ms bound and is aborted.
    const report = await runBench({ ...dir.options({ maxQuestions: 1 }), ontology: true, ontologySettleMs: 40, mockLatencyMs: 300 });
    assert.equal(report.results.length, 1);
    const row = report.results[0];
    assert.equal(row.ontology.ontologySettleTimeout, true);
    assert.ok(row.ontology.ontologyAborted >= 1);
    assert.deepEqual(report.ontologySummary.deviations, [{ id: row.id, kind: "settle-timeout" }]);
    assert.equal(report.ontologySummary.settle.timeouts, 1);
    assert.deepEqual(report.ontology, { arm: ARM, settleMs: 40 });
    // The wait is its own phase: never inside ingestion or the answer latency.
    assert.equal(typeof row.phaseTiming.ontologySettle, "number");
    assert.equal(report.timing.phases.ontologySettle.n, 1);
    assert.equal(report.ontologySummary.settle.excludedFromAnswerLatency, true);
    // The pre-registered bound is settable only through an owner-gated job field (plan 208 gate amendment 12, Beam Free);
    // the flag is a number, and it still needs --ontology (checked below).
    assert.equal(parseArgs(["--ontology", "--ontology-settle-ms", "600000"]).ontologySettleMs, 600000);
    assert.throws(() => parseArgs(["--ontology-settle-ms", "0"]), /positive integers/);
    await assert.rejects(runBench({ offline: true, config: "fabric-x", ontologySettleMs: 40 }), /needs --ontology/);
  } finally {
    await dir.done();
  }
});

test("readiness_refuses_ontology_manifest_without_criteria_or_prefix_record", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-ontology-pin-"));
  try {
    for (const dir of ["packages/memory/fabric/src", "packages/memory/wiki/src", "docs/_evidence/memory-bench/207"])
      await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, "packages/memory/fabric/src/index.ts"), "export const fabric = 1;\n");
    await writeFile(join(root, "packages/memory/wiki/src/index.ts"), "export const wiki = 1;\n");
    const probeFor = async (extra = {}) => {
      const { sourceFingerprint, PREFIX_PRODUCT_PATHS } = await import("./acceptance.mjs");
      return {
        schema: "memory-prefix-probe-v1",
        networkCalls: 0,
        productHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS, root),
        assumptions: { extractor: { systemIdentical: true, toolsIdentical: true } },
        sha256: "probe-sha",
        ...extra,
      };
    };
    const writeProbe = async (probe) => writeFile(join(root, ONTOLOGY_PREFIX_PROBE), JSON.stringify(probe));
    await writeProbe(await probeFor());
    const pins = await ontologyManifestPins({ root });
    assert.equal(pins.threeTierCriteriaHash, threeTierCriteriaHash());
    assert.equal(pins.ontologyPrefixProbe.sha256, "probe-sha");

    // A manifest that pins everything passes.
    assert.equal(await assertOntologyManifestPin(pins, { root }), pins);
    // Task 1's criteria hash is required, and drift is refused.
    const { threeTierCriteriaHash: _hash, ...withoutCriteria } = pins;
    await assert.rejects(assertOntologyManifestPin(withoutCriteria, { root }), /three-tier-criteria-missing/);
    await assert.rejects(
      assertOntologyManifestPin({ ...pins, threeTierCriteriaHash: "0".repeat(64) }, { root }),
      /three-tier-criteria-drift/,
    );
    // Plan 207's prefix-probe record is required: absent, invalid, or taken on another fabric.
    await assert.rejects(assertOntologyManifestPin({ ...pins, ontologyPrefixProbe: null }, { root }), /ontology-manifest-probe-unpinned/);
    await writeProbe(await probeFor({ networkCalls: 1 }));
    await assert.rejects(assertOntologyManifestPin(pins, { root }), /ontology-prefix-probe-invalid/);
    await writeProbe(await probeFor({ assumptions: { extractor: { systemIdentical: true, toolsIdentical: false } } }));
    await assert.rejects(assertOntologyManifestPin(pins, { root }), /ontology-prefix-probe-invalid/);
    await rm(join(root, ONTOLOGY_PREFIX_PROBE));
    await assert.rejects(assertOntologyManifestPin(pins, { root }), /ontology-prefix-probe-missing/);
    await writeProbe(await probeFor({ productHash: "f".repeat(64) }));
    await assert.rejects(assertOntologyManifestPin(pins, { root }), /ontology-prefix-probe-product-changed/);
    // A product edit after the manifest was written makes the manifest stale.
    await writeProbe(await probeFor());
    await writeFile(join(root, "packages/memory/wiki/src/index.ts"), "export const wiki = 2;\n");
    await assert.rejects(assertOntologyManifestPin(pins, { root }), /ontology-manifest-product-unpinned/);
    // The verdict is pure, so each blocker has a name.
    assert.deepEqual(ontologyManifestBlockers({ manifest: {}, probe: undefined, fabricHash: "a", productHash: "b" }), [
      "ontology-prefix-probe-missing",
      "ontology-manifest-product-unpinned",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ontology_arm_writes_claim_bundles_the_audit_can_read", async () => {
  const dir = await scratch();
  try {
    const report = await runBench({ ...dir.options(), ontology: true });
    const bundles = await loadClaimBundles(join(dir.claims, ARM));
    // One private bundle per history, named for the arm.
    assert.equal(bundles.length, report.results.length);
    assert.deepEqual(bundles.map((bundle) => bundle.history).sort(), report.results.map((row) => row.id).sort());
    for (const bundle of bundles) {
      assert.equal(bundle.kind, "ontology-claims-v1");
      assert.equal(bundle.arm, ARM);
      assert.equal(bundle.model, "mock/synthetic");
      assert.equal(bundle.questions.length, 1);
      assert.equal(typeof bundle.questions[0].correct, "boolean", "scored answers mark the bundle");
    }
    // The Task 2 audit accepts them: every cited note resolves to text in the bundle.
    const { claims, human, uncited } = flattenClaims(bundles);
    assert.ok(claims.length >= bundles.length);
    assert.equal(human + uncited, 0);
    for (const claim of claims) assert.ok(claim.notes.every((note) => typeof note === "string" && note.length > 0));
    // Bundles hold text and live in the private directory; the report rows hold none of it.
    const text = JSON.stringify(report);
    for (const claim of claims) assert.equal(text.includes(claim.text), false, "claim text stays out of the report");
    for (const bundle of bundles) for (const note of Object.values(bundle.notes)) assert.equal(text.includes(note), false);
    assert.deepEqual((await readdir(dir.claims)).sort(), [ARM]);
  } finally {
    await dir.done();
  }
});

test("ontology_flags_reach_the_job_command_and_refuse_snapshots", () => {
  const job = { id: "j", family: "f", suite: "locomo", config: "fabric-x" };
  assert.deepEqual(ontologyJobArgs(job), []);
  const twin = ontologyTwin({ ...job, writeSide: "producer", reuse: { from: "x" } }, { arm: ARM });
  assert.equal(twin.id, "j+O");
  assert.equal(twin.writeSide, undefined);
  assert.equal(twin.reuse, undefined);
  assert.notEqual(twin.answersDir, undefined, "the pair never shares answer checkpoints");
  const args = ontologyJobArgs(twin);
  assert.deepEqual(args.slice(0, 3), ["--ontology", "--ontology-arm", ARM]);
  assert.equal(args[3], "--ontology-claims-dir");
  const options = parseArgs(args);
  assert.equal(options.ontology, true);
  assert.equal(options.ontologyArm, ARM);
  assert.throws(() => ontologyJobArgs({ ...twin, writeSide: "producer" }), /no write-side snapshot/);
  assert.throws(() => ontologyJobArgs({ ...twin, ontologyArm: undefined }), /names its arm/);
  assert.throws(() => parseArgs(["--ontology", "--seed-snapshot"]), /unknown flag or missing value/);
});

test("ontology_needs_a_product_ingestion_fabric_arm_and_changes_no_other_arm", async () => {
  // Only an ontology arm gains a `wiki` config; every other arm's resolved config and fingerprint are unchanged.
  const plain = memoryConfigs({ config: "fabric-x" });
  assert.equal("wiki" in plain, false);
  assert.equal("wiki" in resolvedMemoryConfigs(plain), false);
  const ontology = memoryConfigs({ config: "fabric-x", ontology: true });
  assert.deepEqual(ontology.wiki, { consolidate: {} });
  assert.deepEqual(resolvedMemoryConfigs(ontology).wiki, { consolidate: {} });
  assert.deepEqual(memoryConfigs({ config: "fabric-x", ontology: true, offline: true }).wiki, { consolidate: { minNotes: 2 } });
  assert.throws(() => memoryConfigs({ config: "om", ontology: true }), /needs a fabric arm/);
  // Trigger policies are ablations of the ontology arm only (plan 208 Task 5 compares them).
  const policy = memoryConfigs({ config: "fabric-x", ontology: true, ablate: ['wiki.consolidate.triggers=["co-read","repair"]'] });
  assert.deepEqual(policy.wiki.consolidate.triggers, ["co-read", "repair"]);
  assert.throws(
    () => memoryConfigs({ config: "fabric-x", ablate: ['wiki.consolidate.triggers=["repair"]'] }),
    /does not belong to selected arm/,
  );
  const fingerprint = (extra) => protocolFingerprint({ suite: "s", config: "fabric-x", provider: "p", model: "m", ...extra });
  assert.notEqual(fingerprint({}), fingerprint({ ontology: { arm: ARM, settleMs: 1 } }));
  await assert.rejects(runBench({ offline: true, config: "fabric", ontology: true }), /product-ingestion fabric arm/);
  await assert.rejects(runBench({ offline: true, config: "fabric-x", ontology: true, seedSnapshot: "x" }), /no write-side snapshot/);
});

test("ontology_manifest_pins_criteria_and_requires_an_ontology_job", async () => {
  const twin = ontologyTwin({ id: "j", family: "f", suite: "locomo", config: "fabric-x" }, { arm: ARM });
  const manifest = await buildOntologyManifest({ jobs: [twin], plan: 208 });
  assert.equal(manifest.kind, "208-ontology-manifest");
  assert.equal(manifest.threeTierCriteriaHash, threeTierCriteriaHash());
  assert.equal(manifest.jobs.length, 1);
  await assert.rejects(
    buildOntologyManifest({ jobs: [{ id: "j", family: "f", suite: "locomo", config: "fabric-x" }] }),
    /at least one ontology job/,
  );
});

test("summarize_ontology_reports_counts_without_text", () => {
  const row = (ability, extra) => ({
    id: `q-${ability}`,
    ability,
    ontology: {
      concepts: 2,
      claims: 6,
      boundNoteShare: 0.5,
      passes: 1,
      modelCalls: 2,
      repairs: 1,
      rejected: { trust: 0, secret: 0, invalid: 1 },
      itemsLeftDue: 0,
      curator: { calls: 2, inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 },
      ontologySettleMs: 40,
      ontologySettleTimeout: false,
      conceptStage: "concept",
      ...extra,
    },
  });
  const summary = summarizeOntology([
    row("multi-session", {}),
    row("temporal", { conceptStage: "note", ontologySettleMs: 90, ontologySettleTimeout: true }),
  ]);
  assert.equal(summary.claimsPerConcept, 3);
  assert.equal(summary.repairs, 2);
  assert.equal(summary.rejected.invalid, 2);
  assert.deepEqual(summary.conceptStages.all, { concept: 1, note: 1, none: 0 });
  assert.deepEqual(summary.conceptStages.byAbility["multi-session"], { concept: 1, note: 0, none: 0 });
  assert.equal(summary.settle.maxMs, 90);
  assert.equal(summary.settle.timeouts, 1);
  assert.deepEqual(summary.deviations, [{ id: "q-temporal", kind: "settle-timeout" }]);
  assert.equal(summarizeOntology([{ id: "x", ability: "a" }]), undefined);
});

test("series_mode_warms_each_cluster_with_unscored_questions_and_drops_short_clusters", async () => {
  const rows = [
    ...["a1", "a2", "a3", "a4"].map((id) => ({ id, cluster: "a", question: `q ${id}`, date: "2026-01-01" })),
    ...["b1", "b2"].map((id) => ({ id, cluster: "b", question: `q ${id}`, date: "2026-01-02" })),
  ];
  const { scored, dropped, warmupIds } = seriesPartition(rows, 2);
  assert.deepEqual(
    scored.map((row) => row.id),
    ["a3", "a4"],
  );
  assert.deepEqual(warmupIds, ["a1", "a2"]);
  assert.deepEqual(dropped, [{ cluster: "b", questions: 2 }]);
  assert.deepEqual(
    scored[0].warmup.map((row) => row.id),
    ["a1", "a2"],
  );
  // Identical for any policy: the split depends on the question list alone.
  assert.deepEqual(seriesPartition(rows, 2).warmupIds, warmupIds);
  assert.throws(() => seriesPartition(rows, 0), /positive integer/);
  await assert.rejects(runBench({ offline: true, config: "fabric-x", warmup: 2 }), /needs --ontology/);
  const args = ontologyJobArgs({ id: "j", ontology: true, ontologyArm: ARM, warmup: 2 });
  assert.deepEqual(args.slice(-2), ["--warmup", "2"]);
  assert.equal(parseArgs(args).warmup, 2);
});

test("series_mode_offline_run_scores_only_later_questions_and_reports_warmup", async () => {
  const dir = await scratch();
  try {
    const fixture = JSON.parse(await Bun.file(new URL("./fixtures/synthetic.json", import.meta.url)).text());
    // One conversation, so its questions form one cluster: the first is a warm-up, the rest are scored.
    const questions = fixture.questions.slice(0, 3).map((question) => ({ ...question, cluster: "one-history" }));
    const report = await runBench({ ...dir.options({ maxQuestions: undefined }), ontology: true, warmup: 1, questions });
    assert.equal(report.series.warmup, 1);
    assert.equal(report.ontology.warmup, 1);
    assert.equal(report.series.warmupQuestions, 1);
    assert.equal(report.series.scoredQuestions, 2);
    assert.equal(report.results.length, 2);
    assert.ok(!report.results.some((row) => row.id === questions[0].id), "the warm-up question is never scored");
    for (const row of report.results) {
      assert.equal(row.ontology.ontologyWarmupAsked, 1);
      assert.equal(row.ontology.ontologyWarmupFailed, 0);
      assert.ok(Number.isFinite(row.phaseTiming.ontologyWarmup));
    }
    assert.ok(report.timing.phases.ontologyWarmup, "the warm-up is its own phase, apart from answer latency");
  } finally {
    await dir.done();
  }
});
