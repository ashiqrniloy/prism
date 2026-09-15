import { MemoryValidationError } from "./errors.js";
import { quoteIdentifier, validateIdentifier } from "./postgres-identifiers.js";

export const DEFAULT_MEMORY_SCHEMA = "prism_memory";
export const DEFAULT_VECTOR_TABLE = "semantic_memory";

export function buildMemoryDdl(schemaInput = DEFAULT_MEMORY_SCHEMA, tableInput = DEFAULT_VECTOR_TABLE): string {
  const schema = validateIdentifier(schemaInput, "schema");
  const table = validateIdentifier(tableInput, "table");
  const q = quoteIdentifier(schema);
  const t = `${q}.${quoteIdentifier(table)}`;
  return `
CREATE SCHEMA IF NOT EXISTS ${q};
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS ${q}.working_memory (
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  value JSONB NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, thread_id)
);
CREATE TABLE IF NOT EXISTS ${t} (
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector NOT NULL,
  sequence INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, thread_id, id)
);
CREATE INDEX IF NOT EXISTS ${table}_scope_seq_idx
  ON ${t} (tenant_id, resource_id, thread_id, sequence);
ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS consent JSONB;
ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS embedder_id TEXT;
ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS generation INTEGER;
ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS importance REAL;
-- Current-generation pointer per exact scope — the postgres analog of an ES alias.
CREATE TABLE IF NOT EXISTS ${q}.${quoteIdentifier(`${table}_rag_scope_generations`)} (
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  current_generation INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, thread_id)
);
CREATE TABLE IF NOT EXISTS ${q}.${quoteIdentifier(`${table}_rag_source_acl`)} (
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  principal_id TEXT NOT NULL DEFAULT '',
  group_id TEXT NOT NULL DEFAULT '',
  access_version INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, thread_id, source_id, principal_id, group_id)
);
CREATE INDEX IF NOT EXISTS ${table}_rag_source_acl_principal_idx
  ON ${q}.${quoteIdentifier(`${table}_rag_source_acl`)} (tenant_id, resource_id, thread_id, principal_id);
CREATE INDEX IF NOT EXISTS ${table}_rag_source_acl_group_idx
  ON ${q}.${quoteIdentifier(`${table}_rag_source_acl`)} (tenant_id, resource_id, thread_id, group_id);
CREATE TABLE IF NOT EXISTS ${q}.${quoteIdentifier(`${table}_invalidation`)} (
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  id TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  hold BOOLEAN NOT NULL DEFAULT FALSE,
  supersedes_id TEXT,
  PRIMARY KEY (tenant_id, resource_id, thread_id, id)
);
CREATE INDEX IF NOT EXISTS ${table}_invalidation_reason_idx
  ON ${q}.${quoteIdentifier(`${table}_invalidation`)} (tenant_id, resource_id, thread_id, reason);
CREATE TABLE IF NOT EXISTS ${q}.${quoteIdentifier(`${table}_share_grant`)} (
  tenant_id TEXT NOT NULL,
  parent_thread_id TEXT NOT NULL,
  child_thread_id TEXT NOT NULL,
  source_ids JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, parent_thread_id, child_thread_id)
);
`;
}

/**
 * Index-backed lexical structures plus, when the host declares a fixed dimension, the HNSW
 * cosine index (pgvector can only build HNSW over vector(N) columns). Applied best-effort by
 * the adapters: pre-12 PostgreSQL lacks generated columns — queries stay correct via sequential
 * scan there, just slower.
 * # ponytail: silent degradation to seq scan on old extensions; fail loudly once min versions are pinned
 */
export function buildVectorSearchDdl(schemaInput = DEFAULT_MEMORY_SCHEMA, tableInput = DEFAULT_VECTOR_TABLE, dimension?: number): string {
  const schema = validateIdentifier(schemaInput, "schema");
  const table = validateIdentifier(tableInput, "table");
  if (dimension !== undefined && (!Number.isInteger(dimension) || dimension <= 0)) {
    throw new MemoryValidationError("dimension must be a positive integer");
  }
  const q = quoteIdentifier(schema);
  const t = `${q}.${quoteIdentifier(table)}`;
  return `
${
  dimension === undefined
    ? ""
    : `CREATE INDEX IF NOT EXISTS ${table}_embedding_hnsw ON ${t} USING hnsw (embedding vector_cosine_ops);
`
}ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS text_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
CREATE INDEX IF NOT EXISTS ${table}_text_tsv_idx ON ${t} USING gin (text_tsv);
CREATE INDEX IF NOT EXISTS ${table}_lineage_source_idx ON ${t} USING gin ((metadata -> '_lineage' -> 'sourceIds'));
`;
}
