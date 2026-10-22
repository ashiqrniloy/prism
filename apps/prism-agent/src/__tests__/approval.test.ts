import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone } from "@arnilo/prism/testing";
import { createOrchestrator, type HostConfig, sessionIndex } from "../host/index.js";
import { approvalGatesCoding } from "../scenarios/approval-gates-coding.js";

const MODEL = { provider: "mock", model: "m" };

function config(root: string): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura" },
  };
}

test("approval_denies_coding_write", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-deny-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  spawnSync("git", ["init"], { cwd: workspace });
  try {
    const result = await approvalGatesCoding(config(root), false);
    assert.equal(result.fileExists, false);
    assert.equal(result.denied, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("approval_allows_coding_write", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-allow-"));
  const workspace = join(root, "workspace");
  spawnSync("mkdir", ["-p", workspace]);
  spawnSync("git", ["init"], { cwd: workspace });
  try {
    const hostConfig = config(root);
    const denied = await approvalGatesCoding(hostConfig, false);
    assert.equal(denied.fileExists, false);
    const allowed = await approvalGatesCoding(hostConfig, true);
    assert.equal(allowed.fileExists, true);
    const listed = await sessionIndex(hostConfig.storePath).list();
    assert.ok(listed.items.length >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("orchestrator_loads_delegate_child", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-orch-"));
  try {
    const agent = await createOrchestrator(config(root), { packages: [mockProvider([[providerDone()]])] });
    try {
      assert.equal(
        agent.inspect().tools.some((tool) => tool.name === "delegate"),
        true,
      );
    } finally {
      await agent.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
