import { qualifyTable, quoteIdentifier } from "./identifiers.js";

/** Fixed table names; no runtime table name is accepted. */
export const ENTERPRISE_TABLE_NAMES = [
  "prism_enterprise_migrations",
  "prism_policy_decisions",
  "prism_evaluations",
  "prism_work_idempotency",
  "prism_tool_effects",
  "prism_model_router_budgets",
  "prism_model_router_rates",
  "prism_model_router_circuits",
  "prism_erp_outbox",
  "prism_erp_inbox",
  "prism_erp_approvals",
] as const;

/** Required query/cleanup indexes verified from the PostgreSQL catalog on open. */
export const ENTERPRISE_INDEX_NAMES = [
  "prism_policy_decisions_owner_created_idx",
  "prism_policy_decisions_owner_policy_created_idx",
  "prism_policy_decisions_owner_outcome_created_idx",
  "prism_evaluations_owner_created_idx",
  "prism_evaluations_owner_scorer_created_idx",
  "prism_evaluations_owner_session_created_idx",
  "prism_evaluations_owner_run_created_idx",
  "prism_evaluations_owner_experiment_created_idx",
  "prism_evaluations_owner_dataset_item_created_idx",
  "prism_work_idempotency_expiry_idx",
  "prism_tool_effects_expiry_idx",
  "prism_tool_effects_cleanup_idx",
  "prism_model_router_budgets_expiry_idx",
  "prism_model_router_rates_expiry_idx",
  "prism_model_router_circuits_expiry_idx",
  "prism_erp_outbox_claim_idx",
  "prism_erp_outbox_lease_idx",
  "prism_erp_inbox_created_idx",
  "prism_erp_approvals_status_idx",
  "prism_erp_approvals_created_idx",
] as const;

/** One canonical enterprise schema migration. Only validated schema identifiers enter this SQL text. */
export function buildEnterpriseMigration001Ddl(schema: string): string {
  const schemaQuoted = quoteIdentifier(schema);
  const table = (name: string) => qualifyTable(schema, name);

  return `
CREATE SCHEMA IF NOT EXISTS ${schemaQuoted};

CREATE TABLE IF NOT EXISTS ${table("prism_enterprise_migrations")} (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS ${table("prism_policy_decisions")} (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('allow', 'deny', 'modify', 'approval')),
  actor JSONB NOT NULL,
  target JSONB NOT NULL,
  reason TEXT,
  evidence_refs JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS prism_policy_decisions_owner_created_idx
  ON ${table("prism_policy_decisions")} (tenant_id, account_key, user_key, created_at, id);
CREATE INDEX IF NOT EXISTS prism_policy_decisions_owner_policy_created_idx
  ON ${table("prism_policy_decisions")} (tenant_id, account_key, user_key, policy_id, policy_version, created_at, id);
CREATE INDEX IF NOT EXISTS prism_policy_decisions_owner_outcome_created_idx
  ON ${table("prism_policy_decisions")} (tenant_id, account_key, user_key, outcome, created_at, id);

CREATE TABLE IF NOT EXISTS ${table("prism_evaluations")} (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  scorer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scored', 'skipped', 'failed')),
  score DOUBLE PRECISION,
  reason TEXT,
  sampled BOOLEAN NOT NULL,
  session_id TEXT,
  run_id TEXT,
  trace_id TEXT,
  dataset_id TEXT,
  item_id TEXT,
  experiment_id TEXT,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS prism_evaluations_owner_created_idx
  ON ${table("prism_evaluations")} (tenant_id, account_key, user_key, created_at, id);
CREATE INDEX IF NOT EXISTS prism_evaluations_owner_scorer_created_idx
  ON ${table("prism_evaluations")} (tenant_id, account_key, user_key, scorer_id, created_at, id);
CREATE INDEX IF NOT EXISTS prism_evaluations_owner_session_created_idx
  ON ${table("prism_evaluations")} (tenant_id, account_key, user_key, session_id, created_at, id);
CREATE INDEX IF NOT EXISTS prism_evaluations_owner_run_created_idx
  ON ${table("prism_evaluations")} (tenant_id, account_key, user_key, run_id, created_at, id);
CREATE INDEX IF NOT EXISTS prism_evaluations_owner_experiment_created_idx
  ON ${table("prism_evaluations")} (tenant_id, account_key, user_key, experiment_id, created_at, id);
CREATE INDEX IF NOT EXISTS prism_evaluations_owner_dataset_item_created_idx
  ON ${table("prism_evaluations")} (tenant_id, account_key, user_key, dataset_id, item_id, created_at, id);

CREATE TABLE IF NOT EXISTS ${table("prism_work_idempotency")} (
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  op TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed_retryable', 'failed_terminal', 'unknown')),
  attempt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  claim_token TEXT,
  result JSONB,
  failure JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, account_key, user_key, principal_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS prism_work_idempotency_expiry_idx
  ON ${table("prism_work_idempotency")} (tenant_id, account_key, user_key, principal_id, status, expires_at, idempotency_key)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${table("prism_model_router_budgets")} (
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  window_ms BIGINT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  tokens DOUBLE PRECISION NOT NULL,
  cost_usd DOUBLE PRECISION NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, account_key, user_key, principal_id, provider, model, window_ms)
);
CREATE INDEX IF NOT EXISTS prism_model_router_budgets_expiry_idx
  ON ${table("prism_model_router_budgets")} (tenant_id, account_key, user_key, principal_id, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${table("prism_model_router_rates")} (
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  window_ms BIGINT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, account_key, user_key, principal_id, provider, model, window_ms)
);
CREATE INDEX IF NOT EXISTS prism_model_router_rates_expiry_idx
  ON ${table("prism_model_router_rates")} (tenant_id, account_key, user_key, principal_id, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${table("prism_model_router_circuits")} (
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  failures INTEGER NOT NULL,
  cool_down_ms BIGINT NOT NULL,
  open_until TIMESTAMPTZ NOT NULL,
  probe_token TEXT,
  probe_expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, account_key, user_key, principal_id, provider, model)
);
CREATE INDEX IF NOT EXISTS prism_model_router_circuits_expiry_idx
  ON ${table("prism_model_router_circuits")} (tenant_id, account_key, user_key, principal_id, expires_at)
  WHERE expires_at IS NOT NULL;
`;
}

/** Adds durable generic tool effects without mutating migration 001. */
export function buildEnterpriseMigration002Ddl(schema: string): string {
  const table = (name: string) => qualifyTable(schema, name);
  return `
CREATE TABLE IF NOT EXISTS ${table("prism_tool_effects")} (
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'completed', 'failed_retryable', 'failed_terminal', 'unknown')),
  attempt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  claim_token TEXT,
  result JSONB,
  result_ref TEXT,
  failure JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, account_key, user_key, principal_id, effect_key)
);
CREATE INDEX IF NOT EXISTS prism_tool_effects_expiry_idx
  ON ${table("prism_tool_effects")} (tenant_id, account_key, user_key, principal_id, status, expires_at, effect_key)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS prism_tool_effects_cleanup_idx
  ON ${table("prism_tool_effects")} (tenant_id, account_key, user_key, status, updated_at, effect_key)
  WHERE status IN ('completed', 'failed_terminal');
`;
}

/** Adds atomic budget reservations (JSONB slot per budget window) without mutating migrations 001/002. */
export function buildEnterpriseMigration003Ddl(schema: string): string {
  const table = (name: string) => qualifyTable(schema, name);
  return `
ALTER TABLE ${table("prism_model_router_budgets")}
  ADD COLUMN IF NOT EXISTS reservations JSONB NOT NULL DEFAULT '[]'::jsonb;
`;
}

/** Adds tenant-scoped transactional messaging state without mutating earlier migrations. */
export function buildEnterpriseMigration004Ddl(schema: string): string {
  const table = (name: string) => qualifyTable(schema, name);
  return `
CREATE TABLE IF NOT EXISTS ${table("prism_erp_outbox")} (
  tenant_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'retryable', 'completed', 'unknown', 'dead_letter')),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  claim_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error JSONB,
  last_action_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, message_id)
);
CREATE INDEX IF NOT EXISTS prism_erp_outbox_claim_idx
  ON ${table("prism_erp_outbox")} (tenant_id, next_attempt_at, created_at, message_id)
  WHERE status IN ('pending', 'retryable');
CREATE INDEX IF NOT EXISTS prism_erp_outbox_lease_idx
  ON ${table("prism_erp_outbox")} (tenant_id, status, lease_expires_at, updated_at, message_id)
  WHERE status = 'dispatched';

CREATE TABLE IF NOT EXISTS ${table("prism_erp_inbox")} (
  tenant_id TEXT NOT NULL,
  consumer TEXT NOT NULL,
  message_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, consumer, message_id)
);
CREATE INDEX IF NOT EXISTS prism_erp_inbox_created_idx
  ON ${table("prism_erp_inbox")} (tenant_id, consumer, recorded_at, message_id);
`;
}

/** Adds multi-party approval records without mutating earlier migrations. */
export function buildEnterpriseMigration005Ddl(schema: string): string {
  const table = (name: string) => qualifyTable(schema, name);
  return `
CREATE TABLE IF NOT EXISTS ${table("prism_erp_approvals")} (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  requester JSONB NOT NULL,
  action JSONB NOT NULL,
  requirements JSONB NOT NULL,
  separate_from_requester BOOLEAN NOT NULL,
  delegation_max_depth INTEGER NOT NULL,
  policy_revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked', 'consumed')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_action_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS prism_erp_approvals_status_idx
  ON ${table("prism_erp_approvals")} (tenant_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS prism_erp_approvals_created_idx
  ON ${table("prism_erp_approvals")} (tenant_id, created_at, id);
`;
}
