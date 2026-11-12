/**
 * Plan 218 Task 6: gate M-2, live WM efficacy (rows M1-M5 of `memory-model-criteria.json`).
 *
 * Arms, on the development partitions only:
 * - `WM`: the `session` profile (STM + WM, plan 218). The re-plan family hands WM each plan as the episode scope before
 *   its turn; the QA suites hand it the suite's task framing (`--wm-scope`); the long-session family has no plan, so
 *   no scope;
 * - `STM-only`: plan 217's STM with `wm.policy: "deterministic"` and no scope. The deterministic policy keeps protected,
 *   outcome and salient records and discards the rest to meet the target, so it can discard a changed value
 *   (`wm.knowledge-update`, plan 218 Task 5); the report says so beside the arm's numbers;
 * - `OM-before`: the pinned pre-216 observer, run from its worktree. Gate M-1's rows ran on Ollama Cloud routes, so
 *   they do not pair with this gate's OpenCode Go routes, and the arm is re-run here on identical items.
 *
 * Rows: M1 from the live re-plan family (task success after the re-plan), M5 from the QA suites (`WM` vs `STM-only`),
 * M2-M4 from Task 5's offline probes (`218/wm-probes.json`), which must read `works` before any paid call. Plan 217's
 * S1 miss is re-measured on MiMo (three repeats per arm on the long-session family) and reported beside the rows.
 *
 * Machinery: `campaign.mjs --plan memory-model --gate M-2` (journal, product pin, retries that cost only wall time,
 * quota-window waits), `acceptance-report.mjs --plan memory-model --gate M-2 --build` (verdicts). The run starts only
 * on the owner's word: `218/gates/owner-gate-m2.json` must say `approved: true` and bind this manifest. Evidence
 * carries ids, counts, scores and hashes only.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileFingerprint, sourceFingerprint } from "./acceptance.mjs";
import { pairOnIdenticalItems, refOf } from "./cleanup-campaign.mjs";
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
import { loadM1Reports, m1SuiteDone } from "./stm-gate.mjs";

export const M2_PLAN = 218;
export const M2_TASK = 6;
export const M2_GATE_ID = "M-2";
export const M2_PARTITION = "dev";
export const M2_EVIDENCE = "docs/_evidence/memory-bench/218";
export const M2_RUNS = `${M2_EVIDENCE}/runs`;
export const M2_GATE = `${M2_EVIDENCE}/gates/owner-gate-m2.json`;
export const M2_DIR = "docs/_evidence/memory-bench/memory-model/M-2";
export const M2_MANIFEST = `${M2_DIR}/manifest.json`;
export const M2_EXECUTION_MANIFEST = `${M2_RUNS}/execution-manifest.json`;
export const M2_PROBES = `${M2_EVIDENCE}/wm-probes.json`;
export const M2_CACHE = ".cache/memory-bench/218";
export const M2_JOURNAL = `${M2_CACHE}/journal.json`;
export const M2_OUTPUT_PREFIX = "run-218-m2";
export const M2_BASELINES = "docs/_evidence/memory-bench/memory-model/baselines.json";
export const M2_WORKTREE = ".cache/memory-bench/216/om-before";
export const M2_PROVIDER = "opencode-go";
export const M2_SUITES = Object.freeze(["longmemeval-m", "beam-1m"]);
export const M2_REPLAN = "re-plan";
export const M2_LONG_SESSION = "long-session";
/**
 * The models (owner, 2026-11-12: "For the live paid run, use deepseek-v4.1-flash and Muse Spark Contributor 1.3";
 * "Use Opencode go as the provider"). Each arm's WM and STM worker is its answer model.
 */
export const M2_MODELS = Object.freeze([
  { key: "deepseek", provider: M2_PROVIDER, model: "deepseek-v4.1-flash", family: "deepseek" },
  { key: "muse", provider: M2_PROVIDER, model: "muse-spark-1.3-contributor", family: "muse" },
]);
/** Plan 217's S1 miss, re-measured on the model it happened on (owner, 2026-11-12: "Add MiMo for S1"). */
export const M2_S1_MODEL = Object.freeze({ key: "mimo", provider: M2_PROVIDER, model: "mimo-v2.6-flash", family: "mimo" });
export const M2_S1_REPEATS = 3;
/** Every answer route the gate may call. */
export const M2_ANSWER_MODELS = Object.freeze([...M2_MODELS, M2_S1_MODEL]);
/**
 * M5's judges (owner, 2026-11-12: "Use Qwen 3.8 flash and GPT 6 luna as judges from Opencode Go", then "Replace GPT 6
 * luna with Minimax m3.1 flash"). Neither answers.
 */
export const M2_JUDGES = Object.freeze([`${M2_PROVIDER}/qwen3.8-flash`, `${M2_PROVIDER}/minimax-m3.1-flash`]);
/**
 * Arms: the suite config, the switches that make the arm, and the tree it runs from. `STM-only` is the deterministic
 * WM policy; `WM` takes the suite's task framing as its scope.
 */
export const M2_ARMS = Object.freeze([
  { id: "WM", config: "om", tree: "current", wmScope: true, ablate: [] },
  { id: "STM-only", config: "om", tree: "current", wmScope: false, ablate: ["session.wm.policy=deterministic"] },
  { id: "OM-before", config: "om", tree: "om-before", wmScope: false, ablate: [] },
]);
/** M5 compares `WM` with `STM-only` only; `OM-before` does not run on the suites. */
export const M2_SUITE_ARMS = Object.freeze(["WM", "STM-only"]);
/** This tree's product: the session tiers' package, the store library and the kernel. */
export const M2_PRODUCT_PATHS = Object.freeze(["packages/memory/system/src", "packages/memory/core/src", "src"]);
/**
 * The product fingerprint leaves out test files (owner, 2026-11-12, plan 217's proposal: "Exclude test files"), so a
 * test-only commit no longer refuses a sitting; any other byte under the product paths still does.
 */
export const isProductTestPath = (path, directory = false) =>
  directory ? /(^|\/)__tests__$/.test(path) : /(^|\/)__tests__\//.test(path) || /\.test\.[^/]+$/.test(path);
export const m2ProductFingerprint = (root = ".") => sourceFingerprint([...M2_PRODUCT_PATHS], root, { exclude: isProductTestPath });
/** The harness both trees run. A harness edit is a new manifest, not a re-approval. */
export const M2_HARNESS_PATHS = Object.freeze([
  "scripts/memory-bench/replay.mjs",
  "scripts/memory-bench/run.mjs",
  "scripts/memory-bench/ablations.mjs",
  "scripts/memory-bench/datasets.mjs",
  "scripts/memory-bench/chunk-meter.mjs",
  "scripts/memory-bench/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session-live.mjs",
  "scripts/memory-bench/work-outcome/re-plan.mjs",
  "scripts/memory-bench/work-outcome-long-session.json",
  "scripts/memory-bench/work-outcome-re-plan.json",
]);
/** The family files the OM-before worktree needs; nothing under its pinned product paths. */
export const M2_WORKTREE_COPY = Object.freeze([
  "scripts/memory-bench/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session.mjs",
  "scripts/memory-bench/work-outcome/long-session-live.mjs",
  "scripts/memory-bench/work-outcome/re-plan.mjs",
  "scripts/memory-bench/work-outcome-long-session.json",
  "scripts/memory-bench/work-outcome-re-plan.json",
  "scripts/memory-bench/fixtures/memory-model/long-session",
]);
/** M5's sample (owner, 2026-11-12: "Small sample, flagged"): the first questions of each dev cohort, frozen order. */
export const M2_SUITE_QUESTIONS = 4;
/**
 * Per-job caps. Gate M-1 measured 3-14M input tokens per 16-persona family job and 4-20M per two suite questions; the
 * caps hold about three times that. OpenCode Go bills a subscription with rolling usage windows, so a spent window is
 * waited out (a quota-window interruption) and never counts against a job.
 */
export const M2_CAPS = Object.freeze({
  maxInputTokens: { [M2_REPLAN]: 15_000_000, [M2_LONG_SESSION]: 40_000_000, "beam-1m": 60_000_000, "longmemeval-m": 60_000_000 },
  wallTimeCapHours: { [M2_REPLAN]: 24, [M2_LONG_SESSION]: 24, suite: 72 },
  concurrency: 1,
  maxOutputTokens: 8192,
});
export const M2_CEILING = 1_000_000_000_000;
/** The planning estimate stated in the gate record (not a cap), from gate M-1's measured job sizes. */
export const M2_ESTIMATE = Object.freeze({
  tokensPerJob: { [M2_REPLAN]: 3_000_000, [M2_LONG_SESSION]: 10_000_000, "beam-1m": 9_000_000, "longmemeval-m": 11_000_000 },
  basis: "gate M-1 run reports (217/runs): family jobs 3-14M input tokens on 16 personas, STM suite jobs 3.8-5.5M on two questions",
});
/**
 * The sittings, in run order. 1: the re-plan family (M1). 2: plan 217's S1 re-measure on MiMo (three repeats of every
 * arm). 3: the M5 suite sample. 4: the long-session family on the gate models (cost rows and S1 context).
 */
export const M2_SITTINGS = Object.freeze({ 1: "re-plan", 2: "s1", 3: "suites", 4: "long-session" });

/** The development question ids of a suite (the committed draw). */
export const m2DevIds = (suite) => Object.values(ROBUSTNESS_DRAWS[suite].abilities.dev).flat();

export function assertM2Partition(partition) {
  if (partition !== M2_PARTITION)
    throw new Error(
      `M2Partition: gate M-2 reads the ${M2_PARTITION} partition only; ${partition ?? "(none)"} belongs to gate A (plan 223)`,
    );
  return partition;
}

const safe = (value) => value.replace(/[^A-Za-z0-9.+_-]/g, "_");
const arm = (id) => M2_ARMS.find((entry) => entry.id === id);

/** One live family job (`work-outcome/long-session-live.mjs --gate M-2`). Ids: `218-m2.<model>.<arm>.<family>[.r<n>]`. */
export function m2FamilyJob(model, armId, family, { repeat = 1, repeats = 1, sitting, worktree = M2_WORKTREE } = {}) {
  const entry = arm(armId);
  return {
    id: `218-m2.${model.key}.${armId}.${family}${repeats > 1 ? `.r${repeat}` : ""}`,
    kind: "long-session",
    gate: M2_GATE_ID,
    family: `218-m2.${model.key}.${family}${repeats > 1 ? `.r${repeat}` : ""}`,
    workFamily: family,
    repeat,
    role: armId,
    arm: armId,
    model_key: model.key,
    suite: family,
    subset: M2_PARTITION,
    provider: model.provider,
    model: model.model,
    maxInputTokens: M2_CAPS.maxInputTokens[family],
    maxOutputTokens: M2_CAPS.maxOutputTokens,
    wallTimeCapHours: M2_CAPS.wallTimeCapHours[family],
    stateDir: `${M2_CACHE}/${family}`,
    sitting,
    ...(entry.tree === "om-before" ? { cwd: worktree } : {}),
  };
}

/** One QA suite job (`run.mjs`), the first `M2_SUITE_QUESTIONS` dev questions. Ids: `218-m2.<model>.<arm>.<suite>`. */
export function m2SuiteJob(model, armId, suite, { sitting } = {}) {
  const entry = arm(armId);
  return {
    id: `218-m2.${model.key}.${armId}.${suite}`,
    kind: "robustness",
    family: `218-m2.${model.key}.${suite}`,
    role: armId,
    arm: armId,
    model_key: model.key,
    suite,
    subset: M2_PARTITION,
    config: entry.config,
    provider: model.provider,
    model: model.model,
    judges: M2_JUDGES.join(","),
    judgeText: true,
    labelInjections: "off",
    maxInputTokens: M2_CAPS.maxInputTokens[suite],
    maxOutputTokens: M2_CAPS.maxOutputTokens,
    maxQuestions: M2_SUITE_QUESTIONS,
    concurrency: M2_CAPS.concurrency,
    wallTimeCapHours: M2_CAPS.wallTimeCapHours.suite,
    finalTurnAnswer: true,
    interleaveAbilities: true,
    strictQuestions: true,
    ...(entry.wmScope ? { wmScope: true } : {}),
    ...(entry.ablate.length ? { ablate: [...entry.ablate] } : {}),
    // A paired comparison never shares answer or judge checkpoints between its arms.
    answersDir: `${M2_CACHE}/${model.key}/${safe(armId)}/${suite}/answers`,
    judgeCacheDir: `${M2_CACHE}/${model.key}/${safe(armId)}/${suite}/judge`,
    sitting,
  };
}

/** The job list in run order; arms of one item set run back to back, so a halt leaves whole pairs. */
export function m2Jobs({ worktree = M2_WORKTREE } = {}) {
  const ids = M2_ARMS.map((entry) => entry.id);
  const jobs = [];
  for (const model of M2_MODELS) for (const id of ids) jobs.push(m2FamilyJob(model, id, M2_REPLAN, { sitting: 1, worktree }));
  for (let repeat = 1; repeat <= M2_S1_REPEATS; repeat++)
    for (const id of ids)
      jobs.push(m2FamilyJob(M2_S1_MODEL, id, M2_LONG_SESSION, { repeat, repeats: M2_S1_REPEATS, sitting: 2, worktree }));
  for (const model of M2_MODELS)
    for (const suite of M2_SUITES) for (const id of M2_SUITE_ARMS) jobs.push(m2SuiteJob(model, id, suite, { sitting: 3 }));
  for (const model of M2_MODELS) for (const id of ids) jobs.push(m2FamilyJob(model, id, M2_LONG_SESSION, { sitting: 4, worktree }));
  return jobs;
}

/** Every group of the job list differs only in the arm (and what makes it): same items, model, judges and flags. */
export function assertM2Paired(jobs) {
  const strip = ({
    id: _id,
    role: _role,
    arm: _arm,
    config: _config,
    cwd: _cwd,
    answersDir: _a,
    judgeCacheDir: _j,
    wmScope: _s,
    ablate: _ab,
    ...rest
  }) => stableHash(rest);
  const groups = new Map();
  for (const job of jobs) {
    const key = `${job.model_key}|${job.suite}|${job.repeat ?? 1}`;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  for (const [key, group] of groups) {
    const arms = group.map((job) => job.arm).sort();
    const expected = (group[0].kind === "robustness" ? [...M2_SUITE_ARMS] : M2_ARMS.map((entry) => entry.id)).sort();
    if (JSON.stringify(arms) !== JSON.stringify(expected))
      throw new Error(`M2Jobs: ${key} does not hold every arm once (${arms.join(", ")})`);
    if (new Set(group.map(strip)).size !== 1) throw new Error(`M2Jobs: the arms of ${key} differ in more than the arm`);
  }
  for (const job of jobs) {
    if (job.subset !== M2_PARTITION) throw new Error(`M2Jobs: ${job.id} reads ${job.subset}`);
    const expected = arm(job.arm);
    if (
      job.kind === "robustness" &&
      (Boolean(job.wmScope) !== expected.wmScope || JSON.stringify(job.ablate ?? []) !== JSON.stringify(expected.ablate))
    )
      throw new Error(`M2Jobs: ${job.id} does not run its arm's switches`);
    if ((job.cwd !== undefined) !== (expected.tree === "om-before")) throw new Error(`M2Jobs: ${job.id} runs from the wrong tree`);
  }
  return jobs;
}

export function m2ManifestHash(manifest) {
  const { gate: _gate, manifestHash: _hash, generatedAt: _at, ...rest } = manifest;
  return stableHash(rest);
}

export function m2Estimate(jobs = m2Jobs()) {
  const tokens = jobs.reduce((n, job) => n + M2_ESTIMATE.tokensPerJob[job.suite], 0);
  return { jobs: jobs.length, inputTokens: tokens, basis: M2_ESTIMATE.basis, billing: "OpenCode Go subscription usage windows" };
}

/** The offline rows must read `works` before any paid call (Task 5's probes, M2-M4 and the WM mechanism). */
export function assertM2OfflineRows(probes) {
  const rows = probes?.probes ?? [];
  const wm = rows.filter((probe) => probe.group === "wm");
  if (wm.length < 10) throw new Error(`M2Probes: ${M2_PROBES} holds ${wm.length} WM probes, not 10`);
  const failing = wm.filter((probe) => probe.verdict !== "works").map((probe) => probe.id);
  if (failing.length) throw new Error(`M2Probes: ${failing.join(", ")} does not read works; the paid run waits for the offline rows`);
  const offline = m2OfflineRows(probes);
  for (const id of ["M2", "M3", "M4"]) {
    const status = memoryModelGateVerdict(M2_GATE_ID, { ...m2Pin(), rows: offline }).rows.find((row) => row.row === id)?.status;
    if (status !== "pass") throw new Error(`M2Probes: row ${id} reads ${status ?? "missing"} offline`);
  }
  return probes;
}

/** The pin fields every M-2 evidence file carries. */
function m2Pin() {
  return { ...memoryModelManifestPin({ gate: M2_GATE_ID }), gate: M2_GATE_ID, partition: M2_PARTITION };
}

export async function buildM2Manifest({ root = ".", worktree = M2_WORKTREE } = {}) {
  const baselines = JSON.parse(await readFile(join(root, M2_BASELINES), "utf8"));
  const productHash = await m2ProductFingerprint(root);
  const harnessHash = await fileFingerprint([...M2_HARNESS_PATHS], root);
  const probes = JSON.parse(await readFile(join(root, M2_PROBES), "utf8"));
  const om = baselines.omBefore;
  const jobs = assertM2Paired(m2Jobs({ worktree }));
  const label = `wm-${productHash.slice(0, 32)}`;
  const manifest = {
    kind: "218-m2-gate-manifest",
    schemaVersion: 1,
    plan: M2_PLAN,
    task: M2_TASK,
    gateId: M2_GATE_ID,
    partition: M2_PARTITION,
    status: "proposal",
    executable: false,
    ...memoryModelManifestPin({ gate: M2_GATE_ID }),
    rows: [...MEMORY_MODEL_CRITERIA.gates[M2_GATE_ID].rows],
    fixtures: {
      "long-session": assertMemoryModelFixture("long-session"),
      "long-session-replay": assertMemoryModelFixture("long-session-replay"),
      "re-plan": assertMemoryModelFixture("re-plan"),
    },
    probes: { path: M2_PROBES, sha256: stableHash(probes), fixture: probes.fixture ?? null },
    baselines: { omBefore: { revision: om.revision, productHash: om.productHash, productPaths: om.productPaths, worktree } },
    productHash,
    productPaths: [...M2_PRODUCT_PATHS],
    productExcludes: "test files: __tests__/ directories and *.test.* (owner, 2026-11-12)",
    harnessHash,
    harnessPaths: [...M2_HARNESS_PATHS],
    // The report's source label per arm: a commit cannot orphan a checkpoint, and OM-before's is the pinned revision.
    productRevision: { WM: label, "STM-only": label, "OM-before": om.revision },
    provider: M2_PROVIDER,
    model: "218-m2-panel",
    ceiling: M2_CEILING,
    journalPath: M2_JOURNAL,
    summaryPath: `${M2_RUNS}/execution-run.json`,
    models: {
      answers: M2_MODELS.map((model) => ({ key: model.key, ref: refOf(model), family: model.family })),
      s1: { key: M2_S1_MODEL.key, ref: refOf(M2_S1_MODEL), scope: M2_LONG_SESSION, repeats: M2_S1_REPEATS },
      judges: [...M2_JUDGES],
      worker: "each arm's answer model: STM, WM and the pre-216 observer calls go to the answer route",
      judgesDoNotAnswer: true,
    },
    billing: {
      mode: "subscription",
      provider: M2_PROVIDER,
      plan: "OpenCode Go subscription (rolling usage windows; a spent window is waited out)",
      paidAnswers: M2_ANSWER_MODELS.map((model) => refOf(model)),
      paidJudges: [...M2_JUDGES],
      paidFallbacks: [],
    },
    interruptions:
      "429s, spent usage windows, empty replies, timeouts and dropped sockets are re-run from the job's answer/judge (or persona) checkpoints after a cooldown and never count against its attempts; a question that errors fails the job (--strict-questions) instead of being scored",
    caps: { ...M2_CAPS, journalCeiling: M2_CEILING },
    estimate: m2Estimate(jobs),
    sittings: M2_SITTINGS,
    cohort: {
      ...Object.fromEntries(
        M2_SUITES.map((suite) => [
          suite,
          {
            partition: M2_PARTITION,
            questions: M2_SUITE_QUESTIONS,
            of: m2DevIds(suite).length,
            idsHash: ROBUSTNESS_DRAWS[suite].idsHash,
            underpowered: true,
          },
        ]),
      ),
      [M2_REPLAN]: { partition: M2_PARTITION, fixtureHash: assertMemoryModelFixture("re-plan") },
      [M2_LONG_SESSION]: { partition: M2_PARTITION, fixtureHash: assertMemoryModelFixture("long-session") },
    },
    arms: M2_ARMS.map((entry) => ({ ...entry, base: entry.id === "WM" ? null : "WM" })),
    pairing:
      "every arm is paired with WM on identical items: the same question ids (suites), personas and repeat (families), answer model, judges and flags; an item one arm did not finish is reported unpaired, never imputed",
    caveats: [
      "STM-only's deterministic WM policy discards a changed value to meet the target (probe wm.knowledge-update): it protects no supersedes record",
      `M5 reads ${M2_SUITE_QUESTIONS} questions per suite and model: underpowered, a screen; the QA decision stays at gate A`,
    ],
    results: [],
    jobs,
  };
  manifest.manifestHash = m2ManifestHash(manifest);
  assertMemoryModelPin({ ...manifest, gate: M2_GATE_ID });
  return manifest;
}

export async function writeM2Manifest({ root = "." } = {}) {
  const manifest = await buildM2Manifest({ root });
  await mkdir(join(root, M2_DIR), { recursive: true });
  await writeFile(join(root, M2_MANIFEST), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...manifest }, null, 2)}\n`);
  return manifest;
}

/** The owner's approval, bound to the manifest hash. Pure: checks, never writes. */
export function assertM2Gate(gate, manifest) {
  const refuse = (reason) => {
    throw new Error(`M2Gate: ${reason}`);
  };
  if (!gate || typeof gate !== "object") refuse("no gate record");
  if (gate.kind !== "memory-model-owner-gate" || gate.plan !== M2_PLAN || gate.gate !== M2_GATE_ID)
    refuse("the record is not plan 218 gate M-2");
  if (gate.closed)
    refuse(`gate M-2 was closed by the ${gate.closed.by ?? "owner"} on ${gate.closed.at ?? "an unrecorded date"}; it does not run again`);
  if (gate.approved !== true || gate.approvedBy !== "owner")
    refuse("the gate is not approved by the owner (the run starts only on the owner's word)");
  if (typeof gate.text !== "string" || !gate.text.trim()) refuse("the gate carries no owner text");
  if (gate.manifestHash !== manifest.manifestHash)
    refuse("the manifest differs from the approved one; a changed manifest is a refusal, not a re-approval");
  if (gate.memoryModelCriteriaHash !== manifest.memoryModelCriteriaHash) refuse("the gate pins different memory-model criteria");
  if (gate.criteriaHash !== manifest.criteriaHash) refuse("the gate pins different robustness criteria");
  if (JSON.stringify(gate.partitions) !== JSON.stringify([M2_PARTITION])) refuse("gate M-2 lists the dev partition only");
  if (gate.budget?.provider !== M2_PROVIDER || gate.budget?.billing !== "subscription")
    refuse("the budget is not the OpenCode Go subscription");
  const routes = new Set([...M2_ANSWER_MODELS.map((model) => refOf(model)), ...M2_JUDGES]);
  const named = [...Object.values(gate.models?.answers ?? {}), gate.models?.s1, ...(gate.models?.judges ?? [])].filter(Boolean);
  if (!named.length || named.some((ref) => !routes.has(ref))) refuse("the gate names a route outside the gate M-2 models");
  if (named.some((ref) => /openrouter\/.*free|:free$|-free$/.test(ref))) refuse("never openrouter/free or a free route");
  const answers = new Set([...Object.values(gate.models?.answers ?? {}), gate.models?.s1]);
  if ((gate.models?.judges ?? []).some((ref) => answers.has(ref))) refuse("a judge never answers");
  return gate;
}

export async function readM2Gate({ root = "." } = {}) {
  const path = join(root, M2_GATE);
  if (!existsSync(path)) throw new Error(`M2Gate: no gate record at ${M2_GATE}; the owner approves gate M-2 before any live call`);
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * The executable manifest: the proposal plus a verified gate and passing offline rows. `PRISM_MEMORY_BENCH_218_JOBS`
 * (comma-separated id substrings) runs a subset of the approved jobs unchanged; `PRISM_MEMORY_BENCH_218_SITTING` runs
 * one sitting; a bounded smoke (`PRISM_MEMORY_BENCH_218_SMOKE=1`) runs one persona or one question per job in its own
 * journal.
 */
export async function buildExecutableM2Manifest({
  root = ".",
  only = process.env.PRISM_MEMORY_BENCH_218_JOBS,
  sitting = process.env.PRISM_MEMORY_BENCH_218_SITTING,
  smoke = process.env.PRISM_MEMORY_BENCH_218_SMOKE === "1",
} = {}) {
  const manifest = await buildM2Manifest({ root });
  const gate = assertM2Gate(await readM2Gate({ root }), manifest);
  assertM2OfflineRows(JSON.parse(await readFile(join(root, M2_PROBES), "utf8")));
  const patterns = String(only ?? "")
    .split(",")
    .filter(Boolean);
  let jobs = patterns.length ? manifest.jobs.filter((job) => patterns.some((pattern) => job.id.includes(pattern))) : manifest.jobs;
  if (sitting) jobs = jobs.filter((job) => String(job.sitting) === String(sitting));
  if (!jobs.length) throw new Error(`M2: no approved job matches ${only ?? ""} ${sitting ? `sitting ${sitting}` : ""}`.trim());
  const selector = `${smoke ? "smoke:" : ""}${patterns.join(",")}${sitting ? `|s${sitting}` : ""}`;
  // The manifest hash is part of the tag: a re-bound gate (a new manifest) starts a fresh journal instead of finding the
  // old one finished (gate M-2, the re-run after the worker fix).
  const tag = stableHash(`${manifest.manifestHash}|${selector}`).slice(0, 8);
  return {
    ...manifest,
    jobs: smoke ? jobs.map((job) => (job.kind === "long-session" ? { ...job, personaLimit: 1 } : { ...job, maxQuestions: 1 })) : jobs,
    ...(tag
      ? {
          worker: tag,
          journalPath: `${M2_CACHE}/journal-${smoke ? "smoke" : "worker"}-${tag}.json`,
          summaryPath: `${M2_RUNS}/execution-${smoke ? "smoke" : "run-worker"}-${tag}.json`,
          executionManifestPath: `${M2_RUNS}/execution-manifest-${smoke ? "smoke" : "worker"}-${tag}.json`,
          outputPrefix: smoke ? "smoke-218-m2" : M2_OUTPUT_PREFIX,
        }
      : {}),
    status: "approved",
    executable: true,
    gate: { path: M2_GATE, manifestHash: gate.manifestHash, approvedAt: gate.approvedAt },
  };
}

/** The pinned OM-before worktree with the family files copied in byte for byte; refuses anything else. */
export async function prepareM2Worktree({
  root = ".",
  worktree = M2_WORKTREE,
  revision,
  productHash,
  productPaths,
  run = Bun.spawnSync,
} = {}) {
  const dir = join(root, worktree);
  if (!existsSync(dir))
    throw new Error(
      `M2Worktree: ${worktree} is missing (git worktree add --detach ${worktree} ${revision}; bun install --frozen-lockfile)`,
    );
  const head = run(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  if (head !== revision)
    throw new Error(`M2Worktree: ${worktree} is at ${head.slice(0, 8) || "(none)"}, not the pinned ${revision.slice(0, 8)}`);
  if (!existsSync(join(dir, "node_modules")))
    throw new Error(`M2Worktree: ${worktree} has no node_modules (bun install --frozen-lockfile)`);
  for (const path of M2_WORKTREE_COPY) await cp(join(root, path), join(dir, path), { recursive: true, force: true });
  const files = M2_WORKTREE_COPY.filter((path) => path.includes("."));
  const copied = await fileFingerprint(files, dir);
  if (copied !== (await fileFingerprint(files, root))) throw new Error("M2Worktree: the copied harness differs from this tree's");
  const product = await sourceFingerprint(productPaths, dir);
  if (product !== productHash) throw new Error("M2Worktree: the worktree's observational product does not hash to the pinned productHash");
  return { worktree, revision: head, productHash: product, harness: copied };
}

/** Every route in the OpenCode Go catalog, the worktree pinned, the fixtures hashed; nothing runs otherwise. */
export async function preflightM2(manifest, options = {}) {
  const refs = [
    ...new Set(manifest.jobs.flatMap((job) => [`${job.provider}/${job.model}`, ...(job.judges ? job.judges.split(",") : [])])),
  ].sort();
  const allowed = new Set([...M2_ANSWER_MODELS.map((model) => refOf(model)), ...M2_JUDGES]);
  const foreign = refs.filter((ref) => !allowed.has(ref));
  if (foreign.length) throw new Error(`M2Preflight: ${foreign.join(", ")} is not a gate M-2 route`);
  for (const id of Object.keys(manifest.fixtures)) assertMemoryModelFixture(id);
  const worktree = manifest.jobs.some((job) => job.cwd)
    ? await (options.prepareWorktree ?? prepareM2Worktree)({ root: options.root ?? ".", ...manifest.baselines.omBefore })
    : null;
  const list = options.list ?? (await import("@arnilo/prism-ai/opencode-go")).listOpenCodeGoModels;
  const key = options.apiKey ?? process.env.OPENCODE_GO_API_KEY;
  if (!key) throw new Error("M2Preflight: OPENCODE_GO_API_KEY is unavailable");
  const catalog = await list({ apiKey: () => key, signal: AbortSignal.timeout(60_000) });
  const ids = new Set(catalog.map((model) => model.model));
  const missing = refs.filter((ref) => !ids.has(ref.slice(M2_PROVIDER.length + 1)));
  if (missing.length) throw new Error(`M2Preflight: ${missing.join(", ")} is not in the OpenCode Go catalog`);
  const record = { kind: "218-m2-preflight", checkedAt: new Date().toISOString(), refs, worktree };
  if (!options.dryRun) {
    await mkdir(M2_RUNS, { recursive: true });
    await writeFile(`${M2_RUNS}/preflight${manifest.worker ? `-${manifest.worker}` : ""}.json`, `${JSON.stringify(record, null, 2)}\n`);
  }
  return record;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* The evidence (`acceptance-report.mjs --plan memory-model --gate M-2 --build`). Ids, counts, scores and hashes only. */
/* ------------------------------------------------------------------------------------------------------------------ */

export const loadM2Reports = (dir = M2_RUNS) => loadM1Reports(dir, `${M2_OUTPUT_PREFIX}-`);

const round = (value, digits = 4) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const sum = (values) => values.reduce((n, value) => n + (Number.isFinite(value) ? value : 0), 0);
const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] : null;
};
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const completed = (report) => report?.status === "completed";

/**
 * A paired family comparison on one model: `metric(row)` per (repeat, persona, pair), clustered by persona, oriented
 * so positive is better for the candidate. `lowerIsBetter` flips the sign (re-derivations); `scale` makes points.
 */
export function m2FamilyPair(
  baseJobs,
  candidateJobs,
  baseArm,
  candidateArm,
  { metric, lowerIsBetter = false, scale = 1, iterations = 4000 } = {},
) {
  const rows = (jobs, armId) =>
    new Map(jobs.flatMap((job) => (job?.report?.rows?.[armId] ?? []).map((row) => [`${job.repeat ?? 1}:${row.persona}:${row.pair}`, row])));
  const base = rows(baseJobs, baseArm);
  const candidate = rows(candidateJobs, candidateArm);
  const ids = [...base.keys()].filter((id) => candidate.has(id)).sort();
  if (!ids.length) return { n: 0, status: "not-computable" };
  const pick = (map) => ids.map((id) => ({ id, cluster: map.get(id).persona, value: metric(map.get(id)) * scale }));
  const { diff, ci95 } = pairedClusterPermutation(pick(base), pick(candidate), { iterations });
  const sign = lowerIsBetter ? -1 : 1;
  const [low, high] = lowerIsBetter ? [-ci95[1], -ci95[0]] : ci95;
  return {
    n: ids.length,
    clusters: new Set(ids.map((id) => base.get(id).persona)).size,
    repeats: new Set(ids.map((id) => id.split(":")[0])).size,
    unpaired: { base: base.size - ids.length, candidate: candidate.size - ids.length },
    baseMean: round(sum(ids.map((id) => metric(base.get(id)) * scale)) / ids.length),
    candidateMean: round(sum(ids.map((id) => metric(candidate.get(id)) * scale)) / ids.length),
    estimate: round(sign * diff, 2),
    ciLow: round(low, 2),
    ciHigh: round(high, 2),
  };
}

/** M5 on one model: WM - STM-only accuracy (points), every suite's identical items pooled, clustered per question. */
export function m2AccuracyPair(stmReports, wmReports, { iterations = 4000 } = {}) {
  const base = [];
  const candidate = [];
  const unpaired = { base: 0, arm: 0 };
  const coverage = {};
  for (const [suite, stm] of Object.entries(stmReports)) {
    const wm = wmReports[suite];
    const pair = pairOnIdenticalItems(stm, wm, suite);
    base.push(...pair.base);
    candidate.push(...pair.arm);
    unpaired.base += pair.unpaired.base;
    unpaired.arm += pair.unpaired.arm;
    // All-required evidence coverage of WM's rows per ability, over the paired items (the QA rows' coverage rule).
    const wmRows = new Map((wm?.results ?? []).map((row) => [row.id, row]));
    for (const ability of [...new Set(pair.arm.map((row) => row.ability))].sort()) {
      const values = pair.ids
        .map((id) => wmRows.get(id))
        .filter((row) => row?.ability === ability && typeof row.evidenceAllRequired === "boolean");
      if (values.length) coverage[`${suite}:${ability}`] = round(values.filter((row) => row.evidenceAllRequired).length / values.length);
    }
  }
  if (!base.length) return { n: 0, status: "not-computable", unpaired };
  const result = pairedAnalysis(base, candidate, { iterations });
  return {
    n: result.n,
    clusters: result.clusters,
    unpaired,
    stmOnlyCorrect: base.filter((row) => row.correct).length,
    wmCorrect: candidate.filter((row) => row.correct).length,
    estimate: round(result.diff * 100, 2),
    ciLow: round(result.ci95[0] * 100, 2),
    ciHigh: round(result.ci95[1] * 100, 2),
    underpowered: true,
    coverage,
  };
}

/** M2-M4 from Task 5's offline probes, in the criteria's evidence shape. */
export function m2OfflineRows(probes) {
  const probe = (id) => probes?.probes?.find((row) => row.id === id && row.verdict === "works");
  const protectedProbe = probe("wm.protected");
  const ratio = probe("wm.target-ratio");
  const prefix = probe("wm.prefix-stable");
  return {
    M2: protectedProbe
      ? { source: M2_PROBES, tests: { loss: { value: protectedProbe.counts.lost, refused: protectedProbe.counts.refused } } }
      : { tests: {} },
    M3: ratio
      ? {
          source: M2_PROBES,
          tests: { ratio: { value: ratio.counts.medianRatio, target: ratio.counts.target, eligiblePasses: ratio.counts.eligiblePasses } },
        }
      : { tests: {} },
    M4: prefix
      ? {
          source: M2_PROBES,
          tests: {
            prefix: {
              value: prefix.counts.breaksWithoutCompaction === 0 ? "byte-identical" : "changed",
              breaksWithoutCompaction: prefix.counts.breaksWithoutCompaction,
              compactions: prefix.counts.compactions,
            },
          },
        }
      : { tests: {} },
  };
}

/** WM's own cost and behaviour on one family job: calls, cap stops, items per pass, ratio, compactions, cache share. */
export function m2FamilyCost(job, armId) {
  const usage = (job?.report?.usage ?? []).filter((row) => row.arm === armId);
  if (!usage.length) return { status: job?.status ?? "missing" };
  const eligible = sum(usage.map((row) => row.eligibleTokens));
  const worker = sum(usage.map((row) => (row.worker?.inputTokens ?? 0) + (row.worker?.outputTokens ?? 0)));
  const wm = usage.map((row) => row.wmCalls).filter(Boolean);
  const session = usage.map((row) => row.session).filter(Boolean);
  const passes = sum(session.map((row) => row.passes));
  const ratios = session.flatMap((row) => row.ratios ?? []);
  const items = session.flatMap((row) => row.items ?? []);
  const input = sum(usage.map((row) => (row.main?.inputTokens ?? 0) + (row.worker?.inputTokens ?? 0)));
  const cached = sum(usage.map((row) => (row.main?.cacheReadTokens ?? 0) + (row.worker?.cacheReadTokens ?? 0)));
  return {
    status: job?.status ?? "missing",
    personas: usage.length,
    workerCalls: sum(usage.map((row) => row.worker?.calls)),
    workerTokensPer10kEligible: eligible ? round((worker / eligible) * 10_000, 1) : null,
    ...(wm.length
      ? {
          wmCalls: sum(wm.map((row) => row.calls)),
          wmCapStops: sum(wm.map((row) => row.capStops)),
          wmCapNoItem: sum(wm.map((row) => row.capNoItem)),
          wmItems: sum(wm.map((row) => row.items)),
        }
      : {}),
    ...(session.length
      ? {
          wmPasses: passes,
          itemsPerPass: passes ? round(sum(items) / passes, 2) : null,
          budgetUnmetShare: passes ? round(sum(session.map((row) => row.budgetUnmet)) / passes) : null,
          ratio: ratios.length
            ? {
                n: ratios.length,
                median: round(median(ratios)),
                p10: quantile(ratios, 0.1),
                p90: quantile(ratios, 0.9),
                max: Math.max(...ratios),
              }
            : null,
          compactions: sum(session.map((row) => row.compactions)),
        }
      : {}),
    cachedInputShare: input ? round(cached / input) : null,
    inputTokens: job?.inputTokens ?? null,
    successRate: job?.report?.summary?.[armId]?.successRate ?? null,
    rederivationsPerRelatedTask: job?.report?.summary?.[armId]?.rederivationsPerRelatedTask ?? null,
  };
}

/** A suite job's cost row: worker tokens per question, WM call stops, cached-input share, cost and p95 answer time. */
export function m2SuiteCost(report) {
  const rows = (report?.results ?? []).filter((row) => row.outcome === "scored" || row.outcome === "answered");
  const worker = sum(Object.values(report?.workerUsage ?? {}).map((row) => (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0)));
  return {
    status: report?.status ?? "missing",
    questions: rows.length,
    workerTokensPerQuestion: rows.length ? round(worker / rows.length, 1) : null,
    wmCalls: report?.wmCalls ?? null,
    cachedInputShare: report?.inputTokens ? round((report.cacheReadTokens ?? 0) / report.inputTokens) : null,
    inputTokens: report?.inputTokens ?? null,
    costUsd: report?.cost?.measured ?? null,
    p95AnswerMs: quantile(
      rows.map((row) => row.phaseTiming?.answer),
      0.95,
    ),
  };
}

/**
 * The gate's evidence from the run reports and the Task 5 probe file. Every value is computed; a cell whose reports
 * are missing or unfinished stays out, so its row reads `missing`, never `pass`.
 */
export function buildM2Evidence({ reports, manifest, probes, iterations = 4000 }) {
  const get = (model, armId, scope, repeat) => reports.get(`218-m2.${model}.${armId}.${scope}${repeat ? `.r${repeat}` : ""}`);
  const jobOf = (id) => manifest.jobs?.find((job) => job.id === id);
  const cells = {};
  const performance = {};
  const m1 = { "vs-stm-only": [], "vs-om-before": [] };
  const m1Rederivations = { "vs-stm-only": [], "vs-om-before": [] };
  const m5 = [];
  const coverage = {};
  const successOf = (row) => (row.success ? 1 : 0);
  for (const { key: model } of M2_MODELS) {
    performance[model] = {};
    // M1: the re-plan family.
    const family = Object.fromEntries(M2_ARMS.map((entry) => [entry.id, get(model, entry.id, M2_REPLAN)]));
    performance[model][M2_REPLAN] = Object.fromEntries(M2_ARMS.map((entry) => [entry.id, m2FamilyCost(family[entry.id], entry.id)]));
    for (const [test, baseArm] of [
      ["vs-stm-only", "STM-only"],
      ["vs-om-before", "OM-before"],
    ]) {
      if (!completed(family.WM) || !completed(family[baseArm])) {
        cells[`${model}.${M2_REPLAN}.${test}`] = "missing";
        continue;
      }
      const pair = m2FamilyPair([family[baseArm]], [family.WM], baseArm, "WM", { metric: successOf, scale: 100, iterations });
      cells[`${model}.${M2_REPLAN}.${test}`] = pair.n ? "paired" : "not-computable";
      if (pair.n) m1[test].push({ model, ...pair });
      // Beside M1, never in its verdict: re-derivations per post-re-plan task (positive = WM re-derives less).
      const rederived = m2FamilyPair([family[baseArm]], [family.WM], baseArm, "WM", {
        metric: (row) => row.rederivations,
        lowerIsBetter: true,
        iterations,
      });
      if (rederived.n) m1Rederivations[test].push({ model, ...rederived });
    }
    // M5: the QA suite sample, WM against STM-only.
    const stm = {};
    const wm = {};
    performance[model].suites = {};
    let suitesDone = true;
    for (const suite of M2_SUITES) {
      const stmReport = get(model, "STM-only", suite);
      const wmReport = get(model, "WM", suite);
      performance[model].suites[suite] = { "STM-only": m2SuiteCost(stmReport), WM: m2SuiteCost(wmReport) };
      const done =
        m1SuiteDone(stmReport, jobOf(`218-m2.${model}.STM-only.${suite}`)) && m1SuiteDone(wmReport, jobOf(`218-m2.${model}.WM.${suite}`));
      if (!done) suitesDone = false;
      stm[suite] = stmReport;
      wm[suite] = wmReport;
    }
    if (!suitesDone) cells[`${model}.suites`] = "missing";
    else {
      const pair = m2AccuracyPair(stm, wm, { iterations });
      cells[`${model}.suites`] = pair.n ? "paired" : "not-computable";
      if (pair.n) {
        const { coverage: perAbility, ...rest } = pair;
        m5.push({ model, ...rest });
        Object.assign(coverage, Object.fromEntries(Object.entries(perAbility).map(([key, value]) => [`${model}:${key}`, value])));
      }
    }
    // The long-session family on the gate models: cost rows and S1 context, never a verdict.
    performance[model][M2_LONG_SESSION] = Object.fromEntries(
      M2_ARMS.map((entry) => [entry.id, m2FamilyCost(get(model, entry.id, M2_LONG_SESSION), entry.id)]),
    );
  }
  // Plan 217's S1 miss, carried: MiMo, three repeats per arm, re-derivations per related task against OM-before.
  const s1Jobs = (armId) => Array.from({ length: M2_S1_REPEATS }, (_, index) => get(M2_S1_MODEL.key, armId, M2_LONG_SESSION, index + 1));
  const s1Done = (armId) => s1Jobs(armId).every(completed);
  const rederivations = (row) => row.rederivations;
  const s1 = { model: M2_S1_MODEL.key, repeats: M2_S1_REPEATS, plan217: { estimate: -0.34, ciLow: -0.69, ciHigh: -0.06 } };
  for (const candidate of ["WM", "STM-only"]) {
    if (!s1Done("OM-before") || !s1Done(candidate)) {
      s1[`${candidate} - OM-before`] = { status: "missing" };
      continue;
    }
    const pair = m2FamilyPair(s1Jobs("OM-before"), s1Jobs(candidate), "OM-before", candidate, {
      metric: rederivations,
      lowerIsBetter: true,
      iterations,
    });
    s1[`${candidate} - OM-before`] = pair;
  }
  const below = ["WM", "STM-only"].every(
    (candidate) => typeof s1[`${candidate} - OM-before`]?.ciHigh === "number" && s1[`${candidate} - OM-before`].ciHigh < 0,
  );
  s1.result = ["WM", "STM-only"].some((candidate) => s1[`${candidate} - OM-before`]?.status === "missing")
    ? "missing"
    : below
      ? "miss: both new arms re-derive more than OM-before (interval below zero); to the owner before plan 219"
      : "not below zero for both new arms: plan 217's S1 miss does not reproduce as a separation on MiMo";
  if (below) {
    const perPersona = {};
    for (const armId of ["OM-before", "WM", "STM-only"])
      for (const job of s1Jobs(armId))
        for (const row of job?.report?.rows?.[armId] ?? []) {
          perPersona[row.persona] ??= {};
          perPersona[row.persona][armId] = (perPersona[row.persona][armId] ?? 0) + row.rederivations;
        }
    s1.perPersona = perPersona;
  }
  performance[M2_S1_MODEL.key] = {
    [M2_LONG_SESSION]: Object.fromEntries(
      M2_ARMS.map((entry) => [entry.id, s1Jobs(entry.id).map((job, index) => ({ repeat: index + 1, ...m2FamilyCost(job, entry.id) }))]),
    ),
  };
  // WM's output cap, per answer model: calls, stops at the cap, and cap stops that wrote no item.
  const wmCap = {};
  for (const model of [...M2_MODELS, M2_S1_MODEL].map((entry) => entry.key)) {
    const rows = [];
    for (const [scope, value] of Object.entries(performance[model] ?? {})) {
      const cellsOf =
        scope === "suites"
          ? Object.values(value).map((arms) => arms.WM?.wmCalls)
          : [value.WM]
              .flat()
              .map((row) => row && { calls: row.wmCalls, capStops: row.wmCapStops, capNoItem: row.wmCapNoItem, items: row.wmItems });
      for (const cell of cellsOf) if (cell && Number.isFinite(cell.calls)) rows.push(cell);
    }
    wmCap[model] = rows.length
      ? {
          calls: sum(rows.map((row) => row.calls)),
          capStops: sum(rows.map((row) => row.capStops)),
          capNoItem: sum(rows.map((row) => row.capNoItem)),
          items: sum(rows.map((row) => row.items)),
        }
      : null;
  }
  const offline = m2OfflineRows(probes);
  const all = (list) => list.length === M2_MODELS.length;
  const rows = {
    M1:
      all(m1["vs-stm-only"]) && all(m1["vs-om-before"])
        ? { tests: { "vs-stm-only": { models: m1["vs-stm-only"] }, "vs-om-before": { models: m1["vs-om-before"] } } }
        : { tests: {}, cells: m1 },
    ...offline,
    M5: all(m5)
      ? { tests: { "vs-stm-only": { models: m5, underpowered: true, questionsPerSuite: M2_SUITE_QUESTIONS } }, coverage }
      : { tests: {}, cells: m5 },
  };
  return {
    kind: "218-m2-evidence",
    schemaVersion: 1,
    gate: M2_GATE_ID,
    plan: M2_PLAN,
    partition: M2_PARTITION,
    memoryModelCriteriaHash: manifest.memoryModelCriteriaHash,
    criteriaHash: manifest.criteriaHash,
    manifestHash: manifest.manifestHash,
    fixtures: manifest.fixtures,
    omBefore: { revision: manifest.baselines.omBefore.revision, productHash: manifest.baselines.omBefore.productHash },
    productHash: manifest.productHash,
    caveats: manifest.caveats ?? [],
    cells,
    rows,
    m1Rederivations,
    s1,
    wmOutputCap: wmCap,
    performance,
  };
}

/** Build the evidence from the run reports and write `M-2/evidence.json`; the verdicts come from the criteria only. */
export async function writeM2Evidence({ root = "." } = {}) {
  const manifest = JSON.parse(await readFile(join(root, M2_MANIFEST), "utf8"));
  const reports = await loadM2Reports(join(root, M2_RUNS));
  const probes = JSON.parse(await readFile(join(root, M2_PROBES), "utf8"));
  const evidence = buildM2Evidence({ reports, manifest, probes });
  await mkdir(join(root, M2_DIR), { recursive: true });
  await writeFile(join(root, M2_DIR, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return { evidence, verdict: memoryModelGateVerdict(M2_GATE_ID, evidence, { partition: M2_PARTITION }) };
}
