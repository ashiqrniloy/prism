import { WorkToolError } from "./errors.js";
import type { IdempotencyRecord, IdempotencyStore } from "./types.js";

export function createMemoryIdempotencyStore(): IdempotencyStore {
  const map = new Map<string, IdempotencyRecord>();
  const keyOf = (identityKey: string, key: string) => `${identityKey}\0${key}`;
  return {
    async get({ identityKey, key }) {
      return map.get(keyOf(identityKey, key));
    },
    async put(record) {
      if (!record.key || !record.identityKey) throw new WorkToolError("ERR_PRISM_WORK_IDEMPOTENCY", "idempotency key required");
      const id = keyOf(record.identityKey, record.key);
      const existing = map.get(id);
      if (existing) return existing;
      map.set(id, record);
      return record;
    },
  };
}

export function identityKey(identity: { tenantId: string; accountId?: string; userId?: string; principal: { id: string } }): string {
  return [identity.tenantId, identity.accountId ?? "", identity.userId ?? "", identity.principal.id].join("\0");
}
