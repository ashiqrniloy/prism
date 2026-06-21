import type { JsonObject, Message, ProviderRequest, Usage } from "prism";

type OpenRouterContent = string | JsonObject[];

export function openRouterSessionId(request: ProviderRequest): string | undefined {
  return (request.options?.cacheKey ?? request.options?.sessionId)?.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 128);
}

export function withOpenRouterCache(message: JsonObject, enabled: boolean): JsonObject {
  if (!enabled || message.role === "tool") return message;
  const content = message.content as OpenRouterContent;
  if (typeof content === "string") {
    return { role: message.role, content: [{ type: "text", text: content, cache_control: { type: "ephemeral" } }] };
  }
  return {
    role: message.role,
    content: (content ?? []).map((item) => ({ ...item, cache_control: { type: "ephemeral" } })),
  };
}

export function openRouterUsage(usage: OpenRouterUsage | undefined): Usage | undefined {
  return usage ? {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens,
    cacheWriteTokens: usage.prompt_tokens_details?.cache_write_tokens,
  } : undefined;
}

function text(message: Message): string {
  return message.content.map((part) => part.type === "text" ? part.text : "").join("");
}

export interface OpenRouterUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number; readonly cache_write_tokens?: number };
}
