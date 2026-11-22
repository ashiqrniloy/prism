import type { SessionEntry } from "@arnilo/prism";

/**
 * Splits entries at entry (message) boundaries into consecutive chunks whose measured size stays within
 * `budgetTokens` (plan 229 Task 6). Order is kept and no entry is dropped or split: an entry that alone
 * exceeds the budget gets a chunk of its own, and the caller bounds that chunk's text. `measure` is the
 * token cost of one entry as it will be sent, including its separator.
 */
export function chunkCompactionEntries(
  entries: readonly SessionEntry[],
  budgetTokens: number,
  measure: (entry: SessionEntry) => number,
): readonly (readonly SessionEntry[])[] {
  const chunks: SessionEntry[][] = [];
  let current: SessionEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const cost = measure(entry);
    if (current.length > 0 && used + cost > budgetTokens) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(entry);
    used += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
