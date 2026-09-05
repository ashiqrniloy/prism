import type { JsonObject, ProviderRequest } from "@arnilo/prism";
import { snapThinkingLevel } from "@arnilo/prism";
import { openAIThinkingLevels } from "../openai/models.js";

/** Vertex-hosted Gemini models accept `reasoning_effort` mapped to thinking budgets. */
const VERTEX_GEMINI_LEVELS = ["low", "medium", "high"] as const;

/**
 * Declared effort levels for a gateway request: the model's own declaration wins;
 * otherwise provider-id heuristics apply (vertex gemini → low/medium/high; azure
 * deployments and bedrock OpenAI models → the OpenAI family table keyed by the
 * deployment/model id). `undefined` → passthrough.
 */
function declaredLevelsFor(request: ProviderRequest): readonly string[] | undefined {
  const declared = request.model.capabilities?.thinkingLevels;
  if (declared && declared.length > 0) return declared;
  const provider = (request.model.provider ?? "").toLowerCase();
  const id = request.model.model.toLowerCase();
  if (provider.startsWith("vertex")) return id.includes("gemini") ? VERTEX_GEMINI_LEVELS : undefined;
  if (provider.startsWith("azure") || provider.startsWith("bedrock")) return openAIThinkingLevels(id);
  return undefined;
}

/**
 * Sanitized chat-completions body extra for OpenAI-compatible gateways
 * (Azure / Vertex / Bedrock). Forwards only recognized thinking keys from
 * `compat` — `reasoning_effort` (string; `effort`/`reasoningEffort` aliases)
 * and `reasoning` (object: `effort`/`summary`) — snapping effort to the
 * model's declared levels when present. Everything else is dropped, so no
 * opaque compat key can leak onto the wire.
 */
export function openAICompatThinkingExtra(request: ProviderRequest): JsonObject | undefined {
  const optionsCompat = request.options?.compat ?? {};
  const modelCompat = request.model.compat ?? {};
  const snap = (value: string): string => {
    const declared = declaredLevelsFor(request);
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
