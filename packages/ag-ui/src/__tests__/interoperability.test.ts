import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventType } from "@ag-ui/core";
import { type ToolDefinition, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import type { McpAppsBridge, McpToolBridge } from "@arnilo/prism-mcp";
import type { A2AClient, A2AStreamEvent, A2ATask } from "@arnilo/prism-supervisor";
import { createAgent } from "@arnilo/prism";
import {
  createAgUiA2AAdapter,
  createAgUiMcpAdapter,
  createAgUiMcpAppHandler,
  createAgUiMcpAppSandbox,
  createAgUiHandler,
} from "../index.js";

const authorization = { ownership: { tenantId: "tenant-1", userId: "user-1" } };

function request(body: Record<string, unknown>, suffix = "") {
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

async function events(response: Response) {
  return (await response.text())
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>);
}

describe("AG-UI protocol fronting", () => {
  it("injects host-selected MCP tools through the normal Prism session loop and emits MCP Apps activity", async () => {
    let calls = 0;
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
      tools: [{ ...remote, execute: (args, context) => ((calls += 1), remote.execute(args, context)) }],
      apps,
      refresh: async () => undefined,
      close: async () => undefined,
    };
    const mcp = createAgUiMcpAdapter({
      bridge,
      select: () => ["mcp:weather:get"],
      projectResult: ({ result }) => result.value,
    });
    let selected: readonly ToolDefinition[] = [];
    let turn = 0;
    const handler = createAgUiHandler({
      authorize: () => authorization,
      mcp,
      sessionFactory: ({ input }) => {
        selected = input.serverTools;
        return createAgent({
          model: { provider: "mock", model: "mock" },
          tools: input.serverTools,
          provider: {
            id: "mock",
            async *generate() {
              if (++turn === 1) yield { type: "tool_call" as const, call: toolCallContent("weather-1", "mcp:weather:get", {}) };
              else yield providerTextDelta("forecast ready");
              yield providerDone();
            },
          },
        }).createSession({ id: "mcp-session" });
      },
    });
    const output = await events(await handler(request({})));
    assert.deepEqual(
      selected.map((tool) => tool.name),
      ["mcp:weather:get"],
    );
    assert.equal(calls, 1);
    assert.ok(output.some((event) => event.type === EventType.TOOL_CALL_RESULT));
    assert.deepEqual(output.find((event) => event.type === EventType.ACTIVITY_SNAPSHOT)?.content, {
      serverId: "weather",
      toolName: "get",
      resourceUri: "ui://weather/card",
      result: { temperature: 20 },
    });
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

  it("maps verified remote A2A task/message/A2UI parts without creating a local session", async () => {
    const task: A2ATask = {
      id: "remote-task",
      contextId: "remote-context",
      status: {
        state: "TASK_STATE_WORKING",
        timestamp: "2026-08-04T00:00:00.000Z",
        message: { role: "agent", messageId: "remote-message", parts: [{ text: "working" }] },
      },
      artifacts: [{ artifactId: "remote-ui", parts: [{ data: { a2ui: "card" } }] }],
    };
    const remoteEvents: readonly A2AStreamEvent[] = [
      { eventId: "remote-1", task },
      {
        eventId: "remote-2",
        statusUpdate: {
          taskId: task.id,
          contextId: task.contextId,
          status: { state: "TASK_STATE_COMPLETED", timestamp: "2026-08-04T00:00:01.000Z" },
        },
      },
    ];
    const client = {
      getCard: async () => ({ capabilities: { streaming: true } }),
      streamMessage: async function* () {
        yield* remoteEvents;
      },
      subscribeToTask: async function* () {
        yield* remoteEvents;
      },
    } as unknown as A2AClient;
    let correlated = 0;
    const a2a = createAgUiA2AAdapter({
      client,
      select: () => ({ kind: "start", message: { role: "user", messageId: "remote-input", parts: [{ text: "approved" }] } }),
      correlate: () => {
        correlated += 1;
      },
      projectPart: ({ part }) =>
        "data" in part
          ? [{ type: EventType.ACTIVITY_SNAPSHOT, messageId: "a2ui", activityType: "a2ui", content: { rendered: true }, replace: true }]
          : undefined,
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      a2a,
      sessionFactory: () => {
        throw new Error("remote A2A must not create a local session");
      },
    });
    const output = await events(await handler(request({})));
    assert.equal(correlated, 1);
    assert.ok(output.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT && event.delta === "working"));
    assert.ok(output.some((event) => event.type === EventType.ACTIVITY_SNAPSHOT && (event.content as { rendered?: boolean }).rendered));
    assert.equal(output.at(-1)?.type, EventType.RUN_FINISHED);
  });
});
