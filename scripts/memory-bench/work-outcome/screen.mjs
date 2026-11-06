/**
 * Plan 209 Task 6: the owner-gated development screen (gate W-1).
 *
 * The screen is a campaign manifest like any other (`campaign.mjs --plan 209` owns the journal, the lock, the retries
 * and the run summary). This module owns what is specific to plan 209:
 *
 * - the work-outcome jobs: one per (answer model, arm) on the work-outcome `dev` partition, each a child of
 *   `work-outcome/live.mjs`;
 * - the no-harm jobs: `P` and `P+W` on plan 202's development partitions (plan 208's quick slices), large model only,
 *   through the ordinary harness (`run.mjs`);
 * - the gate record, bound to the manifest hash: a changed manifest is a refusal, never a silent re-approval;
 * - the one tuning revision the task allows, refused unless it changes only plan 209's tuning-tier values;
 * - the development report: W1-W6 per model, plan 208's O8 from the `ontology-work` row, the no-harm read.
 *
 * Held-out partitions are not expressible here: they belong to plan 210 Task 9's manifest. Nothing here calls a model.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { memoryFabricConfigSchema } from "@arnilo/prism-memory-fabric";
import { DEFAULT_EXCHANGE_STEPS } from "../../../packages/memory/fabric/src/config.ts";
import { DEFAULT_CAPTURE_RULES_TOKENS } from "../../../packages/memory/fabric/src/delivery/rules.ts";
import { DEFAULT_LESSON_ARCHIVE_SESSIONS, DEFAULT_LESSON_NUDGE_TURNS } from "../../../packages/memory/fabric/src/lessons.ts";
import { sourceFingerprint } from "../acceptance.mjs";
import { ONTOLOGY_PRODUCT_PATHS } from "../audit/readiness.mjs";
import { stableHash } from "../journal.mjs";
import { SCREEN208_JUDGES, SCREEN208_MODELS, SCREEN208_QUICK_QUESTIONS, SCREEN208_SUITES, screen208Job } from "../ontology-screen.mjs";
import { ROBUSTNESS_PARTITIONS, THREE_TIER_CRITERIA } from "../robustness.mjs";
import { pairedAnalysis } from "../stats.mjs";
import { assertWorkOutcomeCriteriaPin, o8Row, WORK_OUTCOME_ARMS, WORK_OUTCOME_CRITERIA, workOutcomeManifestPin } from "./metrics.mjs";

export const SCREEN209_PLAN = 209;
export const SCREEN209_GATE_ID = "W-1";
export const SCREEN209_PARTITION = "dev";
export const SCREEN209_EVIDENCE = "docs/_evidence/memory-bench/209/screen";
export const SCREEN209_GATE = "docs/_evidence/memory-bench/209/gates/owner-gate-w1.json";
export const SCREEN209_MANIFEST = `${SCREEN209_EVIDENCE}/development-screen-manifest.json`;
export const SCREEN209_EXECUTION_MANIFEST = `${SCREEN209_EVIDENCE}/execution-manifest.json`;
export const SCREEN209_SUMMARY = `${SCREEN209_EVIDENCE}/execution-run.json`;
export const SCREEN209_REPORT = `${SCREEN209_EVIDENCE}/development-report.json`;
export const SCREEN209_JOURNAL = ".cache/memory-bench/209/journal.json";
export const SCREEN209_LOGS = ".cache/memory-bench/209/logs";
export const SCREEN209_CHECKPOINTS = ".cache/memory-bench/209/checkpoints";
export const SCREEN209_WIRE = ".cache/memory-bench/209/wire";
export const SCREEN209_OUTPUT_PREFIX = "run-209-task6";

/**
 * Gate W-1 (owner, 2026-11-05): two answer models, one small. `large` was plan 208's free Kilo Nemotron and is now its
 * paid Muse Spark 1.2 (amendment 7, owner, 2026-11-06); `small` is Command Code's paid Qwen 3.7 Flash (rates from plan
 * 208 gate O-1 amendment 6, per million tokens).
 */
export const SCREEN209_MODELS = Object.freeze([
  // Amendment 7 (2026-11-06): the free Kilo Nemotron route refused ~70% of requests (429) through two attempts of every
  // job, so the large model is plan 208's paid Muse Spark 1.2 (rates from gate amendment 3, per million tokens).
  {
    key: "large",
    provider: "commandcode",
    model: "meta/muse-spark-1.2-contributor",
    family: "meta",
    small: false,
    paid: true,
    usdPerMillion: { input: 0.1, output: 0.2, cacheRead: 0.002 },
  },
  {
    key: "small",
    provider: "commandcode",
    model: "Qwen/Qwen3.7-Flash",
    family: "qwen",
    small: true,
    paid: true,
    usdPerMillion: { input: 0.03, output: 0.13, cacheRead: 0.006 },
  },
]);
/**
 * The simulated user (gate amendment 6): Command Code's Qwen3.7-Flash, a fast non-reasoning model with a known rate.
 * The free Kilo cohere route answered 93% of the full screen's simulator requests with 429 (298 of 318 in one job), which
 * would have run the screen past its wall-time cap; Muse reasons past the 4096-token reply bound (amendment 3). Qwen
 * Flash also answers the small-model jobs, so there it plays both roles; the simulator only follows its scripted goal,
 * and `simulatorLeak` guards it. The report states this.
 */
export const SCREEN209_SIMULATOR = "commandcode/Qwen/Qwen3.7-Flash";
export const SCREEN209_SIMULATOR_RATES = Object.freeze({ input: 0.03, output: 0.13, cacheRead: 0.006 });
/** The W5 claim panel: plan 208's free Command Code stealth pair (distinct families, neither answers nor simulates). */
export const SCREEN209_JUDGES = Object.freeze([...SCREEN208_JUDGES]);
/** The owner's USD cap for the one paid model (gate W-1); free routes stay $0. */
export const SCREEN209_USD_CAP = 20;
/** Per work-outcome job (7 personas x 6 sessions, one arm): input-token cap, in-flight persona-arms and claim-panel calls. */
export const SCREEN209_WORK_CAPS = Object.freeze({ maxInputTokens: 8_000_000, concurrency: 2, judgeCalls: 400, wallTimeCapHours: 8 });
/** Per no-harm job (one quick slice of one suite): plan 208's quick runs used 0.16M-0.54M input tokens. */
export const SCREEN209_NOHARM_CAPS = Object.freeze({ maxInputTokens: 3_000_000, wallTimeCapHours: 6 });
/**
 * The journal ceiling over every reservation: 12 work jobs x 8.5M + 6 no-harm jobs x 3.5M, twice (two attempts each),
 * since a free route that omits usage leaves an attempt charged its whole reservation. It bounds work, not money: the
 * paid model's USD is bounded by the gate's cap at its rates.
 */
export const SCREEN209_CEILING = 250_000_000;
/** `P+W` on plan 202's suites: the work-outcome `P+W` fabric settings as harness overrides on the `fabric-x-tools` arm. */
export const SCREEN209_PW_ABLATE = Object.freeze([
  "fabric.exchanges.steps=true",
  "fabric.rules.capture=confirm",
  "fabric.lessons.nudge=true",
]);
export const SCREEN209_NOHARM_ARMS = Object.freeze([
  { id: "P", ablate: [] },
  { id: "P+W", ablate: [...SCREEN209_PW_ABLATE] },
]);

/**
 * The tuning-tier values the one revision may change (Task 6 text): `maxSteps`, `rules.maxTokens`, the nudge rate and
 * `archiveAfterSessions`, each a `tuning` field of the fabric schema. Anything else is a contract field.
 */
export const SCREEN209_TUNING_FIELDS = Object.freeze([
  "exchanges.maxSteps",
  "rules.maxTokens",
  "lessons.minTurnsBetweenNudges",
  "lessons.archiveAfterSessions",
]);

export function screen209TuningDefaults() {
  return {
    "exchanges.maxSteps": DEFAULT_EXCHANGE_STEPS,
    "rules.maxTokens": DEFAULT_CAPTURE_RULES_TOKENS,
    "lessons.minTurnsBetweenNudges": DEFAULT_LESSON_NUDGE_TURNS,
    "lessons.archiveAfterSessions": DEFAULT_LESSON_ARCHIVE_SESSIONS,
  };
}

/** The `x-prism-stability` mark of a dotted schema path (searching `anyOf`/`oneOf` branches), or null. */
export function schemaStability(path, schema = memoryFabricConfigSchema) {
  const [head, ...rest] = path.split(".");
  const branches = [schema, ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  for (const branch of branches) {
    const child = branch.properties?.[head];
    if (!child) continue;
    if (!rest.length) return child["x-prism-stability"] ?? null;
    const found = schemaStability(rest.join("."), child);
    if (found) return found;
  }
  return null;
}

/**
 * The one revision: `before` and `after` are tuning tables ({ field: value }), `evidence` names the development
 * evidence per changed field. Refuses a changed field outside {@link SCREEN209_TUNING_FIELDS}, a field the schema does
 * not mark `tuning`, a change without evidence, and evidence for a field that did not change.
 */
export function assertTuningRevision({ before, after, evidence = {} }) {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed = [...fields].filter((field) => before?.[field] !== after?.[field]).sort();
  for (const field of changed) {
    if (!SCREEN209_TUNING_FIELDS.includes(field)) throw new Error(`Screen209Revision: ${field} is not a plan 209 tuning-tier value`);
    if (schemaStability(field) !== "tuning") throw new Error(`Screen209Revision: the fabric schema marks ${field} as a contract field`);
    if (!Number.isSafeInteger(after?.[field]) || after[field] < 1)
      throw new Error(`Screen209Revision: ${field} must stay a positive integer`);
    if (typeof evidence[field] !== "string" || !evidence[field].trim())
      throw new Error(`Screen209Revision: ${field} changes without naming its development evidence`);
  }
  for (const field of Object.keys(evidence))
    if (!changed.includes(field)) throw new Error(`Screen209Revision: evidence names ${field}, which the revision does not change`);
  return changed.map((field) => ({ field, from: before[field], to: after[field], evidence: evidence[field] }));
}

/** Refuse anything but the development partition, in a manifest, a job or a profile argument. */
export function assertScreen209Partition(partition) {
  if (partition !== SCREEN209_PARTITION)
    throw new Error(
      `Screen209Partition: plan 209 reads the ${SCREEN209_PARTITION} partition only; ${partition ?? "(none)"} belongs to plan 210 Task 9`,
    );
  return partition;
}

export const ref = (model) => `${model.provider}/${model.model}`;

export function screen209WorkJob(model, arm) {
  if (!WORK_OUTCOME_ARMS.includes(arm)) throw new Error(`Screen209Arguments: unknown work-outcome arm ${arm}`);
  return {
    id: `209-screen.work.${model.key}.${arm}`,
    kind: "work-outcome",
    family: `209-screen.work.${model.key}`,
    role: arm,
    arm,
    suite: "work-outcome",
    config: arm,
    subset: SCREEN209_PARTITION,
    provider: model.provider,
    model: model.model,
    simulator: SCREEN209_SIMULATOR,
    simulatorPaid: true,
    judges: SCREEN209_JUDGES.join(","),
    freeOnly: !model.paid,
    ...SCREEN209_WORK_CAPS,
  };
}

/** A no-harm job is plan 208's large quick-slice job with plan 209's id, caches and the arm's overrides. */
export function screen209NoHarmJob(arm, suite) {
  const slot = SCREEN209_MODELS.find((model) => model.key === "large");
  const large = { ...SCREEN208_MODELS.find((model) => model.key === "large"), ...slot };
  const base = screen208Job({ model: large, arm: { id: "P", ontology: false }, suite });
  return {
    ...base,
    id: `209-screen.noharm.large.${arm.id}.${suite}`,
    family: `209-screen.noharm.large.${arm.id}`,
    role: arm.id,
    arm: arm.id,
    maxInputTokens: SCREEN209_NOHARM_CAPS.maxInputTokens,
    wallTimeCapHours: SCREEN209_NOHARM_CAPS.wallTimeCapHours,
    maxQuestions: SCREEN208_QUICK_QUESTIONS[suite],
    answersDir: `.cache/memory-bench/209/noharm/${arm.id}/answers`,
    judgeCacheDir: `.cache/memory-bench/209/noharm/${arm.id}/judge`,
    ...(arm.ablate.length ? { ablate: [...arm.ablate] } : {}),
  };
}

export function screen209Jobs() {
  const work = SCREEN209_MODELS.flatMap((model) => WORK_OUTCOME_ARMS.map((arm) => screen209WorkJob(model, arm)));
  const noHarm = SCREEN208_SUITES.flatMap((suite) => SCREEN209_NOHARM_ARMS.map((arm) => screen209NoHarmJob(arm, suite)));
  return assertScreen209Jobs([...work, ...noHarm]);
}

export function assertScreen209Jobs(jobs) {
  const heldOut = new Set([...ROBUSTNESS_PARTITIONS, ...WORK_OUTCOME_CRITERIA.partitions.all].filter((name) => name.startsWith("heldout")));
  const paid = new Set(SCREEN209_MODELS.filter((model) => model.paid).map(ref));
  for (const job of jobs) {
    if (job.subset !== SCREEN209_PARTITION || heldOut.has(job.subset))
      throw new Error(`Screen209Partition: ${job.id} reads ${job.subset}; plan 209 reads ${SCREEN209_PARTITION} only`);
    const isPaid = paid.has(`${job.provider}/${job.model}`);
    if (isPaid ? job.freeOnly : !job.freeOnly || job.provider !== "kilo")
      throw new Error(`Screen209Billing: ${job.id} is neither a free Kilo job nor a named paid model`);
  }
  return jobs;
}

export function screen209ManifestHash(manifest) {
  const { gate: _gate, manifestHash: _hash, generatedAt: _at, ...rest } = manifest;
  return stableHash(rest);
}

export async function buildScreen209Manifest({ root = "." } = {}) {
  const manifest = {
    kind: "209-development-screen-manifest",
    schemaVersion: 1,
    plan: SCREEN209_PLAN,
    task: 6,
    gateId: SCREEN209_GATE_ID,
    partition: SCREEN209_PARTITION,
    status: "proposal",
    executable: false,
    ...workOutcomeManifestPin(),
    // The frozen product: the fabric, the wiki and the kernel bytes the screen runs (plan 208's ontology product).
    productHash: await sourceFingerprint(ONTOLOGY_PRODUCT_PATHS, root),
    tuning: screen209TuningDefaults(),
    provider: "kilo",
    model: "209-panel",
    ceiling: SCREEN209_CEILING,
    journalPath: SCREEN209_JOURNAL,
    summaryPath: SCREEN209_SUMMARY,
    models: {
      answers: SCREEN209_MODELS.map(ref),
      small: SCREEN209_MODELS.filter((model) => model.small).map(ref),
      simulator: SCREEN209_SIMULATOR,
      judges: [...SCREEN209_JUDGES],
      curator: "agent-own (wiki model unset: each answer model curates its own concepts in P+W+O)",
      families: { answers: SCREEN209_MODELS.map((model) => model.family), judges: ["stealth (glyph-cluster)", "stealth (crouton-alpha)"] },
      judgesDoNotAnswer: true,
    },
    billing: {
      mode: "free-plus-named-paid",
      paidAnswers: SCREEN209_MODELS.filter((model) => model.paid).map(ref),
      usdCap: SCREEN209_USD_CAP,
      rates: Object.fromEntries(SCREEN209_MODELS.filter((model) => model.paid).map((model) => [ref(model), model.usdPerMillion])),
      paidFallbacks: [],
    },
    arms: { work: [...WORK_OUTCOME_ARMS], noHarm: SCREEN209_NOHARM_ARMS.map((arm) => arm.id) },
    caps: { work: { ...SCREEN209_WORK_CAPS }, noHarm: { ...SCREEN209_NOHARM_CAPS }, journalCeiling: SCREEN209_CEILING },
    cohort: {
      work: { partition: SCREEN209_PARTITION, partitionIdsHash: { ...WORK_OUTCOME_CRITERIA.pins.partitionIdsHash } },
      noHarm: Object.fromEntries(
        SCREEN208_SUITES.map((suite) => [
          suite,
          {
            partition: SCREEN209_PARTITION,
            partitionIdsHash: THREE_TIER_CRITERIA.pins.partitionIdsHash[suite],
            quickQuestions: SCREEN208_QUICK_QUESTIONS[suite],
          },
        ]),
      ),
    },
    comparisons: {
      work: "P+W against P per answer model, pooled over both families (work row)",
      memory: "P against memory-off (memory row)",
      ontologyWork: "P+W+O against P+W (ontology-work row = plan 208 O8)",
      codingWork: "coding+W against coding (reported only)",
      noHarm: "P+W against P on plan 202's dev quick slices, paired per question, large model (advisory)",
    },
    results: [],
    jobs: screen209Jobs(),
  };
  manifest.manifestHash = screen209ManifestHash(manifest);
  return assertWorkOutcomeCriteriaPin(manifest);
}

export async function writeScreen209Manifest({ root = ".", path = join(root, SCREEN209_MANIFEST) } = {}) {
  const manifest = await buildScreen209Manifest({ root });
  await mkdir(join(root, SCREEN209_EVIDENCE), { recursive: true });
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...manifest }, null, 2)}\n`);
  return manifest;
}

/** The owner's approval, bound to the manifest hash. Pure: checks, never writes. */
export function assertScreen209Gate(gate, manifest) {
  const refuse = (reason) => {
    throw new Error(`Screen209Gate: ${reason}`);
  };
  if (!gate || typeof gate !== "object") refuse("no gate record");
  if (gate.plan !== SCREEN209_PLAN || gate.gate !== SCREEN209_GATE_ID) refuse(`the record is not plan 209 gate ${SCREEN209_GATE_ID}`);
  if (gate.approved !== true || gate.approvedBy !== "owner") refuse("the gate is not approved by the owner");
  if (typeof gate.text !== "string" || !gate.text.trim()) refuse("the gate carries no owner text");
  if (gate.manifestHash !== manifest.manifestHash)
    refuse("the manifest differs from the approved one; a changed manifest is a refusal, not a re-approval");
  if (gate.billing?.paidFallbacks?.length) refuse("the gate approves no paid fallback");
  if (!(Number(gate.billing?.usdCap) > 0)) refuse("the gate states no USD cap for the paid model");
  return gate;
}

export async function readScreen209Gate({ root = "." } = {}) {
  const path = join(root, SCREEN209_GATE);
  if (!existsSync(path))
    throw new Error(`Screen209Gate: no gate record at ${SCREEN209_GATE}; the owner approves gate W-1 before any paid call`);
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * The executable manifest: the proposal plus a verified gate. `PRISM_MEMORY_BENCH_209_JOBS` (comma-separated id
 * substrings) runs a subset of the approved jobs, unchanged; a bounded smoke (`PRISM_MEMORY_BENCH_209_SMOKE=1`) also
 * runs in its own journal so the real run neither reuses nor overwrites it.
 */
export async function buildExecutableScreen209Manifest({
  root = ".",
  only = process.env.PRISM_MEMORY_BENCH_209_JOBS,
  smoke = process.env.PRISM_MEMORY_BENCH_209_SMOKE === "1",
} = {}) {
  const manifest = await buildScreen209Manifest({ root });
  const gate = assertScreen209Gate(await readScreen209Gate({ root }), manifest);
  const patterns = String(only ?? "")
    .split(",")
    .filter(Boolean);
  const jobs = patterns.length ? manifest.jobs.filter((job) => patterns.some((pattern) => job.id.includes(pattern))) : manifest.jobs;
  if (!jobs.length) throw new Error(`Screen209: no approved job matches ${only}`);
  const tag = patterns.length || smoke ? stableHash(`${smoke ? "smoke:" : ""}${patterns.join(",")}`).slice(0, 8) : null;
  return {
    ...manifest,
    jobs: smoke ? jobs.map((job) => (job.kind === "work-outcome" ? { ...job, personaLimit: 1 } : { ...job, maxQuestions: 2 })) : jobs,
    ...(tag
      ? {
          worker: tag,
          journalPath: `.cache/memory-bench/209/journal-${smoke ? "smoke" : "worker"}-${tag}.json`,
          summaryPath: `${SCREEN209_EVIDENCE}/execution-${smoke ? "smoke" : "run-worker"}-${tag}.json`,
          executionManifestPath: `${SCREEN209_EVIDENCE}/execution-manifest-${smoke ? "smoke" : "worker"}-${tag}.json`,
          outputPrefix: smoke ? "smoke-209-task6" : SCREEN209_OUTPUT_PREFIX,
        }
      : {}),
    status: "approved",
    executable: true,
    gate: { path: SCREEN209_GATE, manifestHash: gate.manifestHash, approvedAt: gate.approvedAt },
  };
}

export { screen209WorkArgv } from "./argv.mjs";

/* ------------------------------------------------------------------------------------------------------------------ */
/* The development report (`acceptance-report.mjs --plan 209 --partition dev`). Ids, counts and scores only.           */
/* ------------------------------------------------------------------------------------------------------------------ */

/** The latest attempt's report per job id: `<prefix>-<id>.json`, or `-<n>` for a later attempt. */
export async function loadScreen209Reports(dir = SCREEN209_EVIDENCE, prefix = `${SCREEN209_OUTPUT_PREFIX}-`) {
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

/** USD for one model's wire usage at the gate's rates (free routes: 0). */
export function usdOf(usage, rates) {
  if (!rates) return 0;
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0));
  return (uncached * rates.input + (usage.cacheReadTokens ?? 0) * rates.cacheRead + (usage.outputTokens ?? 0) * rates.output) / 1e6;
}

const scored = (report) =>
  (report?.results ?? []).filter((row) => typeof row.correct === "boolean" || row.correct === 0 || row.correct === 1);

/** `P+W` against `P` on the quick slices, paired per question across suites (advisory; 2-point non-inferiority). */
export function noHarmRow(reports) {
  const a = [];
  const b = [];
  const suites = [];
  for (const suite of SCREEN208_SUITES) {
    const base = reports.get(`209-screen.noharm.large.P.${suite}`);
    const other = reports.get(`209-screen.noharm.large.P+W.${suite}`);
    if (!base || !other) continue;
    suites.push(suite);
    const twin = new Map(scored(other).map((row) => [row.id, row]));
    for (const row of scored(base)) {
      if (!twin.has(row.id)) continue;
      const tag = (item) => ({ id: `${suite}:${item.id}`, cluster: `${suite}:${item.cluster ?? item.id}`, correct: item.correct });
      a.push(tag(row));
      b.push(tag(twin.get(row.id)));
    }
  }
  if (!a.length) return { row: "no-harm", suites, n: 0, status: "not-computable" };
  const result = pairedAnalysis(a, b, { iterations: 4000 });
  return {
    row: "no-harm",
    suites,
    n: result.n,
    clusters: result.clusters,
    diffPoints: Math.round(result.diff * 1000) / 10,
    ci95Points: result.ci95.map((value) => Math.round(value * 1000) / 10),
    nonInferior2Points: result.ci95[0] > -0.02,
    advisory: true,
  };
}

/**
 * Merge one model's per-arm work-outcome reports into the pre-registered rows. `criteriaOf` is `run.mjs`'s
 * `workOutcomeCriteria`, passed in so this module never loads the runner (and its model packages) to build a manifest.
 */
export function mergeModelReports(model, reports, criteriaOf) {
  const arms = WORK_OUTCOME_ARMS.filter((arm) => reports.get(`209-screen.work.${model.key}.${arm}`)?.status === "completed");
  const of = (arm) => reports.get(`209-screen.work.${model.key}.${arm}`).report;
  const rowsOf = (arm) => of(arm).rows[arm];
  const w5 = Object.fromEntries(arms.map((arm) => [arm, of(arm).w5[arm]]));
  const safety = Object.fromEntries(arms.map((arm) => [arm, of(arm).safety[arm]]));
  const leak = Object.fromEntries(arms.map((arm) => [arm, of(arm).simulatorLeak?.[arm] ?? 0]));
  const criteria = criteriaOf({ arms, rowsOf, w5, safety });
  const leaked = Object.values(leak).some((count) => count > 0);
  return {
    model: ref(model),
    small: model.small,
    armsCompleted: arms,
    armsMissing: WORK_OUTCOME_ARMS.filter((arm) => !arms.includes(arm)),
    summary: Object.fromEntries(arms.map((arm) => [arm, of(arm).summary[arm]])),
    w5,
    safety,
    simulatorLeak: leak,
    // A simulator that gave a hidden answer before the agent asked invalidates this model's W3 (Task 5 finding).
    w3Valid: !leaked,
    curator: Object.fromEntries(arms.filter((arm) => of(arm).curator?.[arm]).map((arm) => [arm, of(arm).curator[arm]])),
    criteria,
    o8: criteria["ontology-work"] ?? null,
    usage: Object.fromEntries(
      arms.map((arm) => {
        const job = reports.get(`209-screen.work.${model.key}.${arm}`);
        return [
          arm,
          {
            inputTokens: job.inputTokens,
            cacheReadTokens: job.cacheReadTokens,
            outputTokens: job.outputTokens,
            usageComplete: job.usageComplete,
            // Per route: the answer model at its rates (0 on a free route) and the paid simulator at its own.
            usd: usdOf(job.byRoute?.answer ?? job, model.usdPerMillion) + usdOf(job.byRoute?.simulator ?? {}, SCREEN209_SIMULATOR_RATES),
            wallMs: of(arm).cost.wallMs,
            meanWallMsPerPersonaArm: of(arm).cost.meanWallMsPerPersonaArm,
            mainRequests: of(arm).cost.mainRequests,
          },
        ];
      }),
    ),
  };
}

export function buildScreen209Report({ reports, criteriaOf, manifest }) {
  const models = SCREEN209_MODELS.map((model) => mergeModelReports(model, reports, criteriaOf));
  const o8 = o8Row();
  return {
    kind: "209-development-report",
    plan: 209,
    task: 6,
    advisory: true,
    note: "Development numbers are advisory, never the verdict; plan 210 Task 9 runs the held-out work-outcome arms.",
    partition: SCREEN209_PARTITION,
    ...workOutcomeManifestPin(),
    productHash: manifest?.productHash ?? null,
    manifestHash: manifest?.manifestHash ?? null,
    jobsRead: [...reports.keys()].sort(),
    models,
    o8: { criteria: o8, perModel: Object.fromEntries(models.map((model) => [model.model, model.o8])) },
    noHarm: noHarmRow(reports),
    usd:
      models.reduce((sum, model) => sum + Object.values(model.usage).reduce((n, row) => n + row.usd, 0), 0) +
      // The no-harm jobs run on the large model, at its rates.
      [...reports]
        .filter(([id]) => id.startsWith("209-screen.noharm."))
        .reduce((sum, [, job]) => sum + usdOf(job, SCREEN209_MODELS.find((model) => model.key === "large").usdPerMillion), 0),
  };
}

export async function writeScreen209Report({ partition, root = "." } = {}) {
  assertScreen209Partition(partition);
  const { workOutcomeCriteria } = await import("./run.mjs");
  const reports = await loadScreen209Reports(join(root, SCREEN209_EVIDENCE));
  const manifestPath = join(root, SCREEN209_MANIFEST);
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : null;
  const report = buildScreen209Report({ reports, criteriaOf: workOutcomeCriteria, manifest });
  await mkdir(join(root, SCREEN209_EVIDENCE), { recursive: true });
  await writeFile(join(root, SCREEN209_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
