/** forward-notify (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */

import type { AgentContext, SessionUpdate } from "@agentclientprotocol/sdk";
import { methods } from "@agentclientprotocol/sdk";
import type { AgentEvent, AgentFinishReason, ToolKind } from "@arnilo/prism";
import { resolveAgUiLimits } from "../../limits.js";
import type { ResolvedAcpClientCapabilities } from "../capabilities.js";
import { AcpError } from "../errors.js";
import { createAcpEventMapper } from "../mapper.js";
import type { AcpPromptResult } from "../prompt.js";
import { decisionFor } from "./decision.js";
import { decisionForElicitation, elicit, permission } from "./permission-elicit.js";
import type { AcpAuthorization, AcpStreamBudget, ActiveSession, CreatePrismAcpAgentOptions, ElicitationPendingDecision } from "./types.js";

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
): Promise<AgentFinishReason | undefined> {
  const budget = current.budget ?? { events: 0, bytes: 0 };
  // F4: captured from the terminal agent_finished event; the prompt handler maps it to StopReason.
  let finishReason: AgentFinishReason | undefined;
  // B4: explicit tool kinds from the session's registry beat the name heuristic.
  const toolKinds = new Map(
    current.tools
      ?.list()
      .map((tool) => [tool.name, tool.kind] as const)
      .filter((entry): entry is readonly [string, ToolKind] => entry[1] !== undefined),
  );
  const mapper = createAcpEventMapper({
    redactor: options.redactor,
    projection: options.projection,
    limits: options.limits,
    usage: options.capabilities?.usage,
    signal,
    toolKinds,
  });
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
      // B2: a terminal run-level error fails the prompt request (JSON-RPC error on the
      // session/prompt response) instead of a fake "Agent error:" transcript chunk.
      // Retryable provider-turn failures never reach here: they surface as
      // provider_turn_finished-with-error and the run may recover; a fatal run ends
      // with a terminal `error` event (session.ts run() catch path).
      if (event.type === "error") {
        const message = options.redactor?.redact(event.error.message) ?? event.error.message;
        // The code is prefixed so clients can distinguish run failures over the wire
        // (the SDK surfaces handler throws as -32603 with the message in data.details).
        throw new AcpError("ERR_PRISM_ACP_RUN", `ERR_PRISM_ACP_RUN: ${truncateBytes(message, 8 * 1024)}`);
      }
      if (event.type === "agent_denied") {
        announce({
          runId: event.runId,
          sessionId: event.sessionId,
          status: "terminal",
          version: event.version,
          updatedAt: new Date().toISOString(),
        });
        continue;
      }
      if (event.type === "agent_finished") {
        finishReason = event.finishReason;
        announce({ runId: event.runId, sessionId: event.sessionId, status: "terminal", updatedAt: new Date().toISOString() });
        continue;
      }
      if (event.type !== "agent_suspended") continue;
      announce({
        runId: event.runId,
        sessionId: event.sessionId,
        status: "suspended",
        version: event.version,
        updatedAt: new Date().toISOString(),
      });
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
      // F4: propagate the resumed run's finish reason to the original prompt response.
      return await forward(
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
    }
  } catch (error) {
    if (lastRef) {
      announce({ runId: lastRef.runId, sessionId: lastRef.sessionId, status: "terminal", updatedAt: new Date().toISOString() });
    }
    throw error;
  }
  return finishReason;
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

function truncateBytes(value: string, maxBytes: number): string {
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
