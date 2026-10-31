/**
 * Plan 202 Task 5.4: execute the approved paired development comparison.
 *
 * The proposal stays frozen; this module only turns it into the campaign shape journal.mjs already
 * understands, refuses to run without a passing gate, and makes the control worktree comparable.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertCacheStabilityPin } from "./audit/readiness.mjs";
import { latestAttempt, manifestFingerprint } from "./journal.mjs";
import { assertComparableServedDeployments } from "./served-model.mjs";
import {
  assertTask5CandidateClean,
  assertTask5OwnerGate,
  assertTask5ScopeReduction,
  auditTask5Comparison,
  ensureTask5ControlRef,
  TASK5_ACTIVE_MANIFEST,
  TASK5_EVIDENCE,
  TASK5_GATE,
  TASK5_JOURNAL,
  TASK5_MANIFEST,
  TASK5_SCREEN_SUITES,
  task5ScreenExpectedCohort,
} from "./task5-comparison.mjs";

const run = promisify(execFile);

export const TASK5_LOGS = ".cache/memory-bench/task5/logs";
export const TASK5_SUMMARY = `${TASK5_EVIDENCE}/execution-run.json`;
export const TASK5_VERIFICATION = `${TASK5_EVIDENCE}/execution-verification.json`;
export const TASK5_KEY_TIER = `${TASK5_EVIDENCE}/free-key.json`;
export const TASK5_SMOKE_JOURNAL = ".cache/memory-bench/task5/journal-smoke.json";
export const TASK5_SMOKE_SUMMARY = `${TASK5_EVIDENCE}/execution-smoke.json`;
export const TASK5_SMOKE_VERIFICATION = `${TASK5_EVIDENCE}/execution-smoke-verification.json`;
/** The bounded wire smoke: one question per arm on one suite, on the same approved route. */
export const TASK5_SMOKE_SUITE = "beam-100k";
export const TASK5_SMOKE_MAX_QUESTIONS = 1;
/** The product names the decoded calls and traces must carry; anything else is a wire leak. */
export const TASK5_PRODUCT_TOOL_NAMES = ["memory.recall", "memory.read"];
/** OpenRouter grants 1,000 free-model requests per day once 10 credits have been purchased, 50 otherwise. */
export const FREE_TIER_DAILY_REQUESTS = 1000;
export const TASK5_CONTROL_WORKTREE = ".cache/memory-bench/task5/control-worktree";

/** The plan of record for execution is the reduced development screen (plan 202 Task 5.4.6). */
export async function readTask5Proposal(root = ".") {
  return JSON.parse(await readFile(join(root, TASK5_ACTIVE_MANIFEST), "utf8"));
}

/** The full ten-cell manifest stays on disk as the record plan 210 inherits; the screen must be its reduction. */
export async function assertTask5ScreenProposal(root, proposal) {
  const full = JSON.parse(await readFile(join(root, TASK5_MANIFEST), "utf8"));
  return assertTask5ScopeReduction(full, proposal);
}

/**
 * Gate-11 reports are not reused: a screen journal opened under a superseded gate is refused rather
 * than resumed, so every screen cell runs fresh under gate 15.
 */
/** Audit the active proposal against its own reduced cohort, not the full draw. */
export async function auditTask5ActiveProposal(root, proposal) {
  const full = JSON.parse(await readFile(join(root, TASK5_MANIFEST), "utf8"));
  return auditTask5Comparison(proposal, {
    root,
    suites: TASK5_SCREEN_SUITES,
    expectedCohort: task5ScreenExpectedCohort(full),
  });
}

export function assertTask5ScreenJournalFresh(journal, manifest) {
  const expected = manifest.stopResume?.manifestFingerprint;
  if (!expected) throw new Error("Task5Screen: the screen manifest carries no journal identity");
  if (journal?.manifestHash !== expected)
    throw new Error(`Task5Screen: journal ${journal?.campaignId ?? "(unknown)"} belongs to a superseded gate; screen cells run fresh`);
  const stale = (journal.attempts ?? []).filter((attempt) => attempt.manifestHash && attempt.manifestHash !== expected);
  if (stale.length) throw new Error(`Task5Screen: ${stale.length} journal attempts were produced under a superseded gate`);
  return journal;
}

/**
 * The control needs its own checkout for the product and its own node_modules for workspace links,
 * then the frozen harness on top. Copying it is what makes "only the product is the treatment" true.
 */
export async function prepareTask5Control({ root = ".", worktree = TASK5_CONTROL_WORKTREE, proposal } = {}) {
  if (!proposal) throw new Error("Task5Execute: prepareTask5Control needs the frozen proposal");
  const control = proposal.product.control.revision;
  // r2 is derived, never hand-made: the candidate tree with the product paths from the source commit.
  const built = await ensureTask5ControlRef(proposal.product.candidate.revision, { root });
  if (built !== control) throw new Error(`Task5Execute: the control ref is ${built}, expected ${control}`);
  const dir = join(root, worktree);
  if (existsSync(join(dir, ".git"))) {
    const head = (await run("git", ["-C", dir, "rev-parse", "HEAD"])).stdout.trim();
    // A stale worktree is rebuilt, never reused: its HEAD is part of the treatment.
    if (head !== control) await run("git", ["-C", root, "worktree", "remove", "--force", dir], { maxBuffer: 1 << 28 });
  }
  if (!existsSync(join(dir, ".git"))) await run("git", ["-C", root, "worktree", "add", "--detach", dir, control], { maxBuffer: 1 << 28 });
  const revision = (await run("git", ["-C", dir, "rev-parse", "HEAD"])).stdout.trim();
  if (revision !== control) throw new Error(`Task5Execute: control worktree is at ${revision}, expected ${control}`);
  if (!existsSync(join(dir, "node_modules")))
    await cp(join(root, "node_modules"), join(dir, "node_modules"), { recursive: true, verbatimSymlinks: true });
  // The frozen harness is copied on top so both arms run byte-identical benchmark code.
  await rm(join(dir, "scripts/memory-bench"), { recursive: true, force: true });
  await cp(join(root, "scripts/memory-bench"), join(dir, "scripts/memory-bench"), { recursive: true });
  return dir;
}

/** Reduce `GET /api/v1/key` to the tier and remaining counts; the key itself never leaves the process. */
export function freeTierFromKeyResponse(body) {
  const data = body?.data ?? body ?? {};
  const paidTier = data.is_free_tier === false;
  return {
    paidTier,
    dailyFreeRequests: paidTier ? FREE_TIER_DAILY_REQUESTS : 50,
    limitRemainingUsd: typeof data.limit_remaining === "number" ? data.limit_remaining : null,
    usageUsd: typeof data.usage === "number" ? data.usage : null,
  };
}

export async function readOpenRouterKeyTier({ apiKey = process.env.OPENROUTER_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("Task5Execute: OPENROUTER_API_KEY is not set");
  const response = await fetchImpl("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Task5Execute: GET /api/v1/key returned ${response.status}`);
  return freeTierFromKeyResponse(await response.json());
}

/**
 * Plan 202 Task 5.4 (Kilo transport): the free rows need no account, so the tier question becomes a
 * panel question: every pinned answer and judge row must be in the live catalog at exactly $0 and
 * accept tools. A stale row is refused before the campaign spends anything.
 */
export async function readKiloFreePanel({ refs = [], baseUrl = "https://ai-gateway.kilo.ai/api/v1", fetchImpl = fetch, catalog } = {}) {
  let rows = catalog;
  if (!rows) {
    const response = await fetchImpl(`${baseUrl}/models`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Task5Execute: GET ${baseUrl}/models returned ${response.status}`);
    rows = (await response.json())?.data;
  }
  if (!Array.isArray(rows)) throw new Error("Task5Execute: the Kilo catalog has no data array");
  const byId = new Map(rows.map((row) => [row.id, row]));
  return refs.map((ref) => {
    const model = ref.split("/").slice(1).join("/");
    const row = byId.get(model);
    if (!row) throw new Error(`Task5Execute: ${ref} is not in the Kilo catalog`);
    if (Number(row.pricing?.prompt) !== 0 || Number(row.pricing?.completion) !== 0)
      throw new Error(`Task5Execute: ${ref} is not free right now`);
    const params = row.supported_parameters ?? [];
    if (params.length && !params.includes("tools")) throw new Error(`Task5Execute: ${ref} does not accept tools`);
    return {
      ref,
      contextWindow: row.context_length ?? null,
      maxOutputTokens: row.top_provider?.max_completion_tokens ?? null,
    };
  });
}

/** Below the 1,000/day tier the campaign cannot finish, so it must not start. */
export function assertTask5FreeTier(tier) {
  if (!tier || tier.dailyFreeRequests < FREE_TIER_DAILY_REQUESTS)
    throw new Error(
      `Task5Execute: the account is on the ${tier?.dailyFreeRequests ?? "unknown"}-requests/day free tier; the campaign needs ${FREE_TIER_DAILY_REQUESTS}`,
    );
  return tier;
}

/**
 * A finished journal is evidence, not a resume point (Task 5.4.4): the earlier failed attempt keeps
 * its 7.5M reservation and $0 charge exactly as recorded, and the next campaign opens a new one.
 * A journal that is still open (for example after a daily-quota halt) is left for its own resume.
 */
export async function archiveFinishedTask5Journal({ root = ".", journalPath = TASK5_JOURNAL, evidence = TASK5_EVIDENCE } = {}) {
  const path = join(root, journalPath);
  if (!existsSync(path)) return null;
  const journal = JSON.parse(await readFile(path, "utf8"));
  if (!journal.campaignId || journal.status !== "finished") return null;
  const archived = `${evidence}/journal-${journal.campaignId}.json`;
  if (!existsSync(join(root, archived))) {
    await mkdir(join(root, evidence), { recursive: true });
    await writeFile(join(root, archived), `${JSON.stringify(journal, null, 2)}\n`);
  }
  await rm(path, { force: true });
  return { campaignId: journal.campaignId, archived };
}

/**
 * The revision-1 product must run on the r2 kernel. Serial execution is deliberate: the fabric
 * suites share temp state across files and flake in parallel (pre-existing, unrelated to Task 5).
 */
export const TASK5_CONTROL_VERIFICATION = `${TASK5_EVIDENCE}/control-verification.json`;
export async function verifyTask5Control(dir, { root = ".", attempts = 3 } = {}) {
  const exec = (command, args, timeout) => run(command, args, { cwd: dir, maxBuffer: 1 << 28, timeout });
  const record = { kind: "202-task5-control-verification", checkedAt: new Date().toISOString(), attempts: [] };
  let suitePassed = false;
  for (let attempt = 1; attempt <= attempts && !suitePassed; attempt++) {
    try {
      await exec("bun", ["test", "--concurrency=1", "packages/memory/fabric", "packages/memory/core"], 900_000);
      suitePassed = true;
      record.attempts.push({ attempt, suite: "pass" });
    } catch (error) {
      // The fabric suite has a pre-existing cross-file isolation flake (a reviewer duplicate-fold reads
      // a neighbour's ledger); it cannot be fixed here without changing the frozen product.
      const cause = `${error.stderr ?? error.stdout ?? error.message}`
        .split("\n")
        .filter((line) => line.includes("(fail)") || line.includes("AssertionError"))
        .slice(0, 3);
      record.attempts.push({ attempt, suite: "fail", cause });
      if (attempt === attempts) {
        await writeFile(join(root, TASK5_CONTROL_VERIFICATION), `${JSON.stringify(record, null, 2)}\n`);
        throw new Error(`Task5Execute: the control worktree failed its suites on ${attempts} attempts: ${cause.join("; ")}`);
      }
    }
  }
  await exec("bun", ["run", "typecheck"], 1_200_000);
  record.attempts.push({ attempt: record.attempts.length, typecheck: "pass" });
  record.status = "pass";
  await mkdir(join(root, TASK5_EVIDENCE), { recursive: true });
  await writeFile(join(root, TASK5_CONTROL_VERIFICATION), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** The journal identity is the frozen fingerprint; a rebuilt campaign must reproduce it exactly. */
export function task5CampaignFingerprint(proposal) {
  return manifestFingerprint({
    criteriaHash: proposal.criteriaHash,
    ceiling: proposal.budgets.campaign.ceiling,
    provider: proposal.models.answers[0].split("/")[0],
    model: proposal.models.answers[0].split("/").slice(1).join("/"),
    jobs: proposal.cells,
  });
}

export async function buildTask5CampaignManifest({ root = ".", smoke = false } = {}) {
  const proposal = await readTask5Proposal(root);
  await assertTask5ScreenProposal(root, proposal);
  const gate = JSON.parse(await readFile(join(root, TASK5_GATE), "utf8"));
  assertTask5OwnerGate(gate, proposal, TASK5_ACTIVE_MANIFEST);
  if (task5CampaignFingerprint(proposal) !== gate.journal.fingerprint)
    throw new Error("Task5Execute: the campaign fingerprint differs from the approved journal identity");
  // Source pins only; preflight refreshes and then strictly audits the control worktree.
  await auditTask5ActiveProposal(root, proposal);
  const smokeJobs = smoke ? proposal.cells.filter((cell) => cell.suite === TASK5_SMOKE_SUITE) : [];
  // Two questions at most: the smoke cannot become a second campaign by accident.
  if (smoke && (smokeJobs.length !== 2 || smokeJobs.length * TASK5_SMOKE_MAX_QUESTIONS > 2))
    throw new Error(`Task5Smoke: the smoke must cover both arms of ${TASK5_SMOKE_SUITE} with one question each`);
  const [provider, ...model] = proposal.models.answers[0].split("/");
  return {
    schemaVersion: 1,
    kind: "202-task5-execution",
    plan: 202,
    task: 5,
    subtask: 5.4,
    smoke,
    status: "approved",
    gate: { path: TASK5_GATE, manifestHash: gate.proposal.manifestHash, journal: gate.journal.fingerprint },
    criteriaHash: proposal.criteriaHash,
    // A checkpoint from another product is not a resume, but a harness commit must not invalidate
    // one: the revision a report records is the product bytes an arm executed, never a commit sha.
    productRevision: {
      control: proposal.product.control.productHash,
      candidate: proposal.product.candidate.productHash,
    },
    evidenceProtocolHash: proposal.evidenceProtocolHash,
    analysisHash: proposal.analysisHash,
    ceiling: proposal.budgets.campaign.ceiling,
    provider,
    model: model.join("/"),
    journalPath: TASK5_JOURNAL,
    summaryPath: TASK5_SUMMARY,
    // The smoke is the same approved campaign with one question per arm, so the journal identity
    // and the gate binding are unchanged and both spend the same accounting.
    jobs: proposal.cells
      .filter((cell) => (smoke ? cell.suite === TASK5_SMOKE_SUITE : true))
      .map(({ reuse, ...job }) => (smoke ? { ...job, maxQuestions: TASK5_SMOKE_MAX_QUESTIONS } : job)),
    results: [],
  };
}

export async function preflightTask5(manifest, { root = ".", keyTier } = {}) {
  const proposal = await readTask5Proposal(root);
  await assertTask5ScreenProposal(root, proposal);
  if (task5CampaignFingerprint(proposal) !== manifest.gate.journal)
    throw new Error("Task5Execute: the campaign fingerprint changed before execution");
  // Working-tree drift could enter the candidate arm, and the control worktree is part of the arms.
  const clean = await assertTask5CandidateClean({ root });
  if (clean.ignored.length) console.log(`preflight: ignoring non-executable dirty paths: ${clean.ignored.join(", ")}`);
  const dir = await prepareTask5Control({ root, proposal });
  await auditTask5ActiveProposal(root, proposal);
  await assertCacheStabilityPin(proposal, { root });
  // The account's free tier decides whether the run can finish; check it before spending anything.
  // A credentialless Kilo panel has no tier to read, so its rows are checked against the live catalog.
  const provider = proposal.models.answers[0].split("/")[0];
  const tier =
    provider === "kilo"
      ? {
          kind: "202-task5-free-panel",
          provider,
          checkedAt: new Date().toISOString(),
          panel: await readKiloFreePanel({ refs: [...proposal.models.answers, ...proposal.models.judges] }),
        }
      : assertTask5FreeTier(keyTier ?? (await readOpenRouterKeyTier()));
  // Never resume a finished campaign: its attempts are frozen evidence, not a starting point.
  await archiveFinishedTask5Journal({ root });
  // An open journal from a superseded gate is not a screen resume point either.
  const openJournal = join(root, TASK5_JOURNAL);
  if (existsSync(openJournal)) assertTask5ScreenJournalFresh(JSON.parse(await readFile(openJournal, "utf8")), proposal);
  await writeFile(
    join(root, TASK5_KEY_TIER),
    `${JSON.stringify({ kind: "202-task5-free-key-tier", checkedAt: new Date().toISOString(), ...tier }, null, 2)}\n`,
  );
  await verifyTask5Control(dir, { root });
  return tier;
}

/** Every tool name a report's traces actually carry, in both the call and its result. */
export function task5TraceToolNames(report) {
  const names = new Set();
  for (const request of report?.trace?.requests ?? [])
    for (const message of request.messages ?? [])
      for (const block of message.content ?? [])
        if ((block?.type === "tool_use" || block?.type === "tool_result") && block.name) names.add(block.name);
  return [...names].sort();
}

/** Returned notes per trace: the surfacing count must come from these, never from a name match. */
export function task5TraceHits(report) {
  const hits = [];
  for (const request of report?.trace?.requests ?? [])
    for (const message of request.messages ?? [])
      for (const block of message.content ?? [])
        if (block?.type === "tool_result" && !block.error)
          hits.push(...(block.name === "memory.recall" ? (block.result?.hits ?? []) : (block.result?.notes ?? [])));
  return hits;
}

/**
 * Fail closed on a wire name in a trace: `memory_recall` would make surfacing read zero with no
 * error, silently corrupting the candidate gap (Task 5.4.5).
 */
export function assertTask5TraceProductNames(report) {
  const names = task5TraceToolNames(report);
  const wire = names.filter((name) => /^memory_/.test(name));
  if (wire.length) throw new Error(`Task5Smoke: trace carries wire tool names ${wire.join(", ")}`);
  const unknown = names.filter((name) => !TASK5_PRODUCT_TOOL_NAMES.includes(name));
  if (unknown.length) throw new Error(`Task5Smoke: trace carries unexpected tool names ${unknown.join(", ")}`);
  return names;
}

export function assertTask5SmokeReports(reports) {
  const names = new Set();
  let hits = 0;
  for (const report of reports) {
    for (const name of assertTask5TraceProductNames(report)) names.add(name);
    hits += task5TraceHits(report).length;
  }
  if (reports.length === 0) throw new Error("Task5Smoke: the smoke produced no report");
  // The route refused `memory.recall` on the earlier attempt, so that is the call to prove.
  if (!names.has("memory.recall")) throw new Error("Task5Smoke: no memory.recall call appears in the traces");
  // A smoke with no returned note proves nothing about surfacing: the route accepted the call.
  if (hits === 0) throw new Error("Task5Smoke: no notes were returned, so surfacing would read zero");
  return { toolNames: [...names].sort(), hits, reports: reports.length };
}

/** The paired answer-cache traces of a smoke arm: they hold the names that crossed the wire. */
async function task5AnswerCacheEntries(answersDir, { root = "." } = {}) {
  const dir = answersDir ? join(root, answersDir) : null;
  if (!dir || !existsSync(dir)) return [];
  const entries = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")))
    entries.push(JSON.parse(await readFile(join(dir, file), "utf8")));
  return entries;
}

/** Read the smoke reports named by the campaign results, prove the trace contract, record it. */
export async function verifyTask5Smoke(manifest, { root = "." } = {}) {
  // A capped run ends `partial`, which is the smoke's normal status; only a failure is not a smoke.
  const results = manifest.results.filter((row) => row.status === "completed" || row.status === "partial");
  const reports = [];
  for (const row of results) {
    const path = join(root, TASK5_EVIDENCE, `smoke-${row.id.replace(/[\\/]/g, "-")}.json`);
    const report = JSON.parse(await readFile(path, "utf8"));
    reports.push(report);
    // The private trace keeps the wire-level call and result names; the report keeps the product ones.
    for (const entry of await task5AnswerCacheEntries(row.answersDir, { root })) reports.push({ trace: entry.trace });
    for (const name of report.results.flatMap((question) => question.turnTrace ?? []))
      if (!TASK5_PRODUCT_TOOL_NAMES.includes(name)) throw new Error(`Task5Smoke: the turn trace carries ${name}`);
  }
  const record = {
    kind: "202-task5-smoke-verification",
    ...assertTask5SmokeReports(reports),
    statuses: manifest.results.map((row) => ({ id: row.id, status: row.status })),
    gate: manifest.gate,
  };
  await writeFile(join(root, TASK5_SMOKE_VERIFICATION), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** Post-execution provenance: the same pins must still hold, and the journal owns the spend. */
/**
 * Plan 214 Task 5b guard 2: the control and candidate arms of one suite must have been served by
 * the same deployment set, or the pair measures a gateway's shuffle instead of the product.
 */
export async function assertTask5ServedDeployments(manifest, journal) {
  const bySuite = new Map();
  for (const job of manifest.jobs ?? []) {
    const attempt = latestAttempt(journal, job.id);
    if (!attempt?.output || !existsSync(attempt.output)) continue;
    const report = JSON.parse(await readFile(attempt.output, "utf8"));
    const arms = bySuite.get(job.suite) ?? {};
    arms[job.role ?? "arm"] = report;
    bySuite.set(job.suite, arms);
  }
  for (const [suite, arms] of bySuite)
    if (arms.control && arms.candidate) assertComparableServedDeployments(arms.candidate, arms.control, { label: `task5 ${suite}` });
}

export async function postflightTask5(manifest, journal, { root = "." } = {}) {
  const proposal = await readTask5Proposal(root);
  assertTask5OwnerGate(JSON.parse(await readFile(join(root, TASK5_GATE), "utf8")), proposal, TASK5_ACTIVE_MANIFEST);
  await assertTask5ScreenProposal(root, proposal);
  await auditTask5ActiveProposal(root, proposal);
  await assertTask5ServedDeployments(manifest, journal);
  const record = {
    kind: "202-task5-execution-verification",
    gate: manifest.gate,
    journal: { campaignId: journal.campaignId, status: journal.status, ceiling: journal.ceiling },
    product: {
      control: proposal.product.control.productHash,
      candidate: proposal.product.candidate.productHash,
      harness: proposal.product.harnessHash,
    },
    criteriaHash: proposal.criteriaHash,
    evidenceProtocolHash: proposal.evidenceProtocolHash,
    analysisHash: proposal.analysisHash,
    results: manifest.results,
    provider: manifest.provider,
    model: manifest.model,
  };
  if (manifest.smoke) {
    await verifyTask5Smoke(manifest, { root });
    return record;
  }
  await writeFile(join(root, TASK5_VERIFICATION), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
