import type { JsonObject, Usage } from "../contracts-core/content.js";

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;

export interface RawUsageInput {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cost?: number;
  readonly currency?: string;
  readonly estimated?: boolean;
  /**
   * If false, `inputTokens` is treated as exclusive of cache read and cache creation tokens
   * (Anthropic wire convention where `input_tokens` only counts uncached prompt tokens).
   * When false, `normalizeUsage` adds `cacheReadTokens` and `cacheWriteTokens` to `inputTokens`
   * to compute the inclusive total prompt token count.
   * Defaults to true (inclusive inputTokens, OpenAI / Prism convention).
   */
  readonly inputTokensInclusive?: boolean;
  /** Provider-specific metadata or monetization telemetry. */
  readonly metadata?: JsonObject;
}

/**
 * Normalizes provider wire usage into the Prism inclusive `Usage` contract:
 * - `inputTokens`: every prompt token (inclusive of cache reads and cache writes).
 * - `cacheReadTokens` / `cacheWriteTokens`: non-negative subsets of `inputTokens`.
 * - `totalTokens`: `inputTokens + outputTokens` when the vendor omits it.
 *
 * This is the single normalization seam for codecs building `Usage`.
 */
export function normalizeUsage(raw: RawUsageInput | undefined): Usage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const cacheReadTokens = count(raw.cacheReadTokens);
  const cacheWriteTokens = count(raw.cacheWriteTokens);

  let inputTokens = count(raw.inputTokens);
  if (raw.inputTokensInclusive === false) {
    if (inputTokens !== undefined || cacheReadTokens !== undefined || cacheWriteTokens !== undefined) {
      inputTokens = (inputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
    }
  }

  const outputTokens = count(raw.outputTokens);

  let totalTokens = count(raw.totalTokens);
  if (totalTokens === undefined && (inputTokens !== undefined || outputTokens !== undefined)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }

  const cost = typeof raw.cost === "number" && Number.isFinite(raw.cost) && raw.cost >= 0 ? raw.cost : undefined;
  const currency = typeof raw.currency === "string" && raw.currency.length > 0 ? raw.currency : undefined;
  const estimated = raw.estimated === true ? true : undefined;
  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as JsonObject)
      : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheWriteTokens === undefined &&
    cost === undefined &&
    metadata === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(cost !== undefined ? { cost, ...(currency ? { currency } : {}) } : {}),
    ...(estimated ? { estimated: true } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
