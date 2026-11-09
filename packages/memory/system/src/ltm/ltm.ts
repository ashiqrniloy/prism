/**
 * The `memory.ltm` service (plan 216 Task 3): the read-only port through which a consumer outside memory (the wiki)
 * reads long-term notes. It replaces the fabric's former ontology service. There is no write member: the wiki keeps its concepts, claims,
 * bindings and sources in its own store and only cites LTM notes by id.
 *
 * Every read goes through the scope's own `Memory`, so scope ACLs, consent and invalidation apply exactly as they do
 * to `memory.read`. The deletion feed carries ids, reasons and timestamps only. Nothing here calls a model.
 */
import { createHash } from "node:crypto";
import { type Memory, MemoryScopeError, MemoryValidationError, type MemoryVectorRecord, type VectorStore } from "@arnilo/prism-memory-core";
import { memoryRetractionVersion } from "./directory.js";
import { exchangeKeywords } from "./exchanges.js";
import { type FabricScopeLevel, type MemoryNoteKind, parseMemoryNoteMetadata } from "./types.js";

/** The service name a consumer declares or consumes. */
export const MEMORY_LTM_SERVICE = "memory.ltm";

/** Ids one `read` takes. */
export const MAX_LTM_READ_IDS = 32;
/** Rows one `scanMetadata` or `activity` page holds at most. */
export const MAX_LTM_PAGE = 500;
const DEFAULT_LTM_PAGE = 200;

/** The kinds the port shows: evidence only. `episode` is reserved until plan 219 stores it. */
const HIDDEN_KINDS: ReadonlySet<MemoryNoteKind> = new Set(["episode"]);

/** One LTM note's metadata as the port shows it: ids, kinds and counters, never text. */
export interface LtmNoteMeta {
  readonly id: string;
  readonly kind: MemoryNoteKind;
  readonly scope: FabricScopeLevel;
  readonly createdAt: string;
  /** `verified` unless the note says otherwise (`candidate`, `archived`, `superseded`, …). */
  readonly status: string;
  /** A trust-scan class flagged the note. A consumer never cites a flagged note. */
  readonly flagged: boolean;
  /** The topic key the note was written with, if any (a `remember` argument; LTM never binds). */
  readonly subject?: string;
  readonly key?: string;
  readonly tRef?: string;
  /** Stored enrichment keywords, or for an evidence note stored without any, `exchangeKeywords` of its text. */
  readonly keywords?: readonly string[];
  readonly links?: readonly { readonly id: string; readonly relation?: string }[];
  readonly coRead?: readonly { readonly s: number; readonly t: number; readonly with: readonly string[] }[];
  /** Recorded uses (the note's last-32 use log). */
  readonly uses?: number;
  /** `file` notes only. */
  readonly path?: string;
  readonly generatedBy?: string;
}

/** One LTM note with its text, capped to the scope's entry limit. */
export interface LtmNoteView extends LtmNoteMeta {
  readonly text: string;
}

export interface LtmPageOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface LtmScanPage {
  readonly notes: readonly LtmNoteMeta[];
  /** Pass back as `cursor`; absent on the last page. */
  readonly cursor?: string;
}

/** A recorded use or co-read of one note. Ids and ordinals only. */
export interface LtmActivityEvent {
  readonly id: string;
  readonly kind: "use" | "co-read";
  /** The scope-session ordinal the event happened in. */
  readonly s: number;
  readonly t?: number;
  readonly at?: string;
  readonly with?: readonly string[];
}

export interface LtmActivityPage {
  readonly events: readonly LtmActivityEvent[];
  readonly cursor?: string;
}

/** One invalidation record: forget, revoke, legal hold or correction. Ids, reasons and times only. */
export interface LtmDeletion {
  readonly id: string;
  readonly reason: string;
  readonly at: string;
}

export interface LtmDeletionPage {
  readonly deletions: readonly LtmDeletion[];
  /** The newest `at` seen: pass it back as `since`. Absent when the page is empty. */
  readonly cursor?: string;
}

export interface MemoryLtmPort {
  /** Readable scope levels, narrowest first. */
  scopes(): readonly FabricScopeLevel[];
  /**
   * An opaque, stable identity of the memory a level reads (a hash of its tenant and resource ids; never the ids). A
   * consumer that keeps its own store pins each level to it, so one store never serves two projects.
   */
  scopeId(scope: FabricScopeLevel): string;
  /** Bumped by every retraction in any scope (forget, revoke, delete, demotion): re-read the deletion feed when it moves. */
  epoch(): number;
  /** Up to {@link MAX_LTM_READ_IDS} notes through the same filters as `memory.read`. An unreadable id is absent. */
  read(scope: FabricScopeLevel, ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly LtmNoteView[]>;
  /** A page of evidence-note metadata, store order. */
  scanMetadata(scope: FabricScopeLevel, options?: LtmPageOptions): Promise<LtmScanPage>;
  /** A page of `use` and `co-read` events, one store-scan page at a time. */
  activity(scope: FabricScopeLevel, options?: LtmPageOptions): Promise<LtmActivityPage>;
  /**
   * Invalidation records newer than `since` (forget, revoke, legal hold, correction), oldest first. Hard deletes
   * (retention, capacity eviction, import replace) leave no record: a consumer confirms what it cites with `read`.
   */
  deletions(scope: FabricScopeLevel, options?: { readonly since?: string; readonly signal?: AbortSignal }): Promise<LtmDeletionPage>;
}

/** One scope the port reads: its level, its memory, and the store its notes live in. */
export interface LtmScope {
  readonly level: FabricScopeLevel;
  readonly memory: Memory;
  readonly store: VectorStore;
}

const SCOPE_CURSOR = /^[^\s]{1,512}$/;

export function createMemoryLtmPort(deps: { readonly scopes: () => readonly LtmScope[] }): MemoryLtmPort {
  const stateOf = (level: FabricScopeLevel): LtmScope => {
    const found = deps.scopes().find((scope) => scope.level === level);
    if (found === undefined) throw new MemoryScopeError(`the ${level} scope is not readable here`);
    return found;
  };
  const pageLimit = (limit: number | undefined): number => Math.min(Math.max(1, Math.trunc(limit ?? DEFAULT_LTM_PAGE)), MAX_LTM_PAGE);
  const checkCursor = (cursor: string | undefined): void => {
    if (cursor !== undefined && (typeof cursor !== "string" || !SCOPE_CURSOR.test(cursor))) {
      throw new MemoryValidationError("cursor must be the value a previous page returned");
    }
  };

  const meta = (
    level: FabricScopeLevel,
    row: Pick<MemoryVectorRecord, "id" | "createdAt" | "metadata">,
    text: string | undefined,
  ): LtmNoteMeta | undefined => {
    const note = parseMemoryNoteMetadata(row.metadata);
    if (note === undefined || HIDDEN_KINDS.has(note.kind)) return undefined;
    const status = typeof row.metadata?.status === "string" ? row.metadata.status : "verified";
    const stored = note.keywords;
    const keywords =
      stored !== undefined && stored.length > 0 ? stored : text === undefined || note.kind === "file" ? undefined : exchangeKeywords(text);
    return {
      id: row.id,
      kind: note.kind,
      scope: level,
      createdAt: row.createdAt,
      status,
      flagged: (note.flags?.length ?? 0) > 0,
      ...(note.subject === undefined ? {} : { subject: note.subject }),
      ...(note.key === undefined ? {} : { key: note.key }),
      ...(note.tRef === undefined ? {} : { tRef: note.tRef }),
      ...(keywords === undefined || keywords.length === 0 ? {} : { keywords }),
      ...(note.links === undefined || note.links.length === 0
        ? {}
        : { links: note.links.map((link) => ({ id: link.id, ...(link.relation === undefined ? {} : { relation: link.relation }) })) }),
      ...(note.coRead === undefined || note.coRead.length === 0 ? {} : { coRead: note.coRead }),
      ...(note.uses === undefined || note.uses.length === 0 ? {} : { uses: note.uses.length }),
      ...(note.kind === "file" && note.path !== undefined ? { path: note.path } : {}),
      ...(note.generated === undefined ? {} : { generatedBy: note.generated.by }),
    };
  };

  async function scanPage(state: LtmScope, options: LtmPageOptions) {
    checkCursor(options.cursor);
    if (state.store.scanMetadata === undefined) throw new MemoryValidationError("the LTM scan needs a store with scanMetadata");
    const { tenantId, resourceId } = state.memory.scope;
    return state.store.scanMetadata({
      scope: { tenantId, resourceId },
      limit: pageLimit(options.limit),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  return {
    scopes: () => deps.scopes().map((scope) => scope.level),
    scopeId(scope) {
      const { tenantId, resourceId } = stateOf(scope).memory.scope;
      return createHash("sha256")
        .update(`memory.ltm\u0000${tenantId}\u0000${resourceId ?? ""}`, "utf8")
        .digest("hex")
        .slice(0, 16);
    },
    epoch: () => deps.scopes().reduce((sum, scope) => sum + memoryRetractionVersion(scope.memory), 0),
    async read(scope, ids, options = {}) {
      const state = stateOf(scope);
      if (!Array.isArray(ids) || ids.length > MAX_LTM_READ_IDS || ids.some((id) => typeof id !== "string")) {
        throw new MemoryValidationError(`read takes at most ${MAX_LTM_READ_IDS} ids`);
      }
      if (ids.length === 0) return [];
      const records = await state.memory.get(ids, options.signal === undefined ? {} : { signal: options.signal });
      const cap = state.memory.limits.maxEntryTextChars;
      return records.flatMap((record) => {
        const view = meta(scope, record, record.text);
        return view === undefined ? [] : [{ ...view, text: record.text.length > cap ? record.text.slice(0, cap) : record.text }];
      });
    },
    async scanMetadata(scope, options = {}) {
      const page = await scanPage(stateOf(scope), options);
      const notes = page.rows.flatMap((row) => {
        const view = meta(scope, row, undefined);
        return view === undefined ? [] : [view];
      });
      return { notes, ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }) };
    },
    async activity(scope, options = {}) {
      const page = await scanPage(stateOf(scope), options);
      const events: LtmActivityEvent[] = [];
      for (const row of page.rows) {
        const note = parseMemoryNoteMetadata(row.metadata);
        if (note === undefined || HIDDEN_KINDS.has(note.kind)) continue;
        for (const use of note.uses ?? []) events.push({ id: row.id, kind: "use", s: use.s, at: use.at });
        for (const read of note.coRead ?? []) events.push({ id: row.id, kind: "co-read", s: read.s, t: read.t, with: read.with });
      }
      return { events, ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }) };
    },
    async deletions(scope, options = {}) {
      const state = stateOf(scope);
      if (options.since !== undefined && (typeof options.since !== "string" || Number.isNaN(Date.parse(options.since)))) {
        throw new MemoryValidationError("since must be an ISO timestamp a previous page returned");
      }
      const listed = (await state.memory.listInvalidated?.(options.signal === undefined ? {} : { signal: options.signal })) ?? [];
      const since = options.since;
      const deletions = listed
        .filter((record) => since === undefined || record.at > since)
        .map((record) => ({ id: record.id, reason: record.reason, at: record.at }))
        .sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1));
      const last = deletions.at(-1);
      return { deletions, ...(last === undefined ? {} : { cursor: last.at }) };
    },
  };
}
