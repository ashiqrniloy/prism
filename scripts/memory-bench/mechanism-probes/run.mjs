/**
 * Plan 210 Task 2: run every mechanism probe offline and write `mechanisms.json`.
 *
 *   timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --out docs/_evidence/memory-bench/210/mechanisms.json
 *   bun scripts/memory-bench/mechanism-probes/run.mjs --group lifecycle        # one group, printed
 *   bun scripts/memory-bench/mechanism-probes/run.mjs --only lifecycle.verification
 *
 * Probes report hashes, counts and verdicts only. No model or network call is made.
 */
import "./deterministic-ids.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { probeRow, withProbeEnv, withTempRoot } from "./harness.mjs";

const root = resolve(import.meta.dir, "../../..");
export const GROUPS = ["lifecycle", "retrieval", "write", "scopes", "delivery", "kinds", "ontology", "om", "surface"];

export async function loadProbes(groups = GROUPS) {
  const all = [];
  for (const group of groups) {
    const module = await import(`./${group}.mjs`);
    for (const probe of module.probes) all.push({ ...probe, group });
  }
  return all;
}

/** Run probes one by one; a probe that throws is reported as a harness error, never as a verdict. */
export async function runProbes(probes, { log = () => {} } = {}) {
  const rows = [];
  const errors = [];
  for (const probe of probes) {
    const started = performance.now();
    try {
      const outcome = await withProbeEnv(() => withTempRoot((dir) => probe.run(dir)));
      const row = { ...probeRow(probe.id, outcome), group: probe.group, ms: Math.round(performance.now() - started) };
      rows.push(row);
      log(`${row.verdict.padEnd(12)} ${probe.id} fires=${row.fires} reaches=${row.reaches} correct=${row.correct}`);
    } catch (error) {
      errors.push({ id: probe.id, group: probe.group, error: String(error?.message ?? error).split("\n")[0].slice(0, 240) });
      log(`ERROR        ${probe.id}: ${String(error?.stack ?? error).split("\n").slice(0, 4).join(" | ")}`);
    }
  }
  return { rows, errors };
}

export async function ledgerRows() {
  const ledger = JSON.parse(await readFile(join(root, "docs/_evidence/memory-bench/210/feature-ledger.json"), "utf8"));
  return { candidates: ledger.features.filter((feature) => feature.candidate).map((feature) => feature.id), known: ledger.features.map((feature) => feature.id) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const value = (name) => {
    const index = argv.indexOf(name);
    return index < 0 ? undefined : argv[index + 1];
  };
  const groups = value("--group")?.split(",") ?? GROUPS;
  let probes = await loadProbes(groups);
  const only = value("--only")?.split(",");
  if (only) probes = probes.filter((probe) => only.includes(probe.id));
  const started = performance.now();
  const { rows, errors } = await runProbes(probes, { log: (line) => console.error(line) });
  const out = value("--out");
  if (out) {
    const { buildReport } = await import("./report.mjs");
    let replay;
    if (!argv.includes("--no-replay")) {
      const { runReplays } = await import("./replay.mjs");
      const maxSessions = value("--max-sessions");
      replay = await withProbeEnv(() => runReplays(maxSessions === undefined ? {} : { maxSessions: Number(maxSessions) }));
      for (const row of replay.replays) console.error(`replay      ${row.suite} turns=${row.turns} sessions=${row.sessionsReplayed}/${row.sessionsTotal}`);
    }
    const report = await buildReport({ rows, errors, ...(await ledgerRows()), replay });
    report.durationSeconds = Math.round((performance.now() - started) / 1000);
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
    console.error(`wrote ${out}: ${rows.length} probes, ${errors.length} errors`);
  }
  if (errors.length) process.exitCode = 1;
}
