import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ModelRouterError, type ModelRouterStateStore } from "../../../governance/model-router/index.js";
import { EnterprisePostgresError } from "../errors.js";
import {
  addMs,
  type CircuitRow,
  circuitValue,
  databaseNow,
  integer,
  MAX_INTEGER,
  positiveInteger,
  type RouterContext,
  routerContext,
  routerParams,
  routerStoreError,
  text,
  window,
  withTransaction,
} from "./util.js";

// ponytail: fixed 24h closed-state retention; expose a router TTL only if operators need a different bound.
const CIRCUIT_IDLE_TTL_MS = 24 * 60 * 60_000;
const EPOCH = new Date(0);

export async function selectCircuit(client: PoolClient, table: string, context: RouterContext): Promise<CircuitRow | undefined> {
  const result = await client.query(
    `SELECT failures, cool_down_ms, open_until, probe_token, probe_expires_at, last_used_at, expires_at
     FROM ${table}
     WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = $5 AND model = $6
     FOR UPDATE`,
    routerParams(context),
  );
  return result.rows[0] ? circuitValue(result.rows[0]) : undefined;
}

export async function insertCircuit(
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

export async function updateCircuit(client: PoolClient, table: string, context: RouterContext, row: CircuitRow): Promise<CircuitRow> {
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

export async function ensureCircuitCapacity(client: PoolClient, table: string, maxKeys: number, now: Date): Promise<void> {
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

export async function claimCircuitProbe(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["claimCircuitProbe"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["claimCircuitProbe"]>>> {
  const context = routerContext(input.key);
  positiveInteger(input.failureThreshold, "circuit failureThreshold", MAX_INTEGER);
  const coolDownMs = window(input.coolDownMs);
  const maxKeys = positiveInteger(input.maxKeys, "circuit maxKeys", 16_384);
  try {
    return await withTransaction(pool, async (client) => {
      const now = await databaseNow(client);
      let row = await selectCircuit(client, table, context);
      if (!row) {
        await ensureCircuitCapacity(client, table, maxKeys, now);
        await insertCircuit(client, table, context, {
          failures: 0,
          coolDownMs,
          openUntil: EPOCH,
          lastUsedAt: now,
          expiresAt: addMs(now, CIRCUIT_IDLE_TTL_MS),
        });
        row = await selectCircuit(client, table, context);
        if (!row) throw new EnterprisePostgresError("router circuit state disappeared", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
      }
      if (row.probeToken && row.probeExpiresAt && row.probeExpiresAt <= now) {
        row = await updateCircuit(client, table, context, {
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
        await updateCircuit(client, table, context, { ...row, lastUsedAt: now });
        return { admitted: false };
      }
      if (row.openUntil > EPOCH) {
        const probeToken = randomUUID();
        await updateCircuit(client, table, context, {
          ...row,
          probeToken,
          probeExpiresAt: addMs(now, coolDownMs),
          lastUsedAt: now,
          expiresAt: undefined,
        });
        return { admitted: true, probeToken };
      }
      await updateCircuit(client, table, context, {
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
}

export async function recordCircuitOutcome(
  pool: Pool,
  table: string,
  input: Parameters<ModelRouterStateStore["recordCircuitOutcome"]>[0],
): Promise<Awaited<ReturnType<ModelRouterStateStore["recordCircuitOutcome"]>>> {
  const context = routerContext(input.key);
  const failureThreshold = positiveInteger(input.failureThreshold, "circuit failureThreshold", MAX_INTEGER);
  const coolDownMs = window(input.coolDownMs);
  const maxKeys = positiveInteger(input.maxKeys, "circuit maxKeys", 16_384);
  const probeToken = input.probeToken === undefined ? undefined : text(input.probeToken, "circuit probe token", 128);
  try {
    await withTransaction(pool, async (client) => {
      const now = await databaseNow(client);
      let row = await selectCircuit(client, table, context);
      if (!row) {
        await ensureCircuitCapacity(client, table, maxKeys, now);
        const failures = input.success ? 0 : 1;
        await insertCircuit(client, table, context, {
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
      await updateCircuit(client, table, context, {
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
}
