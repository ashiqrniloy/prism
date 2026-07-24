import type { AgentIdentity, AIProvider, ModelConfig, ProviderResolver, ProviderRequestPolicy } from "@arnilo/prism";

export interface ModelRouterAllowList {
  readonly providers?: readonly string[];
  readonly models?: readonly string[];
}

export interface ModelRouterBudgets {
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
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
}

export interface ResolvedModelRouterLimits {
  readonly maxAttempts: number;
  readonly maxCircuitKeys: number;
  readonly maxDiagnosticsBytes: number;
}

export interface ModelRouteCandidate {
  readonly model: ModelConfig;
  readonly region?: string;
  readonly residency?: string;
}

export interface CreateModelRouterOptions {
  readonly resolver: ProviderResolver;
  readonly allowList?: ModelRouterAllowList;
  /** When set, request/candidate residency must be in this list. */
  readonly allowedResidencies?: readonly string[];
  readonly budgets?: ModelRouterBudgets;
  readonly rateLimit?: ModelRouterRateLimit;
  readonly circuit?: ModelRouterCircuitOptions;
  /** Ordered fallbacks after the primary model. */
  readonly fallbacks?: readonly ModelConfig[];
  /** Honor `compat.openRouterRouting` only when true (default false). */
  readonly allowOpenRouterRouting?: boolean;
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
  readonly residency?: string;
  readonly region?: string;
}

export interface ModelRouterResolveResult {
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly diagnostics: ModelRouterDiagnostics;
  /** Chainable policy that strips OpenRouter routing unless router allows it. */
  readonly providerRequestPolicy: ProviderRequestPolicy;
}

export interface ModelRouter {
  resolve(request: ModelRouterResolveRequest): Promise<ModelRouterResolveResult>;
  /** Sync `ProviderResolver` facade using router defaults (no per-call budget overrides). */
  readonly providerSource: ProviderResolver;
  recordUsage(input: { provider: string; model: string; tokens?: number; costUsd?: number; identityKey?: string }): void;
  recordOutcome(input: { provider: string; model: string; success: boolean; identityKey?: string }): void;
  createOpenRouterRoutingPolicy(): ProviderRequestPolicy;
}
