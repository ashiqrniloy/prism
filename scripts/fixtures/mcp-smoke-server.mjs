/**
 * Task 8 smoke fixture: the server side of the real-transport MCP client
 * smoke (scripts/mcp-client-smoke.mjs). Serves a plain SDK `McpServer` over
 * stdio via `servePrismMcpStdio`; the fixture owns the deny itself (there is
 * no policy bypass anywhere). Prism's own tool serving moved to Phase 14
 * (`serveTools`), so this fixture deliberately uses no Prism tool surface.
 */

import { servePrismMcpStdio } from "@arnilo/prism-mcp-server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

/** Executed tool names, for post-hoc inspection via the stderr marker channel. */
const executed = [];

servePrismMcpStdio(() => {
  const server = new McpServer({ name: "prism-mcp-smoke", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, (args) => {
    executed.push("echo");
    return { isError: false, content: [{ type: "text", text: JSON.stringify({ echo: args.text }) }] };
  });
  server.registerTool("secret-tool", { inputSchema: z.object({}) }, () => {
    // Gate: never allowed. The body must never run.
    return { isError: true, content: [{ type: "text", text: "ERR_PRISM_MCP_FORBIDDEN: Forbidden" }] };
  });
  return server;
});
