/**
 * Which subjects and clusters are due for a concept pass (plan 207 Task 6). Reads only; never calls a model.
 *
 * Three policies, per readable write scope:
 * - **co-read** (primary): notes that were read and used together in at least `minCoReads` answering turns. When
 *   they share a subject, that subject is due; when none is bound, the cluster is a new-subject candidate.
 * - **accumulation** (secondary): a bound subject with `minNotes` uncited notes, or `minNotes` unbound notes sharing
 *   an enrichment keyword. An ingested source counts as `minNotes` notes by itself.
 * - **repair** (always): a concept the deletion cascade marked stale or removed.
 *
 * "Not yet consolidated" is stateless: a note a concept already cites is consolidated. The only state is the
 * in-process set of attempts the curator answered with nothing, so a trigger that keeps firing is not asked again.
 */
import {
  conceptSources,
  type FabricOntologyPort,
  type FabricScopeLevel,
  type OntologyNoteView,
  parseConceptBody,
} from "@arnilo/prism-memory-fabric";
import { MAX_PROMPT_NOTES } from "./prompt.js";

export type WikiTrigger = "co-read" | "accumulation" | "repair";
export const WIKI_TRIGGERS: readonly WikiTrigger[] = ["co-read", "accumulation", "repair"];

/** The scopes the pass writes. `agent` and `team` concepts come from widening and sharing, never from a pass. */
export const WRITE_SCOPES: readonly FabricScopeLevel[] = ["user", "project"];

/** The policies in effect: the configured ones, with `repair` always present. */
export function resolveTriggers(configured: readonly WikiTrigger[] | undefined): readonly WikiTrigger[] {
  const wanted = new Set<WikiTrigger>(configured ?? WIKI_TRIGGERS);
  wanted.add("repair");
  return WIKI_TRIGGERS.filter((trigger) => wanted.has(trigger));
}

export interface WorkItem {
  readonly scope: FabricScopeLevel;
  /** `subject`: edit an existing concept. `cluster`: unbound notes that may become a subject. */
  readonly kind: "subject" | "cluster";
  readonly subject?: string;
  readonly conceptId?: string;
  readonly reasons: readonly WikiTrigger[];
  /** Evidence note ids the call shows besides the notes the concept already cites (newest first). */
  readonly noteIds: readonly string[];
  /** Stable key of this attempt, so an answered-with-nothing attempt is not repeated. */
  readonly attempt: string;
  /** More notes were due than one call shows. The pass leaves the subject flagged so the rest is offered next. */
  readonly more: boolean;
}

export interface PlanOptions {
  readonly triggers: readonly WikiTrigger[];
  readonly minNotes: number;
  readonly minCoReads: number;
  /** `wiki:consolidate`: any bound subject with new evidence is due, whatever its count. */
  readonly force?: boolean;
  readonly declined: ReadonlySet<string>;
  readonly signal?: AbortSignal;
}

/** Page budget per scan. A scan reads metadata once per page; the notes it keeps are the oldest first. */
const SCAN_PAGES = 3;
const PAGE = 64;
const MAX_CLUSTERS = 4;

async function scan(
  port: FabricOntologyPort,
  scope: FabricScopeLevel,
  filter: { readonly subject?: string; readonly unbound?: boolean; readonly coRead?: boolean },
  signal: AbortSignal | undefined,
): Promise<readonly OntologyNoteView[]> {
  const out: OntologyNoteView[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < SCAN_PAGES; page += 1) {
    const result = await port.pending(scope, {
      limit: PAGE,
      ...filter,
      ...(cursor === undefined ? {} : { cursor }),
      ...(signal === undefined ? {} : { signal }),
    });
    out.push(...result.notes);
    cursor = result.cursor;
    if (cursor === undefined) break;
  }
  return out;
}

/** The note ids a concept's claims, questions and contradictions cite. */
export async function citedBy(
  port: FabricOntologyPort,
  scope: FabricScopeLevel,
  conceptId: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlySet<string>> {
  const [concept] = await port.read(scope, [conceptId], signal === undefined ? {} : { signal });
  if (concept === undefined) return new Set();
  return new Set(conceptSources(parseConceptBody(concept.text, { allowUncited: true })));
}

const newestFirst = (a: OntologyNoteView, b: OntologyNoteView): number =>
  a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1;

const fingerprint = (ids: readonly string[]): string => [...ids].sort().join(",");

/** Connected sets of notes that were read together in at least `minCoReads` distinct turns. */
function coReadClusters(notes: readonly OntologyNoteView[], minCoReads: number): readonly (readonly OntologyNoteView[])[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const turns = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const event of note.coRead ?? []) {
      for (const other of event.with) {
        if (!byId.has(other) || other === note.id) continue;
        const key = note.id < other ? `${note.id}|${other}` : `${other}|${note.id}`;
        const set = turns.get(key) ?? new Set<string>();
        set.add(`${event.s}:${event.t}`);
        turns.set(key, set);
      }
    }
  }
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const linked = new Set<string>();
  for (const [key, set] of turns) {
    if (set.size < minCoReads) continue;
    const [a, b] = key.split("|") as [string, string];
    parent.set(find(a), find(b));
    linked.add(a);
    linked.add(b);
  }
  const groups = new Map<string, OntologyNoteView[]>();
  for (const id of linked) {
    const root = find(id);
    const member = byId.get(id);
    if (member === undefined) continue;
    const list = groups.get(root) ?? [];
    list.push(member);
    groups.set(root, list);
  }
  return [...groups.values()].filter((group) => group.length >= 2);
}

/**
 * An ingested source (`file` note under `sources/`) is a deliberate, whole document, so it is due on its own: it
 * counts as `minNotes` notes toward the accumulation threshold. Every other note counts as one.
 */
const isSource = (note: OntologyNoteView): boolean => note.kind === "file" && note.path?.startsWith("sources/") === true;
const evidenceWeight = (notes: readonly OntologyNoteView[], minNotes: number): number =>
  notes.reduce((sum, note) => sum + (isSource(note) ? minNotes : 1), 0);

/** Groups of unbound notes that share an enrichment keyword, largest first, each note in one group. */
function keywordClusters(notes: readonly OntologyNoteView[], minNotes: number): readonly (readonly OntologyNoteView[])[] {
  const byKeyword = new Map<string, OntologyNoteView[]>();
  for (const note of notes) {
    for (const keyword of new Set((note.keywords ?? []).map((word) => word.toLowerCase()))) {
      const list = byKeyword.get(keyword) ?? [];
      list.push(note);
      byKeyword.set(keyword, list);
    }
  }
  const used = new Set<string>();
  const clusters: OntologyNoteView[][] = [];
  const ranked = [...byKeyword.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  for (const [, group] of ranked) {
    const fresh = group.filter((note) => !used.has(note.id));
    if (evidenceWeight(fresh, minNotes) < minNotes) continue;
    for (const note of fresh) used.add(note.id);
    clusters.push(fresh);
  }
  return clusters;
}

/** Work due in one scope, in priority order: repair, then co-read, then accumulation. */
export async function planScope(port: FabricOntologyPort, scope: FabricScopeLevel, options: PlanOptions): Promise<readonly WorkItem[]> {
  const { signal } = options;
  const subjects = await port.subjects(scope, signal === undefined ? {} : { signal });
  const dirty = await port.dirty(scope, signal === undefined ? {} : { signal });
  const bySlug = new Map(subjects.map((subject) => [subject.subject, subject]));
  const items = new Map<string, { item: WorkItem; reasons: Set<WikiTrigger>; noteIds: string[] }>();

  const add = (kind: "subject" | "cluster", key: string, reason: WikiTrigger, noteIds: readonly string[], subject?: string): void => {
    const known = items.get(key);
    if (known !== undefined) {
      known.reasons.add(reason);
      for (const id of noteIds) if (!known.noteIds.includes(id)) known.noteIds.push(id);
      return;
    }
    const concept = subject === undefined ? undefined : bySlug.get(subject);
    items.set(key, {
      item: {
        scope,
        kind,
        ...(subject === undefined ? {} : { subject }),
        ...(concept === undefined ? {} : { conceptId: concept.conceptId }),
        reasons: [],
        noteIds: [],
        attempt: key,
        more: false,
      },
      reasons: new Set([reason]),
      noteIds: [...noteIds],
    });
  };

  if (options.triggers.includes("repair")) {
    for (const entry of dirty) {
      if (entry.reasons.includes("stale") || entry.reasons.includes("removed"))
        add("subject", `s:${entry.subject}`, "repair", [], entry.subject);
    }
  }

  // The notes a bound subject has not cited yet. Fetched once per subject and shared by both policies below.
  const uncited = new Map<string, readonly OntologyNoteView[]>();
  const uncitedFor = async (slug: string): Promise<readonly OntologyNoteView[]> => {
    const known = uncited.get(slug);
    if (known !== undefined) return known;
    const concept = bySlug.get(slug);
    if (concept === undefined) return [];
    const cited = await citedBy(port, scope, concept.conceptId, signal);
    const notes = (await scan(port, scope, { subject: slug }, signal)).filter((note) => !cited.has(note.id)).sort(newestFirst);
    uncited.set(slug, notes);
    return notes;
  };

  if (options.triggers.includes("co-read")) {
    const clusters = coReadClusters(await scan(port, scope, { coRead: true }, signal), options.minCoReads);
    for (const cluster of clusters) {
      const subjectsHere = new Set(
        cluster.flatMap((note) => (note.subject !== undefined && bySlug.has(note.subject) ? [note.subject] : [])),
      );
      if (subjectsHere.size > 1) continue; // a cluster across subjects is not one subject's evidence
      const [slug] = subjectsHere;
      if (slug === undefined) {
        const members = cluster.filter((note) => note.subject === undefined || !bySlug.has(note.subject)).sort(newestFirst);
        add(
          "cluster",
          `c:${fingerprint(members.map((note) => note.id))}`,
          "co-read",
          members.map((note) => note.id),
        );
        continue;
      }
      const concept = bySlug.get(slug);
      if (concept === undefined) continue;
      const cited = await citedBy(port, scope, concept.conceptId, signal);
      const fresh = cluster.filter((note) => !cited.has(note.id)).sort(newestFirst);
      if (fresh.length > 0)
        add(
          "subject",
          `s:${slug}`,
          "co-read",
          fresh.map((note) => note.id),
          slug,
        );
    }
  }

  if (options.triggers.includes("accumulation")) {
    for (const entry of dirty) {
      if (!entry.reasons.includes("evidence")) continue;
      const notes = await uncitedFor(entry.subject);
      if (evidenceWeight(notes, options.minNotes) >= (options.force === true ? 1 : options.minNotes)) {
        add(
          "subject",
          `s:${entry.subject}`,
          "accumulation",
          notes.map((note) => note.id),
          entry.subject,
        );
      }
    }
    const unbound = await scan(port, scope, { unbound: true }, signal);
    for (const cluster of keywordClusters(unbound, options.force === true ? Math.min(2, options.minNotes) : options.minNotes).slice(
      0,
      MAX_CLUSTERS,
    )) {
      const members = [...cluster].sort(newestFirst);
      add(
        "cluster",
        `c:${fingerprint(members.map((note) => note.id))}`,
        "accumulation",
        members.map((note) => note.id),
      );
    }
  }

  const order: Record<WikiTrigger, number> = { repair: 0, "co-read": 1, accumulation: 2 };
  const ranked = [...items.values()].map(({ item, reasons, noteIds }) => {
    const sorted = WIKI_TRIGGERS.filter((trigger) => reasons.has(trigger));
    return {
      ...item,
      reasons: sorted,
      noteIds: noteIds.slice(0, MAX_PROMPT_NOTES),
      more: noteIds.length > MAX_PROMPT_NOTES,
    } satisfies WorkItem;
  });
  const rank = (item: WorkItem): number => order[item.reasons[0] ?? "accumulation"];
  ranked.sort((a, b) => rank(a) - rank(b) || (a.attempt < b.attempt ? -1 : 1));
  // An attempt the curator already answered with nothing is not asked again until its evidence changes.
  return ranked.filter((item) => !options.declined.has(`${item.attempt}|${fingerprint(item.noteIds)}|${item.reasons.join("+")}`));
}

/** The key under which an attempt answered with nothing is remembered. */
export function attemptKey(item: WorkItem): string {
  return `${item.attempt}|${fingerprint(item.noteIds)}|${item.reasons.join("+")}`;
}
