import type { JsonObject } from "@arnilo/prism";
import { MemoryLimitError, MemoryScopeError, MemoryValidationError } from "./errors.js";
import type {
  MemoryInvalidationEvent,
  MemoryInvalidationReason,
  MemoryInvalidationRecord,
  MemoryLineage,
  MemoryRecallExplanation,
  MemoryScope,
  MemoryShareGrant,
  MemoryVectorRecord,
  VectorStore,
} from "./types.js";
import { requireNonEmptyString } from "./util.js";

export const LINEAGE_META_KEY = "_lineage";
export const LINEAGE_SCHEMA_VERSION = 1 as const;
/** Transitive derived-record walk. */
export const HARD_LINEAGE_DEPTH = 8;
/** Distinct ids marked in one walk. */
export const HARD_LINEAGE_EDGES = 256;
/** `sourceIds` on one record / share grant. */
export const HARD_LINEAGE_SOURCE_IDS = 32;
export const HARD_SHARE_SOURCE_IDS = HARD_LINEAGE_SOURCE_IDS;
/** One `invalidate` / delete slice. */
export const HARD_INVALIDATION_BATCH = 64;

const ID_MAX = 256;
const REASONS = new Set<MemoryInvalidationReason>(["corrected", "revoked", "forgotten", "legal_hold"]);

function requireId(value: unknown, label: string): string {
  const id = requireNonEmptyString(value, label);
  if (id.length > ID_MAX) throw new MemoryValidationError(`${label} exceeds ${ID_MAX} characters`);
  if (id.includes("\0")) throw new MemoryValidationError(`${label} must not contain NUL`);
  return id;
}

function uniqueIds(values: readonly unknown[], label: string, cap: number): readonly string[] {
  if (values.length > cap) throw new MemoryLimitError(`${label} exceeds hard cap ${cap}`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const id = requireId(value, label === "sourceIds" ? "sourceId" : label);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return Object.freeze(out);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize host/write lineage. Schema v1 only. */
export function assertLineage(value: unknown): MemoryLineage {
  if (!isRecord(value)) throw new MemoryValidationError("lineage must be an object");
  if (value.v !== undefined && value.v !== LINEAGE_SCHEMA_VERSION) {
    throw new MemoryValidationError(`lineage.v must be ${LINEAGE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.sourceIds)) throw new MemoryValidationError("lineage.sourceIds must be an array");
  const sourceIds = uniqueIds(value.sourceIds, "sourceIds", HARD_LINEAGE_SOURCE_IDS);
  const reason = value.reason === undefined ? undefined : requireNonEmptyString(value.reason, "lineage.reason").slice(0, ID_MAX);
  if (reason?.includes("\0")) throw new MemoryValidationError("lineage.reason must not contain NUL");
  return Object.freeze({
    v: LINEAGE_SCHEMA_VERSION,
    sourceIds,
    ...(reason ? { reason } : {}),
  });
}

type ParsedLineage = MemoryLineage | undefined | "invalid";

export function parseLineage(metadata: MemoryVectorRecord["metadata"]): ParsedLineage {
  const raw = metadata?.[LINEAGE_META_KEY];
  if (raw === undefined || raw === null) return undefined;
  try {
    return assertLineage(raw);
  } catch {
    return "invalid";
  }
}

export function stampLineage(
  metadata: MemoryVectorRecord["metadata"] | undefined,
  lineage: unknown | undefined,
): MemoryVectorRecord["metadata"] | undefined {
  if (lineage === undefined) return metadata;
  const parsed = assertLineage(lineage);
  const stamped: JsonObject = {
    ...(metadata ?? {}),
    [LINEAGE_META_KEY]: { v: parsed.v, sourceIds: [...parsed.sourceIds], ...(parsed.reason ? { reason: parsed.reason } : {}) },
  };
  return stamped;
}

export function assertInvalidationRecord(value: unknown): MemoryInvalidationRecord {
  if (!isRecord(value)) throw new MemoryValidationError("invalidation must be an object");
  const reason = value.reason;
  if (typeof reason !== "string" || !REASONS.has(reason as MemoryInvalidationReason)) {
    throw new MemoryValidationError("invalidation.reason must be corrected|revoked|forgotten|legal_hold");
  }
  const at = requireNonEmptyString(value.at, "invalidation.at");
  if (!Number.isFinite(Date.parse(at))) throw new MemoryValidationError("invalidation.at must be an ISO timestamp");
  const hold = value.hold === undefined ? reason === "legal_hold" : value.hold === true;
  if (value.hold !== undefined && typeof value.hold !== "boolean") {
    throw new MemoryValidationError("invalidation.hold must be a boolean");
  }
  return Object.freeze({
    id: requireId(value.id, "invalidation.id"),
    reason: reason as MemoryInvalidationReason,
    at,
    ...(hold ? { hold: true } : {}),
    ...(value.supersedesId !== undefined ? { supersedesId: requireId(value.supersedesId, "supersedesId") } : {}),
  });
}

export function assertInvalidationBatch(entries: readonly MemoryInvalidationRecord[]): readonly MemoryInvalidationRecord[] {
  if (entries.length > HARD_INVALIDATION_BATCH) {
    throw new MemoryLimitError(`invalidation batch exceeds hard cap ${HARD_INVALIDATION_BATCH}`);
  }
  const seen = new Set<string>();
  const out: MemoryInvalidationRecord[] = [];
  for (const entry of entries) {
    const parsed = assertInvalidationRecord(entry);
    if (seen.has(parsed.id)) throw new MemoryValidationError("duplicate id in invalidate");
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

export function indexInvalidations(entries: readonly MemoryInvalidationRecord[]): ReadonlyMap<string, MemoryInvalidationRecord> {
  const map = new Map<string, MemoryInvalidationRecord>();
  for (const entry of entries) map.set(entry.id, entry);
  return map;
}

/** Query-time exclude. Corrected sources stay; anything listing them in `_lineage.sourceIds` does not. Corrupt lineage denies. */
export function recordBlocked(
  record: Pick<MemoryVectorRecord, "id" | "metadata">,
  invalidations: ReadonlyMap<string, MemoryInvalidationRecord>,
): boolean {
  const parsed = parseLineage(record.metadata);
  if (parsed === "invalid") return true;
  const self = invalidations.get(record.id);
  if (self && self.reason !== "corrected") return true;
  for (const sourceId of parsed?.sourceIds ?? []) {
    if (sourceId === record.id) continue;
    if (invalidations.has(sourceId)) return true;
  }
  return false;
}

/**
 * Roots plus same-thread records that list a marked id in `_lineage.sourceIds`.
 * Caps fail closed (throw) rather than leave unmarked descendants injectable.
 */
export function collectInvalidationIds(records: readonly MemoryVectorRecord[], roots: readonly string[]): readonly string[] {
  const marked = new Set<string>();
  for (const root of roots) marked.add(requireId(root, "id"));
  if (marked.size > HARD_LINEAGE_EDGES) throw new MemoryLimitError(`lineage walk exceeds edge cap ${HARD_LINEAGE_EDGES}`);
  let depth = 0;
  let changed = true;
  while (changed) {
    changed = false;
    depth += 1;
    if (depth > HARD_LINEAGE_DEPTH) throw new MemoryLimitError(`lineage walk exceeds depth cap ${HARD_LINEAGE_DEPTH}`);
    for (const record of records) {
      if (marked.has(record.id)) continue;
      const parsed = parseLineage(record.metadata);
      if (parsed === undefined || parsed === "invalid") continue;
      if (parsed.sourceIds.some((id) => id !== record.id && marked.has(id))) {
        marked.add(record.id);
        changed = true;
        if (marked.size > HARD_LINEAGE_EDGES) {
          throw new MemoryLimitError(`lineage walk exceeds edge cap ${HARD_LINEAGE_EDGES}`);
        }
      }
    }
  }
  return Object.freeze([...marked]);
}

export function assertShareGrant(grant: MemoryShareGrant): MemoryShareGrant {
  const tenantId = requireId(grant.tenantId, "tenantId");
  const parentThreadId = requireId(grant.parentThreadId, "parentThreadId");
  const childThreadId = requireId(grant.childThreadId, "childThreadId");
  if (parentThreadId === childThreadId) throw new MemoryValidationError("share grant parent and child threadIds must differ");
  const sourceIds = uniqueIds(grant.sourceIds ?? [], "sourceIds", HARD_SHARE_SOURCE_IDS);
  let expiresAt: string | undefined;
  if (grant.expiresAt !== undefined) {
    expiresAt = requireNonEmptyString(grant.expiresAt, "expiresAt");
    if (!Number.isFinite(Date.parse(expiresAt))) throw new MemoryValidationError("expiresAt must be an ISO timestamp");
  }
  return Object.freeze({
    tenantId,
    parentThreadId,
    childThreadId,
    sourceIds,
    ...(expiresAt ? { expiresAt } : {}),
  });
}

export function shareGrantAllows(
  grant: MemoryShareGrant,
  request: { readonly tenantId: string; readonly childThreadId: string; readonly now?: number },
): boolean {
  if (grant.tenantId !== request.tenantId) return false;
  if (grant.childThreadId !== request.childThreadId) return false;
  if (grant.expiresAt !== undefined && (request.now ?? Date.now()) >= Date.parse(grant.expiresAt)) return false;
  return true;
}

export function explainRecord(
  record: Pick<MemoryVectorRecord, "id" | "tenantId" | "resourceId" | "threadId" | "createdAt" | "metadata">,
  invalidation?: MemoryInvalidationRecord,
): MemoryRecallExplanation {
  const parsed = parseLineage(record.metadata);
  const sourceIds = parsed === undefined || parsed === "invalid" ? [] : parsed.sourceIds;
  return Object.freeze({
    id: record.id,
    sourceIds,
    createdAt: record.createdAt,
    tenantId: record.tenantId,
    resourceId: record.resourceId,
    threadId: record.threadId,
    ...(parsed !== undefined && parsed !== "invalid" && parsed.reason ? { reason: parsed.reason } : {}),
    ...(invalidation ? { invalidated: invalidation } : {}),
  });
}

/** 072 invariant body: wrap with `defineScorer({ invariant: true, score: ... })`. Score 0 is not mean-able. */
export function revokedIdsAbsent(
  environment: { readonly injectedIds?: readonly string[] } | undefined,
  deniedIds: readonly string[],
): { readonly score: number; readonly metadata: { readonly invariant: true } } {
  const injected = new Set(environment?.injectedIds ?? []);
  for (const id of deniedIds) {
    if (injected.has(id)) return { score: 0, metadata: { invariant: true } };
  }
  return { score: 1, metadata: { invariant: true } };
}

export async function invalidateAcrossLayers(input: {
  readonly scope: Required<MemoryScope>;
  readonly entries: readonly MemoryInvalidationRecord[];
  readonly vectorStore: VectorStore;
  readonly signal?: AbortSignal;
  readonly observational?: { readonly drop: (ids: readonly string[]) => void | Promise<void> };
  readonly rag?: { readonly deleteSource: (sourceId: string, options?: { readonly signal?: AbortSignal }) => Promise<unknown> };
}): Promise<void> {
  if (input.vectorStore.lineage !== "invalidation" || !input.vectorStore.invalidate) {
    throw new MemoryScopeError("vector store does not support lineage invalidation");
  }
  const entries = assertInvalidationBatch(input.entries);
  await input.vectorStore.invalidate(input.scope, entries, { signal: input.signal });
  await input.observational?.drop(entries.map((entry) => entry.id));
  for (const entry of entries) {
    if (entry.hold || entry.reason === "legal_hold" || entry.reason === "corrected") continue;
    await input.rag?.deleteSource(entry.id, { signal: input.signal });
  }
}

export function toInvalidationEvent(reason: MemoryInvalidationReason, ids: readonly string[], hold: boolean): MemoryInvalidationEvent {
  return Object.freeze({ reason, ids, hold });
}
