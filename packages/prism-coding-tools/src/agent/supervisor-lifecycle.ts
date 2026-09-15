import { createDelegatedAgentStep, type DelegatedAgentStep } from "@arnilo/prism";
import type { Supervisor, SupervisorEvent } from "@arnilo/prism-core/runtime/supervisor";
import type { CodingLifecycleEvent } from "./lifecycle.js";

export interface ObserveSupervisorLifecycleOptions {
  /** Receives redacted coding lifecycle events. Throwing does not stop observation. */
  readonly onEvent: (event: CodingLifecycleEvent) => unknown;
  /** Optional AG-UI bridge; pass emitted steps to `createAgUiEventMapper().map()`. */
  readonly delegatedAgentStep?: {
    readonly sessionId: string;
    readonly runId: string;
    readonly adapterId: string;
    readonly externalConversationId: string;
    readonly onEvent: (event: DelegatedAgentStep) => unknown;
  };
}

/** Bridges supervisor milestones into coding lifecycle and optional AG-UI activity events. */
export function observeSupervisorLifecycle(
  supervisor: Pick<Supervisor, "redact" | "subscribe">,
  options: ObserveSupervisorLifecycleOptions,
): () => void {
  const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
  let stopped = false;
  let stepIndex = 0;

  void (async () => {
    try {
      while (!stopped) {
        const next = await iterator.next();
        if (stopped || next.done) break;
        const event = lifecycleEvent(supervisor, next.value);
        if (!event) continue;
        try {
          options.onEvent(event);
        } catch {
          // Lifecycle consumers are advisory.
        }
        const ui = options.delegatedAgentStep;
        if (!ui) continue;
        try {
          ui.onEvent(
            createDelegatedAgentStep({
              sessionId: ui.sessionId,
              runId: ui.runId,
              adapterId: ui.adapterId,
              externalConversationId: ui.externalConversationId,
              stepIndex: stepIndex++,
              state: event.type === "subagent_started" ? "active" : event.status === "succeeded" ? "done" : "error",
              kind: "subagent",
              subagentType: event.childId,
              ...(event.type === "subagent_stopped" ? { detail: { label: event.status } } : {}),
            }),
          );
        } catch {
          // UI projection is advisory and must not stop coding lifecycle delivery.
        }
      }
    } catch {
      // Supervisor subscription is advisory and ends silently.
    }
  })();

  return () => {
    if (stopped) return;
    stopped = true;
    void iterator.return?.();
  };
}

function lifecycleEvent(
  supervisor: Pick<Supervisor, "redact">,
  event: SupervisorEvent,
): Extract<CodingLifecycleEvent, { readonly type: "subagent_started" | "subagent_stopped" }> | undefined {
  const source = {
    childId: supervisor.redact(event.childId),
    delegationId: supervisor.redact(event.delegationId),
    depth: event.depth,
  };
  switch (event.type) {
    case "delegation_started":
      return { type: "subagent_started", ...source };
    case "delegation_finished":
      return { type: "subagent_stopped", ...source, status: event.status };
    case "delegation_rejected":
      return { type: "subagent_stopped", ...source, status: "denied" };
    case "delegation_error":
      return { type: "subagent_stopped", ...source, status: "failed" };
    default:
      return undefined;
  }
}
