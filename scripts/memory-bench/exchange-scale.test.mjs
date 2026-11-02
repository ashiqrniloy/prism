import { test } from "bun:test";
import assert from "node:assert/strict";
import { measureExchangeStore } from "./exchange-scale.mjs";

test("exchange_scale_smoke_reports_store_metrics", async () => {
  const result = await measureExchangeStore("sqlite", { exchanges: 200, queries: 20 });
  assert.equal(result.store, "sqlite");
  assert.equal(result.exchanges, 200);
  assert.ok(result.writeMs > 0);
  assert.ok(result.queryP50Ms >= 0);
  assert.ok(result.queryP95Ms >= result.queryP50Ms);
  assert.ok(Number.isFinite(result.queryP95Ms));
});
