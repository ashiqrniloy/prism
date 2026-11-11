import assert from "node:assert/strict";
import { it } from "bun:test";
import type { ModelProvider, ProviderRequest } from "../contracts.js";
import { executeProviderLiveScenarios } from "../testing/provider-live-scenarios.js";

it("paid_cache_selection_runs_only_cache_and_reuses_affinity_and_stable_boundary", async () => {
  const requests: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id: "test",
    async *generate(request) {
      requests.push(request);
      yield { type: "usage", usage: { inputTokens: 9000, outputTokens: 1, cacheReadTokens: 8000 } };
      yield { type: "done", stopReason: "end_turn" };
    },
  };
  const model = { provider: "test", model: "demo", cache: { kind: "cache_control" as const } };
  const result = await executeProviderLiveScenarios({ provider, scenarios: ["cache"], routes: { openai: model } });
  assert.deepEqual(
    result.scenarios.map((entry) => entry.scenario),
    ["cache"],
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.options?.sessionId, requests[1]?.options?.sessionId);
  assert.deepEqual(requests[0]?.options?.cache?.breakpoints, [{ location: "stable_context" }]);
  assert.deepEqual(requests[0]?.messages[0], requests[1]?.messages[0]);
});
