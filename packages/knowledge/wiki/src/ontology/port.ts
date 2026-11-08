/**
 * The wiki's ontology (plan 216 Task 3; plan 207 Tasks 2–8 built it inside the fabric). Concepts, their claims,
 * relations and open questions, the subject bindings of evidence, and ingested sources all live in the wiki's own
 * store. Long-term memory is read, never written, through the read-only `memory.ltm` port: a claim cites an LTM note
 * by id, in the concept's own scope, or a wiki source.
 *
 * Deletion still cascades deterministically, with no model call. A forgotten, revoked or held note takes every claim
 * citing it with it; a corrected note marks them stale. Deletions arrive two ways: the `deletions` feed (invalidation
 * records, read after every LTM retraction epoch and on open) and an open-time liveness check (every cited id read back
 * in bounded batches), which catches the hard deletes that leave no record. A claim whose citation is unreadable is
 * never rendered or returned either way: the read side checks again.
 */
import { scanScopedMemoryContent } from "@arnilo/prism-memory-core";
import { MemoryScopeError, MemoryValidationError } from "@arnilo/prism-memory-core";
import { dirname } from "node:path";
import {
  createMemoryWikiStore,
  type WikiConceptRecord,
  type WikiSourceRecord,
  type WikiStore,
  wikiConceptId,
  wikiSourceId,
} from "../store.js";
import { createSubjectMatcher, resolveBindThreshold, type SubjectMatcher } from "./bind.js";
import {
  type ConceptDoc,
  type ConceptItem,
  conceptSources,
  MAX_CONCEPT_ITEMS,
  nextItemId,
  parseConceptBody,
  renderConceptBody,
  validateCites,
  validateItemText,
} from "./codec.js";
import { ConceptFormatError } from "./errors.js";
import { type LtmNoteMeta, type LtmNoteView, type LtmPort, MAX_LTM_READ_IDS } from "./ltm.js";
import {
  CONCEPT_RELATIONS,
  CONCEPT_TYPES,
  CONCEPT_WRITERS,
  type ConceptDirtyReason,
  type ConceptRelation,
  type ConceptType,
  type ConceptWriter,
  isConceptRelation,
  MAX_CONCEPT_ALIASES,
  MAX_CONCEPT_TITLE_CHARS,
  validateAppliesTo,
  validateNoteKey,
  type WikiScopeLevel,
} from "./types.js";

export const MAX_ONTOLOGY_READ_IDS = 32;
export const MAX_ONTOLOGY_PENDING = 64;
export const DEFAULT_ONTOLOGY_PENDING = 24;
export const MAX_CONCEPT_EDITS = 64;
/** LTM metadata pages one binding sweep reads at most (500 notes each). */
const MAX_BIND_PAGES = 8;

export interface OntologySubject {
  readonly subject: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly conceptId: string;
  readonly conceptType: ConceptType;
  readonly dirty: readonly ConceptDirtyReason[];
}

export interface OntologyDirtyEntry {
  readonly subject: string;
  readonly conceptId: string;
  readonly reasons: readonly ConceptDirtyReason[];
}

/** One note as the curator sees it: an LTM note, a wiki source (`kind: "file"`) or a concept. Text capped. */
export interface OntologyNoteView {
  readonly id: string;
  readonly kind: string;
  readonly scope: WikiScopeLevel;
  readonly createdAt: string;
  readonly text: string;
  /** The subject the wiki bound the note to (or the topic key it was written with). On a concept, its subject. */
  readonly subject?: string;
  readonly key?: string;
  readonly tRef?: string;
  readonly status?: string;
  /** Enrichment keywords for clustering unbound notes. */
  readonly keywords?: readonly string[];
  /** Typed links (ids and relation only). A concept's links point at other concepts. */
  readonly links?: readonly { readonly id: string; readonly relation?: string }[];
  /** Co-read events (ids and indexes only), the curator's primary trigger. */
  readonly coRead?: readonly { readonly s: number; readonly t: number; readonly with: readonly string[] }[];
  /** Wiki sources only: `sources/<dir>/extract.md`. */
  readonly path?: string;
  /** Who wrote this last; `human` marks a concept a person edited. */
  readonly generatedBy?: string;
  /** A concept's item ids whose citation was retracted or changed and that no edit has resolved yet. */
  readonly stale?: readonly string[];
}

/** Narrows {@link WikiOntologyPort.pending}; every filter is evaluated in the same metadata scan. */
export interface OntologyPendingOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly subject?: string;
  readonly unbound?: boolean;
  readonly coRead?: boolean;
  readonly signal?: AbortSignal;
}

export interface OntologyPendingPage {
  readonly notes: readonly OntologyNoteView[];
  readonly cursor?: string;
}

/** The edit vocabulary. There is no full-rewrite operation: a body only changes one item at a time. */
export type ConceptEdit =
  | {
      readonly op: "create_subject";
      readonly subject: string;
      readonly title: string;
      readonly conceptType: ConceptType;
      readonly aliases?: readonly string[];
      /** Project-root-relative globs; valid on the project scope only. */
      readonly appliesTo?: readonly string[];
    }
  | { readonly op: "add_claim"; readonly subject: string; readonly text: string; readonly cites: readonly string[] }
  | {
      readonly op: "update_claim";
      readonly subject: string;
      readonly claimId: string;
      readonly text: string;
      readonly cites: readonly string[];
    }
  | { readonly op: "retire_claim"; readonly subject: string; readonly claimId: string; readonly reason: string }
  | {
      readonly op: "merge_claims";
      readonly subject: string;
      readonly claimIds: readonly string[];
      readonly text: string;
      readonly cites: readonly string[];
    }
  | { readonly op: "add_relation"; readonly subject: string; readonly relation: ConceptRelation; readonly target: string }
  | { readonly op: "add_open_question"; readonly subject: string; readonly text: string; readonly cites: readonly string[] }
  | {
      readonly op: "note_contradiction";
      readonly subject: string;
      readonly text: string;
      readonly claimIds?: readonly string[];
      readonly noteIds?: readonly string[];
    };

export interface ApplyConceptEditsOptions {
  readonly generatedBy: ConceptWriter;
  readonly signal?: AbortSignal;
}

export interface ApplyConceptEditsResult {
  readonly subjects: readonly string[];
  readonly edits: number;
  readonly archived: readonly string[];
}

/** A staged source to record in the wiki's store (the `project` scope). */
export interface OntologySourceInput {
  /** `sources/<dir>/extract.md`, relative to the stage root. */
  readonly path: string;
  readonly title: string;
  readonly text: string;
  readonly contentHash: string;
  readonly keywords?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface OntologySourceResult {
  /** False when the trust scan refused the text: the files are staged, nothing is cited from them. */
  readonly indexed: boolean;
  readonly scope: WikiScopeLevel;
  /** The source id; claims cite it. Absent when refused. */
  readonly id?: string;
  /** The subject the source was bound to on ingest, when exactly one fit. */
  readonly subject?: string;
  readonly refused?: string;
}

/** What one reconcile removed or marked. */
export interface WikiReconcileReport {
  readonly concepts: number;
  readonly removed: number;
  readonly stale: number;
  readonly archived: number;
}

export interface WikiOntologyPort {
  /** Readable scope levels, narrowest first. */
  scopes(): readonly WikiScopeLevel[];
  /** Whether long-term memory is attached (the `memory.ltm` service is present). */
  memory(): boolean;
  /** Where sources are staged: the wiki's own root, or `undefined` for an in-memory wiki with no stage root. */
  sourceRoot(): string | undefined;
  /** Record a staged source (trust scan first, deterministic binding, no model call). */
  indexSource(input: OntologySourceInput): Promise<OntologySourceResult>;
  subjects(scope: WikiScopeLevel, options?: { readonly signal?: AbortSignal }): Promise<readonly OntologySubject[]>;
  /** Evidence (LTM notes and wiki sources) written after `cursor`, oldest first. */
  pending(scope: WikiScopeLevel, options?: OntologyPendingOptions): Promise<OntologyPendingPage>;
  /** Up to {@link MAX_ONTOLOGY_READ_IDS} concepts, sources or LTM notes. An unreadable id is absent. */
  read(scope: WikiScopeLevel, ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly OntologyNoteView[]>;
  /** Validate the whole batch, then write it; any invalid edit rejects the batch and writes nothing. */
  applyConceptEdits(
    scope: WikiScopeLevel,
    edits: readonly ConceptEdit[],
    options: ApplyConceptEditsOptions,
  ): Promise<ApplyConceptEditsResult>;
  /** Bind an evidence note to a subject in its own scope (the wiki's binding; LTM is never written). */
  bind(scope: WikiScopeLevel, noteId: string, subject: string, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  dirty(scope: WikiScopeLevel, options?: { readonly signal?: AbortSignal }): Promise<readonly OntologyDirtyEntry[]>;
  /** The trust class the wiki would refuse `text` for, or `undefined` when it is clean. */
  screen(text: string): string | undefined;
  /** Clear the `evidence` reason: the curator looked and had nothing to add. */
  settle(scope: WikiScopeLevel, subject: string, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  /** Bind new evidence deterministically (no model call) and flag the concepts it binds to. Returns the notes bound. */
  bindPending(scope: WikiScopeLevel, options?: { readonly signal?: AbortSignal }): Promise<number>;
  /**
   * Catch up with long-term memory: on first use (open) the deletion feed and the liveness check, after an LTM
   * retraction epoch the deletion feed. A no-op without memory and when nothing moved.
   */
  refresh(options?: { readonly signal?: AbortSignal }): Promise<WikiReconcileReport>;
  /** Run the deletion feed (and, with `liveness`, read back every cited id) for one scope now. */
  reconcile(scope: WikiScopeLevel, options?: { readonly liveness?: boolean; readonly signal?: AbortSignal }): Promise<WikiReconcileReport>;
  /** Ids of `ids` that are readable evidence in `scope` (active LTM notes or unrefused sources). */
  readable(scope: WikiScopeLevel, ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<ReadonlySet<string>>;
  /** Every concept of a scope, archived ones included. */
  concepts(scope: WikiScopeLevel): Promise<readonly WikiConceptRecord[]>;
  /** Record a delivered read of a concept (orders the subject lists). */
  noteUse(scope: WikiScopeLevel, id: string): Promise<void>;
  /** The store, for diagnostics and tests. */
  readonly store: WikiStore;
}

const WRITE_SCOPES: readonly WikiScopeLevel[] = ["user", "project"];
const ACTIVE_STATUSES = new Set(["verified", "candidate"]);
/** Retractions that remove the claims citing a note; every other reason marks them stale. */
const REMOVING = new Set(["forgotten", "revoked", "legal_hold"]);
const EMPTY: WikiReconcileReport = { concepts: 0, removed: 0, stale: 0, archived: 0 };
const add = (a: WikiReconcileReport, b: WikiReconcileReport): WikiReconcileReport => ({
  concepts: a.concepts + b.concepts,
  removed: a.removed + b.removed,
  stale: a.stale + b.stale,
  archived: a.archived + b.archived,
});

interface Working {
  readonly id: string;
  readonly isNew: boolean;
  readonly record?: WikiConceptRecord;
  meta: Omit<WikiConceptRecord, "body">;
  doc: ConceptDoc;
  readonly resolved: Set<string>;
}

const allItems = (doc: ConceptDoc): readonly ConceptItem[] => [...doc.claims, ...doc.questions, ...doc.contradictions];
const addReason = (reasons: readonly ConceptDirtyReason[], reason: ConceptDirtyReason): readonly ConceptDirtyReason[] =>
  reasons.includes(reason) ? reasons : [...reasons, reason];
const isActive = (status: string | undefined): boolean => ACTIVE_STATUSES.has(status ?? "verified");

export interface CreateWikiOntologyOptions {
  readonly store?: WikiStore;
  /** The `memory.ltm` port, resolved per call: memory may load after the wiki, or not at all. */
  readonly ltm?: () => LtmPort | undefined;
  /** The stage root sources live under; the markdown store's root by default. */
  readonly sourceRoot?: string;
  readonly redact?: (text: string) => string;
  readonly now?: () => Date;
  /** Matched tokens of one name that bind a note (default 2). */
  readonly bindThreshold?: number;
  /** Text cap for a note view. Default 16,384 characters. */
  readonly maxTextChars?: number;
}

export function createWikiOntology(options: CreateWikiOntologyOptions = {}): WikiOntologyPort {
  const store = options.store ?? createMemoryWikiStore();
  const now = options.now ?? (() => new Date());
  const redact = options.redact ?? ((text: string) => text);
  const threshold = resolveBindThreshold(options.bindThreshold);
  const maxText = options.maxTextChars ?? 16_384;
  const ltm = (): LtmPort | undefined => options.ltm?.();
  const opened = new Set<WikiScopeLevel>();
  let seenEpoch: number | undefined;
  const matchers = new Map<WikiScopeLevel, { readonly key: string; readonly matcher: SubjectMatcher }>();
  /** Unbound notes the current matcher already tried, so a sweep reads only new evidence until a concept changes. */
  const tried = new Map<WikiScopeLevel, { matcher: SubjectMatcher; readonly ids: Set<string> }>();

  const scopes = (): readonly WikiScopeLevel[] => {
    const port = ltm();
    if (port === undefined) return ["project"];
    const levels = port.scopes() as readonly WikiScopeLevel[];
    return levels.includes("project") ? levels : [...levels, "project"];
  };
  const readableScope = (level: WikiScopeLevel): WikiScopeLevel => {
    if (!scopes().includes(level)) throw new MemoryScopeError(`the ${level} scope is not readable here`);
    return level;
  };
  const writable = (level: WikiScopeLevel): WikiScopeLevel => {
    if (!WRITE_SCOPES.includes(level)) throw new MemoryScopeError(`the wiki does not write ${level} concepts; use user or project`);
    return readableScope(level);
  };
  const ltmHas = (level: WikiScopeLevel): boolean => ltm()?.scopes().includes(level) === true;
  /** Levels whose owner was confirmed, by the memory identity confirmed. */
  const owners = new Map<WikiScopeLevel, string>();
  /**
   * One wiki store never serves two memories: each level is pinned to the `memory.ltm` identity it first read. Another
   * project on the same root fails closed with `MemoryScopeError` before anything is read or written.
   */
  async function pinOwner(scope: WikiScopeLevel): Promise<void> {
    const port = ltm();
    if (port === undefined || !ltmHas(scope)) return;
    const id = port.scopeId(scope);
    if (owners.get(scope) === id) return;
    const state = await store.state(scope);
    if (state.owner === undefined) await store.setState(scope, { ...state, owner: id });
    else if (state.owner !== id) {
      throw new MemoryScopeError(`this wiki's ${scope} scope belongs to another memory; give each project its own wiki root`);
    }
    owners.set(scope, id);
  }
  const cap = (text: string): string => (text.length > maxText ? text.slice(0, maxText) : text);

  const live = (record: WikiConceptRecord): boolean => record.status !== "archived";
  const bySubject = async (scope: WikiScopeLevel, subject: string): Promise<WikiConceptRecord | undefined> =>
    (await store.concepts(scope)).find((record) => record.subject === subject);

  async function readLtm(scope: WikiScopeLevel, ids: readonly string[], signal: AbortSignal | undefined): Promise<readonly LtmNoteView[]> {
    const port = ltm();
    if (port === undefined || !ltmHas(scope) || ids.length === 0) return [];
    const out: LtmNoteView[] = [];
    for (let offset = 0; offset < ids.length; offset += MAX_LTM_READ_IDS) {
      out.push(...(await port.read(scope, ids.slice(offset, offset + MAX_LTM_READ_IDS), signal === undefined ? {} : { signal })));
    }
    return out;
  }

  const sourceView = (record: WikiSourceRecord, text: string, subject: string | undefined): OntologyNoteView => ({
    id: record.id,
    kind: "file",
    scope: "project",
    createdAt: record.createdAt,
    text: cap(text),
    ...(subject === undefined ? {} : { subject }),
    ...(record.keywords.length === 0 ? {} : { keywords: record.keywords }),
    path: record.path,
    generatedBy: "host",
  });

  const ltmView = (note: LtmNoteView, subject: string | undefined): OntologyNoteView => ({
    id: note.id,
    kind: note.kind,
    scope: note.scope,
    createdAt: note.createdAt,
    text: cap(note.text),
    ...(subject === undefined ? {} : { subject }),
    ...(note.key === undefined ? {} : { key: note.key }),
    ...(note.tRef === undefined ? {} : { tRef: note.tRef }),
    status: note.status,
    ...(note.keywords === undefined ? {} : { keywords: note.keywords }),
    ...(note.links === undefined ? {} : { links: note.links }),
    ...(note.coRead === undefined ? {} : { coRead: note.coRead }),
    ...(note.path === undefined ? {} : { path: note.path }),
    ...(note.generatedBy === undefined ? {} : { generatedBy: note.generatedBy }),
  });

  const conceptView = (record: WikiConceptRecord): OntologyNoteView => ({
    id: record.id,
    kind: "concept",
    scope: record.scope,
    createdAt: record.createdAt,
    text: record.body,
    subject: record.subject,
    status: record.status,
    ...(record.links.length === 0 ? {} : { links: record.links }),
    generatedBy: record.generated.by,
    ...(record.stale.length === 0 ? {} : { stale: record.stale }),
  });

  /** The subject a note is bound to: the wiki's own binding first, then the topic key it was written with. */
  const subjectOf = (bindings: ReadonlyMap<string, string>, id: string, stored: string | undefined): string | undefined =>
    bindings.get(id) ?? stored;

  /** The binder for a scope, rebuilt only when a live concept's names change. */
  async function matcherFor(scope: WikiScopeLevel): Promise<SubjectMatcher> {
    const rows = (await store.concepts(scope)).filter(live);
    const key = JSON.stringify(rows.map((row) => [row.subject, row.title, row.aliases]));
    const cached = matchers.get(scope);
    if (cached !== undefined && cached.key === key) return cached.matcher;
    const matcher = createSubjectMatcher(rows, threshold);
    matchers.set(scope, { key, matcher });
    return matcher;
  }

  /** Flag a concept for another pass: evidence it does not cite yet was bound to it. */
  async function markEvidenceDirty(scope: WikiScopeLevel, subject: string, ids: readonly string[]): Promise<void> {
    const record = await bySubject(scope, subject);
    if (record === undefined || !live(record) || record.dirty.includes("evidence")) return;
    let cited: ReadonlySet<string> = new Set();
    try {
      cited = new Set(conceptSources(parseConceptBody(record.body, { allowUncited: true })));
    } catch {
      // A body a person broke cites nothing usable; the evidence is new to it.
    }
    if (ids.every((id) => cited.has(id))) return;
    await store.putConcept({ ...record, dirty: [...record.dirty, "evidence"] });
  }

  // --- the deletion cascade -----------------------------------------------------------------------------------

  async function cascade(scope: WikiScopeLevel, gone: ReadonlySet<string>, remove: boolean): Promise<WikiReconcileReport> {
    if (gone.size === 0) return EMPTY;
    let report = EMPTY;
    for (const record of await store.concepts(scope)) {
      let doc: ConceptDoc;
      try {
        doc = parseConceptBody(record.body, { allowUncited: true });
      } catch {
        continue;
      }
      const hit = allItems(doc).filter((item) => item.cites.some((cite) => gone.has(cite)));
      if (hit.length === 0) continue;
      if (remove) {
        const keep = (items: readonly ConceptItem[]): ConceptItem[] => items.filter((item) => !item.cites.some((cite) => gone.has(cite)));
        const next: ConceptDoc = {
          title: doc.title,
          claims: keep(doc.claims),
          questions: keep(doc.questions),
          contradictions: keep(doc.contradictions),
        };
        const keptIds = new Set(allItems(next).map((item) => item.id));
        const archive = next.claims.length === 0 && live(record);
        await store.putConcept({
          ...record,
          body: renderConceptBody(next),
          stale: record.stale.filter((id) => keptIds.has(id)),
          dirty: addReason(record.dirty, "removed"),
          status: archive ? "archived" : record.status,
        });
        report = add(report, { concepts: 1, removed: hit.length, stale: 0, archived: archive ? 1 : 0 });
        continue;
      }
      const fresh = hit.map((item) => item.id).filter((id) => !record.stale.includes(id));
      if (fresh.length === 0) continue;
      await store.putConcept({ ...record, stale: [...record.stale, ...fresh], dirty: addReason(record.dirty, "stale") });
      report = add(report, { concepts: 1, removed: 0, stale: fresh.length, archived: 0 });
    }
    return report;
  }

  /** Every LTM id a scope's concepts cite (not wiki sources). */
  async function citedLtmIds(scope: WikiScopeLevel): Promise<readonly string[]> {
    const own = new Set((await store.sources()).map((source) => source.id));
    const out = new Set<string>();
    for (const record of await store.concepts(scope)) {
      try {
        for (const id of conceptSources(parseConceptBody(record.body, { allowUncited: true }))) if (!own.has(id)) out.add(id);
      } catch {
        // A body a person broke is not delivered; the next valid edit is reconciled.
      }
    }
    return [...out];
  }

  async function reconcile(
    scope: WikiScopeLevel,
    reconcileOptions: { readonly liveness?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<WikiReconcileReport> {
    const port = ltm();
    // Only the scopes the wiki writes cascade. A read-only scope's citations (a checked-in team concept) are provenance:
    // the private notes they name never travelled with it, so they are never readable here and never retract it.
    if (port === undefined || !ltmHas(scope) || !WRITE_SCOPES.includes(scope)) return EMPTY;
    await pinOwner(scope);
    const signal = reconcileOptions.signal;
    let report = EMPTY;
    // 1. The deletion feed: invalidation records since the last one applied.
    const state = await store.state(scope);
    const feed = await port.deletions(scope, {
      ...(state.deletions === undefined ? {} : { since: state.deletions }),
      ...(signal === undefined ? {} : { signal }),
    });
    const removed = new Set(feed.deletions.filter((entry) => REMOVING.has(entry.reason)).map((entry) => entry.id));
    const changed = new Set(feed.deletions.filter((entry) => !REMOVING.has(entry.reason)).map((entry) => entry.id));
    report = add(report, await cascade(scope, removed, true));
    report = add(report, await cascade(scope, changed, false));
    if (feed.cursor !== undefined) await store.setState(scope, { ...state, deletions: feed.cursor });
    // 2. Liveness: every cited id read back. A missing id was hard-deleted (retention, eviction, import replace).
    if (reconcileOptions.liveness === true) {
      const cited = await citedLtmIds(scope);
      const found = new Map((await readLtm(scope, cited, signal)).map((note) => [note.id, note]));
      const missing = new Set(cited.filter((id) => !found.has(id)));
      const demoted = new Set([...found.values()].filter((note) => note.flagged || !isActive(note.status)).map((note) => note.id));
      report = add(report, await cascade(scope, missing, true));
      report = add(report, await cascade(scope, demoted, false));
    }
    return report;
  }

  async function refresh(refreshOptions: { readonly signal?: AbortSignal } = {}): Promise<WikiReconcileReport> {
    const port = ltm();
    if (port === undefined) return EMPTY;
    const epoch = port.epoch();
    let report = EMPTY;
    for (const scope of scopes()) {
      if (!ltmHas(scope)) continue;
      const first = !opened.has(scope);
      if (!first && epoch === seenEpoch) continue;
      if (first) await store.reload(scope);
      report = add(
        report,
        await reconcile(scope, { liveness: first, ...(refreshOptions.signal === undefined ? {} : { signal: refreshOptions.signal }) }),
      );
      opened.add(scope);
    }
    seenEpoch = epoch;
    return report;
  }

  async function readable(scope: WikiScopeLevel, ids: readonly string[], signal: AbortSignal | undefined): Promise<ReadonlySet<string>> {
    const out = new Set<string>();
    const own = new Map((await store.sources()).map((source) => [source.id, source]));
    const rest: string[] = [];
    for (const id of new Set(ids)) {
      const source = own.get(id);
      if (source !== undefined) {
        if (scope === "project" && source.refused === undefined) out.add(id);
      } else rest.push(id);
    }
    for (const note of await readLtm(scope, rest, signal)) if (!note.flagged && isActive(note.status)) out.add(note.id);
    return out;
  }

  // --- edits ----------------------------------------------------------------------------------------------------

  function checkText(text: string): string {
    const scan = scanScopedMemoryContent(text);
    if (!scan.ok) throw new ConceptFormatError(`refused:${scan.class}`, `refused: ${scan.class}`);
    return redact(text);
  }

  async function load(scope: WikiScopeLevel, subject: string): Promise<Working> {
    const record = await bySubject(scope, subject);
    if (record === undefined) throw new ConceptFormatError("unknown_subject", `no concept for subject ${subject}`);
    if (!live(record)) throw new ConceptFormatError("subject_archived", `the concept ${subject} is archived`);
    const { body, ...meta } = record;
    return { id: record.id, isNew: false, record, meta, doc: parseConceptBody(body, { allowUncited: true }), resolved: new Set() };
  }

  function claim(work: Working, id: string): ConceptItem {
    const found = work.doc.claims.find((item) => item.id === id);
    if (found === undefined) throw new ConceptFormatError("unknown_claim", `no claim ${id} in ${work.meta.subject}`);
    return found;
  }

  /** A person's item (marked, or with no citation at all) is read-only to everyone but a person. */
  const protectedItem = (item: ConceptItem): boolean => item.human === true || item.cites.length === 0;
  const refuseHuman = (item: ConceptItem, writer: ConceptWriter): void => {
    if (writer !== "human" && protectedItem(item)) {
      throw new ConceptFormatError("claim_human", `item ${item.id} was written by a person; only a person changes it`);
    }
  };
  const mark = (writer: ConceptWriter): { readonly human?: true } => (writer === "human" ? { human: true } : {});
  const itemCites = (cites: unknown, writer: ConceptWriter): readonly string[] => {
    const valid = validateCites(cites);
    if (valid.length === 0 && writer !== "human")
      throw new ConceptFormatError("uncited_claim", "a claim cites at least one note; only a person may write an uncited claim");
    return valid;
  };

  function checkAliases(value: unknown): readonly string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_CONCEPT_ALIASES)
      throw new ConceptFormatError("aliases_shape", `aliases is an array of at most ${MAX_CONCEPT_ALIASES} names`);
    const out: string[] = [];
    for (const alias of value) {
      if (typeof alias !== "string" || alias.trim().length === 0 || alias.length > 64)
        throw new ConceptFormatError("aliases_shape", "an alias is a non-empty string of at most 64 characters");
      const clean = checkText(alias.trim());
      if (!out.includes(clean)) out.push(clean);
    }
    return out;
  }

  function replaceItems(work: Working, kind: "claims" | "questions" | "contradictions", items: readonly ConceptItem[]): void {
    if (items.length > MAX_CONCEPT_ITEMS)
      throw new ConceptFormatError("too_many_items", `a concept holds at most ${MAX_CONCEPT_ITEMS} items of one kind`);
    work.doc = { ...work.doc, [kind]: items };
  }

  async function apply(scope: WikiScopeLevel, edits: readonly ConceptEdit[], writer: ConceptWriter, signal: AbortSignal | undefined) {
    const works = new Map<string, Working>();
    const cited = new Set<string>();
    const need = async (subject: unknown): Promise<Working> => {
      if (typeof subject !== "string") throw new ConceptFormatError("subject_shape", "an edit names a subject");
      validateNoteKey(subject);
      const known = works.get(subject);
      if (known !== undefined) return known;
      const loaded = await load(scope, subject);
      works.set(subject, loaded);
      return loaded;
    };
    const track = (cites: readonly string[]): void => {
      for (const cite of cites) cited.add(cite);
    };
    for (const edit of edits) {
      signal?.throwIfAborted();
      switch (edit.op) {
        case "create_subject": {
          const subject = validateNoteKey(edit.subject);
          if (works.has(subject) || (await bySubject(scope, subject)) !== undefined) {
            throw new ConceptFormatError("subject_exists", `subject ${subject} already has a concept`);
          }
          if (
            typeof edit.title !== "string" ||
            edit.title.trim().length === 0 ||
            edit.title.length > MAX_CONCEPT_TITLE_CHARS ||
            /[\r\n]/.test(edit.title)
          ) {
            throw new ConceptFormatError("title_shape", `a title is one line of at most ${MAX_CONCEPT_TITLE_CHARS} characters`);
          }
          if (!(CONCEPT_TYPES as readonly unknown[]).includes(edit.conceptType))
            throw new ConceptFormatError("concept_type", "conceptType is entity or topic");
          const title = checkText(edit.title.trim());
          const appliesTo = edit.appliesTo === undefined ? undefined : validateAppliesTo(edit.appliesTo);
          if (appliesTo !== undefined && scope !== "project")
            throw new ConceptFormatError("applies_to_scope", "appliesTo is valid on the project scope only");
          const at = now().toISOString();
          works.set(subject, {
            id: wikiConceptId(scope, subject),
            isNew: true,
            meta: {
              id: "",
              scope,
              subject,
              title,
              conceptType: edit.conceptType,
              aliases: checkAliases(edit.aliases),
              ...(appliesTo === undefined ? {} : { appliesTo }),
              links: [],
              stale: [],
              dirty: [],
              status: "verified",
              flags: [],
              generated: { by: writer, at },
              createdAt: at,
              uses: 0,
            },
            doc: { title, claims: [], questions: [], contradictions: [] },
            resolved: new Set(),
          });
          break;
        }
        case "add_claim": {
          const work = await need(edit.subject);
          const cites = itemCites(edit.cites, writer);
          track(cites);
          const text = checkText(validateItemText(edit.text));
          replaceItems(work, "claims", [...work.doc.claims, { id: nextItemId(work.doc, "claim"), text, cites, ...mark(writer) }]);
          break;
        }
        case "update_claim": {
          const work = await need(edit.subject);
          const existing = claim(work, edit.claimId);
          refuseHuman(existing, writer);
          const cites = itemCites(edit.cites, writer);
          track(cites);
          const text = checkText(validateItemText(edit.text));
          replaceItems(
            work,
            "claims",
            work.doc.claims.map((item) => (item.id === existing.id ? { id: item.id, text, cites, ...mark(writer) } : item)),
          );
          work.resolved.add(existing.id);
          break;
        }
        case "retire_claim": {
          const work = await need(edit.subject);
          const existing = claim(work, edit.claimId);
          refuseHuman(existing, writer);
          if (typeof edit.reason !== "string" || edit.reason.trim().length === 0 || edit.reason.length > 200) {
            throw new ConceptFormatError("reason_shape", "retire_claim needs a reason of at most 200 characters");
          }
          replaceItems(
            work,
            "claims",
            work.doc.claims.filter((item) => item.id !== existing.id),
          );
          work.resolved.add(existing.id);
          break;
        }
        case "merge_claims": {
          const work = await need(edit.subject);
          if (!Array.isArray(edit.claimIds) || edit.claimIds.length < 2)
            throw new ConceptFormatError("merge_shape", "merge_claims names at least two claims");
          const merged = [...new Set(edit.claimIds)].map((id) => claim(work, id));
          if (merged.length < 2) throw new ConceptFormatError("merge_shape", "merge_claims names at least two distinct claims");
          for (const item of merged) refuseHuman(item, writer);
          const cites = itemCites(edit.cites, writer);
          const union = new Set(merged.flatMap((item) => item.cites));
          if (cites.length !== union.size || cites.some((cite) => !union.has(cite))) {
            throw new ConceptFormatError("merge_cites", "merge_claims cites exactly the union of the merged claims' citations");
          }
          track(cites);
          const text = checkText(validateItemText(edit.text));
          const gone = new Set(merged.map((item) => item.id));
          const survivors = work.doc.claims.filter((item) => !gone.has(item.id));
          replaceItems(work, "claims", [...survivors, { id: nextItemId(work.doc, "claim"), text, cites, ...mark(writer) }]);
          for (const id of gone) work.resolved.add(id);
          break;
        }
        case "add_relation": {
          const work = await need(edit.subject);
          if (!isConceptRelation(edit.relation))
            throw new ConceptFormatError("relation", `relation is one of ${CONCEPT_RELATIONS.join(", ")}`);
          const target = typeof edit.target === "string" ? validateNoteKey(edit.target) : undefined;
          if (target === undefined || target === work.meta.subject)
            throw new ConceptFormatError("relation", "a relation targets another subject");
          const targetId = works.get(target)?.id ?? (await bySubject(scope, target))?.id;
          if (targetId === undefined) throw new ConceptFormatError("relation", `no concept for subject ${target}`);
          if (!work.meta.links.some((link) => link.id === targetId && link.relation === edit.relation)) {
            work.meta = { ...work.meta, links: [...work.meta.links, { id: targetId, relation: edit.relation }] };
          }
          break;
        }
        case "add_open_question": {
          const work = await need(edit.subject);
          const cites = itemCites(edit.cites, writer);
          track(cites);
          const text = checkText(validateItemText(edit.text));
          replaceItems(work, "questions", [...work.doc.questions, { id: nextItemId(work.doc, "question"), text, cites, ...mark(writer) }]);
          break;
        }
        case "note_contradiction": {
          const work = await need(edit.subject);
          const fromClaims = (edit.claimIds ?? []).flatMap((id) => claim(work, id).cites);
          const cites = itemCites([...new Set([...fromClaims, ...validateCites(edit.noteIds ?? [], "noteIds")])], writer);
          track(cites);
          const text = checkText(validateItemText(edit.text));
          replaceItems(work, "contradictions", [
            ...work.doc.contradictions,
            { id: nextItemId(work.doc, "contradiction"), text, cites, ...mark(writer) },
          ]);
          break;
        }
        default:
          throw new ConceptFormatError("unknown_op", `unknown edit operation: ${String((edit as { op?: unknown }).op)}`);
      }
    }
    return { works, cited };
  }

  async function checkCitations(scope: WikiScopeLevel, cited: ReadonlySet<string>, signal: AbortSignal | undefined): Promise<void> {
    if (cited.size === 0) return;
    const ok = await readable(scope, [...cited], signal);
    for (const id of cited) {
      // A foreign-scope, forgotten, revoked, flagged, inactive or unknown id is the same refusal.
      if (!ok.has(id)) throw new MemoryScopeError(`citation ${id} is not a readable active note of the ${scope} scope`);
    }
  }

  async function write(work: Working, writer: ConceptWriter): Promise<"written" | "archived"> {
    const at = now().toISOString();
    const keptIds = new Set(allItems(work.doc).map((item) => item.id));
    const stale = work.meta.stale.filter((id) => keptIds.has(id) && !work.resolved.has(id));
    const archive = work.doc.claims.length === 0;
    if (archive && work.isNew) throw new ConceptFormatError("empty_concept", `the new concept ${work.meta.subject} has no claim`);
    const body = renderConceptBody(work.doc);
    if (body.length > maxText) throw new ConceptFormatError("concept_too_long", "the concept body exceeds the entry text limit");
    const dirty = work.meta.dirty.filter((reason) => reason !== "stale");
    await store.putConcept({
      ...work.meta,
      id: work.id,
      title: work.doc.title,
      body,
      stale,
      dirty:
        stale.length === 0 ? dirty.filter((reason) => reason !== "removed") : [...dirty.filter((reason) => reason !== "removed"), "stale"],
      status: archive ? "archived" : work.meta.status === "archived" ? "verified" : work.meta.status,
      generated: { by: writer, at },
    });
    return archive ? "archived" : "written";
  }

  // --- the port -------------------------------------------------------------------------------------------------

  return {
    store,
    scopes,
    memory: () => ltm() !== undefined,
    sourceRoot: () => options.sourceRoot ?? store.root,
    async indexSource(input) {
      const scope: WikiScopeLevel = "project";
      await pinOwner(scope);
      const scan = scanScopedMemoryContent(input.text);
      const id = wikiSourceId(dirname(input.path));
      const record: WikiSourceRecord = {
        id,
        path: input.path,
        title: input.title,
        keywords: [...(input.keywords ?? [])],
        contentHash: input.contentHash,
        createdAt: now().toISOString(),
        ...(scan.ok ? {} : { refused: scan.class }),
      };
      await store.putSource(record, input.text);
      if (!scan.ok) return { indexed: false, scope, refused: scan.class };
      // Deterministic binding at the wiki's write time: exactly one subject's name in the text, or none.
      const subject = (await matcherFor(scope)).match(input.text, input.keywords ?? []);
      if (subject !== undefined) {
        await store.bind(scope, id, subject);
        await markEvidenceDirty(scope, subject, [id]);
      }
      return { indexed: true, scope, id, ...(subject === undefined ? {} : { subject }) };
    },
    screen(text) {
      const scan = scanScopedMemoryContent(text);
      return scan.ok ? undefined : scan.class;
    },
    async subjects(scope) {
      readableScope(scope);
      await pinOwner(scope);
      return (await store.concepts(scope)).filter(live).map((record) => ({
        subject: record.subject,
        title: record.title,
        aliases: record.aliases,
        conceptId: record.id,
        conceptType: record.conceptType,
        dirty: record.dirty,
      }));
    },
    async pending(scope, pendingOptions = {}) {
      readableScope(scope);
      await pinOwner(scope);
      const signal = pendingOptions.signal;
      const limit = Math.min(Math.max(1, Math.trunc(pendingOptions.limit ?? DEFAULT_ONTOLOGY_PENDING)), MAX_ONTOLOGY_PENDING);
      const bindings = await store.bindings(scope);
      const rows: { id: string; createdAt: string; source?: WikiSourceRecord }[] = [];
      const keep = (id: string, stored: string | undefined, coRead: number): boolean => {
        const subject = subjectOf(bindings, id, stored);
        if (pendingOptions.subject !== undefined && subject !== pendingOptions.subject) return false;
        if (pendingOptions.unbound === true && subject !== undefined) return false;
        if (pendingOptions.coRead === true && coRead === 0) return false;
        return true;
      };
      if (scope === "project") {
        for (const source of await store.sources()) {
          if (source.refused !== undefined || !keep(source.id, undefined, 0)) continue;
          rows.push({ id: source.id, createdAt: source.createdAt, source });
        }
      }
      const port = ltm();
      if (port !== undefined && ltmHas(scope)) {
        let cursor: string | undefined;
        do {
          const page = await port.scanMetadata(scope, {
            limit: 500,
            ...(cursor === undefined ? {} : { cursor }),
            ...(signal === undefined ? {} : { signal }),
          });
          for (const note of page.notes) {
            if (note.flagged || !isActive(note.status) || !keep(note.id, note.subject, note.coRead?.length ?? 0)) continue;
            rows.push({ id: note.id, createdAt: note.createdAt });
          }
          cursor = page.cursor;
        } while (cursor !== undefined);
      }
      rows.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
      const after = pendingOptions.cursor;
      const eligible = after === undefined ? rows : rows.filter((row) => `${row.createdAt}|${row.id}` > after);
      const slice = eligible.slice(0, limit);
      const ltmNotes = new Map(
        (
          await readLtm(
            scope,
            slice.filter((row) => row.source === undefined).map((row) => row.id),
            signal,
          )
        ).map((note) => [note.id, note]),
      );
      const notes: OntologyNoteView[] = [];
      for (const row of slice) {
        if (row.source !== undefined) {
          const text = await store.sourceText(row.id);
          if (text !== undefined) notes.push(sourceView(row.source, text, bindings.get(row.id)));
          continue;
        }
        const note = ltmNotes.get(row.id);
        if (note !== undefined) notes.push(ltmView(note, subjectOf(bindings, note.id, note.subject)));
      }
      const last = slice.at(-1);
      return { notes, ...(eligible.length > slice.length && last !== undefined ? { cursor: `${last.createdAt}|${last.id}` } : {}) };
    },
    async read(scope, ids, readOptions = {}) {
      readableScope(scope);
      await pinOwner(scope);
      if (!Array.isArray(ids) || ids.length > MAX_ONTOLOGY_READ_IDS)
        throw new MemoryValidationError(`read takes at most ${MAX_ONTOLOGY_READ_IDS} ids`);
      const concepts = new Map((await store.concepts(scope)).map((record) => [record.id, record]));
      const own = new Map((await store.sources()).map((source) => [source.id, source]));
      const bindings = await store.bindings(scope);
      const out = new Map<string, OntologyNoteView>();
      const rest: string[] = [];
      for (const id of ids) {
        const concept = concepts.get(id);
        if (concept !== undefined) {
          out.set(id, conceptView(concept));
          continue;
        }
        const source = scope === "project" ? own.get(id) : undefined;
        if (source !== undefined) {
          const text = await store.sourceText(id);
          if (text !== undefined && source.refused === undefined) out.set(id, sourceView(source, text, bindings.get(id)));
          continue;
        }
        rest.push(id);
      }
      for (const note of await readLtm(scope, rest, readOptions.signal))
        out.set(note.id, ltmView(note, subjectOf(bindings, note.id, note.subject)));
      return ids.flatMap((id) => {
        const view = out.get(id);
        return view === undefined ? [] : [view];
      });
    },
    async applyConceptEdits(scope, edits, applyOptions) {
      writable(scope);
      await pinOwner(scope);
      if (applyOptions === null || typeof applyOptions !== "object" || !CONCEPT_WRITERS.includes(applyOptions.generatedBy)) {
        throw new ConceptFormatError("writer", `generatedBy is one of ${CONCEPT_WRITERS.join(", ")}`);
      }
      if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_CONCEPT_EDITS) {
        throw new ConceptFormatError("edits_shape", `a batch holds 1 to ${MAX_CONCEPT_EDITS} edits`);
      }
      const { works, cited } = await apply(scope, edits, applyOptions.generatedBy, applyOptions.signal);
      await checkCitations(scope, cited, applyOptions.signal);
      // Every edit validated: only now does anything touch the store.
      const subjects: string[] = [];
      const archived: string[] = [];
      for (const [subject, work] of works) {
        const result = await write(work, applyOptions.generatedBy);
        subjects.push(subject);
        if (result === "archived") archived.push(subject);
      }
      return { subjects, edits: edits.length, archived };
    },
    async bind(scope, noteId, subject, bindOptions = {}) {
      writable(scope);
      await pinOwner(scope);
      validateNoteKey(subject);
      const concepts = await store.concepts(scope);
      if (concepts.some((record) => record.id === noteId))
        throw new MemoryValidationError("only an evidence note can be bound to a subject");
      if (!(await readable(scope, [noteId], bindOptions.signal)).has(noteId)) return false;
      await store.bind(scope, noteId, subject);
      await markEvidenceDirty(scope, subject, [noteId]);
      return true;
    },
    async dirty(scope) {
      readableScope(scope);
      await pinOwner(scope);
      return (await store.concepts(scope))
        .filter((record) => live(record) && record.dirty.length > 0)
        .map((record) => ({ subject: record.subject, conceptId: record.id, reasons: record.dirty }));
    },
    async settle(scope, subject) {
      writable(scope);
      await pinOwner(scope);
      validateNoteKey(subject);
      const record = await bySubject(scope, subject);
      if (record === undefined || !record.dirty.includes("evidence")) return false;
      await store.putConcept({ ...record, dirty: record.dirty.filter((reason) => reason !== "evidence") });
      return true;
    },
    async bindPending(scope, bindOptions = {}) {
      const port = ltm();
      if (port === undefined || !ltmHas(scope) || !WRITE_SCOPES.includes(scope)) return 0;
      await pinOwner(scope);
      const bindings = await store.bindings(scope);
      const keyed: LtmNoteMeta[] = [];
      const unkeyed: LtmNoteMeta[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_BIND_PAGES; page += 1) {
        const result = await port.scanMetadata(scope, {
          limit: 500,
          ...(cursor === undefined ? {} : { cursor }),
          ...(bindOptions.signal === undefined ? {} : { signal: bindOptions.signal }),
        });
        for (const note of result.notes) {
          if (note.flagged || !isActive(note.status) || bindings.has(note.id)) continue;
          (note.subject === undefined ? unkeyed : keyed).push(note);
        }
        cursor = result.cursor;
        if (cursor === undefined) break;
      }
      const touched = new Map<string, string[]>();
      const record = async (id: string, subject: string): Promise<void> => {
        await store.bind(scope, id, subject);
        touched.set(subject, [...(touched.get(subject) ?? []), id]);
      };
      // A topic key the writer gave is adopted as is; the rest bind by name, deterministically, or stay unbound.
      for (const note of keyed) await record(note.id, note.subject!);
      const matcher = await matcherFor(scope);
      if (matcher.size > 0) {
        let seen = tried.get(scope);
        if (seen === undefined || seen.matcher !== matcher) tried.set(scope, (seen = { matcher, ids: new Set() }));
        const fresh = unkeyed.filter((candidate) => !seen!.ids.has(candidate.id));
        for (const note of await readLtm(
          scope,
          fresh.map((candidate) => candidate.id),
          bindOptions.signal,
        )) {
          seen.ids.add(note.id);
          const subject = matcher.match(note.text, note.keywords ?? []);
          if (subject !== undefined) await record(note.id, subject);
        }
      }
      for (const [subject, ids] of touched) await markEvidenceDirty(scope, subject, ids);
      return [...touched.values()].reduce((sum, ids) => sum + ids.length, 0);
    },
    refresh,
    reconcile,
    async readable(scope, ids, readOptions = {}) {
      await pinOwner(scope);
      return readable(scope, ids, readOptions.signal);
    },
    async concepts(scope) {
      await pinOwner(scope);
      return store.concepts(scope);
    },
    async noteUse(scope, id) {
      await pinOwner(scope);
      const record = (await store.concepts(scope)).find((entry) => entry.id === id);
      if (record !== undefined) await store.putConcept({ ...record, uses: record.uses + 1 });
    },
  };
}
