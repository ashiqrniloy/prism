import assert from "node:assert/strict";
import type { AgentIdentity, ToolDefinition } from "@arnilo/prism";
import { type ConnectMcpToolsOptions, createConnectedAppSession, type McpToolBridge } from "@arnilo/prism-mcp";

const identity: AgentIdentity = {
  tenantId: "tenant-a",
  accountId: "account-a",
  userId: "user-a",
  principal: { kind: "user", id: "user-a" },
  scopes: ["tools:execute"],
  issuedAt: new Date(Date.now() - 60_000).toISOString(),
  verified: true,
};

function mockSlackBridge(options: ConnectMcpToolsOptions): McpToolBridge {
  const tools: ToolDefinition[] = [
    "list_channels",
    "get_channel",
    "search_messages",
    "post_message",
    "update_message",
    "delete_message",
  ].map((remoteName) => ({
    name: `mcp:${options.serverId}:${remoteName}`,
    parameters: { type: "object", properties: {} },
    effect: options.effect?.({ serverId: options.serverId, remoteName }) ?? {
      kind: "external_mutation",
      idempotency: "unsupported",
    },
    execute: async (_args, context) => ({ toolCallId: context.toolCallId, name: remoteName, value: remoteName }),
  }));
  return { tools, refresh: async () => {}, close: async () => {} };
}

export async function demo() {
  // Production hosts select the exact Slack MCP command/origin, then inject tokens through stdio env or MCP OAuth — never model context.
  const apps = createConnectedAppSession({
    identity,
    select: ({ transport }) => transport.type === "stdio" && transport.command === "/mock/slack-mcp",
    effect: ({ remoteName }) => (/^(?:list_|get_|search_)/.test(remoteName) ? { kind: "none", idempotency: "none" } : undefined),
    connect: async (options) => mockSlackBridge(options),
  });
  try {
    await apps.bind({
      appId: "slack",
      serverId: "slack",
      transport: { type: "stdio", command: "/mock/slack-mcp", args: ["mcp"] },
      allowTools: ["list_channels", "get_channel", "search_messages", "post_message"],
    });
    const tools = apps.tools();
    const read = tools.find(({ name }) => name === "mcp:slack:list_channels");
    const write = tools.find(({ name }) => name === "mcp:slack:post_message");
    assert.deepEqual(read?.effect, { kind: "none", idempotency: "none" });
    assert.deepEqual(write?.effect, { kind: "external_mutation", idempotency: "unsupported" });
    return { readEffect: "none" as const, writeEffect: "external_mutation" as const, tools: tools.map(({ name }) => name) };
  } finally {
    await apps.close();
  }
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
