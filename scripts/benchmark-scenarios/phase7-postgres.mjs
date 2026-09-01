#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../../packages/prism-core/dist/enterprise/postgres/index.js";
import { createPostgresPersistence } from "../../packages/prism-core/dist/sessions/postgres/index.js";

const url = process.env.PRISM_TEST_POSTGRES_URL;
if (!url?.trim()) throw new Error("PRISM_TEST_POSTGRES_URL is required for the protected Phase 7 benchmark");
const budgets = JSON.parse(await readFile(new URL("./budgets.json", import.meta.url), "utf8"));
const config = budgets.phase7Postgres;
const iterations = integerEnv("PRISM_BENCH_ITERATIONS", config.fixture.measuredOperations, 10, config.fixture.measuredOperations);
const schema = `prism_phase7_bench_${randomUUID().replaceAll("-", "")}`;
const writers = new Pool({ connectionString: url, max: config.fixture.producers });
const eventStore = await createPostgresPersistence({
  pool: writers,
  schema,
  eventCursorSecret: "phase7-benchmark-cursor-secret",
  eventSource: { pollIntervalMs: 25 },
});
const enterprise = await createPostgresEnterpriseState({ pool: writers, schema });
const results = [];
const ownership = { tenantId: "tenant-0", accountId: "account-0", userId: "user-0" };
const identity = {
  ...ownership,
  principal: { kind: "agent", id: "agent-0" },
  scopes: ["tools:execute"],
  issuedAt: "2026-08-04T00:00:00.000Z",
  verified: true,
};
const table = (name) => `"${schema}"."${name}"`;

function integerEnv(name, fallback, min, max) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return value;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function owner(index) {
  const tenant = Math.floor(index / config.fixture.principalsPerTenant);
  const principal = index % config.fixture.principalsPerTenant;
  const value = { tenantId: `tenant-${tenant}`, accountId: `account-${tenant}`, userId: `user-${principal}` };
  return {
    ...value,
    identity: {
      ...value,
      principal: { kind: "agent", id: `agent-${tenant}-${principal}` },
      scopes: ["tools:execute"],
      issuedAt: identity.issuedAt,
      verified: true,
    },
  };
}

const owners = Array.from({ length: config.fixture.tenants * config.fixture.principalsPerTenant }, (_, index) => owner(index));

function event(id, value, sessionId, runId, timestamp = "2026-08-04T00:00:00.000Z") {
  return {
    id,
    tenantId: value.tenantId,
    accountId: value.accountId,
    userId: value.userId,
    sessionId,
    runId,
    type: "turn_started",
    timestamp,
    event: { type: "turn_started", sessionId, runId, turn: 1 },
    redacted: true,
  };
}

function effect(key) {
  return {
    identity,
    ownership,
    key,
    sessionId: "effect-session",
    runId: "effect-run",
    toolCallId: "effect-call",
    toolName: "benchmark.effect",
    argumentsHash: "a".repeat(64),
  };
}

async function batches(total, operation) {
  for (let start = 0; start < total; start += config.fixture.producers) {
    await Promise.all(Array.from({ length: Math.min(config.fixture.producers, total - start) }, (_, offset) => operation(start + offset)));
  }
}

async function measure(name, operation, operations = iterations, warmups = config.fixture.warmups) {
  for (let index = 0; index < warmups; index += 1) await operation(-index - 1);
  const values = [];
  let last;
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    const before = performance.now();
    last = await operation(index);
    values.push(performance.now() - before);
  }
  const durationMs = performance.now() - started;
  const p50Ms = Number(percentile(values, 0.5).toFixed(3));
  const p95Ms = Number(percentile(values, 0.95).toFixed(3));
  const ceiling = config.p95CeilingsMs[name];
  assert(p95Ms <= ceiling, `${name} p95 ${p95Ms}ms exceeded ${ceiling}ms`);
  results.push({ name, operations, p50Ms, p95Ms, throughputPerSecond: Number(((operations * 1000) / durationMs).toFixed(2)) });
  return last;
}

async function seed() {
  await batches(owners.length * config.fixture.eventsPerOwner, async (index) => {
    const value = owners[Math.floor(index / config.fixture.eventsPerOwner)];
    const sequence = index % config.fixture.eventsPerOwner;
    await eventStore.events.append(
      event(
        `seed-${index}`,
        value,
        `seed-session-${(index / config.fixture.eventsPerOwner) | 0}`,
        `seed-run-${(index / config.fixture.eventsPerOwner) | 0}`,
        `2026-08-04T00:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
      ),
    );
  });
  await writers.query(`ANALYZE ${table("prism_agent_events")}`);
  await writers.query(`ANALYZE ${table("prism_agent_event_streams")}`);
  await writers.query(`ANALYZE ${table("prism_tool_effects")}`);
}

function planNodes(value, output = []) {
  if (Array.isArray(value)) for (const item of value) planNodes(item, output);
  else if (value && typeof value === "object") {
    if (typeof value["Node Type"] === "string") output.push(value);
    for (const item of Object.values(value)) planNodes(item, output);
  }
  return output;
}

async function explain(source, name, sql, values, index) {
  const result = await source.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values);
  const raw = result.rows[0]?.["QUERY PLAN"];
  const nodes = planNodes(typeof raw === "string" ? JSON.parse(raw) : raw);
  const indexes = nodes.map((node) => node["Index Name"]).filter((value) => typeof value === "string");
  assert(!nodes.some((node) => node["Node Type"] === "Seq Scan"), `${name} used a sequential scan`);
  assert(indexes.includes(index), `${name} did not use ${index}: ${indexes.join(", ")}`);
  return { name, indexes, sequentialScan: false };
}

async function queryPlans() {
  const events = table("prism_agent_events");
  const streams = table("prism_agent_event_streams");
  const effects = table("prism_tool_effects");
  const sessionId = "seed-session-0";
  const runId = "seed-run-0";
  const client = await writers.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    const plans = [
      await explain(
        client,
        "event-replay",
        `SELECT id FROM ${events} WHERE session_id = $1 AND run_id = $2 AND tenant_id = $3 AND account_id = $4 AND user_id = $5 AND redacted = TRUE ORDER BY sequence, id LIMIT 100`,
        [sessionId, runId, ownership.tenantId, ownership.accountId, ownership.userId],
        "prism_agent_events_run_sequence_idx",
      ),
      await explain(
        client,
        "event-sequence-allocation",
        `SELECT next_sequence FROM ${streams} WHERE session_id = $1 AND run_id = $2`,
        [sessionId, runId],
        "prism_agent_event_streams_pkey",
      ),
      await explain(
        client,
        "event-retention-cleanup",
        `SELECT id FROM ${events} WHERE tenant_id = $1 AND account_id = $2 AND user_id = $3 AND timestamp < $4 AND redacted = TRUE ORDER BY timestamp, sequence, id LIMIT 100`,
        [ownership.tenantId, ownership.accountId, ownership.userId, "2027-01-01T00:00:00.000Z"],
        "prism_agent_events_owner_timestamp_sequence_idx",
      ),
      await explain(
        client,
        "effect-key-lookup",
        `SELECT effect_key FROM ${effects} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND effect_key = $5`,
        [ownership.tenantId, ownership.accountId, ownership.userId, identity.principal.id, "plan-effect"],
        "prism_tool_effects_pkey",
      ),
      await explain(
        client,
        "effect-expiry-cleanup",
        `SELECT effect_key FROM ${effects} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND status IN ('pending', 'dispatched') AND expires_at <= clock_timestamp() ORDER BY expires_at, effect_key LIMIT 100`,
        [ownership.tenantId, ownership.accountId, ownership.userId, identity.principal.id],
        "prism_tool_effects_expiry_idx",
      ),
    ];
    await client.query("COMMIT");
    return plans;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

async function storage() {
  const values = {};
  for (const name of ["prism_agent_events", "prism_agent_event_streams", "prism_tool_effects"]) {
    const result = await writers.query(
      `SELECT count(*)::bigint AS rows, pg_total_relation_size($1::regclass)::bigint AS bytes FROM ${table(name)}`,
      [`${schema}.${name}`],
    );
    values[name] = { rows: Number(result.rows[0]?.rows), bytes: Number(result.rows[0]?.bytes) };
  }
  return values;
}

async function streamReplay() {
  const sessionId = "stream-session";
  const runId = "stream-run";
  await batches(config.fixture.sustainedStreamEvents, (index) =>
    eventStore.events.append(event(`stream-${index}`, ownership, sessionId, runId)),
  );
  const beforeHeap = process.memoryUsage().heapUsed;
  const replicas = await Promise.all(
    Array.from({ length: config.fixture.subscribers }, async () => {
      const replicaPool = new Pool({ connectionString: url, max: 2 });
      const replica = await createPostgresPersistence({ pool: replicaPool, schema, eventCursorSecret: "phase7-benchmark-cursor-secret" });
      return { replicaPool, replica };
    }),
  );
  const started = performance.now();
  const delivered = await Promise.all(
    replicas.map(async ({ replica }) => {
      const iterator = replica.events.subscribe({ ownership, sessionId, runId })[Symbol.asyncIterator]();
      let count = 0;
      try {
        while (count < config.fixture.sustainedStreamEvents) {
          const item = await iterator.next();
          assert(!item.done, "subscriber closed during sustained replay");
          count += 1;
        }
        return count;
      } finally {
        await iterator.return?.();
      }
    }),
  );
  const durationMs = performance.now() - started;
  await Promise.all(
    replicas.map(async ({ replica, replicaPool }) => {
      await replica.close();
      await replicaPool.end();
    }),
  );
  return {
    events: config.fixture.sustainedStreamEvents,
    subscribers: config.fixture.subscribers,
    deliveries: delivered.reduce((total, value) => total + value, 0),
    throughputPerSecond: Number(((config.fixture.sustainedStreamEvents * 1000) / durationMs).toFixed(2)),
    durationMs: Number(durationMs.toFixed(3)),
    subscriberHeapBytes: Math.max(0, process.memoryUsage().heapUsed - beforeHeap),
  };
}

async function reconnectCatchup() {
  const latencies = [];
  const sessionId = "reconnect-session";
  const runId = "reconnect-run";
  for (let index = 0; index < config.fixture.reconnectSamples; index += 1) {
    const old = await eventStore.events.append(event(`reconnect-old-${index}`, ownership, sessionId, runId));
    const cursor = (await eventStore.events.page({ ownership, sessionId, runId, limit: 100 })).items.find(
      (item) => item.record.id === old.id,
    )?.cursor;
    assert(cursor, "reconnect cursor missing");
    const replicaPool = new Pool({ connectionString: url, max: 2 });
    const replica = await createPostgresPersistence({ pool: replicaPool, schema, eventCursorSecret: "phase7-benchmark-cursor-secret" });
    const iterator = replica.events.subscribe({ ownership, sessionId, runId, after: cursor })[Symbol.asyncIterator]();
    const before = performance.now();
    const next = iterator.next();
    await eventStore.events.append(event(`reconnect-new-${index}`, ownership, sessionId, runId));
    const item = await next;
    latencies.push(performance.now() - before);
    assert(item.value?.record.id === `reconnect-new-${index}`, "reconnect did not catch up from cursor");
    await iterator.return?.();
    await replica.close();
    await replicaPool.end();
  }
  const p50Ms = Number(percentile(latencies, 0.5).toFixed(3));
  const p95Ms = Number(percentile(latencies, 0.95).toFixed(3));
  assert(p95Ms <= config.p95CeilingsMs.reconnectCatchup, `reconnectCatchup p95 ${p95Ms}ms exceeded ceiling`);
  return {
    name: "reconnectCatchup",
    operations: latencies.length,
    p50Ms,
    p95Ms,
    throughputPerSecond: Number(((latencies.length * 1000) / latencies.reduce((sum, value) => sum + value, 0)).toFixed(2)),
  };
}

try {
  await seed();
  await measure("eventAppend", (index) => eventStore.events.append(event(`append-${index}`, ownership, "append-session", "append-run")));
  await measure("eventPage", () => eventStore.events.page({ ownership, sessionId: "seed-session-0", runId: "seed-run-0", limit: 100 }));
  await measure("effectClaimTransition", async (index) => {
    const key = effect(`effect-${index}`);
    const claim = await enterprise.toolEffects.begin(key);
    assert(claim.outcome === "acquired" && claim.record.claimToken, "effect claim was not acquired");
    const dispatched = await enterprise.toolEffects.markDispatched({
      ...key,
      claimToken: claim.record.claimToken,
      expectedVersion: claim.record.version,
    });
    await enterprise.toolEffects.complete({
      ...key,
      claimToken: dispatched.claimToken,
      expectedVersion: dispatched.version,
      result: { toolCallId: key.toolCallId, name: key.toolName, value: { ok: true } },
    });
  });
  await batches(config.fixture.cleanupBatch, (index) =>
    eventStore.events.append(event(`event-cleanup-${index}`, ownership, "cleanup-session", "cleanup-run", "2020-01-01T00:00:00.000Z")),
  );
  for (let index = 0; index < config.fixture.cleanupBatch; index += 1) {
    const cleanupKey = effect(`effect-cleanup-${index}`);
    const cleanupClaim = await enterprise.toolEffects.begin(cleanupKey);
    const cleanupDispatched = await enterprise.toolEffects.markDispatched({
      ...cleanupKey,
      claimToken: cleanupClaim.record.claimToken,
      expectedVersion: cleanupClaim.record.version,
    });
    await enterprise.toolEffects.complete({
      ...cleanupKey,
      claimToken: cleanupDispatched.claimToken,
      expectedVersion: cleanupDispatched.version,
      result: { toolCallId: cleanupKey.toolCallId, name: cleanupKey.toolName },
    });
  }
  await writers.query(
    `UPDATE ${table("prism_tool_effects")} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE effect_key LIKE 'effect-cleanup-%'`,
  );
  const storageBeforeCleanup = await storage();
  const eventCleanup = await measure(
    "eventCleanup",
    () => eventStore.events.cleanup({ ownership, before: "2021-01-01T00:00:00.000Z", limit: config.fixture.cleanupBatch }),
    1,
    0,
  );
  assert(eventCleanup.deleted === config.fixture.cleanupBatch, "event cleanup did not remove one full batch");
  const effectCleanup = await measure(
    "effectCleanup",
    () =>
      enterprise.cleanup({
        tenantId: ownership.tenantId,
        accountId: ownership.accountId,
        userId: ownership.userId,
        principalId: identity.principal.id,
        limit: config.fixture.cleanupBatch,
      }),
    1,
    0,
  );
  assert(effectCleanup.removed === config.fixture.cleanupBatch, "effect cleanup did not remove one full batch");
  const storageAfterCleanup = await storage();
  const plans = await queryPlans();
  const sustainedStream = await streamReplay();
  results.push(await reconnectCatchup());
  assert(sustainedStream.deliveries === sustainedStream.events * sustainedStream.subscribers, "sustained replay lost events");
  console.log(
    JSON.stringify(
      {
        version: "0.0.24",
        generatedAt: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: cpus()[0]?.model ?? "unknown",
          memoryBytes: totalmem(),
          postgres: (await writers.query("SHOW server_version")).rows[0]?.server_version,
          producers: config.fixture.producers,
          subscribers: config.fixture.subscribers,
        },
        fixture: { ...config.fixture, measuredOperations: iterations },
        results,
        sustainedStream,
        plans,
        storageBeforeCleanup,
        storageAfterCleanup,
      },
      null,
      2,
    ),
  );
} finally {
  await eventStore.close();
  await enterprise.close();
  await writers.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await writers.end();
}
