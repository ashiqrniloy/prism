/**
 * Plan 210 Task 2: run every mechanism probe offline and write `mechanisms.json`.
 *
 *   timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --out docs/_evidence/memory-bench/210/mechanisms.json
 *   bun scripts/memory-bench/mechanism-probes/run.mjs --group lifecycle        # one group, printed
 *   bun scripts/memory-bench/mechanism-probes/run.mjs --only lifecycle.verification
 *   timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only stm --out docs/_evidence/memory-bench/217/stm-probes.json
 *   timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only wm --out docs/_evidence/memory-bench/218/wm-probes.json
 *
 * `--only` takes probe ids or group names. The `stm` group (plan 217 Task 5) and the `wm` group (plan 218 Task 5) probe
 * the memory model's short-term and working memory on the long-session fixture; they are not plan 210 ledger rows, so
 * they stay out of `GROUPS` and their `--out` report is their own (`memoryModelProbeReport`).
 *
 * Probes report hashes, counts and verdicts only. No model or network call is made.
 */
import "./deterministic-ids.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { probeRow, withProbeEnv, withTempRoot } from "./harness.mjs";

const root = resolve(import.meta.dir, "../../..");
export const GROUPS = ["lifecycle", "retrieval", "write", "scopes", "delivery", "kinds", "ontology", "om", "surface"];
/** Memory-model groups (plans 217–222): probed on demand, never part of the plan 210 ledger coverage. */
export const MEMORY_MODEL_GROUPS = ["stm", "wm"];
export const STM_PROBES_KIND = "217-task5-stm-probes";
export const WM_PROBES_KIND = "218-task5-wm-probes";
const MEMORY_MODEL_REPORTS = {
  stm: {
    kind: STM_PROBES_KIND,
    plan: "217",
    note: "Offline, deterministic STM mechanism probes on the long-session fixture: scripted main and STM models, real memory system. Counts, hashes and verdicts only.",
  },
  wm: {
    kind: WM_PROBES_KIND,
    plan: "218",
    note: "Offline, deterministic WM mechanism probes on the long-session fixture: scripted main, STM and WM models, real memory system. Counts, hashes and verdicts only.",
  },
};

/** A memory-model group's evidence (`stm` or `wm`): rows, errors and the fixture pins; counts, hashes and verdicts only. */
export async function memoryModelProbeReport({ rows, errors = [], group = "stm" }) {
  const { longSession } = await import("./stm.mjs");
  const fixture = longSession();
  const verdicts = {};
  for (const row of rows) verdicts[row.verdict] = (verdicts[row.verdict] ?? 0) + 1;
  const report = MEMORY_MODEL_REPORTS[group];
  if (!report) throw new Error(`MemoryBenchArguments: no memory-model probe report for ${group}`);
  return {
    schemaVersion: 1,
    kind: report.kind,
    plan: report.plan,
    task: "5",
    note: report.note,
    fixture: { sha256: fixture.hashes, messageEntries: fixture.messageEntries, tasks: fixture.tasks.length, events: fixture.events.length },
    summary: { probes: rows.length, verdicts, errors: errors.length },
    errors,
    probes: [...rows].sort((a, b) => a.id.localeCompare(b.id)).map(({ ms: _ms, ...row }) => row),
  };
}

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
      errors.push({
        id: probe.id,
        group: probe.group,
        error: String(error?.message ?? error)
          .split("\n")[0]
          .slice(0, 240),
      });
      log(
        `ERROR        ${probe.id}: ${String(error?.stack ?? error)
          .split("\n")
          .slice(0, 4)
          .join(" | ")}`,
      );
    }
  }
  return { rows, errors };
}

export async function ledgerRows() {
  const evidence = join(root, "docs/_evidence/memory-bench/210");
  const ledger = JSON.parse(await readFile(join(evidence, "feature-ledger.json"), "utf8"));
  // A transferred row its destination plan removed (`dispositions.json`, e.g. plan 216 Task 7) has no mechanism left to probe.
  const dispositions = JSON.parse(await readFile(join(evidence, "dispositions.json"), "utf8"));
  const removed = new Set(dispositions.rows.filter((row) => /^removed by /.test(row.disposition)).map((row) => row.feature));
  return {
    candidates: ledger.features.filter((feature) => feature.candidate && !removed.has(feature.id)).map((feature) => feature.id),
    known: ledger.features.map((feature) => feature.id),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const value = (name) => {
    const index = argv.indexOf(name);
    return index < 0 ? undefined : argv[index + 1];
  };
  const only = value("--only")?.split(",");
  // A memory-model group loads when `--only` names it or one of its probes (`stm` or `stm.outcome`).
  const named = MEMORY_MODEL_GROUPS.filter((group) => only?.some((item) => item === group || item.startsWith(`${group}.`)));
  const onlyMemoryModel = named.length > 0 && only.every((item) => named.some((group) => item === group || item.startsWith(`${group}.`)));
  const groups = value("--group")?.split(",") ?? (onlyMemoryModel ? named : [...GROUPS, ...named]);
  let probes = await loadProbes(groups);
  if (only) probes = probes.filter((probe) => only.includes(probe.id) || only.includes(probe.group));
  const memoryModelOnly = probes.length > 0 && probes.every((probe) => MEMORY_MODEL_GROUPS.includes(probe.group));
  const started = performance.now();
  const { rows, errors } = await runProbes(probes, { log: (line) => console.error(line) });
  const out = value("--out");
  const groupsRun = [...new Set(probes.map((probe) => probe.group))];
  if (out && memoryModelOnly && groupsRun.length !== 1)
    throw new Error("MemoryBenchArguments: --out writes one memory-model group at a time");
  if (out && memoryModelOnly) {
    const report = await memoryModelProbeReport({ rows, errors, group: groupsRun[0] });
    report.durationSeconds = Math.round((performance.now() - started) / 1000);
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
    console.error(`wrote ${out}: ${rows.length} probes, ${errors.length} errors`);
  } else if (out) {
    const { buildReport } = await import("./report.mjs");
    let replay;
    if (!argv.includes("--no-replay")) {
      const { runReplays } = await import("./replay.mjs");
      const maxSessions = value("--max-sessions");
      replay = await withProbeEnv(() => runReplays(maxSessions === undefined ? {} : { maxSessions: Number(maxSessions) }));
      for (const row of replay.replays)
        console.error(`replay      ${row.suite} turns=${row.turns} sessions=${row.sessionsReplayed}/${row.sessionsTotal}`);
    }
    const report = await buildReport({ rows, errors, ...(await ledgerRows()), replay });
    report.durationSeconds = Math.round((performance.now() - started) / 1000);
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
    console.error(`wrote ${out}: ${rows.length} probes, ${errors.length} errors`);
  }
  if (errors.length) process.exitCode = 1;
}
