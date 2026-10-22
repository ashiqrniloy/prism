#!/usr/bin/env node
import { Pool } from "pg";
import { createPostgresPersistence } from "@arnilo/prism-store-postgres";

const command = process.argv[2];
const encoded = process.env.PRISM_PHASE7_WORKER_INPUT;
if (!encoded) throw new Error("PRISM_PHASE7_WORKER_INPUT is required");
const input = JSON.parse(encoded);
if (!input || typeof input !== "object" || command !== "append") {
  throw new Error("invalid phase 7 worker input");
}
if (typeof input.url !== "string" || typeof input.schema !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.schema)) {
  throw new Error("invalid phase 7 worker database input");
}

const pool = new Pool({ connectionString: input.url, max: 1 });
try {
  const persistence = await createPostgresPersistence({
    pool,
    schema: input.schema,
    eventCursorSecret: "phase7-process-worker-secret",
    eventSource: { pollIntervalMs: 25, reconnectInitialMs: 5000, reconnectMaxMs: 5000 },
  });
  await persistence.events.append(input.event);
  await persistence.close();
} finally {
  await pool.end();
}
