import type { JsonObject, ProviderRequest } from "@arnilo/prism";
import { snapThinkingLevel } from "@arnilo/prism";

/** Provider-owned compat keys stripped before opaque compat spread. */
const OWNED_COMPAT_KEYS = new Set([
  "route",
  "preserveThinking",
  "pricing_source",
  "thinking",
  "effort",
  "reasoning_effort",
  "reasoningEffort",
  "reasoning",
  "output_config",
  "thinkingFamily",
]);

/**
 * Preserve prior thinking on the wire for tool-call continuity and cache-prefix
 * stability: Anthropic thinking blocks on the messages route,
 * `reasoning_content` replay on the chat route. Default on (docs neither
 * recommend nor forbid it; reasoning models need it for tool continuity);
 * per-turn `options.compat.preserveThinking` wins when set false.
 */
export function commandCodePreserveThinking(request: ProviderRequest): boolean {
  const compat = request.options?.compat;
  if (compat && typeof compat.preserveThinking === "boolean") return compat.preserveThinking;
  const model = request.model.compat as JsonObject | undefined;
  if (model && typeof model.preserveThinking === "boolean") return model.preserveThinking;
  return true;
}

/**
 * Upstream Messages-route `thinking` object (forwarded; generation-aware mapping
 * for bare enables is applied by the shared serializer's contract caveat — see
 * `anthropic` package for the canonical generation mapping).
 */
export function commandCodeThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false) return { type: "disabled" };
  if (value && typeof value === "object") return value as JsonObject;
  return value === true ? { type: "enabled" } : undefined;
}

/**
 * Upstream effort value (Messages-route `output_config.effort` / Chat
 * `reasoning_effort`). Request wins over model default; accepts `compat.effort`
 * or the portable `compat.reasoning_effort`. Snapped to the model's declared
 * set when one is stamped; undeclared models pass through.
 */
export function commandCodeEffort(request: ProviderRequest): string | undefined {
  const outputConfig = request.options?.compat?.output_config ?? request.model.compat?.output_config;
  const outputEffort = outputConfig && typeof outputConfig === "object" ? (outputConfig as JsonObject).effort : undefined;
  const effort =
    outputEffort ??
    request.options?.compat?.effort ??
    request.options?.compat?.reasoning_effort ??
    request.options?.compat?.reasoningEffort ??
    request.model.compat?.effort ??
    request.model.compat?.reasoning_effort;
  if (typeof effort !== "string" || !effort.trim()) return undefined;
  return String(snapThinkingLevel(request.model, effort.trim().toLowerCase()));
}

/**
 * Upstream OpenAI-style `reasoning` object (gpt-5.6 chat route). Model default
 * merged with per-turn override; `effort` snapped to declared levels.
 */
export function commandCodeReasoning(request: ProviderRequest): JsonObject | undefined {
  const fromModel = asObject(request.model.compat?.reasoning);
  const fromOptions = asObject(request.options?.compat?.reasoning);
  if (!fromModel && !fromOptions) return undefined;
  const merged = clean({ ...fromModel, ...fromOptions });
  const effort = merged.effort;
  return typeof effort === "string" ? clean({ ...merged, effort: snapThinkingLevel(request.model, effort) }) : merged;
}

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

export function stripCommandCodeOwnedCompat(compat: JsonObject | undefined): JsonObject | undefined {
  if (!compat) return undefined;
  return Object.fromEntries(Object.entries(compat).filter(([key]) => !OWNED_COMPAT_KEYS.has(key))) as JsonObject;
}
