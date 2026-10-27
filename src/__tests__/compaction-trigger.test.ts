import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Session,
  type ModelProvider,
  type CompactionTrigger,
  type CompactionTriggerContext,
  createAgent,
  createMemorySessionStore,
  type HookRegistrar,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type ResolveShouldCompactInput,
  resolveInputCap,
  resolveShouldCompact,
  type SessionEntry,
} from "../index.js";
import { failedRun } from "./run-result-helpers.js";
import { providerPackage } from "../provider-kit/index.js";

const model: ModelConfig = { provider: "mock", model: "demo" };
const cappedModel: ModelConfig = { provider: "mock", model: "demo", limits: { contextWindow: 2_000, maxOutputTokens: 0 } };

function recordingProvider(): { provider: ModelProvider; requests: ProviderRequest[] } {
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
  it("uses the entry gate when no trigger is configured", async () => {
    assert.equal(await resolveShouldCompact({ thresholdEntries: 3 }, gateInput()), false, "at the threshold is not over it");
    assert.equal(await resolveShouldCompact({ thresholdEntries: 2 }, gateInput()), true);
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

    assert.equal(await resolveShouldCompact({ trigger: { type: "threshold_entries", entries: 2 } }, counting), true);
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

/**
 * A `CompactionTrigger` as the `compaction.when` handler that owns the decision — the migration every
 * `CompactionOptions.trigger` caller now makes. `resolveShouldCompact` stays the shared evaluator.
 */
function whenTrigger(trigger: CompactionTrigger, sessionModel: ModelConfig = model): (hooks: HookRegistrar) => void {
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

describe("session auto-compaction trigger", () => {
  it("keeps the legacy entry-count gate, boundary included", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider])], compaction: { thresholdEntries: 3, keepRecentEntries: 1 } });
    const session = await agent.session({ id: "s1", create: true });

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
    const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider])], compaction: { thresholdEntries: 1 } });
    const session = await agent.session({ id: "s1", create: true });

    await session.run("first");
    await session.run("second", { compaction: false });

    assert.equal(compactionEntries(await session.entries()).length, 0);
  });

  it("compacts on input_ratio with the compiler's cap helper and keeps the prefix plus summary", async () => {
    const { provider, requests } = recordingProvider();
    const agent = await createAgent({
      model: cappedModel,
      packages: [providerPackage("test-provider", [provider])],
      instructions: "system rules",
      tools: {
        add: [
          {
            name: "echo",
            parameters: { type: "object", properties: {} },
            execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
          },
        ],
      },
      compaction: { keepRecentEntries: 1 },
      hooks: whenTrigger({ type: "input_ratio", ratio: 0.9 }, cappedModel),
    });
    const session = await agent.session({ id: "s1", create: true });

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
    const agent = await createAgent({ model: cappedModel, packages: [providerPackage("test-provider", [provider])], hooks: whenTrigger({ type: "input_ratio", ratio: 0.9 }, cappedModel) });
    const session = await agent.session({ id: "s1", create: true });

    await session.run("hi");
    await session.run("again");

    assert.equal(compactionEntries(await session.entries()).length, 0);
  });

  it("fails loudly when an input_ratio handler cannot resolve a cap", async () => {
    const { provider } = recordingProvider();
    // `model` declares no limits, so the shared cap helper cannot resolve a window: config error.
    const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider])], hooks: whenTrigger({ type: "input_ratio", ratio: 0.5 }) });
    const session = await agent.session();

    // The cap is resolved as soon as the handler evaluates the ratio, before any size judgement.
    await failedRun(session.run("first"), /requires maxInputTokens or model\.limits\.contextWindow/);
  });

  it("lets a custom trigger replace the entry-count gate in both directions", async () => {
    const seen: CompactionTriggerContext[] = [];
    const declined = recordingProvider();
    const declinedAgent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [declined.provider])],
      compaction: { thresholdEntries: 1 },
      hooks: whenTrigger({
        type: "custom",
        shouldCompact: (context) => {
          seen.push(context);
          return false;
        },
      }),
    });
    const declinedSession = await declinedAgent.session({ id: "s1", create: true });
    await declinedSession.run("first");
    await declinedSession.run("second");

    assert.equal(compactionEntries(await declinedSession.entries()).length, 0, "a false trigger beats a fired threshold");
    assert.deepEqual(
      seen.map((context) => context.entryCount),
      [1, 3],
      "the trigger is asked once per round, with the run input already appended",
    );
    assert.equal(seen[1]?.sessionId, declinedSession.id);

    // Async callbacks are awaited; an entryCount-only callback never resolves the cap (this model has no limits).
    const accepted = recordingProvider();
    const acceptedAgent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [accepted.provider])],
      compaction: { thresholdEntries: 1_000 },
      hooks: whenTrigger({ type: "custom", shouldCompact: async (context) => context.entryCount >= 2 }),
    });
    const acceptedSession = await acceptedAgent.session({ id: "s2", create: true });
    await acceptedSession.run("first");
    await acceptedSession.run("second");

    assert.equal(compactionEntries(await acceptedSession.entries()).length, 1, "a true trigger beats an unmet threshold");
  });

  it("a failed custom handler never compacts the branch", async () => {
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

    for (const [_index, trigger] of triggers.entries()) {
      const { provider } = recordingProvider();
      const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider])], compaction: { thresholdEntries: 1 }, hooks: whenTrigger(trigger) });
      const session = await agent.session();

      // Both runs resolve: a failed trigger decides `false`, it never fails the run.
      await session.run("first");
      await session.run("second");

      assert.equal(compactionEntries(await session.entries()).length, 0, "a failed trigger never compacts the branch");
    }
  });

  it("does not compact a branch that just compacted", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider])], compaction: { thresholdEntries: 1 } });
    const session = await agent.session({ id: "s1", create: true });

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
    let session: Session | undefined;
    const provider: ModelProvider = {
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
    session = await (await createAgent({ model, packages: [providerPackage("test-provider", [provider])], slots: { store: createMemorySessionStore() } })).session({
      id: "s1",
      create: true,
    });

    await session.run("first");

    assert.deepEqual(failures, ["Agent session already has an active run"]);
  });
});

describe("compaction.when hook", () => {
  it("compaction_config_trigger_decides_without_a_hook", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({ model, packages: [providerPackage("test-provider", [provider])], compaction: { thresholdEntries: 0, keepRecentEntries: 1 } });
    const session = await agent.session();

    await session.run("first");

    assert.equal(compactionEntries(await session.entries()).length, 1, "the configured trigger still fires with no handler");
  });

  it("compaction_when_triggers_auto_compaction", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      hooks: (hooks) => hooks.on("compaction.when", () => ({ compact: true })),
    });
    const session = await agent.session();

    await session.run("first");

    assert.equal(compactionEntries(await session.entries()).length, 1, "a handler alone can trigger auto-compaction");
  });

  it("compaction_when_abstain_falls_back_to_the_config_trigger", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      // The configured trigger compacts immediately; an abstaining handler does not suppress it.
      compaction: { thresholdEntries: 0, keepRecentEntries: 1 },
      hooks: (hooks) => hooks.on("compaction.when", () => undefined),
    });
    const session = await agent.session();

    await session.run("first");

    assert.equal(compactionEntries(await session.entries()).length, 1, "an abstaining handler defers to the configured trigger");
  });

  it("compaction_when_false_vetoes_the_config_trigger", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      compaction: { thresholdEntries: 0, keepRecentEntries: 1 },
      hooks: (hooks) => hooks.on("compaction.when", () => ({ compact: false })),
    });
    const session = await agent.session();

    await session.run("first");

    assert.equal(compactionEntries(await session.entries()).length, 0, "a false vote suppresses the configured trigger");
  });

  it("compaction_when_throw_fails_closed", async () => {
    const { provider } = recordingProvider();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      hooks: (hooks) =>
        hooks.on("compaction.when", () => {
          throw new Error("when boom");
        }),
    });
    const session = await agent.session();

    const result = await session.run("first");
    assert.equal(result.status, "failed", "a throwing compaction.when fails the run");
    assert.equal(result.error?.name, "HookError");
    assert.equal(result.error?.owner, "host");
    assert.equal(result.error?.hook, "compaction.when");
  });
});
