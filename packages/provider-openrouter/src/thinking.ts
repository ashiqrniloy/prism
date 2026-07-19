import type { JsonObject, ModelConfig, ProviderRequest, ProviderRequestOptions } from "@arnilo/prism";

/**
 * Resolve OpenRouter body `reasoning` from model defaults + per-turn override.
 * Request `options.compat.reasoning` wins key-by-key (Task 4 `openai_reasoning` family).
 * @see https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 */
export function resolveOpenRouterReasoning(
  model: ModelConfig,
  options: ProviderRequestOptions | undefined,
): JsonObject | undefined {
  const fromModel = asReasoningObject(model.compat?.reasoning);
  const fromOptions = asReasoningObject(options?.compat?.reasoning);
  if (!fromModel && !fromOptions) return undefined;
  return clean({ ...fromModel, ...fromOptions });
}

/**
 * Whether assistant thinking blocks should be replayed as OpenRouter `reasoning`
 * (or `reasoning_content` alias) instead of being folded into text content.
 * Official docs require preserving reasoning across tool-call turns.
 */
export function openRouterPreserveThinking(request: ProviderRequest): boolean {
  const compat = request.options?.compat ?? request.model.compat;
  if (compat?.preserveThinking === false || compat?.preserve_thinking === false) return false;
  if (compat?.preserveThinking === true || compat?.preserve_thinking === true) return true;
  return request.model.capabilities?.reasoning === true || request.model.compat?.reasoning != null;
}

/**
 * Strip OpenRouter-owned compat keys before opaque body spread so resolved
 * `reasoning` / routing / cache flags cannot be overwritten by raw passthrough.
 */
export function stripOpenRouterOwnedCompat(compat: JsonObject | undefined): JsonObject | undefined {
  if (!compat) return undefined;
  const {
    reasoning: _reasoning,
    reasoning_effort: _reasoningEffort,
    reasoningEffort: _reasoningEffortCamel,
    openRouterRouting: _routing,
    openRouterCache: _cache,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    openRouter: _meta,
    ...rest
  } = compat;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function asReasoningObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
