import { lexicalTerms, stemLexical } from "@arnilo/prism-memory-system/core";
import type { MemoryNoteHit } from "./types.js";

/** Below this many content characters a later excerpt carries too little to be worth its header. */
const MIN_EXCERPT_CHARS = 160;
/** Pointer cards show the user's words, capped at one short line, never the assistant reply. */
const POINTER_MAX_CHARS = 120;
export const PREAMBLE = "Cite the memory ids you use as [id].";
/** Minimum confidence for a passive hit; below it only the cue is delivered. */
export const DEFAULT_INJECT_MIN_SCORE = 0.2;
/** At or above this confidence a hit renders full text; below it renders a pointer card. */
export const DEFAULT_INJECT_FULL_TEXT_SCORE = 0.35;
/**
 * The disclosure that the block is a selection, not the whole memory. Domain-neutral on purpose:
 * the product cannot know whether this run exposes the memory tools (plan 188.10 Task 1b), so the
 * sentence names them and a host without them still reads a coherent, harmless line.
 */
const PARTIAL_TOOLS_NOTE =
  "To list, count or compare across past conversations, call memory.recall with several phrasings (queries) and memory.read the ids you need.";

/** `content[start, end)`, clamped, with an ellipsis on each side that was cut. */
export function windowAt(content: string, start: number, end: number): string {
  const from = Math.max(0, start);
  const to = Math.min(content.length, end);
  return `${from > 0 ? "…" : ""}${content.slice(from, to)}${to < content.length ? "…" : ""}`;
}

/**
 * At most `maxChars` of `content`, cut markers included, centred on the window that holds the most
 * matched query-term tokens; the head when nothing matches. One linear pass over the content.
 */
export function queryExcerpt(content: string, queryTerms: ReadonlySet<string>, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const width = Math.max(0, maxChars - 2);
  const spans: [number, number][] = [];
  for (const match of content.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match[0].length >= 2 && queryTerms.has(stemLexical(match[0].toLowerCase())))
      spans.push([match.index, match.index + match[0].length]);
  }
  let best = 0;
  let first = 0;
  for (let end = 0, start = 0; end < spans.length; end++) {
    while (start < end && spans[end]![1] - spans[start]![0] > width) start++;
    if (end - start + 1 > best) [best, first] = [end - start + 1, start];
  }
  if (best === 0) return windowAt(content, 0, width);
  const middle = (spans[first]![0] + spans[first + best - 1]![1]) / 2;
  const start = Math.max(0, Math.min(content.length - width, Math.floor(middle - width / 2)));
  return windowAt(content, start, start + width);
}

function injectionHead(hit: MemoryNoteHit): string {
  const dates = hit.dates?.length ? ` dates=${hit.dates.map((date) => `${date.resolved.slice(0, 10)}/${date.precision}`).join(",")}` : "";
  const superseded = hit.supersededBy ? ` superseded by ${hit.supersededBy.id} on ${hit.supersededBy.at.slice(0, 10)}?` : "";
  return `- [${hit.id}] ${hit.level ?? "project"} ${hit.kind} (${hit.ingestedAt.slice(0, 10)})${hit.tRef ? ` tRef=${hit.tRef}` : ""}${dates}${superseded} `;
}

/** The hit's final confident score: pre-fusion cosine in hybrid mode, coverage/score otherwise. */
function hitConfidence(hit: MemoryNoteHit): number {
  return hit.similarity ?? hit.coverage ?? hit.score ?? 1;
}

/** The user half of an archived exchange; a split assistant part falls back to its own text. */
function exchangeUserLine(content: string): string {
  if (!content.startsWith("user: ")) return content;
  const end = content.indexOf("\n\nassistant:");
  return end < 0 ? content.slice("user: ".length) : content.slice("user: ".length, end);
}

/** One pointer card: id, event date, the user's first 120 characters, and matched query terms. */
function injectionPointer(hit: MemoryNoteHit, queryTerms: ReadonlySet<string>, cardExcerpt: "head" | "query" = "head"): string {
  // `query` (plan 210 Task 3.1): the same width centred on the query terms across both halves of the exchange.
  const body = (cardExcerpt === "query" ? hit.content : exchangeUserLine(hit.content)).replace(/\s+/gu, " ").trim();
  const text =
    cardExcerpt === "query"
      ? queryExcerpt(body, queryTerms, POINTER_MAX_CHARS)
      : body.length > POINTER_MAX_CHARS
        ? `${body.slice(0, POINTER_MAX_CHARS - 1)}…`
        : body;
  const date = (hit.dates?.[0]?.resolved ?? hit.tRef ?? hit.ingestedAt).slice(0, 10);
  const contentTerms = lexicalTerms(text);
  const matched = [...queryTerms].filter((term) => contentTerms.has(term)).slice(0, 4);
  return `- [${hit.id}] ${date} "${text}"${matched.length > 0 ? ` · ${matched.join(", ")}` : ""}`;
}

/**
 * The passive-injection rendering decision, shared with the delivery diagnostic. `hits` are already
 * eligible and ranked. Delivery fills by rank: each hit renders whole while it fits the remaining
 * budget, up to `topK`, and a hit that does not fit whole is skipped rather than truncated (a later,
 * shorter hit may still fit). The best hit is always shown: if it alone exceeds the budget it renders
 * as a query-centred excerpt of the whole budget and names the id to `memory.read` in full. When
 * fewer notes are shown than `eligibleCount` after the floor, the block ends with one line that says
 * so and names the tools that can widen the search, so the agent knows the block was cut. Shown hits
 * are delivered facts first and then exchanges, each group in time order (`tRef` else `ingestedAt`,
 * ties by rank), so a later value is read last, while selection stays by rank. Rendering changes how much of a note is shown, never which ranked
 * notes are considered. Confidence gates delivery: a hit below `minScore` is not shown (the cue still
 * says how many matched), a hit below `fullTextScore` renders as a pointer card, and only a hit at or
 * above it renders its content. No gate changes ranking or adds a query or model call.
 */
export function fitInjection(
  hits: Iterable<MemoryNoteHit>,
  queryTerms: ReadonlySet<string>,
  budgetTokens: number,
  topK: number,
  eligibleCount = 0,
  minScore = DEFAULT_INJECT_MIN_SCORE,
  fullTextScore = DEFAULT_INJECT_FULL_TEXT_SCORE,
  cardExcerpt: "head" | "query" = "head",
): { hits: MemoryNoteHit[]; lines: string[]; tokens: number } {
  const budgetChars = budgetTokens * 4;
  const chosen: { hit: MemoryNoteHit; line: string; rank: number }[] = [];
  // Counted on the joined block, newlines included, so the block's own token estimate stays in budget.
  let chars = PREAMBLE.length;
  let rank = 0;
  for (const hit of hits) {
    if (chosen.length >= topK) break;
    rank += 1;
    const confidence = hitConfidence(hit);
    if (confidence < minScore) continue;
    if (confidence < fullTextScore) {
      const line = injectionPointer(hit, queryTerms, cardExcerpt);
      if (chars + 1 + line.length <= budgetChars) {
        chosen.push({ hit, line, rank });
        chars += 1 + line.length;
      }
      continue;
    }
    const head = injectionHead(hit);
    const whole = head + hit.content;
    if (chars + 1 + whole.length <= budgetChars) {
      chosen.push({ hit, line: whole, rank });
      chars += 1 + whole.length;
      continue;
    }
    // Only the best hit is ever cut; a later hit that does not fit whole is skipped, never truncated.
    if (chosen.length > 0) continue;
    const marker = ` (excerpt; memory.read ${hit.id} for the full note)`;
    const room = budgetChars - chars - 1 - head.length - marker.length;
    // Too little budget to say anything worth the header: deliver nothing rather than overspend it.
    if (room < MIN_EXCERPT_CHARS) break;
    const line = head + queryExcerpt(hit.content, queryTerms, room) + marker;
    chosen.push({ hit, line, rank });
    chars += 1 + line.length;
  }
  if (chosen.length === 0) {
    // A floor can remove every hit. The cue still says memory was searched, so the agent knows the
    // block is empty by policy rather than because nothing matched. It counts inside the budget.
    if (eligibleCount === 0) return { hits: [], lines: [], tokens: 0 };
    const cue = partialSelectionCue(0, eligibleCount);
    if (chars + 1 + cue.length > budgetChars) return { hits: [], lines: [], tokens: 0 };
    return { hits: [], lines: [PREAMBLE, cue], tokens: Math.ceil((chars + 1 + cue.length) / 4) };
  }
  // Facts first, then the exchanges that back them; each group in time order. Selection above stays
  // by rank, so grouping changes where a note is read, never which notes made the cut.
  chosen.sort(
    (a, b) =>
      Number(a.hit.kind === "exchange") - Number(b.hit.kind === "exchange") ||
      (a.hit.tRef ?? a.hit.ingestedAt).localeCompare(b.hit.tRef ?? b.hit.ingestedAt) ||
      a.rank - b.rank,
  );
  let lines = chosen.map((entry) => entry.line);
  if (eligibleCount > chosen.length && chosen.length > 0) {
    // The cue counts inside the same budget, so it competes with evidence: drop delivered notes from
    // the tail (never the best hit) until it fits, and skip it only when even one note leaves no room.
    let cue = partialSelectionCue(chosen.length, eligibleCount);
    while (chosen.length > 1 && chars + 1 + cue.length > budgetChars) {
      const dropped = chosen.pop()!;
      chars -= 1 + (dropped?.line.length ?? 0);
      lines = chosen.map((entry) => entry.line);
      cue = partialSelectionCue(chosen.length, eligibleCount);
    }
    if (chars + 1 + cue.length <= budgetChars) {
      lines.push(cue);
      chars += 1 + cue.length;
    }
  }
  return { hits: chosen.map((entry) => entry.hit), lines: [PREAMBLE, ...lines], tokens: Math.ceil(chars / 4) };
}

/** `Showing N of M matching notes.` plus the tool sentence; counts only, never note text. */
function partialSelectionCue(shown: number, eligibleCount: number): string {
  return `Showing ${shown} of ${eligibleCount} matching notes. ${PARTIAL_TOOLS_NOTE}`;
}
