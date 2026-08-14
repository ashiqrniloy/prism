import type { AgentIdentity, AIProvider, ModelConfig, ProviderRequestPolicy, ProviderResolver } from "@arnilo/prism";

export interface ModelRouterAllowList {
  readonly providers?: readonly string[];
  readonly models?: readonly string[];
}

export interface ModelRouterBudgets {
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
  /** Accounting window; default 24h, bounded to 31 days. */
  readonly windowMs?: number;
  /**
   * How long an admission reservation pins budget capacity. Runs that outlive the
   * TTL are reconciled as unknown usage (reserved amount charged, redacted
   * `unknown_usage` diagnostic). Default 60s; bounded to 31 days.
   */
  readonly reservationTtlMs?: number;
}

export interface ModelRouterRateLimit {
  readonly maxRequests: number;
  readonly windowMs: number;
}

export interface ModelRouterCircuitOptions {
  readonly failureThreshold?: number;
  readonly coolDownMs?: number;
}

export interface ModelRouterLimits {
  readonly maxAttempts?: number;
  readonly maxCircuitKeys?: number;
  readonly maxDiagnosticsBytes?: number;
  /** Hard cap on tracked rate keys (owner x provider x model x window); LRU eviction on insert. */
  readonly maxRateKeys?: number;
  /** Hard cap on tracked budget keys; LRU eviction on insert never drops a held reservation's row. */
  readonly maxBudgetKeys?: number;
}

export interface ResolvedModelRouterLimits {
  readonly maxAttempts: number;
  readonly maxCircuitKeys: number;
  readonly maxDiagnosticsBytes: number;
  readonly maxRateKeys: number;
  readonly maxBudgetKeys: number;
}

/** Exact owner identity persisted by durable router state. */
export interface ModelRouterStateOwner {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principalId: string;
}

export interface ModelRouterStateKey extends ModelRouterStateOwner {
  readonly provider: string;
  readonly model: string;
}

export interface ModelRouterReservation {
  readonly reservationId: string;
  readonly fencingToken: string;
}

export interface ModelRouterStateStore {
  consumeRate(input: {
    readonly key: ModelRouterStateKey;
    readonly maxRequests: number;
    readonly windowMs: number;
    readonly now: number;
    /** Hard cap on tracked rate keys; LRU eviction on new-key insert. */
    readonly maxRateKeys?: number;
  }): Promise<{ readonly admitted: boolean; readonly retryAfterMs?: number }>;
  readBudget(input: {
    readonly key: ModelRouterStateKey;
    readonly windowMs: number;
    readonly now: number;
    /** Hard cap on tracked budget keys; LRU eviction on new-key insert. */
    readonly maxBudgetKeys?: number;
  }): Promise<{ readonly tokens: number; readonly costUsd: number }>;
  addUsage(input: {
    readonly key: ModelRouterStateKey;
    readonly tokens?: number;
    readonly costUsd?: number;
    readonly windowMs: number;
    readonly now: number;
    /** Hard cap on tracked budget keys; LRU eviction on new-key insert. */
    readonly maxBudgetKeys?: number;
  }): Promise<void>;
  /**
   * Atomically reserve budget capacity (max - used - reserved) at admission.
   * Admits only when the full requested amount fits in every capped dimension;
   * an expired reservation is treated as released (its capacity is free).
   */
  reserveBudget(input: {
    readonly key: ModelRouterStateKey;
    readonly tokens?: number;
    readonly costUsd?: number;
    readonly maxTokens?: number;
    readonly maxCostUsd?: number;
    readonly windowMs: number;
    readonly reservationTtlMs: number;
    readonly now: number;
    /** Hard cap on tracked budget keys; LRU eviction on new-key insert. */
    readonly maxBudgetKeys?: number;
  }): Promise<{
    readonly admitted: boolean;
    readonly reservationId?: string;
    readonly fencingToken?: string;
    readonly retryAfterMs?: number;
  }>;
  /**
   * Apply the actual usage delta versus the reserved amount and release the
   * reservation. A reservation that expired before commit charges the reserved
   * amount and reports `unknownUsage: true`; a missing/stale reservation throws
   * `ERR_PRISM_MODEL_ROUTER_STATE` (outcome unknown, fail loud).
   */
  commitBudget(input: {
    readonly key: ModelRouterStateKey;
    readonly reservationId: string;
    readonly fencingToken: string;
    readonly tokens?: number;
    readonly costUsd?: number;
    readonly windowMs: number;
    readonly now: number;
  }): Promise<{ readonly unknownUsage: boolean }>;
  /** Release an uncommitted reservation; stale/foreign fencing tokens are rejected. */
  releaseBudget(input: {
    readonly key: ModelRouterStateKey;
    readonly reservationId: string;
    readonly fencingToken: string;
    readonly windowMs: number;
    readonly now: number;
  }): Promise<void>;
  claimCircuitProbe(input: {
    readonly key: ModelRouterStateKey;
    readonly failureThreshold: number;
    readonly coolDownMs: number;
    readonly maxKeys: number;
    readonly now: number;
  }): Promise<{ readonly admitted: boolean; readonly probeToken?: string }>;
  recordCircuitOutcome(input: {
    readonly key: ModelRouterStateKey;
    readonly success: boolean;
    readonly failureThreshold: number;
    readonly coolDownMs: number;
    readonly maxKeys: number;
    readonly probeToken?: string;
    readonly now: number;
  }): Promise<void>;
  cleanup(input: {
    readonly owner: ModelRouterStateOwner;
    readonly limit?: number;
    readonly now: number;
  }): Promise<{ readonly removed: number }>;
}

export interface ModelRouteCandidate {
  readonly model: ModelConfig;
  readonly region?: string;
  readonly residency?: string;
}

/**
 * Host-configurable candidate selection (0.1.7). The router calls {@link rank}
 * after assembling the primary + fallback candidates and BEFORE the
 * allow-list/residency/budget/rate/circuit checks; the policy therefore only
 * reorders already-allowed candidates and can never widen governance. The
 * returned list MUST be a permutation of the input; any other result fails
 * closed with `ERR_PRISM_MODEL_ROUTER_POLICY`. Absent a `selection` option the
 * router keeps the 0.1.6 ordered behavior byte-identically.
 */
export interface ModelRouterSelectionPolicy {
  /** Short policy name recorded in diagnostics (cap 128). */
  readonly name: string;
  /** Reorder the candidates; must return a permutation of the input. */
  rank(candidates: readonly ModelConfig[], request: ModelRouterResolveRequest): readonly ModelConfig[];
  /** Optional outcome feedback fed by `router.recordOutcome` (e.g. latency EMAs). */
  observe?(outcome: { readonly provider: string; readonly model: string; readonly success: boolean; readonly latencyMs?: number }): void;
}

export interface CostLatencySelectionOptions {
  /** EMA smoothing in [0, 1]; 0 keeps the first sample, 1 uses only the latest. Default 0.5. */
  readonly latencyWeight?: number;
  /** Provider/model key length cap for the latency table. Default 512. */
  readonly maxKeyLength?: number;
}

export interface CreateModelRouterOptions {
  readonly resolver: ProviderResolver;
  readonly allowList?: ModelRouterAllowList;
  /** When set, request/candidate residency must be in this list. */
  readonly allowedResidencies?: readonly string[];
  readonly budgets?: ModelRouterBudgets;
  readonly rateLimit?: ModelRouterRateLimit;
  readonly circuit?: ModelRouterCircuitOptions;
  /** Async state implementation. Requires host-verified identity per call. */
  readonly stateStore?: ModelRouterStateStore;
  /** Ordered fallbacks after the primary model. */
  readonly fallbacks?: readonly ModelConfig[];
  /** Honor `compat.openRouterRouting` only when true (default false). */
  readonly allowOpenRouterRouting?: boolean;
  /** Optional host selection policy; absent keeps the 0.1.6 ordered behavior. */
  readonly selection?: ModelRouterSelectionPolicy;
  readonly limits?: ModelRouterLimits;
  readonly now?: () => number;
  /** Optional audit/telemetry hook; receives redacted diagnostics only. */
  readonly onDiagnostics?: (diagnostics: ModelRouterDiagnostics) => void | Promise<void>;
}

export interface ModelRouterResolveRequest {
  readonly model: ModelConfig;
  readonly identity?: AgentIdentity;
  readonly residency?: string;
  readonly region?: string;
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
  readonly fallbacks?: readonly ModelConfig[];
  readonly signal?: AbortSignal;
}

export type ModelRouterDenyReason =
  | "allow_list"
  | "residency"
  | "budget"
  | "rate_limit"
  | "circuit_open"
  | "unknown_provider"
  | "attempts_exhausted"
  | "openrouter_routing_denied";

export interface ModelRouterAttempt {
  readonly provider: string;
  readonly model: string;
  readonly outcome: "selected" | "denied" | "miss" | "circuit_open";
  readonly reason?: ModelRouterDenyReason | string;
}

export interface ModelRouterDiagnostics {
  readonly outcome: "allow" | "deny";
  readonly reason?: ModelRouterDenyReason | string;
  readonly selectedProvider?: string;
  readonly selectedModel?: string;
  readonly attempts: readonly ModelRouterAttempt[];
  readonly identityRefs?: Readonly<{
    tenantId?: string;
    principalId?: string;
    principalKind?: string;
  }>;
  readonly openRouterRoutingHonored?: boolean;
  /** Host selection policy name when one is configured. */
  readonly selection?: string;
  readonly residency?: string;
  readonly region?: string;
}

export interface ModelRouterResolveResult {
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly diagnostics: ModelRouterDiagnostics;
  /** Pass to recordOutcome after a half-open circuit probe. */
  readonly circuitProbeToken?: string;
  /** Pass to recordUsage to commit the admission reservation against actual usage. */
  readonly budgetReservation?: ModelRouterReservation;
  /** Chainable policy that strips OpenRouter routing unless router allows it. */
  readonly providerRequestPolicy: ProviderRequestPolicy;
}

export interface ModelRouter {
  resolve(request: ModelRouterResolveRequest): Promise<ModelRouterResolveResult>;
  /** Sync `ProviderResolver` facade using router defaults (no per-call budget overrides). */
  readonly providerSource: ProviderResolver;
  recordUsage(input: {
    identity: AgentIdentity;
    provider: string;
    model: string;
    tokens?: number;
    costUsd?: number;
    /** Commit the admission reservation returned by resolve against actual usage. */
    budgetReservation?: ModelRouterReservation;
  }): Promise<void>;
  recordOutcome(input: {
    identity: AgentIdentity;
    provider: string;
    model: string;
    success: boolean;
    circuitProbeToken?: string;
    /** Host-measured provider-call latency; feeds the selection policy EMA. */
    latencyMs?: number;
  }): Promise<void>;
  createOpenRouterRoutingPolicy(): ProviderRequestPolicy;
}
