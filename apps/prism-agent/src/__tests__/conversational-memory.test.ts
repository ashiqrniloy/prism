import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone } from "@arnilo/prism/testing";
import { createCodingWorker } from "../host/coding.js";
import type { HostConfig } from "../host/config.js";
import { loadHostConfig } from "../host/config.js";
import { createResearchWorker } from "../host/research.js";
import { conversationalMemory, MEMORY_FACT } from "../scenarios/conversational-memory.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

function config(root: string): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura" },
  };
}

test("conversational_memory_scenario_recalls_across_sessions_and_forgets", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-"));
  mkdirSync(join(root, "workspace"));
  try {
    const result = await conversationalMemory(config(root));
    assert.match(result.recalled, new RegExp(MEMORY_FACT), "session B's recall must return the archived exchange");
    assert.equal(result.forgetFound, true, "memory.forget must delete the exchange note");
    assert.doesNotMatch(result.afterForget, new RegExp(MEMORY_FACT), "the third session must not recall it");
    assert.match(result.afterForget, /no match in any kind/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("default_agents_do_not_load_memory_fabric", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-default-"));
  mkdirSync(join(root, "workspace"));
  try {
    const provider = mockProvider([[providerDone()]]);
    const coding = await createCodingWorker(config(root), { packages: [provider] });
    const research = await createResearchWorker(config(root), { packages: [provider] });
    try {
      for (const agent of [coding, research]) {
        const names = agent.inspect().packages.map((entry) => entry.name);
        assert.equal(names.includes("@arnilo/prism-memory-fabric"), false, "memory-fabric is opt-in");
      }
    } finally {
      await coding.dispose();
      await research.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("memory_option_rejects_unknown_value", () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-config-"));
  const path = join(root, "prism-agent.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
        storePath: join(root, "sessions.db"),
        workspace: join(root, "workspace"),
        approval: "ask",
        web: { backend: "obscura" },
        memory: "coding",
      }),
    );
    assert.throws(() => loadHostConfig(path), /memory must be conversational/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
