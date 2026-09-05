/**
 * Task 8 smoke fixture: the server side of the real-transport MCP client
 * smoke (scripts/mcp-client-smoke.mjs). Serves `createPrismMcpServer` over
 * stdio via `servePrismMcpStdio`. Sandboxed per the acp-client-smoke
 * precedent: the authorize gate records every call and denies the
 * not-allow-listed tool; there is no policy bypass anywhere.
 */

import { createPrismMcpServer, servePrismMcpStdio } from "@arnilo/prism-mcp";

/** Executed tool names, for post-hoc inspection via the stderr marker channel. */
const executed = [];

const echo = {
  name: "echo",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: (args, context) => {
    executed.push("echo");
    return { toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } };
  },
};

const secretTool = {
  name: "secret-tool",
  parameters: { type: "object", properties: {} },
  execute: (_args, context) => {
    executed.push("secret-tool");
    return { toolCallId: context.toolCallId, name: "secret-tool", value: "must never run" };
  },
};

servePrismMcpStdio(() =>
  createPrismMcpServer({
    tools: [echo, secretTool],
    authorize: async (input) => {
      if (input.kind === "tool" && input.name === "secret-tool") return false; // gate: never allowed
      return { allowed: true, ownership: { tenantId: "smoke-tenant" } };
    },
  }),
);
