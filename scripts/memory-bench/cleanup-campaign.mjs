/**
 * Plan 210 Task 5: the owner-gated ablation and re-measurement campaign (gate C-1).
 *
 * The campaign is a manifest like plans 208 and 209 (`campaign.mjs --plan 210` owns the journal, the lock, the retries
 * and the run summary). This module owns what is specific to plan 210:
 *
 * - the arms: leave-one-out for preset members, add-one for opt-ins, the fixed variants, plan 202 Task 5's deferred
 *   arms, the F4 diagnostic leg, the OM and ontology legs and the work-outcome legs, each a config override (`ablate`
 *   paths or a test-only source switch in `variants.mjs`), never a new product field;
 * - the jobs: one per (answer model, arm, suite) on the `dev` partitions only, every arm paired with its base on the
 *   same question ids; the large write sides (LongMemEval-M, BEAM-1M) built once per write-side configuration and
 *   seeded into every read-side arm that shares it;
 * - the gate record, bound to the manifest hash (a changed manifest is a refusal, never a silent re-approval);
 * - the report: per-feature paired effects with clustered CIs, cost and p95 deltas, every Task 3 prediction scored hit
 *   or miss, plan 202 Task 5's frozen rules on its deferred arms, and the verdict from `cleanupVerdict()` only.
 *
 * Free routes only (gate C-1, owner 2026-11-07). Interruptions are retried by the campaign with no effect but wall time.
 * Held-out partitions are not expressible here. Nothing here calls a model.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileFingerprint, sourceFingerprint } from "./acceptance.mjs";
import { stableHash } from "./journal.mjs";
import {
  assertCleanupCriteriaPin,
  CLEANUP_CRITERIA,
  cleanupManifestPin,
  cleanupVerdict,
  ROBUSTNESS_PARTITIONS,
  THREE_TIER_CRITERIA,
} from "./robustness.mjs";
import { pairedAnalysis } from "./stats.mjs";
import { WRITE_SIDE_VARIANTS } from "./variants.mjs";
import { comparePaired } from "./work-outcome/metrics.mjs";

export const C1_PLAN = 210;
export const C1_TASK = 5;
export const C1_GATE_ID = "C-1";
export const C1_PARTITION = "dev";
export const C1_EVIDENCE = "docs/_evidence/memory-bench/210/ablations";
export const C1_GATE = "docs/_evidence/memory-bench/210/gates/owner-gate-c1.json";
export const C1_MANIFEST = `${C1_EVIDENCE}/c1-manifest.json`;
export const C1_EXECUTION_MANIFEST = `${C1_EVIDENCE}/execution-manifest.json`;
export const C1_REPORT = `${C1_EVIDENCE}/c1-report.json`;
export const C1_JOURNAL = ".cache/memory-bench/210/journal.json";
export const C1_CACHE = ".cache/memory-bench/210";
export const C1_OUTPUT_PREFIX = "run-210-c1";
export const C1_GAP_PREDICTIONS = "docs/_evidence/memory-bench/210/gap-predictions.json";
export const C1_TASK5_MANIFEST = "docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json";

/** The robustness suites with a development partition; every applicable plan 202 Task 5 suite is here. */
export const C1_SUITES = Object.freeze(["memoryagentbench-cr", "beam-100k", "locomo", "beam-1m", "longmemeval-m"]);
/** Suites whose write side is built once per write-side configuration and seeded into the read-side arms. */
export const C1_SHARED_INGEST_SUITES = Object.freeze(["longmemeval-m", "beam-1m"]);
/** Plan 208's ontology suites (the O-rows). */
export const C1_ONTOLOGY_SUITES = Object.freeze(["memoryagentbench-cr", "beam-100k", "locomo"]);

/**
 * Gate C-1. Amendment 4 (owner, 2026-11-08): the campaign moves to paid Ollama Cloud models under the Pro allowance
 * ($60 a month, 3 concurrent requests). Beam answers as the large model, Nemotron 3 Nano as the small one; one route per
 * model, so a pair never straddles routes. (Amendments 1-3 named free Command Code, OpenCode Go and Kilo routes.)
 */
export const C1_PROVIDER = "ollama-cloud";
export const C1_MODELS = Object.freeze([
  { key: "large", provider: C1_PROVIDER, model: "beam", family: "beam", small: false, suiteRoutes: {} },
  { key: "small", provider: C1_PROVIDER, model: "nemotron-3-nano:30b", family: "nemotron", small: true, suiteRoutes: {} },
]);
/** Two judge families, neither an answer model nor a curator (curators are agent-own). */
export const C1_JUDGES = Object.freeze([`${C1_PROVIDER}/gpt-oss:120b`, `${C1_PROVIDER}/gemma4:31b`]);
/** The work-outcome simulated user: a third model, never an answer model or a judge. */
export const C1_SIMULATORS = Object.freeze({
  large: `${C1_PROVIDER}/gpt-oss:20b`,
  small: `${C1_PROVIDER}/gpt-oss:20b`,
});
/** The decision model for P3-P5 (System One wire at Ollama Cloud's `/v1/systemone`; owner, 2026-11-08). */
export const C1_DECIDER = `${C1_PROVIDER}/clef:27b`;
/** Every route gate C-1 amendment 4 authorizes. */
export const C1_ROUTES = Object.freeze(
  new Set([...C1_MODELS.map((model) => `${model.provider}/${model.model}`), ...C1_JUDGES, ...Object.values(C1_SIMULATORS), C1_DECIDER]),
);
/**
 * The allowance guard: a job starts only while the account keeps `reserveUsd` of included plus purchased balance, and
 * while any session or weekly window the account reports is open (the owner's 5-hour window; legacy plans report it).
 */
export const C1_BUDGET = Object.freeze({ reserveUsd: 1.5, windowFloorPercent: 2, balanceTtlMs: 60_000 });

/**
 * Per-job caps. Paid routes (amendment 4): the allowance guard bounds money; tokens bound each job. OM re-observes the
 * whole BEAM-1M conversation (smoke: about 5.7M input tokens a question), so its jobs are capped to a share of the
 * allowance and run last; a capped job reports the questions it finished, and its pair is scored on identical items.
 */
export const C1_CAPS = Object.freeze({
  maxInputTokens: { "longmemeval-m": 60_000_000, "beam-1m": 40_000_000, default: 25_000_000, "work-outcome": 12_000_000, om: 100_000_000 },
  wallTimeCapHours: { "longmemeval-m": 96, "beam-1m": 48, default: 24, "work-outcome": 24, write: 48, om: 48 },
  concurrency: 2,
  judgeCalls: 400,
});
/**
 * Journal ceiling over every reservation. Free routes often omit usage, and an attempt without usage is charged its whole
 * reservation, so with retries a tight ceiling would halt the campaign: an effect beyond wall time (smoke, 2026-11-08).
 * It is set far above any reachable total; the per-job caps bound the work.
 */
export const C1_CEILING = 1_000_000_000_000;

const ALL = C1_SUITES;
const DECISIONS = (points) => ({ points });

/**
 * Candidates gate C-1 cannot measure, with the reason (recorded in the manifest and the report; Task 6 lists them).
 * Amendment 5 (2026-11-08): none. P3-P5 run with Ollama Cloud's clef:27b as the decider (`C1_DECIDER`), served by the
 * ollama-cloud package's System One endpoint.
 */
export const C1_UNMEASURABLE = Object.freeze({});

/**
 * The robustness arms. `mode` orients the effect: `loo` removes a feature the base has (feature effect = base - arm),
 * `add` adds one the base lacks (feature effect = arm - base), `reference` is a base for other arms, `leg` is a
 * pre-registered diagnostic leg. `decisions` is filled with the answer model's own ref per job (agent-own decider).
 */
export const C1_ROBUSTNESS_ARMS = Object.freeze([
  { id: "P", config: "fabric-x-tools", ablate: [], suites: ALL, mode: "reference" },
  {
    id: "memory-off",
    config: "none",
    ablate: [],
    suites: ["locomo", "longmemeval-m"],
    base: "P",
    mode: "loo",
    features: ["retrieval.lexical"],
  },
  {
    id: "strength-0.15",
    ablate: ["fabric.lifecycle.recall.retrieval=0.15"],
    suites: ["longmemeval-m"],
    base: "P",
    mode: "add",
    features: ["retrieval.strength-priors"],
  },
  {
    id: "tool-affordances-loo",
    ablate: ["fabric.multiQuery=off", "fabric.unmatchedTerms=off"],
    suites: ["locomo", "beam-100k"],
    base: "P",
    mode: "loo",
    features: ["recall.multi-query", "recall.unmatched-terms"],
  },
  {
    id: "supersession-keyed-only",
    ablate: ["fabric.recall.supersessionHint=keyed-only"],
    suites: ["locomo", "beam-100k", "longmemeval-m"],
    base: "P",
    mode: "add",
    features: ["recall.supersession-hint"],
  },
  { id: "expansion", ablate: ["fabric.recall.expansion=true"], suites: ["locomo"], base: "P", mode: "add", features: ["recall.expansion"] },
  {
    id: "gather",
    ablate: ["fabric.recall.gather=true"],
    suites: ["locomo", "beam-100k"],
    base: "P",
    mode: "add",
    features: ["recall.gather"],
  },
  {
    id: "enrichment-loo",
    ablate: ["fabric.enrichment=off"],
    suites: ALL,
    base: "P",
    mode: "loo",
    features: ["write.keyword-enrichment"],
    task5: true,
  },
  {
    id: "navigation-loo",
    ablate: ["fabric.navigation=off"],
    suites: ALL,
    base: "P",
    mode: "loo",
    features: ["navigation.agentic-lexical"],
    task5: true,
  },
  {
    id: "timeline-loo",
    ablate: ["fabric.timeline=off"],
    suites: ["longmemeval-m", "locomo"],
    base: "P",
    mode: "loo",
    features: ["timeline"],
  },
  {
    id: "grouping-loo",
    ablate: ["fabric.recall.supersessionHint=keyed-only", "fabric.grouping=off"],
    suites: ["longmemeval-m", "beam-100k"],
    base: "supersession-keyed-only",
    mode: "loo",
    features: ["recall.state-grouping"],
  },
  // The maintain-then-answer pair: the only arms that run `memory:maintain` (cleanup-criteria preRegistered).
  { id: "maintain", ablate: [], maintain: true, suites: ["beam-100k", "longmemeval-m"], base: "P", mode: "reference" },
  {
    id: "archive-exchange-exempt",
    ablate: ["lifecycle.exchangeExempt=on"],
    maintain: true,
    suites: ["beam-100k", "longmemeval-m"],
    base: "maintain",
    mode: "add",
    features: ["lifecycle.archive-revival"],
  },
  {
    id: "tools-only",
    ablate: ["fabric.inject=off"],
    suites: ["locomo", "beam-100k", "longmemeval-m"],
    base: "P",
    mode: "loo",
    features: ["delivery.passive-tail"],
  },
  {
    id: "card-excerpt",
    ablate: ["fabric.inject.cardExcerpt=query"],
    suites: ["locomo"],
    base: "P",
    mode: "add",
    features: ["delivery.passive-tail#inject.cardExcerpt"],
  },
  {
    id: "precision-filter",
    ablate: ["fabric.inject.minScore=0.35"],
    suites: ["locomo", "beam-100k"],
    base: "P",
    mode: "add",
    features: ["delivery.precision-filter"],
  },
  {
    id: "aggregation-loo",
    ablate: ["fabric.aggregation=off"],
    suites: ["beam-100k", "locomo"],
    base: "P",
    mode: "loo",
    features: ["delivery.aggregation-abstention"],
  },
  {
    id: "directory-loo",
    ablate: ["fabric.directory=off"],
    suites: ["locomo", "longmemeval-m"],
    base: "P",
    mode: "loo",
    features: ["delivery.directory"],
  },
  { id: "rules-add", ablate: ["fabric.rules=on"], suites: ["beam-100k"], base: "P", mode: "add", features: ["delivery.standing-rules"] },
  {
    id: "decisions-p3",
    ablate: ["fabric.inject.minScore=0.35"],
    decisions: DECISIONS(["P3"]),
    suites: ["beam-100k", "locomo"],
    base: "precision-filter",
    mode: "add",
    features: ["decisions.P3"],
  },
  {
    id: "decisions-p5",
    ablate: [],
    decisions: DECISIONS(["P5"]),
    suites: ["beam-100k", "locomo"],
    base: "P",
    mode: "add",
    features: ["decisions.P5"],
  },
  // The pre-registered F4 diagnostic leg (cleanup-criteria preRegistered.f4DiagnosticLeg): best read-time and oracle.
  {
    id: "f4-readtime",
    ablate: [
      "fabric.recall.gather=true",
      "fabric.recall.expansion=true",
      "fabric.inject.cardExcerpt=query",
      "fabric.recall.supersessionHint=keyed-only",
    ],
    suites: ["beam-100k", "locomo", "longmemeval-m"],
    base: "P",
    mode: "leg",
  },
  { id: "oracle", config: "oracle", ablate: [], suites: ["beam-100k", "locomo", "longmemeval-m"], mode: "leg" },
  // OM on BEAM-1M: the OM arm, its reflector leave-one-out and the deterministic dropper.
  { id: "OM", config: "om", ablate: [], suites: ["beam-1m"], mode: "reference" },
  {
    id: "om-reflector-loo",
    config: "om",
    ablate: ["om.reflector=off"],
    suites: ["beam-1m"],
    base: "OM",
    mode: "loo",
    features: ["om.reflector"],
  },
  {
    id: "om-dropper-deterministic",
    config: "om",
    ablate: ["om.dropper.policy=lowest-relevance"],
    suites: ["beam-1m"],
    base: "OM",
    mode: "add",
    features: ["om.dropper-model", "om.dropper-lowest-relevance"],
  },
]);

/** The ontology arms on plan 208's suites: `P+O` and four leave-one-outs against it. */
export const C1_ONTOLOGY_ARMS = Object.freeze([
  { id: "P+O", ablate: [], mode: "reference" },
  {
    id: "trigger-co-read-loo",
    ablate: ['wiki.consolidate.triggers=["accumulation","repair"]'],
    base: "P+O",
    mode: "loo",
    features: ["ontology.trigger.co-read"],
  },
  {
    id: "trigger-accumulation-loo",
    ablate: ['wiki.consolidate.triggers=["co-read","repair"]'],
    base: "P+O",
    mode: "loo",
    features: ["ontology.trigger.accumulation"],
  },
  { id: "concept-prior-loo", ablate: ["fabric.ontology.conceptPrior=0"], base: "P+O", mode: "loo", features: ["ontology.concept-prior"] },
  { id: "concept-pointer-loo", ablate: ["ontology.pointer=off"], base: "P+O", mode: "loo", features: ["ontology.passive-pointer"] },
]);

/** The work-outcome arms: plan 209's `P` and `P+W` and overlays on them. */
export const C1_WORK_ARMS = Object.freeze([
  { id: "W.P", arm: "P", mode: "reference" },
  { id: "W.P+W", arm: "P+W", mode: "reference" },
  { id: "W.steps-loo", arm: "P+W", overlay: { exchanges: {} }, base: "W.P+W", mode: "loo", features: ["write.exchange-steps"] },
  {
    id: "W.rules-loo",
    arm: "P+W",
    overlay: { rules: false },
    base: "W.P+W",
    mode: "loo",
    features: ["delivery.standing-rules"],
  },
  { id: "W.lessons-loo", arm: "P+W", overlay: { lessons: { nudge: false } }, base: "W.P+W", mode: "loo", features: ["lessons"] },
  { id: "W.decisions-p4", arm: "P", decisions: DECISIONS(["P4"]), base: "W.P", mode: "add", features: ["decisions.P4"] },
]);

/** Refuse anything but the development partition, in a manifest, a job or a profile argument. */
export function assertC1Partition(partition) {
  if (partition !== C1_PARTITION)
    throw new Error(`C1Partition: plan 210 Task 5 reads the ${C1_PARTITION} partition only; ${partition ?? "(none)"} belongs to Task 9`);
  return partition;
}

export const refOf = (route) => `${route.provider}/${route.model}`;
/** A model's route for a suite (a pair never straddles routes: the route depends on the suite only). */
export function routeFor(model, suite) {
  return model.suiteRoutes?.[suite] ?? { provider: model.provider, model: model.model };
}
const safe = (value) => value.replace(/[^A-Za-z0-9.+_-]/g, "_");
const capOf = (table, suite) => table[suite] ?? table.default;

/** The write-side switches of an arm (what changes the stored notes). */
export function writeVariantsOf(arm) {
  return (arm.ablate ?? []).filter((spec) => WRITE_SIDE_VARIANTS.includes(spec)).sort();
}

/** The snapshot key of a shared write side: suite, partition, config, write switches and the product bytes. */
export function c1SnapshotKey({ suite, config, writeVariants, productHash, ingestHash }) {
  return `210-${safe(suite)}-${stableHash({ suite, partition: C1_PARTITION, config, writeVariants, productHash, ingestHash }).slice(0, 24)}`;
}

function decisionsAblate(arm) {
  return arm.decisions ? [`fabric.decisions=${JSON.stringify({ model: C1_DECIDER, points: arm.decisions.points })}`] : [];
}

/** One robustness job (`run.mjs`). Ids: `210-c1.<model>.<arm>.<suite>`. */
export function c1RobustnessJob(model, arm, suite, { producers = new Map() } = {}) {
  const route = routeFor(model, suite);
  const config = arm.config ?? "fabric-x-tools";
  const id = `210-c1.${model.key}.${arm.id}.${suite}`;
  const job = {
    id,
    kind: "robustness",
    family: `210-c1.${model.key}.${arm.id}`,
    role: arm.id,
    arm: arm.id,
    model_key: model.key,
    suite,
    subset: C1_PARTITION,
    config,
    provider: route.provider,
    model: route.model,
    judges: C1_JUDGES.join(","),
    judgeText: true,
    labelInjections: "off",
    // OM re-observes the whole conversation per question (smoke: about 10M input tokens per BEAM-1M question).
    maxInputTokens: config === "om" ? C1_CAPS.maxInputTokens.om : capOf(C1_CAPS.maxInputTokens, suite),
    maxOutputTokens: 8192,
    concurrency: C1_CAPS.concurrency,
    wallTimeCapHours: config === "om" ? C1_CAPS.wallTimeCapHours.om : capOf(C1_CAPS.wallTimeCapHours, suite),
    finalTurnAnswer: true,
    interleaveAbilities: true,
    strictQuestions: true,
    answersDir: `${C1_CACHE}/${model.key}/${safe(arm.id)}/${suite}/answers`,
    judgeCacheDir: `${C1_CACHE}/${model.key}/${safe(arm.id)}/${suite}/judge`,
    ...(arm.maintain ? { maintainBeforeAnswer: true } : {}),
  };
  const ablate = [...(arm.ablate ?? []), ...decisionsAblate(arm)];
  if (ablate.length) job.ablate = ablate;
  if (arm.decisions) job.decider = C1_DECIDER;
  // A shared-ingest suite seeds from its write side unless the arm builds no fabric store (comparators, OM).
  if (C1_SHARED_INGEST_SUITES.includes(suite) && config === "fabric-x-tools") {
    const producer = producers.get(`${suite}|${writeVariantsOf(arm).join(",")}`);
    if (!producer) throw new Error(`C1Jobs: no write side for ${id}`);
    job.writeSide = producer.id;
  }
  return job;
}

/** A shared write side: builds the store once (`--phase write`), no model call (the conversational write is local). */
export function c1ProducerJob(suite, writeVariants, { productHash, ingestHash }) {
  const route = routeFor(C1_MODELS[0], suite);
  const tag = writeVariants.length ? writeVariants.map((spec) => spec.split("=")[0].split(".").at(-1)).join("+") : "base";
  return {
    id: `210-c1.write.${tag}.${suite}`,
    kind: "write-side",
    family: "210-c1.write",
    role: "write",
    arm: `write.${tag}`,
    suite,
    subset: C1_PARTITION,
    config: "fabric-x-tools",
    provider: route.provider,
    model: route.model,
    // Never called (the write side is local); named so the child's argv carries only gate C-1 refs.
    judges: C1_JUDGES.join(","),
    maxInputTokens: 1_000_000,
    // The readers' question order: a capped producer (smoke) must snapshot the same questions its readers answer.
    interleaveAbilities: true,
    wallTimeCapHours: C1_CAPS.wallTimeCapHours.write,
    // One question at a time: three full-cohort LongMemEval-M write sides at 4 each filled RAM and swap (systemd-oomd, 2026-11-08).
    concurrency: 1,
    ...(writeVariants.length ? { ablate: [...writeVariants] } : {}),
    snapshotKey: c1SnapshotKey({ suite, config: "fabric-x-tools", writeVariants, productHash, ingestHash }),
  };
}

/** One ontology job: plan 208's `P+O` shape with C-1's models, judges, caches and the arm's overrides. */
export function c1OntologyJob(model, arm, suite) {
  const route = routeFor(model, suite);
  const label = `${arm.id}.${model.key}`;
  const root = `${C1_CACHE}/ontology/${safe(label)}/${suite}`;
  return {
    id: `210-c1.${model.key}.${arm.id}.${suite}`,
    kind: "ontology",
    family: `210-c1.${model.key}.${arm.id}`,
    role: arm.id,
    arm: arm.id,
    model_key: model.key,
    suite,
    subset: C1_PARTITION,
    config: "fabric-x-tools",
    provider: route.provider,
    model: route.model,
    judges: C1_JUDGES.join(","),
    judgeText: true,
    labelInjections: "off",
    maxInputTokens: capOf(C1_CAPS.maxInputTokens, suite),
    maxOutputTokens: 8192,
    concurrency: 1,
    wallTimeCapHours: 36,
    finalTurnAnswer: true,
    interleaveAbilities: true,
    strictQuestions: true,
    ontology: true,
    ontologyArm: label,
    ontologyClaimsDir: `${C1_CACHE}/ontology-claims`,
    answersDir: `${root}/answers`,
    judgeCacheDir: `${root}/judge`,
    ...(arm.ablate.length ? { ablate: [...arm.ablate] } : {}),
  };
}

/** One work-outcome job (`work-outcome/live.mjs`) with C-1's models, free simulator and judges. */
export function c1WorkJob(model, arm) {
  const route = routeFor(model, "work-outcome");
  const overlay = {
    ...(arm.overlay ?? {}),
    ...(arm.decisions ? { decisions: { model: C1_DECIDER, points: arm.decisions.points } } : {}),
  };
  return {
    id: `210-c1.${model.key}.${arm.id}`,
    kind: "work-outcome",
    family: `210-c1.${model.key}.${arm.id}`,
    role: arm.id,
    arm: arm.arm,
    c1Arm: arm.id,
    model_key: model.key,
    suite: "work-outcome",
    config: arm.arm,
    subset: C1_PARTITION,
    provider: route.provider,
    model: route.model,
    simulator: C1_SIMULATORS[model.key],
    simulatorPaid: true,
    judgesPaid: true,
    judges: C1_JUDGES.join(","),
    maxInputTokens: C1_CAPS.maxInputTokens["work-outcome"],
    concurrency: C1_CAPS.concurrency,
    judgeCalls: C1_CAPS.judgeCalls,
    wallTimeCapHours: C1_CAPS.wallTimeCapHours["work-outcome"],
    ...(Object.keys(overlay).length ? { fabricOverlay: overlay } : {}),
    ...(arm.decisions ? { decider: C1_DECIDER } : {}),
  };
}

/**
 * Amendment 6 (owner, 2026-11-08: "I would like to go with option 3"): the campaign runs in three waves, each about a
 * working day on the Pro plan's 3 concurrent requests, so the deciding rows land first and each later wave is a fresh
 * owner go-ahead. Every arm's base is in its own wave or an earlier one; write sides are wave 1.
 * - Wave 1: the plan 202 Task 5 rows (P, enrichment-loo, navigation-loo on every suite) and the removal-deciding nulls
 *   and losses that pair with P (memory-off, tool affordances, supersession hint, state grouping, directory, timeline).
 * - Wave 2: the remaining recall and delivery arms, P3/P5 and the work-outcome leg.
 * - Wave 3: the ontology arms (and the panel calibration on P+O.large), the F4 diagnostic leg and OM.
 */
export const C1_WAVES = Object.freeze({
  P: 1,
  "enrichment-loo": 1,
  "navigation-loo": 1,
  "memory-off": 1,
  "tool-affordances-loo": 1,
  "supersession-keyed-only": 1,
  "grouping-loo": 1,
  "directory-loo": 1,
  "timeline-loo": 1,
  "strength-0.15": 2,
  expansion: 2,
  gather: 2,
  maintain: 2,
  "archive-exchange-exempt": 2,
  "tools-only": 2,
  "card-excerpt": 2,
  "precision-filter": 2,
  "aggregation-loo": 2,
  "rules-add": 2,
  "decisions-p3": 2,
  "decisions-p5": 2,
  "f4-readtime": 3,
  oracle: 3,
  OM: 3,
  "om-reflector-loo": 3,
  "om-dropper-deterministic": 3,
});
export const C1_WORK_WAVE = 2;
export const C1_ONTOLOGY_WAVE = 3;
/** Gate C-1 amendment 7 (owner, 2026-11-08): the campaign closed after wave 1; waves 2 and 3 never run. */
export const C1_CLOSED_AFTER_WAVE = CLEANUP_CRITERIA.closure.afterWave;

/** The wave of one job: write sides 1, work-outcome 2, ontology 3, robustness by its arm. */
export function c1WaveOf(job) {
  if (job.kind === "write-side") return 1;
  if (job.kind === "work-outcome") return C1_WORK_WAVE;
  if (job.kind === "ontology") return C1_ONTOLOGY_WAVE;
  const wave = C1_WAVES[job.arm];
  if (!wave) throw new Error(`C1Waves: arm ${job.arm} has no wave`);
  return wave;
}

/** `PRISM_MEMORY_BENCH_210_WAVES` ("1", "1,2", ...): the waves a run may start; anything else is deferred. */
export function parseC1Waves(value) {
  if (value === undefined || value === null || value === "") return null;
  const waves = String(value)
    .split(",")
    .map((item) => Number(item.trim()));
  if (!waves.length || waves.some((wave) => ![1, 2, 3].includes(wave)))
    throw new Error(`C1Waves: PRISM_MEMORY_BENCH_210_WAVES must list waves 1-3, got "${value}"`);
  if (waves.some((wave) => wave > C1_CLOSED_AFTER_WAVE))
    throw new Error(
      `C1Closed: gate C-1 closed after wave ${C1_CLOSED_AFTER_WAVE} (amendment 7); waves above it are cancelled and never run`,
    );
  return [...new Set(waves)].sort();
}

/** Every job of the campaign, producers first. Pure given the product and ingest hashes. */
export function c1Jobs({ productHash, ingestHash }) {
  const producers = new Map();
  for (const suite of C1_SHARED_INGEST_SUITES)
    for (const arm of C1_ROBUSTNESS_ARMS) {
      if (!arm.suites.includes(suite) || (arm.config ?? "fabric-x-tools") !== "fabric-x-tools") continue;
      const variants = writeVariantsOf(arm);
      const key = `${suite}|${variants.join(",")}`;
      if (!producers.has(key)) producers.set(key, c1ProducerJob(suite, variants, { productHash, ingestHash }));
    }
  const robustness = C1_MODELS.flatMap((model) =>
    C1_ROBUSTNESS_ARMS.flatMap((arm) => arm.suites.map((suite) => c1RobustnessJob(model, arm, suite, { producers }))),
  );
  const ontology = C1_MODELS.flatMap((model) =>
    C1_ONTOLOGY_ARMS.flatMap((arm) => C1_ONTOLOGY_SUITES.map((suite) => c1OntologyJob(model, arm, suite))),
  );
  const work = C1_MODELS.flatMap((model) => C1_WORK_ARMS.map((arm) => c1WorkJob(model, arm)));
  // OM jobs run last: they are the costliest per question, so the allowance reaches every other arm first.
  const om = robustness.filter((job) => job.config === "om");
  const rest = robustness.filter((job) => job.config !== "om");
  const jobs = [...producers.values(), ...rest, ...ontology, ...work, ...om].map((job) => ({ ...job, wave: c1WaveOf(job) }));
  return assertC1Jobs(jobs);
}

/** Development only, gate C-1 routes only, every arm paired with an existing base on the same suite and model. */
export function assertC1Jobs(jobs) {
  const heldOut = new Set(ROBUSTNESS_PARTITIONS.filter((name) => name.startsWith("heldout")));
  const ids = new Set();
  for (const job of jobs) {
    if (ids.has(job.id)) throw new Error(`C1Jobs: duplicate job ${job.id}`);
    ids.add(job.id);
    if (job.subset !== C1_PARTITION || heldOut.has(job.subset)) throw new Error(`C1Partition: ${job.id} reads ${job.subset}`);
    if (!C1_ROUTES.has(`${job.provider}/${job.model}`))
      throw new Error(`C1Billing: ${job.id} is not on a gate C-1 route (${job.provider}/${job.model})`);
    for (const ref of [...(job.judges ? job.judges.split(",") : []), ...(job.simulator ? [job.simulator] : [])])
      if (!C1_ROUTES.has(ref)) throw new Error(`C1Billing: ${job.id} names ${ref}, which is not a gate C-1 route`);
    // Route-free model name (provider and family prefixes, `:free` / `-free` dropped), as assertNoCuratorJudge compares.
    const bare = (model) =>
      model
        .split("/")
        .at(-1)
        .toLowerCase()
        .replace(/(:free|-free)$/, "");
    if (job.judges?.split(",").some((ref) => bare(ref) === bare(job.model)))
      throw new Error(`C1Judges: ${job.id} is judged by its own answer model`);
  }
  // Pairing: every non-reference arm's base exists for the same model and suite.
  const all = [...C1_ROBUSTNESS_ARMS, ...C1_ONTOLOGY_ARMS, ...C1_WORK_ARMS];
  for (const job of jobs) {
    if (!job.model_key) continue;
    const arm = all.find((item) => item.id === (job.c1Arm ?? job.arm));
    if (!arm?.base) continue;
    const baseId = job.kind === "work-outcome" ? `210-c1.${job.model_key}.${arm.base}` : `210-c1.${job.model_key}.${arm.base}.${job.suite}`;
    if (!ids.has(baseId)) throw new Error(`C1Pairing: ${job.id} has no base ${baseId}`);
    const base = jobs.find((item) => item.id === baseId);
    if (base.subset !== job.subset || base.provider !== job.provider || base.model !== job.model)
      throw new Error(`C1Pairing: ${job.id} and its base differ in partition or route`);
    if (job.wave !== undefined && base.wave > job.wave) throw new Error(`C1Waves: ${job.id} runs before its base ${baseId}`);
  }
  return jobs;
}

export function c1ManifestHash(manifest) {
  const { gate: _gate, manifestHash: _hash, generatedAt: _at, ...rest } = manifest;
  return stableHash(rest);
}

/** The plan 202 Task 5 pin: the frozen manifest's criteria hash and the full LongMemEval-M / BEAM-1M cohorts. */
export async function c1Task5Pin({ root = "." } = {}) {
  const frozen = JSON.parse(await readFile(join(root, C1_TASK5_MANIFEST), "utf8"));
  const pinned = CLEANUP_CRITERIA.pins.plan202Task5;
  if (frozen.criteriaHash !== pinned.criteriaHash || frozen.criteria?.version !== pinned.criteriaVersion)
    throw new Error("C1Task5: the frozen plan 202 Task 5 criteria drifted from cleanup-criteria.json's pin");
  const cohort = Object.fromEntries(
    frozen.cohort.suites.map((row) => [row.suite, { questions: row.questions, idsHash: row.idsHash ?? null }]),
  );
  return {
    manifest: C1_TASK5_MANIFEST,
    criteriaVersion: frozen.criteria.version,
    criteriaHash: frozen.criteriaHash,
    rules: { halvingFactor: 0.5, abilityMargin: 0.03, abilityGuard: "veto", missingStrata: "unverified and blocking" },
    arms: { "enrichment-off": "enrichment-loo", "navigation-off": "navigation-loo", candidate: "P" },
    cohort,
    fullCohorts: { "longmemeval-m": cohort["longmemeval-m"], "beam-1m": cohort["beam-1m"] },
  };
}

export async function buildC1Manifest({ root = "." } = {}) {
  const productHash = await sourceFingerprint(["packages/memory/system/src/ltm", "packages/memory/core/src"], root);
  const ingestHash = await fileFingerprint(["scripts/memory-bench/replay.mjs", "scripts/memory-bench/datasets.mjs"], root);
  const predictions = JSON.parse(await readFile(join(root, C1_GAP_PREDICTIONS), "utf8"));
  const manifest = {
    kind: "210-c1-ablation-manifest",
    schemaVersion: 1,
    plan: C1_PLAN,
    task: C1_TASK,
    gateId: C1_GATE_ID,
    partition: C1_PARTITION,
    status: "proposal",
    executable: false,
    ...cleanupManifestPin(),
    threeTierCriteriaHash: CLEANUP_CRITERIA.pins.threeTierCriteriaHash,
    workOutcomeCriteriaHash: CLEANUP_CRITERIA.pins.workOutcomeCriteriaHash,
    gapPredictionsHash: CLEANUP_CRITERIA.pins.gapPredictions.predictionsHash,
    plan202Task5: await c1Task5Pin({ root }),
    productHash,
    ingestHash,
    provider: C1_PROVIDER,
    model: "210-c1-panel",
    ceiling: C1_CEILING,
    journalPath: C1_JOURNAL,
    summaryPath: `${C1_EVIDENCE}/execution-run.json`,
    models: {
      answers: C1_MODELS.map((model) => ({
        key: model.key,
        ref: refOf(model),
        family: model.family,
        small: model.small,
        suiteRoutes: Object.fromEntries(Object.entries(model.suiteRoutes).map(([suite, route]) => [suite, refOf(route)])),
      })),
      judges: [...C1_JUDGES],
      judgeFamilies: ["gpt-oss", "gemma"],
      simulators: { ...C1_SIMULATORS },
      curator: "agent-own (wiki model unset: each answer model curates its own concepts)",
      decider: C1_DECIDER,
      judgesDoNotAnswer: true,
    },
    billing: {
      mode: "paid-allowance",
      provider: C1_PROVIDER,
      plan: "Ollama Cloud Pro ($60 included a month, 3 concurrent requests)",
      reserveUsd: C1_BUDGET.reserveUsd,
      paidAnswers: C1_MODELS.map((model) => refOf(model)),
      paidJudges: [...C1_JUDGES],
      paidSimulators: [...new Set(Object.values(C1_SIMULATORS))],
      paidFallbacks: [],
    },
    interruptions:
      "429s, closed usage windows (waited out from /api/balance's resets_at), quota windows, daily caps, empty replies, timeouts and dropped sockets are re-run from the job's answer/judge checkpoints after a cooldown and never count against its attempts; a question that errors fails the job (--strict-questions) instead of being scored; only a classified permanent refusal stops a job, which is then reported incomplete, never as wrong answers",
    sharedIngest:
      "LongMemEval-M and BEAM-1M write sides are built once per write-side configuration (no model call) and seeded into every read-side arm",
    caps: { ...C1_CAPS, journalCeiling: C1_CEILING },
    cohort: Object.fromEntries(
      C1_SUITES.map((suite) => [
        suite,
        { partition: C1_PARTITION, partitionIdsHash: THREE_TIER_CRITERIA.pins.partitionIdsHash?.[suite] ?? null },
      ]),
    ),
    arms: {
      robustness: C1_ROBUSTNESS_ARMS.map(({ id, config, ablate, suites, base, mode, features, maintain, decisions, task5 }) => ({
        id,
        config: config ?? "fabric-x-tools",
        ablate,
        suites,
        base: base ?? null,
        mode,
        features: features ?? [],
        ...(maintain ? { maintain } : {}),
        ...(decisions ? { decisions } : {}),
        ...(task5 ? { plan202Task5: true } : {}),
      })),
      ontology: C1_ONTOLOGY_ARMS.map((arm) => ({ ...arm, suites: [...C1_ONTOLOGY_SUITES] })),
      work: C1_WORK_ARMS.map((arm) => ({ ...arm })),
    },
    closure: structuredClone(CLEANUP_CRITERIA.closure),
    predictionsCovered: c1PredictionCoverage(predictions.predictions),
    unmeasurable: { ...C1_UNMEASURABLE },
    results: [],
    jobs: c1Jobs({ productHash, ingestHash }),
  };
  manifest.manifestHash = c1ManifestHash(manifest);
  return assertCleanupCriteriaPin(manifest);
}

/** Every `fix-and-measure` prediction maps to a C-1 arm, or the manifest is refused. */
export function c1PredictionCoverage(predictions) {
  const arms = new Set([...C1_ROBUSTNESS_ARMS, ...C1_ONTOLOGY_ARMS, ...C1_WORK_ARMS].map((arm) => arm.id));
  const rows = [];
  for (const prediction of predictions) {
    if (prediction.verdict !== "fix-and-measure") continue;
    const arm = C1_PREDICTION_ARMS[prediction.arm];
    if (!arm || ![arm].flat().every((id) => arms.has(id) || id.startsWith("offline:") || id.startsWith("unmeasurable:")))
      throw new Error(`C1Coverage: prediction ${prediction.feature}/${prediction.arm} has no C-1 arm`);
    rows.push({ feature: prediction.feature, prediction: prediction.arm, arms: [arm].flat() });
  }
  return rows;
}

/** The Task 3 prediction arm name -> the C-1 arm(s) that measure it. */
export const C1_PREDICTION_ARMS = Object.freeze({
  "memory-off": "memory-off",
  "strength-0.15": "strength-0.15",
  "tool-affordances-loo": "tool-affordances-loo",
  "supersession-keyed-only": "supersession-keyed-only",
  expansion: "expansion",
  gather: "gather",
  "enrichment-loo": "enrichment-loo",
  "w-steps-loo": "W.steps-loo",
  "timeline-loo": "timeline-loo",
  "grouping-loo": "grouping-loo",
  "archive-exchange-exempt": "archive-exchange-exempt",
  "exchange-tier-off": "offline:growth-stream",
  "tools-only": "tools-only",
  "card-excerpt": "card-excerpt",
  "precision-filter": "precision-filter",
  "aggregation-loo": "aggregation-loo",
  "directory-loo": "directory-loo",
  "rules-loo": ["W.rules-loo", "rules-add"],
  "decisions-p3": "decisions-p3",
  "decisions-p4": "W.decisions-p4",
  "decisions-p5": "decisions-p5",
  "lessons-loo": "W.lessons-loo",
  "trigger-co-read-loo": "trigger-co-read-loo",
  "trigger-accumulation-loo": "trigger-accumulation-loo",
  "concept-prior-loo": "concept-prior-loo",
  "concept-pointer-loo": "concept-pointer-loo",
  "om-reflector-loo": "om-reflector-loo",
  "om-dropper-deterministic": "om-dropper-deterministic",
  "navigation-loo": "navigation-loo",
});

export async function writeC1Manifest({ root = ".", path = join(root, C1_MANIFEST) } = {}) {
  const manifest = await buildC1Manifest({ root });
  await mkdir(join(root, C1_EVIDENCE), { recursive: true });
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...manifest }, null, 2)}\n`);
  return manifest;
}

/**
 * Plan 216 Task 8: ablations whose feature a later task removed, so the arm can no longer be built. A plan 210 row is
 * checked against the slimmed record's removals; anything else that fails to build is an error.
 */
export const C1_RETIRED_ABLATIONS = Object.freeze({
  "fabric.recall.supersessionHint": { feature: "recall.supersession-hint", removedBy: "plan 210 Task 7" },
  "fabric.enrichment": { feature: "write.keyword-enrichment", removedBy: "plan 210 Task 7" },
  "fabric.timeline": { feature: "timeline", removedBy: "plan 210 Task 7" },
  // The concept kind prior in recall went with the ontology; the wiki has no recall prior to ablate.
  "fabric.ontology.conceptPrior": { feature: "ontology.concept-prior", removedBy: "plan 216 Task 3" },
});

/**
 * Plan 216 Task 8: build every C-1 job's arm against the current paths without running it. Each job's memory config
 * resolves through the package schemas and each historical variant patches its (moved) source file; a job whose
 * ablation names a retired feature is reported `retired`, never silently skipped.
 */
export async function dryRunC1Manifest({ root = ".", manifest } = {}) {
  manifest ??= await buildC1Manifest({ root });
  const { canonicalArm, historicalVariants, memoryConfigs } = await import("./ablations.mjs");
  const { variantProvenance } = await import("./variants.mjs");
  const { armConfig } = await import("./work-outcome/run.mjs");
  const slimmed = JSON.parse(await readFile(join(root, "docs/_evidence/memory-bench/210/slimmed/record.json"), "utf8"));
  const removed = new Set(slimmed.removals.map((row) => row.feature));
  for (const [path, row] of Object.entries(C1_RETIRED_ABLATIONS))
    if (row.removedBy === "plan 210 Task 7" && !removed.has(row.feature))
      throw new Error(`C1DryRun: ${path} names ${row.feature}, which the slimmed record does not remove`);
  const jobs = [];
  for (const job of manifest.jobs) {
    const ablate = job.ablate ?? [];
    const retired = ablate.map((spec) => C1_RETIRED_ABLATIONS[spec.split("=")[0]]).find(Boolean);
    if (retired) {
      jobs.push({ id: job.id, kind: job.kind, config: job.config, ablate, status: "retired", ...retired });
      continue;
    }
    let variantFiles = [];
    try {
      if (job.kind === "work-outcome") armConfig(job.config, { fabricOverlay: job.fabricOverlay });
      else {
        const historical = historicalVariants(ablate);
        memoryConfigs({
          config: canonicalArm(job.config),
          suite: job.suite,
          ontology: job.ontology,
          ablate: ablate.filter((spec) => !historical.includes(spec)),
        });
        variantFiles = (await variantProvenance(historical)).map((row) => row.path);
      }
      jobs.push({ id: job.id, kind: job.kind, config: job.config, ablate, status: "builds", variantFiles });
    } catch (error) {
      jobs.push({ id: job.id, kind: job.kind, config: job.config, ablate, status: "error", error: error.message });
    }
  }
  const count = (status) => jobs.filter((job) => job.status === status).length;
  return {
    kind: "216-c1-dry-run",
    manifestHash: manifest.manifestHash,
    productHash: manifest.productHash,
    jobs: jobs.length,
    builds: count("builds"),
    retired: count("retired"),
    errors: count("error"),
    retiredArms: [...new Set(jobs.filter((job) => job.status === "retired").map((job) => `${job.ablate.join(",")} (${job.removedBy})`))],
    rows: jobs,
  };
}

/** The owner's approval, bound to the manifest hash. Pure: checks, never writes. */
export function assertC1Gate(gate, manifest) {
  const refuse = (reason) => {
    throw new Error(`C1Gate: ${reason}`);
  };
  if (!gate || typeof gate !== "object") refuse("no gate record");
  if (gate.plan !== C1_PLAN || gate.gate !== C1_GATE_ID) refuse(`the record is not plan 210 gate ${C1_GATE_ID}`);
  if (gate.approved !== true || gate.approvedBy !== "owner") refuse("the gate is not approved by the owner");
  if (typeof gate.text !== "string" || !gate.text.trim()) refuse("the gate carries no owner text");
  if (gate.manifestHash !== manifest.manifestHash)
    refuse("the manifest differs from the approved one; a changed manifest is a refusal, not a re-approval");
  if (gate.billing?.mode !== "paid-allowance" || gate.billing?.provider !== C1_PROVIDER || gate.billing?.paidFallbacks?.length)
    refuse("gate C-1 (amendment 4) approves the named Ollama Cloud routes under the allowance, with no fallbacks");
  if (gate.cleanupCriteriaHash !== manifest.cleanupCriteriaHash) refuse("the gate pins different cleanup criteria");
  return gate;
}

export async function readC1Gate({ root = "." } = {}) {
  const path = join(root, C1_GATE);
  if (!existsSync(path)) throw new Error(`C1Gate: no gate record at ${C1_GATE}; the owner approves gate C-1 before any live call`);
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * The executable manifest: the proposal plus a verified gate. `PRISM_MEMORY_BENCH_210_JOBS` (comma-separated id
 * substrings) runs a subset of the approved jobs unchanged; a bounded smoke (`PRISM_MEMORY_BENCH_210_SMOKE=1`) runs two
 * questions per job in its own journal so the real run neither reuses nor overwrites it.
 */
export async function buildExecutableC1Manifest({
  root = ".",
  only = process.env.PRISM_MEMORY_BENCH_210_JOBS,
  smoke = process.env.PRISM_MEMORY_BENCH_210_SMOKE === "1",
  waves = parseC1Waves(process.env.PRISM_MEMORY_BENCH_210_WAVES),
} = {}) {
  if (waves?.some((wave) => wave > C1_CLOSED_AFTER_WAVE))
    throw new Error(`C1Closed: gate C-1 closed after wave ${C1_CLOSED_AFTER_WAVE} (amendment 7); waves above it never run`);
  const manifest = await buildC1Manifest({ root });
  const gate = assertC1Gate(await readC1Gate({ root }), manifest);
  const patterns = String(only ?? "")
    .split(",")
    .filter(Boolean);
  let jobs = patterns.length ? manifest.jobs.filter((job) => patterns.some((pattern) => job.id.includes(pattern))) : manifest.jobs;
  // A selected read-side job brings its write side with it.
  const producers = new Set(jobs.map((job) => job.writeSide).filter(Boolean));
  jobs = [...manifest.jobs.filter((job) => producers.has(job.id) && !jobs.includes(job)), ...jobs];
  if (!jobs.length) throw new Error(`C1: no approved job matches ${only}`);
  const tag = patterns.length || smoke ? stableHash(`${smoke ? "smoke:" : ""}${patterns.join(",")}`).slice(0, 8) : null;
  return {
    ...manifest,
    jobs: smoke ? jobs.map((job) => (job.kind === "work-outcome" ? { ...job, personaLimit: 1 } : { ...job, maxQuestions: 2 })) : jobs,
    ...(tag
      ? {
          worker: tag,
          journalPath: `${C1_CACHE}/journal-${smoke ? "smoke" : "worker"}-${tag}.json`,
          summaryPath: `${C1_EVIDENCE}/execution-${smoke ? "smoke" : "run-worker"}-${tag}.json`,
          executionManifestPath: `${C1_EVIDENCE}/execution-manifest-${smoke ? "smoke" : "worker"}-${tag}.json`,
        }
      : {}),
    // The job list (and so the journal) is the whole campaign; jobs outside the active waves are deferred at run time.
    // After amendment 7 the active waves never exceed the closure, whatever the environment says.
    activeWaves: waves ?? Array.from({ length: C1_CLOSED_AFTER_WAVE }, (_, index) => index + 1),
    status: "approved",
    executable: true,
    gate: { path: C1_GATE, manifestHash: gate.manifestHash, approvedAt: gate.approvedAt },
  };
}

/** A job the run must not start: outside the manifest's active waves. */
export function c1Deferred(manifest, job) {
  if (job.wave > C1_CLOSED_AFTER_WAVE) return true;
  return Array.isArray(manifest.activeWaves) && !manifest.activeWaves.includes(job.wave);
}

/** The jobs a run of this manifest may start: none of waves 2-3, which gate C-1 amendment 7 cancelled. */
export function c1Scheduled(manifest) {
  return manifest.jobs.filter((job) => !c1Deferred(manifest, job));
}

/** Every route the jobs call is in Ollama Cloud's live catalog, and the allowance is open; nothing runs otherwise. */
export async function preflightC1(manifest, options = {}) {
  const refs = [
    ...new Set(
      manifest.jobs.flatMap((job) => [
        ...(job.kind === "write-side" ? [] : [`${job.provider}/${job.model}`]),
        ...(job.judges ? job.judges.split(",") : []),
        ...(job.simulator ? [job.simulator] : []),
        ...(job.decider ? [job.decider] : []),
      ]),
    ),
  ].sort();
  const foreign = refs.filter((ref) => !C1_ROUTES.has(ref));
  if (foreign.length) throw new Error(`C1Preflight: ${foreign.join(", ")} is not a gate C-1 route`);
  const list = options.list ?? (await import("@arnilo/prism-ai/ollama-cloud")).listOllamaCloudModels;
  const key = options.apiKey ?? process.env.OLLAMA_API_KEY;
  if (!key) throw new Error("C1Preflight: OLLAMA_API_KEY is unavailable");
  const catalog = await list({ apiKey: () => key, signal: AbortSignal.timeout(60_000) });
  const ids = new Set(catalog.map((model) => model.model));
  const missing = refs.filter((ref) => !ids.has(ref.slice(C1_PROVIDER.length + 1)));
  if (missing.length) throw new Error(`C1Preflight: ${missing.join(", ")} is not in the Ollama Cloud catalog`);
  const balance = await c1Balance({ fetch: options.fetch, apiKey: key, force: true });
  const record = { kind: "210-c1-paid-panel", checkedAt: new Date().toISOString(), refs, balance: balanceSummary(balance) };
  const gate = c1BudgetDecision(balance);
  if (gate.halt) throw new Error(`C1Preflight: ${gate.reason}`);
  if (!options.dryRun) {
    await mkdir(C1_EVIDENCE, { recursive: true });
    await writeFile(
      `${C1_EVIDENCE}/paid-panel${manifest.worker ? `-${manifest.worker}` : ""}.json`,
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }
  return record;
}

/** USD figures and window percentages only; never the key. */
function balanceSummary(balance) {
  return {
    includedUsd: balance.included?.balance_usd ?? null,
    allowanceUsd: balance.included?.allowance_usd ?? null,
    periodUntil: balance.included?.period?.until ?? null,
    purchasedUsd: balance.purchased?.balance_usd ?? null,
    session: balance.included?.session ?? null,
    weekly: balance.included?.weekly ?? null,
  };
}

let balanceCache = null;
/** `GET /api/balance` (10 a minute per user), cached for `C1_BUDGET.balanceTtlMs` across the campaign's jobs. */
export async function c1Balance({ fetch: fetchImpl = fetch, apiKey = process.env.OLLAMA_API_KEY, force = false, now = Date.now() } = {}) {
  if (!force && balanceCache && now - balanceCache.at < C1_BUDGET.balanceTtlMs) return balanceCache.value;
  const response = await fetchImpl("https://ollama.com/api/balance", {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`C1Balance: HTTP ${response.status}`);
  const value = await response.json();
  balanceCache = { at: now, value };
  return value;
}

/**
 * The allowance decision for one balance reply. A closed session or weekly window waits until its `resets_at`; a spent
 * allowance (included plus purchased under the reserve) halts the campaign, which resumes from its journal next period.
 */
export function c1BudgetDecision(balance, { now = Date.now(), budget = C1_BUDGET } = {}) {
  for (const name of ["session", "weekly"]) {
    const window = balance?.included?.[name];
    if (window && typeof window.remaining_percent === "number" && window.remaining_percent <= budget.windowFloorPercent) {
      const resetAt = Date.parse(window.resets_at);
      if (Number.isFinite(resetAt))
        return { wait: true, until: window.resets_at, waitMs: Math.max(60_000, resetAt - now + 120_000), reason: `${name} window closed` };
    }
  }
  const included = balance?.included?.balance_usd;
  const purchased = balance?.purchased?.balance_usd ?? 0;
  if (typeof included === "number" && included + purchased < budget.reserveUsd)
    return {
      halt: true,
      status: "budget-exhausted",
      reason: `allowance spent: $${(included + purchased).toFixed(2)} left under the $${budget.reserveUsd} reserve (resets ${balance.included?.period?.until ?? "next period"})`,
    };
  return { ok: true };
}

/** The campaign's per-job gate: waits out a closed window (only wall time), halts on a spent allowance. */
export async function c1BudgetGate(job, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), balance = c1Balance } = {}) {
  for (;;) {
    let decision;
    try {
      decision = c1BudgetDecision(await balance());
    } catch (error) {
      // An unreadable balance is an interruption, not a verdict: wait and read it again.
      console.error(`balance ${job.id}: ${error instanceof Error ? error.message : String(error)}; re-reading in 1 min`);
      await sleep(60_000);
      continue;
    }
    if (decision.wait) {
      console.error(`pause ${job.id}: ${decision.reason}; resuming after ${decision.until}`);
      await sleep(decision.waitMs);
      balanceCache = null;
      continue;
    }
    return decision.halt ? decision : null;
  }
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* The report (`acceptance-report.mjs --plan 210`). Ids, counts, scores and hashes only.                               */
/* ------------------------------------------------------------------------------------------------------------------ */

/** The latest attempt's report per job id: `<prefix>-<id>.json`, or `-<n>` for a later attempt. */
export async function loadC1Reports(dir = C1_EVIDENCE, prefix = `${C1_OUTPUT_PREFIX}-`) {
  const reports = new Map();
  if (!existsSync(dir)) return reports;
  for (const name of (await readdir(dir)).filter((file) => file.startsWith(prefix) && file.endsWith(".json"))) {
    const stem = name.slice(prefix.length, -".json".length);
    const match = /^(.*)-(\d+)$/.exec(stem);
    const id = match ? match[1] : stem;
    const attempt = match ? Number(match[2]) : 1;
    const previous = reports.get(id);
    if (!previous || attempt > previous.attempt) reports.set(id, { attempt, report: JSON.parse(await readFile(join(dir, name), "utf8")) });
  }
  return new Map([...reports].map(([id, value]) => [id, value.report]));
}

const scoredRows = (report) => (report?.results ?? []).filter((row) => row.outcome === "scored" && typeof row.correct === "boolean");
const round1 = (value) => (value === null || value === undefined ? null : Math.round(value * 1000) / 10);

/**
 * Pair two arms on identical items: the intersection of scored question ids (same model, suite and partition).
 * Returns the rows in matching order; a question scored in one arm only is reported as unpaired, never imputed.
 */
export function pairOnIdenticalItems(baseReport, armReport, suite) {
  const base = new Map(scoredRows(baseReport).map((row) => [row.id, row]));
  const arm = new Map(scoredRows(armReport).map((row) => [row.id, row]));
  const ids = [...base.keys()].filter((id) => arm.has(id)).sort();
  const tag = (row) => ({
    id: `${suite}:${row.id}`,
    cluster: `${suite}:${row.cluster ?? row.id}`,
    ability: row.ability,
    correct: row.correct,
  });
  return {
    ids,
    base: ids.map((id) => tag(base.get(id))),
    arm: ids.map((id) => tag(arm.get(id))),
    unpaired: { base: base.size - ids.length, arm: arm.size - ids.length },
  };
}

const p95 = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] : null;
};
const perQuestion = (report, key) => {
  const n = (report?.results ?? []).length;
  return n && Number.isFinite(report?.[key]) ? report[key] / n : null;
};

/** Paired effect of one arm against its base on one suite and model: accuracy (points), per-ability, cost and p95. */
export function c1PairEffect(baseReport, armReport, suite, { iterations = 4000 } = {}) {
  const pair = pairOnIdenticalItems(baseReport, armReport, suite);
  if (!pair.ids.length) return { suite, n: 0, status: "not-computable", unpaired: pair.unpaired };
  const all = pairedAnalysis(pair.base, pair.arm, { iterations });
  const abilities = {};
  for (const ability of [...new Set(pair.base.map((row) => row.ability))].sort()) {
    const a = pair.base.filter((row) => row.ability === ability);
    const b = pair.arm.filter((row) => row.ability === ability);
    const result = pairedAnalysis(a, b, { iterations });
    abilities[ability] = { n: result.n, diffPoints: round1(result.diff), ci95Points: result.ci95.map(round1) };
  }
  const latency = (report) => p95((report?.results ?? []).map((row) => row.phaseTiming?.answer));
  const relative = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && a > 0 ? (b - a) / a : null);
  return {
    suite,
    n: all.n,
    clusters: all.clusters,
    unpaired: pair.unpaired,
    baseCorrect: pair.base.filter((row) => row.correct).length,
    armCorrect: pair.arm.filter((row) => row.correct).length,
    diffPoints: round1(all.diff),
    ci95Points: all.ci95.map(round1),
    abilities,
    cost: {
      answerInputTokensPerQuestion: { base: perQuestion(baseReport, "inputTokens"), arm: perQuestion(armReport, "inputTokens") },
      injectedTokensPerQuestion: {
        base: perQuestion(baseReport, "injectedContextTokens"),
        arm: perQuestion(armReport, "injectedContextTokens"),
      },
      p95AnswerMs: { base: latency(baseReport), arm: latency(armReport) },
      relativeInputTokens: relative(perQuestion(baseReport, "inputTokens"), perQuestion(armReport, "inputTokens")),
      relativeP95: relative(latency(baseReport), latency(armReport)),
    },
  };
}

/** Feature orientation: the effect of having the feature, in points (loo: base - arm; add: arm - base). */
export function orientEffect(effect, mode) {
  if (!effect || effect.n === 0) return null;
  const flip = mode === "loo";
  const ci = flip ? [-effect.ci95Points[1], -effect.ci95Points[0]] : effect.ci95Points;
  return {
    suite: effect.suite,
    n: effect.n,
    pointsWithFeature: flip ? -effect.diffPoints : effect.diffPoints,
    ci95Points: ci,
    abilities: Object.fromEntries(
      Object.entries(effect.abilities).map(([ability, row]) => [
        ability,
        { n: row.n, ci95Points: flip ? [-row.ci95Points[1], -row.ci95Points[0]] : row.ci95Points },
      ]),
    ),
  };
}

/**
 * Score one Task 3 prediction from the measured effects, on its stated accuracy magnitude. The machine-readable form
 * is `C1_PREDICTION_RULES`; a prediction on a metric the reports do not carry is `not-scored` with the reason, never a
 * hit. `hit` needs every answer model's point estimate to meet the stated direction and magnitude.
 */
export function scorePrediction(rule, effectsByModel) {
  if (!rule) return { outcome: "not-scored", reason: "no machine-readable rule" };
  if (rule.notScored) return { outcome: "not-scored", reason: rule.notScored };
  const models = Object.entries(effectsByModel ?? {});
  if (!models.length) return { outcome: "not-scored", reason: "arm not measured" };
  const perModel = {};
  for (const [model, effects] of models) {
    const rows = (effects ?? []).filter((row) => row && (!rule.suites || rule.suites.includes(row.suite)));
    if (!rows.length || rows.length < (rule.suites?.length ?? 1)) {
      perModel[model] = { outcome: "incomplete" };
      continue;
    }
    const checks = rows.map((row) => {
      const value = row.pointsWithFeature;
      if (rule.kind === "gain") return value >= rule.points;
      if (rule.kind === "null") return Math.abs(value) <= rule.points;
      if (rule.kind === "non-inferior") return row.ci95Points[0] > -rule.points;
      if (rule.kind === "any-gain") return value >= rule.points;
      throw new Error(`C1Prediction: unknown rule kind ${rule.kind}`);
    });
    const hit = rule.kind === "any-gain" ? checks.some(Boolean) : checks.every(Boolean);
    perModel[model] = { outcome: hit ? "hit" : "miss", suites: rows.map((row) => ({ suite: row.suite, points: row.pointsWithFeature })) };
  }
  const outcomes = Object.values(perModel).map((row) => row.outcome);
  const outcome = outcomes.includes("incomplete") ? "incomplete" : outcomes.every((value) => value === "hit") ? "hit" : "miss";
  return { outcome, perModel, rule };
}

/**
 * The accuracy part of each Task 3 prediction, transcribed from `gap-predictions.json` (`predicted` text) before any
 * Task 5 run. Points are percentage points with the feature on; questions are converted at the suite's dev size
 * (LoCoMo 60, BEAM-100K 40). Parts on metrics no report carries (irrelevant share, W rows, curator calls, offline
 * growth) are scored by their own instruments or recorded `not-scored`.
 */
export const C1_PREDICTION_RULES = Object.freeze({
  "memory-off": { kind: "gain", points: 15, suites: ["locomo", "longmemeval-m"] },
  "strength-0.15": { kind: "gain", points: 3, suites: ["longmemeval-m"], note: "knowledge-update stratum; scored on the suite total" },
  "tool-affordances-loo": { kind: "null", points: 1.7, suites: ["locomo", "beam-100k"], note: "+-1 question (1.7 / 2.5 points)" },
  "supersession-keyed-only": { kind: "null", points: 1.7, suites: ["locomo"] },
  expansion: { kind: "non-inferior", points: 2, suites: ["locomo"], note: "never-candidate count 4 -> <= 2 is scored from stages" },
  gather: { kind: "gain", points: 1.7, suites: ["locomo"], note: "multi-hop 3 -> 4 of 12; scored on the suite" },
  "enrichment-loo": { notScored: "candidate-gap rule; scored by plan 202 Task 5's frozen rules (plan202Task5 rows)" },
  "navigation-loo": { notScored: "candidate-gap rule; scored by plan 202 Task 5's frozen rules (plan202Task5 rows)" },
  "timeline-loo": { kind: "gain", points: 5, suites: ["longmemeval-m"], note: "temporal stratum; scored on the suite total" },
  "grouping-loo": { kind: "gain", points: 3, suites: ["longmemeval-m"], note: "knowledge-update stratum; scored on the suite total" },
  "archive-exchange-exempt": { kind: "gain", points: 2, suites: ["beam-100k"] },
  "exchange-tier-off": { notScored: "offline growth-stream instrument (growth.mjs)" },
  "tools-only": { kind: "any-gain", points: 3, suites: ["locomo", "beam-100k", "longmemeval-m"] },
  "card-excerpt": { kind: "gain", points: 1.7, suites: ["locomo"] },
  "precision-filter": { kind: "non-inferior", points: 2, suites: ["locomo", "beam-100k"] },
  "aggregation-loo": {
    kind: "gain",
    points: 0,
    suites: ["beam-100k", "locomo"],
    note: "abstention and answer-gap targets; scored on accuracy direction",
  },
  "directory-loo": { kind: "null", points: 2, suites: ["locomo", "longmemeval-m"] },
  "rules-loo": { kind: "gain", points: 2.5, suites: ["beam-100k"], note: "add-one on conversational; W2 part scored from the work leg" },
  "decisions-p3": {
    kind: "gain",
    points: 1,
    suites: ["beam-100k", "locomo"],
    note: "accuracy part; the irrelevant-share part is read from injections",
  },
  "decisions-p4": { notScored: "injected tokens and W6 (work leg)" },
  "decisions-p5": { kind: "gain", points: 2.5, suites: ["beam-100k"], note: "abstention +1 of 4 on 40 questions; scored on the suite" },
  "w-steps-loo": { notScored: "W1 (work leg)" },
  "lessons-loo": { notScored: "W1 (work leg)" },
  "trigger-co-read-loo": { kind: "non-inferior", points: 5, suites: C1_ONTOLOGY_SUITES, note: "with the trigger removed" },
  "trigger-accumulation-loo": { kind: "non-inferior", points: 5, suites: C1_ONTOLOGY_SUITES, note: "with the trigger removed" },
  "concept-prior-loo": { kind: "gain", points: 3, suites: C1_ONTOLOGY_SUITES },
  "concept-pointer-loo": { kind: "gain", points: 2, suites: C1_ONTOLOGY_SUITES },
  "om-reflector-loo": { kind: "gain", points: 2, suites: ["beam-1m"] },
  "om-dropper-deterministic": { kind: "non-inferior", points: 2, suites: ["beam-1m"] },
});

/** W rows of a work leg: `without` (feature removed) against `with`, at the cleanup criteria's margins. */
export function c1WorkNonInferiority(withRows, withoutRows) {
  const margins = CLEANUP_CRITERIA.rules.remove.nonInferior.workOutcome;
  const checks = margins.rows.map((metric) => {
    const result = comparePaired(withRows, withoutRows, metric);
    const margin = metric === "W4" ? margins.W4.relativeIncreaseAtMost * (result.baseMean ?? 0) : margins.points / 100;
    return {
      metric,
      n: result.n,
      improvement: result.improvement,
      ci95: result.ci95,
      margin,
      pass: result.ci95 ? result.ci95[0] > -margin : null,
    };
  });
  return {
    checks,
    nonInferior: checks.every((check) => check.pass === true) ? true : checks.some((check) => check.pass === false) ? false : null,
  };
}

/**
 * Build the per-feature evidence `cleanupVerdict()` reads, and the verdict itself. Nothing here sets a verdict by hand.
 * `inputs.robustness[model][arm][suite]` are oriented effects; `inputs.work[model][arm]` are work non-inferiority rows;
 * `inputs.task5Pass[feature]` is plan 202 Task 5's frozen-rule pass (true/false/undefined).
 */
export function c1FeatureEvidence(feature, { arms, ledgerRow, prediction, robustness, work, task5Pass }) {
  const models = C1_MODELS.map((model) => model.key);
  const effects = models.flatMap((model) =>
    arms.flatMap((arm) => Object.values(robustness?.[model]?.[arm.id] ?? {}).map((row) => ({ model, arm, row }))),
  );
  const abilities = effects.flatMap(({ row }) => [
    { ciHigh: row.ci95Points[1] },
    ...Object.values(row.abilities).map((ability) => ({ ciHigh: ability.ci95Points[1] })),
  ]);
  const looOrReference = arms.filter((arm) => arm.mode === "loo");
  const addArms = arms.filter((arm) => arm.mode === "add");
  const realFix = prediction && !/^as-is/.test(prediction.change ?? "") && addArms.length > 0;
  const benefit = models.map((model) => {
    const rows = effects.filter((item) => item.model === model).map((item) => item.row.ci95Points[0]);
    return { model, ciLow: rows.length ? Math.max(...rows) : null };
  });
  const evidence = {
    feature,
    status: ledgerRow?.status ?? "unmeasured",
    abilities,
    benefit: realFix ? [] : benefit.filter((row) => row.ciLow !== null),
    plan202Task5Pass: task5Pass,
    fix: realFix
      ? (() => {
          const rows = effects.filter((item) => item.arm.mode === "add").map((item) => item.row);
          if (!rows.length) return { real: true, measured: false };
          const ciLow = Math.max(...rows.map((row) => row.ci95Points[0]));
          return { real: true, measured: true, directionMet: rows.some((row) => row.pointsWithFeature > 0), ciLow };
        })()
      : null,
    removal: (() => {
      // Removing a default-off feature leaves the shipped configurations unchanged: non-inferior by construction on
      // the work rows. Removing a member needs its work leg, or stays unproven.
      const suites = effects.map((item) => ({ suite: item.row.suite, model: item.model, ciLow: -item.row.ci95Points[1] }));
      const workRows = models.flatMap((model) => arms.map((arm) => work?.[model]?.[arm.id]).filter(Boolean));
      const workOutcomeNonInferior =
        looOrReference.length === 0 ? true : workRows.length ? workRows.every((row) => row.nonInferior === true) : null;
      return effects.length ? { suites, workOutcomeNonInferior } : null;
    })(),
  };
  return { evidence, verdict: cleanupVerdict(evidence) };
}

export function buildC1Report({ reports: allReports, manifest, ledger, predictions }) {
  const pin = cleanupManifestPin();
  // Gate C-1 amendment 7: the report reads wave 1 only. A job outside it is never read, whatever files exist.
  const waveOfJob = new Map((manifest?.jobs ?? []).map((job) => [job.id, job.wave]));
  const reports = new Map([...allReports].filter(([id]) => (waveOfJob.get(id) ?? 1) <= C1_CLOSED_AFTER_WAVE));
  const cancelledArms = CLEANUP_CRITERIA.closure.cancelledArms;
  const transferredRows = new Map(CLEANUP_CRITERIA.transferred.features.map((row) => [row.feature, row]));
  const models = C1_MODELS.map((model) => model.key);
  const arms = [...C1_ROBUSTNESS_ARMS, ...C1_ONTOLOGY_ARMS];
  const robustness = {};
  const raw = {};
  const jobStatus = {};
  for (const [id, report] of reports) jobStatus[id] = report?.status ?? null;
  for (const model of models) {
    robustness[model] = {};
    raw[model] = {};
    for (const arm of arms) {
      if (!arm.base) continue;
      const suites = arm.suites ?? C1_ONTOLOGY_SUITES;
      for (const suite of suites) {
        const base = reports.get(`210-c1.${model}.${arm.base}.${suite}`);
        const variant = reports.get(`210-c1.${model}.${arm.id}.${suite}`);
        if (base?.status !== "completed" || variant?.status !== "completed") continue;
        const effect = c1PairEffect(base, variant, suite);
        raw[model][arm.id] ??= {};
        raw[model][arm.id][suite] = effect;
        robustness[model][arm.id] ??= {};
        robustness[model][arm.id][suite] = orientEffect(effect, arm.mode === "leg" ? "add" : arm.mode);
      }
    }
  }
  // Work legs: W rows of each overlay against its base, per model.
  const work = {};
  for (const model of models) {
    work[model] = {};
    for (const arm of C1_WORK_ARMS) {
      if (!arm.base) continue;
      const base = reports.get(`210-c1.${model}.${arm.base}`);
      const variant = reports.get(`210-c1.${model}.${arm.id}`);
      if (base?.status !== "completed" || variant?.status !== "completed") continue;
      const rowsOf = (job) => job.report.rows[job.arm];
      const withRows = arm.mode === "loo" ? rowsOf(base) : rowsOf(variant);
      const withoutRows = arm.mode === "loo" ? rowsOf(variant) : rowsOf(base);
      work[model][arm.id] = c1WorkNonInferiority(withRows, withoutRows);
    }
  }
  // Plan 202 Task 5's frozen rules on the deferred arms (feature off = control, P = candidate).
  const task5 = buildTask5Rows(reports);
  // The F4 diagnostic leg, per suite x model.
  const f4Rows = models.flatMap((model) =>
    ["beam-100k", "locomo", "longmemeval-m"].map((suite) =>
      f4LegRow({
        suite,
        model,
        partition: C1_PARTITION,
        readTime: reports.get(`210-c1.${model}.f4-readtime.${suite}`),
        oracle: reports.get(`210-c1.${model}.oracle.${suite}`),
      }),
    ),
  );
  // Predictions, scored.
  const scored = (predictions ?? [])
    .filter((prediction) => prediction.verdict === "fix-and-measure")
    .map((prediction) => {
      const target = C1_PREDICTION_ARMS[prediction.arm];
      const armIds = [target].flat();
      // A cancelled arm is never a miss: it is reported `cancelled` with its disposition.
      if (armIds.every((id) => cancelledArms[id]))
        return {
          feature: prediction.feature,
          arm: prediction.arm,
          outcome: "cancelled",
          disposition: armIds.map((id) => ({ arm: id, ...cancelledArms[id] })),
        };
      const effectsByModel = Object.fromEntries(
        models.map((model) => [model, armIds.flatMap((armId) => Object.values(robustness[model]?.[armId] ?? {}))]),
      );
      return { feature: prediction.feature, arm: prediction.arm, ...scorePrediction(C1_PREDICTION_RULES[prediction.arm], effectsByModel) };
    });
  // Verdicts per candidate feature, from cleanupVerdict() only.
  const candidates = (ledger?.features ?? []).filter((row) => row.candidate);
  const verdicts = candidates.map((row) => {
    const allFeatureArms = [...arms, ...C1_WORK_ARMS].filter((arm) => (arm.features ?? []).some((name) => name.split("#")[0] === row.id));
    const featureArms = allFeatureArms.filter((arm) => !cancelledArms[arm.id]);
    const prediction = (predictions ?? []).find((item) => item.feature === row.id && item.verdict === "fix-and-measure");
    const transfer = transferredRows.get(row.id);
    if (transfer)
      return {
        feature: row.id,
        measured: false,
        cells: 0,
        verdict: "transferred",
        plan: transfer.plan,
        reason: `transferred -> plan ${transfer.plan}: ${transfer.reason}`,
      };
    if (!featureArms.length && allFeatureArms.length)
      return {
        feature: row.id,
        measured: false,
        cells: 0,
        verdict: null,
        status: "unmeasured",
        cancelled: allFeatureArms.map((arm) => ({ arm: arm.id, ...cancelledArms[arm.id] })),
        reason: "unmeasured: every arm of this feature was in a wave gate C-1 cancelled on 2026-11-08",
      };
    if (C1_UNMEASURABLE[row.id])
      return { feature: row.id, measured: false, cells: 0, verdict: null, reason: `unmeasurable under C-1: ${C1_UNMEASURABLE[row.id]}` };
    if (!featureArms.length)
      return {
        feature: row.id,
        measured: false,
        cells: 0,
        verdict: null,
        reason: "no C-1 arm (inert removal, measure-elsewhere or offline)",
      };
    const { evidence, verdict } = c1FeatureEvidence(row.id, {
      arms: featureArms,
      ledgerRow: row,
      prediction,
      robustness,
      work,
      task5Pass: task5.pass[row.id],
    });
    // `cells`: paired suite x model effects behind the verdict; 0 means the arms have not completed yet.
    const cells = evidence.removal?.suites.length ?? 0;
    return { feature: row.id, measured: cells > 0, cells, arms: featureArms.map((arm) => arm.id), evidence, ...verdict };
  });
  const verdictOf = new Map(verdicts.map((row) => [row.feature, row]));
  // The plan 202 closure rows: scored here only where wave 1 measured the row's features.
  const plan202Closure = (ledger?.closure202?.rows ?? []).map((row) => {
    const features = row.features ?? [];
    const scored = features.filter((id) => verdictOf.get(id)?.measured);
    const moved = features.filter((id) => transferredRows.has(id));
    const status = !features.length
      ? "unverified"
      : scored.length === features.length
        ? "scored"
        : scored.length
          ? "partial"
          : moved.length === features.length
            ? "transferred"
            : "unverified";
    return { sourceTask: row.sourceTask, title: row.title, features, status, scored, ...(moved.length ? { transferred: moved } : {}) };
  });
  return {
    kind: "210-c1-report",
    plan: C1_PLAN,
    task: C1_TASK,
    partition: C1_PARTITION,
    closure: { afterWave: C1_CLOSED_AFTER_WAVE, decided: CLEANUP_CRITERIA.closure.decided, by: CLEANUP_CRITERIA.closure.by },
    ...pin,
    manifestHash: manifest?.manifestHash ?? null,
    productHash: manifest?.productHash ?? null,
    note: "Development evidence only. Every effect is paired on identical question ids; the verdict per feature is cleanupVerdict()'s, never hand-set.",
    jobs: { read: [...reports.keys()].sort(), status: jobStatus },
    effects: raw,
    oriented: robustness,
    work,
    plan202Task5: task5,
    f4: { rows: f4Rows, disposition: f4Disposition(f4Rows), moved: "plan 219 Task 7 (amendment 7)" },
    predictions: scored,
    verdicts,
    plan202Closure,
    cancelled: Object.entries(cancelledArms).map(([arm, row]) => ({ arm, ...row, outcome: "cancelled" })),
    transferred: [...transferredRows.values()].map((row) => ({ ...row, verdict: "transferred" })),
  };
}

/** Plan 202 Task 5's frozen candidate-gap halving and ability veto on the enrichment-off and navigation-off arms. */
export function buildTask5Rows(reports, rules = null) {
  const rows = [];
  const pass = {};
  const fns = rules ?? task5Fns;
  if (!fns) return { rows, pass, note: "task5 rule functions not loaded" };
  for (const arm of C1_ROBUSTNESS_ARMS.filter((item) => item.task5)) {
    const feature = arm.features[0];
    let all = true;
    for (const model of C1_MODELS.map((item) => item.key))
      for (const suite of arm.suites) {
        const control = reports.get(`210-c1.${model}.${arm.id}.${suite}`);
        const candidate = reports.get(`210-c1.${model}.P.${suite}`);
        if (control?.status !== "completed" || candidate?.status !== "completed") {
          rows.push({ feature, model, suite, status: "unverified" });
          all = false;
          continue;
        }
        const gap = fns.task5CandidateGap(control.results ?? [], candidate.results ?? [], { suite });
        const guard = fns.task5AbilityGuard(control.results ?? [], candidate.results ?? [], { descriptive: false });
        // The frozen veto: any regressed stratum or any unverified (missing) stratum blocks.
        const vetoed = guard.passed !== true;
        rows.push({ feature, model, suite, candidateGap: gap, abilityGuard: guard, vetoed });
        if (gap.verdict !== "pass" || vetoed) all = false;
      }
    pass[feature] = all;
  }
  return { rows, pass };
}

/**
 * The F4 diagnostic leg (cleanup-criteria `preRegistered.f4DiagnosticLeg`): which abilities count as state or
 * aggregation, per suite vocabulary. Fixed before any leg result.
 */
export const C1_F4_ABILITIES = Object.freeze({
  state: ["knowledge-update", "knowledge_update", "contradiction_resolution", "temporal-reasoning", "temporal"],
  aggregation: ["multi-session", "multi_session_reasoning", "multi-hop", "summarization", "event_ordering"],
});

/**
 * Apply the pre-registered F4 rule to one suite x model: a failure counts toward extraction only if the oracle answers
 * it, the read-time arm does not, the read-time report's evidenceCounts show the gold evidence delivered or a candidate,
 * the ability is state or aggregation, and the id is unique. Incomplete attribution (a missing arm, a row without
 * evidenceCounts) is `unmeasured`, never `not-needed`. A held-out partition can never trigger the build.
 */
export function f4LegRow({ suite, model, partition, readTime, oracle }) {
  if (partition !== C1_PARTITION)
    throw new Error("C1F4: the diagnostic leg reads development partitions only; held-out data cannot trigger it");
  const leg = CLEANUP_CRITERIA.preRegistered.f4DiagnosticLeg;
  if (readTime?.status !== "completed" || oracle?.status !== "completed")
    return { suite, model, disposition: "unmeasured", reason: "leg incomplete" };
  const read = new Map(scoredRows(readTime).map((row) => [row.id, row]));
  const gold = new Map(scoredRows(oracle).map((row) => [row.id, row]));
  const ids = [...read.keys()].filter((id) => gold.has(id)).sort();
  if (!ids.length) return { suite, model, disposition: "unmeasured", reason: "no paired questions" };
  const abilities = new Set([...C1_F4_ABILITIES.state, ...C1_F4_ABILITIES.aggregation]);
  const failures = ids.filter((id) => gold.get(id).correct && !read.get(id).correct);
  const missingAttribution = failures.filter((id) => !read.get(id).evidenceCounts);
  if (missingAttribution.length)
    return { suite, model, disposition: "unmeasured", reason: "incomplete attribution", missing: missingAttribution.length };
  const qualifying = [
    ...new Set(
      failures.filter((id) => {
        const counts = read.get(id).evidenceCounts;
        const delivered = (counts.selectedGold ?? 0) > 0 || (counts.candidateGold ?? 0) > 0;
        return delivered && abilities.has(read.get(id).ability);
      }),
    ),
  ];
  const share = qualifying.length / ids.length;
  return {
    suite,
    model,
    paired: ids.length,
    oracleOnlyFailures: failures.length,
    irrecoverable: qualifying.length,
    share,
    disposition: share >= leg.thresholdShare ? "fix-and-measure" : "not-needed",
  };
}

/** The leg's overall disposition: any suite x model at or above 5% opens the original Task 17 remedy; any gap keeps it unmeasured. */
export function f4Disposition(rows) {
  if (!rows.length || rows.some((row) => row.disposition === "unmeasured")) return "unmeasured";
  return rows.some((row) => row.disposition === "fix-and-measure") ? "fix-and-measure" : "not-needed";
}

/**
 * The conversational-facts arm may be built only after a qualifying development diagnosis, and only with plan 202
 * Task 17's original bars written down first (cleanup-criteria `preRegistered.f4DiagnosticLeg.originalBars`).
 */
export const C1_F4_ORIGINAL_BARS = Object.freeze([
  "exchange-citations",
  "scope-consent-inheritance",
  "conversational-unchanged",
  "session-failures-at-most-2pct",
  "cheap-model-write-cost-per-session-and-per-1k-exchanges",
  "product-extract-cache-read-write-tokens-and-costs",
  "target-ability-benefit",
  "no-regression",
]);
export function assertF4BuildAllowed({ disposition, partition, bars }) {
  if (partition !== C1_PARTITION) throw new Error("C1F4: held-out evidence cannot trigger the facts build");
  if (disposition !== "fix-and-measure")
    throw new Error(`C1F4: the facts arm needs a measured >= 5% diagnosis (disposition ${disposition})`);
  const missing = C1_F4_ORIGINAL_BARS.filter((bar) => !(bars ?? []).includes(bar));
  if (missing.length) throw new Error(`C1F4: the facts arm lacks the original Task 17 bars: ${missing.join(", ")}`);
  return true;
}

let task5Fns = null;
/** Load plan 202 Task 5's rule functions (kept lazy: the module pulls in the git and manifest tooling). */
export async function loadTask5Rules() {
  const module = await import("./task5-comparison.mjs");
  task5Fns = { task5CandidateGap: module.task5CandidateGap, task5AbilityGuard: module.task5AbilityGuard };
  return task5Fns;
}

export async function writeC1Report({ partition, root = "." } = {}) {
  assertC1Partition(partition);
  await loadTask5Rules();
  const reports = await loadC1Reports(join(root, C1_EVIDENCE));
  const manifestPath = join(root, C1_MANIFEST);
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : null;
  const ledger = JSON.parse(await readFile(join(root, "docs/_evidence/memory-bench/210/feature-ledger.json"), "utf8"));
  const predictions = JSON.parse(await readFile(join(root, C1_GAP_PREDICTIONS), "utf8")).predictions;
  const report = buildC1Report({ reports, manifest, ledger, predictions });
  await mkdir(join(root, C1_EVIDENCE), { recursive: true });
  await writeFile(join(root, C1_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
