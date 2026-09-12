import type { Pool } from "pg";
import { ModelRouterError, type ModelRouterStateStore } from "../../../governance/model-router/index.js";
import { EnterprisePostgresError } from "../errors.js";
import {
  budgetValue,
  finiteNumber,
  integer,
  MAX_INTEGER,
  positiveInteger,
  type RouterContext,
  rateParams,
  routerContext,
  routerStoreError,
  usage,
  validateRateRow,
  window,
} from "./util.js";

export async function consumeRate(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["consumeRate"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["consumeRate"]>>> {
  const context = routerContext(input.key);
  const maxRequests = positiveInteger(input.maxRequests, "rate maxRequests", MAX_INTEGER);
  const windowMs = window(input.windowMs);
  try {
    const updated = await pool.query(
      `INSERT INTO ${table} AS row
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
       RETURNING request_count, window_started_at, last_used_at, expires_at, (xmax = 0) AS inserted`,
      [...rateParams(context, windowMs), maxRequests],
    );
    if (updated.rows[0]) {
      validateRateRow(updated.rows[0]);
      if (updated.rows[0].inserted === true) await enforceRateCapacity(pool, table, input.maxRateKeys, context, windowMs);
      return { admitted: true };
    }
    const denied = await pool.query(
      `UPDATE ${table}
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
}

export async function readBudget(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["readBudget"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["readBudget"]>>> {
  const context = routerContext(input.key);
  const windowMs = window(input.windowMs);
  try {
    const result = await pool.query(
      `INSERT INTO ${table} AS row
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
       RETURNING tokens, cost_usd, window_started_at, last_used_at, expires_at, (xmax = 0) AS inserted`,
      rateParams(context, windowMs),
    );
    const value = budgetValue(result.rows[0]);
    if (result.rows[0]?.inserted === true) await enforceBudgetCapacity(pool, table, input.maxBudgetKeys, context, windowMs);
    return value;
  } catch (error) {
    throw routerStoreError(error);
  }
}

export async function addUsage(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["addUsage"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["addUsage"]>>> {
  const context = routerContext(input.key);
  const windowMs = window(input.windowMs);
  const tokens = usage(input.tokens, "tokens");
  const costUsd = usage(input.costUsd, "costUsd");
  try {
    const result = await pool.query(
      `INSERT INTO ${table} AS row
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
       RETURNING tokens, cost_usd, window_started_at, last_used_at, expires_at, (xmax = 0) AS inserted`,
      [...rateParams(context, windowMs), tokens, costUsd],
    );
    if (!result.rows[0]) throw new ModelRouterError("router budget exceeds finite range", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    budgetValue(result.rows[0]);
    if (result.rows[0]?.inserted === true) await enforceBudgetCapacity(pool, table, input.maxBudgetKeys, context, windowMs);
  } catch (error) {
    throw routerStoreError(error);
  }
}

/** Hard map cap: evict the LRU rate row (no pinning) when a new key would exceed the cap. */
export async function enforceRateCapacity(
  pool: Pool,
  table: string,
  maxKeys: number | undefined,
  exclude: RouterContext,
  windowMs: number,
): Promise<void> {
  if (maxKeys === undefined) return;
  const count = await pool.query(`SELECT count(*) AS count FROM ${table}`);
  if (integer(count.rows[0]?.count, "router rate count", 0, MAX_INTEGER) < maxKeys) return;
  const evicted = await pool.query(
    `WITH candidate AS (
       SELECT ctid FROM ${table}
       WHERE NOT (tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = $5 AND model = $6 AND window_ms = $7)
       ORDER BY last_used_at ASC, tenant_id ASC, account_key ASC, user_key ASC, principal_id ASC, provider ASC, model ASC, window_ms ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ${table} AS row
     USING candidate
     WHERE row.ctid = candidate.ctid
     RETURNING 1`,
    rateParams(exclude, windowMs),
  );
  if (!evicted.rows[0]) throw new ModelRouterError("router state capacity exhausted", "ERR_PRISM_MODEL_ROUTER_STATE");
}

/** Hard map cap: evict the LRU budget row without active reservations; a held reservation's row is never evicted. */
export async function enforceBudgetCapacity(
  pool: Pool,
  table: string,
  maxKeys: number | undefined,
  exclude: RouterContext,
  windowMs: number,
): Promise<void> {
  if (maxKeys === undefined) return;
  const count = await pool.query(`SELECT count(*) AS count FROM ${table}`);
  if (integer(count.rows[0]?.count, "router budget count", 0, MAX_INTEGER) < maxKeys) return;
  const evicted = await pool.query(
    `WITH candidate AS (
       SELECT ctid FROM ${table}
       WHERE reservations = '[]'::jsonb
         AND NOT (tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = $5 AND model = $6 AND window_ms = $7)
       ORDER BY last_used_at ASC, tenant_id ASC, account_key ASC, user_key ASC, principal_id ASC, provider ASC, model ASC, window_ms ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ${table} AS row
     USING candidate
     WHERE row.ctid = candidate.ctid
     RETURNING 1`,
    rateParams(exclude, windowMs),
  );
  if (!evicted.rows[0]) throw new ModelRouterError("router state capacity exhausted", "ERR_PRISM_MODEL_ROUTER_STATE");
}
