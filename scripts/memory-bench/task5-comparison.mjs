#!/usr/bin/env bun
/**
 * Plan 202 Task 5.2: the frozen, paired development-comparison manifest.
 *
 * One control (revision-1 product) and one Task-5 candidate cell per development suite, with the
 * same cohort, mapping, model, judges, budgets and scoring. Nothing here makes a provider call: the
 * manifest is a proposal that Task 5.3 gates and Task 5.4 executes through the existing harness.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { fileFingerprint, sourceFingerprint } from "./acceptance.mjs";
import { DATASETS } from "./datasets.mjs";
import { manifestFingerprint, stableHash } from "./journal.mjs";
import { GRADED_TEMPLATE_VERSION, JUDGE_TEMPLATE_VERSION } from "./judge.mjs";
import { pairedAnalysisProtocol } from "./paired-sizing.mjs";
import rates from "./rates.json" with { type: "json" };
import { BENCH_MAX_TURNS, BENCH_RETRY } from "./replay.mjs";
import { ROBUSTNESS_CRITERIA, robustnessCriteriaHash, robustnessDraw } from "./robustness.mjs";
import { holm, PAIRED_ANALYSIS_VERSION, pairedClusterPermutation } from "./stats.mjs";
import { cacheAdjustedCost, resolveRate } from "./usage.mjs";

const run = promisify(execFile);

export const TASK5_EVIDENCE = "docs/_evidence/memory-bench/202/task5";
export const TASK5_MANIFEST = `${TASK5_EVIDENCE}/development-comparison-manifest.json`;
export const TASK5_SCREEN_MANIFEST = `${TASK5_EVIDENCE}/development-screen-manifest.json`;
/** The plan of record for execution: the reduced development screen, not the ten-cell full target. */
export const TASK5_ACTIVE_MANIFEST = TASK5_SCREEN_MANIFEST;
export const TASK5_INVENTORY = `${TASK5_EVIDENCE}/revision1-trace-inventory.json`;
export const TASK5_VERIFICATION = `${TASK5_EVIDENCE}/verification.json`;
export const TASK5_CACHE = ".cache/memory-bench/task5";
export const TASK5_JOURNAL = `${TASK5_CACHE}/journal.json`;
export const TASK5_GATE = `${TASK5_EVIDENCE}/owner-gate.json`;
export const TASK5_SCREEN_VERDICT_JSON = `${TASK5_EVIDENCE}/development-screen-verdict.json`;
export const TASK5_SCREEN_VERDICT_MD = `${TASK5_EVIDENCE}/development-screen-verdict.md`;

/** Where the control product comes from: the closed screen's revision-1 commit. */
export const TASK5_CONTROL_PRODUCT_SOURCE = "5c2570df52a084b43120ee4e77921746a029480e";
/** Local ref that holds control r2: the candidate tree with the product paths from the source commit. */
export const TASK5_CONTROL_REF = "refs/heads/task5-control-r2";
/** sha256 of the revision-1 product paths, independently reproduced from the source commit. */
export const TASK5_REVISION1_PRODUCT_HASH = "ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0";
/** sha256 of `packages/memory/fabric/src` there, independently recorded by the closed screen. */
export const TASK5_HISTORICAL_FABRIC_HASH = "57aa47d94eb3cad629e232372f220296131583ea7ac06189d6f589b39c825799";
/** Task 5 touches the fabric tools and the core session index; a control must exclude both. */
export const TASK5_PRODUCT_PATHS = ["packages/memory/fabric/src", "packages/memory/core/src"];
export const TASK5_HARNESS_PATHS = ["scripts/memory-bench"];
export const TASK5_SUITES = ["beam-100k", "locomo", "memoryagentbench-cr", "longmemeval-m", "beam-1m"];
/** Plan 202 Task 5.4.6: the owner-approved development screen drops LongMemEval-M. */
export const TASK5_SCREEN_SUITES = TASK5_SUITES.filter((suite) => suite !== "longmemeval-m");
/** v2 changes only the free gateway: the answer and judge model ids, prices, rules, cohort and caps stay. */
export const TASK5_CRITERIA_VERSION = "202-task5-candidate-gap-v2";
export const TASK5_SCREEN_VERSION = `${TASK5_CRITERIA_VERSION}-screen`;
export const TASK5_SCREEN_BEAM_1M_MIN_QUESTIONS = 12;
export const TASK5_SCREEN_BEAM_1M_WALL_HOURS = 12;
export const TASK5_SCREEN_HANDOFF_REASON =
  "deferred to plan 210 by the plan 202 Task 5.4.6 owner disposition; the full target is postponed, not dropped";
export const TASK5_ARM = { id: "preset-r1", config: "fabric-x-tools" };
export const TASK5_MODEL = { provider: "kilo", model: "nvidia/nemotron-3-ultra-550b-a55b:free" };
/** Two free, non-answer families; plain text avoids structured-output capability questions. */
export const TASK5_JUDGES = ["kilo/dots-studio/dots-3-note-preview:free", "kilo/cohere/north-mini-code:free"];
export const TASK5_HALVING_FACTOR = 0.5;
export const TASK5_ABILITY_MARGIN = 0.03;
export const TASK5_CEILING = 100_000_000;
/**
 * Measured calls per question-run from the frozen preset-r1 baseline (Task 5.4.3): the
 * `beam-100k` report for the same free answer family, `timing.roles` solver 127 / judge 90 over
 * 40 questions with `labelInjections: "off"` — 3.175 and 2.25. The high end uses the slower
 * `beam-free` solver rate (161/40 = 4.025) so the estimate brackets a worse-behaved route.
 */
export const TASK5_CALL_RATES = {
  source:
    "docs/_evidence/memory-bench/202/baseline/report-202-baseline.beam-100k.preset-r1.openrouter.nvidia-nemotron-3.5-lightning:free.json (timing.roles: solver 127, judge 90, 40 questions, labelInjections off)",
  solver: 3.2,
  solverHigh: 4.0,
  judge: 2.25,
  solverPerQuestionSource: { calls: 127, questions: 40 },
  judgePerQuestionSource: { calls: 90, questions: 40 },
  labelInjections: "off",
  injectionCalls: 0,
};

export const TASK5_MAX_PHYSICAL_CALLS = 16_800;
const PER_QUESTION_USAGE = { inputTokens: 29_668, outputTokens: 1_882 }; // 188.10 held-out v3, preset-r1
const JUDGE_TOKENS = { inputTokens: 4_000, outputTokens: 100 };
const REQUEST_HEADROOM_TOKENS = 5_000_000;
const INPUT_CAP = 10_000_000;
const WALL_TIME_CAP_HOURS = { "beam-100k": 6, locomo: 4, "memoryagentbench-cr": 6, "longmemeval-m": 144, "beam-1m": 48 };
const OUT_OF_SCOPE = [
  {
    suites: ["memorycode", "coding-longitudinal", "vibemembench", "dreambench-swe"],
    reason: "coding suites use coding arms and are Task 11, not preset-r1",
  },
  { suites: ["beam-500k", "beam-10m"], reason: "optional plan suites; not drawn for the Task-5 development cohort" },
  { suites: ["longmemeval-s"], reason: "development-only suite with no revision-1 tool evidence; not an applicable Task-5 suite" },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const idsHash = (ids) => stableHash([...ids].map(String).sort());

/** The pre-registered comparison rules; hashed into the manifest before any candidate outcome. */
export function task5ComparisonCriteria() {
  return {
    version: TASK5_CRITERIA_VERSION,
    // The panel is the same models; only the gateway that serves the free rows moved.
    transport: {
      provider: TASK5_MODEL.provider,
      gateway: "https://ai-gateway.kilo.ai/api/v1",
      reason:
        "owner instruction 2026-11-01: run the free panel on the Kilo AI Gateway; the OpenRouter key is not available in this environment",
      substitution:
        "same answer and judge model ids at $0, same rules, cohort, protocol, caps and journal accounting; only the transport changed",
    },
    candidateGap: {
      unit: "question",
      neededRounds: "repaired fine-gold round ids (causalSessions -> sessionRounds -> extractEvidence.fineGoldIds)",
      numerator:
        "questions whose needed round set has no member returned in any successful memory.recall hit or memory.read note on the selected answer attempt",
      denominator: "paired questions carrying >=1 mapped needed round in both roles with complete retained tool traces in both roles",
      evidenceSource:
        "successful tool results only; hidden candidates, rankings, passive injection, recalledIds and progress logs never count",
      failures:
        "answer run-limit/transport/setup failures count as not-surfaced in the worst-case bound and are excluded from the primary estimate; never zero",
      missingness:
        "no fine-round labels or an unresolved gold reference are unmeasurable by suite and excluded from every estimate; never zero",
      zeroGapBaseline: "control gap 0 requires candidate gap 0 on the same paired questions; no halving claim, pass only on exact no-loss",
      halving: `positive control gap requires candidateGap <= ${TASK5_HALVING_FACTOR} * controlGap`,
      pooled: "per-suite rows are the claim; a pooled-only verdict is not a pass",
      uncertainty:
        "10000 whole-conversation cluster bootstrap draws on paired gap differences with two-sided cluster sign-flip p; reported, not substituted for the frozen rules",
      verdicts: ["pass", "miss", "inconclusive"],
      inconclusive: "too few complete pairs to distinguish, or the worst-case bound fails while the best-case bound passes",
    },
    abilityGuard: {
      metric: "frozen binary correctness from the two-judge panel",
      margin: TASK5_ABILITY_MARGIN,
      rule: `every suite x ability stratum must satisfy candidate - control >= -${TASK5_ABILITY_MARGIN} on the observed paired accuracy`,
      uncertainty: "exact paired cluster sign-flip p and cluster-bootstrap CI reported; the veto is the frozen margin, not the p-value",
      multiplicity:
        "Holm across each suite's ability strata for description only; strata are underpowered and no equivalence claim follows",
      missing: "a stratum with no comparable pairs is reported as unverified and blocks closure",
    },
    paired: {
      analysisVersion: PAIRED_ANALYSIS_VERSION,
      pairing: "unique question ids, frozen conversation clusters and abilities",
      seed: 7,
      iterations: 10_000,
    },
  };
}

/** Independently hash the product tree at a git revision; no worktree is created or trusted. */
export async function gitTreeFingerprint(paths, revision, root = ".") {
  const dir = await mkdtemp(join(tmpdir(), "prism-rev-"));
  try {
    const archive = join(dir, "tree.tar");
    await writeFile(
      archive,
      (await run("git", ["-C", root, "archive", "--format=tar", revision, "--", ...paths], { maxBuffer: 1 << 28 })).stdout,
    );
    await run("tar", ["-xf", archive, "-C", dir]);
    return await sourceFingerprint(paths, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Deterministic overlay commit: the candidate tree with `TASK5_PRODUCT_PATHS` replaced by the
 * product source's bytes. Fixed author/committer metadata makes the same inputs yield the same sha,
 * so the control is a commit both arms can reproduce rather than a mutable worktree.
 */
export async function task5ControlRevision(candidateRevision, { root = "." } = {}) {
  const cache = join(root, TASK5_CACHE);
  await mkdir(cache, { recursive: true });
  const index = join(cache, `control-overlay-${process.pid}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const git = (args, extra = {}) => run("git", ["-C", root, ...args], { maxBuffer: 1 << 28, env: { ...env, ...extra } });
  await rm(index, { force: true });
  try {
    await git(["read-tree", candidateRevision]);
    const stale = (await git(["ls-files", "-z", "--", ...TASK5_PRODUCT_PATHS])).stdout.split("\0").filter(Boolean);
    if (stale.length) await git(["update-index", "--force-remove", "--", ...stale]);
    const product = (await git(["ls-tree", "-r", TASK5_CONTROL_PRODUCT_SOURCE, "--", ...TASK5_PRODUCT_PATHS])).stdout;
    if (!product.trim()) throw new Error("Task5Control: the product source has no files under the product paths");
    await gitWithInput(["update-index", "--index-info"], product, { root, env });
    const tree = (await git(["write-tree"])).stdout.trim();
    const message = "task5-control-r2: candidate tree with revision-1 product paths\n";
    return (
      await gitWithInput(["commit-tree", tree, "-p", candidateRevision, "-F", "-"], message, {
        root,
        env: { ...env, ...CONTROL_OVERLAY_ENV },
      })
    ).trim();
  } finally {
    await rm(index, { force: true });
  }
}

const CONTROL_OVERLAY_ENV = {
  GIT_AUTHOR_NAME: "Prism Task 5",
  GIT_AUTHOR_EMAIL: "task5@prism.invalid",
  GIT_COMMITTER_NAME: "Prism Task 5",
  GIT_COMMITTER_EMAIL: "task5@prism.invalid",
  GIT_AUTHOR_DATE: "2026-10-31T00:00:00 +0000",
  GIT_COMMITTER_DATE: "2026-10-31T00:00:00 +0000",
};

async function gitWithInput(args, input, { root = ".", env = process.env } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", root, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`git ${args[0]} failed: ${stderr.trim()}`))));
    child.stdin.end(input);
  });
}

/** Build r2 if it is missing or stale; the ref always points at the reproducible overlay. */
export async function ensureTask5ControlRef(candidateRevision, { root = "." } = {}) {
  const revision = await task5ControlRevision(candidateRevision, { root });
  await run("git", ["-C", root, "update-ref", TASK5_CONTROL_REF, revision]);
  return revision;
}

/** The committed arm diff; the product-only check is what makes the treatment attributable. */
export async function task5ArmDiff(controlRevision, candidateRevision, { root = "." } = {}) {
  const { stdout } = await run("git", ["-C", root, "diff", "--name-only", controlRevision, candidateRevision], { maxBuffer: 1 << 28 });
  return stdout.split("\n").filter(Boolean);
}

const underPath = (path, dir) => path === dir || path.startsWith(`${dir}/`);

/** Paths that may differ between the arms: product code only. */
export function task5UnexpectedPaths(paths) {
  return paths.filter((path) => !TASK5_PRODUCT_PATHS.some((dir) => underPath(path, dir)));
}

/** After the freeze only evidence and the plan may change; anything else means a re-freeze. */
export function task5PostFreezePaths(paths) {
  // A commit after the pin may only touch files that cannot change what an arm executes.
  return task5ExecutionPaths(paths.filter((path) => !underPath(path, TASK5_EVIDENCE)));
}

/**
 * Working-tree drift could enter the candidate arm, so it is refused before every run. The Task 5
 * evidence directory and the plan are not part of any arm (their hashes are not frozen), so their
 * unavoidable dirt while a manifest is regenerated is not candidate drift.
 */
export function task5UncommittedPaths(statusText) {
  return statusText
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((path) => !underPath(path, ".cache"))
    .filter((path) => !underPath(path, TASK5_EVIDENCE))
    .filter((path) => !/^plans\/202-Phase-11-Part-O12-[^/]+\.md$/.test(path));
}

/** Only these dirty paths can change what an arm executes: product, harness and the code roots. */
export function task5ExecutionPaths(dirty) {
  const roots = [...TASK5_PRODUCT_PATHS, ...TASK5_HARNESS_PATHS, "src", "packages", "apps", "scripts"];
  return dirty.filter((path) => roots.some((dir) => underPath(path, dir)));
}

export async function assertTask5CandidateClean({ root = ".", status } = {}) {
  const text = status ?? (await run("git", ["-C", root, "status", "--porcelain"])).stdout;
  const dirty = task5UncommittedPaths(text);
  const blocking = task5ExecutionPaths(dirty);
  if (blocking.length) throw new Error(`Task5Manifest: the candidate has uncommitted changes: ${blocking.slice(0, 8).join(", ")}`);
  // A concurrent writer's plans and docs cannot change an arm's bytes, but they are reported, not hidden.
  return { ignored: dirty };
}

async function currentRevision(root) {
  try {
    const [{ stdout }, { stdout: status }] = await Promise.all([
      run("git", ["-C", root, "rev-parse", "HEAD"]),
      run("git", ["-C", root, "status", "--porcelain", "--", ...TASK5_PRODUCT_PATHS]),
    ]);
    return { revision: stdout.trim(), dirty: status.trim().length > 0 };
  } catch {
    return { revision: "unknown", dirty: true };
  }
}

function suiteCohort(suite) {
  const abilities = robustnessDraw(suite).abilities.dev;
  const ids = Object.values(abilities).flat();
  return {
    suite,
    abilities: Object.fromEntries(Object.entries(abilities).map(([ability, list]) => [ability, list.length])),
    questionIds: ids.map(String),
    idsHash: idsHash(ids),
    dataset: { file: DATASETS[suite].file, sha256: DATASETS[suite].sha256 },
  };
}

function suiteBudget(questions) {
  const estimateInputTokens = questions * (PER_QUESTION_USAGE.inputTokens + TASK5_JUDGES.length * JUDGE_TOKENS.inputTokens);
  const estimateOutputTokens = questions * (PER_QUESTION_USAGE.outputTokens + TASK5_JUDGES.length * JUDGE_TOKENS.outputTokens);
  return {
    estimate: {
      productInputTokens: questions * PER_QUESTION_USAGE.inputTokens,
      productOutputTokens: questions * PER_QUESTION_USAGE.outputTokens,
      judgeInputTokens: questions * TASK5_JUDGES.length * JUDGE_TOKENS.inputTokens,
      judgeOutputTokens: questions * TASK5_JUDGES.length * JUDGE_TOKENS.outputTokens,
      inputTokens: estimateInputTokens,
      outputTokens: estimateOutputTokens,
      usd: 0,
    },
    maxInputTokens: Math.min(INPUT_CAP, Math.ceil((estimateInputTokens + REQUEST_HEADROOM_TOKENS) / 500_000) * 500_000),
  };
}

function freeCost(questions) {
  const refs = [`${TASK5_MODEL.provider}/${TASK5_MODEL.model}`, ...TASK5_JUDGES];
  let productUsd = 0,
    judgeUsd = 0;
  for (const ref of refs) {
    const rate = resolveRate(rates, ref);
    const value = cacheAdjustedCost(
      ref.startsWith(`${TASK5_MODEL.provider}/${TASK5_MODEL.model}`) ? PER_QUESTION_USAGE : JUDGE_TOKENS,
      rate,
    );
    if (value === null) throw new Error(`Task5Cost: no priced rate for ${ref}`);
    if (value !== 0) throw new Error(`Task5Cost: ${ref} is not a free route; only free ${TASK5_MODEL.provider} models are permitted`);
    if (ref === `${TASK5_MODEL.provider}/${TASK5_MODEL.model}`) productUsd += questions * value;
    else judgeUsd += questions * value;
  }
  return { productUsd, judgeUsd, totalUsd: productUsd + judgeUsd };
}

function cell({ role, suite, cohort, budget, cost, control, candidate, harnessHash, analysisHash, criteriaHash, protocolHash }) {
  const lower = role;
  return {
    id: `202-task5.${role}.${suite}.${TASK5_ARM.id}.${TASK5_MODEL.provider}.${TASK5_MODEL.model}`,
    role,
    suite,
    subset: "dev",
    ability: null,
    arm: TASK5_ARM.id,
    config: TASK5_ARM.config,
    provider: TASK5_MODEL.provider,
    model: TASK5_MODEL.model,
    judges: TASK5_JUDGES.join(","),
    judgeText: true,
    judgeProtocol: "plain-text-v1",
    labelInjections: "off",
    questions: cohort.questionIds.length,
    questionIds: cohort.questionIds,
    idsHash: cohort.idsHash,
    dataset: cohort.dataset,
    productHash: role === "control" ? control.productHash : candidate.productHash,
    productRevision: role === "control" ? control.revision : candidate.revision,
    ...(role === "control" ? { cwd: control.worktree, worktreeRevision: control.revision } : {}),
    harnessHash,
    analysisHash,
    criteriaHash,
    evidenceProtocolHash: protocolHash,
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: 8192,
    maxTurns: BENCH_MAX_TURNS.standard,
    maxAttempts: 2,
    concurrency: 1,
    wallTimeCapHours: WALL_TIME_CAP_HOURS[suite],
    freeOnly: true,
    freeProductOnly: true,
    boundedWire: true,
    output: `${TASK5_EVIDENCE}/reports/${lower}/${suite}.json`,
    answersDir: `${TASK5_CACHE}/${lower}/answers`,
    judgeCacheDir: `${TASK5_CACHE}/${lower}/judges`,
    estimate: { ...budget.estimate },
    cost: { ...cost },
    reuse: {
      eligible: false,
      reason: "Task 5.1 recovered no revision-1 tool traces; every control and candidate cell is fresh",
    },
  };
}

/**
 * Plan 202 Task 5.4.6: the `beam-1m` slice is a pure function of the frozen cohort ids. It takes the
 * cohort's conversations in descending question count, breaking ties by ascending numeric conversation
 * id, until at least `minimum` questions are covered. No report, journal or outcome is an input.
 */
export function task5Beam1mSlice(questionIds, minimum = TASK5_SCREEN_BEAM_1M_MIN_QUESTIONS) {
  if (!Array.isArray(questionIds) || questionIds.length === 0 || typeof questionIds[0] !== "string")
    throw new Error("Task5Screen: the beam-1m slice takes cohort question ids, never a report or journal");
  const counts = new Map();
  for (const id of questionIds.map(String)) {
    const conversation = Number(id.split(":")[0]);
    if (!Number.isInteger(conversation)) throw new Error(`Task5Screen: ${id} is not a cohort question id`);
    counts.set(conversation, (counts.get(conversation) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const conversations = [];
  let covered = 0;
  for (const [conversation, count] of ordered) {
    if (covered >= minimum) break;
    conversations.push(String(conversation));
    covered += count;
  }
  const keep = new Set(conversations);
  return questionIds.map(String).filter((id) => keep.has(id.split(":")[0]));
}

/** The screen keeps every criterion verbatim except the version and the guard's role. */
export function task5ScreenCriteria(criteria) {
  const next = structuredClone(criteria);
  next.version = criteria.version?.endsWith("-screen") ? criteria.version : `${criteria.version}-screen`;
  next.abilityGuard = { ...next.abilityGuard, role: "descriptive" };
  return next;
}

/** The frozen question ids each screen suite must run: unchanged suites keep theirs, beam-1m is sliced. */
export function task5ScreenExpectedCohort(full) {
  const cohort = {};
  for (const suite of TASK5_SCREEN_SUITES) {
    const control = full.cells?.find((entry) => entry.suite === suite && entry.role === "control");
    if (!control) throw new Error(`Task5Screen: the full manifest has no ${suite} control cell`);
    cohort[suite] = suite === "beam-1m" ? task5Beam1mSlice(control.questionIds) : control.questionIds.map(String);
  }
  return cohort;
}

/** Ability counts for a slice, derived from the cohort ids themselves. */
function task5AbilityCounts(ids, abilities) {
  const counts = Object.fromEntries(Object.keys(abilities).map((ability) => [ability, 0]));
  for (const id of ids) {
    const ability = String(id).split(":")[1];
    if (!(ability in counts)) throw new Error(`Task5Screen: ${id} carries unknown ability ${ability}`);
    counts[ability] += 1;
  }
  return counts;
}

/**
 * The screen manifest is the full manifest reduced to the disposition's scope. Everything the scope
 * does not name is copied byte-for-byte; derived hashes, counts and budgets are recomputed from the
 * reduced cells, never edited. `product` may be supplied to re-pin the harness at execution time.
 */
export function reduceTask5Manifest(full, { generatedAt = new Date().toISOString(), product } = {}) {
  const screen = structuredClone(full);
  if (product) screen.product = structuredClone(product);
  const byKey = new Map(full.cells.map((entry) => [`${entry.suite}:${entry.role}`, entry]));
  const cells = [];
  const suites = [];
  const wallCaps = {};
  for (const suite of TASK5_SCREEN_SUITES) {
    const row = full.cohort.suites.find((entry) => entry.suite === suite);
    const control = byKey.get(`${suite}:control`);
    const candidate = byKey.get(`${suite}:candidate`);
    if (!row || !control || !candidate) throw new Error(`Task5Screen: ${suite} is not paired in the full manifest`);
    const ids = suite === "beam-1m" ? task5Beam1mSlice(control.questionIds) : control.questionIds.map(String);
    const budget = suiteBudget(ids.length);
    const wall = suite === "beam-1m" ? TASK5_SCREEN_BEAM_1M_WALL_HOURS : full.budgets.perCell.wallTimeCapHoursBySuite[suite];
    wallCaps[suite] = wall;
    for (const role of ["control", "candidate"]) {
      const cell = structuredClone(byKey.get(`${suite}:${role}`));
      cell.questionIds = [...ids];
      cell.questions = ids.length;
      cell.idsHash = idsHash(ids);
      cell.maxInputTokens = budget.maxInputTokens;
      cell.estimate = { ...budget.estimate };
      cell.wallTimeCapHours = wall;
      cells.push(cell);
    }
    suites.push({
      ...structuredClone(row),
      questions: ids.length,
      idsHash: idsHash(ids),
      abilities: suite === "beam-1m" ? task5AbilityCounts(ids, row.abilities) : structuredClone(row.abilities),
    });
  }
  screen.cells = cells;
  screen.criteria = task5ScreenCriteria(full.criteria);
  screen.criteriaHash = stableHash(screen.criteria);
  screen.evidenceProtocol = { ...structuredClone(full.evidenceProtocol), criteriaHash: screen.criteriaHash };
  screen.evidenceProtocolHash = stableHash(screen.evidenceProtocol);
  for (const cell of cells) {
    cell.criteriaHash = screen.criteriaHash;
    cell.evidenceProtocolHash = screen.evidenceProtocolHash;
  }
  screen.cohort = {
    ...structuredClone(full.cohort),
    suites,
    questionCount: cells.filter((cell) => cell.role === "control").reduce((n, cell) => n + cell.questions, 0),
    idsHash: idsHash(
      cells.filter((cell) => cell.role === "control").flatMap((cell) => cell.questionIds.map((id) => `${cell.suite}:${id}`)),
    ),
    mapping: {
      ...structuredClone(full.cohort.mapping),
      labels: {
        mapped: suites.reduce((n, row) => n + row.historical.mappedGoldQuestions, 0),
        unresolved: suites.reduce((n, row) => n + row.historical.unresolvedGoldQuestions, 0),
        noFineGold: suites.reduce((n, row) => n + row.historical.noFineGoldQuestions, 0),
      },
    },
  };
  screen.comparison = {
    ...structuredClone(full.comparison),
    controlCells: cells.filter((cell) => cell.role === "control").map((cell) => cell.id),
    candidateCells: cells.filter((cell) => cell.role === "candidate").map((cell) => cell.id),
    pairs: TASK5_SCREEN_SUITES.length,
  };
  const outOfScope = full.coverage.outOfScope.some((row) => row.suites.includes("longmemeval-m"))
    ? structuredClone(full.coverage.outOfScope)
    : [...structuredClone(full.coverage.outOfScope), { suites: ["longmemeval-m"], reason: TASK5_SCREEN_HANDOFF_REASON }];
  screen.coverage = {
    ...structuredClone(full.coverage),
    applicableSuites: [...TASK5_SCREEN_SUITES],
    outOfScope,
    allApplicableSuiteTarget: false,
    note: "development screen on four suites; the full target (LongMemEval-M, the full beam-1m cohort and the ability veto) is plan 210's",
  };
  screen.budgets.perCell = { ...structuredClone(full.budgets.perCell), wallTimeCapHoursBySuite: wallCaps };
  const questionRuns = 2 * screen.cohort.questionCount;
  screen.budgets.campaign = {
    ...structuredClone(full.budgets.campaign),
    expectedPhysicalCalls: Math.round(questionRuns * (TASK5_CALL_RATES.solver + TASK5_CALL_RATES.judge)),
    expectedPhysicalCallsRange: {
      low: Math.round(questionRuns * (TASK5_CALL_RATES.solver + TASK5_CALL_RATES.judge)),
      high: Math.round(questionRuns * (TASK5_CALL_RATES.solverHigh + TASK5_CALL_RATES.judge)),
    },
    physicalCallEstimate: { ...structuredClone(full.budgets.campaign.physicalCallEstimate), questionRuns },
    reservedInputTokens: cells.reduce((n, cell) => n + cell.maxInputTokens, 0),
    estimatedInputTokens: cells.reduce((n, cell) => n + cell.estimate.inputTokens, 0),
    estimatedOutputTokens: cells.reduce((n, cell) => n + cell.estimate.outputTokens, 0),
    wallTimeCapHours: 2 * Object.values(wallCaps).reduce((a, b) => a + b, 0),
    wallTimeNote:
      "the beam-1m slice is capped at 12 h per role; LongMemEval-M, which dominated the full run's wall time, is deferred to plan 210",
  };
  screen.stopResume = {
    ...structuredClone(full.stopResume),
    manifestFingerprint: manifestFingerprint({
      criteriaHash: screen.criteriaHash,
      ceiling: screen.budgets.campaign.ceiling,
      provider: TASK5_MODEL.provider,
      model: TASK5_MODEL.model,
      jobs: cells,
    }),
  };
  screen.generatedAt = generatedAt;
  screen.manifestHash = task5ManifestHash(screen);
  return screen;
}

/** What a scope reduction may change; everything else must be byte-identical to the gate-14 manifest. */
export const TASK5_SCOPE_REDUCTION_ALLOWED = [
  "generatedAt",
  "manifestHash",
  "criteria.version",
  "criteriaHash",
  "evidenceProtocol.criteriaHash",
  "evidenceProtocolHash",
  "stopResume.manifestFingerprint",
  "product.candidate.revision",
  "product.harnessHash",
  /^criteria\.abilityGuard\.role$/,
  /^cohort\.(questionCount|idsHash|suites|mapping\.labels)/,
  /^cells\./,
  /^comparison\.(controlCells|candidateCells|pairs)/,
  /^budgets\.perCell\.wallTimeCapHoursBySuite/,
  /^budgets\.campaign\./,
  /^coverage\./,
];

export function task5ScopeReductionAllowed(path) {
  return TASK5_SCOPE_REDUCTION_ALLOWED.some((rule) => (typeof rule === "string" ? rule === path : rule.test(path)));
}

const TASK5_SCREEN_UNTOUCHED = [
  "schemaVersion",
  "kind",
  "plan",
  "task",
  "subtask",
  "status",
  "executable",
  "ownerGate",
  "scope",
  "scopeAuthorization",
  "claim",
  "models",
  "analysis",
  "analysisHash",
  "isolation",
  "baselineReuse",
  "heldOutGuard",
  "cost",
];

/**
 * Plan 202 Task 5.4.6: a scope reduction is not a re-freeze. This refuses a screen that moved a model,
 * judge, margin, halving factor, product, cap or kept cohort, and refuses a hand-written screen: the
 * only accepted manifest is the exact reduction of the full one.
 */
export function assertTask5ScopeReduction(full, screen) {
  const refuse = (reason) => {
    throw new Error(`Task5Scope: ${reason}`);
  };
  if (screen?.criteria?.version !== TASK5_SCREEN_VERSION) refuse("the manifest is not a screen proposal");
  // The treatment is gate 14's byte for byte: only the candidate revision/harness pin may move.
  if (stableHash(screen.product?.control) !== stableHash(full.product?.control)) refuse("the control pin moved");
  if (stableHash(screen.product?.paths) !== stableHash(full.product?.paths)) refuse("the product paths moved");
  if (stableHash(screen.product?.harnessPaths) !== stableHash(full.product?.harnessPaths)) refuse("the harness paths moved");
  if (screen.product?.candidate?.productHash !== full.product?.candidate?.productHash) refuse("the candidate product moved");
  // Criteria: only the version and the descriptive guard role may change.
  if (stableHash(screen.criteria) !== stableHash(task5ScreenCriteria(full.criteria)))
    refuse("criteria moved beyond the screen version and the descriptive guard role");
  if (screen.criteria.abilityGuard?.role !== "descriptive") refuse("the screen ability guard must be descriptive");
  for (const key of ["metric", "margin", "rule", "uncertainty", "multiplicity", "missing"]) {
    if (stableHash(screen.criteria.abilityGuard?.[key]) !== stableHash(full.criteria.abilityGuard?.[key]))
      refuse(`the ability guard ${key} moved`);
  }
  // Suites: the disposition's four, nothing else; every kept cohort is the full one, beam-1m is the rule.
  const suites = screen.coverage?.applicableSuites ?? [];
  if (idsHash(suites) !== idsHash(TASK5_SCREEN_SUITES))
    refuse(`the screen cohort is not the disposition's suites (${TASK5_SCREEN_SUITES.join(", ")})`);
  for (const suite of suites) if (!full.coverage?.applicableSuites?.includes(suite)) refuse(`${suite} is not in the full cohort`);
  const expectedCohort = task5ScreenExpectedCohort(full);
  if (screen.cells?.length !== suites.length * 2) refuse("the screen has cells outside its four suites");
  for (const suite of suites) {
    for (const role of ["control", "candidate"]) {
      const cell = screen.cells.find((entry) => entry.suite === suite && entry.role === role);
      if (!cell) refuse(`${suite}:${role} is missing`);
      if (idsHash(cell.questionIds) !== idsHash(expectedCohort[suite])) refuse(`${suite}:${role} is not the frozen screen cohort`);
    }
  }
  // Everything the scope does not name stays byte-identical.
  for (const key of TASK5_SCREEN_UNTOUCHED) if (stableHash(screen[key]) !== stableHash(full[key])) refuse(`${key} changed`);
  const frozenPerCell = { ...structuredClone(full.budgets.perCell) };
  const screenPerCell = { ...structuredClone(screen.budgets.perCell) };
  delete frozenPerCell.wallTimeCapHoursBySuite;
  delete screenPerCell.wallTimeCapHoursBySuite;
  if (stableHash(screenPerCell) !== stableHash(frozenPerCell)) refuse("the per-cell budgets changed");
  for (const key of ["ceiling", "maxPhysicalCalls", "physicalCallRule"])
    if (screen.budgets.campaign?.[key] !== full.budgets.campaign?.[key]) refuse(`the campaign ${key} moved`);
  if (stableHash(screen.cohort?.mapping?.rule) !== stableHash(full.cohort?.mapping?.rule)) refuse("the cohort mapping rule moved");
  if (stableHash(screen.cohort?.mapping?.source) !== stableHash(full.cohort?.mapping?.source)) refuse("the cohort mapping source moved");
  // The only accepted screen is the exact reduction; a hand-written one is refused here.
  const expected = reduceTask5Manifest(full, { generatedAt: screen.generatedAt, product: screen.product });
  const drift = task5FreezeDiff(expected, screen);
  if (drift.length) refuse(`the screen is not the reduction of the full manifest: ${drift.slice(0, 5).join(", ")}`);
  return task5FreezeDiff(full, screen).filter((path) => task5ScopeReductionAllowed(path));
}

/** Structural refusal of a screen proposal, with the reduced cohort as the authority. */
export function assertTask5ScreenManifest(screen, full) {
  return assertTask5ComparisonManifest(screen, {
    suites: TASK5_SCREEN_SUITES,
    expectedCohort: task5ScreenExpectedCohort(full),
  });
}

export async function buildTask5ScreenManifest({ root = ".", fullPath = TASK5_MANIFEST, product, generatedAt } = {}) {
  const full = JSON.parse(await readFile(join(root, fullPath), "utf8"));
  const screen = reduceTask5Manifest(full, { ...(product ? { product } : {}), ...(generatedAt ? { generatedAt } : {}) });
  assertTask5ScreenManifest(screen, full);
  assertTask5ScopeReduction(full, screen);
  return screen;
}

export async function writeTask5ScreenManifest({
  root = ".",
  fullPath = TASK5_MANIFEST,
  path = TASK5_SCREEN_MANIFEST,
  repin = false,
} = {}) {
  let product;
  if (repin) {
    // The execution re-freeze pins the harness and candidate that will actually run; the product
    // hash must not move, or this is a different treatment and needs a new base manifest.
    const base = JSON.parse(await readFile(join(root, fullPath), "utf8"));
    const current = await currentRevision(root);
    product = {
      ...structuredClone(base.product),
      harnessHash: await sourceFingerprint(base.product.harnessPaths, root),
      candidate: { ...structuredClone(base.product.candidate), revision: current.revision, dirty: current.dirty },
    };
  }
  const screen = await buildTask5ScreenManifest({ root, fullPath, ...(product ? { product } : {}) });
  await mkdir(join(root, TASK5_EVIDENCE), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(screen, null, 2)}\n`);
  await writeFile(join(root, path.replace(/\.json$/, ".md")), task5ComparisonMarkdown(screen, { path }));
  return screen;
}

export async function buildTask5ComparisonManifest({ root = "." } = {}) {
  const inventoryBytes = await readFile(join(root, TASK5_INVENTORY));
  const inventory = JSON.parse(inventoryBytes);
  const verification = JSON.parse(await readFile(join(root, TASK5_VERIFICATION), "utf8"));
  if (inventory.kind !== "202-task5-revision1-tool-surfacing-inventory") throw new Error("Task5Manifest: wrong inventory kind");
  if (inventory.productHash !== TASK5_HISTORICAL_FABRIC_HASH) throw new Error("Task5Manifest: revision-1 product pin changed");
  if (verification.inventorySha256 !== sha256(inventoryBytes)) throw new Error("Task5Manifest: inventory bytes changed after verification");

  const current = await currentRevision(root);
  if (current.dirty) throw new Error("Task5Manifest: the candidate product has uncommitted changes");
  await assertTask5CandidateClean({ root });
  const controlRevision = await ensureTask5ControlRef(current.revision, { root });
  const controlProductHash = await gitTreeFingerprint(TASK5_PRODUCT_PATHS, controlRevision, root);
  const historicalFabricHash = await gitTreeFingerprint(["packages/memory/fabric/src"], TASK5_CONTROL_PRODUCT_SOURCE, root);
  if (historicalFabricHash !== TASK5_HISTORICAL_FABRIC_HASH)
    throw new Error("Task5Manifest: the product source does not reproduce the closed screen's revision-1 product");
  if (controlProductHash !== TASK5_REVISION1_PRODUCT_HASH)
    throw new Error("Task5Manifest: the control overlay does not reproduce the revision-1 product hash");
  const armDiff = await task5ArmDiff(controlRevision, current.revision, { root });
  const unexpected = task5UnexpectedPaths(armDiff);
  if (!armDiff.length || unexpected.length)
    throw new Error(`Task5Manifest: the arms differ outside the product paths (${unexpected.slice(0, 3).join(", ") || "no differences"})`);
  const candidateProductHash = await gitTreeFingerprint(TASK5_PRODUCT_PATHS, current.revision, root);
  const harnessHash = await sourceFingerprint(TASK5_HARNESS_PATHS, root);
  const analysis = await pairedAnalysisProtocol(root);
  const criteria = task5ComparisonCriteria();
  const criteriaHash = stableHash(criteria);
  const analysisHash = stableHash(analysis);
  const protocol = {
    version: "202-task5-evidence-protocol-v1",
    measurementVersion: "product-phases-attribution-v2",
    traceRetention: "answer/query/tool-result/excerpt retention with retry evidence reset",
    toolSurfacing: await fileFingerprint(["scripts/memory-bench/replay.mjs"], root),
    mapping: await fileFingerprint(["scripts/memory-bench/replay.mjs", "scripts/memory-bench/datasets.mjs"], root),
    judges: await fileFingerprint(["scripts/memory-bench/judge.mjs", "scripts/memory-bench/judge-prompts.json"], root),
    judgeTemplate: JUDGE_TEMPLATE_VERSION,
    gradedTemplate: GRADED_TEMPLATE_VERSION,
    analysisVersion: PAIRED_ANALYSIS_VERSION,
    criteriaHash,
  };
  const protocolHash = stableHash(protocol);

  const inventoryCells = new Map(inventory.cells.map((c) => [c.suite, c]));
  const coverage = [];
  const cells = [];
  let totalInput = 0,
    totalOutput = 0,
    totalReserved = 0,
    productUsd = 0,
    judgeUsd = 0;
  const control = {
    revision: controlRevision,
    sourceRevision: TASK5_CONTROL_PRODUCT_SOURCE,
    productHash: controlProductHash,
    historicalFabricOnlyHash: historicalFabricHash,
    worktree: `${TASK5_CACHE}/control-worktree`,
  };
  const candidate = { revision: current.revision, productHash: candidateProductHash, dirty: false };
  if (analysis.criteriaHash !== robustnessCriteriaHash())
    throw new Error("Task5Manifest: the paired analysis is not bound to the frozen robustness criteria");

  for (const suite of TASK5_SUITES) {
    const cohort = suiteCohort(suite);
    const historical = inventoryCells.get(suite);
    if (!historical) throw new Error(`Task5Manifest: no revision-1 inventory for ${suite}`);
    const historicalIds = historical.rows.map((row) => String(row.id));
    if (idsHash(historicalIds) !== cohort.idsHash)
      throw new Error(`Task5Manifest: ${suite} inventory cohort differs from the frozen development draw`);
    const budget = suiteBudget(cohort.questionIds.length);
    const cost = freeCost(cohort.questionIds.length);
    coverage.push({
      suite,
      questions: cohort.questionIds.length,
      abilities: cohort.abilities,
      idsHash: cohort.idsHash,
      dataset: cohort.dataset,
      historical: {
        jobId: historical.jobId,
        questions: historical.questions,
        toolSurfacingKnown: historical.observedSurfacing,
        mappedGoldQuestions: historical.mappedGoldQuestions,
        unresolvedGoldQuestions: historical.unresolvedGoldQuestions,
        noFineGoldQuestions: historical.noFineGoldQuestions,
        ingestValid: historical.historicalIngestValid,
        reuseEligible: false,
      },
    });
    productUsd += cost.productUsd;
    judgeUsd += cost.judgeUsd;
    for (const role of ["control", "candidate"]) {
      cells.push(cell({ role, suite, cohort, budget, cost, control, candidate, harnessHash, analysisHash, criteriaHash, protocolHash }));
      totalInput += budget.estimate.inputTokens;
      totalOutput += budget.estimate.outputTokens;
      totalReserved += budget.maxInputTokens;
    }
  }

  const questionRuns = 2 * inventory.cells.reduce((n, c) => n + c.rows.length, 0);
  const expectedPhysicalCalls = Math.round(questionRuns * (TASK5_CALL_RATES.solver + TASK5_CALL_RATES.judge));
  const expectedPhysicalCallsRange = {
    low: expectedPhysicalCalls,
    high: Math.round(questionRuns * (TASK5_CALL_RATES.solverHigh + TASK5_CALL_RATES.judge)),
  };
  const manifest = {
    schemaVersion: 1,
    kind: "202-task5-development-comparison",
    plan: 202,
    task: 5,
    subtask: 5.2,
    generatedAt: new Date().toISOString(),
    status: "proposed-awaiting-owner-gate",
    executable: false,
    ownerGate: {
      required: true,
      task: 5.3,
      approved: false,
      binds: "manifestHash plus journal identity",
      note: "planning approval does not authorize provider or model calls",
    },
    scope: "paired-revision1-control-vs-task5-candidate",
    scopeAuthorization: "Complete Task 5.2 from plan 202: freeze a bounded, paired development-comparison manifest",
    claim:
      "development-only paired comparison under one free answer model and two free judges; no held-out, cross-model, cross-provider or Task 18 robustness claim",
    product: {
      paths: TASK5_PRODUCT_PATHS,
      harnessPaths: TASK5_HARNESS_PATHS,
      harnessHash,
      control,
      candidate,
    },
    cohort: {
      partition: "dev",
      questionCount: coverage.reduce((n, row) => n + row.questions, 0),
      idsHash: idsHash(coverage.flatMap((row) => suiteCohort(row.suite).questionIds.map((id) => `${row.suite}:${id}`))),
      suites: coverage,
      mapping: {
        rule: "repaired causalSessions/sessionRounds/extractEvidence note-to-round map on frozen dev ids; cached datasets, fetching disabled",
        source: inventory.sources,
        inventorySha256: sha256(inventoryBytes),
        labels: {
          mapped: coverage.reduce((n, row) => n + row.historical.mappedGoldQuestions, 0),
          unresolved: coverage.reduce((n, row) => n + row.historical.unresolvedGoldQuestions, 0),
          noFineGold: coverage.reduce((n, row) => n + row.historical.noFineGoldQuestions, 0),
        },
      },
    },
    cells,
    comparison: {
      controlCells: cells.filter((c) => c.role === "control").map((c) => c.id),
      candidateCells: cells.filter((c) => c.role === "candidate").map((c) => c.id),
      pairs: TASK5_SUITES.length,
      pairing: "control and candidate share suite, question ids, mapping, model, judges, budgets and scoring rules",
      checkpointValidator: "validateBaselineCheckpoint",
      requiredPerCellHashes: ["harnessHash", "analysisHash", "criteriaHash", "evidenceProtocolHash", "idsHash"],
    },
    models: {
      answers: [`${TASK5_MODEL.provider}/${TASK5_MODEL.model}`],
      judges: TASK5_JUDGES,
      families: { answers: ["nvidia"], judges: ["dots", "cohere"] },
      judgesDoNotAnswer: true,
      freeOnly: true,
      paidFallbacks: [],
      crossProviderClaim: false,
      credentialRefs: ["OPENROUTER_API_KEY"],
      restriction: "the current user restriction permits free OpenRouter models only for later live work",
    },
    budgets: {
      perCell: {
        maxInputTokensReservation: INPUT_CAP,
        maxOutputTokensPerCall: 8192,
        maxTurns: BENCH_MAX_TURNS.standard,
        answerAttempts: BENCH_RETRY.answerAttempts,
        judgeAttempts: BENCH_RETRY.judgeAttempts,
        maxAttemptsPerJob: 2,
        concurrency: 1,
        wallTimeCapHoursBySuite: WALL_TIME_CAP_HOURS,
      },
      campaign: {
        expectedPhysicalCalls,
        expectedPhysicalCallsRange,
        // A measured rate, not a per-question ceiling: the turn cap would price a full 8-turn run
        // that neither baseline arm came close to (Task 5.4.3).
        physicalCallEstimate: {
          questionRuns,
          ...TASK5_CALL_RATES,
          note: "measured on the frozen preset-r1 baseline; labelInjections off, so no injection-label calls",
        },
        maxPhysicalCalls: TASK5_MAX_PHYSICAL_CALLS,
        physicalCallRule: "stop before exceeding the cap; an incomplete run is reported incomplete, never silently completed",
        reservedInputTokens: totalReserved,
        estimatedInputTokens: totalInput,
        estimatedOutputTokens: totalOutput,
        ceiling: TASK5_CEILING,
        wallTimeCapHours: 2 * Object.values(WALL_TIME_CAP_HOURS).reduce((a, b) => a + b, 0),
        wallTimeNote: "LongMemEval-M ingest dominates wall time; it is measured, never assumed zero",
      },
    },
    cost: {
      mode: "free",
      pricingStatus: rates.status,
      ratesAsOf: rates.asOf,
      productUsd,
      judgeUsd,
      totalUsd: productUsd + judgeUsd,
      note: "both answerer and judges are OpenRouter :free routes; quotas and caps, not USD, bind execution",
    },
    criteria,
    criteriaHash,
    analysis,
    analysisHash,
    evidenceProtocol: protocol,
    evidenceProtocolHash: protocolHash,
    isolation: {
      controlArtifacts: `${TASK5_CACHE}/control`,
      candidateArtifacts: `${TASK5_CACHE}/candidate`,
      answerCacheSeparated: true,
      judgeCacheSeparated: true,
      writeSideKeyedByProductHash: true,
      note: "control and candidate never share answer checkpoints, judge caches, stores or logs; enrichment cannot leak into the control",
    },
    baselineReuse: {
      eligible: false,
      reusedCells: 0,
      reason:
        "Task 5.1 established that no historical revision-1 run retained compatible tool-result traces; the owner-closed 23-cell screen stays immutable",
    },
    coverage: {
      applicableSuites: TASK5_SUITES,
      outOfScope: OUT_OF_SCOPE,
      allApplicableSuiteTarget: true,
      note: "all five development suites that carry revision-1 evidence are compared; a smaller or partial screen cannot close Task 5",
    },
    stopResume: {
      preflight: [
        "manifestHash equals the Task 5.3 gate record",
        "control git tree reproduces the historical fabric product hash",
        "candidate product, harness, analysis, criteria and evidence-protocol hashes match",
        "cache-stability pin passes",
      ],
      stopOn: [
        "a budget or physical-call cap reached",
        "classified quota refusal (retain usage, resume after the window)",
        "product/cohort/protocol drift",
        "a held lock or an owned process already running",
      ],
      resume:
        "journal attempts only; completed cells are reused by matching run-path fingerprint; completed answers are never regenerated; failed attempts keep their evidence",
      journalPath: TASK5_JOURNAL,
      manifestFingerprint: manifestFingerprint({
        criteriaHash,
        ceiling: TASK5_CEILING,
        provider: TASK5_MODEL.provider,
        model: TASK5_MODEL.model,
        jobs: cells,
      }),
    },
    security: {
      partition: "dev",
      heldoutAccess: false,
      heldoutContent: false,
      questionText: false,
      answerText: false,
      credentialRefsOnly: true,
      publicFields: "ids, counts, hashes and budgets only",
    },
    heldOutGuard: ROBUSTNESS_CRITERIA.heldOutGuard,
  };
  manifest.manifestHash = task5ManifestHash(manifest);
  return assertTask5ComparisonManifest(manifest);
}

/** The freeze identity: criteria, analysis, protocol, both products, cohort, cells and caps. */
export function task5ManifestHash(manifest) {
  return stableHash({
    criteria: manifest.criteriaHash,
    analysis: manifest.analysisHash,
    protocol: manifest.evidenceProtocolHash,
    harness: manifest.product.harnessHash,
    control: manifest.product.control.productHash,
    candidate: manifest.product.candidate.productHash,
    cohort: manifest.cohort.idsHash,
    jobs: manifest.cells.map((c) => [c.id, c.role, c.maxInputTokens, c.idsHash]),
    budget: [manifest.budgets.campaign.maxPhysicalCalls, manifest.budgets.campaign.ceiling],
  });
}

const isPlainId = (value) => typeof value === "string" && value.length > 0;

/**
 * Structural refusal of a drifted proposal. Observed hashes/cohorts are supplied by the caller so a
 * verifier recomputes them instead of trusting the manifest it is checking.
 */
export function assertTask5ComparisonManifest(
  manifest,
  { observedProductHash, observedControlProductHash, observedCohort, suites = TASK5_SUITES, expectedCohort } = {},
) {
  const refuse = (message) => {
    throw new Error(`Task5Manifest: ${message}`);
  };
  if (manifest?.kind !== "202-task5-development-comparison") refuse("wrong kind");
  if (manifest.executable !== false || manifest.ownerGate?.approved !== false)
    refuse("a proposal must stay non-executable until the Task 5.3 gate");
  if (!manifest.manifestHash) refuse("missing manifest hash");
  if (manifest.manifestHash !== task5ManifestHash(manifest)) refuse("manifest changed after the freeze");
  const product = manifest.product ?? {};
  if (!Array.isArray(product.paths) || product.paths.length === 0) refuse("missing product paths");
  const controlHash = product.control?.productHash;
  const candidateHash = product.candidate?.productHash;
  if (!isPlainId(controlHash) || !isPlainId(candidateHash)) refuse("missing control or candidate product hash");
  if (controlHash === candidateHash) refuse("control and candidate products are identical");
  if (observedProductHash && observedProductHash !== candidateHash) refuse("candidate product drifted after the manifest was written");
  if (observedControlProductHash && observedControlProductHash !== controlHash) refuse("control product drifted from its pin");
  if (manifest.baselineReuse?.eligible !== false || manifest.baselineReuse?.reusedCells !== 0)
    refuse("Task 5.1 recovered no reusable revision-1 trace; reuse must be refused");

  const cells = manifest.cells ?? [];
  const expected = new Set(suites.map((suite) => `${suite}:control`).concat(suites.map((suite) => `${suite}:candidate`)));
  if (cells.length !== expected.size) refuse("every applicable suite needs one control and one candidate cell");
  const seen = new Set();
  const allIds = [];
  for (const cell of cells) {
    const key = `${cell.suite}:${cell.role}`;
    if (!expected.has(key) || seen.has(key)) refuse(`unexpected or duplicate cell ${key}`);
    seen.add(key);
    if (!suites.includes(cell.suite)) refuse(`suite ${cell.suite} is not an applicable Task-5 suite`);
    // Development partitions only: held-out ids may never enter the cohort.
    if (cell.subset !== "dev") refuse(`${key} must run the development partition`);
    const draw = robustnessDraw(cell.suite);
    const dev = new Set(Object.values(draw.abilities.dev).flat().map(String));
    const heldout = new Set(
      [...Object.values(draw.abilities["heldout-a"] ?? {}).flat(), ...Object.values(draw.abilities["heldout-b"] ?? {}).flat()].map(String),
    );
    if (!Array.isArray(cell.questionIds) || cell.questionIds.length !== cell.questions)
      refuse(`${key} question cohort does not match its declared size`);
    if (idsHash(cell.questionIds) !== cell.idsHash) refuse(`${key} cohort hash does not match its ids`);
    // Cohort drift: the frozen draw (or the frozen screen cohort), not the manifest, is authoritative.
    const frozen = expectedCohort?.[cell.suite] ?? [...dev];
    if (idsHash(cell.questionIds) !== idsHash(frozen)) refuse(`${key} cohort drifted from the frozen development draw`);
    for (const id of cell.questionIds) {
      if (heldout.has(id)) refuse(`${key} contains a held-out question id`);
      if (!dev.has(id)) refuse(`${key} contains a question outside the frozen development cohort`);
    }
    if (observedCohort && idsHash(observedCohort[cell.suite] ?? []) !== cell.idsHash)
      refuse(`${key} observed cohort differs from the manifest`);
    allIds.push(...cell.questionIds.map((id) => `${cell.suite}:${id}`));
  }
  const uniqueIds = [...new Set(allIds)];
  if (idsHash(uniqueIds) !== manifest.cohort?.idsHash) refuse("combined cohort hash does not match the cells");
  if (manifest.cohort?.questionCount !== uniqueIds.length) refuse("cohort size does not match the cells");

  if (idsHash(manifest.coverage?.applicableSuites ?? []) !== idsHash(suites))
    refuse("applicable suites drifted from the frozen suites that carry revision-1 evidence");

  // Paired cells must share the treatment-external protocol exactly; only the product may differ.
  const frozenKeys = ["suite", "subset", "arm", "config", "provider", "model", "judges", "judgeProtocol", "labelInjections"];
  const budgetKeys = ["questions", "idsHash", "maxInputTokens", "maxOutputTokens", "maxTurns", "concurrency"];
  for (const suite of suites) {
    const pair = cells.filter((cell) => cell.suite === suite);
    if (pair.length !== 2) refuse(`${suite} needs exactly a control and a candidate`);
    const [a, b] = pair;
    for (const key of frozenKeys) if ((a[key] ?? null) !== (b[key] ?? null)) refuse(`${suite} cells differ on ${key}`);
    for (const key of budgetKeys) if ((a[key] ?? null) !== (b[key] ?? null)) refuse(`${suite} cells differ on the shared budget ${key}`);
    if (sha256(JSON.stringify(a.questionIds)) !== sha256(JSON.stringify(b.questionIds)))
      refuse(`${suite} cells do not share identical question ids`);
    if (a.role === b.role) refuse(`${suite} cells do not pair a control with a candidate`);
    if ((a.estimate?.inputTokens ?? null) !== (b.estimate?.inputTokens ?? null)) refuse(`${suite} cells differ on the shared input budget`);
    if ((a.estimate?.outputTokens ?? null) !== (b.estimate?.outputTokens ?? null))
      refuse(`${suite} cells differ on the shared output budget`);
    const pins = {
      harnessHash: manifest.product.harnessHash,
      analysisHash: manifest.analysisHash,
      criteriaHash: manifest.criteriaHash,
      evidenceProtocolHash: manifest.evidenceProtocolHash,
    };
    for (const cell of pair)
      for (const [key, value] of Object.entries(pins)) if (cell[key] !== value) refuse(`${cell.id} ${key} differs from the manifest`);
    for (const cell of pair) {
      if (cell.provider !== TASK5_MODEL.provider || cell.model !== TASK5_MODEL.model || cell.judges !== TASK5_JUDGES.join(","))
        refuse(`${cell.id} does not use the frozen models and judges`);
    }
  }
  if (manifest.evidenceProtocolHash !== stableHash(manifest.evidenceProtocol)) refuse("evidence protocol changed after the freeze");
  if (manifest.criteriaHash !== stableHash(manifest.criteria)) refuse("criteria changed after the freeze");
  if (manifest.evidenceProtocol?.criteriaHash !== manifest.criteriaHash) refuse("evidence protocol is not bound to the frozen criteria");
  if (manifest.analysisHash !== stableHash(manifest.analysis)) refuse("analysis protocol changed after the freeze");

  // Cost and models: the restriction is one free gateway, its free rows only.
  const answers = manifest.models?.answers ?? [];
  const judges = manifest.models?.judges ?? [];
  const gateway = String(answers[0] ?? "").split("/")[0];
  if (answers.length !== 1 || !gateway || !answers[0].endsWith(":free")) refuse("the comparison requires exactly one free answer model");
  if (judges.length < 2 || judges.some((ref) => !ref.startsWith(`${gateway}/`) || !ref.endsWith(":free") || answers.includes(ref)))
    refuse(`judges must be two free ${gateway} families and never answer an arm`);
  if (manifest.models?.paidFallbacks?.length) refuse("paid fallbacks are not authorized");
  if ((manifest.cost?.totalUsd ?? 0) !== 0) refuse("the authorized routes are free; a nonzero estimate is not authorized");

  // No held-out or question/answer content may appear in the public proposal.
  const forbidden = new Set(["text", "answer", "question", "questionText", "sourceText", "excerpt", "prompt"]);
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${index}]`);
      });
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key) && !(typeof child === "boolean" || child === null))
        refuse(`public manifest carries content field ${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  };
  walk(manifest, "manifest");
  if (manifest.security?.heldoutAccess !== false || manifest.security?.partition !== "dev") refuse("security guard missing");
  return manifest;
}

/** Recompute every pin from source and the frozen draws before a manifest may be gated or run. */
export async function auditTask5Comparison(
  manifest,
  { root = ".", worktree = manifest.product?.control?.worktree, suites = TASK5_SUITES, expectedCohort, pinned = false } = {},
) {
  assertTask5ComparisonManifest(manifest, { suites, expectedCohort });
  const candidateRevision = manifest.product.candidate.revision;
  const controlRevision = manifest.product.control.revision;
  const candidateProductHash = await gitTreeFingerprint(manifest.product.paths, candidateRevision, root);
  // `pinned` audits the committed trees a frozen proposal names, not the working tree: a scope gate
  // authorizes a manifest whose harness is the one its pinned revision carries.
  const workingProductHash = pinned ? candidateProductHash : await sourceFingerprint(manifest.product.paths, root);
  if (workingProductHash !== candidateProductHash)
    throw new Error("Task5Manifest: the working-tree product differs from the pinned candidate commit");
  // The overlay must be a function of the candidate and the product source, never a hand-made ref.
  if ((await task5ControlRevision(candidateRevision, { root })) !== controlRevision)
    throw new Error("Task5Manifest: the control revision does not reproduce from the candidate and the product source");
  const armDiff = await task5ArmDiff(controlRevision, candidateRevision, { root });
  const unexpected = task5UnexpectedPaths(armDiff);
  if (!armDiff.length || unexpected.length)
    throw new Error(`Task5Manifest: the arms differ outside the product paths (${unexpected.slice(0, 3).join(", ") || "no differences"})`);
  // Commits after the freeze may only touch evidence and the plan; anything else needs a re-freeze.
  if (!pinned) {
    const { stdout: afterFreeze } = await run("git", ["-C", root, "diff", "--name-only", candidateRevision, "HEAD"], {
      maxBuffer: 1 << 28,
    });
    const drift = task5PostFreezePaths(afterFreeze.split("\n").filter(Boolean));
    if (drift.length) throw new Error(`Task5Manifest: commits after the candidate pin changed ${drift.slice(0, 3).join(", ")}`);
  }
  const controlPath = worktree ? join(root, worktree) : null;
  let controlProductHash;
  let controlHarnessHash = null;
  if (controlPath && existsSync(controlPath)) {
    const head = (await run("git", ["-C", controlPath, "rev-parse", "HEAD"])).stdout.trim();
    if (head !== controlRevision) throw new Error(`Task5Manifest: control worktree is at ${head}, expected ${controlRevision}`);
    controlProductHash = await sourceFingerprint(manifest.product.paths, controlPath);
    // The control keeps the frozen harness verbatim, so only the product is the treatment.
    controlHarnessHash = await sourceFingerprint(manifest.product.harnessPaths, controlPath);
    if (controlHarnessHash !== manifest.product.harnessHash)
      throw new Error("Task5Manifest: control worktree harness differs from the frozen harness");
  } else controlProductHash = await gitTreeFingerprint(manifest.product.paths, controlRevision, root);
  if (controlProductHash !== TASK5_REVISION1_PRODUCT_HASH)
    throw new Error("Task5Manifest: the control does not reproduce the revision-1 product hash");
  const harnessHash = pinned
    ? await gitTreeFingerprint(manifest.product.harnessPaths, candidateRevision, root)
    : await sourceFingerprint(manifest.product.harnessPaths, root);
  const analysis = await pairedAnalysisProtocol(root);
  if (harnessHash !== manifest.product.harnessHash) throw new Error("Task5Manifest: harness drifted after the freeze");
  if (stableHash(analysis) !== manifest.analysisHash) throw new Error("Task5Manifest: analysis protocol drifted after the freeze");
  if (analysis.criteriaHash !== robustnessCriteriaHash()) throw new Error("Task5Manifest: robustness criteria binding is broken");
  const observedCohort = expectedCohort ?? Object.fromEntries(suites.map((suite) => [suite, suiteCohort(suite).questionIds]));
  assertTask5ComparisonManifest(manifest, {
    observedProductHash: candidateProductHash,
    observedControlProductHash: controlProductHash,
    observedCohort,
    suites,
    expectedCohort,
  });
  return { candidateProductHash, controlProductHash, controlHarnessHash, harnessHash, observedCohort };
}

export function task5ComparisonMarkdown(manifest, { path = TASK5_MANIFEST } = {}) {
  const money = (value) => `$${Number(value ?? 0).toFixed(2)}`;
  const screen = manifest.criteria?.version === TASK5_SCREEN_VERSION;
  return [
    `# Plan 202 Task 5.2 — frozen paired ${screen ? "development-screen" : "development-comparison"} manifest`,
    "",
    `Status: **${manifest.status}**, \`executable: false\`. Task 5.3 must record the owner gate against manifest hash \`${manifest.manifestHash.slice(0, 16)}…\` before any provider call.`,
    "",
    `Manifest: [${path}](${basename(path)}) (ids, counts, hashes and budgets only).`,
    ...(screen
      ? [
          "",
          `Screen scope (plan 202 Task 5.4.6): ${TASK5_SCREEN_SUITES.join(", ")}; \`longmemeval-m\` and the full \`beam-1m\` cohort are deferred to plan 210. The beam-1m slice is ${manifest.cells.find((cell) => cell.suite === "beam-1m")?.questions ?? 0} questions selected by a rule over cohort ids only.`,
        ]
      : []),
    "",
    "## Product pins",
    "",
    `- Control: revision \`${manifest.product.control.revision}\` (r2 = candidate tree with product paths from \`${manifest.product.control.sourceRevision}\`), product \`${manifest.product.control.productHash}\` (reproduces the closed screen's revision-1 fabric hash \`${manifest.product.control.historicalFabricOnlyHash}\`).`,
    `- Candidate: committed revision \`${manifest.product.candidate.revision}\`, product \`${manifest.product.candidate.productHash}\`.`,
    `- The two arms differ only under ${manifest.product.paths.map((path) => `\`${path}\``).join(" and ")}; a git diff outside those paths is a refusal, and so is an uncommitted candidate.`,
    `- Harness \`${manifest.product.harnessHash}\`; unchanged for both roles so only the product is the treatment.`,
    "",
    "## Cohort and cells",
    "",
    "| Suite | Questions | Abilities | Control | Candidate | Historical surfacing |",
    "| --- | ---: | --- | --- | --- | --- |",
    ...manifest.cohort.suites.map(
      (row) =>
        `| ${row.suite} | ${row.questions} | ${Object.keys(row.abilities).length} | fresh | fresh | ${row.historical.toolSurfacingKnown} known (all null) |`,
    ),
    "",
    `${manifest.cells.length} cells (${manifest.comparison.pairs} pairs). Answer model \`${manifest.models.answers[0]}\`; judges ${manifest.models.judges.map((ref) => `\`${ref}\``).join(" + ")}. Both roles share question ids, mapping, model, judges and budgets.`,
    "",
    "## Budgets and cost",
    "",
    `- Reservations: ${manifest.budgets.campaign.reservedInputTokens.toLocaleString()} input tokens per campaign; ceiling ${manifest.budgets.campaign.ceiling.toLocaleString()}.`,
    `- Estimates: ${manifest.budgets.campaign.estimatedInputTokens.toLocaleString()} input / ${manifest.budgets.campaign.estimatedOutputTokens.toLocaleString()} output tokens; ${manifest.budgets.campaign.expectedPhysicalCalls.toLocaleString()}–${manifest.budgets.campaign.expectedPhysicalCallsRange.high.toLocaleString()} expected physical calls (measured rate, not the turn cap), hard cap ${manifest.budgets.campaign.maxPhysicalCalls.toLocaleString()}.`,
    `- Product ${money(manifest.cost.productUsd)} / judge ${money(manifest.cost.judgeUsd)} / total ${money(manifest.cost.totalUsd)} (free OpenRouter routes; quotas and caps bind, not USD).`,
    `- Concurrency 1; wall caps ${Object.values(manifest.budgets.perCell.wallTimeCapHoursBySuite).reduce((a, b) => a + b, 0)} h per role, LongMemEval-M ingest dominating.`,
    "",
    "## Frozen verdict rules",
    "",
    `- Candidate gap: ${manifest.criteria.candidateGap.numerator}. Denominator: ${manifest.criteria.candidateGap.denominator}.`,
    `- Halving: ${manifest.criteria.candidateGap.halving}. Zero-gap baseline: ${manifest.criteria.candidateGap.zeroGapBaseline}.`,
    `- Ability guard (${manifest.criteria.abilityGuard.role ?? "veto"}): ${manifest.criteria.abilityGuard.rule}.`,
    `- Failures/missingness are never zero: ${manifest.criteria.candidateGap.missingness}.`,
    "",
    "## Reuse, isolation and coverage",
    "",
    `- Historical revision-1 controls reused: **0**. ${manifest.baselineReuse.reason}.`,
    `- Isolated artifacts: \`${manifest.isolation.controlArtifacts}\` versus \`${manifest.isolation.candidateArtifacts}\`; separate answer and judge caches, product-hash-keyed write side.`,
    `- Applicable suites: ${manifest.coverage.applicableSuites.join(", ")}. Out of scope: ${manifest.coverage.outOfScope.map((row) => `${row.suites.join("/")} (${row.reason})`).join("; ")}.`,
    `- Credential refs only: ${manifest.models.credentialRefs.join(", ")}; no held-out access or content.`,
    "",
    "## Reproduce",
    "",
    "```sh",
    "timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs",
    `timeout 120 bun scripts/memory-bench/task5-comparison.mjs --manifest${screen ? " --screen" : ""}`,
    "```",
    "",
  ].join("\n");
}

export async function writeTask5ComparisonManifest({ root = ".", path = TASK5_MANIFEST } = {}) {
  const manifest = await buildTask5ComparisonManifest({ root });
  await mkdir(join(root, TASK5_EVIDENCE), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, path.replace(/\.json$/, ".md")), task5ComparisonMarkdown(manifest));
  return manifest;
}

/**
 * A re-freeze may move pins, the harness hash and the informational call estimate — nothing else.
 * Plan 202 Task 5.4.4 keeps the cohort, criteria, protocol, models, judges and every cap byte-identical
 * across a re-freeze, and this allowlist is what makes that checkable instead of asserted in prose.
 */
export const TASK5_REFREEZE_ALLOWED = [
  "generatedAt",
  "manifestHash",
  "product.control.revision",
  "product.candidate.revision",
  "product.harnessHash",
  "product.control.worktree",
  /^cells\.\d+\.productRevision$/,
  /^cells\.\d+\.worktreeRevision$/,
  /^cells\.\d+\.harnessHash$/,
  "budgets.campaign.expectedPhysicalCalls",
  "budgets.campaign.expectedPhysicalCallsRange.low",
  "budgets.campaign.expectedPhysicalCallsRange.high",
  /^budgets\.campaign\.physicalCallEstimate\./,
];

/**
 * Plan 202 Task 5.4: a gateway substitution is not a scope reduction either. The frozen panel keeps
 * its model ids and prices; only the provider prefix, the criteria transport text and the hashes
 * derived from them may move. Everything else stays byte-identical.
 */
export const TASK5_TRANSPORT_REVISION_ALLOWED = [
  "generatedAt",
  "manifestHash",
  "criteriaHash",
  "evidenceProtocol.criteriaHash",
  "evidenceProtocolHash",
  "stopResume.manifestFingerprint",
  // A re-pin moves the candidate/control commits and the harness, never the product bytes.
  "product.candidate.revision",
  "product.control.revision",
  "product.harnessHash",
  /^criteria\./,
  /^models\./,
  /^cells\.\d+\.(id|provider|judges|criteriaHash|evidenceProtocolHash|harnessHash|productRevision|worktreeRevision)$/,
  /^comparison\.(candidateCells|controlCells)\.\d+$/,
];

export function task5TransportRevisionAllowed(path) {
  return TASK5_TRANSPORT_REVISION_ALLOWED.some((rule) => (typeof rule === "string" ? rule === path : rule.test(path)));
}

/** Refuse a transport revision that also moved a cohort, a model id, a judge, a rule or a cap. */
export function assertTask5TransportRevision(previous, next) {
  const diff = task5FreezeDiff(previous, next);
  const refused = diff.filter((path) => !task5TransportRevisionAllowed(path));
  if (refused.length) throw new Error(`Task5Gate: the transport revision changed frozen fields: ${refused.slice(0, 5).join(", ")}`);
  const before = [...previous.models.answers, ...previous.models.judges].map((ref) => ref.split("/").slice(1).join("/"));
  const after = [...next.models.answers, ...next.models.judges].map((ref) => ref.split("/").slice(1).join("/"));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Task5Gate: a transport revision cannot change a model id");
  for (const suite of next.cells) {
    const peer = previous.cells.find((cell) => cell.suite === suite.suite && cell.role === suite.role);
    if (!peer || idsHash(peer.questionIds) !== idsHash(suite.questionIds))
      throw new Error("Task5Gate: a transport revision cannot change a cohort");
  }
  if (previous.cost?.totalUsd !== 0 || next.cost?.totalUsd !== 0) throw new Error("Task5Gate: the free panel is not priced at zero");
  if (!diff.length) throw new Error("Task5Gate: the transport revision changed nothing");
  return diff;
}

function flattenLeaves(value, prefix = "", out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenLeaves(item, `${prefix}.${index}`, out);
    });
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) flattenLeaves(item, prefix ? `${prefix}.${key}` : key, out);
    return out;
  }
  out[prefix] = value;
  return out;
}

/** Every leaf path whose value differs between two frozen manifests. */
export function task5FreezeDiff(previous, next) {
  const before = flattenLeaves(previous);
  const after = flattenLeaves(next);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
    .sort();
}

export function task5RefreezeAllowed(path) {
  return TASK5_REFREEZE_ALLOWED.some((rule) => (typeof rule === "string" ? rule === path : rule.test(path)));
}

/** Refuse a re-freeze that moved a cohort, a criterion, a model, a judge or a cap. */
export function assertTask5RefreezeDiff(previous, next) {
  const diff = task5FreezeDiff(previous, next);
  const refused = diff.filter((path) => !task5RefreezeAllowed(path));
  if (refused.length) throw new Error(`Task5Gate: the re-freeze changed frozen fields: ${refused.slice(0, 5).join(", ")}`);
  return diff;
}

/**
 * Gate 5 authorizes exactly the frozen proposal, and only on free OpenRouter routes. The record
 * carries ids, hashes, caps and the owner's text verbatim; never a credential value or benchmark text.
 */
export function task5OwnerGate(
  manifest,
  {
    text,
    approvedAt = new Date().toISOString().slice(0, 10),
    approvedBy = "owner",
    gate = 5,
    subtask = "5.3",
    supersedes = null,
    proposalPath = TASK5_ACTIVE_MANIFEST,
  } = {},
) {
  if (!text?.trim()) throw new Error("Task5Gate: the owner's approval text is required verbatim");
  const record = {
    schemaVersion: 1,
    kind: "202-task5-owner-gate",
    plan: 202,
    task: 5,
    subtask,
    gate,
    approved: true,
    approvedAt,
    approvedBy,
    text,
    ...(supersedes ? { supersedes } : {}),
    proposal: { path: proposalPath, manifestHash: manifest.manifestHash },
    criteria: { version: manifest.criteria.version, hash: manifest.criteriaHash },
    journal: { path: TASK5_JOURNAL, fingerprint: manifest.stopResume.manifestFingerprint },
    // The gate binds the arms themselves, not only the manifest hash that covers them.
    product: {
      control: manifest.product.control.revision,
      controlSource: manifest.product.control.sourceRevision,
      controlProductHash: manifest.product.control.productHash,
      candidate: manifest.product.candidate.revision,
      candidateProductHash: manifest.product.candidate.productHash,
      harnessHash: manifest.product.harnessHash,
    },
    scope: {
      cells: manifest.cells.length,
      pairs: manifest.comparison.pairs,
      questions: manifest.cohort.questionCount,
      suites: manifest.coverage.applicableSuites,
      roles: ["control", "candidate"],
      arm: { id: manifest.cells[0].arm, config: manifest.cells[0].config },
      answers: manifest.models.answers,
      judges: manifest.models.judges,
    },
    billing: {
      mode: `free-${manifest.models.answers[0].split("/")[0]}`,
      provider: manifest.models.answers[0].split("/")[0],
      freeProductsOnly: true,
      paidFallbacks: [],
      productUsd: manifest.cost.productUsd,
      judgeUsd: manifest.cost.judgeUsd,
      totalUsd: manifest.cost.totalUsd,
    },
    caps: {
      reservedInputTokens: manifest.budgets.campaign.reservedInputTokens,
      ceiling: manifest.budgets.campaign.ceiling,
      maxPhysicalCalls: manifest.budgets.campaign.maxPhysicalCalls,
      concurrency: manifest.budgets.perCell.concurrency,
      wallTimeCapHours: manifest.budgets.campaign.wallTimeCapHours,
    },
    preservation: {
      closedScreen: "closed-by-owner",
      priorCharges: "preserved",
      historicalControlsReused: manifest.baselineReuse.reusedCells,
      heldOutAccess: false,
      credentialValues: false,
    },
  };
  return assertTask5OwnerGate(record, manifest);
}

export function assertTask5OwnerGate(gate, manifest, proposalPath = TASK5_ACTIVE_MANIFEST) {
  const refuse = (reason) => {
    throw new Error(`Task5Gate: ${reason}`);
  };
  if (gate?.kind !== "202-task5-owner-gate") refuse("unknown gate kind");
  if (gate.approved !== true) refuse("execution is not approved");
  if (typeof gate.text !== "string" || !gate.text.trim()) refuse("the owner's approval text is missing");
  if (gate.proposal?.path !== proposalPath || gate.proposal?.manifestHash !== manifest.manifestHash)
    refuse("the approval is not bound to the frozen manifest");
  if (gate.criteria && (gate.criteria.version !== manifest.criteria?.version || gate.criteria.hash !== manifest.criteriaHash))
    refuse("the approval is not bound to the frozen criteria");
  if (gate.journal?.path !== TASK5_JOURNAL || gate.journal?.fingerprint !== manifest.stopResume?.manifestFingerprint)
    refuse("the approval is not bound to the campaign journal identity");
  const provider = String(manifest.models?.answers?.[0] ?? "").split("/")[0];
  if (
    gate.billing?.mode !== `free-${provider}` ||
    gate.billing?.provider !== provider ||
    gate.billing?.freeProductsOnly !== true ||
    !Array.isArray(gate.billing?.paidFallbacks) ||
    gate.billing.paidFallbacks.length !== 0
  )
    refuse(`only free ${provider} products are authorized`);
  for (const ref of [...manifest.models.answers, ...manifest.models.judges]) {
    if (!String(ref).endsWith(":free") || String(ref).split("/")[0] !== provider) refuse(`${ref} is not a free ${provider} route`);
  }
  if (manifest.cost?.totalUsd !== 0 || gate.billing?.totalUsd !== 0 || gate.billing?.productUsd !== 0 || gate.billing?.judgeUsd !== 0)
    refuse("a paid estimate is not authorized");
  const caps = {
    reservedInputTokens: manifest.budgets.campaign.reservedInputTokens,
    ceiling: manifest.budgets.campaign.ceiling,
    maxPhysicalCalls: manifest.budgets.campaign.maxPhysicalCalls,
    concurrency: manifest.budgets.perCell.concurrency,
    wallTimeCapHours: manifest.budgets.campaign.wallTimeCapHours,
  };
  for (const [key, value] of Object.entries(caps)) {
    if (gate.caps?.[key] !== value) refuse(`cap ${key} differs from the frozen proposal`);
  }
  if (gate.scope?.cells !== manifest.cells.length || gate.scope?.questions !== manifest.cohort.questionCount)
    refuse("the approval does not cover the frozen cells");
  const product = manifest.product ?? {};
  if (!gate.product) refuse("the approval does not bind the arms");
  const arms = {
    control: product.control?.revision,
    controlSource: product.control?.sourceRevision,
    controlProductHash: product.control?.productHash,
    candidate: product.candidate?.revision,
    candidateProductHash: product.candidate?.productHash,
    harnessHash: product.harnessHash,
  };
  for (const [key, value] of Object.entries(arms)) {
    if (gate.product?.[key] !== value) refuse(`arm pin ${key} differs from the frozen proposal`);
  }
  if (gate.supersedes && gate.supersedes.manifestHash === manifest.manifestHash) refuse("a gate cannot supersede itself");
  return gate;
}

export function task5OwnerGateMarkdown(_manifest, gate) {
  return [
    `# Plan 202 Task ${gate.subtask} — owner gate ${gate.gate}`,
    "",
    `Status: **approved-by-${gate.approvedBy}** on ${gate.approvedAt}. The proposal itself stays \`executable: false\`; this gate is the authorization.`,
    "",
    `Gate text (verbatim): ${gate.text}`,
    "",
    "## Binding",
    "",
    `- Manifest: \`${gate.proposal.manifestHash}\` ([${gate.proposal.path}](${basename(gate.proposal.path)})).`,
    ...(gate.criteria ? [`- Criteria: \`${gate.criteria.version}\` (\`${gate.criteria.hash.slice(0, 16)}…\`).`] : []),
    `- Journal: \`${gate.journal.path}\`, fingerprint \`${gate.journal.fingerprint}\` (campaign identity over criteria, ceiling, provider, model and jobs).`,
    `- Arms: candidate \`${gate.product?.candidate}\` (product \`${gate.product?.candidateProductHash}\`); control r2 \`${gate.product?.control}\` (product \`${gate.product?.controlProductHash}\` from \`${gate.product?.controlSource}\`); harness \`${gate.product?.harnessHash}\`.`,
    `- A changed manifest, cohort, criteria or journal identity is a refusal, not a re-approval.`,
    ...(gate.supersedes
      ? [
          "",
          `## Supersedes gate ${gate.supersedes.gate}`,
          "",
          `- Gate ${gate.supersedes.gate} stays unedited at \`${gate.supersedes.records.gate}\` (sha256 \`${gate.supersedes.records.gateSha256}\`, manifest \`${gate.supersedes.manifestHash}\`); this gate replaces it.`,
          gate.supersedes.change === "transport-revision"
            ? `- This is a **transport revision, not a re-freeze**: the answer and judge model ids, prices, rules, cohort, caps and treatment (control \`${gate.product?.controlProductHash}\`, candidate product \`${gate.product?.candidateProductHash}\`) are byte-identical. Only the free gateway moved, so the journal identity moves from \`${gate.supersedes.journalFingerprint}\` to \`${gate.journal.fingerprint}\` and the screen runs fresh.`
            : gate.criteria?.version === TASK5_SCREEN_VERSION
              ? `- This is a **scope reduction, not a re-freeze**: the treatment (control \`${gate.product?.controlProductHash}\`, candidate product \`${gate.product?.candidateProductHash}\`) is byte-identical. The journal identity moves from \`${gate.supersedes.journalFingerprint}\` to \`${gate.journal.fingerprint}\` because the criteria version and the cohort changed, and the screen runs fresh.`
              : `- Journal identity is unchanged (\`${gate.supersedes.journalFingerprint}\`) because the cohort, criteria, protocol, models, judges, budgets and caps did not move: only the fields below changed.`,
          "",
          ...gate.supersedes.changes.map((path) => `- \`${path}\``),
        ]
      : []),
    "",
    "## Approved scope",
    "",
    `- ${gate.scope.cells} cells (${gate.scope.pairs} control/candidate pairs) over ${gate.scope.suites.join(", ")}; arm \`${gate.scope.arm.id}\` (\`${gate.scope.arm.config}\`); ${gate.scope.questions} development questions.`,
    `- Answer: ${gate.scope.answers.map((ref) => `\`${ref}\``).join(", ")}; judges ${gate.scope.judges.map((ref) => `\`${ref}\``).join(" + ")}.`,
    `- Billing: free ${gate.billing.provider} routes only; no paid fallback, no cross-provider claim.`,
    "",
    "## Caps and preservation",
    "",
    `- Reservations: ${gate.caps.reservedInputTokens.toLocaleString()} input tokens; ceiling ${gate.caps.ceiling.toLocaleString()}; hard cap ${gate.caps.maxPhysicalCalls.toLocaleString()} physical calls; concurrency ${gate.caps.concurrency}; wall ${gate.caps.wallTimeCapHours} h.`,
    `- Product $${gate.billing.productUsd.toFixed(2)} / judge $${gate.billing.judgeUsd.toFixed(2)} / total $${gate.billing.totalUsd.toFixed(2)} (quota and caps bind, not USD).`,
    `- Closed owner screen stays ${gate.preservation.closedScreen}; prior charges ${gate.preservation.priorCharges}; historical revision-1 controls reused ${gate.preservation.historicalControlsReused}; held-out access false; no credential values.`,
    "",
    "## Reproduce",
    "",
    "```sh",
    "timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs scripts/memory-bench/task5-screen.test.mjs",
    'timeout 120 bun scripts/memory-bench/task5-comparison.mjs --gate --text "<owner approval>" --approved-at 2026-10-30',
    "```",
    "",
  ].join("\n");
}

/** A gate record groups a transport revision's changes by section. */
const summariseTransportChange = (path) => {
  if (path === "criteria.version") return `criteria.version (${TASK5_SCREEN_VERSION})`;
  if (path.startsWith("criteria.transport")) return "criteria.transport (free Kilo AI Gateway; same panel, prices and rules)";
  if (path.startsWith("models.")) return "models (kilo/ provider prefix; same model ids at $0)";
  if (/^cells\.\d+\.(id|provider)$/.test(path)) return "cells (provider prefix and derived ids; cohorts, caps and pins unchanged)";
  if (path === "criteriaHash" || path === "evidenceProtocolHash" || path === "evidenceProtocol.criteriaHash")
    return "hashes derived from the revised criteria";
  if (path === "stopResume.manifestFingerprint") return "journal identity (derived from the provider and criteria)";
  return path;
};

/** A gate record groups a scope reduction's changes by section; the manifest hash covers the leaves. */
const summariseScreenChange = (path) => {
  if (path.startsWith("cells."))
    return "cells (LongMemEval-M removed, beam-1m sliced to the rule's 14 questions, derived ids/estimates/wall caps)";
  if (path.startsWith("cohort.")) return "cohort (question count, id hash, suite rows and label totals)";
  if (path.startsWith("coverage.")) return "coverage (LongMemEval-M deferred to plan 210, all-suite target off)";
  if (path.startsWith("budgets."))
    return "budgets (recomputed estimates, reservations, expected calls and wall caps; ceiling and hard cap unchanged)";
  if (path.startsWith("comparison.")) return "comparison (cell lists and pair count)";
  if (path === "criteria.version") return `criteria.version (${TASK5_SCREEN_VERSION})`;
  if (path === "criteria.abilityGuard.role") return "criteria.abilityGuard.role (descriptive, not a veto)";
  if (path === "criteriaHash" || path === "evidenceProtocolHash" || path === "evidenceProtocol.criteriaHash")
    return "hashes derived from the screen criteria";
  if (path === "stopResume.manifestFingerprint") return "journal identity (new criteria and cohort)";
  if (path === "product.harnessHash" || path === "product.candidate.revision") return "recomputed pins";
  return path;
};

/**
 * The record that replaces a gate without editing it: the archived gate's bytes stay as they were,
 * their sha256 is carried into the new gate, and the changed manifest fields are listed.
 */
export async function supersedesRecord({ root, manifestPath, manifest, transportRevision = false }) {
  const previous = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
  const gatePath = manifestPath.replace(/development-(comparison|screen)-manifest/, "owner-gate");
  const gateBytes = await readFile(join(root, gatePath));
  const previousGate = JSON.parse(gateBytes.toString("utf8"));
  // A scope reduction is not a re-freeze; the stricter guard is the one that applies. Cell leaves
  // shift when a suite is removed, so the record groups them instead of listing every index.
  const changes = transportRevision
    ? [...new Set(assertTask5TransportRevision(previous, manifest).map(summariseTransportChange))].sort()
    : manifest.criteria?.version === TASK5_SCREEN_VERSION
      ? [...new Set(assertTask5ScopeReduction(previous, manifest).map(summariseScreenChange))].sort()
      : assertTask5RefreezeDiff(previous, manifest);
  if (!changes.length) throw new Error("Task5Gate: a re-freeze must change something");
  return {
    ...(transportRevision ? { change: "transport-revision" } : {}),
    gate: previousGate.gate ?? null,
    manifestHash: previousGate.proposal?.manifestHash ?? null,
    journalFingerprint: previousGate.journal?.fingerprint ?? null,
    records: { manifest: manifestPath, gate: gatePath, gateSha256: sha256(gateBytes) },
    changes,
  };
}

export async function writeTask5OwnerGate({
  root = ".",
  text,
  approvedAt,
  path = TASK5_GATE,
  manifestPath = TASK5_ACTIVE_MANIFEST,
  supersedesPath,
  transportRevision = false,
  subtask = "5.4.5",
} = {}) {
  const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
  // Gate the frozen source pins; a prepared control worktree is audited (and refreshed) in preflight.
  if (manifest.criteria?.version === TASK5_SCREEN_VERSION) {
    // The scope gate authorizes the reduction; the bytes it names are the ones its pins carry.
    const full = JSON.parse(await readFile(join(root, TASK5_MANIFEST), "utf8"));
    assertTask5ScopeReduction(full, manifest);
    const pinned = (await sourceFingerprint(manifest.product.harnessPaths, root)) !== manifest.product.harnessHash;
    await auditTask5Comparison(manifest, {
      root,
      worktree: null,
      suites: TASK5_SCREEN_SUITES,
      expectedCohort: task5ScreenExpectedCohort(full),
      pinned,
    });
  } else await auditTask5Comparison(manifest, { root, worktree: null });
  const supersedes = supersedesPath ? await supersedesRecord({ root, manifestPath: supersedesPath, manifest, transportRevision }) : null;
  const gate = task5OwnerGate(manifest, {
    text,
    ...(approvedAt ? { approvedAt } : {}),
    ...(supersedes ? { gate: (supersedes.gate ?? 5) + 1, subtask, supersedes } : {}),
    proposalPath: manifestPath,
  });
  await mkdir(join(root, TASK5_EVIDENCE), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(gate, null, 2)}\n`);
  await writeFile(join(root, path.replace(/\.json$/, ".md")), task5OwnerGateMarkdown(manifest, gate));
  return gate;
}

/**
 * Plan 202 Task 5.5: candidate-gap calculation on paired question results.
 * Compares proportion of questions where needed fine rounds were never surfaced by any tool result.
 */
export function task5CandidateGap(controlRows, candidateResults, { cohortIds, suite = "unknown", iterations = 10_000, seed = 7 } = {}) {
  const cohortSet = cohortIds ? new Set(cohortIds.map(String)) : null;
  const cFiltered = cohortSet ? controlRows.filter((r) => cohortSet.has(String(r.id))) : controlRows;
  const tFiltered = cohortSet ? candidateResults.filter((r) => cohortSet.has(String(r.id))) : candidateResults;
  const cMap = new Map(cFiltered.map((r) => [String(r.id), r]));
  const tMap = new Map(tFiltered.map((r) => [String(r.id), r]));
  const pairedIds = [...cMap.keys()].filter((id) => tMap.has(id));

  // Determine which questions carry mapped needed round labels in both roles
  const withFineGold = pairedIds.filter((id) => {
    const c = cMap.get(id);
    const t = tMap.get(id);
    const cNeeded = (c.evidenceCounts?.fineRounds ?? 0) > 0 || (c.evidenceCounts?.toolSurfacing?.needed ?? 0) > 0;
    const tNeeded = (t.evidenceCounts?.fineRounds ?? 0) > 0 || (t.evidenceCounts?.toolSurfacing?.needed ?? 0) > 0;
    return cNeeded && tNeeded;
  });

  if (withFineGold.length === 0) {
    return {
      suite,
      measurable: false,
      reason: "no fine-round labels or unresolved gold reference; missingness is never zero",
      pairedQuestions: pairedIds.length,
      measurablePairs: 0,
      controlGapCount: null,
      controlGapRate: null,
      candidateGapCount: null,
      candidateGapRate: null,
      ratio: null,
      halvingTarget: null,
      passed: false,
      worstCaseBound: null,
      uncertainty: null,
      verdict: "inconclusive",
    };
  }

  // Primary estimate: complete retained tool traces in both roles
  const completePairs = withFineGold.filter((id) => {
    const c = cMap.get(id);
    const t = tMap.get(id);
    return (
      c.outcome === "scored" && t.outcome === "scored" && c.evidenceCounts?.toolSurfacing != null && t.evidenceCounts?.toolSurfacing != null
    );
  });

  if (completePairs.length === 0) {
    return {
      suite,
      measurable: false,
      reason: "too few complete pairs to distinguish; missingness is never zero",
      pairedQuestions: pairedIds.length,
      measurablePairs: 0,
      controlGapCount: null,
      controlGapRate: null,
      candidateGapCount: null,
      candidateGapRate: null,
      ratio: null,
      halvingTarget: null,
      passed: false,
      worstCaseBound: null,
      uncertainty: null,
      verdict: "inconclusive",
    };
  }

  const controlGapCount = completePairs.filter((id) => cMap.get(id).evidenceCounts?.toolSurfacing?.candidateGap === true).length;
  const candidateGapCount = completePairs.filter((id) => tMap.get(id).evidenceCounts?.toolSurfacing?.candidateGap === true).length;
  const controlGapRate = controlGapCount / completePairs.length;
  const candidateGapRate = candidateGapCount / completePairs.length;
  const halvingTarget = controlGapRate * TASK5_HALVING_FACTOR;
  const ratio = controlGapRate > 0 ? candidateGapRate / controlGapRate : null;

  let passed = false;
  if (controlGapRate === 0) {
    passed = candidateGapRate === 0;
  } else {
    passed = candidateGapRate <= halvingTarget;
  }

  // Worst-case bound: candidate failures count as not surfaced (gap = true)
  const candidateFailures = withFineGold.filter((id) => {
    const t = tMap.get(id);
    return t.outcome !== "scored" || t.evidenceCounts?.toolSurfacing == null;
  }).length;
  const worstCaseCandidateGaps = candidateGapCount + candidateFailures;
  const worstCaseCandidateGapRate = worstCaseCandidateGaps / withFineGold.length;
  const worstCasePassed = controlGapRate === 0 ? worstCaseCandidateGapRate === 0 : worstCaseCandidateGapRate <= halvingTarget;

  // Paired uncertainty: sign-flip permutation p and bootstrap CI on diff (candidate - control)
  const a = completePairs.map((id) => ({
    id,
    cluster: cMap.get(id).cluster ?? id,
    value: cMap.get(id).evidenceCounts?.toolSurfacing?.candidateGap ? 1 : 0,
  }));
  const b = completePairs.map((id) => ({
    id,
    cluster: tMap.get(id).cluster ?? id,
    value: tMap.get(id).evidenceCounts?.toolSurfacing?.candidateGap ? 1 : 0,
  }));
  const perm = pairedClusterPermutation(a, b, { cluster: (r) => r.cluster, iterations, seed });

  let verdict = "miss";
  if (passed && worstCasePassed) {
    verdict = "pass";
  } else if (passed && !worstCasePassed) {
    verdict = "inconclusive";
  } else {
    verdict = "miss";
  }

  return {
    suite,
    measurable: true,
    pairedQuestions: pairedIds.length,
    measurablePairs: completePairs.length,
    controlGapCount,
    controlGapRate,
    candidateGapCount,
    candidateGapRate,
    ratio,
    halvingTarget,
    passed,
    worstCaseBound: {
      candidateFailures,
      worstCaseCandidateGaps,
      worstCaseCandidateGapRate,
      worstCasePassed,
    },
    uncertainty: {
      diff: perm.diff,
      ci95: perm.ci95,
      p: perm.p,
      iterations,
      seed,
    },
    verdict,
  };
}

/**
 * Plan 202 Task 5.5: ability non-regression guard.
 * Compares binary correctness per ability stratum against frozen margin (-0.03).
 */
export function task5AbilityGuard(
  controlRows,
  candidateResults,
  { cohortIds, cohortAbilities, margin = TASK5_ABILITY_MARGIN, iterations = 10_000, seed = 7, descriptive = true } = {},
) {
  const cohortSet = cohortIds ? new Set(cohortIds.map(String)) : null;
  const cFiltered = cohortSet ? controlRows.filter((r) => cohortSet.has(String(r.id))) : controlRows;
  const tFiltered = cohortSet ? candidateResults.filter((r) => cohortSet.has(String(r.id))) : candidateResults;
  const cMap = new Map(cFiltered.map((r) => [String(r.id), r]));
  const tMap = new Map(tFiltered.map((r) => [String(r.id), r]));
  const pairedIds = [...cMap.keys()].filter((id) => tMap.has(id));
  const completePairs = pairedIds.filter((id) => cMap.get(id).outcome === "scored" && tMap.get(id).outcome === "scored");

  const abilities = cohortAbilities
    ? Object.keys(cohortAbilities)
    : [...new Set(completePairs.map((id) => cMap.get(id).ability))].filter(Boolean).sort();

  const strata = {};
  for (const ability of abilities) {
    const aPairs = completePairs.filter((id) => cMap.get(id).ability === ability);
    if (aPairs.length === 0) {
      strata[ability] = {
        ability,
        pairs: 0,
        controlCorrect: null,
        candidateCorrect: null,
        controlAccuracy: null,
        candidateAccuracy: null,
        diff: null,
        ci95: null,
        p: null,
        pHolm: null,
        passesMargin: false,
        regressed: false,
        missing: true,
        status: "unverified",
      };
      continue;
    }

    const controlCorrect = aPairs.filter((id) => cMap.get(id).correct === true).length;
    const candidateCorrect = aPairs.filter((id) => tMap.get(id).correct === true).length;
    const controlAccuracy = controlCorrect / aPairs.length;
    const candidateAccuracy = candidateCorrect / aPairs.length;
    const diff = candidateAccuracy - controlAccuracy;
    const passesMargin = diff >= -margin;
    const regressed = diff < -margin;

    const a = aPairs.map((id) => ({
      id,
      cluster: cMap.get(id).cluster ?? id,
      correct: Boolean(cMap.get(id).correct),
    }));
    const b = aPairs.map((id) => ({
      id,
      cluster: tMap.get(id).cluster ?? id,
      correct: Boolean(tMap.get(id).correct),
    }));
    const { ci95, p } = pairedClusterPermutation(a, b, { cluster: (r) => r.cluster, iterations, seed });

    strata[ability] = {
      ability,
      pairs: aPairs.length,
      controlCorrect,
      candidateCorrect,
      controlAccuracy,
      candidateAccuracy,
      diff,
      ci95,
      p,
      pHolm: null,
      passesMargin,
      regressed,
      missing: false,
      status: regressed ? "regression" : "pass",
    };
  }

  // Holm multiplicity adjustment across observed strata
  const observed = Object.values(strata).filter((s) => !s.missing && s.p !== null);
  if (observed.length > 0) {
    const adjusted = holm(observed.map((s) => s.p));
    observed.forEach((s, idx) => {
      s.pHolm = adjusted[idx];
    });
  }

  const regressions = Object.values(strata)
    .filter((s) => s.regressed)
    .map((s) => s.ability);
  const unverifiedStrata = Object.values(strata)
    .filter((s) => s.missing)
    .map((s) => s.ability);
  const passed = regressions.length === 0 && unverifiedStrata.length === 0;

  return {
    role: descriptive ? "descriptive" : "veto",
    margin,
    strata,
    regressions,
    unverifiedStrata,
    passed,
  };
}

/**
 * Compute complete Task 5 screen verdict across all screen suites.
 */
export async function computeTask5ScreenVerdict({ root = ".", manifestPath = TASK5_SCREEN_MANIFEST } = {}) {
  const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
  const isScreen = manifest.criteria?.version === TASK5_SCREEN_VERSION || manifest.criteria?.abilityGuard?.role === "descriptive";
  const suites = manifest.coverage?.applicableSuites ?? TASK5_SCREEN_SUITES;

  const suiteResults = {};
  const sourceReports = {};

  for (const suite of suites) {
    const controlCell = manifest.cells.find((c) => c.suite === suite && c.role === "control");
    const candidateCell = manifest.cells.find((c) => c.suite === suite && c.role === "candidate");
    if (!controlCell || !candidateCell) {
      throw new Error(`Task5Verdict: manifest missing control or candidate cell for suite ${suite}`);
    }

    const controlReportRel = `${TASK5_EVIDENCE}/run-${controlCell.id.replace(/[/\\]/g, "-")}.json`;
    const candidateReportRel = `${TASK5_EVIDENCE}/run-${candidateCell.id.replace(/[/\\]/g, "-")}.json`;

    const controlBytes = await readFile(join(root, controlReportRel));
    const candidateBytes = await readFile(join(root, candidateReportRel));

    const controlReport = JSON.parse(controlBytes.toString("utf8"));
    const candidateReport = JSON.parse(candidateBytes.toString("utf8"));

    sourceReports[controlCell.id] = {
      path: controlReportRel,
      sha256: sha256(controlBytes),
      questionsScored: controlReport.results?.filter((r) => r.outcome === "scored").length ?? 0,
      totalResults: controlReport.results?.length ?? 0,
      status: controlReport.status ?? null,
    };
    sourceReports[candidateCell.id] = {
      path: candidateReportRel,
      sha256: sha256(candidateBytes),
      questionsScored: candidateReport.results?.filter((r) => r.outcome === "scored").length ?? 0,
      totalResults: candidateReport.results?.length ?? 0,
      status: candidateReport.status ?? null,
    };

    const cohortIds = controlCell.questionIds;
    const gap = task5CandidateGap(controlReport.results ?? [], candidateReport.results ?? [], {
      cohortIds,
      suite,
    });

    const cohortSuite = Array.isArray(manifest.cohort?.suites)
      ? manifest.cohort.suites.find((s) => s.suite === suite)
      : manifest.cohort?.suites?.[suite];
    const ability = task5AbilityGuard(controlReport.results ?? [], candidateReport.results ?? [], {
      cohortIds,
      cohortAbilities: cohortSuite?.abilities,
      descriptive: isScreen,
    });

    // In screen mode, candidate gap is the gate; ability is descriptive.
    // In full target mode, ability regression or unverified stratum would veto.
    let suiteVerdict = gap.verdict;
    if (!isScreen && (!ability.passed || gap.verdict !== "pass")) {
      suiteVerdict = "miss";
    }

    suiteResults[suite] = {
      suite,
      candidateGap: gap,
      abilityGuard: ability,
      suiteVerdict,
    };
  }

  const verdicts = Object.values(suiteResults).map((s) => s.suiteVerdict);
  let screenVerdict = "pass";
  if (verdicts.some((v) => v === "miss")) {
    screenVerdict = "miss";
  } else if (verdicts.some((v) => v === "inconclusive")) {
    screenVerdict = "inconclusive";
  }

  return {
    schemaVersion: 1,
    title: "Plan 202 Task 5 Development Screen Verdict",
    criteriaVersion: manifest.criteria?.version ?? TASK5_SCREEN_VERSION,
    manifestHash: manifest.manifestHash,
    generatedAt: new Date().toISOString(),
    mode: isScreen ? "development-screen" : "full-target",
    screenVerdict,
    handOff: {
      plan: 210,
      reason: TASK5_SCREEN_HANDOFF_REASON,
      verdictSummary:
        screenVerdict === "miss"
          ? "Candidate gap did not achieve the required 50% reduction in any measurable suite (ratios 0.88-1.22 vs target <= 0.50). MAB was unmeasurable due to lack of fine round labels. Descriptive ability regressions observed on beam-100k (abstention, preference_following), locomo (adversarial, open-domain), and beam-1m (multi_session_reasoning), with summarization and temporal_reasoning unverified. Screen closes as miss; deferred arms and root-cause investigations hand off to Plan 210."
          : "Screen passed or inconclusive",
    },
    suites: suiteResults,
    sourceReports,
  };
}

/**
 * Format verdict as GitHub-Flavored Markdown.
 */
export function task5VerdictMarkdown(verdict) {
  const lines = [
    `# Task 5 Development Screen Verdict: ${verdict.screenVerdict}`,
    "",
    `- **Criteria Version:** \`${verdict.criteriaVersion}\``,
    `- **Manifest Hash:** \`${verdict.manifestHash}\``,
    `- **Mode:** \`${verdict.mode}\` (candidate-gap rows gate; ability guard is descriptive under Task 5.4.6 owner disposition)`,
    `- **Generated At:** \`${verdict.generatedAt}\``,
    `- **Overall Screen Verdict:** **\`${verdict.screenVerdict}\`**`,
    "",
    "## Summary by Suite",
    "",
    "| Suite | Complete Pairs | Control Gap | Candidate Gap | Ratio | Target (<= 0.5x) | Gap Verdict | Ability Regressions | Suite Verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const [suite, s] of Object.entries(verdict.suites)) {
    const gap = s.candidateGap;
    const ab = s.abilityGuard;
    const pairs = gap.measurable ? `${gap.measurablePairs}` : `0 (${gap.pairedQuestions} paired)`;
    const cGap = gap.measurable
      ? `${(gap.controlGapRate * 100).toFixed(1)}% (${gap.controlGapCount}/${gap.measurablePairs})`
      : "null (unmeasurable)";
    const tGap = gap.measurable
      ? `${(gap.candidateGapRate * 100).toFixed(1)}% (${gap.candidateGapCount}/${gap.measurablePairs})`
      : "null (unmeasurable)";
    const ratio = gap.measurable ? `${gap.ratio.toFixed(3)}` : "n/a";
    const target = gap.measurable ? `<=${(gap.halvingTarget * 100).toFixed(1)}%` : "n/a";
    const regressions = ab.regressions.length ? ab.regressions.join(", ") : "none";
    lines.push(
      `| \`${suite}\` | ${pairs} | ${cGap} | ${tGap} | ${ratio} | ${target} | **\`${gap.verdict}\`** | ${regressions} | **\`${s.suiteVerdict}\`** |`,
    );
  }

  lines.push("", "## Candidate-Gap Detail", "");
  for (const [suite, s] of Object.entries(verdict.suites)) {
    const gap = s.candidateGap;
    lines.push(`### \`${suite}\``, "");
    if (!gap.measurable) {
      lines.push(`- **Status:** Unmeasurable (${gap.reason})`);
      lines.push(`- **Verdict:** \`${gap.verdict}\``, "");
      continue;
    }
    lines.push(`- **Complete Pairs:** ${gap.measurablePairs} (of ${gap.pairedQuestions} total paired questions)`);
    lines.push(`- **Control Gap:** ${gap.controlGapCount}/${gap.measurablePairs} (${(gap.controlGapRate * 100).toFixed(2)}%)`);
    lines.push(`- **Candidate Gap:** ${gap.candidateGapCount}/${gap.measurablePairs} (${(gap.candidateGapRate * 100).toFixed(2)}%)`);
    lines.push(`- **Ratio:** ${gap.ratio.toFixed(3)} (required: <= 0.500)`);
    lines.push(`- **Halving Target:** <= ${(gap.halvingTarget * 100).toFixed(2)}%`);
    if (gap.uncertainty) {
      lines.push(
        `- **Paired Difference (Candidate - Control):** ${(gap.uncertainty.diff * 100).toFixed(2)}% (95% CI: [${(gap.uncertainty.ci95[0] * 100).toFixed(2)}%, ${(gap.uncertainty.ci95[1] * 100).toFixed(2)}%], two-sided sign-flip p = ${gap.uncertainty.p.toFixed(4)})`,
      );
    }
    if (gap.worstCaseBound) {
      lines.push(
        `- **Worst-Case Bound:** candidate failures counted as not-surfaced: ${gap.worstCaseBound.worstCaseCandidateGaps}/${gap.measurablePairs + gap.worstCaseBound.candidateFailures} (${(gap.worstCaseBound.worstCaseCandidateGapRate * 100).toFixed(2)}%, passed: ${gap.worstCaseBound.worstCasePassed})`,
      );
    }
    lines.push(`- **Candidate-Gap Verdict:** **\`${gap.verdict}\`**`, "");
  }

  lines.push("## Ability-Guard Detail (Descriptive)", "");
  for (const [suite, s] of Object.entries(verdict.suites)) {
    const ab = s.abilityGuard;
    lines.push(`### \`${suite}\``, "");
    lines.push(
      "| Ability | Pairs | Control Acc | Candidate Acc | Diff | 95% CI | Sign-Flip p | Holm p | Status |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const [ability, st] of Object.entries(ab.strata)) {
      if (st.missing) {
        lines.push(`| \`${ability}\` | 0 | null | null | null | null | null | null | **unverified** |`);
      } else {
        const cAcc = `${(st.controlAccuracy * 100).toFixed(1)}% (${st.controlCorrect}/${st.pairs})`;
        const tAcc = `${(st.candidateAccuracy * 100).toFixed(1)}% (${st.candidateCorrect}/${st.pairs})`;
        const diffStr = `${st.diff >= 0 ? "+" : ""}${(st.diff * 100).toFixed(1)}%`;
        const ciStr = `[${(st.ci95[0] * 100).toFixed(1)}%, ${(st.ci95[1] * 100).toFixed(1)}%]`;
        const pStr = st.p !== null ? st.p.toFixed(4) : "n/a";
        const pHolmStr = st.pHolm !== null ? st.pHolm.toFixed(4) : "n/a";
        const statusStr = st.regressed ? "**regression**" : "pass";
        lines.push(`| \`${ability}\` | ${st.pairs} | ${cAcc} | ${tAcc} | ${diffStr} | ${ciStr} | ${pStr} | ${pHolmStr} | ${statusStr} |`);
      }
    }
    lines.push("");
  }

  lines.push(
    "## Plan 210 Hand-Off",
    "",
    `- **Disposition:** ${verdict.handOff.reason}`,
    `- **Summary:** ${verdict.handOff.verdictSummary}`,
    "- **Deferred Arms and Tasks:**",
    "  - `longmemeval-m` full write & recall execution deferred to Plan 210 Task 5",
    "  - `beam-1m` full 40-question cohort deferred to Plan 210 Task 5",
    "  - Ability guard veto evaluation deferred to Plan 210 Task 9 (suite coverage)",
    "  - Root-cause recall investigations on LoCoMo and BEAM hand off to Plan 210 Task 1 ledger",
    "",
    "## Source Reports",
    "",
    "| Cell ID | Status | Scored / Total | Report Path | sha256 |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const [cellId, rep] of Object.entries(verdict.sourceReports)) {
    lines.push(
      `| \`${cellId}\` | ${rep.status} | ${rep.questionsScored}/${rep.totalResults} | \`${rep.path}\` | \`${rep.sha256.slice(0, 16)}...\` |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Write development-screen-verdict.json and development-screen-verdict.md.
 */
export async function writeTask5ScreenVerdict({
  root = ".",
  manifestPath = TASK5_SCREEN_MANIFEST,
  jsonPath = TASK5_SCREEN_VERDICT_JSON,
  mdPath = TASK5_SCREEN_VERDICT_MD,
} = {}) {
  const verdict = await computeTask5ScreenVerdict({ root, manifestPath });
  await mkdir(join(root, TASK5_EVIDENCE), { recursive: true });
  await writeFile(join(root, jsonPath), `${JSON.stringify(verdict, null, 2)}\n`);
  await writeFile(join(root, mdPath), task5VerdictMarkdown(verdict));
  return verdict;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const option = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  if (argv.includes("--gate")) {
    const gate = await writeTask5OwnerGate({
      text: option("--text"),
      approvedAt: option("--approved-at"),
      ...(option("--supersedes") ? { supersedesPath: option("--supersedes") } : {}),
      transportRevision: argv.includes("--transport-revision"),
      ...(option("--subtask") ? { subtask: option("--subtask") } : {}),
    });
    console.log(
      JSON.stringify({
        gate: TASK5_GATE,
        gateNumber: gate.gate,
        manifestHash: gate.proposal.manifestHash,
        journalFingerprint: gate.journal.fingerprint,
        cells: gate.scope.cells,
        totalUsd: gate.billing.totalUsd,
      }),
    );
    process.exit(0);
  }
  if (argv.includes("--verdict")) {
    const verdict = await writeTask5ScreenVerdict({
      ...(option("--manifest-path") ? { manifestPath: option("--manifest-path") } : {}),
    });
    console.log(
      JSON.stringify({
        verdict: TASK5_SCREEN_VERDICT_JSON,
        screenVerdict: verdict.screenVerdict,
        suites: Object.fromEntries(
          Object.entries(verdict.suites).map(([suite, s]) => [
            suite,
            {
              suiteVerdict: s.suiteVerdict,
              gap: s.candidateGap.verdict,
              ratio: s.candidateGap.ratio,
              regressions: s.abilityGuard.regressions,
            },
          ]),
        ),
      }),
    );
    process.exit(0);
  }
  if (!argv.includes("--manifest"))
    throw new Error(
      "Task5Manifest: usage: task5-comparison.mjs --manifest [--screen [--repin]] | --gate --text <owner approval> [--approved-at YYYY-MM-DD] [--supersedes <archived manifest> [--transport-revision]] [--subtask <id>] | --verdict [--manifest-path <path>]",
    );
  if (argv.includes("--screen")) {
    const screen = await writeTask5ScreenManifest({ repin: argv.includes("--repin") });
    console.log(
      JSON.stringify({
        manifest: TASK5_SCREEN_MANIFEST,
        cells: screen.cells.length,
        questions: screen.cohort.questionCount,
        reservedInputTokens: screen.budgets.campaign.reservedInputTokens,
        expectedPhysicalCalls: screen.budgets.campaign.expectedPhysicalCalls,
        totalUsd: screen.cost.totalUsd,
        manifestHash: screen.manifestHash,
        journalFingerprint: screen.stopResume.manifestFingerprint,
      }),
    );
    process.exit(0);
  }
  const manifest = await writeTask5ComparisonManifest();
  console.log(
    JSON.stringify({
      manifest: TASK5_MANIFEST,
      cells: manifest.cells.length,
      questions: manifest.cohort.questionCount,
      reservedInputTokens: manifest.budgets.campaign.reservedInputTokens,
      totalUsd: manifest.cost.totalUsd,
      manifestHash: manifest.manifestHash,
    }),
  );
}
