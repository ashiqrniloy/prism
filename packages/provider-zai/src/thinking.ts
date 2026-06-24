import type { JsonObject, ProviderRequest } from "@arnilo/prism";

export function zaiThinking(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false || request.options?.cacheRetention === "none") return { type: "disabled" };
  if (value && typeof value === "object") return value as JsonObject;
  return value === true ? { type: "enabled" } : undefined;
}

export function zaiReasoningEffort(request: ProviderRequest): string | undefined {
  const effort = request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

export function zaiToolStream(request: ProviderRequest): boolean | undefined {
  const value = request.options?.compat?.tool_stream ?? request.model.compat?.tool_stream;
  return typeof value === "boolean" ? value : undefined;
}
