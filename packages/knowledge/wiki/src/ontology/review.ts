/**
 * A person's edit to a concept file (plan 207 Task 7, moved into the wiki's own store by plan 216 Task 3). The
 * markdown store hands every concept file whose bytes differ from what the wiki last wrote to this reviewer. It:
 *
 * - rejects a body that breaks the codec, keeping the last valid version in use and the file as written, and names
 *   the rejection (`invalid-concept`) in `log.md`;
 * - marks every item whose text or citations changed, or that is new, `[c1 human]`, so the curator never rewrites it;
 * - re-derives the title from the body, and clears the stale mark of an item the person changed;
 * - runs the trust scan: a hit quarantines the concept as a `candidate` with `flags`, a clean edit lifts the flag;
 * - stamps `generated: { by: human }`.
 *
 * It never calls a model and reads nothing but the file and the last body the wiki wrote.
 */
import { scanScopedMemoryContent } from "@arnilo/prism-memory-system/core";
import type { WikiConceptRecord } from "../store.js";
import { type ConceptDoc, type ConceptItem, parseConceptBody, renderConceptBody } from "./codec.js";
import type { ConceptDirtyReason } from "./types.js";

export type ConceptFileReview =
  | { readonly record: WikiConceptRecord; readonly flagged?: string; readonly reject?: undefined }
  | { readonly reject: { readonly verb: string; readonly note: string }; readonly record?: undefined; readonly flagged?: undefined };

export const INVALID_CONCEPT_VERB = "invalid-concept";

const sameCites = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((cite, index) => cite === b[index]);

type Section = "claims" | "questions" | "contradictions";
const SECTIONS: readonly Section[] = ["claims", "questions", "contradictions"];

function tryParse(text: string | undefined): ConceptDoc | undefined {
  if (text === undefined) return undefined;
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

export function reviewConceptFile(
  record: WikiConceptRecord,
  previousBody: string | undefined,
  now: () => Date = () => new Date(),
): ConceptFileReview {
  let doc: ConceptDoc;
  try {
    doc = parseConceptBody(record.body, { allowUncited: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the body is not a concept";
    return { reject: { verb: INVALID_CONCEPT_VERB, note: reason.slice(0, 200) } };
  }
  const bodyChanged = previousBody !== undefined && previousBody !== record.body;
  const marked = markChanges(doc, bodyChanged ? tryParse(previousBody) : undefined);
  const scan = scanScopedMemoryContent([record.title, ...record.aliases, record.body].join("\n"));
  const kept = new Set(SECTIONS.flatMap((section) => marked.doc[section].map((item) => item.id)));
  const stale = record.stale.filter((id) => kept.has(id) && !marked.changed.has(id));
  const dirty: ConceptDirtyReason[] = record.dirty.filter((reason) => reason !== "stale" && reason !== "edited");
  if (stale.length > 0) dirty.push("stale");
  if (bodyChanged) dirty.push("edited");
  const wasFlagged = record.flags.length > 0;
  const status = scan.ok ? (wasFlagged && record.status === "candidate" ? "verified" : record.status) : "candidate";
  const human = bodyChanged || !scan.ok;
  const anyMarked = SECTIONS.some((section) => marked.doc[section].some((item, index) => item.human !== doc[section][index]?.human));
  return {
    record: {
      ...record,
      title: marked.doc.title,
      body: anyMarked ? renderConceptBody(marked.doc) : record.body,
      stale,
      dirty,
      status,
      flags: scan.ok ? [] : [scan.class],
      generated: human ? { by: "human", at: now().toISOString() } : record.generated,
    },
    ...(scan.ok ? {} : { flagged: scan.class }),
  };
}
