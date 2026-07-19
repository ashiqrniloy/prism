import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/**
 * Whether to replay historical thinking on the next request.
 * Anthropic route → thinking content blocks; OpenAI route → `reasoning_content`.
 * Request `compat.preserveThinking` wins over model default; defaults to true when
 * the model declares reasoning capability.
 */
export function openCodeGoPreserveThinking(request: ProviderRequest): boolean {
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
 * Upstream Chat Completions `thinking` object (Kimi K2.x / GLM-style). Request wins.
 * OpenCode Go does not document gateway-owned thinking fields — these are forwarded.
 */
export function openCodeGoThinking(request: ProviderRequest): JsonObject | boolean | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false) return { type: "disabled" };
  if (value && typeof value === "object") return value as JsonObject;
  return value === true ? { type: "enabled" } : undefined;
}

/**
 * Upstream `reasoning_effort` (e.g. Kimi K3). Request wins over model default.
 */
export function openCodeGoReasoningEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort
    ?? request.options?.compat?.reasoningEffort
    ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

/**
 * Upstream OpenAI-style `reasoning` object merge (model default + per-turn override).
 */
export function openCodeGoReasoning(request: ProviderRequest): JsonObject | undefined {
  const fromModel = asObject(request.model.compat?.reasoning);
  const fromOptions = asObject(request.options?.compat?.reasoning);
  if (!fromModel && !fromOptions) return undefined;
  return clean({ ...fromModel, ...fromOptions });
}

/**
 * Strip OpenCode-Go-owned compat keys before opaque body spread so resolved
 * thinking / reasoning / route / preserve flags cannot be overwritten.
 */
export function stripOpenCodeGoOwnedCompat(compat: JsonObject | undefined): JsonObject | undefined {
  if (!compat) return undefined;
  const {
    route: _route,
    thinking: _thinking,
    reasoning: _reasoning,
    reasoning_effort: _effort,
    reasoningEffort: _effortCamel,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    ...rest
  } = compat;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
