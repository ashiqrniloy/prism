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
  readonly dimensions: number;
  embed(
    texts: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly (readonly number[])[]>;
}

export interface MemoryVectorRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId: string;
  readonly text: string;
  readonly embedding: readonly number[];
  readonly sequence: number;
  readonly metadata?: JsonObject;
  readonly consent?: MemoryConsent;
  readonly createdAt: string;
}

export interface MemoryVectorHit extends MemoryVectorRecord {
  readonly score: number;
}

export interface VectorQuery extends MemoryScope {
  readonly embedding: readonly number[];
  readonly topK: number;
  readonly threadId: string;
  readonly signal?: AbortSignal;
}

export interface VectorDeleteFilter extends MemoryScope {
  readonly ids?: readonly string[];
  readonly threadId?: string;
}

export interface VectorStore {
  upsert(records: readonly MemoryVectorRecord[], options?: { readonly signal?: AbortSignal }): Promise<void>;
  query(query: VectorQuery): Promise<readonly MemoryVectorHit[]>;
  delete(filter: VectorDeleteFilter, options?: { readonly signal?: AbortSignal }): Promise<number>;
  getByThread?(scope: Required<MemoryScope>): Promise<readonly MemoryVectorRecord[]>;
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
  update(
    key: WorkingMemoryKey,
    patch: JsonObject,
    options?: WorkingMemoryUpdateOptions,
  ): Promise<WorkingMemoryRecord>;
  delete(key: WorkingMemoryKey, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
}

export interface MemoryEntryInput {
  readonly id: string;
  readonly text: string;
  readonly metadata?: JsonObject;
  readonly consent?: MemoryConsentInput;
  readonly sequence?: number;
  readonly createdAt?: string;
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

export interface RecallOptions {
  readonly topK?: number;
  readonly messageRange?: number;
  /** When true, entries without explicit consent are excluded (strict mode). */
  readonly requireConsent?: boolean;
  readonly signal?: AbortSignal;
}

export interface RecallResult {
  readonly hits: readonly MemoryVectorHit[];
  readonly adjacent: readonly MemoryVectorRecord[];
}

export interface CreateMemoryOptions extends MemoryScope {
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly workingStore?: WorkingMemoryStore;
  readonly limits?: MemoryLimitsInput;
  readonly schema?: JsonObject;
  readonly validateWorkingMemory?: (
    value: JsonObject,
  ) => void | string | Error | Promise<void | string | Error>;
  readonly workingMemoryTemplate?: string;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  /** Strict mode: recall/injection excludes entries lacking explicit consent. */
  readonly requireConsent?: boolean;
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
  readonly extract: (
    messages: readonly Message[],
  ) => JsonObject | undefined | Promise<JsonObject | undefined>;
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
  /** Real delete of entries (all in thread when no ids given). Returns removed count. */
  forget(filter?: { readonly ids?: readonly string[] }, options?: { readonly signal?: AbortSignal }): Promise<number>;
  /** Bounded retention sweep: real-deletes oldest entries past age/count caps. */
  applyRetention(policy: MemoryRetentionPolicy, options?: { readonly signal?: AbortSignal }): Promise<MemoryRetentionResult>;
  createContextProvider(options?: MemoryContextProviderOptions): import("@arnilo/prism").ContextProvider;
  createWorkingMemoryProcessor(options: WorkingMemoryProcessorOptions): {
    process(messages: readonly Message[], options?: { readonly signal?: AbortSignal }): Promise<WorkingMemoryRecord | undefined>;
  };
}
