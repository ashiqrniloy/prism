#!/usr/bin/env bun
/**
 * Plan 217 Task 6 (gate M-1): one live long-session job (one answer model, one arm, the `dev` partition), run as a
 * child of `campaign.mjs --plan memory-model --gate M-1`. It spends only the reservation its journal already holds
 * (`PRISM_MEMORY_BENCH_JOURNAL` / `PRISM_MEMORY_BENCH_ATTEMPT`), so it cannot be started outside an approved campaign.
 *
 * The `OM-before` job runs this file from the pinned pre-216 worktree (the campaign copies the family's harness files
 * there, the `acceptance.mjs` harness-copy pattern), so its imports are the ones both trees share: the kernel, the
 * journal, the bench's live providers and the family module. Usage is the wire proxy's; worker tokens (S4) and eligible
 * tokens are the family's own meter. The job resumes per persona-arm from its checkpoints; the report carries ids,
 * counts and hashes only.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { requireAttemptReservation, stableHash } from "../journal.mjs";
import { liveProviders, loadEnv, refOf } from "../run.mjs";
import { missingUsageCount } from "../usage.mjs";
import { LONG_SESSION_ARMS, longSessionFaults, runLongSession } from "./long-session.mjs";

export const LONG_SESSION_LIVE_KIND = "217-long-session-job";

/** The gates that run this child, with their plan and the families they may name. */
export const LONG_SESSION_LIVE_GATES = Object.freeze({
  "M-1": { plan: 217, families: ["long-session"] },
  // Plan 218 Task 6: the re-plan family (M1) and the long-session family's S1 re-measure, with repeats.
  "M-2": { plan: 218, families: ["long-session", "re-plan"] },
});
const LIVE_ARMS = new Set([...LONG_SESSION_ARMS, "WM", "STM-only"]);

export function parseLongSessionLiveArgs(argv) {
  const options = { partition: "dev", family: "long-session", gate: "M-1", repeat: 1 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--job") options.job = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--arm") options.arm = next();
    else if (arg === "--partition") options.partition = next();
    else if (arg === "--max-input-tokens") options.maxInputTokens = Number(next());
    else if (arg === "--output") options.output = next();
    else if (arg === "--state-dir") options.stateDir = next();
    else if (arg === "--personas") options.personaLimit = Number(next());
    else if (arg === "--family") options.family = next();
    else if (arg === "--gate") options.gate = next();
    else if (arg === "--repeat") options.repeat = Number(next());
    // Plan 218 Task 6: gate M-2 passes its manifest's output limit (8,192); gate M-1 ran at 4,096.
    else if (arg === "--max-output-tokens") options.maxOutputTokens = Number(next());
    // The campaign passes its previous attempt's report; this job resumes from its persona checkpoints instead.
    else if (arg === "--resume") next();
    else throw new Error(`MemoryBenchArguments: unknown flag ${arg}`);
  }
  for (const key of ["job", "model", "arm", "output", "stateDir"])
    if (!options[key]) throw new Error(`MemoryBenchArguments: --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  if (!LIVE_ARMS.has(options.arm)) throw new Error(`MemoryBenchArguments: unknown long-session arm ${options.arm}`);
  const gate = LONG_SESSION_LIVE_GATES[options.gate];
  if (!gate) throw new Error(`MemoryBenchArguments: unknown gate ${options.gate}`);
  if (!gate.families.includes(options.family))
    throw new Error(`MemoryBenchArguments: gate ${options.gate} runs no ${options.family} family`);
  if (!Number.isSafeInteger(options.repeat) || options.repeat < 1)
    throw new Error("MemoryBenchArguments: --repeat must be a positive integer");
  options.maxOutputTokens ??= 4096;
  if (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1)
    throw new Error("MemoryBenchArguments: --max-output-tokens must be a positive integer");
  // Gates M-1 and M-2 are development gates: the held-out partitions belong to gate A (plan 223).
  if (options.partition !== "dev")
    throw new Error(`MemoryBenchGate: gate ${options.gate} reads the dev partition only, not ${options.partition}`);
  if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1)
    throw new Error("MemoryBenchArguments: --max-input-tokens must be a positive integer");
  return options;
}

/** Persona-arm checkpoints keyed by the protocol (model, arm, partition, source label): a changed one never resumes. */
export function longSessionCheckpoint({ root, job, protocol }) {
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

export async function runLongSessionLiveJob(options) {
  const reserved = await requireAttemptReservation({
    journalPath: process.env.PRISM_MEMORY_BENCH_JOURNAL,
    attemptId: process.env.PRISM_MEMORY_BENCH_ATTEMPT,
    maxInputTokens: options.maxInputTokens,
  });
  if (resolve(reserved.attempt.output) !== resolve(options.output))
    throw new Error("LongSessionArguments: --output does not match the reserved attempt");
  loadEnv();
  const stateDir = resolve(options.stateDir);
  const wire = join(stateDir, "wire", reserved.attempt.attemptId.replace(/[^\w.+-]/g, "_"));
  await mkdir(wire, { recursive: true, mode: 0o700 });
  const usage = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, usageComplete: true, usageMissingExchanges: 0 };
  let answer;
  const account = async () => {
    const rows = await usageRows(answer?.proxies ?? []);
    usage.inputTokens = rows.reduce((n, row) => n + (row.inputTokens ?? 0), 0);
    usage.cacheReadTokens = rows.reduce((n, row) => n + (row.cacheReadTokens ?? 0), 0);
    usage.outputTokens = rows.reduce((n, row) => n + (row.outputTokens ?? 0), 0);
    usage.usageMissingExchanges = missingUsageCount(rows);
    usage.usageComplete = usage.usageMissingExchanges === 0;
    if (usage.inputTokens >= options.maxInputTokens) throw new Error("LongSessionTokenCeiling");
  };
  const sourceRevision = process.env.PRISM_MEMORY_BENCH_SOURCE ?? null;
  // Gate M-1's protocol is unchanged; a later gate's family and repeat are part of it, so repeats never share checkpoints.
  const protocol = stableHash({
    kind: LONG_SESSION_LIVE_KIND,
    model: options.model,
    arm: options.arm,
    partition: options.partition,
    sourceRevision,
    ...(options.gate === "M-1"
      ? {}
      : { gate: options.gate, family: options.family, repeat: options.repeat, maxOutputTokens: options.maxOutputTokens }),
  });
  const base = {
    kind: LONG_SESSION_LIVE_KIND,
    plan: LONG_SESSION_LIVE_GATES[options.gate].plan,
    task: 6,
    gate: options.gate,
    family: options.family,
    repeat: options.repeat,
    jobId: options.job,
    attemptId: reserved.attempt.attemptId,
    arm: options.arm,
    model: options.model,
    partition: options.partition,
    sourceRevision,
    protocol,
    maxInputTokens: options.maxInputTokens,
    usageSource: "wire-proxy",
  };
  const write = (body) => writeFile(options.output, `${JSON.stringify(body, null, 2)}\n`);
  try {
    answer = await liveProviders([refOf(options.model)], wire, { beforeAttempt: account, maxOutputTokens: options.maxOutputTokens });
    const report = await runLongSession({
      family: options.family,
      partition: options.partition,
      arms: [options.arm],
      offline: false,
      providers: answer.providers,
      model: answer.models.get(options.model),
      ...(options.personaLimit ? { personaLimit: options.personaLimit } : {}),
      checkpoint: longSessionCheckpoint({ root: join(stateDir, "checkpoints"), job: options.job, protocol }),
    });
    await account().catch((error) => {
      if (error.message !== "LongSessionTokenCeiling") throw error;
    });
    const faults = longSessionFaults(report.usage);
    const codes = [...new Set(faults.map((row) => row.code ?? row.status))].sort();
    await write({
      ...base,
      status: faults.length ? "failed" : "completed",
      ...(faults.length
        ? { failure: { name: "LongSessionFailures", message: `failed tasks in ${faults.length} persona-tasks: ${codes.join(", ")}` } }
        : {}),
      ...usage,
      report,
    });
    return faults.length ? 1 : 0;
  } catch (error) {
    const ceiling = /LongSessionTokenCeiling|CampaignBudgetBlocked/.test(`${error.name} ${error.message}`);
    await account().catch(() => {});
    await write({
      ...base,
      status: ceiling ? "token-ceiling" : "failed",
      ...usage,
      // Error names and messages only; they carry no persona text.
      failure: { name: error.name, message: String(error.message).slice(0, 500) },
    });
    return 1;
  } finally {
    for (const { proxy } of answer?.proxies ?? []) proxy.stop();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runLongSessionLiveJob(parseLongSessionLiveArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
