import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  type CompactionTrigger,
  createAgent,
  type HookRegistrar,
  type ModelConfig,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveInputCap,
  resolveShouldCompact,
  type Session,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

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
  provider: ModelProvider;
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

function collectEvents(session: Session): { readonly events: AgentEvent[]; readonly done: Promise<void> } {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of session.subscribe()) {
      events.push(event);
    }
  })();
  return { events, done };
}

/** A `CompactionTrigger` as the `compaction.when` handler that owns the decision. */
function whenTrigger(trigger: CompactionTrigger, sessionModel: ModelConfig = cappedModel): (hooks: HookRegistrar) => void {
  return (hooks) =>
    hooks.on(
      "compaction.when",
      async (payload, context) => {
        const compact = await resolveShouldCompact(
          { trigger },
          {
            sessionId: payload.sessionId,
            entryCount: payload.entryCount,
            ...(payload.turn === undefined ? {} : { turn: payload.turn }),
            estimateInputTokens: () => payload.estimatedTokens ?? 0,
            resolveInputCapTokens: () => resolveInputCap(undefined, sessionModel),
            signal: context.signal,
          },
        );
        return compact ? { compact: true } : { compact: false };
      },
      { id: "compaction-trigger" },
    );
}

describe("Between-turn auto-compaction (mid-run)", () => {
  it("compacts between turns with each_turn trigger", async () => {
    const { provider, requests } = multiTurnProvider({ rounds: 2 });
    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [workTool] },
      compaction: { keepRecentEntries: 2 },
      hooks: whenTrigger({ type: "each_turn" }),
    });

    const session = await agent.session({ id: "s-each-turn", create: true });
    const { events, done } = collectEvents(session);

    const result = await session.run("Initial instruction to start multi-turn");
    await done;
    assert.equal(result.status, "completed");
    assert.equal(requests.length, 2, "provider had 2 turns");

    // Check compaction event was emitted
    const finishedEvent = events.find((e) => e.type === "compaction.completed");
    assert.ok(finishedEvent, "compaction_finished event must be emitted");
    if (finishedEvent && finishedEvent.type === "compaction.completed") {
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
    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [workTool] },
      compaction: { keepRecentEntries: 2 },
      // Very low token threshold so turn 1 tool result pushes it over
      hooks: whenTrigger({ type: "threshold_tokens", tokens: 50 }, cappedModel),
    });

    const session = await agent.session({ id: "s-threshold-tokens", create: true });
    const { events, done } = collectEvents(session);

    const result = await session.run("Start run with threshold tokens");
    await done;
    assert.equal(result.status, "completed");

    const finishedEvent = events.find((e) => e.type === "compaction.completed");
    assert.ok(finishedEvent, "compaction_finished must be emitted for threshold_tokens");
  });

  it("compacts between turns when input_ratio is crossed", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });
    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [workTool] },
      compaction: { keepRecentEntries: 2 },
      // Set low ratio so turn 1 tool result crosses it
      hooks: whenTrigger({ type: "input_ratio", ratio: 0.05 }, cappedModel),
    });

    const session = await agent.session({ id: "s-input-ratio", create: true });
    const { events, done } = collectEvents(session);

    const result = await session.run("Start run with low ratio");
    await done;
    assert.equal(result.status, "completed");

    const finishedEvent = events.find((e) => e.type === "compaction.completed");
    assert.ok(finishedEvent, "compaction_finished must be emitted for input_ratio");
  });

  it("never splits a tool call from its tool result during compaction", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });
    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [workTool] },
      compaction: {
        // keepRecentEntries = 1 would naively keep only the tool result and drop the assistant tool call
        keepRecentEntries: 1,
      },
      hooks: whenTrigger({ type: "each_turn" }),
    });

    const session = await agent.session({ id: "s-no-split", create: true });
    const result = await session.run("Start tool test");
    assert.equal(result.status, "completed");

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

    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [workTool] },
      // The compactor is the `compaction` slot (roadmap §2.5); `compaction` only sizes it.
      slots: { compaction: failingStrategy },
      hooks: whenTrigger({ type: "each_turn" }),
    });

    const session = await agent.session({ id: "s-failure-fallback", create: true });
    const { events, done } = collectEvents(session);

    // The run should NOT crash; it should fall back to continuing uncompacted
    const result = await session.run("Start run with failing compaction");
    await done;
    assert.equal(result.status, "completed");
    assert.ok(result.text?.includes("Final response"), "Run completed successfully despite compaction failure");

    // Verify the compaction failure was emitted on compaction.completed
    const failedEvent = events.find((e) => e.type === "compaction.completed");
    assert.ok(failedEvent, "a compaction.completed event must be emitted");
    if (failedEvent && failedEvent.type === "compaction.completed") {
      assert.ok(failedEvent.error?.message.includes("429"));
    }
  });

  it("does not compact mid-run when no compaction trigger is configured", async () => {
    const { provider } = multiTurnProvider({ rounds: 2 });
    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [workTool] },
      // No compaction configured
    });

    const session = await agent.session({ id: "s-no-compaction", create: true });
    const { events, done } = collectEvents(session);

    const result = await session.run("Start run without compaction");
    await done;
    assert.equal(result.status, "completed");

    const finishedEvent = events.find((e) => e.type === "compaction.completed");
    assert.equal(finishedEvent, undefined, "No compaction should occur without trigger");
  });
});

describe("The compaction vote counts what the turn sends beside the branch (plan 218.5 Task 7)", () => {
  // A host or package context block (a memory block, a retrieval) is rendered into the request after assembly. The
  // vote used to estimate the branch and its summaries only, so a trigger at a share of the input cap fired late by
  // the block's size and the provider's overflow did the compacting.
  async function votedEstimates(block: string | undefined): Promise<number[]> {
    const { provider } = multiTurnProvider({ rounds: 3 });
    const estimates: number[] = [];
    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [workTool] },
      hooks: (hooks) => {
        if (block !== undefined)
          hooks.on("context.build", (draft) => ({
            ...draft,
            context: [...(draft.context ?? []), { id: "host-block", title: "Memory", content: block }],
          }));
        hooks.on("compaction.when", (payload) => {
          if (payload.turn !== undefined) estimates.push(payload.estimatedTokens ?? 0);
          return { compact: false };
        });
      },
    });
    const session = await agent.session({ id: `s-overhead-${block === undefined ? "none" : "block"}`, create: true });
    assert.equal((await session.run("Start")).status, "completed");
    return estimates;
  }

  it("adds the last turn's context blocks, instructions and tools to estimatedTokens", async () => {
    const without = await votedEstimates(undefined);
    const withBlock = await votedEstimates("memory line ".repeat(400));
    assert.equal(without.length, 2);
    assert.equal(withBlock.length, 2);
    // The tool declarations alone are overhead the old vote left out.
    assert.ok(without[0]! > 0);
    // The ~4,800-character block adds roughly its estimate (about 1,200 tokens) to every mid-loop vote.
    for (const [index, estimate] of withBlock.entries()) {
      const added = estimate - without[index]!;
      assert.ok(added > 1_000 && added < 1_500, `turn ${index + 2}: the block added ${added} tokens`);
    }
  });
});
