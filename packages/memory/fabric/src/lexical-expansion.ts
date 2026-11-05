/**
 * Query expansion for the lexical recall (plan 210 Task 3.1, `recall.expansion`). Recall here is lexical by design (no
 * embeddings), so a question that says "girlfriend" misses a note that says "gf". This is a small, deterministic table
 * of informal and formal forms of the same word, English only, applied to the query before it reaches the store: no
 * model call, no embeddings, and a query with no table term is returned unchanged. The original query is kept whole and
 * the missing alternates are appended, so a note that matches either form is reached.
 */
import { stemLexical } from "@arnilo/prism-memory-core";

/** Each row is one meaning; every member stands for every other. Add a row only for a pair a user plausibly swaps. */
const SYNONYM_SETS: readonly (readonly string[])[] = [
  ["girlfriend", "gf"],
  ["boyfriend", "bf"],
  ["mother", "mom", "mum", "mama"],
  ["father", "dad", "papa"],
  ["brother", "bro"],
  ["sister", "sis"],
  ["husband", "hubby"],
  ["grandmother", "grandma", "granny"],
  ["grandfather", "grandpa", "granddad"],
  ["doctor", "doc"],
  ["university", "uni"],
  ["information", "info"],
  ["photograph", "photo", "pic", "picture"],
  ["congratulations", "congrats"],
  ["television", "tv"],
  ["medication", "meds"],
  ["vacation", "holiday"],
  ["apartment", "flat"],
  ["birthday", "bday"],
  ["application", "app"],
];

const byTerm = new Map<string, readonly string[]>();
for (const set of SYNONYM_SETS) for (const term of set) byTerm.set(stemLexical(term), set);

/** `text` plus the alternates of any table term it contains, each added once and only when not already in `text`. */
export function expandLexicalQuery(text: string): string {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const present = new Set(tokens.map(stemLexical));
  const added: string[] = [];
  for (const token of tokens) {
    const set = byTerm.get(stemLexical(token));
    if (set === undefined) continue;
    for (const alternate of set) {
      const stem = stemLexical(alternate);
      if (present.has(stem)) continue;
      present.add(stem);
      added.push(alternate);
    }
  }
  return added.length === 0 ? text : `${text} ${added.join(" ")}`;
}
