import assert from "node:assert/strict";
import type { WorkflowCheckpointAdapter } from "../index.js";
import {
  WorkflowCheckpointError,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
  type WorkflowCheckpointValue,
} from "../index.js";

export function sampleValue(overrides: Partial<WorkflowCheckpointValue> = {}): WorkflowCheckpointValue {
  const now = new Date().toISOString();
  return {
    schemaVersion: WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
    workflowId: "wf",
    runId: "run1",
    definitionHash: "abc",
    status: "running",
    readyNodeIds: [],
    completedNodeIds: [],
    nodes: {
      a: { nodeId: "a", status: "succeeded", output: { ok: true } },
    },
    createdAt: now,
    updatedAt: now,
    redacted: false,
    ...overrides,
  };
}

export async function runCheckpointAdapterConformance(
  label: string,
  create: () => WorkflowCheckpointAdapter | Promise<WorkflowCheckpointAdapter>,
): Promise<void> {
  const checkpoints = await create();

  await checkpoints.save({
    workflowId: "wf",
    runId: "run1",
    version: 1,
    ownership: { tenantId: "t1" },
    value: sampleValue(),
  });
  const loaded = await checkpoints.load({
    workflowId: "wf",
    runId: "run1",
    ownership: { tenantId: "t1" },
  });
  assert.equal(loaded?.version, 1, `${label}: version`);
  assert.equal(loaded?.value.status, "running", `${label}: status`);
  assert.deepEqual(loaded?.value.nodes.a?.output, { ok: true }, `${label}: output`);

  await assert.rejects(
    () => checkpoints.save({
      workflowId: "wf",
      runId: "run1",
      version: 1,
      ownership: { tenantId: "t1" },
      value: sampleValue(),
    }),
    WorkflowCheckpointError,
    `${label}: stale version`,
  );

  await assert.rejects(
    () => checkpoints.load({
      workflowId: "wf",
      runId: "run1",
      ownership: { tenantId: "other" },
    }),
    /ownership|tenant/i,
    `${label}: tenant mismatch`,
  );

  if (checkpoints.list) {
    const page = await checkpoints.list({
      workflowId: "wf",
      ownership: { tenantId: "t1" },
      limit: 10,
    });
    assert.equal(page.items.length, 1, `${label}: list size`);
    const empty = await checkpoints.list({
      workflowId: "wf",
      ownership: { tenantId: "missing" },
      limit: 10,
    });
    assert.equal(empty.items.length, 0, `${label}: tenant list isolation`);
  }

  if (checkpoints.delete) {
    const deleted = await checkpoints.delete({
      workflowId: "wf",
      runId: "run1",
      ownership: { tenantId: "t1" },
    });
    assert.equal(deleted, true, `${label}: delete`);
    const after = await checkpoints.load({
      workflowId: "wf",
      runId: "run1",
      ownership: { tenantId: "t1" },
    });
    assert.equal(after, null, `${label}: load after delete`);
  }
}
