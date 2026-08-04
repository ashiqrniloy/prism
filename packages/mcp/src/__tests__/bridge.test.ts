import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSecretRedactor, createToolRegistry, dispatchToolCall } from "@arnilo/prism";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { attachMcpToolBridge, connectMcpTools, listAllMcpTools, mapMcpToolsToDefinitions } from "../bridge.js";
import {
  HARD_CALL_TIMEOUT_MS,
  HARD_LIST_CACHE_TTL_MS,
  HARD_MAX_CURSOR_BYTES,
  HARD_MAX_JSON_DEPTH,
  HARD_MAX_JSON_PROPERTIES,
  HARD_MAX_LIST_PAGES,
  HARD_MAX_RESULT_BYTES,
  HARD_MAX_TOOL_DESCRIPTION_BYTES,
  HARD_MAX_TOOL_NAME_BYTES,
  HARD_MAX_TOOL_SCHEMA_BYTES,
  HARD_MAX_TOOLS,
  HARD_MAX_TOTAL_TOOL_SCHEMA_BYTES,
} from "../limits.js";
import { createMcpTransport } from "../transport.js";
import { McpBridgeClosedError, McpBridgeError, McpToolNameCollisionError } from "../types.js";

const executionContext = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };

async function createFixture(
  tools: Array<{
    name: string;
    description?: string;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer(
    { name: "test-server", version: "0.0.1" },
    {
      capabilities: { tools: { listChanged: true } },
    },
  );

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

  it("requires host effect policy and never trusts remote descriptions", async () => {
    const fixture = await createFixture([
      { name: "read_claim", description: "read-only and idempotent", handler: async () => "ok" },
      { name: "mutate", handler: async () => "ok" },
    ]);
    fixtures.push(fixture);
    const defaultBridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, { serverId: "review" });
    assert.deepEqual(
      defaultBridge.tools.map((tool) => tool.effect),
      [
        { kind: "external_mutation", idempotency: "unsupported" },
        { kind: "external_mutation", idempotency: "unsupported" },
      ],
    );
    await defaultBridge.close();

    const reviewed = await createFixture([
      { name: "read_claim", description: "read-only and idempotent", handler: async () => "ok" },
      { name: "mutate", handler: async () => "ok" },
    ]);
    fixtures.push(reviewed);
    const bridge = await attachMcpToolBridge(reviewed.client, reviewed.clientTransport, {
      serverId: "review",
      effect: ({ remoteName }) =>
        remoteName === "read_claim" ? { kind: "none", idempotency: "none" } : { kind: "external_mutation", idempotency: "required" },
    });
    assert.deepEqual(
      bridge.tools.map((tool) => tool.effect),
      [
        { kind: "none", idempotency: "none" },
        { kind: "external_mutation", idempotency: "required" },
      ],
    );
    await bridge.close();
  });

  it("returns tool errors from MCP isError responses", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer(
      { name: "test-server", version: "0.0.1" },
      {
        capabilities: { tools: { listChanged: true } },
      },
    );
    server.registerTool("fail", { inputSchema: { reason: z.string().optional() } }, async () => ({
      isError: true,
      content: [{ type: "text", text: "nope" }],
    }));
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
    const fixture = await createFixture([
      {
        name: "hang",
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return "late";
        },
      },
    ]);
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

    fixture.server.registerTool("two", { inputSchema: { value: z.string().optional() } }, async () => ({
      content: [{ type: "text", text: "2" }],
    }));
    await fixture.server.sendToolListChanged();

    await bridge.refresh();
    assert.equal(bridge.tools.length, 2);
    assert.ok(bridge.tools.some((tool) => tool.name === "mcp:demo:two"));
    await bridge.close();
  });

  it("preserves the previous trusted tool set when refresh validation fails", async () => {
    const fixture = await createFixture([{ name: "safe", handler: async () => "safe" }]);
    fixtures.push(fixture);
    const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
      serverId: "atomic",
      maxToolNameBytes: 8,
    });
    const previous = bridge.tools;
    setClientRequest(fixture.client, async (request) => {
      if (request.method === "tools/list") {
        return { tools: [{ name: "hostile-name", inputSchema: { type: "object" } }] };
      }
      throw new Error("unexpected request");
    });
    await assert.rejects(bridge.refresh(), /name exceeds/);
    assert.strictEqual(bridge.tools, previous);
    assert.equal(bridge.tools[0]?.name, "mcp:atomic:safe");
    await bridge.close();
  });

  it("applies one aggregate result bound to content, structuredContent, and toolResult", async () => {
    const cases = [
      { content: [{ type: "text", text: "x".repeat(80) }] },
      { content: [], structuredContent: { value: "x".repeat(80) } },
      { toolResult: { value: "x".repeat(80) } },
      { content: [{ type: "text", text: "x".repeat(40) }], structuredContent: { value: "x".repeat(40) } },
    ];
    for (const remoteResult of cases) {
      const fixture = await createFixture([{ name: "bounded", handler: async () => "ok" }]);
      fixtures.push(fixture);
      const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
        serverId: "result",
        maxResultBytes: 64,
      });
      setClientRequest(fixture.client, async (request) => {
        if (request.method === "tools/call") return remoteResult;
        throw new Error("unexpected request");
      });
      const result = await bridge.tools[0]!.execute({}, executionContext);
      assert.match(result.error?.message ?? "", /exceeds 64 bytes/);
      assert.equal(result.value, undefined);
      await bridge.close();
      fixtures.pop();
    }
  });

  it("rejects deep, wide, cyclic-like, and non-finite result values", async () => {
    const hostile: unknown[] = [
      { toolResult: { a: { b: { c: true } } } },
      { toolResult: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`p${index}`, index])) },
      { toolResult: { value: Infinity } },
    ];
    const cyclic: { toolResult: Record<string, unknown> } = { toolResult: {} };
    cyclic.toolResult.self = cyclic.toolResult;
    hostile.push(cyclic);
    for (const remoteResult of hostile) {
      const fixture = await createFixture([{ name: "bounded", handler: async () => "ok" }]);
      fixtures.push(fixture);
      const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
        serverId: "json",
        maxJsonDepth: 4,
        maxJsonProperties: 10,
      });
      setClientRequest(fixture.client, async () => remoteResult);
      const result = await bridge.tools[0]!.execute({}, executionContext);
      assert.ok(result.error);
      assert.equal(result.value, undefined);
      await bridge.close();
      fixtures.pop();
    }
  });

  it("bounds remote thrown errors before the core redaction path", async () => {
    const fixture = await createFixture([{ name: "fail", handler: async () => "ok" }]);
    fixtures.push(fixture);
    const bridge = await attachMcpToolBridge(fixture.client, fixture.clientTransport, {
      serverId: "errors",
      maxResultBytes: 128,
    });
    const secret = "mcp-client-secret-canary";
    setClientRequest(fixture.client, async () => {
      throw new Error(`${secret}-${"x".repeat(1_000)}`);
    });
    const registry = createToolRegistry(bridge.tools);
    const result = await dispatchToolCall({
      registry,
      call: { type: "tool_call", id: "call_1", name: "mcp:errors:fail", arguments: {} },
      context: executionContext,
      redactor: createSecretRedactor([secret]),
    });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.ok(Buffer.byteLength(result.error?.message ?? "", "utf8") <= 128);
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

describe("MCP Apps bridge", () => {
  it("negotiates, hides app-only tools, preserves nested metadata, and reads bounded HTML", async () => {
    const client = {
      getServerCapabilities: () => ({ extensions: { "io.modelcontextprotocol/ui": {} } }),
      setNotificationHandler: () => undefined,
      close: async () => undefined,
      request: async (request: { method: string; params?: { uri?: string } }) => {
        if (request.method === "tools/list")
          return {
            tools: [
              {
                name: "weather",
                description: "weather",
                inputSchema: { type: "object" },
                _meta: { ui: { resourceUri: "ui://weather/view", visibility: ["model", "app"] }, "ui/resourceUri": "ui://ignored/flat" },
              },
              {
                name: "refresh",
                inputSchema: { type: "object" },
                _meta: { ui: { resourceUri: "ui://weather/view", visibility: ["app"] } },
              },
            ],
          };
        if (request.method === "resources/list")
          return {
            resources: [
              {
                uri: "ui://weather/view",
                name: "weather",
                mimeType: "text/html;profile=mcp-app",
                _meta: { ui: { csp: { connectDomains: ["https://list.example"] } } },
              },
            ],
          };
        if (request.method === "resources/read")
          return {
            contents: [
              {
                uri: request.params?.uri,
                mimeType: "text/html;profile=mcp-app",
                text: "<!doctype html><html><body>safe</body></html>",
                _meta: { ui: { csp: { connectDomains: ["https://read.example"] }, prefersBorder: true } },
              },
            ],
          };
        if (request.method === "tools/call") return { content: [{ type: "text", text: "ok" }] };
        throw new Error(`unexpected ${request.method}`);
      },
    } as unknown as Client;
    const bridge = await attachMcpToolBridge(
      client,
      { close: async () => undefined } as unknown as import("@modelcontextprotocol/sdk/shared/transport.js").Transport,
      {
        serverId: "weather",
        mcpApps: true,
      },
    );
    assert.deepEqual(
      bridge.tools.map((tool) => tool.name),
      ["mcp:weather:weather"],
    );
    assert.deepEqual(
      bridge.apps?.tools.map((tool) => [tool.name, tool.resourceUri, tool.visibility]),
      [
        ["weather", "ui://weather/view", ["model", "app"]],
        ["refresh", "ui://weather/view", ["app"]],
      ],
    );
    const listed = await bridge.apps!.listResources();
    assert.equal(listed[0]?.uri, "ui://weather/view");
    const resource = await bridge.apps!.readResource("ui://weather/view");
    assert.equal(resource.html.includes("<html"), true);
    assert.deepEqual(resource.ui?.csp?.connectDomains, ["https://read.example"]);
    const result = await bridge.apps!.callTool("refresh", {}, executionContext);
    assert.equal(result.name, "mcp:weather:refresh");
  });

  it("requires a remote MCP Apps extension acknowledgement", async () => {
    const client = {
      getServerCapabilities: () => ({}),
      setNotificationHandler: () => undefined,
    } as unknown as Client;
    await assert.rejects(
      attachMcpToolBridge(
        client,
        { close: async () => undefined } as unknown as import("@modelcontextprotocol/sdk/shared/transport.js").Transport,
        {
          serverId: "weather",
          mcpApps: true,
        },
      ),
      /not negotiated/,
    );
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
          transport: { type: "streamable-http", url: "not-a-url", allowedOrigins: ["https://example.test"] },
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
          allowedOrigins: ["https://example.test"],
        }),
      /must use https:/,
    );
  });
});

describe("listAllMcpTools", () => {
  it("aggregates paginated tool listings through raw bounded requests", async () => {
    const client = fakeListClient([
      { tools: [{ name: "a", inputSchema: { type: "object" } }], nextCursor: "next" },
      { tools: [{ name: "b", inputSchema: { type: "object" } }] },
    ]);
    const listed = await listAllMcpTools(client);
    assert.deepEqual(
      listed.map((tool) => tool.name),
      ["a", "b"],
    );
  });

  it("rejects repeated cursors, page overflow, and tool overflow", async () => {
    await assert.rejects(
      listAllMcpTools(
        fakeListClient([
          { tools: [], nextCursor: "a" },
          { tools: [], nextCursor: "b" },
          { tools: [], nextCursor: "a" },
        ]),
      ),
      /repeated.*cursor/i,
    );
    await assert.rejects(
      listAllMcpTools(
        fakeListClient([
          { tools: [], nextCursor: "a" },
          { tools: [], nextCursor: "b" },
        ]),
        undefined,
        { maxListPages: 2 },
      ),
      /exceeds 2 pages/,
    );
    await assert.rejects(
      listAllMcpTools(fakeListClient([{ tools: [tool("a"), tool("b")] }]), undefined, { maxTools: 1 }),
      /exceeds 1 tools/,
    );
  });

  it("bounds cursor, names, descriptions, schemas, aggregate schemas, depth, and properties", async () => {
    const cases: Array<[unknown, Record<string, number>, RegExp]> = [
      [{ tools: [], nextCursor: "long" }, { maxCursorBytes: 3 }, /cursor exceeds/],
      [{ tools: [tool("long")] }, { maxToolNameBytes: 3 }, /name exceeds/],
      [{ tools: [{ ...tool("a"), description: "long" }] }, { maxToolDescriptionBytes: 3 }, /description exceeds/],
      [{ tools: [{ name: "a", inputSchema: { value: "long" } }] }, { maxToolSchemaBytes: 8 }, /schema.*exceeds/],
      [{ tools: [tool("a"), tool("b")] }, { maxTotalToolSchemaBytes: 20 }, /aggregate/],
      [{ tools: [{ name: "a", inputSchema: { a: { b: { c: true } } } }] }, { maxJsonDepth: 3 }, /depth/],
      [{ tools: [{ name: "a", inputSchema: { a: 1, b: 2 } }] }, { maxJsonProperties: 1 }, /properties/],
    ];
    for (const [page, limits, pattern] of cases) {
      await assert.rejects(listAllMcpTools(fakeListClient([page]), undefined, limits), pattern);
    }
  });

  it("rejects every invalid finite client limit before requesting", async () => {
    const names = [
      "maxListPages",
      "maxTools",
      "maxCursorBytes",
      "maxToolNameBytes",
      "maxToolDescriptionBytes",
      "maxToolSchemaBytes",
      "maxTotalToolSchemaBytes",
      "maxJsonDepth",
      "maxJsonProperties",
      "maxResultBytes",
      "callTimeoutMs",
      "listCacheTtlMs",
    ];
    for (const name of names) {
      for (const value of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(listAllMcpTools(fakeListClient([]), undefined, { [name]: value }), McpBridgeError);
      }
    }
  });

  it("accepts each hard boundary and rejects cap plus one", async () => {
    const boundaries = {
      maxListPages: HARD_MAX_LIST_PAGES,
      maxTools: HARD_MAX_TOOLS,
      maxCursorBytes: HARD_MAX_CURSOR_BYTES,
      maxToolNameBytes: HARD_MAX_TOOL_NAME_BYTES,
      maxToolDescriptionBytes: HARD_MAX_TOOL_DESCRIPTION_BYTES,
      maxToolSchemaBytes: HARD_MAX_TOOL_SCHEMA_BYTES,
      maxTotalToolSchemaBytes: HARD_MAX_TOTAL_TOOL_SCHEMA_BYTES,
      maxJsonDepth: HARD_MAX_JSON_DEPTH,
      maxJsonProperties: HARD_MAX_JSON_PROPERTIES,
      maxResultBytes: HARD_MAX_RESULT_BYTES,
      callTimeoutMs: HARD_CALL_TIMEOUT_MS,
      listCacheTtlMs: HARD_LIST_CACHE_TTL_MS,
    } as const;
    for (const [name, cap] of Object.entries(boundaries)) {
      await assert.doesNotReject(listAllMcpTools(fakeListClient([{ tools: [] }]), undefined, { [name]: cap }));
      await assert.rejects(listAllMcpTools(fakeListClient([{ tools: [] }]), undefined, { [name]: cap + 1 }));
    }
  });

  it("honors abort before requesting", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(listAllMcpTools(fakeListClient([]), controller.signal), /stop/);
  });
});

function tool(name: string) {
  return { name, inputSchema: { type: "object" } };
}

function setClientRequest(client: Client, request: (request: { method: string }) => Promise<unknown>): void {
  Object.defineProperty(client, "request", { configurable: true, value: request });
}

function fakeListClient(pages: readonly unknown[]): Client {
  let index = 0;
  return {
    request: async (request: { method: string }) => {
      assert.equal(request.method, "tools/list");
      const page = pages[index++];
      if (!page) throw new Error("unexpected tools/list page");
      return page;
    },
  } as unknown as Client;
}
