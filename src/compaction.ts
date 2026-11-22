import type { CompactionEntryData, ContentBlock, Message, SessionEntry } from "./contracts.js";
import type { Compactor } from "./slots/types.js";
import { collectFileOperations } from "./file-ops.js";
import { estimateMessageTokens } from "./models/estimate.js";
import { redactSecrets } from "./redaction.js";
import { createSessionEntry } from "./session-stores.js";

export interface DefaultCompactorOptions {
  readonly name?: string;
  /** Keep this many recent messages instead of a token budget. A context's `keepRecentEntries` wins. */
  readonly keepRecentEntries?: number;
  /**
   * Token budget for the kept tail when no `keepRecentEntries` is set. Default: 20% of the context's
   * `inputCapTokens`, never below {@link DEFAULT_KEEP_RECENT_TOKENS_FLOOR}; the floor alone without a cap.
   */
  readonly keepRecentTokens?: number;
  /** Summary cap in characters (default {@link DEFAULT_COMPACTION_MAX_SUMMARY_CHARS}; 0 means unlimited). A context's `maxSummaryChars` wins. */
  readonly maxSummaryChars?: number;
  readonly secrets?: readonly (string | undefined)[];
}

/** The default compactor's summary cap, in characters (plan 229 Task 5). */
export const DEFAULT_COMPACTION_MAX_SUMMARY_CHARS = 8_000;
/** Smallest token budget for the default compactor's kept tail (plan 229 Task 5). */
export const DEFAULT_KEEP_RECENT_TOKENS_FLOOR = 2_000;
const KEEP_RECENT_TOKENS_RATIO = 0.2;
const TASK_CHARS = 1_500;
const PROGRESS_CHARS = 2_000;

/** What decides the kept tail: a message count when set, else a token budget. */
export interface KeepRule {
  readonly keepRecentEntries?: number;
  readonly keepRecentTokens?: number;
  readonly inputCapTokens?: number;
}

/**
 * Index of the first kept entry: everything before it is summarized. A message count wins when set;
 * otherwise the newest messages are kept while their estimate fits the token budget. A tool result
 * is never separated from the assistant tool call before it. Shared by the default compactor and the
 * session's `compaction.completed.entriesCompacted` fallback.
 */
export function resolveKeptStartIndex(entries: readonly SessionEntry[], rule: KeepRule = {}): number {
  let index: number;
  if (rule.keepRecentEntries !== undefined) {
    const keep = Math.max(0, rule.keepRecentEntries);
    const messages = entries.filter((entry) => entry.kind === "message" && entry.message);
    const first = keep === 0 ? undefined : messages.at(-Math.min(keep, messages.length));
    index = first ? entries.indexOf(first) : entries.length;
  } else {
    const budget = keepRecentTokensBudget(rule);
    let used = 0;
    index = entries.length;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const message = entries[i]?.kind === "message" ? entries[i]?.message : undefined;
      if (!message) continue;
      used += estimateMessageTokens(message);
      if (used > budget) break;
      index = i;
    }
  }
  // Never split a tool result from its preceding assistant tool call.
  while (index > 0 && index < entries.length && entries[index]?.message?.role === "tool") index -= 1;
  return index;
}

function keepRecentTokensBudget(rule: KeepRule): number {
  if (rule.keepRecentTokens !== undefined) return Math.max(0, rule.keepRecentTokens);
  const cap = rule.inputCapTokens;
  if (cap === undefined || !Number.isFinite(cap) || cap <= 0) return DEFAULT_KEEP_RECENT_TOKENS_FLOOR;
  return Math.max(DEFAULT_KEEP_RECENT_TOKENS_FLOOR, Math.floor(cap * KEEP_RECENT_TOKENS_RATIO));
}

export function createDefaultCompactor(options: DefaultCompactorOptions = {}): Compactor {
  const name = options.name ?? "default-compaction";
  return {
    name,
    compact(context) {
      const keepRecentEntries = context.keepRecentEntries ?? options.keepRecentEntries;
      const maxSummaryChars = Math.max(0, context.maxSummaryChars ?? options.maxSummaryChars ?? DEFAULT_COMPACTION_MAX_SUMMARY_CHARS);
      const start = resolveKeptStartIndex(context.entries, {
        keepRecentEntries,
        keepRecentTokens: options.keepRecentTokens,
        inputCapTokens: context.inputCapTokens,
      });
      const oldEntries = context.entries.slice(0, start);
      const keptEntries = context.entries.slice(start);
      const throughEntryId = oldEntries.at(-1)?.id;
      // Redact before capping, so a cut can never leave a partial secret the redactor no longer matches.
      const summary = capSummary(
        redactSecrets(summarizeDropped(oldEntries, maxSummaryChars), [...(options.secrets ?? []), ...(context.secrets ?? [])]),
        maxSummaryChars,
      );
      const data: CompactionEntryData = {
        throughEntryId,
        keepEntryIds: keptEntries.map((entry) => entry.id),
        strategy: name,
        trigger: context.trigger,
      };
      const parentId = context.entries.at(-1)?.id;

      return {
        summary,
        entries: [createSessionEntry({ sessionId: context.sessionId, parentId, kind: "compaction", summary, data })],
      };
    },
  };
}

export function isCompactionEntryData(value: unknown): value is CompactionEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    (data.throughEntryId === undefined || typeof data.throughEntryId === "string") &&
    (data.keepEntryIds === undefined ||
      (Array.isArray(data.keepEntryIds) && data.keepEntryIds.every((item) => typeof item === "string"))) &&
    (data.strategy === undefined || typeof data.strategy === "string") &&
    (data.trigger === undefined || typeof data.trigger === "string")
  );
}

/**
 * The dropped span as a structured extract: the task (first user message), the latest progress (last
 * assistant text), the files and tools touched, then the newest remaining text up to the budget.
 * Built from parts and joined once; no model call.
 */
export function summarizeDropped(entries: readonly SessionEntry[], maxSummaryChars = DEFAULT_COMPACTION_MAX_SUMMARY_CHARS): string {
  const saysSomething = (entry: SessionEntry, role: Message["role"]) =>
    entry.kind === "message" && entry.message?.role === role && plainText(entry.message) !== "";
  const taskIndex = entries.findIndex((entry) => saysSomething(entry, "user"));
  const progressIndex = findLastIndex(entries, (entry) => saysSomething(entry, "assistant"));
  const head = [
    taskSection(entries[taskIndex]?.message),
    progressSection(entries[progressIndex]?.message),
    ...filesSection(entries),
    toolsSection(entries),
  ].filter((line): line is string => line !== undefined);
  const recent = recentSection(entries, new Set([taskIndex, progressIndex]), maxSummaryChars, head);
  const sections = recent ? [...head, recent] : head;
  return sections.length ? sections.join("\n") : "No older session entries to summarize.";
}

export function taskSection(message: Message | undefined): string | undefined {
  const text = message ? plainText(message) : "";
  return text ? `Task: ${clip(text, TASK_CHARS)}` : undefined;
}

function progressSection(message: Message | undefined): string | undefined {
  const text = message ? plainText(message) : "";
  return text ? `Latest progress: ${clipTail(text, PROGRESS_CHARS)}` : undefined;
}

export function filesSection(entries: readonly SessionEntry[]): string[] {
  const { readFiles, modifiedFiles } = collectFileOperations(messagesOf(entries));
  const lines: string[] = [];
  if (modifiedFiles.length) lines.push(`Files modified: ${modifiedFiles.join(", ")}`);
  if (readFiles.length) lines.push(`Files read: ${readFiles.join(", ")}`);
  return lines;
}

export function toolsSection(entries: readonly SessionEntry[]): string | undefined {
  const counts = new Map<string, number>();
  for (const message of messagesOf(entries)) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) if (block.type === "tool_call") counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
  }
  if (!counts.size) return undefined;
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return `Tools used: ${ranked.map(([tool, count]) => `${tool} ×${count}`).join(", ")}`;
}

/** Newest dropped lines first, until the budget left after the head sections; marks the older text cut. */
export function recentSection(
  entries: readonly SessionEntry[],
  skip: ReadonlySet<number>,
  maxSummaryChars: number,
  head: readonly string[] = [],
): string | undefined {
  const header = "Recent:";
  const headChars = head.reduce((sum, line) => sum + line.length + 1, 0) + header.length + 1;
  let budget = maxSummaryChars === 0 ? Number.POSITIVE_INFINITY : maxSummaryChars - headChars;
  const picked: string[] = [];
  let cut = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (skip.has(i)) continue;
    const entry = entries[i];
    const line = entry ? entryText(entry) : undefined;
    if (!line) continue;
    if (budget <= 0) {
      cut += line.length;
      continue;
    }
    if (line.length + 1 <= budget) {
      picked.push(line);
      budget -= line.length + 1;
    } else {
      const keep = Math.max(0, Math.floor(budget) - 1);
      if (keep > 0) picked.push(`…${line.slice(line.length - keep + 1)}`);
      cut += line.length - Math.max(0, keep - 1);
      budget = 0;
    }
  }
  if (!picked.length) return cut ? `${header}\n[…${cut} characters cut]` : undefined;
  picked.reverse();
  return [header, ...(cut ? [`[…${cut} earlier characters cut]`] : []), ...picked].join("\n");
}

function entryText(entry: SessionEntry): string | undefined {
  if (entry.kind === "message" && entry.message) return `${entry.message.role}: ${messageText(entry.message)}`;
  if (entry.kind === "summary" && entry.summary) return `summary: ${entry.summary}`;
  if (entry.kind === "model_change" && entry.model) return `model changed to ${entry.model.provider}/${entry.model.model}`;
  if (entry.kind === "label" && entry.label) return `label: ${entry.label}`;
  return undefined;
}

function messagesOf(entries: readonly SessionEntry[]): Message[] {
  const messages: Message[] = [];
  for (const entry of entries) if (entry.kind === "message" && entry.message) messages.push(entry.message);
  return messages;
}

/** Text blocks only: what the user asked or the assistant said, without tool markers or thinking. */
function plainText(message: Message): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text.trim()] : []))
    .filter(Boolean)
    .join(" ");
}

function messageText(message: Message): string {
  return message.content.map(blockText).filter(Boolean).join(" ");
}

function blockText(block: ContentBlock): string {
  if (block.type === "text" || block.type === "thinking") return block.text;
  if (block.type === "tool_call") return `[tool_call ${block.name}]`;
  if (block.type === "tool_call_delta") return `[tool_call_delta ${block.name ?? block.index}]`;
  if (block.type === "tool_result") return `[tool_result ${block.name}]`;
  if (block.type === "image") return "[image]";
  if (block.type === "audio") return "[audio]";
  if (block.type === "file") return "[file]";
  if (block.type === "document") return "[document]";
  return "[content]";
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) if (predicate(items[i] as T)) return i;
  return -1;
}

/** Head of `text`, marked when cut. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)} […${text.length - max} characters cut]`;
}

/** Tail of `text` (the newest part of a progress note), marked when cut. */
function clipTail(text: string, max: number): string {
  return text.length <= max ? text : `[…${text.length - max} characters cut] ${text.slice(text.length - max)}`;
}

/** Final cap: at most `max` characters, ending in a cut marker when it fits (0 means unlimited). */
function capSummary(text: string, max: number): string {
  if (max === 0 || text.length <= max) return text;
  const marker = (cut: number) => `\n[…${cut} characters cut]`;
  // The marker counts what the cut removes, including the room it takes itself; two passes settle its digit count.
  let keep = max - marker(text.length - max).length;
  keep = max - marker(text.length - keep).length;
  if (keep < max / 2) return `${text.slice(0, Math.max(0, max - 1))}…`;
  return `${text.slice(0, keep)}${marker(text.length - keep)}`;
}
