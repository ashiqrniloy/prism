import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { ContentBlock, ExternalToolDecision, JsonObject, JsonValue, RunController, ToolResult } from "@arnilo/prism";
import { ALL_TOOL_EFFECTS, bridgeTools } from "@arnilo/prism/driver-kit";
import { type CallToolResult, fromJsonSchema, type JsonSchemaType, McpServer, type McpServerFactory } from "@modelcontextprotocol/server";
import manifest from "../package.json" with { type: "json" };
import { bounded, truncateUtf8 } from "./bounds.js";
import { createPrismMcpWebHandler } from "./server.js";
import type { PermissionDecision, PermissionRequest, PrismMcpWebHandler, ServeToolsHandle, ServeToolsOptions } from "./types.js";

const DEFAULT_HEADER_ENV = "PRISM_MCP_TOKEN";
const DEFAULT_MAX_CONCURRENT_CALLS = 8;
const HARD_MAX_CONCURRENT_CALLS = 64;
const DEFAULT_RESULT_BYTES = 1024 * 1024;
const HARD_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 256 * 1024;
const CLOSED_MESSAGE = "served tools are closed";
const APPROVAL_PENDING_MESSAGE = "approval is pending; the run is suspended until a decision is recorded, so do not retry this call";
const PERMISSION_STATE_KEY = "prism.permissions";
const PERMISSION_PENDING_MESSAGE = "the run is suspended until an approval decision is recorded, so do not retry this call";
const PERMISSION_NO_UI_MESSAGE = "no one can approve this call, so it is denied";
const PERMISSION_RESPOND_MESSAGE = "respond is not supported by the permission tool";

/** The neutral permission-tool input schema. A codec replaces it with an open object, so any vendor shape reaches `decode`. */
const PERMISSION_SCHEMA = {
  type: "object",
  properties: {
    toolName: { type: "string" },
    input: { type: "object" },
    toolCallId: { type: "string" },
  },
  required: ["toolName", "input"],
  additionalProperties: false,
} as const;
const PERMISSION_CODEC_SCHEMA = { type: "object", additionalProperties: true } as const;

/** The `serveTools` rejection reasons. Every one fails closed before anything is served. */
export type ServeToolsErrorCode =
  | "serve_tools_empty"
  | "serve_tools_transport"
  | "serve_tools_resource_bytes"
  | "serve_tools_permission_conflict";

export class ServeToolsError extends Error {
  constructor(
    readonly code: ServeToolsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServeToolsError";
  }
}

/**
 * Serve a run's tools to an external agent over the run's callback broker.
 *
 * `allow` names tools in `options.tools`; `bridgeTools` resolves them, so an unknown name fails
 * before anything is served and `invoke` refuses anything not bridged. Requests arrive through
 * `broker.route("mcp")` — the one seam a `stdio-relay` binary can reach — and are served by a
 * fresh stateless `McpServer` per request. The broker's synthesized `Request` carries only
 * `content-type`, so the route handler restores the streamable-HTTP `accept` header and unwraps an
 * SSE reply to its JSON payload. Tool results are redacted by the kernel (`dispatchToolCall` runs
 * the agent's redactor) and truncated to `limits.resultBytes` here. `options.permissionTool` adds a
 * prompt tool backed by `run.ask` that only asks and never executes. `close()` unregisters the
 * route, and it runs on `run.signal` abort and after an `approval_pending` result.
 */
export async function serveTools(run: RunController, options: ServeToolsOptions): Promise<ServeToolsHandle> {
  if (options.allow.length === 0 && options.permissionTool === undefined)
    throw new ServeToolsError("serve_tools_empty", "serveTools needs a non-empty allow list");
  const headerEnv = options.headerEnv ?? DEFAULT_HEADER_ENV;
  const maxConcurrentCalls = bounded(
    options.limits?.maxConcurrentCalls,
    DEFAULT_MAX_CONCURRENT_CALLS,
    HARD_MAX_CONCURRENT_CALLS,
    "maxConcurrentCalls",
  );
  const resultBytes = bounded(options.limits?.resultBytes, DEFAULT_RESULT_BYTES, HARD_RESULT_BYTES, "resultBytes");
  const resources = options.resources ?? [];
  for (const resource of resources) {
    if (Buffer.byteLength(resource.text, "utf8") > MAX_RESOURCE_BYTES)
      throw new ServeToolsError("serve_tools_resource_bytes", `resource ${resource.uri} exceeds ${MAX_RESOURCE_BYTES} bytes`);
  }
  const prefix = options.prefix ?? "";
  // Validate the transport before anything is registered, so a bad option leaves no route behind.
  const env: Record<string, string> = {};
  let endpoint: ServeToolsHandle["endpoint"];
  if (options.transport === "loopback-http") {
    endpoint = { transport: "http", url: `${options.broker.url}/mcp`, headerEnv };
    env[headerEnv] = options.broker.token;
  } else {
    const command = options.relay?.command;
    if (command === undefined || command.length === 0 || typeof command[0] !== "string" || command[0] === "")
      throw new ServeToolsError("serve_tools_transport", "stdio-relay needs a non-empty relay.command");
    endpoint = {
      transport: "stdio",
      command: command[0],
      args: [...command.slice(1), "relay", "mcp", "--run", dirname(options.broker.socketPath)],
    };
  }
  const bridge = bridgeTools(run, options.allow, { origin: options.origin, tools: options.tools });
  const exposedNames = new Map(bridge.tools.map((tool) => [`${prefix}${tool.name}`, tool.name] as const));
  const permission = options.permissionTool;
  if (permission !== undefined && (permission.name.length === 0 || exposedNames.has(`${prefix}${permission.name}`)))
    throw new ServeToolsError(
      "serve_tools_permission_conflict",
      "the permission tool needs a non-empty name that no allow-listed tool already takes",
    );

  let closed = false;
  let closing: Promise<void> | undefined;
  let activeCalls = 0;
  let closeAfterCall = false;

  const createServer: McpServerFactory = () => {
    const server = new McpServer({ name: "prism-tools", version: manifest.version }, { capabilities: { tools: {}, resources: {} } });
    for (const tool of bridge.tools) {
      const exposed = `${prefix}${tool.name}`;
      server.registerTool(
        exposed,
        { description: tool.description, inputSchema: fromJsonSchema(tool.schema as JsonSchemaType) },
        async (args: unknown): Promise<CallToolResult> => await callTool(exposed, args),
      );
    }
    for (const resource of resources) {
      server.registerResource(
        resource.name,
        resource.uri,
        { title: resource.name, ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }) },
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
              text: resource.text,
            },
          ],
        }),
      );
    }
    if (permission !== undefined) {
      server.registerTool(
        `${prefix}${permission.name}`,
        {
          description: "Ask the host to allow or deny a tool call. Answers JSON { behavior, updatedInput?, message? }.",
          inputSchema: fromJsonSchema((permission.codec === undefined ? PERMISSION_SCHEMA : PERMISSION_CODEC_SCHEMA) as JsonSchemaType),
        },
        async (args: unknown): Promise<CallToolResult> => await permissionCall(args),
      );
    }
    return server;
  };

  const web: PrismMcpWebHandler = await createPrismMcpWebHandler(createServer);

  const close = (): Promise<void> => {
    closing ??= (async () => {
      if (closed) return;
      closed = true;
      run.signal.removeEventListener("abort", onAbort);
      options.broker.route("mcp", undefined);
      await web.close();
    })();
    return closing;
  };
  const onAbort = (): void => void close();
  run.signal.addEventListener("abort", onAbort, { once: true });

  const route = async (request: Request): Promise<Response> => {
    if (closed) return rpcErrorResponse(undefined, -32000, CLOSED_MESSAGE);
    const text = await request.text();
    const message = parseMessage(text);
    const id = message !== undefined && "id" in message ? message.id : undefined;
    const isCall = message?.method === "tools/call";
    if (isCall && activeCalls >= maxConcurrentCalls)
      return rpcErrorResponse(id, -32000, "too many concurrent tool calls; the call was not queued");
    if (isCall) activeCalls += 1;
    try {
      const response = await web(normalizeRequest(request, text));
      const settled = await unwrapSse(response);
      if (closeAfterCall) {
        closeAfterCall = false;
        await close();
      }
      return settled;
    } finally {
      if (isCall) activeCalls -= 1;
    }
  };

  options.broker.route("mcp", route);
  if (run.signal.aborted) await close();

  return { endpoint, env, tools: [...exposedNames.keys(), ...(permission === undefined ? [] : [`${prefix}${permission.name}`])], close };

  async function callTool(exposed: string, args: unknown): Promise<CallToolResult> {
    const name = exposedNames.get(exposed);
    if (name === undefined) return errorResult(`unknown tool ${exposed}`);
    const result = await bridge.invoke({
      type: "tool_call",
      id: randomUUID(),
      name,
      arguments: isRecord(args) ? (args as JsonObject) : ({} as JsonObject),
    });
    if ((result.metadata as { approvalPending?: unknown } | undefined)?.approvalPending === true) {
      closeAfterCall = true;
      return errorResult(APPROVAL_PENDING_MESSAGE);
    }
    if (result.error !== undefined) return errorResult(errorText(result.error));
    return contentResult(result);
  }

  function errorResult(message: string): CallToolResult {
    return { isError: true, content: [{ type: "text", text: truncateUtf8(message, resultBytes) }] };
  }

  /**
   * One `run.ask` per call, and never an execution. Every failure path denies: a throwing `decode`
   * or gate, an `encode` that throws, and a decision that cannot be recorded.
   */
  async function permissionCall(args: unknown): Promise<CallToolResult> {
    let request: PermissionRequest;
    try {
      request = permission?.codec === undefined ? decodePermission(args) : permission.codec.decode(args as JsonValue);
    } catch (error) {
      return neutralResult({ behavior: "deny", message: `permission request rejected: ${throwText(error)}` });
    }
    const toolCallId = request.toolCallId ?? randomUUID();
    let decision: ExternalToolDecision;
    try {
      decision = await run.ask(
        {
          toolCallId,
          name: request.toolName,
          args: request.input,
          effects: permission?.effects?.(request.toolName) ?? ALL_TOOL_EFFECTS,
        },
        { rewrite: permission?.rewrite ?? false },
      );
    } catch {
      decision = { allow: false, reason: "tool_call_gate_failed" };
    }
    if ("allow" in decision && decision.allow === false && decision.reason === "approval_pending") closeAfterCall = true;
    let mapped = mapPermission(decision);
    let result: CallToolResult;
    if (permission?.codec === undefined) {
      result = neutralResult(mapped);
    } else {
      try {
        result = permission.codec.encode(mapped);
      } catch (error) {
        mapped = { behavior: "deny", message: `permission codec failed: ${throwText(error)}` };
        result = neutralResult(mapped);
      }
    }
    try {
      await run.state(PERMISSION_STATE_KEY).append([
        {
          toolName: request.toolName,
          toolCallId,
          behavior: mapped.behavior,
          ...(mapped.message === undefined ? {} : { reason: mapped.message }),
        },
      ]);
    } catch {
      if (mapped.behavior === "allow") {
        mapped = { behavior: "deny", message: "permission record failed, so the call is denied" };
        result = neutralResult(mapped);
      }
    }
    return result;
  }

  function contentResult(result: ToolResult): CallToolResult {
    const content: CallToolResult["content"] = [];
    for (const block of result.content ?? []) content.push(blockToContent(block));
    if (content.length === 0 && result.value !== undefined) content.push({ type: "text", text: clip(stringify(result.value)) });
    return { content };
  }

  function blockToContent(block: ContentBlock): CallToolResult["content"][number] {
    if (block.type === "text") return { type: "text", text: clip(block.text) };
    return { type: "text", text: clip(stringify(block)) };
  }

  function clip(text: string): string {
    return truncateUtf8(text, resultBytes);
  }
}

/** Restores the streamable-HTTP `accept` header the broker drops, preserving the body. */
function normalizeRequest(request: Request, text: string): Request {
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json, text/event-stream");
  return new Request(request.url, { method: request.method, headers, ...(text === "" ? {} : { body: text }) });
}

/** A streamable-HTTP reply may be SSE; the JSON-RPC message is the last `data:` line. */
async function unwrapSse(response: Response): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return response;
  const body = await response.text();
  const payload = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .at(-1)
    ?.slice(5)
    .trim();
  if (payload === undefined) return rpcErrorResponse(undefined, -32603, "empty MCP event stream");
  return new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
}

function rpcErrorResponse(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/** The neutral permission input, validated. A codec replaces this decode. */
function decodePermission(args: unknown): PermissionRequest {
  if (!isRecord(args)) throw new TypeError("permission arguments must be an object");
  const { toolName, input, toolCallId } = args;
  if (typeof toolName !== "string" || toolName.length === 0) throw new TypeError("toolName must be a non-empty string");
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("input must be an object");
  if (toolCallId !== undefined && typeof toolCallId !== "string") throw new TypeError("toolCallId must be a string");
  return { toolName, input: input as JsonObject, ...(toolCallId === undefined ? {} : { toolCallId }) };
}

/** The gate's answer as the neutral decision. A `respond` is never forwarded: the tool only asks. */
function mapPermission(decision: ExternalToolDecision): PermissionDecision {
  if ("respond" in decision) return { behavior: "deny", message: PERMISSION_RESPOND_MESSAGE };
  if (decision.allow) return { behavior: "allow", ...(decision.args === undefined ? {} : { updatedInput: decision.args as JsonObject }) };
  if (decision.reason === "approval_pending") return { behavior: "deny", message: PERMISSION_PENDING_MESSAGE };
  if (decision.reason === "non_interactive") return { behavior: "deny", message: PERMISSION_NO_UI_MESSAGE };
  return { behavior: "deny", message: `denied: ${decision.reason}` };
}

/** The neutral shape: the decision as JSON text, never `isError` (the vendor reads it as a decision). */
function neutralResult(decision: PermissionDecision): CallToolResult {
  try {
    return { content: [{ type: "text", text: JSON.stringify(decision) }] };
  } catch {
    return { isError: true, content: [{ type: "text", text: "permission decision could not be encoded" }] };
  }
}

function throwText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseMessage(text: string): { method?: string; id?: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? (value as { method?: string; id?: unknown }) : undefined;
  } catch {
    return undefined;
  }
}

function errorText(error: { code?: string | number; message?: string }): string {
  const message = error.message ?? "the tool failed";
  return error.code === undefined ? message : `${error.code}: ${message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "[unserializable result]";
  }
}
