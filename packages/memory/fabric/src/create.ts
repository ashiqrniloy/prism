import { randomUUID } from "node:crypto";
import type { HookRegistrar, JsonObject } from "@arnilo/prism";
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
import { type ConsolidationLifecycle, createConsolidationLease, runConsolidationPass } from "./consolidation/pass.js";
import type { ConsolidationExistingNote } from "./consolidation/prompts.js";
import { createFabricCitationTracker } from "./context.js";
import { decideConsolidation } from "./decider.js";
import {
  createFabricLifecycle,
  isActiveNote,
  type MemoryNoteStatus,
  normalizeNoteStatus,
  type RecordUsesOptions,
} from "./lifecycle/index.js";
import { runMaintenance } from "./lifecycle/maintain.js";
import { noteImportance, storageStrength, strengthPrior } from "./lifecycle/strength.js";
import { mergeNoteLinks, resolveNoteLinks } from "./links.js";
import { registerMemoryFabricContext } from "./provider.js";
import { createFabricRecall, type FabricCandidate } from "./recall.js";
import { createScopeRecall, resolveScopePriors } from "./scope/recall.js";
import { createFabricConversationSearch } from "./search.js";
import { createMemoryFabricTools } from "./tools.js";
import {
  type CreateMemoryFabricOptions,
  defaultScopeFor,
  encodeMemoryNoteMetadata,
  estimateNoteTokens,
  type FabricScopeLevel,
  isMemoryNoteKind,
  isMemoryNoteScope,
  isMemoryNoteValidAt,
  MEMORY_NOTE_METADATA_KEY,
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
  parseMemoryNoteMetadata,
  parsePromotionStamp,
  stampProvenance,
  validateAppliesTo,
  validateNoteKey,
} from "./types.js";
import { resolveMemoryFabricSettings, runFabricEvolutionWorker } from "./workers.js";

const isIso = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

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
  if (input.id !== undefined && !isMemoryId(input.id)) throw new MemoryValidationError("note id must be 12 lowercase hex characters");
  if (input.contentHash !== undefined && (typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(input.contentHash)))
    throw new MemoryValidationError("contentHash must be a SHA-256 hex digest");
  for (const key of ["tRef", "validFrom", "validTo"] as const) {
    const value = input[key];
    if (value !== undefined && !isIso(value)) throw new MemoryValidationError(`${key} must be an ISO timestamp`);
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
  if (input.overrides !== undefined && !isMemoryId(input.overrides)) {
    throw new MemoryValidationError("overrides must be a 12-hex note id");
  }
  if (input.promotion !== undefined && parsePromotionStamp(input.promotion) === undefined) {
    throw new MemoryValidationError("promotion must carry a finite score, finite signals, and a non-empty pass");
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
    ...(input.tRef === undefined ? {} : { tRef: input.tRef }),
    ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
    ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
    ...(input.keywords === undefined ? {} : { keywords: input.keywords }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.links === undefined ? {} : { links: input.links }),
    ...(input.sourceEntryIds === undefined ? {} : { sourceEntryIds: input.sourceEntryIds }),
    ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.appliesTo === undefined ? {} : { appliesTo: input.appliesTo }),
    ...(input.key === undefined ? {} : { key: input.key }),
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
    let status: MemoryNoteStatus | undefined = writeOptions.status;

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
            [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({ ...candidate.metadata, validTo: ingestedAt }),
          },
          ...(candidate.hit.consent === undefined ? {} : { consent: candidate.hit.consent }),
          ...(candidate.hit.importance === undefined ? {} : { importance: candidate.hit.importance }),
          ...(signal === undefined ? {} : { signal }),
        },
        target,
      );
      supersedes = candidate.hit.id;
    } else if (plan.action === "update" && candidate !== undefined) {
      id = candidate.hit.id;
      createdAt = candidate.hit.createdAt;
      hostMetadata = candidate.hit.metadata ?? {};
      consent = input.consent ?? candidate.hit.consent;
      importance = input.importance ?? candidate.hit.importance;
      // A promotion never demotes a note; an agent writing a candidate again is what confirms it.
      const existing = normalizeNoteStatus(candidate.hit.metadata?.status as string | undefined, "verified");
      status =
        existing === "verified"
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
          resolveNoteLinks(
            candidates.map((item) => ({ id: item.hit.id, score: item.hit.score })),
            { topK: settings.linker.topK, exclude: [id, ...(supersedes === undefined ? [] : [supersedes])] },
          ),
        )
      : input.links;
    const links = mergeNoteLinks(
      derivedLinks,
      plan.action === "insert" && plan.similar ? [{ id: plan.similar, relation: "similar" }] : undefined,
    );
    const created = options.clock?.() ?? 0;
    const incoming: MemoryNoteMetadata = {
      ...toNoteMetadata({ ...input, ...(supersedes === undefined ? {} : { supersedes }) }, kind, path, promotedFrom),
      scope: level,
      ...(created > 0 ? { created } : {}),
      ...(input.appliesTo === undefined ? {} : { appliesTo: input.appliesTo }),
      ...(links === undefined ? {} : { links }),
    };
    const metadata = plan.action === "update" && candidate !== undefined ? mergeNoteMetadata(candidate.metadata, incoming) : incoming;
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
    assertRememberInput(input, limits.maxEntryTextChars);
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
          return options.resolveModelClient(promotion.model);
        },
        limits: consolidationLimits!,
        ...(redactor === undefined ? {} : { redactor }),
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
        root: options.promoteRoot ?? process.cwd(),
        ...(consolidateOptions.signal === undefined ? {} : { signal: consolidateOptions.signal }),
        recallExisting: async (query, scope, limit) => {
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
    } finally {
      consolidationLease.exit(session.id);
    }
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
  ): Promise<FabricCandidate[]> {
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
  const recall = createFabricRecall({ loadCandidates, limits, memory, getNotes: getNotesAcrossScopes, priors });
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
      memory,
      remember,
      recall,
      forget,
      tracker,
      noteMemory: (id, signal) => memoryWithNote(id, signal),
      ...(options.scopes === undefined ? {} : { scopeLevel: options.scopes[orderedMemories.indexOf(memory)]?.level ?? "project" }),
      ...(options.touchedPaths === undefined ? {} : { touchedPaths: options.touchedPaths }),
      lifecycle: {
        verify: (id, signal) => routedVerify(id, signal === undefined ? {} : { signal }),
        pin: (id, pinned, signal) => routedPin(id, pinned, signal === undefined ? {} : { signal }),
      },
    }),
  };
}
