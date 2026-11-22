import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { providerDone, providerTextDelta } from "@arnilo/prism";
import { runScripted } from "./agents.mjs";
import {
  armConfig,
  armMemoryConfig,
  armPackages,
  assertEqualTreatment,
  CALIBRATION_ARMS,
  configHash,
  keepRecentTokens,
  PRISM_ARMS,
  REFERENCE_ARMS,
  SESSION_BENCH_ARMS,
  SIDE_ARMS,
  THIRD_PARTY_ARMS,
} from "./arms/prism.mjs";
import { isReferencePrompt, REFERENCE_PROMPTS, referencePrompt } from "./arms/references.mjs";
import {
  hashEmbedder,
  localEmbedder,
  localEmbedderStatus,
  MEM0_ARM_CONFIG,
  mem0Status,
  startModelEndpoint,
  THIRD_PARTY_ARM_SPECS,
  THIRD_PARTY_CANDIDATES,
} from "./arms/third-party.mjs";
import { CHECK_CLASSES } from "./checks.mjs";
import { createWorkspace, initialObservableText } from "./env/workspace.mjs";
import {
  createSession,
  MIN_SESSION_WINDOWS,
  MIN_SPAN_WINDOWS,
  PARTITION_FILE,
  partitionIds,
  serializePartitionFile,
  sessionBenchIds,
  sessionBenchPartitions,
  sessionSizes,
  WINDOW_TOKENS,
} from "./generate.mjs";
import { assertNoMemoryImports, calibrationViolations, checkGuardrails, dependencyLeaks, importSpecifiers } from "./guardrails.mjs";
import {
  countStmFallbacks,
  emptyMeter,
  requestTokens,
  runArmSession,
  runSessionBench,
  sessionBenchAgentMock,
  sessionBenchWorkerMock,
  sharedConfig,
  windowedProviders,
} from "./run.mjs";
import { assertCompleteReport, compareArms, scoreRows } from "./score.mjs";

const MODEL = { provider: "mock", model: "main" };
const WORKER = "worker/session-bench";
const file = sessionBenchPartitions();
const dev = partitionIds(file, "dev").map((id) => createSession(id));
const onePerFamily = Object.values(file.abilities.dev).map((ids) => createSession(ids[0]));
/** Mem0 runs from the cache install (`arms/third-party.mjs --install`); without it, its arm's tests are skipped. */
const mem0 = mem0Status();
const compactBenchCheckout = (() => {
  try {
    referencePrompt(REFERENCE_ARMS[0]);
    return true;
  } catch {
    return false;
  }
})();
const RUNNABLE_ARMS = SESSION_BENCH_ARMS.filter(
  (arm) => (mem0.installed || !THIRD_PARTY_ARMS.includes(arm)) && (compactBenchCheckout || !REFERENCE_ARMS.includes(arm)),
);

test("session_bench_regenerates_byte_for_byte", () => {
  assert.equal(readFileSync(PARTITION_FILE, "utf8"), serializePartitionFile());
  assert.equal(file.counts.sessions, sessionBenchIds().length);
  // The draw is label-blind and disjoint: every id in exactly one partition.
  const all = Object.values(file.abilities).flatMap((families) => Object.values(families).flat());
  assert.equal(new Set(all).size, sessionBenchIds().length);
  // A session is a pure function of its id.
  assert.deepEqual(createSession(dev[0].id), dev[0]);
  for (const session of dev) {
    assert.ok(session.tasks.length >= 8 && session.tasks.length <= 14);
    assert.match(session.scope, /^Session plan: /);
    assert.equal(session.scope.split("\n").length, session.tasks.length + 1);
  }
});

test("oracle_agent_passes_every_check", () => {
  const violations = calibrationViolations(dev).filter((row) => row.guardrail === "G3");
  assert.deepEqual(violations, []);
  // Every class is exercised on dev.
  const classes = new Set(dev.flatMap((session) => session.tasks.flatMap((task) => task.checks.map((check) => check.class))));
  assert.deepEqual([...classes].sort(), [...CHECK_CLASSES].sort());
});

test("amnesic_agent_fails_user_only_and_superseded_checks", () => {
  assert.deepEqual(
    calibrationViolations(dev).filter((row) => row.guardrail === "G4"),
    [],
  );
  const rows = dev.flatMap((session) => runScripted(session, "amnesic").rows);
  assert.ok(rows.some((row) => row.class === "D2") && rows.some((row) => row.class === "D4"));
  // D1 is re-derivable: the amnesic agent re-reads, and the re-reads are counted.
  const rederived = dev.flatMap((session) => runScripted(session, "amnesic").tasks).reduce((sum, row) => sum + row.rederivations, 0);
  assert.ok(rederived > 0);
  assert.equal(
    dev.flatMap((session) => runScripted(session, "oracle").tasks).reduce((sum, row) => sum + row.rederivations, 0),
    0,
  );
});

test("no_dependency_answer_leaks", () => {
  assert.deepEqual(dev.flatMap(dependencyLeaks), []);
  // The lint finds a planted leak: a user-only answer in a file, a superseded one in the scope.
  const session = structuredClone(dev.find((row) => row.deps.some((dep) => dep.class === "D2")));
  const d2 = session.deps.find((dep) => dep.class === "D2");
  session.env.files["docs/notes.md"] = `remember ${d2.answer}`;
  const d4 = session.deps.find((dep) => dep.class === "D4");
  session.scope += `\nShip on ${d4.answer}.`;
  const leaks = dependencyLeaks(session);
  assert.deepEqual(leaks.find((row) => row.dep === d2.id)?.where, ["workspace"]);
  assert.ok(leaks.find((row) => row.dep === d4.id)?.where.includes("scope"));
  assert.ok(initialObservableText(session.env).includes(d2.answer));
});

test("arms_differ_only_in_memory_config", () => {
  const configs = SESSION_BENCH_ARMS.map((arm) => armConfig(arm, sharedConfig()));
  assert.match(assertEqualTreatment(configs), /^[0-9a-f]{64}$/);
  // The memory configs differ; STM-only and STM+WM differ only in setting the scope.
  const stm = configs.find((row) => row.arm === "STM-only").memory;
  const wm = configs.find((row) => row.arm === "STM+WM").memory;
  assert.deepEqual({ ...stm, setScope: true }, wm);
  // Any other difference is refused, naming the field.
  const skewed = configs.map((row) => (row.arm === "STM+WM" ? { ...row, shared: { ...row.shared, sampling: { temperature: 0.7 } } } : row));
  assert.throws(() => assertEqualTreatment(skewed), /STM\+WM differs .*sampling.*G6/);
  // The calibration arms are the benchmark's instruments: the ceiling's window differs by design.
  assert.ok(configs.find((row) => row.arm === "oracle-context").shared.window > WINDOW_TOKENS);
});

test("session_bench_imports_no_memory_package", () => {
  const walked = assertNoMemoryImports();
  for (const core of ["generate.mjs", "checks.mjs", "agents.mjs", "score.mjs", "env/workspace.mjs", "templates/build.mjs"])
    assert.ok(
      walked.some((path) => path.endsWith(`session-bench/${core}`)),
      core,
    );
  assert.deepEqual(importSpecifiers(`import x from "./a.mjs";\nconst y = await import("@arnilo/prism-memory-system");`), [
    "./a.mjs",
    "@arnilo/prism-memory-system",
  ]);
  const sources = {
    "/x/core.mjs": `import { a } from "./helper.mjs";`,
    "/x/helper.mjs": `export * from "../../packages/memory/system/src/index.js";`,
  };
  assert.throws(
    () => assertNoMemoryImports(["/x/core.mjs"], (path) => sources[path]),
    /G2: .*helper\.mjs imports \.\.\/\.\.\/packages\/memory/,
  );
});

test("sessions_outgrow_the_window", () => {
  for (const session of dev) {
    const sizes = sessionSizes(session);
    assert.ok(sizes.total >= MIN_SESSION_WINDOWS * WINDOW_TOKENS, session.id);
    for (const span of sizes.spans)
      assert.ok(span.tokens >= MIN_SPAN_WINDOWS * WINDOW_TOKENS && span.tasks >= 3, `${session.id} ${span.dep}`);
    // No single task's output alone fills the window.
    assert.ok(sizes.maxTaskTokens < WINDOW_TOKENS, session.id);
  }
  assert.ok(file.counts.minSessionTokens >= MIN_SESSION_WINDOWS * WINDOW_TOKENS);
});

test("harness_rejects_requests_over_w", async () => {
  const meter = emptyMeter();
  let reached = 0;
  const inner = {
    id: "mock",
    async *generate() {
      reached++;
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
  const [provider] = windowedProviders([inner], { window: 4_000, meter });
  const request = (chars) => ({
    model: MODEL,
    messages: [{ role: "user", content: [{ type: "text", text: "x ".repeat(chars / 2) }] }],
    tools: [],
  });
  const over = [];
  for await (const chunk of provider.generate(request(20_000))) over.push(chunk);
  assert.equal(over.length, 1);
  assert.equal(over[0].type, "error");
  assert.equal(over[0].error.failureClass, "context_overflow");
  assert.equal(reached, 0);
  assert.equal(meter.overflows, 1);
  for await (const _ of provider.generate(request(400))) void _;
  assert.equal(reached, 1);
  assert.equal(meter.workers.calls, 1, "a request without the workspace tools is a worker call");
});

test("worker_reasoning_effort_reaches_worker_calls_only", async () => {
  // Task 12 (2026-11-20): hy4 ignored "low" and spent the whole 2,048-token output reasoning on most memory-worker calls;
  // a rule's workerReasoningEffort is the default of every arm's worker calls, a worker's own effort wins (STM's retry
  // with thinking off), and the main agent's calls are left alone.
  const seen = [];
  const inner = {
    id: "mock",
    async *generate(request) {
      seen.push(request.options?.compat?.reasoning_effort);
      yield providerDone();
    },
  };
  const [provider] = windowedProviders([inner], { window: 4_000, meter: emptyMeter(), workerReasoningEffort: "low" });
  const message = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  const main = [{ name: "read_file", description: "", parameters: { type: "object" } }];
  for (const [tools, options] of [
    [[], {}],
    [[], { compat: { reasoning_effort: "none" } }],
    [main, { compat: { reasoning_effort: "high" } }],
  ])
    for await (const _ of provider.generate({ model: MODEL, messages: message, tools, options })) void _;
  assert.deepEqual(seen, ["low", "none", "high"]);
});

test("worker_errors_are_counted_apart_from_the_main_agent", async () => {
  // Owner, 2026-11-21: a memory worker's failed call is a live fault, never a score; the meter counts it apart.
  const inner = {
    id: "mock",
    async *generate() {
      yield { type: "error", error: { name: "ProviderError", message: "429" } };
    },
  };
  const meter = emptyMeter();
  const [provider] = windowedProviders([inner], { window: 4_000, meter });
  const message = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  const main = [{ name: "read_file", description: "", parameters: { type: "object" } }];
  for (const tools of [[], main]) for await (const _ of provider.generate({ model: MODEL, messages: message, tools })) void _;
  assert.equal(meter.providerErrors, 2);
  assert.equal(meter.workerErrors, 1);
  assert.deepEqual(meter.workerErrorKinds, { "ProviderError |  |  | 429": 1 });
  // A worker call the session aborted at close (a background pass still in flight) is not a failed worker.
  const aborted = new AbortController();
  aborted.abort(new Error("session closed"));
  const closing = {
    id: "mock",
    async *generate() {
      yield { type: "error", error: { name: "Error", message: "session closed" } };
    },
  };
  const [late] = windowedProviders([closing], { window: 4_000, meter });
  for await (const _ of late.generate({ model: MODEL, messages: message, tools: [], signal: aborted.signal })) void _;
  assert.equal(meter.workerErrors, 1);
  assert.equal(meter.workerAborts, 1);
});

test("a_failed_worker_leaves_no_row", async () => {
  const { workerFailure } = await import("./live.mjs");
  assert.equal(workerFailure({ ...emptyMeter() }), undefined);
  assert.match(workerFailure({ ...emptyMeter(), workerErrors: 2 }), /2 worker calls failed/);
  assert.match(workerFailure({ ...emptyMeter(), stmFallbacks: { output_cap: 1, worker_error: 3 } }), /4 STM batches/);
});

test("worker_output_takes_the_room_the_window_leaves", async () => {
  // Task 12 (owner, 2026-11-20): a worker call may write what W leaves after its input, at most the model's own limit;
  // the main agent keeps the fixed reserve.
  const seen = [];
  const inner = {
    id: "mock",
    async *generate(request) {
      seen.push(request.model.parameters?.maxTokens ?? null);
      yield providerDone();
    },
  };
  const message = [{ role: "user", content: [{ type: "text", text: "x".repeat(4_000) }] }];
  const main = [{ name: "read_file", description: "", parameters: { type: "object" } }];
  const run = async (options) => {
    const [provider] = windowedProviders([inner], { window: 8_000, meter: emptyMeter(), ...options });
    for (const tools of [[], main]) for await (const _ of provider.generate({ model: MODEL, messages: message, tools })) void _;
  };
  await run({ workerOutput: "window" });
  await run({ workerOutput: "window", workerMaxOutputTokens: 3_000 });
  await run({});
  const input = requestTokens({ messages: message, tools: [] });
  assert.deepEqual(seen, [8_000 - input, null, 3_000, null, null, null]);
});

test("stm_fallback_records_are_counted_from_the_ledger", () => {
  const state = (value) => ({ kind: "package_state", data: { key: "memory.session.ledger", value } });
  const entries = [
    state({ type: "observations.recorded", observations: [{ id: "a", fallback: "output_cap" }, { id: "b" }] }),
    state({ type: "observations.recorded", observations: [{ id: "c", fallback: "worker_error" }] }),
    { kind: "package_state", data: { key: "other", value: { observations: [{ fallback: "output_cap" }] } } },
    { kind: "message", message: { role: "user", content: [] } },
  ];
  assert.deepEqual(countStmFallbacks(entries, { output_cap: 0, worker_error: 0 }), { output_cap: 1, worker_error: 1 });
});

test("score_is_blind_to_the_arm", () => {
  const checks = [
    { session: "s1", task: 1, check: "a", class: "C", pass: true },
    { session: "s1", task: 2, check: "b", class: "D2", dep: "dep1", pass: false },
    { session: "s2", task: 1, check: "c", class: "D4", dep: "dep1", pass: true },
  ];
  const score = scoreRows({ checks, tasks: [{ session: "s1", task: 2, rederivations: 2, toolCalls: 5 }] });
  assert.equal(score.overall.tasksPassed, 2);
  assert.equal(score.overall.classes.D2.rate, 0);
  assert.equal(score.overall.rederivations, 2);
  for (const field of ["arm", "configHash"])
    assert.throws(() => scoreRows({ checks: checks.map((row) => ({ ...row, [field]: "STM-only" })) }), /G7/);
  // The same rows score the same under any arm name the runner attaches afterwards.
  const scored = { "memory-off-llm": score, "STM-only": scoreRows({ checks }), "STM+WM": scoreRows({ checks }) };
  const comparisons = compareArms(scored, { iterations: 200 });
  assert.equal(comparisons.length, 3);
  assert.equal(comparisons[1].metrics.task.diff, 0);
  assert.ok(assertCompleteReport({ arms: Object.keys(scored), scores: scored, comparisons }));
  assert.throws(() => assertCompleteReport({ arms: ["amnesic"], scores: scored, comparisons }), /G8/);
});

test("every_arm_completes_one_session_per_template_offline", async () => {
  const report = await runSessionBench({ perTemplate: 1, arms: RUNNABLE_ARMS });
  assert.equal(report.sessions.length, 3);
  for (const arm of RUNNABLE_ARMS) {
    assert.deepEqual(report.faults[arm], [], arm);
    assert.equal(report.cost[arm].overflows, 0, arm);
    assert.ok(report.scores[arm].overall.tasks > 0);
  }
  // The calibration arms bracket the benchmark: the ceiling passes every check, the floor fails every D2/D4.
  assert.equal(report.scores["oracle-context"].overall.taskRate, 1);
  assert.equal(report.scores.amnesic.overall.classes.D2.pass, 0);
  assert.equal(report.scores.amnesic.overall.classes.D4.pass, 0);
  // The memory arms' workers are counted (G9); the report holds ids, counts and hashes only.
  assert.ok(report.cost["STM-only"].workers.calls > 0);
  assert.ok(report.cost["memory-off-llm"].workers.calls > 0);
  const text = JSON.stringify(report);
  for (const session of report.sessions) for (const dep of createSession(session).deps) assert.ok(!text.includes(dep.evidence));
  await assert.rejects(runSessionBench({ partition: "heldout-a" }), /heldout/);
  await assert.rejects(runSessionBench({ offline: false }), /live\.mjs/);
}, 60_000); // whole offline sessions: several seconds each, more on a loaded machine

test("what_leaves_the_window_is_forgotten_by_the_mock", async () => {
  // A compaction summary that carries nothing: the offline model must lose the user-only and superseded facts.
  const session = onePerFamily[0];
  const blank = {
    id: "worker",
    async *generate() {
      yield providerTextDelta("## Progress\nNothing to carry.");
      yield providerDone();
    },
  };
  const run = await runArmSession({
    session,
    arm: "memory-off-llm",
    providers: (state) => [sessionBenchAgentMock(state), blank],
    model: MODEL,
    workerModel: WORKER,
  });
  const failed = (cls) => run.checks.filter((row) => row.class === cls).every((row) => !row.pass);
  assert.ok(failed("D2") && failed("D4"));
  assert.ok(run.checks.filter((row) => row.class === "C").every((row) => row.pass));
  // The same session with the carrying summary keeps them.
  const kept = await runArmSession({
    session,
    arm: "memory-off-llm",
    providers: (state) => [sessionBenchAgentMock(state), sessionBenchWorkerMock()],
    model: MODEL,
    workerModel: WORKER,
  });
  assert.ok(kept.checks.every((row) => row.pass));
});

test("guardrails_pass_before_any_paid_call", async () => {
  const report = await checkGuardrails({ probe: false });
  assert.deepEqual(
    report.guardrails.filter((row) => !row.pass).map((row) => row.id),
    [],
  );
  assert.deepEqual(
    report.guardrails.map((row) => row.id),
    ["G1", "G2", "G3", "G4", "G5", "sizes", "G6", "G7", "G8", "G9", "G10"],
  );
  // A third-party arm off its documented defaults or on another model fails G10.
  const off = await checkGuardrails({ probe: false, thirdPartyArms: [{ id: "x", documentedDefaults: false, model: "same" }] });
  assert.equal(off.guardrails.find((row) => row.id === "G10").pass, false);
}, 60_000); // whole offline sessions: several seconds each, more on a loaded machine

test("workspace_tools_are_deterministic_and_log_rederivations", () => {
  const ws = createWorkspace(dev[0].env);
  ws.task = 1;
  const listing = ws.call("get_config");
  ws.task = 2;
  assert.equal(ws.call("get_config"), listing);
  assert.equal(ws.call("read_file", { path: "../etc/passwd" }), "no such file: ../etc/passwd");
  assert.match(ws.call("set_config", { key: "x", value: { nested: 1 } }), /^error: /);
  assert.deepEqual(
    ws.calls.map((row) => [row.task, row.object, row.read]),
    [
      [1, "config:*", true],
      [2, "config:*", true],
      [2, "file:../etc/passwd", true],
      [2, null, false],
    ],
  );
});

test("prism_arms_match_their_declared_configs", async () => {
  // The decision arms, the side arms and the calibration arms, each once.
  assert.deepEqual([...SESSION_BENCH_ARMS].sort(), [...PRISM_ARMS, ...SIDE_ARMS, ...CALIBRATION_ARMS].sort());
  assert.deepEqual(SIDE_ARMS, ["claude-code-prompt", "codex-prompt", "mem0", "memory-off-drop"]);
  const memory = Object.fromEntries(SESSION_BENCH_ARMS.map((arm) => [arm, armMemoryConfig(arm)]));
  // memory-off-llm: Prism's LLM compaction at its default trigger, kept tail matched to session memory's 20% rule
  // (owner call, 2026-11-18); no memory system.
  assert.deepEqual(memory["memory-off-llm"], {
    package: "@arnilo/prism-extensions/compaction",
    config: { model: "$worker", keepRecentTokens: "$keep" },
    setScope: false,
    freshSessionPerTask: false,
  });
  assert.equal(keepRecentTokens(WINDOW_TOKENS - 2_048), Math.floor((WINDOW_TOKENS - 2_048) * 0.2));
  // STM-only and STM+WM: the same memory-system config; only STM+WM sets the scope (Task 1 decision 4).
  assert.equal(memory["STM-only"].package, "@arnilo/prism-memory-system");
  assert.deepEqual({ ...memory["STM-only"], setScope: true }, memory["STM+WM"]);
  // The references differ from memory-off-llm in the summary prompt alone, pinned by hash.
  for (const arm of REFERENCE_ARMS) {
    const { summaryPrompt, ...rest } = memory[arm].config;
    assert.deepEqual({ ...memory[arm], config: rest }, memory["memory-off-llm"]);
    assert.deepEqual(summaryPrompt, { reference: arm, sha256: REFERENCE_PROMPTS[arm].sha256 });
  }
  // mem0 is memory-off-llm's compaction plus the third-party record, and nothing else.
  const { thirdParty, ...mem0Rest } = memory.mem0;
  assert.deepEqual(mem0Rest, memory["memory-off-llm"]);
  assert.equal(thirdParty, MEM0_ARM_CONFIG);
  // Every arm hashes apart, and every non-calibration arm shares the same treatment (G6).
  const configs = SESSION_BENCH_ARMS.map((arm) => armConfig(arm, sharedConfig()));
  assert.equal(new Set(configs.map(configHash)).size, configs.length);
  assert.match(assertEqualTreatment(configs), /^[0-9a-f]{64}$/);
  // The packages: the calibration arms list none; the others list the compaction package (mem0 adds its block).
  const state = { memoryBlock: null };
  for (const arm of CALIBRATION_ARMS) assert.deepEqual(await armPackages(arm, { workerModel: WORKER, inputCap: 30_000, state }), []);
  assert.equal((await armPackages("memory-off-llm", { workerModel: WORKER, inputCap: 30_000, state })).length, 1);
  assert.equal((await armPackages("mem0", { workerModel: WORKER, inputCap: 30_000, state })).length, 2);
});

test.skipIf(!compactBenchCheckout)("reference_prompts_match_their_pins", () => {
  for (const arm of REFERENCE_ARMS) {
    const text = referencePrompt(arm);
    assert.ok(isReferencePrompt(text), arm);
    assert.ok(!isReferencePrompt(`${text} `));
  }
  assert.match(referencePrompt("claude-code-prompt"), /^Your task is to create a detailed summary/);
  assert.match(referencePrompt("codex-prompt"), /^You are performing a CONTEXT CHECKPOINT COMPACTION/);
});

test("excluded_systems_are_recorded_with_a_reason", () => {
  const criteria = ["licence", "localRuntime", "sameModel", "countableTokens"];
  assert.deepEqual(
    THIRD_PARTY_CANDIDATES.map((row) => row.id),
    ["mem0", "letta", "zep", "graphiti"],
  );
  for (const row of THIRD_PARTY_CANDIDATES) {
    assert.deepEqual(Object.keys(row.criteria), criteria, row.id);
    assert.match(row.version, /\d/, row.id);
    if (row.included) {
      for (const key of criteria) assert.match(row.criteria[key], /^pass/, `${row.id} ${key}`);
      assert.equal(row.reason, undefined);
      assert.ok(SESSION_BENCH_ARMS.includes(row.id));
    } else {
      assert.ok(row.reason && row.reason.length > 40, row.id);
      assert.ok(
        criteria.some((key) => /^(fail|partial|no )/.test(row.criteria[key])),
        row.id,
      );
      assert.ok(!SESSION_BENCH_ARMS.includes(row.id), row.id);
    }
  }
  // G10's input lists exactly the included systems, each at its documented defaults on the same model.
  assert.deepEqual(
    THIRD_PARTY_ARM_SPECS.map((row) => [row.id, row.documentedDefaults, row.model]),
    THIRD_PARTY_ARMS.map((id) => [id, true, "same"]),
  );
});

test("third_party_endpoint_is_local_and_meters_every_call", async () => {
  const meter = emptyMeter();
  const endpoint = startModelEndpoint({
    chat: async ({ messages }) => {
      if (messages.some((message) => message.content === "overflow")) throw new Error("request exceeds the window");
      return { text: "{}", usage: { inputTokens: 5, outputTokens: 1 } };
    },
    embed: (texts) => hashEmbedder(16).embed(texts),
    meter,
  });
  try {
    assert.match(endpoint.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const post = (path, body) =>
      fetch(`${endpoint.baseURL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const embedded = await (await post("/embeddings", { input: ["alpha beta", "gamma"] })).json();
    assert.equal(embedded.data.length, 2);
    assert.equal(embedded.data[0].embedding.length, 16);
    assert.deepEqual(meter.embeddings, { calls: 1, inputTokens: embedded.usage.prompt_tokens });
    const chat = await (await post("/chat/completions", { model: "m", messages: [{ role: "user", content: "hi" }] })).json();
    assert.equal(chat.choices[0].message.content, "{}");
    const refused = await post("/chat/completions", { model: "m", messages: [{ role: "user", content: "overflow" }] });
    assert.equal(refused.status, 400);
    assert.equal(meter.thirdPartyErrors, 1);
  } finally {
    endpoint.stop();
  }
  // The offline embedder is deterministic and normalised.
  const [a, b] = (await hashEmbedder(32).embed(["same words", "same words"])).vectors;
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9);
});

test.skipIf(!mem0.installed)("third_party_arm_runs_offline_on_mock_model", () => mem0OfflineRun(hashEmbedder()));

// Plan 218.3 Task 12: the screen's local embedder (384 dimensions) behind Mem0's vector store, offline.
test.skipIf(!mem0.installed || !localEmbedderStatus().installed)(
  "mem0_runs_offline_with_the_local_embedder",
  async () => {
    const embedder = await localEmbedder();
    try {
      await mem0OfflineRun(embedder);
    } finally {
      embedder.stop();
    }
  },
  600_000,
);

/**
 * Mem0 at its documented defaults on the mock worker: its extraction calls are worker calls through the window (G9),
 * its embeddings are metered apart, and what it retrieves reaches the agent. The compaction summary here carries
 * nothing, so the user-only and superseded facts can only come back through Mem0's retrieval.
 */
async function mem0OfflineRun(embedder) {
  const session = onePerFamily[0];
  const real = sessionBenchWorkerMock();
  let workerCalls = 0;
  let extractions = 0;
  const worker = {
    id: "worker",
    async *generate(request) {
      workerCalls++;
      const system = request.messages.find((message) => message.role === "system")?.content?.[0]?.text ?? "";
      if (system.includes("You are a Memory Extractor")) {
        extractions++;
        yield* real.generate(request);
        return;
      }
      yield providerTextDelta("## Progress\nNothing to carry.");
      yield providerDone();
    },
  };
  let sawBlock = false;
  const run = await runArmSession({
    session,
    arm: "mem0",
    providers: (state) => {
      const agent = sessionBenchAgentMock(state);
      return [
        {
          ...agent,
          async *generate(request) {
            if ((request.context ?? []).some((block) => block.id === "session-bench-third-party")) sawBlock = true;
            yield* agent.generate(request);
          },
        },
        worker,
      ];
    },
    model: MODEL,
    workerModel: WORKER,
    embedder,
  });
  assert.ok(sawBlock);
  assert.equal(extractions, session.tasks.length + 1); // one write per exchange, the scope exchange included
  assert.equal(run.meter.workers.calls, workerCalls);
  assert.ok(run.meter.embeddings.calls > 0 && run.meter.embeddings.inputTokens > 0);
  assert.equal(run.meter.thirdPartyErrors, 0);
  assert.equal(run.meter.overflows, 0);
  const passed = (cls) => run.checks.filter((row) => row.class === cls).every((row) => row.pass);
  assert.ok(passed("D2") && passed("D4"));
  assert.ok(Object.values(run.status).every((row) => row.status === "completed"));
}

test("gate_record_pins_every_arm", async () => {
  // The gate record's sessionBench section is the code's: an arm, prompt, lock or benchmark change shows here first.
  const { sessionBenchPinSection } = await import("./arms/pins.mjs");
  const gate = JSON.parse(
    readFileSync(new URL("../../../docs/_evidence/memory-bench/218/gates/owner-gate-m2.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(gate.sessionBench, await sessionBenchPinSection());
  assert.deepEqual(Object.keys(gate.sessionBench.arms), [...SESSION_BENCH_ARMS]);
});

// --- plan 218.3 Task 11: the live path, offline ------------------------------------------------------------------------

test("live_run_refuses_without_the_owner_approval", async () => {
  const { assertTestGate, SESSION_BENCH_TEST_RULE, testRuleHash, liveConfigHashes } = await import("./live.mjs");
  const live = { sharedConfigHash: liveConfigHashes().sharedConfigHash };
  const approved = {
    sessionBench: { live },
    sessionBenchTest: { approved: true, approvedBy: "owner", text: "yes", ruleHash: testRuleHash(), rule: SESSION_BENCH_TEST_RULE },
  };
  assert.ok(assertTestGate(approved));
  assert.throws(() => assertTestGate({}), /no sessionBenchTest/);
  assert.throws(() => assertTestGate({ ...approved, sessionBenchTest: { ...approved.sessionBenchTest, approved: false } }), /owner's word/);
  const changed = { ...SESSION_BENCH_TEST_RULE, ceilingInputTokens: 1 };
  assert.throws(() => assertTestGate(approved, changed), /differs/);
  assert.throws(() => assertTestGate({ ...approved, sessionBench: { live: { sharedConfigHash: "x" } } }), /G6/);
  // The committed gate record carries this rule and pins its live hashes; the slice is dev only.
  const gate = JSON.parse(
    readFileSync(new URL("../../../docs/_evidence/memory-bench/218/gates/owner-gate-m2.json", import.meta.url), "utf8"),
  );
  assert.equal(gate.sessionBenchTest.ruleHash, testRuleHash());
  assert.deepEqual(gate.sessionBench.live.configHashes, liveConfigHashes().configHashes);
  const dev = new Set(partitionIds(sessionBenchPartitions(), "dev"));
  assert.ok(SESSION_BENCH_TEST_RULE.sessions.every((id) => dev.has(id)));
});

test("quota_waits_never_fail_a_request", async () => {
  const { quotaWaitFetch } = await import("./live.mjs");
  const answers = [429, 503, 200];
  const clock = { waits: 0, waitMs: 0 };
  const slept = [];
  const fetch = quotaWaitFetch(async () => new Response("x", { status: answers.shift() }), {
    waitMs: 1000,
    clock,
    sleep: async (ms) => slept.push(ms),
  });
  assert.equal((await fetch("http://x")).status, 200);
  assert.deepEqual(clock, { waits: 2, waitMs: 2000 });
  // A request the provider refuses as invalid is handed back at once.
  const bad = quotaWaitFetch(async () => new Response("x", { status: 400 }), { waitMs: 1, clock, sleep: async () => {} });
  assert.equal((await bad("http://x")).status, 400);
  assert.equal(clock.waits, 2);
});

test("a_usage_limit_is_never_waited_out", async () => {
  // 2026-11-21: Ollama Cloud's monthly limit answered 429 to every worker call for hours; waiting never clears it.
  const { quotaWaitFetch } = await import("./live.mjs");
  const clock = { waits: 0, waitMs: 0 };
  const lines = [];
  const body = '{"error":"you have reached your monthly usage limit, upgrade for higher limits or add usage credits"}';
  const fetch = quotaWaitFetch(async () => new Response(body, { status: 429 }), {
    waitMs: 1000,
    clock,
    log: (line) => lines.push(line),
    sleep: async () => assert.fail("a usage limit never waits"),
  });
  const response = await fetch("http://x");
  assert.equal(response.status, 429);
  assert.equal(await response.text(), body, "the answer reaches the provider whole");
  assert.equal(clock.usageLimit, 429);
  assert.equal(clock.waits, 0);
  assert.match(lines[0], /usage limit/);
  // Every later request of the job fails at once, so the job ends instead of running on a dead provider.
  await assert.rejects(fetch("http://x"), /SessionBenchUsageLimit/);
  // A 402 naming credits is a usage limit too; a plain 403 is handed back as before.
  const credits = { waits: 0, waitMs: 0 };
  await quotaWaitFetch(async () => new Response("insufficient credits", { status: 402 }), { clock: credits })("http://x");
  assert.equal(credits.usageLimit, 402);
  const plain = { waits: 0, waitMs: 0 };
  assert.equal((await quotaWaitFetch(async () => new Response("forbidden", { status: 403 }), { clock: plain })("http://x")).status, 403);
  assert.equal(plain.usageLimit, undefined);
});

test("a_stop_inside_a_job_is_named_in_the_pause_file", async () => {
  const { haltReason, pauseFile } = await import("./live.mjs");
  const { mkdtempSync, writeFileSync: write } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: joinPath } = await import("node:path");
  const root = mkdtempSync(joinPath(tmpdir(), "sb-halt-"));
  assert.equal(haltReason(root), undefined);
  write(pauseFile(root), "2026-11-21T00:00:00Z owner pause\n");
  assert.equal(haltReason(root), undefined, "a plain pause is not a stop");
  write(pauseFile(root), "2026-11-21T00:00:00Z STOP: STM-only sb-id-02: the memory worker failed this job 3 times\n");
  assert.equal(haltReason(root), "STM-only sb-id-02: the memory worker failed this job 3 times");
});

test("live_report_reads_rows_and_the_live_guardrails", async () => {
  const { liveReport, assertRowHoldsNoText, SESSION_BENCH_TEST_RULE } = await import("./live.mjs");
  const { runArmSession, sessionBenchAgentMock, sessionBenchWorkerMock } = await import("./run.mjs");
  const session = onePerFamily[0];
  const rule = {
    ...SESSION_BENCH_TEST_RULE,
    sessions: [session.id],
    arms: ["memory-off-llm", "STM-only", "STM+WM", "oracle-context", "amnesic"],
  };
  const rows = [];
  for (const arm of rule.arms) {
    const run = await runArmSession({
      session,
      arm,
      providers: (state) => [sessionBenchAgentMock(state), sessionBenchWorkerMock()],
      model: { provider: "mock", model: "main" },
      workerModel: "worker/session-bench",
    });
    const { checks, tasks, status, meter, configHash: hash } = run;
    rows.push(
      assertRowHoldsNoText({
        arm,
        session: session.id,
        checks,
        tasks,
        status,
        meter,
        configHash: hash,
        wallMs: 1,
        quotaWaitMs: 0,
        quotaWaits: 0,
        finishedAt: "t",
      }),
    );
  }
  assert.throws(() => assertRowHoldsNoText({ ...rows[0], text: "model text" }), /not allowed/);
  const report = liveReport(rows, rule);
  assert.equal(report.mode, "live");
  assert.equal(report.complete, true);
  // Offline mocks: the ceiling passes every task, the floor fails every D2 and D4 check.
  assert.equal(report.liveGuardrails.pass, true);
  assert.deepEqual(
    report.liveGuardrails.rows.map((row) => row.id),
    ["oracle-solvable", "amnesic-fails-D2", "amnesic-fails-D4"],
  );
  // A floor that remembers is a miss.
  const { liveGuardrails } = await import("./guardrails.mjs");
  const leaky = structuredClone(report);
  leaky.scores.amnesic.overall.classes.D2 = { pass: 9, total: 10 };
  assert.equal(liveGuardrails(leaky, rule.liveGuardrails).pass, false);
});

test("screen_size_follows_the_measured_variance", async () => {
  const { screenSize, SESSION_BENCH_TEST_RULE } = await import("./live.mjs");
  const sessions = (rates) =>
    Object.fromEntries(rates.map((rate, i) => [`s${i}`, { classes: { D2: { pass: Math.round(rate * 10), total: 10 } } }]));
  const report = (b) => ({
    scores: {
      "memory-off-llm": { sessions: sessions([0.2, 0.2, 0.2, 0.2]) },
      "STM-only": { sessions: sessions(b) },
      "STM+WM": { sessions: sessions(b) },
    },
  });
  const quiet = screenSize(report([0.5, 0.5, 0.6, 0.6]), [], SESSION_BENCH_TEST_RULE);
  const noisy = screenSize(report([0.1, 0.9, 0.2, 0.8]), [], SESSION_BENCH_TEST_RULE);
  assert.ok(quiet.n >= 6 && quiet.fitsDev);
  assert.ok(noisy.n > quiet.n);
  assert.equal(noisy.fitsDev, false);
  assert.match(noisy.verdict, /owner/);
});

test("string_typed_answers_pass_their_checks", async () => {
  // v2 (plan 218.3 Task 11): the tools take strings, so "719" and "false" are the agent's 719 and false.
  const { sameScalar, evaluateCheck } = await import("./checks.mjs");
  assert.ok(sameScalar("719", 719) && sameScalar(719, 719) && sameScalar("false", false) && sameScalar(" true", true));
  assert.ok(!sameScalar("720", 719) && !sameScalar("719", 7190) && !sameScalar(undefined, "undefined") && !sameScalar(null, "null"));
  const state = { config: { k: "719", f: "false" }, tickets: [{ id: "T-1", status: "triaged" }] };
  assert.ok(evaluateCheck({ kind: "config-equals", key: "k", value: 719 }, state, 1));
  assert.ok(!evaluateCheck({ kind: "config-equals", key: "k", value: 718 }, state, 1));
  // Every dev session's oracle still passes, and the amnesic floor still fails D2/D4 (G3, G4 under v2).
  assert.deepEqual(calibrationViolations(partitionIds(sessionBenchPartitions(), "dev").slice(0, 6).map(createSession)), []);
});

test("serial_tool_calls_patch_only_main_agent_requests", async () => {
  const { serialToolCallsFetch } = await import("./live.mjs");
  const seen = [];
  const fetch = serialToolCallsFetch(async (_input, init) => {
    seen.push(init.body);
    return new Response("{}");
  });
  await fetch("u", { body: JSON.stringify({ messages: [], tools: [{ type: "function", function: { name: "read_file" } }] }) });
  await fetch("u", { body: JSON.stringify({ messages: [] }) });
  // A memory worker's tools (STM's record_event, WM's judge) keep parallel calls: they record a batch in one turn.
  await fetch("u", { body: JSON.stringify({ messages: [], tools: [{ type: "function", function: { name: "record_event" } }] }) });
  assert.equal(JSON.parse(seen[0]).parallel_tool_calls, false);
  assert.equal(JSON.parse(seen[1]).parallel_tool_calls, undefined);
  assert.equal(JSON.parse(seen[2]).parallel_tool_calls, undefined);
});

test("pause_stops_new_jobs_and_resume_clears_it", async () => {
  const { pauseFile, isPaused } = await import("./live.mjs");
  const { pool } = await import("../external/loca-bench/pilot.mjs");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "sb-pause-"));
  const ran = [];
  const jobs = [1, 2, 3].map((n) => async () => {
    if (isPaused(root)) throw new Error("SessionBenchPaused");
    ran.push(n);
    if (n === 1) writeFileSync(pauseFile(root), "now"); // a pause raised while job 1 runs
  });
  await pool(jobs, 1, () => {}, { isCeiling: (error) => error?.message === "SessionBenchPaused" });
  assert.deepEqual(ran, [1]);
  rmSync(pauseFile(root));
  assert.equal(isPaused(root), false);
  rmSync(root, { recursive: true, force: true });
});

test("a_partial_live_report_pairs_only_shared_sessions", async () => {
  const { liveReport, SESSION_BENCH_TEST_RULE } = await import("./live.mjs");
  const { runArmSession, sessionBenchAgentMock, sessionBenchWorkerMock } = await import("./run.mjs");
  const rows = [];
  const add = async (arm, session) => {
    const run = await runArmSession({
      session,
      arm,
      providers: (state) => [sessionBenchAgentMock(state), sessionBenchWorkerMock()],
      model: { provider: "mock", model: "main" },
      workerModel: "worker/session-bench",
    });
    const { checks, tasks, status, meter, configHash: hash } = run;
    rows.push({
      arm,
      session: session.id,
      checks,
      tasks,
      status,
      meter,
      configHash: hash,
      wallMs: 1,
      quotaWaitMs: 0,
      quotaWaits: 0,
      finishedAt: "t",
    });
  };
  await add("memory-off-llm", onePerFamily[0]);
  await add("memory-off-llm", onePerFamily[1]);
  await add("STM-only", onePerFamily[0]);
  const rule = { ...SESSION_BENCH_TEST_RULE, sessions: [onePerFamily[0].id, onePerFamily[1].id] };
  const report = liveReport(rows, rule);
  const pair = report.comparisons.find((row) => row.a === "memory-off-llm" && row.b === "STM-only");
  assert.equal(pair.status, "compared");
  assert.equal(pair.sessions, 1);
  assert.equal(report.complete, false);
});

test("stall_guard_ends_silent_requests_and_streams", async () => {
  const { stallGuardFetch, faultedTasks } = await import("./live.mjs");
  // No headers: the request is aborted with a stall error (quotaWaitFetch retries it).
  const silent = stallGuardFetch(
    (_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    { headersMs: 20 },
  );
  await assert.rejects(silent("u", {}), /SessionBenchStall/);
  // A body that stops sending bytes is ended with a stall error.
  const stalled = stallGuardFetch(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("a"));
          },
        }),
      ),
    { idleMs: 20 },
  );
  const response = await stalled("u", {});
  await assert.rejects(response.text(), /SessionBenchStall/);
  // A healthy body passes through.
  const ok = stallGuardFetch(async () => new Response("hello"), { idleMs: 1000 });
  assert.equal(await (await ok("u", {})).text(), "hello");
  // Overflows and run limits are the arm's outcomes; anything else is a fault.
  assert.equal(
    faultedTasks({ 1: { status: "failed", code: "context_overflow" }, 2: { status: "failed", code: "ERR_PRISM_RUN_LIMIT" } }).length,
    0,
  );
  assert.equal(faultedTasks({ 1: { status: "failed", code: "provider_error" }, 2: { status: "failed" } }).length, 2);
});

test("an_embedder_daily_cap_fails_fast_and_is_flagged", async () => {
  const { geminiEmbedder } = await import("./arms/third-party.mjs");
  let calls = 0;
  const embedder = geminiEmbedder({
    apiKey: "test",
    sleep: async () => {},
    fetch: async () => {
      calls++;
      return new Response("Quota exceeded for metric: embed_content_free_tier_requests, Embed content requests per day limit", {
        status: 429,
      });
    },
  });
  await assert.rejects(embedder.embed(["a"]), /daily cap/);
  assert.equal(embedder.dailyCap, true);
  await assert.rejects(embedder.embed(["b"]), /daily cap/);
  assert.equal(calls, 1);
});
