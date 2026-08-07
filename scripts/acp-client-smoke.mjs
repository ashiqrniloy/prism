/**
 * Phase 10 optional protected real-client smoke (plan 010 Task 8).
 * Drives `createPrismAcpAgent` over the REAL SDK client bound to an
 * ndJsonStream (stdio) transport — the same framing a stable ACP client
 * (editor/IDE) uses — in a subprocess, so this is not the in-process
 * connectWith harness of the conformance suite.
 *
 * Operator-gated: run with PRISM_TEST_ACP_CLIENT=1. Without the flag the
 * script FAILS CLOSED (exit 1); the release gate does not invoke it, so the
 * freeze's fail-closed requirement is enforced at the script boundary.
 * The scenario stays sandboxed: read-only prompt, one edit tool call via
 * allow_once, and a narrowing mode switch (edit -> review). Policy is never
 * disabled — every prompt and tool call goes through the host authorize gate
 * and the four-outcome approval path.
 *
 * Usage: PRISM_TEST_ACP_CLIENT=1 node scripts/acp-client-smoke.mjs
 */
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

const FIXTURE = fileURLToPath(new URL("./fixtures/acp-smoke-agent.mjs", import.meta.url));

if (process.env.PRISM_TEST_ACP_CLIENT !== "1") {
  console.error("acp-client-smoke: PRISM_TEST_ACP_CLIENT=1 is required (operator-gated; fail closed without it). Skipping.");
  process.exit(1);
}

const child = spawn(process.execPath, [FIXTURE], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (chunk) => process.stderr.write(`[fixture] ${chunk}`));
const stream = (await import("@agentclientprotocol/sdk")).ndJsonStream(
  // Writable: child stdin; Readable: child stdout.
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
);

let permissionRequests = 0;
const acpClient = client({ name: "smoke-client" })
  .onNotification(methods.client.session.update, () => {})
  .onRequest(methods.client.session.requestPermission, () => {
    permissionRequests += 1;
    return { outcome: { outcome: "selected", optionId: "allow-once" } };
  });

let exitCode = 1;
try {
  const connection = await acpClient.connect(stream);
  const api = connection.agent;
  try {
    const initialize = await api.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { session: { configOptions: { boolean: {} } } },
    });
    assert.equal(initialize.protocolVersion, PROTOCOL_VERSION);
    assert.ok(initialize.agentCapabilities.loadSession, "loadSession advertised");
    assert.ok(initialize.agentCapabilities.sessionCapabilities.close, "close advertised");
    assert.deepEqual(initialize.agentCapabilities.promptCapabilities, { image: true, audio: true, embeddedContext: true });

    const created = await api.request(methods.agent.session.new, { cwd: "/workspace", mcpServers: [] });
    assert.deepEqual(created.modes, {
      currentModeId: "edit",
      availableModes: [
        { id: "edit", name: "Edit" },
        { id: "review", name: "Review" },
      ],
    });

    // Read-only prompt: text only, no tool calls.
    const read = await api.request(methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "list the workspace" }],
    });
    assert.equal(read.stopReason, "end_turn");
    assert.equal(permissionRequests, 0, "read-only prompt must not request permission");

    // One edit tool call via allow_once: approval path exercised, policy enforced.
    const edit = await api.request(methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "edit the file" }],
    });
    assert.equal(edit.stopReason, "end_turn");
    assert.equal(permissionRequests, 1, "edit tool call must go through the approval path");

    // Sandboxed mode switch: edit -> review narrows the host tool set (fixture asserts).
    const switched = await api.request(methods.agent.session.setMode, { sessionId: created.sessionId, modeId: "review" });
    assert.deepEqual(switched, {});

    // Reconnect/load of a stored session (replica change): the agent re-registers it
    // and reports the mode table defaults (per-session persisted mode state is host-owned).
    const loaded = await api.request(methods.agent.session.load, { sessionId: "smoke-stored", cwd: "/workspace", mcpServers: [] });
    assert.deepEqual(loaded.modes, {
      currentModeId: "edit",
      availableModes: [
        { id: "edit", name: "Edit" },
        { id: "review", name: "Review" },
      ],
    });
  } finally {
    await connection.close();
  }
  console.log("acp-client-smoke: OK (read-only, edit, sandboxed mode switch, reconnect)");
  exitCode = 0;
} catch (error) {
  console.error("acp-client-smoke: FAILED", error?.data?.details ?? error?.message ?? error);
} finally {
  child.kill();
  process.exitCode = exitCode;
}
