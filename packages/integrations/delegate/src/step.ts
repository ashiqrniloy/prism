import type { EventOrigin, JsonValue } from "@arnilo/prism";

export const MAX_DELEGATE_STEP_BYTES = 4 * 1024;
export const MAX_DELEGATE_ID_BYTES = 256;
export type DelegateStepPhase = "started" | "milestone" | "finished" | "error";

export interface DelegateStepInput {
  readonly origin: EventOrigin;
  readonly phase: DelegateStepPhase;
  readonly turn?: number;
  readonly status?: string;
  readonly totalTokens?: number;
}

export class DelegateStepError extends Error {
  readonly code = "ERR_PRISM_DELEGATE_STEP";
  constructor(field: string) {
    super(`Invalid delegate step ${field}`);
    this.name = "DelegateStepError";
  }
}

/** Builds the bounded `delegate.step` payload: ids and counters only, never input, output, or arguments. */
export function delegateStepData(input: DelegateStepInput): JsonValue {
  const data: Record<string, JsonValue> = {
    origin: originRecord(input.origin),
    phase: input.phase,
  };
  if (input.phase !== "started" && input.phase !== "milestone" && input.phase !== "finished" && input.phase !== "error") {
    throw new DelegateStepError("phase");
  }
  if (input.turn !== undefined) data.turn = count(input.turn, "turn");
  if (input.status !== undefined) data.status = text(input.status, "status");
  if (input.totalTokens !== undefined) data.totalTokens = count(input.totalTokens, "totalTokens");
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_DELEGATE_STEP_BYTES) throw new DelegateStepError("bytes");
  return data;
}

function text(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /[\0\r\n]/.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_DELEGATE_ID_BYTES
  ) {
    throw new DelegateStepError(field);
  }
  return value;
}

// The child's origin (K3): `agent` is the configured child name and `agentId` the child agent's id, so a
// UI routes a child's activity with the same code it uses for a vendor agent. Bounded like every other id.
function originRecord(origin: EventOrigin): JsonValue {
  const out: Record<string, JsonValue> = {
    kind: text(origin.kind, "origin"),
    agent: text(origin.agent, "origin"),
    agentId: text(origin.agentId, "origin"),
    depth: count(origin.depth, "origin"),
  };
  if (origin.delegationId !== undefined) out.delegationId = text(origin.delegationId, "origin");
  if (origin.remote !== undefined) out.remote = text(origin.remote, "origin");
  if (origin.executedBy !== undefined) out.executedBy = text(origin.executedBy, "origin");
  return out;
}

function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000)
    throw new DelegateStepError(field);
  return value;
}
