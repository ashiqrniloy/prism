import type {
  EvaluationQuery,
  EvaluationRecord,
  EvaluationStore,
  ExperimentReportQuery,
  ExperimentReportRecord,
  ExperimentReportStore,
  OwnershipScope,
  PersistencePage,
  PersistenceQuery,
  SecretRedactor,
} from "@arnilo/prism";
import { ownershipScopeMatches } from "./ownership.js";
import { deepFreeze } from "./util.js";

export const HARD_EVALUATION_RECORD_BYTES = 1024 * 1024;
export const HARD_EXPERIMENT_REPORT_BYTES = 1024 * 1024;

export class EvaluationStoreError extends Error {
  constructor(
    message: string,
    readonly code = "ERR_PRISM_EVAL_STORE",
  ) {
    super(message);
    this.name = "EvaluationStoreError";
  }
}

export interface EvaluationCodecOptions {
  readonly redactor?: SecretRedactor;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new EvaluationStoreError(message);
}

function id(value: unknown): void {
  check(typeof value === "string" && value.trim().length > 0, "Nonempty identifier required");
}

function object(value: unknown): void {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Expected a JSON object");
}

function unit(value: unknown): void {
  check(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, "Score must be finite in [0, 1]");
}

function header(record: { id: string; createdAt: string } & OwnershipScope): void {
  id(record.id);
  check(typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt)), "Invalid createdAt");
  for (const value of [record.tenantId, record.accountId, record.userId]) if (value !== undefined) id(value);
}

function snapshot<T>(record: T, cap: number, code: string): T {
  let json: string;
  try {
    json = JSON.stringify(record, (_key, value) => {
      check(typeof value !== "number" || Number.isFinite(value), "Nonfinite JSON number");
      return value;
    });
  } catch (error) {
    if (error instanceof EvaluationStoreError) throw error;
    throw new EvaluationStoreError("Record must be JSON serializable", code);
  }
  if (new TextEncoder().encode(json).byteLength > cap) throw new EvaluationStoreError("Record exceeds byte cap", code);
  return deepFreeze(JSON.parse(json) as T);
}

/** Validate, redact content fields, detach, and freeze an evaluation before storage. */
export function prepareEvaluationRecord(record: EvaluationRecord, options: EvaluationCodecOptions = {}): EvaluationRecord {
  header(record);
  id(record.scorerId);
  check(["scored", "skipped", "failed"].includes(record.status), "Invalid evaluation status");
  check(typeof record.sampled === "boolean", "Invalid sampled flag");
  if (record.status === "scored" || record.score !== undefined) unit(record.score);
  for (const key of ["sessionId", "runId", "traceId", "datasetId", "itemId", "experimentId", "stepId", "nodeId"] as const) {
    if (record[key] !== undefined) id(record[key]);
  }
  check(record.reason === undefined || typeof record.reason === "string", "Invalid reason");
  if (record.metadata !== undefined) object(record.metadata);
  const content = { reason: record.reason, error: record.error, metadata: record.metadata };
  return snapshot(
    { ...record, ...(options.redactor?.redact(content) ?? content) },
    HARD_EVALUATION_RECORD_BYTES,
    "ERR_PRISM_EVAL_STORE_BOUNDS",
  );
}

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as Pick<T, K>;
}

function usage(value: NonNullable<ExperimentReportRecord["aggregate"]["cost"]>) {
  const keys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "cost",
    "currency",
    "estimated",
  ] as const;
  return {
    ...pick(value, keys),
    costComplete: value.costComplete,
    meanPerItem: pick(value.meanPerItem, [...keys, "durationMs"]),
    ...(value.durationMs === undefined ? {} : { durationMs: pick(value.durationMs, ["p50", "p95"]) }),
  };
}

function scorerStats(scorers: ExperimentReportRecord["aggregate"]["scorers"]) {
  object(scorers);
  for (const [key, stats] of Object.entries(scorers)) {
    id(key);
    unit(stats.mean);
    unit(stats.passRate);
    check(
      Number.isSafeInteger(stats.items) && stats.items >= 0 && Number.isSafeInteger(stats.records) && stats.records >= 0,
      "Invalid scorer counts",
    );
    check(["single_item", "wilson", "cluster_bootstrap"].includes(stats.method), "Invalid statistic method");
  }
  return Object.fromEntries(
    Object.entries(scorers).map(([key, stats]) => [
      key,
      pick(stats, ["items", "records", "mean", "passRate", "passAtK", "passHatK", "passKCounts", "se", "ci95", "judgeAgreement", "method"]),
    ]),
  );
}

/** Allow only numeric statistics (and the method/currency labels), never free-form text. */
function statistics(value: unknown, key = ""): void {
  if (typeof value === "number") {
    check(Number.isFinite(value), "Nonfinite aggregate statistic");
    return;
  }
  if (typeof value === "boolean" || value === undefined) return;
  if (typeof value === "string") {
    check(
      key === "method"
        ? ["single_item", "wilson", "cluster_bootstrap"].includes(value)
        : key === "currency" && value.length > 0 && value.length <= 64 && !/[\r\n]/.test(value),
      "Invalid aggregate text",
    );
    return;
  }
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Invalid aggregate statistic");
  for (const [child, item] of Object.entries(value)) statistics(item, child);
}

/** Shared bounded summary codec for memory and durable adapters. */
export function prepareExperimentReportRecord(
  record: ExperimentReportRecord,
  options: EvaluationCodecOptions = {},
): ExperimentReportRecord {
  header(record);
  id(record.datasetId);
  for (const value of [record.datasetVersion, record.datasetContentHash]) if (value !== undefined) id(value);
  object(record.itemMeans);
  if (record.metadata !== undefined) object(record.metadata);
  for (const [item, means] of Object.entries(record.itemMeans)) {
    id(item);
    object(means);
    for (const [scorer, score] of Object.entries(means)) {
      id(scorer);
      unit(score);
    }
  }
  const source = record.aggregate;
  for (const count of [source.itemCount, source.scoredCount, source.skippedCount, source.failedCount]) {
    check(Number.isSafeInteger(count) && count >= 0, "Invalid aggregate count");
  }
  const aggregate = {
    ...pick(source, ["itemCount", "scoredCount", "skippedCount", "failedCount", "macroMean", "invariantsPassed"]),
    scorers: scorerStats(source.scorers),
    ...(source.cost === undefined ? {} : { cost: usage(source.cost) }),
    ...(source.byTag === undefined
      ? {}
      : { byTag: Object.fromEntries(Object.entries(source.byTag).map(([tag, group]) => [tag, { scorers: scorerStats(group.scorers) }])) }),
  };
  statistics(aggregate);
  const manifest =
    record.manifest === undefined
      ? undefined
      : pick(record.manifest, [
          "promptId",
          "promptVersion",
          "toolFingerprint",
          "skillsRevision",
          "model",
          "policyRevision",
          "runtimeRevision",
          "datasetVersion",
          "datasetContentHash",
        ]);
  if (manifest) {
    id(manifest.runtimeRevision);
    id(manifest.datasetVersion);
    for (const value of Object.values(manifest)) check(typeof value === "string", "Invalid manifest value");
  }
  return snapshot(
    {
      ...pick(record, ["id", "tenantId", "accountId", "userId", "datasetId", "datasetVersion", "datasetContentHash", "createdAt"]),
      aggregate,
      manifest,
      itemMeans: record.itemMeans,
      ...(record.metadata === undefined ? {} : { metadata: options.redactor?.redact(record.metadata) ?? record.metadata }),
    },
    HARD_EXPERIMENT_REPORT_BYTES,
    "ERR_PRISM_EVAL_REPORT_BOUNDS",
  );
}

function page<T extends { id: string; createdAt: string }>(records: readonly T[], query: PersistenceQuery): PersistencePage<T> {
  const limit = query.limit ?? 100;
  check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000, "Page limit must be in [1, 1000]");
  check(query.order === undefined || query.order === "asc" || query.order === "desc", "Invalid order");
  const direction = query.order === "desc" ? -1 : 1;
  const sorted = [...records].sort((a, b) => direction * (Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)));
  const start = query.cursor === undefined ? 0 : sorted.findIndex((record) => record.id === query.cursor) + 1;
  check(query.cursor === undefined || start > 0, "Unknown cursor");
  const items = sorted.slice(start, start + limit);
  return { items, total: sorted.length, nextCursor: start + items.length < sorted.length ? items.at(-1)?.id : undefined };
}

/** Unscoped queries see only unowned records; every supplied ownership field must match exactly. */
export function createMemoryEvaluationStore(
  initial: readonly EvaluationRecord[] = [],
  options: EvaluationCodecOptions = {},
): EvaluationStore {
  const records = new Map<string, EvaluationRecord>();
  const append = (record: EvaluationRecord) => {
    check(!records.has(record.id), "Duplicate evaluation id");
    records.set(record.id, prepareEvaluationRecord(record, options));
  };
  initial.forEach(append);
  return {
    async append(record) {
      append(record);
    },
    async query(query: EvaluationQuery = {}) {
      query.signal?.throwIfAborted();
      return page(
        [...records.values()].filter(
          (record) =>
            ownershipScopeMatches(query, record) &&
            (["id", "scorerId", "sessionId", "runId", "experimentId", "datasetId", "itemId"] as const).every(
              (key) => query[key] === undefined || query[key] === record[key],
            ) &&
            (query.status === undefined ||
              (Array.isArray(query.status) ? query.status.includes(record.status) : query.status === record.status)),
        ),
        query,
      );
    },
  };
}

export function createMemoryExperimentReportStore(
  initial: readonly ExperimentReportRecord[] = [],
  options: EvaluationCodecOptions = {},
): ExperimentReportStore {
  const records = new Map<string, ExperimentReportRecord>();
  const append = (record: ExperimentReportRecord) => {
    check(!records.has(record.id), "Duplicate experiment id");
    records.set(record.id, prepareExperimentReportRecord(record, options));
  };
  initial.forEach(append);
  const query = async (query: ExperimentReportQuery = {}) => {
    query.signal?.throwIfAborted();
    return page(
      [...records.values()].filter(
        (record) =>
          ownershipScopeMatches(query, record) &&
          (["id", "datasetId", "datasetVersion", "datasetContentHash"] as const).every(
            (key) => query[key] === undefined || query[key] === record[key],
          ) &&
          (query.manifestMatch === undefined ||
            Object.entries(query.manifestMatch).every(
              ([key, value]) => value !== undefined && record.manifest?.[key as keyof typeof record.manifest] === value,
            )),
      ),
      query,
    );
  };
  return {
    async append(record) {
      append(record);
    },
    query,
    async latest(input) {
      id(input.datasetId);
      return (await query({ ...input, order: "desc", limit: 1, cursor: undefined })).items[0];
    },
  };
}
