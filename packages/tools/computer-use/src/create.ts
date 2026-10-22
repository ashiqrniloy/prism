import {
  type JsonObject,
  type RunLimits,
  type SecretRedactor,
  type ToolCapabilityKind,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "@arnilo/prism";
import {
  acceptDeviceChunk,
  assertDeviceAdmit,
  type DeviceAdapter,
  DevicePolicyError,
  resolveDevicePolicy,
} from "./devices.js";
import type { ConnectMcpToolsOptions, McpStdioTransport, McpToolBridge } from "@arnilo/prism-mcp";
import { classifyComputerUseLinuxTool, isComputerUseLinuxTool } from "./classify.js";
import { buildChildEnv, DEFAULT_CHILD_ENV_INHERIT } from "./env.js";

const DEFAULT_COMMAND = "computer-use-linux";
const DEFAULT_SERVER_ID = "computer-use-linux";
const SCREENSHOT_TOOLS = new Set(["screenshot", "get_app_state"]);
/** Every tool reaches a host-owned desktop through a host-owned MCP process. */
const EXTERNAL_EFFECTS: readonly ToolCapabilityKind[] = ["external"];

export type ComputerUseLinuxConnect = (options: ConnectMcpToolsOptions) => Promise<McpToolBridge>;

export interface ComputerUseLinuxToolsOptions {
  /** Host-owned binary command. Defaults to `computer-use-linux`. */
  readonly command?: string;
  /** Binary arguments. Defaults to `["mcp"]`. */
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stderr?: McpStdioTransport["stderr"];
  /** MCP bridge id used only for transport/error metadata. */
  readonly serverId?: string;
  readonly device: DeviceAdapter;
  /** Shared run accounting required by DeviceAdapter admission. */
  readonly runLimits: RunLimits;
  /** Host approval for mutating desktop calls. Defaults to false. */
  readonly approved?: boolean;
  readonly includeSetupTools?: boolean;
  readonly redactor?: SecretRedactor;
  /** Test/host platform seam; defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Test/host seam; production dynamically imports `connectMcpTools` from `@arnilo/prism-mcp`. */
  readonly connect?: ComputerUseLinuxConnect;
}

export interface ComputerUseLinuxTools {
  readonly tools: readonly ToolDefinition[];
  close(): Promise<void>;
}

export async function createComputerUseLinuxTools(options: ComputerUseLinuxToolsOptions): Promise<ComputerUseLinuxTools> {
  if ((options.platform ?? process.platform) !== "linux") {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_INPUT", "computer-use-linux requires a Linux host");
  }
  if (options.device?.kind !== "desktop-control") {
    throw new DevicePolicyError("ERR_PRISM_DEVICE_INPUT", "computer-use-linux requires a desktop-control device");
  }

  const policy = resolveDevicePolicy(options.device, { runLimits: options.runLimits });
  // Validate all factory-time admission requirements before spawning/connecting.
  assertDeviceAdmit(policy, { approved: true, activeSessions: 0 });

  const transport: McpStdioTransport = {
    type: "stdio",
    command: options.command ?? DEFAULT_COMMAND,
    args: options.args ?? ["mcp"],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    // Allow-list default env; never let the SDK inherit the full process.env (P1 hardening).
    env: options.env ?? buildChildEnv({ inherit: DEFAULT_CHILD_ENV_INHERIT }),
    ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
  };
  const bridge = await (options.connect ?? (await import("@arnilo/prism-mcp")).connectMcpTools)({
    serverId: options.serverId ?? DEFAULT_SERVER_ID,
    transport,
    namePrefix: "",
  });

  let mutationTail = Promise.resolve();
  const includeSetupTools = options.includeSetupTools === true;
  const tools = bridge.tools
    .filter((tool) => isComputerUseLinuxTool(tool.name, includeSetupTools))
    .map((remote) => {
      const kind = classifyComputerUseLinuxTool(remote.name)!;
      const execute = async (args: JsonObject, context: ToolExecutionContext): Promise<ToolResult> => {
        const operation = () => executeRemote(remote, kind, args, context, policy, options);
        if (kind === "read") return operation();
        return enqueueMutation(operation);
      };
      return {
        ...remote,
        exclusive: kind === "mutating" ? true : remote.exclusive,
        effects: EXTERNAL_EFFECTS,
        effect:
          kind === "read"
            ? { kind: "none", idempotency: "none" as const }
            : { kind: "external_mutation", idempotency: "unsupported" as const },
        execute,
      } satisfies ToolDefinition;
    });

  return {
    tools,
    close: () => bridge.close(),
  };

  async function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = mutationTail;
    let release!: () => void;
    mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

async function executeRemote(
  remote: ToolDefinition,
  kind: "read" | "mutating",
  args: JsonObject,
  context: ToolExecutionContext,
  policy: ReturnType<typeof resolveDevicePolicy>,
  options: ComputerUseLinuxToolsOptions,
): Promise<ToolResult> {
  context.signal?.throwIfAborted();
  assertDeviceAdmit(policy, {
    approved: kind === "read" || options.approved === true,
    activeSessions: 0,
  });

  const raw = await remote.execute(args, context);
  if (!raw.error && SCREENSHOT_TOOLS.has(remote.name)) {
    const chunk = acceptDeviceChunk(policy, resultBytes(raw));
    if (!chunk.accepted) {
      return withTrust(
        {
          toolCallId: context.toolCallId,
          name: remote.name,
          content: [{ type: "text", text: chunk.marker! }],
          value: { marker: chunk.marker, bytes: chunk.bytes },
          metadata: { device: chunk.marker, bytes: chunk.bytes },
        },
        options.redactor,
      );
    }
  }
  return withTrust({ ...raw, toolCallId: context.toolCallId, name: remote.name }, options.redactor);
}

function resultBytes(result: ToolResult): number {
  try {
    const json = JSON.stringify({ content: result.content, value: result.value });
    return Buffer.byteLength(json ?? "", "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function withTrust(result: ToolResult, redactor: SecretRedactor | undefined): ToolResult {
  const redacted = redactor?.redact(result) ?? result;
  return {
    ...redacted,
    metadata: { ...redacted.metadata, trust: "untrusted_external" },
  };
}
