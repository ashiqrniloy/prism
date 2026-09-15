import type { Pool, PoolClient } from "pg";
import {
  type ModelRouterAttribution,
  ModelRouterError,
  type ModelRouterStateKey,
  type ModelRouterStateOwner,
  type PaidWorkKind,
} from "../../../governance/model-router/index.js";
import { EnterprisePostgresError } from "../errors.js";
import { asTimestamp, ownerParams, requiredText, requireStoreOwner, type StoreOwner, storeError } from "../records.js";

const MAX_KEY_BYTES = 512;
export const MAX_WINDOW_MS = 31 * 24 * 60 * 60_000;
export const MAX_INTEGER = 2_147_483_647;
// Serializable retries are the normal cost of concurrent writers on one state row:
// every conflicting transaction must re-read and re-apply before it can commit.
// Budget/rate paths lock a row and rewrite it, so a 16-client burst collides repeatedly;
// the wait is full-jitter exponential (a random point under a capped ceiling), which
// desynchronizes the retriers instead of marching them back in lockstep.
const MAX_TRANSACTION_ATTEMPTS = 12;
const DEFAULT_CLEANUP_LIMIT = 100;
const HARD_CLEANUP_LIMIT = 500;

export interface RouterContext {
  readonly owner: StoreOwner;
  readonly principalId: string;
  readonly provider: string;
  readonly model: string;
  readonly taskId?: string;
  readonly kind?: PaidWorkKind;
}

export interface CircuitRow {
  readonly failures: number;
  readonly coolDownMs: number;
  readonly openUntil: Date;
  readonly probeToken?: string;
  readonly probeExpiresAt?: Date;
  readonly lastUsedAt: Date;
  readonly expiresAt?: Date;
}

export interface Reservation {
  readonly id: string;
  readonly tokens: number;
  readonly costUsd: number;
  readonly expiresAt: number;
  readonly fencingToken: string;
  readonly provider?: string;
  readonly model?: string;
  readonly kind?: PaidWorkKind;
}

export interface BudgetRow {
  readonly tokens: number;
  readonly costUsd: number;
  readonly windowStartedAt: Date;
  readonly windowMs: number;
  readonly reservations: Reservation[];
  readonly lastUsedAt: Date;
  readonly expiresAt: Date;
  readonly taskId?: string;
  readonly attributions?: Record<string, ModelRouterAttribution>;
}

/** Table names qualified for a schema; grouped for the sweep operations. */
export interface RouterTables {
  readonly rates: string;
  readonly budgets: string;
  readonly circuits: string;
}

export async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
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

export function retryDelay(attempt: number): Promise<void> {
  // Full jitter under a capped ceiling: two colliding writers must not pick the same
  // instant, or each retry round reproduces the conflict that caused it.
  const ceiling = Math.min(250, 8 * 2 ** attempt);
  const milliseconds = 1 + Math.floor(Math.random() * ceiling);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query("SELECT clock_timestamp() AS now");
  return new Date(asTimestamp(result.rows[0]?.now, "router database time"));
}

export function routerContext(key: ModelRouterStateKey): RouterContext {
  const owner = routerOwner(key);
  return {
    owner: owner.owner,
    principalId: owner.principalId,
    provider: text(key.provider, "router provider", MAX_KEY_BYTES),
    model: text(key.model, "router model", MAX_KEY_BYTES),
    ...(key.taskId ? { taskId: text(key.taskId, "router taskId", MAX_KEY_BYTES) } : {}),
    ...(key.kind ? { kind: key.kind } : {}),
  };
}

export function budgetContext(key: ModelRouterStateKey): RouterContext {
  const owner = routerOwner(key);
  const taskId = key.taskId ? text(key.taskId, "router taskId", MAX_KEY_BYTES) : undefined;
  if (taskId) {
    return {
      owner: owner.owner,
      principalId: owner.principalId,
      provider: ":task:",
      model: taskId,
      taskId,
      kind: key.kind,
    };
  }
  return {
    owner: owner.owner,
    principalId: owner.principalId,
    provider: text(key.provider, "router provider", MAX_KEY_BYTES),
    model: text(key.model, "router model", MAX_KEY_BYTES),
    kind: key.kind,
  };
}

export function routerOwner(owner: ModelRouterStateOwner): Pick<RouterContext, "owner" | "principalId"> {
  try {
    return {
      owner: requireStoreOwner(owner),
      principalId: text(owner.principalId, "router principal", MAX_KEY_BYTES),
    };
  } catch {
    throw new ModelRouterError("router state owner is required and bounded", "ERR_PRISM_MODEL_ROUTER_STATE");
  }
}

export function routerParams(context: RouterContext): [string, string, string, string, string, string] {
  return [...ownerParams(context.owner), context.principalId, context.provider, context.model];
}

export function rateParams(context: RouterContext, windowMs: number): [string, string, string, string, string, string, number] {
  return [...routerParams(context), windowMs];
}

export function text(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ModelRouterError(`${label} is required and bounded`, "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return value;
}

export function window(value: unknown): number {
  return positiveInteger(value, "router window", MAX_WINDOW_MS);
}

export function positiveInteger(value: unknown, label: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new ModelRouterError(`${label} is out of range`, "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return value;
}

export function usage(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ModelRouterError(`${label} must be finite non-negative`, "ERR_PRISM_MODEL_ROUTER_BUDGET");
  }
  return value;
}

export function limit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ModelRouterError(`budget limit must be finite non-negative`, "ERR_PRISM_MODEL_ROUTER_BUDGET");
  }
  return value;
}

export function reservationRef(value: unknown, label: string): string {
  return text(value, label, 128);
}

export function cleanupLimit(value: unknown): number {
  const limit = value ?? DEFAULT_CLEANUP_LIMIT;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > HARD_CLEANUP_LIMIT) {
    throw new ModelRouterError("router cleanup limit out of range", "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return limit;
}

export function addMs(date: Date, ms: number): Date {
  const value = date.getTime() + ms;
  if (!Number.isFinite(value)) throw new ModelRouterError("router timestamp exceeds range", "ERR_PRISM_MODEL_ROUTER_STATE");
  return new Date(value);
}

export function storedUsage(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0) throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  return number;
}

export function finiteNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  return number;
}

export function integer(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return number;
}

export function reservationList(value: unknown): Reservation[] {
  if (typeof value !== "string" && !Array.isArray(value)) {
    throw new EnterprisePostgresError("router budget reservations are invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const entries: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(entries)) {
    throw new EnterprisePostgresError("router budget reservations are invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new EnterprisePostgresError("router budget reservations are invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
    }
    const record = entry as Record<string, unknown>;
    const expiresAt = finiteNumber(record.expiresAt, `reservation ${index} expiry`);
    return {
      id: requiredText(record.id, `reservation ${index} id`, 128),
      tokens: storedUsage(record.tokens, `reservation ${index} tokens`),
      costUsd: storedUsage(record.costUsd, `reservation ${index} cost`),
      expiresAt,
      fencingToken: requiredText(record.fencingToken, `reservation ${index} fencing`, 128),
      ...(typeof record.provider === "string" ? { provider: record.provider } : {}),
      ...(typeof record.model === "string" ? { model: record.model } : {}),
      ...(typeof record.kind === "string" ? { kind: record.kind as PaidWorkKind } : {}),
    };
  });
}

export function parseAttributions(value: unknown): Record<string, ModelRouterAttribution> {
  if (!value) return {};
  const raw: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const result: Record<string, ModelRouterAttribution> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "object" && v !== null) {
      const rec = v as Record<string, unknown>;
      result[k] = {
        tokens: storedUsage(rec.tokens, `${k} tokens`),
        costUsd: storedUsage(rec.costUsd, `${k} costUsd`),
        count: integer(rec.count ?? 1, `${k} count`, 0, MAX_INTEGER),
      };
    }
  }
  return result;
}

export function updateAttributions(
  existing: Record<string, ModelRouterAttribution> | undefined,
  provider: string,
  model: string,
  kind: string,
  tokens: number,
  costUsd: number,
): Record<string, ModelRouterAttribution> {
  const map: Record<string, ModelRouterAttribution> = { ...existing };
  const key = `${provider}:${model}:${kind}`;
  const prev = map[key] ?? { tokens: 0, costUsd: 0, count: 0 };
  map[key] = {
    tokens: prev.tokens + tokens,
    costUsd: prev.costUsd + costUsd,
    count: prev.count + 1,
  };
  return map;
}

export function aggregateAttributions(attributions: Record<string, ModelRouterAttribution> | undefined): {
  readonly byModel: Record<string, ModelRouterAttribution>;
  readonly byKind: Record<string, ModelRouterAttribution>;
} {
  const byModel: Record<string, ModelRouterAttribution> = {};
  const byKind: Record<string, ModelRouterAttribution> = {};
  if (!attributions) return { byModel, byKind };

  for (const [key, val] of Object.entries(attributions)) {
    const parts = key.split(":");
    const kind = parts.length >= 3 ? parts[parts.length - 1]! : "generation";
    const modelKey = parts.length >= 3 ? parts.slice(0, -1).join(":") : key;

    const prevModel = byModel[modelKey] ?? { tokens: 0, costUsd: 0, count: 0 };
    byModel[modelKey] = {
      tokens: prevModel.tokens + val.tokens,
      costUsd: prevModel.costUsd + val.costUsd,
      count: prevModel.count + val.count,
    };

    const prevKind = byKind[kind] ?? { tokens: 0, costUsd: 0, count: 0 };
    byKind[kind] = {
      tokens: prevKind.tokens + val.tokens,
      costUsd: prevKind.costUsd + val.costUsd,
      count: prevKind.count + val.count,
    };
  }

  return { byModel, byKind };
}

export function budgetValue(row: Record<string, unknown> | undefined): { readonly tokens: number; readonly costUsd: number } {
  if (!row) throw new EnterprisePostgresError("router budget row is missing", "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE");
  asTimestamp(row.window_started_at, "router budget window");
  asTimestamp(row.last_used_at, "router budget last use");
  asTimestamp(row.expires_at, "router budget expiry");
  return { tokens: storedUsage(row.tokens, "router budget tokens"), costUsd: storedUsage(row.cost_usd, "router budget cost") };
}

export function budgetRowValue(row: Record<string, unknown>): BudgetRow {
  const windowStartedAt = new Date(asTimestamp(row.window_started_at, "router budget window"));
  const lastUsedAt = new Date(asTimestamp(row.last_used_at, "router budget last use"));
  const expiresAt = new Date(asTimestamp(row.expires_at, "router budget expiry"));
  const windowMs = integer(row.window_ms, "router budget window ms", 1, MAX_WINDOW_MS);
  return {
    tokens: storedUsage(row.tokens, "router budget tokens"),
    costUsd: storedUsage(row.cost_usd, "router budget cost"),
    windowStartedAt,
    windowMs,
    reservations: reservationList(row.reservations),
    lastUsedAt,
    expiresAt,
    taskId: typeof row.task_id === "string" && row.task_id.length > 0 ? row.task_id : undefined,
    attributions: parseAttributions(row.attributions),
  };
}

export function validateRateRow(row: Record<string, unknown>): void {
  integer(row.request_count, "router rate count", 1, MAX_INTEGER);
  asTimestamp(row.window_started_at, "router rate window");
  asTimestamp(row.last_used_at, "router rate last use");
  asTimestamp(row.expires_at, "router rate expiry");
}

export function circuitValue(row: Record<string, unknown>): CircuitRow {
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

export function serializationFailure(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && ["40001", "40P01"].includes(String(error.code)));
}

export function routerStoreError(error: unknown): Error {
  if (error instanceof ModelRouterError || error instanceof EnterprisePostgresError) return error;
  return storeError(error);
}
