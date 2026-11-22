import type { ContentBlock, Message, SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";

export interface SerializeCompactionConversationOptions {
  readonly secrets?: readonly (string | undefined)[];
  readonly maxToolResultChars?: number;
  /**
   * Per-block cap on text, thinking, and tool-call arguments, with a cut marker, as tool results already have.
   * Default {@link DEFAULT_MAX_TEXT_BLOCK_CHARS}; `0` disables it.
   */
  readonly maxTextBlockChars?: number;
}

export const DEFAULT_MAX_TOOL_RESULT_CHARS = 2_000;
export const DEFAULT_MAX_TEXT_BLOCK_CHARS = 8_000;

interface BlockCaps {
  readonly toolResult: number;
  readonly text: number;
}

export function serializeCompactionConversation(
  entries: readonly SessionEntry[],
  options: SerializeCompactionConversationOptions = {},
): string {
  const caps: BlockCaps = {
    toolResult: options.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS,
    text: options.maxTextBlockChars ?? DEFAULT_MAX_TEXT_BLOCK_CHARS,
  };
  const lines = entries.flatMap((entry) => serializeEntry(entry, caps));
  return redactSecrets(lines.join("\n\n"), options.secrets ?? []);
}

function serializeEntry(entry: SessionEntry, caps: BlockCaps): string[] {
  if (entry.kind === "message" && entry.message) return serializeMessage(entry.message, caps);
  if (entry.kind === "summary" && entry.summary) return [`[Summary]\n${entry.summary}`];
  if (entry.kind === "compaction" && entry.summary) return [`[Previous summary]\n${entry.summary}`];
  if (entry.kind === "model_change" && entry.model) return [`[Model change]\n${entry.model.provider}/${entry.model.model}`];
  if (entry.kind === "label" && entry.label) return [`[Label]\n${entry.label}`];
  return [];
}

function serializeMessage(message: Message, caps: BlockCaps): string[] {
  const chunks = message.content.map((block) => serializeBlock(message.role, block, caps)).filter(Boolean);
  return chunks.length ? [`${label(message.role)}\n${chunks.join("\n")}`] : [];
}

function serializeBlock(role: Message["role"], block: ContentBlock, caps: BlockCaps): string {
  if (block.type === "text") return truncate(block.text, caps.text);
  if (block.type === "thinking") return `[Assistant thinking]\n${truncate(block.text, caps.text)}`;
  if (block.type === "tool_call") return `[Assistant tool call]\n${block.name} ${truncate(JSON.stringify(block.arguments), caps.text)}`;
  if (block.type === "tool_call_delta")
    return `[Assistant tool call delta]\n${block.name ?? "tool"} ${truncate(block.argumentsText ?? "", caps.text)}`;
  if (block.type === "tool_result")
    return `[Tool result]\n${block.name}: ${truncate(JSON.stringify(block.error ?? block.result ?? null), caps.toolResult)}`;
  return role === "user" ? "[User image]" : "[Image]";
}

function label(role: Message["role"]): string {
  if (role === "user") return "[User]";
  if (role === "assistant") return "[Assistant]";
  if (role === "tool") return "[Tool result]";
  return "[System]";
}

export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return `${text.slice(0, max)}[..., ${text.length - max} characters truncated]`;
}
