import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, opendir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MemoryValidationError } from "../errors.js";
import { type MemoryLimitsInput, resolveMemoryLimits } from "../limits.js";
import { recordBlocked } from "../lineage.js";
import { createSqliteMemoryStores, type SqliteMemoryStores } from "../sqlite/index.js";
import type {
  MemoryScope,
  MemoryVectorRecord,
  ScopeCounterKey,
  VectorDeleteFilter,
  VectorLexicalQuery,
  VectorListResourcesQuery,
  VectorQuery,
  VectorScanMetadataQuery,
  VectorStore,
  WorkingMemoryRecord,
  WorkingMemoryStore,
} from "../types.js";
import { assertNotAborted, requireNonEmptyString, requireScope } from "../util.js";
import {
  assertInsideRoot,
  directoryForKind,
  FILE_MAP_FILE,
  fabricFlags,
  fabricKind,
  INDEX_DB_FILE,
  INDEX_FILE,
  isArchived,
  isIndexOnlyKind,
  isNoteRelPath,
  LOG_FILE,
  noteDescription,
  noteRelPath,
  noteTitle,
  provenanceActor,
  STATE_FILE,
  scopeDirectory,
  stateRelPath,
  WORKING_DIRECTORY,
  workingRelPath,
} from "./layout.js";
import { createWriteLock } from "./lock.js";
import {
  type IndexEntry,
  type LogEntry,
  type NoteClassifier,
  parseLogFile,
  parseNoteFile,
  parseWorkingFile,
  renderIndexFile,
  renderLogFile,
  renderNoteFile,
  renderWorkingFile,
  unreadableReason,
} from "./okf.js";

export { noteRelPath } from "./layout.js";

import {
  atomicWriteFile,
  deserializeGeneration,
  type FileMap,
  type IndexedFile,
  type ResourceState,
  readFileMap,
  readResourceState,
  serializeGeneration,
  type ThreadState,
  writeFileMap,
  writeResourceState,
} from "./state.js";

/** Files are canonical; the SQLite index is derived and rebuildable. See plan 188.1 Task 4. */

export interface CreateMarkdownMemoryStoresOptions {
  readonly root: string;
  /** Override the derived index path; defaults to `<root>/.index.sqlite`. */
  readonly index?: { readonly path?: string };
  readonly dimensions?: number;
  /** Reconcile batching caps; defaults to the shared memory limits. */
  readonly limits?: MemoryLimitsInput;
  /**
   * Names why a parsed note cannot be read by the package that owns its metadata, or returns `undefined`.
   * A note with `fabric.v` above 1 is always unreadable without this. An unreadable note is indexed and
   * counted, its file is never rewritten, renamed or moved by this store, and its text stays in the index.
   */
  readonly classifyNote?: NoteClassifier;
  /**
   * Looks at a note whose file changed outside this store, before it is indexed. `previous` is the indexed record the
   * edit replaces, when there is one. Return `undefined` to index the file as parsed, `{ record }` to index (and write
   * back to the file) a reviewed version, or `{ reject }` to keep `previous` indexed, leave the file as the person
   * wrote it, and log the rejection. Never called for an unreadable note.
   */
  readonly reviewEdit?: MarkdownNoteReviewer;
}

/** What a {@link MarkdownNoteReviewer} decided about one externally changed note file. */
export type MarkdownNoteReview =
  | { readonly record: MemoryVectorRecord; readonly reject?: undefined }
  | { readonly reject: { readonly verb: string; readonly note: string }; readonly record?: undefined };

export type MarkdownNoteReviewer = (record: MemoryVectorRecord, previous: MemoryVectorRecord | undefined) => MarkdownNoteReview | undefined;

/** Notes the index holds but this version cannot read, by reason. */
export interface MarkdownUnreadableCounts {
  readonly unreadable: number;
  readonly unreadableReasons: Readonly<Record<string, number>>;
}

export interface MarkdownReconcileReport extends MarkdownUnreadableCounts {
  readonly indexed: number;
  readonly removed: number;
  readonly malformed: number;
  readonly errors: readonly string[];
  /** False when the bounded pass stopped before walking the whole tree. */
  readonly complete: boolean;
}

export interface MarkdownMemoryStores {
  readonly root: string;
  readonly vectorStore: Required<VectorStore>;
  readonly workingStore: WorkingMemoryStore;
  close(): Promise<void>;
  /** Full pass: re-index every file, ignoring the cached mtime/size. */
  rebuild(options?: { readonly signal?: AbortSignal }): Promise<MarkdownReconcileReport>;
  /** Notes the index holds but this version cannot read, by reason, from the last pass. */
  unreadable(): MarkdownUnreadableCounts;
  /** Incremental pass: only new or changed files, plus externally removed ones. */
  reconcile(options?: { readonly signal?: AbortSignal }): Promise<MarkdownReconcileReport>;
  /**
   * Create or update a resource-level OKF file (for example `project.md`) under the store lock.
   * The file is not a note: it is never indexed, and `update` receives the current text if any.
   **/
  updateResourceFile(
    scope: { readonly tenantId: string; readonly resourceId: string },
    name: string,
    update: (current: string | undefined) => string,
  ): Promise<void>;
  /**
   * Write a derived resource file (for example `rules.md`) under the store lock. The file carries a
   * marker whose hash covers its own body, so a manual edit is detectable. A file a person edited is
   * kept, never overwritten: the call returns `false` until the caller has consumed the edit and
   * passes `replaceEdited: true`. Returns `true` when the file now holds `body`.
   */
  writeDerivedFile(
    scope: { readonly tenantId: string; readonly resourceId: string },
    name: string,
    body: string,
    options?: { readonly replaceEdited?: boolean },
  ): Promise<boolean>;
  /**
   * Read a derived resource file: the body after its marker, and whether a person edited it since
   * the last derived write (a missing or non-matching marker counts as edited). `undefined` when absent.
   */
  readDerivedFile(
    scope: { readonly tenantId: string; readonly resourceId: string },
    name: string,
  ): Promise<{ readonly body: string; readonly edited: boolean } | undefined>;
}

const HARD_INVALIDATION_BATCH = 64;

async function* walkFiles(dir: string, base = ""): AsyncGenerator<string> {
  const entries = await opendir(dir);
  for await (const entry of entries) {
    const rel = base.length > 0 ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkFiles(join(dir, entry.name), rel);
    else if (entry.isFile()) yield rel;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** One `.md` file name; both resource-file writers refuse a path segment. */
function resourceFileName(name: string): void {
  if (!/^[^/\\\0]+\.md$/.test(name) || name === "." || name === "..") {
    throw new MemoryValidationError(`resource file name must be one .md segment: ${name}`);
  }
}

const DERIVED_MARKER = /^<!-- prism:derived content_hash=([0-9a-f]{64}) -->\r?\n/;

/** A derived file names itself in a comment whose hash covers the body that follows. */
function renderDerivedFile(body: string): string {
  return `<!-- prism:derived content_hash=${sha256(body)} -->\n${body}`;
}

/** True when the file is the previous derived write, so nothing was edited by hand. */
function derivedFileIntact(content: string): boolean {
  const marker = DERIVED_MARKER.exec(content);
  return marker !== null && sha256(content.slice(marker[0].length)) === marker[1];
}

function withoutEmbedderId(record: MemoryVectorRecord): MemoryVectorRecord {
  const { embedderId: _drop, ...rest } = record;
  return rest;
}

function emptyThreadState(): ThreadState {
  return { invalidations: {}, grants: {}, shares: {} };
}

/** A record is archived only when it is blocked (lineage rule); a `corrected` self-invalidation is not. */
function blockedIn(record: MemoryVectorRecord, state: ThreadState | undefined): boolean {
  return recordBlocked(record, new Map(Object.entries(state?.invalidations ?? {})));
}

export async function createMarkdownMemoryStores(options: CreateMarkdownMemoryStoresOptions): Promise<MarkdownMemoryStores> {
  const root = resolve(requireNonEmptyString(options.root, "root"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const limits = resolveMemoryLimits(options.limits ?? {});
  const lock = createWriteLock(root);
  const indexPath = options.index?.path !== undefined ? resolve(root, options.index.path) : join(root, INDEX_DB_FILE);
  const fileMapPath = join(root, FILE_MAP_FILE);
  const classifyNote = options.classifyNote;
  const reviewEdit = options.reviewEdit;

  let force = !existsSync(indexPath);
  let sqlite: SqliteMemoryStores;
  const openIndex = () =>
    createSqliteMemoryStores({ path: indexPath, ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }) });
  try {
    sqlite = await openIndex();
  } catch (error) {
    if (force) throw error;
    await rm(indexPath, { force: true });
    sqlite = await openIndex();
    force = true;
  }

  let fileMap: FileMap = await readFileMap(fileMapPath);
  const states = new Map<string, ResourceState>();
  const stateKey = (tenantId: string, resourceId: string) => `${tenantId}\0${resourceId}`;

  // Load control state and working memory from their canonical files, then replay state into the index.
  for await (const rel of walkFiles(root)) {
    if (rel.split("/").at(-1) === STATE_FILE) {
      const state = await readResourceState(join(root, rel));
      if (state?.version === 1 && typeof state.tenantId === "string" && typeof state.resourceId === "string" && state.threads) {
        states.set(stateKey(state.tenantId, state.resourceId), state);
      }
      continue;
    }
    if (rel.endsWith(".md") && rel.split("/").at(-2) === WORKING_DIRECTORY) {
      const abs = join(root, rel);
      await assertInsideRoot(root, abs);
      await sqlite.workingStore.set(parseWorkingFile(await readFile(abs, "utf8"), rel));
    }
  }
  for (const state of states.values()) {
    for (const [threadId, thread] of Object.entries(state.threads)) {
      const scope: Required<MemoryScope> = { tenantId: state.tenantId, resourceId: state.resourceId, threadId };
      const grants = Object.values(thread.grants);
      if (grants.length > 0) await sqlite.vectorStore.setSourceAccess(scope, grants);
      const invalidations = Object.values(thread.invalidations);
      for (let offset = 0; offset < invalidations.length; offset += HARD_INVALIDATION_BATCH) {
        await sqlite.vectorStore.invalidate(scope, invalidations.slice(offset, offset + HARD_INVALIDATION_BATCH));
      }
      for (const share of Object.values(thread.shares)) await sqlite.vectorStore.setShareGrant(scope, share);
      const generation = deserializeGeneration(thread.generation);
      if (generation !== undefined) await sqlite.vectorStore.setCurrentGeneration(scope, generation);
    }
  }

  function requireCounterTenant(key: ScopeCounterKey): string {
    return requireNonEmptyString(key.tenantId, "tenantId");
  }
  function requireCounterResource(key: ScopeCounterKey): string {
    return requireNonEmptyString(key.resourceId, "resourceId");
  }

  function resourceState(tenantId: string, resourceId: string): ResourceState {
    const key = stateKey(tenantId, resourceId);
    let state = states.get(key);
    if (!state) {
      state = { version: 1, tenantId, resourceId, threads: {} };
      states.set(key, state);
    }
    return state;
  }

  function threadState(scope: Required<MemoryScope>): ThreadState {
    const state = resourceState(scope.tenantId, scope.resourceId);
    return (state.threads[scope.threadId] ??= emptyThreadState());
  }

  async function persistState(tenantId: string, resourceId: string): Promise<void> {
    const state = states.get(stateKey(tenantId, resourceId));
    if (!state) return;
    const abs = join(root, stateRelPath(tenantId, resourceId));
    await assertInsideRoot(root, abs);
    await writeResourceState(abs, state);
  }

  function findFileById(id: string): IndexedFile | undefined {
    for (const entry of Object.values(fileMap)) if (entry.id === id) return entry;
    return undefined;
  }

  function fileMapEntry(
    record: MemoryVectorRecord,
    relPath: string,
    kind: string | undefined,
    archived: boolean,
    info: { mtimeMs: number; size: number },
    content: string,
  ): IndexedFile {
    const flags = fabricFlags(record);
    const unreadable = unreadableReason(record);
    return {
      path: relPath,
      id: record.id,
      scope: { tenantId: record.tenantId, resourceId: record.resourceId, threadId: record.threadId },
      mtimeMs: info.mtimeMs,
      size: info.size,
      hash: sha256(content),
      ...(kind === undefined ? {} : { kind }),
      title: noteTitle(record.text),
      description: noteDescription(record.text),
      dir: archived ? `archive/${directoryForKind(kind)}` : directoryForKind(kind),
      ...(flags.length === 0 ? {} : { flags }),
      ...(unreadable === undefined ? {} : { unreadable }),
    };
  }

  function unreadableCounts(): MarkdownUnreadableCounts {
    const unreadableReasons: Record<string, number> = {};
    let unreadable = 0;
    for (const entry of Object.values(fileMap)) {
      if (entry.unreadable === undefined) continue;
      unreadable += 1;
      unreadableReasons[entry.unreadable] = (unreadableReasons[entry.unreadable] ?? 0) + 1;
    }
    return { unreadable, unreadableReasons };
  }

  async function regenerateIndex(): Promise<void> {
    const entries: IndexEntry[] = Object.values(fileMap).map((entry) => ({
      dir: entry.dir,
      path: entry.path,
      title: entry.title,
      description: entry.description,
    }));
    const abs = join(root, INDEX_FILE);
    await assertInsideRoot(root, abs);
    await atomicWriteFile(abs, renderIndexFile(entries));
  }

  async function appendLog(newEntries: readonly LogEntry[]): Promise<void> {
    if (newEntries.length === 0) return;
    const logPath = join(root, LOG_FILE);
    const existing = parseLogFile(await readFile(logPath, "utf8").catch(() => ""));
    const combined = [...newEntries, ...existing];
    await atomicWriteFile(logPath, renderLogFile(combined.slice(0, 2000)));
    const overflow = combined.slice(2000);
    if (overflow.length === 0) return;
    const byYear = new Map<string, LogEntry[]>();
    for (const entry of overflow) {
      const year = entry.date.slice(0, 4);
      byYear.set(year, [...(byYear.get(year) ?? []), entry]);
    }
    for (const [year, list] of byYear) {
      const path = join(root, `log-${year}.md`);
      const prior = parseLogFile(await readFile(path, "utf8").catch(() => ""));
      await atomicWriteFile(path, renderLogFile([...prior, ...list]));
    }
  }

  /** Trust flags are equal as sets, so a reordered list does not read as a new flag event. */
  function sameFlags(a: readonly string[], b: readonly string[] | undefined): boolean {
    const left = [...a].sort();
    const right = [...(b ?? [])].sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  async function placeNoteFile(record: MemoryVectorRecord, archived: boolean, logs: LogEntry[], today: string): Promise<void> {
    const kind = fabricKind(record);
    const existing = findFileById(record.id);
    const flags = fabricFlags(record);
    const by = provenanceActor(record);
    const base = (fullId: boolean) =>
      noteRelPath({ tenantId: record.tenantId, resourceId: record.resourceId, kind, text: record.text, archived, id: record.id, fullId });
    let rel = base(false);
    const occupant = fileMap[rel];
    if ((occupant && occupant.id !== record.id) || (!occupant && existsSync(join(root, rel)))) rel = base(true);
    // A note a newer version wrote stays where it is: this store never renames what it cannot read.
    if (existing && unreadableReason(record) !== undefined) rel = existing.path;
    const content = renderNoteFile(record);
    if (existing && existing.path !== rel) {
      const to = join(root, rel);
      await assertInsideRoot(root, to);
      await mkdir(dirname(to), { recursive: true, mode: 0o700 });
      await rename(join(root, existing.path), to);
      delete fileMap[existing.path];
    }
    const abs = join(root, rel);
    await assertInsideRoot(root, abs);
    const current = await readFile(abs, "utf8").catch(() => undefined);
    if (current !== content) await atomicWriteFile(abs, content);
    const info = await stat(abs);
    fileMap[rel] = fileMapEntry(record, rel, kind, archived, info, content);
    // A newly tripped trust flag is its own audit verb; `by` names the writer for every line.
    const newlyFlagged = flags.length > 0 && !sameFlags(flags, existing?.flags);
    const auditVerb = typeof record.metadata?.auditVerb === "string" ? record.metadata.auditVerb : undefined;
    if (!existing)
      logs.push({
        date: today,
        verb: auditVerb ?? (newlyFlagged ? "flagged" : "created"),
        id: record.id,
        ...(by === undefined ? {} : { by }),
      });
    else if (current !== content)
      logs.push({
        date: today,
        verb: auditVerb ?? (newlyFlagged ? "flagged" : "updated"),
        id: record.id,
        ...(by === undefined ? {} : { by }),
      });
  }

  async function repositionFile(scope: Required<MemoryScope>, id: string): Promise<void> {
    const existing = findFileById(id);
    if (!existing) return;
    if (existing.unreadable !== undefined) return;
    const record = (await sqlite.vectorStore.getByIds(scope, [id]))[0];
    if (!record || isIndexOnlyKind(fabricKind(record))) {
      if (!record) {
        await rm(join(root, existing.path), { force: true });
        delete fileMap[existing.path];
      }
      return;
    }
    const blocked = blockedIn(record, threadState(scope));
    const archived = isArchived(record, blocked, Date.now());
    const kind = fabricKind(record);
    let target = noteRelPath({
      tenantId: record.tenantId,
      resourceId: record.resourceId,
      kind,
      text: record.text,
      archived,
      id: record.id,
    });
    const occupant = fileMap[target];
    if (occupant && occupant.id !== record.id) {
      target = noteRelPath({
        tenantId: record.tenantId,
        resourceId: record.resourceId,
        kind,
        text: record.text,
        archived,
        id: record.id,
        fullId: true,
      });
    }
    if (target === existing.path) {
      fileMap[target] = { ...existing, dir: archived ? `archive/${directoryForKind(kind)}` : directoryForKind(kind) };
      return;
    }
    const to = join(root, target);
    await assertInsideRoot(root, to);
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    await rename(join(root, existing.path), to);
    delete fileMap[existing.path];
    fileMap[target] = { ...existing, path: target, dir: archived ? `archive/${directoryForKind(kind)}` : directoryForKind(kind) };
  }

  async function reconcileInternal(forceFull: boolean, signal?: AbortSignal): Promise<MarkdownReconcileReport> {
    return lock.run(async () => {
      const report = { indexed: 0, removed: 0, malformed: 0, errors: [] as string[], complete: true };
      if (forceFull) fileMap = {};
      const seen = new Set<string>();
      const logs: LogEntry[] = [];
      const today = new Date().toISOString().slice(0, 10);
      const start = Date.now();
      let processed = 0;
      for await (const rel of walkFiles(root)) {
        assertNotAborted(signal);
        if (!isNoteRelPath(rel)) continue;
        seen.add(rel);
        const abs = join(root, rel);
        const info = await stat(abs).catch(() => undefined);
        if (!info) continue;
        const known = fileMap[rel];
        if (!forceFull && known && known.mtimeMs === info.mtimeMs && known.size === info.size) continue;
        try {
          const content = await readFile(abs, "utf8");
          const parsed = parseNoteFile(content, rel, classifyNote);
          let record = parsed;
          let rewritten = false;
          if (reviewEdit !== undefined && unreadableReason(parsed) === undefined) {
            const previous = (await sqlite.vectorStore.getByIds(parsed, [parsed.id]))[0];
            const review = reviewEdit(parsed, previous);
            if (review?.reject !== undefined) {
              // Keep the last valid version indexed and the person's file as written; the log says why.
              const keep = previous ?? parsed;
              const keptBlocked = blockedIn(keep, states.get(stateKey(keep.tenantId, keep.resourceId))?.threads[keep.threadId]);
              fileMap[rel] = fileMapEntry(keep, rel, fabricKind(keep), keptBlocked || isArchived(keep, false, Date.now()), info, content);
              report.malformed += 1;
              report.errors.push(`${rel}: ${review.reject.verb}: ${review.reject.note}`);
              logs.push({ date: today, verb: review.reject.verb, id: parsed.id, by: "human", note: review.reject.note });
              processed += 1;
              continue;
            }
            if (review?.record !== undefined) {
              record = review.record;
              rewritten = true;
            }
          }
          await sqlite.vectorStore.upsert(
            [record.embedding.length === 0 && record.embedderId !== undefined ? withoutEmbedderId(record) : record],
            {
              signal,
            },
          );
          const kind = fabricKind(record);
          const blocked = blockedIn(record, states.get(stateKey(record.tenantId, record.resourceId))?.threads[record.threadId]);
          const archived = blocked || isArchived(record, false, Date.now()) || rel.includes("/archive/");
          let written = info;
          let text = content;
          if (rewritten) {
            // The file is canonical: a reviewed record (per-claim markers, a quarantine flag) is written back in place.
            text = renderNoteFile(record);
            await atomicWriteFile(abs, text);
            written = await stat(abs);
          }
          fileMap[rel] = fileMapEntry(record, rel, kind, archived, written, text);
          report.indexed += 1;
          const by = provenanceActor(record);
          logs.push({ date: today, verb: rewritten ? "reviewed" : "indexed", id: record.id, ...(by === undefined ? {} : { by }) });
        } catch (error) {
          report.malformed += 1;
          report.errors.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`);
          delete fileMap[rel];
        }
        processed += 1;
        if (processed >= limits.rebuildBatchSize && Date.now() - start > limits.rebuildMs) {
          report.complete = false;
          break;
        }
      }
      if (!forceFull && report.complete) {
        for (const [rel, entry] of Object.entries(fileMap)) {
          if (seen.has(rel) || existsSync(join(root, rel))) continue;
          await sqlite.vectorStore.delete(
            { tenantId: entry.scope.tenantId, resourceId: entry.scope.resourceId, ids: [entry.id] },
            { signal },
          );
          delete fileMap[rel];
          report.removed += 1;
          logs.push({ date: today, verb: "removed-externally", id: entry.id });
        }
      }
      await writeFileMap(fileMapPath, fileMap);
      await appendLog(logs);
      await regenerateIndex();
      return { ...report, ...unreadableCounts() };
    });
  }

  const vectorStore: Required<VectorStore> = {
    authorization: "acl",
    lineage: "invalidation",
    lexicalModes: ["fts", "bm25"],
    async upsert(records, opts = {}) {
      assertNotAborted(opts.signal);
      await lock.run(async () => {
        const logs: LogEntry[] = [];
        const today = new Date().toISOString().slice(0, 10);
        for (const record of records) {
          requireNonEmptyString(record.id, "id");
          const kind = fabricKind(record);
          if (isIndexOnlyKind(kind)) {
            // Index-only notes (user files) have no note file; the flag shows up in the log and index.
            const by = provenanceActor(record);
            logs.push({
              date: today,
              verb: fabricFlags(record).length > 0 ? "flagged" : "indexed",
              id: record.id,
              ...(by === undefined ? {} : { by }),
            });
            continue;
          }
          const blocked = blockedIn(record, threadState(requireScope(record, true) as Required<MemoryScope>));
          await placeNoteFile(record, isArchived(record, blocked, Date.now()), logs, today);
        }
        await sqlite.vectorStore.upsert(records, opts);
        await writeFileMap(fileMapPath, fileMap);
        await appendLog(logs);
        await regenerateIndex();
      });
    },
    async query(query: VectorQuery) {
      return sqlite.vectorStore.query(query);
    },
    async lexicalQuery(query: VectorLexicalQuery) {
      return sqlite.vectorStore.lexicalQuery(query);
    },
    async delete(filter: VectorDeleteFilter, opts = {}) {
      assertNotAborted(opts.signal);
      return lock.run(async () => {
        requireScope(filter);
        const logs: LogEntry[] = [];
        const today = new Date().toISOString().slice(0, 10);
        for (const [rel, entry] of Object.entries(fileMap)) {
          if (entry.scope.tenantId !== filter.tenantId || entry.scope.resourceId !== filter.resourceId) continue;
          if (filter.threadId !== undefined && entry.scope.threadId !== filter.threadId) continue;
          if (filter.ids !== undefined && !filter.ids.includes(entry.id)) continue;
          await rm(join(root, rel), { force: true });
          delete fileMap[rel];
          logs.push({ date: today, verb: "removed", id: entry.id });
        }
        const deleted = await sqlite.vectorStore.delete(filter, opts);
        await writeFileMap(fileMapPath, fileMap);
        await appendLog(logs);
        await regenerateIndex();
        return deleted;
      });
    },
    async getByIds(scope, ids, opts) {
      return sqlite.vectorStore.getByIds(scope, ids, opts);
    },
    async getByThread(scope) {
      return sqlite.vectorStore.getByThread(scope);
    },
    async listByThread(query) {
      return sqlite.vectorStore.listByThread(query);
    },
    async countByThread(scope, opts) {
      return sqlite.vectorStore.countByThread(scope, opts);
    },
    async countByKind(scope, query) {
      return sqlite.vectorStore.countByKind(scope, query);
    },
    async topTags(scope, query) {
      return sqlite.vectorStore.topTags(scope, query);
    },
    async getCurrentGeneration(scope) {
      return sqlite.vectorStore.getCurrentGeneration(scope);
    },
    async setCurrentGeneration(scope, generation) {
      await lock.run(async () => {
        await sqlite.vectorStore.setCurrentGeneration(scope, generation);
        const exact = requireScope(scope, true) as Required<MemoryScope>;
        threadState(exact).generation = serializeGeneration(generation);
        await persistState(exact.tenantId, exact.resourceId);
      });
    },
    async setSourceAccess(scope, grants, opts) {
      await lock.run(async () => {
        await sqlite.vectorStore.setSourceAccess(scope, grants, opts);
        const exact = requireScope(scope, true) as Required<MemoryScope>;
        const thread = threadState(exact);
        for (const grant of grants) thread.grants[grant.sourceId] = grant;
        await persistState(exact.tenantId, exact.resourceId);
      });
    },
    async checkSourceAccess(scope, sourceId, authorization, opts) {
      return sqlite.vectorStore.checkSourceAccess(scope, sourceId, authorization, opts);
    },
    async invalidate(scope, entries, opts) {
      await lock.run(async () => {
        await sqlite.vectorStore.invalidate(scope, entries, opts);
        const exact = requireScope(scope, true) as Required<MemoryScope>;
        const listed = await sqlite.vectorStore.listInvalidated(exact, opts);
        threadState(exact).invalidations = Object.fromEntries(listed.map((entry) => [entry.id, entry]));
        await persistState(exact.tenantId, exact.resourceId);
        for (const entry of entries) await repositionFile(exact, entry.id);
        await regenerateIndex();
      });
    },
    async listInvalidated(scope, opts) {
      return sqlite.vectorStore.listInvalidated(scope, opts);
    },
    async clearInvalidation(scope, ids, opts) {
      await lock.run(async () => {
        await sqlite.vectorStore.clearInvalidation(scope, ids, opts);
        const exact = requireScope(scope, true) as Required<MemoryScope>;
        const listed = await sqlite.vectorStore.listInvalidated(exact, opts);
        threadState(exact).invalidations = Object.fromEntries(listed.map((entry) => [entry.id, entry]));
        await persistState(exact.tenantId, exact.resourceId);
        for (const id of ids) await repositionFile(exact, id);
        await regenerateIndex();
      });
    },
    async setShareGrant(scope, grant, opts) {
      await lock.run(async () => {
        await sqlite.vectorStore.setShareGrant(scope, grant, opts);
        const exact = requireScope(scope, true) as Required<MemoryScope>;
        const thread = threadState(exact);
        if (grant.sourceIds.length > 0) thread.shares[grant.childThreadId] = grant;
        else delete thread.shares[grant.childThreadId];
        await persistState(exact.tenantId, exact.resourceId);
      });
    },
    async getShareGrant(scope, child, opts) {
      return sqlite.vectorStore.getShareGrant(scope, child, opts);
    },
    async listBySession(scope, session, opts) {
      return sqlite.vectorStore.listBySession(scope, session, opts);
    },
    async scanMetadata(query: VectorScanMetadataQuery) {
      return sqlite.vectorStore.scanMetadata(query);
    },
    async listResources(query: VectorListResourcesQuery) {
      return sqlite.vectorStore.listResources(query);
    },
    // The counter is canonical in `.state.json`: the derived index cannot rebuild it from files.
    scopeCounter: {
      async get(key: ScopeCounterKey, opts = {}) {
        assertNotAborted(opts.signal);
        const tenantId = requireCounterTenant(key);
        const resourceId = requireCounterResource(key);
        // The file is canonical, so a read also sees another process's ticks (the map may lag).
        const onDisk = await readResourceState(join(root, stateRelPath(tenantId, resourceId)));
        return Math.max(resourceState(tenantId, resourceId).counters?.[key.name] ?? 0, onDisk?.counters?.[key.name] ?? 0);
      },
      async increment(key: ScopeCounterKey, opts = {}) {
        assertNotAborted(opts.signal);
        if (key.name !== "sessions") throw new MemoryValidationError("unknown scope counter name");
        return lock.run(async () => {
          const tenantId = requireCounterTenant(key);
          const resourceId = requireCounterResource(key);
          const state = resourceState(tenantId, resourceId);
          // Another process may have ticked since this store loaded; the file under the lock wins.
          const onDisk = await readResourceState(join(root, stateRelPath(tenantId, resourceId)));
          const next = Math.max(state.counters?.[key.name] ?? 0, onDisk?.counters?.[key.name] ?? 0) + 1;
          state.counters = { ...state.counters, [key.name]: next };
          await persistState(tenantId, resourceId);
          return next;
        });
      },
    },
  };

  async function writeWorkingFile(record: WorkingMemoryRecord): Promise<void> {
    const threadId = requireNonEmptyString(record.threadId, "threadId");
    const abs = join(root, workingRelPath(record.tenantId, record.resourceId, threadId));
    await assertInsideRoot(root, abs);
    await atomicWriteFile(abs, renderWorkingFile(record));
  }

  const workingStore: WorkingMemoryStore = {
    async get(scope, opts = {}) {
      return sqlite.workingStore.get(scope, opts);
    },
    async set(record, opts = {}) {
      await lock.run(async () => {
        await sqlite.workingStore.set(record, opts);
        await writeWorkingFile(record);
      });
    },
    async update(scope, patch, opts = {}) {
      return lock.run(async () => {
        const record = await sqlite.workingStore.update(scope, patch, opts);
        await writeWorkingFile(record);
        return record;
      });
    },
    async delete(scope, opts = {}) {
      return lock.run(async () => {
        const deleted = await sqlite.workingStore.delete(scope, opts);
        const threadId = requireNonEmptyString(scope.threadId, "threadId");
        await rm(join(root, workingRelPath(scope.tenantId, scope.resourceId, threadId)), { force: true });
        return deleted;
      });
    },
  };

  await reconcileInternal(force, undefined);

  return {
    root,
    vectorStore,
    workingStore,
    async close() {
      await lock.drain();
      sqlite.close();
    },
    unreadable: unreadableCounts,
    rebuild: (rebuildOptions = {}) => reconcileInternal(true, rebuildOptions.signal),
    reconcile: (reconcileOptions = {}) => reconcileInternal(false, reconcileOptions.signal),
    async updateResourceFile(scope, name, update) {
      resourceFileName(name);
      await lock.run(async () => {
        const abs = join(root, scopeDirectory(scope.tenantId, scope.resourceId), name);
        await assertInsideRoot(root, abs);
        const current = await readFile(abs, "utf8").catch(() => undefined);
        await atomicWriteFile(abs, update(current));
      });
    },
    async writeDerivedFile(scope, name, body, writeOptions = {}) {
      resourceFileName(name);
      if (typeof body !== "string" || body.includes("\0")) {
        throw new MemoryValidationError("derived file body must be text without NUL");
      }
      return lock.run(async () => {
        const abs = join(root, scopeDirectory(scope.tenantId, scope.resourceId), name);
        await assertInsideRoot(root, abs);
        const current = await readFile(abs, "utf8").catch(() => undefined);
        const content = renderDerivedFile(body);
        if (current === content) return true;
        if (current !== undefined && !derivedFileIntact(current) && writeOptions.replaceEdited !== true) return false;
        await atomicWriteFile(abs, content);
        return true;
      });
    },
    async readDerivedFile(scope, name) {
      resourceFileName(name);
      return lock.run(async () => {
        const abs = join(root, scopeDirectory(scope.tenantId, scope.resourceId), name);
        await assertInsideRoot(root, abs);
        const current = await readFile(abs, "utf8").catch(() => undefined);
        if (current === undefined) return undefined;
        const marker = DERIVED_MARKER.exec(current);
        return { body: marker === null ? current : current.slice(marker[0].length), edited: !derivedFileIntact(current) };
      });
    },
  };
}
