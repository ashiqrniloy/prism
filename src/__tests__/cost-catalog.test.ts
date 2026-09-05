/** Plan 062: CostCatalog pricing adapter — with catalog → cost present; without/stale/failing → usage-only. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUsageAccumulator } from "../agent-session/helpers.js";
import { recordProviderUsage } from "../agent-session/session/provider-round.js";
import type { RoundContext, SessionHost } from "../agent-session/session/types.js";
import type { CostCatalog, ModelCost, Usage, UsageRecord } from "../contracts.js";
import { createRunLimitTracker } from "../run-limits.js";

const MODEL = { provider: "demo", model: "demo-large" };
const USAGE: Usage = { inputTokens: 500_000, outputTokens: 100_000, totalTokens: 600_000 };

const QUOTE: ModelCost = { input: 3, output: 12, cacheRead: 0.3, currency: "USD", unit: "per_million_tokens" };

type Recorded = UsageRecord[];
const ledgerOf = (records: Recorded) => ({ appendUsage: (record: UsageRecord) => records.push(record) });

function ctxFixture(catalog?: CostCatalog) {
  const records: Recorded = [];
  const session = {
    id: "session-1",
    agent: { config: { costCatalog: catalog } },
    activeLedger: ledgerOf(records),
    activeOwnership: { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" },
  } as unknown as SessionHost;
  const runUsage = createUsageAccumulator();
  const ctx = {
    session,
    model: MODEL,
    runId: "run-1",
    controller: new AbortController(),
    limits: createRunLimitTracker({ maxInputTokens: 1_000_000, maxOutputTokens: 250_000, maxTotalTokens: 1_000_000 }),
    runUsage,
  } as RoundContext;
  return { ctx, records, runUsage };
}

describe("cost catalog adapter", () => {
  it("with catalog: turn usage is priced and flows to the ledger and run totals", async () => {
    const requested: string[] = [];
    const catalog: CostCatalog = {
      get: async (modelId) => {
        requested.push(modelId);
        return QUOTE;
      },
    };
    const { ctx, records, runUsage } = ctxFixture(catalog);
    await recordProviderUsage(ctx, USAGE, 1, 0);
    assert.deepEqual(requested, ["demo-large"]);
    assert.equal(records.length, 1);
    assert.equal(records[0].usage.cost, 3 * 0.5 + 12 * 0.1); // input + output, cache unused
    assert.equal(records[0].usage.currency, "USD");
    assert.equal(runUsage.value()?.cost, records[0].usage.cost); // run_total aggregates cost
    assert.equal(runUsage.value()?.currency, "USD");
  });

  it("without catalog: usage only, no lookup, no cost fields", async () => {
    const { ctx, records, runUsage } = ctxFixture(undefined);
    await recordProviderUsage(ctx, USAGE, 1, 0);
    assert.equal(records[0].usage.cost, undefined);
    assert.equal(records[0].usage.currency, undefined);
    assert.equal(runUsage.value()?.cost, undefined);
    assert.equal(runUsage.value()?.inputTokens, 500_000);
  });

  it("stale catalog (expired quote resolves undefined) degrades to usage-only", async () => {
    const catalog: CostCatalog = { get: async () => undefined };
    const { ctx, records } = ctxFixture(catalog);
    await recordProviderUsage(ctx, USAGE, 1, 0);
    assert.equal(records[0].usage.cost, undefined);
  });

  it("catalog failure degrades to usage-only instead of failing the round", async () => {
    const catalog: CostCatalog = {
      get: async () => {
        throw new Error("catalog down");
      },
    };
    const { ctx, records } = ctxFixture(catalog);
    await recordProviderUsage(ctx, USAGE, 1, 0);
    assert.equal(records[0].usage.cost, undefined);
    assert.equal(records[0].usage.inputTokens, 500_000);
  });

  it("non-per-million unit quotes are ignored (money path stays conservative)", async () => {
    const catalog: CostCatalog = { get: async () => ({ ...QUOTE, unit: "per_token" }) };
    const { ctx, records } = ctxFixture(catalog);
    await recordProviderUsage(ctx, USAGE, 1, 0);
    assert.equal(records[0].usage.cost, undefined);
  });

  it("provider-reported cost wins: catalog is not consulted", async () => {
    let lookedUp = false;
    const catalog: CostCatalog = {
      get: async () => {
        lookedUp = true;
        return QUOTE;
      },
    };
    const { ctx, records } = ctxFixture(catalog);
    await recordProviderUsage(ctx, { ...USAGE, cost: 0.25, currency: "EUR" }, 1, 0);
    assert.equal(lookedUp, false);
    assert.equal(records[0].usage.cost, 0.25);
    assert.equal(records[0].usage.currency, "EUR");
  });
});
