import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { mcpHost, serveMcp } from "@arnilo/prism-mcp-server";

// One agent, one tool: `serveMcp` exposes the agent as a single `prompt` tool and
// lists its commands as MCP prompts. `mcpHost()` wires approvals: a suspended run
// answers `input_required` and resumes on the client's elicitation response.
const agent = await createAgent({
  id: "mcp-server-demo",
  model: { provider: "mock", model: "offline" },
  host: mcpHost(),
  packages: [mockProvider([[providerTextDelta("hello from the Prism agent"), providerDone()]])],
});

if (process.argv.includes("--stdio")) {
  serveMcp(agent, { stdio: true });
  // Protocol-only stdout: logs go to stderr.
  console.error("demo MCP server listening on stdio");
} else {
  // In-process demo over both transports without opening a port.
  const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client");
  const client = new Client({ name: "demo-client", version: "0.0.1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveMcp(agent, { transport: serverTransport });
  await client.connect(clientTransport);

  const result = await client.callTool({ name: "prompt", arguments: { prompt: "hello" } });
  console.log(JSON.stringify(result));

  await client.close();
  await handle.close();

  // Dual-era HTTP serving looks like this:
  //
  //   import { createServer as createHttpServer } from "node:http";
  //   const { handler } = serveMcp(agent, {
  //     http: { allowedOrigins: ["https://example.test"] }, // exact origin allowlist
  //   });
  //   createHttpServer(async (req, res) => {
  //     const request = toWebRequest(req); // from @modelcontextprotocol/node
  //     const response = await handler(request);
  //     res.writeHead(response.status, Object.fromEntries(response.headers));
  //     res.end(response.body);
  //   });
  //
  // Modern serving is one fresh McpServer per request with no sticky sessions;
  // pass `sessionIdGenerator` + `resolveIdentity` to bind stateful 2025 sessions.
}
