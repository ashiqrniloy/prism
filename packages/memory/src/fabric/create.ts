import { randomUUID } from "node:crypto";
import type { JsonObject } from "@arnilo/prism";
import { createMemoryId, isMemoryId } from "../compaction/observational-memory/ids.js";
import { foldObservationalMemoryLedger } from "../compaction/observational-memory/ledger.js";
import { foldWorkScopeMap, type WorkBindRef, type WorkScopeId, type WorkScopeMap } from "../compaction/observational-memory/scopes.js";
import { MemoryValidationError } from "../errors.js";
import { HARD_TOP_K_CAP } from "../limits.js";
import { RECALL_OVERSAMPLE } from "../scoring.js";
import type { MemoryConsentInput, MemoryContextProviderOptions, RecallScoringOptions } from "../types.js";
import { createFabricAttach } from "./attach.js";
import { assertFabricBlockLabel, fabricBlockId, setFabricBlock, tombstoneFabricBlock } from "./blocks.js";
import { mergeNoteMetadata, planMemoryConsolidation } from "./consolidate.js";
import { mergeNoteLinks, resolveNoteLinks } from "./links.js";
import { createMemoryFabricContextProvider } from "./provider.js";
import { createFabricRecall, type FabricCandidate } from "./recall.js";
import { createFabricConversationSearch } from "./search.js";
import { createMemoryFabricTools } from "./tools.js";
import {
  type CreateMemoryFabricOptions,
  encodeMemoryNoteMetadata,
  estimateNoteTokens,
  isMemoryNoteKind,
  isMemoryNoteValidAt,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryFabric,
  type MemoryFabricForgetInput,
  type MemoryFabricForgetResult,
  type MemoryFabricRememberInput,
  type MemoryFabricWriteOptions,
  type MemoryNote,
  type MemoryNoteKind,
  type MemoryNoteLink,
  type MemoryNoteMetadata,
  type MemoryNotePromotion,
  noteFields,
  parseMemoryNoteMetadata,
} from "./types.js";
import { resolveMemoryFabricSettings, runFabricEvolutionWorker } from "./workers.js";

const isIso = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

function closedScopeForReflection(map: WorkScopeMap, reflectionId: string): WorkScopeId | undefined {
  const ref: WorkBindRef = `reflection:${reflectionId}`;
  for (const [scopeId, refs] of map.binds) {
    if (refs.includes(ref) && map.scopes.get(scopeId)?.status === "closed") return scopeId;
  }
  return undefined;
}

function assertRememberInput(input: MemoryFabricRememberInput, maxTextChars: number): void {
  if (input.id !== undefined && !isMemoryId(input.id)) throw new MemoryValidationError("note id must be 12 lowercase hex characters");
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
    ...(path === undefined ? {} : { path }),
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
  /** Sessions authorized to drive this fabric's tools and workers; an unwired fabric exposes none. */
  const attachedSessions = new Set<string>();
  const contextProvider = createMemoryFabricContextProvider(memory);

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

  /** `fact`/`procedure` promoted from a reflection explicitly bound to a closed work scope. */
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
    const reflection = foldObservationalMemoryLedger(entries).reflections.find((item) => item.id === reflectionId);
    if (reflection === undefined) throw new MemoryValidationError(`unknown observational memory reflection: ${reflectionId}`);
    const scopeId = closedScopeForReflection(foldWorkScopeMap(entries), reflectionId);
    if (scopeId === undefined) throw new MemoryValidationError(`reflection ${reflectionId} is not bound to a closed work scope`);
    return rememberIndexed(kind, input, reflection.content, undefined, writeOptions, { reflectionId, scopeId });
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
  async function writeIndexedRow(write: IndexedRowWrite): Promise<void> {
    await memory.remember(
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
    const record = await setFabricBlock(memory, block, content, writeOptions);
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
    const ingestedAt = new Date().toISOString();
    // Consolidation is part of the write path; linker/evolution are the opt-in workers, and they
    // only run for an attached session — the plain API path writes notes and nothing else.
    const sessionAttached = attachedSessions.size > 0;
    const passive = settings.passive;
    const linkerActive = settings.linker.enabled && !passive && sessionAttached;
    const evolutionActive = settings.evolution.enabled && !passive && sessionAttached;
    const consolidate = settings.consolidate && input.id === undefined && input.supersedes === undefined;
    const neighborCount = Math.max(linkerActive ? settings.linker.topK : 0, evolutionActive ? settings.evolution.maxPatches : 0);
    const candidates =
      consolidate || neighborCount > 0
        ? await recallCandidates(content, new Set([kind]), Date.now(), Math.max(1, neighborCount), signal)
        : [];
    // A file note only ever folds into the same path: embedding similarity never merges documents.
    const candidate = candidates.find((item) => item.hit.id !== input.id && (kind !== "file" || item.metadata.path === path));
    const plan = consolidate
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

    // The random nonce keeps two identical notes written in the same millisecond distinct.
    let id = input.id ?? createMemoryId("fabric", kind, content, ingestedAt, randomUUID());
    let supersedes = input.supersedes;
    let createdAt = ingestedAt;
    let consent: MemoryConsentInput | undefined = input.consent;
    let importance = input.importance;
    let hostMetadata: JsonObject = {};

    if (plan.action === "supersede" && candidate !== undefined) {
      // Supersede the old row first: a crash between the two writes leaves the old note invalid
      // rather than leaving two current notes.
      await writeIndexedRow({
        id: candidate.hit.id,
        content: candidate.hit.text,
        createdAt: candidate.hit.createdAt,
        metadata: {
          ...(candidate.hit.metadata ?? {}),
          [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({ ...candidate.metadata, validTo: ingestedAt }),
        },
        ...(candidate.hit.consent === undefined ? {} : { consent: candidate.hit.consent }),
        ...(candidate.hit.importance === undefined ? {} : { importance: candidate.hit.importance }),
        ...(signal === undefined ? {} : { signal }),
      });
      supersedes = candidate.hit.id;
    } else if (plan.action === "update" && candidate !== undefined) {
      id = candidate.hit.id;
      createdAt = candidate.hit.createdAt;
      hostMetadata = candidate.hit.metadata ?? {};
      consent = input.consent ?? candidate.hit.consent;
      importance = input.importance ?? candidate.hit.importance;
    }

    const links = linkerActive
      ? mergeNoteLinks(
          input.links,
          resolveNoteLinks(
            candidates.map((item) => ({ id: item.hit.id, score: item.hit.score })),
            { topK: settings.linker.topK, exclude: [id, ...(supersedes === undefined ? [] : [supersedes])] },
          ),
        )
      : input.links;
    const incoming: MemoryNoteMetadata = {
      ...toNoteMetadata({ ...input, ...(supersedes === undefined ? {} : { supersedes }) }, kind, path, promotedFrom),
      ...(links === undefined ? {} : { links }),
    };
    const metadata = plan.action === "update" && candidate !== undefined ? mergeNoteMetadata(candidate.metadata, incoming) : incoming;

    await writeIndexedRow({
      id,
      content,
      createdAt,
      metadata: { ...hostMetadata, [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata(metadata) },
      ...(consent === undefined ? {} : { consent }),
      ...(importance === undefined ? {} : { importance }),
      ...(signal === undefined ? {} : { signal }),
    });

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
      ...noteFields(metadata),
      id,
      kind,
      content,
      ingestedAt: createdAt,
      tokenCount: estimateNoteTokens(content),
      ...(importance === undefined ? {} : { importance }),
      scope: memory.scope,
    };
  }

  async function remember(input: MemoryFabricRememberInput, writeOptions: MemoryFabricWriteOptions = {}): Promise<MemoryNote> {
    if (input === null || typeof input !== "object") throw new MemoryValidationError("note input must be an object");
    const kind = input.kind;
    if (!isMemoryNoteKind(kind)) throw new MemoryValidationError(`Unknown memory note kind: ${String(kind)}`);
    assertRememberInput(input, limits.maxEntryTextChars);
    if (kind !== "working" && input.block !== undefined) throw new MemoryValidationError('"block" is only valid for kind "working"');
    if (kind !== "file" && input.path !== undefined) throw new MemoryValidationError('"path" is only valid for kind "file"');
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
  ): Promise<FabricCandidate[]> {
    const recalled = await memory.recall(query, {
      topK: Math.min(HARD_TOP_K_CAP, limit * RECALL_OVERSAMPLE),
      ...(scoring === undefined ? {} : { scoring }),
      ...(signal === undefined ? {} : { signal }),
    });
    const candidates: FabricCandidate[] = [];
    for (const hit of recalled.hits) {
      if (candidates.length >= limit) break;
      const metadata = parseMemoryNoteMetadata(hit.metadata);
      if (metadata === undefined || !kinds.has(metadata.kind) || !isMemoryNoteValidAt(metadata, asOfMs)) continue;
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
    return { id: input.id, deleted: await memory.forget({ ids: [input.id], hold: held }, signal), held };
  }

  const recall = createFabricRecall({ recallCandidates, limits });

  return {
    remember,
    recall,
    searchConversation: createFabricConversationSearch({ observational: options.observational }),
    forget,
    attach: createFabricAttach({
      attachedSessions,
      settings,
      contextProvider,
      ...(options.observational === undefined ? {} : { observational: options.observational }),
    }),
    createContextProvider: (providerOptions?: MemoryContextProviderOptions) => createMemoryFabricContextProvider(memory, providerOptions),
    tools: createMemoryFabricTools({
      memory,
      remember,
      recall,
      forget,
      isAttached: (sessionId) => attachedSessions.has(sessionId),
    }),
  };
}
