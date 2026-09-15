import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ModelRouterError, type ModelRouterStateStore } from "../../../governance/model-router/index.js";
import { EnterprisePostgresError } from "../errors.js";
import { enforceBudgetCapacity } from "./capacity.js";
import {
  addMs,
  type BudgetRow,
  budgetContext,
  budgetRowValue,
  databaseNow,
  finiteNumber,
  limit,
  MAX_WINDOW_MS,
  positiveInteger,
  type Reservation,
  type RouterContext,
  rateParams,
  reservationRef,
  routerParams,
  routerStoreError,
  updateAttributions,
  usage,
  window,
  withTransaction,
} from "./util.js";

export async function selectBudget(client: PoolClient, table: string, context: RouterContext, windowMs: number): Promise<BudgetRow> {
  const result = await client.query(
    `SELECT tokens, cost_usd, window_started_at, window_ms, reservations, last_used_at, expires_at, task_id, attributions
     FROM ${table}
     WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = $5 AND model = $6 AND window_ms = $7
     FOR UPDATE`,
    rateParams(context, windowMs),
  );
  if (!result.rows[0]) throw new ModelRouterError("reservation not found; outcome unknown", "ERR_PRISM_MODEL_ROUTER_STATE");
  return budgetRowValue(result.rows[0]);
}

export async function updateBudget(client: PoolClient, table: string, context: RouterContext, row: BudgetRow): Promise<void> {
  const result = await client.query(
    `UPDATE ${table}
     SET tokens = $1, cost_usd = $2, window_started_at = $3, window_ms = $4, reservations = $5,
         last_used_at = $6, expires_at = $7, task_id = $8, attributions = $9
     WHERE tenant_id = $10 AND account_key = $11 AND user_key = $12 AND principal_id = $13 AND provider = $14 AND model = $15 AND window_ms = $16
     RETURNING 1`,
    [
      row.tokens,
      row.costUsd,
      row.windowStartedAt,
      row.windowMs,
      JSON.stringify(row.reservations),
      row.lastUsedAt,
      row.expiresAt,
      row.taskId ?? context.taskId ?? "",
      JSON.stringify(row.attributions ?? {}),
      ...routerParams(context),
      row.windowMs,
    ],
  );
  if (!result.rows[0]) throw new EnterprisePostgresError("router budget state disappeared", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
}

export function findReservation(row: BudgetRow, reservationId: string, fencingToken: string): Reservation {
  const reservation = row.reservations.find((candidate) => candidate.id === reservationId);
  if (!reservation) throw new ModelRouterError("reservation not found; outcome unknown", "ERR_PRISM_MODEL_ROUTER_STATE");
  if (reservation.fencingToken !== fencingToken) {
    throw new ModelRouterError("reservation fencing mismatch", "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return reservation;
}

export async function reservationRetryAfterMs(pool: Pool, context: RouterContext, table: string, windowMs: number): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(
       (SELECT MIN((r->>'expiresAt')::double precision) FROM jsonb_array_elements(row.reservations) r
         WHERE (r->>'expiresAt')::double precision > EXTRACT(EPOCH FROM clock_timestamp()) * 1000),
       EXTRACT(EPOCH FROM (row.window_started_at + row.window_ms * INTERVAL '1 millisecond' - clock_timestamp())) * 1000
     ) AS retry_after_ms
     FROM ${table} AS row
     WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = $5 AND model = $6 AND window_ms = $7`,
    rateParams(context, windowMs),
  );
  if (result.rows[0]?.retry_after_ms === undefined || result.rows[0]?.retry_after_ms === null) return 0;
  return Math.max(1, Math.ceil(finiteNumber(result.rows[0].retry_after_ms, "reservation retry")));
}

export async function reserveBudget(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["reserveBudget"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["reserveBudget"]>>> {
  const context = budgetContext(input.key);
  const windowMs = window(input.windowMs);
  positiveInteger(input.reservationTtlMs, "reservation TTL", MAX_WINDOW_MS);
  const tokens = usage(input.tokens, "tokens");
  const costUsd = usage(input.costUsd, "costUsd");
  const maxTokens = limit(input.maxTokens);
  const maxCostUsd = limit(input.maxCostUsd);
  if (input.tokens === undefined && input.costUsd === undefined) {
    throw new ModelRouterError("reservation requires tokens or costUsd", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
  }
  // Fresh-row arm of the UPSERT has no WHERE: a request that exceeds the cap
  // outright must be denied before any row is created.
  if (
    (maxTokens !== undefined && input.tokens !== undefined && input.tokens > maxTokens) ||
    (maxCostUsd !== undefined && input.costUsd !== undefined && input.costUsd > maxCostUsd)
  ) {
    return { admitted: false, retryAfterMs: windowMs };
  }
  const reservationId = randomUUID();
  const fencingToken = randomUUID();
  const expired = "row.window_started_at + row.window_ms * INTERVAL '1 millisecond' <= clock_timestamp()";
  const reservationJson = `jsonb_build_object('id', $8::text, 'tokens', $9::double precision, 'costUsd', $10::double precision,
                          'expiresAt', EXTRACT(EPOCH FROM clock_timestamp()) * 1000 + $11::bigint,
                          'fencingToken', $12::text, 'provider', $16::text, 'model', $17::text, 'kind', $18::text)`;
  // Fresh row: the array contains exactly this reservation. Conflict arm: append to the existing array.
  const freshReservations = `jsonb_build_array(${reservationJson})`;
  try {
    const result = await pool.query(
      `INSERT INTO ${table} AS row
         (tenant_id, account_key, user_key, principal_id, provider, model, window_ms,
          window_started_at, tokens, cost_usd, last_used_at, expires_at, reservations, task_id, attributions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(), 0, 0, clock_timestamp(),
               clock_timestamp() + $7::bigint * INTERVAL '1 millisecond',
               ${freshReservations}, $15, '{}'::jsonb)
       ON CONFLICT (tenant_id, account_key, user_key, principal_id, provider, model, window_ms) DO UPDATE
       SET window_started_at = CASE WHEN ${expired} THEN clock_timestamp() ELSE row.window_started_at END,
           tokens = CASE WHEN ${expired} THEN 0 ELSE row.tokens END,
           cost_usd = CASE WHEN ${expired} THEN 0 ELSE row.cost_usd END,
           attributions = CASE WHEN ${expired} THEN '{}'::jsonb ELSE row.attributions END,
           reservations = CASE WHEN ${expired}
             THEN ${freshReservations}
             ELSE row.reservations || ${reservationJson} END,
           last_used_at = clock_timestamp(),
           expires_at = CASE WHEN ${expired}
             THEN clock_timestamp() + row.window_ms * INTERVAL '1 millisecond' ELSE row.expires_at END
       WHERE ($13::double precision IS NULL OR
                (CASE WHEN ${expired} THEN 0 ELSE row.tokens END)
                + (CASE WHEN ${expired} THEN 0 ELSE
                     (SELECT COALESCE(SUM((r->>'tokens')::double precision), 0)
                      FROM jsonb_array_elements(row.reservations) r
                      WHERE (r->>'expiresAt')::double precision > EXTRACT(EPOCH FROM clock_timestamp()) * 1000) END)
                + $9 <= $13)
         AND ($14::double precision IS NULL OR
                (CASE WHEN ${expired} THEN 0 ELSE row.cost_usd END)
                + (CASE WHEN ${expired} THEN 0 ELSE
                     (SELECT COALESCE(SUM((r->>'costUsd')::double precision), 0)
                      FROM jsonb_array_elements(row.reservations) r
                      WHERE (r->>'expiresAt')::double precision > EXTRACT(EPOCH FROM clock_timestamp()) * 1000) END)
                + $10 <= $14)
       RETURNING (xmax = 0) AS inserted`,
      [
        ...rateParams(context, windowMs),
        reservationId,
        tokens,
        costUsd,
        input.reservationTtlMs,
        fencingToken,
        maxTokens,
        maxCostUsd,
        context.taskId ?? "",
        input.key.provider,
        input.key.model,
        input.key.kind ?? "generation",
      ],
    );
    if (!result.rows[0]) {
      return { admitted: false, retryAfterMs: await reservationRetryAfterMs(pool, context, table, windowMs) };
    }
    if (result.rows[0].inserted === true) await enforceBudgetCapacity(pool, table, input.maxBudgetKeys, context, windowMs);
    return { admitted: true, reservationId, fencingToken };
  } catch (error) {
    throw routerStoreError(error);
  }
}

export async function commitBudget(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["commitBudget"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["commitBudget"]>>> {
  const context = budgetContext(input.key);
  const windowMs = window(input.windowMs);
  const tokens = usage(input.tokens, "tokens");
  const costUsd = usage(input.costUsd, "costUsd");
  const reservationId = reservationRef(input.reservationId, "reservation id");
  const fencingToken = reservationRef(input.fencingToken, "reservation fencing token");
  try {
    return await withTransaction(pool, async (client) => {
      const now = await databaseNow(client);
      const row = await selectBudget(client, table, context, windowMs);
      const reservation = findReservation(row, reservationId, fencingToken);
      const windowExpired = row.windowStartedAt.getTime() + row.windowMs <= now.getTime();
      const provider = reservation.provider ?? input.key.provider;
      const model = reservation.model ?? input.key.model;
      const kind = reservation.kind ?? input.key.kind ?? "generation";
      if (windowExpired) {
        // The window rolled over: charge the reserved amount into a fresh window
        // (mirrors addUsage window reset).
        const nextAttributions = updateAttributions(undefined, provider, model, kind, reservation.tokens, reservation.costUsd);
        await updateBudget(client, table, context, {
          tokens: reservation.tokens,
          costUsd: reservation.costUsd,
          windowStartedAt: now,
          windowMs,
          reservations: [],
          lastUsedAt: now,
          expiresAt: addMs(now, windowMs),
          taskId: context.taskId,
          attributions: nextAttributions,
        });
        return { unknownUsage: true };
      }
      if (reservation.expiresAt <= now.getTime() || (input.tokens === undefined && input.costUsd === undefined)) {
        const nextAttributions = updateAttributions(row.attributions, provider, model, kind, reservation.tokens, reservation.costUsd);
        await updateBudget(client, table, context, {
          ...row,
          tokens: row.tokens + reservation.tokens,
          costUsd: row.costUsd + reservation.costUsd,
          reservations: row.reservations.filter((candidate) => candidate.id !== reservationId),
          lastUsedAt: now,
          attributions: nextAttributions,
        });
        return { unknownUsage: true };
      }
      const nextTokens = row.tokens + tokens;
      const nextCost = row.costUsd + costUsd;
      if (!Number.isFinite(nextTokens) || !Number.isFinite(nextCost)) {
        throw new ModelRouterError("router budget exceeds finite range", "ERR_PRISM_MODEL_ROUTER_BUDGET");
      }
      const nextAttributions = updateAttributions(row.attributions, provider, model, kind, tokens, costUsd);
      await updateBudget(client, table, context, {
        ...row,
        tokens: nextTokens,
        costUsd: nextCost,
        reservations: row.reservations.filter((candidate) => candidate.id !== reservationId),
        lastUsedAt: now,
        attributions: nextAttributions,
      });
      return { unknownUsage: false };
    });
  } catch (error) {
    throw routerStoreError(error);
  }
}

export async function releaseBudget(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["releaseBudget"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["releaseBudget"]>>> {
  const context = budgetContext(input.key);
  const windowMs = window(input.windowMs);
  const reservationId = reservationRef(input.reservationId, "reservation id");
  const fencingToken = reservationRef(input.fencingToken, "reservation fencing token");
  try {
    await withTransaction(pool, async (client) => {
      const now = await databaseNow(client);
      const row = await selectBudget(client, table, context, windowMs);
      findReservation(row, reservationId, fencingToken);
      await updateBudget(client, table, context, {
        ...row,
        reservations: row.reservations.filter((candidate) => candidate.id !== reservationId),
        lastUsedAt: now,
      });
    });
  } catch (error) {
    throw routerStoreError(error);
  }
}

export async function renewBudget(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["renewBudget"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["renewBudget"]>>> {
  const context = budgetContext(input.key);
  const windowMs = window(input.windowMs);
  positiveInteger(input.extendTtlMs, "reservation TTL", MAX_WINDOW_MS);
  const reservationId = reservationRef(input.reservationId, "reservation id");
  const fencingToken = reservationRef(input.fencingToken, "reservation fencing token");
  const nextFencingToken = randomUUID();
  try {
    return await withTransaction(pool, async (client) => {
      const now = await databaseNow(client);
      const row = await selectBudget(client, table, context, windowMs);
      const reservation = findReservation(row, reservationId, fencingToken);
      if (reservation.expiresAt <= now.getTime()) {
        throw new ModelRouterError("reservation expired; cannot renew", "ERR_PRISM_MODEL_ROUTER_STATE");
      }
      const updatedReservation: Reservation = {
        ...reservation,
        expiresAt: now.getTime() + input.extendTtlMs,
        fencingToken: nextFencingToken,
      };
      await updateBudget(client, table, context, {
        ...row,
        reservations: row.reservations.map((candidate) => (candidate.id === reservationId ? updatedReservation : candidate)),
        lastUsedAt: now,
      });
      return { renewed: true, fencingToken: nextFencingToken };
    });
  } catch (error) {
    throw routerStoreError(error);
  }
}
