import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_FAN_OUT } from "@arnilo/prism-extensions/workflows";
import { type HostConfig, REMOTE_ENDPOINT } from "../host/index.js";
import { gateThrowFails, orchestratedWorkflow } from "../scenarios/orchestrated-workflow.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

function config(root: string): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "s.db"),
    workspace: join(root, "ws"),
    approval: "ask",
    web: { backend: "obscura" },
  };
}

test("orchestrated_workflow_runs_end_to_end", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-wf-"));
  try {
    const result = await orchestratedWorkflow(config(root));
    assert.equal(result.status, "succeeded");
    assert.equal(result.humanGateAsked, 1);
    assert.equal(result.cited, true);
    assert.equal(result.fanOutLimit, DEFAULT_MAX_FAN_OUT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("worker_events_carry_correct_origin", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-wf-"));
  try {
    const result = await orchestratedWorkflow(config(root));
    assert.equal(result.origins.length, 4);
    for (const origin of result.origins) {
      assert.ok(origin.events > 0, `${origin.agentId} produced no events`);
    }
    const [research, coding, external, remote] = result.origins;
    for (const local of [research!, coding!]) {
      assert.deepEqual(local.executedBy, [], `${local.agentId} must not be marked external`);
      assert.deepEqual(local.remote, [], `${local.agentId} must not carry a remote endpoint`);
      assert.ok(local.bare > 0, `${local.agentId} events should be this agent (no foreign origin)`);
    }
    assert.deepEqual(external!.executedBy, ["external"]);
    assert.deepEqual(remote!.remote, [REMOTE_ENDPOINT]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate_failure_takes_back_edge_once", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-wf-"));
  try {
    const result = await orchestratedWorkflow(config(root));
    assert.deepEqual(result.gatePasses, [false, true]);
    assert.deepEqual(result.failRoute, ["coding"]);
    assert.equal(result.codingSessions, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate_throw_fails_workflow", async () => {
  const message = await gateThrowFails();
  assert.match(message, /WorkflowRuntimeError/);
  assert.match(message, /not a declared successor/);
  assert.notEqual(message, "succeeded");
});

test("worker_sessions_link_to_workflow_run", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-wf-"));
  try {
    const result = await orchestratedWorkflow(config(root));
    const ids = new Set(result.sessionAgentIds);
    assert.equal(ids.size, result.origins.length);
    for (const origin of result.origins) assert.ok(ids.has(origin.agentId), origin.agentId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
