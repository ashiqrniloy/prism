/** Hypercredit usage + remaining reported inside the chat-completions usage object (final stream chunk with `stream_options.include_usage`). */
export interface HyperUsageCost {
  readonly usd?: number;
  readonly hypercredits?: number;
  readonly remainingHypercredits?: number;
}

/**
 * Extract Hyper's custom usage fields — `usage.cost.usd`, `usage.cost.hypercredits`
 * and `usage.remaining.hypercredits` — from the raw wire usage object. Standard
 * token fields map through the shared `mapOpenAIChatUsage` (which already reads
 * `prompt_tokens_details.cached_tokens` / `cache_write_tokens` and
 * `prompt_cache_hit_tokens`), so this helper only surfaces the monetization
 * fields. Hosts call it on the wire usage chunk (e.g. from a `mapUsage` callback
 * or `done.usage` source) — it performs no I/O.
 */
export function parseHyperUsageCost(usage: unknown): HyperUsageCost | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const wire = usage as { readonly cost?: unknown; readonly remaining?: unknown };
  const cost = wire.cost && typeof wire.cost === "object" && !Array.isArray(wire.cost) ? (wire.cost as Record<string, unknown>) : undefined;
  const remaining =
    wire.remaining && typeof wire.remaining === "object" && !Array.isArray(wire.remaining)
      ? (wire.remaining as Record<string, unknown>)
      : undefined;
  if (!cost && !remaining) return undefined;
  return {
    usd: typeof cost?.usd === "number" ? cost.usd : undefined,
    hypercredits: typeof cost?.hypercredits === "number" ? cost.hypercredits : undefined,
    remainingHypercredits: typeof remaining?.hypercredits === "number" ? remaining.hypercredits : undefined,
  };
}