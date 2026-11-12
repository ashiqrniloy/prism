/**
 * Salience signals a WM pass reads (plan 218 Task 2): which STM records carry an error, a user correction, an approval
 * denial or a failed verification. They are derived from the records and the branch entries the records cite, never
 * from a model, so the WM prompt can rank them first and plan 218 Task 3's protections can rely on them.
 */
import type { SessionEntry } from "@arnilo/prism";
import type { MemoryObservation } from "./types.js";

export type SalienceSignal = "error" | "correction" | "denial" | "failed_verification";

/** A user turn that says the previous answer or action was wrong. */
const CORRECTION = /\b(?:no,|that'?s (?:wrong|not right|incorrect)|actually\b|not what I|you should have|I said|wrong (?:file|one|value))/i;
/** An outcome whose check did not pass. */
const FAILED_VERIFICATION = /\b(?:fail(?:s|ed|ing|ure)?|did not pass|not pass(?:ed)?|regress(?:ed|ion)?|broken|not verified)\b/i;

/** Signals per record id; a record without any is absent. */
export function salienceSignals(
  records: readonly MemoryObservation[],
  entries: readonly SessionEntry[],
): ReadonlyMap<string, readonly SalienceSignal[]> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const signals = new Map<string, readonly SalienceSignal[]>();
  for (const record of records) {
    const found = new Set<SalienceSignal>();
    if (record.kind === "error") found.add("error");
    if (record.kind === "outcome" && FAILED_VERIFICATION.test(record.description)) found.add("failed_verification");
    for (const id of record.sourceEntryIds) {
      const message = byId.get(id)?.message;
      if (!message) continue;
      if (message.role === "user" && CORRECTION.test(messageText(message.content))) found.add("correction");
      // A `tool.call` deny or a refused ask reaches the branch as a tool result with `hook_denied` (run-controller).
      if (message.role === "tool" && JSON.stringify(message.content).includes('"hook_denied"')) found.add("denial");
    }
    if (found.size) signals.set(record.id, [...found]);
  }
  return signals;
}

function messageText(content: readonly unknown[]): string {
  return content
    .map((block) =>
      typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("\n");
}
