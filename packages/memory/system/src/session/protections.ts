/**
 * Protected STM records and WM items (plan 218 Task 3, design I5): what a WM pass may never discard and plan 219's
 * Rehearsal may never drop. Protections are read from the ledger by code, never from the prompt, so a model cannot
 * talk its way past them; the WM `discard` tool refuses a protected record with `protected`.
 */
import { activeWmItems, type ObservationalMemoryLedger } from "./ledger.js";
import type { SalienceSignal } from "./salience.js";
import type { MemoryObservation, MemoryWmItem } from "./types.js";

/**
 * Why a record is protected:
 * - `task_state`: a `request` or `decision` the current task state was written from (they share a source entry);
 * - `fact`: cited by an active WM `fact`;
 * - `unresolved_error`: an `error` no later `outcome` resolves (a later outcome that is not a failed verification);
 * - `open_question`: a question (`?`) the current task state was written from while that task state lists open questions;
 * - `needed_later`: cited by an active WM item the WM model marked `neededLater` with a scope reference.
 */
export type ProtectionReason = "task_state" | "fact" | "unresolved_error" | "open_question" | "needed_later";

export interface ProtectionOptions {
  /** Salience signals by record id; a later `outcome` with `failed_verification` resolves no error. */
  readonly salience?: ReadonlyMap<string, readonly SalienceSignal[]>;
}

/** The protected records among `records` (default: every STM record in the ledger), by id, with the first reason that applies. */
export function protectedRecords(
  ledger: ObservationalMemoryLedger,
  records: readonly MemoryObservation[] = ledger.observations,
  options: ProtectionOptions = {},
): ReadonlyMap<string, ProtectionReason> {
  const items = activeWmItems(ledger);
  const factCited = new Set(items.filter((item) => item.kind === "fact").flatMap((item) => item.citedIds));
  const neededLater = new Set(items.filter((item) => item.neededLater).flatMap((item) => item.citedIds));
  const taskEntries = new Set(ledger.taskState?.sourceEntryIds ?? []);
  const openQuestions = (ledger.taskState?.openQuestions?.length ?? 0) > 0;
  const order = new Map(ledger.observations.map((record, index) => [record.id, index]));
  const resolvingOutcomes = ledger.observations
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        record.kind === "outcome" &&
        !(options.salience?.get(record.id) ?? []).includes("failed_verification") &&
        !FAILED_OUTCOME.test(record.description),
    )
    .map(({ index }) => index);
  const protections = new Map<string, ProtectionReason>();
  for (const record of records) {
    const fromTaskState = record.sourceEntryIds.some((id) => taskEntries.has(id));
    const index = order.get(record.id) ?? Number.POSITIVE_INFINITY;
    const reason: ProtectionReason | undefined = factCited.has(record.id)
      ? "fact"
      : record.kind === "error" && !resolvingOutcomes.some((at) => at > index)
        ? "unresolved_error"
        : fromTaskState && (record.kind === "request" || record.kind === "decision")
          ? "task_state"
          : fromTaskState && openQuestions && record.description.includes("?")
            ? "open_question"
            : neededLater.has(record.id)
              ? "needed_later"
              : undefined;
    if (reason) protections.set(record.id, reason);
  }
  return protections;
}

/** A WM item Rehearsal must keep: a `fact` (episode facts are what later steps read) or one marked `neededLater`. */
export function isProtectedWmItem(item: MemoryWmItem): boolean {
  return item.kind === "fact" || item.neededLater !== undefined;
}

/** The tokens of the protected records among `records`. */
export function protectedTokenCount(records: readonly MemoryObservation[], protections: ReadonlyMap<string, ProtectionReason>): number {
  return records.reduce((sum, record) => sum + (protections.has(record.id) ? record.tokenCount : 0), 0);
}

/** An outcome whose check did not pass resolves no error (the same reading as the `failed_verification` signal). */
const FAILED_OUTCOME = /\b(?:fail(?:s|ed|ing|ure)?|did not pass|not pass(?:ed)?|regress(?:ed|ion)?|broken|not verified)\b/i;
