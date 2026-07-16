import type { JsonObject, Message, SecretRedactor } from "@arnilo/prism";
import type { MemoryLimits, MemoryLimitsInput } from "./limits.js";

/** Mandatory tenant + resource scope; thread is optional for resource-level working memory. */
export interface MemoryScope {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly threadId?: string;
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
  createContextProvider(options?: MemoryContextProviderOptions): import("@arnilo/prism").ContextProvider;
  createWorkingMemoryProcessor(options: WorkingMemoryProcessorOptions): {
    process(messages: readonly Message[], options?: { readonly signal?: AbortSignal }): Promise<WorkingMemoryRecord | undefined>;
  };
}
