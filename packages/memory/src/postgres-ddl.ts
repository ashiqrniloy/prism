import { validateIdentifier, quoteIdentifier } from "./postgres-identifiers.js";

export const DEFAULT_MEMORY_SCHEMA = "prism_memory";

export function buildMemoryDdl(schemaInput = DEFAULT_MEMORY_SCHEMA): string {
  const schema = validateIdentifier(schemaInput, "schema");
  const q = quoteIdentifier(schema);
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
CREATE TABLE IF NOT EXISTS ${q}.semantic_memory (
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
CREATE INDEX IF NOT EXISTS semantic_memory_scope_seq_idx
  ON ${q}.semantic_memory (tenant_id, resource_id, thread_id, sequence);
`;
}
