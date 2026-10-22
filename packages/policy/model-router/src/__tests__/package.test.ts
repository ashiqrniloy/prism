import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type LoopStrategy,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerPackage } from "@arnilo/prism/provider-kit";
import modelRouter, {
  createModelRouter,
} from "../index.js";

function mockProvider(
  id: string,
  options: {
    failBeforeOutput?: boolean;
    failAfterOutput?: boolean;
    tokens?: number;
    text?: string;
  } = {},
): ModelProvider {
  return {
    id,
    async *generate(_request: ProviderRequest): AsyncIterable<ProviderEvent> {
      if (options.failBeforeOutput) {
        throw new Error(`${id}: failed before output`);
      }
      yield providerTextDelta(options.text ?? `hello from ${id}`);
      if (options.failAfterOutput) {
        throw new Error(`${id}: failed after output`);
      }
      yield providerDone({
        inputTokens: options.tokens ? Math.floor(options.tokens / 2) : 5,
        outputTokens: options.tokens ? Math.ceil(options.tokens / 2) : 5,
        totalTokens: options.tokens ?? 10,
        cost: (options.tokens ?? 10) * 0.00001,
      });
    },
  };
}

describe("model router package", () => {
  it("model_router_package_conformance", async () => {
    const result = await packageConformance(modelRouter, {
      config: { candidates: ["conformance-provider/conformance"] },
    });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("model_router_same_provider_uses_next", async () => {
    const _nextCalled = false;
    const providerA = mockProvider("mock-same", { text: "from next" });

    const agent = await createAgent({
      id: "agent-same-provider",
      model: { provider: "mock-same", model: "alpha" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("pkg-same", [providerA]),
        modelRouter({
          candidates: ["mock-same/alpha"],
          select: "ordered",
        }),
      ],
    });

    const session = await agent.session({ id: "s-same", create: true });
    const run = await session.run("test same provider");

    assert.equal(run.status, "completed");
    assert.equal(run.text, "from next");
    await agent.dispose();
  });

  it("model_router_cross_provider_uses_models_client", async () => {
    const providerA = mockProvider("mock-a", { text: "from provider A" });
    const providerB = mockProvider("mock-b", { text: "from provider B" });

    const agent = await createAgent({
      id: "agent-cross-provider",
      model: { provider: "mock-a", model: "m1" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("pkg-a", [providerA]),
        providerPackage("pkg-b", [providerB]),
        modelRouter({
          candidates: ["mock-b/m2"],
          select: "ordered",
        }),
      ],
    });

    const session = await agent.session({ id: "s-cross", create: true });
    const run = await session.run("test cross provider");

    assert.equal(run.status, "completed");
    assert.equal(run.text, "from provider B");
    await agent.dispose();
  });

  it("model_router_falls_through_before_output", async () => {
    const events: AgentEvent[] = [];
    const provider1 = mockProvider("prov-1", { failBeforeOutput: true });
    const provider2 = mockProvider("prov-2", { text: "fallback success" });

    const agent = await createAgent({
      id: "agent-fallback",
      model: { provider: "prov-1", model: "c1" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("pkg-p1", [provider1]),
        providerPackage("pkg-p2", [provider2]),
        modelRouter({
          candidates: ["prov-1/c1", "prov-2/c2"],
          select: "ordered",
          circuit: { failureThreshold: 2, cooldownMs: 10_000 },
        }),
      ],
    });

    const session = await agent.session({ id: "s-fallback", create: true });
    const sub = session.subscribe();
    const runPromise = session.run("test fallback");

    for await (const ev of sub) {
      events.push(ev);
    }
    const run = await runPromise;

    assert.equal(run.status, "completed");
    assert.equal(run.text, "fallback success");

    const decisions = events
      .filter((e) => e.type === "package.event" && (e as any).name === "router.decision")
      .map((e) => (e as any).data);

    assert.equal(decisions.length >= 2, true);
    assert.equal(decisions[0].candidate.provider, "prov-1");
    assert.equal(decisions[0].candidate.model, "c1");
    assert.equal(decisions[0].outcome, "selected");

    const errDecision = decisions.find((d) => d.outcome === "error");
    assert.ok(errDecision);
    assert.equal(errDecision.candidate.provider, "prov-1");

    const succDecision = decisions.find((d) => d.outcome === "selected" && d.candidate.provider === "prov-2");
    assert.ok(succDecision);
    assert.equal(succDecision.candidate.model, "c2");

    await agent.dispose();
  });

  it("model_router_error_after_output_fails_turn", async () => {
    const provider1 = mockProvider("prov-1", { failAfterOutput: true });
    const provider2 = mockProvider("prov-2", { text: "should not be called" });

    const agent = await createAgent({
      id: "agent-fail-after-output",
      model: { provider: "prov-1", model: "c1" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("pkg-p1", [provider1]),
        providerPackage("pkg-p2", [provider2]),
        modelRouter({
          candidates: ["prov-1/c1", "prov-2/c2"],
          select: "ordered",
        }),
      ],
    });

    const session = await agent.session({ id: "s-fail-after", create: true });
    const run = await session.run("test after output");

    assert.equal(run.status, "failed");
    assert.match(run.error?.message ?? "", /failed after output/);

    await agent.dispose();
  });

  it("model_router_budget_denies_and_fails_closed", async () => {
    let providerCalled = false;
    const provider: ModelProvider = {
      id: "mock-budget",
      async *generate() {
        providerCalled = true;
        yield providerDone({ totalTokens: 50 });
      },
    };

    const agent = await createAgent({
      id: "agent-budget-deny",
      model: { provider: "mock-budget", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("pkg-budget", [provider]),
        modelRouter({
          candidates: ["mock-budget/m"],
          budgets: {
            maxTokens: 0,
            windowMs: 60_000,
          },
        }),
      ],
    });

    const session = await agent.session({ id: "s-budget", create: true });
    const run = await session.run("test budget denial");

    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "ERR_PRISM_MODEL_ROUTER_BUDGET");
    assert.equal(providerCalled, false);

    await agent.dispose();
  });

  it("model_router_abort_releases_reservation", async () => {
    const router = createModelRouter({
      budgets: { maxTokens: 100, windowMs: 60_000 },
    });

    const identity = {
      tenantId: "t-abort",
      principal: { id: "p-abort", kind: "user" as const },
      scopes: ["model:route"],
      verified: true as const,
      issuedAt: new Date().toISOString(),
    };

    const resolved = await router.resolve({
      model: { provider: "mock", model: "m" },
      identity,
      maxTokens: 50,
    });

    assert.ok(resolved.budgetReservation);
    const budgetBefore = await router.readBudget({ identity });
    // Reserved tokens are pending
    assert.equal(budgetBefore.tokens, 0);

    // Release on abort
    await router.releaseBudget({
      identity,
      provider: "mock",
      model: "m",
      budgetReservation: resolved.budgetReservation,
    });

    // Another reservation of 100 tokens can now succeed because the 50 token reservation was released
    const resolvedAgain = await router.resolve({
      model: { provider: "mock", model: "m" },
      identity,
      maxTokens: 100,
    });
    assert.ok(resolvedAgain.budgetReservation);
  });

  it("model_router_from_custom_loop", async () => {
    let customLoopRan = false;
    const customLoop: LoopStrategy = {
      name: "custom-loop",
      async run(run) {
        customLoopRan = true;
        await run.turn();
      },
    };

    const provider = mockProvider("mock-loop", { text: "custom loop result" });

    const agent = await createAgent({
      id: "agent-custom-loop",
      model: { provider: "mock-loop", model: "m" },
      slots: {
        store: createMemorySessionStore(),
        loop: customLoop,
      },
      packages: [
        providerPackage("pkg-loop", [provider]),
        modelRouter({
          candidates: ["mock-loop/m"],
          select: "ordered",
        }),
      ],
    });

    const session = await agent.session({ id: "s-loop", create: true });
    const run = await session.run("test loop");

    assert.equal(customLoopRan, true);
    assert.equal(run.status, "completed");
    assert.equal(run.text, "custom loop result");

    await agent.dispose();
  });

  it("model_router_decision_names_routed_model", async () => {
    const events: AgentEvent[] = [];
    const provider = mockProvider("mock-dec", { text: "decision test" });

    const agent = await createAgent({
      id: "agent-decision",
      model: { provider: "mock-dec", model: "model-1" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("pkg-dec", [provider]),
        modelRouter({
          candidates: ["mock-dec/model-1"],
        }),
      ],
    });

    const session = await agent.session({ id: "s-decision", create: true });
    const sub = session.subscribe();
    const runPromise = session.run("test decision");

    for await (const ev of sub) {
      events.push(ev);
    }
    await runPromise;

    const decisions = events
      .filter((e) => e.type === "package.event" && (e as any).name === "router.decision")
      .map((e) => (e as any).data);

    assert.equal(decisions.length >= 1, true);
    assert.deepEqual(decisions[0].candidate, { provider: "mock-dec", model: "model-1" });
    assert.equal(decisions[0].outcome, "selected");
    assert.equal(decisions[0].attempt, 1);

    await agent.dispose();
  });
});
