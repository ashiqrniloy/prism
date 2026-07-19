import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/**
 * Official K2.x Chat Completions / Anthropic-compat `thinking` object.
 * Request `options.compat.thinking` wins over `model.compat.thinking`.
 * @see https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model
 */
export function kimiThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false) return { type: "disabled" };
  if (value && typeof value === "object") return value as JsonObject;
  return value === true ? { type: "enabled" } : undefined;
}

/**
 * Official K3 top-level `reasoning_effort` (Open Platform currently documents `"max"`;
 * Kimi Code additionally maps `low` / `high` / `max` for model id `k3`).
 * Request wins over model default.
 * @see https://platform.kimi.ai/docs/guide/use-thinking-effort
 */
export function kimiReasoningEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort
    ?? request.options?.compat?.reasoningEffort
    ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

/**
 * Whether to replay historical thinking blocks (Anthropic `thinking` content or
 * Open Platform `reasoning_content`). K2.7-code / Coding models always preserve.
 * Request `compat.preserveThinking` wins over model default.
 */
export function kimiPreserveThinking(request: ProviderRequest): boolean {
  const value = request.options?.compat?.preserveThinking ?? request.model.compat?.preserveThinking;
  return value === true;
}

/** Strip thinking-owned keys so opaque compat spread cannot invert explicit resolvers. */
export function stripKimiThinkingCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const {
    thinking: _thinking,
    reasoning_effort: _effort,
    reasoningEffort: _effortCamel,
    preserveThinking: _preserve,
    ...rest
  } = compat as Record<string, unknown>;
  return rest as JsonObject;
}
