import type { AgentEvent, Decision, HostUiRequest, HostUiResponse, JsonObject, PendingDecision, Session } from "@arnilo/prism";
import type { ResumeAuthority } from "./authority.js";
import { HeadlessError } from "./errors.js";
import { pendingDecisionsOf } from "./pending.js";

export type ResumeWhenAnsweredResult =
  | { readonly status: "resumed"; readonly events: AsyncIterable<AgentEvent> }
  | { readonly status: "aborted" | "already_resolved" | "unavailable" };

export interface ResumeWhenAnsweredOptions {
  readonly signal?: AbortSignal;
}

/** Select only a single required enum property; complex object schemas use JSON input. */
function requestFor(sessionId: string, pending: PendingDecision): { request: HostUiRequest; property?: string } {
  if (pending.kind !== "elicitation") return { request: { kind: "confirm", sessionId, title: pending.reason } };
  const schema = pending.elicitationSchema;
  const required = schema?.required;
  const properties = schema?.properties;
  if (
    Array.isArray(required) &&
    required.length === 1 &&
    typeof required[0] === "string" &&
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    Object.keys(properties).length === 1
  ) {
    const property = required[0];
    const field = properties[property];
    if (
      field &&
      typeof field === "object" &&
      !Array.isArray(field) &&
      Array.isArray(field.enum) &&
      field.enum.length > 0 &&
      field.enum.every((value) => typeof value === "string")
    ) {
      return {
        property,
        request: { kind: "select", sessionId, title: pending.reason, options: field.enum.map((value) => ({ value: value as string })) },
      };
    }
  }
  return { request: { kind: "input", sessionId, title: pending.reason, ...(schema ? { detail: JSON.stringify(schema) } : {}) } };
}

function decisionFrom(pending: PendingDecision, answer: HostUiResponse, route: string, property?: string): Decision | undefined {
  if (answer.status === "dismissed") return { approvalId: pending.approvalId, outcome: "reject_once", reason: `dismissed via ${route}` };
  if (answer.status !== "answered") return;
  if (pending.kind !== "elicitation") {
    if (typeof answer.value !== "boolean") return;
    return { approvalId: pending.approvalId, outcome: answer.value ? "allow_once" : "reject_once" };
  }
  if (typeof answer.value !== "string") return;
  let value: unknown;
  try {
    value = property ? { [property]: answer.value } : JSON.parse(answer.value);
  } catch {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  return { approvalId: pending.approvalId, outcome: "allow_once", elicitation: value as JsonObject };
}

export async function resumeWhenAnswered(
  authority: ResumeAuthority,
  supplied: Pick<Session, "id">,
  pending: readonly PendingDecision[] | undefined,
  options: ResumeWhenAnsweredOptions,
  offer: (
    request: HostUiRequest,
    approvalId: string,
    signal?: AbortSignal,
    accept?: (answer: HostUiResponse, route: string) => boolean,
  ) => Promise<{ answer: HostUiResponse; route: string } | undefined>,
): Promise<ResumeWhenAnsweredResult> {
  const signal = options.signal;
  if (signal?.aborted) return { status: "aborted" };
  const session = await authority.session(supplied.id);
  const current = pendingDecisionsOf(await session.entries());
  if (!current.length) return { status: "already_resolved" };
  // Caller-provided descriptors never supply prompts or schemas; they must match this suspension.
  if (pending && (pending.length !== current.length || pending.some((item, i) => item.approvalId !== current[i]?.approvalId)))
    throw new HeadlessError("stale_decisions");
  const decisions: Decision[] = [];
  for (const item of current) {
    const { request, property } = requestFor(session.id, item);
    const response = await offer(
      request,
      item.approvalId,
      signal,
      (answer, route) => decisionFrom(item, answer, route, property) !== undefined,
    );
    if (signal?.aborted) return { status: "aborted" };
    if (!response) return { status: "unavailable" };
    const decision = decisionFrom(item, response.answer, response.route, property);
    if (!decision) return { status: "unavailable" };
    decisions.push(decision);
  }
  if (signal?.aborted) return { status: "aborted" };
  return { status: "resumed", events: authority.resume(session.id, decisions, { signal }) };
}
