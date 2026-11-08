/**
 * One consolidation pass (plan 188.3 Task 5): gather, extract once, score, gate, write.
 *
 * The pass owns no timer and no session state. A trigger checks `hasNewObservationalMaterial` and
 * hands the cursor in; the cursor comes back only when every write succeeded, so a failed pass
 * leaves the material for the next trigger.
 */
import type { ModelClient, SecretRedactor, SessionEntry } from "@arnilo/prism";
import { type Memory, type MemoryVectorRecord } from "@arnilo/prism-memory-core";
import { activeReflections, foldObservationalMemoryLedger, isTaskStateRecordedData, recordData } from "@arnilo/prism-memory-observational";
import { type ResolvedMemoryWorkerLimits } from "@arnilo/prism-memory-core";
import type { FabricConsolidationReport, ResolvedPromoteConfig } from "../promote.js";
import { type MemoryFabric, type MemoryFabricScopeBinding, type MemoryNoteScope, parseMemoryNoteMetadata } from "../types.js";
import { type ConsolidationExtraction, type ExtractedNote, extractConsolidationNotes } from "./extract.js";
import { type ConsolidationCandidate, gatherConsolidationCandidates } from "./gather.js";
import type { ConsolidationExistingNote, ConsolidationSegment } from "./prompts.js";
import { loadDerivableSources, type PromotionExistingNote, scorePromotion } from "./score.js";
import { type AcceptedConsolidationNote, type ConsolidationKnownNote, writeConsolidationNotes } from "./write.js";

/** The lifecycle work a pass needs; structurally `createFabricLifecycle(memory)`. */
export interface ConsolidationLifecycle {
  handleSupersededReflections(
    ids: ReadonlySet<string>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly supersededNotes: Map<string, MemoryVectorRecord> }>;
  reconsolidating(options?: { readonly signal?: AbortSignal }): Promise<readonly MemoryVectorRecord[]>;
}

export interface ConsolidationPassInput {
  readonly sessionId: string;
  readonly entries: readonly SessionEntry[];
  readonly cursor?: string;
  readonly remember: MemoryFabric["remember"];
  readonly memory: Memory;
  readonly scopes?: readonly MemoryFabricScopeBinding[];
  readonly lifecycleFor: (memory: Memory) => ConsolidationLifecycle;
  readonly config: ResolvedPromoteConfig;
  /** Resolved only when a pass actually calls the extractor. */
  readonly resolveClient: () => ModelClient;
  readonly limits: ResolvedMemoryWorkerLimits;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  /** Workspace root the `derivableFrom` files resolve inside. */
  readonly root: string;
  /** The project scope has a root, so the extractor gets the repository and derivability rules. */
  readonly repositoryRules?: boolean;
  /**
   * Not-yet-consolidated archived exchanges, gathered by the caller from the store. They join the
   * pass's candidates so one extractor call turns verbatim history into dated, keyed facts.
   */
  readonly exchanges?: readonly ConsolidationExchangeCandidate[];
  /** Marks the gathered exchanges as consolidated, after the pass wrote (or found nothing to write). */
  readonly markExchangesConsolidated?: (ids: readonly string[], at: string) => Promise<void>;
  readonly scratchDir?: string;
  /** The `<slug>--<id8>` id an exception records in the wider note's `contradictedIn`. */
  readonly projectId?: string;
  readonly now?: Date;
  readonly pass?: string;
  readonly signal?: AbortSignal;
  readonly recallExisting?: (
    query: string,
    scope: MemoryNoteScope,
    limit: number,
  ) => Promise<readonly ConsolidationExistingNote[]> | readonly ConsolidationExistingNote[];
}

/** One archived exchange offered to the pass as evidence. */
export interface ConsolidationExchangeCandidate {
  readonly id: string;
  readonly text: string;
  readonly level: MemoryNoteScope;
  readonly tRef?: string;
}

export interface ConsolidationPassResult {
  readonly report: FabricConsolidationReport;
  /** The new cursor: the last entry the pass covered, absent when nothing ran. */
  readonly cursor?: string;
}

const PASS_CANDIDATE_LIMIT = 256;

/** True when OM appended a reflection, superseded one, or a task-state decision after `cursor`. */
export function hasNewObservationalMaterial(entries: readonly SessionEntry[], cursor: string | undefined): boolean {
  const tail = entriesAfter(entries, cursor);
  const ledger = foldObservationalMemoryLedger(tail);
  if (activeReflections(ledger).length > 0) return true;
  if ((ledger.supersededReflectionIds?.length ?? 0) > 0) return true;
  return tail.some((entry) => {
    const data = recordData(entry);
    return isTaskStateRecordedData(data) && (data.taskState.decisions?.length ?? 0) > 0;
  });
}

/** Entries strictly after the cursor; an unknown cursor covers everything (fail towards re-gathering). */
export function entriesAfter(entries: readonly SessionEntry[], cursor: string | undefined): readonly SessionEntry[] {
  if (cursor === undefined) return entries;
  const index = entries.findIndex((entry) => entry.id === cursor);
  return entries.slice(index + 1);
}

/** One pass per session at a time; a trigger during a running pass is dropped, never queued. */
export function createConsolidationLease(): {
  readonly enter: (sessionId: string) => boolean;
  readonly exit: (sessionId: string) => void;
} {
  const running = new Set<string>();
  return {
    enter: (sessionId) => {
      if (running.has(sessionId)) return false;
      running.add(sessionId);
      return true;
    },
    exit: (sessionId) => {
      running.delete(sessionId);
    },
  };
}

/** The zero report every pass starts from; a failed pass persists one so `memory:status` keeps the reason. */
export function consolidationReport(at: string, fields: Partial<FabricConsolidationReport> = {}, pass = at): FabricConsolidationReport {
  return {
    pass,
    at,
    candidates: 0,
    extracted: 0,
    accepted: 0,
    rejected: { score: 0, ephemeral: 0, derivable: 0, trust: 0, secret: 0 },
    written: 0,
    updated: 0,
    exceptions: 0,
    retired: 0,
    modelCalls: 0,
    ...fields,
  };
}

/** Gather, extract once, score, gate, write; returns the report and the cursor to persist on success. */
export async function runConsolidationPass(input: ConsolidationPassInput): Promise<ConsolidationPassResult> {
  const at = (input.now ?? new Date()).toISOString();
  const pass = input.pass ?? at;
  const report = (fields: Partial<FabricConsolidationReport> = {}): FabricConsolidationReport => consolidationReport(at, fields, pass);

  const maxCandidates = Math.min(input.config.maxCandidates, PASS_CANDIDATE_LIMIT);
  const gathered = gatherConsolidationCandidates(input.entries, {
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    maxCandidates,
    maxTextChars: input.memory.limits.maxEntryTextChars,
    ...(input.redactor === undefined ? {} : { redact: (text: string) => input.redactor!.redact(text) }),
  });
  // Exchanges are the second source of candidates: verbatim history the archive already kept, so a
  // general pass reads facts out of it instead of out of the live transcript. Bounded with the rest.
  const exchanges = (input.exchanges ?? []).slice(0, Math.max(0, maxCandidates - gathered.length));
  const candidates: readonly ConsolidationCandidate[] = [
    ...gathered,
    ...exchanges.map((exchange) => ({
      source: "exchange" as const,
      text: exchange.text.slice(0, input.memory.limits.maxEntryTextChars),
      evidenceIds: [exchange.id],
      signals: {},
      ...(exchange.tRef === undefined ? {} : { tRef: exchange.tRef }),
    })),
  ];
  const tail = entriesAfter(input.entries, input.cursor);
  const ledger = foldObservationalMemoryLedger(tail);
  const bindings = scopesOf(input);
  const retire: { readonly id: string; readonly level?: MemoryNoteScope }[] = [];

  // A superseded reflection either retires its note or marks an edited verified note for re-extraction.
  const superseded = new Set(ledger.supersededReflectionIds ?? []);
  if (superseded.size > 0) {
    for (const binding of bindings) {
      const { supersededNotes } = await input.lifecycleFor(binding.memory).handleSupersededReflections(superseded, {
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      for (const record of supersededNotes.values()) retire.push({ id: record.id, level: scopeOf(record) ?? binding.level });
    }
  }

  // Notes a previous pass marked for reconsolidation are shown to the extractor as existing notes.
  const reconsolidating: { readonly level: MemoryNoteScope; readonly record: MemoryVectorRecord }[] = [];
  for (const binding of bindings) {
    for (const record of await input
      .lifecycleFor(binding.memory)
      .reconsolidating(input.signal === undefined ? {} : { signal: input.signal })) {
      reconsolidating.push({ level: scopeOf(record) ?? binding.level, record });
    }
  }
  const extraExisting = reconsolidating.flatMap(({ level, record }) => {
    const note = existingFromRecord(record, level);
    return note === undefined ? [] : [note];
  });

  const extraction =
    candidates.length === 0
      ? {
          notes: [] as const,
          existing: [] as const,
          rejected: { trust: 0, secret: 0 },
          modelCalls: 0,
          correctionCalls: 0,
          outputLimited: 0,
        }
      : await extract(input, candidates, extraExisting, ledger.taskState);

  const knownById = new Map<string, ConsolidationKnownNote>();
  for (const { level, record } of reconsolidating) {
    const known = knownFromRecord(record, level);
    if (known !== undefined) knownById.set(known.id, known);
  }
  for (const existing of extraction.existing) {
    if (knownById.has(existing.id)) continue;
    const binding = bindings.find((item) => item.level === existing.scope || (existing.scope === "path" && item.level === "project"));
    const record = binding === undefined ? undefined : (await binding.memory.get([existing.id])).at(0);
    const known = record === undefined ? undefined : knownFromRecord(record, existing.scope);
    if (known !== undefined) knownById.set(known.id, known);
  }

  const derivable = await loadDerivableSources(input.root, input.config.derivableFrom);
  const accepted: AcceptedConsolidationNote[] = [];
  const rejected = { score: 0, ephemeral: 0, derivable: 0, trust: extraction.rejected.trust, secret: extraction.rejected.secret };
  const matchedReconsolidating = new Set<string>();

  for (const note of extraction.notes) {
    const evidenceIds = note.evidence.flatMap((id) => candidateEvidence(candidates, id));
    const replacing = findReconsolidating(note, reconsolidating);
    if (replacing !== undefined) matchedReconsolidating.add(replacing.record.id);
    const contradicts = note.contradicts === undefined ? undefined : knownById.get(note.contradicts);
    const existing = existingSameScope(extraction.existing, knownById, note.scope);
    const score = scorePromotion(note, {
      candidates,
      sessions: replacing === undefined ? 1 : 2,
      ...(existing.length === 0 ? {} : { existing }),
      ...(derivable.sources.length === 0 ? {} : { derivable: derivable.sources }),
      ...(input.config.weights === undefined ? {} : { weights: input.config.weights }),
      minScore: input.config.minScore,
      ...(input.scratchDir === undefined ? {} : { scratchDir: input.scratchDir }),
    });
    if (!score.accepted) {
      rejected[score.reason ?? "score"] += 1;
      continue;
    }
    // A keyed value that is later than the shown note with the same key supersedes it, so one
    // current value stays current instead of two notes with one key piling up.
    const superseded = supersedingNote(note, extraction.existing);
    accepted.push({
      note,
      score,
      evidenceEntryIds: evidenceIds,
      ...(superseded === undefined ? {} : { supersedes: { id: superseded } }),
      ...(replacing === undefined ? {} : { replacing: knownFromRecord(replacing.record, replacing.level) }),
      ...(contradicts === undefined ? {} : { contradicts }),
    });
  }

  // Re-extracted notes the extractor no longer returns are retired, never deleted.
  for (const { level, record } of reconsolidating) {
    if (matchedReconsolidating.has(record.id)) continue;
    retire.push({ id: record.id, level });
  }

  const written = await writeConsolidationNotes({
    remember: input.remember,
    memory: input.memory,
    ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
    ...(exchanges.length === 0 ? {} : { exchangeEvidence: new Map(exchanges.map((exchange) => [exchange.id, exchange.level])) }),
    notes: accepted,
    ...(retire.length === 0 ? {} : { retire }),
    sessionId: input.sessionId,
    pass,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    now: at,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  // The exchanges were shown to the extractor: they never need to be gathered again, whether or not
  // this pass had anything durable to write from them.
  if (exchanges.length > 0 && input.markExchangesConsolidated !== undefined) {
    await input.markExchangesConsolidated(
      exchanges.map((exchange) => exchange.id),
      at,
    );
  }

  const last = input.entries.at(-1)?.id;
  return {
    report: report({
      candidates: candidates.length,
      extracted: extraction.notes.length,
      accepted: accepted.length,
      rejected,
      written: written.written,
      updated: written.updated,
      exceptions: written.exceptions,
      retired: written.retired,
      modelCalls: extraction.modelCalls,
      correctionCalls: extraction.correctionCalls,
      ...(extraction.outputLimited === 0 ? {} : { outputLimited: extraction.outputLimited }),
    }),
    ...(last === undefined ? {} : { cursor: last }),
  };
}

function scopesOf(input: ConsolidationPassInput): readonly MemoryFabricScopeBinding[] {
  return input.scopes ?? [{ level: "project", memory: input.memory }];
}

async function extract(
  input: ConsolidationPassInput,
  candidates: readonly ConsolidationCandidate[],
  extraExisting: readonly ConsolidationExistingNote[],
  taskState: { readonly goal: string; readonly decisions?: readonly string[] } | undefined,
): Promise<ConsolidationExtraction> {
  const segments: ConsolidationSegment[] =
    taskState === undefined
      ? []
      : [
          {
            id: "s1",
            goal: taskState.goal,
            ...(taskState.decisions?.at(-1) === undefined ? {} : { decision: taskState.decisions.at(-1)! }),
          },
        ];
  const recallExisting = async (query: string, scope: MemoryNoteScope, limit: number): Promise<readonly ConsolidationExistingNote[]> => {
    const merged = new Map<string, ConsolidationExistingNote>();
    for (const note of extraExisting) if (note.scope === scope) merged.set(note.id, note);
    const recalled = input.recallExisting === undefined ? [] : await input.recallExisting(query, scope, limit);
    for (const note of recalled) if (!merged.has(note.id)) merged.set(note.id, note);
    return [...merged.values()].slice(0, limit);
  };
  return extractConsolidationNotes({
    client: input.resolveClient(),
    candidates,
    segments,
    recallExisting,
    limits: input.limits,
    maxNotes: input.config.maxCandidates,
    ...(input.redactor === undefined ? {} : { redactor: input.redactor }),
    ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
    sessionId: input.sessionId,
    ...(input.config.thinkingLevel === undefined ? {} : { thinkingLevel: input.config.thinkingLevel }),
    ...(input.repositoryRules === true ? { repositoryRules: true } : {}),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

/**
 * The shown note a keyed value replaces: same kind and scope, same key, and strictly earlier in time.
 * A key alone is not enough — two instances of one key (two invoices, two trips) both stay.
 */
function supersedingNote(note: ExtractedNote, existing: readonly ConsolidationExistingNote[]): string | undefined {
  if (note.key === undefined || note.tRef === undefined) return undefined;
  const at = Date.parse(note.tRef);
  if (!Number.isFinite(at)) return undefined;
  return existing.find(
    (candidate) =>
      candidate.key === note.key &&
      candidate.kind === note.kind &&
      candidate.scope === note.scope &&
      candidate.tRef !== undefined &&
      Number.isFinite(Date.parse(candidate.tRef)) &&
      Date.parse(candidate.tRef) < at,
  )?.id;
}

function candidateEvidence(candidates: readonly ConsolidationCandidate[], id: string): readonly string[] {
  const index = Number.parseInt(id.slice(1), 10) - 1;
  return candidates[index]?.evidenceIds ?? [];
}

function findReconsolidating(
  note: ExtractedNote,
  reconsolidating: readonly { readonly level: MemoryNoteScope; readonly record: MemoryVectorRecord }[],
): { readonly level: MemoryNoteScope; readonly record: MemoryVectorRecord } | undefined {
  if (note.key === undefined) return undefined;
  return reconsolidating.find(({ record }) => {
    const metadata = parseMemoryNoteMetadata(record.metadata);
    return (
      metadata !== undefined && metadata.key === note.key && metadata.kind === note.kind && (metadata.scope ?? "project") === note.scope
    );
  });
}

function existingSameScope(
  existing: readonly ConsolidationExistingNote[],
  knownById: ReadonlyMap<string, ConsolidationKnownNote>,
  scope: MemoryNoteScope,
): readonly PromotionExistingNote[] {
  return existing.flatMap((note) => {
    if (note.scope !== scope && !(scope === "path" && note.scope === "project")) return [];
    const known = knownById.get(note.id);
    return known === undefined ? [] : [{ id: known.id, kind: known.kind, text: known.text }];
  });
}

function scopeOf(record: MemoryVectorRecord): MemoryNoteScope | undefined {
  return parseMemoryNoteMetadata(record.metadata)?.scope;
}

function knownFromRecord(record: MemoryVectorRecord, level: MemoryNoteScope): ConsolidationKnownNote | undefined {
  const metadata = parseMemoryNoteMetadata(record.metadata);
  if (metadata === undefined) return undefined;
  return {
    id: record.id,
    kind: metadata.kind,
    text: record.text,
    level: metadata.scope ?? level,
    ...(metadata.key === undefined ? {} : { key: metadata.key }),
    ...(metadata.status === undefined ? {} : { status: metadata.status }),
    ...(metadata.flags === undefined ? {} : { flags: metadata.flags }),
    ...(metadata.sourceEntryIds === undefined ? {} : { sourceEntryIds: metadata.sourceEntryIds }),
    ...(metadata.supersedes === undefined ? {} : { supersedes: metadata.supersedes }),
  };
}

function existingFromRecord(record: MemoryVectorRecord, level: MemoryNoteScope): ConsolidationExistingNote | undefined {
  const metadata = parseMemoryNoteMetadata(record.metadata);
  if (metadata === undefined) return undefined;
  return {
    id: record.id,
    text: record.text,
    scope: metadata.scope ?? level,
    kind: metadata.kind,
    ...(metadata.key === undefined ? {} : { key: metadata.key }),
    ...(metadata.tRef === undefined ? {} : { tRef: metadata.tRef }),
  };
}
