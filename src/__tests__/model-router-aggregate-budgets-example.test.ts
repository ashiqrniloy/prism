import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";

/** Plan 122 Task 4: the shipped example is the composition; this test runs it and asserts the
 *  aggregate-ceiling, renewal-fencing, unknown-liability, and model-pin guarantees end to end. */
interface AggregateBudgetPayload {
  readonly modelPin: { readonly provider: string; readonly model: string; readonly configuredFallbacks: number };
  readonly aggregate: {
    readonly ceilingTokens: number;
    readonly perRunReservationTokens: number;
    readonly usedTokens: number;
    readonly remainingTokens: number;
    readonly byModel: Record<string, { readonly tokens: number; readonly count: number }>;
    readonly byKind: Record<string, { readonly tokens: number; readonly count: number }>;
  };
  readonly runs: readonly {
    readonly step: number;
    readonly status: string;
    readonly model?: string;
    readonly deniedCode?: string | number;
  }[];
  readonly auxiliary: {
    readonly kind: string;
    readonly reservationTokens: number;
    readonly usageTokens: number;
    readonly fencingAdvanced: boolean;
    readonly staleCommitRejected: boolean;
    readonly modelsObserved: readonly string[];
  };
  readonly unknownUsage: {
    readonly status: string;
    readonly settlementUnknownUsage?: boolean;
    readonly budgetCommitted?: boolean;
    readonly chargedTokens: number;
    readonly reservationTokens: number;
  };
  readonly contextPressure: {
    readonly contextWindowTokens: number;
    readonly aggregateRemainingTokens: number;
    readonly note: string;
  };
  readonly boundary: string;
}

function runExample(): AggregateBudgetPayload {
  const result = spawnSync(process.execPath, ["examples/model-router-aggregate-budgets.ts"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `model-router-aggregate-budgets.ts exited ${result.status}\n${result.stderr}`);
  const lastLine = result.stdout.trim().split("\n").at(-1);
  assert.ok(lastLine);
  return JSON.parse(lastLine) as AggregateBudgetPayload;
}

test("aggregate ceiling spans three session runs and auxiliary work on one task id", () => {
  const payload = runExample();
  assert.equal(payload.aggregate.ceilingTokens, 30);
  assert.equal(payload.aggregate.usedTokens, 27);
  assert.equal(payload.aggregate.remainingTokens, 3);
  // Two successful runs plus the auxiliary compaction call share the pool; the third run is denied
  // by the reservation check instead of resetting its per-run cap.
  assert.deepEqual(payload.runs, [
    { step: 1, status: "succeeded", model: "fixed-pin", outcome: "early_close" },
    { step: 2, status: "succeeded", model: "fixed-pin", outcome: "early_close" },
    { step: 3, status: "failed", deniedCode: "ERR_PRISM_MODEL_ROUTER_BUDGET" },
  ]);
  assert.equal(payload.auxiliary.kind, "compaction");
  assert.equal(payload.aggregate.byKind.generation?.tokens, 24);
  assert.equal(payload.aggregate.byKind.compaction?.tokens, 3);
  assert.equal(Object.keys(payload.aggregate.byModel).length, 1);
  assert.equal(payload.aggregate.byModel["mock:fixed-pin"]?.tokens, 27);
});

test("renewal fencing keeps the aggregate hold single-committed", () => {
  const payload = runExample();
  assert.equal(payload.auxiliary.fencingAdvanced, true);
  assert.equal(payload.auxiliary.staleCommitRejected, true);
  assert.equal(payload.auxiliary.reservationTokens, 5);
  assert.equal(payload.auxiliary.usageTokens, 3);
});

test("unknown usage settles as reserved liability, not zero", () => {
  const payload = runExample();
  assert.equal(payload.unknownUsage.status, "succeeded");
  assert.equal(payload.unknownUsage.settlementUnknownUsage, true);
  assert.equal(payload.unknownUsage.budgetCommitted, true);
  assert.equal(payload.unknownUsage.chargedTokens, payload.unknownUsage.reservationTokens);
  assert.equal(payload.unknownUsage.chargedTokens, 15);
});

test("model pin unchanged and remaining aggregate is not context-window pressure", () => {
  const payload = runExample();
  assert.deepEqual(payload.modelPin, { provider: "mock", model: "fixed-pin", configuredFallbacks: 0 });
  for (const model of payload.auxiliary.modelsObserved) assert.equal(model, "fixed-pin");
  assert.equal(payload.contextPressure.contextWindowTokens, 200_000);
  assert.equal(payload.contextPressure.aggregateRemainingTokens, 3);
  assert.notEqual(payload.contextPressure.contextWindowTokens, payload.contextPressure.aggregateRemainingTokens);
  assert.match(payload.contextPressure.note, /router\.readBudget/);
  assert.match(payload.boundary, /durable ModelRouterStateStore/);
});
