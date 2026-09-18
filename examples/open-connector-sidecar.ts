import assert from "node:assert/strict";
import type { AgentIdentity, ToolDefinition } from "@arnilo/prism";
import { type ConnectMcpToolsOptions, createConnectedAppSession, type McpToolBridge } from "@arnilo/prism-mcp";

/** The Open Connector runtime's five MCP tools (`/mcp/tools`). */
const OC_TOOLS = ["list_apps", "list_connections", "search_actions", "get_action_guide", "execute_action"] as const;
const OC_ORIGIN = "http://127.0.0.1:3000";

const identity: AgentIdentity = {
  tenantId: "tenant-a",
  accountId: "account-a",
  userId: "user-a",
  principal: { kind: "user", id: "user-a" },
  scopes: ["tools:execute"],
  issuedAt: new Date(Date.now() - 60_000).toISOString(),
  verified: true,
};

/** Stands in for `connectMcpTools` against a real sidecar; no socket, no provider catalog. */
function mockOpenConnectorBridge(options: ConnectMcpToolsOptions): McpToolBridge {
  const tools: ToolDefinition[] = OC_TOOLS.map((remoteName) => ({
    name: `mcp:${options.serverId}:${remoteName}`,
    parameters: { type: "object", properties: {} },
    effect: options.effect?.({ serverId: options.serverId, remoteName }) ?? {
      kind: "external_mutation",
      idempotency: "unsupported",
    },
    execute: async (_args, context) => ({
      toolCallId: context.toolCallId,
      name: remoteName,
      value: { connectionName: "default" },
    }),
  }));
  return { tools, refresh: async () => {}, close: async () => {} };
}

function binding() {
  return {
    appId: "open-connector",
    serverId: "oc",
    transport: {
      type: "streamable-http" as const,
      url: `${OC_ORIGIN}/mcp`,
      allowedOrigins: [OC_ORIGIN],
      // Loopback plaintext dev escape hatch; the runtime token stays host-supplied.
      allowLoopbackHttp: true,
      requestInit: { headers: { authorization: `Bearer ${process.env.OOMOL_CONNECT_RUNTIME_TOKEN ?? "host-token"}` } },
    },
    // Exact allowlist: the 1,000+ provider catalog never reaches the model.
    allowTools: ["search_actions", "get_action_guide", "execute_action"],
  };
}

export async function demo() {
  const apps = createConnectedAppSession({
    identity,
    select: ({ transport }) =>
      transport.type === "streamable-http" && transport.allowLoopbackHttp === true && transport.allowedOrigins.includes(OC_ORIGIN),
    // Reads are observations; `execute_action` stays unclassified → MCP mutation default.
    effect: ({ remoteName }) => (remoteName === "execute_action" ? undefined : { kind: "none", idempotency: "none" }),
    connect: async (options) => mockOpenConnectorBridge(options),
  });
  try {
    await apps.bind(binding());
    const tools = apps.tools();
    const read = tools.find(({ name }) => name === "mcp:oc:search_actions");
    const write = tools.find(({ name }) => name === "mcp:oc:execute_action");
    assert.deepEqual(read?.effect, { kind: "none", idempotency: "none" });
    assert.deepEqual(write?.effect, { kind: "external_mutation", idempotency: "unsupported" });
    assert.ok(!tools.some(({ name }) => name === "mcp:oc:list_apps"), "allowTools must hide unlisted discovery tools");

    // A host policy that does not admit the loopback origin never connects.
    const denied = createConnectedAppSession({
      identity,
      select: () => false,
      connect: async (options) => mockOpenConnectorBridge(options),
    });
    let selectRejected = false;
    try {
      await denied.bind(binding());
    } catch (error) {
      selectRejected = /was not selected/.test(String(error));
    } finally {
      await denied.close();
    }
    assert.equal(selectRejected, true);

    return {
      tools: tools.map(({ name }) => name),
      executeEffect: "external_mutation" as const,
      executeIdempotency: "unsupported" as const,
      selectRejected,
    };
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
