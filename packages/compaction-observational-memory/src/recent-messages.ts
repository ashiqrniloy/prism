import type { ContentBlock, ContextBlock, Message, SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";
import { truncateWorkerText } from "./limits.js";
import { buildObservationalMemoryProjection } from "./projection.js";
import { renderObservationalMemory } from "./render.js";
import { estimateEntryTokens } from "./tokens.js";

export const DEFAULT_KEEP_RECENT_ENTRIES = 8;
export const HARD_MAX_RECENT_MESSAGE_RENDER_BYTES = 512 * 1024;

export interface RecentMessageWindowOptions {
  readonly keepRecentEntries?: number;
  /** When set, drop oldest window entries until within this token budget (`estimateEntryTokens`). */
  readonly maxTokens?: number;
  readonly secrets?: readonly (string | undefined)[];
}

export interface ObservationalMemoryContextOptions extends RecentMessageWindowOptions {}

export function selectRecentMessageEntryIds(entries: readonly SessionEntry[], keepRecentEntries: number): readonly string[] {
  if (keepRecentEntries <= 0) return [];
  return entries
    .filter((entry) => entry.kind === "message" && entry.message)
    .slice(-keepRecentEntries)
    .map((entry) => entry.id);
}

export function selectRecentMessageEntries(
  entries: readonly SessionEntry[],
  options: RecentMessageWindowOptions = {},
): readonly SessionEntry[] {
  const keepRecentEntries = Math.max(0, options.keepRecentEntries ?? DEFAULT_KEEP_RECENT_ENTRIES);
  const ids = new Set(selectRecentMessageEntryIds(entries, keepRecentEntries));
  let selected = entries.filter((entry) => ids.has(entry.id));
  const maxTokens = options.maxTokens;
  if (maxTokens === undefined) return selected;
  while (selected.length > 0 && selected.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0) > maxTokens) {
    selected = selected.slice(1);
  }
  return selected;
}

export function renderRecentMessageWindow(entries: readonly SessionEntry[], secrets: readonly (string | undefined)[] = []): string {
  const lines = entries.flatMap((entry) => formatRecentMessageLines(entry));
  if (!lines.length) return "";
  const content = truncateWorkerText(lines.join("\n"), HARD_MAX_RECENT_MESSAGE_RENDER_BYTES);
  return redactSecrets(content, secrets);
}

export function buildObservationalMemoryContextBlocks(
  entries: readonly SessionEntry[],
  options: ObservationalMemoryContextOptions = {},
): readonly ContextBlock[] {
  const keepRecentEntries = Math.max(0, options.keepRecentEntries ?? DEFAULT_KEEP_RECENT_ENTRIES);
  const recentEntries = selectRecentMessageEntries(entries, options);
  const firstKeptEntryId = recentEntries[0]?.id;
  const projection = buildObservationalMemoryProjection(entries, firstKeptEntryId);
  const secrets = options.secrets ?? [];
  const blocks: ContextBlock[] = [];
  const memory = renderObservationalMemory(projection.reflections, projection.observations, secrets);
  if (memory) blocks.push({ title: "observational-memory", content: memory, priority: 10 });
  const recent = renderRecentMessageWindow(recentEntries, secrets);
  if (recent) blocks.push({ title: "recent-messages", content: recent, priority: 9 });
  return blocks;
}

function formatRecentMessageLines(entry: SessionEntry): string[] {
  if (entry.kind !== "message" || !entry.message) return [];
  return [`[${entry.id}] ${messageLine(entry.message)}`];
}

function messageLine(message: Message): string {
  return `${message.role}: ${message.content.map(formatContentBlock).filter(Boolean).join(" ")}`;
}

function formatContentBlock(block: ContentBlock): string {
  if (block.type === "text" || block.type === "thinking") return block.text;
  if (block.type === "tool_call") return `[tool_call ${block.name} ${JSON.stringify(block.arguments)}]`;
  if (block.type === "tool_call_delta") return `[tool_call_delta ${block.name ?? block.index}]`;
  if (block.type === "tool_result") {
    const payload = block.error ? JSON.stringify(block.error) : JSON.stringify(block.result);
    return `[tool_result ${block.name} ${payload}]`;
  }
  if (block.type === "image") return block.name ? `[image ${block.name}]` : "[image]";
  if (block.type === "audio") return "[audio]";
  if (block.type === "file") return block.name ? `[file ${block.name}]` : "[file]";
  if (block.type === "document") return "[document]";
  return "[content]";
}
