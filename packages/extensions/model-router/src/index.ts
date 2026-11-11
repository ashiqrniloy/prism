/**
 * `@arnilo/prism-extensions/model-router` — native model router package over `model.call`.
 *
 * Routes turns between candidate models using ordered or cost/latency selection, admits
 * budgets atomically, enforces rate and circuit limits, and falls through to fallback
 * candidates on errors before output.
 *
 * ```ts
 * import modelRouter from "@arnilo/prism-extensions/model-router";
 *
 * packages: [
 *   mockProvider(),
 *   modelRouter({ candidates: ["mock/fast", "other/large"], select: "ordered" }),
 * ];
 * ```
 */

import manifest from "../../package.json" with { type: "json" };
import { definePackage, type ModelConfig, parseModelRef } from "@arnilo/prism";
import { createModelCallAroundHandler } from "./around.js";
import { type ModelRouterConfig, modelRouterConfigSchema } from "./config.js";
import { ModelRouterError } from "./router/errors.js";
import { createModelRouter } from "./router/router.js";
import { createCostLatencySelection } from "./router/selection.js";
import { createMemoryModelRouterStateStore } from "./router/state.js";
import type { ModelRouterAllowList, ModelRouterCircuitOptions, ModelRouterSelectionPolicy, ModelRouterStateStore } from "./router/types.js";

export { MODEL_ROUTER_ERROR_CODES, ModelRouterError, type ModelRouterErrorCode } from "./router/errors.js";
export {
  DEFAULT_CIRCUIT_COOLDOWN_MS,
  DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_MODEL_ROUTER_LIMITS,
  HARD_MODEL_ROUTER_LIMITS,
  resolveModelRouterLimits,
} from "./router/limits.js";
export { createModelRouter } from "./router/router.js";
export { createCostLatencySelection } from "./router/selection.js";
export { createMemoryModelRouterStateStore } from "./router/state.js";
export { isOutputEvent } from "./around.js";
export { type ModelRouterCircuitConfig, type ModelRouterConfig, modelRouterConfigSchema } from "./config.js";
export type {
  CostLatencySelectionOptions,
  CreateModelRouterOptions,
  ModelRouteCandidate,
  ModelRouter,
  ModelRouterAllowList,
  ModelRouterAttempt,
  ModelRouterAttribution,
  ModelRouterBudgets,
  ModelRouterCircuitOptions,
  ModelRouterDenyReason,
  ModelRouterDiagnostics,
  ModelRouterLimits,
  ModelRouterRateLimit,
  ModelRouterReservation,
  ModelRouterResolveRequest,
  ModelRouterResolveResult,
  ModelRouterSelectionPolicy,
  ModelRouterStateKey,
  ModelRouterStateOwner,
  ModelRouterStateStore,
  PaidWorkKind,
  ResolvedModelRouterLimits,
} from "./router/types.js";

const PACKAGE = "@arnilo/prism-extensions/model-router";

function createDefinition() {
  return definePackage<ModelRouterConfig>({
    name: PACKAGE,
    version: manifest.version,
    description: "Native model router package: cost/latency-aware routing, budget reservation, circuits, and failover over model.call.",
    requires: { api: 1 },
    capabilities: ["models"],
    config: modelRouterConfigSchema,
    setup(prism) {
      if (!prism.config.candidates || prism.config.candidates.length === 0) {
        throw new ModelRouterError("candidates must have at least one candidate", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
      }

      const candidateConfigs: ModelConfig[] = prism.config.candidates.map(parseModelRef);

      let selection: ModelRouterSelectionPolicy | undefined;
      if (prism.config.select === "cost-latency") {
        selection = createCostLatencySelection();
      }

      let allowList: ModelRouterAllowList | undefined;
      if (prism.config.allow && prism.config.allow.length > 0) {
        const allowed = prism.config.allow.map(parseModelRef);
        allowList = {
          providers: [...new Set(allowed.map((c) => c.provider))],
          models: allowed.map((c) => c.model),
        };
      }

      let circuit: ModelRouterCircuitOptions | undefined;
      if (prism.config.circuit) {
        circuit = {
          failureThreshold: prism.config.circuit.failureThreshold,
          coolDownMs: prism.config.circuit.cooldownMs ?? prism.config.circuit.coolDownMs,
        };
      }

      const stateStore: ModelRouterStateStore =
        prism.services.consume<ModelRouterStateStore>("model-router.state") ?? createMemoryModelRouterStateStore();

      const router = createModelRouter({
        allowList,
        allowedResidencies: prism.config.residency ? [prism.config.residency] : undefined,
        budgets: prism.config.budgets,
        rateLimit: prism.config.rateLimit,
        circuit,
        stateStore,
        fallbacks: candidateConfigs.slice(1),
        allowOpenRouterRouting: prism.config.openRouterRouting === true,
        selection,
      });

      if (prism.config.openRouterRouting !== undefined) {
        prism.hooks.on("model.request", router.createOpenRouterRoutingTransform());
      }

      prism.hooks.on("model.call", createModelCallAroundHandler(prism, router, candidateConfigs));
    },
  });
}

const definition = createDefinition();

export default definition;
