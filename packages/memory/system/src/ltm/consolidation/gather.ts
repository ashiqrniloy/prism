/**
 * Candidate gathering for session consolidation (plan 188.3 Task 1).
 *
 * A pure, bounded function over `session.entries()`: it reads the records observational memory
 * already keeps (reflections, task-state decisions, high-relevance observations) plus the signals
 * in the transcript itself (explicit user statements, corrections, successful outcomes), and makes
 * no model or store call. Only the extractor (Task 2) interprets what is gathered here.
 */
import type { ContentBlock, Message, SessionEntry } from "@arnilo/prism";
import { DEFAULT_MAX_ENTRY_TEXT_CHARS } from "@arnilo/prism-memory-system/core";
import { activeObservations, activeWmItems, foldObservationalMemoryLedger, recordData } from "../../session/ledger.js";
import {
  foldedMemoryFromEntry,
  isMemoryObservation,
  isMemoryWmItem,
  isObservationsRecordedData,
  isTaskStateRecordedData,
  isWmRecordedData,
  type MemoryObservation,
} from "../../session/types.js";

export type ConsolidationSource = "explicit" | "correction" | "decision" | "observation" | "reflection" | "exchange";

/** The signals a candidate carries into scoring (Task 3); every other term comes from the extractor. */
export interface ConsolidationSignals {
  readonly explicit?: 1;
  readonly correction?: 1;
  readonly outcome?: 1;
}

export interface ConsolidationCandidate {
  readonly source: ConsolidationSource;
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly signals: ConsolidationSignals;
  /** When the evidence happened, for a candidate that knows (an archived exchange). */
  readonly tRef?: string;
  /** Notes the assistant cited before the user corrected it; harmful evidence for those notes. */
  readonly citedNotes?: readonly string[];
}

export interface ConsolidationPatterns {
  readonly explicit: readonly string[];
  readonly correction: readonly string[];
  readonly outcomes: readonly string[];
}

/**
 * The default pattern sets, as exported data the README lists. Explicit statements are the user's
 * own instructions; corrections say the last assistant turn was wrong; outcomes are tool calls whose
 * success tags the work it produced.
 */
export const CONSOLIDATION_PATTERNS: ConsolidationPatterns = {
  explicit: [
    "\\bremember\\b",
    "\\balways\\b",
    "\\bnever\\b",
    "\\bdon't\\b",
    "\\bdo not\\b",
    "\\bI prefer\\b",
    "\\bfrom now on\\b",
    "\\bmake sure to\\b",
  ],
  correction: ["\\bno,", "\\bthat's wrong\\b", "\\bactually\\b", "\\binstead\\b", "\\bnot what I\\b", "\\byou should have\\b"],
  outcomes: ["\\bbun test\\b", "\\bnpm test\\b", "\\bpytest\\b", "\\bcargo test\\b", "\\bgo test\\b", "\\bgit commit\\b"],
};

export const DEFAULT_MAX_CONSOLIDATION_CANDIDATES = 48;

export interface GatherConsolidationOptions {
  /** The last entry id a previous pass covered; entries at or before it are skipped. */
  readonly cursor?: string;
  /** Most candidates a pass may gather. Default 48. */
  readonly maxCandidates?: number;
  /** Per-candidate text cap. Default `memory.limits.maxEntryTextChars`. */
  readonly maxTextChars?: number;
  /** Overrides for the default pattern sets; each key replaces that set whole. */
  readonly patterns?: Partial<ConsolidationPatterns>;
  /**
   * Session redactor applied to every candidate text. Entries as persisted are already redacted;
   * this is the second pass a host with its own secrets supplies.
   */
  readonly redact?: (text: string) => string;
}

/** Explicit > correction > decision > critical/high observation > reflection (plan 188.3 Task 1). */
const SOURCE_PRIORITY: readonly ConsolidationSource[] = ["explicit", "correction", "decision", "observation", "reflection"];

/**
 * Gather the candidates a consolidation pass may extract from. Ordered by source priority, bounded
 * by `maxCandidates`, and idempotent for the same cursor.
 */
export function gatherConsolidationCandidates(
  entries: readonly SessionEntry[],
  options: GatherConsolidationOptions = {},
): readonly ConsolidationCandidate[] {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CONSOLIDATION_CANDIDATES;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) {
    throw new RangeError("maxCandidates must be a non-negative safe integer");
  }
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_ENTRY_TEXT_CHARS;
  if (!Number.isSafeInteger(maxTextChars) || maxTextChars < 1) throw new RangeError("maxTextChars must be a positive safe integer");
  const patterns: ConsolidationPatterns = { ...CONSOLIDATION_PATTERNS, ...options.patterns };
  const redact = options.redact ?? ((text: string) => text);

  const cursorIndex = options.cursor === undefined ? -1 : entries.findIndex((entry) => entry.id === options.cursor);
  const tail = entries.slice(cursorIndex + 1);
  const outcomeRuns = outcomeRunIds(entries, patterns.outcomes);
  const runOf = new Map(entries.map((entry) => [entry.id, entry.runId]));
  const recordEntry = recordEntryIds(tail);
  const ledger = foldObservationalMemoryLedger(tail);
  const observationsById = new Map(ledger.observations.map((observation) => [observation.id, observation]));

  const buckets: Record<ConsolidationSource, ConsolidationCandidate[]> = {
    explicit: [],
    correction: [],
    decision: [],
    observation: [],
    reflection: [],
    exchange: [],
  };

  const candidate = (
    source: ConsolidationSource,
    text: string,
    evidenceIds: readonly string[],
    signals: ConsolidationSignals,
    citedNotes?: readonly string[],
  ): void => {
    const capped = text.trim().slice(0, maxTextChars);
    if (!capped) return;
    const ids = [...new Set(evidenceIds.filter(Boolean))];
    const outcome =
      signals.outcome === 1 ||
      ids.some((id) => {
        const runId = runOf.get(id);
        return runId !== undefined && outcomeRuns.has(runId);
      });
    buckets[source].push({
      source,
      text: redact(capped),
      evidenceIds: ids,
      signals: { ...signals, ...(outcome ? { outcome: 1 as const } : {}) },
      ...(citedNotes === undefined || citedNotes.length === 0 ? {} : { citedNotes }),
    });
  };

  // --- explicit statements and corrections: user text only, never the assistant's own claims.
  const messages = tail.filter((entry) => entry.kind === "message" && entry.message !== undefined);
  const seenTexts = new Set<string>();
  for (const entry of messages) {
    const message = entry.message!;
    if (message.role !== "user") continue;
    const text = messageText(message);
    if (!text) continue;
    const explicit = matchingSentences(text, patterns.explicit);
    if (explicit.length > 0 && !seenTexts.has(explicit)) {
      seenTexts.add(explicit);
      candidate("explicit", explicit, [entry.id], { explicit: 1 });
    }
    const correction = matchingSentences(text, patterns.correction);
    const corrected = correction.length > 0 ? precedingAssistant(entries, entry) : undefined;
    if (corrected !== undefined) {
      candidate("correction", correction, [entry.id, corrected.id], { correction: 1 }, citedNoteIds(entries, corrected));
    }
  }

  // --- task-state decisions: every task-state record in the tail, so a later state does not hide an earlier decision.
  for (const entry of tail) {
    const data = recordData(entry);
    if (!isTaskStateRecordedData(data)) continue;
    for (const decision of data.taskState.decisions ?? []) {
      candidate("decision", decision, [entry.id, ...data.taskState.sourceEntryIds], {});
    }
  }

  // --- observations rated high or critical.
  const relevant = activeObservations(ledger).filter(
    (observation) => observation.relevance === "high" || observation.relevance === "critical",
  );
  relevant.sort((left, right) => rank(left.relevance) - rank(right.relevance));
  for (const observation of relevant)
    candidate("observation", observation.description, evidenceForObservation(observation, recordEntry), {});

  // --- working-memory items no later pass superseded (the `reflection` source until plan 219 retires gather).
  for (const item of activeWmItems(ledger)) {
    const evidence = item.citedIds.flatMap((id) => {
      const observation = observationsById.get(id);
      return observation === undefined ? [] : evidenceForObservation(observation, recordEntry);
    });
    const recordId = recordEntry.get(item.id);
    candidate("reflection", item.text, [...evidence, ...(recordId === undefined ? [] : [recordId])], {});
  }

  return SOURCE_PRIORITY.flatMap((source) => buckets[source]).slice(0, maxCandidates);
}

function rank(relevance: MemoryObservation["relevance"]): number {
  return relevance === "critical" ? 0 : 1;
}

/** Entry ids that prove an observation: the entries it was observed from, else the record that kept it. */
function evidenceForObservation(observation: MemoryObservation, recordEntry: ReadonlyMap<string, string>): readonly string[] {
  const recordId = recordEntry.get(observation.id);
  return observation.sourceEntryIds.length > 0
    ? [...observation.sourceEntryIds, ...(recordId === undefined ? [] : [recordId])]
    : [recordId ?? observation.id];
}

/** Where each OM record was kept, so a candidate can name the entry its evidence came from. */
function recordEntryIds(tail: readonly SessionEntry[]): ReadonlyMap<string, string> {
  const recordEntry = new Map<string, string>();
  const remember = (items: readonly unknown[], entryId: string): void => {
    for (const item of items) {
      const id = (item as { readonly id?: unknown }).id;
      if (typeof id === "string" && !recordEntry.has(id)) recordEntry.set(id, entryId);
    }
  };
  for (const entry of tail) {
    const data = recordData(entry);
    const folded = foldedMemoryFromEntry(entry);
    if (isObservationsRecordedData(data)) remember(data.observations.filter(isMemoryObservation), entry.id);
    if (isWmRecordedData(data)) remember(data.items.filter(isMemoryWmItem), entry.id);
    if (folded) {
      remember(folded.observations.filter(isMemoryObservation), entry.id);
      remember(folded.wmItems.filter(isMemoryWmItem), entry.id);
    }
  }
  return recordEntry;
}

/**
 * Runs whose successful tool results are outcomes: a `tool_result` with no error flag whose call
 * matched an outcome pattern, plus approval grants recorded as `decision.resolved` events. Tool
 * output is never a candidate text; an outcome only tags the candidates of its own run.
 */
function outcomeRunIds(entries: readonly SessionEntry[], patterns: readonly string[]): ReadonlySet<string> {
  const matchingCalls = new Map<string, string | undefined>();
  for (const entry of entries) {
    for (const block of entry.kind === "message" ? (entry.message?.content ?? []) : []) {
      if (block.type !== "tool_call") continue;
      if (matches(`${block.name} ${JSON.stringify(block.arguments)}`, patterns)) matchingCalls.set(block.id, entry.runId);
    }
  }
  const runs = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "event" && entry.event?.type === "decision.resolved") {
      if (entry.event.decisions.some((decision) => decision.outcome === "allow") && entry.runId !== undefined) runs.add(entry.runId);
      continue;
    }
    if (entry.kind !== "message") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type !== "tool_result" || block.error !== undefined) continue;
      if (!matchingCalls.has(block.toolCallId)) continue;
      const runId = matchingCalls.get(block.toolCallId) ?? entry.runId;
      if (runId !== undefined) runs.add(runId);
    }
  }
  return runs;
}

/** The assistant turn a user correction answers: the nearest preceding message entry when it is the assistant's. */
function precedingAssistant(entries: readonly SessionEntry[], user: SessionEntry): SessionEntry | undefined {
  const index = entries.indexOf(user);
  for (let at = index - 1; at >= 0; at -= 1) {
    const entry = entries[at]!;
    if (entry.kind !== "message" || entry.message === undefined) continue;
    return entry.message.role === "assistant" ? entry : undefined;
  }
  return undefined;
}

/** Memory notes the assistant cited (`[<id>]`) anywhere in the run that produced `assistant`. */
function citedNoteIds(entries: readonly SessionEntry[], assistant: SessionEntry): readonly string[] {
  const cited = new Set<string>();
  for (const entry of entries) {
    if (entry.runId !== assistant.runId || entry.kind !== "message" || entry.message?.role !== "assistant") continue;
    for (const match of messageText(entry.message).matchAll(/\[([a-f0-9]{12})\]/g)) cited.add(match[1]!);
  }
  return [...cited];
}

function matches(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

/** The sentences of `text` that match a pattern set, joined; the matched sentence only, never the message. */
function matchingSentences(text: string, patterns: readonly string[]): string {
  return sentences(text)
    .filter((sentence) => matches(sentence, patterns))
    .join(" ");
}

function sentences(text: string): readonly string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function messageText(message: Message): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
