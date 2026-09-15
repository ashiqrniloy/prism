import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileAttention, createAttentionCompiler } from "../attention-compiler.js";
import type { ContextBudgetMessageGroups } from "../context-budget.js";
import {
  type AgentSession,
  type AIProvider,
  type CompactionTrigger,
  type CompactionTriggerContext,
  createAgent,
  createMemorySessionStore,
  type Message,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ResolveShouldCompactInput,
  rebuildSessionContext,
  resolveShouldCompact,
  type SessionEntry,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";

const model: ModelConfig = { provider: "mock", model: "demo" };
const cappedModel: ModelConfig = { provider: "mock", model: "demo", limits: { contextWindow: 2_000, maxOutputTokens: 0 } };

function recordingProvider(): { provider: AIProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        yield providerTextDelta(`reply ${requests.length}`);
        yield providerDone();
      },
    },
  };
}

function requestAt(requests: readonly ProviderRequest[], index: number): ProviderRequest {
  const request = requests[index];
  assert.ok(request, `missing provider request at index ${index}`);
  return request;
}

function textOf(request: ProviderRequest): string {
  return request.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

function gateInput(overrides: Partial<ResolveShouldCompactInput> = {}): ResolveShouldCompactInput {
  return { sessionId: "s1", entryCount: 3, estimateInputTokens: () => 900, resolveInputCapTokens: () => 1_000, ...overrides };
}

const compactionEntries = (entries: readonly SessionEntry[]) => entries.filter((entry) => entry.kind === "compaction");

describe("resolveShouldCompact", () => {
  it("uses the legacy gates when no trigger is configured", async () => {
    assert.equal(await resolveShouldCompact({ thresholdEntries: 3 }, gateInput()), false, "at the threshold is not over it");
    assert.equal(await resolveShouldCompact({ thresholdEntries: 2 }, gateInput()), true);
    assert.equal(await resolveShouldCompact({ compactAfterTokens: 900 }, gateInput()), true, "the token gate is inclusive");
    assert.equal(await resolveShouldCompact({ compactAfterTokens: 901 }, gateInput()), false);
    assert.equal(await resolveShouldCompact({}, gateInput()), false);
  });

  it("prefers the trigger over the legacy gates and stays lazy", async () => {
    let estimates = 0;
    let caps = 0;
    const counting = gateInput({
      estimateInputTokens: () => {
        estimates += 1;
        return 900;
      },
      resolveInputCapTokens: () => {
        caps += 1;
        return 1_000;
      },
    });

    assert.equal(await resolveShouldCompact({ trigger: { type: "threshold_entries", entries: 2 }, compactAfterTokens: 1 }, counting), true);
    assert.equal(estimates + caps, 0, "a count trigger never pays for the token gates");
    assert.equal(
      await resolveShouldCompact({ trigger: { type: "custom", shouldCompact: (context) => context.entryCount > 2 } }, counting),
      true,
    );
    assert.equal(estimates + caps, 0, "a counts-only callback never resolves the cap");
    assert.equal(await resolveShouldCompact({ trigger: { type: "input_ratio", ratio: 0.5 } }, counting), true);
    assert.equal(estimates + caps, 2, "the ratio gate resolves each token source once");
  });

  it("memoizes the token sources and reports callback failures", async () => {
    let estimates = 0;
    let caps = 0;
    const errors: unknown[] = [];
    const counting = gateInput({
      estimateInputTokens: () => {
        estimates += 1;
        return 900;
      },
      resolveInputCapTokens: () => {
        caps += 1;
        return 1_000;
      },
      onError: (error) => errors.push(error),
    });

    const repeated = await resolveShouldCompact(
      {
        trigger: {
          type: "custom",
          shouldCompact: (context) => context.estimatedInputTokens + context.estimatedInputTokens + context.inputCapTokens >= 0,
        },
      },
      counting,
    );
    assert.equal(repeated, true);
    assert.deepEqual([estimates, caps], [1, 1], "a callback reading a source twice estimates it once");

    assert.equal(await resolveShouldCompact({ trigger: { type: "custom", shouldCompact: () => false } }, counting), false);
    assert.equal(
      await resolveShouldCompact({ trigger: { type: "custom", shouldCompact: () => "yes" as unknown as boolean } }, counting),
      false,
      "only `true` compacts",
    );
    assert.equal(
      await resolveShouldCompact(
        {
          trigger: {
            type: "custom",
            shouldCompact: () => {
              throw new Error("boom");
            },
          },
        },
        counting,
      ),
      false,
    );
    assert.equal(errors.length, 1, "the failure behind a fail-closed decision is reported");
  });

  it("rejects a malformed trigger instead of guessing", async () => {
    await assert.rejects(resolveShouldCompact({ trigger: { type: "nope" } as never }, gateInput()), /unknown compaction trigger type/);
    await assert.rejects(resolveShouldCompact({ trigger: { type: "input_ratio", ratio: 2 } as never }, gateInput()), /ratio/);
  });
});

describe("session auto-compaction trigger", () => {
  it("keeps the legacy entry-count gate, boundary included", async () => {
    const { provider } = recordingProvider();
    const agent = createAgent({ model, provider, compaction: { thresholdEntries: 3, keepRecentEntries: 1 } });
    const session = agent.createSession({ id: "s1" });

    // The run input is appended before the gate, so the second turn sees three entries: at the
    // threshold, not over it.
    await session.run("first");
    await session.run("second");
    assert.equal(compactionEntries(await session.entries()).length, 0);

    await session.run("third");
    assert.equal(compactionEntries(await session.entries()).length, 1);
  });

  it("still skips when the run disables compaction", async () => {
    const { provider } = recordingProvider();
    const agent = createAgent({ model, provider, compaction: { thresholdEntries: 1 } });
    const session = agent.createSession({ id: "s1" });

    await session.run("first");
    await session.run("second", { compaction: false });

    assert.equal(compactionEntries(await session.entries()).length, 0);
  });

  it("compacts on input_ratio with the compiler's cap helper and keeps the prefix plus summary", async () => {
    const { provider, requests } = recordingProvider();
    const agent = createAgent({
      model: cappedModel,
      provider,
      instructions: "system rules",
      tools: [
        {
          name: "echo",
          parameters: { type: "object", properties: {} },
          execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
        },
      ],
      compaction: { trigger: { type: "input_ratio", ratio: 0.9 }, keepRecentEntries: 1 },
    });
    const session = agent.createSession({ id: "s1" });

    // cap = 2000 - 0 - 1024 (default reserve) = 976; 0.9 of it is 878.4 estimated tokens.
    await session.run("hi");
    assert.equal(compactionEntries(await session.entries()).length, 0, "a small branch stays under the ratio");

    await session.run("y".repeat(4_000));

    assert.equal(compactionEntries(await session.entries()).length, 1, "the big input crosses the ratio");
    const after = textOf(requestAt(requests, 1));
    assert.equal(after.includes("Summary:"), true, "the assembled request carries the fresh summary");
    assert.equal(after.includes("system rules"), true, "instructions survive compaction");
    assert.equal(after.includes("yyyy"), true, "the kept recent tail survives compaction");
    assert.equal(requestAt(requests, 1).tools?.length, 1, "tool declarations survive compaction");
  });

  it("does not compact on input_ratio while the estimate stays under the ratio", async () => {
    const { provider } = recordingProvider();
    const agent = createAgent({ model: cappedModel, provider, compaction: { trigger: { type: "input_ratio", ratio: 0.9 } } });
    const session = agent.createSession({ id: "s1" });

    await session.run("hi");
    await session.run("again");

    assert.equal(compactionEntries(await session.entries()).length, 0);
  });

  it("fails loudly when an input_ratio trigger cannot resolve a cap", async () => {
    const { provider } = recordingProvider();
    // `model` declares no limits, so the shared cap helper cannot resolve a window: config error.
    const agent = createAgent({ model, provider, compaction: { trigger: { type: "input_ratio", ratio: 0.5 } } });
    const session = agent.createSession({ id: "s1" });

    // The cap is resolved as soon as the ratio trigger is evaluated, before any size judgement.
    await assert.rejects(session.run("first"), /requires maxInputTokens or model\.limits\.contextWindow/);
  });

  it("lets a custom trigger replace the entry-count gate in both directions", async () => {
    const seen: CompactionTriggerContext[] = [];
    const declined = recordingProvider();
    const declinedAgent = createAgent({
      model,
      provider: declined.provider,
      compaction: {
        thresholdEntries: 1,
        trigger: {
          type: "custom",
          shouldCompact: (context) => {
            seen.push(context);
            return false;
          },
        },
      },
    });
    const declinedSession = declinedAgent.createSession({ id: "s1" });
    await declinedSession.run("first");
    await declinedSession.run("second");

    assert.equal(compactionEntries(await declinedSession.entries()).length, 0, "a false trigger beats a fired threshold");
    assert.deepEqual(
      seen.map((context) => context.entryCount),
      [1, 3],
      "the trigger is asked once per round, with the run input already appended",
    );
    assert.equal(seen[1]?.sessionId, "s1");

    // Async callbacks are awaited; an entryCount-only callback never resolves the cap (this model has no limits).
    const accepted = recordingProvider();
    const acceptedAgent = createAgent({
      model,
      provider: accepted.provider,
      compaction: { thresholdEntries: 1_000, trigger: { type: "custom", shouldCompact: async (context) => context.entryCount >= 2 } },
    });
    const acceptedSession = acceptedAgent.createSession({ id: "s2" });
    await acceptedSession.run("first");
    await acceptedSession.run("second");

    assert.equal(compactionEntries(await acceptedSession.entries()).length, 1, "a true trigger beats an unmet threshold");
  });

  it("fails closed when a custom trigger throws or reads an unresolvable cap", async () => {
    const triggers: CompactionTrigger[] = [
      {
        type: "custom",
        shouldCompact: () => {
          throw new Error("boom");
        },
      },
      // `inputCapTokens` cannot resolve on a limits-less model, so the getter throws inside the callback.
      { type: "custom", shouldCompact: (context) => context.estimatedInputTokens / context.inputCapTokens >= 0.9 },
    ];

    for (const [index, trigger] of triggers.entries()) {
      const { provider } = recordingProvider();
      const agent = createAgent({ model, provider, compaction: { thresholdEntries: 1, trigger } });
      const session = agent.createSession({ id: `s${index + 1}` });

      // Both runs resolve: a failed trigger decides `false`, it never fails the run.
      await session.run("first");
      await session.run("second");

      assert.equal(compactionEntries(await session.entries()).length, 0, "a failed trigger never compacts the branch");
    }
  });

  it("does not compact a branch that just compacted", async () => {
    const { provider } = recordingProvider();
    const agent = createAgent({ model, provider, compaction: { thresholdEntries: 1 } });
    const session = agent.createSession({ id: "s1" });

    await session.run("first");
    await session.compact({ keepRecentEntries: 1 });
    assert.equal(compactionEntries(await session.entries()).length, 1);

    // The branch now ends with the compaction entry: the gate skips the fresh summary.
    await (session as unknown as { autoCompact(...args: unknown[]): Promise<void> }).autoCompact(
      "run-2",
      {},
      new AbortController().signal,
      [],
    );

    assert.equal(compactionEntries(await session.entries()).length, 1);
  });

  it("refuses session.compact() while a run is active", async () => {
    const failures: string[] = [];
    let session: AgentSession | undefined;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        const active = session;
        assert.ok(active, "the session exists before the run starts");
        await active.compact().then(
          () => failures.push("resolved"),
          (error: unknown) => failures.push(error instanceof Error ? error.message : String(error)),
        );
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    session = createAgent({ model, provider, store: createMemorySessionStore() }).createSession({ id: "s1" });

    await session.run("first");

    assert.deepEqual(failures, ["Agent session already has an active run"]);
  });
});

describe("compiler after compaction", () => {
  const big: ToolDefinition = {
    name: "big",
    parameters: { type: "object", properties: {} },
    execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "big", value: "y".repeat(400) }),
  };

  it("never rewrites the summary and may still stub the kept tail", async () => {
    let turn = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) yield providerToolCall(toolCallContent("c1", "big", {}));
        yield providerTextDelta(`reply ${turn}`);
        yield providerDone();
      },
    };
    const agent = createAgent({ model, provider, tools: [big], compaction: { thresholdEntries: 1, keepRecentEntries: 3 } });
    const session = agent.createSession({ id: "s1" });

    await session.run("use the big tool");
    await session.run("and again");

    const snapshot = rebuildSessionContext(await session.entries(), { leafId: session.leafId });
    assert.ok(snapshot.summaries.length > 0, "the branch carries a compaction summary");
    assert.equal(
      snapshot.messages.some((message) => message.content.some((block) => block.type === "tool_result")),
      true,
      "the kept tail still holds the tool round",
    );
    const summaries: Message[] = snapshot.summaries.map((summary) => ({
      role: "system",
      content: [{ type: "text", text: `Summary:\n${summary}` }],
    }));
    const groups: ContextBudgetMessageGroups = {
      instructions: [{ role: "system", content: [{ type: "text", text: "system rules" }] }],
      summaries,
      history: snapshot.messages,
      input: [{ role: "user", content: [{ type: "text", text: "next" }] }],
      attachments: [],
      toolResults: [],
    };

    // keepLast 0 leaves every tool row eligible, and the tail estimate is far over the 75-token trigger.
    const compiled = await compileAttention({
      compiler: createAttentionCompiler({ maxInputTokens: 100, keepLast: 0 }, { model }),
      groups,
    });

    assert.deepEqual(compiled.groups.summaries, summaries, "the compiler never rewrites the summary");
    assert.equal(JSON.stringify(compiled.groups.summaries).includes("[tool_call big]"), true, "the summary text is passed through");
    assert.deepEqual(compiled.groups.instructions, groups.instructions, "the frozen prefix is untouched");
    assert.deepEqual(compiled.groups.input, groups.input);
    assert.equal(compiled.report.stubbedToolResults, 1, "the kept tail is still subject to stubbing");
    assert.equal(JSON.stringify(compiled.groups.history).includes("y".repeat(50)), false);
  });
});
