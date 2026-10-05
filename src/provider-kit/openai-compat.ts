import type { JsonObject, ProviderRequest } from "../contracts.js";
import { snapThinkingLevel } from "../thinking.js";
import { openAIThinkingLevels } from "./openai-thinking.js";

/** Resolves the effort-level fallback when the model declares none. */
export type ThinkingLevelsFallback = (request: ProviderRequest) => readonly string[] | undefined;

/** Default fallback: the OpenAI family table keyed by the model id. */
const openAICompatFamilyLevels: ThinkingLevelsFallback = (request) => openAIThinkingLevels(request.model.model.toLowerCase());

/**
 * Declared effort levels for an OpenAI-compatible gateway request: the model's
 * own declaration wins; otherwise `fallback` applies (default: the OpenAI family
 * table keyed by the model id). A gateway whose models are not OpenAI-family
 * passes its own fallback. `undefined` → passthrough.
 */
export function declaredThinkingLevelsFor(
  request: ProviderRequest,
  fallback: ThinkingLevelsFallback = openAICompatFamilyLevels,
): readonly string[] | undefined {
  const declared = request.model.capabilities?.thinkingLevels;
  if (declared && declared.length > 0) return declared;
  return fallback(request);
}

/**
 * Sanitized chat-completions body extra for OpenAI-compatible gateways.
 * Forwards only recognized thinking keys from `compat` — `reasoning_effort`
 * (string; `effort`/`reasoningEffort` aliases) and `reasoning` (object:
 * `effort`/`summary`) — snapping effort to the model's declared levels when
 * present. Everything else is dropped, so no opaque compat key can leak onto
 * the wire.
 */
export function openAICompatThinkingExtra(request: ProviderRequest, fallback?: ThinkingLevelsFallback): JsonObject | undefined {
  const optionsCompat = request.options?.compat ?? {};
  const modelCompat = request.model.compat ?? {};
  const snap = (value: string): string => {
    const declared = declaredThinkingLevelsFor(request, fallback);
    if (!declared) return value;
    // Heuristic declarations must reach the core snap — feed it a model view
    // carrying the effective level set (core reads capabilities.thinkingLevels).
    return String(
      snapThinkingLevel(
        {
          provider: request.model.provider,
          compat: request.model.compat,
          capabilities: { ...request.model.capabilities, thinkingLevels: declared },
        },
        value,
      ),
    );
  };

  const rawEffort =
    optionsCompat.effort ??
    optionsCompat.reasoning_effort ??
    optionsCompat.reasoningEffort ??
    modelCompat.effort ??
    modelCompat.reasoning_effort ??
    modelCompat.reasoningEffort;

  const rawReasoning = optionsCompat.reasoning ?? modelCompat.reasoning;
  let reasoningExtra: JsonObject | undefined;
  if (rawReasoning && typeof rawReasoning === "object" && !Array.isArray(rawReasoning)) {
    const reasoning = rawReasoning as JsonObject;
    const effort = typeof reasoning.effort === "string" ? snap(reasoning.effort) : undefined;
    const summary = typeof reasoning.summary === "string" ? reasoning.summary : undefined;
    if (effort !== undefined || summary !== undefined) {
      reasoningExtra = { ...(effort !== undefined ? { effort } : {}), ...(summary !== undefined ? { summary } : {}) };
    }
  }
  if (typeof rawEffort !== "string" && !reasoningExtra) return undefined;
  return {
    ...(typeof rawEffort === "string" ? { reasoning_effort: snap(rawEffort) } : {}),
    ...(reasoningExtra ? { reasoning: reasoningExtra } : {}),
  };
}
