import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentEvent } from "@arnilo/prism";
import { createAntigravityCliAgent, createAntigravityDelegationTool } from "../index.js";

function createFakeAgy(ws: string, name: string, code: string): string {
  const scriptPath = join(ws, name);
  const fullCode = `#!/usr/bin/env node\n${code}\n`;
  writeFileSync(scriptPath, fullCode, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test("createAntigravityCliAgent: inert creation with no side effects", () => {
  const agent = createAntigravityCliAgent();
  assert.ok(agent);
  assert.ok(agent.conversationStore);
  assert.equal(typeof agent.run, "function");
});

test("createAntigravityCliAgent: full delegated run with ephemeral config, event streaming, and conversation continuation", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agent-full-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-journey.mjs",
    `
const args = process.argv;
const convArgIndex = args.indexOf("--conversation");
const convId = convArgIndex !== -1 ? args[convArgIndex + 1] : "conv-journey-1";

process.stdout.write(JSON.stringify({ type: "init", cwd: ${JSON.stringify(ws)}, conversation_id: convId }) + "\\n");
process.stdout.write(JSON.stringify({ type: "step_update", conversation_id: convId, step_index: 0, state: "DONE", step_type: "tool", tool_info: { name: "prism:echo_tool" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "step_update", conversation_id: convId, step_index: 1, state: "DONE", step_type: "assistant", text_delta: "Journey completed." }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", status: "SUCCESS", conversation_id: convId, response: "Journey completed.", usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }) + "\\n");
process.exit(0);
`,
  );

  const agent = createAntigravityCliAgent({
    command: fakeAgy,
    tools: [
      {
        name: "echo_tool",
        description: "Echo test tool",
        execute: async () => ({ toolCallId: "1", name: "echo_tool", content: [{ type: "text", text: "ok" }] }),
      },
    ],
    toolPolicy: "prism-mutators",
  });

  const streamedEvents: AgentEvent[] = [];

  try {
    // 1. First run
    const result1 = await agent.run({
      prompt: "Execute initial step",
      cwd: ws,
      sessionId: "session-e2e-1",
      onEvent: (ev) => {
        streamedEvents.push(ev);
      },
    });

    assert.equal(result1.status, "SUCCESS");
    assert.equal(result1.conversationId, "conv-journey-1");
    assert.equal(result1.response, "Journey completed.");
    assert.ok(streamedEvents.length >= 3);

    // Ephemeral files should be cleaned up
    assert.ok(!existsSync(join(ws, ".agents", "mcp_config.json")));
    assert.ok(!existsSync(join(ws, ".agents", "agents", "prism", "agent.md")));

    // Conversation store should hold the conversation ID
    assert.equal(agent.conversationStore.get("session-e2e-1"), "conv-journey-1");

    // 2. Second run: resumes conversation
    const result2 = await agent.run({
      prompt: "Execute follow-up step",
      cwd: ws,
      sessionId: "session-e2e-1",
    });

    assert.equal(result2.status, "SUCCESS");
    assert.equal(result2.conversationId, "conv-journey-1");

    // Ephemeral files cleaned up after second run as well
    assert.ok(!existsSync(join(ws, ".agents", "mcp_config.json")));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("createAntigravityDelegationTool: executes tool and returns response", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-tool-test-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-tool.mjs",
    `
process.stdout.write(JSON.stringify({ type: "init", cwd: ${JSON.stringify(ws)}, conversation_id: "conv-tool-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", status: "SUCCESS", conversation_id: "conv-tool-1", response: "Delegated result message" }) + "\\n");
process.exit(0);
`,
  );

  const agent = createAntigravityCliAgent({ command: fakeAgy });
  const tool = createAntigravityDelegationTool({
    agent,
    cwd: ws,
  });

  assert.equal(tool.name, "delegate_to_antigravity");
  assert.ok(tool.description);

  try {
    const result = await tool.execute(
      { prompt: "Refactor module" },
      { sessionId: "sess-tool-1", runId: "run-tool-1", toolCallId: "call-tool-1" },
    );

    assert.equal(result.toolCallId, "call-tool-1");
    assert.equal(result.name, "delegate_to_antigravity");
    assert.ok(result.content?.[0]);
    assert.equal(result.content[0].type, "text");
    assert.equal((result.content[0] as { type: "text"; text: string }).text, "Delegated result message");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
