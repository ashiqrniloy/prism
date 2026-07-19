import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPostgresPersistence } from "@arnilo/prism-session-store-postgres";
import {
  createWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  resumeWorkflow,
  runWorkflow,
} from "@arnilo/prism-workflows";

// Opt-in PostgreSQL restart/resume example. Default execution is network-free
// and reports "skipped". Set PRISM_TEST_POSTGRES_URL to run against an explicit
// test database; a unique schema is created and dropped for isolation.

let failFirstAttempt = true;
const unstable = functionNode({
  execute: async () => {
    if (failFirstAttempt) throw new Error("simulated process failure");
    return "recovered";
  },
});
const workflow = defineWorkflow({
  revision: "1",
  id: "postgres-resume-demo",
  nodes: { unstable },
  limits: { maxNodes: 16, maxConcurrency: 1, maxCheckpointBytes: 128 * 1_024 },
});

export async function demo(postgresUrl = process.env.PRISM_TEST_POSTGRES_URL) {
  if (!postgresUrl) return { skipped: true, reason: "set PRISM_TEST_POSTGRES_URL" };

  const schema = `prism_wf_demo_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const ownership = { tenantId: "demo" };
  const runId = "postgres-resume-run";
  let firstPool = new Pool({ connectionString: postgresUrl, max: 2 });

  try {
    const firstPersistence = await createPostgresPersistence({ pool: firstPool, schema });
    const firstCheckpoints = createWorkflowCheckpoints({ store: firstPersistence.checkpoints });
    await runWorkflow(workflow, null, {
      checkpoints: firstCheckpoints,
      ownership,
      runId,
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
    await firstPool.end();

    // New pool simulates a new host process reading durable state.
    failFirstAttempt = false;
    const secondPool = new Pool({ connectionString: postgresUrl, max: 2 });
    const secondPersistence = await createPostgresPersistence({ pool: secondPool, schema });
    const secondCheckpoints = createWorkflowCheckpoints({ store: secondPersistence.checkpoints });
    const resumed = await resumeWorkflow(workflow, { runId }, {
      checkpoints: secondCheckpoints,
      ownership,
      signal: AbortSignal.timeout(30_000),
    });
    await secondPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await secondPool.end();

    return {
      skipped: false,
      status: resumed.status,
      sameRunId: resumed.runId === runId,
      output: resumed.outputs.unstable,
    };
  } finally {
    if (!firstPool.ended) await firstPool.end();
  }
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
