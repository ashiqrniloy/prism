import type { JsonObject, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { normalizeThinkingLevel, snapThinkingLevel } from "@arnilo/prism";

/**
 * Resolve a portable `thinkingLevel` for a Gemini model (phase 65 policy):
 * - level-native 3.x (declared `capabilities.thinkingLevels`): snap to the declared
 *   set via the core helper — `none`/`minimal` below the floor snap up to the minimum.
 * - budget-only 2.5 (`compat.thinkingBudgetRange`): `none` maps to the range minimum
 *   (`thinkingBudget: 0` where disabling is supported, 128 where it is not); any other
 *   level is unsupported and dropped.
 * - unknown model: passthrough when reasoning-capable, dropped otherwise.
 */
function resolveGoogleThinkingLevel(
  model: ModelConfig,
  level: string,
): { readonly kind: "level"; readonly value: string } | { readonly kind: "budget"; readonly value: number } | undefined {
  const declared = model.capabilities?.thinkingLevels;
  if (declared && declared.length > 0) return { kind: "level", value: snapThinkingLevel(model, level) };
  const range = model.compat?.thinkingBudgetRange;
  if (Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number") {
    return normalizeThinkingLevel(level) === "none" ? { kind: "budget", value: range[0] } : undefined;
  }
  return model.capabilities?.reasoning === true ? { kind: "level", value: level } : undefined;
}

/**
 * Official `generationConfig.thinkingConfig`. Request `options.compat.thinkingConfig`
 * wins over model default. Boolean true → `{ includeThoughts: true }`.
 * Also accepts portable `thinkingBudget` / `thinkingLevel` aliases — the level alias
 * is clamped per {@link resolveGoogleThinkingLevel}.
 */
export function googleThinkingConfig(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinkingConfig ?? request.model.compat?.thinkingConfig;
  const budget = request.options?.compat?.thinkingBudget ?? request.model.compat?.thinkingBudget;
  const level = request.options?.compat?.thinkingLevel ?? request.model.compat?.thinkingLevel;

  let config: JsonObject | undefined;
  if (value === false) return undefined;
  if (value && typeof value === "object") config = { ...(value as JsonObject) };
  else if (value === true) config = { includeThoughts: true };

  if (typeof budget === "number") {
    config = { ...(config ?? { includeThoughts: true }), thinkingBudget: budget };
  }
  if (typeof level === "string") {
    const resolved = resolveGoogleThinkingLevel(request.model, level);
    if (resolved?.kind === "level") {
      config = { ...(config ?? { includeThoughts: true }), thinkingLevel: resolved.value };
    } else if (resolved?.kind === "budget") {
      config = { ...(config ?? { includeThoughts: true }), thinkingBudget: resolved.value };
    }
    // resolved === undefined → unsupported level dropped (budget-only or non-reasoning model).
  }
  return config;
}

/**
 * Whether to replay historical thinking/thought parts on the next request.
 * Request `compat.preserveThinking` wins; defaults true when the model declares reasoning.
 */
export function googlePreserveThinking(request: ProviderRequest): boolean {
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
 * Strip provider-owned compat keys before opaque generationConfig / body spread.
 */
export function stripGoogleOwnedCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const {
    thinkingConfig: _thinkingConfig,
    thinkingBudget: _thinkingBudget,
    thinkingLevel: _thinkingLevel,
    thinkingBudgetRange: _budgetRange,
    thinkingFamily: _family,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    ...rest
  } = compat as Record<string, unknown>;
  return rest as JsonObject;
}
