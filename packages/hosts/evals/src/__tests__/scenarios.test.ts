import assert from "node:assert/strict";
import { test } from "bun:test";
import { type Agent, type RunResult, type ModelProvider, createAgent, providerDone, providerTextDelta, providerToolCall } from "@arnilo/prism";
import { defineDataset } from "../dataset.js";
import { runExperiment } from "../experiment.js";
import {
  failureInjection,
  failingStore,
  resolveTrialsConfig,
  runScenario,
  validateEvalManifest,
  validateReleaseEvalManifest,
} from "../scenarios.js";
import { defineScorer } from "../scorer.js";
import { createErrorClassScorer } from "../trajectory.js";
import { providerPackage } from "@arnilo/prism/provider-kit";

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
    packages: [providerPackage("test-provider", [{ id: "mock", async *generate() { yield providerDone(); } }])],
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
  assert.equal(report.trials.uncertaintyMethod, "standard_error");
  assert.equal(report.trials.sampleCount, 3);
  assert.equal(report.trials.standardError, 0);
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
      sampleRate: 0.5,
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
        score: ({ result }) => {
          const toolResults = result.messages
            .flatMap((m) => m.content)
            .filter((c: any) => c.type === "tool_result" && c.name === "refund");
          const ok = toolResults.length > 0 && toolResults.every((r: any) => r.error !== undefined);
          return { score: ok ? 1 : 0, metadata: { invariant: true } };
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
    score: ({ timeline }) => {
      const tools = timeline?.steps.filter((s) => s.kind === "tool") ?? [];
      return {
        score: tools.some((s) => s.status === "succeeded") ? 1 : 0,
        metadata: { invariant: true },
      };
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
      packages: [providerPackage("test-provider", [{
        id: "mock",
        async *generate() {
          yield providerTextDelta("hello");
          yield providerDone();
        },
      }])],
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
    packages: [providerPackage("test-provider", [{ id: "mock", async *generate() { yield providerDone(); } }])],
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
