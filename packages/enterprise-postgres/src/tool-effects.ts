import { randomUUID } from "node:crypto";
import type { ToolEffectKey, ToolEffectRecord, ToolEffectStatus, ToolEffectStore, ToolEffectTransition, ToolResult } from "@arnilo/prism";
import { assertIdentityActive, assertIdentityMatchesOwnership, ToolEffectError } from "@arnilo/prism";
import type { Pool } from "pg";
import { decodeBoundedJson, encodeBoundedJson } from "./codecs.js";
import { EnterprisePostgresError } from "./errors.js";
import { qualifyTable } from "./identifiers.js";
import { asTimestamp, deepFreeze, ownerParams, requiredText, requireStoreOwner, type StoreOwner, storeError } from "./records.js";

const DEFAULT_CLAIM_TTL_MS = 15 * 60_000;
const HARD_CLAIM_TTL_MS = 60 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const HARD_MAX_ATTEMPTS = 10;
const DEFAULT_CLEANUP_LIMIT = 100;
const HARD_CLEANUP_LIMIT = 500;
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_KEY_BYTES = 2 * 1024;
const MAX_IDENTIFIER_BYTES = 512;
const MAX_TOOL_NAME_BYTES = 512;
const MAX_TOKEN_BYTES = 128;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_REFERENCE_BYTES = 1024;
const MAX_RECORD_BYTES = 128 * 1024;

const ACTIVE_STATUSES = new Set<ToolEffectStatus>(["pending", "dispatched"]);
const STATUSES = new Set<ToolEffectStatus>(["pending", "dispatched", "completed", "failed_retryable", "failed_terminal", "unknown"]);
const RECORD_COLUMNS = `tenant_id, account_key, user_key, principal_id, effect_key, session_id, run_id, tool_call_id, tool_name, arguments_hash,
  status, attempt, version, claim_token, result::text AS result, result_ref, failure::text AS failure, created_at, updated_at, expires_at`;

interface EffectContext {
  readonly owner: StoreOwner;
  readonly principalId: string;
  readonly key: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
}

interface CleanupScope {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principalId: string;
  readonly limit: number;
}

/** PostgreSQL implementation of core ToolEffectStore. External effects remain outside SQL. */
export function createPostgresToolEffectStore(pool: Pool, schema: string): ToolEffectStore {
  const table = qualifyTable(schema, "prism_tool_effects");

  return {
    async get(input) {
      const context = effectContext(input);
      try {
        await expireClaim(pool, table, context);
        return await readRecord(pool, table, context);
      } catch (error) {
        throw effectStoreError(error);
      }
    },

    async begin(input) {
      const context = effectContext(input);
      const claimTtlMs = claimTtl(input.claimTtlMs);
      const maxAttempts = maxAttemptsValue(input.maxAttempts);
      try {
        const inserted = await insertClaim(pool, table, context, claimTtlMs);
        if (inserted) return { outcome: "acquired" as const, record: inserted };

        let existing = await readRecord(pool, table, context);
        if (!existing) {
          const retry = await insertClaim(pool, table, context, claimTtlMs);
          if (retry) return { outcome: "acquired" as const, record: retry };
          existing = await readRecord(pool, table, context);
          if (!existing)
            throw new EnterprisePostgresError("tool effect claim could not be read", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
        }
        await expireClaim(pool, table, context);
        existing = (await readRecord(pool, table, context)) ?? existing;
        const reclaimed = await reclaimRetryable(pool, table, context, claimTtlMs, maxAttempts);
        if (reclaimed) return { outcome: "acquired" as const, record: reclaimed };
        return { outcome: "existing" as const, record: existing };
      } catch (error) {
        throw effectStoreError(error);
      }
    },

    async markDispatched(input) {
      const context = transitionContext(input);
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = 'dispatched', version = version + 1, updated_at = clock_timestamp()
           WHERE ${where(1)} AND status = 'pending' AND claim_token = $11 AND version = $12 AND expires_at > clock_timestamp()
           RETURNING ${RECORD_COLUMNS}`,
          [...contextParams(context), input.claimToken, input.expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw effectStoreError(error);
      }
    },

    async complete(input) {
      const context = transitionContext(input);
      const result =
        input.result === undefined
          ? null
          : encodeBoundedJson(validateResult(input.result, context), MAX_RESULT_BYTES, "tool effect result");
      const resultRef = input.resultRef === undefined ? null : validateReference(input.resultRef);
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = 'completed', version = version + 1, claim_token = NULL, result = $1::jsonb, result_ref = $2, failure = NULL,
               updated_at = clock_timestamp(), expires_at = clock_timestamp() + ${RETENTION_MS} * INTERVAL '1 millisecond'
           WHERE ${where(3)} AND status = 'dispatched' AND claim_token = $13 AND version = $14 AND expires_at > clock_timestamp()
           RETURNING ${RECORD_COLUMNS}`,
          [result, resultRef, ...contextParams(context), input.claimToken, input.expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw effectStoreError(error);
      }
    },

    async fail(input) {
      const context = transitionContext(input);
      const status = failureStatus(input.status);
      const failure = encodeBoundedJson(validateFailure(input.failure), MAX_REFERENCE_BYTES * 2, "tool effect failure");
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = $1, version = version + 1, claim_token = NULL, result = NULL, result_ref = NULL, failure = $2::jsonb,
               updated_at = clock_timestamp(),
               expires_at = CASE WHEN $1 = 'failed_terminal' THEN clock_timestamp() + ${RETENTION_MS} * INTERVAL '1 millisecond' ELSE NULL END
           WHERE ${where(3)} AND status IN ('pending', 'dispatched') AND claim_token = $13 AND version = $14 AND expires_at > clock_timestamp()
           RETURNING ${RECORD_COLUMNS}`,
          [status, failure, ...contextParams(context), input.claimToken, input.expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw effectStoreError(error);
      }
    },

    async markUnknown(input) {
      const context = transitionContext(input);
      const failure =
        input.failure === undefined
          ? null
          : encodeBoundedJson(validateFailure(input.failure), MAX_REFERENCE_BYTES * 2, "tool effect failure");
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = 'unknown', version = version + 1, claim_token = NULL, result = NULL, result_ref = NULL,
               failure = COALESCE($1::jsonb, failure), updated_at = clock_timestamp(), expires_at = NULL
           WHERE ${where(2)} AND status = 'dispatched' AND claim_token = $12 AND version = $13 AND expires_at > clock_timestamp()
           RETURNING ${RECORD_COLUMNS}`,
          [failure, ...contextParams(context), input.claimToken, input.expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw effectStoreError(error);
      }
    },

    async resolveUnknown(input) {
      const context = effectContext(input);
      const status = resolutionStatus(input.status);
      const expectedVersion = version(input.expectedVersion);
      const result =
        input.result === undefined
          ? null
          : encodeBoundedJson(validateResult(input.result, context), MAX_RESULT_BYTES, "tool effect result");
      const resultRef = input.resultRef === undefined ? null : validateReference(input.resultRef);
      const failure =
        input.failure === undefined
          ? null
          : encodeBoundedJson(validateFailure(input.failure), MAX_REFERENCE_BYTES * 2, "tool effect failure");
      try {
        const updated = await pool.query(
          `UPDATE ${table}
           SET status = $1, version = version + 1, result = $2::jsonb, result_ref = $3, failure = COALESCE($4::jsonb, failure),
               updated_at = clock_timestamp(),
               expires_at = CASE WHEN $1 IN ('completed', 'failed_terminal') THEN clock_timestamp() + ${RETENTION_MS} * INTERVAL '1 millisecond' ELSE NULL END
           WHERE ${where(5)} AND status = 'unknown' AND version = $15
           RETURNING ${RECORD_COLUMNS}`,
          [status, result, resultRef, failure, ...contextParams(context), expectedVersion],
        );
        return requireTransition(updated.rows[0], context);
      } catch (error) {
        throw effectStoreError(error);
      }
    },

    async cleanup(input) {
      input.signal?.throwIfAborted();
      const owner = effectOwner(input.ownership);
      const before = Date.parse(input.before);
      if (!Number.isFinite(before)) throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "cleanup boundary is invalid");
      const limit = cleanupLimit(input.limit);
      try {
        const deleted = await pool.query(
          `WITH candidates AS (
             SELECT ctid FROM ${table}
             WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3
               AND status IN ('completed', 'failed_terminal') AND updated_at < $4::timestamptz
             ORDER BY updated_at ASC, effect_key ASC
             LIMIT $5
             FOR UPDATE SKIP LOCKED
           )
           DELETE FROM ${table} AS row USING candidates
           WHERE row.ctid = candidates.ctid
           RETURNING 1`,
          [...ownerParams(owner), new Date(before).toISOString(), limit],
        );
        input.signal?.throwIfAborted();
        return { deleted: rowCount(deleted) };
      } catch (error) {
        throw effectStoreError(error);
      }
    },
  };
}

/** Enterprise-wide retention cleanup, kept private to the existing state composition. */
export async function cleanupExpiredPostgresToolEffects(
  pool: Pool,
  schema: string,
  input: CleanupScope,
): Promise<{ readonly transitioned: number; readonly removed: number }> {
  const table = qualifyTable(schema, "prism_tool_effects");
  const owner = cleanupScope(input);
  const transitioned = await pool.query(
    `WITH candidates AS (
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4
         AND status IN ('pending', 'dispatched') AND expires_at <= clock_timestamp()
       ORDER BY expires_at ASC, effect_key ASC
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     UPDATE ${table} AS row
     SET status = CASE row.status WHEN 'pending' THEN 'failed_retryable' ELSE 'unknown' END,
         version = row.version + 1, claim_token = NULL, result = NULL, result_ref = NULL,
         failure = COALESCE(row.failure, jsonb_build_object('code', 'ERR_PRISM_TOOL_EFFECT_EXPIRED')),
         updated_at = clock_timestamp(), expires_at = NULL
     FROM candidates
     WHERE row.ctid = candidates.ctid
     RETURNING 1`,
    cleanupParams(owner),
  );
  const remaining = owner.limit - rowCount(transitioned);
  if (remaining <= 0) return { transitioned: rowCount(transitioned), removed: 0 };
  const removed = await pool.query(
    `WITH candidates AS (
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4
         AND status IN ('completed', 'failed_terminal') AND expires_at <= clock_timestamp()
       ORDER BY expires_at ASC, effect_key ASC
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ${table} AS row USING candidates
     WHERE row.ctid = candidates.ctid
     RETURNING 1`,
    cleanupParams({ ...owner, limit: remaining }),
  );
  return { transitioned: rowCount(transitioned), removed: rowCount(removed) };
}

async function insertClaim(pool: Pool, table: string, context: EffectContext, claimTtlMs: number): Promise<ToolEffectRecord | undefined> {
  const inserted = await pool.query(
    `INSERT INTO ${table}
       (tenant_id, account_key, user_key, principal_id, effect_key, session_id, run_id, tool_call_id, tool_name, arguments_hash,
        status, attempt, version, claim_token, result, result_ref, failure, created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             'pending', 1, 1, $11, NULL, NULL, NULL, clock_timestamp(), clock_timestamp(), clock_timestamp() + $12 * INTERVAL '1 millisecond')
     ON CONFLICT DO NOTHING
     RETURNING ${RECORD_COLUMNS}`,
    [...contextParams(context), randomUUID(), claimTtlMs],
  );
  return inserted.rows[0] ? rowToRecord(inserted.rows[0], context) : undefined;
}

async function reclaimRetryable(
  pool: Pool,
  table: string,
  context: EffectContext,
  claimTtlMs: number,
  maxAttempts: number,
): Promise<ToolEffectRecord | undefined> {
  const reclaimed = await pool.query(
    `UPDATE ${table}
     SET status = 'pending', attempt = attempt + 1, version = version + 1, claim_token = $1, result = NULL, result_ref = NULL, failure = NULL,
         updated_at = clock_timestamp(), expires_at = clock_timestamp() + $2 * INTERVAL '1 millisecond'
     WHERE ${where(3)} AND status = 'failed_retryable' AND attempt < $13
     RETURNING ${RECORD_COLUMNS}`,
    [randomUUID(), claimTtlMs, ...contextParams(context), maxAttempts],
  );
  return reclaimed.rows[0] ? rowToRecord(reclaimed.rows[0], context) : undefined;
}

async function expireClaim(pool: Pool, table: string, context: EffectContext): Promise<void> {
  await pool.query(
    `UPDATE ${table}
     SET status = CASE status WHEN 'pending' THEN 'failed_retryable' ELSE 'unknown' END,
         version = version + 1, claim_token = NULL, result = NULL, result_ref = NULL,
         failure = COALESCE(failure, jsonb_build_object('code', 'ERR_PRISM_TOOL_EFFECT_EXPIRED')),
         updated_at = clock_timestamp(), expires_at = NULL
     WHERE ${where(1)} AND status IN ('pending', 'dispatched') AND expires_at <= clock_timestamp()`,
    contextParams(context),
  );
}

async function readRecord(pool: Pool, table: string, context: EffectContext): Promise<ToolEffectRecord | undefined> {
  const result = await pool.query(
    `SELECT ${RECORD_COLUMNS} FROM ${table}
     WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND effect_key = $5`,
    contextParams(context).slice(0, 5),
  );
  return result.rows[0] ? rowToRecord(result.rows[0], context) : undefined;
}

function effectContext(input: ToolEffectKey): EffectContext {
  input.signal?.throwIfAborted();
  assertIdentityActive(input.identity);
  const owner = effectOwner(input.ownership);
  assertIdentityMatchesOwnership(input.identity, input.ownership);
  if (
    input.identity.tenantId !== owner.tenantId ||
    input.identity.accountId !== owner.accountId ||
    input.identity.userId !== owner.userId
  ) {
    throw conflict();
  }
  return {
    owner,
    principalId: inputText(input.identity.principal.id, "effect principal", MAX_IDENTIFIER_BYTES),
    key: inputText(input.key, "effect key", MAX_KEY_BYTES),
    sessionId: inputText(input.sessionId, "session id", MAX_IDENTIFIER_BYTES),
    runId: inputText(input.runId, "run id", MAX_IDENTIFIER_BYTES),
    toolCallId: inputText(input.toolCallId, "tool call id", MAX_IDENTIFIER_BYTES),
    toolName: inputText(input.toolName, "tool name", MAX_TOOL_NAME_BYTES),
    argumentsHash: argumentsHash(input.argumentsHash),
  };
}

function transitionContext(input: ToolEffectTransition): EffectContext {
  const context = effectContext(input);
  inputText(input.claimToken, "claim token", MAX_TOKEN_BYTES, "ERR_PRISM_TOOL_EFFECT_CONFLICT");
  version(input.expectedVersion);
  return context;
}

function contextParams(context: EffectContext): [string, string, string, string, string, string, string, string, string, string] {
  return [
    ...ownerParams(context.owner),
    context.principalId,
    context.key,
    context.sessionId,
    context.runId,
    context.toolCallId,
    context.toolName,
    context.argumentsHash,
  ];
}

function where(start: number): string {
  return `tenant_id = $${start} AND account_key = $${start + 1} AND user_key = $${start + 2} AND principal_id = $${start + 3}
    AND effect_key = $${start + 4} AND session_id = $${start + 5} AND run_id = $${start + 6} AND tool_call_id = $${start + 7}
    AND tool_name = $${start + 8} AND arguments_hash = $${start + 9}`;
}

function requireTransition(row: Record<string, unknown> | undefined, context: EffectContext): ToolEffectRecord {
  if (!row) throw conflict();
  return rowToRecord(row, context);
}

function rowToRecord(row: Record<string, unknown>, context: EffectContext): ToolEffectRecord {
  const tenantId = requiredText(row.tenant_id, "effect tenant");
  const accountId = normalizedOwner(row.account_key, "effect account");
  const userId = normalizedOwner(row.user_key, "effect user");
  const principalId = requiredText(row.principal_id, "effect principal", MAX_IDENTIFIER_BYTES);
  if (
    tenantId !== context.owner.tenantId ||
    accountId !== context.owner.accountId ||
    userId !== context.owner.userId ||
    principalId !== context.principalId
  ) {
    malformed("tool effect row ownership is invalid");
  }
  const record = {
    tenantId,
    ...(accountId === undefined ? {} : { accountId }),
    ...(userId === undefined ? {} : { userId }),
    key: inputText(row.effect_key, "effect key", MAX_KEY_BYTES),
    sessionId: inputText(row.session_id, "session id", MAX_IDENTIFIER_BYTES),
    runId: inputText(row.run_id, "run id", MAX_IDENTIFIER_BYTES),
    toolCallId: inputText(row.tool_call_id, "tool call id", MAX_IDENTIFIER_BYTES),
    toolName: inputText(row.tool_name, "tool name", MAX_TOOL_NAME_BYTES),
    argumentsHash: argumentsHash(row.arguments_hash),
    status: status(row.status),
    attempt: boundedInteger(row.attempt, "effect attempt", 1, HARD_MAX_ATTEMPTS),
    version: boundedInteger(row.version, "effect version", 1, Number.MAX_SAFE_INTEGER),
    ...(row.claim_token === null || row.claim_token === undefined
      ? {}
      : { claimToken: inputText(row.claim_token, "claim token", MAX_TOKEN_BYTES) }),
    ...(row.result === null || row.result === undefined ? {} : { result: resultValue(row.result, context) }),
    ...(row.result_ref === null || row.result_ref === undefined ? {} : { resultRef: validateReference(row.result_ref) }),
    ...(row.failure === null || row.failure === undefined ? {} : { failure: failureValue(row.failure) }),
    createdAt: asTimestamp(row.created_at, "effect createdAt"),
    updatedAt: asTimestamp(row.updated_at, "effect updatedAt"),
    ...(row.expires_at === null || row.expires_at === undefined ? {} : { expiresAt: asTimestamp(row.expires_at, "effect expiresAt") }),
  } satisfies ToolEffectRecord;
  if (
    record.key !== context.key ||
    record.sessionId !== context.sessionId ||
    record.runId !== context.runId ||
    record.toolCallId !== context.toolCallId ||
    record.toolName !== context.toolName ||
    record.argumentsHash !== context.argumentsHash
  ) {
    throw conflict();
  }
  assertRecord(record);
  return deepFreeze(record);
}

function assertRecord(record: ToolEffectRecord): void {
  if (
    (ACTIVE_STATUSES.has(record.status) &&
      (!record.claimToken || !record.expiresAt || record.result || record.resultRef || record.failure)) ||
    (!ACTIVE_STATUSES.has(record.status) && record.claimToken) ||
    (record.status === "unknown" && record.expiresAt !== undefined) ||
    (record.status === "completed" && record.expiresAt === undefined) ||
    (record.status === "failed_terminal" && record.expiresAt === undefined) ||
    (record.status !== "completed" && (record.result || record.resultRef))
  ) {
    malformed("tool effect row is invalid");
  }
  try {
    encodeBoundedJson(record, MAX_RECORD_BYTES, "tool effect record");
  } catch {
    malformed("tool effect record is invalid");
  }
}

function resultValue(value: unknown, context: EffectContext): ToolResult {
  try {
    return validateResult(decodeBoundedJson(value, MAX_RESULT_BYTES, "tool effect result") as ToolResult, context);
  } catch (error) {
    if (error instanceof ToolEffectError) malformed("tool effect result is invalid");
    throw error;
  }
}

function failureValue(value: unknown): { readonly code: string; readonly reference?: string } {
  try {
    return validateFailure(decodeBoundedJson(value, MAX_REFERENCE_BYTES * 2, "tool effect failure"));
  } catch (error) {
    if (error instanceof ToolEffectError) malformed("tool effect failure is invalid");
    throw error;
  }
}

function validateResult(value: ToolResult, context: Pick<EffectContext, "toolCallId" | "toolName">): ToolResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.toolCallId !== context.toolCallId ||
    value.name !== context.toolName
  ) {
    throw conflict();
  }
  try {
    encodeBoundedJson(value, MAX_RESULT_BYTES, "tool effect result");
  } catch (error) {
    if (error instanceof EnterprisePostgresError)
      throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "tool effect result exceeds limits");
    throw error;
  }
  return value;
}

function validateFailure(value: unknown): { readonly code: string; readonly reference?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "tool effect failure is required and bounded");
  const failure = value as { readonly code?: unknown; readonly reference?: unknown };
  const code = inputText(failure.code, "effect failure code", 128);
  const reference = failure.reference === undefined ? undefined : validateReference(failure.reference);
  if (!Object.keys(failure).every((key) => key === "code" || key === "reference")) {
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "tool effect failure is invalid");
  }
  return { code, ...(reference === undefined ? {} : { reference }) };
}

function validateReference(value: unknown): string {
  return inputText(value, "effect reference", MAX_REFERENCE_BYTES);
}

function claimTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_CLAIM_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > HARD_CLAIM_TTL_MS) {
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "claim TTL exceeds limits");
  }
  return ttl;
}

function maxAttemptsValue(value: number | undefined): number {
  const attempts = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > HARD_MAX_ATTEMPTS) {
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "effect attempts exceed limits");
  }
  return attempts;
}

function cleanupLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_CLEANUP_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_CLEANUP_LIMIT) {
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "cleanup limit exceeds limits");
  }
  return limit;
}

function failureStatus(value: unknown): "failed_retryable" | "failed_terminal" {
  if (value !== "failed_retryable" && value !== "failed_terminal") throw conflict();
  return value;
}

function resolutionStatus(value: unknown): "completed" | "failed_retryable" | "failed_terminal" {
  if (value !== "completed" && value !== "failed_retryable" && value !== "failed_terminal") throw conflict();
  return value;
}

function status(value: unknown): ToolEffectStatus {
  if (typeof value !== "string" || !STATUSES.has(value as ToolEffectStatus)) malformed("tool effect status is invalid");
  return value as ToolEffectStatus;
}

function argumentsHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "arguments hash is invalid");
  return value;
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw conflict();
  return value;
}

function boundedInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) malformed(`${label} is invalid`);
  return value;
}

function inputText(
  value: unknown,
  label: string,
  maxBytes: number,
  code: "ERR_PRISM_TOOL_EFFECT_LIMIT" | "ERR_PRISM_TOOL_EFFECT_CONFLICT" = "ERR_PRISM_TOOL_EFFECT_LIMIT",
): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ToolEffectError(code, `${label} is required and bounded`);
  }
  return value;
}

function normalizedOwner(value: unknown, label: string): string | undefined {
  if (value === "") return undefined;
  return requiredText(value, label);
}

function cleanupScope(input: CleanupScope): CleanupScope {
  const owner = requireStoreOwner(input);
  return {
    tenantId: owner.tenantId,
    ...(owner.accountId === undefined ? {} : { accountId: owner.accountId }),
    ...(owner.userId === undefined ? {} : { userId: owner.userId }),
    principalId: inputText(input.principalId, "effect principal", MAX_IDENTIFIER_BYTES),
    limit: cleanupLimit(input.limit),
  };
}

function cleanupParams(input: CleanupScope): [string, string, string, string, number] {
  return [input.tenantId, input.accountId ?? "", input.userId ?? "", input.principalId, input.limit];
}

function effectOwner(ownership: ToolEffectKey["ownership"]): StoreOwner {
  try {
    return requireStoreOwner(ownership);
  } catch (error) {
    if (error instanceof EnterprisePostgresError) {
      throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_CONFLICT", "tool effect ownership is required");
    }
    throw error;
  }
}

function effectStoreError(error: unknown): Error {
  return error instanceof ToolEffectError ? error : storeError(error);
}

function conflict(): ToolEffectError {
  return new ToolEffectError("ERR_PRISM_TOOL_EFFECT_CONFLICT", "tool effect transition conflict");
}

function malformed(message: string): never {
  throw new EnterprisePostgresError(message, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
}

function rowCount(result: { readonly rowCount: number | null; readonly rows: readonly unknown[] }): number {
  return result.rowCount ?? result.rows.length;
}
