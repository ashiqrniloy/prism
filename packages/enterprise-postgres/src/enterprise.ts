import { Pool } from "pg";
import { createEnterpriseStateCleanup } from "./cleanup.js";
import { createPostgresErpMessaging } from "./erp-messaging.js";
import { asEnterprisePostgresError, EnterprisePostgresError } from "./errors.js";
import { createPostgresEvaluationStore } from "./evaluations.js";
import { validateIdentifier } from "./identifiers.js";
import { applyEnterpriseMigrations } from "./migrations.js";
import { createPostgresModelRouterStateStore } from "./model-router.js";
import { createPostgresPolicyDecisionStore } from "./policy.js";
import { createPostgresToolEffectStore } from "./tool-effects.js";
import {
  DEFAULT_ENTERPRISE_POOL_MAX,
  DEFAULT_ENTERPRISE_SCHEMA,
  type PostgresEnterpriseState,
  type PostgresEnterpriseStateOptions,
} from "./types.js";
import { createPostgresIdempotencyStore } from "./work-idempotency.js";

const HARD_ENTERPRISE_POOL_MAX = 100;

/** Open enterprise PostgreSQL infrastructure. Import remains inert; migration is explicit here. */
export async function createPostgresEnterpriseState(options: PostgresEnterpriseStateOptions): Promise<PostgresEnterpriseState> {
  const schema = options.schema ?? DEFAULT_ENTERPRISE_SCHEMA;
  validateIdentifier(schema);
  const poolMax = resolvePoolMax(options.poolMax);
  const hasPool = options.pool !== undefined;
  const hasConnectionString = options.connectionString !== undefined;
  if (hasPool === hasConnectionString) {
    throw new EnterprisePostgresError("provide exactly one of pool or connectionString", "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG");
  }
  if (!options.pool && !options.connectionString?.trim()) {
    throw new EnterprisePostgresError("connectionString is required", "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG");
  }

  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new Pool({
      ...options.poolConfig,
      connectionString: options.connectionString,
      max: poolMax,
    });
  try {
    if (!options.skipMigrations) await applyEnterpriseMigrations(pool, schema);
    const cleanup = createEnterpriseStateCleanup(pool, schema);
    let closed = false;
    return {
      policy: createPostgresPolicyDecisionStore(pool, schema),
      evaluations: createPostgresEvaluationStore(pool, schema),
      workIdempotency: createPostgresIdempotencyStore(pool, schema),
      toolEffects: createPostgresToolEffectStore(pool, schema),
      modelRouter: createPostgresModelRouterStateStore(pool, schema),
      erpMessaging: createPostgresErpMessaging({ pool, schema }),
      cleanup,
      async close() {
        if (ownsPool && !closed) {
          closed = true;
          await pool.end();
        }
      },
    };
  } catch (error) {
    if (ownsPool) await pool.end();
    throw asEnterprisePostgresError(error, "ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION", "Enterprise PostgreSQL open failed");
  }
}

function resolvePoolMax(value: number | undefined): number {
  const max = value ?? DEFAULT_ENTERPRISE_POOL_MAX;
  if (!Number.isSafeInteger(max) || max < 1 || max > HARD_ENTERPRISE_POOL_MAX) {
    throw new EnterprisePostgresError("poolMax is out of range", "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG");
  }
  return max;
}
