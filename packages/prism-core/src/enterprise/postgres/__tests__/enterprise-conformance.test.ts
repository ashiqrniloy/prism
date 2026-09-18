import { describe, it } from "node:test";
import { createMemoryEvaluationStore } from "../../../governance/evals/index.js";
import { createMemoryModelRouterStateStore } from "../../../governance/model-router/index.js";
import { createMemoryPolicyDecisionStore } from "../../../governance/policy/index.js";
import { createMemoryIdempotencyStore } from "@arnilo/prism-work/connectors";
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
