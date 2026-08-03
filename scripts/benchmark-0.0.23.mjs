#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../packages/enterprise-postgres/dist/index.js";

const url = process.env.PRISM_TEST_POSTGRES_URL;
if (!url?.trim()) throw new Error("PRISM_TEST_POSTGRES_URL is required for the protected enterprise PostgreSQL benchmark");

const budgets = JSON.parse(await readFile(new URL("./budgets.json", import.meta.url), "utf8"));
const config = budgets.enterprisePostgres;
const iterations = integerEnv("PRISM_BENCH_ITERATIONS", config.fixture.measuredOperations, 10, config.fixture.measuredOperations);
const warmups = config.fixture.warmups;
const workers = config.fixture.clients;
const schema = `prism_bench_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: url, max: workers });
const state = await createPostgresEnterpriseState({ pool, schema });
const table = (name) => `"${schema}"."${name}"`;
const now = new Date().toISOString();
const results = [];
let acceptedRateContention = 0;
let budgetTokenSum = 0;
let circuitProbeCount = 0;

function integerEnv(name, fallback, min, max) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return value;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function owner(index) {
  const tenant = Math.floor(index / config.fixture.principalsPerTenant);
  const principal = index % config.fixture.principalsPerTenant;
  return {
    tenantId: `tenant-${tenant}`,
    userId: `user-${principal}`,
    principalId: `agent-${principal}`,
    identity: {
      tenantId: `tenant-${tenant}`,
      userId: `user-${principal}`,
      principal: { kind: "agent", id: `agent-${principal}` },
      scopes: ["model:route", "work:mutate"],
      issuedAt: now,
      verified: true,
    },
  };
}

const owners = Array.from({ length: config.fixture.tenants * config.fixture.principalsPerTenant }, (_, index) => owner(index));
const benchmarkOwner = owners[0];
const cleanupOwner = {
  tenantId: "tenant-cleanup",
  userId: "user-cleanup",
  principalId: "agent-cleanup",
  identity: {
    tenantId: "tenant-cleanup",
    userId: "user-cleanup",
    principal: { kind: "agent", id: "agent-cleanup" },
    scopes: ["model:route", "work:mutate"],
    issuedAt: now,
    verified: true,
  },
};

function stateKey(value, provider = "openai", model = "gpt") {
  return {
    tenantId: value.tenantId,
    userId: value.userId,
    principalId: value.principalId,
    provider,
    model,
  };
}

async function retryContention(operation) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || error.code !== "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE") throw error;
    }
  }
  throw lastError;
}

async function batches(total, operation) {
  for (let start = 0; start < total; start += workers) {
    await Promise.all(Array.from({ length: Math.min(workers, total - start) }, (_, offset) => operation(start + offset)));
  }
}

async function timed(operation) {
  const before = performance.now();
  const value = await operation();
  return { value, latencyMs: performance.now() - before };
}

async function measure(name, operation, operationsPerIteration = 1) {
  for (let index = 0; index < warmups; index += 1) await operation(-warmups + index, false);
  const latencies = [];
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const before = performance.now();
    const result = await operation(index, true);
    if (Array.isArray(result?.latencies)) latencies.push(...result.latencies);
    else latencies.push(performance.now() - before);
  }
  const durationMs = performance.now() - started;
  const p50Ms = Number(percentile(latencies, 0.5).toFixed(3));
  const p95Ms = Number(percentile(latencies, 0.95).toFixed(3));
  const ceiling = config.p95CeilingsMs[name];
  assert(p95Ms <= ceiling, `${name} p95 ${p95Ms}ms exceeded ${ceiling}ms`);
  results.push({
    name,
    operations: iterations * operationsPerIteration,
    p50Ms,
    p95Ms,
    throughputPerSecond: Number(((iterations * operationsPerIteration * 1000) / durationMs).toFixed(2)),
  });
}

async function seed() {
  const recordsPerOwner = config.fixture.recordsPerOwner;
  const totalRecords = owners.length * recordsPerOwner;
  await batches(totalRecords, async (index) => {
    const value = owners[Math.floor(index / recordsPerOwner)];
    const record = index % recordsPerOwner;
    await state.policy.append({
      id: `seed-policy-${index}`,
      policyId: `policy-${record % 4}`,
      policyVersion: "1",
      outcome: ["allow", "deny", "modify", "approval"][record % 4],
      identity: value.identity,
      target: { kind: "benchmark", id: `target-${record}` },
      tenantId: value.tenantId,
      userId: value.userId,
      reason: "bounded benchmark decision",
    });
  });
  await batches(totalRecords, async (index) => {
    const value = owners[Math.floor(index / recordsPerOwner)];
    const record = index % recordsPerOwner;
    await state.evaluations.append({
      id: `seed-evaluation-${index}`,
      scorerId: `scorer-${record % 4}`,
      status: "scored",
      score: 1,
      sampled: true,
      sessionId: `session-${record % 8}`,
      runId: `run-${record % 10}`,
      datasetId: `dataset-${record % 4}`,
      itemId: `item-${record % 20}`,
      experimentId: `experiment-${record % 4}`,
      createdAt: now,
      tenantId: value.tenantId,
      userId: value.userId,
      metadata: { source: "benchmark" },
    });
  });
  await batches(config.fixture.routerKeys, async (index) => {
    const value = owners[index % owners.length];
    const key = stateKey(value, `provider-${Math.floor(index / 100)}`, `model-${index}`);
    await state.modelRouter.consumeRate({ key, maxRequests: 100, windowMs: 60_000, now: 0 });
    await state.modelRouter.addUsage({ key, tokens: 1, costUsd: 0.001, windowMs: 60_000, now: 0 });
  });
  for (let index = 0; index < config.fixture.routerKeys; index += 1) {
    const value = owners[index % owners.length];
    await state.modelRouter.recordCircuitOutcome({
      key: stateKey(value, `provider-${Math.floor(index / 100)}`, `model-${index}`),
      success: true,
      failureThreshold: 3,
      coolDownMs: 60_000,
      maxKeys: 16_384,
      now: 0,
    });
  }
  await batches(iterations + warmups, async (index) => {
    const claim = await state.workIdempotency.begin({ identity: benchmarkOwner.identity, key: `seed-work-${index}`, op: "benchmark.work" });
    assert(claim.outcome === "acquired" && claim.record.claimToken, "seed work claim was not acquired");
    await state.workIdempotency.complete({
      identity: benchmarkOwner.identity,
      key: `seed-work-${index}`,
      op: "benchmark.work",
      claimToken: claim.record.claimToken,
      expectedVersion: claim.record.version,
      result: { draftId: `draft-${index}` },
    });
  });
  const cleanupRows = (iterations + warmups) * config.fixture.cleanupBatch;
  await batches(cleanupRows, async (index) => {
    await state.modelRouter.consumeRate({
      key: stateKey(cleanupOwner, "cleanup", `model-${index}`),
      maxRequests: 1,
      windowMs: 60_000,
      now: 0,
    });
  });
  await pool.query(
    `UPDATE ${table("prism_model_router_rates")} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE tenant_id = $1`,
    [cleanupOwner.tenantId],
  );
  await pool.query(
    `UPDATE ${table("prism_work_idempotency")} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE idempotency_key = $1`,
    ["seed-work-0"],
  );
  for (const name of ["prism_model_router_rates", "prism_model_router_budgets", "prism_model_router_circuits"]) {
    await pool.query(
      `UPDATE ${table(name)} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond'
       WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = $5 AND model = $6`,
      [benchmarkOwner.tenantId, "", benchmarkOwner.userId, benchmarkOwner.principalId, "provider-0", "model-0"],
    );
  }
  for (const name of [
    "prism_policy_decisions",
    "prism_evaluations",
    "prism_work_idempotency",
    "prism_model_router_budgets",
    "prism_model_router_rates",
    "prism_model_router_circuits",
  ]) {
    await pool.query(`ANALYZE ${table(name)}`);
  }
}

function planNodes(value, nodes = []) {
  if (Array.isArray(value)) {
    for (const item of value) planNodes(item, nodes);
  } else if (value && typeof value === "object") {
    if (typeof value["Node Type"] === "string") nodes.push(value);
    for (const item of Object.values(value)) planNodes(item, nodes);
  }
  return nodes;
}

async function explain(name, sql, values, expectedIndex) {
  const result = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values);
  const raw = result.rows[0]?.["QUERY PLAN"];
  const document = typeof raw === "string" ? JSON.parse(raw) : raw;
  const nodes = planNodes(document);
  const indexes = nodes.map((node) => node["Index Name"]).filter((value) => typeof value === "string");
  assert(!nodes.some((node) => node["Node Type"] === "Seq Scan"), `${name} used a sequential scan`);
  assert(indexes.includes(expectedIndex), `${name} did not use ${expectedIndex}: ${indexes.join(", ")}`);
  return { name, indexes, sequentialScan: false };
}

async function queryPlans() {
  const policy = table("prism_policy_decisions");
  const evaluations = table("prism_evaluations");
  const work = table("prism_work_idempotency");
  const rates = table("prism_model_router_rates");
  const budgetsTable = table("prism_model_router_budgets");
  const circuits = table("prism_model_router_circuits");
  const own = [benchmarkOwner.tenantId, "", benchmarkOwner.userId];
  return Promise.all([
    explain(
      "policy-owner",
      `SELECT id FROM ${policy} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 ORDER BY created_at, id LIMIT 100`,
      own,
      "prism_policy_decisions_owner_created_idx",
    ),
    explain(
      "policy-policy",
      `SELECT id FROM ${policy} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND policy_id = 'policy-1' AND policy_version = '1' ORDER BY created_at, id LIMIT 100`,
      own,
      "prism_policy_decisions_owner_policy_created_idx",
    ),
    explain(
      "policy-outcome",
      `SELECT id FROM ${policy} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND outcome = 'deny' ORDER BY created_at, id LIMIT 100`,
      own,
      "prism_policy_decisions_owner_outcome_created_idx",
    ),
    explain(
      "evaluation-scorer",
      `SELECT id FROM ${evaluations} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND scorer_id = 'scorer-1' ORDER BY created_at, id LIMIT 100`,
      own,
      "prism_evaluations_owner_scorer_created_idx",
    ),
    explain(
      "evaluation-run",
      `SELECT id FROM ${evaluations} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND run_id = 'run-1' ORDER BY created_at, id LIMIT 100`,
      own,
      "prism_evaluations_owner_run_created_idx",
    ),
    explain(
      "evaluation-experiment",
      `SELECT id FROM ${evaluations} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND experiment_id = 'experiment-1' ORDER BY created_at, id LIMIT 100`,
      own,
      "prism_evaluations_owner_experiment_created_idx",
    ),
    explain(
      "evaluation-dataset-item",
      `SELECT id FROM ${evaluations} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND dataset_id = 'dataset-1' AND item_id = 'item-1' ORDER BY created_at, id LIMIT 100`,
      own,
      "prism_evaluations_owner_dataset_item_created_idx",
    ),
    explain(
      "work-expiry",
      `SELECT idempotency_key FROM ${work} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND status = 'completed' AND expires_at <= clock_timestamp() ORDER BY expires_at, idempotency_key LIMIT 100`,
      [...own, benchmarkOwner.principalId],
      "prism_work_idempotency_expiry_idx",
    ),
    explain(
      "router-rate",
      `SELECT request_count FROM ${rates} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = 'provider-0' AND model = 'model-0' AND window_ms = 60000`,
      [...own, benchmarkOwner.principalId],
      "prism_model_router_rates_pkey",
    ),
    explain(
      "router-budget",
      `SELECT tokens FROM ${budgetsTable} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = 'provider-0' AND model = 'model-0' AND window_ms = 60000`,
      [...own, benchmarkOwner.principalId],
      "prism_model_router_budgets_pkey",
    ),
    explain(
      "router-circuit",
      `SELECT failures FROM ${circuits} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND provider = 'provider-0' AND model = 'model-0'`,
      [...own, benchmarkOwner.principalId],
      "prism_model_router_circuits_pkey",
    ),
    explain(
      "router-rate-expiry",
      `SELECT provider FROM ${rates} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND expires_at <= clock_timestamp()`,
      [...own, benchmarkOwner.principalId],
      "prism_model_router_rates_expiry_idx",
    ),
    explain(
      "router-budget-expiry",
      `SELECT provider FROM ${budgetsTable} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND expires_at <= clock_timestamp()`,
      [...own, benchmarkOwner.principalId],
      "prism_model_router_budgets_expiry_idx",
    ),
    explain(
      "router-circuit-expiry",
      `SELECT provider FROM ${circuits} WHERE tenant_id = $1 AND account_key = $2 AND user_key = $3 AND principal_id = $4 AND expires_at <= clock_timestamp()`,
      [...own, benchmarkOwner.principalId],
      "prism_model_router_circuits_expiry_idx",
    ),
  ]);
}

async function storage() {
  const names = [
    "prism_policy_decisions",
    "prism_evaluations",
    "prism_work_idempotency",
    "prism_model_router_budgets",
    "prism_model_router_rates",
    "prism_model_router_circuits",
  ];
  const values = {};
  for (const name of names) {
    const result = await pool.query(
      `SELECT count(*)::bigint AS rows, pg_total_relation_size($1::regclass)::bigint AS bytes FROM ${table(name)}`,
      [`${schema}.${name}`],
    );
    values[name] = { rows: Number(result.rows[0]?.rows), bytes: Number(result.rows[0]?.bytes) };
  }
  return values;
}

try {
  await seed();
  const plans = await queryPlans();
  await measure("policyAppend", async (index) => {
    await state.policy.append({
      id: `bench-policy-${index}`,
      policyId: "policy-benchmark",
      policyVersion: "1",
      outcome: "allow",
      identity: benchmarkOwner.identity,
      target: { kind: "benchmark", id: `target-${index}` },
      tenantId: benchmarkOwner.tenantId,
      userId: benchmarkOwner.userId,
    });
  });
  await measure("policyQuery", () => state.policy.query({ tenantId: benchmarkOwner.tenantId, userId: benchmarkOwner.userId, limit: 100 }));
  await measure("evaluationAppend", (index) =>
    state.evaluations.append({
      id: `bench-evaluation-${index}`,
      scorerId: "scorer-benchmark",
      status: "scored",
      score: 1,
      sampled: true,
      createdAt: now,
      tenantId: benchmarkOwner.tenantId,
      userId: benchmarkOwner.userId,
    }),
  );
  await measure("evaluationQuery", () =>
    state.evaluations.query({ tenantId: benchmarkOwner.tenantId, userId: benchmarkOwner.userId, limit: 100 }),
  );
  await measure("workClaimComplete", async (index) => {
    const key = `bench-work-${index}`;
    const claim = await state.workIdempotency.begin({ identity: benchmarkOwner.identity, key, op: "benchmark.work" });
    assert(claim.outcome === "acquired" && claim.record.claimToken, "work claim was not acquired");
    await state.workIdempotency.complete({
      identity: benchmarkOwner.identity,
      key,
      op: "benchmark.work",
      claimToken: claim.record.claimToken,
      expectedVersion: claim.record.version,
      result: { draftId: `draft-${index}` },
    });
  });
  await measure(
    "workContention",
    async (index) => {
      const key = `bench-contention-${index}`;
      const claims = await Promise.all(
        Array.from({ length: workers }, () =>
          timed(() => state.workIdempotency.begin({ identity: benchmarkOwner.identity, key, op: "benchmark.work" })),
        ),
      );
      const acquired = claims.map((claim) => claim.value).filter((claim) => claim.outcome === "acquired");
      assert(acquired.length === 1 && acquired[0]?.record.claimToken, "contention did not produce exactly one work claim");
      await state.workIdempotency.complete({
        identity: benchmarkOwner.identity,
        key,
        op: "benchmark.work",
        claimToken: acquired[0].record.claimToken,
        expectedVersion: acquired[0].record.version,
        result: { draftId: `draft-${index}` },
      });
      return { latencies: claims.map((claim) => claim.latencyMs) };
    },
    workers,
  );
  await measure(
    "routerRateContention",
    async (index, measured) => {
      const key = stateKey(benchmarkOwner, "rate-benchmark", `model-${index}`);
      const values = await Promise.all(
        Array.from({ length: workers }, () =>
          timed(() => state.modelRouter.consumeRate({ key, maxRequests: 1, windowMs: 60_000, now: 0 })),
        ),
      );
      const accepted = values.filter((value) => value.value.admitted).length;
      assert(accepted === 1, `rate contention accepted ${accepted}, expected one`);
      if (measured) acceptedRateContention += accepted;
      return { latencies: values.map((value) => value.latencyMs) };
    },
    workers,
  );
  await measure(
    "routerBudgetContention",
    async (index, measured) => {
      const key = stateKey(benchmarkOwner, "budget-benchmark", `model-${index}`);
      const updates = await Promise.all(
        Array.from({ length: workers }, () =>
          timed(() => state.modelRouter.addUsage({ key, tokens: 1, costUsd: 0.01, windowMs: 60_000, now: 0 })),
        ),
      );
      const value = await state.modelRouter.readBudget({ key, windowMs: 60_000, now: 0 });
      assert(value.tokens === workers && Math.abs(value.costUsd - workers * 0.01) < Number.EPSILON, "budget contention lost usage");
      if (measured) budgetTokenSum += value.tokens;
      return { latencies: updates.map((update) => update.latencyMs) };
    },
    workers,
  );
  await measure(
    "routerCircuitContention",
    async (index, measured) => {
      const key = stateKey(benchmarkOwner, "circuit-benchmark", `model-${index}`);
      const input = { key, failureThreshold: 1, coolDownMs: 1_000, maxKeys: 16_384, now: 0 };
      const outcomes = await Promise.all(
        Array.from({ length: workers }, () =>
          timed(() => retryContention(() => state.modelRouter.recordCircuitOutcome({ ...input, success: false }))),
        ),
      );
      await pool.query(
        `UPDATE ${table("prism_model_router_circuits")} SET open_until = clock_timestamp() - INTERVAL '1 millisecond' WHERE tenant_id = $1 AND provider = $2 AND model = $3`,
        [key.tenantId, key.provider, key.model],
      );
      const probes = await Promise.all(
        Array.from({ length: workers }, () => retryContention(() => state.modelRouter.claimCircuitProbe(input))),
      );
      const winner = probes.find((probe) => probe.admitted);
      assert(probes.filter((probe) => probe.admitted).length === 1 && winner?.probeToken, "circuit contention did not grant one probe");
      await state.modelRouter.recordCircuitOutcome({ ...input, success: true, probeToken: winner.probeToken });
      if (measured) circuitProbeCount += 1;
      return { latencies: outcomes.map((outcome) => outcome.latencyMs) };
    },
    workers,
  );
  const storageBeforeCleanup = await storage();
  await measure(
    "cleanupBatch",
    async () => {
      const result = await state.cleanup({
        tenantId: cleanupOwner.tenantId,
        userId: cleanupOwner.userId,
        principalId: cleanupOwner.principalId,
        limit: config.fixture.cleanupBatch,
      });
      assert(result.removed === config.fixture.cleanupBatch && result.transitioned === 0, "cleanup did not remove one full bounded batch");
    },
    config.fixture.cleanupBatch,
  );
  const storageAfterCleanup = await storage();
  assert(acceptedRateContention === iterations, `rate accepts ${acceptedRateContention}, expected ${iterations}`);
  assert(budgetTokenSum === iterations * workers, `budget sum ${budgetTokenSum}, expected ${iterations * workers}`);
  assert(circuitProbeCount === iterations, `circuit probes ${circuitProbeCount}, expected ${iterations}`);
  assert(storageBeforeCleanup.prism_policy_decisions.rows >= config.fixture.policyRows, "policy seed volume is incomplete");
  assert(storageBeforeCleanup.prism_evaluations.rows >= config.fixture.evaluationRows, "evaluation seed volume is incomplete");
  assert(
    storageBeforeCleanup.prism_model_router_rates.rows >= config.fixture.routerKeys + (iterations + warmups) * config.fixture.cleanupBatch,
    "router seed volume is incomplete",
  );
  assert(
    storageAfterCleanup.prism_model_router_rates.rows ===
      storageBeforeCleanup.prism_model_router_rates.rows - (iterations + warmups) * config.fixture.cleanupBatch,
    "cleanup storage growth did not shrink by exact batches",
  );
  console.log(
    JSON.stringify(
      {
        version: "0.0.23",
        generatedAt: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          postgres: "PRISM_TEST_POSTGRES_URL",
          clients: workers,
        },
        fixture: { ...config.fixture, measuredOperations: iterations },
        assertions: { acceptedRateContention, budgetTokenSum, circuitProbeCount },
        results,
        plans,
        storageBeforeCleanup,
        storageAfterCleanup,
      },
      null,
      2,
    ),
  );
} finally {
  await state.close();
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await pool.end();
}
