import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";
import { createAgent, definePackage } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import type { CheckpointStore, LeaseStore } from "@arnilo/prism-workflows";
import { checkpointConformance, leaseConformance } from "@arnilo/prism-workflows/testing";
import sqliteStore, { createSqlitePersistence, default as sqliteStoreDefinition } from "../index.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempDb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-sqlite-workflow-services-"));
  dirs.push(dir);
  return join(dir, "sessions.db");
}

interface ServiceSpy {
  checkpoints?: unknown;
  leases?: unknown;
}

/** Runs after the store in package order, so it sees exactly the services the store provided. */
function serviceSpyPackage(seen: ServiceSpy) {
  return definePackage({
    name: "@prism-test/workflow-services-spy",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      seen.checkpoints = prism.services.consume("checkpoints");
      seen.leases = prism.services.consume("leases");
    },
  });
}

describe("sqlite store workflow services", () => {
  it("sqlite_provides_checkpoints_and_leases", async () => {
    const seen: ServiceSpy = {};
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider(), sqliteStore({ path: ":memory:" }), serviceSpyPackage(seen)],
    });
    try {
      assert.equal(typeof (seen.checkpoints as CheckpointStore | undefined)?.saveCheckpoint, "function");
      assert.equal(typeof (seen.checkpoints as CheckpointStore | undefined)?.loadCheckpoint, "function");
      assert.equal(typeof (seen.leases as LeaseStore | undefined)?.tryAcquireLease, "function");
      assert.equal(typeof (seen.leases as LeaseStore | undefined)?.renewLease, "function");
    } finally {
      await agent.dispose();
    }
  });

  it("sqlite_checkpoints_pass_conformance", async () => {
    const path = await tempDb();
    await checkpointConformance(() => createSqlitePersistence({ filename: path }).checkpoints);
  });

  it("sqlite_leases_pass_conformance", async () => {
    const path = await tempDb();
    await leaseConformance(() => createSqlitePersistence({ filename: path }).leases);
  });

  it("sqlite_services_share_store_handle", () => {
    // Run `setup` against a recording PackageAPI: the services must be the *same objects* the store slot
    // was given, which is only possible from the single `createSqlitePersistence` call — so one Database.
    let store: { checkpoints?: unknown; leases?: unknown } | undefined;
    const provided = new Map<string, unknown>();
    const prism = {
      config: { path: ":memory:" },
      slots: { store: { provide: (implementation: unknown) => (store = implementation as typeof store) } },
      services: { provide: (name: string, implementation: unknown) => provided.set(name, implementation) },
    };
    sqliteStoreDefinition.setup(prism as never);
    assert.ok(store, "setup must claim the store slot");
    assert.equal(provided.get("checkpoints"), store.checkpoints, "the checkpoints service must be the store's own store");
    assert.equal(provided.get("leases"), store.leases, "the leases service must be the store's own store");
    assert.ok(store.checkpoints, "the store slot must expose checkpoints");
    assert.ok(store.leases, "the store slot must expose leases");
  });
});
