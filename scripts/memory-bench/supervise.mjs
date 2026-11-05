#!/usr/bin/env bun
/**
 * Keep a plan 208 screen worker alive (plan 208 Task 5, 2026-11-04). Free gateways fail in bursts, and a campaign
 * process can halt (a setup failure, a daily cap) or crash outright. This loop re-runs `campaign.mjs` with the same
 * arguments and environment until the worker's journal says `finished`: after a daily cap it sleeps until the journal's
 * `resumeAfter`, after anything else it backs off. The campaign itself resumes every job from its journal and
 * checkpoints, so a restart never repeats a finished question.
 *
 *   bun scripts/memory-bench/supervise.mjs --plan 208 --partition dev
 *
 * The worker is named by the usual environment (`PRISM_MEMORY_BENCH_208_WORKER`, `..._WORKER_PROVIDER`).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { screen208WorkerPaths } from "./ontology-screen.mjs";

export const SUPERVISE_BACKOFF_MS = Object.freeze([60_000, 120_000, 300_000, 600_000, 900_000]);

/** What the supervisor does after one campaign exit, from the worker's journal. Pure, so it is testable. */
export function superviseDecision(journal, { restarts, maxRestarts, now = Date.now() }) {
  if (journal?.status === "finished") return { action: "stop", reason: "finished" };
  if (restarts >= maxRestarts) return { action: "stop", reason: "restart-limit" };
  if (journal?.status === "quota-daily" && journal.resumeAfter) {
    const at = Date.parse(journal.resumeAfter);
    if (Number.isFinite(at)) return { action: "wait", waitMs: Math.max(60_000, at - now + 120_000), reason: "quota-daily" };
  }
  return { action: "wait", waitMs: SUPERVISE_BACKOFF_MS[Math.min(restarts, SUPERVISE_BACKOFF_MS.length - 1)], reason: journal?.status ?? "no-journal" };
}

/** The journal the supervised campaign writes: a quick read keeps its own (plan 208 Task 5), so it must be read from there. */
export function superviseJournalPath(env = process.env) {
  const ids = env.PRISM_MEMORY_BENCH_208_WORKER;
  if (!ids) throw new Error("Supervise: set PRISM_MEMORY_BENCH_208_WORKER to the worker's job list");
  return screen208WorkerPaths(ids, env.PRISM_MEMORY_BENCH_208_WORKER_PROVIDER || undefined, { quick: env.PRISM_MEMORY_BENCH_208_QUICK === "1" }).journalPath;
}

async function main() {
  const journalPath = superviseJournalPath();
  const maxRestarts = Number(process.env.PRISM_MEMORY_BENCH_SUPERVISE_RESTARTS ?? 200);
  const args = process.argv.slice(2);
  let stopping = false;
  let child;
  const stop = () => {
    stopping = true;
    child?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (let restarts = 0; !stopping; restarts += 1) {
    console.log(`supervise: run ${restarts + 1} at ${new Date().toISOString()}`);
    child = Bun.spawn(["bun", "scripts/memory-bench/campaign.mjs", ...args], { stdout: "inherit", stderr: "inherit", env: process.env });
    const exit = await child.exited;
    if (stopping) break;
    const journal = existsSync(journalPath) ? JSON.parse(await readFile(journalPath, "utf8")) : null;
    const decision = superviseDecision(journal, { restarts, maxRestarts });
    console.log(`supervise: campaign exited ${exit}; journal ${journal?.status ?? "missing"}; ${decision.action} (${decision.reason})`);
    if (decision.action === "stop") break;
    console.log(`supervise: restarting in ${Math.round(decision.waitMs / 60_000)} min`);
    await new Promise((resolve) => setTimeout(resolve, decision.waitMs));
  }
}

if (import.meta.main) await main();
