import type {
  AgentEventRecord,
  ProductionPersistenceStore,
  RunRecord,
  ToolCallRecord,
  UsageRecord,
} from "@arnilo/prism";
import { EvalError } from "./errors.js";
import {
  DEFAULT_TRACE_MAX_BYTES,
  DEFAULT_TRACE_PAGE_SIZE,
  DEFAULT_TRACE_PAGES,
  HARD_TRACE_MAX_BYTES,
  HARD_TRACE_PAGE_SIZE,
  HARD_TRACE_PAGES,
} from "./limits.js";
import type { EvaluationTrace, TraceResolver, TraceResolverInput } from "./types.js";
import { exactOwnershipMatches, resolveRedactor } from "./util.js";

function limit(value: number | undefined, fallback: number, hard: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > hard) {
    throw new EvalError(`${name} must be an integer in [1, ${hard}]`, "ERR_PRISM_EVAL_TRACE_BOUNDS");
  }
  return selected;
}

async function pages<T>(
  query: (cursor?: string) => Promise<{ readonly items: readonly T[]; readonly nextCursor?: string }>,
  maxPages: number,
): Promise<T[]> {
  const output: T[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const result = await query(cursor);
    output.push(...result.items);
    if (!result.nextCursor) return output;
    if (seen.has(result.nextCursor)) throw new EvalError("trace cursor repeated", "ERR_PRISM_EVAL_TRACE_CURSOR");
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new EvalError("trace page limit exceeded", "ERR_PRISM_EVAL_TRACE_BOUNDS");
}

/** Resolve one owner/session/run-scoped, redacted, bounded persistence trace. */
export function createPersistenceTraceResolver(store: ProductionPersistenceStore): TraceResolver {
  return async (input: TraceResolverInput): Promise<EvaluationTrace> => {
    input.signal?.throwIfAborted();
    const pageSize = limit(input.limits?.pageSize, DEFAULT_TRACE_PAGE_SIZE, HARD_TRACE_PAGE_SIZE, "pageSize");
    const maxPages = limit(input.limits?.maxPages, DEFAULT_TRACE_PAGES, HARD_TRACE_PAGES, "maxPages");
    const maxBytes = limit(input.limits?.maxBytes, DEFAULT_TRACE_MAX_BYTES, HARD_TRACE_MAX_BYTES, "maxBytes");
    const ownership = { tenantId: input.tenantId, accountId: input.accountId, userId: input.userId };
    const query = { sessionId: input.sessionId, runId: input.runId, order: "asc" as const, limit: pageSize, ...ownership };

    const [runs, events, toolCalls, usage] = await Promise.all([
      pages<RunRecord>((cursor) => store.queryRuns({ sessionId: input.sessionId, cursor, order: "asc", limit: pageSize, ...ownership }), maxPages),
      pages<AgentEventRecord>((cursor) => store.queryEvents({ ...query, cursor }), maxPages),
      pages<ToolCallRecord>((cursor) => store.queryToolCalls({ ...query, cursor }), maxPages),
      pages<UsageRecord>((cursor) => store.queryUsage({ ...query, cursor }), maxPages),
    ]);
    const run = runs.find((candidate) => candidate.id === input.runId);
    if (!run) throw new EvalError("evaluation trace run not found", "ERR_PRISM_EVAL_TRACE_NOT_FOUND");
    const all = [run, ...events, ...toolCalls, ...usage];
    if (run.sessionId !== input.sessionId || all.some((record) => !exactOwnershipMatches(ownership, record))) {
      throw new EvalError("evaluation trace ownership mismatch", "ERR_PRISM_EVAL_TRACE_OWNERSHIP");
    }
    if ([...events, ...toolCalls, ...usage].some((record) => record.sessionId !== input.sessionId || record.runId !== input.runId)) {
      throw new EvalError("evaluation trace identity mismatch", "ERR_PRISM_EVAL_TRACE_IDENTITY");
    }

    const redactor = resolveRedactor(input.redactor, input.secrets);
    const trace = redactor
      ? redactor.redact({ run, events, toolCalls, usage })
      : { run, events, toolCalls, usage };
    if (Buffer.byteLength(JSON.stringify(trace)) > maxBytes) {
      throw new EvalError("evaluation trace byte limit exceeded", "ERR_PRISM_EVAL_TRACE_BOUNDS");
    }
    input.signal?.throwIfAborted();
    return trace;
  };
}
