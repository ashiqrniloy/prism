import { describe, it } from "bun:test";
import { type AgentConfig, createAgent, createMemorySessionStore } from "@arnilo/prism";
import { assertGateIntegrity } from "@arnilo/prism/testing/tool-conformance";
import { defineWorkflow, loopAgentNode, workflowLoop } from "../index.js";

/**
 * Plan 177 Task 6: the workflows loop is the repo's only custom loop, so it runs the published
 * gate-integrity check against the real strategy rather than a stand-in.
 */

function singleStepWorkflow() {
  return defineWorkflow({ id: "gate-integrity", revision: "1", nodes: { step: loopAgentNode() } });
}

describe("gate integrity (plan 177 Task 6)", () => {
  it("gate_integrity_workflow_loop", async () => {
    await assertGateIntegrity({
      createAgent: (config: AgentConfig) =>
        createAgent({
          ...config,
          packages: [...(config.packages ?? []), workflowLoop(singleStepWorkflow())],
          slots: { store: createMemorySessionStore(), ...config.slots },
        }),
    });
  });
});
