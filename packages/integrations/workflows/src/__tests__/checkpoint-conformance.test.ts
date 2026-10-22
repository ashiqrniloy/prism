import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, createMemorySessionStore, definePackage, type PackageAPI, providerDone, providerTextDelta } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider } from "@arnilo/prism/testing";
import workflows, {
  CHECKPOINT_CONFLICT_CODE,
  CHECKPOINTS_SERVICE,
  type CheckpointStore,
  createMemoryCheckpointStore,
  createWorkflowRuntime,
  defineWorkflow,
  functionNode,
  runWorkflow,
} from "../index.js";
import { checkpointConformance } from "../testing.js";

describe("@arnilo/prism-workflows checkpoints contract", () => {
  it("memory_checkpoints_pass_conformance", async () => {
    await checkpointConformance(() => createMemoryCheckpointStore());
  });

  it("checkpoint_cross_tenant_write_rejected", async () => {
    const store = createMemoryCheckpointStore();
    await store.saveCheckpoint({ namespace: "t", key: "k", tenantId: "tenant-a", version: 1, value: { owned: true } });
    await assert.rejects(
      () => store.saveCheckpoint({ namespace: "t", key: "k", tenantId: "tenant-b", version: 2, value: { evil: true } }),
      (error: { code?: string }) => error.code === CHECKPOINT_CONFLICT_CODE,
    );
    assert.deepEqual((await store.loadCheckpoint({ namespace: "t", key: "k", tenantId: "tenant-a" }))?.value, { owned: true });
  });

  it("engine_uses_checkpoints_service", async () => {
    let captured: PackageAPI | undefined;
    const base = createMemoryCheckpointStore();
    const saves: string[] = [];
    const spy: CheckpointStore = {
      saveCheckpoint: (input) => {
        saves.push(`${input.namespace}/${input.key}`);
        return base.saveCheckpoint(input);
      },
      loadCheckpoint: (input) => base.loadCheckpoint(input),
      listCheckpoints: (query) => base.listCheckpoints(query),
      deleteCheckpoint: (input) => base.deleteCheckpoint(input),
    };
    const spyPackage = definePackage({
      name: "@prism-test/checkpoints-spy",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        captured = prism;
        prism.services.provide(CHECKPOINTS_SERVICE, spy);
      },
    });
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("ok"), providerDone()])]), workflows, spyPackage],
    });
    try {
      assert.ok(captured, "the spy package setup must run");
      const runtime = createWorkflowRuntime(captured);
      const result = await runWorkflow(
        defineWorkflow({ revision: "1", id: "svc-wf", nodes: { n: functionNode({ execute: () => "ok" }) } }),
        null,
        { checkpoints: runtime.checkpoints, runId: "svc-run" },
      );
      assert.equal(result.status, "succeeded");
      assert.ok(
        saves.some((key) => key.startsWith("prism.workflow/")),
        `the workflow must write through the provided checkpoints service; saw ${saves.join(", ") || "nothing"}`,
      );
    } finally {
      await agent.dispose();
    }
  });
});
