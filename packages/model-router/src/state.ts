import { randomUUID } from "node:crypto";
import { ModelRouterError } from "./errors.js";
import type { ModelRouterStateKey, ModelRouterStateOwner, ModelRouterStateStore } from "./types.js";

const DEFAULT_CLEANUP_LIMIT = 100;
const HARD_CLEANUP_LIMIT = 500;
// ponytail: fixed 24h closed-state retention; expose a router TTL only if operators need a different bound.
const CIRCUIT_IDLE_TTL_MS = 24 * 60 * 60_000;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60_000;
const MAX_INTEGER = 2_147_483_647;

interface RateState {
  count: number;
  windowStart: number;
  windowMs: number;
  lastUsed: number;
}

interface Reservation {
  readonly id: string;
  readonly tokens: number;
  readonly costUsd: number;
  readonly expiresAt: number;
  readonly fencingToken: string;
}

interface BudgetState {
  tokens: number;
  costUsd: number;
  windowStart: number;
  windowMs: number;
  lastUsed: number;
  reservations: Reservation[];
}

interface CircuitState {
  failures: number;
  openUntil: number;
  coolDownMs: number;
  probeToken?: string;
  probeExpiresAt?: number;
  lastUsed: number;
}

interface StateEntry<T> {
  readonly key: ModelRouterStateKey;
  readonly state: T;
}

/** In-process reference state. Durable adapters implement this same atomic-action contract. */
export function createMemoryModelRouterStateStore(): ModelRouterStateStore {
  const rates = new Map<string, StateEntry<RateState>>();
  const budgets = new Map<string, StateEntry<BudgetState>>();
  const circuits = new Map<string, StateEntry<CircuitState>>();

  return {
    async consumeRate(input) {
      validateKey(input.key);
      stateClock(input.now);
      positiveInteger(input.maxRequests, "rate maxRequests", MAX_INTEGER);
      stateWindow(input.windowMs);
      const id = keyOf(input.key);
      let state = rates.get(id)?.state;
      if (!state) evictLruRate(rates, input.maxRateKeys);
      if (!state || state.windowMs !== input.windowMs || input.now - state.windowStart >= input.windowMs) {
        state = { count: 0, windowStart: input.now, windowMs: input.windowMs, lastUsed: input.now };
      }
      if (state.count >= input.maxRequests) {
        state.lastUsed = input.now;
        rates.set(id, { key: input.key, state });
        return { admitted: false, retryAfterMs: Math.max(1, input.windowMs - (input.now - state.windowStart)) };
      }
      state.count += 1;
      state.lastUsed = input.now;
      rates.set(id, { key: input.key, state });
      return { admitted: true };
    },

    async readBudget(input) {
      validateKey(input.key);
      stateClock(input.now);
      stateWindow(input.windowMs);
      const id = keyOf(input.key);
      let state = budgets.get(id)?.state;
      if (!state) evictLruBudget(budgets, input.maxBudgetKeys, input.now);
      if (!state || state.windowMs !== input.windowMs || input.now - state.windowStart >= input.windowMs) {
        state = { tokens: 0, costUsd: 0, windowStart: input.now, windowMs: input.windowMs, lastUsed: input.now, reservations: [] };
      }
      state.lastUsed = input.now;
      budgets.set(id, { key: input.key, state });
      return { tokens: state.tokens, costUsd: state.costUsd };
    },

    async addUsage(input) {
      validateKey(input.key);
      stateClock(input.now);
      stateWindow(input.windowMs);
      stateUsage(input.tokens, "tokens");
      stateUsage(input.costUsd, "costUsd");
      const id = keyOf(input.key);
      let state = budgets.get(id)?.state;
      if (!state) evictLruBudget(budgets, input.maxBudgetKeys, input.now);
      if (!state || state.windowMs !== input.windowMs || input.now - state.windowStart >= input.windowMs) {
        state = { tokens: 0, costUsd: 0, windowStart: input.now, windowMs: input.windowMs, lastUsed: input.now, reservations: [] };
      }
      if (input.tokens !== undefined) state.tokens += input.tokens;
      if (input.costUsd !== undefined) state.costUsd += input.costUsd;
      if (!Number.isFinite(state.tokens) || !Number.isFinite(state.costUsd)) {
        throw new ModelRouterError("router budget exceeds finite range", "ERR_PRISM_MODEL_ROUTER_BUDGET");
      }
      state.lastUsed = input.now;
      budgets.set(id, { key: input.key, state });
    },

    async reserveBudget(input) {
      validateKey(input.key);
      stateClock(input.now);
      stateWindow(input.windowMs);
      positiveInteger(input.reservationTtlMs, "reservation TTL", MAX_WINDOW_MS);
      stateUsage(input.tokens, "tokens");
      stateUsage(input.costUsd, "costUsd");
      stateLimit(input.maxTokens, "maxTokens");
      stateLimit(input.maxCostUsd, "maxCostUsd");
      if (input.tokens === undefined && input.costUsd === undefined) {
        throw new ModelRouterError("reservation requires tokens or costUsd", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
      }
      const id = keyOf(input.key);
      let state = budgets.get(id)?.state;
      if (!state) evictLruBudget(budgets, input.maxBudgetKeys, input.now);
      if (!state || state.windowMs !== input.windowMs || input.now - state.windowStart >= input.windowMs) {
        state = { tokens: 0, costUsd: 0, windowStart: input.now, windowMs: input.windowMs, lastUsed: input.now, reservations: [] };
      }
      // Expired reservations are treated as released: excluded from capacity and
      // kept only so a late commit can still reconcile (charged as unknown usage).
      const active = state.reservations.filter((reservation) => reservation.expiresAt > input.now);
      const reservedTokens = active.reduce((sum, reservation) => sum + reservation.tokens, 0);
      const reservedCost = active.reduce((sum, reservation) => sum + reservation.costUsd, 0);
      const remainingTokens = input.maxTokens === undefined ? undefined : input.maxTokens - state.tokens - reservedTokens;
      const remainingCost = input.maxCostUsd === undefined ? undefined : input.maxCostUsd - state.costUsd - reservedCost;
      if (
        (input.tokens !== undefined && remainingTokens !== undefined && input.tokens > remainingTokens) ||
        (input.costUsd !== undefined && remainingCost !== undefined && input.costUsd > remainingCost)
      ) {
        const earliestRelease = Math.min(
          active.reduce((earliest, reservation) => Math.min(earliest, reservation.expiresAt), Number.POSITIVE_INFINITY),
          state.windowStart + state.windowMs,
        );
        return { admitted: false, retryAfterMs: Math.max(1, earliestRelease - input.now) };
      }
      const reservation: Reservation = {
        id: randomUUID(),
        tokens: input.tokens ?? 0,
        costUsd: input.costUsd ?? 0,
        expiresAt: input.now + input.reservationTtlMs,
        fencingToken: randomUUID(),
      };
      state.reservations.push(reservation);
      state.lastUsed = input.now;
      budgets.set(id, { key: input.key, state });
      return { admitted: true, reservationId: reservation.id, fencingToken: reservation.fencingToken };
    },

    async commitBudget(input) {
      validateKey(input.key);
      stateClock(input.now);
      stateWindow(input.windowMs);
      stateUsage(input.tokens, "tokens");
      stateUsage(input.costUsd, "costUsd");
      reservationRef(input.reservationId, input.fencingToken);
      const id = keyOf(input.key);
      const entry = budgets.get(id);
      const state = entry?.state;
      if (!state || state.windowMs !== input.windowMs) {
        throw new ModelRouterError("reservation not found; outcome unknown", "ERR_PRISM_MODEL_ROUTER_STATE");
      }
      const reservation = state.reservations.find((candidate) => candidate.id === input.reservationId);
      if (!reservation) {
        throw new ModelRouterError("reservation not found; outcome unknown", "ERR_PRISM_MODEL_ROUTER_STATE");
      }
      if (reservation.fencingToken !== input.fencingToken) {
        throw new ModelRouterError("reservation fencing mismatch", "ERR_PRISM_MODEL_ROUTER_STATE");
      }
      if (input.now - state.windowStart >= state.windowMs) {
        // The window rolled over: the reservation belongs to a dead window. Charge
        // the reserved amount into a fresh window (mirrors addUsage window reset).
        budgets.set(id, {
          key: input.key,
          state: {
            tokens: reservation.tokens,
            costUsd: reservation.costUsd,
            windowStart: input.now,
            windowMs: state.windowMs,
            lastUsed: input.now,
            reservations: [],
          },
        });
        return { unknownUsage: true };
      }
      if (reservation.expiresAt <= input.now) {
        state.tokens += reservation.tokens;
        state.costUsd += reservation.costUsd;
        state.reservations = state.reservations.filter((candidate) => candidate.id !== input.reservationId);
        state.lastUsed = input.now;
        budgets.set(id, { key: input.key, state });
        return { unknownUsage: true };
      }
      state.tokens += input.tokens ?? 0;
      state.costUsd += input.costUsd ?? 0;
      if (!Number.isFinite(state.tokens) || !Number.isFinite(state.costUsd)) {
        throw new ModelRouterError("router budget exceeds finite range", "ERR_PRISM_MODEL_ROUTER_BUDGET");
      }
      state.reservations = state.reservations.filter((candidate) => candidate.id !== input.reservationId);
      state.lastUsed = input.now;
      budgets.set(id, { key: input.key, state });
      return { unknownUsage: false };
    },

    async releaseBudget(input) {
      validateKey(input.key);
      stateClock(input.now);
      stateWindow(input.windowMs);
      reservationRef(input.reservationId, input.fencingToken);
      const id = keyOf(input.key);
      const entry = budgets.get(id);
      const state = entry?.state;
      if (!state || state.windowMs !== input.windowMs) {
        throw new ModelRouterError("reservation not found; outcome unknown", "ERR_PRISM_MODEL_ROUTER_STATE");
      }
      const reservation = state.reservations.find((candidate) => candidate.id === input.reservationId);
      if (!reservation) {
        throw new ModelRouterError("reservation not found; outcome unknown", "ERR_PRISM_MODEL_ROUTER_STATE");
      }
      if (reservation.fencingToken !== input.fencingToken) {
        throw new ModelRouterError("reservation fencing mismatch", "ERR_PRISM_MODEL_ROUTER_STATE");
      }
      state.reservations = state.reservations.filter((candidate) => candidate.id !== input.reservationId);
      state.lastUsed = input.now;
      budgets.set(id, { key: input.key, state });
    },

    async claimCircuitProbe(input) {
      validateKey(input.key);
      stateClock(input.now);
      positiveInteger(input.failureThreshold, "circuit failureThreshold", MAX_INTEGER);
      stateWindow(input.coolDownMs);
      positiveInteger(input.maxKeys, "circuit maxKeys", 16_384);
      const id = keyOf(input.key);
      let entry = circuits.get(id);
      if (!entry) {
        evictClosedCircuit(circuits, input.maxKeys, input.now);
        entry = { key: input.key, state: { failures: 0, openUntil: 0, coolDownMs: input.coolDownMs, lastUsed: input.now } };
      }
      const state = entry.state;
      if (state.probeExpiresAt !== undefined && state.probeExpiresAt <= input.now) {
        state.probeToken = undefined;
        state.probeExpiresAt = undefined;
        state.openUntil = input.now + input.coolDownMs;
        state.coolDownMs = input.coolDownMs;
      }
      state.lastUsed = input.now;
      circuits.set(id, entry);
      if (state.openUntil > input.now || state.probeToken) return { admitted: false };
      if (state.openUntil > 0) {
        state.probeToken = randomUUID();
        state.probeExpiresAt = input.now + input.coolDownMs;
        return { admitted: true, probeToken: state.probeToken };
      }
      return { admitted: true };
    },

    async recordCircuitOutcome(input) {
      validateKey(input.key);
      stateClock(input.now);
      positiveInteger(input.failureThreshold, "circuit failureThreshold", MAX_INTEGER);
      stateWindow(input.coolDownMs);
      positiveInteger(input.maxKeys, "circuit maxKeys", 16_384);
      const id = keyOf(input.key);
      const existing = circuits.get(id);
      if (!existing) evictClosedCircuit(circuits, input.maxKeys, input.now);
      const entry = existing ?? {
        key: input.key,
        state: { failures: 0, openUntil: 0, coolDownMs: input.coolDownMs, lastUsed: input.now },
      };
      const state = entry.state;
      if (state.probeToken) {
        if (input.probeToken !== state.probeToken || state.probeExpiresAt === undefined || state.probeExpiresAt <= input.now) return;
        state.probeToken = undefined;
        state.probeExpiresAt = undefined;
      } else if (input.probeToken) {
        return;
      }
      state.coolDownMs = input.coolDownMs;
      if (input.success) {
        state.failures = 0;
        state.openUntil = 0;
      } else {
        state.failures += 1;
        if (state.failures >= input.failureThreshold) state.openUntil = input.now + input.coolDownMs;
      }
      state.lastUsed = input.now;
      circuits.set(id, entry);
    },

    async cleanup(input) {
      validateOwner(input.owner);
      stateClock(input.now);
      const limit = resolveCleanupLimit(input.limit);
      let removed = removeExpiredWindows(rates, input.owner, input.now, limit);
      if (removed >= limit) return { removed };
      removed += removeExpiredWindows(budgets, input.owner, input.now, limit - removed);
      if (removed >= limit) return { removed };
      for (const [id, entry] of budgets) {
        if (removed >= limit) break;
        if (!sameOwner(entry.key, input.owner)) continue;
        const before = entry.state.reservations.length;
        entry.state.reservations = entry.state.reservations.filter((reservation) => reservation.expiresAt > input.now);
        if (entry.state.reservations.length < before) {
          budgets.set(id, entry);
          removed += 1;
        }
      }
      if (removed >= limit) return { removed };
      const circuitEntries = [...circuits.entries()]
        .filter(([, entry]) => {
          const state = entry.state;
          if (!sameOwner(entry.key, input.owner)) return false;
          if (state.probeExpiresAt !== undefined && state.probeExpiresAt <= input.now) {
            state.probeToken = undefined;
            state.probeExpiresAt = undefined;
            state.openUntil = input.now + state.coolDownMs;
          }
          return state.openUntil <= input.now && !state.probeToken && input.now - state.lastUsed >= CIRCUIT_IDLE_TTL_MS;
        })
        .sort(([, a], [, b]) => a.state.lastUsed - b.state.lastUsed || keyOf(a.key).localeCompare(keyOf(b.key)));
      for (const [id] of circuitEntries) {
        if (removed >= limit) break;
        circuits.delete(id);
        removed += 1;
      }
      return { removed };
    },
  };
}

function removeExpiredWindows<T extends { windowStart: number; windowMs: number; lastUsed: number }>(
  records: Map<string, StateEntry<T>>,
  owner: ModelRouterStateOwner,
  now: number,
  limit: number,
): number {
  const entries = [...records.entries()]
    .filter(([, entry]) => sameOwner(entry.key, owner) && now - entry.state.windowStart >= entry.state.windowMs)
    .sort(([, a], [, b]) => a.state.lastUsed - b.state.lastUsed || keyOf(a.key).localeCompare(keyOf(b.key)));
  for (const [id] of entries.slice(0, limit)) records.delete(id);
  return Math.min(entries.length, limit);
}

function evictClosedCircuit(circuits: Map<string, StateEntry<CircuitState>>, maxKeys: number, now: number): void {
  if (circuits.size < maxKeys) return;
  const candidate = [...circuits.entries()]
    .filter(([, entry]) => entry.state.openUntil <= now && !entry.state.probeToken)
    .sort(([, a], [, b]) => a.state.lastUsed - b.state.lastUsed || keyOf(a.key).localeCompare(keyOf(b.key)))[0];
  if (!candidate) throw new ModelRouterError("router state capacity exhausted", "ERR_PRISM_MODEL_ROUTER_STATE");
  circuits.delete(candidate[0]);
}

function evictLruRate(rates: Map<string, StateEntry<RateState>>, maxKeys: number | undefined): void {
  if (maxKeys === undefined || rates.size < maxKeys) return;
  const candidate = [...rates.entries()].sort(
    ([, a], [, b]) => a.state.lastUsed - b.state.lastUsed || keyOf(a.key).localeCompare(keyOf(b.key)),
  )[0];
  if (!candidate) throw new ModelRouterError("router state capacity exhausted", "ERR_PRISM_MODEL_ROUTER_STATE");
  rates.delete(candidate[0]);
}

function evictLruBudget(budgets: Map<string, StateEntry<BudgetState>>, maxKeys: number | undefined, now: number): void {
  if (maxKeys === undefined || budgets.size < maxKeys) return;
  // A row holding an active reservation is pinned and never evicted.
  const candidate = [...budgets.entries()]
    .filter(([, entry]) => !entry.state.reservations.some((reservation) => reservation.expiresAt > now))
    .sort(([, a], [, b]) => a.state.lastUsed - b.state.lastUsed || keyOf(a.key).localeCompare(keyOf(b.key)))[0];
  if (!candidate) throw new ModelRouterError("router state capacity exhausted", "ERR_PRISM_MODEL_ROUTER_STATE");
  budgets.delete(candidate[0]);
}

function keyOf(key: ModelRouterStateKey): string {
  return JSON.stringify([key.tenantId, key.accountId ?? "", key.userId ?? "", key.principalId, key.provider, key.model]);
}

function sameOwner(key: ModelRouterStateKey, owner: ModelRouterStateOwner): boolean {
  return (
    key.tenantId === owner.tenantId &&
    key.accountId === owner.accountId &&
    key.userId === owner.userId &&
    key.principalId === owner.principalId
  );
}

function validateKey(key: ModelRouterStateKey): void {
  validateOwner(key);
  for (const value of [key.provider, key.model]) {
    if (!value || Buffer.byteLength(value, "utf8") > 512) {
      throw new ModelRouterError("router state key is required and bounded", "ERR_PRISM_MODEL_ROUTER_STATE");
    }
  }
}

function validateOwner(owner: ModelRouterStateOwner): void {
  for (const value of [owner.tenantId, owner.principalId]) {
    if (!value || Buffer.byteLength(value, "utf8") > 512) {
      throw new ModelRouterError("router state owner is required and bounded", "ERR_PRISM_MODEL_ROUTER_STATE");
    }
  }
  for (const value of [owner.accountId, owner.userId]) {
    if (value !== undefined && (!value || Buffer.byteLength(value, "utf8") > 512)) {
      throw new ModelRouterError("router state owner is bounded", "ERR_PRISM_MODEL_ROUTER_STATE");
    }
  }
}

function stateClock(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ModelRouterError("router state clock must be finite", "ERR_PRISM_MODEL_ROUTER_STATE");
  }
}

function stateWindow(value: unknown): void {
  positiveInteger(value, "router window", MAX_WINDOW_MS);
}

function stateUsage(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new ModelRouterError(`${label} must be finite non-negative`, "ERR_PRISM_MODEL_ROUTER_BUDGET");
  }
}

function stateLimit(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new ModelRouterError(`${label} must be finite non-negative`, "ERR_PRISM_MODEL_ROUTER_BUDGET");
  }
}

function reservationRef(reservationId: string, fencingToken: string): void {
  for (const [value, label] of [
    [reservationId, "reservationId"],
    [fencingToken, "fencingToken"],
  ] as const) {
    if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 128) {
      throw new ModelRouterError(`${label} is required and bounded`, "ERR_PRISM_MODEL_ROUTER_STATE");
    }
  }
}

function positiveInteger(value: unknown, label: string, max: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new ModelRouterError(`${label} is out of range`, "ERR_PRISM_MODEL_ROUTER_STATE");
  }
}

function resolveCleanupLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_CLEANUP_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_CLEANUP_LIMIT) {
    throw new ModelRouterError("cleanup limit out of range", "ERR_PRISM_MODEL_ROUTER_STATE");
  }
  return limit;
}
