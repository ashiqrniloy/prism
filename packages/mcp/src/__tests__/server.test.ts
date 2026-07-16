import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSecretRedactor, createStaticPermissionPolicy, type CommandDefinition, type ToolDefinition } from "@arnilo/prism";
import { createPrismMcpServer, createPrismMcpWebHandler } from "../server.js";
import { McpBridgeError } from "../types.js";

async function fixture(options: Parameters<typeof createPrismMcpServer>[0]) {
  const server = createPrismMcpServer(options);
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    server,
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe("Prism MCP server", () => {
  const open: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    while (open.length > 0) await open.pop()?.close();
  });

  it("lists and calls only selected Prism tools and commands", async () => {
    const tool: ToolDefinition = {
      name: "echo",
      description: "Echo text",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute(args, context) {
        return { toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } };
      },
    };
    const command: CommandDefinition = {
      name: "workflow.status",
      parameters: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
      execute(args) {
        return { name: "workflow.status", value: { runId: args.runId, status: "suspended" } };
      },
    };
    const seen: string[] = [];
    const item = await fixture({
      tools: [tool],
      commands: [command],
      authorize(input) {
        seen.push(`${input.kind}:${input.name}`);
        return { allowed: true, ownership: { tenantId: "tenant-1" } };
      },
    });
    open.push(item);

    const listed = await item.client.listTools();
    assert.deepEqual(listed.tools.map((entry) => entry.name).sort(), ["echo", "workflow.status"]);
    const echo = await item.client.callTool({ name: "echo", arguments: { text: "hi" } });
    assert.equal(echo.isError, false);
    assert.match(JSON.stringify(echo.content), /hi/);
    const status = await item.client.callTool({ name: "workflow.status", arguments: { runId: "r1" } });
    assert.match(JSON.stringify(status.content), /suspended/);
    assert.deepEqual(seen, ["tool:echo", "command:workflow.status"]);
  });

  it("fails closed on authorization, validation, permission, duplicate names, and unknown tools", async () => {
    let executions = 0;
    const tool: ToolDefinition = {
      name: "danger",
      parameters: { type: "object", properties: { ok: { type: "boolean" } } },
      execute(_args, context) {
        executions += 1;
        return { toolCallId: context.toolCallId, name: "danger", value: "ran" };
      },
    };
    const denied = await fixture({ tools: [tool], authorize: () => false });
    open.push(denied);
    assert.equal((await denied.client.callTool({ name: "danger", arguments: {} })).isError, true);
    assert.equal(executions, 0);
    await denied.close();
    open.pop();

    const guarded = await fixture({
      tools: [tool],
      authorize: () => ({ allowed: true }),
      validate: () => "blocked by validator",
    });
    open.push(guarded);
    const invalid = await guarded.client.callTool({ name: "danger", arguments: {} });
    assert.equal(invalid.isError, true);
    assert.match(JSON.stringify(invalid.content), /blocked by validator/);
    assert.equal(executions, 0);
    assert.equal((await guarded.client.callTool({ name: "missing", arguments: {} })).isError, true);
    await guarded.close();
    open.pop();

    const permissionDenied = await fixture({
      tools: [tool],
      authorize: () => ({ allowed: true }),
      permission: createStaticPermissionPolicy(false),
    });
    open.push(permissionDenied);
    assert.equal((await permissionDenied.client.callTool({ name: "danger", arguments: {} })).isError, true);
    assert.equal(executions, 0);

    assert.throws(() => createPrismMcpServer({
      tools: [tool],
      commands: [{ name: "danger", execute: () => ({ name: "danger" }) }],
      authorize: () => ({ allowed: true }),
    }), McpBridgeError);
  });

  it("bounds concurrent calls, timeouts, results, and redacts errors", async () => {
    const secret = "mcp-server-canary";
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tool: ToolDefinition = {
      name: "slow",
      execute: async (_args, context) => {
        await Promise.race([
          gate,
          new Promise<void>((resolve) => context.signal?.addEventListener("abort", () => resolve(), { once: true })),
        ]);
        return { toolCallId: context.toolCallId, name: "slow", value: `${secret}-${"x".repeat(100)}` };
      },
    };
    const item = await fixture({
      tools: [tool],
      authorize: () => ({ allowed: true }),
      redactor: createSecretRedactor([secret]),
      maxConcurrentCalls: 1,
      callTimeoutMs: 20,
      maxResultBytes: 40,
    });
    open.push(item);

    const first = item.client.callTool({ name: "slow", arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const busy = await item.client.callTool({ name: "slow", arguments: {} });
    assert.equal(busy.isError, true);
    assert.match(JSON.stringify(busy.content), /CONCURRENCY/);
    const timed = await first;
    assert.equal(timed.isError, true);
    assert.doesNotMatch(JSON.stringify(timed), new RegExp(secret));
    release?.();
  });

  it("provides a bounded web-standard Streamable HTTP handler", async () => {
    const server = createPrismMcpServer({ authorize: () => ({ allowed: true }) });
    open.push(server);
    const handler = await createPrismMcpWebHandler(server, { maxRequestBytes: 256 });

    const tooLarge = await handler(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(300) }),
    }));
    assert.equal(tooLarge.status, 413);

    const initialized = await handler(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
    }));
    assert.equal(initialized.status, 200);
    assert.match(await initialized.text(), /prism-mcp-server/);
  });
});
