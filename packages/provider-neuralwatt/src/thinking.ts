import type { JsonObject, ProviderRequest } from "@arnilo/prism";

/**
 * Read NeuralWatt reasoning/extra request fields from the standard
 * `request.options.compat` / `request.model.compat` escape hatches.
 *
 * These are provider value-adds only — none of them change core contracts.
 */
export function neuralWattReasoningEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort
    ?? request.options?.compat?.reasoningEffort
    ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

export function neuralWattThinkingTokenBudget(request: ProviderRequest): number | undefined {
  const budget =
    request.options?.compat?.thinking_token_budget
    ?? request.model.compat?.thinking_token_budget;
  return typeof budget === "number" ? budget : undefined;
}

/**
 * Merge official NeuralWatt `chat_template_kwargs` with Prism compat flags.
 * Official docs route `preserve_thinking` / `clear_thinking` through kwargs
 * (not top-level body fields). Request `options.compat.chat_template_kwargs`
 * wins over model defaults; explicit kwargs keys win over root compat flags.
 *
 * @see https://portal.neuralwatt.com/docs/api/chat-completions#preserving-reasoning-across-turns
 */
export function neuralWattChatTemplateKwargs(request: ProviderRequest): JsonObject | undefined {
  const modelKwargs = asObject(request.model.compat?.chat_template_kwargs);
  const optionsKwargs = asObject(request.options?.compat?.chat_template_kwargs);
  const kwargs: Record<string, unknown> = { ...modelKwargs, ...optionsKwargs };

  const preserve = neuralWattPreserveThinking(request);
  const clear = neuralWattClearThinking(request);
  if (preserve !== undefined && !("preserve_thinking" in optionsKwargs)) {
    kwargs.preserve_thinking = preserve;
  }
  if (clear !== undefined && !("clear_thinking" in optionsKwargs)) {
    kwargs.clear_thinking = clear;
  }

  return Object.keys(kwargs).length > 0 ? (kwargs as JsonObject) : undefined;
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
  const fromKwargs = readBoolean(
    asObject(request.options?.compat?.chat_template_kwargs)?.preserve_thinking
    ?? asObject(request.model.compat?.chat_template_kwargs)?.preserve_thinking,
  );
  if (fromKwargs !== undefined) return fromKwargs;

  const value =
    request.options?.compat?.preserve_thinking
    ?? request.options?.compat?.preserveThinking
    ?? request.model.compat?.preserve_thinking
    ?? request.model.compat?.preserveThinking;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Read NeuralWatt `clear_thinking` from the standard `compat` escape hatch.
 * When true, prior assistant reasoning is dropped from the request history
 * for the next turn, resetting the chain of thought.
 */
export function neuralWattClearThinking(request: ProviderRequest): boolean | undefined {
  const fromKwargs = readBoolean(
    asObject(request.options?.compat?.chat_template_kwargs)?.clear_thinking
    ?? asObject(request.model.compat?.chat_template_kwargs)?.clear_thinking,
  );
  if (fromKwargs !== undefined) return fromKwargs;

  const value =
    request.options?.compat?.clear_thinking
    ?? request.options?.compat?.clearThinking
    ?? request.model.compat?.clear_thinking
    ?? request.model.compat?.clearThinking;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Strip NeuralWatt-owned compat keys before opaque body spread so resolved
 * thinking / budget / kwargs / tool_choice fields cannot be overwritten.
 */
export function stripNeuralWattOwnedCompat(compat: JsonObject | undefined): JsonObject | undefined {
  if (!compat) return undefined;
  const {
    reasoning_effort: _effort,
    reasoningEffort: _effortCamel,
    thinking_token_budget: _budget,
    chat_template_kwargs: _kwargs,
    tool_choice: _toolChoice,
    preserve_thinking: _preserve,
    preserveThinking: _preserveCamel,
    clear_thinking: _clear,
    clearThinking: _clearCamel,
    ...rest
  } = compat;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
