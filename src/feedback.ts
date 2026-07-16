import type {
  AppendRunFeedbackInput,
  DeleteRunFeedbackInput,
  OwnershipScope,
  PersistencePage,
  RunFeedbackQuery,
  RunFeedbackRecord,
  RunFeedbackStore,
} from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";

export const DEFAULT_MAX_FEEDBACK_COMMENT_BYTES = 4096;
export const HARD_MAX_FEEDBACK_COMMENT_BYTES = 16384;
export const DEFAULT_MAX_FEEDBACK_TAGS = 16;
export const HARD_MAX_FEEDBACK_TAGS = 64;
export const DEFAULT_MAX_FEEDBACK_LINKS = 16;
export const HARD_MAX_FEEDBACK_LINKS = 64;
export const DEFAULT_MAX_FEEDBACK_METADATA_BYTES = 16384;
export const HARD_MAX_FEEDBACK_METADATA_BYTES = 65536;
export const DEFAULT_FEEDBACK_PAGE_SIZE = 100;
export const HARD_FEEDBACK_PAGE_SIZE = 500;
export const MAX_FEEDBACK_TAG_LENGTH = 64;
export const MAX_FEEDBACK_ID_LENGTH = 128;

export class RunFeedbackError extends Error {
  readonly code: string;
  constructor(message: string, code = "ERR_PRISM_RUN_FEEDBACK") {
    super(message);
    this.name = "RunFeedbackError";
    this.code = code;
  }
}

export interface RunFeedbackRun extends OwnershipScope {
  readonly runId: string;
  readonly sessionId: string;
  readonly traceId?: string;
}

export type RunFeedbackRunResolver = (
  input: Readonly<{ runId: string; ownership: OwnershipScope; signal?: AbortSignal }>,
) => RunFeedbackRun | false | undefined | Promise<RunFeedbackRun | false | undefined>;

export interface RunFeedbackLimits {
  readonly maxCommentBytes?: number;
  readonly maxTags?: number;
  readonly maxLinks?: number;
  readonly maxMetadataBytes?: number;
  readonly maxPageSize?: number;
}

export interface PrepareRunFeedbackOptions extends RunFeedbackLimits {
  readonly resolveRun: RunFeedbackRunResolver;
  readonly redactor?: SecretRedactor;
}

export interface MemoryRunFeedbackStoreOptions extends PrepareRunFeedbackOptions {
  readonly initial?: readonly RunFeedbackRecord[];
}

/** Validate, ownership-check, redact, bound, and freeze one feedback record. */
export async function prepareRunFeedback(
  input: AppendRunFeedbackInput,
  options: PrepareRunFeedbackOptions,
): Promise<RunFeedbackRecord> {
  input.signal?.throwIfAborted();
  const ownership = requireOwnership(input);
  const id = requireId(input.id, "feedback id");
  const runId = requireId(input.runId, "runId");
  const run = await options.resolveRun({ runId, ownership, signal: input.signal });
  input.signal?.throwIfAborted();
  if (!run || run.runId !== runId || !sameOwnership(ownership, run)) {
    throw new RunFeedbackError("Run not found", "ERR_PRISM_RUN_FEEDBACK_RUN_NOT_FOUND");
  }
  if (input.sessionId !== undefined && input.sessionId !== run.sessionId) {
    throw new RunFeedbackError("Run not found", "ERR_PRISM_RUN_FEEDBACK_RUN_NOT_FOUND");
  }
  if (input.traceId !== undefined && run.traceId !== undefined && input.traceId !== run.traceId) {
    throw new RunFeedbackError("Run not found", "ERR_PRISM_RUN_FEEDBACK_RUN_NOT_FOUND");
  }
  if (input.comment !== undefined && !input.comment.trim()) {
    throw new RunFeedbackError("comment must not be empty", "ERR_PRISM_RUN_FEEDBACK_VALIDATION");
  }
  if (input.rating !== undefined && (!Number.isFinite(input.rating) || input.rating < -1 || input.rating > 1)) {
    throw new RunFeedbackError("rating must be a finite number in [-1, 1]", "ERR_PRISM_RUN_FEEDBACK_BOUNDS");
  }
  const maxCommentBytes = boundedLimit(options.maxCommentBytes, DEFAULT_MAX_FEEDBACK_COMMENT_BYTES, HARD_MAX_FEEDBACK_COMMENT_BYTES, "maxCommentBytes");
  const maxTags = boundedLimit(options.maxTags, DEFAULT_MAX_FEEDBACK_TAGS, HARD_MAX_FEEDBACK_TAGS, "maxTags");
  const maxLinks = boundedLimit(options.maxLinks, DEFAULT_MAX_FEEDBACK_LINKS, HARD_MAX_FEEDBACK_LINKS, "maxLinks");
  const maxMetadataBytes = boundedLimit(options.maxMetadataBytes, DEFAULT_MAX_FEEDBACK_METADATA_BYTES, HARD_MAX_FEEDBACK_METADATA_BYTES, "maxMetadataBytes");
  const tags = normalizeList(input.tags, maxTags, MAX_FEEDBACK_TAG_LENGTH, "tag");
  const scorerIds = normalizeList(input.scorerIds, maxLinks, MAX_FEEDBACK_ID_LENGTH, "scorer id", true);
  const evaluationIds = normalizeList(input.evaluationIds, maxLinks, MAX_FEEDBACK_ID_LENGTH, "evaluation id", true);
  if (input.rating === undefined && input.comment === undefined && tags.length === 0 && scorerIds.length === 0 && evaluationIds.length === 0) {
    throw new RunFeedbackError("feedback requires rating, comment, tag, scorer, or evaluation", "ERR_PRISM_RUN_FEEDBACK_EMPTY");
  }
  const redact = <T>(value: T): T => options.redactor ? options.redactor.redact(value) : value;
  const comment = input.comment === undefined ? undefined : redact(input.comment);
  const safeTags = Object.freeze(normalizeList(redact(tags), maxTags, MAX_FEEDBACK_TAG_LENGTH, "tag"));
  const metadata = input.metadata === undefined ? undefined : redact(input.metadata);
  assertBytes(comment, maxCommentBytes, "comment");
  assertBytes(metadata, maxMetadataBytes, "metadata");
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new RunFeedbackError("createdAt must be an ISO timestamp", "ERR_PRISM_RUN_FEEDBACK_VALIDATION");
  return Object.freeze({
    id,
    runId,
    sessionId: run.sessionId,
    traceId: input.traceId ?? run.traceId,
    rating: input.rating,
    comment,
    tags: safeTags,
    scorerIds: Object.freeze(scorerIds),
    evaluationIds: Object.freeze(evaluationIds),
    createdAt,
    createdBy: input.createdBy === undefined ? undefined : requireId(input.createdBy, "createdBy"),
    metadata: metadata === undefined ? undefined : cloneFrozenJsonObject(metadata),
    ...ownership,
  });
}

/** In-memory implementation with the same validation/ownership semantics as durable adapters. */
export function createMemoryRunFeedbackStore(options: MemoryRunFeedbackStoreOptions): RunFeedbackStore {
  const records = new Map<string, RunFeedbackRecord>();
  for (const record of options.initial ?? []) records.set(record.id, freezeRecord(record));
  const maxPageSize = boundedLimit(options.maxPageSize, DEFAULT_FEEDBACK_PAGE_SIZE, HARD_FEEDBACK_PAGE_SIZE, "maxPageSize");
  return {
    async append(input) {
      if (records.has(input.id)) throw new RunFeedbackError("Duplicate feedback id", "ERR_PRISM_RUN_FEEDBACK_DUPLICATE");
      const record = await prepareRunFeedback(input, options);
      records.set(record.id, record);
      return record;
    },
    async query(query) {
      query.signal?.throwIfAborted();
      const ownership = requireOwnership(query);
      const limit = pageLimit(query.limit, maxPageSize);
      const order = query.order === "desc" ? -1 : 1;
      const sorted = [...records.values()]
        .filter((record) => sameOwnership(ownership, record) && matchesQuery(record, query))
        .sort((a, b) => order * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      const start = query.cursor ? sorted.findIndex((record) => record.id === query.cursor) + 1 : 0;
      if (query.cursor && start === 0) throw new RunFeedbackError("Unknown feedback cursor", "ERR_PRISM_RUN_FEEDBACK_CURSOR");
      const items = sorted.slice(start, start + limit);
      return { items, nextCursor: start + items.length < sorted.length ? items.at(-1)?.id : undefined, total: sorted.length };
    },
    async delete(input: DeleteRunFeedbackInput) {
      input.signal?.throwIfAborted();
      const ownership = requireOwnership(input);
      const current = records.get(input.id);
      if (!current || !sameOwnership(ownership, current)) return false;
      return records.delete(input.id);
    },
  };
}

export function requireRunFeedbackOwnership(input: OwnershipScope): Required<Pick<OwnershipScope, "tenantId">> & OwnershipScope {
  return requireOwnership(input);
}

export function runFeedbackPageLimit(limit: number | undefined, maximum = HARD_FEEDBACK_PAGE_SIZE): number {
  return pageLimit(limit, maximum);
}

function requireOwnership(input: OwnershipScope): Required<Pick<OwnershipScope, "tenantId">> & OwnershipScope {
  if (!input.tenantId?.trim()
    || (input.accountId !== undefined && !input.accountId.trim())
    || (input.userId !== undefined && !input.userId.trim())
    || (!input.accountId && !input.userId)) {
    throw new RunFeedbackError("tenantId and non-empty accountId or userId are required", "ERR_PRISM_RUN_FEEDBACK_OWNERSHIP");
  }
  return { tenantId: input.tenantId, accountId: input.accountId, userId: input.userId };
}

function sameOwnership(expected: OwnershipScope, actual: OwnershipScope): boolean {
  return expected.tenantId === actual.tenantId
    && expected.accountId === actual.accountId
    && expected.userId === actual.userId;
}

function requireId(value: string, label: string): string {
  if (!value || value.length > MAX_FEEDBACK_ID_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new RunFeedbackError(`${label} is invalid`, "ERR_PRISM_RUN_FEEDBACK_VALIDATION");
  }
  return value;
}

function normalizeList(values: readonly string[] | undefined, maximum: number, maxLength: number, label: string, ids = false): string[] {
  if (!values) return [];
  if (values.length > maximum) throw new RunFeedbackError(`Too many ${label}s`, "ERR_PRISM_RUN_FEEDBACK_BOUNDS");
  const result = values.map((value) => {
    if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\r\n]/.test(value)) {
      throw new RunFeedbackError(`${label} is invalid`, "ERR_PRISM_RUN_FEEDBACK_VALIDATION");
    }
    return ids ? requireId(value, label) : value;
  });
  if (new Set(result).size !== result.length) throw new RunFeedbackError(`Duplicate ${label}`, "ERR_PRISM_RUN_FEEDBACK_VALIDATION");
  return result;
}

function boundedLimit(value: number | undefined, fallback: number, hard: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hard) {
    throw new RunFeedbackError(`${label} must be an integer in [1, ${hard}]`, "ERR_PRISM_RUN_FEEDBACK_BOUNDS");
  }
  return resolved;
}

function pageLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) return Math.min(DEFAULT_FEEDBACK_PAGE_SIZE, maximum);
  if (!Number.isSafeInteger(value) || value < 1) throw new RunFeedbackError("limit must be a positive integer", "ERR_PRISM_RUN_FEEDBACK_BOUNDS");
  return Math.min(value, maximum);
}

function assertBytes(value: unknown, maximum: number, label: string): void {
  if (value === undefined) return;
  let encoded: string;
  try { encoded = typeof value === "string" ? value : JSON.stringify(value); }
  catch { throw new RunFeedbackError(`${label} must be JSON serializable`, "ERR_PRISM_RUN_FEEDBACK_VALIDATION"); }
  if (new TextEncoder().encode(encoded).byteLength > maximum) {
    throw new RunFeedbackError(`${label} exceeds ${maximum} bytes`, "ERR_PRISM_RUN_FEEDBACK_BOUNDS");
  }
}

function matchesQuery(record: RunFeedbackRecord, query: RunFeedbackQuery): boolean {
  if (query.runId !== undefined && record.runId !== query.runId) return false;
  if (query.sessionId !== undefined && record.sessionId !== query.sessionId) return false;
  if (query.traceId !== undefined && record.traceId !== query.traceId) return false;
  if (query.rating !== undefined && record.rating !== query.rating) return false;
  if (query.scorerId !== undefined && !record.scorerIds.includes(query.scorerId)) return false;
  if (query.evaluationId !== undefined && !record.evaluationIds.includes(query.evaluationId)) return false;
  if (query.tag !== undefined && !record.tags.includes(query.tag)) return false;
  if (query.fromCreatedAt !== undefined && record.createdAt < query.fromCreatedAt) return false;
  if (query.toCreatedAt !== undefined && record.createdAt > query.toCreatedAt) return false;
  return true;
}

function freezeRecord(record: RunFeedbackRecord): RunFeedbackRecord {
  return Object.freeze({
    ...record,
    tags: Object.freeze([...record.tags]),
    scorerIds: Object.freeze([...record.scorerIds]),
    evaluationIds: Object.freeze([...record.evaluationIds]),
    metadata: record.metadata ? cloneFrozenJsonObject(record.metadata) : undefined,
  });
}

function cloneFrozenJsonObject(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const cloned: unknown = JSON.parse(JSON.stringify(value));
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) throw new RunFeedbackError("metadata must be a JSON object");
  return deepFreeze(cloned as Record<string, unknown>);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
