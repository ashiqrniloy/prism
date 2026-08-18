import { randomUUID } from "node:crypto";
import {
  type ApplyRetentionInput,
  type LegalHoldExportItem,
  type LegalHoldRecord,
  type OwnershipScope,
  PersistenceLifecycleError,
  type PersistenceLifecycleStore,
} from "@arnilo/prism";
import {
  assertOwnershipRequired,
  assertOwnershipScope,
  assertHoldReason as assertReason,
  ownershipScope as ownership,
  lifecyclePageLimit as pageLimit,
  rowToTenantQuota as rowToQuota,
} from "@arnilo/prism-session-store-codecs";
import type Database from "better-sqlite3";

export function createSqlitePersistenceLifecycle(db: Database.Database): PersistenceLifecycleStore {
  return {
    async putLegalHold(input) {
      assertOwnership(input);
      const reason = assertReason(input.reason);
      const id = input.id ?? randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO prism_legal_holds (id, tenant_id, account_id, user_id, resource_kind, resource_id, reason, created_at, created_by, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
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
      const row = db.prepare("SELECT tenant_id, account_id, user_id FROM prism_legal_holds WHERE id = ?").get(input.id) as
        | { tenant_id: string | null; account_id: string | null; user_id: string | null }
        | undefined;
      if (!row) return false;
      assertOwnershipScope(
        input,
        {
          tenantId: row.tenant_id ?? undefined,
          accountId: row.account_id ?? undefined,
          userId: row.user_id ?? undefined,
        },
        () => new PersistenceLifecycleError("ownership mismatch", "ERR_PRISM_LIFECYCLE_OWNERSHIP"),
      );
      return db.prepare("DELETE FROM prism_legal_holds WHERE id = ?").run(input.id).changes > 0;
    },

    async listLegalHolds(query) {
      assertOwnership(query);
      const limit = pageLimit(query.limit);
      const rows = db
        .prepare(
          `SELECT * FROM prism_legal_holds
         WHERE IFNULL(tenant_id,'') = IFNULL(?, '')
           AND IFNULL(account_id,'') = IFNULL(?, '')
           AND IFNULL(user_id,'') = IFNULL(?, '')
           AND (? IS NULL OR id = ?)
           AND (? IS NULL OR resource_kind = ?)
           AND (? IS NULL OR resource_id = ?)
         ORDER BY created_at ASC, id ASC`,
        )
        .all(
          query.tenantId ?? null,
          query.accountId ?? null,
          query.userId ?? null,
          query.holdId ?? null,
          query.holdId ?? null,
          query.resourceKind ?? null,
          query.resourceKind ?? null,
          query.resourceId ?? null,
          query.resourceId ?? null,
        ) as Record<string, unknown>[];
      const start = query.cursor ? rows.findIndex((row) => String(row.id) === query.cursor) + 1 : 0;
      const slice = rows.slice(Math.max(0, start), Math.max(0, start) + limit).map(rowToHold);
      const next = start + limit < rows.length ? slice.at(-1)?.id : undefined;
      return { items: slice, ...(next === undefined ? {} : { nextCursor: next }) };
    },

    async applyRetention(input) {
      assertOwnership(input);
      const limit = pageLimit(input.limit);
      const held = new Set(
        (
          db
            .prepare(
              `SELECT resource_id FROM prism_legal_holds
           WHERE resource_kind = 'session'
             AND IFNULL(tenant_id,'') = IFNULL(?, '')
             AND IFNULL(account_id,'') = IFNULL(?, '')
             AND IFNULL(user_id,'') = IFNULL(?, '')`,
            )
            .all(input.tenantId ?? null, input.accountId ?? null, input.userId ?? null) as { resource_id: string }[]
        ).map((row) => row.resource_id),
      );
      let candidates = input.candidates ? [...input.candidates] : discoverSessions(db, input, limit);
      if (input.cursor && !input.candidates) {
        const idx = candidates.indexOf(input.cursor);
        candidates = idx >= 0 ? candidates.slice(idx + 1) : candidates;
      }
      const page = candidates.slice(0, limit);
      const deleted: string[] = [];
      const skippedHeld: string[] = [];
      // Whole-session purge: clear ledger children before the session row (FK order).
      // prism_run_feedback cascades from prism_runs; search rows are best-effort cleanup.
      const delIdempotency = db.prepare("DELETE FROM prism_session_append_idempotency WHERE session_id = ?");
      const delEventStreams = db.prepare("DELETE FROM prism_agent_event_streams WHERE session_id = ?");
      const delEvents = db.prepare("DELETE FROM prism_agent_events WHERE session_id = ?");
      const delToolCalls = db.prepare("DELETE FROM prism_tool_calls WHERE session_id = ?");
      const delUsage = db.prepare("DELETE FROM prism_usage WHERE session_id = ?");
      const delRuns = db.prepare("DELETE FROM prism_runs WHERE session_id = ?");
      const delBranches = db.prepare("DELETE FROM prism_branches WHERE session_id = ?");
      const delSearch = db.prepare("DELETE FROM prism_session_search_fts WHERE session_id = ?");
      const delEntries = db.prepare("DELETE FROM prism_session_entries WHERE session_id = ?");
      const delSession = db.prepare("DELETE FROM prism_sessions WHERE id = ?");
      for (const id of page) {
        if (held.has(id)) {
          skippedHeld.push(id);
          continue;
        }
        delIdempotency.run(id);
        delEventStreams.run(id);
        delEvents.run(id);
        delToolCalls.run(id);
        delUsage.run(id);
        delRuns.run(id);
        delBranches.run(id);
        delSearch.run(id);
        delEntries.run(id);
        delSession.run(id);
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
      const existing = db
        .prepare(
          `SELECT id, used_count FROM prism_tenant_quotas
         WHERE IFNULL(tenant_id,'') = IFNULL(?, '')
           AND IFNULL(account_id,'') = IFNULL(?, '')
           AND IFNULL(user_id,'') = IFNULL(?, '')
           AND resource_kind = ?`,
        )
        .get(input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.resourceKind) as
        | { id: string; used_count: number }
        | undefined;
      const used = existing?.used_count ?? 0;
      if (used > input.limit) throw new PersistenceLifecycleError("quota already exceeded", "ERR_PRISM_LIFECYCLE_QUOTA");
      const updatedAt = new Date().toISOString();
      if (existing) {
        db.prepare("UPDATE prism_tenant_quotas SET limit_count = ?, updated_at = ? WHERE id = ?").run(input.limit, updatedAt, existing.id);
      } else {
        db.prepare(
          `INSERT INTO prism_tenant_quotas (id, tenant_id, account_id, user_id, resource_kind, limit_count, used_count, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        ).run(
          randomUUID(),
          input.tenantId ?? null,
          input.accountId ?? null,
          input.userId ?? null,
          input.resourceKind,
          input.limit,
          updatedAt,
        );
      }
      return { ...ownership(input), resourceKind: input.resourceKind, limit: input.limit, used, updatedAt };
    },

    async getTenantQuota(input) {
      assertOwnership(input);
      const row = db
        .prepare(
          `SELECT * FROM prism_tenant_quotas
         WHERE IFNULL(tenant_id,'') = IFNULL(?, '')
           AND IFNULL(account_id,'') = IFNULL(?, '')
           AND IFNULL(user_id,'') = IFNULL(?, '')
           AND resource_kind = ?`,
        )
        .get(input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.resourceKind) as
        | Record<string, unknown>
        | undefined;
      return row ? rowToQuota(row) : null;
    },

    async consumeTenantQuota(input) {
      assertOwnership(input);
      const delta = input.delta ?? 1;
      if (!Number.isSafeInteger(delta) || delta < 1) {
        throw new PersistenceLifecycleError("delta must be a positive safe integer", "ERR_PRISM_LIFECYCLE_QUOTA");
      }
      const row = db
        .prepare(
          `SELECT * FROM prism_tenant_quotas
         WHERE IFNULL(tenant_id,'') = IFNULL(?, '')
           AND IFNULL(account_id,'') = IFNULL(?, '')
           AND IFNULL(user_id,'') = IFNULL(?, '')
           AND resource_kind = ?`,
        )
        .get(input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.resourceKind) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new PersistenceLifecycleError("tenant quota not configured", "ERR_PRISM_LIFECYCLE_QUOTA");
      const used = Number(row.used_count);
      const limit = Number(row.limit_count);
      if (used + delta > limit) {
        throw new PersistenceLifecycleError(`tenant quota exhausted for ${input.resourceKind}`, "ERR_PRISM_LIFECYCLE_QUOTA_EXHAUSTED");
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE prism_tenant_quotas SET used_count = ?, updated_at = ? WHERE id = ?").run(used + delta, updatedAt, String(row.id));
      return { ...ownership(input), resourceKind: input.resourceKind, limit, used: used + delta, updatedAt };
    },
  };
}

function discoverSessions(db: Database.Database, input: ApplyRetentionInput, limit: number): string[] {
  const maxAgeDays = input.policy.maxAgeDays;
  if (maxAgeDays === undefined) return [];
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  return (
    db
      .prepare(
        `SELECT id FROM prism_sessions
     WHERE IFNULL(tenant_id,'') = IFNULL(?, '')
       AND IFNULL(account_id,'') = IFNULL(?, '')
       AND IFNULL(user_id,'') = IFNULL(?, '')
       AND (expires_at IS NOT NULL AND expires_at <= ? OR created_at <= ?)
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
      )
      .all(input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, cutoff, cutoff, limit * 2) as { id: string }[]
  ).map((row) => row.id);
}

function rowToHold(row: Record<string, unknown>): LegalHoldRecord {
  return {
    id: String(row.id),
    resourceKind: row.resource_kind as LegalHoldRecord["resourceKind"],
    resourceId: String(row.resource_id),
    reason: String(row.reason),
    createdAt: String(row.created_at),
    ...(row.created_by == null ? {} : { createdBy: String(row.created_by) }),
    ...(row.metadata == null ? {} : { metadata: JSON.parse(String(row.metadata)) }),
    ...(row.tenant_id == null ? {} : { tenantId: String(row.tenant_id) }),
    ...(row.account_id == null ? {} : { accountId: String(row.account_id) }),
    ...(row.user_id == null ? {} : { userId: String(row.user_id) }),
  };
}

function assertOwnership(input: OwnershipScope): void {
  assertOwnershipRequired(input, () => new PersistenceLifecycleError("ownership required", "ERR_PRISM_LIFECYCLE_OWNERSHIP"));
}
