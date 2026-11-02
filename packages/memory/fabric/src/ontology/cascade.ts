/**
 * The deletion cascade (plan 207 Task 2). When a note is forgotten, deleted, revoked or held, every concept claim
 * that cites it is removed, together with that claim's other citations; when a note is superseded, archived,
 * downgraded, corrected or flagged, each citing claim is marked stale. It is deterministic, calls no model, never
 * deletes a T1 note, and runs in the fabric whether or not the wiki package is installed.
 */
import type { JsonObject } from "@arnilo/prism";
import { type Memory, type MemoryVectorRecord, type VectorStore } from "@arnilo/prism-memory-core";
import { noteMemoryRetraction, noteMemoryWrite } from "../directory.js";
import { type ConceptDirtyReason, encodeMemoryNoteMetadata, type MemoryNoteMetadata } from "../types.js";
import { type ConceptDoc, type ConceptItem, conceptSources, parseConceptBody, renderConceptBody } from "./codec.js";
import { type MemoryRetractEvent, retractionRemovesClaims } from "./retract.js";
import { type ConceptIndex, conceptMetadata, noteOf, rowFromMetadata } from "./state.js";

export interface ConceptCascadeReport {
  /** Concepts rewritten. */
  readonly concepts: number;
  /** Claims, questions and contradictions removed. */
  readonly removed: number;
  /** Items marked stale. */
  readonly stale: number;
  /** Concepts archived because no claim was left. */
  readonly archived: number;
}

export interface ConceptCascade {
  handle(event: MemoryRetractEvent, signal?: AbortSignal): Promise<ConceptCascadeReport>;
}

const EMPTY: ConceptCascadeReport = { concepts: 0, removed: 0, stale: 0, archived: 0 };

const allItems = (doc: ConceptDoc): readonly ConceptItem[] => [...doc.claims, ...doc.questions, ...doc.contradictions];

function without(items: readonly ConceptItem[], gone: ReadonlySet<string>): ConceptItem[] {
  return items.filter((item) => !item.cites.some((cite) => gone.has(cite)));
}

function addReason(reasons: readonly ConceptDirtyReason[] | undefined, reason: ConceptDirtyReason): readonly ConceptDirtyReason[] {
  return reasons?.includes(reason) === true ? reasons : [...(reasons ?? []), reason];
}

/** Last resort for a body a person broke: drop every line that cites a removed note. */
function scrub(text: string, gone: ReadonlySet<string>): string {
  const cites = (line: string): boolean => [...gone].some((id) => line.includes(`[^${id}]`));
  return text
    .split("\n")
    .filter((line) => !cites(line))
    .join("\n");
}

export function createConceptCascade(deps: {
  readonly memory: Memory;
  readonly store: VectorStore;
  readonly index: ConceptIndex;
  readonly now?: () => Date;
}): ConceptCascade {
  const now = deps.now ?? (() => new Date());

  async function rewrite(record: MemoryVectorRecord, text: string, fabric: MemoryNoteMetadata, status: string | undefined): Promise<void> {
    const generated = (record.metadata?.generated ?? {}) as JsonObject;
    const metadata = conceptMetadata(record.metadata, encodeMemoryNoteMetadata(fabric), { generated, status });
    // The old embedding is kept: the cascade only shrinks text, and it makes no embedding call.
    await deps.store.upsert([{ ...record, text, metadata }]);
    const row = rowFromMetadata(record.id, metadata);
    if (row !== undefined) deps.index.upsert(row);
  }

  async function handleOne(record: MemoryVectorRecord, gone: ReadonlySet<string>, remove: boolean): Promise<ConceptCascadeReport> {
    const meta = noteOf(record);
    if (meta === undefined || meta.kind !== "concept") return EMPTY;
    const status = typeof record.metadata?.status === "string" ? record.metadata.status : undefined;
    let doc: ConceptDoc;
    try {
      doc = parseConceptBody(record.text, { allowUncited: true });
    } catch {
      // A broken body cannot be edited item by item. Removal scrubs by line; staleness only flags the concept.
      if (!remove) {
        await rewrite(record, record.text, { ...meta, dirty: addReason(meta.dirty, "stale") }, status);
        return { concepts: 1, removed: 0, stale: 0, archived: 0 };
      }
      const text = scrub(record.text, gone);
      const sources = (meta.sources ?? []).filter((id) => !gone.has(id));
      const empty = text.trim().length === 0;
      await rewrite(
        record,
        empty ? `# ${meta.title ?? meta.subject}\n` : text,
        { ...meta, sources, dirty: addReason(meta.dirty, "removed") },
        status,
      );
      return { concepts: 1, removed: 1, stale: 0, archived: 0 };
    }

    if (remove) {
      const next: ConceptDoc = {
        title: doc.title,
        claims: without(doc.claims, gone),
        questions: without(doc.questions, gone),
        contradictions: without(doc.contradictions, gone),
      };
      const removed = allItems(doc).length - allItems(next).length;
      if (removed === 0) return EMPTY;
      const keptIds = new Set(allItems(next).map((item) => item.id));
      const stale = (meta.stale ?? []).filter((id) => keptIds.has(id));
      const archive = next.claims.length === 0;
      const fabric: MemoryNoteMetadata = {
        ...meta,
        title: doc.title,
        sources: conceptSources(next),
        dirty: addReason(meta.dirty, "removed"),
        ...(stale.length === 0 ? { stale: undefined } : { stale }),
        ...(archive
          ? { archivedAt: now().toISOString(), archivedFrom: status === "candidate" ? ("candidate" as const) : ("verified" as const) }
          : {}),
      };
      await rewrite(record, renderConceptBody(next), fabric, archive ? "archived" : status);
      return { concepts: 1, removed, stale: 0, archived: archive ? 1 : 0 };
    }

    const hit = allItems(doc)
      .filter((item) => item.cites.some((cite) => gone.has(cite)))
      .map((item) => item.id);
    const fresh = hit.filter((id) => !(meta.stale ?? []).includes(id));
    if (fresh.length === 0) return EMPTY;
    await rewrite(
      record,
      record.text,
      { ...meta, stale: [...(meta.stale ?? []), ...fresh], dirty: addReason(meta.dirty, "stale") },
      status,
    );
    return { concepts: 1, removed: 0, stale: fresh.length, archived: 0 };
  }

  return {
    async handle(event, signal) {
      if (event.reason === "import") deps.index.invalidate();
      // A retracted concept leaves the index; a retracted note finds its citing concepts.
      for (const id of event.ids) if ((await deps.index.byId(id, signal)) !== undefined) deps.index.drop(id);
      if (event.ids.length === 0) return EMPTY;
      const conceptIds = await deps.index.citing(event.ids, signal);
      if (conceptIds.length === 0) return EMPTY;
      const remove = retractionRemovesClaims(event.reason) || event.reason === "import";
      const gone = new Set(event.ids);
      const options = signal === undefined ? {} : { signal };
      const records =
        deps.store.getByIds !== undefined
          ? await deps.store.getByIds(deps.memory.scope as Required<typeof deps.memory.scope>, conceptIds, options)
          : await deps.memory.get(conceptIds, options);
      let report = EMPTY;
      for (const record of records) {
        const one = await handleOne(record, gone, remove);
        report = {
          concepts: report.concepts + one.concepts,
          removed: report.removed + one.removed,
          stale: report.stale + one.stale,
          archived: report.archived + one.archived,
        };
      }
      if (report.concepts > 0) {
        // Delivered concept text changed in a way that shows less: end pinned epochs, refresh the directory.
        noteMemoryRetraction(deps.memory);
        noteMemoryWrite(deps.memory);
      }
      return report;
    },
  };
}
