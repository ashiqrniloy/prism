import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { isFreeBenchmarkModel } from "./run.mjs";
import {
  assertComparableServedDeployments,
  assertFreeOnlyCost,
  assertPinnedSubset,
  assertScoredSingleModel,
  CALL_ID_INLINE_LIMIT,
  recordServedDeployments,
  SMOKE_GROUP,
  servedDeploymentsFromRows,
  servedModelGuard,
} from "./served-model.mjs";

const row = (over = {}) => ({ modelId: "deploy-a", callId: "call-1", inputTokens: 10, outputTokens: 5, ...over });

describe("served-model", () => {
  it("report_records_served_deployments", () => {
    const rows = [row(), row({ callId: "call-2" }), row({ modelId: "deploy-b", callId: "call-3" })];
    const served = servedDeploymentsFromRows(rows);
    assert.deepEqual(served.deployments, { "deploy-a": 2, "deploy-b": 1 });
    assert.deepEqual(served.callIds, ["call-1", "call-2", "call-3"]);
    const report = {};
    recordServedDeployments(report, served);
    assert.deepEqual(report.servedDeployments, { "deploy-a": 2, "deploy-b": 1 });
    assert.deepEqual(report.servedCallIds, ["call-1", "call-2", "call-3"]);
  });

  it("report_records_served_deployments_uses_a_sidecar_over_the_threshold", () => {
    const rows = Array.from({ length: CALL_ID_INLINE_LIMIT + 1 }, (_, n) => row({ callId: `call-${n}` }));
    const report = {};
    recordServedDeployments(report, servedDeploymentsFromRows(rows), { sidecarPath: "/tmp/arm.callids.jsonl" });
    assert.deepEqual(report.servedCallIds, { count: CALL_ID_INLINE_LIMIT + 1, path: "/tmp/arm.callids.jsonl" });
  });

  it("served_model_guard_refuses_paid_call_under_free_only", () => {
    assert.throws(() => assertFreeOnlyCost({ servedModelCost: 0.0001 }, { freeOnly: true }), /MemoryBenchServedModel/);
    // A stream carries its total cost in the usage chunk, not a header.
    const streamed = {
      servedModelCost: servedDeploymentsFromRows([row({ responseCost: undefined, rawUsage: { cost: 0.0002 } })]).responseCost,
    };
    assert.throws(() => assertFreeOnlyCost(streamed, { freeOnly: true }), /MemoryBenchServedModel/);
    assert.doesNotThrow(() => assertFreeOnlyCost({ servedModelCost: 0 }, { freeOnly: true }));
    // Without --free-only a priced arm is simply priced.
    assert.doesNotThrow(() => assertFreeOnlyCost({ servedModelCost: 1 }, { freeOnly: false }));
  });

  it("served_model_guard_refuses_mismatched_pairs", () => {
    const candidate = { servedDeployments: { a: 10 } };
    const control = { servedDeployments: { a: 5, b: 5 } };
    assert.throws(() => assertComparableServedDeployments(candidate, control), /different deployments/);
    assert.doesNotThrow(() => assertComparableServedDeployments({ servedDeployments: { a: 3 } }, { servedDeployments: { a: 4 } }));
    // A report with no gateway labels cannot be compared, and is not silently accepted as equal.
    assert.doesNotThrow(() => assertComparableServedDeployments({}, {}));
  });

  it("served_model_guard_refuses_scored_smoke", () => {
    assert.throws(() => assertScoredSingleModel({ group: SMOKE_GROUP, phase: "all" }), /mixes model families/);
    assert.doesNotThrow(() => assertScoredSingleModel({ group: SMOKE_GROUP, phase: "write" }));
    assert.throws(
      () => assertScoredSingleModel({ group: "prism-free/mixed", phase: "all", catalogModel: { compat: { deployments: 2 } } }),
      /deployments/,
    );
  });

  it("served_model_guard_refuses_pool_on_heldout", () => {
    assert.throws(() => assertPinnedSubset({ group: "g", subset: "heldout-a", deployments: 2 }), /refuses a pooled group/);
    assert.doesNotThrow(() => assertPinnedSubset({ group: "g", subset: "heldout-a", deployments: 1 }));
    assert.doesNotThrow(() => assertPinnedSubset({ group: "g", subset: "dev", deployments: 3 }));
  });

  it("is_free_benchmark_model_litellm", () => {
    const free = { provider: "litellm", model: "prism-free/gpt-oss-20b@groq", cost: { input: 0, output: 0 } };
    assert.equal(isFreeBenchmarkModel(free), true);
    assert.equal(isFreeBenchmarkModel({ ...free, model: "gpt-oss-20b" }), false);
    assert.equal(isFreeBenchmarkModel({ ...free, cost: { input: 0, output: 0.5 } }), false);
    // Unknown cost is not zero cost.
    assert.equal(isFreeBenchmarkModel({ provider: "litellm", model: "prism-free/x" }), false);
  });

  it("served_model_guard_is_the_single_arm_entry_point", () => {
    assert.throws(
      () => servedModelGuard({ model: SMOKE_GROUP, phase: "all", subset: "dev" }, { group: SMOKE_GROUP, phase: "all", subset: "dev" }),
      /MemoryBenchServedModel/,
    );
    assert.doesNotThrow(() =>
      servedModelGuard(
        { model: "prism-free/pinned", phase: "all", subset: "dev", servedModelCost: 0, servedDeployments: { a: 2 } },
        { group: "prism-free/pinned", phase: "all", subset: "dev", deployments: 1, freeOnly: true },
      ),
    );
  });
});
