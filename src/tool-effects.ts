import { createHash, randomUUID } from "node:crypto";
import type {
  JsonObject,
  OwnershipScope,
  ToolEffectKey,
  ToolEffectRecord,
  ToolEffectStatus,
  ToolEffectStore,
  ToolEffectTransition,
  ToolResult,
} from "./contracts.js";
import { assertIdentityActive, assertIdentityMatchesOwnership } from "./identity.js";

export type ToolEffectErrorCode =
  | "ERR_PRISM_TOOL_EFFECT_REQUIRED"
  | "ERR_PRISM_TOOL_EFFECT_CONFLICT"
  | "ERR_PRISM_TOOL_EFFECT_UNKNOWN"
  | "ERR_PRISM_TOOL_EFFECT_COMPLETED"
  | "ERR_PRISM_TOOL_EFFECT_LIMIT";

export class ToolEffectError extends Error {
  constructor(
    readonly code: ToolEffectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolEffectError";
  }
}

const DEFAULT_CLAIM_TTL_MS = 15 * 60_000;
const HARD_CLAIM_TTL_MS = 60 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const HARD_MAX_ATTEMPTS = 10;
const DEFAULT_CLEANUP_LIMIT = 100;
const HARD_CLEANUP_LIMIT = 500;
const MAX_EFFECT_KEY_BYTES = 96;
const MAX_TOOL_NAME_BYTES = 512;
const MAX_IDENTIFIER_BYTES = 512;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_REFERENCE_BYTES = 1024;
const MAX_RECORD_BYTES = 128 * 1024;

/** Stable JSON representation for an already-validated tool arguments object. */
export function canonicalToolEffectJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function toolEffectArgumentsHash(argumentsValue: JsonObject): string {
  return createHash("sha256").update(canonicalToolEffectJson(argumentsValue)).digest("hex");
}

/** Derives the only core-authoritative key. Callers never supply this from model input. */
export function deriveToolEffectKey(input: Omit<ToolEffectKey, "key" | "signal">): string {
  const value = canonicalToolEffectJson({
    tenantId: input.ownership.tenantId,
    accountId: input.ownership.accountId ?? null,
    userId: input.ownership.userId ?? null,
    principalId: input.identity.principal.id,
    sessionId: input.sessionId,
    runId: input.runId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    argumentsHash: input.argumentsHash,
  });
  return `prism:tool-effect:v1:${createHash("sha256").update(value).digest("hex")}`;
}

/** In-process reference. Use a durable adapter for cross-replica claims. */
export function createMemoryToolEffectStore(options: { readonly now?: () => number } = {}): ToolEffectStore {
  const records = new Map<string, ToolEffectRecord>();
  const now = options.now ?? Date.now;

  function current(input: ToolEffectKey): ToolEffectRecord | undefined {
    throwIfAborted(input.signal);
    validateKey(input);
    const found = records.get(recordKey(input));
    if (!found) return undefined;
    assertMatches(found, input);
    const expired = expire(found, now());
    if (expired !== found) records.set(recordKey(input), expired);
    return expired;
  }

  function save(record: ToolEffectRecord, identity: ToolEffectKey["identity"]): ToolEffectRecord {
    const frozen = freezeRecord(record);
    assertRecordSize(frozen);
    records.set(recordKey({ identity, key: frozen.key }), frozen);
    return frozen;
  }

  return {
    async get(input) {
      return current(input);
    },

    async begin(input) {
      const existing = current(input);
      const timestamp = now();
      const ttl = claimTtl(input.claimTtlMs);
      const attempts = maxAttempts(input.maxAttempts);
      if (!existing)
        return {
          outcome: "acquired",
          record: save(claim(input, 1, timestamp, ttl), input.identity),
        };
      if (existing.status === "failed_retryable" && existing.attempt < attempts) {
        return {
          outcome: "acquired",
          record: save(claim(input, existing.attempt + 1, timestamp, ttl, existing), input.identity),
        };
      }
      return { outcome: "existing", record: existing };
    },

    async markDispatched(input) {
      const record = requireClaim(current(input), input, ["pending"]);
      return save(
        {
          ...record,
          status: "dispatched",
          version: record.version + 1,
          updatedAt: timestamp(now()),
        },
        input.identity,
      );
    },

    async complete(input) {
      const record = requireClaim(current(input), input, ["dispatched"]);
      const result = input.result === undefined ? undefined : validateResult(input.result, input);
      const resultRef = input.resultRef === undefined ? undefined : validateReference(input.resultRef);
      return save(
        {
          ...withoutClaim(record),
          status: "completed",
          version: record.version + 1,
          ...(result === undefined ? {} : { result }),
          ...(resultRef === undefined ? {} : { resultRef }),
          updatedAt: timestamp(now()),
        },
        input.identity,
      );
    },

    async fail(input) {
      const record = requireClaim(current(input), input, ["pending", "dispatched"]);
      return save(
        {
          ...withoutClaim(record),
          status: input.status,
          version: record.version + 1,
          failure: validateFailure(input.failure),
          updatedAt: timestamp(now()),
        },
        input.identity,
      );
    },

    async markUnknown(input) {
      const record = requireClaim(current(input), input, ["dispatched"]);
      return save(
        {
          ...withoutClaim(record),
          status: "unknown",
          version: record.version + 1,
          ...(input.failure === undefined ? {} : { failure: validateFailure(input.failure) }),
          updatedAt: timestamp(now()),
        },
        input.identity,
      );
    },

    async resolveUnknown(input) {
      const record = current(input);
      if (!record || record.status !== "unknown" || record.version !== input.expectedVersion) throw conflict();
      const result = input.result === undefined ? undefined : validateResult(input.result, input);
      const resultRef = input.resultRef === undefined ? undefined : validateReference(input.resultRef);
      return save(
        {
          ...record,
          status: input.status,
          version: record.version + 1,
          ...(result === undefined ? {} : { result }),
          ...(resultRef === undefined ? {} : { resultRef }),
          ...(input.failure === undefined ? {} : { failure: validateFailure(input.failure) }),
          updatedAt: timestamp(now()),
        },
        input.identity,
      );
    },

    async cleanup(input) {
      throwIfAborted(input.signal);
      const before = Date.parse(input.before);
      if (!Number.isFinite(before)) throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "cleanup boundary is invalid");
      validateOwnership(input.ownership);
      const limit = cleanupLimit(input.limit);
      let deleted = 0;
      for (const [id, record] of records) {
        throwIfAborted(input.signal);
        if (deleted >= limit) break;
        if (!sameOwnership(record, input.ownership) || !isTerminal(record.status) || Date.parse(record.updatedAt) >= before) continue;
        records.delete(id);
        deleted += 1;
      }
      return { deleted };
    },
  };
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "tool effect values must be JSON");
}

function claim(input: ToolEffectKey, attempt: number, currentTime: number, ttl: number, previous?: ToolEffectRecord): ToolEffectRecord {
  return {
    ...owner(input.ownership),
    key: input.key,
    sessionId: input.sessionId,
    runId: input.runId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    argumentsHash: input.argumentsHash,
    status: "pending",
    attempt,
    version: (previous?.version ?? 0) + 1,
    claimToken: randomUUID(),
    createdAt: previous?.createdAt ?? timestamp(currentTime),
    updatedAt: timestamp(currentTime),
    expiresAt: timestamp(currentTime + ttl),
  };
}

function expire(record: ToolEffectRecord, currentTime: number): ToolEffectRecord {
  if ((record.status !== "pending" && record.status !== "dispatched") || !record.expiresAt || Date.parse(record.expiresAt) > currentTime)
    return record;
  const status = record.status === "pending" ? "failed_retryable" : "unknown";
  return freezeRecord({
    ...withoutClaim(record),
    status,
    version: record.version + 1,
    failure: { code: "ERR_PRISM_TOOL_EFFECT_EXPIRED" },
    updatedAt: timestamp(currentTime),
  });
}

function requireClaim(
  record: ToolEffectRecord | undefined,
  input: ToolEffectTransition,
  statuses: readonly ToolEffectStatus[],
): ToolEffectRecord {
  if (!record || !statuses.includes(record.status) || record.version !== input.expectedVersion || record.claimToken !== input.claimToken)
    throw conflict();
  return record;
}

function withoutClaim(record: ToolEffectRecord): Omit<ToolEffectRecord, "claimToken" | "expiresAt"> {
  const { claimToken: _claimToken, expiresAt: _expiresAt, ...rest } = record;
  return rest;
}

function validateKey(input: ToolEffectKey): void {
  assertIdentityActive(input.identity);
  validateOwnership(input.ownership);
  assertIdentityMatchesOwnership(input.identity, input.ownership);
  if (
    input.ownership.tenantId !== input.identity.tenantId ||
    input.ownership.accountId !== input.identity.accountId ||
    input.ownership.userId !== input.identity.userId
  )
    throw conflict();
  validateText(input.key, MAX_EFFECT_KEY_BYTES, "effect key");
  validateText(input.sessionId, MAX_IDENTIFIER_BYTES, "session id");
  validateText(input.runId, MAX_IDENTIFIER_BYTES, "run id");
  validateText(input.toolCallId, MAX_IDENTIFIER_BYTES, "tool call id");
  validateText(input.toolName, MAX_TOOL_NAME_BYTES, "tool name");
  if (!/^[a-f0-9]{64}$/.test(input.argumentsHash)) throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "arguments hash is invalid");
}

function validateOwnership(ownership: OwnershipScope): void {
  if (!ownership.tenantId?.trim()) throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_CONFLICT", "tool effect ownership is required");
  for (const value of [ownership.tenantId, ownership.accountId, ownership.userId]) {
    if (value !== undefined) validateText(value, MAX_IDENTIFIER_BYTES, "ownership");
  }
}

function assertMatches(record: ToolEffectRecord, input: ToolEffectKey): void {
  if (
    record.key !== input.key ||
    record.sessionId !== input.sessionId ||
    record.runId !== input.runId ||
    record.toolCallId !== input.toolCallId ||
    record.toolName !== input.toolName ||
    record.argumentsHash !== input.argumentsHash ||
    !sameOwnership(record, input.ownership)
  ) {
    throw conflict();
  }
}

function validateResult(result: ToolResult, input: Pick<ToolEffectKey, "toolCallId" | "toolName">): ToolResult {
  if (result.toolCallId !== input.toolCallId || result.name !== input.toolName) throw conflict();
  return jsonSnapshot(result, MAX_RESULT_BYTES, "tool result") as ToolResult;
}

function validateReference(reference: string): string {
  validateText(reference, MAX_REFERENCE_BYTES, "effect reference");
  return reference;
}

function validateFailure(failure: { readonly code: string; readonly reference?: string }): {
  readonly code: string;
  readonly reference?: string;
} {
  validateText(failure.code, 128, "effect failure code");
  return Object.freeze({
    ...failure,
    ...(failure.reference === undefined ? {} : { reference: validateReference(failure.reference) }),
  });
}

function assertRecordSize(record: ToolEffectRecord): void {
  void jsonSnapshot(record, MAX_RECORD_BYTES, "tool effect record");
}

function jsonSnapshot(value: unknown, maxBytes: number, label: string): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", `${label} must be JSON serializable`);
  }
  if (text === undefined || Buffer.byteLength(text) > maxBytes)
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", `${label} exceeds limits`);
  return JSON.parse(text);
}

function freezeRecord(record: ToolEffectRecord): ToolEffectRecord {
  return freezeJson(jsonSnapshot(record, MAX_RECORD_BYTES, "tool effect record") as ToolEffectRecord);
}

function freezeJson<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeJson(child);
  return Object.freeze(value);
}

function owner(ownership: OwnershipScope): OwnershipScope {
  return {
    tenantId: ownership.tenantId,
    ...(ownership.accountId === undefined ? {} : { accountId: ownership.accountId }),
    ...(ownership.userId === undefined ? {} : { userId: ownership.userId }),
  };
}

function sameOwnership(left: OwnershipScope, right: OwnershipScope): boolean {
  return left.tenantId === right.tenantId && left.accountId === right.accountId && left.userId === right.userId;
}

function recordKey(input: Pick<ToolEffectKey, "identity" | "key">): string {
  return JSON.stringify([
    input.identity.tenantId,
    input.identity.accountId ?? "",
    input.identity.userId ?? "",
    input.identity.principal.id,
    input.key,
  ]);
}

function isTerminal(status: ToolEffectStatus): boolean {
  return status === "completed" || status === "failed_terminal";
}

function timestamp(value: number): string {
  return new Date(value).toISOString();
}

function claimTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_CLAIM_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > HARD_CLAIM_TTL_MS)
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "claim TTL exceeds limits");
  return ttl;
}

function maxAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > HARD_MAX_ATTEMPTS)
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "effect attempts exceed limits");
  return attempts;
}

function cleanupLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_CLEANUP_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_CLEANUP_LIMIT)
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "cleanup limit exceeds limits");
  return limit;
}

function validateText(value: string, maxBytes: number, label: string): void {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maxBytes)
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", `${label} is required and bounded`);
}

function conflict(): ToolEffectError {
  return new ToolEffectError("ERR_PRISM_TOOL_EFFECT_CONFLICT", "tool effect transition conflict");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
