import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deterministicFailure, freeRouteInterruption, freeRouteRetryCause, stalledJob } from "./campaign.mjs";
import {
  assertC1Gate,
  assertC1Jobs,
  assertF4BuildAllowed,
  buildC1Manifest,
  buildC1Report,
  buildTask5Rows,
  C1_F4_ORIGINAL_BARS,
  C1_RETIRED_ABLATIONS,
  C1_ROBUSTNESS_ARMS,
  c1BudgetDecision,
  c1BudgetGate,
  c1Deferred,
  c1FeatureEvidence,
  c1Jobs,
  c1PairEffect,
  c1Scheduled,
  dryRunC1Manifest,
  f4Disposition,
  f4LegRow,
  orientEffect,
  pairOnIdenticalItems,
  parseC1Waves,
  scorePrediction,
} from "./cleanup-campaign.mjs";
import { CLEANUP_CRITERIA, cleanupVerdict } from "./robustness.mjs";
import { questionFailureDisposition } from "./run.mjs";
import { transformVariantSource, VARIANT_PATHS } from "./variants.mjs";

const hashes = { productHash: "p".repeat(64), ingestHash: "i".repeat(64) };
const row = (id, correct, extra = {}) => ({ id, cluster: `c${id.slice(-1)}`, ability: "a", outcome: "scored", correct, ...extra });
const report = (rows, extra = {}) => ({ status: "completed", results: rows, inputTokens: 1000 * rows.length, ...extra });

describe("plan 210 Task 5 (gate C-1)", () => {
  test("plan_210_arms_paired_on_identical_items", () => {
    const jobs = c1Jobs(hashes);
    // Every non-reference arm has a base job on the same model, suite, partition and route.
    expect(() => assertC1Jobs(jobs)).not.toThrow();
    const moved = jobs.map((job) => (job.id === "210-c1.large.P.locomo" ? { ...job, model: "gpt-oss:20b" } : job));
    expect(() => assertC1Jobs(moved)).toThrow(/C1Pairing/);
    const orphan = jobs.filter((job) => job.id !== "210-c1.small.supersession-keyed-only.beam-100k");
    expect(() => assertC1Jobs(orphan)).toThrow(/no base/);
    // Pairing is on the intersection of scored ids; an id scored in one arm only is unpaired, never imputed.
    const base = report([row("q1", true), row("q2", false), row("q3", true)]);
    const arm = report([row("q3", false), row("q1", true), { ...row("q2", false), outcome: "error" }]);
    const pair = pairOnIdenticalItems(base, arm, "locomo");
    expect(pair.ids).toEqual(["q1", "q3"]);
    expect(pair.base.map((item) => item.id)).toEqual(pair.arm.map((item) => item.id));
    expect(pair.unpaired).toEqual({ base: 1, arm: 0 });
    // A shared write side snapshots in its readers' question order (a capped smoke would otherwise miss snapshots).
    for (const job of jobs.filter((item) => item.writeSide)) {
      const producer = jobs.find((item) => item.id === job.writeSide);
      expect(producer.interleaveAbilities).toBe(job.interleaveAbilities);
      expect(producer.suite).toBe(job.suite);
    }
    const effect = c1PairEffect(base, arm, "locomo", { iterations: 200 });
    expect(effect.n).toBe(2);
    expect(effect.diffPoints).toBe(-50);
  });

  test("c1_jobs_are_development_only_and_on_gate_routes", () => {
    const jobs = c1Jobs(hashes);
    expect(jobs.every((job) => job.subset === "dev" && job.provider === "ollama-cloud")).toBe(true);
    // OM jobs run last, after every other arm (the allowance reaches the cheap arms first).
    const firstOm = jobs.findIndex((job) => job.config === "om");
    expect(jobs.slice(firstOm).every((job) => job.config === "om")).toBe(true);
    expect(() => assertC1Jobs(jobs.map((job, i) => (i === 7 ? { ...job, subset: "heldout-a" } : job)))).toThrow(/C1Partition/);
    expect(() =>
      assertC1Jobs(jobs.map((job, i) => (i === 7 ? { ...job, model: "Qwen/Qwen3.7-Flash", provider: "commandcode" } : job))),
    ).toThrow(/C1Billing/);
    // Judges never answer: a job judged by its own answer model is refused.
    const self = jobs.map((job) =>
      job.id === "210-c1.large.P.locomo" ? { ...job, judges: "ollama-cloud/beam,ollama-cloud/gemma4:31b" } : job,
    );
    expect(() => assertC1Jobs(self)).toThrow(/C1Judges/);
    // P3-P5 (amendment 5): clef:27b decides, never the answer model; each decision arm pairs with its base.
    const deciders = jobs.filter((job) => /decisions-p[345]/.test(job.id));
    expect(deciders.length).toBe(10);
    expect(deciders.every((job) => job.decider === "ollama-cloud/clef:27b")).toBe(true);
    for (const job of deciders.filter((item) => item.kind === "robustness"))
      expect(job.ablate.some((spec) => spec.startsWith("fabric.decisions=") && spec.includes("clef:27b"))).toBe(true);
    expect(
      deciders.filter((job) => job.kind === "work-outcome").every((job) => job.fabricOverlay.decisions.model === "ollama-cloud/clef:27b"),
    ).toBe(true);
    // Robustness and ontology jobs never score an errored question.
    expect(jobs.filter((job) => job.kind === "robustness" || job.kind === "ontology").every((job) => job.strictQuestions)).toBe(true);
  });

  test("verdicts_computed_from_cleanup_criteria_only", () => {
    const arm = C1_ROBUSTNESS_ARMS.find((item) => item.id === "directory-loo");
    const effect = (low, high, suite) => ({ suite, n: 60, pointsWithFeature: (low + high) / 2, ci95Points: [low, high], abilities: {} });
    // Removal non-inferior on every suite and model, but the member has no work leg: not shown non-inferior.
    const robustness = {
      large: { "directory-loo": { locomo: effect(-1, 1, "locomo"), "longmemeval-m": effect(-1.5, 1, "longmemeval-m") } },
      small: { "directory-loo": { locomo: effect(-1, 1.5, "locomo"), "longmemeval-m": effect(-1, 1, "longmemeval-m") } },
    };
    const out = c1FeatureEvidence("delivery.directory", { arms: [arm], ledgerRow: { status: "unmeasured" }, robustness, work: {} });
    expect(out.verdict).toEqual(cleanupVerdict(out.evidence));
    expect(out.verdict.verdict).toBe("inconclusive");
    // A negative ability is removed whatever else.
    robustness.large["directory-loo"].locomo = effect(-9, -1, "locomo");
    const negative = c1FeatureEvidence("delivery.directory", { arms: [arm], ledgerRow: { status: "unmeasured" }, robustness, work: {} });
    expect(negative.verdict.verdict).toBe("remove");
    expect(negative.verdict.reason).toBe("negative");
    // The report has no other route to a verdict: every measured row equals cleanupVerdict(evidence).
    const built = buildC1Report({
      reports: new Map(),
      manifest: null,
      ledger: { features: [{ id: "delivery.directory", candidate: true }] },
      predictions: [],
    });
    for (const verdict of built.verdicts.filter((item) => item.measured))
      expect(verdict.verdict).toBe(cleanupVerdict(verdict.evidence).verdict);
  });

  test("prediction_scoring_marks_hit_or_miss", () => {
    const rows = (points, suite = "locomo") => [{ suite, pointsWithFeature: points, ci95Points: [points - 3, points + 3] }];
    expect(scorePrediction({ kind: "gain", points: 1.7, suites: ["locomo"] }, { large: rows(3.3), small: rows(1.7) }).outcome).toBe("hit");
    expect(scorePrediction({ kind: "gain", points: 1.7, suites: ["locomo"] }, { large: rows(3.3), small: rows(0) }).outcome).toBe("miss");
    expect(scorePrediction({ kind: "null", points: 1.7, suites: ["locomo"] }, { large: rows(1.6), small: rows(-1.6) }).outcome).toBe("hit");
    expect(scorePrediction({ kind: "null", points: 1.7, suites: ["locomo"] }, { large: rows(5) }).outcome).toBe("miss");
    expect(scorePrediction({ kind: "gain", points: 1, suites: ["locomo", "beam-100k"] }, { large: rows(2) }).outcome).toBe("incomplete");
    expect(scorePrediction({ notScored: "W1" }, {}).outcome).toBe("not-scored");
    // Orientation: a leave-one-out arm that loses 5 points means the feature is worth +5.
    const looEffect = { suite: "locomo", n: 60, diffPoints: -5, ci95Points: [-9, -1], abilities: {} };
    expect(orientEffect(looEffect, "loo").pointsWithFeature).toBe(5);
    expect(orientEffect(looEffect, "loo").ci95Points).toEqual([1, 9]);
  });

  test("facts_arm_requires_measured_residual_threshold_and_original_bars", () => {
    const counts = { selectedGold: 1, candidateGold: 1 };
    const oracle = report(Array.from({ length: 20 }, (_, i) => ({ ...row(`q${i}`, true), ability: "knowledge-update" })));
    const readTime = report(
      Array.from({ length: 20 }, (_, i) => ({ ...row(`q${i}`, i > 1), ability: "knowledge-update", evidenceCounts: counts })),
    );
    const hit = f4LegRow({ suite: "locomo", model: "large", partition: "dev", readTime, oracle });
    expect(hit.irrecoverable).toBe(2);
    expect(hit.disposition).toBe("fix-and-measure");
    // Missing attribution never opens extraction.
    const noCounts = report(readTime.results.map(({ evidenceCounts: _e, ...rest }) => rest));
    expect(f4LegRow({ suite: "locomo", model: "large", partition: "dev", readTime: noCounts, oracle }).disposition).toBe("unmeasured");
    expect(f4Disposition([hit, { disposition: "unmeasured" }])).toBe("unmeasured");
    // A diagnosis below 5% closes the remedy; one above opens it only with the original bars.
    const below = f4LegRow({ suite: "locomo", model: "large", partition: "dev", readTime: report(oracle.results), oracle });
    expect(below.disposition).toBe("not-needed");
    expect(() => assertF4BuildAllowed({ disposition: "not-needed", partition: "dev", bars: C1_F4_ORIGINAL_BARS })).toThrow(/>= 5%/);
    expect(() => assertF4BuildAllowed({ disposition: "fix-and-measure", partition: "dev", bars: C1_F4_ORIGINAL_BARS.slice(1) })).toThrow(
      /bars/,
    );
    expect(assertF4BuildAllowed({ disposition: "fix-and-measure", partition: "dev", bars: C1_F4_ORIGINAL_BARS })).toBe(true);
    // Held-out evidence can never trigger the build.
    expect(() => f4LegRow({ suite: "locomo", model: "large", partition: "heldout-a", readTime, oracle })).toThrow(/held-out/);
    expect(() => assertF4BuildAllowed({ disposition: "fix-and-measure", partition: "heldout-b", bars: C1_F4_ORIGINAL_BARS })).toThrow(
      /held-out/,
    );
  });

  test("plan_210_gate_c1_carries_202_task5_deferred_arms", async () => {
    const manifest = await buildC1Manifest();
    const ids = new Set(manifest.jobs.map((job) => job.id));
    for (const model of ["large", "small"])
      for (const suite of ["beam-100k", "locomo", "memoryagentbench-cr", "longmemeval-m", "beam-1m"])
        for (const arm of ["enrichment-loo", "navigation-loo", "P"]) expect(ids.has(`210-c1.${model}.${arm}.${suite}`)).toBe(true);
    const frozen = JSON.parse(await readFile("docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json", "utf8"));
    expect(manifest.plan202Task5.criteriaHash).toBe(frozen.criteriaHash);
    expect(manifest.plan202Task5.criteriaVersion).toBe("202-task5-candidate-gap-v2");
    expect(manifest.plan202Task5.fullCohorts["longmemeval-m"].questions).toBe(50);
    expect(manifest.plan202Task5.fullCohorts["beam-1m"].questions).toBe(40);
    // The deferred jobs read the full development partition (no question cap).
    expect(
      manifest.jobs.filter((job) => /(enrichment|navigation)-loo\.(longmemeval-m|beam-1m)$/.test(job.id)).every((job) => !job.maxQuestions),
    ).toBe(true);
    // The gate binds the manifest: any other hash, or a paid route, is refused.
    const gate = {
      plan: 210,
      gate: "C-1",
      approved: true,
      approvedBy: "owner",
      text: "paid ollama cloud",
      manifestHash: manifest.manifestHash,
      cleanupCriteriaHash: manifest.cleanupCriteriaHash,
      billing: { mode: "paid-allowance", provider: "ollama-cloud", paidFallbacks: [] },
    };
    expect(assertC1Gate(gate, manifest)).toBe(gate);
    expect(() => assertC1Gate({ ...gate, manifestHash: "x" }, manifest)).toThrow(/differs/);
    expect(() => assertC1Gate({ ...gate, billing: { mode: "free-only" } }, manifest)).toThrow(/Ollama Cloud routes/);
    expect(() => assertC1Gate({ ...gate, billing: { ...gate.billing, paidFallbacks: ["x/y"] } }, manifest)).toThrow(/no fallbacks/);
    // The frozen rules: the ability guard is a veto, so an unverified stratum blocks a pass.
    const pass = buildTask5Rows(new Map(), {
      task5CandidateGap: () => ({ verdict: "pass" }),
      task5AbilityGuard: () => ({ passed: false, unverifiedStrata: ["x"] }),
    });
    expect(pass.pass["write.keyword-enrichment"]).toBe(false);
  });

  test("free_route_interruptions_are_retried_and_never_scored", () => {
    // A question error fails the job in strict mode instead of becoming a wrong answer.
    expect(questionFailureDisposition({ error: new Error("MemoryBenchReplayError"), strict: true })).toBe("failed");
    expect(questionFailureDisposition({ error: new Error("MemoryBenchReplayError"), strict: false })).toBe("scored");
    // Any non-permanent failed report is an interruption; a classified permanent refusal is not.
    expect(freeRouteInterruption({ status: "failed", failure: { message: "empty completion" } })).toBe(true);
    expect(freeRouteInterruption({ status: "running" })).toBe(true);
    expect(freeRouteInterruption({ status: "failed", failure: { message: "maximum context length exceeded" } })).toBe(false);
    expect(freeRouteInterruption({ status: "completed" })).toBe(false);
    // Interrupted attempts never count against the job's attempt budget.
    for (const cause of ["transient", "quota-window", "quota-daily"]) expect(freeRouteRetryCause({ cause })).toBe(true);
    expect(freeRouteRetryCause({ cause: "unsupported-by-provider" })).toBe(false);
    // A harness or configuration fault is deterministic: it stops the job instead of looping (smoke, 2026-11-07).
    const setup = {
      status: "failed",
      failure: { message: "Package arnilo/prism-memory-fabric setup failed: Model x/y does not declare the decisions capability" },
    };
    expect(deterministicFailure(setup)).toBe("deterministic-harness-or-config");
    expect(freeRouteInterruption(setup)).toBe(false);
    expect(deterministicFailure({ status: "failed", failure: { message: "429 rate limit" } })).toBe(null);
    // The stall guard: six identical failures with no new scored question stop a job; progress resets it.
    const stuck = { status: "failed", failure: { message: "empty completion" }, results: [{ id: "q1" }] };
    expect(stalledJob(Array.from({ length: 6 }, () => stuck))).toBe(true);
    expect(stalledJob([...Array.from({ length: 5 }, () => stuck), { ...stuck, results: [{ id: "q1" }, { id: "q2" }] }])).toBe(false);
    expect(stalledJob(Array.from({ length: 5 }, () => stuck))).toBe(false);
  });

  test("leave_one_out_switches_apply_to_current_sources_and_change_them", async () => {
    const specs = [
      "fabric.unmatchedTerms=off",
      "fabric.navigation=off",
      "fabric.grouping=off",
      "fabric.aggregation=off",
      "ontology.pointer=off",
      "om.reflector=off",
      "lifecycle.exchangeExempt=on",
    ];
    for (const spec of specs)
      for (const path of VARIANT_PATHS[spec]) {
        const source = await readFile(path, "utf8");
        expect(transformVariantSource(path, source, [spec])).not.toBe(source);
      }
    // Unset, nothing changes.
    const tools = "packages/memory/system/src/ltm/tools.ts";
    const source = await readFile(tools, "utf8");
    expect(transformVariantSource(tools, source, [])).toBe(source);
  });

  test("per_scope_use_routing_cited_user_note_reaches_two_use_sessions", async () => {
    const { fabricAgent, scripted, TENANT } = await import("./mechanism-probes/harness.mjs");
    const root = await mkdtemp(join(tmpdir(), "c1-scope-routing-"));
    let id;
    const s = scripted();
    const h = await fabricAgent(root, {
      respond: s.respond,
      config: { scopes: { user: true } },
      seed: async ({ stores }) => {
        const fabric = await import("@arnilo/prism-memory-system");
        const userMemory = fabric.createMemory({ tenantId: TENANT, resourceId: "user", threadId: "default", ...stores });
        const writer = fabric.createLongTermMemory({ memory: userMemory, vectorStore: stores.vectorStore, consolidate: false });
        id = (
          await writer.remember({ kind: "preference", content: "prefers tabs over spaces in every repository" }, { status: "candidate" })
        ).id;
      },
    });
    try {
      for (const key of ["a", "b"]) {
        s.queue({ calls: [{ name: "memory.recall", args: { query: "tabs spaces repository" } }], cite: true });
        await h.run(key, "tabs or spaces?");
        await h.closeSession(key);
      }
      const rows = await h.stores.vectorStore.getByThread({ tenantId: TENANT, resourceId: "user", threadId: "default" });
      const fabric = await import("@arnilo/prism-memory-system");
      const note = fabric.parseMemoryNoteMetadata(rows.find((item) => item.id === id).metadata);
      expect(note.useSessions ?? 0).toBeGreaterThanOrEqual(2);
    } finally {
      await h.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("allowance_gate_waits_out_closed_windows_and_halts_on_a_spent_allowance", async () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const open = { included: { balance_usd: 40, allowance_usd: 60 }, purchased: { balance_usd: 0 } };
    expect(c1BudgetDecision(open, { now })).toEqual({ ok: true });
    const session = { ...open, included: { ...open.included, session: { remaining_percent: 0, resets_at: "2026-11-08T14:00:00Z" } } };
    const wait = c1BudgetDecision(session, { now });
    expect(wait.wait).toBe(true);
    expect(wait.waitMs).toBe(2 * 3_600_000 + 120_000);
    const spent = {
      included: { balance_usd: 0.4, allowance_usd: 60, period: { until: "2026-12-07T20:57:27Z" } },
      purchased: { balance_usd: 0.5 },
    };
    expect(c1BudgetDecision(spent, { now }).halt).toBe(true);
    // The gate sleeps through a closed window, re-reads, then lets the job start: wall time only.
    const replies = [session, open];
    const slept = [];
    const gate = await c1BudgetGate({ id: "j" }, { sleep: async (ms) => slept.push(ms), balance: async () => replies.shift() });
    expect(gate).toBeNull();
    expect(slept.length).toBe(1);
    expect((await c1BudgetGate({ id: "j" }, { sleep: async () => {}, balance: async () => spent })).status).toBe("budget-exhausted");
  });

  test("c1_waves_partition_every_job_and_never_run_an_arm_before_its_base", () => {
    const jobs = c1Jobs(hashes);
    expect(jobs.every((job) => [1, 2, 3].includes(job.wave))).toBe(true);
    // Write sides and the plan 202 Task 5 rows are wave 1.
    expect(jobs.filter((job) => job.kind === "write-side").every((job) => job.wave === 1)).toBe(true);
    for (const arm of ["P", "enrichment-loo", "navigation-loo"])
      expect(jobs.filter((job) => job.arm === arm && job.kind === "robustness").every((job) => job.wave === 1)).toBe(true);
    expect(jobs.filter((job) => job.kind === "ontology").every((job) => job.wave === 3)).toBe(true);
    // A job whose base is in a later wave is refused.
    const early = jobs.map((job) => (job.id === "210-c1.large.decisions-p3.locomo" ? { ...job, wave: 1 } : job));
    expect(() => assertC1Jobs(early)).toThrow(/C1Waves/);
    // Only the named waves start; the rest are deferred, and the env value is validated.
    expect(parseC1Waves(undefined)).toBeNull();
    expect(parseC1Waves("1")).toEqual([1]);
    expect(() => parseC1Waves("4")).toThrow(/C1Waves/);
    // Amendment 7: the campaign closed after wave 1, so waves 2 and 3 are refused, not just deferred.
    expect(() => parseC1Waves("2,1")).toThrow(/C1Closed/);
    const manifest = { activeWaves: [1] };
    expect(c1Deferred(manifest, { wave: 1 })).toBe(false);
    expect(c1Deferred(manifest, { wave: 2 })).toBe(true);
    expect(c1Deferred({}, { wave: 1 })).toBe(false);
    expect(c1Deferred({}, { wave: 3 })).toBe(true);
  });

  test("plan_210_c1_closed_after_wave_1_and_report_reads_wave_1_only", async () => {
    const jobs = c1Jobs(hashes);
    const manifest = { jobs, activeWaves: [1, 2, 3] };
    // No wave 2-3 job is scheduled, whatever the manifest's active waves say.
    const scheduled = c1Scheduled(manifest);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.every((job) => job.wave === 1)).toBe(true);
    expect(scheduled.length).toBeLessThan(jobs.length);
    expect(jobs.filter((job) => job.wave > 1).every((job) => c1Deferred(manifest, job))).toBe(true);

    // Every arm of a cancelled wave is listed with a disposition, and no wave-1 arm is.
    const cancelled = CLEANUP_CRITERIA.closure.cancelledArms;
    const armWave = new Map(jobs.filter((job) => job.kind !== "write-side").map((job) => [job.c1Arm ?? job.arm, job.wave]));
    for (const [arm, wave] of armWave) expect([arm, Boolean(cancelled[arm])]).toEqual([arm, wave > 1]);
    for (const arm of Object.keys(cancelled)) expect(armWave.has(arm)).toBe(true);

    // The report skips a wave 2-3 report that exists on disk, and calls every cancelled arm `cancelled`, never a miss.
    const ledger = JSON.parse(
      await readFile(new URL("../../docs/_evidence/memory-bench/210/feature-ledger.json", import.meta.url), "utf8"),
    );
    const predictions = JSON.parse(
      await readFile(new URL("../../docs/_evidence/memory-bench/210/gap-predictions.json", import.meta.url), "utf8"),
    );
    const strayId = "210-c1.large.gather.locomo";
    const stray = report([row("q1", true), row("q2", false)]);
    const built = buildC1Report({ reports: new Map([[strayId, stray]]), manifest: { jobs }, ledger, predictions: predictions.predictions });
    expect(built.jobs.read).toEqual([]);
    expect(built.closure.afterWave).toBe(1);
    const gather = built.predictions.find((item) => item.arm === "gather");
    expect(gather.outcome).toBe("cancelled");
    expect(gather.outcome).not.toBe("miss");
    expect(built.predictions.filter((item) => item.outcome === "miss")).toEqual([]);
    expect(built.cancelled.every((item) => item.outcome === "cancelled")).toBe(true);
    // Rows only waves 2-3 would have measured are unmeasured (not removed); transferred rows are not scored.
    const verdictOf = (id) => built.verdicts.find((item) => item.feature === id);
    expect(verdictOf("recall.gather")).toMatchObject({ measured: false, verdict: null, status: "unmeasured" });
    expect(verdictOf("kind.concept")).toMatchObject({ measured: false, verdict: "transferred", plan: 216 });
    expect(built.transferred).toHaveLength(CLEANUP_CRITERIA.transferred.features.length);
    expect(built.plan202Closure.filter((item) => item.status === "scored").length).toBe(0);
    expect(built.plan202Closure.some((item) => item.status === "unverified")).toBe(true);
  });
});

test("cleanup_campaign_dry_run_resolves_new_paths", async () => {
  const run = await dryRunC1Manifest();
  expect(run.errors).toBe(0);
  expect(run.builds + run.retired).toBe(run.jobs);
  expect(run.builds).toBeGreaterThan(0);
  // Every historical variant patches a file under the moved packages, never the retired fabric/observational trees.
  const files = [...new Set(run.rows.flatMap((row) => row.variantFiles ?? []))];
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) expect(file).toMatch(/^packages\/(memory\/(system|core)|knowledge\/wiki)\/src\//);
  // A job is retired only for a named removal, and each named removal retires at least one job.
  for (const row of run.rows.filter((row) => row.status === "retired"))
    expect(row.ablate.some((spec) => Object.hasOwn(C1_RETIRED_ABLATIONS, spec.split("=")[0]))).toBe(true);
  for (const path of Object.keys(C1_RETIRED_ABLATIONS))
    expect(run.rows.some((row) => row.status === "retired" && row.ablate.some((spec) => spec.startsWith(`${path}=`)))).toBe(true);
}, 120_000);
