import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createMemoryLeaseStore, LEASE_CONFLICT_CODE } from "../index.js";
import { leaseConformance } from "../testing.js";

describe("@arnilo/prism-extensions/workflows leases contract", () => {
  it("memory_leases_pass_conformance", async () => {
    await leaseConformance(() => createMemoryLeaseStore());
  });

  it("lease_fencing_survives_expiry", async () => {
    const leases = createMemoryLeaseStore();
    const key = { namespace: "t", key: "k" };
    const first = await leases.tryAcquireLease({ ...key, ownerId: "a", ttlMs: 20 });
    assert.ok(first);
    // Wait past the TTL, then a new holder must fence higher rather than restart at 1.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(await leases.getLease(key), null, "the expired lease must be gone");
    const second = await leases.tryAcquireLease({ ...key, ownerId: "b", ttlMs: 20 });
    assert.ok(second);
    assert.equal(second.fencingToken, first.fencingToken + 1, "expiry must not reset the fence");
  });

  it("lease_errors_carry_the_conflict_code", async () => {
    const leases = createMemoryLeaseStore();
    await assert.rejects(
      () => leases.tryAcquireLease({ namespace: "t", key: "k", ownerId: "", ttlMs: 10 }),
      (error: { code?: string }) => error.code === LEASE_CONFLICT_CODE,
    );
  });
});
