#!/usr/bin/env bun
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { historicalVariants } from "./ablations.mjs";
import {
  ACCEPTANCE_EVIDENCE,
  ACCEPTANCE_JOURNAL,
  ACCEPTANCE_MANIFEST,
  ACCEPTANCE_SUMMARY,
  assertAcceptanceManifest,
  buildAcceptanceManifest,
} from "./acceptance.mjs";
import {
  abandonUnfinished,
  acquireCampaignLock,
  attemptCharge,
  availableTokens,
  campaignLockPath,
  latestAttempt,
  MAX_ATTEMPTS_PER_JOB,
  openJournal,
  reconcileAttempt,
  releaseCampaignLock,
  reserveAttempt,
  saveJournal,
} from "./journal.mjs";
import subsets from "./subsets.json" with { type: "json" };
import { variantProvenance } from "./variants.mjs";

const evidence = "docs/_evidence/memory-bench/task6";
const logs = ".cache/memory-bench/task6-resume";
const ACCEPTANCE_LOGS = ".cache/memory-bench/188.7";
export const JOURNAL_PATH = `${evidence}/campaign-journal.json`;
export const TOKEN_CEILING = 90_000_000;
// Reserve the entire failed first full-context allocation: its wire usage was incomplete.
export const PRIOR_RESERVATION = 10_358_372;
export function campaignJobs() {
  const jobs = [];
  const add = (family, suite, config, ablate = [], ability) => {
    const id = [family, suite, config, ability, ...ablate]
      .filter(Boolean)
      .join("-")
      .replace(/[^\w.=-]/g, "_");
    jobs.push({ id, family, suite, config, ablate, ...(ability ? { ability, subset: "targeted" } : {}) });
  };
  // LoCoMo is comparison-only: one full-context arm is enough to report a comparison.
  for (const config of ["full", "fabric", "fabric-agentic", "om", "om+fabric"])
    for (const suite of ["longmemeval-s", "locomo", "memoryagentbench-cr", "lifecycle"])
      if (suite !== "locomo" || config === "full") add("rerun", suite, config);
  for (const ability of Object.keys(subsets.longmemeval.targeted)) {
    for (const config of ["fabric", "fabric-agentic"]) add("retrieval", "longmemeval-s", config, [], ability);
    for (const spec of ["fabric.stem=off", "fabric.keyWeight=off", "fabric.multiQuery=off"])
      add("retrieval", "longmemeval-s", "fabric-agentic", [spec], ability);
    for (const budget of [600, 1200, 2400])
      add("retrieval", "longmemeval-s", "fabric-agentic", [`fabric.snippetBudget=${budget}`], ability);
  }
  for (const spec of ["om.dates=off", "om.replaceOnReflect=off", "om.taskState=off"]) add("om", "longmemeval-s", "om", [spec]);
  for (const budget of [5000, 10000, 20000])
    add("om", "longmemeval-s", "om", [`om.reflector.observationTokens=${budget}`, `om.dropper.targetTokens=${budget}`]);
  for (const specs of [
    ["fabric.inject=off"],
    ["fabric.inject.query=user"],
    ["fabric.inject=off", "fabric.directory=off"],
    ["fabric.inject=off", "fabric.directory={}"],
    ["fabric.crossSourceDedup=off"],
    ["fabric.consolidate.decider=model"],
  ])
    add("fabric", "memoryagentbench-cr", "fabric", specs);
  for (const specs of [
    ["fabric.promote=off"],
    ["lifecycle.clock=calendar"],
    ["lifecycle.decayMode=exponential"],
    ["lifecycle.capacity=off"],
    ["lifecycle.merge=off"],
    ["fabric.cues=off"],
    ["fabric.core=off"],
    ...["explicit", "correction", "outcome", "recurrence", "generality", "ephemerality", "derivability"].map((signal) => [
      `promote.signal.${signal}=off`,
    ]),
  ])
    add("lifecycle", "lifecycle", "om+fabric", specs);
  for (const notes of [2, 5, 10, 20, 50, 100, 200, 500])
    add(
      "capacity",
      "lifecycle",
      "om+fabric",
      ["user", "agent", "project"].map((scope) => `fabric.lifecycle.capacity.${scope}.notes=${notes}`),
    );
  return jobs;
}
export { reservation } from "./journal.mjs";

export function buildManifest() {
  return {
    ceiling: TOKEN_CEILING,
    priorReservation: PRIOR_RESERVATION,
    provider: "opencode-go",
    model: "mimo-v2.5",
    results: [],
    jobs: campaignJobs(),
    unavailable: [{ arm: "fabric-hybrid", reason: "No live embeddings model configured; hash embeddings are not a substitute." }],
    limitations: [
      "OM 5k/10k dropper arms jointly lower the reflector to satisfy the shipped invariant; these are coupled arms.",
      "LoCoMo is comparison-only; only the full-context arm is measured.",
    ],
  };
}

/** Dry run: write the manifest only. It never creates, rewrites or spends from the journal. */
export async function writeManifest(path = `${evidence}/campaign-v2.json`) {
  await mkdir(evidence, { recursive: true });
  const manifest = buildManifest();
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Frozen owner-approved 106M acceptance manifest; dry-run only on --manifest. */
export async function writeAcceptanceManifest(path = ACCEPTANCE_MANIFEST) {
  await mkdir(ACCEPTANCE_EVIDENCE, { recursive: true });
  const manifest = assertAcceptanceManifest(buildAcceptanceManifest());
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function maxInputFor(job, available) {
  const suiteCap =
    job.maxInputTokens ?? (job.suite === "lifecycle" ? 2_000_000 : job.suite === "longmemeval-s" && !job.ability ? 10_000_000 : 5_000_000);
  return Math.floor(Math.min(available, suiteCap));
}

async function runCampaign(mode = "task6") {
  const acceptance = mode === "acceptance";
  const runEvidence = acceptance ? ACCEPTANCE_EVIDENCE : evidence;
  const runLogs = acceptance ? ACCEPTANCE_LOGS : logs;
  await mkdir(runLogs, { recursive: true });
  await mkdir(runEvidence, { recursive: true });
  const manifest = acceptance ? assertAcceptanceManifest(buildAcceptanceManifest()) : buildManifest();
  manifest.results ??= [];
  if (acceptance) await writeAcceptanceManifest();
  else await writeManifest();
  const journalPath = process.env.PRISM_MEMORY_BENCH_JOURNAL ?? (acceptance ? ACCEPTANCE_JOURNAL : JOURNAL_PATH);
  const lockPath = campaignLockPath(journalPath);
  await acquireCampaignLock(lockPath);
  const children = new Set();
  const stopChildren = () => {
    for (const child of children) {
      try {
        child.kill();
      } catch {
        // The owned child already exited.
      }
    }
    children.clear();
  };
  const onSignal = () => {
    stopChildren();
    void releaseCampaignLock(lockPath).finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const journal = await openJournal({
      path: journalPath,
      manifest,
      legacyDirectory: acceptance ? undefined : evidence,
    });
    abandonUnfinished(journal);
    await saveJournal(journalPath, journal);
    for (const job of manifest.jobs) {
      const latest = latestAttempt(journal, job.id);
      if (latest && latest.status === "completed") {
        manifest.results.push({
          id: job.id,
          attemptId: latest.attemptId,
          status: "completed",
          usageComplete: latest.usageComplete !== false,
          reused: true,
          charged: attemptCharge(latest),
        });
        continue;
      }
      if (acceptance && latest?.status === "token-ceiling") {
        manifest.results.push({ id: job.id, attemptId: latest.attemptId, status: "token-ceiling", reused: true });
        continue;
      }
      if (journal.attempts.filter((attempt) => attempt.jobId === job.id).length >= (acceptance ? 3 : MAX_ATTEMPTS_PER_JOB)) {
        manifest.results.push({ id: job.id, status: "attempts-exhausted" });
        continue;
      }
      const available = availableTokens(journal);
      const maxInput = maxInputFor(job, available);
      if (maxInput < 100_000) {
        journal.status = "token-ceiling";
        break;
      }
      const previous = latest;
      const attempt = reserveAttempt(journal, {
        jobId: job.id,
        output: `${runEvidence}/${acceptance ? "final" : "v2"}-${job.id}${journal.attempts.filter((item) => item.jobId === job.id).length > 1 ? `-${journal.attempts.filter((item) => item.jobId === job.id).length}` : ""}.json`,
        maxInputTokens: maxInput,
      });
      await saveJournal(journalPath, journal);
      const variants = historicalVariants(job.ablate ?? []);
      await variantProvenance(variants);
      const argv = [
        "timeout",
        acceptance ? "10800s" : "7200s",
        "bun",
        "--preload",
        "./scripts/memory-bench/variants.mjs",
        "scripts/memory-bench/run.mjs",
        "--suite",
        job.suite,
        "--config",
        job.config,
        "--provider",
        "opencode-go",
        "--model",
        "mimo-v2.5",
        "--judge",
        "opencode-go/mimo-v2.5",
        "--max-input-tokens",
        String(maxInput),
        "--output",
        attempt.output,
      ];
      if (job.subset) argv.push("--subset", job.subset);
      if (job.ability) argv.push("--ability", job.ability);
      if (job.seed) argv.push("--seed", String(job.seed));
      for (const spec of job.ablate ?? []) argv.push("--ablate", spec);
      // Continue only a same-protocol checkpoint; the child validates the hash and refuses mismatches.
      if (previous?.output && existsSync(previous.output)) argv.push("--resume", previous.output);
      const log = openSync(`${runLogs}/${attempt.attemptId.replace(/[^\w.-]/g, "_")}.log`, "w");
      const child = Bun.spawn(argv, {
        env: {
          ...process.env,
          PRISM_MEMORY_BENCH_VARIANTS: JSON.stringify(variants),
          PRISM_MEMORY_BENCH_PYTHON: process.env.PRISM_MEMORY_BENCH_PYTHON ?? ".cache/memory-bench/python/bin/python3",
          PRISM_MEMORY_BENCH_JOURNAL: journalPath,
          PRISM_MEMORY_BENCH_ATTEMPT: attempt.attemptId,
        },
        stdout: log,
        stderr: log,
      });
      children.add(child);
      console.log(`start ${attempt.attemptId}; cap=${maxInput}; remaining=${availableTokens(journal)}`);
      const exit = await child.exited;
      children.delete(child);
      closeSync(log);
      if (existsSync(attempt.output)) {
        const report = JSON.parse(await readFile(attempt.output, "utf8"));
        reconcileAttempt(journal, attempt.attemptId, {
          status: report.status === "completed" ? "completed" : report.status === "token-ceiling" ? "token-ceiling" : "failed",
          inputTokens: report.inputTokens,
          usageComplete: report.usageComplete !== false,
          cacheReadTokens: report.cacheReadTokens,
          outputTokens: report.outputTokens,
        });
        manifest.results.push({
          id: job.id,
          attemptId: attempt.attemptId,
          status: report.status,
          usageComplete: report.usageComplete !== false,
          charged: attemptCharge(journal.attempts.at(-1)),
        });
      } else {
        // Reserve, do not refund: a child can spend before it writes any report.
        reconcileAttempt(journal, attempt.attemptId, {
          status: "setup-failure",
          inputTokens: attempt.reservedInputTokens,
          usageComplete: false,
        });
        manifest.results.push({ id: job.id, attemptId: attempt.attemptId, status: "setup-failure", exit });
        console.error(`failed ${attempt.attemptId}; no report (exit ${exit}); reserved ${attempt.reservedInputTokens}`);
      }
      console.log(`end ${attempt.attemptId}; charged=${attemptCharge(journal.attempts.at(-1))}; remaining=${availableTokens(journal)}`);
      await saveJournal(journalPath, journal);
    }
    if (journal.status === "active") journal.status = "finished";
    await saveJournal(journalPath, journal);
    if (acceptance) {
      const summary = {
        kind: "188.7-final-acceptance-run",
        journal: {
          campaignId: journal.campaignId,
          status: journal.status,
          ceiling: journal.ceiling,
          spend: journal.attempts.reduce((sum, attempt) => sum + attemptCharge(attempt), 0),
          attempts: journal.attempts.map(({ attemptId, jobId, status, usageComplete, reservedInputTokens, confirmedInputTokens }) => ({
            attemptId,
            jobId,
            status,
            usageComplete: usageComplete !== false,
            reservedInputTokens,
            confirmedInputTokens: confirmedInputTokens ?? null,
          })),
        },
        results: manifest.results,
      };
      await writeFile(ACCEPTANCE_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
    }
  } finally {
    stopChildren();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await releaseCampaignLock(lockPath);
  }
}

if (import.meta.main) {
  const acceptance = process.argv.includes("--acceptance");
  if (process.argv.includes("--manifest")) {
    if (acceptance) await writeAcceptanceManifest();
    else await writeManifest();
    process.exit(0);
  }
  try {
    await runCampaign(acceptance ? "acceptance" : "task6");
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
