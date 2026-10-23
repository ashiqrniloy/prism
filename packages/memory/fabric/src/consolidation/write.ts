/**
 * Writing accepted consolidation notes (plan 188.3 Task 4).
 *
 * One write path for tools and promotion: an accepted note becomes a candidate through the same
 * `remember` the agent uses, so write-time consolidation, the optional decider, and the
 * never-demote-a-verified-note rule all apply. This module adds only what a session pass knows that
 * a tool write does not: where the note came from, what it contradicts, and whether it replaces an
 * existing note in place.
 */
import type { Memory } from "@arnilo/prism-memory-core";
import type { MemoryNoteStatus } from "../lifecycle/index.js";
import { createFabricLifecycle } from "../lifecycle/index.js";
import { SCOPE_DEPTH } from "../scope/recall.js";
import {
  encodeMemoryNoteMetadata,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryFabric,
  type MemoryFabricScopeBinding,
  type MemoryFabricWriteOptions,
  type MemoryNoteKind,
  type MemoryNoteScope,
  parseMemoryNoteMetadata,
} from "../types.js";
import type { ExtractedNote } from "./extract.js";
import { isStorableExtractedKind } from "./prompts.js";
import type { PromotionScore, PromotionSignals } from "./score.js";

/** An active note the pass recalled: enough to route a contradiction and reconsolidate in place. */
export interface ConsolidationKnownNote {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly level?: MemoryNoteScope;
  readonly key?: string;
  readonly status?: MemoryNoteStatus;
  readonly flags?: readonly string[];
  readonly sourceEntryIds?: readonly string[];
  readonly supersedes?: string;
}

/** One note the gate accepted, with the gathered candidates it cites already resolved. */
export interface AcceptedConsolidationNote {
  readonly note: ExtractedNote;
  readonly score: PromotionScore;
  /** Session entry ids behind `note.evidence`, stored as `sources[]`. */
  readonly evidenceEntryIds: readonly string[];
  /** An existing note this note updates in place (reconsolidation): same id, correction lineage kept. */
  readonly replacing?: ConsolidationKnownNote;
  /** A shown existing note this note contradicts. */
  readonly contradicts?: ConsolidationKnownNote;
  /** A shown note this keyed value replaces; the write path supersedes it. */
  readonly supersedes?: { readonly id: string };
}

export interface WriteConsolidationNotesInput {
  readonly remember: MemoryFabric["remember"];
  /** The project memory; `scopes` names the other levels a wider note may live in. */
  readonly memory: Memory;
  readonly scopes?: readonly MemoryFabricScopeBinding[];
  readonly notes: readonly AcceptedConsolidationNote[];
  /** Reconsolidating notes the extractor returned nothing for: retired, never deleted. */
  readonly retire?: readonly { readonly id: string; readonly level?: MemoryNoteScope }[];
  /** Exchange note ids → the scope they live in, so a fact links only exchanges its scope can read. */
  readonly exchangeEvidence?: ReadonlyMap<string, MemoryNoteScope>;
  readonly sessionId: string;
  readonly pass: string;
  /** The project id added to `contradictedIn`; required for an exception to be written. */
  readonly projectId?: string;
  readonly now?: string;
  readonly signal?: AbortSignal;
}

export interface SkippedConsolidationWrite {
  readonly text: string;
  readonly reason:
    | "episode-view"
    | "exception-scope"
    | "exception-key"
    | "exception-project"
    | "contradicted-note-missing"
    | "flagged"
    | "retired";
}

export interface WriteConsolidationNotesResult {
  readonly written: number;
  readonly updated: number;
  readonly exceptions: number;
  readonly retired: number;
  readonly skipped: readonly SkippedConsolidationWrite[];
}

/**
 * Write the accepted notes, then retire the reconsolidating notes that produced nothing.
 *
 * A contradiction of a wider note becomes an exception in the narrower scope: same `key`, plus
 * `overrides` naming the wider note, so plan 188.2's narrowest-scope-wins shadowing applies. The
 * wider note gains this project id in `contradictedIn` (ids only, never text). An exception never
 * targets `user` or `agent` scope from a project session.
 */
export async function writeConsolidationNotes(input: WriteConsolidationNotesInput): Promise<WriteConsolidationNotesResult> {
  const memories = new Map<MemoryNoteScope, Memory>([["project", input.memory]]);
  for (const binding of input.scopes ?? []) memories.set(binding.level, binding.memory);
  // Only a caller that declared its active scopes can have a note scope remapped; one that passed
  // just a memory keeps writing where the note says (the single-scope shape of the direct API).
  const scopesDeclared = (input.scopes ?? []).length > 0;
  const memoryFor = (level: MemoryNoteScope | undefined): Memory =>
    level === undefined || level === "project" ? input.memory : (memories.get(level) ?? input.memory);

  let written = 0;
  let updated = 0;
  let exceptions = 0;
  const skipped: SkippedConsolidationWrite[] = [];

  for (const accepted of input.notes) {
    const { note, score } = accepted;
    // A scope that is not active cannot receive the write: the note lands in the project scope
    // instead of failing the whole pass (plan 188.9 Task 9 runs with user and agent off).
    const level: MemoryNoteScope =
      note.scope === "path" || note.scope === "project" || !scopesDeclared || memories.has(note.scope) ? note.scope : "project";
    if (!isStorableExtractedKind(note.kind)) {
      skipped.push({ text: note.text, reason: "episode-view" });
      continue;
    }
    const contradiction = accepted.contradicts;
    const wider =
      contradiction !== undefined &&
      contradiction.level !== undefined &&
      SCOPE_DEPTH.indexOf(contradiction.level) > SCOPE_DEPTH.indexOf(note.scope);
    // The extractor already downgrades `agent` to `project`, so `user` is the only wider target left.
    if (wider && note.scope === "user") {
      skipped.push({ text: note.text, reason: "exception-scope" });
      continue;
    }
    const exceptionKey = wider ? (note.key ?? contradiction.key) : note.key;
    if (wider && exceptionKey === undefined) {
      skipped.push({ text: note.text, reason: "exception-key" });
      continue;
    }
    if (wider && input.projectId === undefined) {
      skipped.push({ text: note.text, reason: "exception-project" });
      continue;
    }
    const contradicted = wider ? await readKnownNote(memoryFor(contradiction.level), contradiction.id) : undefined;
    if (wider && contradicted === undefined) {
      skipped.push({ text: note.text, reason: "contradicted-note-missing" });
      continue;
    }

    const existing = accepted.replacing === undefined ? undefined : await readKnownNote(memoryFor(level), accepted.replacing.id);
    if (accepted.replacing !== undefined && existing === undefined) {
      skipped.push({ text: note.text, reason: "contradicted-note-missing" });
      continue;
    }
    if (existing !== undefined && ((existing.flags?.length ?? 0) > 0 || existing.status === "archived" || existing.status === "retired")) {
      skipped.push({
        text: note.text,
        reason: existing.status === "archived" || existing.status === "retired" ? "retired" : "flagged",
      });
      continue;
    }

    const keywords = [...new Set([...note.keywords, ...note.aliases])];
    // The exchanges behind the note are its verbatim evidence: a fact is the key, the exchange is the
    // detail. Only an exchange the note's own scope can read is linked.
    const exchangeLinks = [...new Set(accepted.evidenceEntryIds)].flatMap((id) => {
      const evidenceScope = input.exchangeEvidence?.get(id);
      return evidenceScope === undefined || !readableFrom(evidenceScope, level) ? [] : [{ id, relation: "evidence" as const }];
    });
    const supersededBy = accepted.supersedes?.id;
    const contradicting =
      contradiction === undefined ||
      wider ||
      existing !== undefined ||
      accepted.supersedes !== undefined ||
      contradiction.id === supersededBy
        ? []
        : [{ id: contradiction.id, relation: "contradicts" as const }];
    const links = [...contradicting, ...exchangeLinks];
    // An exchange is linked, not a session entry: `sources` stays the transcript entries behind the note.
    const sourceEntryIds = [
      ...new Set([
        ...(existing?.sourceEntryIds ?? []),
        ...accepted.evidenceEntryIds.filter((id) => input.exchangeEvidence?.has(id) !== true),
      ]),
    ];
    const writeOptions: MemoryFabricWriteOptions = {
      sessionId: input.sessionId,
      // A verified note stays verified through a reconsolidating rewrite; absent status means verified.
      ...(existing !== undefined && existing.status !== "candidate" ? {} : { status: "candidate" as const }),
      generatedBy: "promotion",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    await input.remember(
      {
        kind: note.kind as MemoryNoteKind,
        content: note.text,
        scope: level,
        ...(exceptionKey === undefined ? {} : { key: exceptionKey }),
        ...(note.tRef === undefined ? {} : { tRef: note.tRef }),
        ...(note.appliesTo === undefined ? {} : { appliesTo: note.appliesTo }),
        ...(keywords.length === 0 ? {} : { keywords }),
        ...(sourceEntryIds.length === 0 ? {} : { sourceEntryIds }),
        ...(links.length === 0 ? {} : { links }),
        ...(wider ? { overrides: contradicted!.id } : {}),
        ...(existing === undefined ? {} : { id: existing.id }),
        ...(accepted.supersedes === undefined ? {} : { supersedes: accepted.supersedes.id }),
        ...(existing?.supersedes === undefined ? {} : { supersedes: existing.supersedes }),
        promotion: { score: score.score, signals: signalsRecord(score.signals), pass: input.pass },
      },
      writeOptions,
    );

    if (existing !== undefined) updated += 1;
    else written += 1;
    if (wider) {
      exceptions += 1;
      await addContradictedIn(memoryFor(contradiction.level), contradicted!.id, input.projectId!);
    }
  }

  const now = input.now ?? new Date().toISOString();
  let retired = 0;
  for (const entry of input.retire ?? []) {
    const retiredNote = await createFabricLifecycle(memoryFor(entry.level)).retireNote(
      entry.id,
      now,
      input.signal === undefined ? {} : { signal: input.signal },
    );
    if (retiredNote) retired += 1;
  }

  return { written, updated, exceptions, retired, skipped };
}

/** A note may link evidence held at its own scope, at `user` (readable everywhere), or path→project. */
function readableFrom(evidence: MemoryNoteScope, scope: MemoryNoteScope): boolean {
  return evidence === "user" || evidence === scope || (scope === "path" && evidence === "project");
}

function signalsRecord(signals: PromotionSignals): Record<string, number> {
  return { ...signals };
}

/** Read one note through the fabric parser, so a malformed row is never treated as known. */
async function readKnownNote(memory: Memory, id: string): Promise<ConsolidationKnownNote | undefined> {
  const [record] = await memory.get([id]);
  if (record === undefined) return undefined;
  const metadata = parseMemoryNoteMetadata(record.metadata);
  if (metadata === undefined) return undefined;
  return {
    id: record.id,
    kind: metadata.kind,
    text: record.text,
    ...(metadata.scope === undefined ? {} : { level: metadata.scope }),
    ...(metadata.key === undefined ? {} : { key: metadata.key }),
    ...(metadata.status === undefined ? {} : { status: metadata.status }),
    ...(metadata.flags === undefined ? {} : { flags: metadata.flags }),
    ...(metadata.sourceEntryIds === undefined ? {} : { sourceEntryIds: metadata.sourceEntryIds }),
    ...(metadata.supersedes === undefined ? {} : { supersedes: metadata.supersedes }),
  };
}

/** Add the project id to the wider note's `contradictedIn`, deduplicated; ids only. */
async function addContradictedIn(memory: Memory, id: string, projectIdValue: string): Promise<void> {
  const [record] = await memory.get([id]);
  const metadata = record === undefined ? undefined : parseMemoryNoteMetadata(record.metadata);
  if (record === undefined || metadata === undefined) return;
  const contradictedIn = [...new Set([...(metadata.contradictedIn ?? []), projectIdValue])];
  await memory.patchMetadata(id, (current) => ({
    ...current,
    [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({ ...metadata, contradictedIn }),
  }));
}
