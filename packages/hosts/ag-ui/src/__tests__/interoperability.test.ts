import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, type ToolDefinition } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import type { McpAppsBridge, McpToolBridge } from "@arnilo/prism-mcp";
import {
  createAgUiMcpAdapter,
  createAgUiMcpAppHandler,
  createAgUiMcpAppSandbox,
  resolveAgUiLimits,
} from "../index.js";
import { parseAgUiInput } from "../input.js";

const authorization = { ownership: { tenantId: "tenant-1", userId: "user-1" } };

function _request(body: Record<string, unknown>, suffix = "") {
  return new Request(`https://host.example/ag-ui${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [{ id: "user-1", role: "user", content: "hello" }],
      tools: [],
      context: [],
      forwardedProps: {},
      ...body,
    }),
  });
}

async function _events(response: Response) {
  return (await response.text())
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>);
}

async function _mockAgent(id: string) {
  return await createAgent({
    id,
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            yield providerTextDelta("hello");
            yield providerDone();
          },
        },
      ]),
    ],
  });
}

describe("AG-UI protocol fronting", () => {
  it("selects only reviewed bridge tools and projects linked MCP App activity", async () => {
    const remote: ToolDefinition = {
      name: "mcp:weather:get",
      parameters: { type: "object" },
      execute: () => ({ toolCallId: "weather-1", name: "mcp:weather:get", value: { temperature: 20 } }),
    };
    const apps: McpAppsBridge = {
      serverId: "weather",
      negotiated: true,
      tools: [
        {
          name: "get",
          prismName: remote.name,
          inputSchema: { type: "object" },
          resourceUri: "ui://weather/card",
          visibility: ["model", "app"],
        },
      ],
      listResources: async () => [],
      readResource: async () => ({
        uri: "ui://weather/card",
        name: "get",
        mimeType: "text/html;profile=mcp-app",
        html: "<!doctype html><html></html>",
      }),
      callTool: async () => ({ toolCallId: "unused", name: "mcp:weather:get" }),
    };
    const bridge: McpToolBridge = {
      tools: [remote],
      apps,
      refresh: async () => undefined,
      close: async () => undefined,
    };
    const mcp = createAgUiMcpAdapter({
      bridge,
      select: () => ["mcp:weather:get"],
      projectResult: ({ result }) => result.value,
    });
    const limits = resolveAgUiLimits();
    const parsed = parseAgUiInput(
      {
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages: [{ id: "user-1", role: "user", content: "hello" }],
        tools: [],
        context: [],
        forwardedProps: {},
      },
      limits,
    );
    const tools = await mcp.prepare({ request: parsed, authorization, maxTools: 8, signal: new AbortController().signal });
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["mcp:weather:get"],
    );
    assert.deepEqual(
      mcp.activity({
        type: "tool.completed",
        status: "finished",
        sessionId: "s",
        runId: "r",
        result: { toolCallId: "weather-1", name: "mcp:weather:get", value: { temperature: 20 } },
        metadata: { durationMs: 1, status: "finished" },
      })?.content,
      { serverId: "weather", toolName: "get", resourceUri: "ui://weather/card", result: { temperature: 20 } },
    );
  });

  it("serves only negotiated same-server MCP Apps methods after authorization and approval", async () => {
    let calls = 0;
    const apps: McpAppsBridge = {
      serverId: "weather",
      negotiated: true,
      tools: [
        { name: "get", prismName: "mcp:weather:get", inputSchema: { type: "object" }, visibility: ["model"] },
        {
          name: "refresh",
          prismName: "mcp:weather:refresh",
          inputSchema: { type: "object" },
          resourceUri: "ui://weather/card",
          visibility: ["app"],
        },
      ],
      listResources: async () => [{ uri: "ui://weather/card", name: "weather", mimeType: "text/html;profile=mcp-app" }],
      readResource: async () => ({
        uri: "ui://weather/card",
        name: "weather",
        mimeType: "text/html;profile=mcp-app",
        html: "<!doctype html><html><body>safe</body></html>",
      }),
      callTool: async (_name, _args, context) => ({
        toolCallId: context.toolCallId,
        name: "mcp:weather:refresh",
        value: { refreshed: ++calls },
      }),
    };
    const sandbox = createAgUiMcpAppSandbox({
      ui: { csp: { connectDomains: ["https://api.weather.example"] }, permissions: { geolocation: true } },
    });
    assert.match(sandbox.contentSecurityPolicy, /connect-src https:\/\/api.weather.example/);
    assert.match(sandbox.contentSecurityPolicy, /frame-src 'none'/);
    assert.equal(sandbox.allow, "geolocation");
    let approved = false;
    const handler = createAgUiMcpAppHandler({
      apps,
      authorize: () => authorization,
      context: ({ messageId }) => ({ sessionId: "session-1", runId: "run-1", toolCallId: `ui:${messageId}` }),
      approveToolCall: () => approved,
      allowedOrigins: ["https://host.example"],
    });
    const call = (serverId: string, message: Record<string, unknown>) =>
      handler(
        new Request("https://host.example/mcp-app", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://host.example" },
          body: JSON.stringify({ serverId, message }),
        }),
      );
    const listed = await call("weather", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.deepEqual(
      ((await listed.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name),
      ["refresh"],
    );
    const resource = await call("weather", { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "ui://weather/card" } });
    assert.match(JSON.stringify(await resource.json()), /<!doctype html>/);
    const denied = await call("weather", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "refresh", arguments: {} } });
    assert.equal(denied.status, 403);
    assert.equal(calls, 0);
    approved = true;
    const allowed = await call("weather", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "refresh", arguments: {} } });
    assert.deepEqual((await allowed.json()) as unknown, {
      jsonrpc: "2.0",
      id: 4,
      result: { content: [], structuredContent: { refreshed: 1 } },
    });
    assert.equal((await call("other", { jsonrpc: "2.0", id: 5, method: "tools/list" })).status, 400);
  });

});
