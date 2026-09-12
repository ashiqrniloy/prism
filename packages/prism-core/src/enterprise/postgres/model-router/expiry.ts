import type { Pool } from "pg";
import { type ModelRouterStateStore } from "../../../governance/model-router/index.js";
import { ownerParams } from "../records.js";
import { cleanupLimit, type RouterContext, type RouterTables, routerOwner, routerStoreError } from "./util.js";

export async function reopenExpiredProbes(
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

export async function deleteExpiredRouterRows(
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

/** Remove expired reservations from retained budget rows (bounded by limit); a late commit then charges reserved. */
export async function pruneExpiredReservations(
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
         AND reservations <> '[]'::jsonb
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(reservations) r
           WHERE (r->>'expiresAt')::double precision <= EXTRACT(EPOCH FROM clock_timestamp()) * 1000)
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     UPDATE ${table} AS row
     SET reservations = COALESCE(
       (SELECT jsonb_agg(r) FROM jsonb_array_elements(row.reservations) r
         WHERE (r->>'expiresAt')::double precision > EXTRACT(EPOCH FROM clock_timestamp()) * 1000),
       '[]'::jsonb)
     FROM candidates
     WHERE row.ctid = candidates.ctid`,
    [...ownerParams(owner.owner), owner.principalId, limit],
  );
  return result.rowCount ?? result.rows.length;
}

export async function cleanup(
  pool: Pool,
  tables: RouterTables,
  input: Parameters<ModelRouterStateStore["cleanup"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["cleanup"]>>> {
  const owner = routerOwner(input.owner);
  const limit = cleanupLimit(input.limit);
  try {
    const reopened = await reopenExpiredProbes(pool, tables.circuits, owner, limit);
    let remaining = limit - reopened;
    let removed = 0;
    if (remaining > 0) {
      removed += await deleteExpiredRouterRows(pool, tables.rates, owner, remaining, "last_used_at, provider, model, window_ms");
      remaining = limit - reopened - removed;
    }
    if (remaining > 0) {
      removed += await deleteExpiredRouterRows(pool, tables.budgets, owner, remaining, "last_used_at, provider, model, window_ms");
      remaining = limit - reopened - removed;
    }
    if (remaining > 0) {
      removed += await pruneExpiredReservations(pool, tables.budgets, owner, remaining);
      remaining = limit - reopened - removed;
    }
    if (remaining > 0) {
      removed += await deleteExpiredRouterRows(
        pool,
        tables.circuits,
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
}
