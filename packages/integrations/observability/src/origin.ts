import type { EventOrigin } from "@arnilo/prism";

/** Span attribute names for `AgentEvent.origin` (roadmap §2.12.15). One constant, no vendor-specific names. */
export const ORIGIN_ATTRIBUTES = {
  agent: "prism.origin.agent",
  vendor: "prism.origin.vendor",
  profile: "prism.origin.profile",
  executedBy: "prism.origin.executed_by",
  delegationId: "prism.origin.delegation_id",
  subagentId: "prism.origin.subagent_id",
} as const;

const MAX_VALUE = 128;
// A profile is a name: no separators, home markers, or whitespace, so a path or free text never becomes an attribute.
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

const bounded = (value: string | undefined) => (value ? value.slice(0, MAX_VALUE) : undefined);

/** Bounded scalar attributes for an event's origin; empty when the event has none. */
export function originAttributes(origin: EventOrigin | undefined): Record<string, string> {
  if (!origin) return {};
  const out: Record<string, string> = {};
  const set = (name: string, value: string | undefined) => {
    if (value) out[name] = value;
  };
  set(ORIGIN_ATTRIBUTES.agent, bounded(origin.agent));
  set(ORIGIN_ATTRIBUTES.vendor, bounded(origin.vendor));
  set(ORIGIN_ATTRIBUTES.profile, origin.profile && PROFILE_NAME.test(origin.profile) ? origin.profile : undefined);
  set(ORIGIN_ATTRIBUTES.executedBy, origin.executedBy ?? (origin.kind === "external" ? "external" : "prism"));
  set(ORIGIN_ATTRIBUTES.delegationId, bounded(origin.delegationId));
  set(ORIGIN_ATTRIBUTES.subagentId, bounded(origin.subagentId));
  return out;
}
