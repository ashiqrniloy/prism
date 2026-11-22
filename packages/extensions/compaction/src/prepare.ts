import {
  type CompactionContext,
  type CompactionEntryData,
  collectFileOperations,
  type FileOperationDetails,
  type Message,
  type SessionEntry,
} from "@arnilo/prism";
import { estimateEntryTokens } from "./tokens.js";

export interface PrepareLlmCompactionOptions {
  readonly reserveTokens?: number;
  /**
   * Tokens of recent history the cut keeps verbatim. Default: {@link KEEP_RECENT_SHARE} of the model's input cap, at most
   * {@link DEFAULT_KEEP_RECENT_TOKENS} (20,000 when no cap resolves). The kept tail never exceeds
   * {@link MAX_KEPT_SHARE} of the input cap, whatever this asks.
   */
  readonly keepRecentTokens?: number;
  /** The kept tail's largest share of the input cap. Default {@link MAX_KEPT_SHARE}; `1` lets it take the whole cap. */
  readonly maxKeptShare?: number;
  readonly trackFileOperations?: boolean;
}

export interface LlmCompactionEntryData extends CompactionEntryData {
  readonly firstKeptEntryId?: string;
  readonly estimatedTokensBefore: number;
  readonly estimatedTokensAfter: number;
  readonly isSplitTurn?: boolean;
  readonly readFiles?: readonly string[];
  readonly modifiedFiles?: readonly string[];
}

export interface LlmCompactionPreparation {
  readonly entriesToSummarize: readonly SessionEntry[];
  readonly entriesToKeep: readonly SessionEntry[];
  readonly turnPrefixEntries: readonly SessionEntry[];
  readonly previousSummary?: string;
  readonly fileOperations: FileOperationDetails;
  readonly data: LlmCompactionEntryData;
}

export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
/** The default kept tail's share of the model's input cap (plan 240 Task 5; session memory's rule). */
export const KEEP_RECENT_SHARE = 0.2;
/**
 * The largest share of the model's input cap the kept tail may take (plan 240 Task 5). Past it the oldest kept entries
 * are summarized instead, so a compacted request fits: before, one over-window turn left every later compaction keeping
 * the same oversized tail, and every later run of the session failed `context_overflow`.
 */
export const MAX_KEPT_SHARE = 0.4;

export function prepareLlmCompaction(
  context: Pick<CompactionContext, "entries" | "trigger" | "inputCapTokens">,
  options: PrepareLlmCompactionOptions = {},
): LlmCompactionPreparation {
  const cap = context.inputCapTokens;
  const hasCap = typeof cap === "number" && Number.isFinite(cap) && cap > 0;
  const keepRecentTokens = Math.max(
    0,
    options.keepRecentTokens ??
      (hasCap ? Math.min(DEFAULT_KEEP_RECENT_TOKENS, Math.floor(cap * KEEP_RECENT_SHARE)) : DEFAULT_KEEP_RECENT_TOKENS),
  );
  const maxKeptTokens = hasCap ? Math.floor(cap * (options.maxKeptShare ?? MAX_KEPT_SHARE)) : undefined;
  const previous = findPreviousCompaction(context.entries);
  const startIndex = previous ? startAfterPrevious(context.entries, previous) : 0;
  const cutIndex = findLlmCompactionCutPoint(context.entries, {
    startIndex,
    keepRecentTokens,
    ...(maxKeptTokens === undefined ? {} : { maxKeptTokens }),
  });
  const firstKeptIndex = cutIndex + 1;
  const turnStartIndex = findTurnStartIndex(context.entries, firstKeptIndex);
  const isSplitTurn = turnStartIndex >= startIndex && turnStartIndex < firstKeptIndex;
  const entriesToSummarize = context.entries.slice(startIndex, isSplitTurn ? turnStartIndex : firstKeptIndex);
  const turnPrefixEntries = isSplitTurn ? context.entries.slice(turnStartIndex, firstKeptIndex) : [];
  const entriesToKeep = context.entries.slice(firstKeptIndex);
  const summarizedForFiles = [...entriesToSummarize, ...turnPrefixEntries];
  const fileOperations =
    options.trackFileOperations === false ? { readFiles: [], modifiedFiles: [] } : collectFileOperations(messages(summarizedForFiles));
  const estimatedTokensBefore = sumTokens(context.entries.slice(startIndex));
  const estimatedTokensAfter = sumTokens(entriesToKeep);
  const data: LlmCompactionEntryData = {
    throughEntryId: context.entries[cutIndex]?.id,
    keepEntryIds: entriesToKeep.map((entry) => entry.id),
    strategy: "llm-compaction",
    trigger: context.trigger,
    firstKeptEntryId: entriesToKeep[0]?.id,
    estimatedTokensBefore,
    estimatedTokensAfter,
    isSplitTurn: isSplitTurn || undefined,
    readFiles: fileOperations.readFiles.length ? fileOperations.readFiles : undefined,
    modifiedFiles: fileOperations.modifiedFiles.length ? fileOperations.modifiedFiles : undefined,
  };

  return { entriesToSummarize, entriesToKeep, turnPrefixEntries, previousSummary: previous?.summary, fileOperations, data };
}

/**
 * The index of the last entry the cut summarizes (the kept tail starts after it). The tail keeps the newest entries up to
 * `keepRecentTokens`, never past `maxKeptTokens` when given: an entry that would push the tail over it is summarized, and
 * so is everything before it. A tail never starts on a tool result: it reaches back to the call when that still fits,
 * else the orphaned results are summarized with the call.
 */
export function findLlmCompactionCutPoint(
  entries: readonly SessionEntry[],
  options: { readonly startIndex?: number; readonly keepRecentTokens?: number; readonly maxKeptTokens?: number } = {},
): number {
  const startIndex = options.startIndex ?? 0;
  const keepRecentTokens = Math.max(0, options.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS);
  const maxKept = options.maxKeptTokens === undefined ? Number.POSITIVE_INFINITY : Math.max(0, options.maxKeptTokens);
  let kept = 0;
  let firstKeptIndex = entries.length;

  for (let index = entries.length - 1; index >= startIndex; index -= 1) {
    const tokens = estimateEntryTokens(entries[index]!);
    if (kept + tokens > maxKept) break;
    kept += tokens;
    firstKeptIndex = index;
    if (kept >= keepRecentTokens) break;
  }

  // Reach back to the call that a leading tool result answers, while the tail still fits.
  let reach = firstKeptIndex;
  let reachKept = kept;
  while (reach > startIndex && isToolResultEntry(entries[reach])) {
    reach -= 1;
    reachKept += estimateEntryTokens(entries[reach]!);
  }
  if (reachKept <= maxKept) firstKeptIndex = reach;
  else while (firstKeptIndex < entries.length && isToolResultEntry(entries[firstKeptIndex])) firstKeptIndex += 1;
  return Math.max(startIndex - 1, firstKeptIndex - 1);
}

function findPreviousCompaction(entries: readonly SessionEntry[]): SessionEntry | undefined {
  return [...entries].reverse().find((entry) => entry.kind === "compaction" && typeof entry.summary === "string");
}

function startAfterPrevious(entries: readonly SessionEntry[], previous: SessionEntry): number {
  const firstKept = readString(previous.data, "firstKeptEntryId");
  const firstKeptIndex = firstKept ? entries.findIndex((entry) => entry.id === firstKept) : -1;
  if (firstKeptIndex >= 0) return firstKeptIndex;
  const previousIndex = entries.findIndex((entry) => entry.id === previous.id);
  return previousIndex >= 0 ? previousIndex + 1 : 0;
}

function findTurnStartIndex(entries: readonly SessionEntry[], firstKeptIndex: number): number {
  if (entries[firstKeptIndex]?.message?.role === "user") return firstKeptIndex;
  for (let index = firstKeptIndex - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    if (message?.role === "user") return index;
  }
  return firstKeptIndex;
}

function isToolResultEntry(entry: SessionEntry | undefined): boolean {
  return entry?.kind === "message" && entry.message?.role === "tool";
}

function messages(entries: readonly SessionEntry[]): readonly Message[] {
  return entries.flatMap((entry) => (entry.kind === "message" && entry.message ? [entry.message] : []));
}

function sumTokens(entries: readonly SessionEntry[]): number {
  return entries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
}

function readString(value: unknown, key: string): string | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === "string"
    ? (value as Record<string, string>)[key]
    : undefined;
}
