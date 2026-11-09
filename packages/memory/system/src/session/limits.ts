export const DEFAULT_RECALL_PAGE_LIMIT = 20;
export const HARD_MAX_RECALL_PAGE_LIMIT = 100;

export function resolveRecallPageLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_RECALL_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_MAX_RECALL_PAGE_LIMIT) {
    throw new RangeError(`Recall page limit must be a positive safe integer at most ${HARD_MAX_RECALL_PAGE_LIMIT}`);
  }
  return limit;
}
