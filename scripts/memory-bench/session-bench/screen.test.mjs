/** Plan 218.3 Task 12: the decision screen's rule, verdict and held-out refusal; Session-Bench v3's checks; the embedder. */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gpuDevice, LOCAL_EMBEDDER, localEmbedder, localEmbedderStatus } from "./arms/third-party.mjs";
import { evaluateCheck } from "./checks.mjs";
import { createSession, sessionBenchPartitions } from "./generate.mjs";
import { liveConfigHashes, SESSION_BENCH_TEST_RULE, testRuleHash } from "./live.mjs";
import {
  assertDevOnly,
  assertScreenGate,
  costPerPassedTask,
  devIds,
  SCREEN_ARMS,
  SESSION_BENCH_SCREEN_RULE,
  screenRuleHash,
  screenVerdict,
  unitsFromRows,
} from "./screen.mjs";
import { FLAG_LOOKALIKES } from "./templates/build.mjs";

const GATE = new URL("../../../docs/_evidence/memory-bench/218/gates/owner-gate-m2.json", import.meta.url);
const gate = JSON.parse(readFileSync(GATE, "utf8"));
const rule = SESSION_BENCH_SCREEN_RULE;

const approvedGate = (overrides = {}) => ({
  sessionBench: { ...gate.sessionBench, screenLive: { sharedConfigHash: liveConfigHashes(rule).sharedConfigHash } },
  sessionBenchScreen: { approved: true, approvedBy: "owner", text: "yes", ruleHash: screenRuleHash(), rule, ...overrides },
});

test("screen_rule_is_fixed_before_the_run", () => {
  assert.ok(assertScreenGate(approvedGate()));
  assert.throws(() => assertScreenGate({ sessionBench: gate.sessionBench }), /no sessionBenchScreen/);
  assert.throws(() => assertScreenGate(approvedGate({ approved: false })), /owner's word/);
  // A rule changed after approval is refused, not re-approved.
  assert.throws(() => assertScreenGate(approvedGate(), { ...rule, ceilingInputTokens: 1 }), /differs/);
  assert.throws(() => assertScreenGate({ ...approvedGate(), sessionBench: { ...gate.sessionBench, templateHash: "x" } }), /G1/);
  // The rule pins Session-Bench v3, the owner's arms, ceiling, embedder and WM cost bar; the test rule stays as run (v2).
  assert.equal(rule.benchmark.version, 3);
  assert.equal(rule.benchmark.templateHash, sessionBenchPartitions().templateHash);
  assert.deepEqual(rule.arms, [...SCREEN_ARMS]);
  assert.equal(rule.sessions.length, 36);
  assert.equal(rule.ceilingInputTokens, 1_200_000_000);
  assert.equal(rule.limits.maxToolCalls, 60);
  assert.equal(rule.limits.maxTurns, 60);
  assert.equal(SESSION_BENCH_TEST_RULE.limits.maxToolCalls, 30, "Task 11's rule keeps its limit");
  assert.equal(rule.embedder.provider, "llama.cpp");
  assert.equal(rule.embedder.model, "gpustack/bge-m3-GGUF");
  assert.equal(rule.decision.wm.maxCostRatio, 1.5);
  assert.equal(SESSION_BENCH_TEST_RULE.benchmark.version, 2);
  assert.equal(gate.sessionBenchTest.ruleHash, testRuleHash());
  // Equal treatment (G6): one shared config for every screen arm, pinned in sessionBench.screenLive; the screen runs on
  // the owner's model (hy4-flash-free), so it is not Task 11's pin.
  assert.equal(rule.model, "opencode-go/hy4-flash-free");
  // The memory workers on their own small model (owner, 2026-11-20), at low by default, with the window's output room.
  assert.equal(rule.worker, "opencode-go/muse-spark-1.3-contributor");
  assert.match(rule.workerFaults, /no row/);
  assert.equal(rule.sampling.workerReasoningEffort, "low");
  assert.equal(rule.sampling.workerOutput, "window");
  assert.ok(rule.arms.includes("memory-off-drop"));
  assert.deepEqual(rule.productFixes.at(-1).carriedArms, []);
  assert.equal(liveConfigHashes(rule).sharedConfigHash, gate.sessionBench.screenLive.sharedConfigHash);
  assert.notEqual(gate.sessionBench.screenLive.sharedConfigHash, gate.sessionBench.live.sharedConfigHash);
  assert.throws(
    () => assertScreenGate({ ...approvedGate(), sessionBench: gate.sessionBench }, { ...rule, model: "opencode-go/x" }),
    /differs|G6/,
  );
  // Once the committed gate holds the screen, it holds exactly this rule.
  if (gate.sessionBenchScreen) {
    assert.equal(gate.sessionBenchScreen.ruleHash, screenRuleHash());
    assert.deepEqual(gate.sessionBenchScreen.rule, JSON.parse(JSON.stringify(rule)));
  }
});

test("screen_calibration_slice_gates_the_screen", async () => {
  const { calibrationRule, projection, liveConfigHashes: hashes } = await import("./live.mjs");
  // The calibration arms run on Task 11's 6-session slice only, never on the 36 screen sessions.
  const cal = calibrationRule(rule);
  assert.deepEqual(cal.arms, ["oracle-context", "amnesic"]);
  assert.deepEqual(cal.sessions, SESSION_BENCH_TEST_RULE.sessions);
  assert.equal(projection([], rule).of, 7 * 36 + 2 * 6);
  assert.deepEqual(Object.keys(hashes(rule).configHashes), [...SCREEN_ARMS, "oracle-context", "amnesic"]);
  assert.deepEqual(rule.liveGuardrails, SESSION_BENCH_TEST_RULE.liveGuardrails);
  // Task 11's rule keeps its calibration on its own sessions.
  assert.deepEqual(calibrationRule(SESSION_BENCH_TEST_RULE).sessions, SESSION_BENCH_TEST_RULE.sessions);
  const heldout = Object.values(sessionBenchPartitions().abilities["heldout-a"]).flat()[0];
  assert.throws(() => assertScreenGate(approvedGate(), { ...rule, calibration: { ...rule.calibration, sessions: [heldout] } }), /held-out/);
});

test("screen_never_reads_heldout_sessions", () => {
  const file = sessionBenchPartitions();
  const heldout = Object.values(file.abilities["heldout-a"]).flat()[0];
  const heldoutB = Object.values(file.abilities["heldout-b"]).flat()[0];
  assert.throws(() => assertDevOnly([...devIds(file).slice(0, 2), heldout]), /held-out/);
  assert.throws(() => assertDevOnly([heldoutB]), /held-out/);
  assert.throws(() => assertDevOnly(["sb-nope-01"]), /not a dev session/);
  assert.deepEqual(rule.sessions, devIds(file));
  assert.throws(() => assertScreenGate(approvedGate(), { ...rule, sessions: [...rule.sessions, heldout] }), /held-out/);
});

// --- the verdict, on synthetic units (one branch each) ------------------------------------------------------------------

const SESSIONS = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
/** Units for one arm: per session, 6 dependency checks (D1-D4), 4 control checks, 4 tasks; `dep` / `ctl` pass counts. */
function units({ dep, ctl = 4, task = 4 }) {
  const out = { task: [], D1: [], D2: [], D3: [], D4: [], C: [] };
  for (const session of SESSIONS) {
    const d = typeof dep === "function" ? dep(session) : dep;
    for (let i = 0; i < 6; i++)
      out[["D1", "D2", "D3", "D4"][i % 4]].push({ id: `${session}:d${i}`, cluster: session, value: Number(i < d) });
    for (let i = 0; i < 4; i++) out.C.push({ id: `${session}:c${i}`, cluster: session, value: Number(i < ctl) });
    for (let i = 0; i < 4; i++) out.task.push({ id: `${session}:${i}`, cluster: session, value: Number(i < task) });
  }
  return out;
}
const cost = (input) => ({ main: { inputTokens: input }, workers: { inputTokens: 0 }, embeddings: { inputTokens: 0 } });
function report({ off, stm, wm, side = {}, costs = {} }) {
  const all = { "memory-off-llm": off, "STM-only": stm, "STM+WM": wm, ...side };
  const passed = (u) => u.task.filter((row) => row.value).length;
  return {
    units: all,
    scores: Object.fromEntries(Object.entries(all).map(([arm, u]) => [arm, { overall: { tasksPassed: passed(u) } }])),
    cost: Object.fromEntries(Object.keys(all).map((arm) => [arm, cost(costs[arm] ?? 1_000_000)])),
  };
}
const opts = (r) => screenVerdict(r);

test("screen_verdict_follows_the_rule", () => {
  // STM ships: better on dependencies, no control harm; WM beats STM at 1.2x cost: model policy.
  let v = opts(
    report({
      off: units({ dep: 2 }),
      stm: units({ dep: 4 }),
      wm: units({ dep: 6 }),
      costs: { "STM-only": 1_000_000, "STM+WM": 1_200_000 },
    }),
  );
  assert.equal(v.stm.ship, true);
  assert.equal(v.wm.beats, true);
  assert.equal(v.wm.default, true);
  assert.deepEqual(v.summary, { stm: "ship", wmPolicy: "model", findings: 0 });
  assert.ok(v.stm.detectableEffect === 0 || Number.isFinite(v.stm.detectableEffect));

  // WM beats STM but costs 2x per passed task: deterministic policy.
  v = opts(report({ off: units({ dep: 2 }), stm: units({ dep: 4 }), wm: units({ dep: 6 }), costs: { "STM+WM": 2_000_000 } }));
  assert.equal(v.wm.beats, true);
  assert.ok(v.wm.costRatio > 1.5);
  assert.equal(v.wm.default, false);

  // STM better on dependencies but harms control tasks (every C check lost): not shown.
  v = opts(report({ off: units({ dep: 2, ctl: 4 }), stm: units({ dep: 4, ctl: 1 }), wm: units({ dep: 4, ctl: 1 }) }));
  assert.equal(v.stm.ship, false);
  assert.equal(v.summary.wmPolicy, "deterministic");

  // No difference: neither ships; ties never pass a lower bound > 0.
  v = opts(report({ off: units({ dep: 3 }), stm: units({ dep: 3 }), wm: units({ dep: 3 }) }));
  assert.equal(v.stm.ship, false);
  assert.equal(v.wm.beats, false);

  // A side arm above a Prism arm is a finding for the owner; a side arm that did not run is reported not-run.
  v = opts(report({ off: units({ dep: 1 }), stm: units({ dep: 3 }), wm: units({ dep: 3 }), side: { "codex-prompt": units({ dep: 6 }) } }));
  assert.ok(v.findings.some((line) => line.startsWith("memory-off-llm below codex-prompt")));
  assert.ok(v.side.some((row) => row.side === "mem0" && row.status === "not-run"));
  assert.equal(v.ruleHash, screenRuleHash());

  // A missing decision arm cannot ship anything.
  v = opts({ units: { "memory-off-llm": units({ dep: 2 }) }, scores: {}, cost: {} });
  assert.equal(v.stm.status, "not-run");
  assert.equal(v.stm.ship, false);
  assert.equal(costPerPassedTask({ cost: {}, scores: {} }, "STM-only"), null);
});

test("screen_units_come_from_rows_blind", () => {
  const row = (arm, session, pass) => ({
    arm,
    session,
    checks: [{ session, task: 1, check: "c1", class: "D2", dep: "d", pass }],
    tasks: [{ session, task: 1, rederivations: 0, toolCalls: 1 }],
  });
  const u = unitsFromRows([row("STM-only", "s1", true), row("STM-only", "s2", false), row("memory-off-llm", "s1", false)]);
  assert.equal(u["STM-only"].D2.length, 2);
  assert.equal(u["memory-off-llm"].task[0].value, 0);
  // Paired on shared sessions only: s2 has no memory-off-llm row.
  const v = screenVerdict({ units: u, scores: {}, cost: {} });
  assert.equal(v.stm.sessions, 1);
});

// --- Session-Bench v3 ------------------------------------------------------------------------------------------------

test("v3_d4_passes_an_announcement_that_mentions_the_change", () => {
  const session = createSession(devIds()[0]);
  const check = session.tasks.flatMap((task) => task.checks).find((row) => row.class === "D4");
  assert.equal(check.excludes, undefined);
  const [after] = check.includes;
  const state = (text) => ({ created: { messages: [{ task: 1, channel: "#release", text }] } });
  assert.equal(evaluateCheck(check, state(`We now ship on ${after} (moved from the earlier day).`), 1), true);
  assert.equal(evaluateCheck(check, state("We ship soon."), 1), false);
});

test("v3_d3_fails_when_a_lookalike_flag_is_on", () => {
  const session = createSession(devIds().find((id) => createSession(id).deps.some((dep) => dep.class === "D3")));
  const check = session.tasks.flatMap((task) => task.checks).find((row) => row.class === "D3");
  assert.equal(check.othersOff.length, FLAG_LOOKALIKES.length);
  const own = check.othersOff[0].replace(/_legacy$/, "_rollout");
  const state = (extra = {}) => ({
    config: { [own]: true, ...Object.fromEntries(check.othersOff.map((key) => [key, false])), ...extra },
    changes: [{ task: check.sourceTask, kind: "config", created: true, key: own }],
  });
  assert.equal(evaluateCheck(check, state(), 99), true);
  assert.equal(evaluateCheck(check, state({ [check.othersOff[1]]: true }), 99), false);
  // Every look-alike exists in the initial config, so a listing does not single out the agent's own flag.
  for (const key of check.othersOff) assert.equal(session.env.config[key], false);
});

// --- the embedder: BGE-M3 on llama.cpp/Vulkan (needs `arms/third-party.mjs --install-embedder`) ---------------------------------------------

test.skipIf(!localEmbedderStatus().installed)(
  "local_embedder_serves_bge_m3_on_the_gpu",
  async () => {
    const embedder = await localEmbedder();
    try {
      const { vectors, tokens } = await embedder.embed(["we ship on Thursday", "the ship day is Thursday", "close ticket T-104"]);
      assert.equal(vectors.length, 3);
      assert.equal(vectors[0].length, LOCAL_EMBEDDER.dims);
      const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
      assert.ok(Math.abs(dot(vectors[0], vectors[0]) - 1) < 1e-6, "normalised");
      assert.ok(dot(vectors[0], vectors[1]) > dot(vectors[0], vectors[2]));
      assert.ok(tokens > 0, "llama-server reports its own token count");
    } finally {
      embedder.stop();
    }
  },
  180_000,
);

test("embedder_picks_the_discrete_gpu", () => {
  const listing = [
    "Available devices:",
    "  Vulkan0: AMD Radeon 780M Graphics (RADV PHOENIX) (32482 MiB, 31233 MiB free)",
    "  Vulkan1: AMD Radeon RX 6550M (RADV NAVI24) (4080 MiB, 4064 MiB free)",
  ].join("\n");
  assert.equal(gpuDevice(undefined, listing), "Vulkan1");
  assert.throws(() => gpuDevice(undefined, "  Vulkan0: AMD Radeon 780M Graphics (RADV PHOENIX)"), /no discrete/);
});

// Owner, 2026-11-19 (free route): model call failures never end the run; it restarts and resumes.
test("free_route_failures_wait_and_the_run_resumes", async () => {
  const { quotaWaitFetch, WAIT_STATUSES, SessionBenchIncomplete } = await import("./live.mjs");
  for (const status of [408, 425, 429, 500, 502, 503, 504, 520, 524, 529]) assert.ok(WAIT_STATUSES.has(status), String(status));
  const clock = { waits: 0, waitMs: 0 };
  const answers = [520, 408, 200];
  const fetch = quotaWaitFetch(async () => new Response("x", { status: answers.shift() }), {
    waitMs: 1,
    clock,
    sleep: async () => {},
  });
  assert.equal((await fetch("u", {})).status, 200);
  assert.equal(clock.waits, 2);
  assert.equal(new SessionBenchIncomplete("x").name, "SessionBenchIncomplete");
  // The unit restarts on failure only: exit 6 (incomplete) restarts; exit 3 (stop for the owner) and 5 (paused) do not.
  const unit = readFileSync(new URL("./screen-unit.sh", import.meta.url), "utf8");
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /RestartPreventExitStatus=3 5/);
});

test("screen_smoke_accepts_the_arms_own_outcomes", async () => {
  const { faultedTasks } = await import("./live.mjs");
  assert.deepEqual(rule.smokeOutcomes, ["ERR_PRISM_RUN_LIMIT", "context_overflow"]);
  const status = {
    7: { status: "failed", code: "ERR_PRISM_RUN_LIMIT", limit: "maxToolCalls" },
    8: { status: "failed", code: "context_overflow" },
  };
  assert.equal(faultedTasks(status).length, 0);
  assert.equal(faultedTasks({ 1: { status: "failed", code: "provider_error" } }).length, 1);
  assert.equal(SESSION_BENCH_TEST_RULE.smokeOutcomes, undefined, "Task 11's rule keeps its own smoke rule");
});

test("harness_runs_one_tool_call_per_turn", async () => {
  // Owner, 2026-11-19: a main-agent turn with several tool calls runs only the first; the rest get a fixed answer.
  const { providerDone, providerToolCall, providerTextDelta, toolCallContent } = await import("@arnilo/prism");
  const { runArmSession, DEFERRED_TOOL_CALL_TEXT, sessionBenchWorkerMock } = await import("./run.mjs");
  assert.equal(rule.sampling.toolCallsPerTurn, 1);
  const session = createSession(devIds()[0]);
  session.tasks = session.tasks.slice(0, 1);
  const seen = [];
  const main = {
    id: "mock",
    async *generate(request) {
      const tools = request.messages.filter((m) => m.role === "tool");
      if (!tools.length && (request.tools ?? []).some((t) => t.name === "read_file")) {
        yield providerToolCall(toolCallContent("c1", "list_files", {}));
        yield providerToolCall(toolCallContent("c2", "list_tickets", {}));
        yield providerDone();
        return;
      }
      // Later requests carry the same tool messages again: keep each once.
      for (const m of tools) if (!seen.includes(JSON.stringify(m.content))) seen.push(JSON.stringify(m.content));
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
  const run = (toolCallsPerTurn) =>
    runArmSession({
      session,
      arm: "memory-off-llm",
      providers: () => [main, sessionBenchWorkerMock()],
      model: { provider: "mock", model: "main" },
      workerModel: "worker/session-bench",
      ...(toolCallsPerTurn ? { toolCallsPerTurn, parallelToolCalls: false } : {}),
    });
  seen.length = 0;
  const one = await run(1);
  assert.equal(one.meter.deferredToolCalls, 1);
  // The first call ran (a real listing came back); the second got the fixed answer and never reached the workspace.
  assert.equal(seen.filter((text) => text.includes(DEFERRED_TOOL_CALL_TEXT)).length, 1);
  assert.ok(seen.some((text) => text.includes('"c1"') && !text.includes(DEFERRED_TOOL_CALL_TEXT)));
  seen.length = 0;
  const both = await run(undefined);
  assert.equal(both.meter.deferredToolCalls, 0);
  assert.equal(seen.filter((text) => text.includes(DEFERRED_TOOL_CALL_TEXT)).length, 0);
  assert.notEqual(one.configHash, both.configHash, "the setting is in the run config hash (G6)");
});

test("one_tool_call_per_turn_covers_memory_tools", async () => {
  // 2026-11-19 validation of the STM fixes: three recall calls in one STM-only turn all ran (the rule deferred only the
  // workspace tools), and the turn overflowed W. A memory package's tool past the first call gets the fixed answer too.
  const { providerDone, providerToolCall, providerTextDelta, toolCallContent } = await import("@arnilo/prism");
  const { runArmSession, DEFERRED_TOOL_CALL_TEXT, sessionBenchWorkerMock } = await import("./run.mjs");
  const session = createSession(devIds()[0]);
  session.tasks = session.tasks.slice(0, 1);
  const seen = [];
  const main = {
    id: "mock",
    async *generate(request) {
      const tools = request.messages.filter((m) => m.role === "tool");
      if (!tools.length && (request.tools ?? []).some((t) => t.name === "read_file")) {
        yield providerToolCall(toolCallContent("c1", "list_files", {}));
        yield providerToolCall(toolCallContent("c2", "recall", { query: "deploy" }));
        yield providerToolCall(toolCallContent("c3", "recall", { query: "flag" }));
        yield providerDone();
        return;
      }
      for (const m of tools) if (!seen.includes(JSON.stringify(m.content))) seen.push(JSON.stringify(m.content));
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
  const run = await runArmSession({
    session,
    arm: "STM-only",
    providers: () => [main, sessionBenchWorkerMock()],
    model: { provider: "mock", model: "main" },
    workerModel: "worker/session-bench",
    toolCallsPerTurn: 1,
    parallelToolCalls: false,
  });
  assert.equal(run.meter.deferredToolCalls, 2);
  assert.equal(seen.filter((text) => text.includes(DEFERRED_TOOL_CALL_TEXT)).length, 2);
});
