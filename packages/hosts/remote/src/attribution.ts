import type { AgentEvent, EventOrigin } from "@arnilo/prism";

export interface AttributionSource {
  /** The remote agent's name and id (from `initialize`). */
  readonly agent: string;
  readonly agentId: string;
  /** The endpoint id stamped as `origin.remote`. */
  readonly endpointId: string;
}

/**
 * The merge rule (plan 170 Task 1 (g)). An event with no `origin` gains the remote agent's. An event with an
 * `origin` keeps it and gains `remote` only when it has none, so the innermost endpoint wins. Every `tool.*`
 * event is `executedBy: "external"`: the remote ran it, so no local `tool.call` hook ever saw it.
 */
export function attribute(event: AgentEvent, source: AttributionSource): AgentEvent {
  const existing = event.origin;
  const origin: EventOrigin = existing
    ? { ...existing, ...(existing.remote === undefined ? { remote: source.endpointId } : {}) }
    : { kind: "prism", agent: source.agent, agentId: source.agentId, remote: source.endpointId, depth: 0 };
  return { ...event, origin: event.type.startsWith("tool.") ? { ...origin, executedBy: "external" } : origin } as AgentEvent;
}
