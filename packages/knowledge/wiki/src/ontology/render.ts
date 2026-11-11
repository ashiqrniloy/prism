/**
 * How a concept is delivered (plan 207 Task 4; the wiki's own `wiki.search` and `wiki.read` since plan 216 Task 3):
 * concepts first, then drill down.
 *
 * A concept hit renders as a header, its current claims with the ids they cite, and one drill-down line. The
 * selection is deterministic (term overlap with the query, no model call), stale claims never appear, and a claim
 * whose citations are not all readable is dropped, so a forgotten note's text cannot ride in on a concept file
 * another process left behind.
 */
import { lexicalTerms, MemoryValidationError } from "@arnilo/prism-memory-system/core";
import { type ConceptDoc, type ConceptItem, describeItem, parseConceptBody } from "./codec.js";

/** `search.maxClaimsRendered` (tuning): claims one concept hit shows in `wiki.search`. */
export const DEFAULT_MAX_CLAIMS_RENDERED = 8;
export const MAX_CLAIMS_RENDERED_LIMIT = 32;
/** One drill-down line names at most this many ids (the `wiki.read` ceiling). */
export const MAX_DRILL_DOWN_IDS = 8;

export function resolveMaxClaimsRendered(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CLAIMS_RENDERED;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CLAIMS_RENDERED_LIMIT) {
    throw new MemoryValidationError(`search.maxClaimsRendered must be an integer in [1,${MAX_CLAIMS_RENDERED_LIMIT}]`);
  }
  return value;
}

/** The body of a concept note; `undefined` when a person broke it, so a broken file is never delivered. */
export function readConceptBody(text: string): ConceptDoc | undefined {
  try {
    return parseConceptBody(text, { allowUncited: true });
  } catch {
    return undefined;
  }
}

/** Ids a concept hit's current claims cite: what the delivery-time readability check has to confirm. */
export function citedByCurrentClaims(doc: ConceptDoc, stale: readonly string[] | undefined): readonly string[] {
  const skip = new Set(stale ?? []);
  const out = new Set<string>();
  for (const claim of doc.claims) if (!skip.has(claim.id)) for (const cite of claim.cites) out.add(cite);
  return [...out];
}

export interface ConceptRenderInput {
  readonly text: string;
  readonly stale: readonly string[] | undefined;
  readonly queryTerms: ReadonlySet<string>;
  readonly max: number;
  /** When given, a claim is shown only if every note it cites is in the set. */
  readonly readable?: ReadonlySet<string>;
  /**
   * False for a shared team concept: its cited notes are private and never travelled with it, so the drill-down
   * reads the concept itself instead of naming ids nobody here can read. Default true.
   */
  readonly evidence?: boolean;
}

export interface ConceptRender {
  /** Claim lines (indented) then the drill-down line. */
  readonly lines: readonly string[];
  /** Every id a shown claim cites, in claim order. */
  readonly cited: readonly string[];
  readonly claims: number;
}

function overlap(item: ConceptItem, terms: ReadonlySet<string>): number {
  let count = 0;
  for (const term of lexicalTerms(item.text)) if (terms.has(term)) count += 1;
  return count;
}

/** Current claims of a concept for one query: not stale, citations readable, best term overlap first, document order kept. */
export function selectConceptClaims(doc: ConceptDoc, input: Omit<ConceptRenderInput, "text">): readonly ConceptItem[] {
  const stale = new Set(input.stale ?? []);
  const eligible = doc.claims.filter(
    (claim) => !stale.has(claim.id) && (input.readable === undefined || claim.cites.every((cite) => input.readable!.has(cite))),
  );
  const ranked = eligible
    .map((claim, index) => ({ claim, index, score: overlap(claim, input.queryTerms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, input.max);
  return ranked.sort((a, b) => a.index - b.index).map((entry) => entry.claim);
}

/** The recall lines of one concept hit below its header. A concept with no current claim says so and points at the read. */
export function renderConceptClaims(conceptId: string, input: ConceptRenderInput): ConceptRender {
  const doc = readConceptBody(input.text);
  const claims = doc === undefined ? [] : selectConceptClaims(doc, input);
  if (claims.length === 0) {
    return { lines: [`  no current claims; wiki.read { id: ${JSON.stringify(conceptId)} }`], cited: [], claims: 0 };
  }
  const cited: string[] = [];
  for (const claim of claims) for (const cite of claim.cites) if (!cited.includes(cite)) cited.push(cite);
  const lines = claims.map(
    (claim) => `  [${claim.id}] ${describeItem(claim)}${claim.cites.length === 0 ? "" : ` ← ${claim.cites.join(", ")}`}`,
  );
  const ids = input.evidence === false ? [] : cited.slice(0, MAX_DRILL_DOWN_IDS);
  lines.push(
    ids.length === 0
      ? `  drill down: wiki.read { id: ${JSON.stringify(conceptId)} }`
      : `  drill down: wiki.read { ids: [${ids.map((id) => JSON.stringify(id)).join(", ")}] }`,
  );
  return { lines, cited, claims: claims.length };
}

/**
 * `wiki.read` of a concept: the whole body with its claim ids, a `(stale)` label on each stale claim and
 * `(uncited, human)` on a person's uncited claim. A body a person broke is returned as stored.
 */
export function renderConceptRead(text: string, stale: readonly string[] | undefined): string {
  const doc = readConceptBody(text);
  if (doc === undefined) return text;
  const skip = new Set(stale ?? []);
  const item = (entry: ConceptItem): string =>
    `- [${entry.id}] ${describeItem(entry, { stale: skip.has(entry.id) })}${entry.cites.map((cite) => `[^${cite}]`).join("")}`;
  const parts = [`# ${doc.title}`, ""];
  if (doc.claims.length > 0) parts.push(...doc.claims.map(item), "");
  if (doc.questions.length > 0) parts.push("## Open questions", ...doc.questions.map(item), "");
  if (doc.contradictions.length > 0) parts.push("## Contradictions", ...doc.contradictions.map(item), "");
  return parts.join("\n").trimEnd();
}
