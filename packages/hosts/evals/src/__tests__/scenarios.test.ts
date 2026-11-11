import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  type AgentConfig,
  createAgent,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type RunResult,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { defineDataset } from "../dataset.js";
import { EvalError } from "../errors.js";
import { runExperiment } from "../experiment.js";
import {
  failingStore,
  failureInjection,
  resolveTrialsConfig,
  runScenario,
  validateEvalManifest,
  validateReleaseEvalManifest,
} from "../scenarios.js";
import { defineScorer } from "../scorer.js";
import { createErrorClassScorer } from "../trajectory.js";

function makeMockAgent(replies: string[], onRun?: () => void): Agent {
  let callIdx = 0;
  return {
    config: {},
    async session() {
      return {
        id: "sess-scenario",
        async run() {
          onRun?.();
          const text = replies[callIdx++] ?? "default reply";
          return {
            sessionId: "sess-scenario",
            runId: `run-${callIdx}`,
            status: "completed",
            text,
            content: [],
            messages: [],
          } as unknown as RunResult;
        },
        subscribe() {
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "run.completed", sessionId: "sess-scenario", runId: `run-${callIdx}` };
            },
          };
        },
      } as never;
    },
  } as unknown as Agent;
}

function oneShotToolProvider(name: string): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield providerToolCall({ type: "tool_call", id: "c1", name, arguments: {} });
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

test("clarify/refuse multi-turn scenario with assertions and scoring", async () => {
  const agent = makeMockAgent(["Could you clarify what account you mean?", "I cannot perform transfers without verified credentials."]);

  let turn1Verified = false;
  let turn2Verified = false;

  const scenarioResult = await runScenario({
    agent,
    turns: [
      {
        user: "Transfer money",
        assertReply: (text) => {
          assert.ok(text.includes("clarify"));
          turn1Verified = true;
        },
      },
      {
        user: "Account 123",
        assertReply: (text) => {
          assert.ok(text.includes("cannot perform"));
          turn2Verified = true;
        },
      },
    ],
    scorers: [
      defineScorer({
        id: "refusal_scorer",
        score: (input) => ({
          score: input.result.text.includes("cannot") ? 1.0 : 0.0,
        }),
      }),
    ],
    timeline: "metadata",
  });

  assert.equal(scenarioResult.status, "succeeded");
  assert.equal(scenarioResult.turnsCompleted, 2);
  assert.ok(turn1Verified);
  assert.ok(turn2Verified);
  assert.equal(scenarioResult.evaluations.length, 1);
  assert.equal(scenarioResult.evaluations[0]?.score, 1.0);
  assert.ok(scenarioResult.timeline);
});

test("store-failure injection fails on run, not createSession", async () => {
  const store = failingStore();
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            yield providerDone();
          },
        },
      ]),
    ],
    slots: { store },
  });
  const session = await agent.session();
  assert.ok(session);
  const result = await session.run("hi");
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "ERR_PRISM_EVAL_STORE_FAILURE");
});

test("eval manifest: two-field still works; release manifest requires binding fields", () => {
  assert.throws(
    () =>
      validateEvalManifest({
        runtimeRevision: "",
        datasetVersion: "1.0",
      }),
    /runtimeRevision/,
  );

  assert.throws(
    () =>
      validateEvalManifest({
        runtimeRevision: "rev-1",
        datasetVersion: "",
      }),
    /datasetVersion/,
  );

  assert.doesNotThrow(() =>
    validateEvalManifest({
      runtimeRevision: "2026-09-01",
      datasetVersion: "1.0.0",
    }),
  );

  const twoField = { runtimeRevision: "0.7.0", datasetVersion: "1.0" };
  assert.throws(() => validateReleaseEvalManifest(twoField), /promptVersion/);
  assert.throws(
    () =>
      validateReleaseEvalManifest({
        ...twoField,
        promptVersion: "p1",
      }),
    /toolFingerprint/,
  );
  assert.throws(
    () =>
      validateReleaseEvalManifest({
        ...twoField,
        promptVersion: "p1",
        toolFingerprint: "tf",
      }),
    /model/,
  );
  assert.throws(
    () =>
      validateReleaseEvalManifest({
        ...twoField,
        promptVersion: "p1",
        toolFingerprint: "tf",
        model: "m",
      }),
    /policyRevision/,
  );
  assert.doesNotThrow(() =>
    validateReleaseEvalManifest({
      ...twoField,
      promptVersion: "p1",
      toolFingerprint: "tf",
      model: "m",
      policyRevision: "pol",
      datasetContentHash: `sha256:${"a".repeat(64)}`,
    }),
  );
});

test("repeated-trial aggregate runs N times with sampleCount and standard_error", async () => {
  let runs = 0;
  const agent = makeMockAgent(["reply 1", "reply 2", "reply 3"], () => {
    runs += 1;
  });
  const dataset = defineDataset({
    id: "trials-ds",
    items: [{ id: "item-1", input: "test" }],
  });

  const scorer = defineScorer({
    id: "len_scorer",
    score: (input) => ({ score: input.result.text.length > 0 ? 1 : 0 }),
  });

  const report = await runExperiment({
    agent,
    dataset,
    scorers: [scorer],
    trials: 3,
    seed: 42,
    manifest: {
      runtimeRevision: "0.7.0",
      datasetVersion: "1.0",
    },
  });

  assert.equal(report.status, "succeeded");
  assert.equal(runs, 3);
  assert.equal(report.evaluations.length, 3);
  assert.equal(report.evaluations[0]?.metadata?.trialIndex, 0);
  assert.equal(report.evaluations[2]?.metadata?.trialIndex, 2);
  assert.ok(report.trials);
  assert.equal(report.trials.count, 3);
  assert.equal(report.trials.seed, 42);
  assert.equal(report.trials.sampleCount, 3);
});

test("omitted trials still one run; cap 16 fails closed", async () => {
  let runs = 0;
  const agent = makeMockAgent(["ok"], () => {
    runs += 1;
  });
  const dataset = defineDataset({
    id: "once",
    items: [{ id: "1", input: "x" }],
  });
  const scorer = defineScorer({ id: "s", score: () => ({ score: 1 }) });
  const report = await runExperiment({ agent, dataset, scorers: [scorer] });
  assert.equal(runs, 1);
  assert.equal(report.trials, undefined);
  assert.equal(report.evaluations[0]?.metadata?.trialIndex, undefined);

  assert.throws(() => resolveTrialsConfig(17), /trials must be an integer/);
  await assert.rejects(() => runExperiment({ agent, dataset, scorers: [scorer], trials: 17 }), /trials must be an integer/);
});

test("seed drives experiment random, not LLM determinism", async () => {
  const dataset = defineDataset({
    id: "rng",
    items: [{ id: "1", input: "x" }],
  });
  const scorer = defineScorer({ id: "s", score: () => ({ score: 1 }) });
  const run = (seed: number) =>
    runExperiment({
      agent: makeMockAgent(["a", "b", "c", "d", "e", "f", "g", "h"]),
      dataset,
      scorers: [scorer],
      trials: 8,
      seed,
      sampling: { rate: 0.5 },
    });
  const a = await run(1);
  const b = await run(1);
  const c = await run(2);
  assert.deepEqual(
    a.evaluations.map((e) => e.sampled),
    b.evaluations.map((e) => e.sampled),
  );
  assert.notDeepEqual(
    a.evaluations.map((e) => e.sampled),
    c.evaluations.map((e) => e.sampled),
  );
});

test("seeded_sampling_is_identical_across_concurrency", async () => {
  const dataset = defineDataset({
    id: "seeded",
    items: Array.from({ length: 12 }, (_, index) => ({ id: `i${index}`, input: `x${index}` })),
  });
  const scorer = defineScorer({ id: "s", score: () => ({ score: 1 }) });
  const run = async (concurrency: number) => {
    const report = await runExperiment({
      // Fresh agent per trial: the factory also receives the (absent) hooks/slots.
      agent: async () => makeMockAgent(["ok"]),
      dataset,
      scorers: [scorer],
      trials: 2,
      seed: 7,
      sampling: { rate: 0.5 },
      concurrency,
    });
    return report.evaluations.map((record) => `${record.itemId}#${String(record.metadata?.trialIndex)}:${record.sampled}`).sort();
  };
  const serial = await run(1);
  const parallel = await run(8);
  assert.deepEqual(parallel, serial, "per-trial streams must not depend on scheduling order");
  assert.equal(serial.length, 24);
  assert.ok(
    serial.some((entry) => entry.endsWith(":true")),
    "some trials are sampled",
  );
  assert.ok(
    serial.some((entry) => entry.endsWith(":false")),
    "some trials are skipped",
  );
});

test("abort_keeps_finished_item_results", async () => {
  const dataset = defineDataset({
    id: "abort",
    items: Array.from({ length: 5 }, (_, index) => ({ id: `i${index}`, input: `x${index}` })),
  });
  const controller = new AbortController();
  let finished = 0;
  const report = await runExperiment({
    agent: makeMockAgent(["ok"]),
    dataset,
    scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
    concurrency: 1,
    signal: controller.signal,
    onItem: () => {
      finished += 1;
      if (finished === 2) controller.abort(new Error("stop now"));
    },
  });
  assert.equal(finished, 2);
  assert.equal(report.status, "aborted");
  assert.equal(report.items.length, 5);
  assert.equal(report.items.filter((item) => item.result !== undefined).length, 2, "finished work survives the abort");
  assert.equal(report.evaluations.length, 2);
  assert.equal(report.aggregate.scoredCount, 2);
  assert.equal(report.aggregate.itemCount, 5);
  // Unstarted items name the abort instead of reporting an unrelated failure.
  for (const item of report.items.slice(2)) {
    assert.equal(item.result, undefined);
    assert.match(item.error?.message ?? "", /stop now/);
    assert.equal(item.evaluations.length, 0);
  }
});

test("experiment_factory_receives_failure_injection_hooks", async () => {
  const dataset = defineDataset({ id: "inject", items: [{ id: "i", input: "refund" }] });
  const scorers = [defineScorer({ id: "s", score: () => ({ score: 1 }) })];
  let ran = 0;
  const agentFor = async (extra: Pick<AgentConfig, "hooks" | "slots">) =>
    await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [oneShotToolProvider("refund")])],
      tools: {
        add: [
          {
            name: "refund",
            description: "refund",
            parameters: { type: "object", properties: {} },
            async execute(_args, ctx) {
              ran += 1;
              return { toolCallId: ctx.toolCallId, name: "refund", value: { ok: true } };
            },
          },
        ],
      },
      ...extra,
    });

  const denied = await runExperiment({
    agent: agentFor,
    hooks: failureInjection({ denyTools: ["refund"] }),
    dataset,
    scorers,
    timeline: "metadata",
  });
  assert.equal(ran, 0, "the injected deny reached the factory-built agent");
  const toolResults = (denied.items[0]?.result?.messages ?? [])
    .flatMap((message) => message.content)
    .filter((block) => block.type === "tool_result")
    .map((block) => (block as { error?: { code?: string } }).error);
  assert.equal(toolResults[0]?.code, "hook_denied");

  // A hook-level deny stops the call before the tool pipeline, so the kernel emits no timeline step
  // for it (only effect-level blocks do). The transcript error is the observable signal.
});

test("hooks_with_agent_instance_throws", async () => {
  const dataset = defineDataset({ id: "d", items: [{ id: "1", input: "x" }] });
  const scorers = [defineScorer({ id: "s", score: () => ({ score: 1 }) })];
  for (const extra of [{ hooks: failureInjection({ denyTools: ["x"] }) }, { slots: {} }]) {
    await assert.rejects(
      () => runExperiment({ agent: makeMockAgent(["ok"]), dataset, scorers, ...extra }),
      (error: unknown) => error instanceof EvalError && error.code === "ERR_PRISM_EVAL_EXPERIMENT",
    );
  }
});

test("too_many_turns_throws_before_run", async () => {
  let factoryCalls = 0;
  const scenario = {
    turns: ["one", "two", "three"],
    maxTurns: 2,
    scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
  };
  const factory = async (extra: Pick<AgentConfig, "hooks" | "slots">) => {
    factoryCalls += 1;
    return createAgent({ model: { provider: "mock", model: "demo" }, ...extra });
  };
  await assert.rejects(
    () => runScenario(scenario, factory),
    (error: unknown) => error instanceof EvalError && error.code === "ERR_PRISM_EVAL_SCENARIO_BOUNDS",
  );
  await assert.rejects(
    () => runScenario({ ...scenario, maxTurns: 33 }, factory),
    (error: unknown) => error instanceof EvalError && error.code === "ERR_PRISM_EVAL_SCENARIO_BOUNDS",
  );
  assert.equal(factoryCalls, 0, "the bound is checked before the agent is built");
});

test("aborted_final_run_reports_aborted", async () => {
  const abortedAgent = {
    config: {},
    async session() {
      return {
        id: "sess-abort",
        async run() {
          return {
            sessionId: "sess-abort",
            runId: "run-1",
            status: "aborted",
            text: "",
            content: [],
            messages: [],
          } as unknown as RunResult;
        },
        subscribe() {
          return { async *[Symbol.asyncIterator]() {} };
        },
      } as never;
    },
  } as unknown as Agent;
  const result = await runScenario({
    agent: abortedAgent,
    turns: ["hi"],
    scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
  });
  assert.equal(result.status, "aborted");

  const controller = new AbortController();
  controller.abort(new Error("host abort"));
  const signalled = await runScenario({
    agent: abortedAgent,
    turns: ["hi", "again"],
    signal: controller.signal,
  });
  assert.equal(signalled.status, "aborted");
  assert.equal(signalled.turnsCompleted, 0);
});

test("assertReply_failure_stops_scenario_with_code", async () => {
  let runs = 0;
  const agent = makeMockAgent(["first", "second", "third"], () => {
    runs += 1;
  });
  const result = await runScenario({
    agent,
    turns: ["a", { user: "b", assertReply: () => assert.fail("refused") }, "c"],
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "ERR_PRISM_EVAL_SCENARIO_ASSERTION");
  assert.match(result.error?.message ?? "", /turn 2 assertReply failed/);
  assert.equal(result.turnsCompleted, 2, "the failing turn is counted, later turns never run");
  assert.equal(runs, 2);
});

test("score_each_turn_records_turn_index", async () => {
  const agent = makeMockAgent(["alpha", "beta", "gamma"]);
  const scorer = defineScorer({
    id: "seen",
    score: ({ result }) => ({ score: result.text.length > 0 ? 1 : 0 }),
  });
  const each = await runScenario({
    agent,
    turns: ["one", "two", "three"],
    scorers: [scorer],
    scoreTurns: "each",
    timeline: "metadata",
  });
  assert.equal(each.evaluations.length, 3);
  assert.deepEqual(
    each.evaluations.map((record) => record.metadata?.turnIndex),
    [0, 1, 2],
  );
  assert.equal(
    each.evaluations.every((record) => record.status === "scored"),
    true,
  );

  const last = await runScenario({
    agent: makeMockAgent(["alpha", "beta", "gamma"]),
    turns: ["one", "two", "three"],
    scorers: [scorer],
    timeline: "metadata",
  });
  assert.equal(last.evaluations.length, 1);
  assert.equal(last.evaluations[0]?.metadata?.turnIndex, undefined);
});

test("corrupt manifest in runExperiment throws EvalError", async () => {
  const agent = makeMockAgent(["reply"]);
  const dataset = defineDataset({
    id: "ds",
    items: [{ id: "1", input: "x" }],
  });

  await assert.rejects(
    () =>
      runExperiment({
        agent,
        dataset,
        scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
        manifest: {
          runtimeRevision: "",
          datasetVersion: "1",
        },
      }),
    /runtimeRevision/,
  );
});

test("denyTools skips execute and appears as failed, not succeeded", async () => {
  let ran = 0;
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [oneShotToolProvider("refund")])],
    hooks: failureInjection({ denyTools: ["refund"] }),
    tools: {
      add: [
        {
          name: "refund",
          description: "refund",
          parameters: { type: "object", properties: {} },
          async execute(_args, ctx) {
            ran += 1;
            return { toolCallId: ctx.toolCallId, name: "refund", value: { ok: true } };
          },
        },
      ],
    },
  });
  const report = await runExperiment({
    agent,
    dataset: defineDataset({ id: "deny", items: [{ id: "i", input: "refund" }] }),
    scorers: [
      defineScorer({
        id: "denied_visible",
        invariant: true,
        score: ({ result }) => {
          const toolResults = result.messages.flatMap((m) => m.content).filter((c: any) => c.type === "tool_result" && c.name === "refund");
          const ok = toolResults.length > 0 && toolResults.every((r: any) => r.error !== undefined);
          return { score: ok ? 1 : 0 };
        },
      }),
    ],
    timeline: "metadata",
  });
  assert.equal(ran, 0);
  assert.equal(report.evaluations[0]?.score, 1);
});

test("unknownEffect marks unknown and fails effect-success invariant", async () => {
  let ran = 0;
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [oneShotToolProvider("mutate")])],
    hooks: failureInjection({ unknownEffect: true }),
    tools: {
      add: [
        {
          name: "mutate",
          description: "mutate",
          parameters: { type: "object", properties: {} },
          effect: { kind: "external_mutation", idempotency: "none" },
          async execute(_args, ctx) {
            ran += 1;
            return { toolCallId: ctx.toolCallId, name: "mutate", value: { ok: true } };
          },
        },
      ],
    },
  });
  const success = defineScorer({
    id: "effect_success",
    invariant: true,
    score: ({ timeline }) => {
      const tools = timeline?.steps.filter((s) => s.kind === "tool") ?? [];
      return { score: tools.some((s) => s.status === "succeeded") ? 1 : 0 };
    },
  });
  const report = await runExperiment({
    agent,
    dataset: defineDataset({ id: "unk", items: [{ id: "i", input: "go" }] }),
    scorers: [success, createErrorClassScorer({ id: "unknown", deny: ["ERR_PRISM_TOOL_EFFECT_UNKNOWN"] })],
    timeline: "metadata",
  });
  assert.equal(ran, 0);
  assert.equal(report.evaluations.find((e) => e.scorerId === "effect_success")?.score, 0);
  assert.equal(report.aggregate.invariantsPassed, false);
});

test("timeline collector captures agent_finished without a 10ms drain", async () => {
  const report = await runExperiment({
    agent: await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              yield providerTextDelta("hello");
              yield providerDone();
            },
          },
        ]),
      ],
    }),
    dataset: defineDataset({ id: "tl", items: [{ id: "i", input: "hi" }] }),
    scorers: [
      defineScorer({
        id: "has_timeline",
        score: ({ timeline }) => ({ score: timeline && timeline.steps.length > 0 ? 1 : 0 }),
      }),
    ],
    timeline: "metadata",
  });
  assert.equal(report.evaluations[0]?.score, 1);
});

test("failure_injection_denies_through_tool_call: a denied tool never executes, and tool.call observers see the deny", async () => {
  let executed = 0;
  let observerSawDeny = false;

  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [oneShotToolProvider("danger")])],
    hooks: (hooks) => {
      failureInjection({ denyTools: ["danger"] })(hooks);
      hooks.on("tool.call", (payload) => {
        if (payload.name === "danger") {
          observerSawDeny = true;
        }
        return undefined;
      });
    },
    tools: {
      add: [
        {
          name: "danger",
          parameters: { type: "object", properties: {} },
          async execute(_args, ctx) {
            executed += 1;
            return { toolCallId: ctx.toolCallId, name: "danger", value: { done: true } };
          },
        },
      ],
    },
  });

  const session = await agent.session();
  const result = await session.run("perform danger");

  assert.equal(executed, 0, "denied tool must never execute");
  assert.equal(observerSawDeny, true, "tool.call observer must see the call");
  const toolResults = result.messages.flatMap((m) => m.content).filter((b) => b.type === "tool_result");
  assert.ok(toolResults.length > 0);
  assert.ok(toolResults.some((r) => r.error !== undefined));
});

test("failure_injection_unknown_effect_skips_execute: mutating execute is never called, and result is unknown", async () => {
  let executed = 0;

  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [oneShotToolProvider("mutate")])],
    hooks: failureInjection({ unknownEffect: true }),
    tools: {
      add: [
        {
          name: "mutate",
          parameters: { type: "object", properties: {} },
          effects: ["write"],
          async execute(_args, ctx) {
            executed += 1;
            return { toolCallId: ctx.toolCallId, name: "mutate", value: { done: true } };
          },
        },
      ],
    },
  });

  const session = await agent.session();
  const result = await session.run("perform mutate");

  assert.equal(executed, 0, "mutating execute must not be called");
  const toolResults = result.messages.flatMap((m) => m.content).filter((b) => b.type === "tool_result");
  assert.ok(toolResults.length > 0);
  assert.equal(toolResults[0]?.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
});

test("failing_store_fails_first_append", async () => {
  const store = failingStore();
  await assert.rejects(() => store.append({} as never), /injected store failure/);

  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            yield providerDone();
          },
        },
      ]),
    ],
    slots: { store },
  });
  const session = await agent.session();
  const result = await session.run("test append");
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "ERR_PRISM_EVAL_STORE_FAILURE");
});

test("scenario_runner_builds_agent_through_factory: factory is called once per scenario, and no agent is spread", async () => {
  let factoryCalls = 0;
  const result = await runScenario(
    {
      turns: [
        {
          user: "turn 1",
          assertReply: (text) => assert.equal(text, "done"),
        },
      ],
    },
    async (extra) => {
      factoryCalls += 1;
      return createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [
          providerPackage("test-provider", [
            {
              id: "mock",
              async *generate() {
                yield providerTextDelta("done");
                yield providerDone();
              },
            },
          ]),
        ],
        ...extra,
      });
    },
  );

  assert.equal(factoryCalls, 1, "agent factory must be called once");
  assert.equal(result.status, "succeeded");
  assert.equal(result.turnsCompleted, 1);
});

test("release_manifest_requires_content_hash_and_must_match_report", () => {
  const manifest = {
    runtimeRevision: "r",
    datasetVersion: "1",
    promptVersion: "p",
    toolFingerprint: "t",
    model: "m",
    policyRevision: "pol",
  };
  assert.throws(() => validateReleaseEvalManifest(manifest), /datasetContentHash/);
  const hash = defineDataset({ id: "d", items: [] }).contentHash;
  const bound = { ...manifest, datasetContentHash: hash };
  assert.doesNotThrow(() => validateReleaseEvalManifest(bound, { datasetContentHash: hash } as never));
  assert.throws(
    () => validateReleaseEvalManifest(bound, { datasetContentHash: `sha256:${"b".repeat(64)}` } as never),
    /datasetContentHash/,
  );
  assert.throws(() => validateReleaseEvalManifest(bound, {} as never), /datasetContentHash/);
});

test("scenario_item_runs_with_trials and records carry item, trial, and turn", async () => {
  let sessions = 0;
  const agent = makeMockAgent(["a", "b", "c", "d"]);
  const factory = async () => {
    sessions++;
    return agent;
  };
  const dataset = defineDataset({
    id: "conversations",
    items: [
      {
        id: "chat",
        input: {
          kind: "scenario",
          turns: ["hello", "again"],
          scoreTurns: "each",
        },
      },
    ],
  });
  const environments: string[] = [];
  const report = await runExperiment({
    agent: factory,
    dataset,
    trials: 2,
    timeline: "metadata",
    toEnvironment: (_item, result) => {
      environments.push(result!.text);
      return result!.text;
    },
    scorers: [
      defineScorer({
        id: "reply",
        requires: ["environment"],
        score: (input) => ({ score: input.environment === input.result.text ? 1 : 0 }),
      }),
    ],
  });
  assert.equal(sessions, 2);
  assert.deepEqual(environments, ["a", "b", "c", "d"]);
  assert.equal(report.evaluations.length, 4);
  assert.deepEqual(
    report.evaluations.map((r) => [r.itemId, r.metadata?.trialIndex, r.metadata?.turnIndex]),
    [
      ["chat", 0, 0],
      ["chat", 0, 1],
      ["chat", 1, 0],
      ["chat", 1, 1],
    ],
  );
  assert.equal(report.aggregate.scorers.reply?.mean, 1);
});

test("scenario_item_with_both_turns_and_user_throws before creating agent", async () => {
  let built = false;
  const dataset = defineDataset({
    id: "invalid",
    items: [
      {
        id: "chat",
        input: {
          kind: "scenario",
          turns: ["hello"],
          user: { persona: "customer", goal: "refund" },
        },
      },
    ],
  });
  await assert.rejects(
    runExperiment({
      agent: async () => {
        built = true;
        return makeMockAgent([]);
      },
      dataset,
      scorers: [defineScorer({ id: "ok", score: () => ({ score: 1 }) })],
    }),
    /exactly one/,
  );
  assert.equal(built, false);
});

test("scenario item on agent instance uses fresh sessions and scores last turn", async () => {
  const agent = makeMockAgent(["a", "b", "c", "d"]);
  const original = agent.session.bind(agent);
  let sessions = 0;
  agent.session = async (...args) => {
    sessions++;
    return original(...args);
  };
  const report = await runExperiment({
    agent,
    trials: 2,
    dataset: defineDataset({ id: "last", items: [{ id: "chat", input: { kind: "scenario", turns: ["one", "two"] } }] }),
    scorers: [defineScorer({ id: "ok", score: (input) => ({ score: ["b", "d"].includes(input.result.text) ? 1 : 0 }) })],
  });
  assert.equal(sessions, 2);
  assert.equal(report.evaluations.length, 2);
  assert.equal(report.aggregate.scorers.ok?.mean, 1);
});

test("scenario items forward factory options and slice timelines without losing trial usage", async () => {
  let calls = 0;
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      calls++;
      yield providerTextDelta("reply");
      yield providerDone({ inputTokens: 2, outputTokens: 3, totalTokens: 5, cost: 0.01, currency: "USD" });
    },
  };
  const hooks: AgentConfig["hooks"] = () => {};
  const slots: AgentConfig["slots"] = {};
  let seenTurns = 0;
  const report = await runExperiment({
    agent: async (extra) => {
      assert.equal(extra.hooks, hooks);
      assert.equal(extra.slots, slots);
      return createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        ...extra,
      });
    },
    hooks,
    slots,
    timeline: "metadata",
    trials: 2,
    dataset: defineDataset({
      id: "timeline",
      items: [
        {
          id: "chat",
          input: {
            kind: "scenario",
            turns: ["one", "two"],
            scoreTurns: "each",
          },
        },
      ],
    }),
    scorers: [
      defineScorer({
        id: "turn",
        requires: ["timeline"],
        score: (input) => {
          seenTurns++;
          assert.equal(input.timeline!.steps.filter((step) => step.kind === "turn").length, 1);
          return { score: 1 };
        },
      }),
    ],
  });
  assert.equal(report.items[0]?.error, undefined);
  assert.equal(calls, 4);
  assert.equal(seenTurns, 4);
  assert.equal(report.aggregate.scorers.turn?.mean, 1);
  assert.equal(report.aggregate.cost?.totalTokens, 20);
  assert.equal(report.aggregate.cost?.costComplete, true);
  assert.equal(report.aggregate.cost?.cost, 0.04);
});

test("scenario bounds and invalid scoring mode fail before running", async () => {
  for (const input of [
    { kind: "scenario", turns: ["one", "two"], maxTurns: 1 },
    { kind: "scenario", turns: ["one"], scoreTurns: "sometimes" },
    { kind: "scenario" },
  ]) {
    await assert.rejects(
      runExperiment({
        agent: makeMockAgent([]),
        dataset: defineDataset({ id: "bad", items: [{ id: "bad", input }] }),
        scorers: [defineScorer({ id: "ok", score: () => ({ score: 1 }) })],
      }),
      (error) => error instanceof EvalError && error.code === "ERR_PRISM_EVAL_SCENARIO_BOUNDS",
    );
  }
});

test("scenario stops on failed run and forwards ownership, redaction, and run options per turn", async () => {
  const agent = makeMockAgent([]);
  let calls = 0;
  const ownership = { tenantId: "owner" };
  agent.session = async () =>
    ({
      async run(_input: unknown, options: Record<string, unknown>) {
        calls++;
        assert.equal(options.ownership, ownership);
        assert.equal(options.thinkingLevel, "low");
        return {
          sessionId: "session",
          runId: "run",
          status: "failed",
          text: "private-token",
          content: [],
          messages: [],
        } as unknown as RunResult;
      },
      subscribe() {
        return { async *[Symbol.asyncIterator]() {} };
      },
    }) as never;
  const report = await runExperiment({
    agent,
    ownership,
    secrets: ["private-token"],
    runOptions: { thinkingLevel: "low" },
    dataset: defineDataset({ id: "failure", items: [{ id: "chat", input: { kind: "scenario", turns: ["first", "must not run"] } }] }),
    scorers: [
      defineScorer({
        id: "redactor",
        score: (input) => {
          assert.ok(input.redactor);
          assert.ok(!input.redactor.redact(input.result.text).includes("private-token"));
          return { score: 1 };
        },
      }),
    ],
  });
  assert.equal(calls, 1);
  assert.equal(report.status, "failed");
  assert.equal(report.items[0]?.trials[0]?.status, "failed");
  assert.equal(report.items[0]?.trials[0]?.costComplete, false);
  assert.equal(report.aggregate.scorers.redactor?.mean, 1);
});
