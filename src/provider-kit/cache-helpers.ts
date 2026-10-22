import type {
  CacheRetention,
  ContentBlock,
  Message,
  ModelConfig,
  PromptCacheBreakpoint,
  ProviderRequest,
  ToolDefinition,
  Usage,
} from "../contracts.js";

export interface CacheControlValue {
  readonly type: "ephemeral";
  readonly ttl?: "1h";
}

export interface ApplyCacheControlOptions {
  readonly ttl?: "1h";
  readonly maxBreakpoints?: number;
  readonly hasTools?: boolean;
  readonly tools?: readonly ToolDefinition[];
}

export interface PromptCachePlan {
  readonly messageIndices: ReadonlySet<number>;
  readonly markTools: boolean;
  readonly cacheControl: CacheControlValue;
}

export type CacheControlledContentBlock = ContentBlock & { readonly cache_control?: CacheControlValue };
export type CacheControlledMessage = Omit<Message, "content"> & { readonly content: readonly CacheControlledContentBlock[] };

export interface CacheUsageReport {
  /** Present only when the provider reported cache-read usage; never fabricated as zero. */
  readonly cacheReadTokens?: number;
  /** Present only when the provider reported cache-write usage; never fabricated as zero. */
  readonly cacheWriteTokens?: number;
  readonly hitRate?: number;
  readonly estimatedSavings?: number;
  readonly currency?: string;
}

export function sanitizeCacheKey(value: string | undefined, maxLength: number): string | undefined {
  const replaced = value?.replace(/[^A-Za-z0-9_.:-]+/g, "-");
  if (!replaced) return undefined;
  // Index/slice edge trim instead of the `/^-+|-+$/g` alternation (CodeQL js/polynomial-redos, alert 22).
  let start = 0;
  let end = replaced.length;
  while (start < end && replaced.charCodeAt(start) === 45) start += 1;
  while (end > start && replaced.charCodeAt(end - 1) === 45) end -= 1;
  const key = replaced.slice(start, end).slice(0, Math.max(0, maxLength));
  return key || undefined;
}

export function mapCacheRetention(retention: CacheRetention | undefined, model: ModelConfig): "short" | "long" | undefined {
  if (!retention || retention === "none" || model.cache?.kind === "none") return undefined;
  return retention === "long" && model.cache?.longRetention === false ? "short" : retention;
}

/** Check if caching is enabled for an Anthropic-format request. */
export function anthropicCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.options?.cache?.mode === "on";
}

function isNonEmptyContentBlock(block: ContentBlock): boolean {
  if (block.type === "text") {
    return typeof block.text === "string" && block.text.trim().length > 0;
  }
  if (block.type === "thinking") {
    const hasText = typeof block.text === "string" && block.text.trim().length > 0;
    const hasData = typeof block.data === "string" && block.data.trim().length > 0;
    return hasText || hasData;
  }
  if (block.type === "tool_result") {
    return block.result !== undefined || block.error !== undefined;
  }
  return true;
}

function findLastNonEmptyBlockIndex(content: readonly ContentBlock[]): number {
  for (let i = content.length - 1; i >= 0; i--) {
    if (isNonEmptyContentBlock(content[i]!)) return i;
  }
  return -1;
}

function hasNonEmptyContent(message: Message): boolean {
  return findLastNonEmptyBlockIndex(message.content) >= 0;
}

/**
 * Resolves cache-control breakpoints against messages and tool definitions.
 * De-duplicates targets first, then applies `maxBreakpoints`.
 */
export function resolvePromptCachePlan(
  messages: readonly Message[],
  breakpoints: readonly PromptCacheBreakpoint[] | undefined,
  options: ApplyCacheControlOptions = {},
): PromptCachePlan {
  const cacheControl: CacheControlValue = options.ttl
    ? { type: "ephemeral", ttl: options.ttl }
    : { type: "ephemeral" };

  if (!breakpoints || breakpoints.length === 0) {
    return {
      messageIndices: new Set<number>(),
      markTools: false,
      cacheControl,
    };
  }

  const hasTools = options.hasTools ?? (options.tools ? options.tools.length > 0 : false);

  type Target = { readonly kind: "tools" } | { readonly kind: "message"; readonly index: number };
  const uniqueTargets: Target[] = [];
  const seen = new Set<string>();

  for (const breakpoint of breakpoints) {
    if (breakpoint.location === "tools") {
      if (hasTools && !seen.has("tools")) {
        seen.add("tools");
        uniqueTargets.push({ kind: "tools" });
      }
      continue;
    }

    const index = resolveBreakpoint(messages, breakpoint);
    if (index >= 0 && index < messages.length) {
      if (hasNonEmptyContent(messages[index]!)) {
        const key = `message:${index}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueTargets.push({ kind: "message", index });
        }
      }
    }
  }

  const max = options.maxBreakpoints;
  const selected = max !== undefined ? uniqueTargets.slice(0, Math.max(0, max)) : uniqueTargets;

  const messageIndices = new Set<number>();
  let markTools = false;

  for (const target of selected) {
    if (target.kind === "tools") {
      markTools = true;
    } else {
      messageIndices.add(target.index);
    }
  }

  return {
    messageIndices,
    markTools,
    cacheControl,
  };
}

export function applyCacheControl(
  messages: readonly Message[],
  breakpoints: readonly PromptCacheBreakpoint[],
  options: ApplyCacheControlOptions = {},
): readonly CacheControlledMessage[] {
  const plan = resolvePromptCachePlan(messages, breakpoints, options);
  if (!plan.messageIndices.size) return messages as readonly CacheControlledMessage[];

  return messages.map((message, index) => {
    if (!plan.messageIndices.has(index) || !message.content.length) return message as CacheControlledMessage;
    const blockIndex = findLastNonEmptyBlockIndex(message.content);
    if (blockIndex < 0) return message as CacheControlledMessage;

    const content = message.content.map((block, i) =>
      i === blockIndex ? { ...block, cache_control: plan.cacheControl } : block,
    );
    return { ...message, content };
  });
}

export interface SystemCacheControlTextBlock {
  readonly type: "text";
  readonly text: string;
  readonly cache_control?: CacheControlValue;
}

/**
 * Provider-style `system` field: plain joined string by default; native text
 * blocks only when cache-control markers must survive (system_prompt breakpoints).
 * Markers never land on an empty block.
 */
export function systemCacheControlField(
  messages: readonly CacheControlledMessage[],
  toText: (message: Message) => string,
): string | readonly SystemCacheControlTextBlock[] | undefined {
  const system = messages.filter((message) => message.role === "system");
  if (!system.length) return undefined;
  if (!system.some((message) => message.content.some((block) => (block as CacheControlledContentBlock).cache_control))) {
    return system.map(toText).join("\n\n") || undefined;
  }
  return system.map((message) => {
    const cache_control = message.content.find((block) => (block as CacheControlledContentBlock).cache_control)?.cache_control;
    const text = toText(message);
    const block: SystemCacheControlTextBlock = { type: "text", text };
    return cache_control && text.trim().length > 0 ? { ...block, cache_control } : block;
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
  return (read * Math.max(0, input - cacheRead)) / costUnitDivisor(model.cost?.unit);
}

export function cacheUsageReport(usage: Usage | undefined, model?: ModelConfig): CacheUsageReport | undefined {
  if (!usage || (usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined)) return undefined;
  const estimatedSavings = model ? cacheSavings(usage, model) : undefined;
  const currency = estimatedSavings === undefined ? usage.currency : (model?.cost?.currency ?? usage.currency);
  const hitRate = cacheHitRate(usage);
  return {
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(hitRate === undefined ? {} : { hitRate }),
    ...(estimatedSavings === undefined ? {} : { estimatedSavings }),
    ...(currency === undefined ? {} : { currency }),
  };
}

export function resolveBreakpoint(messages: readonly Message[], breakpoint: PromptCacheBreakpoint): number {
  switch (breakpoint.location) {
    case "system_prompt":
      return messages.findIndex((message) => message.role === "system");
    case "tools":
      return -1;
    case "stable_context":
      return messages.findIndex((message) => message.role !== "system");
    case "last_stable_message":
      return messages.length > 1 ? messages.length - 2 : messages.length - 1;
    case "last_user_message":
      return findLastIndex(messages, (message) => message.role === "user");
    case "last_message":
      return messages.length > 0 ? messages.length - 1 : -1;
    case "message_id":
      return messages.findIndex((message) => message.id === breakpoint.messageId);
  }
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index]!)) return index;
  return -1;
}

function costUnitDivisor(unit: string | undefined): number {
  return unit && /(?:1m|million)/i.test(unit) ? 1_000_000 : 1;
}
