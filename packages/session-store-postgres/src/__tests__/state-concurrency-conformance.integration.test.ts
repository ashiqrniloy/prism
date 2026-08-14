// plan 022 Task 4: durable (PostgreSQL) leg of the state-concurrency harness —
// conversation metadata CAS, checkpoint CAS/approval, and replay-cursor resume
// across a real re-open. Gated by test:postgres (skips without
// PRISM_TEST_POSTGRES_URL).

import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { assertStateConcurrencyConforms } from "@arnilo/prism/testing/state-concurrency-conformance";
import { Pool } from "pg";
import { createPostgresPersistence } from "../persistence.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeProtected = postgresUrl ? describe : describe.skip;

function schema(): string {
  return `prism_concurrency_${randomUUID().replaceAll("-", "")}`;
}

describeProtected("state concurrency conformance (postgres)", () => {
  const pools: Pool[] = [];
  const persistences: Array<Awaited<ReturnType<typeof createPostgresPersistence>>> = [];

  after(async () => {
    for (const store of persistences) await store.close();
    while (pools.length > 0) await pools.pop()!.end();
  });

  async function makeStore(valueSchema = schema()) {
    const pool = new Pool({ connectionString: postgresUrl, max: 8 });
    pools.push(pool);
    const store = await createPostgresPersistence({
      pool,
      schema: valueSchema,
      eventCursorSecret: "concurrency-cursor-secret",
      eventSource: { pollIntervalMs: 30_000 },
    });
    persistences.push(store);
    return store;
  }

  it("passes the conversation CAS, checkpoint CAS, and cursor-resume probes against durable stores", async () => {
    // The cursor-resume probe re-opens the store mid-probe (restart), so its
    // factory must recreate against the same schema — unlike the other
    // factories, whose probes are single-instance and self-contained.
    const eventsSchema = schema();
    const probes = await assertStateConcurrencyConforms({
      sessions: () => makeStore(),
      checkpoints: async () => (await makeStore()).checkpoints,
      events: {
        reopenable: true,
        create: async () => (await makeStore(eventsSchema)).events,
      },
    });
    for (const probe of ["conversation-metadata-cas", "approval-determinism", "checkpoint-cas", "cursor-resume"]) {
      if (!probes.includes(probe)) throw new Error(`postgres run did not execute probe ${probe}`);
    }
  });
});
