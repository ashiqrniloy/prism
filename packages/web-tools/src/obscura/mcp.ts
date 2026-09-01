import type { ToolDefinition, ToolResult } from "@arnilo/prism";
import { connectMcpTools, type McpToolBridge, type McpTransportConfig } from "@arnilo/prism-mcp";
import { isObscuraReadTool } from "./classify.js";
import { resolveObscuraProcessLimits } from "./limits.js";
import { validateObscuraCommand } from "./process.js";

export const DEFAULT_OBSCURA_SERVER_ID = "obscura";
export const DEFAULT_OBSCURA_NAME_PREFIX = "obscura_";

export interface ObscuraMcpToolsOptions {
  /** stdio (`obscura mcp` or a Docker argv) or Streamable HTTP transport config. */
  readonly transport: McpTransportConfig;
  readonly serverId?: string;
  /** Default `obscura_` so Obscura tools coexist with `@arnilo/prism-web-tools/browser`; `""` keeps native Obscura names. */
  readonly namePrefix?: string;
  /**
   * Streamable HTTP endpoints outside loopback require this explicit opt-in; the
   * endpoint still needs a secure transport/auth per `@arnilo/prism-mcp` policy.
   */
  readonly allowRemoteHttp?: boolean;
  readonly signal?: AbortSignal;
  /** Test seam: replace the MCP bridge connection. */
  readonly connect?: typeof connectMcpTools;
}

export interface ObscuraMcpTools {
  readonly tools: readonly ToolDefinition[];
  /** Re-list upstream tools (e.g. after an Obscura upgrade changes the tool set). */
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export class ObscuraMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObscuraMcpError";
  }
}

function resolveTransport(options: ObscuraMcpToolsOptions): McpTransportConfig {
  const transport = options.transport;
  if (transport.type === "stdio") {
    // Fail closed on the same command policy as owned processes (absolute, bounded, no insecure flags).
    validateObscuraCommand(
      { command: transport.command, args: transport.args, env: transport.env, cwd: transport.cwd },
      resolveObscuraProcessLimits(),
    );
    return transport;
  }
  const url = new URL(transport.url);
  const loopback = ["127.0.0.1", "::1", "[::1]", "localhost"].includes(url.hostname.toLowerCase());
  if (!loopback && !options.allowRemoteHttp) {
    throw new ObscuraMcpError(`non-loopback MCP HTTP endpoint ${url.hostname} requires explicit allowRemoteHttp`);
  }
  return transport;
}

/**
 * Bridge the complete Obscura MCP surface into Prism tools. Every advertised tool is
 * exposed (no static allow-list): reads are effect-free, known mutations and unknown
 * future tools are exclusive serialized external mutations.
 */
export async function createObscuraMcpTools(options: ObscuraMcpToolsOptions): Promise<ObscuraMcpTools> {
  const bridge = await (options.connect ?? connectMcpTools)({
    serverId: options.serverId ?? DEFAULT_OBSCURA_SERVER_ID,
    transport: resolveTransport(options),
    namePrefix: options.namePrefix ?? DEFAULT_OBSCURA_NAME_PREFIX,
    effect: ({ remoteName }) => (isObscuraReadTool(remoteName) ? { kind: "none", idempotency: "none" } : undefined),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return wrapObscuraBridge(bridge);
}

function wrapObscuraBridge(bridge: McpToolBridge): ObscuraMcpTools {
  // Obscura keeps one live page: mutating tools dispatch strictly sequentially.
  let mutationTail: Promise<unknown> = Promise.resolve();
  const tools = () =>
    bridge.tools.map((tool) => {
      if (typeof tool.effect !== "function" && tool.effect?.kind === "none") return tool;
      const execute = tool.execute.bind(tool);
      return {
        ...tool,
        exclusive: true,
        execute: (args: Parameters<typeof execute>[0], context: Parameters<typeof execute>[1]): Promise<ToolResult> => {
          const run = mutationTail.then(() => execute(args, context));
          mutationTail = run.catch(() => undefined);
          return run;
        },
      } satisfies ToolDefinition;
    });
  return {
    get tools() {
      return tools();
    },
    refresh: () => bridge.refresh(),
    close: () => bridge.close(),
  };
}
