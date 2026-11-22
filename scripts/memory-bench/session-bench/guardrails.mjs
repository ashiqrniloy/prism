/**
 * Plan 218.3 Task 9: Session-Bench's guardrails against bias, checked before any paid call. A failure stops the run.
 *
 *   timeout 1800 bun scripts/memory-bench/session-bench/guardrails.mjs [--output guardrails.json]
 *
 * G1 frozen first, G2 author separation, G3 checks are correct, G4 dependencies are real, G5 no leakage, G6 equal
 * treatment, G7 blind scoring, G8 pre-registered analysis, G9 full cost, G10 third-party defaults. The report holds ids,
 * counts and hashes only.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runScripted } from "./agents.mjs";
import { armConfig, assertEqualTreatment, PRISM_ARMS, SESSION_BENCH_ARMS } from "./arms/prism.mjs";
import { THIRD_PARTY_ARM_SPECS } from "./arms/third-party.mjs";
import { initialObservableText } from "./env/workspace.mjs";
import { CORE_FILES, createSession, partitionIds, sessionBenchPartitions, sessionSizes, templateHash, WINDOW_TOKENS } from "./generate.mjs";
import { ANALYSIS, scoreRows } from "./score.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
/** A specifier that reaches the memory system (G2). */
const MEMORY_IMPORT = /(^|\/)packages\/memory\/|^@arnilo\/prism-memory/;
const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

/** Every import specifier of a source text. */
export function importSpecifiers(text) {
  return [...text.matchAll(IMPORT_RE)].map((match) => match[1] ?? match[2] ?? match[3]);
}

/**
 * G2: the core files and every relative module they reach import nothing from the memory system. Returns the files
 * walked; throws naming the file and the specifier.
 */
export function assertNoMemoryImports(files = CORE_FILES.map((file) => join(HERE, file)), read = (path) => readFileSync(path, "utf8")) {
  const seen = new Set();
  const walk = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const specifier of importSpecifiers(read(path))) {
      if (MEMORY_IMPORT.test(specifier)) throw new Error(`SessionBenchGuardrail G2: ${path.replace(`${REPO}/`, "")} imports ${specifier}`);
      if (specifier.startsWith(".") && /\.m?js$/.test(specifier)) walk(resolve(dirname(path), specifier));
    }
  };
  for (const file of files) walk(file);
  return [...seen].map((path) => path.replace(`${REPO}/`, ""));
}

const contains = (text, answer) =>
  new RegExp(`(^|[^A-Za-z0-9_.-])${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`).test(text);

/**
 * G5: no dependency's answer appears in the scope or the dependent task's prompt, and no user-only (`D2`) or
 * superseded (`D4`) answer appears in any file or tool output of the initial workspace, nor in any prompt but its own
 * sources'. Returns the leaks found (empty when clean).
 */
export function dependencyLeaks(session) {
  const leaks = [];
  const observable = initialObservableText(session.env);
  for (const dep of session.deps) {
    const where = [];
    if (contains(session.scope, dep.answer) || session.scope.includes(dep.evidence)) where.push("scope");
    const dependent = session.tasks[dep.dependent - 1].prompt;
    if (contains(dependent, dep.answer) || dependent.includes(dep.evidence)) where.push("dependent-prompt");
    if (dep.class === "D2" || dep.class === "D4") {
      if (contains(observable, dep.answer)) where.push("workspace");
      for (const task of session.tasks)
        if (!dep.sources.includes(task.n) && contains(task.prompt, dep.answer)) where.push(`prompt-${task.n}`);
    }
    if (where.length) leaks.push({ session: session.id, dep: dep.id, class: dep.class, where });
  }
  return leaks;
}

/** G3 and G4 over a set of sessions: the oracle passes every check; the amnesic agent fails every D2/D4 and passes every C. */
export function calibrationViolations(sessions) {
  const violations = [];
  for (const session of sessions) {
    for (const row of runScripted(session, "oracle").rows)
      if (!row.pass) violations.push({ guardrail: "G3", session: session.id, check: row.check, class: row.class });
    for (const row of runScripted(session, "amnesic").rows) {
      if ((row.class === "D2" || row.class === "D4") && row.pass)
        violations.push({ guardrail: "G4", session: session.id, check: row.check, class: row.class });
      if (row.class === "C" && !row.pass) violations.push({ guardrail: "G4", session: session.id, check: row.check, class: row.class });
    }
  }
  return violations;
}

const result = (id, pass, detail) => ({ id, pass, ...detail });

/**
 * Every pre-run guardrail. `probe` (default on) runs one dev session offline on one memory arm to prove the meter sees
 * the main agent and the workers (G9); tests pass `probe: false` to stay fast.
 */
export async function checkGuardrails({ partition = "dev", probe = true, thirdPartyArms = THIRD_PARTY_ARM_SPECS } = {}) {
  const rows = [];
  // G1: frozen first.
  let file;
  try {
    file = sessionBenchPartitions();
    const gate = readGateRecord();
    const pinned = gate?.sessionBench;
    const pinsMatch =
      !pinned ||
      (pinned.templateHash === file.templateHash && pinned.idsHash === file.idsHash && pinned.sessionsHash === file.sessionsHash);
    rows.push(
      result("G1", pinsMatch && file.templateHash === templateHash(), {
        version: file.version,
        templateHash: file.templateHash,
        idsHash: file.idsHash,
        gateRecord: pinned ? (pinsMatch ? "pinned" : "drifted") : "not yet pinned (plan 218.3 Task 11 pins it before the live run)",
      }),
    );
  } catch (error) {
    rows.push(result("G1", false, { error: error instanceof Error ? error.message : String(error) }));
    return { pass: false, guardrails: rows };
  }
  const ids = partitionIds(file, partition);
  const sessions = ids.map((id) => createSession(id));
  // G2: author separation.
  try {
    const walked = assertNoMemoryImports();
    rows.push(result("G2", partition === "dev", { files: walked.length, partition }));
  } catch (error) {
    rows.push(result("G2", false, { error: error instanceof Error ? error.message : String(error) }));
  }
  // G3 and G4: calibration.
  const violations = calibrationViolations(sessions);
  const checks = sessions.reduce((sum, session) => sum + session.tasks.reduce((n, task) => n + task.checks.length, 0), 0);
  rows.push(
    result("G3", !violations.some((row) => row.guardrail === "G3"), {
      sessions: sessions.length,
      checks,
      failed: violations.filter((row) => row.guardrail === "G3").length,
    }),
  );
  rows.push(
    result("G4", !violations.some((row) => row.guardrail === "G4"), {
      violations: violations.filter((row) => row.guardrail === "G4").length,
    }),
  );
  // G5: no leakage.
  const leaks = sessions.flatMap(dependencyLeaks);
  rows.push(
    result("G5", leaks.length === 0, {
      dependencies: sessions.reduce((sum, session) => sum + session.deps.length, 0),
      leaks: leaks.length,
    }),
  );
  // Sizes: sessions outgrow the window; dependencies span it.
  const sizes = sessions.map((session) => sessionSizes(session, WINDOW_TOKENS));
  rows.push(
    result("sizes", true, {
      window: WINDOW_TOKENS,
      minSessionWindows: Math.min(...sizes.map((size) => size.total)) / WINDOW_TOKENS,
      minSpanWindows: Math.min(...sizes.flatMap((size) => size.spans.map((span) => span.tokens))) / WINDOW_TOKENS,
    }),
  );
  // G6: equal treatment.
  try {
    const { sharedConfig } = await import("./run.mjs");
    const hash = assertEqualTreatment(SESSION_BENCH_ARMS.map((arm) => armConfig(arm, sharedConfig())));
    rows.push(result("G6", true, { arms: SESSION_BENCH_ARMS.length, sharedConfigHash: hash }));
  } catch (error) {
    rows.push(result("G6", false, { error: error instanceof Error ? error.message : String(error) }));
  }
  // G7: blind scoring.
  let blind = false;
  try {
    scoreRows({ checks: [{ session: "s", task: 1, check: "c", class: "C", pass: true, arm: "x" }] });
  } catch {
    blind = true;
  }
  rows.push(result("G7", blind, {}));
  // G8: pre-registered analysis covers every decision arm and every class.
  const compared = new Set(ANALYSIS.comparisons.flat());
  rows.push(
    result(
      "G8",
      PRISM_ARMS.every((arm) => compared.has(arm)) && ["task", "D1", "D2", "D3", "D4", "C"].every((m) => ANALYSIS.metrics.includes(m)),
      {
        analysis: ANALYSIS.version,
        iterations: ANALYSIS.iterations,
        seed: ANALYSIS.seed,
      },
    ),
  );
  // G9: full cost — every provider call of a memory arm is metered, main and workers apart.
  if (probe) {
    const { runArmSession, sessionBenchAgentMock, sessionBenchWorkerMock } = await import("./run.mjs");
    let calls = 0;
    const counted = (provider) => ({
      ...provider,
      async *generate(request) {
        calls++;
        yield* provider.generate(request);
      },
    });
    const run = await runArmSession({
      session: sessions[0],
      arm: "STM-only",
      providers: (state) => [counted(sessionBenchAgentMock(state)), counted(sessionBenchWorkerMock())],
      model: { provider: "mock", model: "main" },
      workerModel: "worker/session-bench",
    });
    const metered = run.meter.main.calls + run.meter.workers.calls;
    rows.push(
      result("G9", metered === calls && run.meter.workers.calls > 0 && run.meter.main.calls > 0, {
        providerCalls: calls,
        metered,
        workerCalls: run.meter.workers.calls,
      }),
    );
  } else rows.push(result("G9", true, { probe: "skipped" }));
  // G10: third-party arms (arms/third-party.mjs) run at their documented defaults on the same model, and each is an arm.
  const g10 = thirdPartyArms.filter((arm) => !arm.documentedDefaults || arm.model !== "same" || !SESSION_BENCH_ARMS.includes(arm.id));
  rows.push(
    result("G10", g10.length === 0, {
      thirdPartyArms: thirdPartyArms.map((arm) => arm.id),
      ...(g10.length ? { failing: g10.map((arm) => arm.id) } : {}),
    }),
  );
  return { pass: rows.every((row) => row.pass), partition, guardrails: rows };
}

/**
 * Plan 218.3 Task 11: the live guardrails, read from a live report. `oracle-context` passes at least `oracleTaskRateMin`
 * of tasks (the benchmark is solvable on this model); `amnesic` fails at least `amnesicFailRateMin[cls]` of each listed
 * class's checks (the dependencies are real). `complete` is false until both calibration arms ran every session.
 */
export function liveGuardrails(report, spec) {
  const oracle = report.scores?.["oracle-context"]?.overall;
  const amnesic = report.scores?.amnesic?.overall;
  const sessions = report.sessions?.length ?? 0;
  const ran = (arm) => Object.keys(report.scores?.[arm]?.sessions ?? {}).length;
  const complete = sessions > 0 && ran("oracle-context") === sessions && ran("amnesic") === sessions;
  const rows = [];
  rows.push({
    id: "oracle-solvable",
    taskRate: oracle?.taskRate ?? null,
    min: spec.oracleTaskRateMin,
    pass: typeof oracle?.taskRate === "number" && oracle.taskRate >= spec.oracleTaskRateMin,
  });
  for (const [cls, min] of Object.entries(spec.amnesicFailRateMin)) {
    const row = amnesic?.classes?.[cls];
    const failRate = row?.total ? 1 - row.pass / row.total : null;
    rows.push({ id: `amnesic-fails-${cls}`, failRate, min, pass: failRate !== null && failRate >= min });
  }
  return { complete, pass: complete && rows.every((row) => row.pass), rows };
}

function readGateRecord() {
  try {
    return JSON.parse(readFileSync(join(REPO, "docs/_evidence/memory-bench/218/gates/owner-gate-m2.json"), "utf8"));
  } catch {
    return null;
  }
}

if (import.meta.main && process.argv.includes("--live")) {
  // `guardrails.mjs --live [evidence.json]`: the live guardrails of the Task 11 evidence (default the committed file).
  const argv = process.argv.slice(2);
  const path = argv[argv.indexOf("--live") + 1] ?? join(REPO, "docs/_evidence/memory-bench/218/session-bench-test.json");
  const report = JSON.parse(readFileSync(path, "utf8"));
  const { SESSION_BENCH_TEST_RULE } = await import("./live.mjs");
  const result = liveGuardrails(report, SESSION_BENCH_TEST_RULE.liveGuardrails);
  for (const row of result.rows) console.log(`${row.pass ? "pass" : "FAIL"} ${row.id} ${JSON.stringify(row)}`);
  console.log(`complete ${result.complete}`);
  if (!result.pass) process.exit(1);
} else if (import.meta.main) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--output");
  const report = await checkGuardrails();
  if (at >= 0) await writeFile(argv[at + 1], `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report.guardrails) {
    const { id, pass, ...detail } = row;
    console.log(`${pass ? "pass" : "FAIL"} ${id} ${JSON.stringify(detail)}`);
  }
  if (!report.pass) {
    console.error("session-bench: a guardrail failed; no arm may run");
    process.exit(1);
  }
}
