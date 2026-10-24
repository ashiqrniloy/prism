import type { ContentBlock, Message } from "../contracts-core/content.js";
import type { SessionEntry } from "../contracts-core/session.js";
import { rebuildSessionContext } from "../session-stores.js";

/** A bounded, portable slice of a conversation: what a sub-agent or a second opinion is given. */
export interface TranscriptSlice {
  /** Summaries of the parts a compaction folded away, oldest first. */
  readonly summaries: readonly string[];
  /** Messages always kept, in order, charged against `maxChars` first. */
  readonly pinned: readonly Message[];
  /** The selected turns, oldest first. Text only: tool activity is rendered inline. */
  readonly messages: readonly Message[];
  /** Turns in the slice; a turn starts at a `user` message. */
  readonly turns: number;
  /** Turns dropped to stay inside `lastTurns` or `maxChars`. */
  readonly omittedTurns: number;
  /** A message was cut to fit `maxChars`. */
  readonly truncated: boolean;
}

export interface TranscriptOptions {
  /** How many newest turns to keep. Omitted keeps every turn that fits `maxChars`. */
  readonly lastTurns?: number;
  /** Budget in characters of rendered text. */
  readonly maxChars: number;
  /** Cap on one rendered tool result. Default 2,000. */
  readonly maxToolChars?: number;
  /** Messages rendered with the same rules and always included. */
  readonly pinned?: readonly Message[];
}

const DEFAULT_MAX_TOOL_CHARS = 2_000;
const MAX_TOOL_CALL_ARG_CHARS = 200;

/** One message after rendering: role plus its text. Tool activity stays inside that text. */
interface Portable {
  readonly role: "user" | "assistant";
  readonly text: string;
  /** Source message id, for de-duplicating pinned messages that also fall inside the selection. */
  readonly id?: string;
}

function toolResultText(block: Extract<ContentBlock, { type: "tool_result" }>, max: number): string {
  const cut = (text: string) => (max > 0 && text.length > max ? `${text.slice(0, max)}…` : text);
  if (block.error) return cut(block.error.message);
  const result = block.result as { content?: readonly ContentBlock[]; value?: unknown } | string | undefined;
  if (typeof result === "string") return cut(result);
  if (result && Array.isArray(result.content)) {
    const text = result.content.map(blockText).filter(Boolean).join("\n");
    if (text.length > 0) return cut(text);
  }
  if (result && result.value !== undefined) return cut(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
  return result === undefined ? "" : cut(JSON.stringify(result));
}

function blockText(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "image") return "[image omitted]";
  if (block.type === "audio") return "[audio omitted]";
  if (block.type === "file") return "[file omitted]";
  if (block.type === "document") return "[document omitted]";
  if (block.type === "video") return "[video omitted]";
  // Thinking is provider-bound and a signature never survives a different provider.
  return "";
}

function toolCallText(block: Extract<ContentBlock, { type: "tool_call" }>): string {
  const args = JSON.stringify(block.arguments ?? {});
  return `[tool_call ${block.name} ${args.length > MAX_TOOL_CALL_ARG_CHARS ? `${args.slice(0, MAX_TOOL_CALL_ARG_CHARS)}…` : args}]`;
}

/**
 * The newest conversation a bounded consumer may see, rendered portable: text only, tool calls and
 * results as text, thinking and provider metadata dropped. A dangling assistant tool call is dropped,
 * because a provider rejects a call whose result never follows.
 */
export function selectTranscript(entries: readonly SessionEntry[] | readonly Message[], options: TranscriptOptions): TranscriptSlice {
  const maxChars = Math.max(0, Math.floor(options.maxChars));
  const maxToolChars = options.maxToolChars ?? DEFAULT_MAX_TOOL_CHARS;
  const input = entries as readonly (SessionEntry | Message)[];
  const isEntry = input.some((item) => typeof (item as SessionEntry).kind === "string" && "kind" in item);
  const snapshot = isEntry ? rebuildSessionContext(input as readonly SessionEntry[]) : undefined;
  const source: readonly Message[] = snapshot ? snapshot.messages : (input as readonly Message[]);
  const summaries = snapshot ? [...snapshot.summaries] : [];

  // A `tool_call` is dropped unless a `tool_result` for its id exists, so an in-flight call (the
  // assistant message is appended before tools run) never reaches a consumer as an unmatched `tool_use`.
  const answered = new Set<string>();
  for (const message of source)
    for (const block of message.content) if (block.type === "tool_result") answered.add(block.toolCallId);

  const portable = (message: Message): Portable | undefined => {
    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        if (block.text.length > 0) parts.push(block.text);
      } else if (block.type === "tool_call") {
        if (block.authority !== "provider-hosted" && !answered.has(block.id)) continue;
        parts.push(toolCallText(block));
      } else if (block.type === "tool_result") {
        parts.push(`[tool_result ${block.name}: ${toolResultText(block, maxToolChars)}]`);
      } else {
        const text = blockText(block);
        if (text.length > 0) parts.push(text);
      }
    }
    if (parts.length === 0) return undefined;
    const role = message.role === "assistant" ? "assistant" : "user";
    return { role, text: parts.join("\n"), ...(message.id === undefined ? {} : { id: message.id }) };
  };

  const rendered = source.map(portable).filter((item): item is Portable => item !== undefined);

  // A turn starts at a user message; anything before the first one is a leading turn.
  const turns: Portable[][] = [];
  for (const message of rendered) {
    if (turns.length === 0 || message.role === "user") turns.push([message]);
    else (turns.at(-1) as Portable[]).push(message);
  }

  const cost = (messages: readonly Portable[]) => messages.reduce((sum, message) => sum + message.text.length + 1, 0);

  const pinned: Portable[] = [];
  let used = 0;
  let truncated = false;
  const pinnedIds = new Set<string>();
  const pinnedTexts = new Set<string>();
  for (const message of options.pinned ?? []) {
    const item = portable(message);
    if (item === undefined) continue;
    let text = item.text;
    if (used + text.length > maxChars) {
      text = text.slice(0, Math.max(0, maxChars - used));
      truncated = true;
    }
    used += text.length;
    pinned.push({ ...item, text });
    if (item.id !== undefined) pinnedIds.add(item.id);
    else pinnedTexts.add(`${item.role}\u0000${item.text}`);
  }

  const limit = options.lastTurns === undefined ? turns.length : Math.min(options.lastTurns, turns.length);
  const selected: Portable[][] = [];
  let turnsKept = 0;
  for (let index = turns.length - 1; index >= 0 && turnsKept < limit; index -= 1) {
    const turn = turns[index] as Portable[];
    const withoutPinned = turn.filter((message) => !(message.id !== undefined ? pinnedIds.has(message.id) : pinnedTexts.has(`${message.role}\u0000${message.text}`)));
    const remaining = maxChars - used;
    const room = remaining <= 0 ? 0 : remaining;
    const size = cost(withoutPinned);
    if (size > room) {
      // Newest turn too big on its own: cut it from its oldest end, message by message.
      const kept: Portable[] = [];
      let spent = 0;
      for (let at = withoutPinned.length - 1; at >= 0; at -= 1) {
        const message = withoutPinned[at] as Portable;
        if (spent + message.text.length + 1 > room) {
          if (kept.length === 0 && room > 0) {
            kept.unshift({ ...message, text: message.text.slice(0, room) });
            spent += room;
          }
          truncated = true;
          break;
        }
        kept.unshift(message);
        spent += message.text.length + 1;
      }
      if (kept.length > 0) {
        selected.unshift(kept);
        used += spent;
        turnsKept += 1;
      }
      break;
    }
    selected.unshift(withoutPinned);
    used += size;
    turnsKept += 1;
  }

  // Consecutive same-role messages merge, so the slice never claims a turn shape it does not have.
  const messages: Message[] = [];
  for (const turn of selected)
    for (const item of turn) {
      const previous = messages.at(-1);
      if (previous && previous.role === item.role) messages[messages.length - 1] = { ...previous, content: [{ type: "text", text: `${textOf(previous)}\n${item.text}` }] };
      else messages.push({ role: item.role, content: [{ type: "text", text: item.text }] });
    }

  const pinnedMessages: Message[] = pinned.map((item) => ({ role: item.role, content: [{ type: "text", text: item.text }] }));
  return {
    summaries,
    pinned: pinnedMessages,
    messages,
    turns: turnsKept,
    omittedTurns: turns.length - turnsKept,
    truncated,
  };
}

function textOf(message: Message): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}
