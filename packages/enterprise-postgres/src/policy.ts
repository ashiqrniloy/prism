import type { PersistencePage } from "@arnilo/prism";
import {
  PolicyError,
  preparePolicyDecision,
  requireOwnership,
  resolvePolicyLimits,
  type PolicyActorRef,
  type PolicyDecisionOutcome,
  type PolicyDecisionRecord,
  type PolicyDecisionStore,
  type PolicyTarget,
  type ResolvedPolicyLimits,
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
  isSqlState,
  optionalText,
  requiredText,
  storeError,
  type StoreOwner,
} from "./records.js";

const OUTCOMES = new Set<PolicyDecisionOutcome>(["allow", "deny", "modify", "approval"]);

/** PostgreSQL implementation of the append-only policy decision ledger. */
export function createPostgresPolicyDecisionStore(pool: Pool, schema: string): PolicyDecisionStore {
  const table = qualifyTable(schema, "prism_policy_decisions");
  const limits = resolvePolicyLimits();

  return {
    async append(input) {
      input.signal?.throwIfAborted();
      const record = preparePolicyDecision(input);
      try {
        await pool.query(
          `INSERT INTO ${table} (
            id, tenant_id, account_key, user_key, policy_id, policy_version, outcome,
            actor, target, reason, evidence_refs, created_at, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12, $13)`,
          [
            record.id,
            record.tenantId,
            record.accountId ?? "",
            record.userId ?? "",
            record.policyId,
            record.policyVersion,
            record.outcome,
            encodeBoundedJson(record.actor, limits.maxDecisionBytes, "policy actor"),
            encodeBoundedJson(record.target, limits.maxDecisionBytes, "policy target"),
            record.reason ?? null,
            encodeBoundedJson(record.evidenceRefs, limits.maxDecisionBytes, "policy evidence"),
            record.createdAt,
            record.expiresAt ?? null,
          ],
        );
      } catch (error) {
        if (isSqlState(error, "23505")) throw new PolicyError("Duplicate policy decision id", "ERR_PRISM_POLICY_DUPLICATE");
        throw storeError(error);
      }
      input.signal?.throwIfAborted();
      return record;
    },

    async query(query) {
      query.signal?.throwIfAborted();
      const ownership = requireOwnership(query);
      const owner: StoreOwner = {
        tenantId: requiredText(ownership.tenantId, "policy tenant"),
        ...(ownership.accountId === undefined ? {} : { accountId: requiredText(ownership.accountId, "policy account") }),
        ...(ownership.userId === undefined ? {} : { userId: requiredText(ownership.userId, "policy user") }),
      };
      const limit = resolvePageLimit(query.limit, limits.maxExportPageSize);
      const order = query.order === "desc" ? "desc" : "asc";
      const filters = ["tenant_id = $1", "account_key = $2", "user_key = $3"];
      const params: unknown[] = [owner.tenantId, owner.accountId ?? "", owner.userId ?? ""];
      addFilter(filters, params, "policy_id", query.policyId, limits.maxPolicyIdBytes);
      addFilter(filters, params, "policy_version", query.policyVersion, limits.maxPolicyVersionBytes);
      if (query.outcome !== undefined && !OUTCOMES.has(query.outcome)) {
        throw new PolicyError("outcome must be allow|deny|modify|approval", "ERR_PRISM_POLICY_VALIDATION");
      }
      addFilter(filters, params, "outcome", query.outcome, 16);
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
        const result = await pool.query(
          `SELECT id, tenant_id, account_key, user_key, policy_id, policy_version, outcome,
                  actor::text AS actor, target::text AS target, reason, evidence_refs::text AS evidence_refs,
                  created_at, expires_at
           FROM ${table}
           WHERE ${filters.join(" AND ")}
           ORDER BY created_at ${order.toUpperCase()}, id ${order.toUpperCase()}
           LIMIT $${params.length}`,
          params,
        );
        const rows = result.rows as Array<Record<string, unknown>>;
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const items = pageRows.map((row) => rowToPolicyDecision(row, limits));
        const last = items.at(-1);
        return {
          items,
          nextCursor: hasMore && last ? encodeRecordCursor(last.createdAt, last.id, owner, order) : undefined,
        } satisfies PersistencePage<PolicyDecisionRecord>;
      } catch (error) {
        throw storeError(error);
      }
    },
  };
}

function addFilter(filters: string[], params: unknown[], column: string, value: string | undefined, maxBytes: number): void {
  if (value === undefined) return;
  params.push(requiredText(value, `policy ${column}`, maxBytes));
  filters.push(`${column} = $${params.length}`);
}

function resolvePageLimit(value: number | undefined, max: number): number {
  if (value === undefined) return max;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new PolicyError(`limit must be 1..${max}`, "ERR_PRISM_POLICY_BOUNDS");
  }
  return value;
}

function rowToPolicyDecision(row: Record<string, unknown>, limits: ResolvedPolicyLimits): PolicyDecisionRecord {
  const maxBytes = limits.maxDecisionBytes;
  const owner: StoreOwner = {
    tenantId: requiredText(row.tenant_id, "policy tenant"),
    ...(row.account_key === "" ? {} : { accountId: requiredText(row.account_key, "policy account") }),
    ...(row.user_key === "" ? {} : { userId: requiredText(row.user_key, "policy user") }),
  };
  if (owner.accountId === undefined && owner.userId === undefined) {
    throw new EnterprisePostgresError("Policy row ownership is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const actor = decodeActor(row.actor, maxBytes);
  if (actor.tenantId !== owner.tenantId || actor.accountId !== owner.accountId || actor.userId !== owner.userId) {
    throw new EnterprisePostgresError("Policy row ownership is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const outcome = requiredText(row.outcome, "policy outcome") as PolicyDecisionOutcome;
  if (!OUTCOMES.has(outcome)) throw new EnterprisePostgresError("Policy row outcome is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  const evidenceRefs = decodeBoundedJson(row.evidence_refs, maxBytes, "policy evidence");
  if (
    !Array.isArray(evidenceRefs) ||
    evidenceRefs.length > limits.maxEvidenceRefs ||
    !evidenceRefs.every((value) => typeof value === "string" && Buffer.byteLength(value, "utf8") <= limits.maxEvidenceRefBytes)
  ) {
    throw new EnterprisePostgresError("Policy evidence is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  const target = decodeTarget(row.target, limits.maxTargetBytes);
  return deepFreeze({
    id: requiredText(row.id, "policy id", limits.maxIdBytes),
    policyId: requiredText(row.policy_id, "policy id", limits.maxPolicyIdBytes),
    policyVersion: requiredText(row.policy_version, "policy version", limits.maxPolicyVersionBytes),
    outcome,
    actor,
    target,
    ...(optionalText(row.reason, "policy reason", limits.maxReasonBytes) !== undefined
      ? { reason: optionalText(row.reason, "policy reason", limits.maxReasonBytes) }
      : {}),
    evidenceRefs: [...evidenceRefs],
    createdAt: asTimestamp(row.created_at, "policy createdAt"),
    ...(row.expires_at === null ? {} : { expiresAt: asTimestamp(row.expires_at, "policy expiresAt") }),
    ...owner,
  });
}

function decodeActor(value: unknown, maxBytes: number): PolicyActorRef {
  const actor = objectJson(value, maxBytes, "policy actor");
  return deepFreeze({
    tenantId: requiredText(actor.tenantId, "policy actor tenant"),
    ...(actor.accountId === undefined ? {} : { accountId: requiredText(actor.accountId, "policy actor account") }),
    ...(actor.userId === undefined ? {} : { userId: requiredText(actor.userId, "policy actor user") }),
    principalId: requiredText(actor.principalId, "policy actor principal"),
    principalKind: requiredText(actor.principalKind, "policy actor kind"),
    ...(actor.sponsorId === undefined ? {} : { sponsorId: requiredText(actor.sponsorId, "policy actor sponsor") }),
  });
}

function decodeTarget(value: unknown, maxBytes: number): PolicyTarget {
  const target = objectJson(value, maxBytes, "policy target");
  return deepFreeze({ kind: requiredText(target.kind, "policy target kind"), id: requiredText(target.id, "policy target id") });
}

function objectJson(value: unknown, maxBytes: number, label: string): Record<string, unknown> {
  const decoded = decodeBoundedJson(value, maxBytes, label);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new EnterprisePostgresError(`${label} is invalid`, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
  }
  return decoded as Record<string, unknown>;
}
