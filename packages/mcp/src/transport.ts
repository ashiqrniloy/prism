import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpTransportConfig } from "./types.js";
import { McpBridgeError } from "./types.js";

export function createMcpTransport(config: McpTransportConfig): Transport {
  switch (config.type) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args ? [...config.args] : undefined,
        env: config.env ? { ...config.env } : undefined,
        cwd: config.cwd,
        stderr: config.stderr,
      });
    case "streamable-http": {
      let url: URL;
      try {
        url = new URL(config.url);
      } catch (error) {
        throw new McpBridgeError(`Invalid MCP HTTP URL: ${config.url}`, { cause: error });
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new McpBridgeError(`MCP HTTP URL must use http: or https: (got ${url.protocol})`);
      }
      return new StreamableHTTPClientTransport(url, {
        requestInit: config.requestInit,
        sessionId: config.sessionId,
      });
    }
    default: {
      const exhaustive: never = config;
      throw new McpBridgeError(`Unsupported MCP transport: ${(exhaustive as { type: string }).type}`);
    }
  }
}
