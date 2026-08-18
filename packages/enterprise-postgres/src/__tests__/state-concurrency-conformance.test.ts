// plan 022 Task 4: enterprise-store legs of the state-concurrency harness.
// Memory run executes in the default npm test; the durable run is gated by
// test:postgres (skips without PRISM_TEST_POSTGRES_URL).

import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { assertStateConcurrencyConforms } from "@arnilo/prism/testing/state-concurrency-conformance";
import { createMemoryModelRouterStateStore } from "@arnilo/prism-model-router";
import { createMemoryIdempotencyStore } from "@arnilo/prism-work-tools";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../enterprise.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;

describe("state concurrency conformance (enterprise memory)", () => {
  it("passes the router reservation and idempotency probes against the memory stores", async () => {
    const probes = await assertStateConcurrencyConforms({
      routerState: { create: () => createMemoryModelRouterStateStore(), nowInjected: true },
      idempotency: () => createMemoryIdempotencyStore(),
    });
    for (const probe of ["router-reservation", "unknown-outcome", "idempotency-retry"]) {
      if (!probes.includes(probe)) throw new Error(`memory run did not execute probe ${probe}`);
    }
  });
});

function schema(): string {
  return `prism_concurrency_${randomUUID().replaceAll("-", "")}`;
}

const describeDurable = postgresUrl ? describe : describe.skip;

describeDurable("state concurrency conformance (enterprise postgres)", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length > 0) await pools.pop()!.end();
  });

  it("passes the router reservation and idempotency probes against the durable stores", async () => {
    const pool = new Pool({ connectionString: postgresUrl, max: 8 });
    pools.push(pool);
    const state = await createPostgresEnterpriseState({ pool, schema: schema() });
    const probes = await assertStateConcurrencyConforms({
      // Durable expiry uses the database clock, so the deterministic
      // unknown-outcome probe stays off here; the durable TTL reconciliation
      // leg runs in the Task 1 enterprise-conformance integration probe.
      routerState: { create: () => state.modelRouter },
      idempotency: () => state.workIdempotency,
    });
    for (const probe of ["router-reservation", "idempotency-retry"]) {
      if (!probes.includes(probe)) throw new Error(`postgres run did not execute probe ${probe}`);
    }
  });
});
