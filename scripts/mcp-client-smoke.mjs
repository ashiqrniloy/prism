/**
 * Plans/064 Task 8 real-client MCP smoke: drives `createPrismMcpServer` through
 * the REAL `@modelcontextprotocol/client` SDK `Client` over a real
 * `StdioClientTransport` (stdio subprocess) — the same shape a production MCP
 * host uses — against the fixture server (scripts/fixtures/mcp-smoke-server.mjs).
 *
 * Operator-gated: PRISM_TEST_MCP_CLIENT=1 (mirrors acp-client-smoke.mjs); the
 * script FAILS CLOSED (exit 1) without the flag. The scenario stays sandboxed:
 * read-only echo tool calls, and an authorize-gated denial proves the host gate
 * is enforced over the wire (the denied tool never executes server-side).
 *
 * Scenario (plan test cases):
 *   1. initialize handshake completes (both modern auto and legacy openings)
 *   2. tools/list returns the registered capabilities
 *   3. tools/call round-trips a result
 *   4. authorize-gated tool denial fails closed over the wire
 *   5. malformed frame fails closed: the stdio transport tears the connection
 *      down instead of answering garbage (SDK-documented behavior)
 *
 * Server-initiated `elicitation/create` is NOT exercised: Prism records
 * server-initiated sampling/elicitation as a documented boundary
 * (scripts/mcp-conformance-2026-baseline.yaml); the elicitation round-trip
 * Prism does speak (bridge-side MRTR over real HTTP) is covered by
 * packages/mcp/src/__tests__/modern-bridge.test.ts.
 *
 * Usage: PRISM_TEST_MCP_CLIENT=1 node scripts/mcp-client-smoke.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-smoke-server.mjs", import.meta.url));

function clientFor(options) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FIXTURE],
    stderr: "pipe",
  });
  return { client: new Client({ name: "mcp-smoke-client", version: "0.0.1" }, options), transport };
}

async function withClient(options, run) {
  const { client, transport } = clientFor(options);
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
  if (process.env.PRISM_TEST_MCP_CLIENT !== "1") {
    console.error("mcp-client-smoke: PRISM_TEST_MCP_CLIENT=1 is required (operator-gated; fail closed without it). Skipping.");
    process.exit(1);
  }

  // 1+2+3. Real client over stdio subprocess: handshake, listing, round-trip.
  await withClient({ capabilities: {}, versionNegotiation: { mode: "auto" } }, async (client) => {
    assert.equal(client.getProtocolEra(), "modern", "auto negotiation must complete the modern handshake over stdio");
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["echo", "secret-tool"],
      "tools/list must return registered capabilities",
    );
    const echoed = await client.callTool({ name: "echo", arguments: { text: "smoke-roundtrip" } });
    assert.equal(echoed.isError, false);
    assert.match(JSON.stringify(echoed.content), /smoke-roundtrip/, "tools/call must round-trip the result");
    console.log("mcp-client-smoke: modern handshake + list + call OK");
  });

  // Legacy opening must also complete (dual-era serving contract).
  await withClient({ capabilities: {} }, async (client) => {
    assert.equal(client.getProtocolEra(), "legacy", "legacy opening must pin a legacy instance");
    const echoed = await client.callTool({ name: "echo", arguments: { text: "legacy-smoke" } });
    assert.equal(echoed.isError, false);
    console.log("mcp-client-smoke: legacy handshake + call OK");
  });

  // 4. Authorize-gated denial fails closed over the wire; the tool never runs.
  await withClient({ capabilities: {}, versionNegotiation: { mode: "auto" } }, async (client) => {
    const denied = await client.callTool({ name: "secret-tool", arguments: {} });
    assert.equal(denied.isError, true, "authorize-denied tool call must surface as a tool error, not a bypass");
    assert.doesNotMatch(JSON.stringify(denied.content), /must never run/, "denied tool must not have executed");
    console.log("mcp-client-smoke: authorize gate enforced over the wire OK");
  });

  // 5. Malformed frame fails closed: the transport closes the connection
  //    instead of answering garbage (StdioServerTransport ondata → onerror → close).
  {
    const child = spawn(process.execPath, [FIXTURE], { stdio: ["pipe", "pipe", "pipe"] });
    const sawValidAnswer = await new Promise((resolve) => {
      let buffer = "";
      const timer = setTimeout(() => resolve(false), 5_000);
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes("\n")) resolve(true); // ANY frame is a fail: garbage must get no answer
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.stdin.write("GARBAGE NOT JSON\n");
    });
    child.kill();
    assert.equal(sawValidAnswer, false, "malformed frame must fail closed (connection torn down, no JSON-RPC answer)");
    console.log("mcp-client-smoke: malformed frame fails closed OK");
  }

  console.log("mcp-client-smoke: OK (handshake modern+legacy, list, call, authorize gate, malformed-frame fail-closed)");
}

main().catch((error) => {
  console.error("mcp-client-smoke: FAILED", error?.message ?? error);
  process.exit(1);
});
