/**
 * Merging (plan 188.4 Task 5): duplicates fold without a model. Episode-cluster merging was removed with the
 * episode view (plan 216 Task 7). The planner is pure — grouping is deterministic and bounded — so the pass in
 * `create.ts` only performs the writes the plan names.
 */

import { lexicalDice, lexicalTerms } from "@arnilo/prism-memory-core";
import { unionStrings } from "../consolidate.js";
import { mergeNoteLinks } from "../links.js";
import type { MemoryNoteLink, MemoryNoteMetadata, MemoryNotePromotionStamp } from "../types.js";
import { type CapacityNote, compareNotes } from "./capacity.js";
import { MAX_USE_EVENTS, type MemoryNoteUseEvent, readUseEvents } from "./events.js";
import { type StorageWeights, storageStrength } from "./strength.js";

/** Cosine-free floor for "the same note twice": term-set Dice over the active lexical mode. */
export const DEFAULT_DUPLICATE_DICE = 0.8;
export const MAX_DUPLICATE_DICE = 1;
export const MIN_DUPLICATE_DICE = 0.5;

export interface DuplicateGroup {
  readonly survivor: CapacityNote;
  readonly others: readonly CapacityNote[];
}

/** Merge identity: one kind, one scope level, one glob set. A project note never folds into a user one. */
function scopeIdentity(note: CapacityNote): string {
  const level = note.metadata.scope ?? "project";
  const appliesTo = level === "path" ? [...(note.metadata.appliesTo ?? [])].sort().join(",") : "";
  return `${note.metadata.kind}|${level}|${appliesTo}`;
}

/**
 * Both sides of a merge must be unpinned (a merge archives the loser), and an episode is never a
 * duplicate: an episode is an immutable record of what happened, not a note that can repeat.
 */
function mergeable(note: CapacityNote): boolean {
  return note.text !== undefined && note.metadata.pinned !== true && note.metadata.kind !== "episode";
}

function byStrength(notes: readonly CapacityNote[], weights?: StorageWeights) {
  return [...notes].sort((left, right) => {
    const delta = storageStrength(right.metadata, weights) - storageStrength(left.metadata, weights);
    return delta !== 0 ? delta : compareNotes(left, right);
  });
}

/**
 * Duplicate groups: notes of one kind in one scope with an equal `key`, or with term-set Dice at or
 * above `duplicateDice`. The survivor is the note with the higher storage strength; the rest fold in.
 * One note joins at most one group, so the pass never archives a note into another that just left.
 */
export function duplicateGroups(
  notes: readonly CapacityNote[],
  options: { readonly duplicateDice?: number; readonly weights?: StorageWeights } = {},
): readonly DuplicateGroup[] {
  const dice = options.duplicateDice ?? DEFAULT_DUPLICATE_DICE;
  const candidates = notes.filter(mergeable);
  const grouped = new Set<string>();
  const groups: DuplicateGroup[] = [];
  const alive = () => candidates.filter((note) => !grouped.has(note.id));

  // Pass 1: one `key` is one subject, so the notes cannot both stay.
  const byKey = new Map<string, CapacityNote[]>();
  for (const note of alive()) {
    if (note.metadata.key === undefined) continue;
    const bucket = `${scopeIdentity(note)}|${note.metadata.key}`;
    byKey.set(bucket, [...(byKey.get(bucket) ?? []), note]);
  }
  for (const bucket of [...byKey.keys()].sort()) {
    const members = byKey.get(bucket)!;
    if (members.length < 2) continue;
    const [survivor, ...others] = byStrength(members, options.weights);
    for (const note of members) grouped.add(note.id);
    groups.push({ survivor: survivor!, others });
  }

  // Pass 2: the same statement written twice, without a key to say so.
  for (const note of alive()) {
    const peers = alive().filter(
      (other) => other.id !== note.id && scopeIdentity(other) === scopeIdentity(note) && other.metadata.key === undefined,
    );
    const similar = peers.filter((other) => lexicalDice(lexicalTerms(note.text!), lexicalTerms(other.text!)) >= dice);
    if (similar.length === 0) continue;
    const members = [note, ...similar];
    const [survivor, ...others] = byStrength(members, options.weights);
    for (const member of members) grouped.add(member.id);
    groups.push({ survivor: survivor!, others });
  }
  return groups;
}

function bestPromotion(notes: readonly MemoryNoteMetadata[]): MemoryNotePromotionStamp | undefined {
  let best: MemoryNotePromotionStamp | undefined;
  for (const note of notes) {
    if (note.promotion !== undefined && (best === undefined || note.promotion.score > best.score)) best = note.promotion;
  }
  return best;
}

/** The survivor keeps its own claims (text, key, scope) and inherits everything the others learned. */
export function mergedMetadata(survivor: MemoryNoteMetadata, others: readonly MemoryNoteMetadata[]): MemoryNoteMetadata {
  const sorted = [survivor, ...others];
  const uses = sorted
    .flatMap((note) => readUseEvents(note.uses) ?? [])
    .sort((left: MemoryNoteUseEvent, right: MemoryNoteUseEvent) => left.s - right.s)
    .slice(-MAX_USE_EVENTS);
  let useSessions = survivor.useSessions ?? 0;
  let retrievals = survivor.retrievals ?? 0;
  let helpful = survivor.helpful ?? 0;
  let harmful = survivor.harmful ?? 0;
  let lastSession = survivor.lastSession;
  for (const note of others) {
    useSessions += note.useSessions ?? 0;
    retrievals += note.retrievals ?? 0;
    helpful += note.helpful ?? 0;
    harmful += note.harmful ?? 0;
    lastSession = lastSession ?? note.lastSession;
  }
  const keywords = sorted.reduce<readonly string[] | undefined>((all, note) => unionStrings(all, note.keywords), undefined);
  const tags = sorted.reduce<readonly string[] | undefined>((all, note) => unionStrings(all, note.tags), undefined);
  const links = sorted.reduce<readonly MemoryNoteLink[] | undefined>((all, note) => mergeNoteLinks(all, note.links), undefined);
  const sourceEntryIds = sorted.reduce<readonly string[] | undefined>((all, note) => unionStrings(all, note.sourceEntryIds), undefined);
  const { mergedInto: _mergedInto, ...base } = survivor;
  const promotion = bestPromotion(sorted);
  return {
    ...base,
    ...(keywords === undefined ? {} : { keywords }),
    ...(tags === undefined ? {} : { tags }),
    ...(links === undefined ? {} : { links }),
    ...(sourceEntryIds === undefined ? {} : { sourceEntryIds }),
    ...(uses.length === 0 ? {} : { uses }),
    ...(useSessions > 0 ? { useSessions } : {}),
    ...(retrievals > 0 ? { retrievals } : {}),
    ...(helpful > 0 ? { helpful } : {}),
    ...(harmful > 0 ? { harmful } : {}),
    ...(lastSession === undefined ? {} : { lastSession }),
    // The strongest promotion stamp survives: its signals are what S and the archive rule read.
    ...(promotion === undefined ? {} : { promotion }),
  };
}
