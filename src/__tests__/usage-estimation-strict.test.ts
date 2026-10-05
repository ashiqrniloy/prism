/** Plan 103 T5: `usageEstimation: "strict"` refuses a usage-less turn instead of estimating it. */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type {
  AgentEvent,
  Session,
  CostCatalog,
  Message,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  RetryOptions,
  RunLedger,
  UsageRecord,
} from "../index.js";
import {
  createAgent,
  createDefaultRetryPolicy,
  createMemorySessionStore,
  estimateMessageTokens,
  providerDone,
  providerError,
  providerTextDelta,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL: ModelConfig = { provider: "mock", model: "claude-sonnet-4.5", limits: { contextWindow: 100_000 } };
const REPORTED = { inputTokens: 1_234, outputTokens: 56, totalTokens: 1_290 };

function memoryLedger(): { ledger: RunLedger; usage: UsageRecord[] } {
  const usage: UsageRecord[] = [];
  return {
    usage,
    ledger: {
      appendRun: () => {},
      appendEvent: () => {},
      appendToolCall: () => {},
      appendUsage: (record) => {
        usage.push(record);
      },
    },
  };
}

/** Permissive policy: retries every failure, so a refusal that still retried would be visible. */
const alwaysRetry: RetryOptions = { policy: { name: "always", decide: () => ({ retry: true, delayMs: 0 }) } };

/** Provider that yields a fixed script and counts how many times it was asked to generate. */
function scriptedProvider(events: readonly ProviderEvent[], attempts: { count: number }, onRequest?: (request: ProviderRequest) => void) {
  return {
    id: "mock",
    async *generate(request: ProviderRequest) {
      attempts.count += 1;
      onRequest?.(request);
      yield* events;
    },
  };
}

async function createStrictSession(
  usageEstimation: "strict" | "fallback" | "off",
  provider: ReturnType<typeof scriptedProvider>,
  ledger: RunLedger,
  costCatalog?: CostCatalog,
): Promise<Session> {
  const agent = await createAgent({
    id: `usage-${usageEstimation}`,
    slots: { store: createMemorySessionStore() },
    model: MODEL,
    packages: [providerPackage("test-provider", [provider])],
    usageEstimation,
    runLedger: ledger,
    ...(costCatalog === undefined ? {} : { costCatalog }),
  });
  return await agent.session({ id: `usage-${usageEstimation}-session`, create: true });
}

async function runSession(session: Session, input: string, options: Parameters<Session["run"]>[1] = {}) {
  const events: AgentEvent[] = [];
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  const outcome = await session.run(input, options).then(
    (result) => ({ result, error: undefined as unknown }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await pump;
  return { events, ...outcome };
}

/** Test-only reach into the private history (same cast pattern as `context-meter-cache.test.ts`). */
function historyOf(session: Session): Message[] {
  return (session as unknown as { history: Message[] }).history;
}

const turnFinished = (events: readonly AgentEvent[]) => {
  const event = events.find((candidate) => candidate.type === "turn.completed");
  assert.ok(event?.type === "turn.completed", "a provider turn must finish");
  return event;
};

describe('usageEstimation: "strict" (plan 103 T5)', () => {
  it("refuses a usage-less turn with a typed, non-retryable error and records nothing", async () => {
    const { ledger, usage } = memoryLedger();
    const attempts = { count: 0 };
    const catalogCalls: string[] = [];
    const catalog: CostCatalog = {
      get: async (modelId) => {
        catalogCalls.push(modelId);
        return { input: 3, output: 12, unit: "per_million_tokens" };
      },
    };
    const session = await createStrictSession(
      "strict",
      scriptedProvider([providerTextDelta("ok"), providerDone()], attempts),
      ledger,
      catalog,
    );
    const before = session.contextMeter().inputTokens;

    const { events, result, error } = await runSession(session, "hello", { retry: alwaysRetry, limits: { maxTurns: 4 } });

    assert.equal(error, undefined, "a refused run returns its result");
    assert.equal(result?.error?.code, "usage_missing");
    assert.equal(result?.error?.name, "UsageMissingError");
    assert.equal(result?.error?.failureClass, undefined, "a harness refusal is not a provider failure");
    assert.match(result?.error?.message ?? "", /turn 1.*usageEstimation is "strict"/);
    assert.equal(result?.usage, undefined, "usage stays absent, never zero");
    assert.equal(result?.status, "failed");
    assert.equal(attempts.count, 1, "an observable refusal is never retried, whatever the policy says");
    assert.deepEqual(catalogCalls, [], "the cost catalog is never consulted for a refused turn");
    assert.equal(usage.length, 0, "no provider_turn row and no run_total aggregate");

    const turn = turnFinished(events);
    assert.equal(turn.usage, undefined);
    assert.equal(turn.error?.code, "usage_missing");
    assert.equal(turn.metadata?.budgets?.inputTokens, undefined);
    assert.equal(turn.metadata?.budgets?.inputTokensSource, undefined);
    const terminal = events.at(-1);
    assert.equal(terminal?.type, "run.failed", "the terminal event carries the refusal");
    assert.equal(terminal?.type === "run.failed" ? terminal.error.code : undefined, "usage_missing");
    assert.ok(!events.some((event) => event.type === "run.failed" && event.limit), "no breach attribution for a refusal");

    assert.equal(historyOf(session).filter((message) => message.role === "assistant").length, 0, "no assistant reply is persisted");
    assert.equal(session.contextMeter().inputTokens, before, "the refused turn changes no meter reading");
    assert.equal(
      session.contextMeter().inputTokens,
      estimateMessageTokens(historyOf(session), MODEL.model).tokens,
      "the meter still estimates stored history, not the refused turn",
    );
  });

  it("a reporting provider under strict is unaffected", async () => {
    const { ledger, usage } = memoryLedger();
    const attempts = { count: 0 };
    const session = await createStrictSession(
      "strict",
      scriptedProvider([providerTextDelta("ok"), providerDone(REPORTED)], attempts),
      ledger,
    );

    const { events, result, error } = await runSession(session, "hello", { retry: alwaysRetry, limits: { maxTurns: 4 } });

    assert.equal(error, undefined);
    assert.equal(result?.status, "completed");
    assert.equal(result?.error, undefined);
    assert.equal(result?.usage?.inputTokens, REPORTED.inputTokens);
    assert.equal(turnFinished(events).metadata?.budgets?.inputTokensSource, "reported");
    assert.equal(usage.length, 2, "provider_turn row plus run_total aggregate");
    assert.ok(
      usage.every((row) => row.usage.estimated === undefined),
      "reported usage is never labeled an estimate",
    );
  });

  it('"off" and "fallback" keep their behavior', async () => {
    const off = memoryLedger();
    const offAttempts = { count: 0 };
    const offSession = await createStrictSession(
      "off",
      scriptedProvider([providerTextDelta("ok"), providerDone()], offAttempts),
      off.ledger,
    );
    const offRun = await runSession(offSession, "hello", { limits: { maxTurns: 4 } });
    assert.equal(offRun.error, undefined, '"off" still completes');
    assert.equal(offRun.result?.usage, undefined);
    assert.equal(off.usage.length, 0);
    assert.equal(turnFinished(offRun.events).usage, undefined);

    const fallback = memoryLedger();
    const fallbackAttempts = { count: 0 };
    const fallbackSession = await createStrictSession(
      "fallback",
      scriptedProvider([providerTextDelta("ok"), providerDone()], fallbackAttempts),
      fallback.ledger,
    );
    const fallbackRun = await runSession(fallbackSession, "hello", { limits: { maxTurns: 4 } });
    assert.equal(fallbackRun.error, undefined, '"fallback" still completes');
    const fallbackTurn = turnFinished(fallbackRun.events);
    assert.equal(fallbackTurn.usage?.estimated, true);
    assert.equal(fallbackTurn.metadata?.budgets?.inputTokensSource, "estimated");
    assert.equal(fallback.usage.length, 2);
  });

  it("the constructor still fails closed on an out-of-union value", async () => {
    const agent = await createAgent({
      id: "usage-bogus",
      slots: { store: createMemorySessionStore() },
      model: MODEL,
      packages: [providerPackage("test-provider", [scriptedProvider([providerDone()], { count: 0 })])],
      usageEstimation: "sometimes" as never,
    });
    await assert.rejects(
      async () => await agent.session({ id: "usage-bogus-session", create: true }),
      (thrown: unknown) => {
        assert.ok(thrown instanceof TypeError);
        assert.match(thrown.message, /usageEstimation must be "fallback", "off", or "strict"/);
        return true;
      },
    );
  });

  it("the refusal wins over the fail-closed maxCost breach", async () => {
    const { ledger, usage } = memoryLedger();
    const attempts = { count: 0 };
    const session = await createStrictSession("strict", scriptedProvider([providerTextDelta("ok"), providerDone()], attempts), ledger);

    const { events, result } = await runSession(session, "hello", { limits: { maxCost: { amount: 0.05, currency: "USD" }, maxTurns: 4 } });

    assert.equal(result?.error?.code, "usage_missing", "missing usage is refused, not attributed to a budget breach");
    assert.equal(result?.limit, undefined);
    assert.equal(result?.error?.failureClass, undefined);
    assert.ok(!events.some((event) => event.type === "run.failed" && event.limit));
    assert.equal(usage.length, 0);
  });

  it("does zero estimator work: a poisoned message array cannot break the refusal", async () => {
    const { ledger, usage } = memoryLedger();
    /** The seam iterates `request.messages` only when it projects an estimate; an iteration here is estimator work. */
    const poison = (request: ProviderRequest) => {
      Object.defineProperty(request.messages, Symbol.iterator, {
        value: () => {
          throw new Error("estimator iterated the request messages");
        },
      });
    };
    const attempts = { count: 0 };
    const session = await createStrictSession(
      "strict",
      scriptedProvider([providerTextDelta("ok"), providerDone()], attempts, poison),
      ledger,
    );

    const { result } = await runSession(session, "hello", { limits: { maxTurns: 4 } });

    assert.equal(result?.error?.code, "usage_missing", "the refusal is decided before any message flattening");
    assert.equal(usage.length, 0);

    // Positive control: the same poison does break the estimating path, so the assertion above is real.
    const control = memoryLedger();
    const controlSession = await createStrictSession(
      "fallback",
      scriptedProvider([providerTextDelta("ok"), providerDone()], { count: 0 }, poison),
      control.ledger,
    );
    const controlRun = await runSession(controlSession, "hello", { limits: { maxTurns: 4 } });
    assert.match(controlRun.result?.error?.message ?? "", /estimator iterated the request messages/);
  });

  it("a provider failure under strict still reports the provider error and stays retryable", async () => {
    const { ledger } = memoryLedger();
    const attempts = { count: 0 };
    const upstream = Object.assign(new Error("upstream down"), { code: 503 });
    const session = await createStrictSession("strict", scriptedProvider([providerError(upstream)], attempts), ledger);

    const { result } = await runSession(session, "hello", {
      retry: { policy: createDefaultRetryPolicy({ maxAttempts: 2, baseDelayMs: 0, jitter: 0 }) },
      limits: { maxTurns: 4 },
    });

    assert.equal(attempts.count, 2, "a failed turn with no usage is not refused, so the retry policy still runs");
    assert.equal(result?.error?.code, 503);
    assert.notEqual(result?.error?.code, "usage_missing", "the refusal never masks a provider error");
    assert.equal(result?.error?.failureClass, "transient");
  });
});
