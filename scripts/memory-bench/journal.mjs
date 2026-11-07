/**
 * Durable paid-attempt journal (plan 188.7 Task 2).
 *
 * The journal, not a directory listing, is the only source of spend truth: a renamed, crashed,
 * never-reported or manually launched attempt keeps its reservation until it is reconciled once.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

export const JOURNAL_SCHEMA_VERSION = 1;
/** A cap is checked between questions, so one in-flight question may cross it. */
export const ARM_OVERSHOOT_TOKENS = 500_000;
/** Worst-case single full-context request; admission counts it before every provider call. */
export const REQUEST_BOUND_TOKENS = 250_000;
/** One planned infrastructure retry per arm; later attempts need a new campaign decision. */
export const MAX_ATTEMPTS_PER_JOB = 2;
export const TERMINAL_ATTEMPT_STATUSES = [
  "completed",
  "failed",
  // Deterministic: the provider answered 4xx in a way a retry cannot change (context too long,
  // unsupported parameter, unknown model). Retrying spends quota on the same refusal.
  "failed-permanent",
  "setup-failure",
  "token-ceiling",
  "abandoned",
  // Plan 202 Task 5.4.3: the account's daily free-model cap reopened later. The attempt is kept as
  // evidence, does not consume the job's attempts, and the rerun continues from its checkpoints.
  "quota-daily",
];

export class CampaignBudgetBlocked extends Error {}
export class CampaignLocked extends Error {}
export class JournalInvalid extends Error {}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new JournalInvalid(`${label} must be a nonnegative integer`);
  return value;
}

export function campaignLockPath(journalPath) {
  return `${journalPath}.lock`;
}

export function stableHash(value) {
  const canonical = (input) => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, canonical(input[key])]),
      );
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function manifestFingerprint(manifest) {
  return stableHash({
    // Plan 202 Task 2: the pre-registered criteria hash is part of the campaign identity.
    criteria: manifest.criteriaHash ?? null,
    ...(manifest.resumeProtocolHash ? { resumeProtocol: manifest.resumeProtocolHash } : {}),
    ceiling: manifest.ceiling,
    provider: manifest.provider,
    model: manifest.model,
    jobs: manifest.jobs.map((job) => [
      job.id,
      job.suite,
      job.config,
      job.ability ?? null,
      job.subset ?? null,
      job.seed ?? null,
      job.maxInputTokens ?? null,
      job.ablate,
    ]),
  });
}

/** Charge of one attempt: verified usage reconciles, anything else keeps its reservation. */
export function attemptCharge(attempt) {
  count(attempt.reservedInputTokens, "reservedInputTokens");
  if (attempt.usageComplete === true && attempt.confirmedInputTokens !== undefined) {
    return count(attempt.confirmedInputTokens, "confirmedInputTokens");
  }
  return attempt.reservedInputTokens;
}

/** The legacy reservation rule kept for reports imported once from pre-journal evidence. */
export function reservation(report) {
  if (!Number.isSafeInteger(report.inputTokens) || report.inputTokens < 0) throw new Error("CampaignUsage");
  const max = Number.isSafeInteger(report.maxInputTokens) && report.maxInputTokens > 0 ? report.maxInputTokens : report.inputTokens;
  return report.usageComplete === false ? Math.max(max, report.inputTokens) : report.inputTokens;
}

export function journalSpend(journal) {
  let total = count(journal.priorReservation ?? 0, "priorReservation");
  for (const entry of journal.legacy) total += count(entry.charge, "legacy charge");
  for (const attempt of journal.attempts) total += attemptCharge(attempt);
  return total;
}

export function availableTokens(journal) {
  return journal.ceiling - journalSpend(journal);
}

export function attemptsForJob(journal, jobId) {
  return journal.attempts.filter((attempt) => attempt.jobId === jobId);
}

export function latestAttempt(journal, jobId) {
  const attempts = attemptsForJob(journal, jobId);
  return attempts.at(-1);
}

export function nextAttemptId(journal, jobId) {
  return `${jobId}@${attemptsForJob(journal, jobId).length + 1}`;
}

function assertAttempt(attempt) {
  if (!attempt || typeof attempt.attemptId !== "string" || !attempt.attemptId) throw new JournalInvalid("attemptId is required");
  if (!Number.isSafeInteger(attempt.maxInputTokens) || attempt.maxInputTokens < 1)
    throw new JournalInvalid("maxInputTokens must be a positive integer");
  count(attempt.reservedInputTokens, "reservedInputTokens");
}

/** Reserve worst-case spend (cap plus one-question overshoot) before a child starts. */
export function reserveAttempt(journal, { jobId, output, maxInputTokens, now = new Date().toISOString() }) {
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1) throw new JournalInvalid("maxInputTokens must be a positive integer");
  const reservedInputTokens = maxInputTokens + ARM_OVERSHOOT_TOKENS;
  const available = availableTokens(journal);
  if (reservedInputTokens > available)
    throw new CampaignBudgetBlocked(`campaign has ${available} tokens; ${reservedInputTokens} requested for ${jobId}`);
  const attempt = {
    attemptId: nextAttemptId(journal, jobId),
    jobId,
    manifestHash: journal.manifestHash,
    status: "reserved",
    output,
    maxInputTokens,
    reservedInputTokens,
    startedAt: now,
  };
  journal.attempts.push(attempt);
  journal.updatedAt = now;
  return attempt;
}

export function findAttempt(journal, attemptId) {
  const attempt = journal.attempts.find((item) => item.attemptId === attemptId);
  if (!attempt) throw new JournalInvalid(`unknown attempt: ${attemptId}`);
  return attempt;
}

/** Reconcile once; repeating identical values never changes the charge. */
export function reconcileAttempt(
  journal,
  attemptId,
  { status, inputTokens, usageComplete, cacheReadTokens, outputTokens, cause, now = new Date().toISOString() },
) {
  if (!TERMINAL_ATTEMPT_STATUSES.includes(status)) throw new JournalInvalid(`invalid terminal status: ${status}`);
  const attempt = findAttempt(journal, attemptId);
  attempt.status = status;
  if (inputTokens !== undefined) attempt.confirmedInputTokens = count(inputTokens, "inputTokens");
  attempt.usageComplete = usageComplete === true ? true : usageComplete === false ? false : undefined;
  if (cacheReadTokens !== undefined) attempt.cacheReadTokens = count(cacheReadTokens, "cacheReadTokens");
  if (outputTokens !== undefined) attempt.outputTokens = count(outputTokens, "outputTokens");
  if (cause !== undefined) attempt.cause = cause;
  attempt.endedAt = now;
  journal.updatedAt = now;
  return attempt;
}

/** A crashed child keeps its whole reservation until a human reconciles the attempt. */
export function abandonUnfinished(journal, now = new Date().toISOString()) {
  for (const attempt of journal.attempts) {
    if (attempt.status !== "reserved" && attempt.status !== "running") continue;
    reconcileAttempt(journal, attempt.attemptId, {
      status: "abandoned",
      inputTokens: attempt.reservedInputTokens,
      usageComplete: false,
      now,
    });
  }
  return journal;
}

export function validateJournal(journal) {
  if (!journal || journal.schemaVersion !== JOURNAL_SCHEMA_VERSION) throw new JournalInvalid("unsupported journal schema");
  count(journal.ceiling, "ceiling");
  count(journal.priorReservation ?? 0, "priorReservation");
  if (!Array.isArray(journal.legacy) || !Array.isArray(journal.attempts))
    throw new JournalInvalid("legacy and attempts arrays are required");
  for (const entry of journal.legacy) count(entry.charge, `legacy ${entry.file}`);
  const ids = new Set();
  for (const attempt of journal.attempts) {
    assertAttempt(attempt);
    if (ids.has(attempt.attemptId)) throw new JournalInvalid(`duplicate attempt: ${attempt.attemptId}`);
    ids.add(attempt.attemptId);
    if (!["reserved", "running", ...TERMINAL_ATTEMPT_STATUSES].includes(attempt.status))
      throw new JournalInvalid(`invalid attempt status: ${attempt.status}`);
  }
  if (journalSpend(journal) < 0) throw new JournalInvalid("negative spend");
  return journal;
}

/**
 * Saves to one path run one at a time, and each serializes the journal when its turn comes. Overlapping saves from
 * parallel arms could otherwise rename out of order, so an older snapshot (without a just-reserved attempt) landed
 * last and the child refused its own reservation (`unknown attempt`, plan 210 Task 5 smoke, 2026-11-08).
 */
const journalSaves = new Map();
export async function saveJournal(path, journal) {
  validateJournal(journal);
  const previous = journalSaves.get(path) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`);
      await rename(temp, path);
    });
  journalSaves.set(path, next);
  try {
    await next;
  } finally {
    if (journalSaves.get(path) === next) journalSaves.delete(path);
  }
}

export async function loadJournal(path) {
  return validateJournal(JSON.parse(await readFile(path, "utf8")));
}

/** Import pre-journal evidence exactly once, charging incomplete usage at its allocation. */
export async function importLegacyEvidence(directory) {
  const legacy = [];
  if (!directory || !existsSync(directory)) return legacy;
  for (const file of (await readdir(directory)).sort()) {
    if (!file.endsWith(".json") || file === "campaign-journal.json") continue;
    let report;
    const text = await readFile(`${directory}/${file}`, "utf8");
    try {
      report = JSON.parse(text);
    } catch {
      continue;
    }
    if (!report || !Number.isSafeInteger(report.inputTokens) || report.inputTokens < 0) continue;
    legacy.push({
      file,
      sha256: createHash("sha256").update(text).digest("hex"),
      charge: reservation(report),
      status: typeof report.status === "string" ? report.status : "unknown",
    });
  }
  return legacy;
}

export async function openJournal({ path, manifest, legacyDirectory, now = new Date().toISOString() }) {
  const manifestHash = manifestFingerprint(manifest);
  if (existsSync(path)) {
    const journal = await loadJournal(path);
    if (journal.manifestHash !== manifestHash)
      throw new JournalInvalid("journal manifest differs: start a new journal for a changed campaign");
    return journal;
  }
  const journal = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    campaignId: `campaign-${manifestHash.slice(0, 12)}`,
    manifestHash,
    ceiling: manifest.ceiling,
    priorReservation: manifest.priorReservation ?? 0,
    provider: manifest.provider,
    model: manifest.model,
    createdAt: now,
    updatedAt: now,
    status: "active",
    legacy: await importLegacyEvidence(legacyDirectory),
    attempts: [],
  };
  return validateJournal(journal);
}

/** One paid writer: a live campaign lock, not a broad process-name kill. */
export async function acquireCampaignLock(path, { pid = process.pid, now = new Date().toISOString() } = {}) {
  for (let tryIndex = 0; tryIndex < 2; tryIndex += 1) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${JSON.stringify({ pid, startedAt: now })}\n`);
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let holder;
      try {
        holder = JSON.parse(await readFile(path, "utf8"));
      } catch {
        holder = {};
      }
      if (Number.isSafeInteger(holder.pid) && holder.pid !== pid) {
        try {
          process.kill(holder.pid, 0);
          throw new CampaignLocked(`campaign already running as pid ${holder.pid}`);
        } catch (probe) {
          if (probe instanceof CampaignLocked) throw probe;
          // EPERM means the process exists but is not ours; only a missing pid is a stale lock.
          if (probe.code !== "ESRCH") throw new CampaignLocked(`campaign lock held by pid ${holder.pid}`);
        }
      }
      await unlink(path).catch(() => {});
    }
  }
  throw new CampaignLocked(`could not acquire campaign lock ${path}`);
}

export async function releaseCampaignLock(path) {
  await unlink(path).catch(() => {});
}

/** In-flight bounds share the hard reservation; retries must fit before they start. */
export function createAdmission({ reservedInputTokens, spent, bound = REQUEST_BOUND_TOKENS, now = () => Date.now(), staleMs = 660_000 }) {
  const live = [];
  const sweep = () => {
    const at = now();
    while (live.length && at - live[0].at > staleMs) live.shift();
  };
  const inflight = () => live.reduce((sum, entry) => sum + entry.bound, 0);
  return {
    bound,
    /** Returns the reservation token; pass it back to `release` so a call frees its own bound. */
    check(requestBound = bound) {
      sweep();
      const used = spent();
      const held = inflight();
      if (used + held + requestBound > reservedInputTokens)
        throw new CampaignBudgetBlocked(
          `reserved ${reservedInputTokens} tokens exhausted: used ${used}, in flight ${held}, next ${requestBound}`,
        );
      const entry = { bound: requestBound, at: now() };
      live.push(entry);
      return entry;
    },
    release(token) {
      sweep();
      if (!token) {
        live.shift();
        return;
      }
      const index = live.indexOf(token);
      if (index >= 0) live.splice(index, 1);
    },
  };
}

/**
 * A live child may only spend a reservation its journal already holds. Offline runs skip this.
 */
export async function requireAttemptReservation({ journalPath, attemptId, maxInputTokens }) {
  if (!journalPath || !attemptId) throw new JournalInvalid("live runs require PRISM_MEMORY_BENCH_JOURNAL and PRISM_MEMORY_BENCH_ATTEMPT");
  const journal = await loadJournal(journalPath);
  const attempt = findAttempt(journal, attemptId);
  if (attempt.status !== "reserved" && attempt.status !== "running")
    throw new JournalInvalid(`attempt ${attemptId} is ${attempt.status}, not reserved`);
  if (attempt.maxInputTokens < maxInputTokens)
    throw new JournalInvalid(`attempt ${attemptId} reserves ${attempt.maxInputTokens} tokens, ${maxInputTokens} requested`);
  const available = availableTokens(journal) + attemptCharge(attempt);
  if (available < maxInputTokens) throw new CampaignBudgetBlocked(`attempt ${attemptId} has no headroom`);
  return { journal, attempt };
}
