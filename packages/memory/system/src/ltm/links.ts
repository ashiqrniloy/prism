import type { MemoryNoteLink } from "./types.js";

/** Later groups win on the same id, so caller-supplied links override derived ones. */
export function mergeNoteLinks(...groups: (readonly MemoryNoteLink[] | undefined)[]): readonly MemoryNoteLink[] | undefined {
  const merged = new Map<string, MemoryNoteLink>();
  for (const group of groups) for (const link of group ?? []) merged.set(link.id, link);
  return merged.size === 0 ? undefined : [...merged.values()];
}
