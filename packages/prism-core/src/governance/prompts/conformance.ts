import type { PromptStore } from "./types.js";

export type PromptStoreConformanceFactory = () => PromptStore | Promise<PromptStore>;

/** Small shared contract check for memory and durable prompt stores. */
export async function runPromptStoreConformance(factory: PromptStoreConformanceFactory): Promise<void> {
  const store = await factory();
  const owner = { tenantId: "prompt-tenant", userId: "prompt-user" } as const;
  const first = await store.put({
    ...owner,
    name: "support-agent",
    body: "You are helpful.\nAnswer briefly.",
    labels: ["production"],
    metadata: { revision: "one" },
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const second = await store.put({
    ...owner,
    name: "support-agent",
    body: "You are helpful.\nAnswer clearly and briefly.",
    labels: ["candidate"],
    createdAt: "2026-01-01T00:00:01.000Z",
  });
  if (first.version !== 1 || second.version !== 2) throw new Error("prompt versions did not append monotonically");
  if (first.hash === second.hash || !Object.isFrozen(first) || !Object.isFrozen(first.labels))
    throw new Error("prompt records are not immutable");
  if ((await store.resolve({ ...owner, name: first.name }))?.version !== 2) throw new Error("latest prompt resolution failed");
  if ((await store.resolve({ ...owner, name: first.name, label: "production" }))?.version !== 1)
    throw new Error("label prompt resolution failed");
  if (await store.resolve({ tenantId: "other-tenant", userId: owner.userId, name: first.name })) {
    throw new Error("cross-tenant prompt resolution leaked a record");
  }
  if ((await store.list({ tenantId: "other-tenant", userId: owner.userId, name: first.name })).items.length !== 0) {
    throw new Error("cross-tenant prompt listing leaked a record");
  }

  const page = await store.list({ ...owner, name: first.name, limit: 1 });
  if (page.items.length !== 1 || !page.nextCursor) throw new Error("prompt pagination first page is invalid");
  const next = await store.list({ ...owner, name: first.name, limit: 1, cursor: page.nextCursor });
  if (next.items.length !== 1 || next.items[0]?.version === page.items[0]?.version || next.nextCursor) {
    throw new Error("prompt pagination cursor did not advance");
  }

  const diff = await store.diff({ ...owner, name: first.name, fromVersion: 1, toVersion: 2 });
  if (diff.added === 0 || diff.removed === 0 || diff.lines.length === 0) throw new Error("prompt diff is empty");
}
