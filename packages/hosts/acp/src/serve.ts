import { Readable, Writable } from "node:stream";
import {
  type AgentContext,
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type RequestPermissionResponse,
  type SessionUpdate,
  type Stream,
} from "@agentclientprotocol/sdk";
import type { Agent, AgentEvent, AgentFinishReason, Decision, JsonObject, PendingDecision, Session } from "@arnilo/prism";
import { isSessionNotFound } from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };
import { AcpError } from "./errors.js";
import { resolveAcpLimits } from "./limits.js";
import { createAcpEventMapper } from "./mapper.js";
import { decisionForPermission, elicitationRequest, PERMISSION_OPTIONS } from "./permission.js";
import { projectAcpPrompt } from "./prompt.js";
import { bindAcpSession, type ElicitRequest, type ElicitResult, isAcpHost, unbindAcpSession } from "./session-map.js";

export interface ServeAcpOptions {
  /** Serve one local stdio peer. Mutually exclusive with `stream`. */
  readonly stdio?: true;
  /** ACP `Stream` for in-process tests and embedded hosts. */
  readonly stream?: Stream;
  /** Per-connection allow/deny. Absent allows the peer. `false` is a JSON-RPC error and creates no session. */
  readonly authorize?: (input: { readonly peer: "stdio" | "stream" }) => boolean | Promise<boolean>;
}

export interface ServeAcpHandle {
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

const STOP: Readonly<Record<AgentFinishReason, "max_turn_requests" | "max_tokens" | "refusal" | "end_turn">> = {
  turn_limit: "max_turn_requests",
  token_limit: "max_tokens",
  refusal: "refusal",
  hook_stop: "end_turn",
  hook_limit: "end_turn",
  denied: "refusal",
};

/**
 * Serve an existing agent over ACP v1. Approvals suspend (`interactive: false`) and
 * resume through one `session/request_permission` per pending decision.
 */
export function serveAcp(prism: Agent, options: ServeAcpOptions): ServeAcpHandle {
  if (options.stdio === true && options.stream) throw new AcpError("ERR_PRISM_ACP_INPUT", "serveAcp takes stdio or stream, not both");
  if (options.stdio !== true && !options.stream)
    throw new AcpError("ERR_PRISM_ACP_INPUT", "serveAcp requires { stdio: true } or { stream }");
  const stream = options.stream ?? stdioStream();
  const limits = resolveAcpLimits();
  const host = isAcpHost(prism.config.host) ? prism.config.host : undefined;
  const sessions = new Map<string, Session>();
  const cancelled = new Set<string>();
  const cancelWaiters = new Map<string, Array<() => void>>();
  let elicitation = false;
  let authorized = false;
  let opened = false;

  const app = agent({ name: "prism" });
  app.onRequest(methods.agent.initialize, async (ctx) => {
    opened = true;
    const allowed = options.authorize ? await options.authorize({ peer: options.stdio === true ? "stdio" : "stream" }) : true;
    authorized = allowed === true;
    if (!authorized) throw RequestError.invalidRequest(undefined, "connection denied");
    elicitation = ctx.params.clientCapabilities?.elicitation != null;
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "prism", version: manifest.version },
    };
  });
  app.onRequest(methods.agent.session.new, async (ctx) => {
    assertAuthorized(authorized, opened);
    rejectMcpServers(ctx.params.mcpServers);
    const session = await prism.session();
    remember(session, ctx.client);
    await publishCommands(ctx.client, session);
    return { sessionId: session.id };
  });
  app.onRequest(methods.agent.session.load, async (ctx) => {
    assertAuthorized(authorized, opened);
    rejectMcpServers(ctx.params.mcpServers);
    const session = await openStored(prism, ctx.params.sessionId);
    remember(session, ctx.client);
    await replay(ctx.client, session);
    await publishCommands(ctx.client, session);
    return {};
  });
  app.onRequest(methods.agent.session.prompt, async (ctx) => {
    assertAuthorized(authorized, opened);
    const session = sessions.get(ctx.params.sessionId);
    if (!session) throw RequestError.invalidParams(undefined, "unknown session");
    cancelled.delete(session.id);
    const text = await promptText(ctx.params.prompt);
    const command = commandOf(text, prism);
    if (command) {
      await prism.commands.run(command.name, command.args, { session });
      return { stopReason: "end_turn" as const };
    }
    const stopReason = await runPrompt(session, text, ctx.client, ctx.signal);
    return { stopReason };
  });
  app.onNotification(methods.agent.session.cancel, (ctx) => {
    const session = sessions.get(ctx.params.sessionId);
    if (!session) return;
    cancelled.add(session.id);
    session.abort();
    for (const wake of cancelWaiters.get(session.id) ?? []) wake();
    cancelWaiters.delete(session.id);
  });

  const connection = app.connect(stream);
  return {
    closed: connection.closed,
    close: async () => {
      for (const id of sessions.keys()) unbindAcpSession(host, id);
      sessions.clear();
      connection.close();
      await connection.closed.catch(() => undefined);
    },
  };

  function remember(session: Session, client: AgentContext): void {
    sessions.set(session.id, session);
    if (!host) return;
    bindAcpSession(host, session.id, {
      elicitation,
      notify: async (text) => {
        await send(client, session.id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: clip(text) } });
      },
      elicit: (request) => elicit(client, session.id, request),
      cancelPermission: () => cancelled.add(session.id),
    });
  }

  async function runPrompt(
    session: Session,
    input: string,
    client: AgentContext,
    signal: AbortSignal,
  ): Promise<"end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"> {
    const mapper = createAcpEventMapper({ redactor: prism.config.redactor });
    let pending: readonly PendingDecision[] | undefined;
    let stop: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" = "end_turn";
    let failed: string | undefined;
    const consume = async (events: AsyncIterable<AgentEvent>): Promise<void> => {
      let sent = 0;
      for await (const event of events) {
        if (cancelled.has(session.id) || signal.aborted) {
          stop = "cancelled";
          return;
        }
        if (event.type === "run.suspended") {
          pending = event.interruption.pendingDecisions ?? [];
          continue;
        }
        if (event.type === "run.failed") {
          failed = event.error.message;
          return;
        }
        if (event.type === "run.completed") {
          stop = event.status === "completed" || !event.stopReason ? "end_turn" : STOP[event.stopReason];
        }
        if (sent >= limits.maxStreamEvents) continue;
        for (const update of await mapper.map(event)) {
          await send(client, session.id, update);
          sent += 1;
        }
      }
    };
    await consume(session.stream(input, { interactive: false, signal }));
    while (pending && pending.length > 0 && !cancelled.has(session.id) && !signal.aborted && !failed) {
      const decisions = await requestPermissions(client, session.id, pending);
      if (cancelled.has(session.id) || signal.aborted) return "cancelled";
      pending = undefined;
      await consume(session.resume(decisions, { interactive: false, signal }));
    }
    if (failed) throw RequestError.internalError(undefined, clip(failed));
    return cancelled.has(session.id) || signal.aborted ? "cancelled" : stop;
  }

  async function requestPermissions(client: AgentContext, sessionId: string, pending: readonly PendingDecision[]): Promise<Decision[]> {
    const decisions: Decision[] = [];
    for (const item of pending) {
      if (cancelled.has(sessionId)) {
        decisions.push({ approvalId: item.approvalId, outcome: "reject_once" });
        continue;
      }
      let response: RequestPermissionResponse;
      try {
        const cancelledResponse: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
        response = await Promise.race<RequestPermissionResponse>([
          client.request(methods.client.session.requestPermission, {
            sessionId,
            toolCall: {
              toolCallId: clip(item.toolCallId ?? item.approvalId),
              title: clip(item.scope.toolName ?? "tool"),
              kind: "other",
              status: "pending",
            },
            options: [...PERMISSION_OPTIONS],
          }),
          whenCancelled(sessionId).then(() => cancelledResponse),
        ]);
      } catch {
        response = { outcome: { outcome: "cancelled" as const } };
      }
      if (cancelled.has(sessionId)) {
        decisions.push({ approvalId: item.approvalId, outcome: "reject_once" });
        continue;
      }
      decisions.push(decisionForPermission(item, response));
    }
    return decisions;
  }

  async function publishCommands(client: AgentContext, session: Session): Promise<void> {
    const availableCommands = prism.commands
      .list()
      .slice(0, limits.acpCommandsPerUpdate)
      .map((command) => ({
        name: clip(command.name),
        description: clip(command.description),
      }));
    if (availableCommands.length === 0) return;
    await send(client, session.id, { sessionUpdate: "available_commands_update", availableCommands });
  }

  async function replay(client: AgentContext, session: Session): Promise<void> {
    const messages = await session.messages();
    let sent = 0;
    for (const message of messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      for (const block of message.content) {
        if (block.type !== "text" || sent >= limits.maxReplayEvents) continue;
        const text = clip(prism.config.redactor?.redact(block.text) ?? block.text);
        await send(client, session.id, {
          sessionUpdate: message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          messageId: message.id,
          content: { type: "text", text },
        });
        sent += 1;
      }
    }
  }

  function whenCancelled(sessionId: string): Promise<void> {
    if (cancelled.has(sessionId)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = cancelWaiters.get(sessionId) ?? [];
      list.push(resolve);
      cancelWaiters.set(sessionId, list);
    });
  }

  function clip(value: string): string {
    const redacted = prism.config.redactor?.redact(value) ?? value;
    if (Buffer.byteLength(redacted, "utf8") <= limits.maxTextBytes) return redacted;
    return redacted.slice(0, limits.maxTextBytes);
  }

  async function send(client: AgentContext, sessionId: string, update: SessionUpdate): Promise<void> {
    await client.notify(methods.client.session.update, { sessionId, update });
  }

  async function elicit(client: AgentContext, sessionId: string, request: ElicitRequest): Promise<ElicitResult> {
    const schema =
      request.kind === "confirm"
        ? { type: "object" as const, properties: { approved: { type: "boolean" as const } }, required: ["approved"] }
        : request.kind === "select"
          ? {
              type: "object" as const,
              properties: { value: { type: "string" as const, enum: (request.options ?? []).map((option) => option.value) } },
              required: ["value"],
            }
          : { type: "object" as const, properties: { value: { type: "string" as const } }, required: ["value"] };
    try {
      const response = await client.request(
        methods.client.elicitation.create,
        elicitationRequest(sessionId, clip(request.title), request.detail ? clip(request.detail) : undefined, schema as never),
      );
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
}

function stdioStream(): Stream {
  return ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
}

function assertAuthorized(authorized: boolean, opened: boolean): void {
  if (!opened || !authorized) throw RequestError.invalidRequest(undefined, "connection denied");
}

function rejectMcpServers(servers: readonly unknown[]): void {
  if (servers.length > 0) throw RequestError.invalidParams(undefined, "mcpServers is not supported");
}

async function openStored(prism: Agent, id: string): Promise<Session> {
  try {
    return await prism.session({ id });
  } catch (error) {
    if (isSessionNotFound(error)) throw RequestError.invalidParams(undefined, "unknown session");
    throw error;
  }
}

async function promptText(prompt: readonly { readonly type: string }[]): Promise<string> {
  const limits = resolveAcpLimits();
  const projected = await projectAcpPrompt(prompt, {
    maxBlocks: 32,
    maxTextBytes: limits.maxTextBytes,
    maxMediaParts: 0,
    maxMediaBytes: limits.maxEventBytes,
    capabilities: { image: false, audio: false, embeddedContext: false },
  });
  return projected.text;
}

function commandOf(text: string, prism: Agent): { readonly name: string; readonly args: JsonObject } | undefined {
  if (!text.startsWith("/")) return undefined;
  const body = text.slice(1).trim();
  const space = body.indexOf(" ");
  const name = space === -1 ? body : body.slice(0, space);
  if (!prism.commands.list().some((command) => command.name === name)) return undefined;
  const rest = space === -1 ? "" : body.slice(space + 1).trim();
  return { name, args: rest.length > 0 ? { text: rest } : {} };
}
