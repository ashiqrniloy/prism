import type { JsonObject, ProviderRequest } from "@arnilo/prism";

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
 * catalog). Clamped to the model's documented effort set when one is declared —
 * a value outside the documented set is dropped rather than risking a 400.
 */
export function hyperReasoningEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  if (typeof effort !== "string" || !effort) return undefined;
  const allowed = request.model.compat?.effortLevels;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(effort)) return undefined;
  return effort;
}

/**
 * Upstream Chat Completions `thinking` object (Kimi K2.x / GLM-style). Request
 * wins. Hyper does not document gateway-owned thinking fields — forwarded.
 */
export function hyperThinking(request: ProviderRequest): JsonObject | boolean | undefined {
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
    ...rest
  } = compat;
  return Object.keys(rest).length > 0 ? rest : undefined;
}