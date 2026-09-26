/**
 * Fixed-model aggregate budget composition across host step loops (plan 122 Task 4).
 *
 * One `taskId` owns one aggregate liability pool: three `session.run()` calls plus one auxiliary
 * production call all reserve from the same atomic ceiling, so a per-run token cap is never a
 * per-run reset. The model is pinned (no fallbacks configured), which keeps accounting policy-
 * preserving: the host chose the model, the router only tracks cumulative spend.
 *
 * The auxiliary call is admitted through `router.resolve` directly so the host can demonstrate
 * hold-renewal fencing: `renewBudget` advances the fencing token and the pre-renewal handle can no
 * longer commit. The second scenario settles a provider that emits no usage at all: the reservation
 * amount is charged as unknown liability (`unknownUsage: true`), never assumed to be zero.
 *
 * `readBudget` is the remaining-aggregate read for host UIs. It is intentionally separate from the
 * context-window axis: no attention threshold is touched or faked to represent another run's spend.
 *
 * Budget state here is in-memory (process-local). A host that needs spend to survive worker restarts
 * passes a durable `ModelRouterStateStore` (for example enterprise PostgreSQL); the example states
 * that boundary instead of implying durability. Making it live is one seam: replace the mock
 * resolver with a real provider factory (and a durable state store). The demo itself reads no
 * credentials and performs no network I/O.
 *
 * Run: npm run build:core && node examples/model-router-aggregate-budgets.ts
 */
import {
  type AgentIdentity,
  AgentRunError,
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  type ModelConfig,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type Usage,
} from "@arnilo/prism";
import {
  createGovernedProvider,
  createModelRouter,
  type GovernedInvocationSettlement,
  ModelRouterError,
} from "@arnilo/prism-core/governance/model-router";

const identity: AgentIdentity = {
  tenantId: "tenant-aggregate-demo",
  userId: "user-1",
  principal: { id: "user-1", kind: "user" },
  scopes: ["llm:generate"],
  verified: true,
  issuedAt: new Date().toISOString(),
};

/** The policy-preserving pin: every paid call in the composition targets this one model. */
const pinned: ModelConfig = {
  provider: "mock",
  model: "fixed-pin",
  limits: { contextWindow: 200_000, maxOutputTokens: 4_096 },
};

const ceilingTokens = 30;
const perRunReservationTokens = 15;
const perRunUsageTokens = 12;
const auxiliaryReservationTokens = 5;
const auxiliaryUsageTokens = 3;
const unknownReservationTokens = 15;

function mockProvider(usage?: Usage): AIProvider {
  return {
    id: "mock",
    async *generate(_request: ProviderRequest): AsyncIterable<ProviderEvent> {
      yield providerTextDelta("mock turn complete");
      // `providerDone()` without usage is the honest "provider did not report" case.
      yield providerDone(usage);
    },
  };
}

function failedCode(result: { readonly error?: { readonly code?: string | number } }): string | number | undefined {
  return result.error?.code;
}

export async function demo(): Promise<Record<string, unknown>> {
  const settlements: GovernedInvocationSettlement[] = [];

  // --- Scenario A: one aggregate ceiling across three runs and one auxiliary call ----------------
  const router = createModelRouter({
    resolver: (_target: ModelConfig) => mockProvider({ inputTokens: 7, outputTokens: 5, totalTokens: perRunUsageTokens }),
    budgets: { maxTokens: ceilingTokens, windowMs: 86_400_000 },
  });
  const taskId = "task-aggregate";
  const governed = createGovernedProvider({
    router,
    identity,
    id: pinned.provider,
    model: pinned,
    maxTokens: perRunReservationTokens,
    taskId,
    kind: "generation",
    onSettlement: (settlement) => {
      settlements.push(settlement);
    },
  });
  const agent = createAgent({
    id: "aggregate-budget-agent",
    model: pinned,
    store: createMemorySessionStore(),
    provider: governed,
  });
  const session = agent.createSession({ id: "aggregate-budget-session" });

  const run1 = await session.run("step 1");

  // Auxiliary production work (compaction/embedding-shaped): the host admits it on the same task
  // pool by hand, renews the hold, then commits once. The pre-renewal handle is fenced off.
  const selection = await router.resolve({
    model: pinned,
    identity,
    taskId,
    kind: "compaction",
    maxTokens: auxiliaryReservationTokens,
  });
  const reservation = selection.budgetReservation;
  if (!reservation) throw new Error("expected an admission reservation for the auxiliary call");
  const renewed = await router.renewBudget({
    identity,
    provider: pinned.provider,
    model: pinned.model,
    taskId,
    kind: "compaction",
    budgetReservation: reservation,
    extendTtlMs: 60_000,
  });
  const fencingAdvanced = renewed.fencingToken !== reservation.fencingToken;
  let staleCommitRejected = false;
  try {
    await router.recordUsage({
      identity,
      provider: pinned.provider,
      model: pinned.model,
      taskId,
      kind: "compaction",
      tokens: auxiliaryUsageTokens,
      budgetReservation: reservation,
    });
  } catch (error) {
    staleCommitRejected = error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE";
  }
  await router.recordUsage({
    identity,
    provider: pinned.provider,
    model: pinned.model,
    taskId,
    kind: "compaction",
    tokens: auxiliaryUsageTokens,
    budgetReservation: renewed,
  });

  const run2 = await session.run("step 2");
  let denied: { readonly status: string; readonly error?: { readonly code?: string | number } };
  try {
    const result = await session.run("step 3");
    denied = { status: result.status };
  } catch (error) {
    if (!(error instanceof AgentRunError)) throw error;
    denied = { status: error.result.status, error: error.result.error };
  }
  const budget = await router.readBudget({ identity, taskId });

  // --- Scenario B: missing usage settles as reserved liability, never zero ----------------------
  const unknownSettlements: GovernedInvocationSettlement[] = [];
  const unknownRouter = createModelRouter({
    resolver: () => mockProvider(),
    budgets: { maxTokens: 20, windowMs: 86_400_000 },
  });
  const unknownTaskId = "task-unknown-usage";
  const unknownGoverned = createGovernedProvider({
    router: unknownRouter,
    identity,
    id: pinned.provider,
    model: pinned,
    maxTokens: unknownReservationTokens,
    taskId: unknownTaskId,
    kind: "generation",
    onSettlement: (settlement) => {
      unknownSettlements.push(settlement);
    },
  });
  const unknownAgent = createAgent({
    id: "aggregate-budget-unknown-agent",
    model: pinned,
    store: createMemorySessionStore(),
    provider: unknownGoverned,
  });
  const unknownRun = await unknownAgent.createSession({ id: "aggregate-budget-unknown-session" }).run("step");
  const unknownBudget = await unknownRouter.readBudget({ identity, taskId: unknownTaskId });

  return {
    modelPin: { provider: pinned.provider, model: pinned.model, configuredFallbacks: 0 },
    aggregate: {
      ceilingTokens,
      perRunReservationTokens,
      usedTokens: budget.tokens,
      remainingTokens: ceilingTokens - budget.tokens,
      byModel: budget.byModel,
      byKind: budget.byKind,
    },
    runs: [
      { step: 1, status: run1.status, model: settlements[0]?.model.model, outcome: settlements[0]?.outcome },
      { step: 2, status: run2.status, model: settlements[1]?.model.model, outcome: settlements[1]?.outcome },
      { step: 3, status: denied.status, deniedCode: failedCode(denied) },
    ],
    auxiliary: {
      kind: "compaction",
      reservationTokens: auxiliaryReservationTokens,
      usageTokens: auxiliaryUsageTokens,
      fencingAdvanced,
      staleCommitRejected,
      modelsObserved: settlements.map((settlement) => settlement.model.model),
    },
    unknownUsage: {
      status: unknownRun.status,
      settlementUnknownUsage: unknownSettlements[0]?.unknownUsage,
      budgetCommitted: unknownSettlements[0]?.budgetCommitted,
      chargedTokens: unknownBudget.tokens,
      reservationTokens: unknownReservationTokens,
    },
    contextPressure: {
      contextWindowTokens: pinned.limits?.contextWindow ?? 0,
      aggregateRemainingTokens: ceilingTokens - budget.tokens,
      note: "aggregate liability is read via router.readBudget; no attention threshold is derived from another run's spend",
    },
    boundary: "in-memory router state; pass a durable ModelRouterStateStore for cross-worker spend",
  };
}

export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
