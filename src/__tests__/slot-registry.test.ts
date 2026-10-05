import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  createEnvRefCredentialResolver,
  createSlotDefaults,
  createSlotRegistry,
  SlotConflictError,
  UnknownSlotError,
  type SlotContracts,
} from "../index.js";

const fakeLoop = { name: "custom", async run() {} };

describe("slot registry", () => {
  it("slot_conflict_fails_closed_naming_both_owners", () => {
    const registry = createSlotRegistry(createSlotDefaults());
    registry.provide("loop", "pkg-a", fakeLoop);
    registry.provide("loop", "pkg-b", { name: "other", async run() {} });
    assert.throws(
      () => registry.resolve("loop"),
      (error: unknown) =>
        error instanceof SlotConflictError && error.code === "ERR_PRISM_SLOT_CONFLICT" && error.owners.join(",") === "pkg-a,pkg-b",
    );
  });

  it("slot_direct_implementation_wins", () => {
    const registry = createSlotRegistry(createSlotDefaults());
    registry.provide("loop", "pkg-a", fakeLoop);
    registry.provide("loop", "pkg-b", { name: "other", async run() {} });
    assert.equal(registry.resolve("loop", fakeLoop), fakeLoop);
  });

  it("unknown_slot_fails_closed", () => {
    const registry = createSlotRegistry(createSlotDefaults());
    assert.throws(
      () => registry.resolve("nope" as keyof SlotContracts),
      (error: unknown) => error instanceof UnknownSlotError && error.code === "ERR_PRISM_UNKNOWN_SLOT",
    );
  });

  it("slot_default_exposed_for_delegation", () => {
    const registry = createSlotRegistry(createSlotDefaults());
    assert.equal(registry.default("loop").name, "default");
    assert.equal(registry.resolve("loop"), registry.default("loop"));
    assert.equal(typeof registry.default("compaction").compact, "function");
  });

  it("credentials_default_resolves_env_only", () => {
    const resolver = createEnvRefCredentialResolver({ PRISM_TEST_KEY: "s3cret" });
    assert.deepEqual(resolver.resolve("env:PRISM_TEST_KEY", {}), {
      type: "api_key",
      value: "s3cret",
      metadata: { source: "env", envName: "PRISM_TEST_KEY" },
    });
    assert.equal(resolver.resolve("PRISM_TEST_KEY", {}), undefined);
    assert.equal(resolver.resolve("env:MISSING", {}), undefined);
    assert.equal(resolver.resolve("env:", {}), undefined);
    assert.equal(resolver.store, undefined);
  });
});
