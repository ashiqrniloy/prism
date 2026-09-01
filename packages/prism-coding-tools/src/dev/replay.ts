/**
 * Durable replay paging (plan 040 Task 2): a thin, read-only page over the
 * host `AgentEventSource` using the server package's
 * `createPrismAgentEventReplay` seam. Never executes a run — no session is
 * created and no provider is consulted; only stored events are paged, inside
 * the source's own bounds (page size, cursor bytes). Authorization is
 * consulted exactly like the server's SSE events route (`agent.events`
 * operation) and supplies the ownership every page is scoped by; foreign
 * ownership is refused by the source itself (fail closed).
 */

import { type AgentRunRef, assertIdentityActive, assertIdentityMatchesOwnership, type SecretRedactor } from "@arnilo/prism";
import {
  type PrismAgentEventReplay,
  type PrismAgentEventResolutionInput,
  type PrismServerAuthorizer,
  PrismServerError,
} from "@arnilo/prism-core/runtime/server";

export interface DevReplaySeams {
  /** `createPrismAgentEventReplay` over the host event source (server seam). */
  readonly replay: PrismAgentEventReplay;
  /** Resolves the public run selector to internal IDs (same callback wired into the handler). */
  readonly resolveRun: (input: PrismAgentEventResolutionInput) => AgentRunRef | undefined | Promise<AgentRunRef | undefined>;
  /** Same authorizer the underlying handler uses; consulted for every replay page. */
  readonly authorize: PrismServerAuthorizer;
  /** Capability id of the inspected agent exposure. */
  readonly capabilityId: string;
  /** Host redactor; applied on send like the SSE events route does. */
  readonly redactor?: SecretRedactor;
}

export async function replayRunPage(seams: DevReplaySeams, request: Request, runId: string, cursor: string | undefined): Promise<Response> {
  try {
    const authorization = await seams.authorize({
      request,
      operation: "agent.events",
      capabilityId: seams.capabilityId,
      signal: request.signal,
    });
    if (!authorization) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
    const { identity, ownership } = authorization;
    if (!ownership.tenantId) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
    if (identity) {
      assertIdentityActive(identity);
      assertIdentityMatchesOwnership(identity, ownership);
    }
    const run = await seams.resolveRun({ runId, authorization, signal: request.signal });
    if (!run?.sessionId) throw new PrismServerError("Run is unavailable", 404, "ERR_PRISM_SERVER_REPLAY");
    const page = await seams.replay.page({
      ownership: authorization.ownership,
      sessionId: run.sessionId,
      runId: run.runId,
      ...(cursor === undefined ? {} : { cursor }),
      signal: request.signal,
    });
    const redact = seams.redactor?.redact.bind(seams.redactor);
    const body = {
      items: redact
        ? page.items.map((envelope) => ({
            ...envelope,
            record: { ...envelope.record, event: redact(envelope.record.event) ?? envelope.record.event },
          }))
        : page.items,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      terminal: page.terminal,
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    if (error instanceof PrismServerError) {
      return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
        status: error.status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return new Response(JSON.stringify({ error: { code: "ERR_PRISM_SERVER", message: "Replay failed" } }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
