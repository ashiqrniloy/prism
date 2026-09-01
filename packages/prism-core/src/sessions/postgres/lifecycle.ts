import { randomUUID } from "node:crypto";
import {
  type ApplyRetentionInput,
  type LegalHoldExportItem,
  type LegalHoldRecord,
  type OwnershipScope,
  PersistenceLifecycleError,
  type PersistenceLifecycleStore,
} from "@arnilo/prism";
import type { Pool } from "pg";
import {
  assertOwnershipRequired,
  assertOwnershipScope,
  assertHoldReason as assertReason,
  ownershipScope as ownership,
  lifecyclePageLimit as pageLimit,
  rowToTenantQuota as rowToQuota,
} from "../codecs/index.js";
import { qualifyTable } from "./identifiers.js";

export function createPostgresPersistenceLifecycle(pool: Pool, schema: string): PersistenceLifecycleStore {
  const holds = qualifyTable(schema, "prism_legal_holds");
  const quotas = qualifyTable(schema, "prism_tenant_quotas");
  const sessions = qualifyTable(schema, "prism_sessions");
  const entries = qualifyTable(schema, "prism_session_entries");
  const idempotency = qualifyTable(schema, "prism_session_append_idempotency");
  const events = qualifyTable(schema, "prism_agent_events");
  const eventStreams = qualifyTable(schema, "prism_agent_event_streams");
  const toolCalls = qualifyTable(schema, "prism_tool_calls");
  const usage = qualifyTable(schema, "prism_usage");
  const runs = qualifyTable(schema, "prism_runs");
  const branches = qualifyTable(schema, "prism_branches");
  const search = qualifyTable(schema, "prism_session_search");

  return {
    async putLegalHold(input) {
      assertOwnership(input);
      const reason = assertReason(input.reason);
      const id = input.id ?? randomUUID();
      const createdAt = new Date().toISOString();
      await pool.query(
        `INSERT INTO ${holds} (id, tenant_id, account_id, user_id, resource_kind, resource_id, reason, created_at, created_by, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          input.tenantId ?? null,
          input.accountId ?? null,
          input.userId ?? null,
          input.resourceKind,
          input.resourceId,
          reason,
          createdAt,
          input.createdBy ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
        ],
      );
      return {
        id,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        reason,
        createdAt,
        ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ...ownership(input),
      };
    },

    async releaseLegalHold(input) {
      assertOwnership(input);
      const found = await pool.query(`SELECT tenant_id, account_id, user_id FROM ${holds} WHERE id = $1`, [input.id]);
      if (!found.rowCount) return false;
      const row = found.rows[0]!;
      assertOwnershipScope(
        input,
        {
          tenantId: row.tenant_id ?? undefined,
          accountId: row.account_id ?? undefined,
          userId: row.user_id ?? undefined,
        },
        () => new PersistenceLifecycleError("ownership mismatch", "ERR_PRISM_LIFECYCLE_OWNERSHIP"),
      );
      const result = await pool.query(`DELETE FROM ${holds} WHERE id = $1`, [input.id]);
      return Boolean(result.rowCount);
    },

    async listLegalHolds(query) {
      assertOwnership(query);
      const limit = pageLimit(query.limit);
      const result = await pool.query(
        `SELECT * FROM ${holds}
         WHERE COALESCE(tenant_id,'') = COALESCE($1,'')
           AND COALESCE(account_id,'') = COALESCE($2,'')
           AND COALESCE(user_id,'') = COALESCE($3,'')
           AND ($4::text IS NULL OR id = $4)
           AND ($5::text IS NULL OR resource_kind = $5)
           AND ($6::text IS NULL OR resource_id = $6)
         ORDER BY created_at ASC, id ASC`,
        [
          query.tenantId ?? null,
          query.accountId ?? null,
          query.userId ?? null,
          query.holdId ?? null,
          query.resourceKind ?? null,
          query.resourceId ?? null,
        ],
      );
      const rows = result.rows as Record<string, unknown>[];
      const start = query.cursor ? rows.findIndex((row) => String(row.id) === query.cursor) + 1 : 0;
      const slice = rows.slice(Math.max(0, start), Math.max(0, start) + limit).map(rowToHold);
      const next = start + limit < rows.length ? slice.at(-1)?.id : undefined;
      return { items: slice, ...(next === undefined ? {} : { nextCursor: next }) };
    },

    async applyRetention(input) {
      assertOwnership(input);
      const limit = pageLimit(input.limit);
      const heldResult = await pool.query(
        `SELECT resource_id FROM ${holds}
         WHERE resource_kind = 'session'
           AND COALESCE(tenant_id,'') = COALESCE($1,'')
           AND COALESCE(account_id,'') = COALESCE($2,'')
           AND COALESCE(user_id,'') = COALESCE($3,'')`,
        [input.tenantId ?? null, input.accountId ?? null, input.userId ?? null],
      );
      const held = new Set(heldResult.rows.map((row) => String(row.resource_id)));
      let candidates = input.candidates ? [...input.candidates] : await discoverSessions(pool, sessions, input, limit);
      if (input.cursor && !input.candidates) {
        const idx = candidates.indexOf(input.cursor);
        candidates = idx >= 0 ? candidates.slice(idx + 1) : candidates;
      }
      const page = candidates.slice(0, limit);
      const deleted: string[] = [];
      const skippedHeld: string[] = [];
      for (const id of page) {
        if (held.has(id)) {
          skippedHeld.push(id);
          continue;
        }
        // Whole-session purge: clear ledger children before the session row (FK order).
        // prism_run_feedback cascades from prism_runs; search rows are best-effort cleanup.
        await pool.query(`DELETE FROM ${idempotency} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${eventStreams} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${events} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${toolCalls} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${usage} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${runs} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${branches} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${search} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${entries} WHERE session_id = $1`, [id]);
        await pool.query(`DELETE FROM ${sessions} WHERE id = $1`, [id]);
        deleted.push(id);
      }
      const nextCursor = !input.candidates && candidates.length > limit ? page.at(-1) : undefined;
      return { deleted, skippedHeld, ...(nextCursor === undefined ? {} : { nextCursor }) };
    },

    async exportUnderHold(input) {
      const page = await this.listLegalHolds({
        ...ownership(input),
        holdId: input.holdId,
        resourceKind: input.resourceKind,
        cursor: input.cursor,
        limit: input.limit,
        signal: input.signal,
      });
      return {
        items: page.items.map(
          (hold): LegalHoldExportItem => ({
            holdId: hold.id,
            resourceKind: hold.resourceKind,
            resourceId: hold.resourceId,
            reason: hold.reason,
            createdAt: hold.createdAt,
            redacted: true,
          }),
        ),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },

    async setTenantQuota(input) {
      assertOwnership(input);
      if (!Number.isSafeInteger(input.limit) || input.limit < 0) {
        throw new PersistenceLifecycleError("limit must be a non-negative safe integer", "ERR_PRISM_LIFECYCLE_QUOTA");
      }
      const existing = await pool.query(
        `SELECT id, used_count FROM ${quotas}
         WHERE COALESCE(tenant_id,'') = COALESCE($1,'')
           AND COALESCE(account_id,'') = COALESCE($2,'')
           AND COALESCE(user_id,'') = COALESCE($3,'')
           AND resource_kind = $4`,
        [input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.resourceKind],
      );
      const used = existing.rows[0] ? Number(existing.rows[0].used_count) : 0;
      if (used > input.limit) throw new PersistenceLifecycleError("quota already exceeded", "ERR_PRISM_LIFECYCLE_QUOTA");
      const updatedAt = new Date().toISOString();
      if (existing.rows[0]) {
        await pool.query(`UPDATE ${quotas} SET limit_count = $1, updated_at = $2 WHERE id = $3`, [
          input.limit,
          updatedAt,
          existing.rows[0].id,
        ]);
      } else {
        await pool.query(
          `INSERT INTO ${quotas} (id, tenant_id, account_id, user_id, resource_kind, limit_count, used_count, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
          [randomUUID(), input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.resourceKind, input.limit, updatedAt],
        );
      }
      return { ...ownership(input), resourceKind: input.resourceKind, limit: input.limit, used, updatedAt };
    },

    async getTenantQuota(input) {
      assertOwnership(input);
      const result = await pool.query(
        `SELECT * FROM ${quotas}
         WHERE COALESCE(tenant_id,'') = COALESCE($1,'')
           AND COALESCE(account_id,'') = COALESCE($2,'')
           AND COALESCE(user_id,'') = COALESCE($3,'')
           AND resource_kind = $4`,
        [input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.resourceKind],
      );
      return result.rows[0] ? rowToQuota(result.rows[0] as Record<string, unknown>) : null;
    },

    async consumeTenantQuota(input) {
      assertOwnership(input);
      const delta = input.delta ?? 1;
      if (!Number.isSafeInteger(delta) || delta < 1) {
        throw new PersistenceLifecycleError("delta must be a positive safe integer", "ERR_PRISM_LIFECYCLE_QUOTA");
      }
      const result = await pool.query(
        `SELECT * FROM ${quotas}
         WHERE COALESCE(tenant_id,'') = COALESCE($1,'')
           AND COALESCE(account_id,'') = COALESCE($2,'')
           AND COALESCE(user_id,'') = COALESCE($3,'')
           AND resource_kind = $4`,
        [input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.resourceKind],
      );
      if (!result.rows[0]) throw new PersistenceLifecycleError("tenant quota not configured", "ERR_PRISM_LIFECYCLE_QUOTA");
      const row = result.rows[0] as Record<string, unknown>;
      const used = Number(row.used_count);
      const limit = Number(row.limit_count);
      if (used + delta > limit) {
        throw new PersistenceLifecycleError(`tenant quota exhausted for ${input.resourceKind}`, "ERR_PRISM_LIFECYCLE_QUOTA_EXHAUSTED");
      }
      const updatedAt = new Date().toISOString();
      await pool.query(`UPDATE ${quotas} SET used_count = $1, updated_at = $2 WHERE id = $3`, [used + delta, updatedAt, row.id]);
      return { ...ownership(input), resourceKind: input.resourceKind, limit, used: used + delta, updatedAt };
    },
  };
}

async function discoverSessions(pool: Pool, sessions: string, input: ApplyRetentionInput, limit: number): Promise<string[]> {
  const maxAgeDays = input.policy.maxAgeDays;
  if (maxAgeDays === undefined) return [];
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const result = await pool.query(
    `SELECT id FROM ${sessions}
     WHERE COALESCE(tenant_id,'') = COALESCE($1,'')
       AND COALESCE(account_id,'') = COALESCE($2,'')
       AND COALESCE(user_id,'') = COALESCE($3,'')
       AND (expires_at IS NOT NULL AND expires_at <= $4 OR created_at <= $4)
     ORDER BY created_at ASC, id ASC
     LIMIT $5`,
    [input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, cutoff, limit * 2],
  );
  return result.rows.map((row) => String(row.id));
}

function rowToHold(row: Record<string, unknown>): LegalHoldRecord {
  return {
    id: String(row.id),
    resourceKind: row.resource_kind as LegalHoldRecord["resourceKind"],
    resourceId: String(row.resource_id),
    reason: String(row.reason),
    createdAt: String(row.created_at),
    ...(row.created_by == null ? {} : { createdBy: String(row.created_by) }),
    ...(row.metadata == null ? {} : { metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata as object) }),
    ...(row.tenant_id == null ? {} : { tenantId: String(row.tenant_id) }),
    ...(row.account_id == null ? {} : { accountId: String(row.account_id) }),
    ...(row.user_id == null ? {} : { userId: String(row.user_id) }),
  };
}

function assertOwnership(input: OwnershipScope): void {
  assertOwnershipRequired(input, () => new PersistenceLifecycleError("ownership required", "ERR_PRISM_LIFECYCLE_OWNERSHIP"));
}
