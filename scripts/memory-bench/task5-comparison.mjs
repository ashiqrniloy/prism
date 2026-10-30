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
import { join } from "node:path";
import { promisify } from "node:util";
import { fileFingerprint, sourceFingerprint } from "./acceptance.mjs";
import { DATASETS } from "./datasets.mjs";
import { manifestFingerprint, stableHash } from "./journal.mjs";
import { GRADED_TEMPLATE_VERSION, JUDGE_TEMPLATE_VERSION } from "./judge.mjs";
import { pairedAnalysisProtocol } from "./paired-sizing.mjs";
import rates from "./rates.json" with { type: "json" };
import { BENCH_MAX_TURNS, BENCH_RETRY } from "./replay.mjs";
import { ROBUSTNESS_CRITERIA, robustnessCriteriaHash, robustnessDraw } from "./robustness.mjs";
import { PAIRED_ANALYSIS_VERSION } from "./stats.mjs";
import { cacheAdjustedCost, resolveRate } from "./usage.mjs";

const run = promisify(execFile);

export const TASK5_EVIDENCE = "docs/_evidence/memory-bench/202/task5";
export const TASK5_MANIFEST = `${TASK5_EVIDENCE}/development-comparison-manifest.json`;
export const TASK5_INVENTORY = `${TASK5_EVIDENCE}/revision1-trace-inventory.json`;
export const TASK5_VERIFICATION = `${TASK5_EVIDENCE}/verification.json`;
export const TASK5_CACHE = ".cache/memory-bench/task5";
export const TASK5_JOURNAL = `${TASK5_CACHE}/journal.json`;
export const TASK5_GATE = `${TASK5_EVIDENCE}/owner-gate.json`;

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
export const TASK5_ARM = { id: "preset-r1", config: "fabric-x-tools" };
export const TASK5_MODEL = { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" };
/** Two free, non-answer families; plain text avoids structured-output capability questions. */
export const TASK5_JUDGES = ["openrouter/dots-studio/dots-3-note-preview:free", "openrouter/cohere/north-mini-code:free"];
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
    version: "202-task5-candidate-gap-v1",
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
  return paths.filter((path) => !underPath(path, TASK5_EVIDENCE) && !/^plans\/202-Phase-11-Part-O12-[^/]+\.md$/.test(path));
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

export async function assertTask5CandidateClean({ root = ".", status } = {}) {
  const text = status ?? (await run("git", ["-C", root, "status", "--porcelain"])).stdout;
  const dirty = task5UncommittedPaths(text);
  if (dirty.length) throw new Error(`Task5Manifest: the candidate has uncommitted changes: ${dirty.slice(0, 8).join(", ")}`);
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
    if (value !== 0) throw new Error(`Task5Cost: ${ref} is not a free route; the current restriction permits free OpenRouter models only`);
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
export function assertTask5ComparisonManifest(manifest, { observedProductHash, observedControlProductHash, observedCohort } = {}) {
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
  const expected = new Set(TASK5_SUITES.map((suite) => `${suite}:control`).concat(TASK5_SUITES.map((suite) => `${suite}:candidate`)));
  if (cells.length !== expected.size) refuse("every applicable suite needs one control and one candidate cell");
  const seen = new Set();
  const allIds = [];
  for (const cell of cells) {
    const key = `${cell.suite}:${cell.role}`;
    if (!expected.has(key) || seen.has(key)) refuse(`unexpected or duplicate cell ${key}`);
    seen.add(key);
    if (!TASK5_SUITES.includes(cell.suite)) refuse(`suite ${cell.suite} is not an applicable Task-5 suite`);
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
    // Cohort drift: the frozen draw, not the manifest, is authoritative.
    if (idsHash(cell.questionIds) !== idsHash([...dev])) refuse(`${key} cohort drifted from the frozen development draw`);
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

  if (idsHash(manifest.coverage?.applicableSuites ?? []) !== idsHash(TASK5_SUITES))
    refuse("applicable suites drifted from the five suites that carry revision-1 evidence");

  // Paired cells must share the treatment-external protocol exactly; only the product may differ.
  const frozenKeys = ["suite", "subset", "arm", "config", "provider", "model", "judges", "judgeProtocol", "labelInjections"];
  const budgetKeys = ["questions", "idsHash", "maxInputTokens", "maxOutputTokens", "maxTurns", "concurrency"];
  for (const suite of TASK5_SUITES) {
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

  // Cost and models: the restriction is free OpenRouter only.
  const answers = manifest.models?.answers ?? [];
  const judges = manifest.models?.judges ?? [];
  if (answers.length !== 1 || !answers[0].startsWith("openrouter/") || !answers[0].endsWith(":free"))
    refuse("the comparison requires exactly one free OpenRouter answer model");
  if (judges.length < 2 || judges.some((ref) => !ref.startsWith("openrouter/") || !ref.endsWith(":free") || answers.includes(ref)))
    refuse("judges must be two free OpenRouter families and never answer an arm");
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
export async function auditTask5Comparison(manifest, { root = ".", worktree = manifest.product?.control?.worktree } = {}) {
  assertTask5ComparisonManifest(manifest);
  const candidateRevision = manifest.product.candidate.revision;
  const controlRevision = manifest.product.control.revision;
  const candidateProductHash = await gitTreeFingerprint(manifest.product.paths, candidateRevision, root);
  const workingProductHash = await sourceFingerprint(manifest.product.paths, root);
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
  const { stdout: afterFreeze } = await run("git", ["-C", root, "diff", "--name-only", candidateRevision, "HEAD"], { maxBuffer: 1 << 28 });
  const drift = task5PostFreezePaths(afterFreeze.split("\n").filter(Boolean));
  if (drift.length) throw new Error(`Task5Manifest: commits after the candidate pin changed ${drift.slice(0, 3).join(", ")}`);
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
  const harnessHash = await sourceFingerprint(manifest.product.harnessPaths, root);
  const analysis = await pairedAnalysisProtocol(root);
  if (harnessHash !== manifest.product.harnessHash) throw new Error("Task5Manifest: harness drifted after the freeze");
  if (stableHash(analysis) !== manifest.analysisHash) throw new Error("Task5Manifest: analysis protocol drifted after the freeze");
  if (analysis.criteriaHash !== robustnessCriteriaHash()) throw new Error("Task5Manifest: robustness criteria binding is broken");
  const observedCohort = Object.fromEntries(TASK5_SUITES.map((suite) => [suite, suiteCohort(suite).questionIds]));
  assertTask5ComparisonManifest(manifest, {
    observedProductHash: candidateProductHash,
    observedControlProductHash: controlProductHash,
    observedCohort,
  });
  return { candidateProductHash, controlProductHash, controlHarnessHash, harnessHash, observedCohort };
}

export function task5ComparisonMarkdown(manifest) {
  const money = (value) => `$${Number(value ?? 0).toFixed(2)}`;
  return [
    "# Plan 202 Task 5.2 — frozen paired development-comparison manifest",
    "",
    `Status: **${manifest.status}**, \`executable: false\`. Task 5.3 must record the owner gate against manifest hash \`${manifest.manifestHash.slice(0, 16)}…\` before any provider call.`,
    "",
    `Manifest: [${TASK5_MANIFEST}](development-comparison-manifest.json) (ids, counts, hashes and budgets only).`,
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
    `- Ability guard: ${manifest.criteria.abilityGuard.rule}.`,
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
    "timeout 120 bun scripts/memory-bench/task5-comparison.mjs --manifest",
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

function flattenLeaves(value, prefix = "", out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenLeaves(item, `${prefix}.${index}`, out));
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
  { text, approvedAt = new Date().toISOString().slice(0, 10), approvedBy = "owner", gate = 5, subtask = "5.3", supersedes = null } = {},
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
    proposal: { path: TASK5_MANIFEST, manifestHash: manifest.manifestHash },
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
      mode: "free-openrouter",
      provider: "openrouter",
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

export function assertTask5OwnerGate(gate, manifest) {
  const refuse = (reason) => {
    throw new Error(`Task5Gate: ${reason}`);
  };
  if (gate?.kind !== "202-task5-owner-gate") refuse("unknown gate kind");
  if (gate.approved !== true) refuse("execution is not approved");
  if (typeof gate.text !== "string" || !gate.text.trim()) refuse("the owner's approval text is missing");
  if (gate.proposal?.path !== TASK5_MANIFEST || gate.proposal?.manifestHash !== manifest.manifestHash)
    refuse("the approval is not bound to the frozen manifest");
  if (gate.journal?.path !== TASK5_JOURNAL || gate.journal?.fingerprint !== manifest.stopResume?.manifestFingerprint)
    refuse("the approval is not bound to the campaign journal identity");
  if (
    gate.billing?.mode !== "free-openrouter" ||
    gate.billing?.provider !== "openrouter" ||
    gate.billing?.freeProductsOnly !== true ||
    !Array.isArray(gate.billing?.paidFallbacks) ||
    gate.billing.paidFallbacks.length !== 0
  )
    refuse("only free OpenRouter products are authorized");
  for (const ref of [...manifest.models.answers, ...manifest.models.judges]) {
    if (!String(ref).endsWith(":free")) refuse(`${ref} is not a free OpenRouter route`);
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

export function task5OwnerGateMarkdown(manifest, gate) {
  return [
    `# Plan 202 Task ${gate.subtask} — owner gate ${gate.gate}`,
    "",
    `Status: **approved-by-${gate.approvedBy}** on ${gate.approvedAt}. The proposal itself stays \`executable: false\`; this gate is the authorization.`,
    "",
    `Gate text (verbatim): ${gate.text}`,
    "",
    "## Binding",
    "",
    `- Manifest: \`${gate.proposal.manifestHash}\` ([${gate.proposal.path}](development-comparison-manifest.json)).`,
    `- Journal: \`${gate.journal.path}\`, fingerprint \`${gate.journal.fingerprint}\` (campaign identity over criteria, ceiling, provider, model and jobs).`,
    `- Arms: candidate \`${gate.product?.candidate}\` (product \`${gate.product?.candidateProductHash}\`); control r2 \`${gate.product?.control}\` (product \`${gate.product?.controlProductHash}\` from \`${gate.product?.controlSource}\`); harness \`${gate.product?.harnessHash}\`.`,
    `- A changed manifest, cohort, criteria or journal identity is a refusal, not a re-approval.`,
    ...(gate.supersedes
      ? [
          "",
          `## Supersedes gate ${gate.supersedes.gate}`,
          "",
          `- Gate ${gate.supersedes.gate} stays unedited at \`${gate.supersedes.records.gate}\` (sha256 \`${gate.supersedes.records.gateSha256}\`, manifest \`${gate.supersedes.manifestHash}\`); this gate replaces it.`,
          `- Journal identity is unchanged (\`${gate.supersedes.journalFingerprint}\`) because the cohort, criteria, protocol, models, judges, budgets and caps did not move: only the fields below changed.`,
          "",
          ...gate.supersedes.changes.map((path) => `- \`${path}\``),
        ]
      : []),
    "",
    "## Approved scope",
    "",
    `- ${gate.scope.cells} cells (${gate.scope.pairs} control/candidate pairs) over ${gate.scope.suites.join(", ")}; arm \`${gate.scope.arm.id}\` (\`${gate.scope.arm.config}\`); ${gate.scope.questions} development questions.`,
    `- Answer: ${gate.scope.answers.map((ref) => `\`${ref}\``).join(", ")}; judges ${gate.scope.judges.map((ref) => `\`${ref}\``).join(" + ")}.`,
    "- Billing: free OpenRouter routes only; no paid fallback, no cross-provider claim.",
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
    "timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs",
    'timeout 120 bun scripts/memory-bench/task5-comparison.mjs --gate --text "<owner approval>" --approved-at 2026-10-30',
    "```",
    "",
  ].join("\n");
}

/**
 * The record that replaces a gate without editing it: the archived gate's bytes stay as they were,
 * their sha256 is carried into the new gate, and the changed manifest fields are listed.
 */
export async function supersedesRecord({ root, manifestPath, manifest }) {
  const previous = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
  const gatePath = manifestPath.replace(/development-comparison-manifest/, "owner-gate");
  const gateBytes = await readFile(join(root, gatePath));
  const previousGate = JSON.parse(gateBytes.toString("utf8"));
  const changes = assertTask5RefreezeDiff(previous, manifest);
  if (!changes.length) throw new Error("Task5Gate: a re-freeze must change something");
  return {
    gate: previousGate.gate ?? null,
    manifestHash: previousGate.proposal?.manifestHash ?? null,
    journalFingerprint: previousGate.journal?.fingerprint ?? null,
    records: { manifest: manifestPath, gate: gatePath, gateSha256: sha256(gateBytes) },
    changes,
  };
}

export async function writeTask5OwnerGate({ root = ".", text, approvedAt, path = TASK5_GATE, supersedesPath } = {}) {
  const manifest = JSON.parse(await readFile(join(root, TASK5_MANIFEST), "utf8"));
  // Gate the frozen source pins; a prepared control worktree is audited (and refreshed) in preflight.
  await auditTask5Comparison(manifest, { root, worktree: null });
  const supersedes = supersedesPath ? await supersedesRecord({ root, manifestPath: supersedesPath, manifest }) : null;
  const gate = task5OwnerGate(manifest, {
    text,
    ...(approvedAt ? { approvedAt } : {}),
    ...(supersedes ? { gate: (supersedes.gate ?? 5) + 1, subtask: "5.4.4", supersedes } : {}),
  });
  await mkdir(join(root, TASK5_EVIDENCE), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(gate, null, 2)}\n`);
  await writeFile(join(root, path.replace(/\.json$/, ".md")), task5OwnerGateMarkdown(manifest, gate));
  return gate;
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
  if (!argv.includes("--manifest"))
    throw new Error(
      "Task5Manifest: usage: task5-comparison.mjs --manifest | --gate --text <owner approval> [--approved-at YYYY-MM-DD] [--supersedes <archived manifest>]",
    );
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
