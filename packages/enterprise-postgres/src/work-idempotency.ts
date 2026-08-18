import { randomUUID } from "node:crypto";
import { assertIdentityActive } from "@arnilo/prism";
import {
  DEFAULT_WORK_LIMITS,
  HARD_WORK_LIMITS,
  type IdempotencyStore,
  type WorkMutationFailure,
  type WorkMutationKey,
  type WorkMutationRecord,
  type WorkMutationResult,
  type WorkMutationStatus,
  type WorkMutationTransitionInput,
  WorkToolError,
} from "@arnilo/prism-work-tools";
import type { Pool } from "pg";
import { decodeBoundedJson, encodeBoundedJson } from "./codecs.js";
import { EnterprisePostgresError } from "./errors.js";
import { qualifyTable } from "./identifiers.js";
import { asTimestamp, deepFreeze, ownerParams, requiredText, requireStoreOwner, type StoreOwner, storeError } from "./records.js";

const DEFAULT_CLAIM_TTL_MS = 15 * 60_000;
const HARD_CLAIM_TTL_MS = 60 * 60_000;
const DEFAULT_MAX_ATTEMPTS = DEFAULT_WORK_LIMITS.maxRetries + 1;
const HARD_MAX_ATTEMPTS = HARD_WORK_LIMITS.maxRetries + 1;
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_KEY_BYTES = 2 * 1024;
const MAX_OP_BYTES = 512;
const MAX_PRINCIPAL_BYTES = 512;
const MAX_TOKEN_BYTES = 128;
const MAX_RESULT_FIELD_BYTES = 512;
const MAX_FAILURE_CODE_BYTES = 128;
const MAX_FAILURE_REFERENCE_BYTES = 1024;
const MAX_WORK_RECORD_BYTES = 8 * 1024;

const STATUSES = new Set<WorkMutationStatus>(["in_progress", "completed", "failed_retryable", "failed_terminal", "unknown"]);
const RECORD_COLUMNS = `tenant_id, account_key, user_key, principal_id, idempotency_key, op, status, attempt, version,
  claim_token, result::text AS result, failure::text AS failure, created_at, updated_at, expires_at`;

interface WorkContext {
  readonly owner: StoreOwner;
  readonly principalId: string;
  readonly key: string;
  readonly op: string;
}

/** PostgreSQL implementation of the work-tools claim/CAS contract. External effects stay outside SQL. */
export function createPostgresIdempotencyStore(pool: Pool, schema: string): IdempotencyStore {
  const table = qualifyTable(schema, "prism_work_idempotency");

  return {
    async get(input) {
      const context = workContext(input);
      try {
        await expireClaim(pool, table, context);
        return await readRecord(pool, table, context);
      } catch (error) {
        throw workStoreError(error);
      }
    },

    async begin(input) {
      const context = workContext(input);
      const claimTtlMs = resolveClaimTtl(input.claimTtlMs);
      const maxAttempts = resolveMaxAttempts(input.maxAttempts);
      try {
        const inserted = await insertClaim(pool, table, context, claimTtlMs);
        if (inserted) return { outcome: "acquired", record: inserted };

        let existing = await readRecord(pool, table, context);
        if (!existing) {
          const retriedInsert = await insertClaim(pool, table, context, claimTtlMs);
          if (retriedInsert) return { outcome: "acquired", record: retriedInsert };
          existing = await readRecord(pool, table, context);
          if (!existing)
            throw new EnterprisePostgresError("idempotency claim could not be read", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
        }
        const expired = await expireClaim(pool, table, context);
        if (expired) return { outcome: "existing", record: expired };
        const reclaimed = await reclaimRetryable(pool, table, context, claimTtlMs, maxAttempts);
        if (reclaimed) return { outcome: "acquired", record: reclaimed };
        return { outcome: "existing", record: (await readRecord(pool, table, context)) ?? existing };
      } catch (error) {
        throw workStoreError(error);
      }
    },

    async complete(input) {
      const context = transitionContext(input);
      const result = encodeBoundedJson(validateResult(input.result), MAX_WORK_RECORD_BYTES, "work result");
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = 'completed', version = version + 1, claim_token = NULL, result = $1::jsonb, failure = NULL,
               updated_at = clock_timestamp(), expires_at = clock_timestamp() + ${RETENTION_MS} * INTERVAL '1 millisecond'
           WHERE tenant_id = $2 AND account_key = $3 AND user_key = $4 AND principal_id = $5 AND idempotency_key = $6 AND op = $7
             AND status = 'in_progress' AND claim_token = $8 AND version = $9 AND expires_at > clock_timestamp()
           RETURNING ${RECORD_COLUMNS}`,
          [result, ...contextParams(context), input.claimToken, input.expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw workStoreError(error);
      }
    },

    async fail(input) {
      const context = transitionContext(input);
      const status = failureStatus(input.status);
      const failure = encodeBoundedJson(validateFailure(input.failure), MAX_WORK_RECORD_BYTES, "work failure");
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = $1, version = version + 1, claim_token = NULL, result = NULL, failure = $2::jsonb,
               updated_at = clock_timestamp(), expires_at = clock_timestamp() + ${RETENTION_MS} * INTERVAL '1 millisecond'
           WHERE tenant_id = $3 AND account_key = $4 AND user_key = $5 AND principal_id = $6 AND idempotency_key = $7 AND op = $8
             AND status = 'in_progress' AND claim_token = $9 AND version = $10 AND expires_at > clock_timestamp()
           RETURNING ${RECORD_COLUMNS}`,
          [status, failure, ...contextParams(context), input.claimToken, input.expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw workStoreError(error);
      }
    },

    async markUnknown(input) {
      const context = transitionContext(input);
      const failure = input.failure ? encodeBoundedJson(validateFailure(input.failure), MAX_WORK_RECORD_BYTES, "work failure") : null;
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = 'unknown', version = version + 1, claim_token = NULL, result = NULL, failure = COALESCE($1::jsonb, failure),
               updated_at = clock_timestamp(), expires_at = NULL
           WHERE tenant_id = $2 AND account_key = $3 AND user_key = $4 AND principal_id = $5 AND idempotency_key = $6 AND op = $7
             AND status = 'in_progress' AND claim_token = $8 AND version = $9 AND expires_at > clock_timestamp()
           RETURNING ${RECORD_COLUMNS}`,
          [failure, ...contextParams(context), input.claimToken, input.expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw workStoreError(error);
      }
    },

    async resolveUnknown(input) {
      const context = workContext(input);
      const status = failureStatus(input.status);
      const expectedVersion = version(input.expectedVersion);
      const failure = input.failure ? encodeBoundedJson(validateFailure(input.failure), MAX_WORK_RECORD_BYTES, "work failure") : null;
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = $1, version = version + 1, failure = COALESCE($2::jsonb, failure),
               updated_at = clock_timestamp(), expires_at = clock_timestamp() + ${RETENTION_MS} * INTERVAL '1 millisecond'
           WHERE tenant_id = $3 AND account_key = $4 AND user_key = $5 AND principal_id = $6 AND idempotency_key = $7 AND op = $8
             AND status = 'unknown' AND version = $9
           RETURNING ${RECORD_COLUMNS}`,
          [status, failure, ...contextParams(context), expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw workStoreError(error);
      }
    },
  };
}

async function insertClaim(pool: Pool, table: string, context: WorkContext, claimTtlMs: number): Promise<WorkMutationRecord | undefined> {
  const inserted = await pool.query(
    `INSERT INTO ${table}
       (tenant_id, account_key, user_key, principal_id, idempotency_key, op, status, attempt, version, claim_token, result, failure, created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', 1, 1, $7, NULL, NULL, clock_timestamp(), clock_timestamp(),
             clock_timestamp() + $8 * INTERVAL '1 millisecond')
     ON CONFLICT DO NOTHING
     RETURNING ${RECORD_COLUMNS}`,
    [...contextParams(context), randomUUID(), claimTtlMs],
  );
  return inserted.rows[0] ? rowToRecord(inserted.rows[0], context) : undefined;
}

async function reclaimRetryable(
  pool: Pool,
  table: string,
  context: WorkContext,
  claimTtlMs: number,
  maxAttempts: number,
): Promise<WorkMutationRecord | undefined> {
  const reclaimed = await pool.query(
    `UPDATE ${table}
     SET status = 'in_progress', attempt = attempt + 1, version = version + 1, claim_token = $1, result = NULL, failure = NULL,
         updated_at = clock_timestamp(), expires_at = clock_timestamp() + $2 * INTERVAL '1 millisecond'
     WHERE tenant_id = $3 AND account_key = $4 AND user_key = $5 AND principal_id = $6 AND idempotency_key = $7 AND op = $8
       AND status = 'failed_retryable' AND attempt < $9
     RETURNING ${RECORD_COLUMNS}`,
    [randomUUID(), claimTtlMs, ...contextParams(context), maxAttempts],
  );
  return reclaimed.rows[0] ? rowToRecord(reclaimed.rows[0], context) : undefined;
}

async function expireClaim(pool: Pool, table: string, context: WorkContext): Promise<WorkMutationRecord | undefined> {
  const expired = await pool.query(
    `UPDATE ${table}
     SET status = 'unknown', version = version + 1, claim_token = NULL, expires_at = NULL,
         failure = COALESCE(failure, jsonb_build_object('code', 'ERR_PRISM_WORK_IDEMPOTENCY_UNKNOWN')),
         updated_at = clock_timestamp()
     WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND idempotency_key = $5 AND op = $6
       AND status = 'in_progress' AND expires_at <= clock_timestamp()
     RETURNING ${RECORD_COLUMNS}`,
    contextParams(context),
  );
  return expired.rows[0] ? rowToRecord(expired.rows[0], context) : undefined;
}

async function readRecord(pool: Pool, table: string, context: WorkContext): Promise<WorkMutationRecord | undefined> {
  const result = await pool.query(
    `SELECT ${RECORD_COLUMNS} FROM ${table}
     WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND idempotency_key = $5`,
    contextParams(context).slice(0, 5),
  );
  if (!result.rows[0]) return undefined;
  const record = rowToRecord(result.rows[0], context);
  if (record.op !== context.op) idempotencyConflict();
  return record;
}

function workContext(input: WorkMutationKey): WorkContext {
  input.signal?.throwIfAborted();
  assertIdentityActive(input.identity);
  const owner = requireStoreOwner(input.identity);
  const principalId = inputText(input.identity.principal.id, "work principal", MAX_PRINCIPAL_BYTES);
  return {
    owner,
    principalId,
    key: inputText(input.key, "idempotency key", MAX_KEY_BYTES),
    op: inputText(input.op, "work operation", MAX_OP_BYTES),
  };
}

function transitionContext(input: WorkMutationTransitionInput): WorkContext {
  const context = workContext(input);
  inputText(input.claimToken, "claim token", MAX_TOKEN_BYTES, "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT");
  version(input.expectedVersion);
  return context;
}

function contextParams(context: WorkContext): [string, string, string, string, string, string] {
  return [...ownerParams(context.owner), context.principalId, context.key, context.op];
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

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT", "idempotency transition conflict");
  }
  return value;
}

function validateResult(result: WorkMutationResult): WorkMutationResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "result is required and bounded");
  }
  const draftId = inputText(result.draftId, "draftId", MAX_RESULT_FIELD_BYTES);
  const resourceId = result.resourceId === undefined ? undefined : inputText(result.resourceId, "resourceId", MAX_RESULT_FIELD_BYTES);
  return { draftId, ...(resourceId === undefined ? {} : { resourceId }) };
}

function validateFailure(failure: WorkMutationFailure): WorkMutationFailure {
  if (!failure || typeof failure !== "object" || Array.isArray(failure)) {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "failure is required and bounded");
  }
  const code = inputText(failure.code, "failure code", MAX_FAILURE_CODE_BYTES);
  const reference =
    failure.reference === undefined ? undefined : inputText(failure.reference, "failure reference", MAX_FAILURE_REFERENCE_BYTES);
  return { code, ...(reference === undefined ? {} : { reference }) };
}

function failureStatus(value: unknown): "failed_retryable" | "failed_terminal" {
  if (value !== "failed_retryable" && value !== "failed_terminal") {
    throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT", "idempotency transition conflict");
  }
  return value;
}

function inputText(
  value: unknown,
  label: string,
  maxBytes: number,
  code: "ERR_PRISM_WORK_IDEMPOTENCY" | "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT" = "ERR_PRISM_WORK_IDEMPOTENCY",
): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new WorkToolError(code, `${label} is required and bounded`);
  }
  return value;
}

function requireTransition(row: Record<string, unknown> | undefined, context: WorkContext): WorkMutationRecord {
  if (!row) idempotencyConflict();
  return rowToRecord(row, context);
}

function rowToRecord(row: Record<string, unknown>, context: WorkContext): WorkMutationRecord {
  const tenantId = requiredText(row.tenant_id, "work tenant");
  const accountId = normalizedOwner(row.account_key, "work account");
  const userId = normalizedOwner(row.user_key, "work user");
  const principalId = requiredText(row.principal_id, "work principal", MAX_PRINCIPAL_BYTES);
  if (
    tenantId !== context.owner.tenantId ||
    accountId !== context.owner.accountId ||
    userId !== context.owner.userId ||
    principalId !== context.principalId
  ) {
    throw new EnterprisePostgresError("work row ownership is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const status = requiredText(row.status, "work status", 32) as WorkMutationStatus;
  if (!STATUSES.has(status)) throw new EnterprisePostgresError("work row status is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  const key = requiredText(row.idempotency_key, "idempotency key", MAX_KEY_BYTES);
  const op = requiredText(row.op, "work operation", MAX_OP_BYTES);
  const claimToken =
    row.claim_token === null || row.claim_token === undefined ? undefined : requiredText(row.claim_token, "claim token", MAX_TOKEN_BYTES);
  const expiresAt = row.expires_at === null || row.expires_at === undefined ? undefined : asTimestamp(row.expires_at, "work expiresAt");
  const result = resultValue(row.result);
  const failure = failureValue(row.failure);
  if (status === "in_progress" && (!claimToken || !expiresAt || result || failure)) {
    throw new EnterprisePostgresError("work claim row is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  if (status !== "in_progress" && (claimToken || (expiresAt !== undefined && status === "unknown"))) {
    throw new EnterprisePostgresError("work terminal row is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  if (status === "completed" && (!result || failure || !expiresAt)) {
    throw new EnterprisePostgresError("work completion row is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  if (status !== "completed" && result) {
    throw new EnterprisePostgresError("work result row is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  if ((status === "failed_retryable" || status === "failed_terminal") && !expiresAt) {
    throw new EnterprisePostgresError("work retention row is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return deepFreeze({
    tenantId,
    ...(accountId === undefined ? {} : { accountId }),
    ...(userId === undefined ? {} : { userId }),
    principalId,
    key,
    op,
    status,
    attempt: boundedInteger(row.attempt, "work attempt", 1, HARD_MAX_ATTEMPTS),
    version: boundedInteger(row.version, "work version", 1, Number.MAX_SAFE_INTEGER),
    ...(claimToken === undefined ? {} : { claimToken }),
    ...(result === undefined ? {} : { result }),
    ...(failure === undefined ? {} : { failure }),
    createdAt: asTimestamp(row.created_at, "work createdAt"),
    updatedAt: asTimestamp(row.updated_at, "work updatedAt"),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

function normalizedOwner(value: unknown, label: string): string | undefined {
  if (value === "") return undefined;
  return requiredText(value, label);
}

function resultValue(value: unknown): WorkMutationResult | undefined {
  if (value === null || value === undefined) return undefined;
  const decoded = objectValue(value, "work result");
  if (!onlyKeys(decoded, ["draftId", "resourceId"])) {
    throw new EnterprisePostgresError("work result is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const draftId = requiredText(decoded.draftId, "work draftId", MAX_RESULT_FIELD_BYTES);
  const resourceId =
    decoded.resourceId === undefined ? undefined : requiredText(decoded.resourceId, "work resourceId", MAX_RESULT_FIELD_BYTES);
  return deepFreeze({ draftId, ...(resourceId === undefined ? {} : { resourceId }) });
}

function failureValue(value: unknown): WorkMutationFailure | undefined {
  if (value === null || value === undefined) return undefined;
  const decoded = objectValue(value, "work failure");
  if (!onlyKeys(decoded, ["code", "reference"])) {
    throw new EnterprisePostgresError("work failure is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const code = requiredText(decoded.code, "work failure code", MAX_FAILURE_CODE_BYTES);
  const reference =
    decoded.reference === undefined ? undefined : requiredText(decoded.reference, "work failure reference", MAX_FAILURE_REFERENCE_BYTES);
  return deepFreeze({ code, ...(reference === undefined ? {} : { reference }) });
}

function objectValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const decoded = decodeBoundedJson(value, MAX_WORK_RECORD_BYTES, label);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return decoded as Record<string, unknown>;
}

function onlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return value;
}

function idempotencyConflict(): never {
  throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT", "idempotency transition conflict");
}

function workStoreError(error: unknown): Error {
  return error instanceof WorkToolError ? error : storeError(error);
}
