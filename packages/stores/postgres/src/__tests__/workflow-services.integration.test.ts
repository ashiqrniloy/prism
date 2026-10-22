import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "bun:test";
import { createAgent, definePackage } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import type { CheckpointStore, LeaseStore } from "@arnilo/prism-workflows";
import { checkpointConformance, leaseConformance } from "@arnilo/prism-workflows/testing";
import postgresStore, { createPostgresPersistence } from "../index.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_ws_${randomUUID().replace(/-/g, "")}`;
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

describeIntegration("postgres store workflow services", () => {
  it("postgres_provides_checkpoints_and_leases", async () => {
    const seen: ServiceSpy = {};
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [
        mockProvider(),
        postgresStore({ url: "env:PRISM_TEST_POSTGRES_URL", schema: uniqueSchema() }),
        serviceSpyPackage(seen),
      ],
    });
    try {
      assert.equal(typeof (seen.checkpoints as CheckpointStore | undefined)?.saveCheckpoint, "function");
      assert.equal(typeof (seen.leases as LeaseStore | undefined)?.tryAcquireLease, "function");
    } finally {
      await agent.dispose();
    }
  });

  it("postgres_checkpoints_pass_conformance", async () => {
    const schema = uniqueSchema();
    await checkpointConformance(async () => (await createPostgresPersistence({ connectionString: postgresUrl, schema })).checkpoints);
  });

  it("postgres_leases_pass_conformance", async () => {
    const schema = uniqueSchema();
    await leaseConformance(async () => (await createPostgresPersistence({ connectionString: postgresUrl, schema })).leases);
  });
});
