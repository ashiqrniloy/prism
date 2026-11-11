import { randomUUID } from "node:crypto";
import type { Agent, ApprovalOutcome, Decision, JsonObject, Message, PendingDecision, RunResult, Session } from "@arnilo/prism";
import { McpBridgeError } from "@arnilo/prism-extensions/mcp";
import {
  acceptedContent,
  type CallToolResult,
  CLIENT_CAPABILITIES_META_KEY,
  type ClientCapabilities,
  type ElicitRequestFormParams,
  type InputRequest,
  type InputRequiredResult,
  inputRequired,
  type McpRequestContext,
  McpServer,
  type ServerContext,
  type Transport,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import manifest from "../../package.json" with { type: "json" };
import { bounded, truncateUtf8 } from "./bounds.js";
import { createPrismMcpWebHandler, servePrismMcpStdio } from "./server.js";
import { bindMcpSession, type ElicitRequest, type ElicitResult, isMcpHost, unbindMcpSession } from "./session-map.js";
import type { PrismMcpAuthorization, ServeMcpHandle, ServeMcpOptions } from "./types.js";

const DEFAULT_TOOL_NAME = "prompt";
const DEFAULT_MAX_PROMPT_BYTES = 64 * 1024;
const HARD_MAX_PROMPT_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 1024 * 1024;
const HARD_MAX_RESULT_BYTES = 8 * 1024 * 1024;
const APPROVAL_OUTCOMES: readonly ApprovalOutcome[] = ["allow_once", "allow_for_run", "reject_once", "reject_for_run"];
const APPROVAL_SCHEMA: ElicitRequestFormParams["requestedSchema"] = {
  type: "object",
  properties: { outcome: { type: "string", enum: [...APPROVAL_OUTCOMES] } },
  required: ["outcome"],
  additionalProperties: false,
};

/**
 * Serve an existing agent over MCP. One tool (`options.toolName`, default `prompt`) runs
 * `session.run(prompt)` on the session bound to the MCP session id; `agent.commands` are
 * listed as MCP prompts. Approvals suspend (`interactive: false`) and resume through the
 * tool result's `input_required` round trip when the client advertised `elicitation.form`.
 * Tool serving is `serveTools` (Phase 14): it bridges a `ToolDefinition[]` onto the run's
 * `tool.call` gate. This server runs the agent, never a bare tool.
 */
export function serveMcp(agent: Agent, options: ServeMcpOptions): ServeMcpHandle {
  const transports = [options.stdio === true, options.transport !== undefined, options.http !== undefined].filter(Boolean).length;
  if (transports !== 1) throw new McpBridgeError("serveMcp takes exactly one of { stdio: true }, { transport }, or { http }");
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  if (!toolName) throw new McpBridgeError("toolName must be non-empty");
  const maxPromptBytes = bounded(options.maxPromptBytes, DEFAULT_MAX_PROMPT_BYTES, HARD_MAX_PROMPT_BYTES, "maxPromptBytes");
  const maxResultBytes = bounded(options.maxResultBytes, DEFAULT_MAX_RESULT_BYTES, HARD_MAX_RESULT_BYTES, "maxResultBytes");
  const redactor = options.redactor ?? agent.config.redactor;
  const host = isMcpHost(agent.config.host) ? agent.config.host : undefined;
  const sessions = new Map<string, Session>();
  const pending = new Map<string, readonly PendingDecision[]>();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const factory = (request: McpRequestContext): McpServer => {
    const instanceId = `mcp-${randomUUID()}`;
    const server = new McpServer(
      { name: options.serverName ?? "prism-mcp-server", version: options.serverVersion ?? manifest.version },
      { capabilities: { tools: {}, prompts: {} } },
    );
    server.registerTool(
      toolName,
      { description: "Run the Prism agent and return its final text.", inputSchema: z.object({ prompt: z.string() }) },
      (args, ctx) => runTool(args.prompt, ctx, server, instanceId, request.era),
    );
    for (const command of agent.commands.list()) {
      server.registerPrompt(
        command.name,
        { description: command.description, argsSchema: z.record(z.string(), z.string()).default({}) },
        async (args, ctx) => {
          const name = command.name;
          if (!(await authorize("prompt", name, jsonObject(args), ctx))) throw new McpBridgeError("ERR_PRISM_MCP_FORBIDDEN: Forbidden");
          const session = await sessionFor(sessionKey(ctx, instanceId), ctx);
          const result = await agent.commands.run(name, jsonObject(args), { session });
          return { messages: [{ role: "user" as const, content: { type: "text" as const, text: clip(stringify(result)) } }] };
        },
      );
    }
    return server;
  };

  if (options.http) {
    let ready: Promise<Awaited<ReturnType<typeof createPrismMcpWebHandler>>> | undefined;
    const init = () => (ready ??= createPrismMcpWebHandler(factory, options.http));
    return {
      closed,
      close: async () => {
        await (await init()).close();
        resolveClosed();
      },
      handler: (request) => init().then((web) => web(request)),
    };
  }
  const wire = options.stdio === true ? new StdioServerTransport() : (options.transport as Transport);
  const stdio = servePrismMcpStdio(factory, { transport: wire });
  const upstream = wire.onclose;
  wire.onclose = () => {
    upstream?.();
    resolveClosed();
  };
  return {
    closed,
    close: async () => {
      for (const id of sessions.keys()) unbindMcpSession(host, id);
      sessions.clear();
      pending.clear();
      await stdio.close();
      resolveClosed();
    },
  };

  async function runTool(
    prompt: unknown,
    ctx: ServerContext,
    server: McpServer,
    instanceId: string,
    era: "legacy" | "modern",
  ): Promise<CallToolResult | InputRequiredResult> {
    if (!(await authorize("tool", toolName, { prompt: typeof prompt === "string" ? prompt : "" }, ctx)))
      return errorResult("Forbidden", "ERR_PRISM_MCP_FORBIDDEN");
    if (typeof prompt !== "string" || prompt.length === 0 || Buffer.byteLength(prompt, "utf8") > maxPromptBytes)
      return errorResult(`prompt must be a non-empty string <= ${maxPromptBytes} bytes`, "ERR_PRISM_MCP_INPUT");
    const key = sessionKey(ctx, instanceId);
    const stored = pending.get(key);
    const responses = ctx.mcpReq.inputResponses;
    if (responses !== undefined && Object.keys(responses).length > 0) {
      // A retry without a matching pending decision (a new server instance on a
      // stateless transport) must never re-run the prompt: fail closed.
      if (!stored) return errorResult("Approval cannot be resumed on this MCP session", "ERR_PRISM_MCP_APPROVAL_REQUIRED");
      pending.delete(key);
      const decisions = decisionsFor(stored, responses);
      return settleStream(await sessionFor(key, ctx), ctx, server, key, decisions);
    }
    const session = await sessionFor(key, ctx);
    if (host) {
      bindMcpSession(host, session.id, {
        elicitation: era === "legacy" && elicitationAvailable(server, ctx),
        elicit: (request) => elicit(ctx, request),
      });
    }
    try {
      const result = await session.run(prompt, { interactive: false, signal: ctx.mcpReq.signal });
      return settleResult(result, ctx, server, key);
    } catch (error) {
      return errorResult(clip(errorMessage(error)), "ERR_PRISM_MCP_RUN");
    } finally {
      unbindMcpSession(host, session.id);
    }
  }

  async function settleStream(
    session: Session,
    ctx: ServerContext,
    server: McpServer,
    key: string,
    decisions: readonly Decision[],
  ): Promise<CallToolResult | InputRequiredResult> {
    let text = "";
    let failed: string | undefined;
    let suspended: readonly PendingDecision[] | undefined;
    try {
      for await (const event of session.resume(decisions, { interactive: false, signal: ctx.mcpReq.signal })) {
        if (event.type === "message.completed") text = textOf(event.message);
        else if (event.type === "run.failed") failed = event.error.message;
        else if (event.type === "run.suspended") suspended = event.interruption.pendingDecisions ?? [];
      }
    } catch (error) {
      return errorResult(clip(errorMessage(error)), "ERR_PRISM_MCP_RUN");
    }
    if (failed !== undefined) return errorResult(clip(failed), "ERR_PRISM_MCP_RUN");
    if (suspended) return suspend(suspended, ctx, server, key);
    return textResult(clip(text));
  }

  function settleResult(result: RunResult, ctx: ServerContext, server: McpServer, key: string): CallToolResult | InputRequiredResult {
    if (result.status === "failed") return errorResult(clip(result.error?.message ?? "Run failed"), "ERR_PRISM_MCP_RUN");
    if (result.status === "aborted") return errorResult(clip(result.abortReason ?? "Run aborted"), "ERR_PRISM_MCP_ABORTED");
    if (result.status === "suspended") return suspend(result.pending ?? [], ctx, server, key);
    return textResult(clip(result.text));
  }

  function suspend(
    decisions: readonly PendingDecision[],
    ctx: ServerContext,
    server: McpServer,
    key: string,
  ): CallToolResult | InputRequiredResult {
    if (decisions.length === 0) return errorResult("Run suspended without a pending decision", "ERR_PRISM_MCP_APPROVAL_REQUIRED");
    if (!elicitationAvailable(server, ctx))
      return errorResult(`Approval required: ${decisions.map(approvalLabel).join(", ")}`, "ERR_PRISM_MCP_APPROVAL_REQUIRED");
    pending.set(key, decisions);
    const inputRequests: Record<string, InputRequest> = {};
    for (const decision of decisions) {
      inputRequests[decision.approvalId] = inputRequired.elicit({
        message: `Approve ${approvalLabel(decision)}?`,
        requestedSchema: APPROVAL_SCHEMA,
      });
    }
    return inputRequired({ inputRequests });
  }

  async function authorize(kind: "tool" | "prompt", name: string, args: JsonObject, ctx: ServerContext): Promise<boolean> {
    if (!options.authorize) return true;
    let decision: false | PrismMcpAuthorization;
    try {
      decision = await options.authorize({
        kind,
        name,
        arguments: args,
        authInfo: ctx.http?.authInfo,
        sessionId: ctx.sessionId,
        signal: ctx.mcpReq.signal,
      });
    } catch {
      return false;
    }
    return decision !== false;
  }

  async function sessionFor(key: string, ctx: ServerContext): Promise<Session> {
    const existing = sessions.get(key);
    if (existing) return existing;
    const session = ctx.sessionId ? await agent.session({ id: key, create: true }) : await agent.session();
    sessions.set(key, session);
    return session;
  }

  function clip(value: string): string {
    const redacted = redactor?.redact(value) ?? value;
    return truncateUtf8(redacted, maxResultBytes);
  }

  function textResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
  }

  function errorResult(message: string, code: string): CallToolResult {
    return { isError: true, content: [{ type: "text", text: truncateUtf8(`${code}: ${message}`, maxResultBytes) }] };
  }
}

function sessionKey(ctx: ServerContext, instanceId: string): string {
  return ctx.sessionId ?? instanceId;
}

function elicitationAvailable(server: McpServer, ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities = (envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? server.server.getClientCapabilities()) as
    | ClientCapabilities
    | undefined;
  return capabilities?.elicitation?.form !== undefined;
}

async function elicit(ctx: ServerContext, request: ElicitRequest): Promise<ElicitResult> {
  const requestedSchema: ElicitRequestFormParams["requestedSchema"] =
    request.kind === "confirm"
      ? { type: "object", properties: { approved: { type: "boolean" } }, required: ["approved"] }
      : request.kind === "select"
        ? {
            type: "object",
            properties: { value: { type: "string", enum: (request.options ?? []).map((option) => option.value) } },
            required: ["value"],
          }
        : { type: "object", properties: { value: { type: "string" } }, required: ["value"] };
  try {
    const response = await ctx.mcpReq.elicitInput({
      message: request.detail ? `${request.title}\n${request.detail}` : request.title,
      requestedSchema,
    });
    if (response.action !== "accept") return { status: "dismissed" };
    const content = response.content;
    if (request.kind === "confirm") {
      const approved = content && typeof content === "object" && "approved" in content ? content.approved === true : false;
      return approved ? { status: "answered", value: true } : { status: "dismissed" };
    }
    const value = content && typeof content === "object" && "value" in content ? content.value : undefined;
    return typeof value === "string" ? { status: "answered", value } : { status: "dismissed" };
  } catch {
    return { status: "unavailable" };
  }
}

function decisionsFor(stored: readonly PendingDecision[], responses: Record<string, unknown>): Decision[] {
  return stored.map((decision) => {
    const content = acceptedContent<{ outcome?: unknown }>(responses, decision.approvalId);
    const outcome = content?.outcome;
    return { approvalId: decision.approvalId, outcome: isApprovalOutcome(outcome) ? outcome : "reject_once" };
  });
}

function isApprovalOutcome(value: unknown): value is ApprovalOutcome {
  return typeof value === "string" && (APPROVAL_OUTCOMES as readonly string[]).includes(value);
}

function approvalLabel(decision: PendingDecision): string {
  return decision.scope.toolName ?? decision.kind;
}

function textOf(message: Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "[unserializable result]";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
