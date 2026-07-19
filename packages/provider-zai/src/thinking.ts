import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/**
 * Map Prism compat → official Z.AI `thinking` body object.
 * @see https://docs.z.ai/guides/capabilities/thinking
 * @see https://docs.z.ai/api-reference/llm/chat-completion
 */
export function zaiThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  const clearThinking = zaiClearThinking(request);

  if (value === false || request.options?.cacheRetention === "none") {
    return cleanThinking({ type: "disabled", clear_thinking: clearThinking });
  }
  if (value && typeof value === "object") {
    return cleanThinking({
      ...(value as JsonObject),
      ...(clearThinking !== undefined ? { clear_thinking: clearThinking } : {}),
    });
  }
  if (value === true) {
    return cleanThinking({ type: "enabled", clear_thinking: clearThinking });
  }
  // Hosts may set only `clear_thinking` / preserve flags without an explicit thinking switch.
  if (clearThinking !== undefined) {
    return cleanThinking({ type: "enabled", clear_thinking: clearThinking });
  }
  return undefined;
}

/**
 * Official `reasoning_effort` (GLM-5.2+). Request `options.compat` wins over model defaults.
 * Allowed: max | xhigh | high | medium | low | minimal | none.
 * @see https://docs.z.ai/guides/capabilities/thinking
 */
export function zaiReasoningEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort
    ?? request.options?.compat?.reasoningEffort
    ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

/**
 * Official `tool_stream` (GLM-4.6+). Request wins over model defaults.
 * @see https://docs.z.ai/guides/capabilities/stream-tool
 */
export function zaiToolStream(request: ProviderRequest): boolean | undefined {
  const value = request.options?.compat?.tool_stream ?? request.model.compat?.tool_stream;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Official nested `thinking.clear_thinking` (default true on the wire).
 * When false, prior `reasoning_content` must be replayed for Preserved Thinking.
 * @see https://docs.z.ai/guides/capabilities/thinking-mode
 */
export function zaiClearThinking(request: ProviderRequest): boolean | undefined {
  const fromThinkingObject = readClearThinkingFromObject(
    request.options?.compat?.thinking ?? request.model.compat?.thinking,
  );
  if (fromThinkingObject !== undefined) return fromThinkingObject;

  const value =
    request.options?.compat?.clear_thinking
    ?? request.options?.compat?.clearThinking
    ?? request.model.compat?.clear_thinking;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Prism-local: when true (and clear_thinking is not true), replay prior thinking
 * blocks as assistant `reasoning_content`. Official Preserved Thinking also requires
 * `thinking.clear_thinking: false`.
 */
export function zaiPreserveThinking(request: ProviderRequest): boolean {
  const clear = zaiClearThinking(request);
  if (clear === true) return false;
  const value =
    request.options?.compat?.preserveThinking
    ?? request.options?.compat?.preserve_thinking
    ?? request.model.compat?.preserveThinking
    ?? request.model.compat?.preserve_thinking;
  if (typeof value === "boolean") return value;
  // clear_thinking:false implies preserved thinking even without an explicit preserve flag.
  return clear === false;
}

function readClearThinkingFromObject(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const clear = (value as JsonObject).clear_thinking ?? (value as JsonObject).clearThinking;
  return typeof clear === "boolean" ? clear : undefined;
}

function cleanThinking(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
