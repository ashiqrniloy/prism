/**
 * The exchange archive (plan 188.9 Task 7): one verbatim note per completed user turn — the user's
 * text plus the assistant reply that follows it — so a later session can recall what was actually
 * said, not only what a later extractor made of it.
 *
 * Tool payloads are never stored. With the opt-in `steps` option (plan 209 Task 2) an exchange also
 * carries a bounded `## Steps` trace — tool, argument summary, outcome, first error line, result entry
 * id — which is evidence for recall, never a candidate for extraction.
 *
 * Two rules shape everything here. An exchange is **paired**, never a single message: a tool round
 * (an assistant message that carries a `tool_call`) is not a completed exchange, and tool payloads are
 * never stored. And the note's inputs are the **persisted** session entries, which the kernel writes
 * after redaction, so a configured agent redactor has already replaced its secrets before this module
 * sees the text; the trust scan below is the second gate, not the only one.
 */
import { createHash } from "node:crypto";
import type { Message, SecretRedactor, SessionEntry } from "@arnilo/prism";
import type { MemoryConsentInput } from "@arnilo/prism-memory-system/core";
import { lexicalTerms } from "@arnilo/prism-memory-system/core";
import { normalizeScopedMemoryContent, scanScopedMemoryContent } from "@arnilo/prism-memory-system/core";
import type { MemoryFabric, MemoryFabricWriteOptions, MemoryNoteScope } from "./types.js";

/** Link edges one split part carries; a pathological turn is capped instead of writing a quadratic list. */
const MAX_LINKED_PARTS = 8;
/** Headroom a split part leaves inside the entry limit for its `context: "part i of n"` key text. */
const PART_CONTEXT_OVERHEAD = 40;

export interface ExchangePair {
  readonly user: SessionEntry;
  readonly assistant: SessionEntry;
  /** The persisted entries between the two (tool rounds). Present only when there are some; the step trace reads them. */
  readonly between?: readonly SessionEntry[];
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
  /** Steps whose text the trust scan or redactor dropped (only `outcome` kept); zero unless `steps` is on. */
  readonly stepsDropped: number;
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
  /** Opt-in condensed tool-step trace (plan 209 Task 2). Absent, an exchange stores dialogue only. */
  readonly steps?: ExchangeStepsOptions;
}

export interface ExchangeStepsOptions {
  /** Most tool rounds listed per exchange; further ones collapse into one "more" line. */
  readonly maxSteps: number;
  /** The argument names a tool declares (its `parameters.properties`), so the summary reads the schema, not the tool name. */
  readonly argumentFields?: (tool: string) => ReadonlySet<string> | undefined;
  /** Regex sources (`CONSOLIDATION_PATTERNS.outcomes`): a failed-then-passed run of a matching command tags the exchange `outcome:fixed`. */
  readonly outcomePatterns?: readonly string[];
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
  let between: SessionEntry[] = [];
  for (const entry of entries) {
    const message = entry.message;
    if (message === undefined) continue;
    if (message.role === "user") {
      if (messageText(message).length > 0) {
        user = entry;
        between = [];
      }
      continue;
    }
    if (user !== undefined && isFinalAssistant(message)) {
      pairs.push({ user, assistant: entry, ...(between.length === 0 ? {} : { between }) });
      between = [];
    } else if (user !== undefined) between.push(entry);
  }
  return pairs;
}

/** Argument names tried in order when a tool declares them; the first scalar argument is the fallback. */
const ARGUMENT_FIELDS: readonly string[] = ["command", "cmd", "path", "file_path", "filePath", "file", "query", "pattern", "url"];
const MAX_ARGUMENT_CHARS = 120;
const MAX_ERROR_CHARS = 200;
const TOOL_NAME = /^[\w.:-]{1,64}$/;

export interface ExchangeStep {
  readonly tool: string;
  /** Argument summary, at most 120 characters. Absent when the tool took no scalar argument. */
  readonly argument?: string;
  readonly outcome: "ok" | "error";
  /** First line of the error text, at most 200 characters. */
  readonly error?: string;
  /** The session entry id of the tool result, so `memory.read { around }` can reach the full output. */
  readonly entryId: string;
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function summarizeArgument(args: Record<string, unknown>, declared: ReadonlySet<string> | undefined): string | undefined {
  const scalar = (value: unknown): string | undefined =>
    typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
  for (const field of ARGUMENT_FIELDS) {
    if (declared !== undefined && !declared.has(field)) continue;
    const text = scalar(args[field]);
    if (text !== undefined && flat(text).length > 0) return clip(flat(text).replace(/`/g, "'"), MAX_ARGUMENT_CHARS);
  }
  for (const value of Object.values(args)) {
    const text = scalar(value);
    if (text !== undefined && flat(text).length > 0) return clip(flat(text).replace(/`/g, "'"), MAX_ARGUMENT_CHARS);
  }
  return undefined;
}

/**
 * One step per tool result among `entries`, in order: the tool, an argument summary, `ok`/`error`, the
 * error's first line, and the result entry id. Result bodies are never read.
 */
export function summarizeSteps(
  entries: readonly SessionEntry[],
  options: Pick<ExchangeStepsOptions, "argumentFields"> = {},
): readonly ExchangeStep[] {
  const calls = new Map<string, { readonly name: string; readonly arguments: Record<string, unknown> }>();
  const steps: ExchangeStep[] = [];
  for (const entry of entries) {
    for (const block of entry.message?.content ?? []) {
      if (block.type === "tool_call") {
        calls.set(block.id, { name: block.name, arguments: block.arguments });
        continue;
      }
      if (block.type !== "tool_result") continue;
      const call = calls.get(block.toolCallId);
      const tool = call?.name ?? block.name;
      const argument = call === undefined ? undefined : summarizeArgument(call.arguments, options.argumentFields?.(tool));
      const firstLine =
        block.error === undefined ? undefined : (block.error.message.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "");
      steps.push({
        tool,
        ...(argument === undefined ? {} : { argument }),
        outcome: block.error === undefined ? "ok" : "error",
        ...(firstLine === undefined || flat(firstLine).length === 0 ? {} : { error: clip(flat(firstLine), MAX_ERROR_CHARS) }),
        entryId: entry.id,
      });
    }
  }
  return steps;
}

/** True when an `error` step is followed by an `ok` step of the same tool and argument, for a command the patterns match. */
export function hasFailedThenPassed(steps: readonly ExchangeStep[], patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const expressions = patterns.map((pattern) => new RegExp(pattern, "i"));
  const failed = new Set<string>();
  for (const step of steps) {
    if (step.argument === undefined) continue;
    const text = `${step.tool} ${step.argument}`;
    if (!expressions.some((expression) => expression.test(text))) continue;
    const key = `${step.tool}\0${step.argument}`;
    if (step.outcome === "error") failed.add(key);
    else if (failed.has(key)) return true;
  }
  return false;
}

const STEPS_HEADING = "\n\n## Steps\n";

/**
 * An archived exchange's dialogue without its step trace. Steps are evidence for recall; extraction
 * reads only what was said (plan 188.3: tool output is never candidate text).
 */
export function exchangeDialogue(text: string): string {
  const at = text.lastIndexOf(STEPS_HEADING);
  if (at < 0) return text;
  const rest = text.slice(at + STEPS_HEADING.length).split("\n");
  return rest.every((line) => line.startsWith("- ")) ? text.slice(0, at) : text;
}

/**
 * The `## Steps` block (with its leading blank line) and the counts the caller reports. A step whose text
 * the trust scan flags, or the redactor would rewrite, keeps only its tool name and outcome. The block
 * never exceeds `maxChars`: later steps collapse into one "more" line.
 */
export function renderSteps(
  steps: readonly ExchangeStep[],
  limits: { readonly maxSteps: number; readonly maxChars: number; readonly redactor?: SecretRedactor },
): { readonly block: string; readonly dropped: number } {
  const lines: string[] = [];
  let dropped = 0;
  let used = STEPS_HEADING.length - 1;
  let listed = 0;
  for (const step of steps.slice(0, limits.maxSteps)) {
    const tool = TOOL_NAME.test(step.tool) ? step.tool : "tool";
    const argument = step.argument === undefined ? undefined : normalizeScopedMemoryContent(step.argument);
    const error = step.error === undefined ? undefined : normalizeScopedMemoryContent(step.error);
    const text = [tool, argument ?? "", error ?? ""].join("\n");
    const unsafe =
      !TOOL_NAME.test(step.tool) ||
      !scanScopedMemoryContent(text).ok ||
      (limits.redactor !== undefined && limits.redactor.redact(text) !== text);
    const line = unsafe
      ? `- ${tool} → ${step.outcome} (entry ${step.entryId})`
      : `- ${tool}${argument === undefined ? "" : ` \`${argument}\``} → ${step.outcome}${error === undefined ? "" : `: ${error}`} (entry ${step.entryId})`;
    if (unsafe) dropped += 1;
    const overflow = steps.length - listed - 1;
    const reserve = overflow > 0 ? `\n- … ${overflow} more step(s)`.length : 0;
    if (used + 1 + line.length + reserve > limits.maxChars) break;
    lines.push(line);
    used += 1 + line.length;
    listed += 1;
  }
  if (lines.length === 0) return { block: "", dropped };
  const more = steps.length - listed;
  if (more > 0) lines.push(`- … ${more} more step(s)`);
  return { block: `${STEPS_HEADING}${lines.join("\n")}`, dropped };
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

/**
 * Deterministic keyword derivation; categories bridge common paraphrases without a model. The exchange archive no longer
 * writes these (plan 210 Task 7); the ontology tier derives them for evidence notes stored without keywords.
 */
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
  return { archived: 0, skipped: 0, parts: 0, refused: { trust: 0, secret: 0 }, stepsDropped: 0 };
}

export function createExchangeArchive(options: ExchangeArchiveOptions): ExchangeArchive {
  const { remember, exists, maxTextChars, scope } = options;

  async function pair(input: ExchangePair, writeOptions: MemoryFabricWriteOptions = {}): Promise<ExchangeArchiveReport> {
    const report = emptyReport();
    if (!isFinalAssistant(input.assistant.message)) return { ...report, skipped: 1 };
    const userText = normalizeScopedMemoryContent(messageText(input.user.message));
    const assistantText = normalizeScopedMemoryContent(messageText(input.assistant.message));
    if (userText.length === 0) return { ...report, skipped: 1 };
    if (!scanScopedMemoryContent(`${userText}\n${assistantText}`).ok) {
      return { ...report, skipped: 1, refused: { trust: 1, secret: 0 } };
    }
    if (options.redactor !== undefined && options.redactor.redact(`${userText}\n${assistantText}`) !== `${userText}\n${assistantText}`) {
      return { ...report, skipped: 1, refused: { trust: 0, secret: 1 } };
    }
    const sessionId = writeOptions.sessionId ?? "";
    // The step trace is bounded to a quarter of the entry limit and appended to the last part, so the
    // dialogue keeps at least three quarters and stays verbatim.
    const steps = options.steps === undefined || input.between === undefined ? [] : summarizeSteps(input.between, options.steps);
    const rendered =
      steps.length === 0
        ? { block: "", dropped: 0 }
        : renderSteps(steps, {
            maxSteps: options.steps!.maxSteps,
            maxChars: Math.floor(maxTextChars / 4),
            ...(options.redactor === undefined ? {} : { redactor: options.redactor }),
          });
    const fixed = rendered.block !== "" && hasFailedThenPassed(steps, options.steps?.outcomePatterns ?? []);
    const room = maxTextChars - rendered.block.length;
    let contents = splitExchange(userText, assistantText, room);
    // A split part also carries `context`, which the store indexes with the text: split again with
    // headroom so the part plus its context still fits the core limit.
    if (contents.length > 1 && room > 2 * PART_CONTEXT_OVERHEAD) {
      contents = splitExchange(userText, assistantText, room - PART_CONTEXT_OVERHEAD);
    }
    if (rendered.block !== "") contents = [...contents.slice(0, -1), `${contents[contents.length - 1]}${rendered.block}`];
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
          ...(fixed ? { tags: ["outcome:fixed"] } : {}),
          ...(contents.length < 2 ? {} : { context: `part ${part + 1} of ${contents.length}` }),
          ...(links === undefined ? {} : { links }),
          ...(options.consent === undefined ? {} : { consent: options.consent }),
        },
        { ...writeOptions, generatedBy: "host" },
      );
      written += 1;
    }
    return { ...report, archived: 1, parts: written, stepsDropped: rendered.dropped };
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
    let stepsDropped = 0;
    let cursor = priorCursor;
    for (const item of pairs.slice(start)) {
      const result = await pair(item, writeOptions);
      archived += result.archived;
      skipped += result.skipped;
      parts += result.parts;
      trust += result.refused.trust;
      secret += result.refused.secret;
      stepsDropped += result.stepsDropped;
      cursor = item.assistant.id;
    }
    return { archived, skipped, parts, refused: { trust, secret }, stepsDropped, ...(cursor === undefined ? {} : { cursor }) };
  }

  return { pair, entries };
}
