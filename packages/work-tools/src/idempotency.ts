import { assertIdentityActive, type AgentIdentity } from "@arnilo/prism";
import { randomUUID } from "node:crypto";
import { WorkToolError } from "./errors.js";
import { DEFAULT_WORK_LIMITS, HARD_WORK_LIMITS } from "./limits.js";
import type {
  IdempotencyStore,
  WorkMutationFailure,
  WorkMutationKey,
  WorkMutationRecord,
  WorkMutationResult,
  WorkMutationTransitionInput,
} from "./types.js";

const DEFAULT_CLAIM_TTL_MS = 15 * 60_000;
const HARD_CLAIM_TTL_MS = 60 * 60_000;
const DEFAULT_MAX_ATTEMPTS = DEFAULT_WORK_LIMITS.maxRetries + 1;
const HARD_MAX_ATTEMPTS = HARD_WORK_LIMITS.maxRetries + 1;

/** In-process reference implementation. Durable adapters provide cross-replica claims. */
export function createMemoryIdempotencyStore(options: { readonly now?: () => number } = {}): IdempotencyStore {
  const records = new Map<string, WorkMutationRecord>();
  const now = options.now ?? Date.now;

  function current(input: WorkMutationKey): WorkMutationRecord | undefined {
    throwIfAborted(input.signal);
    validateKey(input);
    const id = recordKey(input.identity, input.key);
    const existing = records.get(id);
    if (!existing) return undefined;
    assertOp(input.op, existing);
    const expired = expire(existing, now());
    if (expired !== existing) records.set(id, expired);
    return expired;
  }

  function save(record: WorkMutationRecord): WorkMutationRecord {
    const frozen = freezeRecord(record);
    records.set(recordKeyFromRecord(record), frozen);
    return frozen;
  }

  return {
    async get(input) {
      return current(input);
    },

    async begin(input) {
      const existing = current(input);
      const timestamp = now();
      const claimTtlMs = resolveClaimTtl(input.claimTtlMs);
      const maxAttempts = resolveMaxAttempts(input.maxAttempts);
      if (!existing) return { outcome: "acquired", record: save(claim(input, 1, timestamp, claimTtlMs)) };
      if (existing.status === "failed_retryable" && existing.attempt < maxAttempts) {
        return { outcome: "acquired", record: save(claim(input, existing.attempt + 1, timestamp, claimTtlMs, existing)) };
      }
      return { outcome: "existing", record: existing };
    },

    async complete(input) {
      const record = requireClaim(current(input), input);
      return save({
        ...withoutClaim(record),
        status: "completed",
        version: record.version + 1,
        result: validateResult(input.result),
        updatedAt: timestamp(now()),
      });
    },

    async fail(input) {
      const record = requireClaim(current(input), input);
      return save({
        ...withoutClaim(record),
        status: input.status,
        version: record.version + 1,
        failure: validateFailure(input.failure),
        updatedAt: timestamp(now()),
      });
    },

    async markUnknown(input) {
      const record = requireClaim(current(input), input);
      return save({
        ...withoutClaim(record),
        status: "unknown",
        version: record.version + 1,
        ...(input.failure ? { failure: validateFailure(input.failure) } : {}),
        updatedAt: timestamp(now()),
      });
    },

    async resolveUnknown(input) {
      const record = current(input);
      if (record?.status !== "unknown" || record.version !== input.expectedVersion) {
        throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT", "idempotency transition conflict");
      }
      return save({
        ...record,
        status: input.status,
        version: record.version + 1,
        ...(input.failure ? { failure: validateFailure(input.failure) } : {}),
        updatedAt: timestamp(now()),
      });
    },
  };
}

/** Stable legacy identity key for host diagnostics; stores keep structured ownership internally. */
export function identityKey(identity: Pick<AgentIdentity, "tenantId" | "accountId" | "userId" | "principal">): string {
  return [identity.tenantId, identity.accountId ?? "", identity.userId ?? "", identity.principal.id].join("\0");
}

function claim(
  input: WorkMutationKey,
  attempt: number,
  now: number,
  claimTtlMs: number,
  previous?: WorkMutationRecord,
): WorkMutationRecord {
  const identity = input.identity;
  return {
    tenantId: identity.tenantId,
    ...(identity.accountId === undefined ? {} : { accountId: identity.accountId }),
    ...(identity.userId === undefined ? {} : { userId: identity.userId }),
    principalId: identity.principal.id,
    key: input.key,
    op: input.op,
    status: "in_progress",
    attempt,
    version: (previous?.version ?? 0) + 1,
    claimToken: randomUUID(),
    createdAt: previous?.createdAt ?? timestamp(now),
    updatedAt: timestamp(now),
    expiresAt: timestamp(now + claimTtlMs),
  };
}

function expire(record: WorkMutationRecord, now: number): WorkMutationRecord {
  if (record.status !== "in_progress" || !record.expiresAt || Date.parse(record.expiresAt) > now) return record;
  return freezeRecord({
    ...withoutClaim(record),
    status: "unknown",
    version: record.version + 1,
    failure: { code: "ERR_PRISM_WORK_IDEMPOTENCY_UNKNOWN" },
    updatedAt: timestamp(now),
  });
}

function requireClaim(record: WorkMutationRecord | undefined, input: WorkMutationTransitionInput): WorkMutationRecord {
  if (record?.status !== "in_progress" || record.version !== input.expectedVersion || record.claimToken !== input.claimToken) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT", "idempotency transition conflict");
  }
  return record;
}

function withoutClaim(record: WorkMutationRecord): Omit<WorkMutationRecord, "claimToken" | "expiresAt"> {
  const { claimToken: _claimToken, expiresAt: _expiresAt, ...rest } = record;
  return rest;
}

function recordKey(identity: AgentIdentity, key: string): string {
  return JSON.stringify([identity.tenantId, identity.accountId ?? "", identity.userId ?? "", identity.principal.id, key]);
}

function recordKeyFromRecord(record: WorkMutationRecord): string {
  return JSON.stringify([record.tenantId ?? "", record.accountId ?? "", record.userId ?? "", record.principalId, record.key]);
}

function validateKey(input: WorkMutationKey): void {
  assertIdentityActive(input.identity);
  for (const [label, value, maxBytes] of [
    ["idempotency key", input.key, 2 * 1024],
    ["operation", input.op, 512],
  ] as const) {
    if (!value || Buffer.byteLength(value, "utf8") > maxBytes) {
      throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", `${label} is required and bounded`);
    }
  }
}

function assertOp(op: string, record: WorkMutationRecord): void {
  if (record.op !== op) throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT", "idempotency operation conflict");
}

function resolveClaimTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_CLAIM_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > HARD_CLAIM_TTL_MS) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "claimTtlMs out of range");
  }
  return ttl;
}

function resolveMaxAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > HARD_MAX_ATTEMPTS) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "maxAttempts out of range");
  }
  return attempts;
}

function validateResult(result: WorkMutationResult): WorkMutationResult {
  if (!result.draftId || Buffer.byteLength(result.draftId, "utf8") > 512) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "draftId is required and bounded");
  }
  if (result.resourceId !== undefined && Buffer.byteLength(result.resourceId, "utf8") > 512) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "resourceId is bounded");
  }
  return Object.freeze({ ...result });
}

function validateFailure(failure: WorkMutationFailure): WorkMutationFailure {
  if (!failure.code || Buffer.byteLength(failure.code, "utf8") > 128) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "failure code is required and bounded");
  }
  if (failure.reference !== undefined && Buffer.byteLength(failure.reference, "utf8") > 1024) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "failure reference is bounded");
  }
  return Object.freeze({ ...failure });
}

function freezeRecord(record: WorkMutationRecord): WorkMutationRecord {
  return Object.freeze({
    ...record,
    ...(record.result ? { result: Object.freeze({ ...record.result }) } : {}),
    ...(record.failure ? { failure: Object.freeze({ ...record.failure }) } : {}),
  });
}

function timestamp(value: number): string {
  return new Date(value).toISOString();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
