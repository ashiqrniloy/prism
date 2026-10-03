import type { ToolEffectKey, ToolEffectStore, ToolResult } from "../contracts.js";

export interface ToolEffectStoreConformanceOptions {
  readonly ownership?: ToolEffectKey["ownership"];
  readonly key?: string;
}

/** Assert core claim/CAS, duplicate, reconciliation, and cleanup semantics without a test framework. */
export async function assertToolEffectStoreConforms(
  factory: () => ToolEffectStore | Promise<ToolEffectStore>,
  options: ToolEffectStoreConformanceOptions = {},
): Promise<void> {
  const store = await factory();
  const ownership = options.ownership ?? { tenantId: "tenant" };
  const base = key(ownership, options.key ?? "prism:tool-effect:v1:conformance");
  const first = await store.begin(base);
  if (first.outcome !== "acquired" || first.record.status !== "pending" || !first.record.claimToken) {
    throw new Error("store must acquire an absent tool effect as pending with a claim token");
  }
  const duplicate = await store.begin(base);
  if (duplicate.outcome !== "existing" || duplicate.record.status !== "pending") {
    throw new Error("store must return existing pending effects without a second claim");
  }
  const dispatched = await store.markDispatched(transition(base, first.record));
  if (dispatched.status !== "dispatched" || dispatched.version !== first.record.version + 1) {
    throw new Error("store must transition a claimed pending effect to dispatched");
  }
  const result: ToolResult = { toolCallId: base.toolCallId, name: base.toolName, value: { ok: true } };
  const completed = await store.complete({ ...transition(base, dispatched), result });
  if (completed.status !== "completed" || completed.result?.toolCallId !== base.toolCallId) {
    throw new Error("store must retain a completed bounded result");
  }
  const replay = await store.begin(base);
  if (replay.outcome !== "existing" || replay.record.status !== "completed") {
    throw new Error("store must preserve completed duplicate state");
  }
  await expectReject(() => store.markDispatched(transition(base, dispatched)), "store must reject stale claim/version transitions");

  const unknownKey = key(ownership, `${base.key}:unknown`, "call-unknown");
  const unknownPending = await store.begin(unknownKey);
  const unknownDispatched = await store.markDispatched(transition(unknownKey, unknownPending.record));
  const unknown = await store.markUnknown({ ...transition(unknownKey, unknownDispatched), failure: { code: "test" } });
  if (unknown.status !== "unknown") throw new Error("store must mark dispatched effects unknown");
  const resolved = await store.resolveUnknown({
    ...unknownKey,
    expectedVersion: unknown.version,
    status: "failed_terminal",
    failure: { code: "test" },
  });
  if (resolved.status !== "failed_terminal") throw new Error("store must CAS-resolve unknown effects");

  const cleanup = await store.cleanup({ ownership, before: new Date(Date.now() + 60_000).toISOString(), limit: 100 });
  if (cleanup.deleted < 1) throw new Error("store cleanup must remove terminal effects");
}

function key(ownership: ToolEffectKey["ownership"], value: string, toolCallId = "call"): ToolEffectKey {
  return {
    ownership,
    key: value,
    sessionId: "session",
    runId: "run",
    toolCallId,
    toolName: "effect.tool",
    argumentsHash: "a".repeat(64),
  };
}

function transition(base: ToolEffectKey, record: { readonly claimToken?: string; readonly version: number }) {
  if (!record.claimToken) throw new Error("store transition record lacks claim token");
  return { ...base, claimToken: record.claimToken, expectedVersion: record.version };
}

async function expectReject(run: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(message);
}
