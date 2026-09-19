/** Plan 091 T2: usage fallback at the `recordUsage` seam and the session context meter. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUsageAccumulator } from "../agent-session/helpers.js";
import { recordProviderUsage } from "../agent-session/session/provider-round.js";
import type { RoundContext, SessionHost } from "../agent-session/session/types.js";
import type { AgentEvent, AgentSession, ContextMeter, ModelConfig, ProviderRequest, RunLedger, UsageRecord } from "../index.js";
import {
  createAgent,
  createMemorySessionStore,
  estimateMessageTokens,
  providerDone,
  providerTextDelta,
  resolveInputCap,
} from "../index.js";
import { createRunLimitTracker } from "../run-limits.js";

const MODEL: ModelConfig = { provider: "mock", model: "claude-sonnet-4.5", limits: { contextWindow: 100_000 } };
const CAP = resolveInputCap({}, MODEL);
const MESSAGES = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello there, estimate me" }] }];

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

/** Provider that never reports usage — the models this fallback exists for. */
const silentProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

/** Subscribe first, collect events, and snapshot `contextMeter()` while the run is still active. */
async function runWithMeters(session: AgentSession, input: string, options: Parameters<AgentSession["run"]>[1] = {}) {
  const events: AgentEvent[] = [];
  const meters = new Map<number, ContextMeter>();
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) {
      events.push(event);
      if (event.type === "provider_turn_finished") meters.set(event.turn, session.contextMeter());
    }
  })();
  const outcome = await session.run(input, options).then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await pump;
  return { events, meters, ...outcome };
}

function finished(events: readonly AgentEvent[]) {
  const event = events.find((candidate) => candidate.type === "provider_turn_finished");
  assert.ok(event?.type === "provider_turn_finished", "a provider turn must finish");
  return event;
}

describe("usage fallback and context meter (plan 091 T2)", () => {
  it("a non-reporting provider gets a labeled estimate in the event, ledger, run totals, and meter", async () => {
    const { ledger, usage: rows } = memoryLedger();
    const agent = createAgent({
      id: "usage-fallback",
      store: createMemorySessionStore(),
      model: MODEL,
      provider: silentProvider,
      runLedger: ledger,
    });
    const session = agent.createSession({ id: "usage-fallback-session" });
    const { events, meters, result, error } = await runWithMeters(session, "hi", { limits: { maxInputTokens: 5_000, maxTurns: 4 } });
    assert.equal(error, undefined, String(error));

    const turn = finished(events);
    assert.equal(turn.usage?.estimated, true, "a missing provider report must be labeled as an estimate");
    assert.equal(turn.usage?.confidence, "medium", "calibrated family tables are medium confidence");
    assert.ok((turn.usage?.inputTokens ?? 0) > 0);
    assert.equal(turn.metadata.budgets?.inputTokens, turn.usage?.inputTokens, "the estimate feeds the turn budget snapshot");
    assert.equal(turn.metadata.budgets?.runInputUsed, turn.usage?.inputTokens, "the estimate charges the run input budget");

    assert.equal(rows.length, 2, "provider-turn and run-total usage rows");
    const turnRow = rows.find((row) => row.scope === "provider_turn");
    const totalRow = rows.find((row) => row.scope === "run_total");
    assert.equal(turnRow?.usage.estimated, true);
    assert.equal(turnRow?.usage.confidence, "medium");
    assert.equal(turnRow?.usage.inputTokens, turn.usage?.inputTokens);
    assert.equal(totalRow?.usage.estimated, true, "the run total keeps estimate provenance");
    assert.equal(totalRow?.usage.inputTokens, turn.usage?.inputTokens);

    assert.equal(result?.usage?.estimated, true, "run totals keep estimate provenance");
    assert.equal(result?.usage?.inputTokens, turn.usage?.inputTokens);

    const during = meters.get(1);
    assert.equal(during?.source, "estimated");
    assert.equal(during?.inputTokens, turn.usage?.inputTokens);
    assert.equal(during?.inputCap, CAP, "cap resolution matches plan 086/087");
    assert.equal(during?.runInputBudget, 5_000);
    assert.equal(during?.usedRatio, (turn.usage?.inputTokens ?? 0) / CAP);

    const after = session.contextMeter();
    assert.equal(after.source, "estimated", "the last turn's estimate still labels the meter");
    assert.equal(after.inputTokens, turn.usage?.inputTokens);
    assert.equal(after.inputCap, CAP);
    assert.equal(after.runInputBudget, undefined, "the run budget ends with the run");
  });

  it("a reporting provider is untouched: no estimate flag, meter source reported", async () => {
    const provider = {
      id: "mock",
      async *generate() {
        yield { type: "usage" as const, usage: { inputTokens: 500, outputTokens: 7, totalTokens: 507 } };
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const agent = createAgent({ id: "usage-reported", store: createMemorySessionStore(), model: MODEL, provider });
    const session = agent.createSession({ id: "usage-reported-session" });
    const { events, meters, result, error } = await runWithMeters(session, "hi");
    assert.equal(error, undefined, String(error));

    const turn = finished(events);
    assert.deepEqual(turn.usage, { inputTokens: 500, outputTokens: 7, totalTokens: 507 }, "reported usage is never overwritten");
    assert.equal(meters.get(1)?.source, "reported");
    assert.equal(meters.get(1)?.inputTokens, 500);
    assert.equal(result?.usage?.estimated, undefined);
    assert.deepEqual(result?.usage, { inputTokens: 500, outputTokens: 7, totalTokens: 507 });
  });

  it('usageEstimation: "off" leaves absent usage absent and records nothing', async () => {
    const { ledger, usage: rows } = memoryLedger();
    const agent = createAgent({
      id: "usage-off",
      store: createMemorySessionStore(),
      model: MODEL,
      provider: silentProvider,
      usageEstimation: "off",
      runLedger: ledger,
    });
    const session = agent.createSession({ id: "usage-off-session" });
    const { events, result, error } = await runWithMeters(session, "hi");
    assert.equal(error, undefined, String(error));

    const turn = finished(events);
    assert.equal(turn.usage, undefined, "off means absent, never zero");
    assert.equal(turn.metadata.budgets?.inputTokens, undefined);
    assert.equal(turn.metadata.budgets?.runInputUsed, 0);
    assert.equal(rows.length, 0, "nothing estimated into the ledger");
    assert.equal(result?.usage, undefined);

    const meter = session.contextMeter();
    assert.equal(meter.source, "estimated");
    assert.ok(meter.inputTokens > 0, "the meter still estimates stored history when the fallback is off");
  });

  it("estimated usage is never priced through the cost catalog", async () => {
    let quotes = 0;
    const { ledger, usage: rows } = memoryLedger();
    const agent = createAgent({
      id: "usage-estimate-cost",
      store: createMemorySessionStore(),
      model: MODEL,
      provider: silentProvider,
      runLedger: ledger,
      costCatalog: {
        get: async () => {
          quotes += 1;
          return { input: 3, output: 12, currency: "USD", unit: "per_million_tokens" };
        },
      },
    });
    const session = agent.createSession({ id: "usage-estimate-cost-session" });
    const { result, error } = await runWithMeters(session, "hi");
    assert.equal(error, undefined, String(error));
    assert.equal(quotes, 0, "a catalog quote on estimated tokens would invent billing");
    assert.equal(rows[0]?.usage.cost, undefined);
    assert.equal(rows[0]?.usage.currency, undefined);
    assert.equal(result?.usage?.cost, undefined);
  });

  it("an unknown model family falls back to low confidence and still measures", async () => {
    const unknown: ModelConfig = { provider: "mock", model: "demo-local-7b" };
    const agent = createAgent({ id: "usage-unknown", store: createMemorySessionStore(), model: unknown, provider: silentProvider });
    const session = agent.createSession({ id: "usage-unknown-session" });
    const { events, error } = await runWithMeters(session, "hi");
    assert.equal(error, undefined, String(error));
    const turn = finished(events);
    assert.equal(turn.usage?.estimated, true);
    assert.equal(turn.usage?.confidence, "low");
    assert.equal(session.contextMeter().source, "estimated");
  });

  it("the estimate covers tool declarations and charges the run input budget", async () => {
    const ctx = {
      session: { id: "unit", agent: { config: { usageEstimation: "fallback" } } } as unknown as SessionHost,
      model: MODEL,
      runId: "run-unit",
      controller: new AbortController(),
      limits: createRunLimitTracker({ maxInputTokens: 1_000_000 }),
      runUsage: createUsageAccumulator(),
    } as RoundContext;
    const bare: ProviderRequest = { model: MODEL, messages: MESSAGES };
    const tooled: ProviderRequest = {
      model: MODEL,
      messages: MESSAGES,
      tools: [
        { name: "big", description: "x".repeat(4_000), parameters: {}, execute: () => ({ toolCallId: "c1", name: "big", value: "ok" }) },
      ],
    };
    const base = await recordProviderUsage(ctx, undefined, 1, 1, bare);
    const withTools = await recordProviderUsage(ctx, undefined, 1, 1, tooled);
    assert.ok(base !== undefined && withTools !== undefined, "missing usage with estimation on must yield an estimate");
    assert.equal(base.estimated, true);
    assert.equal(base.inputTokens, estimateMessageTokens(MESSAGES, MODEL.model).tokens, "no tools: the estimate is the message estimate");
    assert.ok((withTools.inputTokens ?? 0) > (base.inputTokens ?? 0), "tool schemas are part of the turn's real input");
    assert.equal(
      ctx.limits.snapshot().inputTokens,
      (base.inputTokens ?? 0) + (withTools.inputTokens ?? 0),
      "estimates charge the plan 086 run input axis",
    );
    assert.equal(ctx.runUsage.value()?.estimated, true);
  });
});
