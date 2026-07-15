import type { ContentBlock, Message, SessionEntry } from "@arnilo/prism";

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: Message): number {
  return estimateTextTokens(message.role) + message.content.reduce((sum, block) => sum + estimateContentBlockTokens(block), 0);
}

export function estimateEntryTokens(entry: SessionEntry): number {
  if (entry.kind === "message" && entry.message) return estimateMessageTokens(entry.message);
  if (entry.summary) return estimateTextTokens(entry.summary);
  if (entry.label) return estimateTextTokens(entry.label);
  if (entry.event) return estimateTextTokens(JSON.stringify(entry.event));
  return 0;
}

function estimateContentBlockTokens(block: ContentBlock): number {
  if (block.type === "text" || block.type === "thinking") return estimateTextTokens(block.text);
  if (block.type === "tool_call") return estimateTextTokens(`${block.name} ${JSON.stringify(block.arguments)}`);
  if (block.type === "tool_call_delta") return estimateTextTokens(`${block.name ?? "tool"} ${block.argumentsText ?? ""}`);
  if (block.type === "tool_result") return estimateTextTokens(`${block.name} ${JSON.stringify(block.result ?? block.error ?? "")}`);
  if (block.type === "image") return estimateTextTokens(block.url ?? block.resourceUri ?? block.mimeType ?? "[image]");
  if (block.type === "audio") return estimateTextTokens(block.transcript ?? block.url ?? block.resourceUri ?? block.mediaType ?? "[audio]");
  if (block.type === "file") return estimateTextTokens(block.name ?? block.url ?? block.resourceUri ?? block.mediaType ?? "[file]");
  if (block.type === "document") return estimateTextTokens(block.transcript ?? block.name ?? block.url ?? block.resourceUri ?? block.mediaType ?? "[document]");
  return estimateTextTokens("[content]");
}
