import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ToolDefinition } from "@arnilo/prism";
import { createPrismMcpServer } from "@arnilo/prism-mcp";

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

const server = createPrismMcpServer({
  tools: [echo],
  authorize: async () => ({ allowed: true, ownership: { tenantId: "demo-tenant" } }),
});
const client = new Client({ name: "demo-client", version: "0.0.1" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

const result = await client.callTool({ name: "echo", arguments: { text: "hello" } });
console.log(JSON.stringify(result));

await client.close();
await server.close();
