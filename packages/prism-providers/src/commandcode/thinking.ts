import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/** Provider-owned compat keys stripped before opaque compat spread. */
const OWNED_COMPAT_KEYS = new Set(["route", "preserveThinking", "pricing_source"]);

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

export function stripCommandCodeOwnedCompat(compat: JsonObject | undefined): JsonObject | undefined {
  if (!compat) return undefined;
  return Object.fromEntries(Object.entries(compat).filter(([key]) => !OWNED_COMPAT_KEYS.has(key))) as JsonObject;
}