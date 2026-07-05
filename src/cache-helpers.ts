import type { CacheRetention, ContentBlock, Message, ModelConfig, PromptCacheBreakpoint, Usage } from "./contracts.js";

export interface CacheControlValue {
  readonly type: "ephemeral";
  readonly ttl?: "1h";
}

export interface ApplyCacheControlOptions {
  readonly ttl?: "1h";
  readonly maxBreakpoints?: number;
}

export type CacheControlledContentBlock = ContentBlock & { readonly cache_control?: CacheControlValue };
export type CacheControlledMessage = Omit<Message, "content"> & { readonly content: readonly CacheControlledContentBlock[] };

export interface CacheUsageReport {
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly hitRate?: number;
  readonly estimatedSavings?: number;
  readonly currency?: string;
}

export function sanitizeCacheKey(value: string | undefined, maxLength: number): string | undefined {
  const key = value?.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, Math.max(0, maxLength));
  return key || undefined;
}

export function mapCacheRetention(retention: CacheRetention | undefined, model: ModelConfig): "short" | "long" | undefined {
  if (!retention || retention === "none" || model.cache?.kind === "none") return undefined;
  return retention === "long" && model.cache?.longRetention === false ? "short" : retention;
}

export function applyCacheControl(
  messages: readonly Message[],
  breakpoints: readonly PromptCacheBreakpoint[],
  options: ApplyCacheControlOptions = {},
): readonly CacheControlledMessage[] {
  const selected = new Set<number>();
  for (const breakpoint of breakpoints) {
    const index = resolveBreakpoint(messages, breakpoint);
    if (index >= 0) selected.add(index);
    if (options.maxBreakpoints && selected.size >= options.maxBreakpoints) break;
  }
  if (!selected.size) return messages as readonly CacheControlledMessage[];

  const cache_control: CacheControlValue = options.ttl ? { type: "ephemeral", ttl: options.ttl } : { type: "ephemeral" };
  return messages.map((message, index) => {
    if (!selected.has(index) || !message.content.length) return message as CacheControlledMessage;
    const content = message.content.map((block, blockIndex) => blockIndex === message.content.length - 1 ? { ...block, cache_control } : block);
    return { ...message, content };
  });
}

export function cacheHitRate(usage: Usage | undefined): number | undefined {
  const read = usage?.cacheReadTokens;
  const input = usage?.inputTokens;
  return read === undefined || !input ? undefined : read / input;
}

export function cacheSavings(usage: Usage | undefined, model: ModelConfig): number | undefined {
  const read = usage?.cacheReadTokens;
  const input = model.cost?.input;
  const cacheRead = model.cost?.cacheRead;
  if (read === undefined || input === undefined || cacheRead === undefined) return undefined;
  return read * Math.max(0, input - cacheRead) / costUnitDivisor(model.cost?.unit);
}

export function cacheUsageReport(usage: Usage | undefined, model?: ModelConfig): CacheUsageReport | undefined {
  if (!usage) return undefined;
  const estimatedSavings = model ? cacheSavings(usage, model) : undefined;
  return {
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    hitRate: cacheHitRate(usage),
    estimatedSavings,
    currency: estimatedSavings === undefined ? usage.currency : model?.cost?.currency ?? usage.currency,
  };
}

function resolveBreakpoint(messages: readonly Message[], breakpoint: PromptCacheBreakpoint): number {
  switch (breakpoint.location) {
    case "system_prompt": return messages.findIndex((message) => message.role === "system");
    case "tools": return messages.findIndex((message) => message.role === "tool" || message.content.some((block) => block.type === "tool_call" || block.type === "tool_result"));
    case "stable_context": return messages.findIndex((message) => message.role !== "system");
    case "last_stable_message": return messages.length > 1 ? messages.length - 2 : messages.length - 1;
    case "last_user_message": return findLastIndex(messages, (message) => message.role === "user");
    case "message_id": return messages.findIndex((message) => message.id === breakpoint.messageId);
  }
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index]!)) return index;
  return -1;
}

function costUnitDivisor(unit: string | undefined): number {
  return unit && /(?:1m|million)/i.test(unit) ? 1_000_000 : 1;
}
