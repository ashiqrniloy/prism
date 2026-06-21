import type { CompactionContext, CompactionEntryData, Message, SessionEntry } from "prism";
import { collectFileOperations, type FileOperationDetails } from "./file-ops.js";
import { estimateEntryTokens } from "./tokens.js";

export interface PrepareLlmCompactionOptions {
  readonly reserveTokens?: number;
  readonly keepRecentTokens?: number;
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

const DEFAULT_KEEP_RECENT_TOKENS = 20_000;

export function prepareLlmCompaction(
  context: Pick<CompactionContext, "entries" | "trigger">,
  options: PrepareLlmCompactionOptions = {},
): LlmCompactionPreparation {
  const keepRecentTokens = Math.max(0, options.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS);
  const previous = findPreviousCompaction(context.entries);
  const startIndex = previous ? startAfterPrevious(context.entries, previous) : 0;
  const cutIndex = findLlmCompactionCutPoint(context.entries, { startIndex, keepRecentTokens });
  const firstKeptIndex = cutIndex + 1;
  const turnStartIndex = findTurnStartIndex(context.entries, firstKeptIndex);
  const isSplitTurn = turnStartIndex >= startIndex && turnStartIndex < firstKeptIndex;
  const entriesToSummarize = context.entries.slice(startIndex, isSplitTurn ? turnStartIndex : firstKeptIndex);
  const turnPrefixEntries = isSplitTurn ? context.entries.slice(turnStartIndex, firstKeptIndex) : [];
  const entriesToKeep = context.entries.slice(firstKeptIndex);
  const summarizedForFiles = [...entriesToSummarize, ...turnPrefixEntries];
  const fileOperations = options.trackFileOperations === false ? { readFiles: [], modifiedFiles: [] } : collectFileOperations(messages(summarizedForFiles));
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

export function findLlmCompactionCutPoint(
  entries: readonly SessionEntry[],
  options: { readonly startIndex?: number; readonly keepRecentTokens?: number } = {},
): number {
  const startIndex = options.startIndex ?? 0;
  const keepRecentTokens = Math.max(0, options.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS);
  let kept = 0;
  let firstKeptIndex = entries.length;

  for (let index = entries.length - 1; index >= startIndex; index -= 1) {
    kept += estimateEntryTokens(entries[index]!);
    firstKeptIndex = index;
    if (kept >= keepRecentTokens) break;
  }

  while (firstKeptIndex > startIndex && isToolResultEntry(entries[firstKeptIndex])) firstKeptIndex -= 1;
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
  return entries.flatMap((entry) => entry.kind === "message" && entry.message ? [entry.message] : []);
}

function sumTokens(entries: readonly SessionEntry[]): number {
  return entries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
}

function readString(value: unknown, key: string): string | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === "string"
    ? (value as Record<string, string>)[key]
    : undefined;
}
