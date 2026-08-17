import { assertIdentityActive } from "@arnilo/prism";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { decodeBoundedJson, encodeBoundedJson } from "./codecs.js";
import { EnterprisePostgresError } from "./errors.js";
import { validateIdentifier, qualifyTable } from "./identifiers.js";
import { asTimestamp, deepFreeze, requiredText, storeError } from "./records.js";
import type {
  ErpInboxRecordInput,
  ErpOutboxAppendInput,
  ErpOutboxClaimInput,
  ErpOutboxDeadLetterInput,
  ErpOutboxDispatcher,
  ErpOutboxRecord,
  ErpOutboxReplayInput,
  ErpOutboxRetryInput,
  ErpOutboxStatus,
  ErpOutboxStore,
  ErpOutboxTransitionInput,
  ErpOutboxUnknownInput,
  PostgresErpMessaging,
  PostgresErpMessagingOptions,
} from "./types.js";

const DEFAULT_BATCH_SIZE = 100;
const HARD_BATCH_SIZE = 1_000;
const DEFAULT_LEASE_TTL_MS = 30_000;
const HARD_LEASE_TTL_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const HARD_MAX_ATTEMPTS = 10;
const HARD_DELAY_MS = 60 * 60_000;
const MAX_ID_BYTES = 512;
const MAX_TOPIC_BYTES = 512;
const MAX_CONSUMER_BYTES = 512;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 4 * 1024;
const MAX_ACTION_REF_BYTES = 512;
const OUTBOX_COLUMNS = `tenant_id, message_id, topic, payload::text AS payload, status, attempt, version,
  claim_token, lease_expires_at, next_attempt_at, last_error::text AS last_error, last_action_ref,
  created_at, updated_at`;
const STATUSES = new Set<ErpOutboxStatus>(["pending", "dispatched", "retryable", "completed", "unknown", "dead_letter"]);

/** PostgreSQL transactional outbox/inbox plus bounded at-least-once dispatch. */
export function createPostgresErpMessaging(options: PostgresErpMessagingOptions): PostgresErpMessaging {
  if (!options?.pool) {
    throw new EnterprisePostgresError("pool is required", "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG");
  }
  const schema = options.schema ?? "prism";
  validateIdentifier(schema);
  const defaultMaxAttempts = maxAttempts(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const outboxTable = qualifyTable(schema, "prism_erp_outbox");
  const inboxTable = qualifyTable(schema, "prism_erp_inbox");

  const outbox: ErpOutboxStore = {
    append: (client, input) => append(client, outboxTable, input),
  };
  const inbox = {
    record: (client: PoolClient, input: ErpInboxRecordInput) => recordInbox(client, inboxTable, input),
  };
  const dispatcher: ErpOutboxDispatcher = {
    claim: (input) => claim(options.pool, outboxTable, input),
    acknowledge: (input) => acknowledge(options.pool, outboxTable, input),
    retry: (input) => retry(options.pool, outboxTable, input, defaultMaxAttempts),
    markUnknown: (input) => markUnknown(options.pool, outboxTable, input),
    deadLetter: (input) => deadLetter(options.pool, outboxTable, input),
    replay: (input) => replay(options.pool, outboxTable, input),
  };
  return { outbox, inbox, dispatcher };
}

async function append(client: PoolClient, table: string, input: ErpOutboxAppendInput): Promise<ErpOutboxRecord> {
  const context = appendContext(input);
  const payload = encodeBoundedJson(input.payload, MAX_PAYLOAD_BYTES, "ERP outbox payload");
  try {
    const inserted = await client.query(
      `INSERT INTO ${table}
         (tenant_id, message_id, topic, payload, status, attempt, version, claim_token, lease_expires_at,
          next_attempt_at, last_error, last_action_ref, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 'pending', 0, 1, NULL, NULL,
               clock_timestamp(), NULL, NULL, clock_timestamp(), clock_timestamp())
       ON CONFLICT (tenant_id, message_id) DO NOTHING
       RETURNING ${OUTBOX_COLUMNS}`,
      [context.tenantId, context.messageId, context.topic, payload],
    );
    if (inserted.rows[0]) return rowToRecord(inserted.rows[0]);

    const existing = await client.query(`SELECT ${OUTBOX_COLUMNS} FROM ${table} WHERE tenant_id = $1 AND message_id = $2`, [
      context.tenantId,
      context.messageId,
    ]);
    const row = existing.rows[0];
    if (!row) throw retryable("outbox conflict row could not be read");
    const record = rowToRecord(row);
    if (record.topic !== context.topic || !sameJson(record.payload, input.payload)) {
      throw conflict("message_id already contains a different outbox message");
    }
    return record;
  } catch (error) {
    throw messagingError(error);
  }
}

async function recordInbox(client: PoolClient, table: string, input: ErpInboxRecordInput): Promise<boolean> {
  const tenantId = text(input.tenantId, "ERP inbox tenant", MAX_ID_BYTES);
  const consumer = text(input.consumer, "ERP inbox consumer", MAX_CONSUMER_BYTES);
  const messageId = text(input.messageId, "ERP inbox message", MAX_ID_BYTES);
  try {
    const result = await client.query(
      `INSERT INTO ${table} (tenant_id, consumer, message_id, recorded_at)
       VALUES ($1, $2, $3, clock_timestamp())
       ON CONFLICT (tenant_id, consumer, message_id) DO NOTHING`,
      [tenantId, consumer, messageId],
    );
    return result.rowCount === 1;
  } catch (error) {
    throw messagingError(error);
  }
}

async function claim(pool: Pool, table: string, input: ErpOutboxClaimInput): Promise<readonly ErpOutboxRecord[]> {
  const tenantId = text(input.tenantId, "ERP outbox tenant", MAX_ID_BYTES);
  const batchSize = boundedInteger(input.batchSize ?? DEFAULT_BATCH_SIZE, "ERP outbox batch size", 1, HARD_BATCH_SIZE);
  const leaseTtlMs = boundedInteger(input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS, "ERP outbox lease TTL", 1, HARD_LEASE_TTL_MS);
  const attemptLimit = maxAttempts(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  input.signal?.throwIfAborted();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `WITH candidates AS (
         SELECT ctid FROM ${table}
         WHERE tenant_id = $1 AND status = 'dispatched' AND lease_expires_at <= CURRENT_TIMESTAMP
         ORDER BY lease_expires_at ASC, message_id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${table} AS row
       SET status = 'unknown', version = row.version + 1, claim_token = NULL, lease_expires_at = NULL,
           last_error = COALESCE(row.last_error, jsonb_build_object('code', 'ERR_PRISM_ERP_OUTBOX_LEASE_EXPIRED')),
           last_action_ref = 'system:lease-expired', updated_at = clock_timestamp()
       FROM candidates
       WHERE row.ctid = candidates.ctid`,
      [tenantId, batchSize],
    );
    await client.query(
      `WITH candidates AS (
         SELECT ctid FROM ${table}
         WHERE tenant_id = $1 AND status = 'retryable' AND attempt >= $2
         ORDER BY next_attempt_at ASC, message_id ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${table} AS row
       SET status = 'dead_letter', version = row.version + 1, claim_token = NULL, lease_expires_at = NULL,
           last_error = COALESCE(row.last_error, jsonb_build_object('code', 'ERR_PRISM_ERP_OUTBOX_RETRY_EXHAUSTED')),
           last_action_ref = 'system:retry-exhausted', updated_at = clock_timestamp()
       FROM candidates
       WHERE row.ctid = candidates.ctid`,
      [tenantId, attemptLimit, batchSize],
    );
    const claimToken = randomUUID();
    const result = await client.query(
      `WITH candidates AS (
         SELECT ctid FROM ${table}
         WHERE tenant_id = $1 AND status IN ('pending', 'retryable')
           AND next_attempt_at <= CURRENT_TIMESTAMP AND attempt < $5
         ORDER BY next_attempt_at ASC, created_at ASC, message_id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${table} AS row
       SET status = 'dispatched', attempt = row.attempt + 1, version = row.version + 1,
           claim_token = $3, lease_expires_at = CURRENT_TIMESTAMP + $4 * INTERVAL '1 millisecond',
           updated_at = clock_timestamp()
       FROM candidates
       WHERE row.ctid = candidates.ctid
       RETURNING ${OUTBOX_COLUMNS}`,
      [tenantId, batchSize, claimToken, leaseTtlMs, attemptLimit],
    );
    await client.query("COMMIT");
    return result.rows.map((row) => rowToRecord(row));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original dispatch error.
    }
    throw messagingError(error);
  } finally {
    client.release();
  }
}

async function acknowledge(pool: Pool, table: string, input: ErpOutboxTransitionInput): Promise<ErpOutboxRecord> {
  const context = transitionContext(input);
  try {
    const result = await pool.query(
      `UPDATE ${table}
       SET status = 'completed', version = version + 1, claim_token = NULL, lease_expires_at = NULL,
           last_error = NULL, updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND message_id = $2 AND status = 'dispatched'
         AND claim_token = $3 AND version = $4
       RETURNING ${OUTBOX_COLUMNS}`,
      [context.tenantId, context.messageId, context.claimToken, context.expectedVersion],
    );
    return requireTransition(result.rows[0]);
  } catch (error) {
    throw messagingError(error);
  }
}

async function retry(pool: Pool, table: string, input: ErpOutboxRetryInput, defaultMaxAttempts: number): Promise<ErpOutboxRecord> {
  const context = transitionContext(input);
  const error = input.error === undefined ? null : encodeBoundedJson(input.error, MAX_ERROR_BYTES, "ERP outbox error");
  const delayMs = boundedInteger(input.delayMs ?? 0, "ERP outbox retry delay", 0, HARD_DELAY_MS);
  const maxAttempts = maxAttemptsValue(input.maxAttempts, defaultMaxAttempts);
  try {
    const result = await pool.query(
      `UPDATE ${table}
       SET status = CASE WHEN attempt >= $5 THEN 'dead_letter' ELSE 'retryable' END,
           version = version + 1, claim_token = NULL, lease_expires_at = NULL,
           next_attempt_at = CASE WHEN attempt >= $5 THEN clock_timestamp()
                                  ELSE clock_timestamp() + $6 * INTERVAL '1 millisecond' END,
           last_error = $7::jsonb,
           last_action_ref = CASE WHEN attempt >= $5 THEN 'system:retry-exhausted' ELSE last_action_ref END,
           updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND message_id = $2 AND status = 'dispatched'
         AND claim_token = $3 AND version = $4
       RETURNING ${OUTBOX_COLUMNS}`,
      [context.tenantId, context.messageId, context.claimToken, context.expectedVersion, maxAttempts, delayMs, error],
    );
    return requireTransition(result.rows[0]);
  } catch (error) {
    throw messagingError(error);
  }
}

async function markUnknown(pool: Pool, table: string, input: ErpOutboxUnknownInput): Promise<ErpOutboxRecord> {
  const context = transitionContext(input);
  const error = input.error === undefined ? null : encodeBoundedJson(input.error, MAX_ERROR_BYTES, "ERP outbox unknown error");
  try {
    const result = await pool.query(
      `UPDATE ${table}
       SET status = 'unknown', version = version + 1, claim_token = NULL, lease_expires_at = NULL,
           next_attempt_at = clock_timestamp(), last_error = COALESCE($5::jsonb, last_error),
           last_action_ref = 'system:unknown', updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND message_id = $2 AND status = 'dispatched'
         AND claim_token = $3 AND version = $4
       RETURNING ${OUTBOX_COLUMNS}`,
      [context.tenantId, context.messageId, context.claimToken, context.expectedVersion, error],
    );
    return requireTransition(result.rows[0]);
  } catch (error) {
    throw messagingError(error);
  }
}

async function deadLetter(pool: Pool, table: string, input: ErpOutboxDeadLetterInput): Promise<ErpOutboxRecord> {
  const tenantId = text(input.tenantId, "ERP outbox tenant", MAX_ID_BYTES);
  const messageId = text(input.messageId, "ERP outbox message", MAX_ID_BYTES);
  const expectedVersion = version(input.expectedVersion);
  const auditRef = actionRef(input.auditRef);
  const claimToken = input.claimToken === undefined ? null : text(input.claimToken, "ERP outbox claim token", MAX_ID_BYTES);
  assertIdentityActive(input.authorizedBy, { expectedTenantId: tenantId });
  input.signal?.throwIfAborted();
  try {
    const result = await pool.query(
      `UPDATE ${table}
       SET status = 'dead_letter', version = version + 1, claim_token = NULL, lease_expires_at = NULL,
           last_error = COALESCE(last_error, jsonb_build_object('code', 'ERR_PRISM_ERP_OUTBOX_DEAD_LETTER')),
           last_action_ref = $5, updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND message_id = $2 AND version = $3
         AND (($4::text IS NOT NULL AND status = 'dispatched' AND claim_token = $4)
           OR ($4::text IS NULL AND status IN ('pending', 'retryable', 'unknown')))
       RETURNING ${OUTBOX_COLUMNS}`,
      [tenantId, messageId, expectedVersion, claimToken, auditRef],
    );
    return requireTransition(result.rows[0]);
  } catch (error) {
    throw messagingError(error);
  }
}

async function replay(pool: Pool, table: string, input: ErpOutboxReplayInput): Promise<ErpOutboxRecord> {
  const tenantId = text(input.tenantId, "ERP outbox tenant", MAX_ID_BYTES);
  const messageId = text(input.messageId, "ERP outbox message", MAX_ID_BYTES);
  const expectedVersion = version(input.expectedVersion);
  const auditRef = actionRef(input.auditRef);
  assertIdentityActive(input.authorizedBy, { expectedTenantId: tenantId });
  input.signal?.throwIfAborted();
  try {
    const result = await pool.query(
      `UPDATE ${table}
       SET status = 'pending', attempt = 0, version = version + 1, claim_token = NULL, lease_expires_at = NULL,
           next_attempt_at = clock_timestamp(), last_error = NULL, last_action_ref = $4, updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND message_id = $2 AND version = $3 AND status IN ('unknown', 'dead_letter')
       RETURNING ${OUTBOX_COLUMNS}`,
      [tenantId, messageId, expectedVersion, auditRef],
    );
    return requireTransition(result.rows[0]);
  } catch (error) {
    throw messagingError(error);
  }
}

function appendContext(input: ErpOutboxAppendInput): { readonly tenantId: string; readonly messageId: string; readonly topic: string } {
  return {
    tenantId: text(input.tenantId, "ERP outbox tenant", MAX_ID_BYTES),
    messageId: text(input.messageId, "ERP outbox message", MAX_ID_BYTES),
    topic: text(input.topic, "ERP outbox topic", MAX_TOPIC_BYTES),
  };
}

function transitionContext(input: ErpOutboxTransitionInput): ErpOutboxTransitionInput {
  input.signal?.throwIfAborted();
  return {
    tenantId: text(input.tenantId, "ERP outbox tenant", MAX_ID_BYTES),
    messageId: text(input.messageId, "ERP outbox message", MAX_ID_BYTES),
    claimToken: text(input.claimToken, "ERP outbox claim token", MAX_ID_BYTES),
    expectedVersion: version(input.expectedVersion),
    signal: input.signal,
  };
}

function rowToRecord(row: Record<string, unknown>): ErpOutboxRecord {
  const record = {
    tenantId: requiredText(row.tenant_id, "ERP outbox tenant", MAX_ID_BYTES),
    messageId: requiredText(row.message_id, "ERP outbox message", MAX_ID_BYTES),
    topic: requiredText(row.topic, "ERP outbox topic", MAX_TOPIC_BYTES),
    payload: decodeBoundedJson(row.payload, MAX_PAYLOAD_BYTES, "ERP outbox payload"),
    status: status(row.status),
    attempt: boundedInteger(row.attempt, "ERP outbox attempt", 0, Number.MAX_SAFE_INTEGER),
    version: boundedInteger(row.version, "ERP outbox version", 1, Number.MAX_SAFE_INTEGER),
    ...(row.claim_token === null || row.claim_token === undefined
      ? {}
      : { claimToken: requiredText(row.claim_token, "ERP outbox claim token", MAX_ID_BYTES) }),
    ...(row.lease_expires_at === null || row.lease_expires_at === undefined
      ? {}
      : { leaseExpiresAt: asTimestamp(row.lease_expires_at, "ERP outbox lease") }),
    nextAttemptAt: asTimestamp(row.next_attempt_at, "ERP outbox next attempt"),
    ...(row.last_error === null || row.last_error === undefined
      ? {}
      : { lastError: decodeBoundedJson(row.last_error, MAX_ERROR_BYTES, "ERP outbox error") }),
    ...(row.last_action_ref === null || row.last_action_ref === undefined
      ? {}
      : { lastActionRef: requiredText(row.last_action_ref, "ERP outbox action reference", MAX_ACTION_REF_BYTES) }),
    createdAt: asTimestamp(row.created_at, "ERP outbox createdAt"),
    updatedAt: asTimestamp(row.updated_at, "ERP outbox updatedAt"),
  } satisfies ErpOutboxRecord;
  if ((record.status === "dispatched") !== Boolean(record.claimToken && record.leaseExpiresAt))
    malformed("ERP outbox claim state is invalid");
  return deepFreeze(record);
}

function requireTransition(row: Record<string, unknown> | undefined): ErpOutboxRecord {
  if (!row) throw conflict("ERP outbox transition lost its claim or revision");
  return rowToRecord(row);
}

function status(value: unknown): ErpOutboxStatus {
  if (typeof value === "string" && STATUSES.has(value as ErpOutboxStatus)) return value as ErpOutboxStatus;
  malformed("ERP outbox status is invalid");
}

function text(value: unknown, label: string, maxBytes: number): string {
  return requiredText(value, label, maxBytes);
}

function version(value: unknown): number {
  return boundedInteger(value, "ERP outbox version", 1, Number.MAX_SAFE_INTEGER);
}

function maxAttempts(value: unknown): number {
  return boundedInteger(value, "ERP outbox max attempts", 1, HARD_MAX_ATTEMPTS);
}

function maxAttemptsValue(value: number | undefined, fallback: number): number {
  return maxAttempts(value ?? fallback);
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new EnterprisePostgresError(`${label} is out of range`, "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS");
  }
  return Number(value);
}

function actionRef(value: unknown): string {
  const ref = text(value, "ERP outbox audit reference", MAX_ACTION_REF_BYTES);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(ref)) {
    throw new EnterprisePostgresError("ERP outbox audit reference is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS");
  }
  return ref;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function conflict(message: string): never {
  throw new EnterprisePostgresError(message, "ERR_PRISM_ENTERPRISE_POSTGRES_CONFLICT");
}

function retryable(message: string): never {
  throw new EnterprisePostgresError(message, "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
}

function malformed(message: string): never {
  throw new EnterprisePostgresError(message, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
}

function messagingError(error: unknown): EnterprisePostgresError {
  if (error instanceof EnterprisePostgresError) return error;
  return storeError(error);
}
