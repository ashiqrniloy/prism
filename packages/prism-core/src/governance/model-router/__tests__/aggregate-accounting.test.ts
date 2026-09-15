import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, AIProvider, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { ModelRouterError } from "../errors.js";
import { createModelRouter } from "../router.js";
import type { ModelRouterDiagnostics } from "../types.js";

function identity(tenantId = "tenant-1", principalId = "agent-1"): AgentIdentity {
  return {
    tenantId,
    userId: "user-1",
    principal: { kind: "agent", id: principalId },
    scopes: ["model:route"],
    issuedAt: "2026-08-01T00:00:00.000Z",
    verified: true,
  };
}

function model(providerId: string, modelId: string, cost?: { input?: number; output?: number }): ModelConfig {
  return {
    provider: providerId,
    model: modelId,
    ...(cost ? { cost: { input: cost.input, output: cost.output } } : {}),
  };
}

function mockProvider(id: string): AIProvider {
  return {
    id,
    async *generate(_request: ProviderRequest): AsyncIterable<ProviderEvent> {
      yield { type: "message_start", messageId: "msg-1" };
      yield { type: "content_delta", content: { type: "text", text: "hello" } };
      yield {
        type: "usage",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cost: 0.15,
        },
      };
      yield { type: "done" };
    },
  };
}

describe("Task 7: Aggregate task/tenant accounting across all paid work", () => {
  it("cross-model and child concurrent cap: 32 concurrent requests under shared task budget", async () => {
    const currentTime = 1_000;
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      now: () => currentTime,
      budgets: {
        maxCostUsd: 10, // Total task budget: $10
        reservationTtlMs: 60_000,
      },
    });

    const tenantIdent = identity("tenant-shared", "worker-pool");
    const taskId = "task-batch-32";

    // 32 concurrent requests across two models
    const requests = Array.from({ length: 32 }, (_, i) => {
      const isModelA = i % 2 === 0;
      const candidateModel = isModelA
        ? model("openai", "gpt-4o", { input: 0.005, output: 0.015 })
        : model("anthropic", "claude-3-5-sonnet", { input: 0.003, output: 0.015 });

      return router.resolve({
        model: candidateModel,
        identity: tenantIdent,
        taskId,
        kind: "generation",
        attemptId: `attempt-${i}`,
        maxCostUsd: 1.0, // Each request reserves $1.00
      });
    });

    const results = await Promise.allSettled(requests);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<(typeof requests)[0]>> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    // Exactly 10 requests admitted ($10 / $1 = 10 holds)
    assert.equal(fulfilled.length, 10);
    // Remaining 22 requests denied fail-closed
    assert.equal(rejected.length, 22);

    for (const rej of rejected) {
      assert.ok(rej.reason instanceof ModelRouterError);
      assert.equal(rej.reason.code, "ERR_PRISM_MODEL_ROUTER_BUDGET");
    }

    // Read the budget state: all $10 is reserved (0 actual committed yet)
    const initialBudget = await router.readBudget({
      identity: tenantIdent,
      taskId,
    });
    assert.equal(initialBudget.tokens, 0);
    assert.equal(initialBudget.costUsd, 0);

    // Commit 5 of the admitted reservations with partial actual usage ($0.20 each)
    for (let i = 0; i < 5; i++) {
      const item = fulfilled[i]!.value;
      await router.recordUsage({
        identity: tenantIdent,
        provider: item.model.provider,
        model: item.model.model,
        taskId,
        kind: "generation",
        costUsd: 0.2,
        tokens: 50,
        budgetReservation: item.budgetReservation,
      });
    }

    // Release the other 5 unneeded reservations
    for (let i = 5; i < 10; i++) {
      const item = fulfilled[i]!.value;
      await router.releaseBudget({
        identity: tenantIdent,
        provider: item.model.provider,
        model: item.model.model,
        taskId,
        kind: "generation",
        budgetReservation: item.budgetReservation!,
      });
    }

    // Now 5 * $0.20 = $1.00 committed, and remaining $9.00 capacity is free again
    const midBudget = await router.readBudget({
      identity: tenantIdent,
      taskId,
    });
    assert.equal(midBudget.costUsd, 1.0);
    assert.equal(midBudget.tokens, 250);

    // A new request can now be admitted because capacity was released
    const followup = await router.resolve({
      model: model("openai", "gpt-4o", { input: 0.005, output: 0.015 }),
      identity: tenantIdent,
      taskId,
      kind: "generation",
      maxCostUsd: 1.0,
    });
    assert.ok(followup.budgetReservation);
  });

  it("replay idempotency / duplicate commit rejection", async () => {
    const currentTime = 1_000;
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      now: () => currentTime,
      budgets: { maxCostUsd: 10 },
    });

    const ident = identity("tenant-idemp");
    const taskId = "task-idemp";

    const selection = await router.resolve({
      model: model("openai", "gpt-4o", { input: 0.01, output: 0.03 }),
      identity: ident,
      taskId,
      kind: "generation",
      maxCostUsd: 2.0,
    });
    assert.ok(selection.budgetReservation);

    // First commit succeeds
    await router.recordUsage({
      identity: ident,
      provider: "openai",
      model: "gpt-4o",
      taskId,
      kind: "generation",
      costUsd: 1.5,
      tokens: 100,
      budgetReservation: selection.budgetReservation,
    });

    // Replaying / duplicate commit with same reservation fails closed
    await assert.rejects(
      () =>
        router.recordUsage({
          identity: ident,
          provider: "openai",
          model: "gpt-4o",
          taskId,
          kind: "generation",
          costUsd: 1.5,
          tokens: 100,
          budgetReservation: selection.budgetReservation,
        }),
      (err: unknown) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );

    // Attempting to release an already committed reservation also fails closed
    await assert.rejects(
      () =>
        router.releaseBudget({
          identity: ident,
          provider: "openai",
          model: "gpt-4o",
          taskId,
          kind: "generation",
          budgetReservation: selection.budgetReservation!,
        }),
      (err: unknown) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
  });

  it("expired and stale fencing token rejection", async () => {
    const currentTime = 1_000;
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      now: () => currentTime,
      budgets: { maxCostUsd: 10 },
    });

    const ident = identity("tenant-fence");
    const taskId = "task-fence";

    const selection = await router.resolve({
      model: model("openai", "gpt-4o", { input: 0.01, output: 0.03 }),
      identity: ident,
      taskId,
      kind: "generation",
      maxCostUsd: 2.0,
    });
    assert.ok(selection.budgetReservation);

    // Foreign fencing token rejected
    await assert.rejects(
      () =>
        router.recordUsage({
          identity: ident,
          provider: "openai",
          model: "gpt-4o",
          taskId,
          kind: "generation",
          costUsd: 1.0,
          budgetReservation: {
            reservationId: selection.budgetReservation!.reservationId,
            fencingToken: "stale-or-foreign-token",
          },
        }),
      (err: unknown) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
  });

  it("crash before settle: expired reservation charged conservatively as unknown usage", async () => {
    let currentTime = 1_000;
    let diagnosticsEmitted: ModelRouterDiagnostics | undefined;

    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      now: () => currentTime,
      budgets: {
        maxCostUsd: 5.0,
        reservationTtlMs: 30_000,
      },
      onDiagnostics: (diag) => {
        diagnosticsEmitted = diag;
      },
    });

    const ident = identity("tenant-crash");
    const taskId = "task-crash";

    const selection = await router.resolve({
      model: model("openai", "gpt-4o", { input: 0.01, output: 0.03 }),
      identity: ident,
      taskId,
      kind: "generation",
      maxCostUsd: 2.0,
    });
    assert.ok(selection.budgetReservation);

    // Advance clock past reservation TTL (crash / hang before settle)
    currentTime += 35_000;

    // Late commit: worker crashed and restarted, or slow network response arrived late
    await router.recordUsage({
      identity: ident,
      provider: "openai",
      model: "gpt-4o",
      taskId,
      kind: "generation",
      costUsd: 0.5, // Actual was only $0.50, but reservation expired
      budgetReservation: selection.budgetReservation,
    });

    // Check diagnostics emitted unknown_usage
    assert.equal(diagnosticsEmitted?.reason, "unknown_usage");

    // Conservative liability: the full reserved amount ($2.00) is charged to prevent oversubscription
    const budget = await router.readBudget({
      identity: ident,
      taskId,
    });
    assert.equal(budget.costUsd, 2.0);
  });

  it("renewal hold (renewBudget) extends TTL and advances fencing token", async () => {
    let currentTime = 1_000;
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      now: () => currentTime,
      budgets: {
        maxCostUsd: 5.0,
        reservationTtlMs: 30_000, // 30s TTL
      },
    });

    const ident = identity("tenant-renew");
    const taskId = "task-renew";

    const selection = await router.resolve({
      model: model("openai", "gpt-4o", { input: 0.01, output: 0.03 }),
      identity: ident,
      taskId,
      kind: "generation",
      maxCostUsd: 2.0,
    });
    assert.ok(selection.budgetReservation);
    const initialFencing = selection.budgetReservation.fencingToken;

    // Advance clock to 25s (near expiration)
    currentTime += 25_000;

    // Renew hold for another 30s
    const renewed = await router.renewBudget({
      identity: ident,
      provider: "openai",
      model: "gpt-4o",
      taskId,
      kind: "generation",
      budgetReservation: selection.budgetReservation,
      extendTtlMs: 30_000,
    });

    assert.equal(renewed.reservationId, selection.budgetReservation.reservationId);
    assert.notEqual(renewed.fencingToken, initialFencing, "fencing token must advance on renewal");

    // Old fencing token can no longer commit
    await assert.rejects(
      () =>
        router.recordUsage({
          identity: ident,
          provider: "openai",
          model: "gpt-4o",
          taskId,
          kind: "generation",
          costUsd: 1.0,
          budgetReservation: selection.budgetReservation,
        }),
      (err: unknown) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );

    // Advance clock another 15s (total 40s from start, beyond original 30s TTL)
    currentTime += 15_000;

    // Commit with renewed reservation succeeds!
    await router.recordUsage({
      identity: ident,
      provider: "openai",
      model: "gpt-4o",
      taskId,
      kind: "generation",
      costUsd: 1.2,
      budgetReservation: renewed,
    });

    const budget = await router.readBudget({
      identity: ident,
      taskId,
    });
    assert.equal(budget.costUsd, 1.2);
  });

  it("renewal failure on expired hold fails closed", async () => {
    let currentTime = 1_000;
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      now: () => currentTime,
      budgets: {
        maxCostUsd: 5.0,
        reservationTtlMs: 30_000,
      },
    });

    const ident = identity("tenant-expired-renew");
    const taskId = "task-expired-renew";

    const selection = await router.resolve({
      model: model("openai", "gpt-4o", { input: 0.01, output: 0.03 }),
      identity: ident,
      taskId,
      kind: "generation",
      maxCostUsd: 2.0,
    });
    assert.ok(selection.budgetReservation);

    // Advance clock past expiration
    currentTime += 35_000;

    // Attempting to renew an expired reservation fails closed
    await assert.rejects(
      () =>
        router.renewBudget({
          identity: ident,
          provider: "openai",
          model: "gpt-4o",
          taskId,
          kind: "generation",
          budgetReservation: selection.budgetReservation!,
        }),
      (err: unknown) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_STATE" && err.message.includes("expired"),
    );
  });

  it("strict hard-budget mode: denies candidate lacking pricing configuration", async () => {
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      budgets: {
        maxCostUsd: 10.0,
        strict: true,
      },
    });

    const ident = identity("tenant-strict-price");

    // Candidate model with NO pricing info
    const unpricedModel = model("custom-provider", "unpriced-model");

    await assert.rejects(
      () =>
        router.resolve({
          model: unpricedModel,
          identity: ident,
          maxCostUsd: 1.0,
        }),
      (err: unknown) =>
        err instanceof ModelRouterError &&
        err.code === "ERR_PRISM_MODEL_ROUTER_BUDGET" &&
        err.message.includes("strict hard-budget mode denies candidate lacking pricing configuration"),
    );

    // Candidate model WITH pricing info succeeds
    const pricedModel = model("custom-provider", "priced-model", { input: 0.001, output: 0.002 });
    const selection = await router.resolve({
      model: pricedModel,
      identity: ident,
      maxCostUsd: 1.0,
    });
    assert.ok(selection.provider);
  });

  it("strict hard-budget mode: denies calls lacking enforceable bounds", async () => {
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      budgets: {
        maxCostUsd: 10.0,
        strict: true,
      },
    });

    const ident = identity("tenant-strict-bounds");
    const pricedModel = model("custom-provider", "priced-model", { input: 0.001, output: 0.002 });

    // Call has NO maxCostUsd and NO maxTokens, and candidate has NO maxOutputTokens
    await assert.rejects(
      () =>
        router.resolve({
          model: pricedModel,
          identity: ident,
        }),
      (err: unknown) =>
        err instanceof ModelRouterError &&
        err.code === "ERR_PRISM_MODEL_ROUTER_BUDGET" &&
        err.message.includes("strict hard-budget mode denies calls lacking enforceable cost or output bounds"),
    );
  });

  it("paid work categories (generation, embedding, compaction, tool) charging and attribution breakdown", async () => {
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      budgets: { maxCostUsd: 50.0 },
    });

    const ident = identity("tenant-paid-work");
    const taskId = "task-full-lifecycle";

    // 1. Generation
    await router.recordUsage({
      identity: ident,
      provider: "openai",
      model: "gpt-4o",
      taskId,
      kind: "generation",
      tokens: 100,
      costUsd: 0.5,
    });

    // 2. Embedding
    await router.recordUsage({
      identity: ident,
      provider: "openai",
      model: "text-embedding-3-small",
      taskId,
      kind: "embedding",
      tokens: 500,
      costUsd: 0.05,
    });

    // 3. Compaction
    await router.recordUsage({
      identity: ident,
      provider: "anthropic",
      model: "claude-3-haiku",
      taskId,
      kind: "compaction",
      tokens: 200,
      costUsd: 0.2,
    });

    // 4. Paid Tool
    await router.recordUsage({
      identity: ident,
      provider: "browser",
      model: "web-search",
      taskId,
      kind: "tool",
      tokens: 0,
      costUsd: 0.02,
    });

    const report = await router.readBudget({
      identity: ident,
      taskId,
    });

    assert.equal(report.tokens, 800);
    assert.equal(Math.round(report.costUsd * 100) / 100, 0.77);

    // Verify byKind decomposition
    assert.ok(report.byKind);
    assert.deepEqual(report.byKind.generation, { tokens: 100, costUsd: 0.5, count: 1 });
    assert.deepEqual(report.byKind.embedding, { tokens: 500, costUsd: 0.05, count: 1 });
    assert.deepEqual(report.byKind.compaction, { tokens: 200, costUsd: 0.2, count: 1 });
    assert.deepEqual(report.byKind.tool, { tokens: 0, costUsd: 0.02, count: 1 });

    // Verify byModel decomposition
    assert.ok(report.byModel);
    assert.deepEqual(report.byModel["openai:gpt-4o"], { tokens: 100, costUsd: 0.5, count: 1 });
    assert.deepEqual(report.byModel["openai:text-embedding-3-small"], { tokens: 500, costUsd: 0.05, count: 1 });
    assert.deepEqual(report.byModel["anthropic:claude-3-haiku"], { tokens: 200, costUsd: 0.2, count: 1 });
    assert.deepEqual(report.byModel["browser:web-search"], { tokens: 0, costUsd: 0.02, count: 1 });

    // Verify granular attributions
    assert.ok(report.attributions);
    assert.equal(Object.keys(report.attributions).length, 4);
  });

  it("cross-tenant budget references reject", async () => {
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      budgets: { maxCostUsd: 10.0 },
    });

    const tenantA = identity("tenant-A");
    const tenantB = identity("tenant-B");
    const taskId = "task-cross-tenant";

    const selection = await router.resolve({
      model: model("openai", "gpt-4o", { input: 0.01, output: 0.03 }),
      identity: tenantA,
      taskId,
      kind: "generation",
      maxCostUsd: 1.0,
    });
    assert.ok(selection.budgetReservation);

    // Tenant B attempts to commit Tenant A's reservation
    await assert.rejects(
      () =>
        router.recordUsage({
          identity: tenantB,
          provider: "openai",
          model: "gpt-4o",
          taskId,
          kind: "generation",
          costUsd: 0.5,
          budgetReservation: selection.budgetReservation,
        }),
      (err: unknown) => err instanceof ModelRouterError && err.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
  });

  it("GovernedProvider end-to-end integration with taskId, kind, and renewBudget", async () => {
    const currentTime = 1_000;
    const router = createModelRouter({
      resolver: (cfg) => mockProvider(cfg.provider),
      now: () => currentTime,
      budgets: { maxCostUsd: 10.0, reservationTtlMs: 60_000 },
    });

    const ident = identity("tenant-gov-pvd");
    const taskId = "task-gov-1";

    let settlementRecorded = false;
    const governed = router.createGovernedProvider({
      identity: ident,
      model: model("openai", "gpt-4o", { input: 0.01, output: 0.03 }),
      taskId,
      kind: "generation",
      maxCostUsd: 1.0,
      onSettlement: (settlement) => {
        settlementRecorded = true;
        assert.equal(settlement.outcome, "success");
        assert.equal(settlement.taskId, taskId);
        assert.equal(settlement.kind, "generation");
        assert.equal(settlement.budgetCommitted, true);
      },
    });

    assert.equal(governed.isGoverned, true);
    assert.equal(governed.taskId, taskId);
    assert.equal(governed.kind, "generation");

    // Execute provider stream
    const events: ProviderEvent[] = [];
    for await (const ev of governed.generate({
      model: model("openai", "gpt-4o"),
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      events.push(ev);
    }

    assert.ok(events.length > 0);
    assert.equal(settlementRecorded, true);

    // Verify task budget recorded
    const budget = await router.readBudget({
      identity: ident,
      taskId,
    });
    assert.equal(budget.costUsd, 0.15);
    assert.equal(budget.tokens, 30);
    assert.ok(budget.byModel?.["openai:gpt-4o"]);
    assert.ok(budget.byKind?.generation);
  });
});
