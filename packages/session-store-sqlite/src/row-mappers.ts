import type {
  AgentDefinitionRecord,
  AgentEventRecord,
  BranchRecord,
  MigrationRecord,
  RetentionPolicy,
  RunRecord,
  SessionEntry,
  SessionRecord,
  ToolCallRecord,
  UsageRecord,
} from "@arnilo/prism";

export interface SessionEntryRow {
  readonly id: string;
  readonly session_id: string;
  readonly parent_id: string | null;
  readonly run_id: string | null;
  readonly timestamp: string;
  readonly kind: string;
  readonly schema_version: number | null;
  readonly message: string | null;
  readonly event: string | null;
  readonly model: string | null;
  readonly previous_model: string | null;
  readonly label: string | null;
  readonly summary: string | null;
  readonly data: string | null;
  readonly metadata: string | null;
}

export interface RunRow {
  readonly id: string;
  readonly session_id: string;
  readonly branch_id: string | null;
  readonly agent_definition_id: string | null;
  readonly agent_definition_version: string | null;
  readonly status: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly model: string | null;
  readonly provider: string | null;
  readonly idempotency_key: string | null;
  readonly abort_reason: string | null;
  readonly error: string | null;
  readonly tenant_id: string | null;
  readonly account_id: string | null;
  readonly user_id: string | null;
  readonly metadata: string | null;
}

export interface AgentEventRow {
  readonly id: string;
  readonly session_id: string;
  readonly run_id: string | null;
  readonly entry_id: string | null;
  readonly sequence: number;
  readonly type: string;
  readonly timestamp: string;
  readonly event: string;
  readonly redacted: number;
  readonly tenant_id: string | null;
  readonly account_id: string | null;
  readonly user_id: string | null;
  readonly metadata: string | null;
}

export interface ToolCallRow {
  readonly id: string;
  readonly session_id: string;
  readonly run_id: string | null;
  readonly entry_id: string | null;
  readonly tool_call_id: string;
  readonly name: string;
  readonly arguments: string;
  readonly result: string | null;
  readonly status: string | null;
  readonly reason: string | null;
  readonly progress: string | null;
  readonly progress_metadata: string | null;
  readonly progress_at: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly redacted: number;
  readonly tenant_id: string | null;
  readonly account_id: string | null;
  readonly user_id: string | null;
  readonly metadata: string | null;
}

export interface UsageRow {
  readonly id: string;
  readonly session_id: string;
  readonly run_id: string | null;
  readonly entry_id: string | null;
  readonly usage: string;
  readonly recorded_at: string;
  readonly tenant_id: string | null;
  readonly account_id: string | null;
  readonly user_id: string | null;
  readonly metadata: string | null;
}

function parseJson<T>(value: string | null): T | undefined {
  if (value == null) return undefined;
  return JSON.parse(value) as T;
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

export function sessionEntryToRow(entry: SessionEntry): SessionEntryRow {
  return {
    id: entry.id,
    session_id: entry.sessionId,
    parent_id: entry.parentId ?? null,
    run_id: entry.runId ?? null,
    timestamp: entry.timestamp,
    kind: entry.kind,
    schema_version: entry.schemaVersion ?? null,
    message: stringifyJson(entry.message),
    event: stringifyJson(entry.event),
    model: stringifyJson(entry.model),
    previous_model: stringifyJson(entry.previousModel),
    label: entry.label ?? null,
    summary: entry.summary ?? null,
    data: stringifyJson(entry.data),
    metadata: stringifyJson(entry.metadata),
  };
}

export function rowToSessionEntry(row: SessionEntryRow): SessionEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id ?? undefined,
    runId: row.run_id ?? undefined,
    timestamp: row.timestamp,
    kind: row.kind as SessionEntry["kind"],
    schemaVersion: row.schema_version === 1 ? 1 : undefined,
    message: parseJson(row.message),
    event: parseJson(row.event),
    model: parseJson(row.model),
    previousModel: parseJson(row.previous_model),
    label: row.label ?? undefined,
    summary: row.summary ?? undefined,
    data: parseJson(row.data),
    metadata: parseJson(row.metadata),
  };
}

export function runRecordToRow(record: RunRecord): RunRow {
  return {
    id: record.id,
    session_id: record.sessionId,
    branch_id: record.branchId ?? null,
    agent_definition_id: record.agentDefinitionId ?? null,
    agent_definition_version: record.agentDefinitionVersion ?? null,
    status: record.status ?? null,
    started_at: record.startedAt,
    finished_at: record.finishedAt ?? null,
    model: stringifyJson(record.model),
    provider: record.provider ?? null,
    idempotency_key: record.idempotencyKey ?? null,
    abort_reason: record.abortReason ?? null,
    error: stringifyJson(record.error),
    tenant_id: record.tenantId ?? null,
    account_id: record.accountId ?? null,
    user_id: record.userId ?? null,
    metadata: stringifyJson(record.metadata),
  };
}

export function rowToRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    branchId: row.branch_id ?? undefined,
    agentDefinitionId: row.agent_definition_id ?? undefined,
    agentDefinitionVersion: row.agent_definition_version ?? undefined,
    status: (row.status ?? undefined) as RunRecord["status"],
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    model: parseJson(row.model),
    provider: row.provider ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    abortReason: row.abort_reason ?? undefined,
    error: parseJson(row.error),
    tenantId: row.tenant_id ?? undefined,
    accountId: row.account_id ?? undefined,
    userId: row.user_id ?? undefined,
    metadata: parseJson(row.metadata),
  };
}

export function agentEventRecordToRow(record: AgentEventRecord, sequence: number): AgentEventRow {
  return {
    id: record.id,
    session_id: record.sessionId,
    run_id: record.runId ?? null,
    entry_id: record.entryId ?? null,
    sequence,
    type: record.type,
    timestamp: record.timestamp,
    event: JSON.stringify(record.event),
    redacted: record.redacted ? 1 : 0,
    tenant_id: record.tenantId ?? null,
    account_id: record.accountId ?? null,
    user_id: record.userId ?? null,
    metadata: stringifyJson(record.metadata),
  };
}

export function rowToAgentEventRecord(row: AgentEventRow): AgentEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    entryId: row.entry_id ?? undefined,
    type: row.type as AgentEventRecord["type"],
    timestamp: row.timestamp,
    event: JSON.parse(row.event),
    redacted: row.redacted === 1,
    tenantId: row.tenant_id ?? undefined,
    accountId: row.account_id ?? undefined,
    userId: row.user_id ?? undefined,
    metadata: parseJson(row.metadata),
  };
}

export function toolCallRecordToRow(record: ToolCallRecord): ToolCallRow {
  return {
    id: record.id,
    session_id: record.sessionId,
    run_id: record.runId ?? null,
    entry_id: record.entryId ?? null,
    tool_call_id: record.toolCallId,
    name: record.name,
    arguments: JSON.stringify(record.arguments),
    result: stringifyJson(record.result),
    status: record.status ?? null,
    reason: record.reason ?? null,
    progress: stringifyJson(record.progress),
    progress_metadata: stringifyJson(record.progressMetadata),
    progress_at: record.progressAt ?? null,
    started_at: record.startedAt,
    finished_at: record.finishedAt ?? null,
    redacted: record.redacted ? 1 : 0,
    tenant_id: record.tenantId ?? null,
    account_id: record.accountId ?? null,
    user_id: record.userId ?? null,
    metadata: stringifyJson(record.metadata),
  };
}

export function rowToToolCallRecord(row: ToolCallRow): ToolCallRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    entryId: row.entry_id ?? undefined,
    toolCallId: row.tool_call_id,
    name: row.name,
    arguments: JSON.parse(row.arguments),
    result: parseJson(row.result),
    status: (row.status ?? undefined) as ToolCallRecord["status"],
    reason: row.reason ?? undefined,
    progress: parseJson(row.progress),
    progressMetadata: parseJson(row.progress_metadata),
    progressAt: row.progress_at ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    redacted: row.redacted === 1,
    tenantId: row.tenant_id ?? undefined,
    accountId: row.account_id ?? undefined,
    userId: row.user_id ?? undefined,
    metadata: parseJson(row.metadata),
  };
}

export function usageRecordToRow(record: UsageRecord): UsageRow {
  return {
    id: record.id,
    session_id: record.sessionId,
    run_id: record.runId ?? null,
    entry_id: record.entryId ?? null,
    usage: JSON.stringify(record.usage),
    recorded_at: record.recordedAt,
    tenant_id: record.tenantId ?? null,
    account_id: record.accountId ?? null,
    user_id: record.userId ?? null,
    metadata: stringifyJson(record.metadata),
  };
}

export function rowToUsageRecord(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    entryId: row.entry_id ?? undefined,
    usage: JSON.parse(row.usage),
    recordedAt: row.recorded_at,
    tenantId: row.tenant_id ?? undefined,
    accountId: row.account_id ?? undefined,
    userId: row.user_id ?? undefined,
    metadata: parseJson(row.metadata),
  };
}

export function rowToSessionRecord(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
    accountId: row.account_id ? String(row.account_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    parentSessionId: row.parent_session_id ? String(row.parent_session_id) : undefined,
    agentDefinitionId: row.agent_definition_id ? String(row.agent_definition_id) : undefined,
    agentDefinitionVersion: row.agent_definition_version ? String(row.agent_definition_version) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiresAt: row.expires_at ? String(row.expires_at) : undefined,
    retentionPolicyId: row.retention_policy_id ? String(row.retention_policy_id) : undefined,
    metadata: parseJson(row.metadata as string | null),
  };
}

export function rowToBranchRecord(row: Record<string, unknown>): BranchRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    name: row.name ? String(row.name) : undefined,
    rootEntryId: row.root_entry_id ? String(row.root_entry_id) : undefined,
    parentBranchId: row.parent_branch_id ? String(row.parent_branch_id) : undefined,
    leafEntryId: row.leaf_entry_id ? String(row.leaf_entry_id) : undefined,
    createdAt: String(row.created_at),
    metadata: parseJson(row.metadata as string | null),
  };
}

export function rowToAgentDefinitionRecord(row: Record<string, unknown>): AgentDefinitionRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    version: String(row.version),
    source: row.source ? String(row.source) : undefined,
    agentDefinition: JSON.parse(String(row.agent_definition)),
    tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
    accountId: row.account_id ? String(row.account_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    createdAt: String(row.created_at),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    metadata: parseJson(row.metadata as string | null),
  };
}

export function rowToRetentionPolicy(row: Record<string, unknown>): RetentionPolicy {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
    accountId: row.account_id ? String(row.account_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    name: row.name ? String(row.name) : undefined,
    maxAgeDays: row.max_age_days == null ? undefined : Number(row.max_age_days),
    maxEntriesPerSession: row.max_entries_per_session == null ? undefined : Number(row.max_entries_per_session),
    maxTotalBytes: row.max_total_bytes == null ? undefined : Number(row.max_total_bytes),
    archiveStore: row.archive_store ? String(row.archive_store) : undefined,
    appliedKinds: parseJson(row.applied_kinds as string | null),
    createdAt: String(row.created_at),
    metadata: parseJson(row.metadata as string | null),
  };
}

export function rowToMigrationRecord(row: Record<string, unknown>): MigrationRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    version: String(row.version),
    appliedAt: String(row.applied_at),
    appliedBy: row.applied_by ? String(row.applied_by) : undefined,
    checksum: row.checksum ? String(row.checksum) : undefined,
    metadata: parseJson(row.metadata as string | null),
  };
}

export function encodeEntryCursor(timestamp: string, id: string): string {
  return `${timestamp}\u0000${id}`;
}

export function decodeEntryCursor(cursor: string): { timestamp: string; id: string } {
  const split = cursor.indexOf("\u0000");
  if (split < 0) throw new Error("Invalid entry pagination cursor");
  return { timestamp: cursor.slice(0, split), id: cursor.slice(split + 1) };
}

export function parentKey(parentId: string | undefined): string {
  return parentId ?? "";
}
