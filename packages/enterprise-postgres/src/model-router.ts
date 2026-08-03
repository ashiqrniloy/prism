import { randomUUID } from "node:crypto";
import {
  ModelRouterError,
  type ModelRouterStateKey,
  type ModelRouterStateOwner,
  type ModelRouterStateStore,
} from "@arnilo/prism-model-router";
import type { Pool, PoolClient } from "pg";
import { EnterprisePostgresError } from "./errors.js";
import { qualifyTable } from "./identifiers.js";
import { asTimestamp, ownerParams, requireStoreOwner, requiredText, storeError, type StoreOwner } from "./records.js";

const MAX_KEY_BYTES = 512;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60_000;
const MAX_INTEGER = 2_147_483_647;
const MAX_TRANSACTION_ATTEMPTS = 3;
const DEFAULT_CLEANUP_LIMIT = 100;
const HARD_CLEANUP_LIMIT = 500;
// ponytail: fixed 24h closed-state retention; expose a router TTL only if operators need a different bound.
const CIRCUIT_IDLE_TTL_MS = 24 * 60 * 60_000;
const EPOCH = new Date(0);

interface RouterContext {
  readonly owner: StoreOwner;
  readonly principalId: string;
  readonly provider: string;
  readonly model: string;
}

interface CircuitRow {
  readonly failures: number;
  readonly coolDownMs: number;
  readonly openUntil: Date;
  readonly probeToken?: string;
  readonly probeExpiresAt?: Date;
  readonly lastUsedAt: Date;
  readonly expiresAt?: Date;
}

/** Durable PostgreSQL implementation of the model-router atomic state contract. */
export function createPostgresModelRouterStateStore(pool: Pool, schema: string): ModelRouterStateStore {
  const rates = qualifyTable(schema, "prism_model_router_rates");
  const budgets = qualifyTable(schema, "prism_model_router_budgets");
  const circuits = qualifyTable(schema, "prism_model_router_circuits");

  return {
    async consumeRate(input) {
      const context = routerContext(input.key);
      const maxRequests = positiveInteger(input.maxRequests, "rate maxRequests", MAX_INTEGER);
      const windowMs = window(input.windowMs);
      try {
        const updated = await pool.query(
          `INSERT INTO ${rates} AS row
             (tenant_id, account_key, user_key, principal_id, provider, model, window_ms,
              window_started_at, request_count, last_used_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(), 1, clock_timestamp(),
                   clock_timestamp() + $7::bigint * INTERVAL '1 millisecond')
           ON CONFLICT (tenant_id, account_key, user_key, principal_id, provider, model, window_ms) DO UPDATE
           SET window_started_at = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN clock_timestamp() ELSE row.window_started_at END,
               request_count = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN 1 ELSE row.request_count + 1 END,
               last_used_at = clock_timestamp(),
               expires_at = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN clock_timestamp() + row.window_ms * INTERVAL '1 millisecond' ELSE row.expires_at END
           WHERE row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
              OR row.request_count < $8
           RETURNING request_count, window_started_at, last_used_at, expires_at`,
          [...rateParams(context, windowMs), maxRequests],
        );
        if (updated.rows[0]) {
          validateRateRow(updated.rows[0]);
          return { admitted: true };
        }
        const denied = await pool.query(
          `UPDATE ${rates}
           SET last_used_at = clock_timestamp()
           WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4
             AND provider = $5 AND model = $6 AND window_ms = $7
           RETURNING request_count, window_started_at, last_used_at, expires_at,
                     EXTRACT(EPOCH FROM (window_started_at + window_ms * INTERVAL '1 millisecond' - clock_timestamp())) * 1000
                       AS retry_after_ms`,
          rateParams(context, windowMs),
        );
        if (!denied.rows[0]) {
          throw new EnterprisePostgresError("router rate state disappeared", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
        }
        validateRateRow(denied.rows[0]);
        return { admitted: false, retryAfterMs: Math.max(1, Math.ceil(finiteNumber(denied.rows[0]?.retry_after_ms, "rate retry"))) };
      } catch (error) {
        throw routerStoreError(error);
      }
    },

    async readBudget(input) {
      const context = routerContext(input.key);
      const windowMs = window(input.windowMs);
      try {
        const result = await pool.query(
          `INSERT INTO ${budgets} AS row
             (tenant_id, account_key, user_key, principal_id, provider, model, window_ms,
              window_started_at, tokens, cost_usd, last_used_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(), 0, 0, clock_timestamp(),
                   clock_timestamp() + $7::bigint * INTERVAL '1 millisecond')
           ON CONFLICT (tenant_id, account_key, user_key, principal_id, provider, model, window_ms) DO UPDATE
           SET window_started_at = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN clock_timestamp() ELSE row.window_started_at END,
               tokens = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN 0 ELSE row.tokens END,
               cost_usd = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN 0 ELSE row.cost_usd END,
               last_used_at = clock_timestamp(),
               expires_at = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN clock_timestamp() + row.window_ms * INTERVAL '1 millisecond' ELSE row.expires_at END
           RETURNING tokens, cost_usd, window_started_at, last_used_at, expires_at`,
          rateParams(context, windowMs),
        );
        return budgetValue(result.rows[0]);
      } catch (error) {
        throw routerStoreError(error);
      }
    },

    async addUsage(input) {
      const context = routerContext(input.key);
      const windowMs = window(input.windowMs);
      const tokens = usage(input.tokens, "tokens");
      const costUsd = usage(input.costUsd, "costUsd");
      try {
        const result = await pool.query(
          `INSERT INTO ${budgets} AS row
             (tenant_id, account_key, user_key, principal_id, provider, model, window_ms,
              window_started_at, tokens, cost_usd, last_used_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(), $8, $9, clock_timestamp(),
                   clock_timestamp() + $7::bigint * INTERVAL '1 millisecond')
           ON CONFLICT (tenant_id, account_key, user_key, principal_id, provider, model, window_ms) DO UPDATE
           SET window_started_at = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN clock_timestamp() ELSE row.window_started_at END,
               tokens = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond'
                   <= clock_timestamp() THEN EXCLUDED.tokens ELSE row.tokens + EXCLUDED.tokens END,
               cost_usd = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond'
                   <= clock_timestamp() THEN EXCLUDED.cost_usd ELSE row.cost_usd + EXCLUDED.cost_usd END,
               last_used_at = clock_timestamp(),
               expires_at = CASE
                 WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                 THEN clock_timestamp() + row.window_ms * INTERVAL '1 millisecond' ELSE row.expires_at END
           WHERE (CASE WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                    THEN EXCLUDED.tokens ELSE row.tokens + EXCLUDED.tokens END) >= 0
             AND (CASE WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                    THEN EXCLUDED.tokens ELSE row.tokens + EXCLUDED.tokens END) < 'Infinity'::double precision
             AND (CASE WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                    THEN EXCLUDED.cost_usd ELSE row.cost_usd + EXCLUDED.cost_usd END) >= 0
             AND (CASE WHEN row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()
                    THEN EXCLUDED.cost_usd ELSE row.cost_usd + EXCLUDED.cost_usd END) < 'Infinity'::double precision
           RETURNING tokens, cost_usd, window_started_at, last_used_at, expires_at`,
          [...rateParams(context, windowMs), tokens, costUsd],
        );
        if (!result.rows[0]) throw new ModelRouterError("router budget exceeds finite range", "ERR_PRISM_MODEL_ROUTER_BUDGET");
        budgetValue(result.rows[0]);
      } catch (error) {
        throw routerStoreError(error);
      }
    },

    async claimCircuitProbe(input) {
      const context = routerContext(input.key);
      positiveInteger(input.failureThreshold, "circuit failureThreshold", MAX_INTEGER);
      const coolDownMs = window(input.coolDownMs);
      const maxKeys = positiveInteger(input.maxKeys, "circuit maxKeys", 16_384);
      try {
        return await withTransaction(pool, async (client) => {
          const now = await databaseNow(client);
          let row = await selectCircuit(client, circuits, context);
          if (!row) {
            await ensureCircuitCapacity(client, circuits, maxKeys, now);
            await insertCircuit(client, circuits, context, {
              failures: 0,
              coolDownMs,
              openUntil: EPOCH,
              lastUsedAt: now,
              expiresAt: addMs(now, CIRCUIT_IDLE_TTL_MS),
            });
            row = await selectCircuit(client, circuits, context);
            if (!row) throw new EnterprisePostgresError("router circuit state disappeared", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
          }
          if (row.probeToken && row.probeExpiresAt && row.probeExpiresAt <= now) {
            row = await updateCircuit(client, circuits, context, {
              ...row,
              coolDownMs,
              openUntil: addMs(now, coolDownMs),
              probeToken: undefined,
              probeExpiresAt: undefined,
              lastUsedAt: now,
              expiresAt: undefined,
            });
          }
          if (row.openUntil > now || row.probeToken) {
            await updateCircuit(client, circuits, context, { ...row, lastUsedAt: now });
            return { admitted: false };
          }
          if (row.openUntil > EPOCH) {
            const probeToken = randomUUID();
            await updateCircuit(client, circuits, context, {
              ...row,
              probeToken,
              probeExpiresAt: addMs(now, coolDownMs),
              lastUsedAt: now,
              expiresAt: undefined,
            });
            return { admitted: true, probeToken };
          }
          await updateCircuit(client, circuits, context, {
            ...row,
            coolDownMs,
            lastUsedAt: now,
            expiresAt: addMs(now, CIRCUIT_IDLE_TTL_MS),
          });
          return { admitted: true };
        });
      } catch (error) {
        throw routerStoreError(error);
      }
    },

    async recordCircuitOutcome(input) {
      const context = routerContext(input.key);
      const failureThreshold = positiveInteger(input.failureThreshold, "circuit failureThreshold", MAX_INTEGER);
      const coolDownMs = window(input.coolDownMs);
      const maxKeys = positiveInteger(input.maxKeys, "circuit maxKeys", 16_384);
      const probeToken = input.probeToken === undefined ? undefined : text(input.probeToken, "circuit probe token", 128);
      try {
        await withTransaction(pool, async (client) => {
          const now = await databaseNow(client);
          let row = await selectCircuit(client, circuits, context);
          if (!row) {
            await ensureCircuitCapacity(client, circuits, maxKeys, now);
            const failures = input.success ? 0 : 1;
            await insertCircuit(client, circuits, context, {
              failures,
              coolDownMs,
              openUntil: input.success || failures < failureThreshold ? EPOCH : addMs(now, coolDownMs),
              lastUsedAt: now,
              expiresAt: input.success || failures < failureThreshold ? addMs(now, CIRCUIT_IDLE_TTL_MS) : undefined,
            });
            return;
          }
          if (row.probeToken) {
            if (probeToken !== row.probeToken || !row.probeExpiresAt || row.probeExpiresAt <= now) return;
            row = { ...row, probeToken: undefined, probeExpiresAt: undefined };
          } else if (probeToken) {
            return;
          }
          const failures = input.success ? 0 : positiveInteger(row.failures + 1, "circuit failures", MAX_INTEGER);
          await updateCircuit(client, circuits, context, {
            ...row,
            failures,
            coolDownMs,
            openUntil: input.success || failures < failureThreshold ? EPOCH : addMs(now, coolDownMs),
            lastUsedAt: now,
            expiresAt: input.success || failures < failureThreshold ? addMs(now, CIRCUIT_IDLE_TTL_MS) : undefined,
          });
        });
      } catch (error) {
        throw routerStoreError(error);
      }
    },

    async cleanup(input) {
      const owner = routerOwner(input.owner);
      const limit = cleanupLimit(input.limit);
      try {
        const reopened = await reopenExpiredProbes(pool, circuits, owner, limit);
        let remaining = limit - reopened;
        let removed = 0;
        if (remaining > 0) {
          removed += await deleteExpiredRouterRows(pool, rates, owner, remaining, "last_used_at, provider, model, window_ms");
          remaining = limit - reopened - removed;
        }
        if (remaining > 0) {
          removed += await deleteExpiredRouterRows(pool, budgets, owner, remaining, "last_used_at, provider, model, window_ms");
          remaining = limit - reopened - removed;
        }
        if (remaining > 0) {
          removed += await deleteExpiredRouterRows(
            pool,
            circuits,
            owner,
            remaining,
            "last_used_at, provider, model",
            "probe_token IS NULL AND open_until <= clock_timestamp()",
          );
        }
        return { removed };
      } catch (error) {
        throw routerStoreError(error);
      }
    },
  };
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    let client: PoolClient | undefined;
    let retry = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      lastError = error;
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve original failure; the client is released below.
        }
      }
      if (!serializationFailure(error) || attempt + 1 === MAX_TRANSACTION_ATTEMPTS) throw error;
      retry = true;
    } finally {
      client?.release();
    }
    if (retry) await retryDelay(attempt);
  }
  throw lastError;
}

function retryDelay(attempt: number): Promise<void> {
  const milliseconds = 2 ** attempt + Math.floor(Math.random() * 3);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query("SELECT clock_timestamp() AS now");
  return new Date(asTimestamp(result.rows[0]?.now, "router database time"));
}

async function selectCircuit(client: PoolClient, table: string, context: RouterContext): Promise<CircuitRow | undefined> {
  const result = await client.query(
    `SELECT failures, cool_down_ms, open_until, probe_token, probe_expires_at, last_used_at, expires_at
     FROM ${table}
     WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = $5 AND model = $6
     FOR UPDATE`,
    routerParams(context),
  );
  return result.rows[0] ? circuitValue(result.rows[0]) : undefined;
}

async function insertCircuit(
  client: PoolClient,
  table: string,
  context: RouterContext,
  row: Omit<CircuitRow, "probeToken" | "probeExpiresAt"> & Pick<Partial<CircuitRow>, "probeToken" | "probeExpiresAt">,
): Promise<void> {
  await client.query(
    `INSERT INTO ${table}
       (tenant_id, account_key, user_key, principal_id, provider, model, failures, cool_down_ms, open_until,
        probe_token, probe_expires_at, last_used_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT DO NOTHING`,
    [
      ...routerParams(context),
      row.failures,
      row.coolDownMs,
      row.openUntil,
      row.probeToken ?? null,
      row.probeExpiresAt ?? null,
      row.lastUsedAt,
      row.expiresAt ?? null,
    ],
  );
}

async function updateCircuit(client: PoolClient, table: string, context: RouterContext, row: CircuitRow): Promise<CircuitRow> {
  const result = await client.query(
    `UPDATE ${table}
     SET failures = $1, cool_down_ms = $2, open_until = $3, probe_token = $4, probe_expires_at = $5,
         last_used_at = $6, expires_at = $7
     WHERE tenant_id = $8 AND account_key = $9 AND user_key = $10 AND principal_id = $11 AND provider = $12 AND model = $13
     RETURNING failures, cool_down_ms, open_until, probe_token, probe_expires_at, last_used_at, expires_at`,
    [
      row.failures,
      row.coolDownMs,
      row.openUntil,
      row.probeToken ?? null,
      row.probeExpiresAt ?? null,
      row.lastUsedAt,
      row.expiresAt ?? null,
      ...routerParams(context),
    ],
  );
  if (!result.rows[0]) throw new EnterprisePostgresError("router circuit state disappeared", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
  return circuitValue(result.rows[0]);
}

async function ensureCircuitCapacity(client: PoolClient, table: string, maxKeys: number, now: Date): Promise<void> {
  const count = await client.query(`SELECT count(*) AS count FROM ${table}`);
  if (integer(count.rows[0]?.count, "router circuit count", 0, MAX_INTEGER) < maxKeys) return;
  const evicted = await client.query(
    `WITH candidate AS (
       SELECT ctid FROM ${table}
       WHERE probe_token IS NULL AND open_until <= $1 AND expires_at IS NOT NULL
       ORDER BY last_used_at ASC, tenant_id ASC, account_key ASC, user_key ASC, principal_id ASC, provider ASC, model ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ${table} AS row
     USING candidate
     WHERE row.ctid = candidate.ctid
     RETURNING 1`,
    [now],
  );
  if (!evicted.rows[0]) throw new ModelRouterError("router state capacity exhausted", "ERR_PRISM_MODEL_ROUTER_STATE");
}

async function reopenExpiredProbes(
  pool: Pool,
  table: string,
  owner: Pick<RouterContext, "owner" | "principalId">,
  limit: number,
): Promise<number> {
  if (limit === 0) return 0;
  const result = await pool.query(
    `WITH candidates AS (
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4
         AND probe_token IS NOT NULL AND probe_expires_at <= clock_timestamp()
       ORDER BY probe_expires_at ASC, provider ASC, model ASC
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     UPDATE ${table} AS row
     SET probe_token = NULL, probe_expires_at = NULL,
         open_until = clock_timestamp() + row.cool_down_ms * INTERVAL '1 millisecond',
         expires_at = NULL, last_used_at = clock_timestamp()
     FROM candidates
     WHERE row.ctid = candidates.ctid
     RETURNING 1`,
    [...ownerParams(owner.owner), owner.principalId, limit],
  );
  return result.rowCount ?? result.rows.length;
}

async function deleteExpiredRouterRows(
  pool: Pool,
  table: string,
  owner: Pick<RouterContext, "owner" | "principalId">,
  limit: number,
  order: string,
  extra = "TRUE",
): Promise<number> {
  if (limit === 0) return 0;
  const result = await pool.query(
    `WITH candidates AS (
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4
         AND expires_at <= clock_timestamp() AND ${extra}
       ORDER BY ${order}
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ${table} AS row
     USING candidates
     WHERE row.ctid = candidates.ctid
     RETURNING 1`,
    [...ownerParams(owner.owner), owner.principalId, limit],
  );
  return result.rowCount ?? result.rows.length;
}

function routerContext(key: ModelRouterStateKey): RouterContext {
  const owner = routerOwner(key);
  return {
    owner: owner.owner,
    principalId: owner.principalId,
    provider: text(key.provider, "router provider", MAX_KEY_BYTES),
    model: text(key.model, "router model", MAX_KEY_BYTES),
  };
}

function routerOwner(owner: ModelRouterStateOwner): Pick<RouterContext, "owner" | "principalId"> {
  try {
    return {
      owner: requireStoreOwner(owner),
      principalId: text(owner.principalId, "router principal", MAX_KEY_BYTES),
    };
  } catch {
    throw new ModelRouterError("router state owner is required and bounded", "ERR_PRISM_MODEL_ROUTER_STATE");
  }
}

function routerParams(context: RouterContext): [string, string, string, string, string, string] {
  return [...ownerParams(context.owner), context.principalId, context.provider, context.model];
}

function rateParams(context: RouterContext, windowMs: number): [string, string, string, string, string, string, number] {
  return [...routerParams(context), windowMs];
}

function text(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ModelRouterError(`${label} is required and bounded`, "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return value;
}

function window(value: unknown): number {
  return positiveInteger(value, "router window", MAX_WINDOW_MS);
}

function positiveInteger(value: unknown, label: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new ModelRouterError(`${label} is out of range`, "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return value;
}

function usage(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ModelRouterError(`${label} must be finite non-negative`, "ERR_PRISM_MODEL_ROUTER_BUDGET");
  }
  return value;
}

function cleanupLimit(value: unknown): number {
  const limit = value ?? DEFAULT_CLEANUP_LIMIT;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > HARD_CLEANUP_LIMIT) {
    throw new ModelRouterError("router cleanup limit out of range", "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return limit;
}

function budgetValue(row: Record<string, unknown> | undefined): { readonly tokens: number; readonly costUsd: number } {
  if (!row) throw new EnterprisePostgresError("router budget row is missing", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
  asTimestamp(row.window_started_at, "router budget window");
  asTimestamp(row.last_used_at, "router budget last use");
  asTimestamp(row.expires_at, "router budget expiry");
  return { tokens: storedUsage(row.tokens, "router budget tokens"), costUsd: storedUsage(row.cost_usd, "router budget cost") };
}

function validateRateRow(row: Record<string, unknown>): void {
  integer(row.request_count, "router rate count", 1, MAX_INTEGER);
  asTimestamp(row.window_started_at, "router rate window");
  asTimestamp(row.last_used_at, "router rate last use");
  asTimestamp(row.expires_at, "router rate expiry");
}

function circuitValue(row: Record<string, unknown>): CircuitRow {
  const probeToken =
    row.probe_token === null || row.probe_token === undefined ? undefined : requiredText(row.probe_token, "router probe token", 128);
  const probeExpiresAt =
    row.probe_expires_at === null || row.probe_expires_at === undefined
      ? undefined
      : new Date(asTimestamp(row.probe_expires_at, "router probe expiry"));
  const expiresAt =
    row.expires_at === null || row.expires_at === undefined ? undefined : new Date(asTimestamp(row.expires_at, "router expiry"));
  if (Boolean(probeToken) !== Boolean(probeExpiresAt)) {
    throw new EnterprisePostgresError("router probe row is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return {
    failures: integer(row.failures, "router failures", 0, MAX_INTEGER),
    coolDownMs: integer(row.cool_down_ms, "router cooldown", 1, MAX_WINDOW_MS),
    openUntil: new Date(asTimestamp(row.open_until, "router open until")),
    ...(probeToken === undefined ? {} : { probeToken }),
    ...(probeExpiresAt === undefined ? {} : { probeExpiresAt }),
    lastUsedAt: new Date(asTimestamp(row.last_used_at, "router last use")),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function storedUsage(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0) throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  return number;
}

function finiteNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  return number;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return number;
}

function addMs(date: Date, ms: number): Date {
  const value = date.getTime() + ms;
  if (!Number.isFinite(value)) throw new ModelRouterError("router timestamp exceeds range", "ERR_PRISM_MODEL_ROUTER_STATE");
  return new Date(value);
}

function serializationFailure(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && ["40001", "40P01"].includes(String(error.code)));
}

function routerStoreError(error: unknown): Error {
  if (error instanceof ModelRouterError || error instanceof EnterprisePostgresError) return error;
  return storeError(error);
}
