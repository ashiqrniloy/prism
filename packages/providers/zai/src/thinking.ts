import type { JsonObject, ProviderRequest } from "@arnilo/prism";
import { isGlm52Model, isGlm53Model } from "./models.js";

/**
 * Map Prism compat → official Z.AI `thinking` body object.
 * @see https://docs.z.ai/guides/capabilities/thinking
 * @see https://docs.z.ai/api-reference/llm/chat-completion
 */
export function zaiThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  const clearThinking = zaiClearThinking(request);
  // GLM-5.3 / 5.3-FLASH force thinking: a `disabled` request must never reach the wire.
  const forcedThinking = isGlm53Model(request.model.model);

  if (zaiThinkingOff(request) && !forcedThinking) {
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
 * Host-supplied effort alias chain (request wins over model default), unvalidated.
 */
function zaiRequestedEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" && effort.trim() ? effort.trim().toLowerCase() : undefined;
}

/** GLM-5.2 upstream mapping: minimal/none stop thinking (no effort field), low/medium→high, xhigh→max. */
const ZAI_52_EFFORT_MAP: Readonly<Record<string, string | undefined>> = {
  none: undefined,
  minimal: undefined,
  low: "high",
  medium: "high",
  high: "high",
  xhigh: "max",
  max: "max",
};

/** GLM-5.3 accepts low | high | max only and cannot disable thinking — everything snaps into that set. */
const ZAI_53_EFFORT_MAP: Readonly<Record<string, string>> = {
  none: "low",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "max",
  max: "max",
};

/**
 * Official `reasoning_effort` — GLM-5.2+ only (upstream rejects it on GLM-4.x).
 * GLM-5.2 snaps per the documented table; GLM-5.3 snaps into low/high/max; unknown
 * strings pass through (forward compat). `none`/`minimal` on 5.2 return undefined —
 * zaiThinking emits `thinking: { type: "disabled" }` for them instead.
 * @see https://docs.z.ai/guides/capabilities/thinking
 */
export function zaiReasoningEffort(request: ProviderRequest): string | undefined {
  const id = request.model.model.toLowerCase();
  const requested = zaiRequestedEffort(request);
  if (requested === undefined) return undefined;
  if (isGlm53Model(id)) return ZAI_53_EFFORT_MAP[requested] ?? requested;
  if (isGlm52Model(id)) return ZAI_52_EFFORT_MAP[requested];
  return undefined;
}

/** True when thinking must render as disabled on the wire for this request. */
function zaiThinkingOff(request: ProviderRequest): boolean {
  const optionsThinking = request.options?.compat?.thinking;
  // Request-level explicit disable / cacheRetention:none always win.
  if (optionsThinking === false || request.options?.cacheRetention === "none") return true;
  // Request-level explicit enable wins over the effort alias.
  if (optionsThinking === true || (optionsThinking && typeof optionsThinking === "object")) return false;
  // GLM-5.2: request-level `reasoning_effort` decides when no thinking switch was sent —
  // none|minimal stop thinking (documented); any real effort implies thinking on.
  if (isGlm52Model(request.model.model)) {
    const requested = request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort;
    if (typeof requested === "string" && requested.trim()) {
      const normalized = requested.trim().toLowerCase();
      return normalized === "none" || normalized === "minimal";
    }
  }
  // Model defaults: explicit false disables.
  const value = optionsThinking ?? request.model.compat?.thinking;
  return value === false;
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
  const fromThinkingObject = readClearThinkingFromObject(request.options?.compat?.thinking ?? request.model.compat?.thinking);
  if (fromThinkingObject !== undefined) return fromThinkingObject;

  const value = request.options?.compat?.clear_thinking ?? request.options?.compat?.clearThinking ?? request.model.compat?.clear_thinking;
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
    request.options?.compat?.preserveThinking ??
    request.options?.compat?.preserve_thinking ??
    request.model.compat?.preserveThinking ??
    request.model.compat?.preserve_thinking;
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
