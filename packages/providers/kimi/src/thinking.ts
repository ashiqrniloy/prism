import type { JsonObject, ProviderRequest } from "@arnilo/prism";
import { kimiIsK3Model } from "./models.js";

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

/** Documented K3 snapping: always-on, so `none` floors at `low`; the rest map to the declared ladder. */
const KIMI_K3_EFFORT_MAP: Readonly<Record<string, string>> = {
  none: "low",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "max",
  max: "max",
};

/**
 * Official K3 top-level `reasoning_effort`: `"low"` / `"high"` / `"max"`.
 * Open Platform default is `"max"`; Kimi Code default is `"high"` (model default).
 * K3 only — K2.x uses the `thinking` object family, so effort compat is dropped there.
 * Host-supplied values snap to the documented K3 ladder; unknown strings pass through
 * (forward compat). Request wins over model default.
 * @see https://platform.kimi.ai/docs/guide/use-thinking-effort
 */
export function kimiReasoningEffort(request: ProviderRequest): string | undefined {
  if (!kimiIsK3Model(request.model.model)) return undefined;
  const effort =
    request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  if (typeof effort !== "string" || !effort.trim()) return undefined;
  const normalized = effort.trim().toLowerCase();
  return KIMI_K3_EFFORT_MAP[normalized] ?? normalized;
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

/**
 * Strip provider-owned compat keys so the opaque compat spread cannot leak
 * routing/serialization directives (or inverted thinking values) into wire bodies.
 */
export function stripKimiThinkingCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const {
    thinking: _thinking,
    reasoning_effort: _effort,
    reasoningEffort: _effortCamel,
    preserveThinking: _preserve,
    preserve_thinking: _preserveSnake,
    thinkingFamily: _family,
    route: _route,
    ...rest
  } = compat as Record<string, unknown>;
  return rest as JsonObject;
}
