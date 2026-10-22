import type { Database } from "bun:sqlite";
import { closeSync, openSync } from "node:fs";
import { HARD_DIRECTORY_TAGS, resolveDirectoryAsOf, resolveDirectoryLimit } from "../directory.js";
import { assertAccessConstraint, assertAccessGrants, assertAuthorizationTenant, grantAllows, sourceIdFromRecord } from "../acl.js";
import { MemoryConflictError, MemoryValidationError } from "../errors.js";
import { assertInvalidationBatch, assertShareGrant, HARD_LINEAGE_EDGES, recordBlocked } from "../lineage.js";
import {
  compareMemoryRecord,
  compareMemoryRecords,
  decodeMemoryCursor,
  decodeMetadataCursor,
  encodeMemoryCursor,
  encodeMetadataCursor,
} from "../pagination.js";
import { normalizeImportance } from "../scoring.js";
import type {
  MemoryInvalidationRecord,
  MemoryScope,
  MemoryShareGrant,
  MemoryVectorHit,
  MemoryVectorMetadataPage,
  MemoryVectorRecord,
  ScopeCounterKey,
  SourceAccessGrant,
  VectorLexicalQuery,
  VectorListResourcesQuery,
  VectorQuery,
  VectorScanMetadataQuery,
  VectorStore,
  WorkingMemoryRecord,
  WorkingMemoryStore,
} from "../types.js";
import {
  assertByteLimit,
  assertFiniteVector,
  assertNotAborted,
  assertRecordEmbedding,
  assertTextLimit,
  cosineSimilarity,
  mergeJsonObjects,
  requireNonEmptyString,
  requireScope,
} from "../util.js";
import { lexicalCoverage, lexicalKeys, lexicalTerms, lexicalTermString, recordLexicalTerms } from "../lexical.js";
import {
  buildSqliteMemoryDdl,
  buildSqliteMemoryV3Migration,
  SQLITE_MEMORY_APPLICATION_ID,
  SQLITE_MEMORY_SCHEMA_VERSION,
} from "./ddl.js";

export { buildSqliteMemoryDdl } from "./ddl.js";

export interface SqliteMemoryStoresOptions {
  readonly path: string;
  readonly dimensions?: number;
}
export interface SqliteMemoryStores {
  readonly vectorStore: Required<VectorStore>;
  readonly workingStore: WorkingMemoryStore;
  close(): void;
}

/** The lifecycle columns the scan filters on, mirrored from the record at write time (plan 188.4 Task 2). */
function lifecycleColumns(
  record: MemoryVectorRecord,
  importance: number | undefined,
): { readonly status: string | null; readonly storage: number | null; readonly lastUseOrdinal: number | null } {
  const status = typeof record.metadata?.status === "string" ? record.metadata.status : null;
  const fabric = record.metadata?.fabric;
  const uses = fabric !== null && typeof fabric === "object" ? (fabric as { uses?: unknown }).uses : undefined;
  const last = Array.isArray(uses) ? (uses.at(-1) as { s?: unknown } | undefined)?.s : undefined;
  return {
    status,
    storage: importance ?? null,
    lastUseOrdinal: typeof last === "number" && Number.isSafeInteger(last) ? last : null,
  };
}

// Generations can exceed Number.MAX_SAFE_INTEGER; preserve their exact value and type.
function encode(value: unknown): string {
  return JSON.stringify(value, function (key, v) {
    return this === value && key === "generation" && typeof v === "bigint" ? { bigint: String(v) } : v;
  });
}
function decode<T>(value: string): T {
  const parsed = JSON.parse(value);
  if (parsed?.generation && typeof parsed.generation === "object" && typeof parsed.generation.bigint === "string") {
    parsed.generation = BigInt(parsed.generation.bigint);
  }
  return parsed as T;
}
function validGeneration(value: bigint | number): void {
  if (!(typeof value === "bigint" ? value >= 0n : Number.isSafeInteger(value) && value >= 0))
    throw new MemoryValidationError("generation must be a non-negative safe integer or bigint");
}

// The SQL form of `activeDirectoryNote`; julianday() is NULL for a malformed timestamp, which excludes the row (fail closed).
const FABRIC = "$.metadata.fabric";
/** The SQL form of `recordBlocked`: a self-invalidation other than `corrected`, or a derived row's blocked source. */
const NOT_BLOCKED = `NOT EXISTS (
    SELECT 1 FROM memory_state m
    WHERE m.tenant_id=s.tenant_id AND m.resource_id=s.resource_id AND m.thread_id=s.thread_id AND m.kind='invalidation'
      AND ((m.id=s.id AND json_extract(m.value,'$.reason') <> 'corrected')
        OR (m.id<>s.id AND EXISTS (SELECT 1 FROM json_each(s.record,'$.metadata._lineage.sourceIds') j WHERE j.value=m.id))))`;
const ACTIVE_NOTE = `s.tenant_id=? AND s.resource_id=? AND s.thread_id=?
  AND json_type(s.record,'${FABRIC}.kind')='text'
  AND COALESCE(json_extract(s.record,'$.consent.visible'),1) <> 0
  AND (COALESCE(json_extract(s.record,'$.metadata.status'),'') NOT IN ('candidate', 'archived') OR (json_extract(s.record,'$.metadata.status')='archived' AND json_extract(s.record,'${FABRIC}.archivedAt') IS NOT NULL AND julianday(json_extract(s.record,'${FABRIC}.archivedAt')) > julianday(?)))
  AND (json_type(s.record,'${FABRIC}.validFrom') IS NULL OR julianday(json_extract(s.record,'${FABRIC}.validFrom')) <= julianday(?))
  AND (json_type(s.record,'${FABRIC}.validTo') IS NULL OR julianday(json_extract(s.record,'${FABRIC}.validTo')) > julianday(?))
  AND ${NOT_BLOCKED}`;

export async function createSqliteMemoryStores(options: SqliteMemoryStoresOptions): Promise<SqliteMemoryStores> {
  requireNonEmptyString(options.path, "path");
  if (options.dimensions !== undefined && (!Number.isInteger(options.dimensions) || options.dimensions < 1))
    throw new MemoryValidationError("dimensions must be a positive integer");
  let db: Database | undefined;
  let dimensions = options.dimensions;
  try {
    if (options.path !== ":memory:") closeSync(openSync(options.path, "a", 0o600));
    const { Database } = await import("bun:sqlite");
    const openedDb = new Database(options.path, { strict: true });
    db = openedDb;
    openedDb.exec("PRAGMA busy_timeout = 5000");
    openedDb
      .transaction(() => {
        const app = openedDb.query<{ application_id: number }, []>("PRAGMA application_id").get()?.application_id;
        const version = openedDb.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
        const tables = openedDb.query("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
        if (app === 0 && version === 0 && tables.length === 0) {
          openedDb.exec(buildSqliteMemoryDdl());
          openedDb.query("INSERT INTO memory_config VALUES (1, ?)").run(dimensions ?? null);
        } else if (app !== SQLITE_MEMORY_APPLICATION_ID) {
          throw new MemoryValidationError("Unknown SQLite memory schema");
        } else if (version === 2) {
          openedDb.exec(buildSqliteMemoryV3Migration());
        } else if (version !== SQLITE_MEMORY_SCHEMA_VERSION) {
          throw new MemoryValidationError("Unknown SQLite memory schema");
        }
        const stored = openedDb.query<{ dimensions: number | null }, []>("SELECT dimensions FROM memory_config WHERE id = 1").get();
        if (!stored) throw new MemoryValidationError("Missing SQLite memory configuration");
        if (dimensions !== undefined && stored.dimensions !== null && dimensions !== stored.dimensions)
          throw new MemoryValidationError("SQLite memory dimensions mismatch");
        dimensions ??= stored.dimensions ?? undefined;
        if (dimensions !== undefined && stored.dimensions === null) {
          const records = openedDb.query<{ record: string }, []>("SELECT record FROM semantic_memory").all();
          for (const row of records) {
            const embedding = decode<MemoryVectorRecord>(row.record).embedding;
            if (embedding.length) assertFiniteVector(embedding, "embedding", dimensions);
          }
          openedDb.query("UPDATE memory_config SET dimensions = ? WHERE id = 1").run(dimensions);
        }
        if (openedDb.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok")
          throw new MemoryValidationError("Corrupt SQLite memory file");
        openedDb.query("SELECT record FROM semantic_memory LIMIT 0").all();
        openedDb.query("SELECT record FROM working_memory LIMIT 0").all();
        openedDb.query("SELECT value FROM memory_state LIMIT 0").all();
        openedDb.query("SELECT value FROM memory_scope_counter LIMIT 0").all();
        openedDb.exec("INSERT INTO semantic_memory_fts(semantic_memory_fts, rank) VALUES ('integrity-check', 1)");
      })
      .immediate();
  } catch {
    db?.close();
    throw new MemoryValidationError("Cannot open SQLite memory file: unknown, corrupt, or incompatible schema/configuration");
  }
  const database = db;
  function requireScanScope(query: VectorScanMetadataQuery): { readonly tenantId: string; readonly resourceId: string } {
    if (!Number.isInteger(query.limit) || query.limit < 1) throw new MemoryValidationError("scan limit must be a positive integer");
    return {
      tenantId: requireNonEmptyString(query.scope?.tenantId, "tenantId"),
      resourceId: requireNonEmptyString(query.scope?.resourceId, "resourceId"),
    };
  }
  function counterArgs(key: ScopeCounterKey): [string, string, string] {
    if (key.name !== "sessions") throw new MemoryValidationError("unknown scope counter name");
    return [requireNonEmptyString(key.tenantId, "tenantId"), requireNonEmptyString(key.resourceId, "resourceId"), key.name];
  }
  const scopeArgs = (scope: MemoryScope, thread = true): [string, string, string] => {
    const s = requireScope(scope, thread);
    return [s.tenantId, s.resourceId, s.threadId ?? ""];
  };
  function state<T>(scope: MemoryScope, kind: string, id: string): T | undefined {
    const row = database
      .query<{ value: string }, [string, string, string, string, string]>(
        "SELECT value FROM memory_state WHERE tenant_id=? AND resource_id=? AND thread_id=? AND kind=? AND id=?",
      )
      .get(...scopeArgs(scope), kind, id);
    return row ? decode<T>(row.value) : undefined;
  }
  function putState(scope: MemoryScope, kind: string, id: string, value: unknown): void {
    database
      .query(
        "INSERT INTO memory_state VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id,resource_id,thread_id,kind,id) DO UPDATE SET value=excluded.value",
      )
      .run(...scopeArgs(scope), kind, id, encode(value));
  }
  function removeState(scope: MemoryScope, kind: string, id: string): void {
    database
      .query("DELETE FROM memory_state WHERE tenant_id=? AND resource_id=? AND thread_id=? AND kind=? AND id=?")
      .run(...scopeArgs(scope), kind, id);
  }
  function rows(scope: MemoryScope): MemoryVectorRecord[] {
    return database
      .query<{ record: string }, [string, string, string]>(
        "SELECT record FROM semantic_memory WHERE tenant_id=? AND resource_id=? AND thread_id=?",
      )
      .all(...scopeArgs(scope))
      .map((row) => decode<MemoryVectorRecord>(row.record));
  }
  function invalidated(scope: MemoryScope): MemoryInvalidationRecord[] {
    return database
      .query<{ value: string }, [string, string, string]>(
        "SELECT value FROM memory_state WHERE tenant_id=? AND resource_id=? AND thread_id=? AND kind='invalidation'",
      )
      .all(...scopeArgs(scope))
      .map((row) => decode<MemoryInvalidationRecord>(row.value));
  }
  function currentGeneration(scope: MemoryScope): bigint | number | undefined {
    const pointer = state<{ generation: bigint | number }>(scope, "generation", "");
    if (pointer) return pointer.generation;
    let max: bigint | number | undefined;
    for (const row of rows(scope))
      if (row.generation !== undefined && (max === undefined || BigInt(row.generation) > BigInt(max))) max = row.generation;
    return max;
  }
  function rank(query: VectorQuery | VectorLexicalQuery, candidates: MemoryVectorHit[]): MemoryVectorHit[] {
    assertNotAborted(query.signal);
    scopeArgs(query);
    if (!Number.isInteger(query.topK) || query.topK < 1) throw new MemoryValidationError("topK must be a positive integer");
    if (query.ids && query.ids.length > HARD_LINEAGE_EDGES) throw new MemoryValidationError("query ids exceed hard cap");
    const auth = query.authorization ? assertAccessConstraint(query.authorization) : undefined;
    if (auth) assertAuthorizationTenant(auth, query.tenantId);
    const blocked = new Map(invalidated(query).map((x) => [x.id, x]));
    const generation = currentGeneration(query);
    const denied = new Map<string, "no_grant" | "version_mismatch">();
    const hits = candidates.filter((record) => {
      if (query.ids && !query.ids.includes(record.id)) return false;
      if (generation !== undefined && record.generation !== undefined && BigInt(record.generation) !== BigInt(generation)) return false;
      if (recordBlocked(record, blocked)) return false;
      if (auth) {
        const sourceId = sourceIdFromRecord(record);
        const grant = sourceId ? state<SourceAccessGrant>(query, "acl", sourceId) : undefined;
        if (!grant || !grantAllows({ ...grant, principalIds: grant.principalIds ?? [], groupIds: grant.groupIds ?? [] }, auth)) {
          if (sourceId)
            denied.set(
              sourceId,
              grant && auth.accessVersion !== undefined && grant.accessVersion !== auth.accessVersion ? "version_mismatch" : "no_grant",
            );
          return false;
        }
      }
      return true;
    });
    if (auth) query.onDeniedSources?.([...denied].map(([sourceId, reason]) => ({ sourceId, reason })));
    hits.sort((a, b) => b.score - a.score || a.sequence - b.sequence || a.id.localeCompare(b.id));
    return hits.slice(0, query.topK);
  }
  const vectorStore: Required<VectorStore> = {
    authorization: "acl",
    lineage: "invalidation",
    lexicalModes: ["fts", "bm25"],
    async upsert(records, opts = {}) {
      assertNotAborted(opts.signal);
      database
        .transaction(() => {
          for (const record of records) {
            const scope = scopeArgs(record);
            requireNonEmptyString(record.id, "id");
            assertTextLimit(record.text, 64_384, "vector text");
            assertRecordEmbedding(record, dimensions);
            if (!Number.isInteger(record.sequence)) throw new MemoryValidationError("sequence must be an integer");
            if (record.generation !== undefined) validGeneration(record.generation);
            if (record.embedderId !== undefined && (!record.embedderId.length || record.embedderId.length > 256))
              throw new MemoryValidationError("Invalid embedderId");
            const importance = normalizeImportance(record.importance);
            const index = lifecycleColumns(record, importance);
            database
              .query(
                `INSERT INTO semantic_memory
                   (tenant_id, resource_id, thread_id, id, text, record, lex_text, lex_keys, status, storage, last_use_ordinal)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(tenant_id,resource_id,thread_id,id) DO UPDATE SET
                   text=excluded.text, record=excluded.record, lex_text=excluded.lex_text, lex_keys=excluded.lex_keys,
                   status=excluded.status, storage=excluded.storage, last_use_ordinal=excluded.last_use_ordinal`,
              )
              .run(
                ...scope,
                record.id,
                record.text,
                encode({ ...record, ...(importance !== undefined ? { importance } : {}) }),
                lexicalTermString(record.text),
                lexicalTermString(lexicalKeys(record)),
                index.status,
                index.storage,
                index.lastUseOrdinal,
              );
          }
        })
        .immediate();
    },
    async query(query) {
      assertNotAborted(query.signal);
      // An embedding-less (lexical-only) memory has no vector leg.
      if (query.embedding.length === 0) return rank(query, []);
      assertFiniteVector(query.embedding, "query embedding", dimensions);
      return rank(
        query,
        rows(query)
          .filter((r) => r.embedding.length === query.embedding.length)
          .map((r) => ({ ...r, score: cosineSimilarity(query.embedding, r.embedding) })),
      );
    },
    async lexicalQuery(query) {
      assertNotAborted(query.signal);
      requireNonEmptyString(query.text, "text");
      // Analyzed terms, each quoted: user text is literal tokens, never FTS operators.
      const terms = lexicalTerms(query.text);
      const match = [...terms].map((t) => `"${t}"`).join(" OR ");
      // Keys (keywords, tags, context, path) weigh three times the body.
      const matches = match
        ? database
            .query<{ record: string; score: number }, [string, string, string, string]>(
              "SELECT m.record, -bm25(semantic_memory_fts, 1.0, 3.0) AS score FROM semantic_memory_fts JOIN semantic_memory m ON m.rowid=semantic_memory_fts.rowid WHERE semantic_memory_fts MATCH ? AND m.tenant_id=? AND m.resource_id=? AND m.thread_id=?",
            )
            .all(match, ...scopeArgs(query))
            .map((row) => {
              const record = decode<MemoryVectorRecord>(row.record);
              return { ...record, score: row.score, coverage: lexicalCoverage(terms, recordLexicalTerms(record)) };
            })
        : [];
      return rank(query, matches);
    },
    async delete(filter, opts = {}) {
      assertNotAborted(opts.signal);
      const s = requireScope(filter);
      return database
        .transaction(() => {
          const candidates = database
            .query<{ id: string; thread_id: string }, [string, string]>(
              "SELECT id, thread_id FROM semantic_memory WHERE tenant_id=? AND resource_id=?",
            )
            .all(s.tenantId, s.resourceId);
          let deleted = 0;
          for (const row of candidates)
            if ((s.threadId === undefined || s.threadId === row.thread_id) && (!filter.ids || filter.ids.includes(row.id)))
              deleted += database
                .query("DELETE FROM semantic_memory WHERE tenant_id=? AND resource_id=? AND thread_id=? AND id=? RETURNING id")
                .all(s.tenantId, s.resourceId, row.thread_id, row.id).length;
          return deleted;
        })
        .immediate();
    },
    async getByIds(scope, ids, options = {}) {
      assertNotAborted(options.signal);
      const s = requireScope(scope, true);
      if (!ids.length) return [];
      return database.query<{ record: string }, string[]>(
        `SELECT record FROM semantic_memory WHERE tenant_id=? AND resource_id=? AND thread_id=? AND id IN (${ids.map(() => "?").join(",")})`,
      ).all(s.tenantId, s.resourceId, s.threadId!, ...ids).map(row => decode<MemoryVectorRecord>(row.record));
    },
    async getByThread(scope) {
      return rows(scope).sort((a, b) => compareMemoryRecords(a, b, "sequence"));
    },
    async listByThread(query) {
      assertNotAborted(query.signal);
      if (!Number.isInteger(query.limit) || query.limit < 1)
        throw new MemoryValidationError("memory page limit must be a positive integer");
      const order = query.order ?? "sequence";
      const cursor = decodeMemoryCursor(query.cursor, order);
      const all = rows(query)
        .filter((r) => compareMemoryRecord(r, cursor, order) > 0)
        .sort((a, b) => compareMemoryRecords(a, b, order));
      const records = all.slice(0, query.limit);
      const last = records.at(-1);
      return { records, ...(last && all.length > records.length ? { nextCursor: encodeMemoryCursor(last, order) } : {}) };
    },
    async countByThread(scope, opts = {}) {
      assertNotAborted(opts.signal);
      return (
        database
          .query<{ count: number }, [string, string, string]>(
            "SELECT count(*) AS count FROM semantic_memory WHERE tenant_id=? AND resource_id=? AND thread_id=?",
          )
          .get(...scopeArgs(scope))?.count ?? 0
      );
    },
    async countByKind(scope, query = {}) {
      assertNotAborted(query.signal);
      const asOf = resolveDirectoryAsOf(query.asOf);
      const found = database
        .query<{ kind: string; count: number }, [string, string, string, string, string, string]>(
          `SELECT json_extract(s.record,'${FABRIC}.kind') AS kind, count(*) AS count FROM semantic_memory s WHERE ${ACTIVE_NOTE} GROUP BY kind ORDER BY kind`,
        )
        .all(...scopeArgs(scope), asOf, asOf, asOf);
      return Object.fromEntries(found.map((row) => [row.kind, row.count]));
    },
    async topTags(scope, query = {}) {
      assertNotAborted(query.signal);
      const limit = Math.min(resolveDirectoryLimit(query.limit), HARD_DIRECTORY_TAGS);
      const asOf = resolveDirectoryAsOf(query.asOf);
      const leg = (field: string) =>
        `SELECT s.id AS id, j.value AS tag FROM semantic_memory s, json_each(s.record,'${FABRIC}.${field}') j WHERE j.type='text' AND j.value<>'' AND ${ACTIVE_NOTE}`;
      const args = [...scopeArgs(scope), asOf, asOf, asOf];
      return database
        .query<{ tag: string; count: number }, (string | number)[]>(
          `SELECT tag, count(*) AS count FROM (${leg("tags")} UNION ${leg("keywords")}) GROUP BY tag ORDER BY count DESC, tag ASC LIMIT ?`,
        )
        .all(...args, ...args, limit);
    },
    async getCurrentGeneration(scope) {
      return currentGeneration(scope);
    },
    async setCurrentGeneration(scope, generation) {
      validGeneration(generation);
      putState(scope, "generation", "", { generation });
    },
    async setSourceAccess(scope, grants, opts = {}) {
      assertNotAborted(opts.signal);
      database
        .transaction(() => {
          for (const grant of assertAccessGrants(grants)) putState(scope, "acl", grant.sourceId, grant);
        })
        .immediate();
    },
    async checkSourceAccess(scope, sourceId, authorization, opts = {}) {
      assertNotAborted(opts.signal);
      requireNonEmptyString(sourceId, "sourceId");
      const auth = assertAccessConstraint(authorization);
      assertAuthorizationTenant(auth, requireScope(scope, true).tenantId);
      const grant = state<SourceAccessGrant>(scope, "acl", sourceId);
      return !!grant && grantAllows({ ...grant, principalIds: grant.principalIds ?? [], groupIds: grant.groupIds ?? [] }, auth);
    },
    async invalidate(scope, entries, opts = {}) {
      assertNotAborted(opts.signal);
      database
        .transaction(() => {
          for (const entry of assertInvalidationBatch(entries)) {
            const prior = state<MemoryInvalidationRecord>(scope, "invalidation", entry.id);
            const hold = prior?.hold === true || prior?.reason === "legal_hold" || entry.hold === true || entry.reason === "legal_hold";
            putState(scope, "invalidation", entry.id, {
              ...entry,
              reason: prior?.hold || prior?.reason === "legal_hold" ? prior.reason : entry.reason,
              ...(hold ? { hold: true } : {}),
            });
          }
        })
        .immediate();
    },
    async listInvalidated(scope, opts = {}) {
      assertNotAborted(opts.signal);
      return invalidated(scope);
    },
    async clearInvalidation(scope, ids, opts = {}) {
      assertNotAborted(opts.signal);
      database
        .transaction(() => {
          for (const id of ids) {
            const prior = state<MemoryInvalidationRecord>(scope, "invalidation", id);
            if (prior && !prior.hold && prior.reason !== "legal_hold") removeState(scope, "invalidation", id);
          }
        })
        .immediate();
    },
    async setShareGrant(scope, input, opts = {}) {
      assertNotAborted(opts.signal);
      const s = requireScope(scope, true);
      const grant = assertShareGrant({ ...input, tenantId: s.tenantId, parentThreadId: scopeArgs(s)[2] });
      if (grant.sourceIds.length) putState(scope, "share", grant.childThreadId, grant);
      else removeState(scope, "share", grant.childThreadId);
    },
    async getShareGrant(scope, child, opts = {}) {
      assertNotAborted(opts.signal);
      return state<MemoryShareGrant>(scope, "share", requireNonEmptyString(child, "childThreadId"));
    },
    async scanMetadata(query: VectorScanMetadataQuery): Promise<MemoryVectorMetadataPage> {
      assertNotAborted(query.signal);
      const { tenantId, resourceId } = requireScanScope(query);
      const cursor = decodeMetadataCursor(query.cursor);
      const params: (string | number)[] = [tenantId, resourceId];
      const after = cursor === undefined ? "" : ` AND (s.thread_id > ? OR (s.thread_id = ? AND s.id > ?))`;
      if (cursor !== undefined) params.push(cursor.threadId, cursor.threadId, cursor.id);
      params.push(query.limit + 1);
      const found = database
        .query<{ id: string; thread_id: string; record: string }, (string | number)[]>(
          `SELECT s.id, s.thread_id, s.record FROM semantic_memory s
           WHERE s.tenant_id=? AND s.resource_id=?${after}
             AND json_extract(s.record,'$.consent.visible')=1
             AND ${NOT_BLOCKED}
           ORDER BY s.thread_id ASC, s.id ASC LIMIT ?`,
        )
        .all(...params);
      const page = found.slice(0, query.limit).map((row) => {
        const record = decode<MemoryVectorRecord>(row.record);
        return Object.freeze({
          id: row.id,
          ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
          createdAt: record.createdAt,
          ...(record.lastAccessedAt === undefined ? {} : { lastAccessedAt: record.lastAccessedAt }),
        });
      });
      const last = found[query.limit - 1];
      return Object.freeze({
        rows: Object.freeze(page),
        ...(last && found.length > page.length
          ? { nextCursor: encodeMetadataCursor({ threadId: last.thread_id, id: last.id }) }
          : {}),
      });
    },
    async listResources(query: VectorListResourcesQuery) {
      assertNotAborted(query.signal);
      const tenantId = requireNonEmptyString(query.tenantId, "tenantId");
      const prefix = query.prefix ?? "";
      return Object.freeze(
        database
          .query<{ resource_id: string }, [string, string, string]>(
            "SELECT DISTINCT resource_id FROM semantic_memory WHERE tenant_id=? AND substr(resource_id,1,length(?))=? ORDER BY resource_id",
          )
          .all(tenantId, prefix, prefix)
          .map((row) => row.resource_id),
      );
    },
    scopeCounter: {
      async get(key: ScopeCounterKey, opts = {}) {
        assertNotAborted(opts.signal);
        const row = database
          .query<{ value: number }, [string, string, string]>(
            "SELECT value FROM memory_scope_counter WHERE tenant_id=? AND resource_id=? AND name=?",
          )
          .get(...counterArgs(key));
        return row?.value ?? 0;
      },
      async increment(key: ScopeCounterKey, opts = {}) {
        assertNotAborted(opts.signal);
        const row = database
          .query<{ value: number }, [string, string, string]>(
            `INSERT INTO memory_scope_counter (tenant_id, resource_id, name, value) VALUES (?, ?, ?, 1)
             ON CONFLICT (tenant_id, resource_id, name) DO UPDATE SET value = value + 1
             RETURNING value`,
          )
          .get(...counterArgs(key));
        return Number(row?.value ?? 0);
      },
    },
  };
  function getWorking(scope: MemoryScope): WorkingMemoryRecord | undefined {
    const row = database
      .query<{ record: string }, [string, string, string]>(
        "SELECT record FROM working_memory WHERE tenant_id=? AND resource_id=? AND thread_id=?",
      )
      .get(...scopeArgs(scope, false));
    return row ? decode<WorkingMemoryRecord>(row.record) : undefined;
  }
  function setWorking(record: WorkingMemoryRecord): void {
    if (!Number.isInteger(record.version) || record.version < 1) throw new MemoryValidationError("version must be an integer >= 1");
    assertByteLimit(record.value, 256 * 1024, "working memory");
    const value = mergeJsonObjects({}, record.value);
    database
      .query(
        "INSERT INTO working_memory VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id,resource_id,thread_id) DO UPDATE SET record=excluded.record",
      )
      .run(...scopeArgs(record, false), encode({ ...requireScope(record), value, version: record.version, updatedAt: record.updatedAt }));
  }
  const workingStore: WorkingMemoryStore = {
    async get(scope, opts = {}) {
      assertNotAborted(opts.signal);
      return getWorking(scope);
    },
    async set(record, opts = {}) {
      assertNotAborted(opts.signal);
      setWorking(record);
    },
    async update(scope, patch, opts = {}) {
      assertNotAborted(opts.signal);
      return database
        .transaction(() => {
          const prior = getWorking(scope);
          if (opts.expectedVersion !== undefined && (prior?.version ?? 0) !== opts.expectedVersion)
            throw new MemoryConflictError("working memory version conflict");
          if (opts.mode !== undefined && opts.mode !== "merge" && opts.mode !== "replace")
            throw new MemoryValidationError("Invalid working memory update mode");
          const next = {
            ...requireScope(scope),
            value: mergeJsonObjects(opts.mode === "replace" ? {} : (prior?.value ?? {}), patch),
            version: (prior?.version ?? 0) + 1,
            updatedAt: new Date().toISOString(),
          };
          setWorking(next);
          return next;
        })
        .immediate();
    },
    async delete(scope, opts = {}) {
      assertNotAborted(opts.signal);
      return (
        database.query("DELETE FROM working_memory WHERE tenant_id=? AND resource_id=? AND thread_id=?").run(...scopeArgs(scope, false))
          .changes > 0
      );
    },
  };
  let closed = false;
  return {
    vectorStore,
    workingStore,
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    },
  };
}
