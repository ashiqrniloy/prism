import { describe, it } from "node:test";
import { createMemoryEvaluationStore } from "@arnilo/prism-evals";
import { createMemoryModelRouterStateStore } from "@arnilo/prism-model-router";
import { createMemoryPolicyDecisionStore } from "@arnilo/prism-policy";
import { createMemoryIdempotencyStore } from "@arnilo/prism-work-tools";
import { runEnterpriseStoreConformance } from "./enterprise-conformance.js";

describe("enterprise domain conformance", () => {
  it("passes against development memory stores without PostgreSQL", async () => {
    await runEnterpriseStoreConformance(
      {
        policy: createMemoryPolicyDecisionStore(),
        evaluations: createMemoryEvaluationStore(),
        workIdempotency: createMemoryIdempotencyStore(),
        modelRouter: createMemoryModelRouterStateStore(),
      },
      "memory",
    );
  });
});
