#!/usr/bin/env bun
/**
 * Plan 209 Task 6: one live work-outcome job (one answer model, one arm, the `dev` partition), run as a child of
 * `campaign.mjs --plan 209`. It spends only the reservation its journal already holds
 * (`PRISM_MEMORY_BENCH_JOURNAL` / `PRISM_MEMORY_BENCH_ATTEMPT`), so it cannot be started outside an approved campaign.
 *
 * Usage is the wire proxy's (answer and simulator routes; the claim panel accounts its own), the job resumes per
 * persona-arm from `.cache/memory-bench/209/checkpoints/`, and the report it writes carries ids, counts and scores
 * only. Keys stay refs: the providers read them from the live env file and the proxy strips them from every log.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { requireAttemptReservation, stableHash } from "../journal.mjs";
import { openClaimJudges } from "../ontology-audit.mjs";
import { liveProviders, loadEnv, refOf } from "../run.mjs";
import { missingUsageCount } from "../usage.mjs";
import { workOutcomeManifestPin } from "./metrics.mjs";
import { runWorkOutcome, SCORED_SESSION_FAILURES as SCORED_FAILURES } from "./run.mjs";
import { assertScreen209Partition, SCREEN209_CHECKPOINTS, SCREEN209_WIRE } from "./screen.mjs";

export function parseLiveArgs(argv) {
  const options = { partition: "dev", concurrency: 2, answerFreeOnly: false, judgeCalls: 400 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--job") options.job = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--arm") options.arm = next();
    else if (arg === "--simulator") options.simulator = next();
    else if (arg === "--judges") options.judges = next().split(",");
    else if (arg === "--partition") options.partition = next();
    else if (arg === "--max-input-tokens") options.maxInputTokens = Number(next());
    else if (arg === "--concurrency") options.concurrency = Number(next());
    else if (arg === "--judge-calls") options.judgeCalls = Number(next());
    else if (arg === "--output") options.output = next();
    else if (arg === "--free-only") options.answerFreeOnly = true;
    else if (arg === "--simulator-paid") options.simulatorPaid = true;
    else if (arg === "--personas") options.personaLimit = Number(next());
    // The campaign passes its previous attempt's report; this job resumes from its persona checkpoints instead.
    else if (arg === "--resume") next();
    else throw new Error(`MemoryBenchArguments: unknown flag ${arg}`);
  }
  for (const key of ["job", "model", "arm", "simulator", "judges", "output"])
    if (!options[key]) throw new Error(`MemoryBenchArguments: --${key} is required`);
  if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1)
    throw new Error("MemoryBenchArguments: --max-input-tokens must be a positive integer");
  assertScreen209Partition(options.partition);
  return options;
}

async function usageRows(proxies) {
  const rows = [];
  for (const { proxy, usageLog } of proxies) {
    await proxy.drain();
    try {
      rows.push(
        ...(await readFile(usageLog, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return rows;
}

/** Persona-arm checkpoints, keyed by the protocol (criteria pin, model, simulator, arm): a changed protocol never resumes. */
export function personaCheckpoint({ job, protocol, root = SCREEN209_CHECKPOINTS }) {
  const dir = join(root, job.replace(/[^\w.+-]/g, "_"), protocol.slice(0, 16));
  const path = (key) => join(dir, `${stableHash(key).slice(0, 24)}.json`);
  return {
    dir,
    async load(key) {
      try {
        return JSON.parse(await readFile(path(key), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async save(key, value) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path(key), JSON.stringify(value));
    },
  };
}

export async function runLiveJob(options) {
  const reserved = await requireAttemptReservation({
    journalPath: process.env.PRISM_MEMORY_BENCH_JOURNAL,
    attemptId: process.env.PRISM_MEMORY_BENCH_ATTEMPT,
    maxInputTokens: options.maxInputTokens,
  });
  if (resolve(reserved.attempt.output) !== resolve(options.output))
    throw new Error("WorkOutcomeArguments: --output does not match the reserved attempt");
  loadEnv();
  const wire = join(SCREEN209_WIRE, reserved.attempt.attemptId.replace(/[^\w.+-]/g, "_"));
  await mkdir(join(wire, "answer"), { recursive: true, mode: 0o700 });
  await mkdir(join(wire, "simulator"), { recursive: true, mode: 0o700 });
  const usage = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, usageComplete: true, usageMissingExchanges: 0, byRoute: {} };
  let answer, simulator, panel;
  const sum = (rows) => ({
    inputTokens: rows.reduce((n, row) => n + (row.inputTokens ?? 0), 0),
    cacheReadTokens: rows.reduce((n, row) => n + (row.cacheReadTokens ?? 0), 0),
    outputTokens: rows.reduce((n, row) => n + (row.outputTokens ?? 0), 0),
    exchanges: rows.length,
    usageMissingExchanges: missingUsageCount(rows),
  });
  const account = async () => {
    // Per route, so the paid answer model's USD is read from its own rows, never the free simulator's.
    const answerRows = await usageRows(answer?.proxies ?? []);
    const simulatorRows = await usageRows(simulator?.proxies ?? []);
    usage.byRoute = { answer: sum(answerRows), simulator: sum(simulatorRows) };
    const all = sum([...answerRows, ...simulatorRows]);
    usage.inputTokens = all.inputTokens;
    usage.cacheReadTokens = all.cacheReadTokens;
    usage.outputTokens = all.outputTokens;
    usage.usageMissingExchanges = all.usageMissingExchanges;
    usage.usageComplete = all.usageMissingExchanges === 0;
    if (usage.inputTokens >= options.maxInputTokens) throw new Error("WorkOutcomeTokenCeiling");
  };
  const base = {
    kind: "209-work-outcome-job",
    plan: 209,
    task: 6,
    jobId: options.job,
    attemptId: reserved.attempt.attemptId,
    arm: options.arm,
    partition: options.partition,
    maxInputTokens: options.maxInputTokens,
    usageSource: "wire-proxy",
  };
  const write = (body) => writeFile(options.output, `${JSON.stringify(body, null, 2)}\n`);
  try {
    answer = await liveProviders([refOf(options.model)], join(wire, "answer"), {
      freeOnly: options.answerFreeOnly,
      beforeAttempt: account,
      maxOutputTokens: 4096,
    });
    // 4096, the evals simulator's own output bound: a reasoning model thinks first, and a 1024 cap left it no room for
    // the reply (plan 209 Task 6: every failed simulator turn stopped on max_output_tokens with empty text).
    simulator = await liveProviders([refOf(options.simulator)], join(wire, "simulator"), {
      // Free-only unless the gate names a paid simulator (amendment 3: Muse).
      freeOnly: options.simulatorPaid !== true,
      beforeAttempt: account,
      maxOutputTokens: 4096,
    });
    panel = await openClaimJudges({ refs: options.judges, calls: options.judgeCalls, root: join(wire, "judges"), freeOnly: true });
    const protocol = stableHash({ pin: workOutcomeManifestPin(), model: options.model, simulator: options.simulator, arm: options.arm });
    const report = await runWorkOutcome({
      offline: false,
      partition: options.partition,
      arms: [options.arm],
      providers: answer.providers,
      model: answer.models.get(options.model),
      simulatorProviders: simulator.providers,
      simulatorModel: simulator.models.get(options.simulator),
      judges: panel.judges,
      concurrency: options.concurrency,
      ...(options.personaLimit ? { personaLimit: options.personaLimit } : {}),
      checkpoint: personaCheckpoint({ job: options.job, protocol }),
    });
    await account().catch((error) => {
      if (error.message !== "WorkOutcomeTokenCeiling") throw error;
    });
    // A failed session is a provider or harness fault, never a score: the job fails and the campaign re-runs it from
    // the persona checkpoints (failed persona-arms are not checkpointed). Codes only.
    // The agent exhausting its own run limits is a scored outcome (W6 0), not a fault; everything else is a fault.
    const faults = Object.values(report.rows)
      .flat()
      .filter((row) => row.failureCode && !SCORED_FAILURES.has(row.failureCode));
    const failed = report.personas.filter((persona) => faults.some((row) => row.cluster === persona.id));
    const codes = [...new Set(faults.map((row) => row.failureCode))].sort();
    await write({
      ...base,
      protocol,
      status: failed.length ? "failed" : "completed",
      ...(failed.length
        ? {
            failure: {
              name: "WorkOutcomeSessionFailures",
              message: `failed sessions in ${failed.length} persona-arms: ${codes.join(", ")}`,
            },
          }
        : {}),
      ...usage,
      judgeUsage: panel.usage(),
      report,
    });
    return failed.length ? 1 : 0;
  } catch (error) {
    const ceiling = /WorkOutcomeTokenCeiling|CampaignBudgetBlocked/.test(`${error.name} ${error.message}`);
    await account().catch(() => {});
    await write({
      ...base,
      status: ceiling ? "token-ceiling" : "failed",
      ...usage,
      judgeUsage: panel?.usage() ?? null,
      // Error names and messages only; they carry no persona text.
      failure: {
        name: error.name,
        message: String(error.message).slice(0, 500),
        cause: error.cause ? { message: String(error.cause.message ?? error.cause).slice(0, 500) } : undefined,
      },
    });
    return 1;
  } finally {
    for (const { proxy } of [...(answer?.proxies ?? []), ...(simulator?.proxies ?? [])]) proxy.stop();
    await panel?.close();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runLiveJob(parseLiveArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
