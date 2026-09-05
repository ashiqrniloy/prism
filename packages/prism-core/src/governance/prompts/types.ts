import type { PersistencePage } from "@arnilo/prism";
import type { PromptLimitsInput } from "./limits.js";

/** Optional tenant/account/user scope. Omitted scope is an isolated local scope. */
export interface PromptOwnership {
  readonly tenantId?: string;
  readonly accountId?: string;
  readonly userId?: string;
}

export interface PromptVersionRef {
  readonly name: string;
  readonly version: number;
  readonly hash: string;
}

export interface PromptRecord extends PromptOwnership, PromptVersionRef {
  readonly body: string;
  readonly labels: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface PutPromptInput extends PromptOwnership {
  readonly name: string;
  readonly body: string;
  readonly labels?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
  readonly signal?: AbortSignal;
}

export interface PromptListQuery extends PromptOwnership {
  readonly name?: string;
  readonly label?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
  readonly signal?: AbortSignal;
}

export interface PromptResolveInput extends PromptOwnership {
  readonly name: string;
  readonly version?: number;
  readonly label?: string;
  readonly signal?: AbortSignal;
}

export interface PromptDiffInput extends PromptOwnership {
  readonly name: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly signal?: AbortSignal;
}

export interface PromptDiffLine {
  readonly type: "context" | "add" | "remove";
  readonly text: string;
}

export interface PromptDiff {
  readonly name: string;
  readonly from: PromptVersionRef;
  readonly to: PromptVersionRef;
  readonly lines: readonly PromptDiffLine[];
  readonly added: number;
  readonly removed: number;
  readonly truncated: boolean;
}

export interface PromptStore {
  put(input: PutPromptInput): Promise<PromptRecord>;
  list(query?: PromptListQuery): Promise<PersistencePage<PromptRecord>>;
  resolve(input: PromptResolveInput): Promise<PromptRecord | null>;
  diff(input: PromptDiffInput): Promise<PromptDiff>;
  diff(name: string, fromVersion: number, toVersion: number, ownership?: PromptOwnership): Promise<PromptDiff>;
}

export interface PromptStoreOptions {
  readonly initial?: readonly PromptRecord[];
  readonly ownership?: PromptOwnership;
  readonly limits?: PromptLimitsInput;
  readonly now?: () => number;
}
