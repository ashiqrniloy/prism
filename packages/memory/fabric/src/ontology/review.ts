/**
 * A person's edit to a concept file (plan 207 Task 7). The markdown store hands every externally changed note to this
 * reviewer before it is indexed. For a concept it:
 *
 * - rejects a body that breaks the codec, keeping the last valid version indexed and the file as written, and names
 *   the rejection (`invalid-concept`) in `log.md`;
 * - marks every item whose text or citations changed, or that is new, `[c1 human]`, so the curator never rewrites it;
 * - re-derives `title` and `sources` from the body, and clears the stale mark of an item the person changed;
 * - runs the trust scan: a hit quarantines the concept as a `candidate` with `flags`, a clean edit lifts the flag;
 * - stamps `generated: { by: human }`.
 *
 * It never calls a model and reads nothing but the two records. A note that is not a concept is left alone.
 */
import type { JsonObject } from "@arnilo/prism";
import type { MemoryVectorRecord } from "@arnilo/prism-memory-core";
import { scanScopedMemoryContent } from "../scoped/trust.js";
import {
  type ConceptDirtyReason,
  encodeMemoryNoteMetadata,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryNoteMetadata,
  parseMemoryNoteMetadata,
  stampProvenance,
} from "../types.js";
import { type ConceptDoc, type ConceptItem, conceptSources, parseConceptBody, renderConceptBody } from "./codec.js";

export type ConceptEditReview =
  | { readonly record: MemoryVectorRecord; readonly reject?: undefined }
  | { readonly reject: { readonly verb: string; readonly note: string }; readonly record?: undefined };

export const INVALID_CONCEPT_VERB = "invalid-concept";

const sameCites = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((cite, index) => cite === b[index]);

type Section = "claims" | "questions" | "contradictions";
const SECTIONS: readonly Section[] = ["claims", "questions", "contradictions"];

function tryParse(text: string): ConceptDoc | undefined {
  try {
    return parseConceptBody(text, { allowUncited: true });
  } catch {
    return undefined;
  }
}

/** Mark what a person changed. With nothing to compare against, the file is taken as written. */
function markChanges(doc: ConceptDoc, before: ConceptDoc | undefined): { readonly doc: ConceptDoc; readonly changed: ReadonlySet<string> } {
  const changed = new Set<string>();
  if (before === undefined) return { doc, changed };
  const next: Record<Section, readonly ConceptItem[]> = { claims: [], questions: [], contradictions: [] };
  for (const section of SECTIONS) {
    const prior = new Map(before[section].map((item) => [item.id, item]));
    next[section] = doc[section].map((item) => {
      const old = prior.get(item.id);
      if (old !== undefined && old.text === item.text && sameCites(old.cites, item.cites)) {
        // A marker a person wrote or the store set is never lost by re-saving the file.
        return old.human === true && item.human !== true ? { ...item, human: true as const } : item;
      }
      changed.add(item.id);
      return { ...item, human: true as const };
    });
  }
  return { doc: { title: doc.title, ...next }, changed };
}

/** Key-order-independent JSON, so two encodings of one note compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function reviewConceptEdit(
  record: MemoryVectorRecord,
  previous: MemoryVectorRecord | undefined,
  now: () => Date = () => new Date(),
): ConceptEditReview | undefined {
  const note = parseMemoryNoteMetadata(record.metadata);
  if (note === undefined || note.kind !== "concept") return undefined;
  let doc: ConceptDoc;
  try {
    doc = parseConceptBody(record.text, { allowUncited: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the body is not a concept";
    return { reject: { verb: INVALID_CONCEPT_VERB, note: reason.slice(0, 200) } };
  }
  const bodyChanged = previous !== undefined && previous.text !== record.text;
  const marked = markChanges(doc, bodyChanged ? tryParse(previous.text) : undefined);
  const scan = scanScopedMemoryContent([note.title ?? "", ...(note.aliases ?? []), record.text].join("\n"));
  const at = now().toISOString();

  const kept = new Set(SECTIONS.flatMap((section) => marked.doc[section].map((item) => item.id)));
  const stale = (note.stale ?? []).filter((id) => kept.has(id) && !marked.changed.has(id));
  const dirty: ConceptDirtyReason[] = (note.dirty ?? []).filter((reason) => reason !== "stale" && reason !== "edited");
  if (stale.length > 0) dirty.push("stale");
  if (bodyChanged) dirty.push("edited");
  const { stale: _stale, dirty: _dirty, flags: _flags, ...rest } = note;
  const fabric: MemoryNoteMetadata = {
    ...rest,
    title: marked.doc.title,
    sources: conceptSources(marked.doc),
    ...(stale.length === 0 ? {} : { stale }),
    ...(dirty.length === 0 ? {} : { dirty }),
    ...(scan.ok ? {} : { flags: [scan.class] }),
  };
  const { status: priorStatus, generated: priorGenerated, ...host } = (record.metadata ?? {}) as JsonObject;
  const wasFlagged = (note.flags?.length ?? 0) > 0;
  const status = scan.ok ? (wasFlagged ? undefined : priorStatus) : "candidate";
  const human = bodyChanged || !scan.ok;
  const metadata: JsonObject = {
    ...host,
    [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata(fabric),
    ...(status === undefined ? {} : { status }),
    ...(human
      ? { generated: stampProvenance("human", at) as unknown as JsonObject }
      : priorGenerated === undefined
        ? {}
        : { generated: priorGenerated }),
  };
  const anyMarked = SECTIONS.some((section) => marked.doc[section].some((item, index) => item.human !== doc[section][index]?.human));
  const text = anyMarked ? renderConceptBody(marked.doc) : record.text;
  // Nothing a reviewer owns changed: the file is indexed as the store parsed it, and is not rewritten.
  if (
    !human &&
    text === record.text &&
    status === priorStatus &&
    stable(encodeMemoryNoteMetadata(fabric)) === stable(encodeMemoryNoteMetadata(note))
  ) {
    return undefined;
  }
  return { record: { ...record, text, metadata } };
}
