import type { ErrorInfo, PersistencePage } from "@arnilo/prism";
import {
  EvalError,
  HARD_EVALUATION_PAGE_CAP,
  type EvaluationQuery,
  type EvaluationRecord,
  type EvaluationStatus,
  type EvaluationStore,
} from "@arnilo/prism-evals";
import type { Pool } from "pg";
import { decodeBoundedJson, encodeBoundedJson } from "./codecs.js";
import { qualifyTable } from "./identifiers.js";
import {
  asTimestamp,
  boundsError,
  decodeRecordCursor,
  deepFreeze,
  encodeRecordCursor,
  isSqlState,
  optionalText,
  ownerParams,
  requireStoreOwner,
  requiredText,
  storeError,
  type StoreOwner,
} from "./records.js";

const MAX_RECORD_BYTES = 64 * 1024;
const MAX_REASON_BYTES = 8 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_METADATA_BYTES = 32 * 1024;
const MAX_FIELD_BYTES = 512;
const STATUSES = new Set<EvaluationStatus>(["scored", "skipped", "failed"]);
const RECORD_KEYS = new Set([
  "id",
  "scorerId",
  "status",
  "score",
  "reason",
  "sampled",
  "sessionId",
  "runId",
  "traceId",
  "datasetId",
  "itemId",
  "experimentId",
  "error",
  "createdAt",
  "metadata",
  "tenantId",
  "accountId",
  "userId",
]);

/** PostgreSQL implementation of the bounded, owner-scoped evaluation record store. */
export function createPostgresEvaluationStore(pool: Pool, schema: string): EvaluationStore {
  const table = qualifyTable(schema, "prism_evaluations");

  return {
    async append(input) {
      const record = prepareEvaluationRecord(input);
      try {
        await pool.query(
          `INSERT INTO ${table} (
            id, tenant_id, account_key, user_key, scorer_id, status, score, reason, sampled,
            session_id, run_id, trace_id, dataset_id, item_id, experiment_id, error, created_at, metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18::jsonb
          )`,
          [
            record.id,
            record.tenantId,
            record.accountId ?? "",
            record.userId ?? "",
            record.scorerId,
            record.status,
            record.score ?? null,
            record.reason ?? null,
            record.sampled,
            record.sessionId ?? null,
            record.runId ?? null,
            record.traceId ?? null,
            record.datasetId ?? null,
            record.itemId ?? null,
            record.experimentId ?? null,
            record.error === undefined ? null : encodeBoundedJson(record.error, MAX_ERROR_BYTES, "evaluation error"),
            record.createdAt,
            record.metadata === undefined ? null : encodeBoundedJson(record.metadata, MAX_METADATA_BYTES, "evaluation metadata"),
          ],
        );
      } catch (error) {
        if (isSqlState(error, "23505")) throw new EvalError(`duplicate evaluation id: ${record.id}`, "ERR_PRISM_EVAL_STORE");
        throw storeError(error);
      }
    },

    async query(query: EvaluationQuery = {}) {
      query.signal?.throwIfAborted();
      const owner = requireStoreOwner(query);
      const limit = resolvePageLimit(query.limit);
      const order = query.order === "desc" ? "desc" : "asc";
      const filters = ["tenant_id = $1", "account_key = $2", "user_key = $3"];
      const params: unknown[] = [...ownerParams(owner)];
      addFilter(filters, params, "id", query.id);
      addFilter(filters, params, "scorer_id", query.scorerId);
      addFilter(filters, params, "session_id", query.sessionId);
      addFilter(filters, params, "run_id", query.runId);
      addFilter(filters, params, "experiment_id", query.experimentId);
      addFilter(filters, params, "dataset_id", query.datasetId);
      addFilter(filters, params, "item_id", query.itemId);
      addStatuses(filters, params, query.status);
      if (query.cursor) {
        const cursor = decodeRecordCursor(query.cursor, owner, order);
        const index = params.length + 1;
        filters.push(
          order === "asc"
            ? `(created_at > $${index} OR (created_at = $${index + 1} AND id > $${index + 2}))`
            : `(created_at < $${index} OR (created_at = $${index + 1} AND id < $${index + 2}))`,
        );
        params.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      params.push(limit + 1);
      try {
        const result = await pool.query(
          `SELECT id, tenant_id, account_key, user_key, scorer_id, status, score, reason, sampled,
                  session_id, run_id, trace_id, dataset_id, item_id, experiment_id,
                  error::text AS error, created_at, metadata::text AS metadata
           FROM ${table}
           WHERE ${filters.join(" AND ")}
           ORDER BY created_at ${order.toUpperCase()}, id ${order.toUpperCase()}
           LIMIT $${params.length}`,
          params,
        );
        const rows = result.rows as Array<Record<string, unknown>>;
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const items = pageRows.map(rowToEvaluation);
        const last = items.at(-1);
        return {
          items,
          nextCursor: hasMore && last ? encodeRecordCursor(last.createdAt, last.id, owner, order) : undefined,
        } satisfies PersistencePage<EvaluationRecord>;
      } catch (error) {
        throw storeError(error);
      }
    },
  };
}

function prepareEvaluationRecord(input: EvaluationRecord): EvaluationRecord {
  if (!input || typeof input !== "object") boundsError("evaluation record is required");
  for (const key of Object.keys(input)) if (!RECORD_KEYS.has(key)) boundsError("evaluation record has unsupported fields");
  const owner = requireStoreOwner(input);
  const status = requiredText(input.status, "evaluation status") as EvaluationStatus;
  if (!STATUSES.has(status)) boundsError("evaluation status is invalid");
  if (typeof input.sampled !== "boolean") boundsError("evaluation sampled is invalid");
  const score = input.score;
  if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 1)) boundsError("evaluation score is invalid");
  if (status === "scored" && score === undefined) boundsError("scored evaluation requires score");
  const error = input.error === undefined ? undefined : inputErrorValue(input.error, "evaluation error");
  const metadata = input.metadata === undefined ? undefined : inputObjectValue(input.metadata, MAX_METADATA_BYTES, "evaluation metadata");
  const record: EvaluationRecord = {
    id: requiredText(input.id, "evaluation id", MAX_FIELD_BYTES),
    scorerId: requiredText(input.scorerId, "evaluation scorer", MAX_FIELD_BYTES),
    status,
    ...(score === undefined ? {} : { score }),
    ...(input.reason === undefined ? {} : { reason: requiredText(input.reason, "evaluation reason", MAX_REASON_BYTES) }),
    sampled: input.sampled,
    ...optionalFields(input),
    ...(error === undefined ? {} : { error }),
    createdAt: asTimestamp(input.createdAt, "evaluation createdAt"),
    ...(metadata === undefined ? {} : { metadata }),
    ...owner,
  };
  encodeBoundedJson(record, MAX_RECORD_BYTES, "evaluation record");
  return deepFreeze(record);
}

function optionalFields(
  input: EvaluationRecord,
): Pick<EvaluationRecord, "sessionId" | "runId" | "traceId" | "datasetId" | "itemId" | "experimentId"> {
  const entries = [
    ["sessionId", input.sessionId],
    ["runId", input.runId],
    ["traceId", input.traceId],
    ["datasetId", input.datasetId],
    ["itemId", input.itemId],
    ["experimentId", input.experimentId],
  ] as const;
  return Object.fromEntries(
    entries
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, requiredText(value, `evaluation ${key}`, MAX_FIELD_BYTES)]),
  ) as Pick<EvaluationRecord, "sessionId" | "runId" | "traceId" | "datasetId" | "itemId" | "experimentId">;
}

function resolvePageLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  if (!Number.isInteger(limit) || limit < 1) throw new EvalError("limit must be an integer >= 1", "ERR_PRISM_EVAL_BOUNDS");
  return Math.min(limit, HARD_EVALUATION_PAGE_CAP);
}

function addFilter(filters: string[], params: unknown[], column: string, value: string | undefined): void {
  if (value === undefined) return;
  params.push(requiredText(value, `evaluation ${column}`, MAX_FIELD_BYTES));
  filters.push(`${column} = $${params.length}`);
}

function addStatuses(filters: string[], params: unknown[], status: EvaluationStatus | readonly EvaluationStatus[] | undefined): void {
  if (status === undefined) return;
  const values = [...new Set(Array.isArray(status) ? status : [status])];
  if (values.length === 0 || values.length > STATUSES.size || !values.every((value) => STATUSES.has(value))) {
    boundsError("evaluation status filter is invalid");
  }
  params.push(values);
  filters.push(`status = ANY($${params.length}::text[])`);
}

function rowToEvaluation(row: Record<string, unknown>): EvaluationRecord {
  const owner: StoreOwner = {
    tenantId: requiredText(row.tenant_id, "evaluation tenant"),
    ...(row.account_key === "" ? {} : { accountId: requiredText(row.account_key, "evaluation account") }),
    ...(row.user_key === "" ? {} : { userId: requiredText(row.user_key, "evaluation user") }),
  };
  const status = requiredText(row.status, "evaluation status") as EvaluationStatus;
  if (!STATUSES.has(status)) boundsError("evaluation row status is invalid");
  const score = row.score === null ? undefined : Number(row.score);
  if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 1)) boundsError("evaluation row score is invalid");
  if (status === "scored" && score === undefined) boundsError("evaluation row score is required");
  if (typeof row.sampled !== "boolean") boundsError("evaluation row sampled is invalid");
  const error = row.error === null ? undefined : errorValue(row.error, "evaluation error");
  const metadata = row.metadata === null ? undefined : objectValue(row.metadata, MAX_METADATA_BYTES, "evaluation metadata");
  return deepFreeze({
    id: requiredText(row.id, "evaluation id", MAX_FIELD_BYTES),
    scorerId: requiredText(row.scorer_id, "evaluation scorer", MAX_FIELD_BYTES),
    status,
    ...(score === undefined ? {} : { score }),
    ...(optionalText(row.reason, "evaluation reason", MAX_REASON_BYTES) === undefined
      ? {}
      : { reason: optionalText(row.reason, "evaluation reason", MAX_REASON_BYTES) }),
    sampled: row.sampled,
    ...(optionalText(row.session_id, "evaluation session", MAX_FIELD_BYTES) === undefined
      ? {}
      : { sessionId: optionalText(row.session_id, "evaluation session", MAX_FIELD_BYTES) }),
    ...(optionalText(row.run_id, "evaluation run", MAX_FIELD_BYTES) === undefined
      ? {}
      : { runId: optionalText(row.run_id, "evaluation run", MAX_FIELD_BYTES) }),
    ...(optionalText(row.trace_id, "evaluation trace", MAX_FIELD_BYTES) === undefined
      ? {}
      : { traceId: optionalText(row.trace_id, "evaluation trace", MAX_FIELD_BYTES) }),
    ...(optionalText(row.dataset_id, "evaluation dataset", MAX_FIELD_BYTES) === undefined
      ? {}
      : { datasetId: optionalText(row.dataset_id, "evaluation dataset", MAX_FIELD_BYTES) }),
    ...(optionalText(row.item_id, "evaluation item", MAX_FIELD_BYTES) === undefined
      ? {}
      : { itemId: optionalText(row.item_id, "evaluation item", MAX_FIELD_BYTES) }),
    ...(optionalText(row.experiment_id, "evaluation experiment", MAX_FIELD_BYTES) === undefined
      ? {}
      : { experimentId: optionalText(row.experiment_id, "evaluation experiment", MAX_FIELD_BYTES) }),
    ...(error === undefined ? {} : { error }),
    createdAt: asTimestamp(row.created_at, "evaluation createdAt"),
    ...(metadata === undefined ? {} : { metadata }),
    ...owner,
  });
}

function inputErrorValue(value: unknown, label: string): ErrorInfo {
  return toErrorInfo(inputObjectValue(value, MAX_ERROR_BYTES, label), label);
}

function errorValue(value: unknown, label: string): ErrorInfo {
  return toErrorInfo(objectValue(value, MAX_ERROR_BYTES, label), label);
}

function toErrorInfo(error: Readonly<Record<string, unknown>>, label: string): ErrorInfo {
  return deepFreeze({
    ...error,
    message: requiredText(error.message, `${label} message`, MAX_ERROR_BYTES),
    ...(error.name === undefined ? {} : { name: requiredText(error.name, `${label} name`, MAX_FIELD_BYTES) }),
    ...(error.code === undefined || typeof error.code === "string" || typeof error.code === "number"
      ? {}
      : boundsError(`${label} code is invalid`)),
    ...(error.retryAfterMs === undefined || (typeof error.retryAfterMs === "number" && Number.isFinite(error.retryAfterMs))
      ? {}
      : boundsError(`${label} retryAfterMs is invalid`)),
  }) as ErrorInfo;
}

function inputObjectValue(value: unknown, maxBytes: number, label: string): Readonly<Record<string, unknown>> {
  const encoded = encodeBoundedJson(value, maxBytes, label);
  const decoded = JSON.parse(encoded) as unknown;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) boundsError(`${label} is invalid`);
  return deepFreeze(decoded as Record<string, unknown>);
}

function objectValue(value: unknown, maxBytes: number, label: string): Readonly<Record<string, unknown>> {
  const decoded = decodeBoundedJson(value, maxBytes, label);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) boundsError(`${label} is invalid`);
  return deepFreeze(decoded as Record<string, unknown>);
}
