/**
 * Deterministic subject binding (plan 207 Task 3): which one subject, if any, a T1 note's text and keys name.
 *
 * A token map, not a scan, and no model call. Names (a subject's slug, title and aliases) and the note are
 * both reduced by the lexical index's own normalizer (`lexicalTerms`: lowercase, stopwords dropped, stemmed),
 * so a binding agrees with what recall would match. Matching is whole-token and case-folded.
 *
 * A subject qualifies when one of its names has at least `threshold` distinct tokens in the note, or when every
 * token of a multi-token name does (an exact alias). Exactly one qualifying subject binds the note. Zero, or
 * several, leave it unbound for the concept pass to decide: guessing here would fragment the ontology.
 */
import { lexicalTerms, MemoryValidationError } from "@arnilo/prism-memory-core";

/** Two matched tokens of one name, or one whole multi-token name. Tuning (`ontology.bindThreshold`). */
export const DEFAULT_BIND_THRESHOLD = 2;
export const MAX_BIND_THRESHOLD = 8;
/** Text beyond this is not read: a verbatim exchange can be large and its opening names its subject. */
const MAX_BIND_TEXT_CHARS = 16_000;

/** What a subject answers to: its slug, title and aliases. */
export interface SubjectNames {
  readonly subject: string;
  readonly title: string;
  readonly aliases: readonly string[];
}

export interface SubjectMatcher {
  readonly size: number;
  /** The one subject the note binds to; `undefined` when none qualifies or several do. */
  match(text: string, keys?: readonly string[]): string | undefined;
}

interface NameEntry {
  readonly subject: string;
  readonly tokens: number;
}

export function resolveBindThreshold(value: number | undefined): number {
  const threshold = value ?? DEFAULT_BIND_THRESHOLD;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > MAX_BIND_THRESHOLD) {
    throw new MemoryValidationError(`ontology.bindThreshold must be an integer in [1,${MAX_BIND_THRESHOLD}]`);
  }
  return threshold;
}

export function createSubjectMatcher(subjects: readonly SubjectNames[], threshold: number = DEFAULT_BIND_THRESHOLD): SubjectMatcher {
  const names: NameEntry[] = [];
  const postings = new Map<string, number[]>();
  for (const entry of subjects) {
    // The slug is a name too: `deploy-pipeline` answers to "deploy pipeline".
    for (const name of [entry.subject.replace(/[.-]+/g, " "), entry.title, ...entry.aliases]) {
      const tokens = lexicalTerms(name);
      if (tokens.size === 0) continue;
      const index = names.length;
      names.push({ subject: entry.subject, tokens: tokens.size });
      for (const token of tokens) {
        const list = postings.get(token);
        if (list === undefined) postings.set(token, [index]);
        else list.push(index);
      }
    }
  }
  return {
    size: subjects.length,
    match(text, keys = []) {
      if (names.length === 0) return undefined;
      const terms = lexicalTerms(`${text.slice(0, MAX_BIND_TEXT_CHARS)}\n${keys.join("\n")}`);
      const hits = new Map<number, number>();
      for (const term of terms) {
        for (const index of postings.get(term) ?? []) hits.set(index, (hits.get(index) ?? 0) + 1);
      }
      let found: string | undefined;
      for (const [index, count] of hits) {
        const name = names[index]!;
        if (count < threshold && !(name.tokens >= 2 && count === name.tokens)) continue;
        if (found !== undefined && found !== name.subject) return undefined;
        found = name.subject;
      }
      return found;
    },
  };
}
