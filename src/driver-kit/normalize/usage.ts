import type { Usage } from "../../contracts.js";

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Vendor-neutral usage fields a driver can pass in under common spellings. */
export interface UsageLike {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly total?: unknown;
  readonly cacheRead?: unknown;
  readonly cacheWrite?: unknown;
  readonly cost?: unknown;
  readonly currency?: string;
  readonly estimated?: boolean;
}

/** Builds a `Usage`, dropping non-finite or negative numbers. `totalTokens` is derived when absent. */
export function mapUsage(raw: UsageLike): Usage {
  const inputTokens = count(raw.input);
  const outputTokens = count(raw.output);
  const totalTokens = count(raw.total) ?? (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined);
  const cacheReadTokens = count(raw.cacheRead);
  const cacheWriteTokens = count(raw.cacheWrite);
  const cost = count(raw.cost);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(cost !== undefined ? { cost, ...(raw.currency ? { currency: raw.currency } : {}) } : {}),
    ...(raw.estimated ? { estimated: true } : {}),
  };
}
