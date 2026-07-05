import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/**
 * Read NeuralWatt reasoning/extra request fields from the standard
 * `request.options.compat` / `request.model.compat` escape hatches.
 *
 * These are provider value-adds only — none of them change core contracts.
 */
export function neuralWattReasoningEffort(request: ProviderRequest): string | undefined {
  const effort = request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

export function neuralWattThinkingTokenBudget(request: ProviderRequest): number | undefined {
  const budget = request.options?.compat?.thinking_token_budget ?? request.model.compat?.thinking_token_budget;
  return typeof budget === "number" ? budget : undefined;
}

export function neuralWattChatTemplateKwargs(request: ProviderRequest): JsonObject | undefined {
  const kwargs = request.options?.compat?.chat_template_kwargs ?? request.model.compat?.chat_template_kwargs;
  return kwargs && typeof kwargs === "object" ? (kwargs as JsonObject) : undefined;
}

export function neuralWattToolChoice(request: ProviderRequest): string | JsonObject | undefined {
  const choice = request.options?.compat?.tool_choice ?? request.model.compat?.tool_choice;
  return choice as string | JsonObject | undefined;
}

/**
 * Read NeuralWatt `preserve_thinking` from the standard `compat` escape hatch.
 * When true, prior assistant reasoning is kept in the request history so
 * multi-turn reasoning continues with its earlier chain of thought.
 */
export function neuralWattPreserveThinking(request: ProviderRequest): boolean | undefined {
  const value = request.options?.compat?.preserve_thinking ?? request.model.compat?.preserve_thinking;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Read NeuralWatt `clear_thinking` from the standard `compat` escape hatch.
 * When true, prior assistant reasoning is dropped from the request history
 * for the next turn, resetting the chain of thought.
 */
export function neuralWattClearThinking(request: ProviderRequest): boolean | undefined {
  const value = request.options?.compat?.clear_thinking ?? request.model.compat?.clear_thinking;
  return typeof value === "boolean" ? value : undefined;
}
