import type { PersistencePage } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import type { EvaluationQuery, EvaluationRecord, EvaluationStore } from "./types.js";
import { normalizePageLimit, ownershipMatches, statusMatches } from "./util.js";

/** In-memory evaluation store for hosts that do not need a database. */
export function createMemoryEvaluationStore(
  initial: readonly EvaluationRecord[] = [],
): EvaluationStore {
  const records: EvaluationRecord[] = [...initial];

  return {
    async append(record) {
      if (!record.id) throw new EvalError("evaluation record id is required", "ERR_PRISM_EVAL_STORE");
      if (records.some((existing) => existing.id === record.id)) {
        throw new EvalError(`duplicate evaluation id: ${record.id}`, "ERR_PRISM_EVAL_STORE");
      }
      records.push(record);
    },

    async query(query: EvaluationQuery = {}): Promise<PersistencePage<EvaluationRecord>> {
      query.signal?.throwIfAborted();
      const filtered = records.filter((record) => {
        if (!ownershipMatches(query, record)) return false;
        if (query.id !== undefined && record.id !== query.id) return false;
        if (query.scorerId !== undefined && record.scorerId !== query.scorerId) return false;
        if (query.sessionId !== undefined && record.sessionId !== query.sessionId) return false;
        if (query.runId !== undefined && record.runId !== query.runId) return false;
        if (query.experimentId !== undefined && record.experimentId !== query.experimentId) return false;
        if (query.datasetId !== undefined && record.datasetId !== query.datasetId) return false;
        if (query.itemId !== undefined && record.itemId !== query.itemId) return false;
        if (!statusMatches(query.status, record.status)) return false;
        return true;
      });

      const order = query.order === "desc" ? "desc" : "asc";
      const sorted = [...filtered].sort((a, b) => {
        const byTime = a.createdAt.localeCompare(b.createdAt);
        if (byTime !== 0) return order === "asc" ? byTime : -byTime;
        return order === "asc" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
      });

      let start = 0;
      if (query.cursor) {
        const cursorIndex = sorted.findIndex((record) => record.id === query.cursor);
        if (cursorIndex < 0) throw new EvalError(`unknown evaluation cursor: ${query.cursor}`, "ERR_PRISM_EVAL_STORE");
        start = cursorIndex + 1;
      }

      const limit = normalizePageLimit(query.limit);
      const items = sorted.slice(start, start + limit);
      const next = sorted[start + limit];
      return {
        items,
        nextCursor: next?.id,
        total: sorted.length,
      };
    },
  };
}
