/**
 * Scope widening and narrowing (plan 188.4 Task 6): a lesson proven in two projects may live at
 * `agent`; a note that two projects contradict stops being true.
 *
 * Widening is replication-gated and deterministic: verification plus a second project is what
 * promotes knowledge, so one compromised project cannot plant agent-wide instructions. The grouping
 * is pure; the writes happen through the fabric's own write path in `maintain.ts`.
 */
import { type CapacityNote, compareNotes } from "./capacity.js";
import { type StorageWeights, storageStrength } from "./strength.js";

export interface WidenConfig {
  /** Distinct projects a verified lesson needs before it may live at `agent`; never below 2. */
  readonly minProjects: number;
  readonly minSiblings: number;
  readonly contradictionsToSupersede: number;
}

/** Provisional defaults (plan 188.6 fits them). */
export const DEFAULT_WIDEN_CONFIG: WidenConfig = { minProjects: 2, minSiblings: 2, contradictionsToSupersede: 2 };
/** One project can never widen: the poisoning bound is the replication rule itself. */
export const MIN_WIDEN_PROJECTS = 2;
export const MAX_WIDEN_PROJECTS = 10;
export const MIN_WIDEN_SIBLINGS = 2;
export const MAX_WIDEN_SIBLINGS = 20;
export const MIN_WIDEN_CONTRADICTIONS = 2;
export const MAX_WIDEN_CONTRADICTIONS = 20;

/** One active note tagged with the project resource it was read from. */
export interface WidenNote extends CapacityNote {
  readonly project: string;
}

export interface WidenGroup {
  /** The note whose text becomes the wider note: highest storage strength, ties by id. */
  readonly survivor: WidenNote;
  readonly others: readonly WidenNote[];
  readonly projects: readonly string[];
}

/**
 * Conservative content equality (plan 188.7 Task 4): case, Unicode form and runs of whitespace are
 * ignorable; numbers, negation and every other token are not. Dice "semantic agreement" is never used
 * to widen, because one shared subject key does not prove the two values agree.
 */
export function normalizeWidenText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!;:,]+$/, "");
}

/** Project names/ids named by the text make it project-bound, whatever the key says. */
function mentionsResource(text: string, projects: readonly string[]): boolean {
  const normalized = normalizeWidenText(text);
  for (const project of projects) {
    const name = /^projects\/(.+?)--[0-9a-f]+$/.exec(project)?.[1] ?? /^projects\/(.+)$/.exec(project)?.[1];
    for (const alias of [project, name]) {
      if (alias !== undefined && alias.length >= 3 && normalized.includes(alias.toLowerCase())) return true;
    }
  }
  return false;
}

/** One note is one witness; notes copied from the same source never corroborate each other. */
function witnessOrigin(note: CapacityNote): string {
  const sources = note.metadata.sourceEntryIds ?? [];
  return sources.length === 0 ? `note:${note.id}` : `source:${[...sources].sort().join(",")}`;
}

export interface SiblingGroup {
  readonly key: string;
  readonly survivor: CapacityNote;
  readonly others: readonly CapacityNote[];
  /** The sibling subtrees the globs cover; at least `minSiblings` distinct. */
  readonly subtrees: readonly string[];
}

/** What may widen: verified evidence, never contradicted, and never a note that hurt. */
function widenable(note: CapacityNote): boolean {
  return (
    note.status === "verified" &&
    (note.metadata.kind === "fact" || note.metadata.kind === "procedure") &&
    (note.metadata.harmful ?? 0) === 0 &&
    (note.metadata.contradictedIn ?? []).length === 0 &&
    note.metadata.pinned !== true
  );
}

function strongest(notes: readonly WidenNote[], weights?: StorageWeights): readonly WidenNote[] {
  return [...notes].sort((left, right) => {
    const delta = storageStrength(right.metadata, weights) - storageStrength(left.metadata, weights);
    return delta !== 0 ? delta : compareNotes(left, right);
  });
}

/**
 * Lessons the same in several projects: one `key` and one **identical** normalized value, or keyless
 * notes with identical normalized text. A group widens only when every readable note agrees on the
 * value (one differing note blocks the whole subject), at least `minProjects` distinct projects and
 * distinct witness origins supply readable text, and the text names no participating resource.
 * Metadata-only notes are evidence of presence, never of agreement. `duplicateDice` is retained for
 * source compatibility and ignored: fuzzy overlap is not agreement.
 */
export function crossProjectGroups(
  notes: readonly WidenNote[],
  options: { readonly duplicateDice?: number; readonly weights?: StorageWeights; readonly minProjects?: number } = {},
): readonly WidenGroup[] {
  const minProjects = Math.max(MIN_WIDEN_PROJECTS, options.minProjects ?? DEFAULT_WIDEN_CONFIG.minProjects);
  const candidates = notes.filter((note) => widenable(note) && note.metadata.scope !== "path");
  const buckets = new Map<string, WidenNote[]>();
  const subjectValues = new Map<string, Set<string>>();
  for (const note of candidates) {
    const key = note.metadata.key;
    const bucket =
      key === undefined
        ? `text|${note.metadata.kind}|${note.text === undefined ? `unreadable:${note.id}` : normalizeWidenText(note.text)}`
        : `key|${note.metadata.kind}|${key}`;
    const members = buckets.get(bucket);
    if (members === undefined) buckets.set(bucket, [note]);
    else members.push(note);
    if (key !== undefined && note.text !== undefined) {
      const subject = `${note.metadata.kind}|${key}`;
      const values = subjectValues.get(subject) ?? new Set<string>();
      values.add(normalizeWidenText(note.text));
      subjectValues.set(subject, values);
    }
  }
  const groups: { readonly bucket: string; readonly members: readonly WidenNote[] }[] = [];
  // A keyed subject with any different readable value is contested: no member of it may widen.
  const contested = new Set([...subjectValues].filter(([, values]) => values.size > 1).map(([subject]) => subject));
  for (const [bucket, members] of [...buckets].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    if (bucket.startsWith("key|")) {
      const [, kind, key] = bucket.split("|");
      if (contested.has(`${kind}|${key}`)) continue;
    }
    // Metadata-only notes cannot confirm agreement; if one shares the subject, fail the subject closed.
    if (members.some((note) => note.text === undefined)) continue;
    const readable = members.filter((note): note is WidenNote & { text: string } => note.text !== undefined);
    const values = new Set(readable.map((note) => normalizeWidenText(note.text)));
    if (values.size !== 1) continue;
    const projects = [...new Set(readable.map((note) => note.project))].sort();
    if (projects.length < minProjects) continue;
    if (new Set(readable.map(witnessOrigin)).size < minProjects) continue;
    if (readable.some((note) => mentionsResource(note.text, projects))) continue;
    const ordered = strongest(readable, options.weights);
    const survivor = ordered[0];
    if (survivor === undefined) continue;
    groups.push({ bucket, members: ordered });
  }
  return groups.map(({ members }) => ({
    survivor: members[0]!,
    others: members.slice(1),
    projects: [...new Set(members.map((note) => note.project))].sort(),
  }));
}

/** The literal part of a glob: everything before the first segment that can match many names. */
function subtreeOf(glob: string): { readonly parent: string; readonly subtree: string } {
  const segments = glob.split("/").filter((segment) => segment.length > 0);
  const literal: string[] = [];
  for (const segment of segments) {
    if (/[*?[{]/.test(segment)) break;
    literal.push(segment);
  }
  return { parent: literal.slice(0, -1).join("/"), subtree: literal.join("/") };
}

/**
 * Path notes of one project that agree across sibling subtrees: one `key`, verified, and globs that
 * cover at least `minSiblings` distinct subtrees under one parent. They widen to the project scope.
 */
export function siblingGroups(pathNotes: readonly CapacityNote[], minSiblings = DEFAULT_WIDEN_CONFIG.minSiblings): readonly SiblingGroup[] {
  const floor = Math.max(MIN_WIDEN_SIBLINGS, minSiblings);
  const byKey = new Map<string, CapacityNote[]>();
  for (const note of pathNotes) {
    if (!widenable(note)) continue;
    if (note.metadata.scope !== "path" || note.metadata.key === undefined) continue;
    if ((note.metadata.appliesTo ?? []).length === 0) continue;
    const bucket = byKey.get(note.metadata.key);
    if (bucket === undefined) byKey.set(note.metadata.key, [note]);
    else bucket.push(note);
  }
  const groups: SiblingGroup[] = [];
  for (const [key, bucket] of [...byKey].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    // Missing text, conflicting values, or mixed kinds block the whole subject: fail closed.
    if (bucket.some((note) => note.text === undefined)) continue;
    const kinds = new Set(bucket.map((note) => note.metadata.kind));
    if (kinds.size !== 1) continue;
    const values = new Set(bucket.map((note) => normalizeWidenText(note.text!)));
    if (values.size !== 1) continue;
    // A note counts for exactly one subtree under exactly one parent. A note listing two globs is
    // one witness, never two regions.
    const byParent = new Map<string, Map<string, CapacityNote[]>>();
    for (const note of bucket) {
      const placements = new Set(
        (note.metadata.appliesTo ?? []).map((glob) => {
          const { parent, subtree } = subtreeOf(glob);
          return `${parent}\u0000${subtree}`;
        }),
      );
      if (placements.size !== 1) continue;
      const [placement] = placements;
      const [parent, subtree] = placement!.split("\u0000");
      const subtrees = byParent.get(parent!) ?? new Map<string, CapacityNote[]>();
      const notes = subtrees.get(subtree!);
      if (notes === undefined) subtrees.set(subtree!, [note]);
      else notes.push(note);
      byParent.set(parent!, subtrees);
    }
    let best: { readonly subtrees: Map<string, CapacityNote[]>; readonly witnesses: readonly CapacityNote[] } | undefined;
    for (const subtrees of byParent.values()) {
      if (subtrees.size < floor) continue;
      const witnesses = [...subtrees.values()].map(
        (notes) =>
          [...notes].sort(
            (left, right) => storageStrength(right.metadata) - storageStrength(left.metadata) || compareNotes(left, right),
          )[0]!,
      );
      if (new Set(witnesses.map(witnessOrigin)).size < floor) continue;
      if (best === undefined || subtrees.size > best.subtrees.size) best = { subtrees, witnesses };
    }
    if (best === undefined) continue;
    const ordered = [...best.witnesses].sort((left, right) => {
      const delta = storageStrength(right.metadata) - storageStrength(left.metadata);
      return delta !== 0 ? delta : compareNotes(left, right);
    });
    groups.push({
      key,
      survivor: ordered[0]!,
      others: ordered.slice(1),
      subtrees: [...best.subtrees.keys()].sort(),
    });
  }
  return groups;
}

/** Wider-scope notes enough projects contradict: supersede them with `validTo`. */
export function narrowingCandidates(
  notes: readonly CapacityNote[],
  threshold = DEFAULT_WIDEN_CONFIG.contradictionsToSupersede,
): readonly string[] {
  const floor = Math.max(MIN_WIDEN_CONTRADICTIONS, threshold);
  return notes.filter((note) => (note.metadata.contradictedIn ?? []).length >= floor).map((note) => note.id);
}

/** Union of the keywords a wider note inherits from its sources. */
export function mergedKeywords(notes: readonly CapacityNote[], key?: string): readonly string[] {
  const keywords = new Set<string>();
  for (const note of notes) for (const keyword of note.metadata.keywords ?? []) keywords.add(keyword);
  if (key !== undefined) keywords.delete(key);
  return [...keywords].sort();
}
