/**
 * The `memory.fabric` service (plan 207 Task 2): the narrow, typed port through which the wiki package (the
 * ontology tier's curator) reads T1 evidence and edits concept notes. The fabric owns storage, validity and the
 * deletion cascade; the consumer owns synthesis. Nothing here calls a model.
 */
import { randomUUID } from "node:crypto";
import type { JsonObject } from "@arnilo/prism";
import { type Memory, MemoryScopeError, MemoryValidationError, type MemoryVectorRecord, type VectorStore } from "@arnilo/prism-memory-core";
import { createMemoryId } from "@arnilo/prism-memory-observational";
import { memoryRetractionVersion, noteMemoryWrite } from "../directory.js";
import { scanScopedMemoryContent } from "../scoped/trust.js";
import {
  CONCEPT_RELATIONS,
  CONCEPT_TYPES,
  type ConceptDirtyReason,
  type ConceptRelation,
  type ConceptType,
  encodeMemoryNoteMetadata,
  type FabricScopeLevel,
  isConceptRelation,
  MAX_CONCEPT_ALIASES,
  MAX_CONCEPT_TITLE_CHARS,
  type MemoryNoteActor,
  type MemoryNoteKind,
  type MemoryNoteMetadata,
  parseMemoryNoteMetadata,
  stampProvenance,
  validateAppliesTo,
  validateNoteKey,
} from "../types.js";
import { type ConceptCascade, type ConceptCascadeReport, createConceptCascade } from "./cascade.js";
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
import { createFabricSubjects, type FabricSubjects } from "./index.js";
import { type MemoryRetractEvent, setMemoryRetractListener } from "./retract.js";
import { type ConceptIndex, type ConceptRow, conceptMetadata, createConceptIndex, type OntologyScope, rowFromMetadata } from "./state.js";

/** The service name the wiki package declares in `requires.services`. */
export const MEMORY_FABRIC_SERVICE = "memory.fabric";

export const MAX_ONTOLOGY_READ_IDS = 32;
export const MAX_ONTOLOGY_PENDING = 64;
export const DEFAULT_ONTOLOGY_PENDING = 24;
export const MAX_CONCEPT_EDITS = 64;

/** Who may stamp a concept write; `agent`, `promotion` and `import` are not curators. */
export type ConceptWriter = Extract<MemoryNoteActor, "consolidation" | "human" | "host">;
const WRITERS: readonly string[] = ["consolidation", "human", "host"];

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

/** One T1 note as the curator sees it: scope-, consent- and invalidation-filtered, redacted, text capped. */
export interface OntologyNoteView {
  readonly id: string;
  readonly kind: MemoryNoteKind;
  readonly scope: FabricScopeLevel;
  readonly createdAt: string;
  readonly text: string;
  readonly subject?: string;
  readonly key?: string;
  readonly tRef?: string;
  readonly status?: string;
}

export interface OntologyPendingPage {
  readonly notes: readonly OntologyNoteView[];
  /** Pass this back as `cursor` for the next page; absent when the page was the last. */
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
      /** Project-root-relative globs; the concept is then a `path`-scope note in the project. */
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
  /** Subjects written, in first-touched order. */
  readonly subjects: readonly string[];
  readonly edits: number;
  /** Subjects archived because the batch left them with no claim. */
  readonly archived: readonly string[];
}

export interface FabricOntologyPort {
  /** Readable scope levels, narrowest first. */
  scopes(): readonly FabricScopeLevel[];
  /** The ontology index: one entry per live concept of a scope. */
  subjects(scope: FabricScopeLevel, options?: { readonly signal?: AbortSignal }): Promise<readonly OntologySubject[]>;
  /** T1 notes written after `cursor`, oldest first. */
  pending(
    scope: FabricScopeLevel,
    options?: { readonly cursor?: string; readonly limit?: number; readonly signal?: AbortSignal },
  ): Promise<OntologyPendingPage>;
  /** Up to {@link MAX_ONTOLOGY_READ_IDS} notes, through the same filters as `memory.read`. */
  read(scope: FabricScopeLevel, ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly OntologyNoteView[]>;
  /** Validate the whole batch, then write it; any invalid edit rejects the batch and writes nothing. */
  applyConceptEdits(
    scope: FabricScopeLevel,
    edits: readonly ConceptEdit[],
    options: ApplyConceptEditsOptions,
  ): Promise<ApplyConceptEditsResult>;
  /** Bind a T1 note to a subject in its own scope. The subject may not have a concept yet. */
  bind(scope: FabricScopeLevel, noteId: string, subject: string, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  /** Concepts that need a pass, and why. */
  dirty(scope: FabricScopeLevel, options?: { readonly signal?: AbortSignal }): Promise<readonly OntologyDirtyEntry[]>;
}

export interface FabricOntology {
  readonly port: FabricOntologyPort;
  /**
   * Run the deletion cascade for notes retracted outside the fabric's own write path (a deletion propagator
   * tombstones through the store). `resourceId` narrows it to one scope; the report sums every scope it ran.
   */
  retract(
    event: MemoryRetractEvent,
    options?: { readonly resourceId?: string; readonly signal?: AbortSignal },
  ): Promise<ConceptCascadeReport>;
  /** Register the deletion cascade on a scope memory (also on scopes opened later). */
  attach(scope: OntologyScope): void;
  /**
   * Notes whose metadata changed outside the port (a recorded use): refresh the index row of any that is a concept, so
   * the directory's use ordering follows it (plan 207 Task 4). Cheap: one `get` per scope, none for a non-concept.
   */
  refresh(ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** The index of a scope, for diagnostics and tests. */
  index(scope: FabricScopeLevel): ConceptIndex | undefined;
  /** What the write path binds notes with and what the extractor prompt and the directory show (Task 3). */
  readonly subjects: FabricSubjects;
}

const WRITE_SCOPES: readonly FabricScopeLevel[] = ["user", "project"];
const ACTIVE_STATUSES = new Set(["verified", "candidate"]);

interface ScopeState extends OntologyScope {
  readonly index: ConceptIndex;
}

interface Working {
  readonly id: string;
  readonly isNew: boolean;
  readonly record?: MemoryVectorRecord;
  meta: MemoryNoteMetadata;
  doc: ConceptDoc;
  /** Item ids edited or removed by this batch (their staleness is resolved). */
  readonly resolved: Set<string>;
}

export function createFabricOntology(deps: {
  readonly scopes: readonly OntologyScope[];
  readonly store: VectorStore;
  readonly redact?: (text: string) => string;
  readonly now?: () => Date;
  /** `ontology.bindThreshold`: matched tokens of one name that bind a note (default 2). */
  readonly bindThreshold?: number;
}): FabricOntology {
  const now = deps.now ?? (() => new Date());
  const redact = deps.redact ?? ((text: string) => text);
  const states = new Map<FabricScopeLevel, ScopeState>();
  const attached = new WeakSet<object>();
  const cascades = new Map<Memory, ConceptCascade>();

  const register = (scope: OntologyScope): ScopeState => {
    const index = createConceptIndex({ memory: scope.memory, store: deps.store });
    const state: ScopeState = { ...scope, index };
    if (!attached.has(scope.memory)) {
      attached.add(scope.memory);
      const cascade = createConceptCascade({ memory: scope.memory, store: deps.store, index, now });
      cascades.set(scope.memory, cascade);
      setMemoryRetractListener(scope.memory, async (event) => {
        await cascade.handle(event);
      });
    }
    return state;
  };
  for (const scope of deps.scopes) if (!states.has(scope.level)) states.set(scope.level, register(scope));

  const stateOf = (level: FabricScopeLevel): ScopeState => {
    const state = states.get(level);
    if (state === undefined) throw new MemoryScopeError(`the ${level} scope is not readable here`);
    return state;
  };
  const writable = (level: FabricScopeLevel): ScopeState => {
    // `agent` concepts come only from widening and `team` concepts only from `memory:share`.
    if (!WRITE_SCOPES.includes(level)) {
      throw new MemoryScopeError(`the ontology port does not write ${level} concepts; use user or project`);
    }
    return stateOf(level);
  };

  const cap = (text: string, limit: number): string => (text.length > limit ? text.slice(0, limit) : text);

  const view = (state: ScopeState, record: MemoryVectorRecord): OntologyNoteView | undefined => {
    const note = parseMemoryNoteMetadata(record.metadata);
    if (note === undefined) return undefined;
    const status = typeof record.metadata?.status === "string" ? record.metadata.status : undefined;
    return {
      id: record.id,
      kind: note.kind,
      scope: state.level,
      createdAt: record.createdAt,
      text: cap(record.text, state.memory.limits.maxEntryTextChars),
      ...(note.subject === undefined ? {} : { subject: note.subject }),
      ...(note.key === undefined ? {} : { key: note.key }),
      ...(note.tRef === undefined ? {} : { tRef: note.tRef }),
      ...(status === undefined ? {} : { status }),
    };
  };

  function checkText(text: string): string {
    const scan = scanScopedMemoryContent(text);
    if (!scan.ok) throw new ConceptFormatError(`refused:${scan.class}`, `refused: ${scan.class}`);
    return redact(text);
  }

  async function load(state: ScopeState, subject: string, signal: AbortSignal | undefined): Promise<Working> {
    const row = await state.index.bySubject(subject, signal);
    if (row === undefined) throw new ConceptFormatError("unknown_subject", `no concept for subject ${subject}`);
    if (row.status === "archived" || row.status === "retired")
      throw new ConceptFormatError("subject_archived", `the concept ${subject} is archived`);
    const [record] = await state.memory.get([row.id], signal === undefined ? {} : { signal });
    const meta = record === undefined ? undefined : parseMemoryNoteMetadata(record.metadata);
    if (record === undefined || meta === undefined)
      throw new ConceptFormatError("unknown_subject", `the concept ${subject} is not readable`);
    return { id: row.id, isNew: false, record, meta, doc: parseConceptBody(record.text, { allowUncited: true }), resolved: new Set() };
  }

  function claim(work: Working, id: string): ConceptItem {
    const found = work.doc.claims.find((item) => item.id === id);
    if (found === undefined) throw new ConceptFormatError("unknown_claim", `no claim ${id} in ${work.meta.subject}`);
    return found;
  }

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

  async function apply(
    state: ScopeState,
    edits: readonly ConceptEdit[],
    options: ApplyConceptEditsOptions,
  ): Promise<{ readonly works: Map<string, Working>; readonly cited: Set<string> }> {
    const works = new Map<string, Working>();
    const cited = new Set<string>();
    const writer = options.generatedBy;
    const need = async (subject: unknown): Promise<Working> => {
      if (typeof subject !== "string") throw new ConceptFormatError("subject_shape", "an edit names a subject");
      validateNoteKey(subject);
      const known = works.get(subject);
      if (known !== undefined) return known;
      const loaded = await load(state, subject, options.signal);
      works.set(subject, loaded);
      return loaded;
    };
    const track = (cites: readonly string[]): void => {
      for (const cite of cites) cited.add(cite);
    };
    for (const edit of edits) {
      options.signal?.throwIfAborted();
      switch (edit.op) {
        case "create_subject": {
          const subject = validateNoteKey(edit.subject);
          if (works.has(subject) || (await state.index.bySubject(subject, options.signal)) !== undefined) {
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
          if (appliesTo !== undefined && state.level !== "project")
            throw new ConceptFormatError("applies_to_scope", "appliesTo is valid on the project scope only");
          const meta: MemoryNoteMetadata = {
            v: 1,
            kind: "concept",
            subject,
            title,
            conceptType: edit.conceptType,
            aliases: checkAliases(edit.aliases),
            scope: appliesTo === undefined ? state.level : "path",
            ...(appliesTo === undefined ? {} : { appliesTo }),
          };
          works.set(subject, {
            id: createMemoryId("fabric", "concept", state.level, subject, randomUUID()),
            isNew: true,
            meta,
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
          replaceItems(work, "claims", [...work.doc.claims, { id: nextItemId(work.doc, "claim"), text, cites }]);
          break;
        }
        case "update_claim": {
          const work = await need(edit.subject);
          const existing = claim(work, edit.claimId);
          const cites = itemCites(edit.cites, writer);
          track(cites);
          const text = checkText(validateItemText(edit.text));
          replaceItems(
            work,
            "claims",
            work.doc.claims.map((item) => (item.id === existing.id ? { id: item.id, text, cites } : item)),
          );
          work.resolved.add(existing.id);
          break;
        }
        case "retire_claim": {
          const work = await need(edit.subject);
          const existing = claim(work, edit.claimId);
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
          const cites = itemCites(edit.cites, writer);
          const union = new Set(merged.flatMap((item) => item.cites));
          // The merged claim keeps every citation of the claims it replaces, and adds none it cannot show.
          if (cites.length !== union.size || cites.some((cite) => !union.has(cite))) {
            throw new ConceptFormatError("merge_cites", "merge_claims cites exactly the union of the merged claims' citations");
          }
          track(cites);
          const text = checkText(validateItemText(edit.text));
          const gone = new Set(merged.map((item) => item.id));
          const survivors = work.doc.claims.filter((item) => !gone.has(item.id));
          replaceItems(work, "claims", [...survivors, { id: nextItemId({ ...work.doc, claims: work.doc.claims }, "claim"), text, cites }]);
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
          const targetId = works.get(target)?.id ?? (await state.index.bySubject(target, options.signal))?.id;
          if (targetId === undefined) throw new ConceptFormatError("relation", `no concept for subject ${target}`);
          const links = work.meta.links ?? [];
          if (!links.some((link) => link.id === targetId && link.relation === edit.relation)) {
            work.meta = { ...work.meta, links: [...links, { id: targetId, relation: edit.relation }] };
          }
          break;
        }
        case "add_open_question": {
          const work = await need(edit.subject);
          const cites = itemCites(edit.cites, writer);
          track(cites);
          const text = checkText(validateItemText(edit.text));
          replaceItems(work, "questions", [...work.doc.questions, { id: nextItemId(work.doc, "question"), text, cites }]);
          break;
        }
        case "note_contradiction": {
          const work = await need(edit.subject);
          const fromClaims = (edit.claimIds ?? []).flatMap((id) => claim(work, id).cites);
          const cites = itemCites([...new Set([...fromClaims, ...validateCites(edit.noteIds ?? [], "noteIds")])], writer);
          track(cites);
          const text = checkText(validateItemText(edit.text));
          replaceItems(work, "contradictions", [...work.doc.contradictions, { id: nextItemId(work.doc, "contradiction"), text, cites }]);
          break;
        }
        default:
          throw new ConceptFormatError("unknown_op", `unknown edit operation: ${String((edit as { op?: unknown }).op)}`);
      }
    }
    return { works, cited };
  }

  async function checkCitations(state: ScopeState, cited: ReadonlySet<string>, signal: AbortSignal | undefined): Promise<void> {
    if (cited.size === 0) return;
    const ids = [...cited];
    const found = new Map<string, MemoryVectorRecord>();
    for (let offset = 0; offset < ids.length; offset += 64) {
      for (const record of await state.memory.get(ids.slice(offset, offset + 64), signal === undefined ? {} : { signal }))
        found.set(record.id, record);
    }
    for (const id of ids) {
      const record = found.get(id);
      // A foreign-scope, forgotten, revoked or unknown id is the same refusal: the batch cites nothing it cannot read here.
      if (record === undefined) throw new MemoryScopeError(`citation ${id} is not a readable note of the ${state.level} scope`);
      const note = parseMemoryNoteMetadata(record.metadata);
      const status = typeof record.metadata?.status === "string" ? record.metadata.status : "verified";
      if (
        note === undefined ||
        note.kind === "concept" ||
        note.kind === "working" ||
        !ACTIVE_STATUSES.has(status) ||
        (note.flags?.length ?? 0) > 0
      ) {
        throw new ConceptFormatError("cites_inactive", `citation ${id} is not an active evidence note`);
      }
    }
  }

  async function write(state: ScopeState, work: Working, writer: ConceptWriter): Promise<"written" | "archived"> {
    const at = now().toISOString();
    const keptIds = new Set([...work.doc.claims, ...work.doc.questions, ...work.doc.contradictions].map((item) => item.id));
    const stale = (work.meta.stale ?? []).filter((id) => keptIds.has(id) && !work.resolved.has(id));
    const archive = work.doc.claims.length === 0;
    if (archive && work.isNew) throw new ConceptFormatError("empty_concept", `the new concept ${work.meta.subject} has no claim`);
    const text = renderConceptBody(work.doc);
    if (text.length > state.memory.limits.maxEntryTextChars)
      throw new ConceptFormatError("concept_too_long", "the concept body exceeds the entry text limit");
    const { stale: _stale, dirty: _dirty, archivedAt: _archivedAt, archivedFrom: _archivedFrom, ...rest } = work.meta;
    const fabric: MemoryNoteMetadata = {
      ...rest,
      title: work.doc.title,
      sources: conceptSources(work.doc),
      ...(stale.length === 0 ? {} : { stale, dirty: ["stale" as const] }),
      ...(archive ? { archivedAt: at, archivedFrom: "verified" as const } : {}),
    };
    const previousStatus = typeof work.record?.metadata?.status === "string" ? work.record.metadata.status : undefined;
    const status = archive ? "archived" : previousStatus === "archived" ? undefined : previousStatus;
    const metadata = conceptMetadata(work.record?.metadata, encodeMemoryNoteMetadata(fabric), {
      generated: stampProvenance(writer, at) as unknown as JsonObject,
      status,
    });
    await state.memory.remember(
      {
        entries: [
          {
            id: work.id,
            text,
            createdAt: work.record?.createdAt ?? at,
            metadata,
            ...(work.record?.consent === undefined ? {} : { consent: work.record.consent }),
          },
        ],
      },
      { wait: true },
    );
    const row = rowFromMetadata(work.id, metadata);
    if (row !== undefined) state.index.upsert(row);
    noteMemoryWrite(state.memory);
    return archive ? "archived" : "written";
  }

  /** Flag a concept for another pass: evidence was bound to it. The index row follows the stored note. */
  async function markEvidenceDirty(state: ScopeState, row: ConceptRow, signal?: AbortSignal): Promise<void> {
    await state.memory.patchMetadata(
      row.id,
      (metadata) => {
        const note = parseMemoryNoteMetadata(metadata);
        if (note === undefined) return metadata;
        return { ...metadata, fabric: encodeMemoryNoteMetadata({ ...note, dirty: [...(note.dirty ?? []), "evidence" as const] }) };
      },
      signal === undefined ? {} : { signal },
    );
    state.index.upsert({ ...row, dirty: [...row.dirty, "evidence"] });
  }

  const subjects = createFabricSubjects({
    index: (level) => states.get(level)?.index,
    levels: () => [...states.keys()],
    markDirty: (level, row, signal) => markEvidenceDirty(stateOf(level), row, signal),
    epoch: () => [...states.values()].reduce((sum, state) => sum + memoryRetractionVersion(state.memory), 0),
    ...(deps.bindThreshold === undefined ? {} : { bindThreshold: deps.bindThreshold }),
  });

  const port: FabricOntologyPort = {
    scopes: () => deps.scopes.map((scope) => scope.level),
    async subjects(scope, options = {}) {
      const state = stateOf(scope);
      return (await state.index.subjects(options.signal)).map((row) => ({
        subject: row.subject,
        title: row.title,
        aliases: row.aliases,
        conceptId: row.id,
        conceptType: row.conceptType,
        dirty: row.dirty,
      }));
    },
    async pending(scope, options = {}) {
      const state = stateOf(scope);
      const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? DEFAULT_ONTOLOGY_PENDING)), MAX_ONTOLOGY_PENDING);
      const { tenantId, resourceId } = state.memory.scope;
      const rows: { id: string; createdAt: string }[] = [];
      if (deps.store.scanMetadata === undefined) throw new MemoryValidationError("pending notes need a store with scanMetadata");
      let cursor: string | undefined;
      do {
        const page = await deps.store.scanMetadata({
          scope: { tenantId, resourceId },
          limit: 500,
          ...(cursor === undefined ? {} : { cursor }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        for (const row of page.rows) {
          const note = parseMemoryNoteMetadata(row.metadata);
          const status = typeof row.metadata?.status === "string" ? row.metadata.status : "verified";
          if (note === undefined || note.kind === "concept" || note.kind === "working" || note.kind === "episode") continue;
          if (!ACTIVE_STATUSES.has(status) || (note.flags?.length ?? 0) > 0) continue;
          rows.push({ id: row.id, createdAt: row.createdAt });
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      rows.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
      const after = options.cursor;
      const eligible = after === undefined ? rows : rows.filter((row) => `${row.createdAt}|${row.id}` > after);
      const slice = eligible.slice(0, limit);
      const records = new Map<string, MemoryVectorRecord>();
      for (const record of await state.memory.get(
        slice.map((row) => row.id),
        options.signal === undefined ? {} : { signal: options.signal },
      )) {
        records.set(record.id, record);
      }
      const notes = slice.flatMap((row) => {
        const record = records.get(row.id);
        const item = record === undefined ? undefined : view(state, record);
        return item === undefined ? [] : [item];
      });
      const last = slice.at(-1);
      return {
        notes,
        ...(eligible.length > slice.length && last !== undefined ? { cursor: `${last.createdAt}|${last.id}` } : {}),
      };
    },
    async read(scope, ids, options = {}) {
      const state = stateOf(scope);
      if (!Array.isArray(ids) || ids.length > MAX_ONTOLOGY_READ_IDS) {
        throw new MemoryValidationError(`read takes at most ${MAX_ONTOLOGY_READ_IDS} ids`);
      }
      const records = await state.memory.get(ids, options.signal === undefined ? {} : { signal: options.signal });
      return records.flatMap((record) => {
        const item = view(state, record);
        return item === undefined ? [] : [item];
      });
    },
    async applyConceptEdits(scope, edits, options) {
      const state = writable(scope);
      if (options === null || typeof options !== "object" || !WRITERS.includes(options.generatedBy)) {
        throw new ConceptFormatError("writer", `generatedBy is one of ${WRITERS.join(", ")}`);
      }
      if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_CONCEPT_EDITS) {
        throw new ConceptFormatError("edits_shape", `a batch holds 1 to ${MAX_CONCEPT_EDITS} edits`);
      }
      const { works, cited } = await apply(state, edits, options);
      await checkCitations(state, cited, options.signal);
      // Every edit validated: only now does anything touch the store.
      const subjects: string[] = [];
      const archived: string[] = [];
      for (const [subject, work] of works) {
        const result = await write(state, work, options.generatedBy);
        subjects.push(subject);
        if (result === "archived") archived.push(subject);
      }
      return { subjects, edits: edits.length, archived };
    },
    async bind(scope, noteId, subject, options = {}) {
      const state = writable(scope);
      validateNoteKey(subject);
      const ok = await state.memory.patchMetadata(
        noteId,
        (metadata) => {
          const note = parseMemoryNoteMetadata(metadata);
          if (note === undefined || note.kind === "concept" || note.kind === "working") {
            throw new MemoryValidationError("only an evidence note can be bound to a subject");
          }
          return { ...metadata, fabric: encodeMemoryNoteMetadata({ ...note, subject }) };
        },
        options.signal === undefined ? {} : { signal: options.signal },
      );
      if (!ok) return false;
      const row = await state.index.bySubject(subject, options.signal);
      if (row !== undefined && !row.dirty.includes("evidence")) await markEvidenceDirty(state, row, options.signal);
      return true;
    },
    async dirty(scope, options = {}) {
      const state = stateOf(scope);
      return (await state.index.subjects(options.signal))
        .filter((row) => row.dirty.length > 0)
        .map((row) => ({ subject: row.subject, conceptId: row.id, reasons: row.dirty }));
    },
  };

  return {
    port,
    subjects,
    async retract(event, options = {}) {
      let report: ConceptCascadeReport = { concepts: 0, removed: 0, stale: 0, archived: 0 };
      for (const [memory, cascade] of cascades) {
        if (options.resourceId !== undefined && memory.scope.resourceId !== options.resourceId) continue;
        const one = await cascade.handle(event, options.signal);
        report = {
          concepts: report.concepts + one.concepts,
          removed: report.removed + one.removed,
          stale: report.stale + one.stale,
          archived: report.archived + one.archived,
        };
      }
      return report;
    },
    attach(scope) {
      const state = register(scope);
      if (!states.has(scope.level)) states.set(scope.level, state);
    },
    async refresh(ids, options = {}) {
      if (ids.length === 0) return;
      for (const state of states.values()) {
        for (const record of await state.memory.get(ids, options.signal === undefined ? {} : { signal: options.signal })) {
          const row = rowFromMetadata(record.id, record.metadata);
          if (row !== undefined) state.index.upsert(row);
        }
      }
    },
    index: (level) => states.get(level)?.index,
  };
}
