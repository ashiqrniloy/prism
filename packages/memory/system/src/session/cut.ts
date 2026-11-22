/**
 * Where a session-memory compaction cuts the branch (plan 218.3 Task 3, Task 1 decision 2). The cut is sized in tokens,
 * never in a message count, and never separates a tool call from its result:
 *
 * - mid-loop (the loop goes on after the compaction): the newest tool round stays, plus earlier messages while they fit
 *   `keepRecentTokens`;
 * - between loops (a run starts after a completed loop): only the run's new input stays.
 *
 * Everything before the cut leaves the window, and only after STM has covered it (`compactor.ts`).
 */
import type { Message, SessionEntry } from "@arnilo/prism";

import type { CompactionTriggerPoint } from "./config.js";
import { estimateMessageTokens } from "./tokens.js";

export interface CutOptions {
  readonly point: CompactionTriggerPoint;
  /** Mid-loop only: tokens kept verbatim besides the newest tool round. */
  readonly keepRecentTokens: number;
  /** Message entry indexes currently in the window (excludes messages already removed by an earlier compaction). */
  readonly activeIndexes?: readonly number[];
}

interface IndexedMessage {
  readonly index: number;
  readonly message: Message;
}

/** The index in `entries` of the first entry the compaction keeps; `entries.length` keeps nothing. */
export function keptTailStart(entries: readonly SessionEntry[], options: CutOptions): number {
  const indexes = options.activeIndexes ?? messageIndexes(entries);
  const items = indexes.map((index) => ({ index, message: entries[index]!.message! }));
  return keptTailStartOf(items, entries.length, options);
}

/** The index in `messages` of the first message the compaction keeps; `messages.length` keeps nothing. */
export function keptTailStartMessages(messages: readonly Message[], options: Pick<CutOptions, "point" | "keepRecentTokens">): number {
  const items = messages.map((message, index) => ({ index, message }));
  return keptTailStartOf(items, messages.length, options);
}

function keptTailStartOf(
  items: readonly IndexedMessage[],
  endIndex: number,
  options: Pick<CutOptions, "point" | "keepRecentTokens">,
): number {
  if (!items.length) return endIndex;
  if (options.point === "between-loops") {
    // The run's new input: the trailing user messages after the last reply. None (the branch ends on a reply): nothing.
    let start = endIndex;
    for (let at = items.length - 1; at >= 0 && items[at]!.message.role === "user"; at -= 1) start = items[at]!.index;
    return start;
  }
  // The newest tool round: the last assistant message that calls a tool, with everything after it.
  let roundPos = items.length - 1;
  for (let at = items.length - 1; at >= 0; at -= 1) {
    if (items[at]!.message.role === "assistant" && messageCallsTool(items[at]!.message)) {
      roundPos = at;
      break;
    }
  }
  let startPos = pairStartPos(items, roundPos);
  let tokens = 0;
  for (let at = startPos; at < items.length; at += 1) tokens += estimateMessageTokens(items[at]!.message);
  // Earlier messages while they fit, one tool round (call plus results) or one message at a time.
  while (startPos > 0) {
    const unitStartPos = pairStartPos(items, startPos - 1);
    let unitTokens = 0;
    for (let at = unitStartPos; at < startPos; at += 1) unitTokens += estimateMessageTokens(items[at]!.message);
    if (tokens + unitTokens > options.keepRecentTokens) break;
    tokens += unitTokens;
    startPos = unitStartPos;
  }
  return items[startPos]!.index;
}

function pairStartPos(items: readonly IndexedMessage[], pos: number): number {
  if (items[pos]?.message.role !== "tool") return pos;
  let at = pos;
  while (at > 0 && items[at]!.message.role === "tool") at -= 1;
  return items[at]!.message.role === "tool" ? pos : at;
}

/**
 * Moves a cut that would land on (or just before) a tool result back to the assistant message that called it, so a call and its result
 * are kept or removed together.
 */
export function pairStart(entries: readonly SessionEntry[], messages: readonly number[], index: number): number {
  // The first message at or after the cut decides: a tool result there means its call must stay too.
  const next = messages.findIndex((at) => at >= index);
  if (next < 0 || roleAt(entries, messages[next]!) !== "tool") return index;
  let at = next;
  while (at > 0 && roleAt(entries, messages[at]!) === "tool") at -= 1;
  return roleAt(entries, messages[at]!) === "tool" ? index : messages[at]!;
}

/** Message entry indexes of a branch, in order. */
export function messageIndexes(entries: readonly SessionEntry[]): readonly number[] {
  return entries.flatMap((entry, index) => (isMessage(entry) ? [index] : []));
}

/**
 * Message entry indexes currently in the active window (matching the kernel's `snapshotFromBranch`): excludes messages
 * already compacted away before the newest compaction entry so a later cut never resurrects them.
 */
export function activeWindowMessageIndexes(entries: readonly SessionEntry[]): readonly number[] {
  const compaction = [...entries]
    .reverse()
    .find(
      (entry) =>
        entry.kind === "compaction" &&
        Boolean(entry.summary) &&
        typeof entry.data === "object" &&
        entry.data !== null &&
        !Array.isArray(entry.data),
    );
  if (!compaction) return messageIndexes(entries);
  const data = compaction.data as { readonly throughEntryId?: unknown; readonly keepEntryIds?: unknown };
  const throughEntryId = typeof data.throughEntryId === "string" ? data.throughEntryId : undefined;
  const keepIds = new Set(Array.isArray(data.keepEntryIds) ? data.keepEntryIds.filter((id): id is string => typeof id === "string") : []);
  let afterThrough = throughEntryId === undefined;
  const indexes: number[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.id === throughEntryId) {
      afterThrough = true;
      continue;
    }
    if (entry.id === compaction.id) continue;
    if (isMessage(entry) && (afterThrough || keepIds.has(entry.id))) indexes.push(index);
  }
  return indexes;
}

function isMessage(entry: SessionEntry): boolean {
  return entry.kind === "message" && entry.message !== undefined;
}

function roleAt(entries: readonly SessionEntry[], index: number): string | undefined {
  return entries[index]?.message?.role;
}

function messageCallsTool(message: Message): boolean {
  return message.content.some((block) => block.type === "tool_call");
}
