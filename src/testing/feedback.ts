import type { RunFeedbackStore } from "../contracts.js";

export interface RunFeedbackConformanceFactory {
  (): RunFeedbackStore | Promise<RunFeedbackStore>;
}

/** Shared minimum behavior for memory and production feedback stores. */
export async function runFeedbackConformance(factory: RunFeedbackConformanceFactory): Promise<void> {
  const store = await factory();
  const owner = { tenantId: "feedback-tenant", userId: "feedback-user" } as const;
  await store.append({
    id: "feedback-1",
    runId: "feedback-run-a",
    rating: 1,
    comment: "useful",
    tags: ["reviewed"],
    evaluationIds: ["eval-1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...owner,
  });
  await store.append({
    id: "feedback-2",
    runId: "feedback-run-a",
    rating: 0,
    createdAt: "2026-01-01T00:00:01.000Z",
    ...owner,
  });
  const first = await store.query({ ...owner, runId: "feedback-run-a", limit: 1 });
  if (first.items.length !== 1 || !first.nextCursor) throw new Error("feedback first page is invalid");
  const second = await store.query({ ...owner, runId: "feedback-run-a", cursor: first.nextCursor, limit: 1 });
  if (second.items.length !== 1 || second.items[0]?.id === first.items[0]?.id) throw new Error("feedback cursor did not advance");
  const linked = await store.query({ ...owner, evaluationId: "eval-1" });
  if (linked.items.length !== 1 || linked.items[0]?.id !== "feedback-1") throw new Error("feedback evaluation filter failed");
  if (await store.delete({ id: "feedback-1", tenantId: "feedback-tenant", userId: "other" })) {
    throw new Error("cross-owner feedback deletion succeeded");
  }
  if (!await store.delete({ id: "feedback-1", ...owner })) throw new Error("owned feedback deletion failed");
}
