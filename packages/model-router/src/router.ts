import {
  assertIdentityActive,
  type AgentIdentity,
  type AIProvider,
  type ModelConfig,
  type ProviderRequest,
  type ProviderRequestPolicy,
} from "@arnilo/prism";
import { ModelRouterError } from "./errors.js";
import { DEFAULT_CIRCUIT_COOLDOWN_MS, DEFAULT_CIRCUIT_FAILURE_THRESHOLD, resolveModelRouterLimits } from "./limits.js";
import { createMemoryModelRouterStateStore } from "./state.js";
import type {
  CreateModelRouterOptions,
  ModelRouter,
  ModelRouterAttempt,
  ModelRouterDiagnostics,
  ModelRouterResolveRequest,
  ModelRouterResolveResult,
  ModelRouterSelectionPolicy,
  ModelRouterStateKey,
  ModelRouterStateOwner,
} from "./types.js";

const DEFAULT_BUDGET_WINDOW_MS = 24 * 60 * 60_000;
const HARD_BUDGET_WINDOW_MS = 31 * 24 * 60 * 60_000;
const MAX_STATE_INTEGER = 2_147_483_647;
const MEMORY_OWNER: ModelRouterStateOwner = { tenantId: "__prism_memory__", principalId: "__prism_memory__" };

function modelKey(model: Pick<ModelConfig, "provider" | "model">): string {
  return `${model.provider}/${model.model}`;
}

/** The policy may only reorder: the ranked list must be a permutation of the input. */
function isPermutation(ranked: readonly ModelConfig[], original: readonly ModelConfig[]): boolean {
  if (ranked.length !== original.length) return false;
  const counts = new Map<string, number>();
  for (const candidate of original) {
    const key = modelKey(candidate);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const candidate of ranked) {
    const key = modelKey(candidate);
    const remaining = counts.get(key);
    if (remaining === undefined || remaining === 0) return false;
    counts.set(key, remaining - 1);
  }
  return true;
}

function assertSelectionPolicy(selection: ModelRouterSelectionPolicy | undefined): void {
  if (!selection) return;
  if (typeof selection.name !== "string" || selection.name.length === 0 || selection.name.length > 128) {
    throw new ModelRouterError("selection.name must be a non-empty string up to 128 chars", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
  }
  if (typeof selection.rank !== "function") {
    throw new ModelRouterError("selection.rank must be a function", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
  }
}

function stateKey(identity: AgentIdentity | undefined, provider: string, model: string): ModelRouterStateKey {
  const owner = identity
    ? {
        tenantId: identity.tenantId,
        ...(identity.accountId === undefined ? {} : { accountId: identity.accountId }),
        ...(identity.userId === undefined ? {} : { userId: identity.userId }),
        principalId: identity.principal.id,
      }
    : MEMORY_OWNER;
  return { ...owner, provider, model };
}

function identityRefs(identity: AgentIdentity | undefined): ModelRouterDiagnostics["identityRefs"] {
  if (!identity) return undefined;
  return { tenantId: identity.tenantId, principalId: identity.principal.id, principalKind: identity.principal.kind };
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
      attempts: Object.freeze(frozen.attempts.slice(0, 3).map((a) => Object.freeze({ ...a }))),
      openRouterRoutingHonored: frozen.openRouterRoutingHonored,
    });
  }
  return frozen;
}

function hasOpenRouterRouting(model: ModelConfig): boolean {
  return model.compat?.openRouterRouting !== undefined && model.compat?.openRouterRouting !== null;
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
      if (!compat || compat.openRouterRouting === undefined) return model === request.model ? request : { ...request, model };
      const { openRouterRouting: _drop, ...restCompat } = compat;
      return {
        ...request,
        model,
        options: { ...request.options, compat: Object.keys(restCompat).length > 0 ? restCompat : undefined },
      };
    },
  };
}

/** Governance facade over an existing {@link import("@arnilo/prism").ProviderResolver}. */
export function createModelRouter(options: CreateModelRouterOptions): ModelRouter {
  if (!options.resolver) throw new ModelRouterError("resolver required", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
  const limits = resolveModelRouterLimits(options.limits);
  const now = options.now ?? Date.now;
  const failureThreshold = options.circuit?.failureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD;
  const coolDownMs = options.circuit?.coolDownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS;
  const budgetWindowMs = resolveBudgetWindow(options.budgets?.windowMs);
  const stateStore = options.stateStore ?? createMemoryModelRouterStateStore();
  const externalState = options.stateStore !== undefined;
  const openRouterPolicy = createOpenRouterGatePolicy(options.allowOpenRouterRouting === true);
  assertSelectionPolicy(options.selection);

  if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1 || failureThreshold > MAX_STATE_INTEGER) {
    throw new ModelRouterError(
      "circuit.failureThreshold must be a positive safe integer in PostgreSQL range",
      "ERR_PRISM_MODEL_ROUTER_LIMITS",
    );
  }
  if (!Number.isSafeInteger(coolDownMs) || coolDownMs < 1 || coolDownMs > HARD_BUDGET_WINDOW_MS) {
    throw new ModelRouterError("circuit.coolDownMs must be a positive safe integer ≤ 31 days", "ERR_PRISM_MODEL_ROUTER_LIMITS");
  }
  if (options.rateLimit) {
    if (!Number.isSafeInteger(options.rateLimit.maxRequests) || options.rateLimit.maxRequests < 1) {
      throw new ModelRouterError("rateLimit.maxRequests must be a positive safe integer", "ERR_PRISM_MODEL_ROUTER_LIMITS");
    }
    if (
      !Number.isSafeInteger(options.rateLimit.windowMs) ||
      options.rateLimit.windowMs < 1 ||
      options.rateLimit.windowMs > HARD_BUDGET_WINDOW_MS
    ) {
      throw new ModelRouterError("rateLimit.windowMs must be a positive safe integer ≤ 31 days", "ERR_PRISM_MODEL_ROUTER_LIMITS");
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

  function assertIdentity(identity: AgentIdentity | undefined, required: boolean): void {
    if (!identity) {
      if (required) throw new ModelRouterError("identity is required for durable router state", "ERR_PRISM_MODEL_ROUTER_IDENTITY");
      return;
    }
    try {
      assertIdentityActive(identity);
    } catch {
      throw new ModelRouterError("identity must be active and host-verified", "ERR_PRISM_MODEL_ROUTER_IDENTITY");
    }
  }

  async function state<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ModelRouterError) throw error;
      throw new ModelRouterError("router state operation failed", "ERR_PRISM_MODEL_ROUTER_STATE");
    }
  }

  async function assertBudget(key: ModelRouterStateKey, request: ModelRouterResolveRequest, t: number): Promise<void> {
    const maxTokens = request.maxTokens ?? options.budgets?.maxTokens;
    const maxCost = request.maxCostUsd ?? options.budgets?.maxCostUsd;
    if (maxTokens === undefined && maxCost === undefined) return;
    if (maxTokens !== undefined && !(Number.isFinite(maxTokens) && maxTokens >= 0)) {
      throw new ModelRouterError("maxTokens must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    }
    if (maxCost !== undefined && !(Number.isFinite(maxCost) && maxCost >= 0)) {
      throw new ModelRouterError("maxCostUsd must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    }
    const used = await state(() => stateStore.readBudget({ key, windowMs: budgetWindowMs, now: t }));
    if (maxTokens !== undefined && used.tokens >= maxTokens)
      throw new ModelRouterError("token budget exhausted", "ERR_PRISM_MODEL_ROUTER_BUDGET");
    if (maxCost !== undefined && used.costUsd >= maxCost)
      throw new ModelRouterError("cost budget exhausted", "ERR_PRISM_MODEL_ROUTER_BUDGET");
  }

  async function assertRate(key: ModelRouterStateKey, t: number): Promise<void> {
    const cfg = options.rateLimit;
    if (!cfg) return;
    const result = await state(() => stateStore.consumeRate({ key, maxRequests: cfg.maxRequests, windowMs: cfg.windowMs, now: t }));
    if (!result.admitted) {
      throw new ModelRouterError(
        `rate limit exceeded; retry after ${result.retryAfterMs ?? 1}ms`,
        "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT",
        undefined,
        {
          retryAfterMs: result.retryAfterMs ?? 1,
        },
      );
    }
  }

  async function emit(diagnostics: ModelRouterDiagnostics): Promise<ModelRouterDiagnostics> {
    const redacted = redactDiagnostics(diagnostics, limits.maxDiagnosticsBytes);
    await options.onDiagnostics?.(redacted);
    return redacted;
  }

  async function resolve(request: ModelRouterResolveRequest): Promise<ModelRouterResolveResult> {
    request.signal?.throwIfAborted();
    assertIdentity(request.identity, externalState);
    const t = now();
    const attempts: ModelRouterAttempt[] = [];
    const assembled = [request.model, ...(request.fallbacks ?? options.fallbacks ?? [])].slice(0, limits.maxAttempts);
    let candidates: readonly ModelConfig[] = assembled;
    if (options.selection) {
      const ranked = options.selection.rank(assembled, request);
      if (!isPermutation(ranked, assembled)) {
        throw new ModelRouterError(
          `selection policy "${options.selection.name}" must return a permutation of the candidates`,
          "ERR_PRISM_MODEL_ROUTER_POLICY",
        ); // fail closed: a misbehaving policy can never add, drop, or duplicate candidates
      }
      candidates = ranked;
    }
    let lastDeny: { reason: string; code: string } | undefined;

    for (const candidate of candidates) {
      request.signal?.throwIfAborted();
      const key = stateKey(request.identity, candidate.provider, candidate.model);
      try {
        assertAllowList(candidate);
        assertResidency(request.residency);
        await assertBudget(key, request, t);
        await assertRate(key, t);
      } catch (error) {
        if (!(error instanceof ModelRouterError)) throw error;
        const reason = denyReason(error.code);
        attempts.push({ provider: candidate.provider, model: candidate.model, outcome: "denied", reason });
        lastDeny = { reason: error.message, code: error.code };
        if (reason === "allow_list" || reason === "residency" || reason === "budget" || error.code === "ERR_PRISM_MODEL_ROUTER_STATE") {
          const diagnostics = await emit({
            outcome: "deny",
            reason,
            attempts,
            identityRefs: identityRefs(request.identity),
            residency: request.residency,
            region: request.region,
            openRouterRoutingHonored: false,
            ...(options.selection ? { selection: options.selection.name } : {}),
          });
          throw new ModelRouterError(error.message, error.code, diagnostics, error.details);
        }
        continue;
      }

      const circuit = await state(() =>
        stateStore.claimCircuitProbe({ key, failureThreshold, coolDownMs, maxKeys: limits.maxCircuitKeys, now: t }),
      );
      if (!circuit.admitted) {
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
        ...(options.selection ? { selection: options.selection.name } : {}),
      });
      return {
        provider,
        model,
        diagnostics,
        ...(circuit.probeToken ? { circuitProbeToken: circuit.probeToken } : {}),
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
      ...(options.selection ? { selection: options.selection.name } : {}),
    });
    throw new ModelRouterError(
      lastDeny?.reason ?? "model router attempts exhausted",
      lastDeny?.code ?? "ERR_PRISM_MODEL_ROUTER_ATTEMPTS",
      diagnostics,
    );
  }

  return {
    resolve,
    providerSource(model) {
      if (externalState) throw new ModelRouterError("providerSource is unavailable with async state", "ERR_PRISM_MODEL_ROUTER_ASYNC_STATE");
      assertAllowList(model);
      if (options.allowedResidencies?.length) {
        assertResidency(typeof model.compat?.residency === "string" ? model.compat.residency : undefined);
      }
      return options.resolver(model);
    },
    async recordUsage(input) {
      assertIdentity(input.identity, true);
      if (input.tokens !== undefined && !(Number.isFinite(input.tokens) && input.tokens >= 0)) {
        throw new ModelRouterError("tokens must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
      }
      if (input.costUsd !== undefined && !(Number.isFinite(input.costUsd) && input.costUsd >= 0)) {
        throw new ModelRouterError("costUsd must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_BUDGET");
      }
      await state(() =>
        stateStore.addUsage({
          key: stateKey(input.identity, input.provider, input.model),
          tokens: input.tokens,
          costUsd: input.costUsd,
          windowMs: budgetWindowMs,
          now: now(),
        }),
      );
    },
    async recordOutcome(input) {
      assertIdentity(input.identity, true);
      if (input.latencyMs !== undefined && !(Number.isFinite(input.latencyMs) && input.latencyMs >= 0)) {
        throw new ModelRouterError("latencyMs must be finite non-negative", "ERR_PRISM_MODEL_ROUTER_LIMITS");
      }
      await state(() =>
        stateStore.recordCircuitOutcome({
          key: stateKey(input.identity, input.provider, input.model),
          success: input.success,
          failureThreshold,
          coolDownMs,
          maxKeys: limits.maxCircuitKeys,
          ...(input.circuitProbeToken ? { probeToken: input.circuitProbeToken } : {}),
          now: now(),
        }),
      );
      options.selection?.observe?.({
        provider: input.provider,
        model: input.model,
        success: input.success,
        ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      });
    },
    createOpenRouterRoutingPolicy() {
      return openRouterPolicy;
    },
  };
}

function resolveBudgetWindow(value: number | undefined): number {
  const windowMs = value ?? DEFAULT_BUDGET_WINDOW_MS;
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > HARD_BUDGET_WINDOW_MS) {
    throw new ModelRouterError("budgets.windowMs must be a positive safe integer ≤ 31 days", "ERR_PRISM_MODEL_ROUTER_LIMITS");
  }
  return windowMs;
}

function denyReason(code: string): string {
  if (code === "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST") return "allow_list";
  if (code === "ERR_PRISM_MODEL_ROUTER_RESIDENCY") return "residency";
  if (code === "ERR_PRISM_MODEL_ROUTER_BUDGET") return "budget";
  if (code === "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT") return "rate_limit";
  return code;
}
