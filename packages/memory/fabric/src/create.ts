import { randomUUID } from "node:crypto";
import type { HookRegistrar, JsonObject, Message, ModelClient, ModelRef } from "@arnilo/prism";
import { resolveRedactor } from "@arnilo/prism";
import type { Memory, MemoryConsentInput, MemoryContextProviderOptions, RecallScoringOptions } from "@arnilo/prism-memory-core";
import {
  HARD_TOP_K_CAP,
  lexicalDice,
  lexicalTerms,
  MemoryScopeError,
  MemoryValidationError,
  type MemoryVectorRecord,
  RECALL_OVERSAMPLE,
} from "@arnilo/prism-memory-core";
import { createMemoryId, foldObservationalMemoryLedger, isMemoryId, resolveMemoryWorkerLimits } from "@arnilo/prism-memory-observational";
import { assertFabricBlockLabel, fabricBlockId, setFabricBlock, tombstoneFabricBlock } from "./blocks.js";
import { type MemoryConsolidationPlan, mergeNoteMetadata, planMemoryConsolidation } from "./consolidate.js";
import { ConsolidationExtractionError } from "./consolidation/extract.js";
import {
  type ConsolidationExchangeCandidate,
  type ConsolidationLifecycle,
  consolidationReport,
  createConsolidationLease,
  runConsolidationPass,
} from "./consolidation/pass.js";
import type { ConsolidationExistingNote } from "./consolidation/prompts.js";
import { createFabricCitationTracker } from "./context.js";
import { decideConsolidation } from "./decider.js";
import type { SupersessionChoice } from "./decisions.js";
import {
  createFabricLifecycle,
  isActiveNote,
  type MemoryNoteStatus,
  normalizeNoteStatus,
  type RecordUsesOptions,
} from "./lifecycle/index.js";
import { runMaintenance } from "./lifecycle/maintain.js";
import {
  assertEvidenceInput,
  assertLessonInput,
  EVIDENCE_RELATION,
  EvidenceNotFoundError,
  evidenceLevelsFor,
  isLessonTagged,
} from "./lessons.js";
import { noteImportance, storageStrength, strengthPrior } from "./lifecycle/strength.js";
import { exchangeDialogue } from "./exchanges.js";
import { mergeNoteLinks, resolveNoteLinks } from "./links.js";
import { registerMemoryFabricContext } from "./provider.js";
import { createFabricRecall, type FabricCandidate, noteInWindow, noteTime } from "./recall.js";
import { createScopeRecall, resolveScopePriors } from "./scope/recall.js";
import { scanScopedMemoryContent } from "./scoped/trust.js";
import { createFabricConversationSearch } from "./search.js";
import { resolveStateConfig } from "./state.js";
import { ConceptRequiresOntologyError } from "./ontology/errors.js";
import { DEFAULT_CONCEPT_PRIOR, DEFAULT_MAX_CLAIMS_RENDERED } from "./ontology/render.js";
import { emitMemoryRetract } from "./ontology/retract.js";
import { createMemoryFabricTools } from "./tools.js";
import {
  type CreateMemoryFabricOptions,
  defaultScopeFor,
  encodeMemoryNoteMetadata,
  estimateNoteTokens,
  type FabricScopeLevel,
  isDecisionScope,
  isMemoryDecisionStatus,
  isMemoryNoteKind,
  isMemoryNoteScope,
  isMemoryNoteValidAt,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryDecisionStatus,
  type MemoryFabric,
  type MemoryFabricConsolidateOptions,
  type MemoryFabricConsolidateResult,
  type MemoryFabricConsolidateSource,
  type MemoryFabricForgetInput,
  type MemoryFabricForgetResult,
  type MemoryFabricRememberInput,
  type MemoryFabricWriteOptions,
  type MemoryNote,
  type MemoryNoteActor,
  type MemoryNoteKind,
  type MemoryNoteLink,
  type MemoryNoteMetadata,
  type MemoryNotePromotion,
  type MemoryNoteProvenance,
  type MemoryNoteScope,
  noteFields,
  parseDates,
  parseMemoryNoteMetadata,
  parsePromotionStamp,
  stampProvenance,
  validateAppliesTo,
  validateNoteKey,
} from "./types.js";
import { resolveMemoryFabricSettings, runFabricEvolutionWorker } from "./workers.js";

const isIso = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

/** One time-scoped archive recall scans metadata because core recall ranks by relevance only. */
const ARCHIVE_WINDOW_PAGE = 200;
// shortcut: scan at most 5,000 archived metadata rows per time-window recall; add store-side date
// filtering before an archive outgrows that bound.
const ARCHIVE_WINDOW_SCAN_ROWS = 5_000;

/**
 * Re-resolve the extractor's model with `parameters.maxTokens`, capped by the model's own limit (the
 * same rule compaction's `withOutputBudget` uses). No budget means the host's client, untouched.
 */
function withOutputBudget(resolve: (ref?: ModelRef) => ModelClient, ref: string | undefined, maxTokens: number | undefined): ModelClient {
  const base = resolve(ref);
  if (maxTokens === undefined) return base;
  const declared = base.model.limits?.maxOutputTokens;
  const cap = Number.isSafeInteger(declared) && (declared as number) > 0 ? Math.min(maxTokens, declared as number) : maxTokens;
  return resolve({ ...base.model, parameters: { ...base.model.parameters, maxTokens: cap } });
}

/** Storage identity of a note's scope: notes written before scopes existed are project notes. */
function noteScopeKey(level: MemoryNoteScope | undefined, appliesTo: readonly string[] | undefined): string {
  const resolved = level ?? "project";
  return resolved === "path" ? `path|${[...(appliesTo ?? [])].sort().join(",")}` : resolved;
}

/**
 * Who wrote a durable note. Promotion wins (it derives from a reflection), then an explicit
 * `generatedBy`, then an agent when the caller named a session, else the host.
 */
function resolveActor(writeOptions: MemoryFabricWriteOptions, promotedFrom?: MemoryNotePromotion): MemoryNoteActor {
  if (promotedFrom !== undefined) return "promotion";
  return writeOptions.generatedBy ?? (writeOptions.sessionId === undefined ? "host" : "agent");
}

/** The one provenance stamp the fabric write paths share. */
function provenanceFor(
  writeOptions: MemoryFabricWriteOptions,
  promotedFrom?: MemoryNotePromotion,
  sourceEntryIds?: readonly string[],
  at = new Date().toISOString(),
): MemoryNoteProvenance {
  return stampProvenance(resolveActor(writeOptions, promotedFrom), at, {
    ...(writeOptions.sessionId === undefined ? {} : { session: writeOptions.sessionId }),
    ...(promotedFrom === undefined ? {} : { reflectionId: promotedFrom.reflectionId }),
    ...(sourceEntryIds === undefined ? {} : { sourceEntryIds }),
  });
}

function assertRememberInput(input: MemoryFabricRememberInput, maxTextChars: number): void {
  if (input.session !== undefined && (typeof input.session !== "string" || !input.session.trim()))
    throw new MemoryValidationError("session must be a non-empty string");
  if (input.id !== undefined && !isMemoryId(input.id)) throw new MemoryValidationError("note id must be 12 lowercase hex characters");
  if (input.contentHash !== undefined && (typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(input.contentHash)))
    throw new MemoryValidationError("contentHash must be a SHA-256 hex digest");
  for (const key of ["tRef", "validFrom", "validTo"] as const) {
    const value = input[key];
    if (value !== undefined && !isIso(value)) throw new MemoryValidationError(`${key} must be an ISO timestamp`);
  }
  if (input.dates !== undefined) {
    const dates = parseDates(input.dates);
    if (dates === undefined || dates.length !== input.dates.length)
      throw new MemoryValidationError("dates must carry text, an ISO resolved time, and a known precision");
  }
  for (const key of ["keywords", "tags", "sourceEntryIds"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new MemoryValidationError(`${key} must be an array of non-empty strings`);
    }
  }
  if (input.context !== undefined && (typeof input.context !== "string" || input.context.length === 0)) {
    throw new MemoryValidationError("context must be a non-empty string");
  }
  if (input.supersedes !== undefined && !isMemoryId(input.supersedes)) {
    throw new MemoryValidationError("supersedes must be a 12-hex note id");
  }
  assertEvidenceInput(input.evidence, isMemoryId);
  assertLessonInput(input);
  if (input.overrides !== undefined && !isMemoryId(input.overrides)) {
    throw new MemoryValidationError("overrides must be a 12-hex note id");
  }
  if (input.promotion !== undefined && parsePromotionStamp(input.promotion) === undefined) {
    throw new MemoryValidationError("promotion must carry a finite score, finite signals, and a non-empty pass");
  }
  if (input.rationale !== undefined && (typeof input.rationale !== "string" || input.rationale.trim().length === 0)) {
    throw new MemoryValidationError("rationale must be a non-empty string");
  }
  if (input.decisionStatus !== undefined && !isMemoryDecisionStatus(input.decisionStatus)) {
    throw new MemoryValidationError("decisionStatus must be proposed, active or superseded");
  }
  if (input.kind !== "decision" && (input.rationale !== undefined || input.decisionStatus !== undefined)) {
    throw new MemoryValidationError("rationale and decisionStatus are only valid for kind decision");
  }
  if (input.kind === "decision" && !isDecisionScope(input.scope)) {
    throw new MemoryValidationError("decision scope must be user, project or path");
  }
  if (input.reflectionId !== undefined && !isMemoryId(input.reflectionId)) {
    throw new MemoryValidationError("reflectionId must be a 12-hex observational memory id");
  }
  if (
    input.importance !== undefined &&
    (typeof input.importance !== "number" || !Number.isFinite(input.importance) || input.importance < 0 || input.importance > 1)
  ) {
    throw new MemoryValidationError("importance must be a number in [0,1]");
  }
  if (input.links !== undefined) {
    if (!Array.isArray(input.links)) throw new MemoryValidationError("links must be an array");
    for (const link of input.links) {
      if (link === null || typeof link !== "object" || !isMemoryId((link as MemoryNoteLink).id)) {
        throw new MemoryValidationError("each link needs a 12-hex note id");
      }
      const { relation, weight } = link as MemoryNoteLink;
      if (relation !== undefined && typeof relation !== "string") throw new MemoryValidationError("link relation must be a string");
      if (weight !== undefined && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1)) {
        throw new MemoryValidationError("link weight must be a number in [0,1]");
      }
    }
  }
  if (input.scope !== undefined && !isMemoryNoteScope(input.scope)) {
    throw new MemoryValidationError(`scope must be one of ${["user", "agent", "project", "path"].join("|")}`);
  }
  if (input.key !== undefined) validateNoteKey(input.key);
  if (input.subject !== undefined) validateNoteKey(input.subject);
  if (input.appliesTo !== undefined) validateAppliesTo(input.appliesTo);
  if ((input.scope === "path") !== (input.appliesTo !== undefined)) {
    throw new MemoryValidationError('appliesTo is required exactly when scope is "path"');
  }
  if (input.content !== undefined) {
    if (typeof input.content !== "string" || input.content.trim().length === 0) {
      throw new MemoryValidationError("content must be a non-empty string");
    }
    if (input.content.length > maxTextChars) throw new MemoryValidationError(`content exceeds ${maxTextChars} characters`);
  }
}

/** Metadata fields carried by the input (content/block/path are stored, not duplicated). */
function toNoteMetadata(
  input: MemoryFabricRememberInput,
  kind: MemoryNoteKind,
  path?: string,
  promotedFrom?: MemoryNotePromotion,
): MemoryNoteMetadata {
  return {
    v: 1,
    kind,
    ...(promotedFrom === undefined ? {} : { promotedFrom }),
    ...(input.session === undefined ? {} : { session: input.session }),
    ...(input.tRef === undefined ? {} : { tRef: input.tRef }),
    ...(input.dates === undefined ? {} : { dates: input.dates }),
    ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
    ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
    ...(input.keywords === undefined ? {} : { keywords: input.keywords }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.links === undefined ? {} : { links: input.links }),
    ...(input.sourceEntryIds === undefined ? {} : { sourceEntryIds: input.sourceEntryIds }),
    ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
    ...(input.decisionStatus === undefined ? {} : { decisionStatus: input.decisionStatus }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.appliesTo === undefined ? {} : { appliesTo: input.appliesTo }),
    ...(input.key === undefined ? {} : { key: input.key }),
    ...(input.subject === undefined ? {} : { subject: input.subject }),
    ...(input.overrides === undefined ? {} : { overrides: input.overrides }),
    ...(input.promotion === undefined ? {} : { promotion: input.promotion }),
    ...(path === undefined ? {} : { path }),
    ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
  };
}

/**
 * Opt-in notes over the host's existing stores: `fact`/`procedure`/`file` are tagged vector
 * records, `working` is a labeled block in the working-memory value, and `episode` is a view
 * over an observational-memory id (nothing is written for it).
 *
 * Creating a fabric starts nothing: no workers, no timers, no tools.
 */
export function createMemoryFabric(options: CreateMemoryFabricOptions): MemoryFabric {
  if (options === null || typeof options !== "object") throw new MemoryValidationError("createMemoryFabric requires options");
  const { memory, observational } = options;
  if (memory === null || typeof memory !== "object" || typeof memory.recall !== "function" || typeof memory.remember !== "function") {
    throw new MemoryValidationError("createMemoryFabric requires a memory instance");
  }
  if (observational !== undefined && typeof observational.session?.entries !== "function") {
    throw new MemoryValidationError("observational must expose session.entries()");
  }
  const limits = memory.limits;
  const settings = resolveMemoryFabricSettings(options);
  const state = resolveStateConfig(options.state);
  if (state !== false && options.resolveModelClient === undefined) {
    throw new MemoryValidationError("state requires resolveModelClient for its one model call");
  }
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const decider = typeof options.consolidate === "object" && options.consolidate.decider === "model" ? options.consolidate : undefined;
  const promotion = options.promote?.enabled === true ? options.promote : undefined;
  const consolidationLimits = promotion === undefined ? undefined : resolveMemoryWorkerLimits(options.workerLimits);
  const consolidationLease = createConsolidationLease();
  const consolidationLifecycles = new Map<Memory, ConsolidationLifecycle>();
  const lifecycleFor = (target: Memory): ConsolidationLifecycle => {
    let lifecycle = consolidationLifecycles.get(target);
    if (lifecycle === undefined) {
      lifecycle = createFabricLifecycle(target);
      consolidationLifecycles.set(target, lifecycle);
    }
    return lifecycle;
  };
  const warnedSessions = new Set<string>();

  // Active scope memories, narrowest first, as the package resolved them. A direct caller that passes
  // no bindings keeps one memory: every scope writes there and no scope is "disabled".
  const orderedMemories = options.scopes === undefined ? [memory] : options.scopes.map((binding) => binding.memory);
  const scopeMemories = new Map<FabricScopeLevel, Memory>((options.scopes ?? []).map((binding) => [binding.level, binding.memory]));
  const scoped = scopeMemories.size > 0;

  function memoryForScope(level: Exclude<MemoryNoteScope, "path">): Memory {
    const bound = scopeMemories.get(level);
    if (bound !== undefined) return bound;
    if (!scoped) return memory;
    throw new MemoryValidationError(`scope ${level} is not active`);
  }

  /** The storage level and memory a write targets; `path` notes live in the project resource. */
  function writeTarget(kind: MemoryNoteKind, input: MemoryFabricRememberInput): { level: MemoryNoteScope; memory: Memory } {
    const level = input.scope ?? defaultScopeFor(kind);
    return { level, memory: memoryForScope(level === "path" ? "project" : level) };
  }

  /** The first active scope holding `id`, narrowest first; at most one `getEntry` per scope. */
  async function memoryWithNote(id: string, signal?: AbortSignal): Promise<Memory | undefined> {
    for (const candidate of orderedMemories) {
      if ((await candidate.getEntry(id, signal === undefined ? {} : { signal })) !== undefined) return candidate;
    }
    return undefined;
  }

  /**
   * `evidence` ids as links (plan 209 Task 4). Each id must name a note in an active scope that stays
   * readable wherever a note at `level` is read: a user or agent note may not cite one project's note.
   */
  async function resolveEvidence(
    level: MemoryNoteScope,
    target: Memory,
    ids: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<readonly MemoryNoteLink[]> {
    const allowed = evidenceLevelsFor(level);
    const candidates: readonly Memory[] =
      options.scopes === undefined
        ? [memory]
        : options.scopes
            .filter((binding) =>
              binding.level === "project" ? allowed.has("project") || allowed.has("path") : allowed.has(binding.level as MemoryNoteScope),
            )
            .map((binding) => binding.memory);
    const links: MemoryNoteLink[] = [];
    for (const id of new Set(ids)) {
      let found = false;
      for (const candidate of candidates.includes(target) ? candidates : [target, ...candidates]) {
        const row = await candidate.getEntry(id, signal === undefined ? {} : { signal });
        if (row === undefined || parseMemoryNoteMetadata(row.metadata) === undefined) continue;
        found = true;
        break;
      }
      if (!found) throw new EvidenceNotFoundError(id);
      links.push({ id, relation: EVIDENCE_RELATION });
    }
    return links;
  }

  async function rememberEpisode(input: MemoryFabricRememberInput): Promise<MemoryNote> {
    if (observational === undefined) {
      throw new MemoryValidationError('kind "episode" requires createMemoryFabric({ observational }) with an attached session');
    }
    if (input.id === undefined) throw new MemoryValidationError('kind "episode" requires the observational memory id');
    if (input.content !== undefined) {
      throw new MemoryValidationError('kind "episode" derives content from observational memory; content is not accepted');
    }
    const entries = await observational.session.entries();
    const observation = foldObservationalMemoryLedger(entries).observations.find((item) => item.id === input.id);
    if (observation === undefined) throw new MemoryValidationError(`unknown observational memory id: ${input.id}`);
    return {
      ...noteFields(toNoteMetadata(input, "episode")),
      id: observation.id,
      kind: "episode",
      content: observation.content,
      ingestedAt: observation.timestamp,
      tokenCount: observation.tokenCount,
      sourceEntryIds: observation.sourceEntryIds,
      ...(input.importance === undefined ? {} : { importance: input.importance }),
      scope: memory.scope,
    };
  }

  /**
   * `fact`/`procedure` promoted from an observational-memory reflection.
   *
   * 0.12 required the reflection to be bound to a closed work scope; work scopes were deleted with the
   * observational-memory attach surface (plan 157 Task 1 (h)), so the gate is now the reflection's
   * presence in the ledger. A future scope source restores the narrower gate.
   */
  async function rememberReflection(
    kind: "fact" | "procedure",
    reflectionId: string,
    input: MemoryFabricRememberInput,
    writeOptions: MemoryFabricWriteOptions,
  ): Promise<MemoryNote> {
    if (observational === undefined) {
      throw new MemoryValidationError(
        `kind "${kind}" with reflectionId requires createMemoryFabric({ observational }) with an attached session`,
      );
    }
    const entries = await observational.session.entries();
    const ledger = foldObservationalMemoryLedger(entries);
    const reflection = ledger.reflections.find((item) => item.id === reflectionId);
    if (reflection === undefined) throw new MemoryValidationError(`unknown observational memory reflection: ${reflectionId}`);
    // The evidence a reflection still points at: observations a later pass consumed no longer resolve.
    const support = new Set(reflection.supportingObservationIds);
    const evidence = [
      ...new Set([
        ...(input.sourceEntryIds ?? []),
        ...ledger.observations.filter((item) => support.has(item.id)).flatMap((item) => item.sourceEntryIds),
      ]),
    ];
    return rememberIndexed(
      kind,
      evidence.length === 0 ? input : { ...input, sourceEntryIds: evidence },
      reflection.content,
      undefined,
      writeOptions,
      { reflectionId },
    );
  }

  interface IndexedRowWrite {
    readonly id: string;
    readonly content: string;
    readonly createdAt: string;
    readonly metadata: JsonObject;
    readonly consent?: MemoryConsentInput;
    readonly importance?: number;
    readonly signal?: AbortSignal;
  }

  /** One awaited vector upsert: a rewrite keeps the row id, so consolidation never duplicates ids. */
  async function writeIndexedRow(write: IndexedRowWrite, target: Memory = memory): Promise<void> {
    await target.remember(
      {
        entries: [
          {
            id: write.id,
            text: write.content,
            createdAt: write.createdAt,
            metadata: write.metadata,
            ...(write.consent === undefined ? {} : { consent: write.consent }),
            ...(write.importance === undefined ? {} : { importance: write.importance }),
          },
        ],
      },
      { wait: true, ...(write.signal === undefined ? {} : { signal: write.signal }) },
    );
  }

  async function rememberWorking(
    input: MemoryFabricRememberInput,
    content: string,
    writeOptions: MemoryFabricWriteOptions,
  ): Promise<MemoryNote> {
    if (input.id !== undefined) throw new MemoryValidationError('kind "working" derives its id from "block"; omit id');
    assertFabricBlockLabel(input.block);
    const block = input.block;
    const id = fabricBlockId(block);
    const generated = provenanceFor(writeOptions);
    const record = await setFabricBlock(memory, block, content, { ...writeOptions, generated });
    return {
      ...noteFields(toNoteMetadata(input, "working")),
      id,
      kind: "working",
      content,
      ingestedAt: record.updatedAt,
      tokenCount: estimateNoteTokens(content),
      block,
      ...(input.importance === undefined ? {} : { importance: input.importance }),
      scope: memory.scope,
      generated,
    };
  }

  async function rememberIndexed(
    kind: MemoryNoteKind,
    input: MemoryFabricRememberInput,
    content: string,
    path: string | undefined,
    writeOptions: MemoryFabricWriteOptions,
    promotedFrom?: MemoryNotePromotion,
  ): Promise<MemoryNote> {
    const signal = writeOptions.signal;
    const { level, memory: target } = writeTarget(kind, input);
    const incomingScope = noteScopeKey(level, input.appliesTo);
    // Evidence is checked before any write: an unreadable or foreign id rejects the whole note.
    const evidenceLinks = input.evidence === undefined ? undefined : await resolveEvidence(level, target, input.evidence, signal);
    const ingestedAt = new Date().toISOString();
    const generated = provenanceFor(writeOptions, promotedFrom, input.sourceEntryIds, ingestedAt);
    // Consolidation is part of the write path; linker/evolution are the opt-in workers. The per-session
    // tool gate decides who may write at all, so a write that reaches here may run its configured workers.
    const passive = settings.passive;
    const linkerActive = settings.linker.enabled && !passive;
    const evolutionActive = settings.evolution.enabled && !passive;
    const consolidate = settings.consolidate && input.id === undefined && input.supersedes === undefined;
    const neighborCount = Math.max(linkerActive ? settings.linker.topK : 0, evolutionActive ? settings.evolution.maxPatches : 0);
    const rawCandidates =
      consolidate || neighborCount > 0
        ? await recallCandidates(
            content,
            new Set([kind]),
            Date.now(),
            Math.max(decider ? 5 : 1, neighborCount),
            signal,
            undefined,
            undefined,
            target,
          )
        : [];
    // The write path scores candidates on the active mode's [0,1] similarity: term-set Dice in
    // lexical mode, pre-fusion cosine in hybrid mode (never the RRF rank). Only notes in the same
    // scope may fold together: a project note never absorbs a user preference or a path note.
    const newTerms = settings.retrieval === "lexical" ? lexicalTerms(content) : undefined;
    const candidates: FabricCandidate[] = rawCandidates
      .map((item) => ({
        ...item,
        hit: {
          ...item.hit,
          score: newTerms === undefined ? (item.hit.similarity ?? item.hit.score) : lexicalDice(newTerms, lexicalTerms(item.hit.text)),
        },
      }))
      .filter((item) => noteScopeKey(item.metadata.scope, item.metadata.appliesTo) === incomingScope);
    // A file note only ever folds into the same path: embedding similarity never merges documents.
    let candidate = candidates.find((item) => item.hit.id !== input.id && (kind !== "file" || item.metadata.path === path));
    let plan: MemoryConsolidationPlan | { action: "supersede"; id: string } = consolidate
      ? planMemoryConsolidation({
          kind,
          text: content,
          ...(path === undefined ? {} : { path }),
          threshold: settings.threshold,
          ...(candidate === undefined
            ? {}
            : {
                candidate: {
                  id: candidate.hit.id,
                  text: candidate.hit.text,
                  score: candidate.hit.score,
                  metadata: candidate.metadata,
                },
              }),
        })
      : ({ action: "insert" } as const);

    if (consolidate && decider && candidate && candidate.hit.score >= settings.threshold) {
      const eligible = candidates
        .filter((item) => item.hit.score >= settings.threshold && (kind !== "file" || item.metadata.path === path))
        .slice(0, 5);
      try {
        const classified = options.decisions?.enabled("P2")
          ? await options.decisions.supersession(
              content,
              eligible.map((item) => ({ id: item.hit.id, text: item.hit.text, score: item.hit.score })),
            )
          : undefined;
        if (classified !== undefined) {
          const priority: readonly SupersessionChoice[] = ["replaces", "contradicts", "refines"];
          const id = [...classified.entries()]
            .sort(([leftId, left], [rightId, right]) => priority.indexOf(left) - priority.indexOf(right) || (leftId < rightId ? -1 : 1))
            .find(([, choice]) => priority.includes(choice))?.[0];
          if (id !== undefined) {
            candidate = eligible.find((item) => item.hit.id === id)!;
            const choice = classified.get(id)!;
            plan = { action: choice === "refines" ? "update" : "supersede", id };
          } else plan = { action: "insert", similar: candidate.hit.id };
        } else {
          if (!options.resolveModelClient) throw new Error("Model decider requires a model client");
          const decision = await decideConsolidation({
            client: options.resolveModelClient(decider.model),
            text: content,
            candidates: eligible.map((item) => ({ id: item.hit.id, text: item.hit.text, score: item.hit.score, metadata: item.metadata })),
            limits: settings.workerLimits,
            redactor,
            sessionId: writeOptions.sessionId,
            signal,
          });
          if (decision.action === "NOOP") {
            return {
              ...noteFields(candidate.metadata),
              id: candidate.hit.id,
              kind,
              content: candidate.hit.text,
              ingestedAt: candidate.hit.createdAt,
              tokenCount: estimateNoteTokens(candidate.hit.text),
              scope: target.scope,
            };
          }
          if (decision.action === "UPDATE" || decision.action === "SUPERSEDE") {
            candidate = eligible.find((item) => item.hit.id === decision.id)!;
            plan = { action: decision.action === "UPDATE" ? "update" : "supersede", id: candidate.hit.id };
          } else plan = { action: "insert", similar: candidate.hit.id };
        }
      } catch {
        if (signal?.aborted) throw signal.reason ?? new Error("Memory write aborted");
        plan = { action: "insert", similar: candidate.hit.id };
        const key = writeOptions.sessionId ?? "default";
        if (!warnedSessions.has(key)) {
          warnedSessions.add(key);
          options.onDeciderFailure?.(writeOptions.sessionId);
        }
      }
    }
    if (input.supersedes !== undefined) {
      const row = await target.getEntry(input.supersedes, { signal });
      const metadata = row && parseMemoryNoteMetadata(row.metadata);
      if (!row || !metadata || row.id === input.id) {
        // The id is an address across active scopes: name the other scope instead of "not found".
        for (const other of orderedMemories) {
          if (other === target) continue;
          if ((await other.getEntry(input.supersedes, { signal })) !== undefined) {
            throw new MemoryScopeError("supersedes cannot cross scopes; write the note in the scope it belongs to");
          }
        }
        throw new MemoryValidationError("supersedes must reference an accessible, distinct fabric note");
      }
      candidate = { hit: { ...row, score: 1 }, metadata };
      plan = { action: "supersede", id: row.id };
    }

    // The random nonce keeps two identical notes written in the same millisecond distinct.
    let id = input.id ?? createMemoryId("fabric", kind, content, ingestedAt, randomUUID());
    let supersedes = input.supersedes;
    let createdAt = ingestedAt;
    let consent: MemoryConsentInput | undefined = input.consent;
    let importance = input.importance;
    let hostMetadata: JsonObject = {};
    // A lesson has to earn its place: it starts as a candidate and verifies by use like any candidate.
    let status: MemoryNoteStatus | undefined = writeOptions.status ?? (isLessonTagged(input.tags) ? "candidate" : undefined);
    const decisionStatus: MemoryDecisionStatus | undefined =
      kind === "decision"
        ? (input.decisionStatus ??
          (plan.action === "update" && candidate !== undefined ? candidate.metadata.decisionStatus : undefined) ??
          "proposed")
        : undefined;

    if (plan.action === "supersede" && candidate !== undefined) {
      // Supersede the old row first: a crash between the two writes leaves the old note invalid
      // rather than leaving two current notes.
      await writeIndexedRow(
        {
          id: candidate.hit.id,
          content: candidate.hit.text,
          createdAt: candidate.hit.createdAt,
          metadata: {
            ...(candidate.hit.metadata ?? {}),
            status: "retired",
            auditVerb: promotedFrom !== undefined ? "superseded-by-om" : "superseded",
            [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({
              ...candidate.metadata,
              validTo: ingestedAt,
              ...(candidate.metadata.kind === "decision" ? { decisionStatus: "superseded" as const } : {}),
            }),
          },
          ...(candidate.hit.consent === undefined ? {} : { consent: candidate.hit.consent }),
          ...(candidate.hit.importance === undefined ? {} : { importance: candidate.hit.importance }),
          ...(signal === undefined ? {} : { signal }),
        },
        target,
      );
      supersedes = candidate.hit.id;
      await emitMemoryRetract(target, { ids: [candidate.hit.id], reason: "superseded" });
    } else if (plan.action === "update" && candidate !== undefined) {
      id = candidate.hit.id;
      createdAt = candidate.hit.createdAt;
      hostMetadata = candidate.hit.metadata ?? {};
      consent = input.consent ?? candidate.hit.consent;
      importance = input.importance ?? candidate.hit.importance;
      // A promotion never demotes a note; an agent writing a candidate again is what confirms it.
      const existing = normalizeNoteStatus(candidate.hit.metadata?.status as string | undefined, "verified");
      status =
        kind === "decision" && decisionStatus !== "active"
          ? "candidate"
          : existing === "verified"
            ? candidate.hit.metadata?.status === undefined
              ? undefined
              : "verified"
            : writeOptions.status === "candidate"
              ? "candidate"
              : "verified";
    }

    const derivedLinks = linkerActive
      ? mergeNoteLinks(
          input.links,
          evidenceLinks,
          resolveNoteLinks(
            candidates.map((item) => ({ id: item.hit.id, score: item.hit.score })),
            { topK: settings.linker.topK, exclude: [id, ...(supersedes === undefined ? [] : [supersedes])] },
          ),
        )
      : mergeNoteLinks(input.links, evidenceLinks);
    const links = mergeNoteLinks(
      derivedLinks,
      plan.action === "insert" && plan.similar ? [{ id: plan.similar, relation: "similar" }] : undefined,
    );
    // Schema-assisted encoding (plan 207 Task 3): a note names its subject when it is written. An explicit subject
    // wins, a rewrite keeps the subject it already had, and otherwise the scope's concept index decides, with no
    // model call. Zero or several matches leave the note unbound for the concept pass.
    const subject =
      input.subject ??
      (plan.action === "update" ? candidate?.metadata.subject : undefined) ??
      (options.subjects === undefined ? undefined : await options.subjects.bindingFor(level, content, input.keywords ?? [], signal));
    const created = options.clock?.() ?? 0;
    const incoming: MemoryNoteMetadata = {
      ...toNoteMetadata(
        {
          ...input,
          ...(supersedes === undefined ? {} : { supersedes }),
          ...(decisionStatus === undefined ? {} : { decisionStatus }),
          ...(subject === undefined ? {} : { subject }),
        },
        kind,
        path,
        promotedFrom,
      ),
      scope: level,
      ...(created > 0 ? { created } : {}),
      ...(input.appliesTo === undefined ? {} : { appliesTo: input.appliesTo }),
      ...(links === undefined ? {} : { links }),
    };
    const metadata = plan.action === "update" && candidate !== undefined ? mergeNoteMetadata(candidate.metadata, incoming) : incoming;
    if (kind === "decision" && decisionStatus !== "active" && status === undefined) status = "candidate";
    // D14: importance is evidence, not a constant. A host value still wins; otherwise S at [0,1).
    importance ??= noteImportance(storageStrength(metadata, options.lifecycle?.storageWeights));

    const { status: _previous, ...hostRest } = hostMetadata;
    await writeIndexedRow(
      {
        id,
        content,
        createdAt,
        metadata: {
          ...hostRest,
          [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata(metadata),
          ...(status === undefined ? {} : { status }),
          generated,
        },
        ...(consent === undefined ? {} : { consent }),
        ...(importance === undefined ? {} : { importance }),
        ...(signal === undefined ? {} : { signal }),
      },
      target,
    );

    if (subject !== undefined) await options.subjects?.noteBound(level, subject, signal);

    if (evolutionActive) {
      const neighbors = candidates
        .filter((item) => item.hit.id !== id && item.hit.id !== supersedes)
        .slice(0, settings.evolution.maxPatches);
      if (neighbors.length > 0) {
        await runFabricEvolutionWorker({
          memory,
          neighbors,
          ...(input.keywords === undefined ? {} : { keywords: input.keywords }),
          ...(input.context === undefined ? {} : { context: input.context }),
          limitBytes: settings.workerLimits.maxResultBytes,
          ...(signal === undefined ? {} : { signal }),
        });
      }
    }

    return {
      ...noteFields({ ...metadata, ...(status === undefined ? {} : { status }), generated }),
      id,
      kind,
      content,
      ingestedAt: createdAt,
      tokenCount: estimateNoteTokens(content),
      ...(importance === undefined ? {} : { importance }),
      scope: target.scope,
    };
  }

  async function remember(input: MemoryFabricRememberInput, writeOptions: MemoryFabricWriteOptions = {}): Promise<MemoryNote> {
    if (input === null || typeof input !== "object") throw new MemoryValidationError("note input must be an object");
    const kind = input.kind;
    if (!isMemoryNoteKind(kind)) throw new MemoryValidationError(`Unknown memory note kind: ${String(kind)}`);
    // A concept is the ontology tier's note: only the ontology port, a human edit, import and share write one.
    if (kind === "concept") throw new ConceptRequiresOntologyError();
    assertRememberInput(input, limits.maxEntryTextChars);
    if (kind === "decision") {
      const scan = scanScopedMemoryContent(`${input.content ?? ""}\n${input.rationale ?? ""}`);
      if (!scan.ok) throw new MemoryValidationError(`decision refused by the trust scan: ${scan.class}`);
    }
    if (kind !== "working" && input.block !== undefined) throw new MemoryValidationError('"block" is only valid for kind "working"');
    if (kind !== "file" && input.path !== undefined) throw new MemoryValidationError('"path" is only valid for kind "file"');
    if (kind === "working" && (input.scope !== undefined || input.appliesTo !== undefined || input.key !== undefined)) {
      throw new MemoryValidationError("working blocks are not scoped; use a durable kind");
    }
    if (input.reflectionId !== undefined) {
      if (kind !== "fact" && kind !== "procedure") {
        throw new MemoryValidationError('"reflectionId" is only valid for kind "fact" or "procedure"');
      }
      if (input.content !== undefined) {
        throw new MemoryValidationError('"reflectionId" derives content from observational memory; content is not accepted');
      }
      return rememberReflection(kind, input.reflectionId, input, writeOptions);
    }
    if (kind === "episode") return rememberEpisode(input);
    let path: string | undefined;
    if (kind === "file") {
      path = input.path;
      if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
        throw new MemoryValidationError('kind "file" requires a non-empty path without NUL');
      }
      if (path.length > limits.maxEntryTextChars) throw new MemoryValidationError(`path exceeds ${limits.maxEntryTextChars} characters`);
    }
    const content = input.content ?? path;
    if (content === undefined) throw new MemoryValidationError(`content is required for kind "${kind}"`);
    if (kind === "working") return rememberWorking(input, content, writeOptions);
    return rememberIndexed(kind, input, content, path, writeOptions);
  }

  /**
   * Archived exchanges the pass has not consolidated, read through the same scoped recall the tools
   * use, with the session tail as the query. Bounded and scope-tagged; text is bounded by the pass.
   */
  async function gatherExchanges(
    entries: readonly import("@arnilo/prism").SessionEntry[],
    limit: number,
    levels: Map<string, FabricScopeLevel>,
    signal?: AbortSignal,
  ): Promise<readonly ConsolidationExchangeCandidate[]> {
    const query = [...entries]
      .reverse()
      .flatMap((entry) => (entry.kind === "message" && entry.message?.role === "user" ? messageTextOf(entry.message) : []))
      .join("\n")
      .slice(0, 2_000);
    if (query.trim().length === 0 || limit < 1) return [];
    const found = new Map<string, ConsolidationExchangeCandidate>();
    for (const binding of options.scopes ?? [{ level: "project" as const, memory }]) {
      const rows = await recallCandidates(query, EXCHANGE_KINDS, Date.now(), limit, signal, undefined, undefined, binding.memory);
      for (const { hit, metadata } of rows) {
        if (metadata.consolidatedAt !== undefined || found.has(hit.id)) continue;
        const level: FabricScopeLevel = metadata.scope === undefined || metadata.scope === "path" ? binding.level : metadata.scope;
        levels.set(hit.id, level);
        found.set(hit.id, {
          id: hit.id,
          text: exchangeDialogue(hit.text),
          level,
          ...(metadata.tRef === undefined ? {} : { tRef: metadata.tRef }),
        });
      }
    }
    return [...found.values()].slice(0, limit);
  }

  /** Mark the exchanges a pass read, so the next pass gathers only new history. */
  async function markExchangesConsolidated(
    ids: readonly string[],
    at: string,
    levels: ReadonlyMap<string, FabricScopeLevel>,
  ): Promise<void> {
    for (const id of ids) {
      const level = levels.get(id);
      if (level === undefined) continue;
      await memoryForScope(level).patchMetadata(id, (current) => {
        const metadata = parseMemoryNoteMetadata(current);
        return metadata === undefined
          ? current
          : { ...current, [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({ ...metadata, consolidatedAt: at }) };
      });
    }
  }

  /**
   * One consolidation pass over the session tail. The extractor client resolves only when candidates
   * exist, so a turn or command with nothing to consolidate makes no model call.
   */
  async function consolidate(
    session: MemoryFabricConsolidateSource,
    consolidateOptions: MemoryFabricConsolidateOptions = {},
  ): Promise<MemoryFabricConsolidateResult> {
    if (promotion === undefined) return { ran: false, reason: "disabled" };
    if (!consolidationLease.enter(session.id)) return { ran: false, reason: "busy" };
    try {
      const entries = await session.entries();
      if (consolidateOptions.signal?.aborted) throw consolidateOptions.signal.reason;
      const exchangeLevels = new Map<string, FabricScopeLevel>();
      const exchanges =
        options.exchanges?.enabled === true
          ? await gatherExchanges(entries, promotion.maxCandidates, exchangeLevels, consolidateOptions.signal)
          : [];
      // The scope's subjects, pinned for this session's epoch: the extractor may bind a note to one it was shown.
      const subjects = options.subjects === undefined ? [] : await options.subjects.snapshot(session.id, consolidateOptions.signal);
      const result = await runConsolidationPass({
        sessionId: session.id,
        entries,
        ...(consolidateOptions.cursor === undefined ? {} : { cursor: consolidateOptions.cursor }),
        remember,
        memory,
        ...(options.scopes === undefined ? {} : { scopes: options.scopes }),
        lifecycleFor,
        config: promotion,
        resolveClient: () => {
          if (options.resolveModelClient === undefined) {
            throw new MemoryValidationError("consolidation needs resolveModelClient to reach a model");
          }
          return withOutputBudget(options.resolveModelClient, promotion.model, promotion.maxOutputTokens);
        },
        limits: consolidationLimits!,
        ...(redactor === undefined ? {} : { redactor }),
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
        root: options.promoteRoot ?? process.cwd(),
        ...(options.repositoryRules === true ? { repositoryRules: true } : {}),
        ...(subjects.length === 0 ? {} : { subjects }),
        ...(exchanges.length === 0 ? {} : { exchanges }),
        ...(exchanges.length === 0
          ? {}
          : { markExchangesConsolidated: (ids: readonly string[], at: string) => markExchangesConsolidated(ids, at, exchangeLevels) }),
        ...(consolidateOptions.signal === undefined ? {} : { signal: consolidateOptions.signal }),
        recallExisting: async (query, scope, limit) => {
          // A disabled scope has no existing notes to reconcile against; consolidation must still run
          // in a configuration that turns `user` or `agent` off (plan 188.9 Task 9 found this).
          if (scoped && !scopeMemories.has(scope === "path" ? "project" : scope)) return [];
          const source = memoryForScope(scope === "path" ? "project" : scope);
          const recalled = await source.recall(query, { topK: limit });
          const notes: ConsolidationExistingNote[] = [];
          for (const hit of recalled.hits) {
            const metadata = parseMemoryNoteMetadata(hit.metadata);
            if (metadata === undefined) continue;
            if (metadata.scope !== undefined && metadata.scope !== scope) continue;
            if (!isActiveNote(metadata, { allowCandidate: true })) continue;
            notes.push({
              id: hit.id,
              text: hit.text,
              scope: metadata.scope ?? scope,
              kind: metadata.kind,
              ...(metadata.key === undefined ? {} : { key: metadata.key }),
              ...(metadata.tRef === undefined ? {} : { tRef: metadata.tRef }),
            });
          }
          return notes;
        },
      });
      const report = result.report;
      // The pass wrote to this session's project scope, so maintain it now: archive and capacity only.
      // Widening compares projects and belongs to the scheduled pass; a maintenance failure never
      // fails a consolidation that already wrote its notes.
      if (options.vectorStore?.scanMetadata !== undefined) {
        const project = options.scopes?.find((binding) => binding.level === "project")?.memory;
        if (project !== undefined) {
          try {
            await maintain({
              scope: project.scope.resourceId,
              ...(consolidateOptions.signal === undefined ? {} : { signal: consolidateOptions.signal }),
            });
          } catch {
            // Reported by the next scheduled pass; the notes the consolidation wrote are already durable.
          }
        }
      }
      return {
        ran: report.modelCalls > 0 || report.retired > 0,
        ...(report.modelCalls === 0 && report.retired === 0 ? { reason: "empty" as const } : {}),
        ...(result.cursor === undefined ? {} : { cursor: result.cursor }),
        report,
      };
    } catch (error) {
      // A failed extraction writes nothing and keeps the cursor, so the material is retried next
      // pass. The reason is counted in a report instead of thrown away: `memory:status` reads it.
      if (!(error instanceof ConsolidationExtractionError)) throw error;
      return {
        ran: false,
        reason: "failed",
        reasonCode: error.reasonCode,
        report: consolidationReport(new Date().toISOString(), {
          modelCalls: error.modelCalls,
          ...(error.correctionCalls === 0 ? {} : { correctionCalls: error.correctionCalls }),
          failures: { [error.reasonCode]: 1 },
          ...(error.reasonCode === "output_truncated" ? { outputLimited: 1 } : {}),
        }),
      };
    } finally {
      consolidationLease.exit(session.id);
    }
  }

  /**
   * Time-scoped archive search reads every archived metadata row in the bound instead of the
   * relevance top-K, so an event date outside that top-K is still found. The main store is the one
   * `options.vectorStore` backs; a read-only team store falls back to the relevance path.
   */
  async function scanArchivedWindow(
    source: Memory,
    kinds: ReadonlySet<MemoryNoteKind>,
    asOfMs: number,
    limit: number,
    window: { readonly from?: number; readonly to?: number },
    signal?: AbortSignal,
  ): Promise<FabricCandidate[] | undefined> {
    const store = options.vectorStore;
    if (source !== memory || store?.scanMetadata === undefined) return undefined;
    const rows: { readonly id: string; readonly createdAt: string; readonly metadata: MemoryNoteMetadata }[] = [];
    let cursor: string | undefined;
    let scanned = 0;
    while (scanned < ARCHIVE_WINDOW_SCAN_ROWS) {
      const page = await store.scanMetadata({
        scope: { tenantId: source.scope.tenantId, resourceId: source.scope.resourceId },
        limit: Math.min(ARCHIVE_WINDOW_PAGE, ARCHIVE_WINDOW_SCAN_ROWS - scanned),
        ...(cursor === undefined ? {} : { cursor }),
        ...(signal === undefined ? {} : { signal }),
      });
      scanned += page.rows.length;
      for (const row of page.rows) {
        const metadata = parseMemoryNoteMetadata(row.metadata);
        if (
          metadata === undefined ||
          metadata.status !== "archived" ||
          !kinds.has(metadata.kind) ||
          !isMemoryNoteValidAt(metadata, asOfMs) ||
          !noteInWindow(metadata, row.createdAt, window.from, window.to)
        )
          continue;
        rows.push({ id: row.id, createdAt: row.createdAt, metadata });
      }
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    // Newest event first in the window; `order: "time"` re-sorts the appended rows afterwards.
    rows.sort((a, b) => noteTime(b.metadata, b.createdAt) - noteTime(a.metadata, a.createdAt) || a.id.localeCompare(b.id));
    const selected = rows.slice(0, limit);
    if (selected.length === 0) return [];
    const records = await source.get(
      selected.map((row) => row.id),
      signal === undefined ? {} : { signal },
    );
    const byId = new Map(records.map((record) => [record.id, record]));
    return selected.flatMap((row) => {
      const record = byId.get(row.id);
      return record === undefined ? [] : [{ hit: { ...record, score: 0 }, metadata: row.metadata }];
    });
  }

  /**
   * One bounded candidate batch for both recall and the write path: explicit oversample because
   * kind, validity, and foreign-row filtering happen here (`memory.recall` oversamples only when
   * scoring resolves).
   */
  async function recallCandidates(
    query: string,
    kinds: ReadonlySet<MemoryNoteKind>,
    asOfMs: number,
    limit: number,
    signal?: AbortSignal,
    scoring?: RecallScoringOptions,
    minSimilarity?: number,
    source: Memory = memory,
    allowArchived = false,
    window?: { readonly from?: number; readonly to?: number },
  ): Promise<FabricCandidate[]> {
    const scanned =
      allowArchived && window !== undefined ? await scanArchivedWindow(source, kinds, asOfMs, limit, window, signal) : undefined;
    if (scanned !== undefined) return scanned;
    const recalled = await source.recall(query, {
      minSimilarity,
      topK: Math.min(HARD_TOP_K_CAP, limit * RECALL_OVERSAMPLE),
      ...(scoring === undefined ? {} : { scoring }),
      ...(signal === undefined ? {} : { signal }),
    });
    const candidates: FabricCandidate[] = [];
    for (const hit of recalled.hits) {
      if (candidates.length >= limit) break;
      const metadata = parseMemoryNoteMetadata(hit.metadata);
      if (
        metadata === undefined ||
        !kinds.has(metadata.kind) ||
        !isMemoryNoteValidAt(metadata, asOfMs) ||
        !isActiveNote(metadata, { asOfMs, allowCandidate: true, allowArchived })
      )
        continue;
      candidates.push({ hit, metadata });
    }
    return candidates;
  }

  /** Tombstone one note or working block. Scope is the memory instance's own thread scope. */
  async function forget(input: MemoryFabricForgetInput, forgetOptions: MemoryFabricWriteOptions = {}): Promise<MemoryFabricForgetResult> {
    if (input === null || typeof input !== "object") throw new MemoryValidationError("forget requires an input object");
    const hasBlock = input.block !== undefined;
    if (hasBlock === (input.id !== undefined)) throw new MemoryValidationError("forget requires exactly one of id or block");
    if (input.hold !== undefined && typeof input.hold !== "boolean") throw new MemoryValidationError("hold must be a boolean");
    const signal = forgetOptions.signal === undefined ? {} : { signal: forgetOptions.signal };
    if (hasBlock) {
      if (input.hold !== undefined) throw new MemoryValidationError("hold applies to indexed notes; a block is tombstoned in place");
      assertFabricBlockLabel(input.block);
      const block = input.block;
      const tombstoned = await tombstoneFabricBlock(memory, block, signal);
      return { block, deleted: tombstoned ? 1 : 0, held: false };
    }
    if (!isMemoryId(input.id)) throw new MemoryValidationError("note id must be 12 lowercase hex characters");
    const held = input.hold === true;
    const target = await memoryWithNote(input.id, forgetOptions.signal);
    if (target === undefined) return { id: input.id, deleted: 0, held };
    return { id: input.id, deleted: await target.forget({ ids: [input.id], hold: held }, signal), held };
  }

  const tracker = createFabricCitationTracker();
  const priors = resolveScopePriors(options.scopePriors);
  // Two bounded strength priors after fusion (plan 188.4 Task 3): used notes rank above equally
  // relevant neglected ones, and relevance still dominates.
  const noteStrengthPrior =
    options.lifecycle === undefined && options.clock === undefined
      ? undefined
      : (metadata: MemoryNoteMetadata): number =>
          strengthPrior(metadata, options.clock?.() ?? 0, {
            ...(options.lifecycle === undefined
              ? {}
              : {
                  decay: options.lifecycle.decay,
                  storageWeights: options.lifecycle.storageWeights,
                  weights: options.lifecycle.recall,
                }),
          });
  const loadCandidates = createScopeRecall({
    // Read-only levels (the team store) join fusion, shadowing, and the priors but never a write.
    scopes: [...(options.scopes ?? [{ level: "project", memory }]), ...(options.readOnlyScopes ?? [])],
    recallCandidates,
    priors,
    ...(noteStrengthPrior === undefined ? {} : { strengthPrior: noteStrengthPrior }),
    conceptPrior: options.ontology?.conceptPrior ?? DEFAULT_CONCEPT_PRIOR,
  });
  /** Link targets may live in any active scope; the narrowest scope wins an id collision. */
  async function getNotesAcrossScopes(ids: readonly string[], signal?: AbortSignal): Promise<readonly MemoryVectorRecord[]> {
    const found = new Map<string, MemoryVectorRecord>();
    for (const scopeMemory of orderedMemories) {
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length === 0) break;
      for (const record of await scopeMemory.get(missing, signal === undefined ? {} : { signal })) {
        if (!found.has(record.id)) found.set(record.id, record);
      }
    }
    return [...found.values()];
  }
  async function navigateNotes(
    request: { around?: string; session?: string; page?: number },
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    let session = request.session;
    let memories = orderedMemories;
    if (request.around !== undefined) {
      const owner = await memoryWithNote(request.around, signal);
      if (owner === undefined) return [];
      const anchor = await owner.getEntry(request.around, { signal });
      const metadata = anchor === undefined ? undefined : parseMemoryNoteMetadata(anchor.metadata);
      if (metadata?.kind !== "exchange" || !metadata.session) return [];
      session = metadata.session;
      memories = [owner];
    }
    if (!session) return [];
    const rows = new Map<string, { id: string; time: string }>();
    for (const source of memories) {
      const { tenantId, resourceId, threadId } = source.scope;
      if (!tenantId || !resourceId || !threadId) continue;
      const store = options.vectorStore;
      let metadataRows: readonly import("@arnilo/prism-memory-core").MemoryVectorMetadataRow[] = [];
      if (store?.listBySession) {
        metadataRows = await store.listBySession({ tenantId, resourceId, threadId }, session, { signal });
      } else if (store?.scanMetadata) {
        options.notify?.("memory-fabric: store has no listBySession; session navigation uses a metadata scan");
        const collected: import("@arnilo/prism-memory-core").MemoryVectorMetadataRow[] = [];
        let cursor: string | undefined;
        do {
          signal?.throwIfAborted();
          const page = await store.scanMetadata({ scope: { tenantId, resourceId }, limit: 200, cursor, signal });
          collected.push(...page.rows);
          cursor = page.nextCursor;
        } while (cursor !== undefined);
        // get() below binds every candidate back to the exact active thread.
        metadataRows = collected;
      } else {
        options.notify?.("memory-fabric: session navigation unavailable; store has no listBySession or scanMetadata");
      }
      const candidates = metadataRows.filter((row) => {
        const metadata = parseMemoryNoteMetadata(row.metadata);
        return metadata?.kind === "exchange" && metadata.session === session;
      });
      // Bind metadata to the active memory before paging, excluding revoked and foreign-thread rows.
      for (let start = 0; start < candidates.length; start += 200) {
        const batch = candidates.slice(start, start + 200);
        const readable = store?.listBySession
          ? batch
          : await source.get(
              batch.map((row) => row.id),
              { signal },
            );
        for (const record of readable) {
          const metadata = parseMemoryNoteMetadata(record.metadata);
          const now = Date.now();
          if (
            metadata?.kind !== "exchange" ||
            metadata.session !== session ||
            metadata.status === "archived" ||
            metadata.status === "retired" ||
            metadata.status === "candidate" ||
            (metadata.validFrom !== undefined && Date.parse(metadata.validFrom) > now) ||
            (metadata.validTo !== undefined && Date.parse(metadata.validTo) <= now)
          )
            continue;
          if (!rows.has(record.id)) rows.set(record.id, { id: record.id, time: metadata.tRef ?? record.createdAt });
        }
      }
    }
    const sorted = [...rows.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id));
    if (request.around !== undefined) {
      const index = sorted.findIndex((row) => row.id === request.around);
      return index < 0 ? [] : sorted.slice(Math.max(0, index - 2), index + 3).map((row) => row.id);
    }
    const offset = (request.page ?? 0) * 8;
    return sorted.slice(offset, offset + 8).map((row) => row.id);
  }
  const recall = createFabricRecall({
    loadCandidates,
    limits,
    memory,
    getNotes: getNotesAcrossScopes,
    priors,
    onRecall: options.onRecall,
    ...(options.supersessionHint === undefined ? {} : { supersessionHint: options.supersessionHint }),
    ...(options.queryExpansion === true ? { queryExpansion: true } : {}),
  });
  const lifecycles = orderedMemories.map((scopeMemory) => createFabricLifecycle(scopeMemory));
  const routedVerify = async (id: string, verifyOptions: { readonly signal?: AbortSignal } = {}): Promise<boolean> => {
    const target = await memoryWithNote(id, verifyOptions.signal);
    const index = target === undefined ? -1 : orderedMemories.indexOf(target);
    return index < 0 ? false : lifecycles[index]!.verify(id, verifyOptions);
  };
  const routedRecordUses = async (
    sessionKey: string,
    ids: readonly string[],
    recordOptions: RecordUsesOptions = {},
  ): Promise<readonly string[]> => (await Promise.all(lifecycles.map((item) => item.recordUses(sessionKey, ids, recordOptions)))).flat();
  const routedPin = async (id: string, pinned = true, pinOptions: { readonly signal?: AbortSignal } = {}): Promise<boolean> => {
    const target = await memoryWithNote(id, pinOptions.signal);
    const index = target === undefined ? -1 : orderedMemories.indexOf(target);
    return index < 0 ? false : lifecycles[index]!.pin(id, pinned, pinOptions);
  };

  const MAINTAIN_LIMITS = resolveMemoryWorkerLimits(options.workerLimits);

  /**
   * One maintenance pass (plan 188.4 Tasks 4-6): archive, capacity, widening, narrowing. With a
   * `scope` it runs for that resource only and skips widening, which needs the cross-project scan.
   */
  const maintain: MemoryFabric["maintain"] = (maintainOptions = {}) =>
    runMaintenance(
      {
        memories: orderedMemories,
        levels: orderedMemories.map((_, index) => options.scopes?.[index]?.level ?? "project"),
        lifecycles,
        ...(options.vectorStore === undefined ? {} : { store: options.vectorStore }),
        remember,
        ...(options.lifecycle === undefined ? {} : { lifecycle: options.lifecycle }),
        workerLimits: MAINTAIN_LIMITS,
        ...(options.resolveModelClient === undefined ? {} : { resolveModelClient: options.resolveModelClient }),
        ...(redactor === undefined ? {} : { redactor }),
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
        ...(options.notify === undefined ? {} : { notify: options.notify }),
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.openScope === undefined ? {} : { openScope: options.openScope }),
      },
      maintainOptions,
    );

  return {
    remember,
    consolidate,
    recall,
    maintain,
    searchConversation: createFabricConversationSearch({ observational: options.observational }),
    forget,
    verify: routedVerify,
    pin: routedPin,
    recordUses: routedRecordUses,
    registerContextBuild: (hooks: HookRegistrar, providerOptions?: MemoryContextProviderOptions) =>
      registerMemoryFabricContext(
        hooks,
        memory,
        providerOptions,
        recall,
        options.inject,
        tracker,
        { recordUses: routedRecordUses },
        options.touchedPaths,
      ),
    tools: createMemoryFabricTools({
      ...(options.supersessionHint === undefined ? {} : { supersessionHint: options.supersessionHint }),
      ...(options.gather === true ? { gather: true } : {}),
      memory,
      remember,
      recall,
      forget,
      state,
      ...(options.resolveModelClient === undefined ? {} : { resolveModelClient: options.resolveModelClient }),
      tracker,
      noteMemory: (id, signal) => memoryWithNote(id, signal),
      navigateNotes,
      readNotes: (ids, signal) => getNotesAcrossScopes(ids, signal),
      ...(options.ontology === undefined
        ? {}
        : { ontology: { maxClaimsRendered: options.ontology.maxClaimsRendered ?? DEFAULT_MAX_CLAIMS_RENDERED } }),
      ...(options.scopes === undefined ? {} : { scopeLevel: options.scopes[orderedMemories.indexOf(memory)]?.level ?? "project" }),
      scopeLevels: [
        ...(options.scopes ?? [{ level: "project" as const, memory }]).map((binding) => binding.level),
        ...(options.readOnlyScopes ?? []).map((binding) => binding.level),
      ],
      ...(options.touchedPaths === undefined ? {} : { touchedPaths: options.touchedPaths }),
      lifecycle: {
        verify: (id, signal) => routedVerify(id, signal === undefined ? {} : { signal }),
        pin: (id, pinned, signal) => routedPin(id, pinned, signal === undefined ? {} : { signal }),
      },
    }),
  };
}

/** The one kind an exchange candidate carries; a pass never gathers anything else from the store. */
const EXCHANGE_KINDS: ReadonlySet<MemoryNoteKind> = new Set<MemoryNoteKind>(["exchange"]);

function messageTextOf(message: Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}
