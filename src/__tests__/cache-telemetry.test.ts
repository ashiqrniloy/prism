import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelConfig, Usage } from "../index.js";
import { CACHE_TELEMETRY_OVERFLOW_KEY, CacheTelemetryError, createCacheTelemetry } from "../index.js";

const model = (name: string, cost?: ModelConfig["cost"]): ModelConfig => ({
  provider: "mock",
  model: name,
  ...(cost ? { cost } : {}),
});

const usage = (u: Partial<Usage>): Usage => ({ inputTokens: 1000, ...u });

describe("cache telemetry", () => {
  it("aggregation correctness: mixed hit/miss usages produce exact per-provider/model rates and totals", () => {
    const t = createCacheTelemetry();
    // 60% cached reads for "fast": 600 of 1000 input tokens read from cache, twice
    t.record(usage({ cacheReadTokens: 600, cacheWriteTokens: 200 }), model("fast"));
    t.record(usage({ cacheReadTokens: 600, cacheWriteTokens: 200 }), model("fast"));
    // miss-heavy "cold": no reads at all
    t.record(usage({ cacheWriteTokens: 1000 }), model("cold"));
    // second provider keeps buckets disjoint
    t.record(usage({ cacheReadTokens: 250, inputTokens: 500 }), { ...model("fast"), provider: "other" });

    const report = t.report();
    assert.equal(report.totalRequests, 4);
    assert.equal(report.totalCacheReadTokens, 1450);
    assert.equal(report.totalCacheWriteTokens, 1400);
    assert.equal(report.overflowed, false);

    const fast = report.samples.find((s) => s.provider === "mock" && s.model === "fast");
    assert.equal(fast?.requests, 2);
    assert.equal(fast?.cacheReadTokens, 1200);
    assert.equal(fast?.cacheWriteTokens, 400);
    assert.equal(fast?.inputTokens, 2000);
    assert.equal(fast?.hitRate, 0.6, "aggregate hit rate = total reads / total input");

    const cold = report.samples.find((s) => s.provider === "mock" && s.model === "cold");
    assert.equal(cold?.requests, 1);
    assert.equal(cold?.cacheReadTokens, 0);
    assert.equal(cold?.hitRate, 0, "zero reads on a miss-only sample is a 0% hit rate, not undefined");

    const other = report.samples.find((s) => s.provider === "other" && s.model === "fast");
    assert.equal(other?.hitRate, 0.5);
    assert.equal(t.size, 3, "distinct provider/model keys");
  });

  it("read-only providers (write tokens absent) report hits correctly", () => {
    const t = createCacheTelemetry();
    t.record(usage({ cacheReadTokens: 900 }), model("read-only"));
    const sample = t.report().samples[0];
    assert.equal(sample.cacheReadTokens, 900);
    assert.equal(sample.cacheWriteTokens, 0);
    assert.equal(sample.hitRate, 0.9);
  });

  it("savings with and without ModelCost: present only when cost metadata exists", () => {
    const t = createCacheTelemetry();
    const priced: ModelConfig = model("priced", { input: 2.5, cacheRead: 0.25, currency: "USD" });
    const pricedPerMillion = model("priced-unit", {
      input: 2.5,
      cacheRead: 0.25,
      currency: "USD",
      unit: "per_million_tokens",
    });
    t.record(usage({ cacheReadTokens: 1_000_000 }), pricedPerMillion);
    t.record(usage({ cacheReadTokens: 500 }), priced);
    t.record(usage({ cacheReadTokens: 700 }), model("unpriced"));

    const byModel = new Map(t.report().samples.map((s) => [s.model, s]));
    assert.equal(byModel.get("priced-unit")?.estimatedSavings, 2.25, "savings = reads * (input - cacheRead) / unit divisor");
    assert.equal(byModel.get("priced-unit")?.currency, "USD");
    assert.equal(byModel.get("priced")?.estimatedSavings, 500 * (2.5 - 0.25), "default (per-token) unit divisor is 1");
    assert.equal(byModel.get("unpriced")?.estimatedSavings, undefined, "no cost metadata => no savings estimate");
    assert.equal(byModel.get("unpriced")?.currency, undefined);
  });

  it("aggregate hit rate equals cacheUsageReport math across a sample run", () => {
    const t = createCacheTelemetry();
    const m = model("math");
    const usages = [usage({ cacheReadTokens: 300 }), usage({ cacheReadTokens: 100, inputTokens: 200 }), usage({ inputTokens: 500 })];
    for (const u of usages) t.record(u, m);
    const sample = t.report().samples[0];
    // cacheUsageReport math: hitRate = total reads / total input across the run
    assert.equal(sample.hitRate, (300 + 100) / (1000 + 200 + 500));
    assert.equal(sample.cacheReadTokens, 400);
  });

  it("cardinality cap: over-cap distinct keys collapse into __overflow__ without growth or throw", () => {
    const t = createCacheTelemetry({ maxKeys: 3 });
    for (let i = 0; i < 10; i += 1) t.record(usage({ cacheReadTokens: 1 }), model(`m${i}`));
    assert.equal(t.size, 3, "size never exceeds the cap");
    const report = t.report();
    assert.equal(report.overflowed, true);
    const overflow = report.samples.find((s) => s.model === CACHE_TELEMETRY_OVERFLOW_KEY);
    assert.equal(overflow?.requests, 7, "keys beyond the cap accumulate in the single overflow bucket");
    assert.equal(report.samples.length, 4, "3 capped keys + 1 overflow bucket");
    // repeated overflow records keep working, no throw, no growth
    t.record(usage({ cacheReadTokens: 5 }), model("m99"));
    assert.equal(t.size, 3);
    assert.equal(t.report().samples.find((s) => s.model === CACHE_TELEMETRY_OVERFLOW_KEY)?.requests, 8);
  });

  it("invalid input: negative/NaN token counts rejected with a typed error; no partial mutation", () => {
    const t = createCacheTelemetry();
    for (const bad of [
      { cacheReadTokens: -1 },
      { cacheReadTokens: NaN },
      { cacheReadTokens: 1.5 },
      { cacheReadTokens: Number.MAX_SAFE_INTEGER + 1 },
      { cacheWriteTokens: -2 },
      { inputTokens: -3 },
    ]) {
      assert.throws(() => t.record(usage(bad), model("m")), CacheTelemetryError);
    }
    assert.equal(t.size, 0, "rejected records mutate nothing");
    assert.throws(() => createCacheTelemetry({ maxKeys: 0 }), CacheTelemetryError);
    assert.throws(() => createCacheTelemetry({ maxKeys: NaN }), CacheTelemetryError);
  });

  it("redaction construction: reports expose only token counters and rates, never keys or content", () => {
    const t = createCacheTelemetry();
    t.record(usage({ cacheReadTokens: 5, cost: 0.01, currency: "USD" }), {
      provider: "mock",
      model: "m",
      cache: { kind: "openai_key" },
      cost: { input: 2, cacheRead: 0.5 },
      metadata: { secret: "sk-very-secret" },
    });
    const json = JSON.stringify(t.report());
    assert.ok(!json.includes("sk-very-secret"), "no metadata content in reports");
    assert.ok(!json.includes("cache_control") && !json.includes("openai_key"), "no cache configuration/keys in reports");
    const sample = t.report().samples[0];
    assert.deepEqual(Object.keys(sample).sort(), [
      "cacheReadTokens",
      "cacheWriteTokens",
      "currency",
      "estimatedSavings",
      "hitRate",
      "inputTokens",
      "model",
      "provider",
      "requests",
    ]);
  });

  it("no telemetry is collected until the host subscribes the aggregator", () => {
    // import alone never collects: a fresh aggregator is empty, and records
    // flow only through explicit host wiring (the record() calls above).
    const t = createCacheTelemetry();
    assert.equal(t.size, 0);
    assert.equal(t.report().totalRequests, 0);
    assert.equal(t.report().overflowed, false);
    t.reset();
    assert.equal(t.size, 0);
  });

  it("provider-only aggregation when no model is supplied", () => {
    const t = createCacheTelemetry();
    t.record(usage({ cacheReadTokens: 100 }));
    t.record(usage({ cacheReadTokens: 50 }));
    const report = t.report();
    assert.equal(report.totalRequests, 2);
    assert.equal(report.samples[0].provider, "unknown");
    assert.equal(report.samples[0].model, "unknown");
    assert.equal(report.samples[0].cacheReadTokens, 150);
  });
});
