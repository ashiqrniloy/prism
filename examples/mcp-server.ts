import type { ToolDefinition } from "@arnilo/prism";
import { createPrismMcpServer, createPrismMcpWebHandler, servePrismMcpStdio } from "@arnilo/prism-mcp";

const echo: ToolDefinition = {
  name: "echo",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  execute(args, context) {
    return { toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } };
  },
};

// One factory backs every era: `createMcpHandler` builds a fresh McpServer
// per HTTP request (modern 2026-07-28 + legacy fallback), `serveStdio` pins
// one instance per stdio connection.
const createServer = () =>
  createPrismMcpServer({
    tools: [echo],
    authorize: async () => ({ allowed: true, ownership: { tenantId: "demo-tenant" } }),
  });

if (process.argv.includes("--stdio")) {
  servePrismMcpStdio(createServer);
  // Protocol-only stdout: logs go to stderr.
  console.error("demo MCP server listening on stdio");
} else {
  // In-process demo over both transports without opening a port.
  const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client");
  const client = new Client({ name: "demo-client", version: "0.0.1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({ name: "echo", arguments: { text: "hello" } });
  console.log(JSON.stringify(result));

  await client.close();

  // Dual-era HTTP serving looks like this:
  //
  //   import { createServer as createHttpServer } from "node:http";
  //   const handler = await createPrismMcpWebHandler(createServer, {
  //     allowedOrigins: ["https://example.test"], // exact origin allowlist
  //   });
  //   createHttpServer(async (req, res) => {
  //     const request = toWebRequest(req); // from @modelcontextprotocol/node
  //     const response = await handler(request);
  //     res.writeHead(response.status, Object.fromEntries(response.headers));
  //     res.end(response.body);
  //   });
  //
  // The handler is callable, and carries fetch/close/notify/bus; modern
  // serving is one fresh McpServer per request with no sticky sessions.
  void createPrismMcpWebHandler;
}
