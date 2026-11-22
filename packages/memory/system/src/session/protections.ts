/**
 * Protected STM records and WM items (plan 218 Task 3, design I5): what a WM pass may never discard and plan 219's
 * Rehearsal may never drop. Protections are read from the ledger by code, never from the prompt, so a model cannot
 * talk its way past them; the WM `discard` tool refuses a protected record with `protected`.
 */
import { DEFAULT_WM_PROTECT_REQUEST_PASSES } from "./config.js";
import { activeWmItems, type ObservationalMemoryLedger } from "./ledger.js";
import type { SalienceSignal } from "./salience.js";
import { isReleasableWmItem } from "./scope.js";
import type { MemoryObservation, MemoryWmItem } from "./types.js";

/**
 * Why a record is protected:
 * - `constraint`: a user statement the recorder marked `durable: "constraint"` (plan 218.2 Task 3), for the episode,
 *   until a later record supersedes it. WM may keep it as an event, never discard or summarise it;
 * - `task_state`: a user `request` no `outcome` names in `resolves` yet (plan 218.2 Task 3). When no outcome in the ledger
 *   carries `resolves` (an older ledger, or a worker that never sets it), the batch rule: a `request` or `decision` the
 *   current task state was written from (they share a source entry). A `decision` always follows the batch rule;
 * - `fact`: cited by an active WM `fact`;
 * - `unresolved_error`: an `error` no `status: "passed"` outcome names in `resolves`. With no `resolves` in the ledger, an
 *   error no later outcome resolves (one with `status: "passed"`; one written without a status resolves unless it reads
 *   as a failed verification);
 * - `open_question`: a question (`?`) the current task state was written from while that task state lists open questions;
 * - `needed_later`: cited by an active WM item the WM model marked `neededLater` with a scope reference.
 *
 * A link protection (`task_state` or `unresolved_error` read from `resolves`) ends after `protectRequestPasses` WM passes
 * that processed records without a resolving outcome; `onLapse` names each such record (`protection_lapsed`).
 */
export type ProtectionReason = "constraint" | "task_state" | "fact" | "unresolved_error" | "open_question" | "needed_later";

export interface ProtectionOptions {
  /** Salience signals by record id; a later `outcome` with `failed_verification` resolves no error. */
  readonly salience?: ReadonlyMap<string, readonly SalienceSignal[]>;
  /** `wm.protectRequestPasses` (default 8). */
  readonly protectRequestPasses?: number;
  /** Finished scope steps: a WM item whose `neededLater` steps are all finished stops protecting its cited records. */
  readonly finishedSteps?: ReadonlySet<number>;
  /** Called with each record whose link protection lapsed, so the pass records `protection_lapsed`. */
  readonly onLapse?: (id: string) => void;
}

/** The protected records among `records` (default: every STM record in the ledger), by id, with the first reason that applies. */
export function protectedRecords(
  ledger: ObservationalMemoryLedger,
  records: readonly MemoryObservation[] = ledger.observations,
  options: ProtectionOptions = {},
): ReadonlyMap<string, ProtectionReason> {
  const items = activeWmItems(ledger);
  const finished = options.finishedSteps ?? new Set<number>();
  const factCited = new Set(items.filter((item) => item.kind === "fact").flatMap((item) => item.citedIds));
  const neededLater = new Set(
    items.filter((item) => item.neededLater && !isReleasableWmItem(item.neededLater, finished)).flatMap((item) => item.citedIds),
  );
  const taskEntries = new Set(ledger.taskState?.sourceEntryIds ?? []);
  const openQuestions = (ledger.taskState?.openQuestions?.length ?? 0) > 0;
  const superseded = supersededIds(ledger);
  const order = new Map(ledger.observations.map((record, index) => [record.id, index]));
  const outcomes = ledger.observations.flatMap((record, index) => (record.kind === "outcome" ? [{ record, index }] : []));
  // Link mode: the recorder writes `resolves`, so a request or error stays protected until an outcome names it.
  const linked = outcomes.some(({ record }) => (record.resolves?.length ?? 0) > 0);
  const resolvedRequests = new Set(outcomes.flatMap(({ record }) => record.resolves ?? []));
  const resolvedErrors = new Set(outcomes.flatMap(({ record }) => (resolvesErrors(record, options) ? (record.resolves ?? []) : [])));
  const resolvingOutcomes = outcomes.filter(({ record }) => resolvesErrors(record, options)).map(({ index }) => index);
  const limit = options.protectRequestPasses ?? DEFAULT_WM_PROTECT_REQUEST_PASSES;
  /** A link protection holds for `limit` processing WM passes after the record was recorded; past it, it lapses once. */
  const held = (record: MemoryObservation): boolean => {
    if ((ledger.wmPasses ?? 0) - (ledger.recordedAtWmPass?.[record.id] ?? 0) < limit) return true;
    options.onLapse?.(record.id);
    return false;
  };
  const protections = new Map<string, ProtectionReason>();
  for (const record of records) {
    const fromTaskState = record.sourceEntryIds.some((id) => taskEntries.has(id));
    const index = order.get(record.id) ?? Number.POSITIVE_INFINITY;
    const userRequest = linked && record.kind === "request" && record.attribution !== "assistant" && record.attribution !== "tool";
    const reason: ProtectionReason | undefined =
      record.durable === "constraint" && !superseded.has(record.id)
        ? "constraint"
        : factCited.has(record.id)
          ? "fact"
          : record.kind === "error" &&
              (linked ? !resolvedErrors.has(record.id) && held(record) : !resolvingOutcomes.some((at) => at > index))
            ? "unresolved_error"
            : userRequest
              ? !resolvedRequests.has(record.id) && !superseded.has(record.id) && held(record)
                ? "task_state"
                : neededLater.has(record.id)
                  ? "needed_later"
                  : undefined
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

/**
 * A WM item Rehearsal must keep: a `fact` (episode facts are what later steps read), one marked `neededLater`, or (with
 * the ledger) an `event` kept from a user constraint (plan 218.2 Task 3).
 */
export function isProtectedWmItem(item: MemoryWmItem, ledger?: ObservationalMemoryLedger, finishedSteps?: ReadonlySet<number>): boolean {
  if (item.kind === "fact") return true;
  if (item.neededLater !== undefined && (!finishedSteps || !isReleasableWmItem(item.neededLater, finishedSteps))) return true;
  if (item.kind !== "event" || !ledger) return false;
  const superseded = supersededIds(ledger);
  return ledger.observations.some(
    (record) => record.durable === "constraint" && item.citedIds.includes(record.id) && !superseded.has(record.id),
  );
}

/** Records a later record replaced by `supersedes` (the STM worker drops them with reason `superseded`). */
function supersededIds(ledger: ObservationalMemoryLedger): ReadonlySet<string> {
  return new Set(
    Object.entries(ledger.dropReasons ?? {})
      .filter(([, reason]) => reason.startsWith("superseded by "))
      .map(([id]) => id),
  );
}

/** The tokens of the protected records among `records`. */
export function protectedTokenCount(records: readonly MemoryObservation[], protections: ReadonlyMap<string, ProtectionReason>): number {
  return records.reduce((sum, record) => sum + (protections.has(record.id) ? record.tokenCount : 0), 0);
}

/**
 * Whether an outcome resolves earlier errors (plan 218.2 Task 2): its `status` decides when the recorder set one (only
 * `passed` resolves); an outcome written before the field resolves unless it reads as a failed verification.
 */
function resolvesErrors(record: MemoryObservation, options: ProtectionOptions): boolean {
  if (record.status !== undefined) return record.status === "passed";
  return !(options.salience?.get(record.id) ?? []).includes("failed_verification") && !FAILED_OUTCOME.test(record.description);
}

/** An outcome whose check did not pass resolves no error (the same reading as the `failed_verification` signal). */
const FAILED_OUTCOME = /\b(?:fail(?:s|ed|ing|ure)?|did not pass|not pass(?:ed)?|regress(?:ed|ion)?|broken|not verified)\b/i;
