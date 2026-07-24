import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createExtensionKernel,
  createMemoryPersistenceLifecycle,
  PersistenceLifecycleError,
} from "../index.js";

const ownership = { tenantId: "t1", userId: "u1" };

describe("persistence lifecycle", () => {
  it("legal hold blocks retention delete; export is redacted; quota fails closed", async () => {
    const store = createMemoryPersistenceLifecycle();
    await store.putLegalHold({
      ...ownership,
      resourceKind: "session",
      resourceId: "s-held",
      reason: "litigation",
    });
    const result = await store.applyRetention({
      ...ownership,
      policy: { id: "p1", createdAt: new Date().toISOString(), maxAgeDays: 1 },
      candidates: ["s-held", "s-free"],
    });
    assert.deepEqual(result.skippedHeld, ["s-held"]);
    assert.deepEqual(result.deleted, ["s-free"]);

    const exported = await store.exportUnderHold({ ...ownership, limit: 10 });
    assert.equal(exported.items.length, 1);
    assert.equal(exported.items[0]?.redacted, true);

    await store.setTenantQuota({ ...ownership, resourceKind: "session", limit: 1 });
    await store.consumeTenantQuota({ ...ownership, resourceKind: "session" });
    await assert.rejects(
      () => store.consumeTenantQuota({ ...ownership, resourceKind: "session" }),
      (error: unknown) => error instanceof PersistenceLifecycleError && error.code === "ERR_PRISM_LIFECYCLE_QUOTA_EXHAUSTED",
    );
  });
});

describe("extension load policy", () => {
  it("denies unsigned / unallowlisted extensions fail-closed", async () => {
    const kernel = createExtensionKernel({
      errorPolicy: "throw",
      loadPolicy: {
        allowList: ["good"],
        verifySignature: (extension) => extension.signature === "sig-ok",
      },
    });
    await assert.rejects(
      () => kernel.load([{ name: "other", setup() {} }]),
      /not allow-listed/,
    );
    await assert.rejects(
      () => kernel.load([{ name: "good", setup() {} }]),
      /unsigned/,
    );
    await kernel.load([{ name: "good", signature: "sig-ok", setup() {} }]);
  });
});
