/**
 * The curator's edit vocabulary, in one place: the `edit_concept` tool definition and the parser read the same
 * tables, so a field the model may send is a field the parser accepts and nothing else (plan 207 Task 6).
 *
 * Fail closed. A malformed answer, an id that was not shown, an uncited claim or a cap breach rejects the whole
 * answer. Only a shape failure may be repaired, once. The schema carries no per-call value (ids, subject names,
 * the claim cap), so the tool segment of the request is byte-identical across calls and the provider can cache it.
 */
import type { JsonObject } from "@arnilo/prism";
import { MAX_CLAIM_CHARS } from "../ontology/codec.js";
import type { ConceptEdit } from "../ontology/port.js";
import { CONCEPT_RELATIONS, type ConceptRelation, type ConceptType } from "../ontology/types.js";

export const EDIT_TOOL_NAME = "edit_concept";

export const EDIT_OPS = [
  "create_subject",
  "bind",
  "add_claim",
  "update_claim",
  "retire_claim",
  "merge_claims",
  "add_relation",
  "add_open_question",
  "note_contradiction",
] as const;
export type EditOp = (typeof EDIT_OPS)[number];

const CONCEPT_KINDS: readonly ConceptType[] = ["entity", "topic"];

/** At most this many edits in one answer; the port's own cap (64) stays above it. */
export const MAX_ANSWER_EDITS = 48;
/** Ids named by one edit (cites, merged claims, contradiction notes). */
export const MAX_EDIT_IDS = 16;
const MAX_REASON_CHARS = 200;
const MAX_TITLE_CHARS = 120;
const MAX_ALIASES = 16;
const MAX_ALIAS_CHARS = 64;
const SLUG = /^[a-z0-9.-]{1,64}$/;

/** Which fields each operation takes. The parser rejects anything else. */
const OP_FIELDS: Readonly<Record<EditOp, { readonly required: readonly string[]; readonly optional: readonly string[] }>> = {
  create_subject: { required: ["subject", "title", "conceptType"], optional: ["aliases"] },
  bind: { required: ["noteId", "subject"], optional: [] },
  add_claim: { required: ["text", "cites"], optional: [] },
  update_claim: { required: ["claimId", "text", "cites"], optional: [] },
  retire_claim: { required: ["claimId", "reason"], optional: [] },
  merge_claims: { required: ["claimIds", "text", "cites"], optional: [] },
  add_relation: { required: ["relation", "target"], optional: [] },
  add_open_question: { required: ["text", "cites"], optional: [] },
  note_contradiction: { required: ["text"], optional: ["claimIds", "noteIds"] },
};

const idList = (description: string): JsonObject => ({
  type: "array",
  description,
  items: { type: "string", minLength: 1, maxLength: 64 },
  maxItems: MAX_EDIT_IDS,
});

/** The tool's argument schema. A pure constant: nothing in it depends on the call. */
export const EDIT_CONCEPT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["edits"],
  properties: {
    edits: {
      type: "array",
      description: "Small edits, applied in order. An empty list is a valid answer when the evidence adds nothing.",
      maxItems: MAX_ANSWER_EDITS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op"],
        properties: {
          op: { type: "string", enum: [...EDIT_OPS] },
          subject: { type: "string", maxLength: 64, description: "create_subject: the new slug. bind: the subject the note joins." },
          title: { type: "string", maxLength: MAX_TITLE_CHARS },
          conceptType: { type: "string", enum: [...CONCEPT_KINDS] },
          aliases: { type: "array", items: { type: "string", minLength: 1, maxLength: MAX_ALIAS_CHARS }, maxItems: MAX_ALIASES },
          noteId: { type: "string", minLength: 1, maxLength: 64 },
          text: { type: "string", minLength: 1, maxLength: MAX_CLAIM_CHARS },
          cites: idList("Ids of the shown notes this text rests on."),
          claimId: { type: "string", minLength: 1, maxLength: 64 },
          claimIds: idList("Ids of shown claims."),
          noteIds: idList("Ids of shown notes."),
          reason: { type: "string", minLength: 1, maxLength: MAX_REASON_CHARS },
          relation: { type: "string", enum: [...CONCEPT_RELATIONS] },
          target: { type: "string", maxLength: 64, description: "The slug of another listed subject." },
        },
      },
    },
  },
};

/** Safe reason codes; never raw model text. */
export type AnswerReason =
  | "answer_shape"
  | "edits_shape"
  | "edit_shape"
  | "edit_op"
  | "edit_field"
  | "text_shape"
  | "slug_shape"
  | "tool_call_missing"
  | "tool_call_shape"
  | "output_truncated"
  | "id_not_shown"
  | "uncited"
  | "claim_read_only"
  | "merge_cites"
  | "over_cap"
  | "subject_used"
  | "subject_misplaced"
  | "model_call_failed";

/** Shape-only failures may be corrected once; provenance, safety, cap, abort and limit failures never are. */
const REPAIRABLE: ReadonlySet<AnswerReason> = new Set([
  "answer_shape",
  "edits_shape",
  "edit_shape",
  "edit_op",
  "edit_field",
  "text_shape",
  "slug_shape",
  "tool_call_missing",
  "tool_call_shape",
  "output_truncated",
]);

export class WikiAnswerError extends Error {
  readonly reasonCode: AnswerReason;
  readonly repairable: boolean;
  constructor(reasonCode: AnswerReason, message: string) {
    super(`concept answer rejected: ${message}`);
    this.name = "WikiAnswerError";
    this.reasonCode = reasonCode;
    this.repairable = REPAIRABLE.has(reasonCode);
  }
}

const fail = (reasonCode: AnswerReason, message: string): never => {
  throw new WikiAnswerError(reasonCode, message);
};

/** What the parser may accept for one call: only ids that were shown in that call's input. */
export interface AnswerContext {
  /** `subject`: edits one existing concept. `cluster`: proposes a new subject or declines. */
  readonly mode: "subject" | "cluster";
  /** The subject being edited; absent for a cluster. */
  readonly subject?: string;
  /** Shown claim ids, with their citations and whether a person wrote them. */
  readonly claims: ReadonlyMap<string, { readonly cites: readonly string[]; readonly readOnly: boolean }>;
  /** Shown note ids: the evidence list plus every citation of a shown claim. */
  readonly notes: ReadonlySet<string>;
  /** Shown subject slugs (the scope's index). */
  readonly subjects: ReadonlySet<string>;
  /** Claims the concept holds before the edit. */
  readonly claimCount: number;
  readonly maxClaims: number;
}

/** An edit that can carry model-written text, for the trust scan. */
export interface ParsedEdit {
  readonly op: EditOp;
  readonly edit: ConceptEdit | { readonly op: "bind"; readonly noteId: string; readonly subject: string };
  /** Every string the edit would store. */
  readonly texts: readonly string[];
}

export interface ParsedAnswer {
  /** The subject the edits write to: the shown one, or the one a cluster creates. */
  readonly subject?: string;
  readonly edits: readonly ParsedEdit[];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    return fail("text_shape", `${label} is a non-empty string of at most ${max} characters`);
  }
  if (/[\r\n]/.test(value)) return fail("text_shape", `${label} is one line`);
  return value.trim();
}

function ids(value: unknown, label: string, shown: ReadonlySet<string>, min: number): readonly string[] {
  // An empty citation list is not a shape slip: the claim rests on nothing, and no repair call invents evidence.
  if (Array.isArray(value) && value.length === 0 && min > 0) return fail("uncited", `${label} cites at least one shown note`);
  if (!Array.isArray(value) || value.length < min || value.length > MAX_EDIT_IDS) {
    return fail("edit_shape", `${label} is a list of ${min === 0 ? "up to" : `${min} to`} ${MAX_EDIT_IDS} ids`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) return fail("edit_shape", `${label} holds ids`);
    if (!shown.has(item)) return fail("id_not_shown", `${label} names an id that was not shown`);
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function slug(value: unknown, label: string): string {
  if (typeof value !== "string" || !SLUG.test(value))
    return fail("slug_shape", `${label} is a slug of lowercase letters, digits, dots and hyphens (at most 64)`);
  return value;
}

/**
 * Parse the model's arguments for one call. Throws {@link WikiAnswerError} for the whole answer; nothing is
 * partially accepted. Trust and secret screening of the texts is the caller's, so it can drop one edit.
 */
export function parseAnswer(raw: unknown, context: AnswerContext): ParsedAnswer {
  const body = record(raw);
  if (body === undefined) return fail("answer_shape", "the arguments are an object");
  for (const key of Object.keys(body)) if (key !== "edits") return fail("answer_shape", "the arguments hold only edits");
  const list = body.edits;
  if (!Array.isArray(list) || list.length > MAX_ANSWER_EDITS) return fail("edits_shape", `edits is a list of at most ${MAX_ANSWER_EDITS}`);

  let subject = context.mode === "subject" ? context.subject : undefined;
  let claimCount = context.claimCount;
  const claims = new Map(context.claims);
  const retired = new Set<string>();
  const parsed: ParsedEdit[] = [];
  const created = new Set<string>();

  const liveClaim = (
    value: unknown,
    label: string,
  ): { readonly id: string; readonly cites: readonly string[]; readonly readOnly: boolean } => {
    if (typeof value !== "string" || value.length === 0) return fail("edit_shape", `${label} is a claim id`);
    const found = claims.get(value);
    if (found === undefined) return fail("id_not_shown", `${label} names a claim that was not shown`);
    if (retired.has(value)) return fail("id_not_shown", `${label} names a claim already retired by this answer`);
    return { id: value, ...found };
  };
  const requireSubject = (): string => {
    if (subject === undefined) return fail("subject_misplaced", "a cluster answer begins with create_subject");
    return subject;
  };

  for (const item of list) {
    const edit = record(item);
    if (edit === undefined) return fail("edit_shape", "an edit is an object");
    const op = edit.op;
    if (typeof op !== "string" || !(EDIT_OPS as readonly string[]).includes(op))
      return fail("edit_op", "op is one of the listed operations");
    const spec = OP_FIELDS[op as EditOp];
    for (const key of Object.keys(edit)) {
      if (key !== "op" && !spec.required.includes(key) && !spec.optional.includes(key))
        return fail("edit_field", `${op} does not take ${key}`);
    }
    for (const key of spec.required) if (edit[key] === undefined) return fail("edit_field", `${op} needs ${key}`);

    // Grow and refine: at the cap only merging and retiring are accepted.
    if (claimCount >= context.maxClaims && op !== "merge_claims" && op !== "retire_claim") {
      return fail(
        "over_cap",
        `the concept holds ${claimCount} claims (the cap is ${context.maxClaims}); only merge_claims and retire_claim are accepted`,
      );
    }

    switch (op as EditOp) {
      case "create_subject": {
        if (context.mode !== "cluster" || subject !== undefined)
          return fail("subject_misplaced", "create_subject opens a cluster answer, once");
        const slugValue = slug(edit.subject, "subject");
        if (context.subjects.has(slugValue)) return fail("subject_used", "the subject is already in the list");
        const title = text(edit.title, "title", MAX_TITLE_CHARS);
        const conceptType = edit.conceptType;
        if (!CONCEPT_KINDS.includes(conceptType as ConceptType)) return fail("edit_shape", "conceptType is entity or topic");
        const aliases: string[] = [];
        if (edit.aliases !== undefined) {
          if (!Array.isArray(edit.aliases) || edit.aliases.length > MAX_ALIASES)
            return fail("edit_shape", `aliases is a list of at most ${MAX_ALIASES}`);
          for (const alias of edit.aliases) {
            const clean = text(alias, "an alias", MAX_ALIAS_CHARS);
            if (!aliases.includes(clean)) aliases.push(clean);
          }
        }
        subject = slugValue;
        created.add(slugValue);
        parsed.push({
          op: "create_subject",
          edit: { op: "create_subject", subject: slugValue, title, conceptType: conceptType as ConceptType, aliases },
          texts: [title, ...aliases],
        });
        break;
      }
      case "bind": {
        const target = slug(edit.subject, "subject");
        if (typeof edit.noteId !== "string" || !context.notes.has(edit.noteId))
          return fail("id_not_shown", "bind names a note that was not shown");
        if (target !== subject && !context.subjects.has(target) && !created.has(target)) {
          return fail("id_not_shown", "bind names a subject that was not shown");
        }
        parsed.push({ op: "bind", edit: { op: "bind", noteId: edit.noteId, subject: target }, texts: [] });
        break;
      }
      case "add_claim": {
        const on = requireSubject();
        const claimText = text(edit.text, "text", MAX_CLAIM_CHARS);
        const cites = ids(edit.cites, "cites", context.notes, 1);
        parsed.push({ op: "add_claim", edit: { op: "add_claim", subject: on, text: claimText, cites }, texts: [claimText] });
        claimCount += 1;
        break;
      }
      case "update_claim": {
        const on = requireSubject();
        const target = liveClaim(edit.claimId, "claimId");
        if (target.readOnly) return fail("claim_read_only", "a claim a person wrote is read-only");
        const claimText = text(edit.text, "text", MAX_CLAIM_CHARS);
        const cites = ids(edit.cites, "cites", context.notes, 1);
        parsed.push({
          op: "update_claim",
          edit: { op: "update_claim", subject: on, claimId: target.id, text: claimText, cites },
          texts: [claimText],
        });
        claims.set(target.id, { cites, readOnly: false });
        break;
      }
      case "retire_claim": {
        const on = requireSubject();
        const target = liveClaim(edit.claimId, "claimId");
        if (target.readOnly) return fail("claim_read_only", "a claim a person wrote is read-only");
        const reason = text(edit.reason, "reason", MAX_REASON_CHARS);
        parsed.push({ op: "retire_claim", edit: { op: "retire_claim", subject: on, claimId: target.id, reason }, texts: [reason] });
        retired.add(target.id);
        claimCount -= 1;
        break;
      }
      case "merge_claims": {
        const on = requireSubject();
        if (!Array.isArray(edit.claimIds) || edit.claimIds.length < 2 || edit.claimIds.length > MAX_EDIT_IDS) {
          return fail("edit_shape", `claimIds is a list of 2 to ${MAX_EDIT_IDS} claims`);
        }
        const merged = [...new Set(edit.claimIds as readonly unknown[])].map((id) => liveClaim(id, "claimIds"));
        if (merged.length < 2) return fail("edit_shape", "merge_claims names two distinct claims");
        if (merged.some((claim) => claim.readOnly)) return fail("claim_read_only", "a claim a person wrote is read-only");
        const claimText = text(edit.text, "text", MAX_CLAIM_CHARS);
        const cites = ids(edit.cites, "cites", context.notes, 1);
        const union = new Set(merged.flatMap((claim) => claim.cites));
        if (cites.length !== union.size || cites.some((cite) => !union.has(cite))) {
          return fail("merge_cites", "merge_claims cites exactly the union of the merged claims' citations");
        }
        parsed.push({
          op: "merge_claims",
          edit: { op: "merge_claims", subject: on, claimIds: merged.map((claim) => claim.id), text: claimText, cites },
          texts: [claimText],
        });
        for (const claim of merged) retired.add(claim.id);
        claimCount -= merged.length - 1;
        break;
      }
      case "add_relation": {
        const on = requireSubject();
        if (!(CONCEPT_RELATIONS as readonly unknown[]).includes(edit.relation))
          return fail("edit_shape", `relation is one of ${CONCEPT_RELATIONS.join(", ")}`);
        const target = slug(edit.target, "target");
        if (target === on) return fail("edit_shape", "a relation targets another subject");
        if (!context.subjects.has(target)) return fail("id_not_shown", "a relation targets a listed subject");
        parsed.push({
          op: "add_relation",
          edit: { op: "add_relation", subject: on, relation: edit.relation as ConceptRelation, target },
          texts: [],
        });
        break;
      }
      case "add_open_question": {
        const on = requireSubject();
        const questionText = text(edit.text, "text", MAX_CLAIM_CHARS);
        const cites = ids(edit.cites, "cites", context.notes, 1);
        parsed.push({
          op: "add_open_question",
          edit: { op: "add_open_question", subject: on, text: questionText, cites },
          texts: [questionText],
        });
        break;
      }
      case "note_contradiction": {
        const on = requireSubject();
        const claimIds = edit.claimIds === undefined ? [] : ids(edit.claimIds, "claimIds", new Set(claims.keys()), 1);
        const noteIds = edit.noteIds === undefined ? [] : ids(edit.noteIds, "noteIds", context.notes, 1);
        if (claimIds.length + noteIds.length === 0) return fail("uncited", "a contradiction names claimIds or noteIds");
        const contradictionText = text(edit.text, "text", MAX_CLAIM_CHARS);
        parsed.push({
          op: "note_contradiction",
          edit: {
            op: "note_contradiction",
            subject: on,
            text: contradictionText,
            ...(claimIds.length === 0 ? {} : { claimIds }),
            ...(noteIds.length === 0 ? {} : { noteIds }),
          },
          texts: [contradictionText],
        });
        break;
      }
    }
  }

  if (context.mode === "cluster" && parsed.length > 0 && !parsed.some((entry) => entry.op === "add_claim")) {
    return fail("uncited", "a new subject needs at least one cited claim");
  }
  return { ...(subject === undefined ? {} : { subject }), edits: parsed };
}
