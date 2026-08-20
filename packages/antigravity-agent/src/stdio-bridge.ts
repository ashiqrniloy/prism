import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AntigravityMcpError, type AntigravityMcpExposure } from "./types.js";

export interface AntigravityMcpStdioServerHandle {
  readonly transport: StdioServerTransport;
  readonly exposure: AntigravityMcpExposure;
  close(): Promise<void>;
}

export async function connectAntigravityMcpStdio(exposure: AntigravityMcpExposure): Promise<AntigravityMcpStdioServerHandle> {
  const transport = new StdioServerTransport();
  try {
    await exposure.server.connect(transport);
  } catch (error) {
    throw new AntigravityMcpError("Failed to connect stdio transport to MCP server", { cause: error });
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await transport.close();
    } catch {
      // Ignore transport close errors
    }
    await exposure.close();
  };

  if (exposure.runContext.signal) {
    exposure.runContext.signal.addEventListener(
      "abort",
      () => {
        void close();
      },
      { once: true },
    );
  }

  return {
    transport,
    exposure,
    close,
  };
}
