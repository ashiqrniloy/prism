import {
  type ApprovalOutcome,
  type Decision,
  HARD_MAX_PENDING_DECISIONS,
  type JsonObject,
  MAX_DECISION_REASON_BYTES,
  MAX_SESSION_LINK_ID_LENGTH,
  type Message,
  type OwnershipScope,
  type PendingDecision,
  type Principal,
  type ResolvedRunLimits,
  resolveRunLimits,
  type RunLimits,
  type RunOptions,
  type SessionListQuery,
  type SessionParentLink,
  type SteerOptions,
} from "@arnilo/prism";
import { RemoteError } from "./errors.js";
import type { RemoteRunOptions } from "./protocol.js";

export const MAX_APPROVAL_ID_LENGTH = 256;
export const MAX_SESSION_LIST_CURSOR_LENGTH = 512;

const RUN_OPTION_KEYS = new Set(["metadata", "limits", "interactive"]);
const DECISION_KEYS = new Set(["approvalId", "outcome", "reason", "elicitation"]);
const APPROVAL_OUTCOMES: ReadonlySet<ApprovalOutcome> = new Set(["allow_once", "allow_for_run", "reject_once", "reject_for_run"]);
const OWNERSHIP_KEYS = new Set(["tenantId", "accountId", "userId"]);
const SESSION_LIST_LINK_STRING_KEYS = ["agentId", "parentSessionId", "workflowRunId", "delegationId", "actorAgent"] as const;
const SESSION_LIST_QUERY_KEYS = new Set<string>(["cursor", "limit", "order", ...SESSION_LIST_LINK_STRING_KEYS, "actorKind"]);
const PARENT_LINK_KEYS = ["sessionId", "agentId", "workflowRunId", "delegationId"] as const;
const PARENT_LINK_KEY_SET = new Set<string>(PARENT_LINK_KEYS);

export const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

export function invalid(message: string): RemoteError {
  return new RemoteError("invalid_params", message);
}

export function str(params: JsonObject, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value === "") throw invalid(`${key} must be a non-empty string`);
  return value;
}

export function parseInput(value: unknown): string | Message | readonly Message[] {
  if (typeof value === "string" || isObject(value) || Array.isArray(value)) {
    return value as string | Message | readonly Message[];
  }
  throw invalid("input must be a string, a message, or a message list");
}

const NUMERIC_LIMIT_KEYS = [
  "maxTurns",
  "maxProviderAttempts",
  "maxToolRounds",
  "maxToolCalls",
  "maxRepeatedToolRounds",
  "maxWallTimeMs",
  "maxRequestBytes",
  "maxResponseBytes",
  "maxInputTokens",
  "maxOutputTokens",
  "maxTotalTokens",
  "maxContinuations",
  "maxToolTimeMs",
  "maxRunStateBytes",
] as const satisfies readonly (keyof RunLimits & keyof ResolvedRunLimits)[];
const WIRE_LIMIT_KEYS = new Set<string>([...NUMERIC_LIMIT_KEYS, "maxCost", "bufferOutput"]);

/**
 * A client's `limits` may only narrow the agent's resolved limits (plan 239 Task 5). The kernel lets a run layer
 * set an axis the agent left at its default, and `null` disables a cap, so the wire checks each axis against the
 * agent's own resolved value: `null`, an unknown axis, or a value above the agent's is `invalid_params`. The error
 * names the axis, never a value.
 */
export function narrowWireLimits(value: unknown, agentLimits: Readonly<ResolvedRunLimits>): RunLimits {
  if (!isObject(value)) throw invalid("limits must be an object");
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!WIRE_LIMIT_KEYS.has(key)) throw invalid(`limits.${key} is not allowed over the wire`);
    if (key === "bufferOutput") {
      if (typeof raw !== "boolean") throw invalid("limits.bufferOutput must be a boolean");
      // `true` at any layer wins, so a client can only make delivery stricter.
      out[key] = raw;
      continue;
    }
    if (key === "maxCost") {
      if (!isObject(raw) || typeof raw.amount !== "number" || !(raw.amount >= 0) || typeof raw.currency !== "string") {
        throw invalid("limits.maxCost must be { amount, currency }");
      }
      const agentCost = agentLimits.maxCost;
      if (agentCost && (raw.currency !== agentCost.currency || raw.amount > agentCost.amount)) {
        throw invalid("limits.maxCost may only narrow the agent's limit");
      }
      out[key] = { amount: raw.amount, currency: raw.currency };
      continue;
    }
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      throw invalid(`limits.${key} must be a non-negative safe integer; null is not allowed over the wire`);
    }
    const agentValue = agentLimits[key as (typeof NUMERIC_LIMIT_KEYS)[number]];
    if (typeof agentValue === "number" && raw > agentValue) throw invalid(`limits.${key} may only narrow the agent's limit`);
    out[key] = raw;
  }
  return out as RunLimits;
}

/** Wire `RunOptions` is an allow-list: a client never chooses `principal`, `ownership`, `redactor`, `signal`, … */
export function parseRunOptions(
  value: unknown,
  principal: Principal | undefined,
  ownership: OwnershipScope | undefined,
  agentLimits: Readonly<ResolvedRunLimits> = resolveRunLimits(),
): RunOptions {
  const identity: RunOptions = {
    ...(principal ? { principal } : {}),
    ...(ownership ? { ownership } : {}),
  };
  if (value === undefined) return identity;
  if (!isObject(value)) throw invalid("options must be an object");
  for (const key of Object.keys(value)) {
    if (!RUN_OPTION_KEYS.has(key)) throw invalid(`option ${key} is not allowed over the wire`);
  }
  const wire = value as RemoteRunOptions;
  if (wire.metadata !== undefined && !isObject(wire.metadata)) throw invalid("metadata must be an object");
  const limits = wire.limits === undefined ? undefined : narrowWireLimits(wire.limits, agentLimits);
  if (wire.interactive !== undefined && typeof wire.interactive !== "boolean") {
    throw invalid("interactive must be a boolean");
  }
  return {
    ...(wire.metadata ? { metadata: wire.metadata } : {}),
    ...(limits ? { limits } : {}),
    ...(wire.interactive !== undefined ? { interactive: wire.interactive } : {}),
    ...identity,
  };
}

export interface ParseDecisionsOptions {
  readonly allowModifiedArguments?: boolean;
  /** Most decisions one request carries: the agent's `ceilings.pendingDecisions`. Default 128. */
  readonly maxDecisions?: number;
  readonly pending?: readonly PendingDecision[];
}

function isApprovalOutcome(value: unknown): value is ApprovalOutcome {
  return typeof value === "string" && APPROVAL_OUTCOMES.has(value as ApprovalOutcome);
}

/**
 * Validates and constructs `Decision` items from wire input. Only `approvalId` (≤ 256 chars), `outcome`
 * (one of the four `ApprovalOutcome` values), `reason` (≤ 2 KiB), and `elicitation` (JSON object, only for
 * pending elicitation decisions) are accepted by default; `modifiedArguments` requires `allowModifiedArguments: true`.
 */
export function parseDecisions(value: unknown, options: ParseDecisionsOptions = {}): readonly Decision[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid("decisions must be a non-empty list");
  const maxDecisions = options.maxDecisions ?? HARD_MAX_PENDING_DECISIONS;
  if (value.length > maxDecisions) throw invalid(`decisions must contain at most ${maxDecisions} items`);
  const pendingById = options.pending ? new Map(options.pending.map((item) => [item.approvalId, item])) : undefined;
  const out: Decision[] = [];
  for (const item of value) {
    if (!isObject(item)) throw invalid("malformed decision");
    for (const key of Object.keys(item)) {
      if (key === "modifiedArguments") {
        if (options.allowModifiedArguments !== true) {
          throw invalid("modifiedArguments is not allowed over the wire unless allowModifiedArguments is enabled");
        }
        continue;
      }
      if (!DECISION_KEYS.has(key)) {
        throw invalid(`decision field ${key} is not allowed over the wire`);
      }
    }
    if (typeof item.approvalId !== "string" || item.approvalId.length === 0 || item.approvalId.length > MAX_APPROVAL_ID_LENGTH) {
      throw invalid(`approvalId must be a non-empty string of at most ${MAX_APPROVAL_ID_LENGTH} characters`);
    }
    if (!isApprovalOutcome(item.outcome)) {
      throw invalid("outcome must be a valid ApprovalOutcome");
    }
    let reason: string | undefined;
    if (item.reason !== undefined) {
      if (typeof item.reason !== "string" || Buffer.byteLength(item.reason, "utf8") > MAX_DECISION_REASON_BYTES) {
        throw invalid(`reason must be a string of at most ${MAX_DECISION_REASON_BYTES} bytes`);
      }
      reason = item.reason;
    }
    let elicitation: JsonObject | undefined;
    if (item.elicitation !== undefined) {
      if (!isObject(item.elicitation)) {
        throw invalid("elicitation must be a JSON object");
      }
      const target = pendingById?.get(item.approvalId);
      if (target?.kind !== "elicitation") {
        throw invalid("elicitation is only allowed for pending elicitation decisions");
      }
      elicitation = item.elicitation;
    }
    let modifiedArguments: JsonObject | undefined;
    if (item.modifiedArguments !== undefined) {
      if (!isObject(item.modifiedArguments)) {
        throw invalid("modifiedArguments must be a JSON object");
      }
      modifiedArguments = item.modifiedArguments;
    }
    out.push({
      approvalId: item.approvalId,
      outcome: item.outcome,
      ...(reason !== undefined ? { reason } : {}),
      ...(elicitation !== undefined ? { elicitation } : {}),
      ...(modifiedArguments !== undefined ? { modifiedArguments } : {}),
    });
  }
  return out;
}

/** Validates wire `SteerOptions`: only `softInterrupt: boolean` is accepted. */
export function parseSteerOptions(value: unknown): SteerOptions | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw invalid("options must be an object");
  for (const key of Object.keys(value)) {
    if (key !== "softInterrupt") throw invalid(`steer option ${key} is not allowed over the wire`);
  }
  if (value.softInterrupt !== undefined && typeof value.softInterrupt !== "boolean") {
    throw invalid("softInterrupt must be a boolean");
  }
  return value.softInterrupt !== undefined ? { softInterrupt: value.softInterrupt } : {};
}

/**
 * Validates wire `SessionListQuery`: accepts only documented `SessionListQuery` filter and pagination keys,
 * drops client-supplied ownership keys (`tenantId`, `accountId`, `userId`), and applies the server's `ownership` scope.
 */
export function parseSessionListQuery(value: unknown, ownership?: OwnershipScope): SessionListQuery | undefined {
  if (value === undefined) {
    return ownership ? { ...ownership } : undefined;
  }
  if (!isObject(value)) throw invalid("query must be an object");
  for (const key of Object.keys(value)) {
    if (OWNERSHIP_KEYS.has(key)) continue;
    if (!SESSION_LIST_QUERY_KEYS.has(key)) {
      throw invalid(`query field ${key} is not allowed over the wire`);
    }
  }
  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isSafeInteger(value.limit) || value.limit < 1) {
      // The store checks the page against its own `queryLimits.maxListLimit`, which the host may have raised.
      throw invalid("limit must be a positive integer");
    }
  }
  if (value.cursor !== undefined) {
    if (typeof value.cursor !== "string" || value.cursor.length === 0 || value.cursor.length > MAX_SESSION_LIST_CURSOR_LENGTH) {
      throw invalid(`cursor must be a non-empty string of at most ${MAX_SESSION_LIST_CURSOR_LENGTH} characters`);
    }
  }
  if (value.order !== undefined && value.order !== "asc" && value.order !== "desc") {
    throw invalid('order must be "asc" or "desc"');
  }
  if (value.actorKind !== undefined && value.actorKind !== "prism" && value.actorKind !== "external") {
    throw invalid('actorKind must be "prism" or "external"');
  }
  for (const key of SESSION_LIST_LINK_STRING_KEYS) {
    const field = value[key];
    if (field !== undefined && (typeof field !== "string" || field.length === 0 || field.length > MAX_SESSION_LINK_ID_LENGTH)) {
      throw invalid(`${key} must be a non-empty string of at most ${MAX_SESSION_LINK_ID_LENGTH} characters`);
    }
  }
  const out: SessionListQuery = {
    ...(value.cursor !== undefined ? { cursor: value.cursor as string } : {}),
    ...(value.limit !== undefined ? { limit: value.limit as number } : {}),
    ...(value.order !== undefined ? { order: value.order as "asc" | "desc" } : {}),
    ...(value.agentId !== undefined ? { agentId: value.agentId as string } : {}),
    ...(value.parentSessionId !== undefined ? { parentSessionId: value.parentSessionId as string } : {}),
    ...(value.workflowRunId !== undefined ? { workflowRunId: value.workflowRunId as string } : {}),
    ...(value.delegationId !== undefined ? { delegationId: value.delegationId as string } : {}),
    ...(value.actorKind !== undefined ? { actorKind: value.actorKind as "prism" | "external" } : {}),
    ...(value.actorAgent !== undefined ? { actorAgent: value.actorAgent as string } : {}),
    ...(ownership ?? {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Validates wire `SessionParentLink`: accepts only `SessionParentLink` string fields ≤ `MAX_SESSION_LINK_ID_LENGTH`. */
export function parseSessionParentLink(value: unknown): SessionParentLink | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw invalid("parent must be an object");
  for (const key of Object.keys(value)) {
    if (!PARENT_LINK_KEY_SET.has(key)) {
      throw invalid(`parent field ${key} is not allowed over the wire`);
    }
  }
  for (const key of PARENT_LINK_KEYS) {
    const field = value[key];
    if (field !== undefined && (typeof field !== "string" || field.length === 0 || field.length > MAX_SESSION_LINK_ID_LENGTH)) {
      throw invalid(`parent.${key} must be a non-empty string of at most ${MAX_SESSION_LINK_ID_LENGTH} characters`);
    }
  }
  return {
    ...(value.sessionId !== undefined ? { sessionId: value.sessionId as string } : {}),
    ...(value.agentId !== undefined ? { agentId: value.agentId as string } : {}),
    ...(value.workflowRunId !== undefined ? { workflowRunId: value.workflowRunId as string } : {}),
    ...(value.delegationId !== undefined ? { delegationId: value.delegationId as string } : {}),
  };
}
