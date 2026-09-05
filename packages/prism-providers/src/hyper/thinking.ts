import type { JsonObject, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { snapThinkingLevel } from "@arnilo/prism";

/**
 * Whether to replay historical thinking on the next request.
 * Anthropic route → thinking content blocks; OpenAI route → `reasoning_content`.
 * Request `compat.preserveThinking` wins over model default; defaults to true when
 * the model declares reasoning capability.
 */
export function hyperPreserveThinking(request: ProviderRequest): boolean {
  const value =
    request.options?.compat?.preserveThinking ??
    request.options?.compat?.preserve_thinking ??
    request.model.compat?.preserveThinking ??
    request.model.compat?.preserve_thinking;
  if (value === false) return false;
  if (value === true) return true;
  return request.model.capabilities?.reasoning === true;
}

/**
 * Upstream Chat Completions `reasoning_effort`. Request wins over the model
 * default (`reasoning.effort_levels` / `default_effort_level` from the live
 * catalog). Snapped to the model's declared set when one is declared —
 * `capabilities.thinkingLevels` primary, legacy `compat.effortLevels` mirror
 * kept for hosts that set compat directly. Undeclared models and opaque
 * (non-ladder) values pass through.
 */
export function hyperReasoningEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  if (typeof effort !== "string" || !effort.trim()) return undefined;
  const normalized = effort.trim().toLowerCase();
  const declared = request.model.capabilities?.thinkingLevels ?? (request.model.compat?.effortLevels as readonly string[] | undefined);
  if (!declared || declared.length === 0) return normalized;
  const view: Pick<ModelConfig, "provider" | "compat" | "capabilities"> = {
    provider: request.model.provider,
    compat: request.model.compat,
    capabilities: { ...request.model.capabilities, thinkingLevels: declared },
  };
  return String(snapThinkingLevel(view, normalized));
}

/**
 * Upstream Chat Completions `thinking` object (Kimi K2.x / GLM-style). Request
 * wins. Hyper does not document gateway-owned thinking fields — forwarded.
 */
export function hyperThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false) return { type: "disabled" };
  if (value && typeof value === "object") return value as JsonObject;
  return value === true ? { type: "enabled" } : undefined;
}

/**
 * Strip Hyper-owned compat keys before opaque body spread so resolved
 * thinking / reasoning / route / preserve / effort-levels flags cannot be
 * overwritten. `effortLevels` is Hyper metadata, never wire.
 */
export function stripHyperOwnedCompat(compat: JsonObject | undefined): JsonObject | undefined {
  if (!compat) return undefined;
  const {
    route: _route,
    thinking: _thinking,
    reasoning: _reasoning,
    reasoning_effort: _effort,
    reasoningEffort: _effortCamel,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    effortLevels: _levels,
    thinkingFamily: _family,
    ...rest
  } = compat;
  return Object.keys(rest).length > 0 ? rest : undefined;
}
