#!/usr/bin/env node
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../../packages/prism-core/dist/enterprise/postgres/index.js";
import { createPostgresPersistence } from "../../packages/prism-core/dist/sessions/postgres/index.js";

const command = process.argv[2];
const encoded = process.env.PRISM_PHASE7_WORKER_INPUT;
if (!encoded) throw new Error("PRISM_PHASE7_WORKER_INPUT is required");
const input = JSON.parse(encoded);
if (!input || typeof input !== "object" || !["append", "effect-pending", "effect-dispatched"].includes(command ?? "")) {
  throw new Error("invalid phase 7 worker input");
}
if (typeof input.url !== "string" || typeof input.schema !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.schema)) {
  throw new Error("invalid phase 7 worker database input");
}

const pool = new Pool({ connectionString: input.url, max: 1 });
try {
  if (command === "append") {
    const persistence = await createPostgresPersistence({
      pool,
      schema: input.schema,
      eventCursorSecret: "phase7-process-worker-secret",
      eventSource: { pollIntervalMs: 25, reconnectInitialMs: 5000, reconnectMaxMs: 5000 },
    });
    await persistence.events.append(input.event);
    await persistence.close();
  } else {
    const state = await createPostgresEnterpriseState({ pool, schema: input.schema });
    const claim = await state.toolEffects.begin(input.effect);
    if (claim.outcome !== "acquired" || !claim.record.claimToken) throw new Error("worker effect claim was not acquired");
    if (command === "effect-dispatched") {
      const dispatched = await state.toolEffects.markDispatched({
        ...input.effect,
        claimToken: claim.record.claimToken,
        expectedVersion: claim.record.version,
      });
      if (dispatched.status !== "dispatched") throw new Error("worker effect was not dispatched");
      await pool.query(
        `INSERT INTO "${input.schema}"."phase7_effect_counter" (id, executions) VALUES ($1, 1)
         ON CONFLICT (id) DO UPDATE SET executions = "${input.schema}"."phase7_effect_counter".executions + 1`,
        [input.effect.key],
      );
    }
    await state.close();
  }
} finally {
  await pool.end();
}
