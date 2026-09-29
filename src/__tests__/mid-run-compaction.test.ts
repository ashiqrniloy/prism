import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  type AgentSession,
  type AIProvider,
  createAgent,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";

const cappedModel: ModelConfig = {
  provider: "mock",
  model: "demo",
  limits: { contextWindow: 2_000, maxOutputTokens: 200 },
};

const workTool: ToolDefinition = {
  name: "do_work",
  description: "Performs some work",
  parameters: { type: "object", properties: { step: { type: "number" } } },
  execute: async (args, ctx) => {
    return {
      toolCallId: ctx.toolCallId,
      name: "do_work",
      value: { done: true, step: (args as { step?: number }).step ?? 1, output: "x".repeat(300) },
    };
  },
};

function multiTurnProvider(options: { readonly rounds?: number; readonly toolCallsPerRound?: number } = {}): {
  provider: AIProvider;
  requests: ProviderRequest[];
} {
  const requests: ProviderRequest[] = [];
  const maxRounds = options.rounds ?? 2;
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        const round = requests.length;
        if (round < maxRounds) {
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

function collectEvents(session: AgentSession): { readonly events: AgentEvent[]; readonly done: Promise<void> } {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of session.subscribe()) {
      events.push(event);
    }
  })();
  return { events, done };
}

describe("Between-turn auto-compaction (mid-run)", () => {
  it("compacts between turns with each_turn trigger", async () => {
    const { provider, requests } = multiTurnProvider({ rounds: 2 });
    const agent = createAgent({
      model: cappedModel,
      provider,
      tools: [workTool],
      compaction: {
        trigger: { type: "each_turn" },
        keepRecentEntries: 2,
      },
    });

    const session = agent.createSession({ id: "s-each-turn" });
    const { events, done } = collectEvents(session);

    const result = await session.run("Initial instruction to start multi-turn");
    await done;
    assert.equal(result.status, "succeeded");
    assert.equal(requests.length, 2, "provider had 2 turns");

    // Check compaction event was emitted
    const finishedEvent = events.find((e) => e.type === "compaction_finished");
    assert.ok(finishedEvent, "compaction_finished event must be emitted");
    if (finishedEvent && finishedEvent.type === "compaction_finished") {
      assert.ok(typeof finishedEvent.entriesCompacted === "number");
      assert.ok(finishedEvent.entriesCompacted > 0, "entriesCompacted should be positive");
    }

    // Check session store has compaction entry
    const entries = await session.entries();
    const compactionEntry = entries.find((e) => e.kind === "compaction");
    assert.ok(compactionEntry, "session entries must contain compaction entry");

    // Check request 2 carried summaries
    const req2 = requests[1];
    assert.ok(req2);
    // Provider request at turn 2 should contain the compaction summary
    const allText = req2.messages
      .flatMap((m) => m.content)
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ");
    assert.ok(allText.includes("Summary:"), "Turn 2 request should carry compaction summary");
  });

  it("compacts between turns when threshold_tokens is crossed", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });
    const agent = createAgent({
      model: cappedModel,
      provider,
      tools: [workTool],
      compaction: {
        // Very low token threshold so turn 1 tool result pushes it over
        trigger: { type: "threshold_tokens", tokens: 50 },
        keepRecentEntries: 2,
      },
    });

    const session = agent.createSession({ id: "s-threshold-tokens" });
    const { events, done } = collectEvents(session);

    const result = await session.run("Start run with threshold tokens");
    await done;
    assert.equal(result.status, "succeeded");

    const finishedEvent = events.find((e) => e.type === "compaction_finished");
    assert.ok(finishedEvent, "compaction_finished must be emitted for threshold_tokens");
  });

  it("compacts between turns when input_ratio is crossed", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });
    const agent = createAgent({
      model: cappedModel,
      provider,
      tools: [workTool],
      compaction: {
        // Set low ratio so turn 1 tool result crosses it
        trigger: { type: "input_ratio", ratio: 0.05 },
        keepRecentEntries: 2,
      },
    });

    const session = agent.createSession({ id: "s-input-ratio" });
    const { events, done } = collectEvents(session);

    const result = await session.run("Start run with low ratio");
    await done;
    assert.equal(result.status, "succeeded");

    const finishedEvent = events.find((e) => e.type === "compaction_finished");
    assert.ok(finishedEvent, "compaction_finished must be emitted for input_ratio");
  });

  it("never splits a tool call from its tool result during compaction", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });
    const agent = createAgent({
      model: cappedModel,
      provider,
      tools: [workTool],
      compaction: {
        trigger: { type: "each_turn" },
        // keepRecentEntries = 1 would naively keep only the tool result and drop the assistant tool call
        keepRecentEntries: 1,
      },
    });

    const session = agent.createSession({ id: "s-no-split" });
    const result = await session.run("Start tool test");
    assert.equal(result.status, "succeeded");

    // Verify in history that the kept recent entries include the assistant tool call before the tool result
    const entries = await session.entries();
    const compactionEntry = entries.find((e) => e.kind === "compaction");
    assert.ok(compactionEntry);

    const data = compactionEntry.data as { keepEntryIds?: readonly string[] } | undefined;
    const keptIds = data?.keepEntryIds ?? [];
    assert.ok(keptIds.length >= 2, "Should keep at least assistant tool call and tool result");

    const keptEntries = entries.filter((e) => keptIds.includes(e.id));
    const firstKept = keptEntries[0];
    assert.ok(firstKept?.message?.role !== "tool", "First kept entry must not be an orphaned tool result");
  });

  it("handles compaction failure gracefully by emitting compaction_failed and continuing uncompacted", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });

    // Failing compaction strategy
    const failingStrategy = {
      name: "failing-strategy",
      compact: async () => {
        throw new Error("Compaction LLM provider rate limit exceeded (429)");
      },
    };

    const agent = createAgent({
      model: cappedModel,
      provider,
      tools: [workTool],
      compaction: {
        strategy: failingStrategy,
        trigger: { type: "each_turn" },
      },
    });

    const session = agent.createSession({ id: "s-failure-fallback" });
    const { events, done } = collectEvents(session);

    // The run should NOT crash; it should fall back to continuing uncompacted
    const result = await session.run("Start run with failing compaction");
    await done;
    assert.equal(result.status, "succeeded");
    assert.ok(result.text?.includes("Final response"), "Run completed successfully despite compaction failure");

    // Verify compaction_failed event was emitted
    const failedEvent = events.find((e) => e.type === "compaction_failed");
    assert.ok(failedEvent, "compaction_failed event must be emitted");
    if (failedEvent && failedEvent.type === "compaction_failed") {
      assert.ok(failedEvent.error.message.includes("429"));
    }
  });

  it("does not compact mid-run when no compaction trigger is configured", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });
    const agent = createAgent({
      model: cappedModel,
      provider,
      tools: [workTool],
      // No compaction configured
    });

    const session = agent.createSession({ id: "s-no-compaction" });
    const { events, done } = collectEvents(session);

    const result = await session.run("Start run without compaction");
    await done;
    assert.equal(result.status, "succeeded");

    const finishedEvent = events.find((e) => e.type === "compaction_finished");
    assert.equal(finishedEvent, undefined, "No compaction should occur without trigger");
  });
});
