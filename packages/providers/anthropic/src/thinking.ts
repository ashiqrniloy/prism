import type { JsonObject, ProviderRequest } from "@arnilo/prism";
import { ANTHROPIC_LEGACY_THINKING_DEFAULT_BUDGET, anthropicThinkingGeneration } from "./models.js";

/**
 * Official Messages `thinking` object. Request `options.compat.thinking` wins over model default.
 * Generation-aware (phase 65): on adaptive-generation models (Opus 4.6+, Sonnet 4.6+, Fable/Mythos,
 * Opus 5) any bare *enabled* request maps to `{ type: "adaptive" }` — `enabled`+budget is deprecated
 * there and rejected on 4.7+; on legacy models (Opus/Sonnet/Haiku 4.5) a bare enable gets a default
 * `budget_tokens` injected so `{ type: "enabled" }` without a budget can never reach the wire (defect 2).
 */
export function anthropicThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false) return { type: "disabled" };
  if (value && typeof value === "object") {
    const thinking = value as JsonObject;
    if (thinking.type === "enabled") {
      if (anthropicThinkingGeneration(request.model.model) === "adaptive") return { type: "adaptive" };
      if (typeof thinking.budget_tokens !== "number") {
        return { type: "enabled", budget_tokens: ANTHROPIC_LEGACY_THINKING_DEFAULT_BUDGET };
      }
    }
    return thinking;
  }
  if (value === true) {
    return anthropicThinkingGeneration(request.model.model) === "adaptive"
      ? { type: "adaptive" }
      : { type: "enabled", budget_tokens: ANTHROPIC_LEGACY_THINKING_DEFAULT_BUDGET };
  }
  return undefined;
}

/**
 * Official Messages `output_config.effort` (adaptive thinking depth). Request wins over model default.
 * Accepts `compat.effort`, portable `compat.reasoning_effort`, or the official nested
 * `compat.output_config.effort`. Emitted by {@link anthropicMessagesBody} as
 * `output_config: { effort }` — there is no top-level `effort` field in the current API.
 */
export function anthropicEffort(request: ProviderRequest): string | undefined {
  const outputConfig =
    (request.options?.compat?.output_config as JsonObject | undefined) ?? (request.model.compat?.output_config as JsonObject | undefined);
  const nested = outputConfig?.effort;
  const effort =
    typeof nested === "string"
      ? nested
      : (request.options?.compat?.effort ??
        request.options?.compat?.reasoning_effort ??
        request.options?.compat?.reasoningEffort ??
        request.model.compat?.effort ??
        request.model.compat?.reasoning_effort);
  return typeof effort === "string" ? effort : undefined;
}

/**
 * Whether to replay historical thinking blocks (with signatures) on the next request.
 * Request `compat.preserveThinking` wins; defaults true when the model declares reasoning.
 */
export function anthropicPreserveThinking(request: ProviderRequest): boolean {
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
 * Strip provider-owned compat keys before opaque body spread.
 */
export function stripAnthropicOwnedCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const {
    thinking: _thinking,
    effort: _effort,
    reasoning_effort: _effortSnake,
    reasoningEffort: _effortCamel,
    output_config: _outputConfig,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    thinkingFamily: _family,
    route: _route,
    ...rest
  } = compat as Record<string, unknown>;
  return rest as JsonObject;
}
