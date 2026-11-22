/**
 * Plan 218.1 Task 4: the LOCA-Bench offline validation and the paid pilot that sizes Task 5's screen.
 *
 * ```sh
 * timeout 1800 bun scripts/memory-bench/external/loca-bench/fetch.mjs
 * timeout 7200 bun scripts/memory-bench/external/loca-bench/pilot.mjs --offline [--concurrency 4]
 * # paid, after the owner approves `locaBenchPilot` in the gate record (run as a systemd --user unit):
 * bun scripts/memory-bench/external/loca-bench/pilot.mjs --live [--concurrency 4]
 * bun scripts/memory-bench/external/loca-bench/pilot.mjs --score
 * ```
 *
 * Offline: every arm (the five Prism arms and `loca-react`) runs one instance per task family on a scripted model
 * (read-only calls over the instance's own tools, then `claim_done`) with the offline STM/WM worker; LOCA's evaluator
 * scores each end state. Nothing is paid. Live: the pilot rule below, fixed in the gate record before any call.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableHash } from "../../journal.mjs";
import { longSessionWorkerMock } from "../../work-outcome/long-session.mjs";
import {
  assertLocaRowHoldsNoText,
  LOCA_ARMS,
  LOCA_CALIBRATION_ARM,
  LOCA_PRISM_ARMS,
  LocaProviderFault,
  locaInstances,
  locaScriptedAgent,
  runLocaInstance,
  runLocaReact,
  startScriptedChat,
} from "./adapter.mjs";
import { LOCA_BENCH_PIN, locaBenchPaths, locaSeamSelfCheck, verifyLocaBenchCode, verifyLocaBenchEnv } from "./fetch.mjs";

export const LOCA_PILOT_GATE = "docs/_evidence/memory-bench/218/gates/owner-gate-m2.json";
export const LOCA_PILOT_EVIDENCE = "docs/_evidence/memory-bench/218/loca-bench-pilot.json";

/** The pre-registered pilot rule. Changing any field changes its hash, which the gate record pins. */
export const LOCA_PILOT_RULE = Object.freeze({
  suite: "loca-bench",
  codeRevision: LOCA_BENCH_PIN.code.commit,
  lengths: [{ preset: "64k", budget: 65_536 }],
  order:
    "one length (owner, 2026-11-17): the 64k environment at B = 64K. At B = 32K LOCA's own ReAct cannot hold the large-schema tasks (Canvas: 147 tool schemas, about 17K tokens, plus one 10K-token tool output exceed the budget and its trimmer ends the episode), so calibration there would read a floor. If this length does not qualify, the finding goes to the owner with the measured cost; no second length runs under this rule",
  instances:
    "LOCA-Bench's 15 tasks at seed 42 (ordinal 1, the first configuration of each task): the development partition, never seeds 4-5",
  seed: 42,
  arms: [LOCA_CALIBRATION_ARM, "memory-off", "WM"],
  model: "opencode-go/muse-spark-1.3-contributor",
  worker: "opencode-go/muse-spark-1.3-contributor",
  maxOutputTokens: 8_192,
  sampling:
    "temperature 1.0 for every arm (LOCA's ReAct); each arm leaves thinking at the provider's default, as LOCA's ReAct sends no reasoning field",
  budget:
    "B is the model's context window for the Prism arms (limits.contextWindow, maxOutputTokens taken from it) and LOCA's --max-context-size for loca-react (--max-tokens taken from it)",
  calibration:
    "at each length, memory-off's accuracy (mean reward over the 15 instances) lies inside loca-react's 95% Wilson score interval; otherwise the adapter is taken as wrong, the pilot stops there and the finding goes to the owner",
  select: {
    wmEngagedMin: 12,
    of: 15,
    engaged: "WM records at least one pass (memory.session.wm.recorded) in the instance",
    memoryOffAccuracy: [0.1, 0.85],
    rule: "the selected length is the first, in order, that calibrates, where WM engages on at least 12 of 15 instances and memory-off accuracy lies in [0.10, 0.85] (neither floor nor ceiling)",
    none: "if no length qualifies, the finding goes to the owner and Task 5 does not start",
  },
  reports:
    "per arm and length: accuracy, input and output tokens per instance (agent and worker apart), wall time per instance, WM passes, compactions, peak request size against B, failures; Task 5's estimate is computed from the selected length's measured tokens per instance",
  ceilingInputTokens: 500_000_000,
  ceilingBasis: "every usage log under the pilot's wire directory (Prism arms and loca-react)",
});

export const pilotRuleHash = (rule = LOCA_PILOT_RULE) => stableHash(rule);

/** The gate record must approve exactly this rule on the owner's word. */
export function assertPilotGate(gate, rule = LOCA_PILOT_RULE) {
  const pilot = gate?.locaBenchPilot;
  if (!pilot) throw new Error("LocaPilotGate: the gate record has no locaBenchPilot section");
  if (pilot.approved !== true || pilot.approvedBy !== "owner" || typeof pilot.text !== "string" || !pilot.text.trim())
    throw new Error("LocaPilotGate: the pilot is not approved on the owner's word");
  if (pilot.ruleHash !== pilotRuleHash(rule) || JSON.stringify(pilot.rule) !== JSON.stringify(rule))
    throw new Error("LocaPilotGate: the rule differs from the approved one; a changed rule is a refusal, not a re-approval");
  return pilot;
}

/** 95% Wilson score interval for k successes in n. */
export function wilsonInterval(k, n, z = 1.959963984540054) {
  if (!n) return [0, 1];
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Per-arm summary of one length's rows. */
export function summarizeArm(rows) {
  const passed = rows.filter((row) => row.reward >= 1).length;
  return {
    n: rows.length,
    passed,
    accuracy: round(rows.length ? passed / rows.length : 0),
    interval: wilsonInterval(passed, rows.length).map((value) => round(value)),
    inputTokensPerInstance: Math.round(mean(rows.map((row) => (row.main?.inputTokens ?? 0) + (row.worker?.inputTokens ?? 0)))),
    outputTokensPerInstance: Math.round(mean(rows.map((row) => (row.main?.outputTokens ?? 0) + (row.worker?.outputTokens ?? 0)))),
    workerInputTokensPerInstance: Math.round(mean(rows.map((row) => row.worker?.inputTokens ?? 0))),
    wallMsPerInstance: Math.round(mean(rows.map((row) => row.wallMs ?? 0))),
    wmEngaged: rows.filter((row) => (row.wmPasses ?? 0) >= 1).length,
    wmPasses: rows.reduce((sum, row) => sum + (row.wmPasses ?? 0), 0),
    compactions: rows.reduce((sum, row) => sum + (row.compactions ?? 0), 0),
    overBudget: rows.filter((row) => (row.peakInputTokens ?? 0) > (row.budget ?? Infinity)).length,
    claimed: rows.filter((row) => row.claimed).length,
    failures: rows.filter((row) => row.status === "failed" || row.evaluation === "missing" || row.evaluation === "error").length,
  };
}

/**
 * The rule applied to measured rows: per length, calibration and the two selection tests; the first length in order
 * that passes all three is selected; none → `owner`. A length with too few rows reads `incomplete` and stops the walk.
 */
export function selectPilotLength(rows, rule = LOCA_PILOT_RULE) {
  const lengths = [];
  for (const { preset, budget } of rule.lengths) {
    const at = rows.filter((row) => row.preset === preset && row.budget === budget);
    const byArm = Object.fromEntries(rule.arms.map((arm) => [arm, summarizeArm(at.filter((row) => row.arm === arm))]));
    const complete = rule.arms.every((arm) => byArm[arm].n === rule.select.of);
    const react = byArm[LOCA_CALIBRATION_ARM];
    const off = byArm["memory-off"];
    const calibrated = off.accuracy >= react.interval[0] && off.accuracy <= react.interval[1];
    const engaged = byArm.WM.wmEngaged >= rule.select.wmEngagedMin;
    const [low, high] = rule.select.memoryOffAccuracy;
    const notFloorOrCeiling = off.accuracy >= low && off.accuracy <= high;
    const reading = { preset, budget, complete, calibrated, engaged, notFloorOrCeiling, byArm };
    lengths.push(reading);
    if (!complete) return { selected: null, verdict: at.length ? "incomplete" : "not-run", lengths };
    if (!calibrated) return { selected: null, verdict: "calibration-failed", owner: true, lengths };
    if (engaged && notFloorOrCeiling) return { selected: { preset, budget }, verdict: "selected", lengths };
  }
  return { selected: null, verdict: "owner", owner: true, lengths };
}

/** Task 5's estimate from the selected length: 5 Prism arms + calibration, 45 instances, measured tokens per instance. */
export function screenEstimate(selection, { instances = 45, usdPerMillionInput = 0.065 } = {}) {
  if (!selection.selected) return null;
  const reading = selection.lengths.find((length) => length.preset === selection.selected.preset);
  const perInstance = Math.max(...Object.values(reading.byArm).map((arm) => arm.inputTokensPerInstance));
  const inputTokens = perInstance * instances * (LOCA_PRISM_ARMS.length + 1);
  return {
    basis: "the largest measured arm's input tokens per instance x 45 instances x 6 arms (5 Prism arms + loca-react)",
    inputTokens,
    usd: round((inputTokens / 1e6) * usdPerMillionInput, 2),
    ceilingInputTokens: Math.round(inputTokens * 1.5),
  };
}

/** Input and output tokens across every `*usage.jsonl` under `dir`. */
export function wireUsage(dir) {
  const totals = { inputTokens: 0, outputTokens: 0 };
  if (!existsSync(dir)) return totals;
  for (const entry of readdirSync(dir, { recursive: true })) {
    const file = join(dir, String(entry));
    if (!/usage\.jsonl$/.test(String(entry)) || !statSync(file).isFile()) continue;
    for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      totals.inputTokens += row.inputTokens ?? 0;
      totals.outputTokens += row.outputTokens ?? 0;
    }
  }
  return totals;
}

/** Checkpointed rows: `<root>/rows/<preset>-<budget>/<arm>/<instance>.json`. */
const rowFile = (root, { preset, budget }, arm, instance) =>
  join(root, "rows", `${preset}-${budget}`, arm, `${instance.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

export function readRows(root) {
  const dir = join(root, "rows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => assertLocaRowHoldsNoText(JSON.parse(readFileSync(join(dir, entry), "utf8"))));
}

/**
 * Run `jobs` with at most `concurrency` in flight. A provider fault (`isFault`, default `LocaProviderFault`: quota, rate
 * limit, overload) waits `faultWaitMs` and runs the same job again, without limit: a quota window reopens, and the
 * instance must not become a failed row. The token ceiling (`isCeiling`) stops the worker: no new job starts. Any other
 * error is retried twice, then logged; such a job leaves no checkpoint. Session-Bench's live run (plan 218.3 Task 11)
 * reuses it with its own fault and ceiling errors.
 */
export async function pool(
  jobs,
  concurrency,
  log,
  {
    faultWaitMs = 900_000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    isFault = (error) => error instanceof LocaProviderFault,
    isCeiling = (error) => error?.message === "LocaPilotTokenCeiling",
  } = {},
) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      for (let attempt = 1; ; attempt++) {
        try {
          await job();
          break;
        } catch (error) {
          if (isCeiling(error)) {
            log(
              `${error.message === "LocaPilotTokenCeiling" || error.message === "SessionBenchTokenCeiling" ? "token ceiling reached" : error.message}; no new job starts`,
            );
            return;
          }
          if (isFault(error)) {
            log(`provider fault (${error.message}); waiting ${Math.round(faultWaitMs / 60_000)} min, then again`);
            await sleep(faultWaitMs);
            continue;
          }
          log(`job failed (attempt ${attempt}): ${error?.message ?? error}`);
          if (attempt >= 3) break;
          await sleep(60_000);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
}

/**
 * One length's jobs: each (arm, instance) not yet checkpointed. `runArm(arm, instance, workspace)` returns the row.
 * `beforeEach` may throw (the token ceiling) to stop new instances.
 */
export function lengthJobs({ root, length, arms, instances, runArm, beforeEach = async () => {}, log = () => {} }) {
  const jobs = [];
  for (const instance of instances)
    for (const arm of arms) {
      const file = rowFile(root, length, arm, instance);
      if (existsSync(file)) continue;
      jobs.push(async () => {
        await beforeEach();
        const workspace = join(root, "work", `${length.preset}-${length.budget}`, arm, instance.id.replace(/[^A-Za-z0-9._-]/g, "_"));
        const row = await runArm(arm, instance, workspace);
        mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
        writeFileSync(file, `${JSON.stringify(assertLocaRowHoldsNoText(row))}\n`);
        log(
          `${length.preset} ${arm} ${instance.id}: reward ${row.reward} wm ${row.wmPasses ?? "-"} compactions ${row.compactions ?? "-"} ${Math.round(row.wallMs / 1000)}s`,
        );
      });
    }
  return jobs;
}

/** The offline validation: one instance per task family (seed 42), every arm, scripted model, offline worker. */
export async function runOfflineValidation({ paths, root, preset = "64k", budget = 32_768, steps = 40, concurrency = 4, log = () => {} }) {
  const { file, instances } = locaInstances(paths.code, preset);
  const picked = instances.filter((instance) => instance.ordinal === 1);
  const chat = startScriptedChat({ steps });
  const length = { preset, budget };
  try {
    const jobs = lengthJobs({
      root,
      length,
      arms: LOCA_ARMS,
      instances: picked,
      log,
      runArm: (arm, instance, workspace) =>
        arm === LOCA_CALIBRATION_ARM
          ? runLocaReact({
              instance,
              preset,
              budget,
              maxOutputTokens: 2_048,
              model: "scripted",
              paths,
              configFile: file,
              workspace,
              baseUrl: chat.baseUrl,
              apiKey: "offline",
            })
          : runLocaInstance({
              instance,
              arm,
              preset,
              budget,
              maxOutputTokens: 2_048,
              providers: [locaScriptedAgent({ steps }), longSessionWorkerMock()],
              model: { provider: "mock", model: "loca-scripted" },
              workerModel: "worker/stm",
              paths,
              configFile: file,
              workspace,
            }),
    });
    await pool(jobs, concurrency, log);
  } finally {
    chat.stop();
  }
  const rows = readRows(root).filter((row) => row.preset === preset && row.budget === budget);
  return offlineReport(rows, { preset, budget, steps, families: picked.length });
}

/** The offline acceptance read from rows: every arm scored every family; WM engaged where the run outgrew B. */
export function offlineReport(rows, { preset, budget, steps, families }) {
  const byArm = Object.fromEntries(LOCA_ARMS.map((arm) => [arm, rows.filter((row) => row.arm === arm)]));
  const scored = (row) => ["passed", "failed"].includes(row.evaluation) && typeof row.reward === "number";
  const wm = byArm.WM ?? [];
  // The environment outgrew B when the run read more tool output than B holds; the agent's own requests stay under
  // B by compaction, so the peak request is not the measure.
  const read = (row) => row.toolOutputTokens ?? 0;
  const over = wm.filter((row) => read(row) > budget);
  const under = wm.filter((row) => read(row) <= budget * 0.3);
  return {
    preset,
    budget,
    steps,
    families,
    model: "scripted (read-only calls over the instance's own tools, then claim_done); offline STM/WM worker",
    arms: Object.fromEntries(
      Object.entries(byArm).map(([arm, armRows]) => [
        arm,
        { ...summarizeArm(armRows), scored: armRows.filter(scored).length, statuses: countBy(armRows, (row) => row.status) },
      ]),
    ),
    checks: {
      everyArmScoredEveryFamily: LOCA_ARMS.every((arm) => byArm[arm].length === families && byArm[arm].every(scored)),
      wmEngagedAboveBudget: over.some((row) => row.wmPasses >= 1),
      wmIdleWellBelowBudget: under.every((row) => row.wmPasses === 0),
      instancesAboveBudget: over.length,
      instancesWellBelowBudget: under.length,
    },
  };
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const paths = locaBenchPaths();
  verifyLocaBenchCode({ dir: paths.code });
  verifyLocaBenchEnv({ paths });
  locaSeamSelfCheck({ paths });
  const concurrency = Number(flag("--concurrency") ?? 4);
  const log = (line) => process.stderr.write(`[${new Date().toISOString()}] ${line}\n`);
  if (args.includes("--offline")) {
    const preset = flag("--preset") ?? "64k";
    const budget = Number(flag("--budget") ?? 32_768);
    const root = join(paths.root, "pilot", "offline", `${preset}-${budget}`);
    const report = await runOfflineValidation({ paths, root, preset, budget, concurrency, log });
    const evidence = existsSync(LOCA_PILOT_EVIDENCE) ? JSON.parse(readFileSync(LOCA_PILOT_EVIDENCE, "utf8")) : {};
    writeFileSync(
      LOCA_PILOT_EVIDENCE,
      `${JSON.stringify(
        {
          kind: "loca-bench-pilot-v1",
          plan: "218.1 Task 4",
          codeRevision: LOCA_BENCH_PIN.code.commit,
          ruleHash: pilotRuleHash(),
          ...evidence,
          offlineValidation: { ...report, finishedAt: new Date().toISOString() },
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`${JSON.stringify(report.checks, null, 2)}\n`);
  } else if (args.includes("--live") || args.includes("--score")) {
    const gate = JSON.parse(readFileSync(LOCA_PILOT_GATE, "utf8"));
    const approval = assertPilotGate(gate);
    const root = join(paths.root, "pilot", pilotRuleHash().slice(0, 16));
    if (args.includes("--live")) {
      const { liveProviders, loadEnv, refOf } = await import("../../run.mjs");
      const { startPassthrough } = await import("../compact-bench/passthrough.mjs");
      loadEnv();
      const wire = join(root, "wire");
      mkdirSync(wire, { recursive: true, mode: 0o700 });
      const ref = refOf(LOCA_PILOT_RULE.model);
      const live = await liveProviders([ref], join(wire, "prism"), { maxOutputTokens: LOCA_PILOT_RULE.maxOutputTokens, patient: true });
      const pass = await startPassthrough({
        agentModel: "",
        record: join(wire, "react", "exchanges"),
        usageLog: join(wire, "react", "usage.jsonl"),
      });
      const model = live.models.get(LOCA_PILOT_RULE.model);
      const beforeEach = async () => {
        for (const { proxy } of live.proxies) await proxy.drain();
        await pass.drain();
        if (wireUsage(wire).inputTokens >= LOCA_PILOT_RULE.ceilingInputTokens) throw new Error("LocaPilotTokenCeiling");
      };
      try {
        for (const length of LOCA_PILOT_RULE.lengths) {
          const selection = selectPilotLength(readRows(root));
          if (selection.verdict === "selected" || selection.verdict === "calibration-failed") break;
          const { file, instances } = locaInstances(paths.code, length.preset);
          const picked = instances.filter((instance) => instance.seed === LOCA_PILOT_RULE.seed);
          const jobs = lengthJobs({
            root,
            length,
            arms: LOCA_PILOT_RULE.arms,
            instances: picked,
            beforeEach,
            log,
            runArm: (arm, instance, workspace) =>
              arm === LOCA_CALIBRATION_ARM
                ? runLocaReact({
                    instance,
                    ...length,
                    maxOutputTokens: LOCA_PILOT_RULE.maxOutputTokens,
                    model: ref.model,
                    paths,
                    configFile: file,
                    workspace,
                    baseUrl: `${pass.url}/v1`,
                    apiKey: pass.upstreamEnv.CB_API_KEY,
                  })
                : runLocaInstance({
                    instance,
                    arm,
                    ...length,
                    maxOutputTokens: LOCA_PILOT_RULE.maxOutputTokens,
                    providers: live.providers,
                    model,
                    workerModel: LOCA_PILOT_RULE.worker,
                    paths,
                    configFile: file,
                    workspace,
                  }),
          });
          await pool(jobs, concurrency, log);
          const rows = readRows(root).filter((row) => row.preset === length.preset);
          if (rows.length < LOCA_PILOT_RULE.arms.length * LOCA_PILOT_RULE.select.of) {
            log(`${length.preset}: ${rows.length} rows; re-run --live to resume`);
            break;
          }
        }
      } finally {
        for (const { proxy } of live.proxies) proxy.stop();
        pass.stop();
      }
    }
    const rows = readRows(root);
    const selection = selectPilotLength(rows);
    const evidence = existsSync(LOCA_PILOT_EVIDENCE) ? JSON.parse(readFileSync(LOCA_PILOT_EVIDENCE, "utf8")) : {};
    writeFileSync(
      LOCA_PILOT_EVIDENCE,
      `${JSON.stringify(
        {
          ...evidence,
          kind: "loca-bench-pilot-v1",
          plan: "218.1 Task 4",
          codeRevision: LOCA_BENCH_PIN.code.commit,
          ruleHash: pilotRuleHash(),
          pilot: {
            approvedAt: approval.approvedAt,
            usage: wireUsage(join(root, "wire")),
            selection: { verdict: selection.verdict, selected: selection.selected, lengths: selection.lengths },
            screenEstimate: screenEstimate(selection),
            rows,
            rowsSha256: sha256(JSON.stringify(rows)),
            finishedAt: new Date().toISOString(),
          },
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`${JSON.stringify({ verdict: selection.verdict, selected: selection.selected }, null, 2)}\n`);
  } else {
    process.stderr.write("pilot.mjs: --offline | --live | --score\n");
    process.exit(2);
  }
}
