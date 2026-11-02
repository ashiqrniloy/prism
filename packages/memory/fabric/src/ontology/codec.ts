/**
 * The concept body codec (plan 207 Task 2): itemized claims, each with a stable id and one or more OKF §5.1
 * footnote references naming the T1 notes it rests on.
 *
 * ```markdown
 * # Payments service
 *
 * - [c1] Retries use exponential backoff capped at 3 attempts.[^3f1c9e2a4b70]
 *
 * ## Open questions
 * - [q1] Whether refunds share the retry budget.[^3f1c9e2a4b70]
 *
 * ## Contradictions
 * - [x1] The README says 5 attempts.[^3f1c9e2a4b70][^9c1e2a4b7d10]
 * ```
 *
 * A body is one line per item, never rewritten wholesale: the port edits an item and renders the rest unchanged.
 */
import { ConceptFormatError } from "./errors.js";

export const MAX_CLAIM_CHARS = 280;
/** Hard ceiling on items of one kind in one concept; the wiki's `maxClaimsPerConcept` is a tuning value below it. */
export const MAX_CONCEPT_ITEMS = 200;
/** Hard ceiling on citations of one item. */
export const MAX_ITEM_CITES = 16;

export type ConceptItemKind = "claim" | "question" | "contradiction";

export interface ConceptItem {
  /** `c<n>`, `q<n>` or `x<n>`; stable for the life of the item. */
  readonly id: string;
  readonly text: string;
  /** Cited note ids, in first-use order, no duplicates. */
  readonly cites: readonly string[];
}

export interface ConceptDoc {
  readonly title: string;
  readonly claims: readonly ConceptItem[];
  readonly questions: readonly ConceptItem[];
  readonly contradictions: readonly ConceptItem[];
}

const NOTE_ID = /^[0-9a-f]{12}$/;
const CITE = /\[\^([0-9a-f]{12})\]/g;
const ITEM_LINE = /^- \[([cqx][1-9][0-9]{0,5})\] (.*)$/;
const SECTION = { "## Open questions": "question", "## Contradictions": "contradiction" } as const;
const ID_PREFIX: Record<ConceptItemKind, string> = { claim: "c", question: "q", contradiction: "x" };

export function isNoteId(value: unknown): value is string {
  return typeof value === "string" && NOTE_ID.test(value);
}

export function itemKindOf(id: string): ConceptItemKind {
  return id.startsWith("q") ? "question" : id.startsWith("x") ? "contradiction" : "claim";
}

/** The next free id of a kind (`c1`, `c2`, …): ids are never reused within a body's current items. */
export function nextItemId(doc: ConceptDoc, kind: ConceptItemKind): string {
  const items = kind === "claim" ? doc.claims : kind === "question" ? doc.questions : doc.contradictions;
  let highest = 0;
  for (const item of items) highest = Math.max(highest, Number(item.id.slice(1)));
  return `${ID_PREFIX[kind]}${highest + 1}`;
}

/** Claim text rules shared by the parser and every edit: one line, no footnote syntax, bounded length. */
export function validateItemText(text: unknown): string {
  if (typeof text !== "string" || text.trim().length === 0) throw new ConceptFormatError("claim_empty", "a claim needs text");
  const trimmed = text.trim();
  if (trimmed.length > MAX_CLAIM_CHARS) throw new ConceptFormatError("claim_too_long", `a claim is at most ${MAX_CLAIM_CHARS} characters`);
  if (/[\r\n]/.test(trimmed)) throw new ConceptFormatError("claim_multiline", "a claim is one line");
  if (trimmed.includes("[^")) throw new ConceptFormatError("claim_footnote_syntax", "claim text must not contain footnote syntax");
  return trimmed;
}

export function validateCites(cites: unknown, label = "cites"): readonly string[] {
  if (!Array.isArray(cites)) throw new ConceptFormatError("cites_shape", `${label} must be an array of note ids`);
  const seen: string[] = [];
  for (const cite of cites) {
    if (!isNoteId(cite)) throw new ConceptFormatError("cites_shape", `${label} must hold 12-character note ids`);
    if (!seen.includes(cite)) seen.push(cite);
  }
  if (seen.length > MAX_ITEM_CITES) throw new ConceptFormatError("cites_too_many", `an item cites at most ${MAX_ITEM_CITES} notes`);
  return seen;
}

export interface ParseConceptOptions {
  /** A person may write a claim with no citation; a curator may not. */
  readonly allowUncited?: boolean;
}

/** Parse a concept body. Anything outside the grammar is rejected: a body is data, not free text. */
export function parseConceptBody(text: string, options: ParseConceptOptions = {}): ConceptDoc {
  const lines = text.split(/\r?\n/);
  let title: string | undefined;
  let section: ConceptItemKind = "claim";
  const claims: ConceptItem[] = [];
  const questions: ConceptItem[] = [];
  const contradictions: ConceptItem[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    if (line.startsWith("# ")) {
      if (title !== undefined) throw new ConceptFormatError("body_shape", "a concept has one title heading");
      title = line.slice(2).trim();
      continue;
    }
    if (line in SECTION) {
      section = SECTION[line as keyof typeof SECTION];
      continue;
    }
    const match = ITEM_LINE.exec(line);
    if (match === null) throw new ConceptFormatError("body_shape", `line ${index + 1} is not a claim item, a known section or the title`);
    const id = match[1]!;
    if (itemKindOf(id) !== section) throw new ConceptFormatError("body_shape", `item ${id} is in the wrong section`);
    if (seen.has(id)) throw new ConceptFormatError("body_shape", `item id ${id} appears twice`);
    seen.add(id);
    const cites: string[] = [];
    const body = match[2]!.replace(CITE, (_all, cite: string) => {
      if (!cites.includes(cite)) cites.push(cite);
      return "";
    });
    const itemText = validateItemText(body);
    if (cites.length === 0 && options.allowUncited !== true) {
      throw new ConceptFormatError("uncited_claim", `item ${id} cites no note; only a person may write an uncited claim`);
    }
    if (cites.length > MAX_ITEM_CITES) throw new ConceptFormatError("cites_too_many", `item ${id} cites too many notes`);
    const item: ConceptItem = { id, text: itemText, cites };
    (section === "claim" ? claims : section === "question" ? questions : contradictions).push(item);
    if (claims.length > MAX_CONCEPT_ITEMS || questions.length > MAX_CONCEPT_ITEMS || contradictions.length > MAX_CONCEPT_ITEMS) {
      throw new ConceptFormatError("too_many_items", `a concept holds at most ${MAX_CONCEPT_ITEMS} items of one kind`);
    }
  }
  if (title === undefined || title.length === 0)
    throw new ConceptFormatError("body_shape", "a concept body starts with a `# Title` heading");
  return { title, claims, questions, contradictions };
}

function renderItem(item: ConceptItem): string {
  return `- [${item.id}] ${item.text}${item.cites.map((cite) => `[^${cite}]`).join("")}`;
}

/** Deterministic render: `parseConceptBody(renderConceptBody(doc))` equals `doc`. */
export function renderConceptBody(doc: ConceptDoc): string {
  const parts = [`# ${doc.title}`, ""];
  if (doc.claims.length > 0) parts.push(...doc.claims.map(renderItem), "");
  if (doc.questions.length > 0) parts.push("## Open questions", ...doc.questions.map(renderItem), "");
  if (doc.contradictions.length > 0) parts.push("## Contradictions", ...doc.contradictions.map(renderItem), "");
  return `${parts.join("\n").trimEnd()}\n`;
}

/** Every distinct note id a concept cites, in first-use order. */
export function conceptSources(doc: ConceptDoc): readonly string[] {
  const out: string[] = [];
  for (const item of [...doc.claims, ...doc.questions, ...doc.contradictions]) {
    for (const cite of item.cites) if (!out.includes(cite)) out.push(cite);
  }
  return out;
}

/** The label an uncited (person-written) item carries wherever it is rendered. */
export const UNCITED_LABEL = "(uncited, human)";
export const STALE_LABEL = "(stale)";

export function describeItem(item: ConceptItem, options: { readonly stale?: boolean } = {}): string {
  return `${item.text}${item.cites.length === 0 ? ` ${UNCITED_LABEL}` : ""}${options.stale === true ? ` ${STALE_LABEL}` : ""}`;
}
