/** Contracts-core compaction family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ErrorInfo } from "./content.js";
import type { SessionEntry } from "./session.js";

export interface CompactionStrategy {
  readonly name: string;
  compact(context: CompactionContext): Promise<CompactionResult> | CompactionResult;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CompactionContext {
  readonly sessionId: string;
  readonly entries: readonly SessionEntry[];
  readonly keepRecentEntries?: number;
  readonly trigger?: "manual" | "auto" | string;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface CompactionResult {
  readonly summary: string;
  readonly entries?: readonly SessionEntry[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CompactionOptions {
  readonly strategy?: CompactionStrategy;
  readonly thresholdEntries?: number;
  readonly keepRecentEntries?: number;
  readonly maxSummaryChars?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface CompactionMiddlewarePayload {
  readonly context: CompactionContext;
  readonly result: CompactionResult;
}

export interface CompactionEntryData {
  readonly throughEntryId?: string;
  readonly keepEntryIds?: readonly string[];
  readonly strategy?: string;
  readonly trigger?: "manual" | "auto" | string;
}

export interface RetryPolicy {
  readonly name: string;
  decide(context: RetryContext): Promise<RetryDecision> | RetryDecision;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly error: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryOptions {
  readonly policy?: RetryPolicy;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetryMiddlewarePayload {
  readonly context: RetryContext;
  readonly decision: RetryDecision;
}
