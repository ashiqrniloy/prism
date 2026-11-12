/**
 * Host-assembled evidence for the completion validator. The validator reads only what the host hands it here
 * (a diff, a check log); every block is size-capped and a cut is labelled in the prompt, so the model always
 * knows when it is judging a partial view.
 */

/** One block of evidence. `truncated: true` says the host already cut it; the prompt labels it either way. */
export interface ValidationEvidence {
  readonly label: string;
  readonly text: string;
  readonly truncated?: boolean;
}

/** Evidence blocks one validation reads. More is an `invalid_input` error, never a silent drop. */
export const MAX_EVIDENCE_BLOCKS = 16;
/** Character budget for all evidence text together. */
export const DEFAULT_EVIDENCE_MAX_CHARS = 48_000;
export const HARD_EVIDENCE_MAX_CHARS = 120_000;
/** Cap on the task and on the criteria text, each. */
export const MAX_TASK_CHARS = 16_000;
const MAX_LABEL_CHARS = 64;

export const clampEvidenceMaxChars = (value: number | undefined): number =>
  Math.max(1, Math.min(Math.floor(value ?? DEFAULT_EVIDENCE_MAX_CHARS), HARD_EVIDENCE_MAX_CHARS));

/** Throws a `TypeError` on a malformed list; callers turn it into `invalid_input`. */
export function checkEvidence(evidence: unknown): readonly ValidationEvidence[] {
  if (evidence === undefined) return [];
  if (!Array.isArray(evidence)) throw new TypeError("evidence must be an array");
  if (evidence.length > MAX_EVIDENCE_BLOCKS) throw new TypeError(`evidence has more than ${MAX_EVIDENCE_BLOCKS} blocks`);
  for (const block of evidence) {
    if (typeof block !== "object" || block === null) throw new TypeError("evidence blocks must be objects");
    const { label, text, truncated } = block as Record<string, unknown>;
    if (typeof label !== "string" || typeof text !== "string") throw new TypeError("evidence blocks need a string label and text");
    if (truncated !== undefined && typeof truncated !== "boolean") throw new TypeError("evidence truncated must be a boolean");
  }
  return evidence as readonly ValidationEvidence[];
}

/** A label is a heading: one line of plain characters, upper case, never empty. */
function cleanLabel(label: string, index: number): string {
  const cleaned = label
    .replace(/[^A-Za-z0-9 _./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL_CHARS)
    .toUpperCase();
  return cleaned.length === 0 ? `EVIDENCE ${index + 1}` : cleaned;
}

/** Max-min fair split of the budget: a short block keeps all of its text and leaves the rest to the others. */
function allocate(lengths: readonly number[], budget: number): number[] {
  const order = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
  const out = new Array<number>(lengths.length).fill(0);
  let remaining = budget;
  order.forEach(({ length, index }, position) => {
    const share = Math.floor(remaining / (order.length - position));
    const take = Math.min(length, share);
    out[index] = take;
    remaining -= take;
  });
  return out;
}

/** Text cut at `max` with a marker saying how much was shown. */
export function capText(text: string, max: number, what: string): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated: ${what} cut to the first ${max} of ${text.length} chars]`;
}

/** Evidence as prompt sections. Each block sits between BEGIN/END lines so its text cannot pose as a heading. */
export function renderEvidence(evidence: readonly ValidationEvidence[], maxChars: number): readonly string[] {
  const budgets = allocate(
    evidence.map((block) => block.text.length),
    maxChars,
  );
  return evidence.map((block, index) => {
    const label = cleanLabel(block.label, index);
    const budget = budgets[index] ?? 0;
    const cut = block.text.length > budget;
    const notes = [
      ...(block.truncated === true ? ["[truncated: the host cut this evidence before validation]"] : []),
      ...(cut ? [`[truncated: shown the first ${budget} of ${block.text.length} chars]`] : []),
    ];
    const body = block.text.slice(0, budget) || "(empty)";
    return [`EVIDENCE: ${label}`, ...notes, `----- BEGIN ${label} -----`, body, `----- END ${label} -----`].join("\n");
  });
}
