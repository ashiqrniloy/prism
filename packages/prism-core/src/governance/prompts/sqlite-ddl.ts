/** Standalone, package-owned SQLite schema for prompt assets. Values are bound at runtime. */
export const PROMPT_MIGRATION_001_INIT = `
CREATE TABLE IF NOT EXISTS prism_prompt_migrations (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  checksum TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS prism_prompts (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  body TEXT NOT NULL,
  hash TEXT NOT NULL,
  labels TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, account_id, user_id, name, version)
);

CREATE TABLE IF NOT EXISTS prism_prompt_labels (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (tenant_id, account_id, user_id, name, version, label),
  FOREIGN KEY (tenant_id, account_id, user_id, name, version)
    REFERENCES prism_prompts (tenant_id, account_id, user_id, name, version)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS prism_prompts_list_idx
  ON prism_prompts (tenant_id, account_id, user_id, name, version);
CREATE INDEX IF NOT EXISTS prism_prompt_labels_resolve_idx
  ON prism_prompt_labels (tenant_id, account_id, user_id, name, label, version);
`;

export const PROMPT_INDEX_NAMES = ["prism_prompts_list_idx", "prism_prompt_labels_resolve_idx"] as const;
