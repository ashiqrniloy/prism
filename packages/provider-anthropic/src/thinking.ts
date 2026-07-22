import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/**
 * Official Messages `thinking` object. Request `options.compat.thinking` wins over model default.
 * Hosts pass `{ type: "enabled", budget_tokens }` (Haiku 4.5 / older) or `{ type: "adaptive" }`
 * (Opus 4.8 / Sonnet 5 / Fable 5). Boolean true → `{ type: "enabled" }` (caller must add budget).
 */
export function anthropicThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false) return { type: "disabled" };
  if (value && typeof value === "object") return value as JsonObject;
  return value === true ? { type: "enabled" } : undefined;
}

/**
 * Official Messages `effort` (adaptive thinking depth). Request wins over model default.
 * Accepts `compat.effort` or portable `compat.reasoning_effort`.
 */
export function anthropicEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.effort
    ?? request.options?.compat?.reasoning_effort
    ?? request.options?.compat?.reasoningEffort
    ?? request.model.compat?.effort
    ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

/**
 * Whether to replay historical thinking blocks (with signatures) on the next request.
 * Request `compat.preserveThinking` wins; defaults true when the model declares reasoning.
 */
export function anthropicPreserveThinking(request: ProviderRequest): boolean {
  const value =
    request.options?.compat?.preserveThinking
    ?? request.options?.compat?.preserve_thinking
    ?? request.model.compat?.preserveThinking
    ?? request.model.compat?.preserve_thinking;
  if (value === false) return false;
  if (value === true) return true;
  return request.model.capabilities?.reasoning === true;
}

/**
 * Strip provider-owned compat keys before opaque body spread.
 */
export function stripAnthropicOwnedCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const {
    thinking: _thinking,
    effort: _effort,
    reasoning_effort: _effortSnake,
    reasoningEffort: _effortCamel,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    route: _route,
    ...rest
  } = compat as Record<string, unknown>;
  return rest as JsonObject;
}
