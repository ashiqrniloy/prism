export const DEFAULT_RECALL_PAGE_LIMIT = 20;
/** Hits a `recall { query }` returns when the call carries no limit (plan 218.2 Task 7). */
export const DEFAULT_RECALL_QUERY_LIMIT = 8;
/**
 * The most hits or messages one `recall` call may ask for. The model picks `limit`; the host sets this ceiling
 * (`recallLimits.maxPageLimit`), and the model's argument never raises it.
 */
export const DEFAULT_MAX_RECALL_PAGE_LIMIT = 100;

export function resolveRecallPageLimit(limit?: number, max: number = DEFAULT_MAX_RECALL_PAGE_LIMIT): number {
  if (limit === undefined) return Math.min(DEFAULT_RECALL_PAGE_LIMIT, max);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) {
    throw new RangeError(`Recall page limit must be a positive safe integer at most ${max}`);
  }
  return limit;
}

/**
 * Bytes one recall answer may carry (plan 218.3 Task 4): a page of one original entry, a record's source evidence, or a
 * `detail: "full"` cursor page, header included. An entry larger than a page is read in pieces with `recall { entry,
 * offset }`.
 */
export const DEFAULT_RECALL_PAGE_BYTES = 16_384;
export const MIN_RECALL_PAGE_BYTES = 1_024;

/** The host's value is the cap (plan 239); below {@link MIN_RECALL_PAGE_BYTES} a page cannot hold its header. */
export function resolveRecallPageBytes(bytes?: number): number {
  if (bytes === undefined) return DEFAULT_RECALL_PAGE_BYTES;
  if (!Number.isSafeInteger(bytes) || bytes < MIN_RECALL_PAGE_BYTES) {
    throw new RangeError(`Recall page bytes must be a safe integer of at least ${MIN_RECALL_PAGE_BYTES}`);
  }
  return bytes;
}
