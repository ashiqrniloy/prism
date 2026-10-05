/**
 * Portable reasoning-effort level mapping for the OpenAI Responses wire.
 *
 * Shared by the OpenAI vendor package and every Responses-protocol adapter
 * (e.g. hyper) so the declared level set is identical across them.
 */

/** GPT-5.1 family: none (default), low, medium, high. */
function isGpt51Family(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("gpt-5.1");
}

/** GPT-5.2 family: none…xhigh (default medium). */
function isGpt52Family(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("gpt-5.2");
}

/**
 * Declared portable reasoning-effort levels per model family
 * (Research Matrix row openai, phase 65):
 * gpt-5.1 none/low/medium/high (default none), gpt-5.2 +xhigh (default medium),
 * gpt-5.x + o1/o3/o4 families minimal…high (default medium), the subscription
 * Responses aliases follow gpt-5.1. `undefined` for unknown ids → forward-compat passthrough.
 * @see https://developers.openai.com/api/docs/models/gpt-5.1
 */
export function openAIThinkingLevels(modelId: string): readonly string[] | undefined {
  const id = modelId.toLowerCase();
  if (isGpt52Family(id)) return ["none", "minimal", "low", "medium", "high", "xhigh"];
  if (isGpt51Family(id)) return ["none", "low", "medium", "high"];
  if (id.includes("gpt-5") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")) {
    return ["minimal", "low", "medium", "high"];
  }
  return undefined;
}

/** Official default `reasoning.effort` for a model family; `undefined` when none is declared. */
export function openAIDefaultEffort(modelId: string): string | undefined {
  const id = modelId.toLowerCase();
  if (isGpt52Family(id)) return "medium";
  if (isGpt51Family(id)) return "none";
  if (id.includes("gpt-5") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")) return "medium";
  return undefined;
}
