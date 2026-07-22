import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/**
 * Official `generationConfig.thinkingConfig`. Request `options.compat.thinkingConfig`
 * wins over model default. Boolean true → `{ includeThoughts: true }`.
 * Also accepts portable `thinkingBudget` / `thinkingLevel` aliases.
 */
export function googleThinkingConfig(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinkingConfig ?? request.model.compat?.thinkingConfig;
  const budget =
    request.options?.compat?.thinkingBudget
    ?? request.model.compat?.thinkingBudget;
  const level =
    request.options?.compat?.thinkingLevel
    ?? request.model.compat?.thinkingLevel;

  let config: JsonObject | undefined;
  if (value === false) return undefined;
  if (value && typeof value === "object") config = { ...(value as JsonObject) };
  else if (value === true) config = { includeThoughts: true };

  if (typeof budget === "number") {
    config = { ...(config ?? { includeThoughts: true }), thinkingBudget: budget };
  }
  if (typeof level === "string") {
    config = { ...(config ?? { includeThoughts: true }), thinkingLevel: level };
  }
  return config;
}

/**
 * Whether to replay historical thinking/thought parts on the next request.
 * Request `compat.preserveThinking` wins; defaults true when the model declares reasoning.
 */
export function googlePreserveThinking(request: ProviderRequest): boolean {
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
 * Strip provider-owned compat keys before opaque generationConfig / body spread.
 */
export function stripGoogleOwnedCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const {
    thinkingConfig: _thinkingConfig,
    thinkingBudget: _thinkingBudget,
    thinkingLevel: _thinkingLevel,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    ...rest
  } = compat as Record<string, unknown>;
  return rest as JsonObject;
}
