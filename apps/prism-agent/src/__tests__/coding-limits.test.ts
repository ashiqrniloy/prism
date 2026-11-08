import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createCodingWorker } from "../host/coding.js";
import type { HostConfig } from "../host/config.js";

const MOCK = "mock/m";

function config(root: string): HostConfig {
  return {
    models: { orchestrator: MOCK, coding: { provider: "mock", model: "m", limits: { contextWindow: 100_000 } }, research: MOCK },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "auto",
    web: { backend: "obscura" },
  };
}

const readCall = (id: string) =>
  [{ type: "tool_call", call: { type: "tool_call", id, name: "read", arguments: { path: "a.txt" } } }, { type: "done" }] as const;

async function turnsOf(limits: Parameters<typeof createCodingWorker>[1]) {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-limits-"));
  mkdirSync(join(root, "workspace"));
  writeFileSync(join(root, "workspace", "a.txt"), "hello\n");
  try {
    const script = [
      readCall("c1"),
      readCall("c2"),
      readCall("c3"),
      [{ type: "content_delta", content: { type: "text", text: "done" } }, { type: "done" }],
    ];
    const agent = await createCodingWorker(config(root), { ...limits, packages: [mockProvider(script as never)] });
    try {
      const session = await agent.session({ id: "limits", create: true });
      const events: AgentEvent[] = [];
      for await (const event of session.stream("go")) events.push(event);
      return events.filter((event) => event.type === "turn.completed").length;
    } finally {
      await agent.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("coding_worker_applies_deps_limits", async () => {
  // Agent-wide ceilings narrow the loop; unset, the same script runs to its last turn.
  assert.equal(await turnsOf({ limits: { maxTurns: 2 } }), 2);
  assert.equal(await turnsOf({}), 4);
});
