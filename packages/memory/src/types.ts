import type { JsonObject, Message, SecretRedactor } from "@arnilo/prism";
import type { MemoryLimits, MemoryLimitsInput } from "./limits.js";

/** Mandatory tenant + resource scope; thread is optional for resource-level working memory. */
export interface MemoryScope {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId?: string;
}

/** Who created a memory entry. */
export type MemoryConsentSource = "user" | "agent" | "system";

/** Visibility/control granularity: per-thread, per-profile (resource), or per-user. */
export type MemoryConsentScope = "thread" | "profile" | "user";

/**
 * Consent/source/visibility controls carried on every entry and enforced at
 * recall/injection time. `visible: false` (or a revoked grant) keeps the entry
 * out of prompts, events, exports, and telemetry.
 */
export interface MemoryConsent {
  readonly source: MemoryConsentSource;
  readonly scope: MemoryConsentScope;
  readonly visible: boolean;
  readonly grantedAt?: string;
  readonly revokedAt?: string;
}

/** Partial consent for grant/update; unset fields keep prior values or defaults. */
export interface MemoryConsentInput {
  readonly source?: MemoryConsentSource;
  readonly scope?: MemoryConsentScope;
  readonly visible?: boolean;
}

export interface MemoryRetentionPolicy {
  readonly maxAgeDays?: number;
  readonly maxEntries?: number;
  readonly batchSize?: number;
}

export interface MemoryRetentionResult {
  readonly deleted: number;
  readonly scanned: number;
}

export interface Embedder {
  /** Stable identity of the embedding model, e.g. "nomic-embed-text-v1.5".
   * Persisted on every indexed record so query/index model drift fails closed. */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly (readonly number[])[]>;
}

export interface MemoryVectorRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId: string;
  readonly text: string;
  readonly embedding: readonly number[];
  readonly sequence: number;
  /** Identity of the embedder that produced `embedding`; absent on legacy records. */
  readonly embedderId?: string;
  /** Monotonic per-scope index generation; absent on legacy records, which stay retrievable until re-indexed. */
  readonly generation?: bigint | number;
  readonly metadata?: JsonObject;
  readonly consent?: MemoryConsent;
  /** Host-trusted recall weight in [0,1]; absent on legacy rows → neutral 1.0 at scoring time. */
  readonly importance?: number;
  readonly createdAt: string;
}

export interface MemoryVectorHit extends MemoryVectorRecord {
  readonly score: number;
  /** Composite-score components, present only when `RecallOptions.scoring` is enabled. */
  readonly similarity?: number;
  readonly recency?: number;
}

/** Host-verified principal for query-time document ACL. Not the metadata `filter`. */
export interface RagAccessConstraint {
  readonly principalId: string;
  readonly tenantId: string;
  readonly groupIds?: readonly string[];
  /** When set, only grants at this version match; unresolved versions deny. */
  readonly accessVersion?: number;
}

/** Replace-set of grants for one source. Empty principal+group lists revoke access. */
export interface SourceAccessGrant {
  readonly sourceId: string;
  readonly principalIds?: readonly string[];
  readonly groupIds?: readonly string[];
  readonly accessVersion: number;
}

/** Why a semantic/observational record is excluded from injection. */
export type MemoryInvalidationReason = "corrected" | "revoked" | "forgotten" | "legal_hold";

/** Durable tombstone; bodies may already be gone. */
export interface MemoryInvalidationRecord {
  readonly id: string;
  readonly reason: MemoryInvalidationReason;
  readonly at: string;
  readonly hold?: boolean;
  readonly supersedesId?: string;
}

export interface MemoryInvalidationEvent {
  readonly reason: MemoryInvalidationReason;
  readonly ids: readonly string[];
  readonly hold: boolean;
}

/** v1 lineage stamped at `metadata._lineage`. Missing → self-only (legacy). */
export interface MemoryLineage {
  readonly v: 1;
  readonly sourceIds: readonly string[];
  readonly reason?: string;
}

/** Parent→child share of specific source ids. Empty `sourceIds` revokes. */
export interface MemoryShareGrant {
  readonly tenantId: string;
  readonly parentThreadId: string;
  readonly childThreadId: string;
  readonly sourceIds: readonly string[];
  readonly expiresAt?: string;
}

export interface MemoryRecallExplanation {
  readonly id: string;
  readonly sourceIds: readonly string[];
  readonly createdAt?: string;
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId: string;
  readonly reason?: string;
  readonly invalidated?: MemoryInvalidationRecord;
}

export interface VectorQuery extends MemoryScope {
  readonly embedding: readonly number[];
  readonly topK: number;
  readonly threadId: string;
  readonly signal?: AbortSignal;
  readonly authorization?: RagAccessConstraint;
  /** Additional allow-list (share grants). Empty → no hits. */
  readonly ids?: readonly string[];
}

export interface VectorDeleteFilter extends MemoryScope {
  readonly ids?: readonly string[];
  readonly threadId?: string;
}

export type MemoryVectorOrder = "sequence" | "createdAt";

/** Bounded, stable page over one exact semantic-memory thread. */
export interface MemoryVectorListQuery extends Required<MemoryScope> {
  readonly limit: number;
  readonly cursor?: string;
  readonly order?: MemoryVectorOrder;
  readonly signal?: AbortSignal;
}

export interface MemoryVectorPage {
  readonly records: readonly MemoryVectorRecord[];
  readonly nextCursor?: string;
}

/** Lexical (keyword) retrieval request for stores that declare support. */
export interface VectorLexicalQuery {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId: string;
  readonly text: string;
  readonly topK: number;
  readonly signal?: AbortSignal;
  readonly authorization?: RagAccessConstraint;
  readonly ids?: readonly string[];
}

export type LexicalMode = "fts" | "bm25";

export interface VectorStore {
  upsert(records: readonly MemoryVectorRecord[], options?: { readonly signal?: AbortSignal }): Promise<void>;
  query(query: VectorQuery): Promise<readonly MemoryVectorHit[]>;
  delete(filter: VectorDeleteFilter, options?: { readonly signal?: AbortSignal }): Promise<number>;
  getByThread?(scope: Required<MemoryScope>): Promise<readonly MemoryVectorRecord[]>;
  listByThread?(query: MemoryVectorListQuery): Promise<MemoryVectorPage>;
  countByThread?(scope: Required<MemoryScope>, options?: { readonly signal?: AbortSignal }): Promise<number>;
  /** Lexical retrieval modes this store can execute; absent = no lexical leg. */
  readonly lexicalModes?: readonly LexicalMode[];
  lexicalQuery?(query: VectorLexicalQuery): Promise<readonly MemoryVectorHit[]>;
  /** Current generation for an exact scope; undefined = no generated records yet (or never swapped). */
  getCurrentGeneration?(scope: MemoryScope): Promise<bigint | number | undefined>;
  setCurrentGeneration?(scope: MemoryScope, generation: bigint | number): Promise<void>;
  /** Declared when `query`/`lexicalQuery` apply `authorization` before ranking. Absent = ACL mode unsupported. */
  readonly authorization?: "acl";
  setSourceAccess?(
    scope: Required<MemoryScope>,
    grants: readonly SourceAccessGrant[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>;
  checkSourceAccess?(
    scope: Required<MemoryScope>,
    sourceId: string,
    authorization: RagAccessConstraint,
    options?: { readonly signal?: AbortSignal },
  ): Promise<boolean>;
  /** Declared when query/lexicalQuery exclude invalidated ids before ranking. */
  readonly lineage?: "invalidation";
  invalidate?(
    scope: Required<MemoryScope>,
    entries: readonly MemoryInvalidationRecord[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>;
  listInvalidated?(scope: Required<MemoryScope>, options?: { readonly signal?: AbortSignal }): Promise<readonly MemoryInvalidationRecord[]>;
  /** Drops non-hold rows. Legal hold stays. */
  clearInvalidation?(scope: Required<MemoryScope>, ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<void>;
  setShareGrant?(scope: Required<MemoryScope>, grant: MemoryShareGrant, options?: { readonly signal?: AbortSignal }): Promise<void>;
  getShareGrant?(
    scope: Required<MemoryScope>,
    childThreadId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<MemoryShareGrant | undefined>;
}

export interface WorkingMemoryKey extends MemoryScope {}

export interface WorkingMemoryRecord extends MemoryScope {
  readonly value: JsonObject;
  readonly version: number;
  readonly updatedAt: string;
}

export type WorkingMemoryUpdateMode = "merge" | "replace";

export interface WorkingMemoryUpdateOptions {
  readonly mode?: WorkingMemoryUpdateMode;
  readonly expectedVersion?: number;
  readonly signal?: AbortSignal;
}

export interface WorkingMemoryStore {
  get(key: WorkingMemoryKey, options?: { readonly signal?: AbortSignal }): Promise<WorkingMemoryRecord | undefined>;
  set(record: WorkingMemoryRecord, options?: { readonly signal?: AbortSignal }): Promise<void>;
  update(key: WorkingMemoryKey, patch: JsonObject, options?: WorkingMemoryUpdateOptions): Promise<WorkingMemoryRecord>;
  delete(key: WorkingMemoryKey, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
}

export interface MemoryEntryInput {
  readonly id: string;
  readonly text: string;
  readonly metadata?: JsonObject;
  readonly consent?: MemoryConsentInput;
  readonly sequence?: number;
  readonly createdAt?: string;
  /** Host-supplied importance in [0,1]; wins over importanceFrom derivation; clamped at write. */
  readonly importance?: number;
  /** Redacted reflection record fed to `importanceFrom` (write time only; not persisted). */
  readonly reflection?: JsonObject;
  /** Stamped onto `metadata._lineage`; missing → self-only at query time. */
  readonly lineage?: {
    readonly sourceIds: readonly string[];
    readonly reason?: string;
  };
}

export interface RememberInput {
  readonly entries: readonly MemoryEntryInput[];
}

export interface RememberOptions {
  /** When false (default), indexing continues after the call returns. */
  readonly wait?: boolean;
  readonly signal?: AbortSignal;
}

export interface RememberResult {
  readonly accepted: number;
  readonly pending: boolean;
  readonly done: Promise<void>;
}

/** Composite recall scoring inputs; `score` becomes the weighted blend and hits expose components. */
export interface RecallScoringOptions {
  /** Weight for timestamp half-life decay; requires `halfLifeMs`. */
  readonly recencyWeight?: number;
  /** Weight for the clamped stored `importance` (neutral 1.0 when absent). */
  readonly importanceWeight?: number;
  /** Recency half-life in milliseconds. */
  readonly halfLifeMs?: number;
}

export interface RecallOptions {
  readonly topK?: number;
  readonly messageRange?: number;
  /** When true, entries without explicit consent are excluded (strict mode). */
  readonly requireConsent?: boolean;
  /** Optional composite blend; absent = pure similarity scoring, ordering unchanged. */
  readonly scoring?: RecallScoringOptions;
  readonly signal?: AbortSignal;
  /** When true, each hit gets source/time/scope/reason (no withheld bodies). */
  readonly explain?: boolean;
  /** Live parent-thread share; missing/expired/wrong-child grants fail closed. */
  readonly shareFromParentThreadId?: string;
}

export interface RecallResult {
  readonly hits: readonly MemoryVectorHit[];
  readonly adjacent: readonly MemoryVectorRecord[];
  readonly explanations?: readonly MemoryRecallExplanation[];
}

/** Exact host-verified owner required before semantic-memory export. */
export interface MemoryExportIdentity extends Required<MemoryScope> {}

export interface ExportMemoryOptions {
  readonly identity: MemoryExportIdentity;
  readonly cursor?: string;
  readonly limit?: number;
  readonly maxBytes?: number;
  readonly maxMs?: number;
  readonly signal?: AbortSignal;
}

export interface MemoryExportResult {
  readonly entries: readonly MemoryVectorRecord[];
  readonly nextCursor?: string;
  readonly bytes: number;
}

export interface RebuildIndexOptions {
  readonly cursor?: string;
  readonly batchSize?: number;
  readonly maxMs?: number;
  readonly signal?: AbortSignal;
}

export interface RebuildIndexResult {
  readonly rebuilt: number;
  readonly nextCursor?: string;
}

export interface CreateMemoryOptions extends MemoryScope {
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly workingStore?: WorkingMemoryStore;
  readonly limits?: MemoryLimitsInput;
  readonly schema?: JsonObject;
  readonly validateWorkingMemory?: (value: JsonObject) => undefined | string | Error | Promise<undefined | string | Error>;
  readonly workingMemoryTemplate?: string;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  /** Strict mode: recall/injection excludes entries lacking explicit consent. */
  readonly requireConsent?: boolean;
  /** Host-owned importance derivation from redacted reflection payloads; runs at write time only (see ImportanceFromReflection). */
  readonly importanceFrom?: import("./scoring.js").ImportanceFromReflection;
  /** Fired after invalidation rows land, before body delete. */
  readonly onInvalidate?: (event: MemoryInvalidationEvent) => void | Promise<void>;
}

export interface MemoryContextProviderOptions {
  readonly name?: string;
  readonly includeWorking?: boolean;
  readonly includeSemantic?: boolean;
  /** Explicit recall query; otherwise derived from the latest user message text. */
  readonly query?: string | ((context: { readonly messages: readonly Message[] }) => string | undefined);
  readonly topK?: number;
  readonly messageRange?: number;
}

export interface WorkingMemoryProcessorOptions {
  readonly extract: (messages: readonly Message[]) => JsonObject | undefined | Promise<JsonObject | undefined>;
  readonly mode?: WorkingMemoryUpdateMode;
}

export interface Memory {
  readonly scope: MemoryScope;
  readonly limits: MemoryLimits;
  getWorking(options?: { readonly signal?: AbortSignal }): Promise<WorkingMemoryRecord | undefined>;
  updateWorking(patch: JsonObject, options?: WorkingMemoryUpdateOptions): Promise<WorkingMemoryRecord>;
  deleteWorking(options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  renderWorking(template?: string): Promise<string | undefined>;
  remember(input: RememberInput, options?: RememberOptions): Promise<RememberResult>;
  recall(query: string, options?: RecallOptions): Promise<RecallResult>;
  /** Grant/update consent on an existing entry (no re-embed). */
  setConsent(entryId: string, consent: MemoryConsentInput, options?: { readonly signal?: AbortSignal }): Promise<MemoryVectorRecord>;
  /** Correct an entry's text (re-embeds, preserves id/sequence/metadata/consent). */
  correct(entryId: string, text: string, options?: { readonly signal?: AbortSignal }): Promise<MemoryVectorRecord>;
  /** Real delete of entries (all in thread when no ids given). `hold: true` marks legal_hold and skips body delete. */
  forget(
    filter?: { readonly ids?: readonly string[]; readonly hold?: boolean },
    options?: { readonly signal?: AbortSignal },
  ): Promise<number>;
  shareWith(
    childThreadId: string,
    sourceIds: readonly string[],
    options?: { readonly expiresAt?: string; readonly signal?: AbortSignal },
  ): Promise<void>;
  revokeShare(childThreadId: string, options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** Bounded retention sweep: real-deletes oldest entries past age/count caps. */
  applyRetention(policy: MemoryRetentionPolicy, options?: { readonly signal?: AbortSignal }): Promise<MemoryRetentionResult>;
  /** Returns one redacted, consented page after exact host identity binding. */
  exportMemory(options: ExportMemoryOptions): Promise<MemoryExportResult>;
  /** Re-embeds one bounded page; return `nextCursor` to resume. */
  rebuildIndex(options?: RebuildIndexOptions): Promise<RebuildIndexResult>;
  createContextProvider(options?: MemoryContextProviderOptions): import("@arnilo/prism").ContextProvider;
  createWorkingMemoryProcessor(options: WorkingMemoryProcessorOptions): {
    process(messages: readonly Message[], options?: { readonly signal?: AbortSignal }): Promise<WorkingMemoryRecord | undefined>;
  };
}
