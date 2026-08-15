/** forward-notify (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
import type { AcpPromptResult } from "../prompt.js";
import type { AgentContext, SessionUpdate } from "@agentclientprotocol/sdk";
import { methods } from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@arnilo/prism";
import type { ResolvedAcpClientCapabilities } from "../capabilities.js";
import { createAcpEventMapper } from "../mapper.js";
import { resolveAgUiLimits } from "../../limits.js";
import type { AcpAuthorization, AcpStreamBudget, ActiveSession, CreatePrismAcpAgentOptions, ElicitationPendingDecision } from "./types.js";
import { decisionFor } from "./decision.js";
import { decisionForElicitation, elicit, permission } from "./permission-elicit.js";

export async function forward<Authorization extends AcpAuthorization>(
  source: AsyncIterable<AgentEvent>,
  current: ActiveSession,
  authorization: Authorization,
  sessionId: string,
  client: AgentContext,
  signal: AbortSignal,
  limits: ReturnType<typeof resolveAgUiLimits>,
  options: CreatePrismAcpAgentOptions<Authorization>,
  clientCapabilities: ResolvedAcpClientCapabilities,
  onRunRef?: (ref: import("../session-store.js").PersistedAcpRunRef) => void,
): Promise<void> {
  const budget = current.budget ?? { events: 0, bytes: 0 };
  const mapper = createAcpEventMapper({ redactor: options.redactor, projection: options.projection, limits: options.limits });
  let lastRef: import("../session-store.js").PersistedAcpRunRef | undefined;
  const announce = (ref: import("../session-store.js").PersistedAcpRunRef): void => {
    lastRef = ref;
    onRunRef?.(ref);
  };
  try {
    for await (const event of source) {
      if (!lastRef && "runId" in event && typeof event.runId === "string" && typeof event.sessionId === "string") {
        announce({ runId: event.runId, sessionId: event.sessionId, status: "running", updatedAt: new Date().toISOString() });
      }
      for (const update of await mapper.map(event)) await notify(client, sessionId, update, budget, limits);
      if (event.type === "agent_denied") {
        announce({ runId: event.runId, sessionId: event.sessionId, status: "terminal", version: event.version, updatedAt: new Date().toISOString() });
        continue;
      }
      if (event.type === "agent_finished") {
        announce({ runId: event.runId, sessionId: event.sessionId, status: "terminal", updatedAt: new Date().toISOString() });
        continue;
      }
      if (event.type !== "agent_suspended") continue;
      announce({ runId: event.runId, sessionId: event.sessionId, status: "suspended", version: event.version, updatedAt: new Date().toISOString() });
      const pending = event.interruption.pendingDecisions ?? [];
    const elicitations = pending.filter((decision): decision is ElicitationPendingDecision => decision.kind === "elicitation");
    const approvals = pending.filter((decision) => decision.kind === "tool_approval");
    if (elicitations.length > 0 && clientCapabilities.elicitation && approvals.length === 0) {
      // Elicitation batch: one form elicitation per pending decision; accept carries the
      // typed payload, decline/cancel deny (parity). Mixed batches stay on the shared path.
      const responses = await Promise.all(elicitations.map((decision) => elicit(client, sessionId, event, decision, budget, limits)));
      const decision = decisionForElicitation(responses, elicitations);
      await forward(
        options.lifecycle.resumeStream(
          { sessionId: event.sessionId, runId: event.runId },
          { ...decision, expectedVersion: event.version },
          { ownership: authorization.ownership, agentId: current.agentId, signal, overflow: "close" },
        ),
        current,
        authorization,
        sessionId,
        client,
        signal,
        limits,
        options,
        clientCapabilities,
        onRunRef,
      );
      return;
    }
    const response = await permission(client, sessionId, event, budget, limits);
    const decision = decisionFor(response, event.interruption);
    await forward(
      options.lifecycle.resumeStream(
        { sessionId: event.sessionId, runId: event.runId },
        { ...decision, expectedVersion: event.version },
        { ownership: authorization.ownership, agentId: current.agentId, signal, overflow: "close" },
      ),
      current,
      authorization,
      sessionId,
      client,
      signal,
      limits,
      options,
      clientCapabilities,
      onRunRef,
    );
    return;
    }
  } catch (error) {
    if (lastRef) {
      announce({ runId: lastRef.runId, sessionId: lastRef.sessionId, status: "terminal", updatedAt: new Date().toISOString() });
    }
    throw error;
  }
}

export function toPrismPrompt(projected: AcpPromptResult): import("@arnilo/prism").Message {
  const content: import("@arnilo/prism").ContentBlock[] = [{ type: "text", text: projected.text }];
  for (const part of projected.media ?? []) {
    if (part.type === "image")
      content.push({ type: "image", mimeType: part.mediaType, data: part.data, ...(part.name ? { name: part.name } : {}) });
    else if (part.type === "audio")
      content.push({ type: "audio", mediaType: part.mediaType, data: part.data, ...(part.name ? { name: part.name } : {}) });
    else content.push({ type: "file", mediaType: part.mediaType, data: part.data, ...(part.name ? { name: part.name } : {}) });
  }
  return { role: "user", content };
}

export async function notify(
  client: AgentContext,
  sessionId: string,
  update: SessionUpdate,
  budget: AcpStreamBudget,
  limits: ReturnType<typeof resolveAgUiLimits>,
): Promise<void> {
  const bytes = Buffer.byteLength(JSON.stringify({ sessionId, update }), "utf8");
  if (bytes > limits.maxEventBytes || ++budget.events > limits.maxStreamEvents || (budget.bytes += bytes) > limits.maxStreamBytes)
    throw new Error("ACP update limit exceeded");
  await client.notify(methods.client.session.update, { sessionId, update });
}
