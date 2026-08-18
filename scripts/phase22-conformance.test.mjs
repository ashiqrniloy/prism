/**
 * Phase 22 conformance gate (plan 022 Task 4): the multi-process
 * state-concurrency harness must have run against every available store.
 *
 *   Memory leg (always): runs the harness against the core memory stores and
 *   asserts the adapter legs exist on disk, so a deleted/renamed leg fails the
 *   gate even when the remaining tests pass. Also greps the harness source for
 *   `setTimeout(` (the plan bans timing-only sleeps in harness files).
 *
 *   Durable leg: with PRISM_TEST_POSTGRES_URL runs the harness against the
 *   durable PostgreSQL stores (session-store and enterprise) in fresh schemas.
 *   Without it, a named BLOCKED GATE failure records the durable evidence as
 *   missing — never a green skip (0.2.3's blocked-not-skipped visibility rule).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Pool } from "pg";
import { createMemoryAgentEventSource, createMemoryCheckpointStore } from "../dist/index.js";
import { assertStateConcurrencyConforms } from "../dist/testing/state-concurrency-conformance.js";
import { createPostgresEnterpriseState } from "../packages/enterprise-postgres/dist/index.js";
import { createPostgresPersistence } from "../packages/session-store-postgres/dist/index.js";

const url = process.env.PRISM_TEST_POSTGRES_URL;
const root = new URL("..", import.meta.url).pathname;
const harness = readFileSync(`${root}src/testing/state-concurrency-conformance.ts`, "utf8");

function schema() {
  return `prism_phase22_${randomUUID().replaceAll("-", "")}`;
}

describe("Phase 22 state-concurrency conformance gate", () => {
  it("harness source bans timing-only sleeps", () => {
    assert.equal(harness.includes("setTimeout("), false, "state-concurrency-conformance.ts must not use setTimeout");
  });

  it("every store leg exists on disk", () => {
    for (const file of [
      "src/__tests__/state-concurrency-conformance.test.ts",
      "packages/session-store-sqlite/src/__tests__/state-concurrency-conformance.test.ts",
      "packages/session-store-postgres/src/__tests__/state-concurrency-conformance.integration.test.ts",
      "packages/enterprise-postgres/src/__tests__/state-concurrency-conformance.test.ts",
      "packages/session-store-nats/src/__tests__/state-concurrency-conformance.test.ts",
    ]) {
      assert.ok(existsSync(`${root}${file}`), `missing harness leg ${file}`);
    }
  });

  it("memory leg passes against the core memory stores", async () => {
    const probes = await assertStateConcurrencyConforms({
      checkpoints: () => createMemoryCheckpointStore(),
      events: { create: () => createMemoryAgentEventSource() },
    });
    for (const probe of ["approval-determinism", "checkpoint-cas", "cursor-resume"]) {
      assert.ok(probes.includes(probe), `memory leg did not execute probe ${probe}`);
    }
  });

  if (!url) {
    it("BLOCKED GATE: PRISM_TEST_POSTGRES_URL is required for the durable state-concurrency leg", () => {
      assert.fail(
        "BLOCKED GATE: durable state-concurrency conformance evidence cannot be recorded without " +
          "PRISM_TEST_POSTGRES_URL. The memory leg passed; the durable PostgreSQL leg (session-store + " +
          "enterprise router/idempotency) requires the protected environment.",
      );
    });
    return;
  }

  it("durable leg passes against the PostgreSQL stores", async () => {
    const pools = [];
    const persistences = [];
    try {
      async function makeStore(valueSchema) {
        const pool = new Pool({ connectionString: url, max: 8 });
        pools.push(pool);
        const store = await createPostgresPersistence({
          pool,
          schema: valueSchema,
          eventCursorSecret: "phase22-cursor-secret",
          eventSource: { pollIntervalMs: 30_000 },
        });
        persistences.push(store);
        return store;
      }
      const eventsSchema = schema();
      const sessionProbes = await assertStateConcurrencyConforms({
        sessions: () => makeStore(schema()),
        checkpoints: async () => (await makeStore(schema())).checkpoints,
        events: { reopenable: true, create: async () => (await makeStore(eventsSchema)).events },
      });
      for (const probe of ["conversation-metadata-cas", "approval-determinism", "checkpoint-cas", "cursor-resume"]) {
        assert.ok(sessionProbes.includes(probe), `postgres session leg did not execute probe ${probe}`);
      }
      const enterprisePool = new Pool({ connectionString: url, max: 8 });
      pools.push(enterprisePool);
      const state = await createPostgresEnterpriseState({ pool: enterprisePool, schema: schema() });
      const enterpriseProbes = await assertStateConcurrencyConforms({
        routerState: { create: () => state.modelRouter },
        idempotency: () => state.workIdempotency,
      });
      for (const probe of ["router-reservation", "idempotency-retry"]) {
        assert.ok(enterpriseProbes.includes(probe), `postgres enterprise leg did not execute probe ${probe}`);
      }
    } finally {
      for (const store of persistences) await store.close();
      while (pools.length > 0) {
        const last = pools.pop();
        if (last) await last.end();
      }
    }
  });
});
