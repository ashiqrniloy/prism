import type { JsonObject } from "@arnilo/prism";
import type { MemoryVectorRecord } from "./types.js";

/**
 * Shared lexical analysis for every lexical leg: the index, the query, and the coverage score use the
 * same terms, so a store hit and its coverage always agree (the SQLite index stores these terms
 * pre-stemmed instead of letting FTS5 tokenize raw text).
 */

// Function words that carry no recall signal. Kept short: over-pruning hurts short notes more than a
// stray stopword hurts ranking.
const STOPWORDS: ReadonlySet<string> = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its " +
    "me my of on or our she so than that the their them then there these they this those to was we were what when where " +
    "which who why will with would you your"
  ).split(" "),
);

/**
 * Conservative English suffix stemming: plurals, `-ing`, `-ed`, `-ly`. It folds the tense and number
 * variants that make two notes about one thing miss each other, and nothing more aggressive.
 */
export function stemLexical(term: string): string {
  if (!/^[a-z]+$/.test(term) || term.length <= 3) return term;
  let stem = term;
  if (stem.endsWith("ies") && stem.length > 4) stem = `${stem.slice(0, -3)}y`;
  else if (/(?:ss|us|is)$/.test(stem)) return stem;
  else if (/(?:sses|xes|zes|ches|shes)$/.test(stem)) stem = stem.slice(0, -2);
  else if (stem.endsWith("s")) stem = stem.slice(0, -1);
  if (stem.endsWith("ing") && stem.length > 5) stem = undouble(stem.slice(0, -3));
  else if (stem.endsWith("ed") && stem.length > 4) stem = undouble(stem.slice(0, -2));
  else if (stem.endsWith("ly") && stem.length > 4) stem = stem.slice(0, -2);
  return stem;
}

function undouble(stem: string): string {
  // "running" → "runn" → "run"; keep "ll"/"ss"/"zz" endings ("install", "pass").
  return /([b-df-hj-km-np-rtv-z])\1$/.test(stem) && !/(?:ll|ss|zz)$/.test(stem) ? stem.slice(0, -1) : stem;
}

/** Lowercase Unicode letter/number tokens of 2+ characters, stopwords dropped, stemmed. */
export function lexicalTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    terms.add(stemLexical(raw));
  }
  return terms;
}

/** Share of the query's terms the document contains, in [0,1]; 0 for an empty query. */
export function lexicalCoverage(queryTerms: ReadonlySet<string>, docTerms: ReadonlySet<string>): number {
  if (queryTerms.size === 0) return 0;
  let matched = 0;
  for (const term of queryTerms) if (docTerms.has(term)) matched += 1;
  return matched / queryTerms.size;
}

/** Query terms the document contains, in query order. */
export function lexicalMatches(queryTerms: ReadonlySet<string>, docTerms: ReadonlySet<string>): string[] {
  return [...queryTerms].filter((term) => docTerms.has(term));
}

/** Dice coefficient of two term sets, in [0,1]: the note-to-note similarity of the lexical mode. */
export function lexicalDice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * The record's index keys: the fabric note's keywords, tags, context, and path. These are written by
 * the agent or the promotion worker to name what the note is about, so the index weights them above
 * the body (write-time key expansion).
 */
export function lexicalKeys(record: Pick<MemoryVectorRecord, "metadata">): string {
  const note = record.metadata?.fabric;
  if (note === null || typeof note !== "object" || Array.isArray(note)) return "";
  const fields = note as JsonObject;
  const parts: string[] = [];
  for (const key of ["keywords", "tags"] as const) {
    const value = fields[key];
    if (Array.isArray(value)) for (const item of value) if (typeof item === "string") parts.push(item);
  }
  for (const key of ["context", "path"] as const) if (typeof fields[key] === "string") parts.push(fields[key] as string);
  return parts.join("\n");
}

/** Body and key terms of one record, for stores that score in TypeScript. */
export function recordLexicalTerms(record: Pick<MemoryVectorRecord, "text" | "metadata">): Set<string> {
  const terms = lexicalTerms(record.text);
  for (const term of lexicalTerms(lexicalKeys(record))) terms.add(term);
  return terms;
}

/** Space-joined terms, the form the SQLite FTS index stores and matches. */
export function lexicalTermString(text: string): string {
  return [...lexicalTerms(text)].join(" ");
}
