import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { createToolRegistry, dispatchToolCall } from "@arnilo/prism";
import {
  attachMcpToolBridge,
  connectMcpTools,
  listAllMcpTools,
  mapMcpToolsToDefinitions,
} from "../bridge.js";
import { createMcpTransport } from "../transport.js";
import { McpBridgeClosedError, McpToolNameCollisionError } from "../types.js";

const executionContext = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };

async function createFixture(tools: Array<{
  name: string;
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "test-server", version: "0.0.1" }, {
    capabilities: { tools: { listChanged: true } },
  });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: {
          text: z.string().optional(),
        },
      },
      async (args: { text?: string }) => ({
        content: [{ type: "text", text: String(await tool.handler(args)) }],
      }),
    );
  }

  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    client,
    clientTransport,
    server,
    serverTransport,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe("attachMcpToolBridge", () => {
  const fixtures: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    while (fixtures.length > 0) {
      await fixtures.pop()?.close();
    }
  });

  it("lists remote tools with prefixed names and executes calls", async () => {
    const fixture = await createFixture([
      {
        name: "echo",
        description: "echo text",
        handler: async (args) => `echo:${args.text}`,
      },
    ]);
    fixtures.push(fixture);

    const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
      serverId: "demo",
      listCacheTtlMs: 60_000,
    });

    assert.equal(bridge.tools.length, 1);
    assert.equal(bridge.tools[0]?.name, "mcp:demo:echo");
    assert.equal(bridge.tools[0]?.description, "echo text");

    const result = await bridge.tools[0]!.execute({ text: "hi" }, executionContext);
    assert.equal(result.content?.[0]?.type, "text");
    if (result.content?.[0]?.type === "text") {
      assert.equal(result.content[0].text, "echo:hi");
    }

    await bridge.close();
    assert.throws(() => bridge.tools, McpBridgeClosedError);
  });

  it("returns tool errors from MCP isError responses", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "test-server", version: "0.0.1" }, {
      capabilities: { tools: { listChanged: true } },
    });
    server.registerTool(
      "fail",
      { inputSchema: { reason: z.string().optional() } },
      async () => ({
        isError: true,
        content: [{ type: "text", text: "nope" }],
      }),
    );
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await client.connect(clientTransport);
    fixtures.push({
      async close() {
        await client.close();
        await server.close();
      },
    });

    const bridge = await attachMcpToolBridge(client, clientTransport, {
      serverId: "demo",
    });

    const failTool = bridge.tools.find((tool) => tool.name === "mcp:demo:fail");
    assert.ok(failTool);
    const result = await failTool!.execute({}, executionContext);
    assert.ok(result.error);
    assert.match(result.error.message, /nope/);
    await bridge.close();
  });

  it("returns an attributable error when a remote call exceeds callTimeoutMs", async () => {
    const fixture = await createFixture([{
      name: "hang",
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "late";
      },
    }]);
    fixtures.push(fixture);
    const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
      serverId: "hung",
      callTimeoutMs: 10,
    });

    const started = Date.now();
    const result = await bridge.tools[0]!.execute({}, executionContext);
    assert.ok(result.error);
    assert.match(result.error.message, /timed out|abort/i);
    assert.ok(Date.now() - started < 150, "hung MCP call exceeded timeout bound");
    assert.equal(result.name, "mcp:hung:hang");
    await bridge.close();
  });

  it("refreshes tool list after list_changed invalidates cache", async () => {
    const fixture = await createFixture([
      {
        name: "one",
        handler: async () => "1",
      },
    ]);
    fixtures.push(fixture);

    const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
      serverId: "demo",
      listCacheTtlMs: 60_000,
    });
    assert.equal(bridge.tools.length, 1);

    fixture.server.registerTool(
      "two",
      { inputSchema: { value: z.string().optional() } },
      async () => ({ content: [{ type: "text", text: "2" }] }),
    );
    await fixture.server.sendToolListChanged();

    await bridge.refresh();
    assert.equal(bridge.tools.length, 2);
    assert.ok(bridge.tools.some((tool) => tool.name === "mcp:demo:two"));
    await bridge.close();
  });

  it("dispatches through core harness with permission and validation hooks", async () => {
    const fixture = await createFixture([
      {
        name: "echo",
        handler: async (args) => args.text,
      },
    ]);
    fixtures.push(fixture);

    const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
      serverId: "demo",
    });
    const registry = createToolRegistry(bridge.tools);

    const result = await dispatchToolCall({
      registry,
      call: { type: "tool_call", id: "call_1", name: "mcp:demo:echo", arguments: { text: "ok" } },
      context: executionContext,
      validate: (_tool, args) => {
        if (typeof args.text !== "string") return "text required";
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.content?.[0]?.type, "text");
    await bridge.close();
  });
});

describe("mapMcpToolsToDefinitions", () => {
  it("throws on prefixed name collisions", () => {
    assert.throws(
      () =>
        mapMcpToolsToDefinitions(
          [
            { name: "dup", inputSchema: { type: "object", properties: {} } },
            { name: "dup", inputSchema: { type: "object", properties: {} } },
          ],
          {
            namePrefix: "mcp:test:",
            serverId: "test",
            callTimeoutMs: 1_000,
            maxResultBytes: 1_000,
            isClosed: () => false,
            callRemoteTool: async () => ({
              toolCallId: "c",
              name: "mcp:test:dup",
            }),
          },
        ),
      McpToolNameCollisionError,
    );
  });
});

describe("connectMcpTools transport validation", () => {
  it("rejects invalid HTTP URLs before connecting", async () => {
    await assert.rejects(
      () =>
        connectMcpTools({
          serverId: "remote",
          transport: { type: "streamable-http", url: "not-a-url" },
        }),
      /Invalid MCP HTTP URL/,
    );
  });

  it("rejects non-http protocols", () => {
    assert.throws(
      () =>
        createMcpTransport({
          type: "streamable-http",
          url: "file:///etc/passwd",
        }),
      /must use http: or https:/,
    );
  });
});

describe("listAllMcpTools", () => {
  it("aggregates paginated tool listings", async () => {
    const fixture = await createFixture([{ name: "a", handler: async () => "a" }]);
    const listed = await listAllMcpTools(fixture.client);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.name, "a");
    await fixture.close();
  });
});
