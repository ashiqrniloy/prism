import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentIdentity, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createConnectedAppSession } from "../index.js";
import { McpBridgeError } from "../types.js";
import type { ConnectMcpToolsOptions, McpToolBridge } from "../types.js";

function identity(accountId = "account-a"): AgentIdentity {
  return {
    tenantId: "tenant-a",
    accountId,
    userId: "user-a",
    principal: { kind: "user", id: "user-a" },
    scopes: ["tools:execute"],
    issuedAt: "2026-09-16T00:00:00.000Z",
    verified: true,
  };
}

function tool(serverId: string, remoteName: string): ToolDefinition {
  return {
    name: `mcp:${serverId}:${remoteName}`,
    parameters: { type: "object", properties: {} },
    effect: { kind: "external_mutation", idempotency: "unsupported" },
    execute: async (_args, context: ToolExecutionContext): Promise<ToolResult> => ({
      toolCallId: context.toolCallId,
      name: remoteName,
      value: remoteName,
    }),
  };
}

function bridge(serverId: string, remoteNames: readonly string[], closed?: Set<string>): McpToolBridge & { refreshes: () => number } {
  let refreshCount = 0;
  return {
    tools: remoteNames.map((name) => tool(serverId, name)),
    refresh: async () => {
      refreshCount += 1;
    },
    close: async () => {
      closed?.add(serverId);
    },
    refreshes: () => refreshCount,
  };
}

function transport() {
  return { type: "stdio" as const, command: "/usr/bin/example-mcp", args: ["mcp"] };
}

test("denied bind never connects", async () => {
  let connects = 0;
  const apps = createConnectedAppSession({
    identity: identity(),
    select: async () => false,
    connect: async () => {
      connects += 1;
      return bridge("slack", []);
    },
  });

  await assert.rejects(apps.bind({ appId: "slack", serverId: "slack", transport: transport() }), McpBridgeError);
  assert.equal(connects, 0);
});

test("rejects duplicate app and server identifiers", async () => {
  const apps = createConnectedAppSession({
    identity: identity(),
    select: () => true,
    connect: async (options) => bridge(options.serverId, []),
  });
  await apps.bind({ appId: "slack", serverId: "slack", transport: transport() });

  await assert.rejects(apps.bind({ appId: "slack", serverId: "linear", transport: transport() }), McpBridgeError);
  await assert.rejects(apps.bind({ appId: "linear", serverId: "slack", transport: transport() }), McpBridgeError);
  await apps.close();
});

test("allowTools filters remote names without refreshing", async () => {
  let connected: (McpToolBridge & { refreshes: () => number }) | undefined;
  let options: ConnectMcpToolsOptions | undefined;
  const apps = createConnectedAppSession({
    identity: identity(),
    select: () => true,
    connect: async (input) => {
      options = input;
      connected = bridge(input.serverId, ["list_channels", "post_message", "admin_delete"]);
      return connected;
    },
  });
  await apps.bind({
    appId: "slack",
    serverId: "slack",
    transport: transport(),
    allowTools: ["list_channels", "post_message"],
  });

  assert.equal(options?.effect, undefined);
  assert.deepEqual(
    apps.tools().map((item) => item.name),
    ["mcp:slack:list_channels", "mcp:slack:post_message"],
  );
  assert.equal(connected?.refreshes(), 0);
  await apps.refresh();
  assert.equal(connected?.refreshes(), 1);
  await apps.close();
});

test("list omits transport secrets", async () => {
  const secret = "fixture-access-token";
  const apps = createConnectedAppSession({
    identity: identity(),
    select: () => true,
    connect: async (options) => bridge(options.serverId, ["list_channels"]),
  });
  await apps.bind({
    appId: "slack",
    serverId: "slack",
    transport: { type: "stdio", command: "/usr/bin/slack-mcp", env: { SLACK_TOKEN: secret } },
  });
  await apps.bind({
    appId: "notion",
    serverId: "notion",
    transport: {
      type: "streamable-http",
      url: "https://mcp.example.test",
      allowedOrigins: ["https://mcp.example.test"],
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
    },
  });

  const listed = JSON.stringify(apps.list());
  assert.match(listed, /mcp:slack:list_channels/);
  assert.doesNotMatch(listed, /env|headers|token|fixture-access-token/i);
  await apps.close();
});

test("rejects a binding for another identity before connect", async () => {
  let connects = 0;
  const apps = createConnectedAppSession({
    identity: identity(),
    select: () => true,
    connect: async (options) => {
      connects += 1;
      return bridge(options.serverId, []);
    },
  });

  await assert.rejects(
    apps.bind({ appId: "slack", serverId: "slack", transport: transport(), identity: identity("account-b") }),
    McpBridgeError,
  );
  assert.equal(connects, 0);
});

test("enforces the hard 32-app limit", async () => {
  const apps = createConnectedAppSession({
    identity: identity(),
    maxApps: 32,
    select: () => true,
    connect: async (options) => bridge(options.serverId, []),
  });
  for (let index = 0; index < 32; index += 1) {
    await apps.bind({ appId: `app-${index}`, serverId: `server-${index}`, transport: transport() });
  }

  await assert.rejects(apps.bind({ appId: "app-32", serverId: "server-32", transport: transport() }), McpBridgeError);
  await apps.close();
});

test("unbind and close close every bound bridge", async () => {
  const closed = new Set<string>();
  const apps = createConnectedAppSession({
    identity: identity(),
    select: () => true,
    connect: async (options) => bridge(options.serverId, [], closed),
  });
  await apps.bind({ appId: "slack", serverId: "slack", transport: transport() });
  await apps.bind({ appId: "linear", serverId: "linear", transport: transport() });

  await apps.unbind("slack");
  assert.deepEqual([...closed], ["slack"]);
  await apps.close();
  assert.deepEqual([...closed].sort(), ["linear", "slack"]);
});
