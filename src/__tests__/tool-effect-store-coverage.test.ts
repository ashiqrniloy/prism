// Plan 025 Task 5 — focused behavior regressions for the tool-effect-store conformance
// helper's weak branches (src/testing/tool-effect-store-conformance.ts, 38.89% branch
// coverage). The existing happy-path test covers the conformant memory store; this adds
// the options-defaults branches (explicit identity/ownership/key) and the violation
// throws (a store that misbehaves must be caught). Behavior-backed: each test asserts the
// helper throws the named violation, not a call count.

import assert from "node:assert/strict";
import test from "node:test";
import { type AgentIdentity, createMemoryToolEffectStore, type ToolEffectRecord, type ToolEffectStore } from "../index.js";
import { assertToolEffectStoreConforms } from "../testing/tool-effect-store-conformance.js";

// A minimal conformant record for the broken begin() override.
function pendingRecord(claimToken = "tok"): ToolEffectRecord {
  return {
    key: "k",
    sessionId: "s",
    runId: "r",
    toolCallId: "c",
    toolName: "n",
    argumentsHash: "a".repeat(64),
    status: "pending",
    attempt: 1,
    version: 0,
    claimToken,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tenantId: "tenant",
  } as ToolEffectRecord;
}

// Delegate to the real memory store but override one method with a misbehaving impl.
function wrap(real: ToolEffectStore, overrides: Partial<ToolEffectStore>): ToolEffectStore {
  return { ...real, ...overrides } as ToolEffectStore;
}

const identity: AgentIdentity = {
  tenantId: "tenant-x",
  principal: { kind: "service", id: "conformance-x" },
  scopes: ["tools:execute"],
  issuedAt: "2026-01-01T00:00:00.000Z",
  verified: true,
};

test("assertToolEffectStoreConforms honors explicit identity/ownership/key options", async () => {
  // Passing explicit options exercises the options.?? left-side branches (vs the defaults).
  await assertToolEffectStoreConforms(() => createMemoryToolEffectStore(), {
    identity,
    ownership: { tenantId: "tenant-x" },
    key: "prism:tool-effect:v1:custom",
  });
});

test("assertToolEffectStoreConforms rejects a store that does not acquire an absent effect as pending", async () => {
  const broken = wrap(createMemoryToolEffectStore(), {
    async begin() {
      return { outcome: "existing", record: pendingRecord() };
    },
  });
  await assert.rejects(
    () => assertToolEffectStoreConforms(() => broken),
    /store must acquire an absent tool effect as pending with a claim token/,
  );
});

test("assertToolEffectStoreConforms rejects a store that does not retain a completed result", async () => {
  const real = createMemoryToolEffectStore();
  const broken = wrap(real, {
    async complete() {
      return { ...pendingRecord(), status: "dispatched" as const, version: 2 };
    },
  });
  await assert.rejects(() => assertToolEffectStoreConforms(() => broken), /store must retain a completed bounded result/);
});

test("assertToolEffectStoreConforms rejects a store that does not reject stale claim/version transitions", async () => {
  // The real store rejects the stale transition; a store that silently accepts it must be caught.
  const real = createMemoryToolEffectStore();
  let firstResult: ToolEffectRecord | undefined;
  let calls = 0;
  const stale = wrap(real, {
    async markDispatched(input) {
      calls += 1;
      if (calls === 1) {
        firstResult = await real.markDispatched(input);
        return firstResult;
      }
      // stale call: return the first result instead of rejecting.
      return firstResult!;
    },
  });
  await assert.rejects(() => assertToolEffectStoreConforms(() => stale), /store must reject stale claim\/version transitions/);
});

test("assertToolEffectStoreConforms rejects a store whose cleanup does not remove terminal effects", async () => {
  const real = createMemoryToolEffectStore();
  const broken = wrap(real, {
    async cleanup() {
      return { deleted: 0 };
    },
  });
  await assert.rejects(() => assertToolEffectStoreConforms(() => broken), /store cleanup must remove terminal effects/);
});
