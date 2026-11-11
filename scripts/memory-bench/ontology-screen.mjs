/**
 * Plan 208 Task 5: the owner-gated development screen of the ontology tier.
 *
 * The screen is a campaign manifest like any other (the journal, the lock, the wire proxy and the report writer are
 * `campaign.mjs`'s). This module owns what is specific to the ontology question:
 *
 * - the cohort: the development partitions of three suites, read by plan 208 only (held-out reads belong to plan 210
 *   Task 9, and the `--plan 208` profile refuses them);
 * - the arms: `P` (the plan 202 `preset-r1` candidate, config `fabric-x-tools`) and `P+O`, per answer model, plus the
 *   trigger-policy comparison in series mode;
 * - the gate record: the owner's approval of the scope, bound to the manifest hash. A changed manifest is a refusal,
 *   never a silent re-approval.
 *
 * Nothing here calls a model.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOntologyManifest, ontologyTwin } from "./campaign.mjs";
import { stableHash } from "./journal.mjs";
import { ROBUSTNESS_PARTITIONS, THREE_TIER_CRITERIA } from "./robustness.mjs";
import { isFreeBenchmarkModel } from "./run.mjs";
import { readKiloFreePanel, readOpenRouterKeyTier } from "./task5-execute.mjs";

export const SCREEN208_PLAN = 208;
export const SCREEN208_GATE_ID = "O-1";
export const SCREEN208_EVIDENCE = "docs/_evidence/memory-bench/208/screen";
export const SCREEN208_GATE = "docs/_evidence/memory-bench/208/gates/owner-gate-1.json";
export const SCREEN208_MANIFEST = `${SCREEN208_EVIDENCE}/development-screen-manifest.json`;
export const SCREEN208_JOURNAL = ".cache/memory-bench/208/journal.json";
export const SCREEN208_LOGS = ".cache/memory-bench/208/logs";
export const SCREEN208_SUMMARY = `${SCREEN208_EVIDENCE}/execution-run.json`;
export const SCREEN208_CLAIMS = ".cache/memory-bench/208/ontology-claims";
/** The only partition plan 208 reads. */
export const SCREEN208_PARTITION = "dev";
/** Unscored warm-up questions per cluster in series mode. */
export const SCREEN208_WARMUP = 2;
/**
 * The answer models. `large` plays plan 202's large slot; `small` is plan 202's small-model slot, which became Command
 * Code's paid Qwen 3.7 Flash when Gemma's free pool stayed rate-limited upstream (owner, 2026-11-04, gate amendment 7);
 * `beamfree` is a third, larger free model (OpenCode Go's Beam Free, Reflection's Beam 1.0, 501B with 23B active), P
 * and P+O only.
 */
export const SCREEN208_MODELS = Object.freeze([
  { key: "large", provider: "kilo", model: "nvidia/nemotron-3-ultra-550b-a55b:free", family: "nvidia", small: false },
  // Qwen's Command Code route refused some MemoryAgentBench-CR questions with a content-inspection 400 that survived two
  // re-asks (owner, 2026-11-05, gate amendment 16), so that suite's pair runs on Muse; both arms of a pair share a model.
  {
    key: "small",
    provider: "commandcode",
    model: "Qwen/Qwen3.7-Flash",
    family: "qwen",
    small: true,
    paid: true,
    suiteModels: { "memoryagentbench-cr": { provider: "commandcode", model: "meta/muse-spark-1.2-contributor", family: "meta" } },
  },
  // Beam Free reasons slowly: its concept passes were cut off at the default 120 s settle bound with no concepts, so its
  // `P+O` arm runs under a 600 s bound (owner, 2026-11-04, gate amendment 12).
  { key: "beamfree", provider: "opencode-go", model: "beam-free", family: "reflection", small: false, ontologySettleMs: 600_000 },
  // Owner, 2026-11-04 (gate amendment 11, no USD cap): the trigger-policy arms run on a fast paid model, in parallel, because
  // they were the longest part of the screen on the Kilo free model. Series arms only; no P or P+O pair.
  {
    key: "muse",
    provider: "commandcode",
    model: "meta/muse-spark-1.2-contributor",
    family: "meta",
    small: false,
    paid: true,
    seriesOnly: true,
  },
]);
/** The models that read `P` against `P+O` (O1, O2, O5, O7). */
export const SCREEN208_PAIRED_MODELS = Object.freeze(SCREEN208_MODELS.filter((model) => !model.seriesOnly));
/** The model that runs the trigger-policy (series) arms. */
export const SCREEN208_SERIES_MODEL = SCREEN208_MODELS.find((model) => model.seriesOnly);
/**
 * The judge panel (owner, 2026-11-04, gate amendment 6): Command Code's two free stealth-preview models, 1000 requests a
 * day per account each, so judging no longer shares the answer routes' quotas. Neither answers nor curates.
 */
export const SCREEN208_JUDGES = Object.freeze(["commandcode/stealth/glyph-cluster:free", "commandcode/stealth/crouton-alpha"]);
/** A paid answer model runs only when an owner amendment names it with a USD cap (gate amendment 6). */
export const SCREEN208_PAID_ANSWERS = Object.freeze(
  SCREEN208_MODELS.filter((model) => model.paid).map((model) => `${model.provider}/${model.model}`),
);
/** Questions per job in the quick first read: a balanced prefix (round-robin by ability), reused by the full run. */
export const SCREEN208_QUICK_QUESTIONS = Object.freeze({ "memoryagentbench-cr": 8, "beam-100k": 10, locomo: 10 });
/** Smallest first, so a partial run still answers something. */
export const SCREEN208_SUITES = Object.freeze(["memoryagentbench-cr", "beam-100k", "locomo"]);
export const SCREEN208_ARM_CONFIG = "fabric-x-tools";
const WALL_HOURS = { "memoryagentbench-cr": 12, "beam-100k": 16, locomo: 24 };
const READ_TIME_ONLY = '["co-read","repair"]';

/** The arms of the screen. `series` arms run the warm-up mode and compare against each other, never against `P`. */
export const SCREEN208_ARMS = Object.freeze([
  { id: "P", ontology: false },
  { id: "P+O", ontology: true },
  { id: "P+O.series-default", ontology: true, series: true },
  { id: "P+O.series-readtime", ontology: true, series: true, readTimeOnly: true },
]);

function armsFor(model) {
  // The trigger-policy (series) arms run on the one series-only model, never beside P and P+O; the other models read
  // P against P+O only (the small one also reads O7).
  return SCREEN208_ARMS.filter((arm) => Boolean(arm.series) === Boolean(model.seriesOnly));
}

export function screen208JobId(model, arm, suite) {
  return `208-screen.${model.key}.${arm.id}.${suite}`;
}

/** One job of the screen. Held-out partitions are not expressible here: the subset is fixed to `dev`. */
export function screen208Job({ model: slot, arm, suite }) {
  // A slot may run one suite on another model (`suiteModels`); the id, caches and pairing stay the slot's.
  const model = { ...slot, ...(slot.suiteModels?.[suite] ?? {}) };
  const base = {
    id: screen208JobId(slot, arm, suite),
    family: `208-screen.${slot.key}.${arm.id}`,
    role: arm.id,
    suite,
    subset: SCREEN208_PARTITION,
    arm: arm.id,
    config: SCREEN208_ARM_CONFIG,
    provider: model.provider,
    model: model.model,
    judges: SCREEN208_JUDGES.join(","),
    judgeText: true,
    judgeProtocol: "plain-text-v1",
    labelInjections: "off",
    maxInputTokens: 25_000_000,
    maxOutputTokens: 8192,
    maxAttempts: 2,
    concurrency: 1,
    wallTimeCapHours: arm.series ? WALL_HOURS[suite] * 2 : WALL_HOURS[suite],
    freeOnly: !model.paid,
    freeProductOnly: !model.paid,
    boundedWire: true,
    // The last allowed answer turn carries no memory tools, so every model answers (owner, 2026-11-04, amendment 8).
    finalTurnAnswer: true,
    // Any prefix of a non-series job is a balanced slice, so the quick first read covers every ability.
    ...(arm.series ? {} : { interleaveAbilities: true }),
    answersDir: `.cache/memory-bench/208/${model.key}/${arm.id}/answers`,
    judgeCacheDir: `.cache/memory-bench/208/${model.key}/${arm.id}/judge`,
  };
  if (!arm.ontology) return base;
  const label = `${arm.id}.${model.key}`;
  const twin = ontologyTwin(base, { arm: label });
  return {
    ...twin,
    id: base.id,
    family: base.family,
    answersDir: base.answersDir,
    judgeCacheDir: base.judgeCacheDir,
    ontologyClaimsDir: SCREEN208_CLAIMS,
    ...(model.ontologySettleMs ? { ontologySettleMs: model.ontologySettleMs } : {}),
    ...(arm.series ? { warmup: SCREEN208_WARMUP } : {}),
    ...(arm.readTimeOnly ? { ablate: [`wiki.consolidate.triggers=${READ_TIME_ONLY}`] } : {}),
  };
}

export function screen208Jobs() {
  return SCREEN208_MODELS.flatMap((model) =>
    SCREEN208_SUITES.flatMap((suite) => armsFor(model).map((arm) => screen208Job({ model, arm, suite }))),
  );
}

/** Refuse anything but the development partition, in a manifest or a profile argument. */
export function assertScreen208Partition(partition) {
  if (partition !== SCREEN208_PARTITION)
    throw new Error(
      `Screen208Partition: plan 208 reads the ${SCREEN208_PARTITION} partition only; ${partition ?? "(none)"} belongs to plan 210 Task 9`,
    );
  return partition;
}

export function assertScreen208Jobs(jobs) {
  for (const job of jobs) {
    if (job.subset !== SCREEN208_PARTITION || ROBUSTNESS_PARTITIONS.filter((name) => name.startsWith("heldout")).includes(job.subset))
      throw new Error(`Screen208Partition: ${job.id} reads ${job.subset}; plan 208 reads ${SCREEN208_PARTITION} only`);
    const paid = SCREEN208_PAID_ANSWERS.includes(`${job.provider}/${job.model}`);
    const freeRoute =
      job.provider === "kilo" || (job.provider === "opencode-go" && isFreeBenchmarkModel({ provider: job.provider, model: job.model }));
    if (paid ? job.freeOnly : !job.freeOnly || !freeRoute)
      throw new Error(`Screen208Billing: ${job.id} is not a free Kilo or OpenCode Go job or a named paid answer model`);
  }
  return jobs;
}

/** The partitions the screen reads: the committed idsHash of each suite, as Task 1's criteria pin them. */
export function screen208Cohort() {
  return Object.fromEntries(
    SCREEN208_SUITES.map((suite) => [
      suite,
      { partition: SCREEN208_PARTITION, partitionIdsHash: THREE_TIER_CRITERIA.pins.partitionIdsHash[suite] },
    ]),
  );
}

/** The manifest fingerprint the gate binds: everything but the gate binding and the hash itself. */
export function screen208ManifestHash(manifest) {
  const { gate: _gate, manifestHash: _hash, generatedAt: _at, ...rest } = manifest;
  return stableHash(rest);
}

export async function buildScreen208Manifest({ root = "." } = {}) {
  const jobs = assertScreen208Jobs(screen208Jobs());
  const manifest = await buildOntologyManifest({
    root,
    jobs,
    ...{
      schemaVersion: 1,
      plan: SCREEN208_PLAN,
      task: 5,
      gateId: SCREEN208_GATE_ID,
      partition: SCREEN208_PARTITION,
      status: "proposal",
      executable: false,
      provider: "kilo",
      model: "free-panel",
      // The journal's reservation ceiling over every job; free gateway, so it bounds work, never money.
      ceiling: 1_300_000_000,
      journalPath: SCREEN208_JOURNAL,
      summaryPath: SCREEN208_SUMMARY,
      models: {
        answers: SCREEN208_MODELS.map((model) => `${model.provider}/${model.model}`),
        judges: [...SCREEN208_JUDGES],
        curator: "agent-own (ontologyModel unset: each answer model curates its own concepts)",
        families: {
          answers: SCREEN208_MODELS.map((model) => model.family),
          judges: ["stealth (glyph-cluster)", "stealth (crouton-alpha)"],
        },
        judgesDoNotAnswer: true,
        crossProviderClaim: false,
      },
      // Free routes stay $0; the one paid answer model (the small slot) is bounded by the USD cap its owner amendment sets.
      billing: {
        mode: "free-plus-named-paid",
        provider: "kilo",
        freeProductsOnly: false,
        paidFallbacks: [],
        paidAnswers: [...SCREEN208_PAID_ANSWERS],
      },
      arms: SCREEN208_ARMS.map((arm) => arm.id),
      warmup: SCREEN208_WARMUP,
      cohort: screen208Cohort(),
      comparisons: {
        benefit: "P+O against P, paired per question, per answer model (O1, O2, O5, O7)",
        triggerPolicy: "P+O.series-readtime against P+O.series-default, same warm-up and scored sets (large model)",
        claimSupport: "ontology-audit.mjs over the claim bundles of every P+O arm (O3)",
        safety: "safety/run.mjs --ontology plus the evasive-lure residual judged by the panel (O4)",
      },
      notScreened: [
        {
          criteria: ["O6"],
          reason:
            "the coding arms need plan 202 Task 11's coding preset and sandbox workspaces; neither exists on a free route. Enters plan 210's ledger.",
        },
        { criteria: ["O8"], reason: "waits for plan 209 Task 6" },
        {
          criteria: ["O1 providers"],
          reason:
            "each answer model is served by one gateway (large: Kilo free; small: Command Code, paid Qwen 3.7 Flash; third: OpenCode Go Beam Free), never by a second provider for the same model, so O1 stays advisory",
        },
      ],
      claimsDir: SCREEN208_CLAIMS,
      concurrency: { concurrency: 1 },
      results: [],
    },
  });
  manifest.manifestHash = screen208ManifestHash(manifest);
  return manifest;
}

/** The gate record the owner's approval is written to. Pure: checks, never writes. */
export function assertScreen208Gate(gate, manifest) {
  const refuse = (reason) => {
    throw new Error(`Screen208Gate: ${reason}`);
  };
  if (!gate || typeof gate !== "object") refuse("no gate record");
  if (gate.plan !== SCREEN208_PLAN || gate.gate !== SCREEN208_GATE_ID) refuse(`the record is not plan 208 gate ${SCREEN208_GATE_ID}`);
  if (gate.approved !== true || gate.approvedBy !== "owner") refuse("the gate is not approved by the owner");
  if (typeof gate.text !== "string" || !gate.text.trim()) refuse("the gate carries no owner text");
  if (gate.manifestHash !== manifest.manifestHash)
    refuse("the manifest differs from the approved one; a changed manifest is a refusal, not a re-approval");
  if (gate.billing?.paidFallbacks?.length) refuse("the gate approves no paid fallback");
  // A paid answer model runs only when an owner amendment names it with a positive USD cap.
  const paidCaps = new Map(
    (gate.amendments ?? [])
      .filter((item) => item.by === "owner" && item.paidAnswer?.ref)
      // An owner may also state "no cap" outright (`uncapped: true`); the per-job input cap and the journal ceiling still bound the work.
      .map((item) => [item.paidAnswer.ref, item.paidAnswer.uncapped === true ? Number.POSITIVE_INFINITY : Number(item.paidAnswer.usdCap)]),
  );
  const freeRefs = new Set((gate.amendments ?? []).filter((item) => item.by === "owner").flatMap((item) => item.freeAnswers ?? []));
  for (const job of manifest.jobs) {
    const ref = `${job.provider}/${job.model}`;
    if (job.freeOnly && job.provider === "kilo") continue;
    // A free model on another gateway runs only when an owner amendment names it (gate amendment 7).
    if (job.freeOnly && freeRefs.has(ref)) continue;
    if (!SCREEN208_PAID_ANSWERS.includes(ref) || !(paidCaps.get(ref) > 0))
      refuse(`${job.id} is not a free Kilo job, an owner-named free model or an owner-capped paid model`);
  }
  return gate;
}

export async function readScreen208Gate({ root = "." } = {}) {
  const path = join(root, SCREEN208_GATE);
  if (!existsSync(path))
    throw new Error(`Screen208Gate: no gate record at ${SCREEN208_GATE}; the owner approves gate O-1 before any paid call`);
  return JSON.parse(await readFile(path, "utf8"));
}

/** The executable manifest: the proposal plus a verified gate. Refuses without one. */
/**
 * A bounded smoke is a question filter on approved jobs, never a different job: the jobs whose ids contain one of the
 * `match` strings run with `maxQuestions` set, in their own journal and under their own report prefix, so the real
 * run neither reuses nor overwrites them. The gate is verified against the full manifest first.
 */
export const SCREEN208_SMOKE_JOURNAL = ".cache/memory-bench/208/journal-smoke.json";
export const SCREEN208_SMOKE_MAX_QUESTIONS = 2;

export function screen208SmokeJobs(manifest, match) {
  const patterns = String(match).split(",").filter(Boolean);
  if (!patterns.length) throw new Error("Screen208Smoke: name the jobs to smoke (substrings of their ids)");
  const jobs = manifest.jobs.filter((job) => patterns.some((pattern) => job.id.includes(pattern)));
  if (!jobs.length) throw new Error(`Screen208Smoke: no approved job matches ${match}`);
  return jobs.map((job) => ({ ...job, maxQuestions: SCREEN208_SMOKE_MAX_QUESTIONS }));
}

/**
 * A second worker runs a named subset of the approved jobs in the order given, with its own journal, summary and
 * executable record. The gate is verified against the full manifest first; each job keeps its approved id, config and
 * caps, so its report is the same one the full run would write. The caller must keep the lists disjoint: a journal
 * only knows its own jobs, so two workers handed the same id run it twice.
 */
export function screen208WorkerJobs(manifest, ids) {
  const wanted = String(ids)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!wanted.length) throw new Error("Screen208Worker: name the jobs this worker runs (exact job ids)");
  if (new Set(wanted).size !== wanted.length) throw new Error("Screen208Worker: a job id is listed twice");
  const byId = new Map(manifest.jobs.map((job) => [job.id, job]));
  const unknown = wanted.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`Screen208Worker: no approved job has the id ${unknown.join(", ")}`);
  return wanted.map((id) => byId.get(id));
}

/**
 * An owner amendment may move named jobs to another free route (plan 208 Task 5 gate O-1, 2026-11-03). The job keeps its
 * approved id, config and caps; only the route changes, and only for the ids the amendment lists, at $0. Anything the
 * amendment does not name is refused, so a worker cannot move a job on its own say-so.
 */
export function screen208RouteJobs(jobs, gate, provider) {
  if (provider !== "openrouter") throw new Error(`Screen208Route: ${provider} is not an approved route; only openrouter is`);
  // Each owner amendment names its own jobs; a job moves when any of them names it, and every one must be $0.
  const overrides = (gate?.amendments ?? [])
    .filter((item) => item.by === "owner" && item.routeOverride?.provider === provider)
    .map((item) => item.routeOverride);
  if (!overrides.length) throw new Error(`Screen208Route: no owner amendment approves the ${provider} route`);
  if (overrides.some((routeOverride) => routeOverride.billing?.totalUsd !== 0 || routeOverride.billing?.paidFallbacks?.length))
    throw new Error("Screen208Route: the amendment approves free models only");
  const named = new Set(overrides.flatMap((routeOverride) => routeOverride.jobs));
  return jobs.map((job) => {
    if (!named.has(job.id)) throw new Error(`Screen208Route: the amendment does not move ${job.id}`);
    if (!job.model.endsWith(":free")) throw new Error(`Screen208Route: ${job.id} is not a :free model`);
    const moved = (path) => path.replace("/208/", `/208/${provider}/`);
    return {
      ...job,
      provider,
      answersDir: moved(job.answersDir),
      judgeCacheDir: moved(job.judgeCacheDir),
      route: "owner-gate-1:amendment",
    };
  });
}

/**
 * The quick first read (owner, 2026-11-04): each non-series job runs only its balanced prefix of
 * {@link SCREEN208_QUICK_QUESTIONS}. Same job, same answer and judge caches, so the full run replays the prefix from
 * cache and pays only for the rest. Series arms need whole clusters and wait for the full run.
 */
export function screen208QuickJobs(jobs) {
  const quick = jobs.filter((job) => !job.warmup);
  if (!quick.length) throw new Error("Screen208Quick: the worker lists only series arms; they run in the full read");
  return quick.map((job) => ({ ...job, maxQuestions: SCREEN208_QUICK_QUESTIONS[job.suite] }));
}

export function screen208WorkerPaths(ids, provider, { quick = false } = {}) {
  const tag = stableHash(`${quick ? "quick:" : ""}${provider ?? "kilo"}:${String(ids)}`).slice(0, 8);
  return {
    tag,
    journalPath: `.cache/memory-bench/208/journal-worker-${tag}.json`,
    summaryPath: `${SCREEN208_EVIDENCE}/execution-run-worker-${tag}.json`,
    executionManifestPath: `${SCREEN208_EVIDENCE}/execution-manifest-worker-${tag}.json`,
  };
}

export async function buildExecutableScreen208Manifest({
  root = ".",
  smoke = process.env.PRISM_MEMORY_BENCH_208_SMOKE,
  worker = process.env.PRISM_MEMORY_BENCH_208_WORKER,
  workerProvider = process.env.PRISM_MEMORY_BENCH_208_WORKER_PROVIDER,
  quick = process.env.PRISM_MEMORY_BENCH_208_QUICK === "1",
} = {}) {
  if (workerProvider && !worker) throw new Error("Screen208: a route provider needs a worker job list");
  if (quick && !worker) throw new Error("Screen208: the quick first read runs as a worker");
  if (smoke && worker) throw new Error("Screen208: a smoke run and a worker run are separate modes");
  const manifest = await buildScreen208Manifest({ root });
  const gateRecord = await readScreen208Gate({ root });
  const gate = assertScreen208Gate(gateRecord, manifest);
  const workerPaths = worker ? screen208WorkerPaths(worker, workerProvider, { quick }) : null;
  const listed = worker ? screen208WorkerJobs(manifest, worker) : null;
  const workerJobs = listed && quick ? screen208QuickJobs(listed) : listed;
  return {
    ...manifest,
    ...(workerPaths
      ? {
          worker: workerPaths.tag,
          journalPath: workerPaths.journalPath,
          summaryPath: workerPaths.summaryPath,
          executionManifestPath: workerPaths.executionManifestPath,
          ...(workerProvider ? { routeProvider: workerProvider } : {}),
          ...(quick ? { quick: true } : {}),
          jobs: workerProvider ? screen208RouteJobs(workerJobs, gateRecord, workerProvider) : workerJobs,
        }
      : {}),
    ...(smoke
      ? {
          smoke: true,
          journalPath: SCREEN208_SMOKE_JOURNAL,
          summaryPath: `${SCREEN208_EVIDENCE}/execution-smoke.json`,
          jobs: screen208SmokeJobs(manifest, smoke),
        }
      : {}),
    status: "approved",
    executable: true,
    gate: { path: SCREEN208_GATE, manifestHash: gate.manifestHash, approvedAt: gate.approvedAt },
  };
}

/**
 * Command Code's catalog carries no prices, so a row is free only by its id (`:free`, `-free`) or the owner-named
 * preview list, and a paid row runs only when the manifest names it as a paid answer model.
 */
export async function readCommandCodePanel({
  refs = [],
  paidAnswers = [],
  baseUrl = "https://api.commandcode.ai/provider/v1",
  fetchImpl = fetch,
  catalog,
} = {}) {
  let rows = catalog;
  if (!rows) {
    const key = process.env.COMMAND_CODE_API_KEY;
    if (!key) throw new Error("Screen208Preflight: COMMAND_CODE_API_KEY is not set (load ~/.config/prism/live.env)");
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Screen208Preflight: GET ${baseUrl}/models returned ${response.status}`);
    rows = (await response.json())?.data;
  }
  if (!Array.isArray(rows)) throw new Error("Screen208Preflight: the Command Code catalog has no data array");
  const byId = new Map(rows.map((row) => [row.id, row]));
  return refs.map((ref) => {
    const model = ref.split("/").slice(1).join("/");
    const row = byId.get(model);
    if (!row) throw new Error(`Screen208Preflight: ${ref} is not in the Command Code catalog`);
    if (!isFreeBenchmarkModel({ provider: "commandcode", model }) && !paidAnswers.includes(ref))
      throw new Error(`Screen208Preflight: ${ref} is neither free nor a named paid answer model`);
    if (
      row.supported_endpoints &&
      !row.supported_endpoints.includes("/chat/completions") &&
      !row.supported_endpoints.includes("/responses")
    )
      throw new Error(`Screen208Preflight: ${ref} serves no chat route`);
    return { ref, contextWindow: row.context_length ?? null, paid: paidAnswers.includes(ref) };
  });
}

/**
 * OpenCode Go bills its models, so a row runs on this screen only when its id ends in `-free` and the live catalog
 * prices both input and output at exactly zero, with tools supported.
 */
export async function readOpenCodeGoPanel({ refs = [], baseUrl = "https://opencode.ai/zen/go/v1", fetchImpl = fetch, catalog } = {}) {
  let rows = catalog;
  if (!rows) {
    const key = process.env.OPENCODE_GO_API_KEY ?? process.env.OPENCODE_API_KEY;
    if (!key) throw new Error("Screen208Preflight: OPENCODE_GO_API_KEY is not set (load ~/.config/prism/live.env)");
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Screen208Preflight: GET ${baseUrl}/models returned ${response.status}`);
    rows = (await response.json())?.data;
  }
  if (!Array.isArray(rows)) throw new Error("Screen208Preflight: the OpenCode Go catalog has no data array");
  const byId = new Map(rows.map((row) => [row.id, row]));
  return refs.map((ref) => {
    const model = ref.split("/").slice(1).join("/");
    const row = byId.get(model);
    if (!row) throw new Error(`Screen208Preflight: ${ref} is not in the OpenCode Go catalog`);
    const price = row.cost?.text;
    if (!/-free$/.test(model) || price?.input?.price !== 0 || price?.output?.price !== 0)
      throw new Error(`Screen208Preflight: ${ref} is not priced at zero in the OpenCode Go catalog`);
    if (row.capabilities?.tools?.supported !== true) throw new Error(`Screen208Preflight: ${ref} takes no tools`);
    return { ref, contextWindow: row.limit?.context ?? null, canonical: row.canonical_id ?? null };
  });
}

/**
 * Every model a worker calls must be in its provider's live catalog, free, and able to take tools, or nothing runs:
 * the worker's own answer models (a worker that never calls a model is not refused for it) and the judge panel.
 * Options: `catalog` (Kilo), `routed` (OpenRouter), `commandcode`, `keyTier` (OpenRouter allowance).
 */
export async function preflightScreen208(manifest, options = {}) {
  const refs = [...new Set([...manifest.jobs.map((job) => `${job.provider}/${job.model}`), ...manifest.models.judges])];
  const of = (provider) => refs.filter((ref) => ref.startsWith(`${provider}/`));
  const unknown = refs.filter((ref) => !["kilo/", "openrouter/", "commandcode/", "opencode-go/"].some((prefix) => ref.startsWith(prefix)));
  if (unknown.length) throw new Error(`Screen208Preflight: no catalog check for ${unknown.join(", ")}`);
  const record = { kind: "208-free-panel", checkedAt: new Date().toISOString(), provider: "kilo", panel: [] };
  if (of("kilo").length)
    record.panel = await readKiloFreePanel({
      refs: of("kilo"),
      ...(options.catalog ? { catalog: options.catalog } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  if (of("openrouter").length) {
    const routedPanel = await readKiloFreePanel({ refs: of("openrouter"), baseUrl: "https://openrouter.ai/api/v1", ...options.routed });
    // The key's allowance is read, never spent: the free allowance is what bounds this route.
    const key = await (options.keyTier ?? readOpenRouterKeyTier)();
    if (key.dailyFreeRequests < 1000)
      throw new Error(`Screen208Route: the key allows ${key.dailyFreeRequests} free requests a day; the amendment assumes 1000`);
    record.route = { provider: "openrouter", panel: routedPanel, dailyFreeRequests: key.dailyFreeRequests, paidTier: key.paidTier };
  }
  if (of("commandcode").length)
    record.commandcode = await readCommandCodePanel({
      refs: of("commandcode"),
      paidAnswers: manifest.billing?.paidAnswers ?? [],
      ...options.commandcode,
    });
  if (of("opencode-go").length) record.opencodeGo = await readOpenCodeGoPanel({ refs: of("opencode-go"), ...options.opencodeGo });
  return record;
}

export async function writeScreen208Manifest({ root = ".", path = join(root, SCREEN208_MANIFEST) } = {}) {
  const manifest = await buildScreen208Manifest({ root });
  await mkdir(join(root, SCREEN208_EVIDENCE), { recursive: true });
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...manifest }, null, 2)}\n`);
  return manifest;
}
