/**
 * The cited lesson notebook (plan 209 Task 4). A lesson is a `procedure` or `fact` the working agent
 * writes in its own turn with `tags: ["lesson"]` and at least one `evidence` id: no new kind and no
 * background model call. Evidence ids are stored as links with relation `evidence`.
 *
 * The nudge is one fixed tail line after a turn that carried a lesson signal (a correction, an explicit
 * "remember", a failed-then-fixed command, or an approval denial). It holds an exchange id and fixed
 * text, never note content, and never enters the prompt prefix.
 */
import type { SessionEntry } from "@arnilo/prism";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { gatherConsolidationCandidates } from "./consolidation/gather.js";
import type { ExchangePair } from "./exchanges.js";
import type { MemoryNoteScope } from "./types.js";

export const LESSON_TAG = "lesson";
/** The link relation an `evidence` id is stored under. */
export const EVIDENCE_RELATION = "evidence";
export const MAX_EVIDENCE_IDS = 8;
export const DEFAULT_LESSON_NUDGE_TURNS = 5;
export const MAX_LESSON_NUDGE_TURNS = 1_000;
export const DEFAULT_LESSON_ARCHIVE_SESSIONS = 20;
export const MAX_LESSON_ARCHIVE_SESSIONS = 10_000;

/** An `evidence` id is not a note readable wherever the new note is read. */
export class EvidenceNotFoundError extends MemoryValidationError {
  override readonly code: string = "not_found";

  constructor(id: string) {
    super(`evidence ${id} is not a note readable in the write scope`);
    this.name = "EvidenceNotFoundError";
  }
}

/** A `lesson`-tagged write without evidence, or of a kind other than procedure or fact. */
export class LessonRequiresEvidenceError extends MemoryValidationError {
  override readonly code: string = "lesson_requires_evidence";

  constructor(message = 'a note tagged "lesson" needs 1-8 evidence ids and kind procedure or fact') {
    super(message);
    this.name = "LessonRequiresEvidenceError";
  }
}

export function isLessonTagged(tags: readonly string[] | undefined): boolean {
  return tags?.includes(LESSON_TAG) === true;
}

/**
 * The levels whose notes stay readable wherever a note at `level` is read. A project or path note is
 * read only inside its project, where the user and agent scopes are also active; a user or agent note
 * is read in every project, so its evidence must not be one project's note.
 */
export function evidenceLevelsFor(level: MemoryNoteScope): ReadonlySet<MemoryNoteScope> {
  return level === "user" || level === "agent"
    ? new Set<MemoryNoteScope>(["user", "agent"])
    : new Set<MemoryNoteScope>(["path", "project", "user", "agent"]);
}

/** Shape check for `evidence`; existence and scope are checked by the write path. */
export function assertEvidenceInput(evidence: unknown, isMemoryId: (value: string) => boolean): void {
  if (evidence === undefined) return;
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > MAX_EVIDENCE_IDS) {
    throw new MemoryValidationError(`evidence must be an array of 1-${MAX_EVIDENCE_IDS} note ids`);
  }
  for (const id of evidence) {
    if (typeof id !== "string" || !isMemoryId(id)) throw new MemoryValidationError("each evidence id must be a 12-hex note id");
  }
}

/** The lesson invariant, for every writer: a lesson is a procedure or fact with evidence. */
export function assertLessonInput(input: {
  readonly kind: string;
  readonly tags?: readonly string[];
  readonly evidence?: readonly string[];
}): void {
  if (!isLessonTagged(input.tags)) return;
  if (input.kind !== "procedure" && input.kind !== "fact")
    throw new LessonRequiresEvidenceError('a lesson is a "procedure" or "fact" note');
  if (input.evidence === undefined || input.evidence.length === 0) throw new LessonRequiresEvidenceError();
}

export type LessonSignal = "correction" | "remember" | "fixed" | "denial";

const SIGNAL_TEXT: Record<LessonSignal, string> = {
  correction: "a correction",
  remember: "an explicit remember request",
  fixed: "a failed-then-fixed command",
  denial: "an approval denial",
};

const REMEMBER = /\bremember\b/i;

/**
 * The lesson signal of one completed exchange, by the consolidation gatherer's own pattern matching
 * over the user turn, plus the turn's step trace (`fixed`) and any approval denial between the user
 * entry and the reply. Correction wins, then remember, then fixed, then denial. No model call.
 */
export function lessonSignal(
  entries: readonly SessionEntry[],
  pair: ExchangePair,
  options: { readonly fixed?: boolean } = {},
): LessonSignal | undefined {
  const start = entries.indexOf(pair.user);
  const end = entries.indexOf(pair.assistant);
  if (start < 0 || end < start) return undefined;
  const window = entries.slice(0, end + 1);
  const cursor = start > 0 ? entries[start - 1]!.id : undefined;
  const userCandidates = gatherConsolidationCandidates(window, {
    ...(cursor === undefined ? {} : { cursor }),
    maxCandidates: 8,
  }).filter((candidate) => candidate.evidenceIds.includes(pair.user.id));
  if (userCandidates.some((candidate) => candidate.source === "correction")) return "correction";
  if (userCandidates.some((candidate) => candidate.source === "explicit" && REMEMBER.test(candidate.text))) return "remember";
  if (options.fixed === true) return "fixed";
  for (const entry of entries.slice(start + 1, end)) {
    if (entry.kind === "event" && entry.event?.type === "decision.resolved") {
      if (entry.event.decisions.some((decision) => decision.outcome === "deny")) return "denial";
    }
  }
  return undefined;
}

/** The one nudge line: ids and fixed text only. */
export function lessonNudgeLine(signal: LessonSignal, exchangeId: string, insertTool = "memory.insert"): string {
  return `memory: this turn had ${SIGNAL_TEXT[signal]}; if there is a reusable lesson, record it: ${insertTool} { kind: "procedure", tags: ["lesson"], evidence: ["${exchangeId}"] }`;
}

/** Per-session nudge state: a turn counter, the last nudged turn, and the line waiting for the next request. */
export interface LessonNudges {
  /** Record one completed exchange; a signal turn queues a line unless the rate limit holds it back. */
  completed(sessionId: string, signal: LessonSignal | undefined, exchangeId: string): void;
  /** The queued line for the next request, removed as it is taken. */
  take(sessionId: string): string | undefined;
  forget(sessionId: string): void;
}

export function createLessonNudges(options: { readonly minTurnsBetween: number; readonly insertTool?: string }): LessonNudges {
  const state = new Map<string, { turn: number; last?: number; pending?: string }>();
  return {
    completed(sessionId, signal, exchangeId) {
      const current = state.get(sessionId) ?? { turn: 0 };
      current.turn += 1;
      if (signal !== undefined && (current.last === undefined || current.turn - current.last >= options.minTurnsBetween)) {
        current.last = current.turn;
        current.pending = lessonNudgeLine(signal, exchangeId, options.insertTool);
      } else delete current.pending;
      state.set(sessionId, current);
    },
    take(sessionId) {
      const current = state.get(sessionId);
      const line = current?.pending;
      if (current !== undefined) delete current.pending;
      return line;
    },
    forget(sessionId) {
      state.delete(sessionId);
    },
  };
}
