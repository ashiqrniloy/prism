/**
 * Plan 218.5 Task 5: the long bench's guardrails against bias, checked before any paid call. A failure stops the run.
 *
 *   timeout 1800 bun scripts/memory-bench/session-bench-long/guardrails.mjs [--jobs 6] [--output guardrails.json]
 *   timeout 60   bun scripts/memory-bench/session-bench-long/guardrails.mjs --live <report.json>
 *
 * G1–G10 are Session-Bench v3's (`../session-bench/guardrails.mjs`, imported and never edited), applied to the long
 * bench's own files, pins, arms and helpers. G11 is new: in the offline run the scripted STM worker, recording at plan
 * 218.5 Task 2's measured rates, overflows the pool before the first `after` dependent on every dev session.
 *
 * G8 reads plan 218.5 Task 6's pre-registered analysis (`score.mjs` `ANALYSIS_LONG`). Without `score.mjs`, G8 would be
 * reported `pending`; `live.mjs --live` refuses a report with anything pending.
 *
 * The report holds ids, counts and hashes only.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { THIRD_PARTY_ARM_SPECS } from "../session-bench/arms/third-party.mjs";
import { assertNoMemoryImports } from "../session-bench/guardrails.mjs";
import { scoreRows } from "../session-bench/score.mjs";
import { runScripted } from "./agents.mjs";
import { assertLongEqualTreatment, LONG_ARMS, LONG_DECISION_ARMS, longArmConfig } from "./arms.mjs";
import { DEPENDENCY_CLASSES, LONG_CHECK_CLASSES, REVOKE_CLASS } from "./checks.mjs";
import {
  CORE_FILES,
  createSession,
  dependencyLeaks,
  partitionIds,
  sessionBenchLongPartitions,
  sessionSizes,
  templateHash,
  WINDOW_TOKENS,
} from "./generate.mjs";
import { firstAfterTask } from "./instrument.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
export const LONG_GATE_FILE = join(REPO, "docs/_evidence/memory-bench/218.5/gates/owner-gate-long.json");
/** The classes the amnesic agent must fail on every check (G4) and, live, on at least `amnesicFailRateMin` of them. */
export const AMNESIC_FAIL_CLASSES = Object.freeze(["D2", "D4", REVOKE_CLASS]);
/**
 * The live guardrails (plan 218.5 Tasks 5 and 7): `oracle-notes` passes at least 60% of tasks; `amnesic` fails at least
 * 70% of each of `D2`, `D4` and `D2R`; STM-only's recorded pool overflows before the first `after` dependent in at
 * least 2 of the 3 pilot sessions; no row overflows W.
 */
export const LIVE_GUARDRAILS = Object.freeze({
  oracleTaskRateMin: 0.6,
  amnesicFailRateMin: Object.freeze({ D2: 0.7, D4: 0.7, [REVOKE_CLASS]: 0.7 }),
  pressureArm: "STM-only",
  pressureSessionsMin: 2,
  maxOverflows: 0,
});

/**
 * G11 over a set of sessions and their offline summaries (`instrument.mjs` `sessionPressureSummary`, by session id):
 * a session passes when its pool overflowed before its first `after` dependent. A session with no overflow (too short,
 * too sparse) or a late one is a violation.
 */
export function pressureViolations(sessions, summaries) {
  const violations = [];
  for (const session of sessions) {
    const firstAfter = firstAfterTask(session);
    const overflow = summaries[session.id]?.firstOverflowTask ?? null;
    if (overflow === null || overflow >= firstAfter) violations.push({ guardrail: "G11", session: session.id, firstAfter, overflow });
  }
  return violations;
}

/** G3 and G4: the oracle passes every check; the amnesic agent fails every `D2`, `D4` and `D2R` and passes every `C`. */
export function calibrationViolations(sessions) {
  const violations = [];
  for (const session of sessions) {
    for (const row of runScripted(session, "oracle").rows)
      if (!row.pass) violations.push({ guardrail: "G3", session: session.id, check: row.check, class: row.class });
    for (const row of runScripted(session, "amnesic").rows) {
      if (AMNESIC_FAIL_CLASSES.includes(row.class) && row.pass)
        violations.push({ guardrail: "G4", session: session.id, check: row.check, class: row.class });
      if (row.class === "C" && !row.pass) violations.push({ guardrail: "G4", session: session.id, check: row.check, class: row.class });
    }
  }
  return violations;
}

const result = (id, pass, detail) => ({ id, pass, ...detail });
const readGate = () => {
  try {
    return JSON.parse(readFileSync(LONG_GATE_FILE, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Every pre-run guardrail. `probe` (G9) runs one dev session's first tasks offline on STM-only; `pressure` (G11) runs
 * STM-only offline on every dev session up to its first `after` dependent. Tests turn either off to stay fast.
 */
export async function checkLongGuardrails({ probe = true, pressure = true, jobs = 1, thirdPartyArms = THIRD_PARTY_ARM_SPECS } = {}) {
  const rows = [];
  // G1: frozen first.
  let file;
  try {
    file = sessionBenchLongPartitions();
    const pinned = readGate()?.sessionBenchLong?.benchmark;
    const pinsMatch =
      !pinned ||
      (pinned.templateHash === file.templateHash && pinned.idsHash === file.idsHash && pinned.sessionsHash === file.sessionsHash);
    rows.push(
      result("G1", pinsMatch && file.templateHash === templateHash(), {
        version: file.version,
        templateHash: file.templateHash,
        idsHash: file.idsHash,
        gateRecord: pinned ? (pinsMatch ? "pinned" : "drifted") : "not yet pinned (plan 218.5 Task 6 pins it before the pilot)",
      }),
    );
  } catch (error) {
    rows.push(result("G1", false, { error: error instanceof Error ? error.message : String(error) }));
    return { pass: false, pending: [], guardrails: rows };
  }
  const ids = partitionIds(file, "dev");
  const sessions = ids.map((id) => createSession(id));
  // G2: author separation, over the long bench's core files and every relative module they reach (v3's included).
  try {
    const walked = assertNoMemoryImports(CORE_FILES.map((path) => fileURLToPath(new URL(path, import.meta.url))));
    rows.push(result("G2", true, { files: walked.length, partition: "dev" }));
  } catch (error) {
    rows.push(result("G2", false, { error: error instanceof Error ? error.message : String(error) }));
  }
  // G3 and G4: calibration, with the long bench's scripted agents.
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
      classes: [...AMNESIC_FAIL_CLASSES],
      violations: violations.filter((row) => row.guardrail === "G4").length,
    }),
  );
  // G5: no leakage (the long bench's rule: shared weekdays, the revoke's two strings).
  const leaks = sessions.flatMap(dependencyLeaks);
  rows.push(result("G5", leaks.length === 0, { dependencies: sessions.reduce((sum, s) => sum + s.deps.length, 0), leaks: leaks.length }));
  // Sizes: the generator's rules hold for every dev session.
  try {
    const sizes = sessions.map((session) => sessionSizes(session));
    rows.push(
      result("sizes", true, {
        window: WINDOW_TOKENS,
        minSessionWindows: Math.min(...sizes.map((size) => size.total)) / WINDOW_TOKENS,
        worstRequestTokens: Math.max(...sizes.map((size) => size.worstRequest.tokens)),
      }),
    );
  } catch (error) {
    rows.push(result("sizes", false, { error: error instanceof Error ? error.message : String(error) }));
  }
  // G6: equal treatment.
  try {
    const { sharedConfig } = await import("../session-bench/run.mjs");
    const hash = assertLongEqualTreatment(LONG_ARMS.map((arm) => longArmConfig(arm, sharedConfig())));
    rows.push(result("G6", true, { arms: LONG_ARMS.length, sharedConfigHash: hash }));
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
  // G8: the pre-registered analysis (`ANALYSIS_LONG`, plan 218.5 Task 6) covers every decision arm and every class.
  const pending = [];
  if (existsSync(join(HERE, "score.mjs"))) {
    const { ANALYSIS_LONG } = await import("./score.mjs");
    const compared = new Set((ANALYSIS_LONG?.comparisons ?? []).flat());
    rows.push(
      result(
        "G8",
        Boolean(ANALYSIS_LONG) &&
          LONG_DECISION_ARMS.every((arm) => compared.has(arm)) &&
          LONG_CHECK_CLASSES.every((cls) => ANALYSIS_LONG.metrics.includes(cls)),
        { analysis: ANALYSIS_LONG?.version ?? null },
      ),
    );
  } else {
    pending.push("G8");
    rows.push(
      result("G8", true, { pending: "plan 218.5 Task 6 freezes ANALYSIS_LONG (score.mjs); the live run refuses a pending guardrail" }),
    );
  }
  // G9: full cost — every provider call of a memory arm is metered, main and workers apart.
  if (probe) {
    const { longAgentMock, longWorkerMock, runLongArmSession } = await import("./run.mjs");
    let calls = 0;
    const counted = (provider) => ({
      ...provider,
      async *generate(request) {
        calls++;
        yield* provider.generate(request);
      },
    });
    const run = await runLongArmSession({
      session: sessions[0],
      arm: "STM-only",
      providers: (state) => [counted(longAgentMock(state)), counted(longWorkerMock())],
      model: { provider: "mock", model: "main" },
      workerModel: "worker/session-bench",
      maxTasks: 6,
    });
    const metered = run.meter.main.calls + run.meter.workers.calls;
    rows.push(
      result("G9", metered === calls && run.meter.workers.calls > 0 && run.meter.main.calls > 0, {
        tasks: 6,
        providerCalls: calls,
        metered,
        workerCalls: run.meter.workers.calls,
      }),
    );
  } else rows.push(result("G9", true, { probe: "skipped" }));
  // G10: third-party arms run at their documented defaults on the same model, and each is an arm.
  const g10 = thirdPartyArms.filter((arm) => !arm.documentedDefaults || arm.model !== "same" || !LONG_ARMS.includes(arm.id));
  rows.push(
    result("G10", g10.length === 0, {
      thirdPartyArms: thirdPartyArms.map((arm) => arm.id),
      ...(g10.length ? { failing: g10.map((arm) => arm.id) } : {}),
    }),
  );
  // G11: pressure reached — STM-only offline overflows the pool before every dev session's first `after` dependent.
  if (pressure) {
    const { runLongBench } = await import("./run.mjs");
    const report = await runLongBench({
      arms: ["STM-only"],
      maxTasks: Math.max(...sessions.map(firstAfterTask)) - 1,
      jobs,
    });
    const summaries = report.pressure["STM-only"] ?? {};
    const g11 = pressureViolations(sessions, summaries);
    rows.push(
      result("G11", g11.length === 0, {
        sessions: sessions.length,
        firstOverflowTask: Object.fromEntries(ids.map((id) => [id, summaries[id]?.firstOverflowTask ?? null])),
        firstAfterTask: Object.fromEntries(sessions.map((session) => [session.id, firstAfterTask(session)])),
        violations: g11.length,
      }),
    );
  } else rows.push(result("G11", true, { offlineRun: "skipped" }));
  return { pass: rows.every((row) => row.pass), pending, partition: "dev", guardrails: rows };
}

/**
 * The live guardrails, read from a live report (plan 218.5 Task 7). `complete` is false until both calibration arms
 * and the pressure arm ran every session of the report. Each row names its threshold.
 */
export function liveLongGuardrails(report, spec = LIVE_GUARDRAILS) {
  const sessions = report.sessions ?? [];
  const ran = (arm) => Object.keys(report.scores?.[arm]?.sessions ?? {}).length;
  const complete = sessions.length > 0 && ["oracle-notes", "amnesic", spec.pressureArm].every((arm) => ran(arm) === sessions.length);
  const rows = [];
  const oracle = report.scores?.["oracle-notes"]?.overall;
  rows.push({
    id: "oracle-notes-solvable",
    taskRate: oracle?.taskRate ?? null,
    min: spec.oracleTaskRateMin,
    pass: typeof oracle?.taskRate === "number" && oracle.taskRate >= spec.oracleTaskRateMin,
  });
  const amnesic = report.scores?.amnesic?.overall;
  for (const [cls, min] of Object.entries(spec.amnesicFailRateMin)) {
    const row = amnesic?.classes?.[cls];
    const failRate = row?.total ? 1 - row.pass / row.total : null;
    rows.push({ id: `amnesic-fails-${cls}`, failRate, min, pass: failRate !== null && failRate >= min });
  }
  const summaries = report.pressure?.[spec.pressureArm] ?? {};
  const reached = sessions.filter((id) => {
    const overflow = summaries[id]?.firstOverflowTask;
    const firstAfter = report.firstAfterTask?.[id];
    return typeof overflow === "number" && typeof firstAfter === "number" && overflow < firstAfter;
  }).length;
  rows.push({
    id: "G11-live",
    reached,
    sessions: sessions.length,
    min: spec.pressureSessionsMin,
    pass: reached >= spec.pressureSessionsMin,
  });
  const overflows = Object.values(report.cost ?? {}).reduce((sum, cost) => sum + (cost.overflows ?? 0), 0);
  rows.push({ id: "no-window-overflow", overflows, max: spec.maxOverflows, pass: overflows <= spec.maxOverflows });
  return { complete, pass: complete && rows.every((row) => row.pass), rows };
}

if (import.meta.main && process.argv.includes("--live")) {
  const argv = process.argv.slice(2);
  const path = argv[argv.indexOf("--live") + 1];
  if (!path) {
    console.error("usage: guardrails.mjs --live <report.json>");
    process.exit(2);
  }
  const live = liveLongGuardrails(JSON.parse(readFileSync(path, "utf8")));
  for (const row of live.rows) console.log(`${row.pass ? "pass" : "FAIL"} ${row.id} ${JSON.stringify(row)}`);
  console.log(`complete ${live.complete}`);
  if (!live.pass) process.exit(1);
} else if (import.meta.main) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--output");
  const jobsAt = argv.indexOf("--jobs");
  const report = await checkLongGuardrails({ jobs: jobsAt >= 0 ? Number(argv[jobsAt + 1]) : 6 });
  if (at >= 0) await writeFile(argv[at + 1], `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report.guardrails) {
    const { id, pass, ...detail } = row;
    console.log(`${pass ? "pass" : "FAIL"} ${id} ${JSON.stringify(detail)}`);
  }
  if (report.pending.length) console.log(`pending ${report.pending.join(", ")} (plan 218.5 Task 6)`);
  if (!report.pass) {
    console.error("session-bench-long: a guardrail failed; no arm may run");
    process.exit(1);
  }
}

export { DEPENDENCY_CLASSES, firstAfterTask };
