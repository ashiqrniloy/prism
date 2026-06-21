import type { Message, SessionEntry } from "prism";

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: Message): number {
  return message.content.reduce((sum, block) => sum + estimateTextTokens(JSON.stringify(block)), 0);
}

export function estimateEntryTokens(entry: SessionEntry): number {
  if (entry.message) return estimateMessageTokens(entry.message);
  return estimateTextTokens(JSON.stringify(entry));
}
