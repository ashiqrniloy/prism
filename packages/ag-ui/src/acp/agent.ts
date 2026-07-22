import { agent, methods, PROTOCOL_VERSION, type AgentApp, type AgentContext, type RequestPermissionResponse, type SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentEvent, AgentRunLifecycle, AgentSession, SecretRedactor } from "@arnilo/prism";
import { resolveAgUiLimits, type AgUiLimitOptions } from "../limits.js";
import type { AgUiProjection } from "../projection.js";
import type { AgUiAuthorization } from "../types.js";
import { createAcpEventMapper } from "./mapper.js";

export interface AcpAuthorization extends AgUiAuthorization {}

export interface AcpSessionBinding {
  readonly session: AgentSession;
  /** Optional host assertion passed to the durable lifecycle. */
  readonly agentId?: string;
}

export interface CreatePrismAcpAgentOptions<Authorization extends AcpAuthorization = AcpAuthorization> {
  readonly name?: string;
  /** Host binds transport identity to Prism ownership. False rejects new sessions. */
  readonly authorize: (input: { readonly sessionId?: string; readonly signal: AbortSignal }) => Authorization | false | Promise<Authorization | false>;
  /** Host owns session construction; ACP cwd, files, MCP, and editor state are never forwarded. */
  readonly sessionFactory: (input: { readonly authorization: Authorization; readonly signal: AbortSignal }) => AcpSessionBinding | Promise<AcpSessionBinding>;
  readonly lifecycle: AgentRunLifecycle;
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  readonly limits?: AgUiLimitOptions;
}

interface ActiveSession extends AcpSessionBinding {
  controller?: AbortController;
}

interface AcpStreamBudget {
  events: number;
  bytes: number;
}

/** Builds a stable ACP v1 agent using Prism sessions and durable-resume streams. */
export function createPrismAcpAgent<Authorization extends AcpAuthorization = AcpAuthorization>(options: CreatePrismAcpAgentOptions<Authorization>): AgentApp {
  const limits = resolveAgUiLimits(options.limits);
  const sessions = new Map<string, ActiveSession>();

  return agent({ name: options.name ?? "Prism" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { sessionCapabilities: { close: {} } },
      agentInfo: { name: options.name ?? "Prism", version: "0.0.12" },
    }))
    .onRequest(methods.agent.session.new, async (context) => {
      const authorization = await options.authorize({ signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const binding = await options.sessionFactory({ authorization, signal: context.signal });
      if (sessions.has(binding.session.id)) throw new Error("ACP session already exists");
      sessions.set(binding.session.id, binding);
      return { sessionId: binding.session.id };
    })
    .onRequest(methods.agent.session.prompt, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const current = session(sessions, context.params.sessionId);
      if (current.controller) throw new Error("ACP session already has an active prompt");
      const prompt = textPrompt(context.params.prompt, limits.maxInputMessages, limits.maxInputTextBytes);
      const controller = abortOn(context.signal);
      current.controller = controller;
      try {
        await forward(current.session.stream(prompt, {
          ownership: authorization.ownership,
          redactor: options.redactor,
          signal: controller.signal,
          maxQueuedEvents: limits.maxQueuedEvents,
          overflow: "close",
        }), current, authorization, context.params.sessionId, context.client, controller.signal, { events: 0, bytes: 0 }, limits, options);
        return { stopReason: controller.signal.aborted ? "cancelled" : "end_turn" };
      } finally {
        current.controller = undefined;
      }
    })
    .onNotification(methods.agent.session.cancel, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (authorization) sessions.get(context.params.sessionId)?.controller?.abort(new Error("ACP session cancelled"));
    })
    .onRequest(methods.agent.session.close, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const current = sessions.get(context.params.sessionId);
      current?.controller?.abort(new Error("ACP session closed"));
      sessions.delete(context.params.sessionId);
    });
}

async function forward<Authorization extends AcpAuthorization>(
  source: AsyncIterable<AgentEvent>,
  current: ActiveSession,
  authorization: Authorization,
  sessionId: string,
  client: AgentContext,
  signal: AbortSignal,
  budget: AcpStreamBudget,
  limits: ReturnType<typeof resolveAgUiLimits>,
  options: CreatePrismAcpAgentOptions<Authorization>,
): Promise<void> {
  const mapper = createAcpEventMapper({ redactor: options.redactor, projection: options.projection, limits: options.limits });
  for await (const event of source) {
    for (const update of mapper.map(event)) await notify(client, sessionId, update, budget, limits);
    if (event.type !== "agent_suspended") continue;
    const response = await permission(client, sessionId, event, budget, limits);
    const decision = decisionFor(response);
    await forward(options.lifecycle.resumeStream(
      { sessionId: event.sessionId, runId: event.runId },
      { decision, expectedVersion: event.version },
      { ownership: authorization.ownership, agentId: current.agentId, signal, overflow: "close" },
    ), current, authorization, sessionId, client, signal, budget, limits, options);
    return;
  }
}

function session(sessions: ReadonlyMap<string, ActiveSession>, id: string): ActiveSession {
  const value = sessions.get(id);
  if (!value) throw new Error("Unknown ACP session");
  return value;
}

function textPrompt(prompt: readonly { readonly type: string; readonly text?: string }[], maxBlocks: number, maxBytes: number): string {
  if (prompt.length === 0 || prompt.length > maxBlocks || prompt.some((block) => block.type !== "text" || typeof block.text !== "string")) throw new Error("ACP prompt must contain only text blocks");
  const text = prompt.map((block) => block.text!).join("");
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("ACP prompt exceeds configured limit");
  return text;
}

async function notify(client: AgentContext, sessionId: string, update: SessionUpdate, budget: AcpStreamBudget, limits: ReturnType<typeof resolveAgUiLimits>): Promise<void> {
  const bytes = Buffer.byteLength(JSON.stringify({ sessionId, update }), "utf8");
  if (bytes > limits.maxEventBytes || ++budget.events > limits.maxStreamEvents || (budget.bytes += bytes) > limits.maxStreamBytes) throw new Error("ACP update limit exceeded");
  await client.notify(methods.client.session.update, { sessionId, update });
}

async function permission(client: AgentContext, sessionId: string, event: Extract<AgentEvent, { readonly type: "agent_suspended" }>, budget: AcpStreamBudget, limits: ReturnType<typeof resolveAgUiLimits>): Promise<RequestPermissionResponse> {
  const toolCallId = truncate(event.interruption.toolCallId ?? `prism:${event.runId}:${event.version}`, limits.maxTextBytes);
  await notify(client, sessionId, { sessionUpdate: "tool_call", toolCallId, title: "Approval required", kind: "other", status: "pending" }, budget, limits);
  try {
    return await client.request(methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId, title: "Approval required", kind: "other", status: "pending" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
  } catch {
    return { outcome: { outcome: "cancelled" } };
  }
}

function decisionFor(response: RequestPermissionResponse): "approve" | "deny" {
  return response.outcome.outcome === "selected" && response.outcome.optionId === "allow-once" ? "approve" : "deny";
}

function abortOn(source: AbortSignal): AbortController {
  const controller = new AbortController();
  if (source.aborted) controller.abort(source.reason);
  else source.addEventListener("abort", () => controller.abort(source.reason), { once: true });
  return controller;
}

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let out = "";
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
}
