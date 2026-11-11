import { test } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, providerDone, providerTextDelta, type ProviderRequest } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createUserSimulator, defineDataset, runExperiment, runScenario } from "../index.js";

async function agent(replies: string[], requests: ProviderRequest[] = []) {
  return createAgent({
    model: { provider: "mock", model: "sim" },
    packages: [
      mockProvider(
        replies.map((text) => [providerTextDelta(text), providerDone()]),
        { onRequest: (r) => requests.push(r) },
      ),
    ],
  });
}
const scorer = {
  id: "ok",
  score() {
    return { score: 1 };
  },
};

test("simulator_stops_on_token", async () => {
  const requests: ProviderRequest[] = [];
  const sim = await agent(["Refund please", "###DONE###"], requests);
  const target = await agent(["Refunded"]);
  try {
    const user = createUserSimulator({ agent: sim, persona: "terse customer", goal: "Get refund" });
    const result = await runScenario({ agent: target, user, scorers: [scorer] });
    assert.equal(result.status, "succeeded");
    assert.equal(result.turnsCompleted, 1);
    assert.equal(result.simulation?.stopReason, "goal_reached");
    assert.deepEqual(result.simulation?.turns, [{ user: "Refund please", assistant: "Refunded" }]);
    assert.match(JSON.stringify(requests[1]), /Refunded/);
    assert.ok(requests.every((r) => !r.tools?.length));
  } finally {
    await sim.dispose();
    await target.dispose();
  }
});

test("simulator_stops_at_max_turns", async () => {
  const sim = await agent(["One", "Two"]);
  const target = await agent(["A", "B"]);
  try {
    const result = await runScenario({ agent: target, user: createUserSimulator({ agent: sim, persona: "p", goal: "g", maxTurns: 2 }) });
    assert.equal(result.turnsCompleted, 2);
    assert.equal(result.simulation?.stopReason, "max_turns");
  } finally {
    await sim.dispose();
    await target.dispose();
  }
});

test("simulator_never_sees_expected_and_redacts_replies", async () => {
  const requests: ProviderRequest[] = [];
  const sim = await agent(["Hi", "###DONE###", "Hi", "###DONE###"], requests);
  const target = await agent(["SECRET", "SECRET"]);
  try {
    const user = createUserSimulator({ agent: sim, persona: "p", goal: "g" });
    const dataset = defineDataset({
      id: "d",
      items: [{ id: "i", input: { kind: "scenario" as const, user }, expected: "HIDDEN_EXPECTED" }],
    });
    const report = await runExperiment({
      agent: target,
      dataset,
      scorers: [scorer],
      trials: 2,
      secrets: ["SECRET"],
      toEnvironment: () => "HIDDEN_ENV",
    });
    assert.equal(report.status, "succeeded");
    assert.equal(report.evaluations.length, 2);
    assert.doesNotMatch(JSON.stringify(requests), /HIDDEN_EXPECTED|HIDDEN_ENV|SECRET/);
    assert.match(JSON.stringify(requests), /REDACTED/);
  } finally {
    await sim.dispose();
    await target.dispose();
  }
});

test("simulator_failure_is_not_agent_failure", async () => {
  for (const scoreTurns of ["last", "each"] as const) {
    const sim = await agent(["Hi", " "]);
    const target = await agent(["Reply"]);
    let scored = 0;
    try {
      const user = createUserSimulator({ agent: sim, persona: "p", goal: "g" });
      const result = await runScenario({
        agent: target,
        user,
        scoreTurns,
        scorers: [
          {
            id: "s",
            score() {
              scored++;
              return { score: 0 };
            },
          },
        ],
      });
      assert.equal(result.status, "failed");
      assert.equal(result.error?.code, "ERR_PRISM_EVAL_USER_SIMULATOR");
      assert.equal(result.evaluations[0]?.status, "skipped");
      assert.equal(result.evaluations[0]?.reason, "ERR_PRISM_EVAL_USER_SIMULATOR");
      assert.equal(scored, 0);
    } finally {
      await sim.dispose();
      await target.dispose();
    }
  }
});

test("simulator_failure_before_first_turn_skips_persisted_experiment_scores", async () => {
  const { createMemoryEvaluationStore } = await import("@arnilo/prism-extensions/store-codecs");
  for (const scoreTurns of ["last", "each"] as const) {
    const sim = await agent([" "]);
    const target = await agent(["Unused"]);
    const store = createMemoryEvaluationStore();
    try {
      const user = createUserSimulator({ agent: sim, persona: "p", goal: "g" });
      const report = await runExperiment({
        agent: target,
        store,
        dataset: defineDataset({ id: "d", items: [{ id: "i", input: { kind: "scenario", user, scoreTurns } }] }),
        scorers: [{ id: "s", score: () => assert.fail("must skip") }],
      });
      assert.equal(report.status, "failed");
      assert.equal(report.items[0]?.error?.code, "ERR_PRISM_EVAL_USER_SIMULATOR");
      assert.equal(report.items[0]?.result, undefined);
      assert.equal(report.evaluations[0]?.status, "skipped");
      assert.equal(report.evaluations[0]?.itemId, "i");
      assert.equal(report.aggregate.failedCount, 0);
      assert.equal(report.aggregate.skippedCount, 1);
      assert.equal((await store.query()).items.length, 1);
    } finally {
      await sim.dispose();
      await target.dispose();
    }
  }
});

test("simulator_agent_stopped_and_initial_stop", async () => {
  for (const initialStop of [false, true]) {
    const requests: ProviderRequest[] = [];
    const sim = await agent([initialStop ? "###DONE###" : "Hi"], requests);
    const target = await agent(["Reply"]);
    const wrapped = {
      ...target,
      session: async () => {
        const session = await target.session();
        return {
          ...session,
          run: async (...args: Parameters<typeof session.run>) => ({ ...(await session.run(...args)), status: "suspended" as const }),
        };
      },
    };
    try {
      const result = await runScenario({ agent: wrapped, user: createUserSimulator({ agent: sim, persona: "p", goal: "g" }) });
      assert.equal(result.simulation?.stopReason, initialStop ? "goal_reached" : "agent_stopped");
      assert.equal(result.turnsCompleted, initialStop ? 0 : 1);
      assert.equal(requests.length, 1);
    } finally {
      await sim.dispose();
      await target.dispose();
    }
  }
});

test("simulator_timeout_and_fresh_toolless_session_lifecycle", async () => {
  const target = await agent(["Reply"]);
  let opened = 0,
    closed = 0;
  const sim = {
    config: { model: { provider: "mock", model: "timeout" } },
    session: async () => {
      opened++;
      return {
        run: async (_prompt: string, options: import("@arnilo/prism").RunOptions) => {
          assert.deepEqual(options.tools, { only: [] });
          assert.equal(options.limits?.maxTurns, 1);
          assert.equal(options.limits?.maxProviderAttempts, 1);
          return new Promise<never>((_, reject) =>
            options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }),
          );
        },
        close: async () => {
          closed++;
        },
      };
    },
  } as unknown as import("@arnilo/prism").Agent;
  try {
    const result = await runScenario({
      agent: target,
      user: createUserSimulator({ agent: sim, persona: "p", goal: "g", timeoutMs: 5 }),
      scorers: [scorer],
    });
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "ERR_PRISM_EVAL_USER_SIMULATOR");
    assert.equal(result.evaluations[0]?.status, "skipped");
    assert.equal(opened, 1);
    assert.equal(closed, 1);
  } finally {
    await target.dispose();
  }
});

test("simulator_bounds_cancellation_and_unbound_specs_fail_before_calls", async () => {
  const sim = await agent(["Hi"]);
  try {
    for (const change of [
      { persona: "" },
      { goal: " " },
      { stop: "" },
      { maxTurns: 0 },
      { maxTurns: 33 },
      { timeoutMs: 0 },
      { timeoutMs: Infinity },
    ]) {
      assert.throws(() => createUserSimulator({ agent: sim, persona: "p", goal: "g", ...change }), {
        code: "ERR_PRISM_EVAL_USER_SIMULATOR",
      });
    }
    const user = createUserSimulator({ agent: sim, persona: "p", goal: "g" });
    const result = await runScenario({ agent: sim, user, signal: AbortSignal.abort(new Error("cancel")) });
    assert.equal(result.status, "aborted");
    await assert.rejects(() => runScenario({ agent: sim, user: JSON.parse(JSON.stringify(user)) }), {
      code: "ERR_PRISM_EVAL_USER_SIMULATOR",
    });
  } finally {
    await sim.dispose();
  }
});

test("simulator_template_change_requires_version_bump", async () => {
  const { createHash } = await import("node:crypto");
  const { USER_SIMULATOR_TEMPLATE, USER_SIMULATOR_TEMPLATE_VERSION } = await import("../user-simulator.js");
  assert.equal(USER_SIMULATOR_TEMPLATE_VERSION, "1");
  assert.equal(
    createHash("sha256").update(USER_SIMULATOR_TEMPLATE).digest("hex"),
    "5b326c1bf990aa4bbca7c1f124b784c0d658c18760c6904f5708cdd28d176f5c",
  );
});

test("simulator_each_turn_preserves_result_environment_and_identity", async () => {
  const sim = await agent(["One", "Two", "###DONE###"]);
  const target = await agent(["First reply", "Second reply"]);
  const seen: unknown[] = [];
  let state = 0;
  try {
    const report = await runExperiment({
      agent: target,
      dataset: defineDataset({
        id: "d",
        items: [
          { id: "i", input: { kind: "scenario", scoreTurns: "each", user: createUserSimulator({ agent: sim, persona: "p", goal: "g" }) } },
        ],
      }),
      toEnvironment: () => ++state,
      scorers: [
        {
          id: "s",
          requires: ["environment"],
          score: (input) => {
            seen.push([input.result.text, input.environment]);
            return { score: 1 };
          },
        },
      ],
    });
    assert.deepEqual(seen, [
      ["First reply", 1],
      ["Second reply", 2],
    ]);
    assert.deepEqual(
      report.evaluations.map((r) => [r.itemId, r.metadata?.trialIndex, r.metadata?.turnIndex]),
      [
        ["i", 0, 0],
        ["i", 0, 1],
      ],
    );
    assert.equal(report.items[0]?.trials[0]?.simulation?.turns.length, 2);
    assert.equal(report.items[0]?.trials[0]?.simulation?.stopReason, "goal_reached");
  } finally {
    await sim.dispose();
    await target.dispose();
  }
});

test("simulator_initial_stop_completes_trial_without_agent_failure", async () => {
  const sim = await agent(["FINISHED"]);
  const target = await agent(["Unused"]);
  try {
    const report = await runExperiment({
      agent: target,
      scorers: [scorer],
      dataset: defineDataset({
        id: "d",
        items: [
          {
            id: "i",
            input: { kind: "scenario", user: createUserSimulator({ agent: sim, persona: "p", goal: "g", stop: "FINISHED" }) },
          },
        ],
      }),
    });
    assert.equal(report.status, "succeeded");
    assert.equal(report.items[0]?.trials[0]?.status, "completed");
    assert.equal(report.items[0]?.trials[0]?.simulation?.stopReason, "goal_reached");
    assert.equal(report.items[0]?.result, undefined);
  } finally {
    await sim.dispose();
    await target.dispose();
  }
});

test("simulator_sessions_close_and_tools_cannot_execute", async () => {
  const { providerToolCall, definePackage } = await import("@arnilo/prism");
  let tools = 0,
    opened = 0,
    closed = 0;
  const sim = await createAgent({
    model: { provider: "mock", model: "sim" },
    packages: [
      mockProvider([[providerToolCall({ type: "tool_call", id: "call", name: "leak", arguments: {} }), providerDone()]]),
      definePackage({
        name: "sim-test",
        version: "0.13.0",
        requires: { api: 1 },
        setup(api) {
          api.tools.register({
            name: "leak",
            description: "Must not execute",
            parameters: { type: "object" },
            execute: async (_args, context) => {
              tools++;
              return { toolCallId: context.toolCallId, name: "leak", content: [] };
            },
          });
        },
      }),
    ],
  });
  const target = await agent(["Unused"]);
  const tracked = {
    ...sim,
    session: async () => {
      opened++;
      const session = await sim.session();
      return {
        ...session,
        close: async () => {
          closed++;
          await session.close();
        },
      };
    },
  };
  try {
    const result = await runScenario({
      agent: target,
      user: createUserSimulator({ agent: tracked, persona: "p", goal: "g" }),
      scorers: [scorer],
    });
    assert.equal(result.error?.code, "ERR_PRISM_EVAL_USER_SIMULATOR");
    assert.equal(result.evaluations[0]?.status, "skipped");
    assert.equal(tools, 0);
    assert.equal(opened, 1);
    assert.equal(closed, 1);
  } finally {
    await sim.dispose();
    await target.dispose();
  }
});
