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
