import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentIdentity,
  type AIProvider,
  type ModelConfig,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
} from "@arnilo/prism";
import {
  createGovernedProvider,
  createMemoryModelRouterStateStore,
  createModelRouter,
  type GovernedInvocationSettlement,
  isGovernedProvider,
  ModelRouterError,
} from "../index.js";

const testIdentity: AgentIdentity = {
  tenantId: "tenant-gov",
  userId: "user-gov",
  principal: { kind: "user", id: "user-gov" },
  scopes: ["llm:generate"],
  verified: true,
  issuedAt: "2026-09-01T00:00:00.000Z",
};

const modelPrimary: ModelConfig = {
  provider: "openai",
  model: "gpt-4o",
};

const modelFallback: ModelConfig = {
  provider: "anthropic",
  model: "claude-3-5-sonnet",
};

function createRecordingProvider(
  id: string,
  events: readonly ProviderEvent[] | ((req: ProviderRequest) => AsyncIterable<ProviderEvent>),
): AIProvider & { readonly calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = [];
  return {
    id,
    calls,
    async *generate(req: ProviderRequest) {
      calls.push(req);
      if (typeof events === "function") {
        yield* events(req);
      } else {
        for (const ev of events) {
          yield ev;
        }
      }
    },
  };
}

describe("governed provider invocation lifecycle (plan 073 Task 6)", () => {
  it("denial before I/O: allow-list mismatch denies before calling provider", async () => {
    let providerCalled = false;
    const mockProvider: AIProvider = {
      id: "openai",
      async *generate() {
        providerCalled = true;
        yield providerTextDelta("should not run");
        yield providerDone();
      },
    };

    const router = createModelRouter({
      allowList: { models: ["claude-3-5-sonnet"] }, // gpt-4o denied
      resolver: () => mockProvider,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
    });

    await assert.rejects(
      async () => {
        for await (const _ of governed.generate({ model: modelPrimary, messages: [] })) {
          // should not yield
        }
      },
      (err) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST",
    );

    assert.equal(providerCalled, false, "provider must not be called when router denies before I/O");
  });

  it("denial before I/O: budget exhausted denies before calling provider", async () => {
    let providerCalled = false;
    const mockProvider: AIProvider = {
      id: "openai",
      async *generate() {
        providerCalled = true;
        yield providerTextDelta("should not run");
        yield providerDone();
      },
    };

    const stateStore = createMemoryModelRouterStateStore();
    const router = createModelRouter({
      stateStore,
      budgets: { maxTokens: 100 },
      resolver: () => mockProvider,
    });

    // Exhaust budget
    await router.recordUsage({
      identity: testIdentity,
      provider: modelPrimary.provider,
      model: modelPrimary.model,
      tokens: 100,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
    });

    await assert.rejects(
      async () => {
        for await (const _ of governed.generate({ model: modelPrimary, messages: [] })) {
          // should not yield
        }
      },
      (err) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_BUDGET",
    );

    assert.equal(providerCalled, false);
  });

  it("selected fallback model: router selects fallback when primary is disallowed", async () => {
    const primaryProvider = createRecordingProvider("openai", [providerTextDelta("primary"), providerDone()]);
    const fallbackProvider = createRecordingProvider("anthropic", [providerTextDelta("fallback response"), providerDone()]);

    const settlements: GovernedInvocationSettlement[] = [];
    const router = createModelRouter({
      allowList: { models: ["claude-3-5-sonnet"] }, // only fallback allowed
      fallbacks: [modelFallback],
      resolver: (m) => (m.provider === "openai" ? primaryProvider : fallbackProvider),
    });

    const governed = router.createGovernedProvider({
      identity: testIdentity,
      model: modelPrimary,
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    const events: ProviderEvent[] = [];
    for await (const ev of governed.generate({ model: modelPrimary, messages: [] })) {
      events.push(ev);
    }

    assert.equal(primaryProvider.calls.length, 0, "disallowed primary should not be called");
    assert.equal(
      events.some((e) => e.type === "content_delta" && e.content.type === "text" && e.content.text === "fallback response"),
      true,
    );
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]!.model.model, "claude-3-5-sonnet");
    assert.equal(settlements[0]!.outcome, "success");
  });

  it("normal completion: applies policy, streams bounded chunks, commits usage, and records outcome", async () => {
    const provider = createRecordingProvider("openai", [
      { type: "message_start" },
      providerTextDelta("Hello from governed model"),
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.002 } },
      providerDone(),
    ]);

    const stateStore = createMemoryModelRouterStateStore();
    const settlements: GovernedInvocationSettlement[] = [];

    const router = createModelRouter({
      stateStore,
      budgets: { maxTokens: 1000 },
      resolver: () => provider,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      maxTokens: 100,
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    const received: ProviderEvent[] = [];
    for await (const ev of governed.generate({ model: modelPrimary, messages: [] })) {
      received.push(ev);
    }

    assert.equal(received.length, 4);
    assert.equal(settlements.length, 1);
    const settlement = settlements[0]!;
    assert.equal(settlement.outcome, "success");
    assert.equal(settlement.usage?.totalTokens, 15);
    assert.equal(settlement.usage?.cost, 0.002);
    assert.equal(settlement.budgetCommitted, true);
    assert.equal(settlement.unknownUsage, false);

    // Verify budget committed in stateStore
    const budgetState = await stateStore.readBudget({
      key: {
        tenantId: testIdentity.tenantId,
        userId: testIdentity.userId,
        principalId: testIdentity.principal.id,
        provider: modelPrimary.provider,
        model: modelPrimary.model,
      },
      windowMs: 86400000,
      now: Date.now(),
    });
    assert.equal(budgetState.tokens, 15);
    assert.equal(budgetState.costUsd, 0.002);
  });

  it("upstream EOF without usage: charges reserved liability as unknown usage", async () => {
    // Provider abruptly ends stream after output, omitting usage
    const provider = createRecordingProvider("openai", [
      providerTextDelta("partial output before EOF"),
      // stream closes here without usage or done!
    ]);

    const stateStore = createMemoryModelRouterStateStore();
    const settlements: GovernedInvocationSettlement[] = [];

    const router = createModelRouter({
      stateStore,
      budgets: { maxTokens: 1000, reservationTtlMs: 60000 },
      resolver: () => provider,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      maxTokens: 100,
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    const received: ProviderEvent[] = [];
    for await (const ev of governed.generate({ model: modelPrimary, messages: [] })) {
      received.push(ev);
    }

    assert.equal(received.length, 1);
    assert.equal(settlements.length, 1);
    const s = settlements[0]!;
    assert.equal(s.outcome, "success");
    assert.equal(s.unknownUsage, true);
    assert.equal(s.budgetCommitted, true);

    // Reserved amount was charged into budget
    const budgetState = await stateStore.readBudget({
      key: {
        tenantId: testIdentity.tenantId,
        userId: testIdentity.userId,
        principalId: testIdentity.principal.id,
        provider: modelPrimary.provider,
        model: modelPrimary.model,
      },
      windowMs: 86400000,
      now: Date.now(),
    });
    assert.ok(budgetState.tokens > 0, "missing actual usage charges reserved liability");
  });

  it("abort before response: releases reservation and does not charge budget", async () => {
    const controller = new AbortController();
    const provider: AIProvider = {
      id: "openai",
      async *generate() {
        // Abort right before generating any output
        controller.abort();
        yield providerTextDelta("should not be read");
      },
    };

    const stateStore = createMemoryModelRouterStateStore();
    const settlements: GovernedInvocationSettlement[] = [];

    const router = createModelRouter({
      stateStore,
      budgets: { maxTokens: 1000 },
      resolver: () => provider,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      maxTokens: 100,
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    await assert.rejects(
      async () => {
        for await (const _ of governed.generate({
          model: modelPrimary,
          messages: [],
          signal: controller.signal,
        })) {
          // ...
        }
      },
      (err: unknown) => err instanceof Error && (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR"),
    );

    assert.equal(settlements.length, 1);
    const s = settlements[0]!;
    assert.equal(s.outcome, "abort");
    assert.equal(s.budgetReleased, true, "abort before output must release reservation");
    assert.equal(s.budgetCommitted, false);

    // Budget state should be 0
    const budgetState = await stateStore.readBudget({
      key: {
        tenantId: testIdentity.tenantId,
        userId: testIdentity.userId,
        principalId: testIdentity.principal.id,
        provider: modelPrimary.provider,
        model: modelPrimary.model,
      },
      windowMs: 86400000,
      now: Date.now(),
    });
    assert.equal(budgetState.tokens, 0);
  });

  it("abort after response: commits budget reservation because output was delivered", async () => {
    const controller = new AbortController();
    const provider: AIProvider = {
      id: "openai",
      async *generate() {
        yield providerTextDelta("first chunk");
        controller.abort();
        yield providerTextDelta("second chunk");
      },
    };

    const stateStore = createMemoryModelRouterStateStore();
    const settlements: GovernedInvocationSettlement[] = [];

    const router = createModelRouter({
      stateStore,
      budgets: { maxTokens: 1000 },
      resolver: () => provider,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      maxTokens: 100,
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    const seen: ProviderEvent[] = [];
    await assert.rejects(
      async () => {
        for await (const ev of governed.generate({
          model: modelPrimary,
          messages: [],
          signal: controller.signal,
        })) {
          seen.push(ev);
        }
      },
      (err: unknown) => err instanceof Error && (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR"),
    );

    assert.equal(seen.length, 1, "first chunk was delivered");
    assert.equal(settlements.length, 1);
    const s = settlements[0]!;
    assert.equal(s.outcome, "abort");
    assert.equal(s.budgetCommitted, true, "output was delivered so budget must be committed");
  });

  it("iterator return: breaking for-await triggers explicit settlement and releases/commits", async () => {
    const provider: AIProvider = {
      id: "openai",
      async *generate() {
        yield providerTextDelta("chunk-1");
        yield providerTextDelta("chunk-2");
        yield providerTextDelta("chunk-3");
      },
    };

    const settlements: GovernedInvocationSettlement[] = [];
    const router = createModelRouter({
      budgets: { maxTokens: 1000 },
      resolver: () => provider,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      maxTokens: 100,
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    for await (const ev of governed.generate({ model: modelPrimary, messages: [] })) {
      if (ev.type === "content_delta") {
        break; // Early close!
      }
    }

    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]!.outcome, "early_close");
    assert.equal(settlements[0]!.budgetCommitted, true);
  });

  it("failed usage persistence: throws recording error without hiding it", async () => {
    const provider = createRecordingProvider("openai", [providerTextDelta("ok"), providerDone()]);

    const router = createModelRouter({
      budgets: { maxTokens: 1000 },
      resolver: () => provider,
    });

    // Mock router.recordUsage to fail
    router.recordUsage = async () => {
      throw new ModelRouterError("database disk full", "ERR_PRISM_MODEL_ROUTER_STATE");
    };

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      maxTokens: 100,
    });

    await assert.rejects(
      async () => {
        for await (const _ of governed.generate({ model: modelPrimary, messages: [] })) {
          // ...
        }
      },
      (err) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
  });

  it("duplicate settlement: settle is idempotent and runs exactly once", async () => {
    const provider: AIProvider = {
      id: "openai",
      async *generate() {
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };

    let settlementCalls = 0;
    const router = createModelRouter({
      budgets: { maxTokens: 1000 },
      resolver: () => provider,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      onSettlement: () => {
        settlementCalls++;
      },
    });

    const gen = governed.generate({ model: modelPrimary, messages: [] });
    const it = gen[Symbol.asyncIterator]();
    await it.next();
    await it.next();
    // Repeated return calls
    await it.return?.();
    await it.return?.();

    assert.equal(settlementCalls, 1, "settlement must be idempotent and called exactly once");
  });

  it("safe fallback before output: primary failure before output falls back to secondary seamlessly", async () => {
    const primaryCalls: ProviderRequest[] = [];
    const fallbackCalls: ProviderRequest[] = [];

    const primaryProvider: AIProvider = {
      id: "openai",
      async *generate(req) {
        primaryCalls.push(req);
        // Fails immediately before emitting any content!
        throw new Error("primary upstream connection refused");
      },
    };

    const fallbackProvider: AIProvider = {
      id: "anthropic",
      async *generate(req) {
        fallbackCalls.push(req);
        yield providerTextDelta("fallback rescued output");
        yield providerDone();
      },
    };

    const settlements: GovernedInvocationSettlement[] = [];
    const router = createModelRouter({
      fallbacks: [modelFallback],
      resolver: (m) => (m.provider === "openai" ? primaryProvider : fallbackProvider),
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      fallbacks: [modelFallback],
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    const output: string[] = [];
    for await (const ev of governed.generate({ model: modelPrimary, messages: [] })) {
      if (ev.type === "content_delta" && ev.content.type === "text") {
        output.push(ev.content.text);
      }
    }

    assert.equal(primaryCalls.length, 1, "primary should have been attempted first");
    assert.equal(fallbackCalls.length, 1, "fallback should have rescued call");
    assert.deepEqual(output, ["fallback rescued output"]);

    // Two settlements: primary error, fallback success
    assert.equal(settlements.length, 2);
    assert.equal(settlements[0]!.model.model, "gpt-4o");
    assert.equal(settlements[0]!.outcome, "error");
    assert.equal(settlements[1]!.model.model, "claude-3-5-sonnet");
    assert.equal(settlements[1]!.outcome, "success");
  });

  it("forbidden fallback after output/effect: primary failure after emitting text NEVER falls back", async () => {
    const primaryCalls: ProviderRequest[] = [];
    const fallbackCalls: ProviderRequest[] = [];

    const primaryProvider: AIProvider = {
      id: "openai",
      async *generate(req) {
        primaryCalls.push(req);
        yield providerTextDelta("partial text delivered to caller");
        // Emitted output, THEN fails!
        throw new Error("mid-stream failure after output");
      },
    };

    const fallbackProvider: AIProvider = {
      id: "anthropic",
      async *generate(req) {
        fallbackCalls.push(req);
        yield providerTextDelta("duplicate fallback");
        yield providerDone();
      },
    };

    const settlements: GovernedInvocationSettlement[] = [];
    const router = createModelRouter({
      fallbacks: [modelFallback],
      resolver: (m) => (m.provider === "openai" ? primaryProvider : fallbackProvider),
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      fallbacks: [modelFallback],
      onSettlement: (s) => {
        settlements.push(s);
      },
    });

    const output: string[] = [];
    await assert.rejects(async () => {
      for await (const ev of governed.generate({ model: modelPrimary, messages: [] })) {
        if (ev.type === "content_delta" && ev.content.type === "text") {
          output.push(ev.content.text);
        }
      }
    }, /mid-stream failure after output/);

    assert.equal(output.length, 1);
    assert.equal(output[0], "partial text delivered to caller");
    assert.equal(fallbackCalls.length, 0, "fallback is strictly forbidden after output was delivered");
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]!.model.model, "gpt-4o");
    assert.equal(settlements[0]!.outcome, "error");
  });

  it("forbidden fallback after tool call: tool call emitted NEVER falls back", async () => {
    const fallbackCalls: ProviderRequest[] = [];
    const primaryProvider: AIProvider = {
      id: "openai",
      async *generate() {
        yield providerToolCall({
          type: "tool_call",
          id: "call-1",
          name: "send_email",
          arguments: { to: "alice@example.com" },
        });
        throw new Error("crash after tool call");
      },
    };

    const fallbackProvider: AIProvider = {
      id: "anthropic",
      async *generate(req) {
        fallbackCalls.push(req);
        yield providerTextDelta("fallback output");
      },
    };

    const router = createModelRouter({
      fallbacks: [modelFallback],
      resolver: (m) => (m.provider === "openai" ? primaryProvider : fallbackProvider),
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
      fallbacks: [modelFallback],
    });

    await assert.rejects(async () => {
      for await (const _ of governed.generate({ model: modelPrimary, messages: [] })) {
        // ...
      }
    }, /crash after tool call/);

    assert.equal(fallbackCalls.length, 0, "fallback is forbidden after side-effecting tool call");
  });

  it("isGovernedProvider predicate and coverage exposure", () => {
    const plainMock: AIProvider = {
      id: "mock",
      async *generate() {},
    };

    const router = createModelRouter({
      resolver: () => plainMock,
    });

    const governed = createGovernedProvider({
      router,
      identity: testIdentity,
      model: modelPrimary,
    });

    assert.equal(isGovernedProvider(plainMock), false);
    assert.equal(isGovernedProvider(governed), true);
    assert.equal(governed.isGoverned, true);
    assert.equal(governed.model?.model, "gpt-4o");
    assert.equal(governed.router, router);
  });
});
