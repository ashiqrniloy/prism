/**
 * `compaction.when` is a tri-state vote (plan 194 Task 2): `true` compacts, `false` vetoes, and
 * `undefined` abstains. The kernel's `thresholdEntries` fallback runs only when every registered
 * handler abstains, so a package that has nothing to say can no longer silence the host's gate.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import memorySystem from "@arnilo/prism-memory-system";
import {
  type AgentEvent,
  createAgent,
  defaultLoop,
  type LoopStrategy,
  type ModelConfig,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ProviderRequest,
  type Session,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { loopConformance } from "../testing/index.js";

const model: ModelConfig = {
  provider: "mock",
  model: "demo",
  limits: { contextWindow: 100_000, maxOutputTokens: 1_000 },
};

const workTool: ToolDefinition = {
  name: "do_work",
  description: "Performs some work",
  parameters: { type: "object", properties: { step: { type: "number" } } },
  execute: async (args, ctx) => ({
    toolCallId: ctx.toolCallId,
    name: "do_work",
    value: { done: true, step: (args as { step?: number }).step ?? 1, output: "x".repeat(300) },
  }),
};

function recordingProvider(text = "done"): { provider: ModelProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        yield providerTextDelta(text);
        yield providerDone();
      },
    },
  };
}

/** A provider that runs `rounds` turns: a `do_work` call each turn except the last. */
function multiTurnProvider(rounds: number): { provider: ModelProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        const round = requests.length;
        if (round < rounds) {
          yield providerToolCall(toolCallContent(`call_${round}`, "do_work", { step: round }));
          yield providerDone();
        } else {
          yield providerTextDelta(`Final response after ${round} turns`);
          yield providerDone();
        }
      },
    },
  };
}

function countCompactions(session: Session): Promise<number> {
  return session.entries().then((entries) => entries.filter((entry) => entry.kind === "compaction").length);
}

describe("compaction.when abstention", () => {
  it("om_off_does_not_suppress_host_compaction", async () => {
    // The 2026-10-17 repro: OM installs its `compaction.when` handler, its per-session toggle is off,
    // and the host's `thresholdEntries` gate must still fire.
    const { provider, requests } = multiTurnProvider(8);
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider]), memorySystem({})],
      tools: { add: [workTool] },
      compaction: { thresholdEntries: 4, keepRecentEntries: 2 },
    });
    const session = await agent.session({ id: "s-om-off", create: true });

    await session.run("start");

    assert.equal(requests.length, 8, "the run took all eight turns");
    assert.ok((await countCompactions(session)) > 0, "the host trigger compacts while OM is off");
    await agent.dispose();
  });

  it("all_abstain_falls_back_to_threshold_entries", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      compaction: { thresholdEntries: 0, keepRecentEntries: 1 },
      hooks: (hooks) => hooks.on("compaction.when", () => undefined),
    });
    const session = await agent.session({ id: "s-abstain", create: true });

    await session.run("first");

    assert.equal(await countCompactions(session), 1, "an abstaining handler defers to the host trigger");
    await agent.dispose();
  });

  it("explicit_false_blocks_fallback", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      compaction: { thresholdEntries: 0, keepRecentEntries: 1 },
      hooks: (hooks) => hooks.on("compaction.when", () => ({ compact: false })),
    });
    const session = await agent.session({ id: "s-veto", create: true });

    await session.run("first");

    assert.equal(await countCompactions(session), 0, "a false vote vetoes the host trigger");
    await agent.dispose();
  });

  it("om_on_below_gate_vetoes_the_host_fallback", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [
        providerPackage("test-provider", [provider]),
        memorySystem({ enabled: true, context: { compactAt: { maxTokens: 1_000_000 } } }),
      ],
      compaction: { thresholdEntries: 0 },
    });
    const session = await agent.session({ id: "s-om-on", create: true });

    await session.run("first");

    assert.equal(await countCompactions(session), 0, "OM owns the decision while on and declines below its gate");
    await agent.dispose();
  });

  // The combination rule lives in the bus, but the fallback runs on the session's model-call path:
  // prove both the default and a custom loop reach it.
  const customLoop: LoopStrategy = {
    name: "abstain-custom",
    revision: "1",
    async run(run) {
      for (;;) {
        const turn = await run.turn();
        if (turn.stopped) return;
        if (turn.toolCalls.length > 0) {
          await run.executeTools(turn.toolCalls);
          continue;
        }
        const end = await run.end();
        if (!end.continue) return;
      }
    },
  };
  for (const [loopName, loop] of [
    ["defaultLoop", defaultLoop],
    ["customLoop", customLoop],
  ] as const) {
    it(`abstain_falls_back_from_${loopName}`, async () => {
      const { session } = await loopConformance({
        loop,
        compaction: { thresholdEntries: 0, keepRecentEntries: 1 },
        hooks: (hooks) => hooks.on("compaction.when", () => undefined),
      });
      assert.ok((await countCompactions(session)) > 0, "the configured trigger fires from either loop");
      await session.close?.();
    });
  }

  it("any_true_wins_over_false", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      hooks: (hooks) => {
        hooks.on("compaction.when", () => ({ compact: false }));
        hooks.on("compaction.when", () => ({ compact: true }));
      },
    });
    const session = await agent.session({ id: "s-true-wins", create: true });

    const events: AgentEvent[] = [];
    const done = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    await session.run("first");
    await done;

    assert.equal(events.filter((event) => event.type === "compaction.completed").length, 1);
    await agent.dispose();
  });
});
