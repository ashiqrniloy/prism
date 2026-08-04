import type { Pool } from "pg";
import { EnterprisePostgresError } from "./errors.js";
import { qualifyTable } from "./identifiers.js";
import { cleanupExpiredPostgresToolEffects } from "./tool-effects.js";
import type { EnterpriseStateCleanupInput, EnterpriseStateCleanupResult } from "./types.js";

const DEFAULT_CLEANUP_LIMIT = 100;
const HARD_CLEANUP_LIMIT = 500;

/** Build explicit, owner-scoped cleanup. No timer or worker is started by this module. */
export function createEnterpriseStateCleanup(
  pool: Pool,
  schema: string,
): (input: EnterpriseStateCleanupInput) => Promise<EnterpriseStateCleanupResult> {
  const work = qualifyTable(schema, "prism_work_idempotency");
  const budgets = qualifyTable(schema, "prism_model_router_budgets");
  const rates = qualifyTable(schema, "prism_model_router_rates");
  const circuits = qualifyTable(schema, "prism_model_router_circuits");

  return async (input) => {
    input.signal?.throwIfAborted();
    const owner = cleanupOwner(input);
    let remaining = resolveCleanupLimit(input.limit);
    let transitioned = 0;
    let removed = 0;

    const expiredClaims = await transitionExpiredWorkClaims(pool, work, owner, remaining);
    transitioned += expiredClaims;
    remaining -= expiredClaims;
    if (remaining > 0) {
      const effects = await cleanupExpiredPostgresToolEffects(pool, schema, {
        tenantId: owner.tenantId,
        ...(owner.accountKey === "" ? {} : { accountId: owner.accountKey }),
        ...(owner.userKey === "" ? {} : { userId: owner.userKey }),
        principalId: owner.principalId,
        limit: remaining,
      });
      transitioned += effects.transitioned;
      removed += effects.removed;
      remaining -= effects.transitioned + effects.removed;
    }
    if (remaining > 0) {
      const expiredProbes = await reopenExpiredCircuitProbes(pool, circuits, owner, remaining);
      transitioned += expiredProbes;
      remaining -= expiredProbes;
    }
    if (remaining > 0) {
      const deletedWork = await deleteExpired(
        pool,
        work,
        owner,
        remaining,
        "status IN ('completed', 'failed_retryable', 'failed_terminal')",
        "idempotency_key",
      );
      removed += deletedWork;
      remaining -= deletedWork;
    }
    if (remaining > 0) {
      const deletedRates = await deleteExpired(pool, rates, owner, remaining, "TRUE", "last_used_at, provider, model, window_ms");
      removed += deletedRates;
      remaining -= deletedRates;
    }
    if (remaining > 0) {
      const deletedBudgets = await deleteExpired(pool, budgets, owner, remaining, "TRUE", "last_used_at, provider, model, window_ms");
      removed += deletedBudgets;
      remaining -= deletedBudgets;
    }
    if (remaining > 0) {
      removed += await deleteExpired(
        pool,
        circuits,
        owner,
        remaining,
        "probe_token IS NULL AND open_until <= clock_timestamp()",
        "last_used_at, provider, model",
      );
    }
    input.signal?.throwIfAborted();
    return { removed, transitioned };
  };
}

interface CleanupOwner {
  readonly tenantId: string;
  readonly accountKey: string;
  readonly userKey: string;
  readonly principalId: string;
}

async function transitionExpiredWorkClaims(pool: Pool, table: string, owner: CleanupOwner, limit: number): Promise<number> {
  if (limit === 0) return 0;
  const result = await pool.query(
    `WITH candidates AS (
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4
         AND status = 'in_progress' AND expires_at <= clock_timestamp()
       ORDER BY expires_at ASC, idempotency_key ASC
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     UPDATE ${table} AS row
     SET status = 'unknown', claim_token = NULL, expires_at = NULL, version = row.version + 1,
         failure = COALESCE(row.failure, jsonb_build_object('code', 'ERR_PRISM_WORK_IDEMPOTENCY_UNKNOWN')),
         updated_at = clock_timestamp()
     FROM candidates
     WHERE row.ctid = candidates.ctid
     RETURNING 1`,
    ownerParams(owner, limit),
  );
  return rowCount(result);
}

async function reopenExpiredCircuitProbes(pool: Pool, table: string, owner: CleanupOwner, limit: number): Promise<number> {
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
    ownerParams(owner, limit),
  );
  return rowCount(result);
}

async function deleteExpired(
  pool: Pool,
  table: string,
  owner: CleanupOwner,
  limit: number,
  extraFilter: string,
  tieBreaker: string,
): Promise<number> {
  if (limit === 0) return 0;
  const result = await pool.query(
    `WITH candidates AS (
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4
         AND expires_at IS NOT NULL AND expires_at <= clock_timestamp() AND ${extraFilter}
       ORDER BY expires_at ASC, ${tieBreaker} ASC
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ${table} AS row
     USING candidates
     WHERE row.ctid = candidates.ctid
     RETURNING 1`,
    ownerParams(owner, limit),
  );
  return rowCount(result);
}

function cleanupOwner(input: EnterpriseStateCleanupInput): CleanupOwner {
  const required = [
    ["tenantId", input.tenantId],
    ["principalId", input.principalId],
  ] as const;
  for (const [label, value] of required) assertBoundedIdentifier(label, value);
  for (const [label, value] of [
    ["accountId", input.accountId],
    ["userId", input.userId],
  ] as const) {
    if (value !== undefined) assertBoundedIdentifier(label, value);
  }
  return {
    tenantId: input.tenantId!,
    accountKey: input.accountId ?? "",
    userKey: input.userId ?? "",
    principalId: input.principalId,
  };
}

function assertBoundedIdentifier(label: string, value: string | undefined): asserts value is string {
  if (!value?.trim() || Buffer.byteLength(value, "utf8") > 512) {
    throw new EnterprisePostgresError(`${label} is required and bounded`, "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP");
  }
}

function resolveCleanupLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_CLEANUP_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_CLEANUP_LIMIT) {
    throw new EnterprisePostgresError("cleanup limit is out of range", "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS");
  }
  return limit;
}

function ownerParams(owner: CleanupOwner, limit: number): [string, string, string, string, number] {
  return [owner.tenantId, owner.accountKey, owner.userKey, owner.principalId, limit];
}

function rowCount(result: { readonly rowCount: number | null; readonly rows: readonly unknown[] }): number {
  return result.rowCount ?? result.rows.length;
}
