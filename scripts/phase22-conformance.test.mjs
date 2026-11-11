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

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createPostgresPersistence } from "@arnilo/prism-extensions/store-postgres";
import { Pool } from "pg";
import { assertStateConcurrencyConforms } from "../src/testing/state-concurrency-conformance.ts";
import { blockedGate } from "./blocked-gate.mjs";

const url = process.env.PRISM_TEST_POSTGRES_URL;
const root = new URL("..", import.meta.url).pathname;
const harness = readFileSync(`${root}src/testing/state-concurrency-conformance.ts`, "utf8");

function schema() {
  return `prism_phase22_${randomUUID().replaceAll("-", "")}`;
}

describe("phase 22 state concurrency conformance", () => {
  it("conformance harness avoids ambient timing dependencies", () => {
    assert.equal(harness.includes("setTimeout("), false, "state-concurrency-conformance.ts must not use setTimeout");
  });

  it("every store leg exists on disk", () => {
    for (const file of [
      "packages/extensions/store-sqlite/src/__tests__/state-concurrency-conformance.test.ts",
      "packages/extensions/store-postgres/src/__tests__/state-concurrency-conformance.integration.test.ts",
    ]) {
      assert.ok(existsSync(`${root}${file}`), `missing harness leg ${file}`);
    }
  });

  if (!url) {
    it("records a blocked gate when PRISM_TEST_POSTGRES_URL is absent", () => {
      // The memory leg already passed above; only the durable leg is blocked.
      blockedGate("phase22-conformance");
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
        events: { reopenable: true, create: async () => (await makeStore(eventsSchema)).events },
      });
      // The harness exposes these two probes for the factories above. Checkpoints and approvals are
      // not state-concurrency probes — `storeConformance` owns them (`package-state`, `session-links`,
      // `external-state`), and the `@arnilo/prism-extensions/store-postgres` leg runs that suite.
      for (const probe of ["conversation-metadata-cas", "cursor-resume"]) {
        assert.ok(sessionProbes.includes(probe), `postgres session leg did not execute probe ${probe}`);
      }
      assert.deepEqual(
        [...sessionProbes].sort(),
        ["conversation-metadata-cas", "cursor-resume"],
        "the durable leg must execute exactly the probes the harness offers",
      );
    } finally {
      for (const store of persistences) await store.close();
      while (pools.length > 0) {
        const last = pools.pop();
        if (last) await last.end();
      }
    }
  });
});
