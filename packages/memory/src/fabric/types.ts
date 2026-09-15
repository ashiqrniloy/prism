import type { ContextProvider, JsonObject, SessionEntry, ToolDefinition } from "@arnilo/prism";
import type { MemoryWorkerLimitOptions } from "../compaction/observational-memory/limits.js";
import type { RecallBranchPageResult, RecallPageDetail, RecallPageDirection } from "../compaction/observational-memory/recall.js";
import { isMemoryId } from "../compaction/observational-memory/types.js";
import type {
  Memory,
  MemoryConsent,
  MemoryConsentInput,
  MemoryContextProviderOptions,
  MemoryScope,
  RecallScoringOptions,
} from "../types.js";
import type { AttachedMemoryFabricSession, MemoryFabricAttachableSession, MemoryFabricAttachOptions } from "./attach.js";

/**
 * Note kinds a fabric record may carry. `episode` is a **view** over an observational-memory
 * id: it is never stored as a second row, so `kind: "episode"` writes nothing.
 */
export type MemoryNoteKind = "working" | "episode" | "fact" | "procedure" | "file";

export const MEMORY_NOTE_KINDS: readonly MemoryNoteKind[] = ["working", "episode", "fact", "procedure", "file"];

/**
 * Kinds `recall` returns when the caller does not name kinds. `procedure` is opt-in: it is
 * never mixed into an untyped recall, and `working` is injected as a core block instead.
 */
export const DEFAULT_RECALL_KINDS: readonly MemoryNoteKind[] = ["fact", "file"];

/** Reserved `metadata` key holding the fabric note fields on a vector record. */
export const MEMORY_NOTE_METADATA_KEY = "fabric";

/** Reserved top-level key inside the working-memory value holding labeled fabric blocks. */
export const MEMORY_FABRIC_WORKING_KEY = "_fabric";

export interface MemoryNoteLink {
  /** Target note id (12-hex, same id space as observational memory). */
  readonly id: string;
  readonly relation?: string;
  /** Optional edge weight in [0,1]; 1 when absent. */
  readonly weight?: number;
}

/** Provenance of a note derived from a reflection explicitly bound to a closed work scope. */
export interface MemoryNotePromotion {
  readonly reflectionId: string;
  readonly scopeId: string;
}

/** One fabric note as returned by `remember` and `recall`. */
export interface MemoryNote {
  readonly id: string;
  readonly kind: MemoryNoteKind;
  readonly content: string;
  /** Write time of the backing record (vector `createdAt` / working `updatedAt` / observation timestamp). */
  readonly ingestedAt: string;
  readonly tokenCount: number;
  /** Reference time the note talks about; informational, not a validity bound. */
  readonly tRef?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly context?: string;
  readonly links?: readonly MemoryNoteLink[];
  readonly sourceEntryIds?: readonly string[];
  readonly supersedes?: string;
  /** Set only on a note derived from a bound reflection; names the bind it graduated from. */
  readonly promotedFrom?: MemoryNotePromotion;
  /** Block label, `kind: "working"` only. */
  readonly block?: string;
  /** Workspace path, `kind: "file"` only. */
  readonly path?: string;
  readonly importance?: number;
  readonly consent?: MemoryConsent;
  readonly scope?: MemoryScope;
}

export interface MemoryNoteHit extends MemoryNote {
  readonly score: number;
  /** Present only when recall scoring was requested. */
  readonly similarity?: number;
  readonly recency?: number;
}

export interface MemoryFabricRememberInput {
  readonly kind: MemoryNoteKind;
  /** Required for `episode` (it is the observational-memory id); optional elsewhere. */
  readonly id?: string;
  /**
   * Derives content from an observational-memory reflection; `fact`/`procedure` only. The
   * reflection must be explicitly bound (`om.scope.bound`) to a closed work scope, and
   * `content` is not accepted with it.
   */
  readonly reflectionId?: string;
  /** Required for `working`; required for `fact`/`procedure`; defaults to `path` for `file`. */
  readonly content?: string;
  /** Block label, `kind: "working"` only. */
  readonly block?: string;
  /** Workspace path, `kind: "file"` only. */
  readonly path?: string;
  readonly tRef?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly context?: string;
  readonly links?: readonly MemoryNoteLink[];
  readonly sourceEntryIds?: readonly string[];
  readonly supersedes?: string;
  readonly importance?: number;
  readonly consent?: MemoryConsentInput;
}

export interface MemoryFabricWriteOptions {
  readonly signal?: AbortSignal;
}

export interface MemoryFabricRecallOptions {
  /** Defaults to {@link DEFAULT_RECALL_KINDS}; naming a kind is the only way to get `procedure`. */
  readonly kinds?: readonly MemoryNoteKind[];
  /** Point in time used for the validity window. Defaults to now. */
  readonly asOf?: string | Date;
  readonly topK?: number;
  /** Ceiling on the summed `tokenCount` of the returned hits; the best hit is always returned. */
  readonly budget?: number;
  readonly scoring?: RecallScoringOptions;
  readonly signal?: AbortSignal;
}

/** One provenance row, parallel to `hits[i]`; scores only, never a payload beyond the returned hits. */
export interface MemoryFabricExplainEntry {
  readonly id: string;
  readonly score: number;
  /** Present only when recall scoring was requested. */
  readonly similarity?: number;
  readonly recency?: number;
  readonly importance?: number;
  /** True when the hit arrived through a link from a seed hit instead of the query ranking. */
  readonly link: boolean;
  /** True for every returned hit: each one passed the `asOf` validity filter. */
  readonly valid: boolean;
}

export interface MemoryFabricRecallResult {
  readonly hits: readonly MemoryNoteHit[];
  readonly explain: readonly MemoryFabricExplainEntry[];
}

/**
 * Observational-memory ledger source for `kind: "episode"` views. An attached
 * `AttachedObservationalMemorySession` satisfies this (`{ session }`).
 */
export interface MemoryFabricObservationSource {
  readonly session: { readonly id?: string; entries(): Promise<readonly SessionEntry[]> };
}

export interface CreateMemoryFabricOptions {
  readonly memory: Memory;
  /** Required only for `kind: "episode"`; fabric stays fully inert without it. */
  readonly observational?: MemoryFabricObservationSource;
  /**
   * Deterministic near-duplicate folding on `fact`/`procedure`/`file` writes (default on): an
   * existing note at or above the threshold is rewritten in place when it is the same note, and
   * superseded when it is the same subject with changed content. Pass `false` to write unconditionally.
   */
  readonly consolidate?: boolean | MemoryFabricConsolidationOptions;
  /** Opt-in derived `related` edges stored on the written note. */
  readonly linker?: boolean | MemoryFabricLinkerOptions;
  /** Opt-in annotation patch (keywords/context) of the written note's nearest neighbors. */
  readonly evolution?: boolean | MemoryFabricEvolutionOptions;
  /** Skips the opt-in workers (linker, evolution); consolidation is part of the write path. */
  readonly passive?: boolean;
  /** Worker caps, resolved by the observational-memory `resolveMemoryWorkerLimits` helper. */
  readonly workerLimits?: MemoryWorkerLimitOptions;
}

export interface MemoryFabricConsolidationOptions {
  /** Cosine floor at which a recalled note counts as the same note; default 0.85. */
  readonly threshold?: number;
}

export interface MemoryFabricLinkerOptions {
  readonly enabled?: boolean;
  /** Edges per note; default 3, hard cap 32. */
  readonly topK?: number;
}

export interface MemoryFabricEvolutionOptions {
  readonly enabled?: boolean;
  /** Neighbors patched per write; default is the resolved worker per-turn budget, hard cap 32. */
  readonly maxPatches?: number;
}

export interface MemoryFabricConversationSearchOptions {
  /** Messages per page around a hit: the observational-memory page limit (default 20, hard cap 100). */
  readonly limit?: number;
  /** Page direction; default `backward` (the page ends at the matching message). */
  readonly direction?: RecallPageDirection;
  /** Page detail; default `summary`. */
  readonly detail?: RecallPageDetail;
  /** Matching messages returned; default 5, hard cap 100. */
  readonly topK?: number;
  readonly signal?: AbortSignal;
}

export interface MemoryFabricConversationHit {
  readonly entryId: string;
  /** Query-term coverage in [0,1]. */
  readonly score: number;
  readonly timestamp: string;
  /** Branch page around the match, from `recallObservationalMemoryBranchPage` (cursor semantics included). */
  readonly page: RecallBranchPageResult;
}

export interface MemoryFabricConversationSearchResult {
  readonly hits: readonly MemoryFabricConversationHit[];
  /** Eligible branch messages scanned on this call. */
  readonly scanned: number;
}

export interface MemoryFabricForgetInput {
  /** Indexed note id to tombstone. Exactly one of `id`/`block` is required. */
  readonly id?: string;
  /** Working block label to tombstone (content cleared, label reusable). */
  readonly block?: string;
  /** Retain the row as a legal hold instead of deleting it; ignored for blocks. */
  readonly hold?: boolean;
}

export interface MemoryFabricForgetResult {
  readonly id?: string;
  readonly block?: string;
  /** Rows removed from the vector store; 0 when the note was held or was not in this scope. */
  readonly deleted: number;
  /** True when the note was retained under legal hold rather than deleted. */
  readonly held: boolean;
}

export interface MemoryFabricToolsOptions {
  /** Directory file tools are jailed to. Without it, path-taking tools fail closed. */
  readonly root?: string;
  /** Per-file read/append ceiling; default 50 KiB, hard cap 1 MiB. */
  readonly maxFileBytes?: number;
}

export interface MemoryFabric {
  readonly remember: (input: MemoryFabricRememberInput, options?: MemoryFabricWriteOptions) => Promise<MemoryNote>;
  readonly recall: (query: string, options?: MemoryFabricRecallOptions) => Promise<MemoryFabricRecallResult>;
  /** Lexical search over the current branch, each hit carrying the observational-memory page around it. */
  readonly searchConversation: (
    query: string,
    options?: MemoryFabricConversationSearchOptions,
  ) => Promise<MemoryFabricConversationSearchResult>;
  /** Tombstone a note: `memory.forget` (deleted, or retained under legal hold) or `updateWorking` (block). */
  readonly forget: (input: MemoryFabricForgetInput, options?: MemoryFabricWriteOptions) => Promise<MemoryFabricForgetResult>;
  /**
   * Authorize one session: its tool calls run against this fabric and the opt-in workers enrich
   * writes while it is attached. Fails closed on a non-session or on a session that is not the
   * fabric's observational session.
   */
  readonly attach: <S extends MemoryFabricAttachableSession>(
    session: S,
    options?: MemoryFabricAttachOptions,
  ) => AttachedMemoryFabricSession<S>;
  /** Context seam: the blocks `createMemory` resolves, tagged `working-memory` / `semantic-memory`. */
  readonly createContextProvider: (options?: MemoryContextProviderOptions) => ContextProvider;
  /** Fresh inert definitions each call; nothing is registered globally and nothing runs until the host adds them. */
  readonly tools: (options?: MemoryFabricToolsOptions) => readonly ToolDefinition[];
}

/** Stored form of a note's fabric fields (the `v: 1` schema under {@link MEMORY_NOTE_METADATA_KEY}). */
export interface MemoryNoteMetadata {
  readonly v: 1;
  readonly kind: MemoryNoteKind;
  readonly tRef?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly context?: string;
  readonly links?: readonly MemoryNoteLink[];
  readonly sourceEntryIds?: readonly string[];
  readonly supersedes?: string;
  /** Set only on a note derived from a bound reflection; names the bind it graduated from. */
  readonly promotedFrom?: MemoryNotePromotion;
  readonly path?: string;
}

export function isMemoryNoteKind(value: unknown): value is MemoryNoteKind {
  return typeof value === "string" && (MEMORY_NOTE_KINDS as readonly string[]).includes(value);
}

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

/**
 * Fail-closed parse of the fabric fields on a vector record. Returns `undefined` when the
 * record is not a fabric note or carries a malformed field, so a corrupt row is never injected.
 */
export function parseMemoryNoteMetadata(metadata: JsonObject | undefined): MemoryNoteMetadata | undefined {
  const raw = metadata?.[MEMORY_NOTE_METADATA_KEY];
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.v !== 1 || !isMemoryNoteKind(record.kind)) return undefined;
  for (const key of ["tRef", "validFrom", "validTo"] as const) {
    if (record[key] !== undefined && !isIsoTimestamp(record[key])) return undefined;
  }
  for (const key of ["keywords", "tags", "sourceEntryIds"] as const) {
    if (record[key] !== undefined && !isStringList(record[key])) return undefined;
  }
  if (record.context !== undefined && (typeof record.context !== "string" || record.context.length === 0)) return undefined;
  if (record.supersedes !== undefined && !isMemoryId(record.supersedes)) return undefined;
  if (record.path !== undefined && (typeof record.path !== "string" || record.path.length === 0)) return undefined;
  let promotedFrom: MemoryNotePromotion | undefined;
  if (record.promotedFrom !== undefined) {
    if (record.promotedFrom === null || typeof record.promotedFrom !== "object" || Array.isArray(record.promotedFrom)) return undefined;
    const source = record.promotedFrom as Record<string, unknown>;
    if (!isMemoryId(source.reflectionId)) return undefined;
    if (typeof source.scopeId !== "string" || source.scopeId.length === 0) return undefined;
    promotedFrom = { reflectionId: source.reflectionId, scopeId: source.scopeId };
  }
  let links: readonly MemoryNoteLink[] | undefined;
  if (record.links !== undefined) {
    if (!Array.isArray(record.links)) return undefined;
    const parsedLinks: MemoryNoteLink[] = [];
    for (const link of record.links) {
      if (link === null || typeof link !== "object" || Array.isArray(link)) return undefined;
      const item = link as Record<string, unknown>;
      if (!isMemoryId(item.id)) return undefined;
      if (item.relation !== undefined && typeof item.relation !== "string") return undefined;
      if (item.weight !== undefined && (typeof item.weight !== "number" || !Number.isFinite(item.weight))) return undefined;
      parsedLinks.push({
        id: item.id,
        ...(item.relation === undefined ? {} : { relation: item.relation as string }),
        ...(item.weight === undefined ? {} : { weight: item.weight as number }),
      });
    }
    links = parsedLinks;
  }
  return {
    v: 1,
    kind: record.kind,
    ...(record.tRef === undefined ? {} : { tRef: record.tRef as string }),
    ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom as string }),
    ...(record.validTo === undefined ? {} : { validTo: record.validTo as string }),
    ...(record.keywords === undefined ? {} : { keywords: record.keywords as readonly string[] }),
    ...(record.tags === undefined ? {} : { tags: record.tags as readonly string[] }),
    ...(record.context === undefined ? {} : { context: record.context as string }),
    ...(links === undefined ? {} : { links }),
    ...(record.sourceEntryIds === undefined ? {} : { sourceEntryIds: record.sourceEntryIds as readonly string[] }),
    ...(record.supersedes === undefined ? {} : { supersedes: record.supersedes as string }),
    ...(promotedFrom === undefined ? {} : { promotedFrom }),
    ...(record.path === undefined ? {} : { path: record.path as string }),
  };
}

/** JSON-safe form of the fabric fields; `undefined` fields are dropped. */
export function encodeMemoryNoteMetadata(fields: Omit<MemoryNoteMetadata, "v">): JsonObject {
  const encoded: Record<string, unknown> = { v: 1, kind: fields.kind };
  for (const [key, value] of Object.entries(fields)) {
    if (key !== "kind" && value !== undefined) encoded[key] = value;
  }
  return encoded as JsonObject;
}

/**
 * True when `asOfMs` falls inside the note's validity window. The window is half-open:
 * `validFrom` is inclusive and `validTo` is exclusive, so a supersession never leaves two
 * current versions of one note at the boundary millisecond.
 */
export function isMemoryNoteValidAt(metadata: Pick<MemoryNoteMetadata, "validFrom" | "validTo">, asOfMs: number): boolean {
  if (metadata.validFrom !== undefined && Date.parse(metadata.validFrom) > asOfMs) return false;
  if (metadata.validTo !== undefined && Date.parse(metadata.validTo) <= asOfMs) return false;
  return true;
}

/** Note fields a hit/result carries, without the storage-only `v`/`kind` discriminator. */
export function noteFields(metadata: MemoryNoteMetadata): Omit<MemoryNoteMetadata, "v" | "kind"> {
  const { v: _v, kind: _kind, ...fields } = metadata;
  return fields;
}

/** ponytail: 4-chars-per-token estimate; swap for a real tokenizer only if budgeting drifts. */
export function estimateNoteTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
