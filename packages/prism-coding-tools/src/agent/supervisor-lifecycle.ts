import { createDelegatedAgentStep, type DelegatedAgentStep } from "@arnilo/prism";
import type { Supervisor, SupervisorEvent } from "@arnilo/prism-core/runtime/supervisor";
import { DEFAULT_LIFECYCLE_MAX_REASON_BYTES, type CodingLifecycleEvent, type SubagentFailure, type SubagentRecovery } from "./lifecycle.js";

/** Pending `child_failed` entries kept until the matching stop; oldest dropped at the bound. */
const MAX_PENDING_FAILURES = 64;

/** Supervisor surface the bridge uses; `summary` stays optional so minimal sources keep working. */
type SupervisorLifecycleSource = Pick<Supervisor, "redact" | "subscribe"> & {
  readonly summary?: Supervisor["summary"];
};

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
  /**
   * Attach redacted `failure` attribution (reason, run-limit axis, stop reason) to the
   * `subagent_stopped` an error produced. Default off: with it off no delegation error text crosses
   * this bridge. `delegation_finished` and `delegation_rejected` never carry it.
   */
  readonly includeFailure?: boolean;
  /**
   * Attach per-child `recovery` counters read from `summary()` to every `subagent_stopped`. Default
   * off; a source without `summary()` omits the field instead of throwing.
   */
  readonly includeRecovery?: boolean;
}

/** Bridges supervisor milestones into coding lifecycle and optional AG-UI activity events. */
export function observeSupervisorLifecycle(supervisor: SupervisorLifecycleSource, options: ObserveSupervisorLifecycleOptions): () => void {
  const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
  const pendingFailures = new Map<string, SubagentFailure>();
  let stopped = false;
  let stepIndex = 0;

  void (async () => {
    try {
      while (!stopped) {
        const next = await iterator.next();
        if (stopped || next.done) break;
        const supervisorEvent = next.value;
        if (supervisorEvent.type === "child_failed") {
          if (options.includeFailure === true) rememberFailure(pendingFailures, supervisorEvent);
          continue;
        }
        const terminal = isTerminalEvent(supervisorEvent);
        const event = lifecycleEvent(
          supervisor,
          supervisorEvent,
          terminal && options.includeFailure === true && supervisorEvent.type === "delegation_error"
            ? pendingFailures.get(supervisorEvent.delegationId)
            : undefined,
          terminal && options.includeRecovery === true ? recoveryFor(supervisor, supervisorEvent.childId) : undefined,
        );
        if (!event) continue;
        if (terminal) pendingFailures.delete(supervisorEvent.delegationId);
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

function isTerminalEvent(event: SupervisorEvent): boolean {
  return event.type === "delegation_finished" || event.type === "delegation_rejected" || event.type === "delegation_error";
}

/** O(1) insert/delete; over the bound the oldest pending failure is dropped. */
function rememberFailure(pending: Map<string, SubagentFailure>, event: Extract<SupervisorEvent, { readonly type: "child_failed" }>): void {
  pending.delete(event.delegationId);
  pending.set(event.delegationId, {
    reason: truncateReason(event.reason),
    ...(event.limit ? { limit: event.limit.limit } : {}),
    ...(event.stopReason ? { stopReason: event.stopReason } : {}),
  });
  if (pending.size > MAX_PENDING_FAILURES) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
}

/** Byte-bounded at insert; the reason is redacted at the supervisor boundary, so only the cap applies. */
function truncateReason(reason: string): string {
  if (Buffer.byteLength(reason, "utf8") <= DEFAULT_LIFECYCLE_MAX_REASON_BYTES) return reason;
  let end = Math.min(reason.length, DEFAULT_LIFECYCLE_MAX_REASON_BYTES);
  while (end > 0 && Buffer.byteLength(reason.slice(0, end), "utf8") > DEFAULT_LIFECYCLE_MAX_REASON_BYTES) end -= 1;
  return reason.slice(0, end);
}

function recoveryFor(supervisor: SupervisorLifecycleSource, childId: string): SubagentRecovery | undefined {
  const summary = supervisor.summary;
  if (!summary) return undefined;
  try {
    const row = summary.call(supervisor).children.find((child) => child.childId === childId);
    if (!row) return undefined;
    return {
      attempts: row.attempts,
      retries: row.retries,
      failures: row.failures,
      failureRadius: row.failureRadius,
      outcome: row.outcome,
    };
  } catch {
    // Recovery counters are advisory; a broken source omits the field instead of ending observation.
    return undefined;
  }
}

function lifecycleEvent(
  supervisor: SupervisorLifecycleSource,
  event: SupervisorEvent,
  failure?: SubagentFailure,
  recovery?: SubagentRecovery,
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
      return { type: "subagent_stopped", ...source, status: event.status, ...(recovery ? { recovery } : {}) };
    case "delegation_rejected":
      return { type: "subagent_stopped", ...source, status: "denied", ...(recovery ? { recovery } : {}) };
    case "delegation_error":
      return {
        type: "subagent_stopped",
        ...source,
        status: "failed",
        ...(failure ? { failure } : {}),
        ...(recovery ? { recovery } : {}),
      };
    default:
      return undefined;
  }
}
