import {
  type Agent,
  isSessionNotFound,
  type OwnershipScope,
  type ProductionPersistenceStore,
  type RunRecord,
  type RunResult,
  SESSION_NOTHING_TO_CONTINUE_CODE,
} from "@arnilo/prism";
import { HeadlessError } from "./errors.js";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_RECOVERY_CONCURRENCY = 2;

/** The listing capability the sweep needs. `RunLedger` is write-only. */
export type RunListing = Pick<ProductionPersistenceStore, "queryRuns">;

export interface FindInterruptedRunsOptions {
  /** Applied to the ledger query, and again to every returned record. */
  readonly ownership: OwnershipScope;
  /** Keep only runs started at least this long ago, so a run another process is still driving is left alone. Default 60 000. */
  readonly olderThanMs?: number;
  /** Rows per ledger page. Default 100. */
  readonly pageSize?: number;
  /** Clock for the age check. Default `Date.now`. */
  readonly now?: () => number;
}

export interface InterruptedRun {
  readonly sessionId: string;
  readonly runId: string;
  readonly startedAt: string;
}

export interface ContinueInterruptedOptions {
  /** Continuations at once. Default 2. */
  readonly concurrency?: number;
}

export type ContinueInterruptedOutcome =
  | (InterruptedRun & { readonly status: "continued"; readonly result: RunResult })
  | (InterruptedRun & { readonly status: "skipped"; readonly reason: "nothing_to_continue" | "session_not_found" })
  | (InterruptedRun & { readonly status: "failed"; readonly error: unknown });

const OWNERSHIP_KEYS = ["tenantId", "accountId", "userId"] as const;

function scopeOf(ownership: OwnershipScope): OwnershipScope {
  const scope: Record<string, string> = {};
  for (const key of OWNERSHIP_KEYS) {
    const value = ownership[key];
    if (value !== undefined) scope[key] = value;
  }
  return scope;
}

function inScope(record: RunRecord, scope: OwnershipScope): boolean {
  return OWNERSHIP_KEYS.every((key) => record[key] === scope[key]);
}

/**
 * Runs the ledger still records as `running` and that started at least `olderThanMs` ago: the
 * process driving them died. One entry per session (its newest run). A run that failed, was aborted,
 * or suspended has a terminal ledger record and is never returned.
 */
export async function findInterruptedRuns(runs: RunListing, options: FindInterruptedRunsOptions): Promise<InterruptedRun[]> {
  if (typeof runs?.queryRuns !== "function") throw new HeadlessError("ledger_query_unsupported");
  if (options?.ownership === undefined || options.ownership === null || typeof options.ownership !== "object") {
    throw new HeadlessError("invalid_ownership");
  }
  const olderThanMs = options.olderThanMs ?? 60_000;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw new HeadlessError("invalid_limit");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new HeadlessError("invalid_limit");
  const scope = scopeOf(options.ownership);
  const cutoff = (options.now ?? Date.now)() - olderThanMs;
  const newest = new Map<string, InterruptedRun>();
  let cursor: string | undefined;
  do {
    const page = await runs.queryRuns({ status: "running", ...scope, limit: pageSize, ...(cursor === undefined ? {} : { cursor }) });
    for (const record of page.items) {
      // The store filters; this is the fail-closed second check. SQLite ignores `toStartedAt`, so age is checked here too.
      if (record.status !== "running" || record.finishedAt !== undefined || !inScope(record, scope)) continue;
      const started = Date.parse(record.startedAt);
      if (!Number.isFinite(started) || started > cutoff) continue;
      const current = newest.get(record.sessionId);
      if (current === undefined || Date.parse(current.startedAt) < started) {
        newest.set(record.sessionId, { sessionId: record.sessionId, runId: record.id, startedAt: record.startedAt });
      }
    }
    cursor = page.items.length === 0 ? undefined : page.nextCursor;
  } while (cursor !== undefined);
  return [...newest.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Opens each session on `agent` and calls `session.continue()`. A session that no longer owes a
 * model turn, or that this agent cannot see, is skipped. Any other error is collected, not thrown.
 */
export async function continueInterrupted(
  agent: Pick<Agent, "session">,
  runs: readonly InterruptedRun[],
  options: ContinueInterruptedOptions = {},
): Promise<ContinueInterruptedOutcome[]> {
  const concurrency = options.concurrency ?? DEFAULT_RECOVERY_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new HeadlessError("invalid_limit");
  const outcomes: ContinueInterruptedOutcome[] = new Array(runs.length);
  let next = 0;
  const worker = async () => {
    while (next < runs.length) {
      const index = next;
      next += 1;
      const run = runs[index] as InterruptedRun;
      try {
        const session = await agent.session({ id: run.sessionId });
        outcomes[index] = { ...run, status: "continued", result: await session.continue() };
      } catch (error) {
        if (isSessionNotFound(error)) outcomes[index] = { ...run, status: "skipped", reason: "session_not_found" };
        else if ((error as { code?: unknown } | undefined)?.code === SESSION_NOTHING_TO_CONTINUE_CODE) {
          outcomes[index] = { ...run, status: "skipped", reason: "nothing_to_continue" };
        } else outcomes[index] = { ...run, status: "failed", error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, runs.length) }, worker));
  return outcomes;
}
