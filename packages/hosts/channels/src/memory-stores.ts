import type { OwnershipScope } from "@arnilo/prism";
import type { CheckpointStore, LeaseRecord, LeaseStore } from "./checkpoint-contract.js";

export function createMemoryCheckpointStore(): CheckpointStore {
  const records = new Map<string, any>();
  const keyOf = (ns: string, key: string, scope?: OwnershipScope) =>
    `${ns}:${scope?.tenantId ?? "-"}:${scope?.accountId ?? "-"}:${scope?.userId ?? "-"}:${key}`;

  return {
    async saveCheckpoint(input) {
      const id = keyOf(input.namespace, input.key, input);
      const existing = records.get(id);
      if (input.expectedVersion !== undefined && input.expectedVersion !== (existing?.version ?? 0)) {
        const err = new Error(`Checkpoint CAS failed (expected ${input.expectedVersion}, got ${existing?.version ?? 0})`);
        err.name = "CheckpointConflictError";
        throw err;
      }
      const record = {
        namespace: input.namespace,
        key: input.key,
        tenantId: input.tenantId,
        accountId: input.accountId,
        userId: input.userId,
        category: input.category,
        version: input.version,
        fencingToken: input.fencingToken,
        value: input.value,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.set(id, record);
      return record;
    },
    async loadCheckpoint(input) {
      const id = keyOf(input.namespace, input.key, input);
      return records.get(id) ?? null;
    },
    async listCheckpoints(query) {
      const prefix = query?.namespace ? `${query.namespace}:` : "";
      const matches = Array.from(records.values()).filter((r) => !prefix || r.namespace === query?.namespace);
      return { items: matches, hasMore: false };
    },
    async deleteCheckpoint(input) {
      const id = keyOf(input.namespace, input.key, input);
      return records.delete(id);
    },
  };
}

export function createMemoryLeaseStore(): LeaseStore {
  const records = new Map<string, LeaseRecord>();
  const keyOf = (ns: string, key: string, scope?: OwnershipScope) =>
    `${ns}:${scope?.tenantId ?? "-"}:${scope?.accountId ?? "-"}:${scope?.userId ?? "-"}:${key}`;

  return {
    async getLease(input) {
      const id = keyOf(input.namespace, input.key, input);
      const current = records.get(id);
      if (!current) return null;
      if (Date.parse(current.expiresAt) <= Date.now()) {
        records.delete(id);
        return null;
      }
      return current;
    },
    async tryAcquireLease(input) {
      const id = keyOf(input.namespace, input.key, input);
      const current = records.get(id);
      const now = Date.now();
      if (current && Date.parse(current.expiresAt) > now) {
        return null;
      }
      const timestamp = new Date(now).toISOString();
      const record: LeaseRecord = {
        namespace: input.namespace,
        key: input.key,
        ownerId: input.ownerId,
        token: crypto.randomUUID(),
        fencingToken: (current?.fencingToken ?? 0) + 1,
        acquiredAt: timestamp,
        expiresAt: new Date(now + input.ttlMs).toISOString(),
        updatedAt: timestamp,
        tenantId: input.tenantId,
        accountId: input.accountId,
        userId: input.userId,
      };
      records.set(id, record);
      return record;
    },
    async renewLease(input) {
      const id = keyOf(input.namespace, input.key, input);
      const current = records.get(id);
      if (!current || current.token !== input.token) return null;
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const updated: LeaseRecord = {
        ...current,
        expiresAt: new Date(now + input.ttlMs).toISOString(),
        updatedAt: timestamp,
      };
      records.set(id, updated);
      return updated;
    },
    async releaseLease(input) {
      const id = keyOf(input.namespace, input.key, input);
      const current = records.get(id);
      if (!current || current.token !== input.token) return false;
      records.delete(id);
      return true;
    },
  };
}
