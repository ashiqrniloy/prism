import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { createPostgresPersistence } from "../packages/session-store-postgres/dist/index.js";
import { Pool } from "pg";

/**
 * Phase 12 protected restart-recovery evidence (plan 012 Task 4).
 *
 * Multi-replica run/reconnect: replica A runs a durable agent against
 * PostgreSQL, suspends on a batched tool approval, appends durable events and
 * is then SIGKILLed by this driver. Replica B reconnects to the same schema
 * and resumes: events show no gap/duplicate, tenant isolation holds, partial
 * approvals re-suspend with CAS, the durable tool-effect path executes each
 * side effect exactly once, and the unknown-outcome window fails closed.
 *
 * Blocked-gate semantics: without PRISM_TEST_POSTGRES_URL the suite records a
 * named, visible BLOCKED GATE failure instead of a passing skip (this file is
 * wired into `npm run test:postgres`, which requires the URL first).
 *
 * Evidence recording: set PRISM_PHASE12_RECORD_EVIDENCE=1 to write
 * scripts/phase12-restart-recovery.json (checked in as the recorded evidence
 * for the release tree).
 */

const url = process.env.PRISM_TEST_POSTGRES_URL;
const recordEvidence = process.env.PRISM_PHASE12_RECORD_EVIDENCE === "1";
const worker = new URL("./fixtures/phase12-restart-worker.mjs", import.meta.url);
const cursorSecret = "phase12-restart-cursor-secret";
const ownership = {
  tenantId: "tenant-restart",
  accountId: "account-1",
  userId: "user-1",
};
const identity = {
  ...ownership,
  principal: { kind: "agent", id: "agent-restart" },
  scopes: ["tools:execute"],
  issuedAt: "2026-08-01T00:00:00.000Z",
  verified: true,
};
const schemas = new Set();
const pools = [];

function schema() {
  const value = `prism_phase12_${randomUUID().replaceAll("-", "")}`;
  schemas.add(value);
  return value;
}

function pool(max = 8) {
  const value = new Pool({ connectionString: url, max });
  pools.push(value);
  return value;
}

function runWorker(mode, valueSchema, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker.pathname, mode], {
      env: {
        ...process.env,
        PRISM_PHASE12_WORKER_INPUT: JSON.stringify({
          url,
          schema: valueSchema,
          ownership,
          identity,
          mode,
        }),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Spawn replica A, wait for its STATE line, SIGKILL it, run replica B. */
async function killAndResume(valueSchema, resumeEnv = {}) {
  const a = spawn(process.execPath, [worker.pathname, "run"], {
    env: {
      ...process.env,
      PRISM_PHASE12_WORKER_INPUT: JSON.stringify({
        url,
        schema: valueSchema,
        ownership,
        identity,
        mode: "run",
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  a.stdout.on("data", (chunk) => (stdout += chunk));
  a.stderr.on("data", (chunk) => (stderr += chunk));
  const stateLine = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`replica A did not reach suspension: ${stdout} ${stderr}`)), 60000);
    const check = () => {
      const match = stdout.match(/STATE (.+)\n/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    a.stdout.on("data", check);
    a.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`replica A exited early (code ${code}): ${stdout} ${stderr}`));
    });
    a.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const state = JSON.parse(stateLine);
  a.kill("SIGKILL");
  await new Promise((resolve) => a.on("exit", resolve));
  const b = await runWorker("resume", valueSchema, {
    PRISM_PHASE12_RESUME_STATE: JSON.stringify(state),
    ...resumeEnv,
  });
  return { state, b };
}

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

async function waitForListener(database) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const result = await database.query(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = 'LISTEN prism_agent_events' ORDER BY backend_start DESC LIMIT 1",
    );
    if (typeof result.rows[0]?.pid === "number") return result.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("LISTEN backend did not start");
}

describe("Phase 12 protected restart recovery", () => {
  if (!url) {
    it("BLOCKED GATE: PRISM_TEST_POSTGRES_URL is required for protected restart-recovery evidence", () => {
      assert.fail(
        "BLOCKED GATE: protected multi-replica/restart-recovery evidence cannot be recorded without PRISM_TEST_POSTGRES_URL. " +
          "Run under `npm run test:postgres` against a disposable PostgreSQL 16 (e.g. pgvector/pgvector:pg16).",
      );
    });
    return;
  }

  after(async () => {
    while (pools.length) await pools.pop().end();
    const cleanup = new Pool({ connectionString: url });
    try {
      for (const name of schemas) await cleanup.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    } finally {
      await cleanup.end();
    }
  });

  it("kills replica A mid-run and resumes on replica B with no gap, no duplicate, and exactly-once effects", async () => {
    const valueSchema = schema();
    const { state, b } = await killAndResume(valueSchema);
    assert.equal(b.code, 0, `replica B failed:\n${b.stdout}\n${b.stderr}`);
    assert.match(b.stdout, /RESTART RECOVERY OK reconnectMs=\d+/);
    assert.ok(Number(b.stdout.match(/reconnectMs=(\d+)/)?.[1]) > 0);
    assert.ok(state.version >= 1, "replica A reported a persisted run version");
  });

  it("records reconnect p95 across repeated kill/resume cycles under the frozen ceiling", async () => {
    const reconnectSamples = [];
    for (let i = 0; i < 3; i += 1) {
      const { b } = await killAndResume(schema());
      assert.equal(b.code, 0, `replica B failed on cycle ${i}:\n${b.stdout}\n${b.stderr}`);
      reconnectSamples.push(Number(b.stdout.match(/reconnectMs=(\d+)/)?.[1]));
    }
    const manifest = JSON.parse(readFileSync(new URL("../scripts/phase12-freeze-manifest.json", import.meta.url), "utf8"));
    const ceiling = manifest.capacity.postgresEvidence.reconnectP95Ms;
    const measured = p95(reconnectSamples);
    assert.ok(measured <= ceiling, `reconnect p95 ${measured}ms exceeds frozen ceiling ${ceiling}ms`);
    if (recordEvidence) {
      writeFileSync(
        new URL("../scripts/phase12-restart-recovery.json", import.meta.url),
        JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            reconnectP95Ms: measured,
            reconnectSamples,
            reconnectCeilingMs: ceiling,
            postgres: {
              driver: "pg",
              major: 16,
              image: "pgvector/pgvector:pg16",
            },
          },
          null,
          2,
        ),
      );
    }
  });

  it("records append contention p95 under the frozen point-op ceiling", async () => {
    const valueSchema = schema();
    const workers = await Promise.all(Array.from({ length: 16 }, (_, index) => runWorker("append", valueSchema)));
    const appendMs = [];
    for (const w of workers) {
      assert.equal(w.code, 0, `append worker failed:\n${w.stdout}\n${w.stderr}`);
      appendMs.push(Number(w.stdout.match(/appendMs":(\d+\.?\d*)/)?.[1]));
    }
    const manifest = JSON.parse(readFileSync(new URL("../scripts/phase12-freeze-manifest.json", import.meta.url), "utf8"));
    const ceiling = manifest.capacity.postgresEvidence.pointOpP95Ms;
    const measured = p95(appendMs);
    assert.ok(measured <= ceiling, `append p95 ${measured}ms exceeds frozen point-op ceiling ${ceiling}ms`);
    if (recordEvidence) {
      const evidencePath = new URL("../scripts/phase12-restart-recovery.json", import.meta.url);
      const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : {};
      writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            ...evidence,
            contentionP95Ms: measured,
            contentionSamples: appendMs,
            contentionCeilingMs: ceiling,
          },
          null,
          2,
        ),
      );
    }
  });

  it("database restart during streaming: terminated LISTEN backend recovers by polling", async () => {
    const valueSchema = schema();
    const database = pool(4);
    const subscriber = await createPostgresPersistence({
      pool: database,
      schema: valueSchema,
      eventCursorSecret: cursorSecret,
      eventSource: {
        pollIntervalMs: 25,
        reconnectInitialMs: 5000,
        reconnectMaxMs: 5000,
      },
    });
    const input = {
      ownership,
      sessionId: "db-restart-s",
      runId: "db-restart-r",
    };
    const iterator = subscriber.events.subscribe(input)[Symbol.asyncIterator]();
    const next = iterator.next();
    const pid = await waitForListener(database);
    assert.equal((await database.query("SELECT pg_terminate_backend($1, 1000) AS terminated", [pid])).rows[0]?.terminated, true);
    const append = await runWorker("append", valueSchema, {
      PRISM_PHASE12_PROBE_SESSION: input.sessionId,
      PRISM_PHASE12_PROBE_RUN: input.runId,
    });
    assert.equal(append.code, 0, append.stderr);
    const item = await Promise.race([
      next,
      new Promise((_, reject) => setTimeout(() => reject(new Error("poll catch-up timed out after backend termination")), 5000)),
    ]);
    assert.equal(item.done, false);
    assert.match(String(item.value.record.id), /^probe-/);
    await iterator.return?.();
    await subscriber.close();
  });
});
