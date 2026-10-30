/**
 * The exchange archive (plan 188.9 Task 7): one verbatim note per completed user turn — the user's
 * text plus the assistant reply that follows it — so a later session can recall what was actually
 * said, not only what a later extractor made of it.
 *
 * Two rules shape everything here. An exchange is **paired**, never a single message: a tool round
 * (an assistant message that carries a `tool_call`) is not a completed exchange, and tool payloads are
 * never stored. And the note's inputs are the **persisted** session entries, which the kernel writes
 * after redaction, so a configured agent redactor has already replaced its secrets before this module
 * sees the text; the trust scan below is the second gate, not the only one.
 */
import { createHash } from "node:crypto";
import type { Message, SecretRedactor, SessionEntry } from "@arnilo/prism";
import type { MemoryConsentInput } from "@arnilo/prism-memory-core";
import { lexicalTerms } from "@arnilo/prism-memory-core";
import { scanScopedMemoryContent } from "./scoped/trust.js";
import type { MemoryFabric, MemoryFabricWriteOptions, MemoryNoteScope } from "./types.js";

/** Link edges one split part carries; a pathological turn is capped instead of writing a quadratic list. */
const MAX_LINKED_PARTS = 8;
/** Headroom a split part leaves inside the entry limit for its `context: "part i of n"` key text. */
const PART_CONTEXT_OVERHEAD = 40;

export interface ExchangePair {
  readonly user: SessionEntry;
  readonly assistant: SessionEntry;
}

/** Counts of one archive run. `parts` can exceed `archived` when a long exchange splits. */
export interface ExchangeArchiveReport {
  /** Completed exchanges archived (a re-archive of an existing exchange counts as skipped). */
  readonly archived: number;
  /** Pairs the archive passed over: already archived, a tool round, empty text, or refused. */
  readonly skipped: number;
  /** Notes written. */
  readonly parts: number;
  /** Refusals per gate, reported so a host can note them. */
  readonly refused: { readonly trust: number; readonly secret: number };
  /** The assistant entry id of the last pair the scan reached; the caller's back-fill cursor. */
  readonly cursor?: string;
}

export interface ExchangeArchiveOptions {
  readonly remember: MemoryFabric["remember"];
  /** True when a note id already exists. The back-fill uses it to stay idempotent. */
  readonly exists?: (id: string) => Promise<boolean>;
  /** The core entry-text limit an exchange is kept under; longer turns split into linked parts. */
  readonly maxTextChars: number;
  /** The write scope, resolved once at setup; `path` never holds history. */
  readonly scope: Exclude<MemoryNoteScope, "path">;
  readonly consent?: MemoryConsentInput;
  /** Defense in depth: refuse a turn the redactor would rewrite instead of storing altered history. */
  readonly redactor?: SecretRedactor;
}

export interface ExchangeArchive {
  /** Archive one pair. A no-op when the pair is not a completed exchange or its note already exists. */
  pair(pair: ExchangePair, options?: MemoryFabricWriteOptions): Promise<ExchangeArchiveReport>;
  /** Archive every completed exchange in `entries` after `cursor` (a prior run's assistant entry id). */
  entries(
    entries: readonly SessionEntry[],
    options?: { readonly cursor?: string } & MemoryFabricWriteOptions,
  ): Promise<ExchangeArchiveReport>;
}

/** The text blocks of a message, joined in order; tool calls, results, images, and thinking are excluded. */
export function messageText(message: Message | undefined): string {
  if (message === undefined) return "";
  return message.content
    .filter((block): block is { readonly type: "text"; readonly text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** An assistant reply that ends a turn: text (or at least no tool call), and no `tool_call` block. */
export function isFinalAssistant(message: Message | undefined): boolean {
  if (message === undefined || message.role !== "assistant") return false;
  if (message.content.some((block) => block.type === "tool_call")) return false;
  return messageText(message).length > 0;
}

/** Every completed exchange in branch order: each final assistant entry with its nearest preceding user entry. */
export function exchangePairs(entries: readonly SessionEntry[]): readonly ExchangePair[] {
  const pairs: ExchangePair[] = [];
  let user: SessionEntry | undefined;
  for (const entry of entries) {
    const message = entry.message;
    if (message === undefined) continue;
    if (message.role === "user") {
      if (messageText(message).length > 0) user = entry;
      continue;
    }
    if (user !== undefined && isFinalAssistant(message)) pairs.push({ user, assistant: entry });
  }
  return pairs;
}

/**
 * The exchange's note id: a function of the session and the two entry ids, so re-archiving the same
 * pair addresses the same note instead of writing a duplicate.
 */
export function exchangeNoteId(sessionId: string, userEntryId: string, assistantEntryId: string, part: number): string {
  return createHash("sha256").update(`${sessionId}\0${userEntryId}\0${assistantEntryId}\0${part}`).digest("hex").slice(0, 12);
}

/**
 * The exchange as one or more note bodies, each at most `maxChars`. A turn that fits stays one note
 * (`user: …` then `assistant: …`); a longer turn splits on the message boundary first, then on
 * paragraph, then line, then hard boundaries, so no part ever cuts a paragraph when a smaller cut is
 * available and every part stays verbatim.
 */
export function splitExchange(userText: string, assistantText: string, maxChars: number): readonly string[] {
  const whole = `user: ${userText}\n\nassistant: ${assistantText}`;
  if (whole.length <= maxChars) return [whole];
  const parts: string[] = [];
  for (const [label, text] of [
    ["user", userText],
    ["assistant", assistantText],
  ] as const) {
    const prefix = `${label}: `;
    const room = maxChars - prefix.length;
    if (room < 1) throw new Error("maxChars is too small for an exchange prefix");
    for (const chunk of chunkText(text, room)) parts.push(prefix + chunk);
  }
  return parts;
}

/** Greedy packing of paragraph → line → character pieces into chunks of at most `size` characters. */
function chunkText(text: string, size: number): readonly string[] {
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length <= size) {
      pieces.push(paragraph);
      continue;
    }
    for (const line of paragraph.split("\n")) {
      if (line.length <= size) {
        pieces.push(line);
        continue;
      }
      for (let at = 0; at < line.length; at += size) pieces.push(line.slice(at, at + size));
    }
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const joined = current.length === 0 ? piece : `${current}\n${piece}`;
    if (joined.length <= size) current = joined;
    else {
      if (current.length > 0) chunks.push(current);
      current = piece;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

/** Deterministic index expansion; categories bridge common paraphrases without a model. */
export function exchangeKeywords(text: string): readonly string[] {
  const terms = lexicalTerms(text);
  const keywords = new Set<string>();
  for (const entity of text.match(
    /\b[A-Z][\p{L}\p{N}-]*(?:[ \t]+[A-Z][\p{L}\p{N}-]*)*|\b\d+(?:[./:-]\d+)*(?:\s?(?:kg|km|cm|mg|ml|hours?|minutes?|days?|years?))?/gu,
  ) ?? []) {
    keywords.add(entity.toLowerCase().trim());
  }
  const categories: Readonly<Record<string, string>> = {
    travel: "flight airport hotel vacation trip journey",
    health: "doctor hospital medication illness surgery",
    employment: "job work employer career salary interview",
    education: "school university college degree course exam",
    residence: "house apartment home moved rent",
    family: "mother father daughter son wife husband sibling",
    preference: "favorite favourite prefer love like dislike",
    exercise: "running cycling swimming gym workout marathon",
    finance: "bank budget savings investment mortgage",
    food: "restaurant dinner lunch breakfast cooking recipe",
  };
  for (const [category, words] of Object.entries(categories)) {
    if ([...lexicalTerms(words)].some((term) => terms.has(term))) keywords.add(category);
  }
  return [...keywords].sort();
}

function emptyReport(): ExchangeArchiveReport {
  return { archived: 0, skipped: 0, parts: 0, refused: { trust: 0, secret: 0 } };
}

export function createExchangeArchive(options: ExchangeArchiveOptions): ExchangeArchive {
  const { remember, exists, maxTextChars, scope } = options;

  async function pair(input: ExchangePair, writeOptions: MemoryFabricWriteOptions = {}): Promise<ExchangeArchiveReport> {
    const report = emptyReport();
    if (!isFinalAssistant(input.assistant.message)) return { ...report, skipped: 1 };
    const userText = messageText(input.user.message);
    const assistantText = messageText(input.assistant.message);
    if (userText.length === 0) return { ...report, skipped: 1 };
    if (!scanScopedMemoryContent(`${userText}\n${assistantText}`).ok) {
      return { ...report, skipped: 1, refused: { trust: 1, secret: 0 } };
    }
    if (options.redactor !== undefined && options.redactor.redact(`${userText}\n${assistantText}`) !== `${userText}\n${assistantText}`) {
      return { ...report, skipped: 1, refused: { trust: 0, secret: 1 } };
    }
    const sessionId = writeOptions.sessionId ?? "";
    let contents = splitExchange(userText, assistantText, maxTextChars);
    // A split part also carries `context`, which the store indexes with the text: split again with
    // headroom so the part plus its context still fits the core limit.
    if (contents.length > 1 && maxTextChars > 2 * PART_CONTEXT_OVERHEAD) {
      contents = splitExchange(userText, assistantText, maxTextChars - PART_CONTEXT_OVERHEAD);
    }
    const ids = contents.map((_, part) => exchangeNoteId(sessionId, input.user.id, input.assistant.id, part));
    if (exists !== undefined) {
      const present = await Promise.all(ids.map((id) => exists(id)));
      if (present.every(Boolean)) return { ...report, skipped: 1 };
    }
    let written = 0;
    for (const [part, content] of contents.entries()) {
      // A part links to its siblings so recalling any one expands to the rest; a pathological turn
      // caps the edges at eight rather than writing a quadratic link list.
      const links =
        contents.length < 2
          ? undefined
          : ids
              .filter((_, other) => other !== part)
              .slice(0, MAX_LINKED_PARTS)
              .map((id) => ({ id, relation: "part" }));
      await remember(
        {
          kind: "exchange",
          id: ids[part]!,
          content,
          scope,
          session: sessionId || input.user.sessionId,
          tRef: input.user.timestamp,
          sourceEntryIds: [input.user.id, input.assistant.id],
          keywords: exchangeKeywords(content),
          ...(contents.length < 2 ? {} : { context: `part ${part + 1} of ${contents.length}` }),
          ...(links === undefined ? {} : { links }),
          ...(options.consent === undefined ? {} : { consent: options.consent }),
        },
        { ...writeOptions, generatedBy: "host" },
      );
      written += 1;
    }
    return { ...report, archived: 1, parts: written };
  }

  async function entries(
    branch: readonly SessionEntry[],
    runOptions: { readonly cursor?: string } & MemoryFabricWriteOptions = {},
  ): Promise<ExchangeArchiveReport> {
    const pairs = exchangePairs(branch);
    // The cursor names the last assistant entry a previous run reached; a missing cursor (a rewritten
    // branch) starts over and the id check keeps it idempotent.
    const { cursor: priorCursor, ...writeOptions } = runOptions;
    const start = priorCursor === undefined ? 0 : pairs.findIndex((item) => item.assistant.id === priorCursor) + 1;
    let archived = 0;
    let skipped = 0;
    let parts = 0;
    let trust = 0;
    let secret = 0;
    let cursor = priorCursor;
    for (const item of pairs.slice(start)) {
      const result = await pair(item, writeOptions);
      archived += result.archived;
      skipped += result.skipped;
      parts += result.parts;
      trust += result.refused.trust;
      secret += result.refused.secret;
      cursor = item.assistant.id;
    }
    return { archived, skipped, parts, refused: { trust, secret }, ...(cursor === undefined ? {} : { cursor }) };
  }

  return { pair, entries };
}
