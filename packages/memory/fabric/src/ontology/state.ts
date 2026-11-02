/**
 * The concept index of one scope (plan 207 Task 2): every `concept` note's subject, aliases and cited note ids,
 * plus the reverse map `cited id → concept ids` the deletion cascade reads. Built lazily from one metadata scan,
 * then kept current by the port's own writes and the cascade, so a retraction costs a map lookup, not a scan.
 * An import, a restored backup or a person's file edit calls `invalidate()`; the next use rescans.
 */
import type { JsonObject } from "@arnilo/prism";
import type { Memory, MemoryVectorRecord, VectorStore } from "@arnilo/prism-memory-core";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import {
  type ConceptDirtyReason,
  type ConceptType,
  type FabricScopeLevel,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryNoteMetadata,
  parseMemoryNoteMetadata,
} from "../types.js";

/** One scope the ontology reads: the level, its memory and the store both share. */
export interface OntologyScope {
  readonly level: FabricScopeLevel;
  readonly memory: Memory;
}

export interface ConceptRow {
  readonly id: string;
  readonly subject: string;
  readonly title: string;
  readonly conceptType: ConceptType;
  readonly aliases: readonly string[];
  readonly sources: readonly string[];
  readonly dirty: readonly ConceptDirtyReason[];
  readonly status: string;
  /** The write scope stored on the note (`path` for a subject bound to globs). */
  readonly scope: string | undefined;
  /** Recorded uses of the concept (the note's last-32 use log); orders the directory's subject list. */
  readonly uses: number;
}

export function rowFromMetadata(id: string, metadata: JsonObject | undefined): ConceptRow | undefined {
  const note = parseMemoryNoteMetadata(metadata);
  if (note === undefined || note.kind !== "concept" || note.subject === undefined) return undefined;
  const status = typeof metadata?.status === "string" ? metadata.status : "verified";
  return {
    id,
    subject: note.subject,
    title: note.title ?? note.subject,
    conceptType: note.conceptType ?? "topic",
    aliases: note.aliases ?? [],
    sources: note.sources ?? [],
    dirty: note.dirty ?? [],
    status,
    scope: note.scope,
    uses: note.uses?.length ?? 0,
  };
}

const SCAN_PAGE = 500;

async function scanConceptRows(memory: Memory, store: VectorStore, signal: AbortSignal | undefined): Promise<ConceptRow[]> {
  const rows: ConceptRow[] = [];
  const { tenantId, resourceId, threadId } = memory.scope;
  if (store.scanMetadata !== undefined) {
    let cursor: string | undefined;
    do {
      const page = await store.scanMetadata({
        scope: { tenantId, resourceId },
        limit: SCAN_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
        ...(signal === undefined ? {} : { signal }),
      });
      for (const row of page.rows) {
        const parsed = rowFromMetadata(row.id, row.metadata);
        if (parsed !== undefined) rows.push(parsed);
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return rows;
  }
  if (store.getByThread !== undefined && threadId !== undefined) {
    for (const record of await store.getByThread({ tenantId, resourceId, threadId })) {
      const parsed = rowFromMetadata(record.id, record.metadata);
      if (parsed !== undefined) rows.push(parsed);
    }
    return rows;
  }
  throw new MemoryValidationError("the ontology needs a vector store with scanMetadata or getByThread");
}

export interface ConceptIndex {
  /** Subjects with a live (non-archived) concept, sorted by subject. */
  subjects(signal?: AbortSignal): Promise<readonly ConceptRow[]>;
  /** The concept row for a subject, archived or not; `undefined` when none exists. */
  bySubject(subject: string, signal?: AbortSignal): Promise<ConceptRow | undefined>;
  byId(id: string, signal?: AbortSignal): Promise<ConceptRow | undefined>;
  /** Concept ids whose `sources` include any of `ids`. */
  citing(ids: readonly string[], signal?: AbortSignal): Promise<readonly string[]>;
  upsert(row: ConceptRow): void;
  drop(id: string): void;
  invalidate(): void;
  /** Bumped by every change to the index, so a cache built from it knows when it is stale. */
  version(): number;
}

export function createConceptIndex(deps: { readonly memory: Memory; readonly store: VectorStore }): ConceptIndex {
  let byId: Map<string, ConceptRow> | undefined;
  let bySubject: Map<string, string> | undefined;
  let byCited: Map<string, Set<string>> | undefined;
  let loading: Promise<void> | undefined;
  let revision = 0;

  const add = (row: ConceptRow): void => {
    revision += 1;
    byId!.set(row.id, row);
    bySubject!.set(row.subject, row.id);
    for (const cited of row.sources) {
      const set = byCited!.get(cited) ?? new Set<string>();
      set.add(row.id);
      byCited!.set(cited, set);
    }
  };
  const remove = (id: string): void => {
    const existing = byId?.get(id);
    if (existing === undefined) return;
    revision += 1;
    byId!.delete(id);
    if (bySubject!.get(existing.subject) === id) bySubject!.delete(existing.subject);
    for (const cited of existing.sources) {
      const set = byCited!.get(cited);
      set?.delete(id);
      if (set?.size === 0) byCited!.delete(cited);
    }
  };

  async function ensure(signal: AbortSignal | undefined): Promise<void> {
    if (byId !== undefined) return;
    loading ??= (async () => {
      const rows = await scanConceptRows(deps.memory, deps.store, signal);
      byId = new Map();
      bySubject = new Map();
      byCited = new Map();
      for (const row of rows) add(row);
    })().finally(() => {
      loading = undefined;
    });
    await loading;
  }

  return {
    async subjects(signal) {
      await ensure(signal);
      return [...byId!.values()]
        .filter((row) => row.status !== "archived" && row.status !== "retired")
        .sort((a, b) => (a.subject < b.subject ? -1 : 1));
    },
    async bySubject(subject, signal) {
      await ensure(signal);
      const id = bySubject!.get(subject);
      return id === undefined ? undefined : byId!.get(id);
    },
    async byId(id, signal) {
      await ensure(signal);
      return byId!.get(id);
    },
    async citing(ids, signal) {
      await ensure(signal);
      const out = new Set<string>();
      for (const id of ids) for (const concept of byCited!.get(id) ?? []) out.add(concept);
      return [...out];
    },
    upsert(row) {
      if (byId === undefined) return;
      remove(row.id);
      add(row);
    },
    drop(id) {
      if (byId !== undefined) remove(id);
    },
    invalidate() {
      revision += 1;
      byId = undefined;
      bySubject = undefined;
      byCited = undefined;
    },
    version: () => revision,
  };
}

/** Rebuild the fabric metadata of a concept, carrying every field the caller does not change. */
export function conceptMetadata(
  previous: JsonObject | undefined,
  fabric: JsonObject,
  patch: { readonly generated: JsonObject; readonly status?: string | undefined },
): JsonObject {
  const { status: _status, generated: _generated, ...host } = previous ?? {};
  return {
    ...host,
    [MEMORY_NOTE_METADATA_KEY]: fabric,
    ...(patch.status === undefined ? {} : { status: patch.status }),
    generated: patch.generated,
  };
}

export function noteOf(record: Pick<MemoryVectorRecord, "metadata">): MemoryNoteMetadata | undefined {
  return parseMemoryNoteMetadata(record.metadata);
}
