/**
 * Per-note lifecycle view (plan 188.4 Further Action 4): S, R, the use log, and why the archive and
 * widening rules do or do not pick this note. The decisions stay in `archive.ts` and `widen.ts`; this
 * module only explains them, so an operator reads a note instead of `log.md` or a debug script.
 */
import { type MemoryNoteMetadata, type MemoryNoteScope, type MemoryNoteStatus } from "../types.js";
import { type ArchiveConfig, DEFAULT_ARCHIVE_CONFIG, lessonUnused, shouldArchive } from "./archive.js";
import {
  type MemoryNoteDecay,
  type StorageWeights,
  DEFAULT_DECAY,
  DEFAULT_STORAGE_WEIGHTS,
  noteImportance,
  retrievalStrength,
  storageStrength,
} from "./strength.js";

/** One gate's verdict: `eligible` with no reasons, or the gates that refused. */
export interface LifecycleDecisionView {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export interface LifecycleNoteView {
  readonly id: string;
  readonly kind: MemoryNoteMetadata["kind"];
  readonly noteScope?: MemoryNoteScope;
  readonly key?: string;
  readonly status: MemoryNoteStatus;
  readonly created?: number;
  readonly pinned?: boolean;
  readonly uses: readonly { readonly s: number; readonly at?: string }[];
  readonly useSessions: number;
  readonly retrievals: number;
  readonly helpful: number;
  readonly harmful: number;
  /** Storage strength S, rounded for printing. */
  readonly storage: number;
  /** Retrieval strength R, rounded for printing. */
  readonly retrieval: number;
  /** `noteImportance(S)` as stamped on the note at write time. */
  readonly importance: number;
  readonly archive: LifecycleDecisionView;
  readonly contradictedIn?: readonly string[];
  readonly archivedAt?: string;
  readonly archivedFrom?: MemoryNoteStatus;
  readonly mergedInto?: string;
  readonly validTo?: string;
}

export interface InspectNoteInput {
  readonly id: string;
  readonly metadata: MemoryNoteMetadata;
  readonly status: MemoryNoteStatus;
  /** The scope's session ordinal, the same clock `maintain()` reads. */
  readonly clock: number;
  readonly archive?: ArchiveConfig;
  readonly decay?: MemoryNoteDecay;
  readonly storageWeights?: StorageWeights;
}

/** Why `shouldArchive` refused, in the predicate's own order, so the view cannot disagree with it. */
function archiveReasons(input: InspectNoteInput): readonly string[] {
  const { metadata, clock } = input;
  const archive = input.archive ?? DEFAULT_ARCHIVE_CONFIG;
  const decay = input.decay ?? DEFAULT_DECAY;
  const weights = input.storageWeights ?? DEFAULT_STORAGE_WEIGHTS;
  const reasons: string[] = [];
  if (metadata.pinned === true) reasons.push("pinned");
  else if (lessonUnused(metadata, clock, archive)) return reasons;
  if (retrievalStrength(metadata, clock, decay[metadata.kind] ?? DEFAULT_DECAY.fact) >= archive.retrievalBelow) reasons.push("retrieval");
  if (storageStrength(metadata, weights) >= archive.storageBelow) reasons.push("storage");
  const created = Number.isSafeInteger(metadata.created) && (metadata.created as number) > 0 ? (metadata.created as number) : 0;
  if (clock - created < archive.graceSessions) reasons.push("grace");
  return reasons;
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

export function inspectNote(input: InspectNoteInput): LifecycleNoteView {
  const { metadata, status } = input;
  const decay = input.decay ?? DEFAULT_DECAY;
  const storage = storageStrength(metadata, input.storageWeights);
  const reasons = archiveReasons(input);
  return {
    id: input.id,
    kind: metadata.kind,
    ...(metadata.scope === undefined ? {} : { noteScope: metadata.scope }),
    ...(metadata.key === undefined ? {} : { key: metadata.key }),
    status,
    ...(metadata.created === undefined ? {} : { created: metadata.created }),
    ...(metadata.pinned === undefined ? {} : { pinned: metadata.pinned }),
    uses: (metadata.uses ?? []).map((use) => (use.at === undefined ? { s: use.s } : { s: use.s, at: use.at })),
    useSessions: metadata.useSessions ?? 0,
    retrievals: metadata.retrievals ?? 0,
    helpful: metadata.helpful ?? 0,
    harmful: metadata.harmful ?? 0,
    storage: round(storage),
    retrieval: round(retrievalStrength(metadata, input.clock, decay[metadata.kind] ?? DEFAULT_DECAY.fact)),
    importance: round(noteImportance(storage)),
    archive: {
      eligible:
        reasons.length === 0 &&
        shouldArchive(metadata, input.clock, {
          ...(input.archive === undefined ? {} : { archive: input.archive }),
          ...(input.decay === undefined ? {} : { decay: input.decay }),
          ...(input.storageWeights === undefined ? {} : { storageWeights: input.storageWeights }),
        }),
      reasons,
    },
    ...(metadata.contradictedIn === undefined ? {} : { contradictedIn: metadata.contradictedIn }),
    ...(metadata.archivedAt === undefined ? {} : { archivedAt: metadata.archivedAt }),
    ...(metadata.archivedFrom === undefined ? {} : { archivedFrom: metadata.archivedFrom }),
    ...(metadata.mergedInto === undefined ? {} : { mergedInto: metadata.mergedInto }),
    ...(metadata.validTo === undefined ? {} : { validTo: metadata.validTo }),
  };
}

/** One line an operator can scan: the rememberable surface, without the token cost of JSON. */
export function describeNote(view: LifecycleNoteView): string {
  const parts = [
    view.id,
    view.kind,
    view.key === undefined ? "-" : `key=${view.key}`,
    view.status,
    `S=${view.storage}`,
    `R=${view.retrieval}`,
    `uses=${view.uses.length}/${view.useSessions}`,
    `archive=${view.archive.eligible ? "yes" : `no(${view.archive.reasons.join(",")})`}`,
  ];
  if (view.mergedInto !== undefined) parts.push(`mergedInto=${view.mergedInto}`);
  return parts.join(" ");
}
