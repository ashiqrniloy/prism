import type { CompactionContext, CompactionEntryData, CompactionStrategy, ContentBlock, Message, SessionEntry } from "./contracts.js";
import { redactSecrets } from "./redaction.js";
import { createSessionEntry } from "./session-stores.js";

export interface DefaultCompactionStrategyOptions {
  readonly name?: string;
  readonly keepRecentEntries?: number;
  readonly maxSummaryChars?: number;
  readonly secrets?: readonly (string | undefined)[];
}

export function createDefaultCompactionStrategy(options: DefaultCompactionStrategyOptions = {}): CompactionStrategy {
  const name = options.name ?? "default-compaction";
  return {
    name,
    compact(context) {
      const keepRecentEntries = Math.max(0, context.keepRecentEntries ?? options.keepRecentEntries ?? 8);
      const maxSummaryChars = Math.max(0, options.maxSummaryChars ?? 4000);
      const messages = context.entries.filter((entry) => entry.kind === "message" && entry.message);
      const keepEntryIds = keepRecentEntries === 0 ? [] : messages.slice(-keepRecentEntries).map((entry) => entry.id);
      const firstKept = keepEntryIds[0];
      const firstKeptIndex = firstKept ? context.entries.findIndex((entry) => entry.id === firstKept) : context.entries.length;
      const oldEntries = context.entries.slice(0, firstKeptIndex < 0 ? context.entries.length : firstKeptIndex);
      const throughEntryId = oldEntries.at(-1)?.id;
      const summary = truncate(redactSecrets(summarize(oldEntries), [...(options.secrets ?? []), ...(context.secrets ?? [])]), maxSummaryChars);
      const data: CompactionEntryData = { throughEntryId, keepEntryIds, strategy: name, trigger: context.trigger };
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
  return (data.throughEntryId === undefined || typeof data.throughEntryId === "string")
    && (data.keepEntryIds === undefined || (Array.isArray(data.keepEntryIds) && data.keepEntryIds.every((item) => typeof item === "string")))
    && (data.strategy === undefined || typeof data.strategy === "string")
    && (data.trigger === undefined || typeof data.trigger === "string");
}

function summarize(entries: readonly SessionEntry[]): string {
  const lines = entries.flatMap((entry) => entryText(entry));
  return lines.length ? lines.join("\n") : "No older session entries to summarize.";
}

function entryText(entry: SessionEntry): string[] {
  if (entry.kind === "message" && entry.message) return [`${entry.message.role}: ${messageText(entry.message)}`];
  if (entry.kind === "summary" && entry.summary) return [`summary: ${entry.summary}`];
  if (entry.kind === "model_change" && entry.model) return [`model changed to ${entry.model.provider}/${entry.model.model}`];
  if (entry.kind === "label" && entry.label) return [`label: ${entry.label}`];
  return [];
}

function messageText(message: Message): string {
  return message.content.map(blockText).filter(Boolean).join(" ");
}

function blockText(block: ContentBlock): string {
  if (block.type === "text" || block.type === "thinking") return block.text;
  if (block.type === "tool_call") return `[tool_call ${block.name}]`;
  if (block.type === "tool_result") return `[tool_result ${block.name}]`;
  return "[image]";
}

function truncate(text: string, max: number): string {
  if (max === 0 || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
