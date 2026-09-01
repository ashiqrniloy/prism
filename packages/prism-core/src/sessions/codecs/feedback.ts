import type { RunFeedbackRecord } from "@arnilo/prism";
import { deepFreeze, parseStringArray } from "./util.js";

export function rowToRunFeedbackRecord(row: Record<string, unknown>): RunFeedbackRecord {
  return Object.freeze({
    id: String(row.id),
    runId: String(row.run_id),
    sessionId: String(row.session_id),
    traceId: row.trace_id === null ? undefined : String(row.trace_id),
    rating: row.rating === null ? undefined : Number(row.rating),
    comment: row.comment === null ? undefined : String(row.comment),
    tags: Object.freeze(parseStringArray(row.tags)),
    scorerIds: Object.freeze(parseStringArray(row.scorer_ids)),
    evaluationIds: Object.freeze(parseStringArray(row.evaluation_ids)),
    createdAt: String(row.created_at),
    createdBy: row.created_by === null ? undefined : String(row.created_by),
    tenantId: String(row.tenant_id),
    accountId: row.account_id === null ? undefined : String(row.account_id),
    userId: row.user_id === null ? undefined : String(row.user_id),
    metadata: row.metadata === null ? undefined : deepFreeze(JSON.parse(String(row.metadata)) as Readonly<Record<string, unknown>>),
  });
}
