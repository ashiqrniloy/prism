import type { DelegatedAgentStep, DelegatedAgentStepKind, DelegatedAgentStepUsage } from "./contracts-protocol.js";

export const MAX_DELEGATED_AGENT_EVENT_BYTES = 64 * 1024;
export const MAX_DELEGATED_AGENT_ID_BYTES = 512;
export const MAX_DELEGATED_AGENT_NAME_BYTES = 256;
export const MAX_DELEGATED_AGENT_STEP_INDEX = 1_000_000;
export const MAX_DELEGATED_AGENT_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_DELEGATED_AGENT_TOKEN_COUNT = 1_000_000_000_000;

export interface DelegatedAgentStepInput extends Omit<DelegatedAgentStep, "type" | "kind" | "state"> {
  readonly kind: string;
  readonly state: string;
}

export class DelegatedAgentStepError extends Error {
  readonly code = "ERR_PRISM_DELEGATED_AGENT_STEP";

  constructor(message: string) {
    super(message);
    this.name = "DelegatedAgentStepError";
  }
}

/**
 * Builds the only safe core shape for delegated timeline metadata. Unknown step
 * kinds become `unknown`; unbounded or malformed identity/counter fields fail closed.
 */
export function createDelegatedAgentStep(input: DelegatedAgentStepInput): DelegatedAgentStep {
  if (!input || typeof input !== "object") throw invalid("event");
  const state = input.state;
  if (state !== "active" && state !== "done" && state !== "error") throw invalid("state");
  const kind = normalizeKind(input.kind);
  if (!Number.isSafeInteger(input.stepIndex) || input.stepIndex < 0 || input.stepIndex > MAX_DELEGATED_AGENT_STEP_INDEX) {
    throw invalid("stepIndex");
  }

  const event: DelegatedAgentStep = {
    type: "delegated_agent_step",
    sessionId: boundedText(input.sessionId, "sessionId", MAX_DELEGATED_AGENT_ID_BYTES),
    runId: boundedText(input.runId, "runId", MAX_DELEGATED_AGENT_ID_BYTES),
    adapterId: boundedText(input.adapterId, "adapterId", MAX_DELEGATED_AGENT_ID_BYTES),
    externalConversationId: boundedText(input.externalConversationId, "externalConversationId", MAX_DELEGATED_AGENT_ID_BYTES),
    stepIndex: input.stepIndex,
    state,
    kind,
    ...(input.durationMs === undefined
      ? {}
      : { durationMs: boundedNumber(input.durationMs, "durationMs", MAX_DELEGATED_AGENT_DURATION_MS) }),
    ...(input.usage === undefined ? {} : { usage: normalizeUsage(input.usage) }),
    ...(input.toolName === undefined ? {} : { toolName: boundedText(input.toolName, "toolName", MAX_DELEGATED_AGENT_NAME_BYTES) }),
    ...(input.subagentType === undefined
      ? {}
      : { subagentType: boundedText(input.subagentType, "subagentType", MAX_DELEGATED_AGENT_NAME_BYTES) }),
    ...(input.detail === undefined ? {} : { detail: normalizeDetail(input.detail) }),
  };

  if (utf8Bytes(JSON.stringify(event)) > MAX_DELEGATED_AGENT_EVENT_BYTES) throw invalid("event bytes");
  return event;
}

function normalizeKind(value: unknown): DelegatedAgentStepKind {
  return value === "assistant" || value === "tool" || value === "subagent" || value === "checkpoint" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeUsage(value: DelegatedAgentStepUsage): DelegatedAgentStepUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("usage");
  const output: Record<string, number> = {};
  for (const key of ["inputTokens", "outputTokens", "thinkingTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"]) {
    const amount = value[key as keyof DelegatedAgentStepUsage];
    if (amount === undefined) continue;
    output[key] = boundedNumber(amount, key, MAX_DELEGATED_AGENT_TOKEN_COUNT);
  }
  return output;
}

function normalizeDetail(value: DelegatedAgentStep["detail"]): DelegatedAgentStep["detail"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("detail");
  const referenceId =
    value.referenceId === undefined ? undefined : boundedOpaque(value.referenceId, "detail.referenceId", MAX_DELEGATED_AGENT_ID_BYTES);
  const label = value.label === undefined ? undefined : boundedText(value.label, "detail.label", MAX_DELEGATED_AGENT_NAME_BYTES);
  return {
    ...(referenceId === undefined ? {} : { referenceId }),
    ...(label === undefined ? {} : { label }),
  };
}

function boundedText(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value) || utf8Bytes(value) > maxBytes) throw invalid(name);
  return value;
}

function boundedOpaque(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== "string" || /[\\/:]/.test(value)) throw invalid(name);
  return boundedText(value, name, maxBytes);
}

function boundedNumber(value: unknown, name: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw invalid(name);
  return value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalid(field: string): DelegatedAgentStepError {
  return new DelegatedAgentStepError(`Invalid delegated agent step ${field}`);
}
