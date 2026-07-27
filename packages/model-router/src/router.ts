import type { AgentIdentity, AIProvider, ModelConfig, ProviderRequest, ProviderRequestPolicy } from "@arnilo/prism";
import { ModelRouterError } from "./errors.js";
import { DEFAULT_CIRCUIT_COOLDOWN_MS, DEFAULT_CIRCUIT_FAILURE_THRESHOLD, resolveModelRouterLimits } from "./limits.js";
import type {
  CreateModelRouterOptions,
  ModelRouter,
  ModelRouterAttempt,
  ModelRouterDiagnostics,
  ModelRouterResolveRequest,
  ModelRouterResolveResult,
} from "./types.js";

interface CircuitState {
  failures: number;
  openUntil: number;
  lastUsed: number;
}

interface RateState {
  count: number;
  windowStart: number;
  lastUsed: number;
}

interface BudgetState {
  tokens: number;
  costUsd: number;
}

function modelKey(model: Pick<ModelConfig, "provider" | "model">): string {
  return `${model.provider}/${model.model}`;
}

function stateKey(provider: string, model: string, identityKey?: string): string {
  return identityKey ? `${identityKey}|${provider}/${model}` : `${provider}/${model}`;
}

function identityKeyFrom(identity: AgentIdentity | undefined): string | undefined {
  if (!identity) return undefined;
  return [identity.tenantId, identity.accountId, identity.userId, identity.principal.id].filter(Boolean).join(":");
}

function identityRefs(identity: AgentIdentity | undefined): ModelRouterDiagnostics["identityRefs"] {
  if (!identity) return undefined;
  return {
    tenantId: identity.tenantId,
    principalId: identity.principal.id,
    principalKind: identity.principal.kind,
  };
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function redactDiagnostics(diagnostics: ModelRouterDiagnostics, maxBytes: number): ModelRouterDiagnostics {
  const frozen = Object.freeze({
    ...diagnostics,
    attempts: Object.freeze(diagnostics.attempts.map((a) => Object.freeze({ ...a }))),
    ...(diagnostics.identityRefs ? { identityRefs: Object.freeze({ ...diagnostics.identityRefs }) } : {}),
  });
  if (utf8Bytes(frozen) > maxBytes) {
    return Object.freeze({
      outcome: frozen.outcome,
      reason: frozen.reason ?? "diagnostics_truncated",
      selectedProvider: frozen.selectedProvider,
      selectedModel: frozen.selectedModel,
      attempts: Object.freeze(
        frozen.attempts.slice(0, 3).map((a) =>
          Object.freeze({
            provider: a.provider,
            model: a.model,
            outcome: a.outcome,
            reason: a.reason,
          }),
        ),
      ),
      openRouterRoutingHonored: frozen.openRouterRoutingHonored,
    });
  }
  return frozen;
}

function hasOpenRouterRouting(model: ModelConfig): boolean {
  const routing = model.compat?.openRouterRouting;
  return routing !== undefined && routing !== null;
}

function stripOpenRouterRouting(model: ModelConfig): ModelConfig {
  if (!model.compat || model.compat.openRouterRouting === undefined) return model;
  const { openRouterRouting: _drop, ...rest } = model.compat;
  return { ...model, compat: Object.keys(rest).length > 0 ? rest : undefined };
}

function createOpenRouterGatePolicy(allow: boolean): ProviderRequestPolicy {
  return {
    name: allow ? "model-router:openrouter-routing-allow" : "model-router:openrouter-routing-deny",
    async apply({ request }): Promise<ProviderRequest> {
      if (allow) return request;
      const model = stripOpenRouterRouting(request.model);
      const compat = request.options?.compat;
      if (!compat || compat.openRouterRouting === undefined) {
        return model === request.model ? request : { ...request, model };
      }
      const { openRouterRouting: _drop, ...restCompat } = compat;
      return {
        ...request,
        model,
        options: {
          ...request.options,
          compat: Object.keys(restCompat).length > 0 ? restCompat : undefined,
        },
      };
    },
  };
}

function evictOldest<T extends { lastUsed: number }>(map: Map<string, T>, maxKeys: number): void {
  while (map.size > maxKeys) {
    let oldestKey: string | undefined;
    let oldest = Infinity;
    for (const [key, value] of map) {
      if (value.lastUsed < oldest) {
        oldest = value.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

/** Governance facade over an existing {@link import("@arnilo/prism").ProviderResolver}. */
export function createModelRouter(options: CreateModelRouterOptions): ModelRouter {
  if (!options.resolver) throw new ModelRouterError("resolver required", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
  const limits = resolveModelRouterLimits(options.limits);
  const now = options.now ?? Date.now;
  const failureThreshold = options.circuit?.failureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD;
  const coolDownMs = options.circuit?.coolDownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS;
  if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1) {
    throw new ModelRouterError("circuit.failureThreshold must be a positive safe integer", "ERR_PRISM_MODEL_ROUTER_LIMITS");
  }
  if (!Number.isSafeInteger(coolDownMs) || coolDownMs < 1) {
    throw new ModelRouterError("circuit.coolDownMs must be a positive safe integer", "ERR_PRISM_MODEL_ROUTER_LIMITS");
  }
  if (options.rateLimit) {
    if (!Number.isSafeInteger(options.rateLimit.maxRequests) || options.rateLimit.maxRequests < 1) {
      throw new ModelRouterError("rateLimit.maxRequests must be a positive safe integer", "ERR_PRISM_MODEL_ROUTER_LIMITS");
    }
    if (!Number.isSafeInteger(options.rateLimit.windowMs) || options.rateLimit.windowMs < 1) {
      throw new ModelRouterError("rateLimit.windowMs must be a positive safe integer", "ERR_PRISM_MODEL_ROUTER_LIMITS");
    }
  }
  for (const [label, value] of [
    ["budgets.maxTokens", options.budgets?.maxTokens],
    ["budgets.maxCostUsd", options.budgets?.maxCostUsd],
  ] as const) {
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
      throw new ModelRouterError(`${label} must be a finite non-negative number`, "ERR_PRISM_MODEL_ROUTER_LIMITS");
    }
  }

  const circuits = new Map<string, CircuitState>();
  const rates = new Map<string, RateState>();
  const budgets = new Map<string, BudgetState>();
  const openRouterPolicy = createOpenRouterGatePolicy(options.allowOpenRouterRouting === true);

  function assertAllowList(model: ModelConfig): void {
    const list = options.allowList;
    if (!list) return;
    if (list.providers && !list.providers.includes(model.provider)) {
      throw new ModelRouterError(`provider not allow-listed: ${model.provider}`, "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST");
    }
    if (list.models && !list.models.includes(model.model) && !list.models.includes(modelKey(model))) {
      throw new ModelRouterError(`model not allow-listed: ${modelKey(model)}`, "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST");
    }
  }

  function assertResidency(residency: string | undefined): void {
    if (!options.allowedResidencies?.length) return;
    if (!residency || !options.allowedResidencies.includes(residency)) {
      throw new ModelRouterError(
        residency ? `residency not allowed: ${residency}` : "residency required",
        "ERR_PRISM_MODEL_ROUTER_RESIDENCY",
      );
    }
  }

  function assertBudget(key: string, request: ModelRouterResolveRequest): void {
    const maxTokens = request.maxTokens ?? options.budgets?.maxTokens;
    const maxCost = request.maxCostUsd ?? options.budgets?.maxCostUsd;
    if (maxTokens === undefined && maxCost === undefined) return;
    if (maxTokens !== undefined && !(Number.isFinite(maxTokens) && maxTokens >= 0)) {
      throw new ModelRouterError("maxTokens must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    }
    if (maxCost !== undefined && !(Number.isFinite(maxCost) && maxCost >= 0)) {
      throw new ModelRouterError("maxCostUsd must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    }
    const used = budgets.get(key) ?? { tokens: 0, costUsd: 0 };
    if (maxTokens !== undefined && used.tokens >= maxTokens) {
      throw new ModelRouterError("token budget exhausted", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    }
    if (maxCost !== undefined && used.costUsd >= maxCost) {
      throw new ModelRouterError("cost budget exhausted", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    }
  }

  function assertRate(key: string, t: number): void {
    const cfg = options.rateLimit;
    if (!cfg) return;
    let state = rates.get(key);
    if (!state || t - state.windowStart >= cfg.windowMs) {
      state = { count: 0, windowStart: t, lastUsed: t };
    }
    if (state.count >= cfg.maxRequests) {
      const retryAfterMs = Math.max(1, cfg.windowMs - (t - state.windowStart));
      throw new ModelRouterError(`rate limit exceeded; retry after ${retryAfterMs}ms`, "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT", undefined, {
        retryAfterMs,
      });
    }
    state.count += 1;
    state.lastUsed = t;
    rates.set(key, state);
    evictOldest(rates, limits.maxCircuitKeys);
  }

  function circuitOpen(key: string, t: number): boolean {
    const state = circuits.get(key);
    if (!state) return false;
    if (state.openUntil > t) {
      state.lastUsed = t;
      return true;
    }
    if (state.openUntil > 0 && state.openUntil <= t) {
      state.failures = 0;
      state.openUntil = 0;
    }
    state.lastUsed = t;
    return false;
  }

  async function emit(diagnostics: ModelRouterDiagnostics): Promise<ModelRouterDiagnostics> {
    const redacted = redactDiagnostics(diagnostics, limits.maxDiagnosticsBytes);
    await options.onDiagnostics?.(redacted);
    return redacted;
  }

  async function resolve(request: ModelRouterResolveRequest): Promise<ModelRouterResolveResult> {
    request.signal?.throwIfAborted();
    if (request.identity && request.identity.verified !== true) {
      throw new ModelRouterError("identity must be host-verified", "ERR_PRISM_MODEL_ROUTER_IDENTITY");
    }
    const t = now();
    const idKey = identityKeyFrom(request.identity);
    const attempts: ModelRouterAttempt[] = [];
    const candidates = [request.model, ...(request.fallbacks ?? options.fallbacks ?? [])].slice(0, limits.maxAttempts);

    let lastDeny: { reason: string; code: string } | undefined;

    for (const candidate of candidates) {
      request.signal?.throwIfAborted();
      const key = stateKey(candidate.provider, candidate.model, idKey);
      try {
        assertAllowList(candidate);
        assertResidency(request.residency);
        assertBudget(idKey ?? "global", request);
        assertRate(key, t);
      } catch (error) {
        const err = error as ModelRouterError;
        const reason =
          err.code === "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST"
            ? "allow_list"
            : err.code === "ERR_PRISM_MODEL_ROUTER_RESIDENCY"
              ? "residency"
              : err.code === "ERR_PRISM_MODEL_ROUTER_BUDGET"
                ? "budget"
                : err.code === "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT"
                  ? "rate_limit"
                  : err.code;
        attempts.push({ provider: candidate.provider, model: candidate.model, outcome: "denied", reason });
        lastDeny = { reason: err.message, code: err.code };
        // allow-list/residency/budget are hard stops (no fallback)
        if (reason === "allow_list" || reason === "residency" || reason === "budget") {
          const diagnostics = await emit({
            outcome: "deny",
            reason,
            attempts,
            identityRefs: identityRefs(request.identity),
            residency: request.residency,
            region: request.region,
            openRouterRoutingHonored: false,
          });
          throw new ModelRouterError(err.message, err.code, diagnostics);
        }
        continue;
      }

      if (circuitOpen(key, t)) {
        attempts.push({ provider: candidate.provider, model: candidate.model, outcome: "circuit_open", reason: "circuit_open" });
        lastDeny = { reason: `circuit open: ${modelKey(candidate)}`, code: "ERR_PRISM_MODEL_ROUTER_CIRCUIT" };
        continue;
      }

      const provider: AIProvider | undefined = options.resolver(candidate);
      if (!provider) {
        attempts.push({ provider: candidate.provider, model: candidate.model, outcome: "miss", reason: "unknown_provider" });
        lastDeny = { reason: `Unknown provider: ${candidate.provider}`, code: "ERR_PRISM_MODEL_ROUTER_UNKNOWN_PROVIDER" };
        continue;
      }

      const honorOpenRouter = options.allowOpenRouterRouting === true;
      if (!honorOpenRouter && hasOpenRouterRouting(candidate)) {
        // still select provider; routing metadata stripped via policy — note denied honor
      }
      const model = honorOpenRouter ? candidate : stripOpenRouterRouting(candidate);
      attempts.push({ provider: candidate.provider, model: candidate.model, outcome: "selected" });
      const diagnostics = await emit({
        outcome: "allow",
        selectedProvider: candidate.provider,
        selectedModel: candidate.model,
        attempts,
        identityRefs: identityRefs(request.identity),
        residency: request.residency,
        region: request.region,
        openRouterRoutingHonored: honorOpenRouter && hasOpenRouterRouting(candidate),
      });
      return {
        provider,
        model,
        diagnostics,
        providerRequestPolicy: openRouterPolicy,
      };
    }

    const diagnostics = await emit({
      outcome: "deny",
      reason: lastDeny ? (attempts.at(-1)?.reason ?? "attempts_exhausted") : "attempts_exhausted",
      attempts,
      identityRefs: identityRefs(request.identity),
      residency: request.residency,
      region: request.region,
      openRouterRoutingHonored: false,
    });
    throw new ModelRouterError(
      lastDeny?.reason ?? "model router attempts exhausted",
      lastDeny?.code ?? "ERR_PRISM_MODEL_ROUTER_ATTEMPTS",
      diagnostics,
    );
  }

  const router: ModelRouter = {
    resolve,
    providerSource(model) {
      // Sync facade: allow-list + residency defaults + circuit; no async diagnostics hook.
      assertAllowList(model);
      if (options.allowedResidencies?.length) {
        const residency = typeof model.compat?.residency === "string" ? model.compat.residency : undefined;
        assertResidency(residency);
      }
      const key = stateKey(model.provider, model.model);
      if (circuitOpen(key, now())) {
        throw new ModelRouterError(`circuit open: ${modelKey(model)}`, "ERR_PRISM_MODEL_ROUTER_CIRCUIT");
      }
      const provider = options.resolver(model);
      if (!provider) return undefined;
      return provider;
    },
    recordUsage(input) {
      const key = input.identityKey ?? "global";
      const used = budgets.get(key) ?? { tokens: 0, costUsd: 0 };
      if (input.tokens !== undefined) {
        if (!Number.isFinite(input.tokens) || input.tokens < 0) {
          throw new ModelRouterError("tokens must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
        }
        used.tokens += input.tokens;
      }
      if (input.costUsd !== undefined) {
        if (!Number.isFinite(input.costUsd) || input.costUsd < 0) {
          throw new ModelRouterError("costUsd must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
        }
        used.costUsd += input.costUsd;
      }
      budgets.set(key, used);
    },
    recordOutcome(input) {
      const t = now();
      const key = stateKey(input.provider, input.model, input.identityKey);
      let state = circuits.get(key) ?? { failures: 0, openUntil: 0, lastUsed: t };
      if (input.success) {
        state = { failures: 0, openUntil: 0, lastUsed: t };
      } else {
        state.failures += 1;
        state.lastUsed = t;
        if (state.failures >= failureThreshold) state.openUntil = t + coolDownMs;
      }
      circuits.set(key, state);
      evictOldest(circuits, limits.maxCircuitKeys);
    },
    createOpenRouterRoutingPolicy() {
      return openRouterPolicy;
    },
  };
  return router;
}
