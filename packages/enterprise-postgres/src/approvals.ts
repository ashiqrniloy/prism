import { randomUUID } from "node:crypto";
import type { PersistencePage } from "@arnilo/prism";
import {
  APPROVAL_HARD_LIMITS,
  type ApprovalAuthority,
  type ApprovalConsumeInput,
  type ApprovalDecision,
  type ApprovalQueryClient,
  type ApprovalRecord,
  type ApprovalRequest,
  type ApprovalRequirement,
  type ApprovalRoleGrant,
  type ApprovalStatus,
  type ApprovalStore,
  type PolicyActorRef,
  PolicyError,
  prepareApprovalConsume,
  prepareApprovalCreate,
  prepareApprovalDecision,
  prepareApprovalRevoke,
} from "@arnilo/prism-policy";
import type { Pool } from "pg";
import { decodeBoundedJson, encodeBoundedJson } from "./codecs.js";
import { EnterprisePostgresError } from "./errors.js";
import { qualifyTable } from "./identifiers.js";
import {
  asTimestamp,
  decodeRecordCursor,
  deepFreeze,
  encodeRecordCursor,
  optionalText,
  requiredText,
  type StoreOwner,
  storeError,
} from "./records.js";

const STATUSES = new Set<ApprovalStatus>(["pending", "approved", "rejected", "revoked", "consumed"]);
const DECISION_VALUES = new Set(["approve", "reject"]);
const L = APPROVAL_HARD_LIMITS;
const APPROVAL_COLUMNS = `id, tenant_id, requester::text AS requester, action::text AS action, requirements::text AS requirements,
  separate_from_requester, delegation_max_depth, policy_revision, status, revision, decisions::text AS decisions,
  last_action_ref, created_at, updated_at, expires_at`;

export interface PostgresApprovalStoreOptions {
  /** Existing `pg` pool; caller retains lifecycle ownership. */
  readonly pool: Pool;
  /** Validated PostgreSQL schema. Defaults to `prism`. */
  readonly schema?: string;
  /** Host-owned role/authority resolution and policy revision. */
  readonly authority: ApprovalAuthority;
}

/** PostgreSQL implementation of the multi-party approval store. One locked row per request. */
export function createPostgresApprovalStore(options: PostgresApprovalStoreOptions): ApprovalStore {
  if (!options?.pool) {
    throw new EnterprisePostgresError("pool is required", "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG");
  }
  if (!options.authority || typeof options.authority.resolveRoles !== "function") {
    throw new EnterprisePostgresError("approval authority resolveRoles is required", "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG");
  }
  const schema = options.schema ?? "prism";
  const table = qualifyTable(schema, "prism_erp_approvals");
  const authority = options.authority;

  return {
    async create(input) {
      input.signal?.throwIfAborted();
      const prepared = prepareApprovalCreate(input, { authority, now: Date.now() }, randomId());
      try {
        const result = await options.pool.query(
          `INSERT INTO ${table} (
            id, tenant_id, requester, action, requirements, separate_from_requester, delegation_max_depth,
            policy_revision, status, revision, decisions, last_action_ref, created_at, updated_at, expires_at
          ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, 'pending', 1, '[]'::jsonb, NULL, now(), now(), $9)
          RETURNING ${APPROVAL_COLUMNS}`,
          [
            prepared.request.id,
            prepared.request.tenantId,
            encodeBoundedJson(prepared.request.requester, L.maxActorJsonBytes, "approval requester"),
            encodeBoundedJson(prepared.request.action, L.maxDigestBytes + L.maxKindBytes, "approval action"),
            encodeBoundedJson(prepared.request.requirements, L.maxRequirementJsonBytes, "approval requirements"),
            prepared.request.separateFromRequester,
            prepared.request.delegationMaxDepth,
            prepared.policyRevision,
            prepared.request.expiresAt,
          ],
        );
        return rowToApproval(result.rows[0] as Record<string, unknown>);
      } catch (error) {
        throw approvalError(error);
      }
    },

    async decide(input) {
      input.signal?.throwIfAborted();
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        const current = await lockedRecord(client, table, input.tenantId, input.requestId);
        const prepared = await prepareApprovalDecision(current, input, { authority, now: Date.now() });
        const record = prepared.changed
          ? await writeTransition(client, table, current, prepared.status, prepared.nextRevision, prepared.lastActionRef, prepared.decision)
          : current;
        await client.query("COMMIT");
        return record;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the decide error.
        }
        throw approvalError(error);
      } finally {
        client.release();
      }
    },

    async revoke(input) {
      input.signal?.throwIfAborted();
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        const current = await lockedRecord(client, table, input.tenantId, input.requestId);
        const prepared = prepareApprovalRevoke(current, input, { authority, now: Date.now() });
        const record = await writeTransition(
          client,
          table,
          current,
          prepared.status,
          prepared.nextRevision,
          prepared.lastActionRef,
          undefined,
        );
        await client.query("COMMIT");
        return record;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the revoke error.
        }
        throw approvalError(error);
      } finally {
        client.release();
      }
    },

    async consume(input) {
      input.signal?.throwIfAborted();
      if (input.client !== undefined) {
        return consumeOn(input.client, table, input, authority);
      }
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        const record = await consumeOn(client, table, input, authority);
        await client.query("COMMIT");
        return record;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the consume error.
        }
        throw approvalError(error);
      } finally {
        client.release();
      }
    },

    async get(input) {
      input.signal?.throwIfAborted();
      const tenantId = text(input.tenantId, "approval tenant");
      const id = text(input.requestId, "approval id");
      try {
        const result = await options.pool.query(`SELECT ${APPROVAL_COLUMNS} FROM ${table} WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          id,
        ]);
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row === undefined ? null : rowToApproval(row);
      } catch (error) {
        throw approvalError(error);
      }
    },

    async query(query) {
      query.signal?.throwIfAborted();
      const owner: StoreOwner = { tenantId: text(query.tenantId, "approval tenant") };
      const limit = resolvePageLimit(query.limit);
      const order = query.order === "desc" ? "desc" : "asc";
      const filters = ["tenant_id = $1"];
      const params: unknown[] = [owner.tenantId];
      if (query.status !== undefined) {
        if (!STATUSES.has(query.status)) {
          throw new PolicyError("status must be pending|approved|rejected|revoked|consumed", "ERR_PRISM_POLICY_VALIDATION");
        }
        params.push(query.status);
        filters.push(`status = $${params.length}`);
      }
      if (query.cursor) {
        const cursor = decodeRecordCursor(query.cursor, owner, order);
        const index = params.length + 1;
        filters.push(
          order === "asc"
            ? `(created_at > $${index} OR (created_at = $${index + 1} AND id > $${index + 2}))`
            : `(created_at < $${index} OR (created_at = $${index + 1} AND id < $${index + 2}))`,
        );
        params.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      params.push(limit + 1);
      try {
        const result = await options.pool.query(
          `SELECT ${APPROVAL_COLUMNS} FROM ${table}
           WHERE ${filters.join(" AND ")}
           ORDER BY created_at ${order.toUpperCase()}, id ${order.toUpperCase()}
           LIMIT $${params.length}`,
          params,
        );
        const rows = result.rows as Array<Record<string, unknown>>;
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const items = pageRows.map((row) => rowToApproval(row));
        const last = items.at(-1);
        return {
          items,
          nextCursor: hasMore && last ? encodeRecordCursor(last.createdAt, last.id, owner, order) : undefined,
        } satisfies PersistencePage<ApprovalRecord>;
      } catch (error) {
        throw approvalError(error);
      }
    },
  };
}

async function lockedRecord(source: ApprovalQueryClient, table: string, tenantId: string, requestId: string): Promise<ApprovalRecord> {
  const result = await source.query(`SELECT ${APPROVAL_COLUMNS} FROM ${table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [
    text(tenantId, "approval tenant"),
    text(requestId, "approval id"),
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) throw new PolicyError("approval request not found", "ERR_PRISM_POLICY_OWNERSHIP");
  return rowToApproval(row);
}

async function writeTransition(
  source: ApprovalQueryClient,
  table: string,
  current: ApprovalRecord,
  status: ApprovalStatus,
  revision: number,
  lastActionRef: string,
  decision: ApprovalDecision | undefined,
): Promise<ApprovalRecord> {
  const decisions = decision === undefined ? current.decisions : [...current.decisions, decision];
  const result = await source.query(
    `UPDATE ${table}
     SET status = $3, revision = $4, decisions = $5::jsonb, last_action_ref = $6, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND revision = $4 - 1
     RETURNING ${APPROVAL_COLUMNS}`,
    [
      current.tenantId,
      current.id,
      status,
      revision,
      encodeBoundedJson(decisions, L.maxDecisionJsonBytes, "approval decisions"),
      lastActionRef,
    ],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) throw new PolicyError("approval transition lost its revision", "ERR_PRISM_POLICY_APPROVAL");
  return rowToApproval(row);
}

async function consumeOn(
  source: ApprovalQueryClient,
  table: string,
  input: ApprovalConsumeInput,
  authority: ApprovalAuthority,
): Promise<ApprovalRecord> {
  const current = await lockedRecord(source, table, input.tenantId, input.requestId);
  const prepared = prepareApprovalConsume(current, input, { authority, now: Date.now() });
  return writeTransition(source, table, current, prepared.status, prepared.nextRevision, prepared.lastActionRef, undefined);
}

function rowToApproval(row: Record<string, unknown>): ApprovalRecord {
  const requester = decodeActor(row.requester, "approval requester");
  const action = decodeAction(row.action);
  const requirements = decodeRequirements(row.requirements);
  const decisions = decodeDecisions(row.decisions);
  const status = requiredText(row.status, "approval status") as ApprovalStatus;
  if (!STATUSES.has(status)) throw new EnterprisePostgresError("Approval row status is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  const request: ApprovalRequest = {
    id: requiredText(row.id, "approval id", L.maxIdBytes),
    tenantId: requiredText(row.tenant_id, "approval tenant", L.maxTenantBytes),
    requester,
    action,
    requirements,
    separateFromRequester: row.separate_from_requester === true,
    delegationMaxDepth: integer(row.delegation_max_depth, "approval depth"),
    expiresAt: asTimestamp(row.expires_at, "approval expiry"),
    createdAt: asTimestamp(row.created_at, "approval createdAt"),
  };
  return deepFreeze({
    ...request,
    status,
    revision: integer(row.revision, "approval revision"),
    policyRevision: requiredText(row.policy_revision, "approval policy revision", L.maxPolicyRevisionBytes),
    decisions,
    ...(optionalText(row.last_action_ref, "approval last action ref", L.maxAuditRefBytes) === undefined
      ? {}
      : { lastActionRef: optionalText(row.last_action_ref, "approval last action ref", L.maxAuditRefBytes) }),
    updatedAt: asTimestamp(row.updated_at, "approval updatedAt"),
  });
}

function decodeActor(value: unknown, label: string): PolicyActorRef {
  const actor = toObject(value, L.maxActorJsonBytes, label);
  return deepFreeze({
    tenantId: requiredText(actor.tenantId, "approval actor tenant", L.maxTenantBytes),
    ...(actor.accountId === undefined ? {} : { accountId: requiredText(actor.accountId, "approval actor account", L.maxIdBytes) }),
    ...(actor.userId === undefined ? {} : { userId: requiredText(actor.userId, "approval actor user", L.maxIdBytes) }),
    principalId: requiredText(actor.principalId, "approval actor principal", L.maxIdBytes),
    principalKind: requiredText(actor.principalKind, "approval actor kind", L.maxIdBytes),
    ...(actor.sponsorId === undefined ? {} : { sponsorId: requiredText(actor.sponsorId, "approval actor sponsor", L.maxIdBytes) }),
  });
}

function decodeAction(value: unknown): ApprovalRequest["action"] {
  const action = toObject(value, L.maxDigestBytes + L.maxKindBytes, "approval action");
  return deepFreeze({
    kind: requiredText(action.kind, "approval action kind", L.maxKindBytes),
    digest: requiredText(action.digest, "approval action digest", L.maxDigestBytes),
  });
}

function decodeRequirements(value: unknown): readonly ApprovalRequirement[] {
  const decoded = decodeBoundedJson(value, L.maxRequirementJsonBytes, "approval requirements");
  if (!Array.isArray(decoded) || decoded.length < 1 || decoded.length > L.maxRequirements) {
    throw new EnterprisePostgresError("Approval requirements are invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const roles = new Set<string>();
  return deepFreeze(
    decoded.map((entry, index) => {
      const requirement = toObject(entry, L.maxRequirementJsonBytes, `approval requirement ${index}`);
      const role = requiredText(requirement.role, "approval role", L.maxRoleBytes);
      if (roles.has(role)) throw new EnterprisePostgresError("Approval roles are duplicated", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
      roles.add(role);
      return deepFreeze({ role, quorum: integer(requirement.quorum, "approval quorum") });
    }),
  );
}

function decodeDecisions(value: unknown): readonly ApprovalDecision[] {
  const decoded = decodeBoundedJson(value, L.maxDecisionJsonBytes, "approval decisions");
  if (!Array.isArray(decoded) || decoded.length > L.maxDecisions) {
    throw new EnterprisePostgresError("Approval decisions are invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return deepFreeze(
    decoded.map((entry, index) => {
      const decision = toObject(entry, L.maxDecisionJsonBytes, `approval decision ${index}`);
      const decisionValue = decision.decision;
      if (typeof decisionValue !== "string" || !DECISION_VALUES.has(decisionValue)) {
        throw new EnterprisePostgresError("Approval decision value is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
      }
      return deepFreeze({
        id: requiredText(decision.id, "approval decision id", L.maxIdBytes),
        actor: decodeActor(decision.actor, "approval decision actor"),
        role: requiredText(decision.role, "approval decision role", L.maxRoleBytes),
        decision: decisionValue as "approve" | "reject",
        grant: decodeGrant(decision.grant),
        ...(decision.reason === undefined ? {} : { reason: requiredText(decision.reason, "approval reason", L.maxReasonBytes) }),
        auditRef: requiredText(decision.auditRef, "approval audit reference", L.maxAuditRefBytes),
        createdAt: asTimestamp(decision.createdAt, "approval decision createdAt"),
      });
    }),
  );
}

function decodeGrant(value: unknown): ApprovalRoleGrant {
  const grant = toObject(value, L.maxDecisionJsonBytes / 4, "approval role grant");
  const role = requiredText(grant.role, "approval role", L.maxRoleBytes);
  const expiresAt = optionalText(grant.expiresAt, "approval role grant expiry");
  const chain = grant.delegatedFrom;
  return deepFreeze({
    role,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(chain === undefined
      ? {}
      : {
          delegatedFrom: deepFreeze((chain as unknown[]).map((ref) => decodeActor(ref, "approval delegation ref"))),
        }),
  });
}

function toObject(value: unknown, maxBytes: number, label: string): Record<string, unknown> {
  const decoded = typeof value === "string" ? decodeBoundedJson(value, maxBytes, label) : value;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return decoded as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  return Number(value);
}

function text(value: unknown, label: string, maxBytes = L.maxTenantBytes): string {
  try {
    return requiredText(value, label, maxBytes);
  } catch {
    throw new PolicyError("invalid approval input", "ERR_PRISM_POLICY_VALIDATION");
  }
}

function randomId(): string {
  return randomUUID();
}

function resolvePageLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new PolicyError("approval limit must be 1..500", "ERR_PRISM_POLICY_BOUNDS");
  }
  return limit;
}

function approvalError(error: unknown): Error {
  if (error instanceof PolicyError || error instanceof EnterprisePostgresError) return error;
  return storeError(error);
}
