import type { ContentBlock, Message, SessionEntry } from "prism";
import { redactSecrets } from "prism";

export interface SerializeCompactionConversationOptions {
  readonly secrets?: readonly (string | undefined)[];
  readonly maxToolResultChars?: number;
}

const DEFAULT_MAX_TOOL_RESULT_CHARS = 2_000;

export function serializeCompactionConversation(
  entries: readonly SessionEntry[],
  options: SerializeCompactionConversationOptions = {},
): string {
  const maxToolResultChars = options.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
  const lines = entries.flatMap((entry) => serializeEntry(entry, maxToolResultChars));
  return redactSecrets(lines.join("\n\n"), options.secrets ?? []);
}

function serializeEntry(entry: SessionEntry, maxToolResultChars: number): string[] {
  if (entry.kind === "message" && entry.message) return serializeMessage(entry.message, maxToolResultChars);
  if (entry.kind === "summary" && entry.summary) return [`[Summary]\n${entry.summary}`];
  if (entry.kind === "compaction" && entry.summary) return [`[Previous summary]\n${entry.summary}`];
  if (entry.kind === "model_change" && entry.model) return [`[Model change]\n${entry.model.provider}/${entry.model.model}`];
  if (entry.kind === "label" && entry.label) return [`[Label]\n${entry.label}`];
  return [];
}

function serializeMessage(message: Message, maxToolResultChars: number): string[] {
  const chunks = message.content.map((block) => serializeBlock(message.role, block, maxToolResultChars)).filter(Boolean);
  return chunks.length ? [`${label(message.role)}\n${chunks.join("\n")}`] : [];
}

function serializeBlock(role: Message["role"], block: ContentBlock, maxToolResultChars: number): string {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return `[Assistant thinking]\n${block.text}`;
  if (block.type === "tool_call") return `[Assistant tool call]\n${block.name} ${JSON.stringify(block.arguments)}`;
  if (block.type === "tool_result") return `[Tool result]\n${block.name}: ${truncate(JSON.stringify(block.error ?? block.result ?? null), maxToolResultChars)}`;
  return role === "user" ? "[User image]" : "[Image]";
}

function label(role: Message["role"]): string {
  if (role === "user") return "[User]";
  if (role === "assistant") return "[Assistant]";
  if (role === "tool") return "[Tool result]";
  return "[System]";
}

function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return `${text.slice(0, max)}[..., ${text.length - max} characters truncated]`;
}
