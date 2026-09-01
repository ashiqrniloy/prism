import { qualifyPromptTable, quotePromptIdentifier, validatePromptIdentifier } from "./postgres-identifiers.js";

export const DEFAULT_PROMPT_SCHEMA = "prism";

export function buildPromptMigration001Ddl(schemaInput = DEFAULT_PROMPT_SCHEMA): string {
  const schema = validatePromptIdentifier(schemaInput, "schema");
  const q = quotePromptIdentifier(schema);
  const table = (name: string) => qualifyPromptTable(schema, name);
  const index = (name: string) => quotePromptIdentifier(name);
  return `
CREATE SCHEMA IF NOT EXISTS ${q};
CREATE TABLE IF NOT EXISTS ${table("prism_prompt_migrations")} (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  checksum TEXT NOT NULL,
  UNIQUE (name, version)
);
CREATE TABLE IF NOT EXISTS ${table("prism_prompts")} (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  body TEXT NOT NULL,
  hash TEXT NOT NULL,
  labels JSONB NOT NULL,
  metadata JSONB,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, account_id, user_id, name, version)
);
CREATE TABLE IF NOT EXISTS ${table("prism_prompt_labels")} (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (tenant_id, account_id, user_id, name, version, label),
  FOREIGN KEY (tenant_id, account_id, user_id, name, version)
    REFERENCES ${table("prism_prompts")} (tenant_id, account_id, user_id, name, version)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ${index("prism_prompts_list_idx")}
  ON ${table("prism_prompts")} (tenant_id, account_id, user_id, name, version);
CREATE INDEX IF NOT EXISTS ${index("prism_prompt_labels_resolve_idx")}
  ON ${table("prism_prompt_labels")} (tenant_id, account_id, user_id, name, label, version);
`;
}

export function buildPromptMigrationMetaDdl(schemaInput = DEFAULT_PROMPT_SCHEMA): string {
  const schema = validatePromptIdentifier(schemaInput, "schema");
  const q = quotePromptIdentifier(schema);
  return `
CREATE SCHEMA IF NOT EXISTS ${q};
CREATE TABLE IF NOT EXISTS ${qualifyPromptTable(schema, "prism_prompt_migrations")} (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  checksum TEXT NOT NULL,
  UNIQUE (name, version)
);`;
}
