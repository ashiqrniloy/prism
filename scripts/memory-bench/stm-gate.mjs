/**
 * Plan 217 Task 6: gate M-1, live STM efficacy against the pre-redesign observer (rows S1-S4 of
 * `memory-model-criteria.json`).
 *
 * Arms, on the development partition only:
 * - `STM`: this tree's `om` config (the `session` profile: STM with the plan-216 reflector and dropper), so the
 *   comparison isolates the encoder;
 * - `OM-before`: the pinned pre-216 revision (`baselines.json` `omBefore.revision`), run from its own worktree
 *   (`.cache/memory-bench/216/om-before`) with the same `om` config and `PRISM_MEMORY_BENCH_SOURCE` set to that
 *   revision; the long-session family's harness files are copied in (the `acceptance.mjs` harness-copy pattern);
 * - `memory-off`: no memory package (`none` on the suites; the kernel's own compaction on the family).
 *
 * Suites: `beam-1m` and `longmemeval-m` (S3 accuracy, S4 worker tokens) and the live `long-session` family (S1
 * re-derivations, S4). S2 is the offline probe of Task 5 (`217/stm-probes.json`). Every arm is paired with
 * `OM-before` on identical items: the same question ids (or personas), answer model, judges and flags.
 *
 * Machinery: `campaign.mjs --plan memory-model --gate M-1` (journal, source pin, retries that cost only wall time,
 * the Ollama allowance guard), `acceptance-report.mjs --plan memory-model --gate M-1 --build` (verdicts). The run
 * starts only on the owner's word: `217/gates/owner-gate-m1.json` must say `approved: true` and bind this manifest.
 * Evidence carries ids, counts, scores and hashes only.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileFingerprint, sourceFingerprint } from "./acceptance.mjs";
import { C1_PROVIDER, c1Balance, c1BudgetDecision, c1BudgetGate, pairOnIdenticalItems, refOf } from "./cleanup-campaign.mjs";
import { stableHash } from "./journal.mjs";
import {
  assertMemoryModelFixture,
  assertMemoryModelPin,
  MEMORY_MODEL_CRITERIA,
  memoryModelGateVerdict,
  memoryModelManifestPin,
  ROBUSTNESS_DRAWS,
} from "./robustness.mjs";
import { pairedAnalysis, pairedClusterPermutation } from "./stats.mjs";

export const M1_PLAN = 217;
export const M1_TASK = 6;
export const M1_GATE_ID = "M-1";
export const M1_PARTITION = "dev";
export const M1_EVIDENCE = "docs/_evidence/memory-bench/217";
export const M1_RUNS = `${M1_EVIDENCE}/runs`;
export const M1_GATE = `${M1_EVIDENCE}/gates/owner-gate-m1.json`;
export const M1_DIR = "docs/_evidence/memory-bench/memory-model/M-1";
export const M1_MANIFEST = `${M1_DIR}/manifest.json`;
export const M1_EXECUTION_MANIFEST = `${M1_RUNS}/execution-manifest.json`;
export const M1_PROBES = `${M1_EVIDENCE}/stm-probes.json`;
export const M1_JUSTIFICATION = `${M1_EVIDENCE}/s4-justification.md`;
export const M1_CACHE = ".cache/memory-bench/217";
export const M1_JOURNAL = `${M1_CACHE}/journal.json`;
export const M1_OUTPUT_PREFIX = "run-217-m1";
export const M1_BASELINES = "docs/_evidence/memory-bench/memory-model/baselines.json";
export const M1_WORKTREE = ".cache/memory-bench/216/om-before";
export const M1_SUITES = Object.freeze(["longmemeval-m", "beam-1m"]);
export const M1_FAMILY = "long-session";
/**
 * The models (owner, 2026-11-09, gate M-1 start word: "You can use ollama cloud for testing with gemma4:31b,
 * GPT-OSS-120B, Mimo-2.6-flash, deepseek-v4.1-flash"). DeepSeek V4.1 Flash answers as the large model and MiMo V2.6
 * Flash as the small one; the two judges keep gate C-1's families and never answer. Each arm's worker is its answer model.
 */
export const M1_MODELS = Object.freeze([
  { key: "large", provider: C1_PROVIDER, model: "deepseek-v4.1-flash", family: "deepseek", small: false },
  { key: "small", provider: C1_PROVIDER, model: "mimo-v2.6-flash", family: "mimo", small: true },
]);
/**
 * The S1 replication models (owner, 2026-11-11: "Let's run on two different models from ollama cloud now. GLM-5.3-flash
 * and Minimax m3.1 flash. And see what happens to S1"): the long-session family only, all three arms, sitting 5. Their
 * S1 and family S4 cells are reported beside the gate rows (`evidence.replication`); the M-1 verdicts stay on M1_MODELS.
 */
export const M1_REPLICATION_MODELS = Object.freeze([
  { key: "glm", provider: C1_PROVIDER, model: "glm-5.3-flash", family: "glm", small: false },
  { key: "minimax", provider: C1_PROVIDER, model: "minimax-m3.1-flash", family: "minimax", small: true },
]);
/** Every answer route the gate may call: the gate models and the replication models. */
export const M1_ANSWER_MODELS = Object.freeze([...M1_MODELS, ...M1_REPLICATION_MODELS]);
export const M1_JUDGES = Object.freeze([`${C1_PROVIDER}/gpt-oss:120b`, `${C1_PROVIDER}/gemma4:31b`]);
/** Arms: the config each runs and the tree it runs from. */
export const M1_ARMS = Object.freeze([
  { id: "memory-off", config: "none", tree: "current" },
  { id: "STM", config: "om", tree: "current" },
  { id: "OM-before", config: "om", tree: "om-before" },
]);
/** The worker arms S3 and S4 compare; `memory-off` is a reference only. */
export const M1_WORKER_ARMS = Object.freeze(["STM", "OM-before"]);
/** This tree's product: the session tiers' package, the store library and the kernel. */
export const M1_PRODUCT_PATHS = Object.freeze(["packages/memory/system/src", "packages/memory/core/src", "src"]);
/** The harness both trees run. Its fingerprint is in the manifest, so a harness edit is a new manifest, not a re-approval. */
export const M1_HARNESS_PATHS = Object.freeze([
  "scripts/memory-bench/replay.mjs",
  "scripts/memory-bench/run.mjs",
  "scripts/memory-bench/datasets.mjs",
  "scripts/memory-bench/chunk-meter.mjs",
  "scripts/memory-bench/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session-live.mjs",
  "scripts/memory-bench/work-outcome-long-session.json",
]);
/**
 * The family's files the OM-before worktree needs. Nothing under the pinned product paths: the product hash of the
 * worktree is checked after the copy.
 */
export const M1_WORKTREE_COPY = Object.freeze([
  "scripts/memory-bench/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session-live.mjs",
  "scripts/memory-bench/work-outcome-long-session.json",
  "scripts/memory-bench/fixtures/memory-model/long-session",
]);
/**
 * Per-job caps (the owner chose the full development cohort, 2026-11-09). The worker arms re-observe the whole history
 * per question (C-1 smoke: about 10M input tokens a BEAM-1M question; LongMemEval-M estimated at 5M), so their caps
 * hold the full cohort with room; the allowance guard bounds money.
 */
export const M1_CAPS = Object.freeze({
  maxInputTokens: { "beam-1m": 600_000_000, "longmemeval-m": 400_000_000, "memory-off": 25_000_000, "long-session": 30_000_000 },
  wallTimeCapHours: { worker: 120, "memory-off": 24, "long-session": 24 },
  concurrency: 2,
  maxOutputTokens: 8192,
});
/** The planning estimate stated in the gate record (not a cap): tokens per question and the billed rate. */
export const M1_ESTIMATE = Object.freeze({
  tokensPerQuestion: { "beam-1m": 10_000_000, "longmemeval-m": 5_000_000 },
  longSessionTokensPerJob: 2_000_000,
  usdPerMillion: 0.0585,
  rateSource: "Ollama /api/usage, 2026-11-09 (the smoke and the diagnostics): $1.57 for 26.8M input tokens, output included",
});
export const M1_CEILING = 1_000_000_000_000;

/** The development question ids of a suite (the committed draw). */
export const m1DevIds = (suite) => Object.values(ROBUSTNESS_DRAWS[suite].abilities.dev).flat();

export function assertM1Partition(partition) {
  if (partition !== M1_PARTITION)
    throw new Error(
      `M1Partition: gate M-1 reads the ${M1_PARTITION} partition only; ${partition ?? "(none)"} belongs to gate A (plan 223)`,
    );
  return partition;
}

const safe = (value) => value.replace(/[^A-Za-z0-9.+_-]/g, "_");

/** One robustness job (`run.mjs`); `OM-before` runs from the worktree. Ids: `217-m1.<model>.<arm>.<suite>`. */
export function m1RobustnessJob(model, arm, suite, { worktree = M1_WORKTREE } = {}) {
  const worker = arm.config === "om";
  return {
    id: `217-m1.${model.key}.${arm.id}.${suite}`,
    kind: "robustness",
    family: `217-m1.${model.key}.${suite}`,
    role: arm.id,
    arm: arm.id,
    model_key: model.key,
    suite,
    subset: M1_PARTITION,
    config: arm.config,
    provider: model.provider,
    model: model.model,
    judges: M1_JUDGES.join(","),
    judgeText: true,
    labelInjections: "off",
    maxInputTokens: worker ? M1_CAPS.maxInputTokens[suite] : M1_CAPS.maxInputTokens["memory-off"],
    maxOutputTokens: M1_CAPS.maxOutputTokens,
    concurrency: M1_CAPS.concurrency,
    wallTimeCapHours: worker ? M1_CAPS.wallTimeCapHours.worker : M1_CAPS.wallTimeCapHours["memory-off"],
    finalTurnAnswer: true,
    interleaveAbilities: true,
    strictQuestions: true,
    // A paired comparison never shares answer or judge checkpoints between its arms.
    answersDir: `${M1_CACHE}/${model.key}/${safe(arm.id)}/${suite}/answers`,
    judgeCacheDir: `${M1_CACHE}/${model.key}/${safe(arm.id)}/${suite}/judge`,
    ...(arm.tree === "om-before" ? { cwd: worktree } : {}),
  };
}

/** One live long-session job (`work-outcome/long-session-live.mjs`). Ids: `217-m1.<model>.<arm>.long-session`. */
export function m1LongSessionJob(model, arm, { worktree = M1_WORKTREE } = {}) {
  return {
    id: `217-m1.${model.key}.${arm.id}.${M1_FAMILY}`,
    kind: "long-session",
    family: `217-m1.${model.key}.${M1_FAMILY}`,
    role: arm.id,
    arm: arm.id,
    model_key: model.key,
    suite: M1_FAMILY,
    subset: M1_PARTITION,
    provider: model.provider,
    model: model.model,
    maxInputTokens: M1_CAPS.maxInputTokens["long-session"],
    wallTimeCapHours: M1_CAPS.wallTimeCapHours["long-session"],
    stateDir: `${M1_CACHE}/long-session`,
    ...(arm.tree === "om-before" ? { cwd: worktree } : {}),
  };
}

/**
 * The S4 sample of the suites (owner, 2026-11-10: S3 deferred to gate A, runs 1-4): the first questions of each
 * suite's development cohort in its frozen ability-interleaved order, the same ids for every arm. Every question
 * replays a whole 1-1.2M-token history, so the worker-token ratio per question is measured on full histories.
 */
export const M1_S4_SAMPLE_QUESTIONS = 2;
/**
 * The runs (sittings) of 2-3 hours each. Run 1 is the long-session family (S1 and the family's S4 cell); runs 2-4 hold
 * the eight suite jobs, three at a time (`--parallel-arms 3`, concurrency 1: the account's three concurrent requests).
 */
export const M1_SITTINGS = Object.freeze({
  1: [
    "small.memory-off.long-session",
    "small.STM.long-session",
    "small.OM-before.long-session",
    "large.memory-off.long-session",
    "large.STM.long-session",
    "large.OM-before.long-session",
  ],
  2: ["small.STM.longmemeval-m", "small.OM-before.longmemeval-m", "small.STM.beam-1m"],
  3: ["small.OM-before.beam-1m", "large.STM.longmemeval-m", "large.OM-before.longmemeval-m"],
  4: ["large.STM.beam-1m", "large.OM-before.beam-1m"],
  5: M1_REPLICATION_MODELS.flatMap((model) => M1_ARMS.map((arm) => `${model.key}.${arm.id}.${M1_FAMILY}`)),
});

/**
 * The job list, in run order: the family (three arms per model, full dev partition), then the S4 suite sample (STM and
 * OM-before per model and suite, `M1_S4_SAMPLE_QUESTIONS` each). memory-off runs on the family only: on the suites it
 * measured nothing S1-S4 reads once S3 was deferred. Each job names its sitting.
 */
export function m1Jobs({ worktree = M1_WORKTREE } = {}) {
  const models = [...M1_MODELS].sort((a, b) => Number(b.small) - Number(a.small));
  const jobs = [];
  for (const model of models) for (const arm of M1_ARMS) jobs.push(m1LongSessionJob(model, arm, { worktree }));
  for (const model of M1_REPLICATION_MODELS) for (const arm of M1_ARMS) jobs.push(m1LongSessionJob(model, arm, { worktree }));
  for (const model of models)
    for (const suite of M1_SUITES)
      for (const id of M1_WORKER_ARMS)
        jobs.push({
          ...m1RobustnessJob(
            model,
            M1_ARMS.find((arm) => arm.id === id),
            suite,
            { worktree },
          ),
          maxQuestions: M1_S4_SAMPLE_QUESTIONS,
          concurrency: 1,
        });
  const sittingOf = (job) =>
    Number(Object.entries(M1_SITTINGS).find(([, ids]) => ids.includes(job.id.replace(/^217-m1\./, "")))?.[0] ?? Number.NaN);
  for (const job of jobs) {
    job.sitting = sittingOf(job);
    if (!Number.isInteger(job.sitting)) throw new Error(`M1Jobs: ${job.id} is in no sitting`);
  }
  return jobs.sort((a, b) => a.sitting - b.sitting);
}

/** Every pair in the job list differs only in the arm (and the tree it runs from): same items, model, judges and flags. */
export function assertM1Paired(jobs) {
  const strip = ({
    id: _id,
    role: _role,
    arm: _arm,
    config: _config,
    cwd: _cwd,
    answersDir: _a,
    judgeCacheDir: _j,
    maxInputTokens: _m,
    wallTimeCapHours: _w,
    sitting: _s,
    ...rest
  }) => stableHash(rest);
  const groups = new Map();
  for (const job of jobs) {
    const key = `${job.model_key}|${job.suite}`;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  for (const [key, group] of groups) {
    const arms = group.map((job) => job.arm).sort();
    const expected = (group[0].suite === M1_FAMILY ? M1_ARMS.map((arm) => arm.id) : [...M1_WORKER_ARMS]).sort();
    if (JSON.stringify(arms) !== JSON.stringify(expected))
      throw new Error(`M1Jobs: ${key} does not hold every arm once (${arms.join(", ")})`);
    const shapes = new Set(group.map(strip));
    if (shapes.size !== 1) throw new Error(`M1Jobs: the arms of ${key} differ in more than the arm`);
    const workers = group.filter((job) => M1_WORKER_ARMS.includes(job.arm));
    if (new Set(workers.map((job) => job.maxInputTokens)).size !== 1)
      throw new Error(`M1Jobs: the worker arms of ${key} have different caps`);
  }
  return jobs;
}

export function m1ManifestHash(manifest) {
  const { gate: _gate, manifestHash: _hash, generatedAt: _at, ...rest } = manifest;
  return stableHash(rest);
}

/** The planning estimate: input tokens and USD per arm and in total, from the cohort sizes. */
export function m1Estimate() {
  const historyTokens = { "longmemeval-m": 1_212_826, "beam-1m": 1_000_000 };
  const sampleHistory = M1_SUITES.reduce((n, suite) => n + historyTokens[suite] * M1_S4_SAMPLE_QUESTIONS, 0);
  // Measured 2026-11-09/10 on 120k tokens of LongMemEval-M with MiMo: STM 5.2, OM-before 5.0 worker tokens per history token.
  const workerTokens = sampleHistory * (5.2 + 5.0) * M1_MODELS.length;
  const tokens = Math.round(workerTokens + M1_ESTIMATE.longSessionTokensPerJob * M1_ARMS.length * M1_MODELS.length);
  return {
    sample: { questionsPerSuiteAndArm: M1_S4_SAMPLE_QUESTIONS, historyTokensPerQuestion: historyTokens },
    inputTokens: tokens,
    usd: Math.round((tokens / 1e6) * M1_ESTIMATE.usdPerMillion),
    wall: "run 1 about 1.5 h; runs 2-4 about 2.5 h each (16k history tokens a minute per stream, three streams)",
    basis: M1_ESTIMATE,
  };
}

export async function buildM1Manifest({ root = ".", worktree = M1_WORKTREE } = {}) {
  const baselines = JSON.parse(await readFile(join(root, M1_BASELINES), "utf8"));
  const productHash = await sourceFingerprint([...M1_PRODUCT_PATHS], root);
  const harnessHash = await fileFingerprint(
    [...M1_HARNESS_PATHS].filter((path) => path.includes(".")),
    root,
  );
  const om = baselines.omBefore;
  const jobs = assertM1Paired(m1Jobs({ worktree }));
  const label = `stm-${productHash.slice(0, 32)}`;
  const manifest = {
    kind: "217-m1-gate-manifest",
    schemaVersion: 1,
    plan: M1_PLAN,
    task: M1_TASK,
    gateId: M1_GATE_ID,
    partition: M1_PARTITION,
    status: "proposal",
    executable: false,
    ...memoryModelManifestPin({ gate: M1_GATE_ID }),
    rows: [...MEMORY_MODEL_CRITERIA.gates[M1_GATE_ID].rows],
    fixtures: {
      "long-session": assertMemoryModelFixture("long-session"),
      "long-session-replay": assertMemoryModelFixture("long-session-replay"),
    },
    baselines: { omBefore: { revision: om.revision, productHash: om.productHash, productPaths: om.productPaths, worktree } },
    productHash,
    productPaths: [...M1_PRODUCT_PATHS],
    harnessHash,
    harnessPaths: [...M1_HARNESS_PATHS],
    // The report's source label per arm: a commit cannot orphan a checkpoint, and OM-before's is the pinned revision.
    productRevision: { STM: label, "memory-off": label, "OM-before": om.revision },
    provider: C1_PROVIDER,
    model: "217-m1-panel",
    ceiling: M1_CEILING,
    journalPath: M1_JOURNAL,
    summaryPath: `${M1_RUNS}/execution-run.json`,
    models: {
      answers: M1_MODELS.map((model) => ({ key: model.key, ref: refOf(model), family: model.family, small: model.small })),
      replication: M1_REPLICATION_MODELS.map((model) => ({ key: model.key, ref: refOf(model), family: model.family, scope: M1_FAMILY })),
      judges: [...M1_JUDGES],
      worker: "each arm's answer model (as in gate C-1): the STM / observer, reflector and dropper calls go to the answer route",
      judgesDoNotAnswer: true,
    },
    billing: {
      mode: "paid-allowance",
      provider: C1_PROVIDER,
      plan: "Ollama Cloud Pro ($60 included a month, 3 concurrent requests)",
      reserveUsd: 1.5,
      paidAnswers: M1_ANSWER_MODELS.map((model) => refOf(model)),
      paidJudges: [...M1_JUDGES],
      paidFallbacks: [],
    },
    interruptions:
      "429s, closed usage windows (waited out from /api/balance's resets_at), quota windows, empty replies, timeouts and dropped sockets are re-run from the job's answer/judge (or persona) checkpoints after a cooldown and never count against its attempts; a spent allowance halts the campaign, which resumes from its journal next period; a question that errors fails the job (--strict-questions) instead of being scored",
    caps: { ...M1_CAPS, journalCeiling: M1_CEILING },
    estimate: m1Estimate(),
    cohort: {
      ...Object.fromEntries(
        M1_SUITES.map((suite) => [
          suite,
          { partition: M1_PARTITION, questions: m1DevIds(suite).length, idsHash: ROBUSTNESS_DRAWS[suite].idsHash },
        ]),
      ),
      [M1_FAMILY]: { partition: M1_PARTITION, fixtureHash: assertMemoryModelFixture("long-session") },
    },
    arms: M1_ARMS.map((arm) => ({ ...arm, base: arm.id === "OM-before" ? null : "OM-before" })),
    pairing:
      "every arm is paired with OM-before on identical items: the same question ids (suites) or personas (family), answer model, judges and flags; an item one arm did not finish is reported unpaired, never imputed",
    results: [],
    jobs,
  };
  manifest.manifestHash = m1ManifestHash(manifest);
  assertMemoryModelPin({ ...manifest, gate: M1_GATE_ID });
  return manifest;
}

export async function writeM1Manifest({ root = "." } = {}) {
  const manifest = await buildM1Manifest({ root });
  await mkdir(join(root, M1_DIR), { recursive: true });
  await writeFile(join(root, M1_MANIFEST), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...manifest }, null, 2)}\n`);
  return manifest;
}

/** The owner's approval, bound to the manifest hash. Pure: checks, never writes. */
export function assertM1Gate(gate, manifest) {
  const refuse = (reason) => {
    throw new Error(`M1Gate: ${reason}`);
  };
  if (!gate || typeof gate !== "object") refuse("no gate record");
  if (gate.kind !== "memory-model-owner-gate" || gate.plan !== M1_PLAN || gate.gate !== M1_GATE_ID)
    refuse("the record is not plan 217 gate M-1");
  // Plan 218 Task 5: a closed gate never runs again; its records keep the criteria hash it ran on.
  if (gate.closed)
    refuse(`gate M-1 was closed by the ${gate.closed.by ?? "owner"} on ${gate.closed.at ?? "an unrecorded date"}; it does not run again`);
  if (gate.approved !== true || gate.approvedBy !== "owner")
    refuse("the gate is not approved by the owner (the run starts only on the owner's word)");
  if (typeof gate.text !== "string" || !gate.text.trim()) refuse("the gate carries no owner text");
  if (gate.manifestHash !== manifest.manifestHash)
    refuse("the manifest differs from the approved one; a changed manifest is a refusal, not a re-approval");
  if (gate.memoryModelCriteriaHash !== manifest.memoryModelCriteriaHash) refuse("the gate pins different memory-model criteria");
  if (gate.criteriaHash !== manifest.criteriaHash) refuse("the gate pins different robustness criteria");
  if (JSON.stringify(gate.partitions) !== JSON.stringify([M1_PARTITION])) refuse("gate M-1 lists the dev partition only");
  if (gate.budget?.provider !== C1_PROVIDER || gate.budget?.billing !== "paid-allowance")
    refuse("the budget is not the Ollama Cloud allowance");
  const routes = new Set([...M1_ANSWER_MODELS.map((model) => refOf(model)), ...M1_JUDGES]);
  const named = [...Object.values(gate.models?.answers ?? {}), ...(gate.models?.judges ?? [])];
  if (!named.length || named.some((ref) => !routes.has(ref))) refuse("the gate names a route outside the gate M-1 models");
  if (named.some((ref) => /openrouter\/.*free|:free$/.test(ref))) refuse("never openrouter/free");
  return gate;
}

export async function readM1Gate({ root = "." } = {}) {
  const path = join(root, M1_GATE);
  if (!existsSync(path)) throw new Error(`M1Gate: no gate record at ${M1_GATE}; the owner approves gate M-1 before any live call`);
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * The executable manifest: the proposal plus a verified gate. `PRISM_MEMORY_BENCH_217_JOBS` (comma-separated id
 * substrings) runs a subset of the approved jobs unchanged; a bounded smoke (`PRISM_MEMORY_BENCH_217_SMOKE=1`) runs
 * two questions or one persona per job in its own journal.
 */
export async function buildExecutableM1Manifest({
  root = ".",
  only = process.env.PRISM_MEMORY_BENCH_217_JOBS,
  smoke = process.env.PRISM_MEMORY_BENCH_217_SMOKE === "1",
} = {}) {
  const manifest = await buildM1Manifest({ root });
  const gate = assertM1Gate(await readM1Gate({ root }), manifest);
  const patterns = String(only ?? "")
    .split(",")
    .filter(Boolean);
  const jobs = patterns.length ? manifest.jobs.filter((job) => patterns.some((pattern) => job.id.includes(pattern))) : manifest.jobs;
  if (!jobs.length) throw new Error(`M1: no approved job matches ${only}`);
  const tag = patterns.length || smoke ? stableHash(`${smoke ? "smoke:" : ""}${patterns.join(",")}`).slice(0, 8) : null;
  return {
    ...manifest,
    jobs: smoke ? jobs.map((job) => (job.kind === "long-session" ? { ...job, personaLimit: 1 } : { ...job, maxQuestions: 2 })) : jobs,
    ...(tag
      ? {
          worker: tag,
          journalPath: `${M1_CACHE}/journal-${smoke ? "smoke" : "worker"}-${tag}.json`,
          summaryPath: `${M1_RUNS}/execution-${smoke ? "smoke" : "run-worker"}-${tag}.json`,
          executionManifestPath: `${M1_RUNS}/execution-manifest-${smoke ? "smoke" : "worker"}-${tag}.json`,
          outputPrefix: smoke ? "smoke-217-m1" : M1_OUTPUT_PREFIX,
        }
      : {}),
    status: "approved",
    executable: true,
    gate: { path: M1_GATE, manifestHash: gate.manifestHash, approvedAt: gate.approvedAt },
  };
}

/**
 * The pinned OM-before worktree: at the recorded revision, with its observational product unchanged, dependencies
 * installed, and the family's harness files copied in byte for byte. Refuses anything else.
 */
export async function prepareM1Worktree({
  root = ".",
  worktree = M1_WORKTREE,
  revision,
  productHash,
  productPaths,
  run = Bun.spawnSync,
} = {}) {
  const dir = join(root, worktree);
  if (!existsSync(dir))
    throw new Error(
      `M1Worktree: ${worktree} is missing (git worktree add --detach ${worktree} ${revision}; bun install --frozen-lockfile)`,
    );
  const head = run(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  if (head !== revision)
    throw new Error(`M1Worktree: ${worktree} is at ${head.slice(0, 8) || "(none)"}, not the pinned ${revision.slice(0, 8)}`);
  if (!existsSync(join(dir, "node_modules")))
    throw new Error(`M1Worktree: ${worktree} has no node_modules (bun install --frozen-lockfile)`);
  for (const path of M1_WORKTREE_COPY) await cp(join(root, path), join(dir, path), { recursive: true, force: true });
  const copied = await fileFingerprint(
    M1_WORKTREE_COPY.filter((path) => path.includes(".")),
    dir,
  );
  if (
    copied !==
    (await fileFingerprint(
      M1_WORKTREE_COPY.filter((path) => path.includes(".")),
      root,
    ))
  )
    throw new Error("M1Worktree: the copied harness differs from this tree's");
  const product = await sourceFingerprint(productPaths, dir);
  if (product !== productHash) throw new Error("M1Worktree: the worktree's observational product does not hash to the pinned productHash");
  return { worktree, revision: head, productHash: product, harness: copied };
}

/** Every route in the catalog, the worktree pinned, the fixtures hashed and the allowance open; nothing runs otherwise. */
export async function preflightM1(manifest, options = {}) {
  const refs = [
    ...new Set(manifest.jobs.flatMap((job) => [`${job.provider}/${job.model}`, ...(job.judges ? job.judges.split(",") : [])])),
  ].sort();
  const allowed = new Set([...M1_ANSWER_MODELS.map((model) => refOf(model)), ...M1_JUDGES]);
  const foreign = refs.filter((ref) => !allowed.has(ref));
  if (foreign.length) throw new Error(`M1Preflight: ${foreign.join(", ")} is not a gate M-1 route`);
  for (const id of Object.keys(manifest.fixtures)) assertMemoryModelFixture(id);
  const worktree = await (options.prepareWorktree ?? prepareM1Worktree)({ root: options.root ?? ".", ...manifest.baselines.omBefore });
  const list = options.list ?? (await import("@arnilo/prism-ai/ollama-cloud")).listOllamaCloudModels;
  const key = options.apiKey ?? process.env.OLLAMA_API_KEY;
  if (!key) throw new Error("M1Preflight: OLLAMA_API_KEY is unavailable");
  const catalog = await list({ apiKey: () => key, signal: AbortSignal.timeout(60_000) });
  const ids = new Set(catalog.map((model) => model.model));
  const missing = refs.filter((ref) => !ids.has(ref.slice(C1_PROVIDER.length + 1)));
  if (missing.length) throw new Error(`M1Preflight: ${missing.join(", ")} is not in the Ollama Cloud catalog`);
  const balance = await c1Balance({ fetch: options.fetch, apiKey: key, force: true });
  const decision = c1BudgetDecision(balance);
  if (decision.halt) throw new Error(`M1Preflight: ${decision.reason}`);
  const record = {
    kind: "217-m1-preflight",
    checkedAt: new Date().toISOString(),
    refs,
    worktree,
    balance: { includedUsd: balance.included?.balance_usd ?? null, periodUntil: balance.included?.period?.until ?? null },
  };
  if (!options.dryRun) {
    await mkdir(M1_RUNS, { recursive: true });
    await writeFile(`${M1_RUNS}/preflight${manifest.worker ? `-${manifest.worker}` : ""}.json`, `${JSON.stringify(record, null, 2)}\n`);
  }
  return record;
}

/** The campaign's per-job gate: the C-1 allowance guard (waits out a closed window, halts on a spent allowance). */
export const m1BudgetGate = (job, options) => c1BudgetGate(job, options);

/* ------------------------------------------------------------------------------------------------------------------ */
/* The evidence (`acceptance-report.mjs --plan memory-model --gate M-1 --build`). Ids, counts, scores and hashes only. */
/* ------------------------------------------------------------------------------------------------------------------ */

/** The latest attempt's report per job id: `<prefix>-<id>.json`, or `-<n>` for a later attempt. */
export async function loadM1Reports(dir = M1_RUNS, prefix = `${M1_OUTPUT_PREFIX}-`) {
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

const round = (value, digits = 4) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const sum = (values) => values.reduce((n, value) => n + (Number.isFinite(value) ? value : 0), 0);
const p95 = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] : null;
};
const completed = (report) => report?.status === "completed";
/**
 * A suite job is done when it completed, or when it is a capped sample (`maxQuestions`) that answered exactly its
 * sample (the run reports `partial` for a capped job).
 */
const answeredIds = (report) =>
  (report?.results ?? []).filter((row) => row.outcome === "scored" || row.outcome === "answered").map((row) => row.id);
export function m1SuiteDone(report, job) {
  if (completed(report)) return true;
  return Boolean(job?.maxQuestions) && report?.status === "partial" && answeredIds(report).length === job.maxQuestions;
}
const workerTokens = (usage) => sum(Object.values(usage ?? {}).map((row) => (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0)));
const workerCalls = (usage) => sum(Object.values(usage ?? {}).map((row) => row?.calls ?? 0));

/** S3 on one model and suite: paired accuracy (points, STM - OM-before) and STM's all-required evidence coverage per ability. */
export function m1AccuracyPair(omReport, stmReport, suite, { iterations = 4000 } = {}) {
  const pair = pairOnIdenticalItems(omReport, stmReport, suite);
  if (!pair.ids.length) return { suite, n: 0, status: "not-computable", unpaired: pair.unpaired };
  const result = pairedAnalysis(pair.base, pair.arm, { iterations });
  const stmRows = new Map((stmReport.results ?? []).map((row) => [row.id, row]));
  const coverage = {};
  for (const ability of [...new Set(pair.arm.map((row) => row.ability))].sort()) {
    const values = pair.ids
      .map((id) => stmRows.get(id))
      .filter((row) => row?.ability === ability && typeof row.evidenceAllRequired === "boolean")
      .map((row) => (row.evidenceAllRequired ? 1 : 0));
    if (values.length) coverage[`${suite}:${ability}`] = round(sum(values) / values.length);
  }
  return {
    suite,
    n: result.n,
    clusters: result.clusters,
    unpaired: pair.unpaired,
    omCorrect: pair.base.filter((row) => row.correct).length,
    stmCorrect: pair.arm.filter((row) => row.correct).length,
    estimate: round(result.diff * 100, 2),
    ciLow: round(result.ci95[0] * 100, 2),
    ciHigh: round(result.ci95[1] * 100, 2),
    coverage,
  };
}

/** Per-arm cost rows for one report: worker calls and tokens, context-block bytes, chunk-store peak, cost and p95. */
export function m1CostRow(report) {
  const rows = (report?.results ?? []).filter((row) => row.outcome === "scored" || row.outcome === "answered");
  const n = rows.length || null;
  return {
    status: report?.status ?? "missing",
    questions: rows.length,
    workerCalls: workerCalls(report?.workerUsage),
    workerTokens: workerTokens(report?.workerUsage),
    workerTokensPerQuestion: n ? round(workerTokens(report?.workerUsage) / n, 1) : null,
    inputTokens: report?.inputTokens ?? null,
    contextBlockBytesPerQuestion:
      n && Number.isFinite(report?.injectedContextTokens) ? round((report.injectedContextTokens * 4) / n, 1) : null,
    chunkStorePeakBytes: rows.some((row) => typeof row.chunkStorePeakBytes === "number")
      ? Math.max(...rows.map((row) => row.chunkStorePeakBytes ?? 0))
      : null,
    costUsd: report?.cost?.measured ?? null,
    p95AnswerMs: p95(rows.map((row) => row.phaseTiming?.answer)),
  };
}

/** S1 on one model: re-derivation calls per related task, paired by persona and pair (positive = STM re-derives less). */
export function m1RederivationPair(omJob, stmJob, { iterations = 4000 } = {}) {
  const rowsOf = (job, arm) => job?.report?.rows?.[arm] ?? [];
  const key = (row) => `${row.persona}:${row.pair}`;
  const om = new Map(rowsOf(omJob, "OM-before").map((row) => [key(row), row]));
  const stm = new Map(rowsOf(stmJob, "STM").map((row) => [key(row), row]));
  const ids = [...om.keys()].filter((id) => stm.has(id)).sort();
  if (!ids.length) return { n: 0, status: "not-computable" };
  const pick = (map) => ids.map((id) => ({ id, cluster: map.get(id).persona, value: map.get(id).rederivations }));
  const { diff, ci95 } = pairedClusterPermutation(pick(om), pick(stm), { iterations });
  // diff is STM - OM-before; fewer re-derivations is better, so the improvement is its negation.
  return {
    n: ids.length,
    clusters: new Set(ids.map((id) => om.get(id).persona)).size,
    omMean: round(sum(ids.map((id) => om.get(id).rederivations)) / ids.length),
    stmMean: round(sum(ids.map((id) => stm.get(id).rederivations)) / ids.length),
    estimate: round(-diff),
    ciLow: round(-ci95[1]),
    ciHigh: round(-ci95[0]),
    successRate: {
      om: round(ids.filter((id) => om.get(id).success).length / ids.length),
      stm: round(ids.filter((id) => stm.get(id).success).length / ids.length),
    },
  };
}

/** S4's family cell: worker tokens per 10k eligible tokens, per arm, over the personas both arms finished. */
export function m1FamilyWorkerTokens(omJob, stmJob) {
  const usageOf = (job) => new Map((job?.report?.usage ?? []).map((row) => [row.persona, row]));
  const om = usageOf(omJob);
  const stm = usageOf(stmJob);
  const personas = [...om.keys()].filter((id) => stm.has(id)).sort();
  if (!personas.length) return null;
  const per10k = (map) => {
    const tokens = sum(personas.map((id) => map.get(id).worker.inputTokens + map.get(id).worker.outputTokens));
    const eligible = sum(personas.map((id) => map.get(id).eligibleTokens));
    return eligible ? (tokens / eligible) * 10_000 : null;
  };
  const omValue = per10k(om);
  const stmValue = per10k(stm);
  return {
    personas: personas.length,
    omPer10kEligible: round(omValue, 1),
    stmPer10kEligible: round(stmValue, 1),
    ratio: omValue ? round(stmValue / omValue) : null,
    stmChunkStorePeakBytes: Math.max(0, ...personas.map((id) => stm.get(id).chunkStorePeakBytes ?? 0)),
  };
}

/**
 * The gate's evidence from the run reports, the Task 5 probe file and (S4 only) a written justification. Every value
 * is computed; nothing is set by hand. A cell whose reports are missing or unfinished stays out, so its row reads
 * `missing`, never `pass`.
 */
export function buildM1Evidence({ reports, manifest, probes, justification = null, iterations = 4000 }) {
  const models = M1_MODELS.map((model) => model.key);
  const get = (model, arm, suite) => reports.get(`217-m1.${model}.${arm}.${suite}`);
  const s1 = [];
  const s3 = [];
  const s4 = [];
  const coverage = {};
  const performance = {};
  const cells = {};
  for (const model of models) {
    performance[model] = {};
    for (const suite of M1_SUITES) {
      performance[model][suite] = Object.fromEntries(M1_WORKER_ARMS.map((arm) => [arm, m1CostRow(get(model, arm, suite))]));
      const om = get(model, "OM-before", suite);
      const stm = get(model, "STM", suite);
      const jobOf = (arm) => manifest.jobs?.find((job) => job.id === `217-m1.${model}.${arm}.${suite}`);
      // The two arms must have answered the same questions: the S4 ratio is per question on identical histories.
      const sameIds = JSON.stringify([...answeredIds(om)].sort()) === JSON.stringify([...answeredIds(stm)].sort());
      if (!m1SuiteDone(om, jobOf("OM-before")) || !m1SuiteDone(stm, jobOf("STM")) || !sameIds) {
        cells[`${model}.${suite}`] = "missing";
        continue;
      }
      const pair = m1AccuracyPair(om, stm, suite, { iterations });
      cells[`${model}.${suite}`] = pair.n ? "paired" : "not-computable";
      if (!pair.n) continue;
      s3.push({
        model,
        suite,
        n: pair.n,
        clusters: pair.clusters,
        unpaired: pair.unpaired,
        estimate: pair.estimate,
        ciLow: pair.ciLow,
        ciHigh: pair.ciHigh,
      });
      Object.assign(coverage, Object.fromEntries(Object.entries(pair.coverage).map(([key, value]) => [`${model}:${key}`, value])));
      const omCost = performance[model][suite]["OM-before"];
      const stmCost = performance[model][suite].STM;
      // Identical items replay identical histories, so worker tokens per question are worker tokens per eligible token.
      if (omCost.workerTokensPerQuestion)
        s4.push({
          model,
          scope: suite,
          stm: stmCost.workerTokensPerQuestion,
          om: omCost.workerTokensPerQuestion,
          ratio: round(stmCost.workerTokensPerQuestion / omCost.workerTokensPerQuestion),
        });
    }
    const omJob = get(model, "OM-before", M1_FAMILY);
    const stmJob = get(model, "STM", M1_FAMILY);
    const offJob = get(model, "memory-off", M1_FAMILY);
    performance[model][M1_FAMILY] = Object.fromEntries(
      [
        ["OM-before", omJob],
        ["STM", stmJob],
        ["memory-off", offJob],
      ].map(([arm, job]) => [
        arm,
        {
          status: job?.status ?? "missing",
          rederivationsPerRelatedTask: job?.report?.summary?.[arm]?.rederivationsPerRelatedTask ?? null,
          successRate: job?.report?.summary?.[arm]?.successRate ?? null,
          inputTokens: job?.inputTokens ?? null,
        },
      ]),
    );
    if (!completed(omJob) || !completed(stmJob)) {
      cells[`${model}.${M1_FAMILY}`] = "missing";
      continue;
    }
    const pair = m1RederivationPair(omJob, stmJob, { iterations });
    cells[`${model}.${M1_FAMILY}`] = pair.n ? "paired" : "not-computable";
    if (pair.n) s1.push({ model, ...pair });
    const family = m1FamilyWorkerTokens(omJob, stmJob);
    if (family?.ratio !== null && family?.ratio !== undefined)
      s4.push({
        model,
        scope: M1_FAMILY,
        stm: family.stmPer10kEligible,
        om: family.omPer10kEligible,
        ratio: family.ratio,
        unit: "per 10k eligible tokens",
      });
  }
  // The replication models: S1 and the family S4 cell on the long-session family, beside the rows, never in a verdict.
  const replication = {};
  for (const { key: model } of M1_REPLICATION_MODELS) {
    const omJob = get(model, "OM-before", M1_FAMILY);
    const stmJob = get(model, "STM", M1_FAMILY);
    const offJob = get(model, "memory-off", M1_FAMILY);
    const arms = Object.fromEntries(
      [
        ["OM-before", omJob],
        ["STM", stmJob],
        ["memory-off", offJob],
      ].map(([arm, job]) => [
        arm,
        {
          status: job?.status ?? "missing",
          rederivationsPerRelatedTask: job?.report?.summary?.[arm]?.rederivationsPerRelatedTask ?? null,
          successRate: job?.report?.summary?.[arm]?.successRate ?? null,
          inputTokens: job?.inputTokens ?? null,
        },
      ]),
    );
    if (!completed(omJob) || !completed(stmJob)) {
      replication[model] = { cell: "missing", arms };
      continue;
    }
    const pair = m1RederivationPair(omJob, stmJob, { iterations });
    const family = m1FamilyWorkerTokens(omJob, stmJob);
    replication[model] = {
      cell: pair.n ? "paired" : "not-computable",
      arms,
      ...(pair.n ? { S1: pair } : {}),
      ...(family?.ratio == null ? {} : { S4: { stm: family.stmPer10kEligible, om: family.omPer10kEligible, ratio: family.ratio } }),
    };
  }
  const recall = probes?.probes?.find((probe) => probe.id === "stm.recall-verbatim");
  const expectedCells = models.length * (M1_SUITES.length + 1);
  const s4Complete = s4.length === expectedCells;
  const s4Value = s4Complete ? Math.max(...s4.map((row) => row.ratio)) : null;
  const rows = {
    S1: s1.length === models.length ? { tests: { "vs-om-before": { models: s1 } } } : { tests: {}, cells: s1 },
    S2:
      recall?.counts && recall.counts.chunks > 0
        ? {
            source: M1_PROBES,
            tests: {
              "byte-equal": { value: recall.counts.byteEqual / recall.counts.chunks, chunks: recall.counts.chunks },
              "other-tool-runs": { value: recall.counts.otherToolCalls },
            },
          }
        : { tests: {} },
    // Deferred to gate A (owner decision m1S3Deferred, 2026-11-10). The sample's paired accuracy is kept as a
    // diagnostic only: two questions per cell decide nothing.
    S3: { deferred: MEMORY_MODEL_CRITERIA.gates[M1_GATE_ID].deferred?.S3 ?? null, diagnostic: { cells: s3, coverage } },
    S4: {
      tests: s4Complete
        ? {
            "token-ratio": {
              value: s4Value,
              rule: "the largest STM / OM-before ratio over every (answer model, scope) cell",
              cells: s4,
              ...(s4Value > 1.25 && justification ? { justification } : {}),
            },
          }
        : {},
      ...(s4Complete ? {} : { cells: s4 }),
    },
  };
  return {
    kind: "217-m1-evidence",
    schemaVersion: 1,
    gate: M1_GATE_ID,
    plan: M1_PLAN,
    partition: M1_PARTITION,
    memoryModelCriteriaHash: manifest.memoryModelCriteriaHash,
    criteriaHash: manifest.criteriaHash,
    manifestHash: manifest.manifestHash,
    fixtures: manifest.fixtures,
    omBefore: { revision: manifest.baselines.omBefore.revision, productHash: manifest.baselines.omBefore.productHash },
    productHash: manifest.productHash,
    cells,
    rows,
    performance,
    replication,
  };
}

/** Build the evidence from the run reports and write `M-1/evidence.json`; the verdicts come from the criteria only. */
export async function writeM1Evidence({ root = "." } = {}) {
  const manifest = JSON.parse(await readFile(join(root, M1_MANIFEST), "utf8"));
  const reports = await loadM1Reports(join(root, M1_RUNS));
  const probes = JSON.parse(await readFile(join(root, M1_PROBES), "utf8"));
  const justification = existsSync(join(root, M1_JUSTIFICATION)) ? (await readFile(join(root, M1_JUSTIFICATION), "utf8")).trim() : null;
  const evidence = buildM1Evidence({ reports, manifest, probes, justification });
  await mkdir(join(root, M1_DIR), { recursive: true });
  await writeFile(join(root, M1_DIR, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return { evidence, verdict: memoryModelGateVerdict(M1_GATE_ID, evidence, { partition: M1_PARTITION }) };
}
