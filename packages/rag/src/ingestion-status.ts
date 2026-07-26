import { RagScopeError, RagValidationError } from "./errors.js";
import { resolveRagLimits } from "./limits.js";
import type { IngestionStatus, IngestionStatusQuery, IngestionStatusStore, RagScope } from "./types.js";
import { assertNotAborted, byteLength, requireScope, requireSourceId } from "./util.js";

export async function listIngestionStatus(options: IngestionStatusQuery): Promise<{ readonly entries: readonly IngestionStatus[]; readonly nextCursor?: string }> {
  const scope = requireScope(options.scope);
  const limit = resolveRagLimits({ ingestionStatusPageSize: options.limit }).ingestionStatusPageSize;
  if (options.cursor !== undefined) requireSourceId(options.cursor);
  assertNotAborted(options.signal);
  const page = await options.store.list(scope, { limit, cursor: options.cursor, signal: options.signal });
  if (page.entries.length > limit) throw new RagValidationError("ingestion status store exceeded requested page limit");
  for (const entry of page.entries) assertStatus(entry, scope);
  if (page.nextCursor !== undefined) requireSourceId(page.nextCursor);
  return Object.freeze({ entries: Object.freeze([...page.entries]), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
}

export function createMemoryIngestionStatusStore(): IngestionStatusStore {
  const scopes = new Map<string, Map<string, IngestionStatus>>();
  return {
    async set(status, options = {}) {
      assertNotAborted(options.signal);
      const scope = requireScope(status.scope);
      assertStatus(status, scope);
      const key = scopeKey(scope);
      const entries = scopes.get(key) ?? new Map<string, IngestionStatus>();
      entries.set(status.sourceId, Object.freeze({ ...status, scope }));
      scopes.set(key, entries);
    },
    async delete(scope, sourceId, options = {}) {
      assertNotAborted(options.signal);
      const entries = scopes.get(scopeKey(requireScope(scope)));
      entries?.delete(requireSourceId(sourceId));
    },
    async list(scope, options) {
      assertNotAborted(options.signal);
      const required = requireScope(scope);
      const limit = options.limit;
      if (!Number.isInteger(limit) || limit < 1) throw new RagValidationError("ingestion status limit must be a positive integer");
      if (options.cursor !== undefined) requireSourceId(options.cursor);
      const entries = [...(scopes.get(scopeKey(required))?.values() ?? [])]
        .filter((entry) => entry.sourceId > (options.cursor ?? ""))
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
      const page = entries.slice(0, limit);
      const next = entries.length > page.length ? page.at(-1)?.sourceId : undefined;
      return Object.freeze({ entries: Object.freeze(page), ...(next ? { nextCursor: next } : {}) });
    },
  };
}

export function ingestionStatus(
  scope: RagScope,
  sourceId: string,
  state: IngestionStatus["state"],
  bytes: number,
  chunks: number,
  error?: string,
): IngestionStatus {
  const status: IngestionStatus = {
    sourceId: requireSourceId(sourceId),
    scope: requireScope(scope),
    state,
    bytes,
    chunks,
    ...(error ? { error } : {}),
    updatedAt: new Date().toISOString(),
  };
  assertStatus(status, status.scope);
  return Object.freeze(status);
}

function assertStatus(status: IngestionStatus, scope: RagScope): void {
  requireSourceId(status.sourceId);
  if (status.scope.tenantId !== scope.tenantId || status.scope.resourceId !== scope.resourceId || status.scope.corpusId !== scope.corpusId) {
    throw new RagScopeError("ingestion status crossed tenant/resource/corpus boundary");
  }
  if (!(["pending", "indexed", "failed", "partial"] as const).includes(status.state)) throw new RagValidationError("ingestion status state is invalid");
  if (!Number.isSafeInteger(status.bytes) || status.bytes < 0 || !Number.isSafeInteger(status.chunks) || status.chunks < 0) {
    throw new RagValidationError("ingestion status bytes and chunks must be non-negative safe integers");
  }
  if (!Number.isFinite(Date.parse(status.updatedAt))) throw new RagValidationError("ingestion status updatedAt must be an ISO timestamp");
  if (status.error !== undefined && (typeof status.error !== "string" || byteLength(status.error) > 4_096)) {
    throw new RagValidationError("ingestion status error must be a string <= 4096 bytes");
  }
}

function scopeKey(scope: RagScope): string {
  return `${scope.tenantId}\0${scope.resourceId}\0${scope.corpusId}`;
}
