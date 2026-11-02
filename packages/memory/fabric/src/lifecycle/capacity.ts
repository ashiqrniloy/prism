/**
 * Capacity budgets (plan 188.4 Task 5): what a scope may hold, and which notes leave first when it
 * holds more. Merging runs before eviction, and a note that earned its place — pinned, or above the
 * archive's storage threshold — is never evicted. The pass itself lives in `create.ts`; this module is
 * the arithmetic, so it is tested without a store.
 */
import type { MemoryNoteMetadata, MemoryNoteScope, MemoryNoteStatus } from "../types.js";
import { type ArchiveDecisionOptions, DEFAULT_ARCHIVE_CONFIG } from "./archive.js";
import { DEFAULT_DECAY, type MemoryNoteDecay, retrievalStrength, storageStrength } from "./strength.js";

export interface CapacityLimits {
  readonly notes: number;
  readonly tokens: number;
}

/** The exchange tier is size-only: raw history has no merge pass and no note-count budget. */
export interface ExchangeCapacityLimits {
  readonly hotTokens: number;
}

/** Provisional defaults (plan 188.6 fits them): a project resizes with the code, a profile does not. */
export const DEFAULT_CAPACITY: Readonly<Record<"user" | "agent" | "project", CapacityLimits>> = Object.freeze({
  user: { notes: 200, tokens: 20_000 },
  agent: { notes: 200, tokens: 20_000 },
  project: { notes: 500, tokens: 60_000 },
});

export const DEFAULT_EXCHANGE_CAPACITY: ExchangeCapacityLimits = Object.freeze({ hotTokens: 200_000 });

export const MAX_FABRIC_CAPACITY_NOTES = 10_000;
export const MAX_FABRIC_CAPACITY_TOKENS = 1_000_000;

export function capacityForLevel(level: MemoryNoteScope, capacity?: Readonly<Record<string, CapacityLimits>>): CapacityLimits {
  // A path note lives in its project's resource, so it shares the project budget.
  const key = level === "path" ? "project" : level;
  return capacity?.[key] ?? DEFAULT_CAPACITY[key as keyof typeof DEFAULT_CAPACITY];
}

/** One active note as the capacity pass sees it: metadata for the strengths, text for tokens and Dice. */
export interface CapacityNote {
  readonly id: string;
  readonly metadata: MemoryNoteMetadata;
  readonly status: MemoryNoteStatus;
  readonly tokens: number;
  /** Absent when the note lives in another thread of the resource: it counts, but cannot be merged. */
  readonly text?: string;
}

export interface CapacityUsage {
  readonly notes: number;
  readonly tokens: number;
}

export function capacityUsage(notes: readonly CapacityNote[]): CapacityUsage {
  let tokens = 0;
  for (const note of notes) tokens += note.tokens;
  return { notes: notes.length, tokens };
}

export function overCapacity(usage: CapacityUsage, limits: CapacityLimits): boolean {
  return usage.notes > limits.notes || usage.tokens > limits.tokens;
}

function decayOf(metadata: MemoryNoteMetadata, decay: MemoryNoteDecay = DEFAULT_DECAY): number {
  return decay[metadata.kind] ?? decay.fact;
}

function scored(note: CapacityNote, clock: number, options: ArchiveDecisionOptions): number {
  return (
    storageStrength(note.metadata, options.storageWeights) *
    Math.exp(retrievalStrength(note.metadata, clock, decayOf(note.metadata, options.decay)))
  );
}

/**
 * Stable order for equal-strength notes: content first, id only as a last resort. Note ids are random,
 * so id-first ties reorder real replays of one policy and invalidate warm caches.
 */
export function compareNotes(left: CapacityNote, right: CapacityNote): number {
  const key = (note: CapacityNote) =>
    `${note.metadata.kind}|${note.metadata.scope ?? "project"}|${note.text ?? ""}|${note.metadata.key ?? ""}`;
  const order = key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;
  return order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/**
 * Lowest `S·exp(R)` first — the note the ranking already valued least, ties broken by content. Pinned
 * notes and notes at or above the archive's storage threshold are protected: capacity pressure is not
 * a reason to shed knowledge that was earned.
 */
export function evictionOrder(
  notes: readonly CapacityNote[],
  clock: number,
  options: ArchiveDecisionOptions = {},
): readonly CapacityNote[] {
  const storageBelow = (options.archive ?? DEFAULT_ARCHIVE_CONFIG).storageBelow;
  return notes
    .filter((note) => note.text !== undefined && note.metadata.pinned !== true && note.metadata.kind !== "concept")
    .filter((note) => storageStrength(note.metadata, options.storageWeights) < storageBelow)
    .map((note) => ({ note, value: scored(note, clock, options) }))
    .sort((left, right) => left.value - right.value || compareNotes(left.note, right.note))
    .map((item) => item.note);
}

/**
 * Exchange demotion ignores the storage-strength protection that keeps a learned fact: raw history is
 * bounded by size alone. Pinned exchanges still stay, because pinning is an explicit host action.
 */
export function exchangeDemotionOrder(
  notes: readonly CapacityNote[],
  clock: number,
  options: ArchiveDecisionOptions = {},
): readonly CapacityNote[] {
  return notes
    .filter((note) => note.metadata.kind === "exchange" && note.text !== undefined && note.metadata.pinned !== true)
    .map((note) => ({ note, value: scored(note, clock, options) }))
    .sort((left, right) => left.value - right.value || compareNotes(left.note, right.note))
    .map((item) => item.note);
}
