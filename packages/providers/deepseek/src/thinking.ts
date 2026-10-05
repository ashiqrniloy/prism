import type { JsonObject, ProviderRequest } from "@arnilo/prism";

const EFFORT_MAP: Readonly<Record<string, "low" | "high" | "max">> = {
  low: "low",
  minimal: "low",
  medium: "high",
  high: "high",
  xhigh: "high",
  max: "max",
};

/** Official Chat Completions effort: `low` / `high` / `max`. `medium` and `xhigh` map to `high`. */
export function mapDeepseekEffort(value: unknown): "low" | "high" | "max" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "off" || normalized === "disabled") return undefined;
  return EFFORT_MAP[normalized] ?? "high";
}

/**
 * Official `thinking: { type: "enabled" | "disabled" }`.
 * Thinking is on by default. `cacheRetention: "none"` or `thinking: false` disables.
 * @see https://api-docs.deepseek.com/guides/thinking_mode
 */
export function deepseekThinking(request: ProviderRequest): JsonObject {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false || request.options?.cacheRetention === "none") return { type: "disabled" };
  // Request-level switch wins; without one, `reasoning_effort: none|off|disabled`
  // stops thinking and a model-default `thinking: false` disables.
  const optionsThinking = request.options?.compat?.thinking;
  if (optionsThinking === undefined) {
    const effort = request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort;
    if (typeof effort === "string" && ["none", "off", "disabled"].includes(effort.trim().toLowerCase())) return { type: "disabled" };
    if (request.model.compat?.thinking === false) return { type: "disabled" };
  }
  if (value && typeof value === "object") {
    const type = (value as JsonObject).type;
    if (type === "disabled") return { type: "disabled" };
  }
  return { type: "enabled" };
}

/**
 * Official `reasoning_effort` when thinking is enabled. Default `high`.
 * Request `options.compat` wins over `model.compat`.
 */
export function deepseekReasoningEffort(request: ProviderRequest): "low" | "high" | "max" | undefined {
  if (deepseekThinking(request).type === "disabled") return undefined;
  const effort =
    request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  return mapDeepseekEffort(effort) ?? "high";
}

/**
 * Replay prior thinking as `reasoning_content` when this request carries tools
 * or a tool call exists on/after this assistant (DeepSeek 400 otherwise).
 */
export function deepseekReplayThinking(request: ProviderRequest, messageIndex: number): boolean {
  if (request.tools && request.tools.length > 0) return true;
  return request.messages.slice(Math.max(0, messageIndex)).some((message) => message.content.some((part) => part.type === "tool_call"));
}
