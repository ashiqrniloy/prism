import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createUsageAccumulator } from "../agent-session/helpers.js";
import { recordProviderUsage } from "../agent-session/session/provider-round.js";
import type { RoundContext, SessionHost } from "../agent-session/session/types.js";
import type { CostCatalog, ModelCost, Usage, UsageRecord } from "../contracts.js";
import { createRunLimitTracker } from "../run-limits.js";

const MODEL = { provider: "demo", model: "demo-cached" };

const QUOTE: ModelCost = {
  input: 3, // $3 / 1M tokens ($0.000003/token)
  output: 15, // $15 / 1M tokens ($0.000015/token)
  cacheRead: 0.3, // $0.30 / 1M tokens ($0.0000003/token)
  cacheWrite: 3.75, // $3.75 / 1M tokens ($0.00000375/token)
  currency: "USD",
  unit: "per_million_tokens",
};

type Recorded = UsageRecord[];
const ledgerOf = (records: Recorded) => ({ appendUsage: (record: UsageRecord) => records.push(record) });

function ctxFixture(catalog?: CostCatalog) {
  const records: Recorded = [];
  const session = {
    id: "session-cost-1",
    agent: { config: { costCatalog: catalog } },
    activeLedger: ledgerOf(records),
    activeOwnership: { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" },
  } as unknown as SessionHost;
  const runUsage = createUsageAccumulator();
  const ctx = {
    session,
    model: MODEL,
    runId: "run-cost-1",
    controller: new AbortController(),
    limits: createRunLimitTracker({ maxInputTokens: 2_000_000, maxOutputTokens: 250_000, maxTotalTokens: 2_000_000 }),
    runUsage,
  } as RoundContext;
  return { ctx, records, runUsage };
}

describe("catalog cost pricing (plan 182 Task 4)", () => {
  it("catalog_cost_does_not_double_charge_cached_tokens", async () => {
    const catalog: CostCatalog = {
      get: async () => QUOTE,
    };
    const { ctx, records } = ctxFixture(catalog);

    // Turn usage with 1M total input tokens:
    // 800k cache read, 100k cache write, 100k uncached input, and 50k output.
    const usage: Usage = {
      inputTokens: 1_000_000,
      cacheReadTokens: 800_000,
      cacheWriteTokens: 100_000,
      outputTokens: 50_000,
      totalTokens: 1_050_000,
    };

    await recordProviderUsage(ctx, usage, 1, 0);

    assert.equal(records.length, 1);
    const recorded = records[0].usage;

    // Correct formula:
    // uncachedInput = 1_000_000 - 800_000 - 100_000 = 100_000.
    // cost = (100_000 * 3 + 800_000 * 0.3 + 100_000 * 3.75 + 50_000 * 15) / 1_000_000
    //      = (300_000 + 240_000 + 375_000 + 750_000) / 1_000_000
    //      = 1_665_000 / 1_000_000 = 1.665.
    //
    // Under the old formula (double-charging cached tokens at full input rate):
    // cost = (1_000_000 * 3 + 800_000 * 0.3 + 100_000 * 3.75 + 50_000 * 15) / 1_000_000
    //      = (3_000_000 + 240_000 + 375_000 + 750_000) / 1_000_000
    //      = 4.365.
    const expectedCost = (100_000 * 3 + 800_000 * 0.3 + 100_000 * 3.75 + 50_000 * 15) / 1_000_000;

    assert.equal(recorded.cost, expectedCost);
    assert.equal(recorded.cost, 1.665);
    assert.equal(recorded.currency, "USD");
  });
});
