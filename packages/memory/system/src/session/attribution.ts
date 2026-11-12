/**
 * Speaker attribution (plan 218 Task 4.1): whose content a record is, from stored entry roles only. A model never sets
 * it, so message text cannot claim to be the user's; a wrong citation shows as a wrong attribution, never a forged one.
 */
import type { SessionEntry } from "@arnilo/prism";
import type { MemoryAttribution, MemoryEventKind, MemoryObservation, MemoryWmItem } from "./types.js";

/** Event kinds that state or propose something; an assistant-only one renders as an `assistant proposal`. */
const PROPOSAL_KINDS: ReadonlySet<MemoryEventKind> = new Set(["request", "statement", "decision"]);

/**
 * Combines speaker sides. User and assistant together are `mixed` (a `mixed` side counts as both). Tool output beside
 * one side counts as that side, since it answers that side's call; tool output alone is `tool`. No side: `undefined`.
 */
export function combineAttribution(sides: Iterable<MemoryAttribution>): MemoryAttribution | undefined {
  let user = false;
  let assistant = false;
  let tool = false;
  for (const side of sides) {
    if (side === "user" || side === "mixed") user = true;
    if (side === "assistant" || side === "mixed") assistant = true;
    if (side === "tool") tool = true;
  }
  return user && assistant ? "mixed" : user ? "user" : assistant ? "assistant" : tool ? "tool" : undefined;
}

/** An STM event's attribution: the roles of the message entries it cites. Non-message entries and `system` add no side. */
export function attributionOfEntries(entries: readonly SessionEntry[]): MemoryAttribution | undefined {
  return combineAttribution(
    entries.flatMap((entry) => {
      const role = entry.kind === "message" ? entry.message?.role : undefined;
      return role === "user" || role === "assistant" || role === "tool" ? [role] : [];
    }),
  );
}

/** True when an STM record is something the assistant proposed, not something the user stated or that happened. */
export function isAssistantProposal(record: Pick<MemoryObservation, "kind" | "attribution">): boolean {
  return record.attribution === "assistant" && PROPOSAL_KINDS.has(record.kind);
}

/**
 * A WM item's attribution from what it rests on. An assistant proposal adds `assistant`; an assistant record of another
 * kind (an action, a result) adds no side, so an item resting only on those is unmarked. A source without an
 * attribution (written before Task 4.1) leaves the item without one.
 */
export function attributionOfSources(records: readonly MemoryObservation[], items: readonly MemoryWmItem[]): MemoryAttribution | undefined {
  const sides: MemoryAttribution[] = [];
  for (const record of records) {
    if (!record.attribution) return undefined;
    if (record.attribution !== "assistant" || isAssistantProposal(record)) sides.push(record.attribution);
  }
  for (const item of items) {
    if (!item.attribution) return undefined;
    sides.push(item.attribution);
  }
  return combineAttribution(sides);
}

/** The render mark of an attribution: `assistant proposal` replaces the label, `(user + assistant)` follows it. */
export function attributionLabel(label: string, attribution: MemoryAttribution | undefined, proposal: boolean): string {
  if (proposal) return "assistant proposal";
  return attribution === "mixed" ? `${label} (user + assistant)` : label;
}
