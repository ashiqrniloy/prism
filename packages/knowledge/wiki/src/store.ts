/**
 * The wiki's own store (plan 216 Task 3): concepts, their claims, relations and open questions, the subject bindings
 * of the evidence they rest on, and ingested sources. Long-term memory never holds a concept; the wiki only cites
 * LTM notes by id.
 *
 * Markdown by default, under `wiki.root`:
 *
 * ```text
 * <root>/<scope>/concepts/<subject>.md   one concept: JSON-valued frontmatter, then the concept body grammar
 * <root>/<scope>/bindings.json           evidence id → subject
 * <root>/<scope>/.wiki-state.json         cursors, and the last body the wiki wrote per concept (human-edit review)
 * <root>/sources/<id>/                    the staged original, `extract.md` and `source.json`
 * <root>/log.md                           one line per rejected or quarantined person's edit
 * ```
 *
 * Directories are created 0700 and files written 0600 through a temp file and a rename, the fabric markdown store's
 * modes. A concept file a person edited is reviewed on the next load (see `review.ts`). Nothing here calls a model.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MemoryValidationError } from "@arnilo/prism-memory-system/core";
import { reviewConceptFile } from "./ontology/review.js";
import {
  CONCEPT_DIRTY_REASONS,
  CONCEPT_TYPES,
  type ConceptDirtyReason,
  type ConceptRelation,
  type ConceptType,
  type ConceptWriter,
  isConceptRelation,
  type WikiScopeLevel,
} from "./ontology/types.js";

export type WikiConceptStatus = "verified" | "candidate" | "archived";

/** One concept as the store keeps it. `body` is the concept grammar (`codec.ts`). */
export interface WikiConceptRecord {
  readonly id: string;
  readonly scope: WikiScopeLevel;
  readonly subject: string;
  readonly title: string;
  readonly conceptType: ConceptType;
  readonly aliases: readonly string[];
  readonly appliesTo?: readonly string[];
  readonly links: readonly { readonly id: string; readonly relation: ConceptRelation }[];
  readonly body: string;
  /** Item ids whose citation was retracted or changed and that no edit has resolved yet. */
  readonly stale: readonly string[];
  readonly dirty: readonly ConceptDirtyReason[];
  readonly status: WikiConceptStatus;
  /** Trust-scan classes a person's edit tripped; a flagged concept is a candidate and never delivered. */
  readonly flags: readonly string[];
  readonly generated: { readonly by: ConceptWriter; readonly at: string };
  readonly createdAt: string;
  /** Times `wiki.read` returned the concept; orders the subject lists. */
  readonly uses: number;
}

/** One ingested source: a whole document the wiki owns. Its extract is the text claims cite. */
export interface WikiSourceRecord {
  /** 12 hex characters, the id claims cite. */
  readonly id: string;
  /** `sources/<dir>/extract.md`, relative to the stage root. */
  readonly path: string;
  readonly title: string;
  readonly keywords: readonly string[];
  readonly contentHash: string;
  readonly createdAt: string;
  /** The trust class that refused the text; a flagged source is never cited. */
  readonly refused?: string;
}

export interface WikiScopeState {
  /** The `memory.ltm` scope identity this level of the store belongs to, pinned on first use. */
  readonly owner?: string;
  /** The newest LTM invalidation the wiki has applied (`at`), so the deletion feed resumes after it. */
  readonly deletions?: string;
}

export interface WikiStore {
  /** The markdown root; `undefined` for the in-memory store. */
  readonly root: string | undefined;
  /** Re-read a scope from disk (a person's edits are reviewed here). A no-op for the in-memory store. */
  reload(scope: WikiScopeLevel): Promise<void>;
  /** Every concept of a scope, archived ones included, sorted by subject. */
  concepts(scope: WikiScopeLevel): Promise<readonly WikiConceptRecord[]>;
  putConcept(record: WikiConceptRecord): Promise<void>;
  sources(): Promise<readonly WikiSourceRecord[]>;
  /** Record a staged source. The markdown store writes `source.json` beside the extract the ingest staged. */
  putSource(record: WikiSourceRecord, extract: string): Promise<void>;
  sourceText(id: string): Promise<string | undefined>;
  bindings(scope: WikiScopeLevel): Promise<ReadonlyMap<string, string>>;
  bind(scope: WikiScopeLevel, noteId: string, subject: string): Promise<void>;
  state(scope: WikiScopeLevel): Promise<WikiScopeState>;
  setState(scope: WikiScopeLevel, state: WikiScopeState): Promise<void>;
  log(verb: string, note: string): Promise<void>;
  /** Bumped by every write, so a cache built from the store knows when it is stale. */
  version(): number;
}

const SOURCE_ID = /^[0-9a-f]{12}$/;

/** The id a staged source directory gets: stable for the directory, 12 hex characters like every cited id. */
export function wikiSourceId(rawDir: string): string {
  return createHash("sha256").update(`wiki-source:${rawDir}`, "utf8").digest("hex").slice(0, 12);
}

/** A new concept's id. */
export function wikiConceptId(scope: WikiScopeLevel, subject: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["wiki", "concept", scope, subject, randomUUID()]))
    .digest("hex")
    .slice(0, 12);
}

const bySubject = (a: WikiConceptRecord, b: WikiConceptRecord): number => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);

/** The in-memory store: tests, and hosts that keep the wiki for one process. */
export function createMemoryWikiStore(): WikiStore {
  const concepts = new Map<WikiScopeLevel, Map<string, WikiConceptRecord>>();
  const sources = new Map<string, { readonly record: WikiSourceRecord; readonly text: string }>();
  const bindings = new Map<WikiScopeLevel, Map<string, string>>();
  const states = new Map<WikiScopeLevel, WikiScopeState>();
  let revision = 0;
  const scopeMap = (scope: WikiScopeLevel): Map<string, WikiConceptRecord> => {
    let map = concepts.get(scope);
    if (map === undefined) concepts.set(scope, (map = new Map()));
    return map;
  };
  return {
    root: undefined,
    async reload() {},
    async concepts(scope) {
      return [...scopeMap(scope).values()].sort(bySubject);
    },
    async putConcept(record) {
      revision += 1;
      scopeMap(record.scope).set(record.id, record);
    },
    async sources() {
      return [...sources.values()].map((entry) => entry.record);
    },
    async putSource(record, extract) {
      revision += 1;
      sources.set(record.id, { record, text: extract });
    },
    async sourceText(id) {
      return sources.get(id)?.text;
    },
    async bindings(scope) {
      return new Map(bindings.get(scope) ?? []);
    },
    async bind(scope, noteId, subject) {
      revision += 1;
      let map = bindings.get(scope);
      if (map === undefined) bindings.set(scope, (map = new Map()));
      map.set(noteId, subject);
    },
    async state(scope) {
      return states.get(scope) ?? {};
    },
    async setState(scope, state) {
      states.set(scope, state);
    },
    async log() {},
    version: () => revision,
  };
}

// --- markdown -------------------------------------------------------------------------------------------------

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = await readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const hash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const FRONTMATTER_KEYS = [
  "id",
  "subject",
  "title",
  "concept_type",
  "aliases",
  "applies_to",
  "links",
  "status",
  "flags",
  "stale",
  "dirty",
  "generated",
  "created_at",
  "uses",
] as const;

/** One concept file: frontmatter with one JSON value per key, then the body. Deterministic for a record. */
export function renderConceptFile(record: WikiConceptRecord): string {
  const values: Record<(typeof FRONTMATTER_KEYS)[number], unknown> = {
    id: record.id,
    subject: record.subject,
    title: record.title,
    concept_type: record.conceptType,
    aliases: record.aliases,
    applies_to: record.appliesTo,
    links: record.links,
    status: record.status,
    flags: record.flags,
    stale: record.stale,
    dirty: record.dirty,
    generated: record.generated,
    created_at: record.createdAt,
    uses: record.uses,
  };
  const lines = ["---"];
  for (const key of FRONTMATTER_KEYS) {
    const value = values[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0 && key !== "aliases" && key !== "links")) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${record.body.endsWith("\n") ? record.body : `${record.body}\n`}`;
}

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

/** Fail-closed parse of a concept file. `undefined` when the frontmatter is not the wiki's. The body is not parsed here. */
export function parseConceptFile(text: string, scope: WikiScopeLevel): WikiConceptRecord | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const fields: Record<string, unknown> = {};
  for (const line of text.slice(4, end).split("\n")) {
    if (line.trim().length === 0) continue;
    const colon = line.indexOf(": ");
    if (colon === -1) return undefined;
    try {
      fields[line.slice(0, colon)] = JSON.parse(line.slice(colon + 2)) as unknown;
    } catch {
      return undefined;
    }
  }
  const body = text.slice(end + 5).replace(/^\n/, "");
  const { id, subject, title, concept_type, status, generated, created_at } = fields;
  if (typeof id !== "string" || !SOURCE_ID.test(id) || typeof subject !== "string" || typeof title !== "string") return undefined;
  if (!(CONCEPT_TYPES as readonly unknown[]).includes(concept_type)) return undefined;
  if (status !== "verified" && status !== "candidate" && status !== "archived") return undefined;
  if (typeof created_at !== "string") return undefined;
  if (generated === null || typeof generated !== "object") return undefined;
  const by = (generated as Record<string, unknown>).by;
  const at = (generated as Record<string, unknown>).at;
  if ((by !== "consolidation" && by !== "human" && by !== "host") || typeof at !== "string") return undefined;
  const list = (key: string): readonly string[] | undefined => {
    const value = fields[key];
    if (value === undefined) return [];
    return isStringList(value) ? value : undefined;
  };
  const aliases = list("aliases");
  const flags = list("flags");
  const stale = list("stale");
  const dirty = list("dirty");
  if (aliases === undefined || flags === undefined || stale === undefined || dirty === undefined) return undefined;
  if (!dirty.every((reason) => (CONCEPT_DIRTY_REASONS as readonly string[]).includes(reason))) return undefined;
  const appliesTo = fields.applies_to;
  if (appliesTo !== undefined && !isStringList(appliesTo)) return undefined;
  const rawLinks = fields.links ?? [];
  if (!Array.isArray(rawLinks)) return undefined;
  const links: { id: string; relation: ConceptRelation }[] = [];
  for (const link of rawLinks) {
    if (link === null || typeof link !== "object") return undefined;
    const entry = link as Record<string, unknown>;
    if (typeof entry.id !== "string" || !isConceptRelation(entry.relation)) return undefined;
    links.push({ id: entry.id, relation: entry.relation });
  }
  const uses = fields.uses ?? 0;
  if (!Number.isSafeInteger(uses) || (uses as number) < 0) return undefined;
  return {
    id,
    scope,
    subject,
    title,
    conceptType: concept_type as ConceptType,
    aliases,
    ...(appliesTo === undefined ? {} : { appliesTo: appliesTo as readonly string[] }),
    links,
    body,
    stale,
    dirty: dirty as readonly ConceptDirtyReason[],
    status,
    flags,
    generated: { by, at },
    createdAt: created_at,
    uses: uses as number,
  };
}

interface DiskScopeState extends WikiScopeState {
  /** Per concept id: the hash of the file the wiki last wrote and the body it held (the last valid version). */
  readonly written?: Readonly<Record<string, { readonly hash: string; readonly body: string }>>;
}

/** The markdown store under `root`. */
export function createMarkdownWikiStore(options: { readonly root: string; readonly now?: () => Date }): WikiStore {
  const root = options.root;
  const now = options.now ?? (() => new Date());
  const loaded = new Map<WikiScopeLevel, Map<string, WikiConceptRecord>>();
  const states = new Map<WikiScopeLevel, DiskScopeState>();
  const bindingCache = new Map<WikiScopeLevel, Map<string, string>>();
  let sourceCache: Map<string, WikiSourceRecord> | undefined;
  let revision = 0;

  const scopeDir = (scope: WikiScopeLevel): string => join(root, scope);
  const conceptPath = (scope: WikiScopeLevel, subject: string): string => join(scopeDir(scope), "concepts", `${subject}.md`);
  const statePath = (scope: WikiScopeLevel): string => join(scopeDir(scope), ".wiki-state.json");

  async function readState(scope: WikiScopeLevel): Promise<DiskScopeState> {
    const known = states.get(scope);
    if (known !== undefined) return known;
    const raw = await readJson(statePath(scope));
    const state = raw !== null && typeof raw === "object" ? (raw as DiskScopeState) : {};
    states.set(scope, state);
    return state;
  }

  async function writeState(scope: WikiScopeLevel, state: DiskScopeState): Promise<void> {
    states.set(scope, state);
    await atomicWrite(statePath(scope), `${JSON.stringify(state, null, 2)}\n`);
  }

  async function log(verb: string, note: string): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const line = `- ${now().toISOString()} ${verb}: ${note.replace(/[\r\n]+/g, " ").slice(0, 300)}\n`;
    await appendFile(join(root, "log.md"), line, { encoding: "utf8", mode: 0o600 });
  }

  async function load(scope: WikiScopeLevel): Promise<Map<string, WikiConceptRecord>> {
    const state = await readState(scope);
    const written = { ...(state.written ?? {}) };
    let changed = false;
    const map = new Map<string, WikiConceptRecord>();
    let names: string[] = [];
    try {
      names = (await readdir(join(scopeDir(scope), "concepts"))).filter((name) => name.endsWith(".md"));
    } catch {
      names = [];
    }
    for (const name of names.sort()) {
      const path = join(scopeDir(scope), "concepts", name);
      const text = await readText(path);
      if (text === undefined) continue;
      const parsed = parseConceptFile(text, scope);
      if (parsed === undefined) {
        await log("invalid-concept", `${scope}/concepts/${name}: the frontmatter is not a wiki concept`);
        continue;
      }
      const last = written[parsed.id];
      if (last !== undefined && last.hash === hash(text)) {
        map.set(parsed.id, parsed);
        continue;
      }
      // A person changed the file (or it is new to this store): review it before it is used.
      const review = reviewConceptFile(parsed, last?.body, now);
      if (review.reject !== undefined) {
        await log(review.reject.verb, `${scope}/concepts/${name}: ${review.reject.note}`);
        if (last !== undefined) map.set(parsed.id, { ...parsed, body: last.body });
        continue;
      }
      if (review.flagged !== undefined) await log("flagged-concept", `${scope}/concepts/${name}: ${review.flagged}`);
      const record = review.record;
      const rendered = renderConceptFile(record);
      if (rendered !== text) await atomicWrite(path, rendered);
      written[record.id] = { hash: hash(rendered), body: record.body };
      changed = true;
      map.set(record.id, record);
    }
    if (changed) await writeState(scope, { ...state, written });
    loaded.set(scope, map);
    return map;
  }

  const scopeConcepts = async (scope: WikiScopeLevel): Promise<Map<string, WikiConceptRecord>> => loaded.get(scope) ?? (await load(scope));

  async function loadSources(): Promise<Map<string, WikiSourceRecord>> {
    if (sourceCache !== undefined) return sourceCache;
    const map = new Map<string, WikiSourceRecord>();
    let dirs: string[] = [];
    try {
      dirs = await readdir(join(root, "sources"));
    } catch {
      dirs = [];
    }
    for (const dir of dirs.sort()) {
      const raw = await readJson(join(root, "sources", dir, "source.json"));
      if (raw === null || typeof raw !== "object") continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry.id !== "string" || !SOURCE_ID.test(entry.id) || typeof entry.path !== "string") continue;
      if (typeof entry.title !== "string" || typeof entry.contentHash !== "string" || typeof entry.createdAt !== "string") continue;
      if (!isStringList(entry.keywords ?? [])) continue;
      map.set(entry.id, {
        id: entry.id,
        path: entry.path,
        title: entry.title,
        keywords: (entry.keywords ?? []) as readonly string[],
        contentHash: entry.contentHash,
        createdAt: entry.createdAt,
        ...(typeof entry.refused === "string" ? { refused: entry.refused } : {}),
      });
    }
    sourceCache = map;
    return map;
  }

  return {
    root,
    async reload(scope) {
      loaded.delete(scope);
      states.delete(scope);
      bindingCache.delete(scope);
      sourceCache = undefined;
      revision += 1;
      await load(scope);
    },
    async concepts(scope) {
      return [...(await scopeConcepts(scope)).values()].sort(bySubject);
    },
    async putConcept(record) {
      const map = await scopeConcepts(record.scope);
      const previous = map.get(record.id);
      const text = renderConceptFile(record);
      await atomicWrite(conceptPath(record.scope, record.subject), text);
      if (previous !== undefined && previous.subject !== record.subject)
        await rm(conceptPath(record.scope, previous.subject), { force: true });
      map.set(record.id, record);
      const state = await readState(record.scope);
      await writeState(record.scope, {
        ...state,
        written: { ...(state.written ?? {}), [record.id]: { hash: hash(text), body: record.body } },
      });
      revision += 1;
    },
    async sources() {
      return [...(await loadSources()).values()];
    },
    async putSource(record, _extract) {
      if (!record.path.startsWith("sources/") || !record.path.endsWith("/extract.md")) {
        throw new MemoryValidationError("a wiki source lives at sources/<id>/extract.md");
      }
      const dir = join(root, dirname(record.path));
      await atomicWrite(join(dir, "source.json"), `${JSON.stringify(record, null, 2)}\n`);
      (await loadSources()).set(record.id, record);
      revision += 1;
    },
    async sourceText(id) {
      const record = (await loadSources()).get(id);
      if (record === undefined) return undefined;
      return readText(join(root, record.path));
    },
    async bindings(scope) {
      const known = bindingCache.get(scope);
      if (known !== undefined) return new Map(known);
      const raw = await readJson(join(scopeDir(scope), "bindings.json"));
      const map = new Map<string, string>();
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [id, subject] of Object.entries(raw as Record<string, unknown>)) if (typeof subject === "string") map.set(id, subject);
      }
      bindingCache.set(scope, map);
      return new Map(map);
    },
    async bind(scope, noteId, subject) {
      const map = new Map(await this.bindings(scope));
      map.set(noteId, subject);
      bindingCache.set(scope, map);
      const sorted = Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
      await atomicWrite(join(scopeDir(scope), "bindings.json"), `${JSON.stringify(sorted, null, 2)}\n`);
      revision += 1;
    },
    async state(scope) {
      const { written: _written, ...rest } = await readState(scope);
      return rest;
    },
    async setState(scope, state) {
      const current = await readState(scope);
      await writeState(scope, { ...state, ...(current.written === undefined ? {} : { written: current.written }) });
    },
    log,
    version: () => revision,
  };
}
