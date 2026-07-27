#!/usr/bin/env node
import { join } from "node:path";
/**
 * Release 0.0.13 network-free enterprise identity/policy/router/connector/deployment evidence.
 * Evidence fields only — bounds/fixtures, not timings, gate release.
 */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const iterations = Number(process.env.PRISM_BENCH_ITERATIONS ?? 100);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 100_000) {
  throw new Error("PRISM_BENCH_ITERATIONS must be 10..100000");
}

const REQUIRED_RESULT_FIELDS = Object.freeze([
  "scenario",
  "mode",
  "iterations",
  "throughputPerSecond",
  "p50Ms",
  "p95Ms",
  "memoryBytes",
  "peakQueueEvents",
  "eventBytes",
  "diskBytes",
  "processCount",
  "estimatedCostUsd",
  "backpressureSignals",
  "resourceLimitSignals",
]);
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)];
const results = [];

function assertResultSchema(row) {
  for (const field of REQUIRED_RESULT_FIELDS) if (!(field in row)) throw new Error(`benchmark result missing field: ${field}`);
  for (const field of ["throughputPerSecond", "p50Ms", "p95Ms", "memoryBytes", "peakQueueEvents", "eventBytes"]) {
    if (!Number.isFinite(row[field]) || row[field] < 0) throw new Error(`invalid ${field} for ${row.scenario}`);
  }
}

async function measure(scenario, mode, operation) {
  const latencies = [];
  let peakQueueEvents = 0;
  let eventBytes = 0;
  let resourceLimitSignals = 0;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const before = performance.now();
    const details = await operation(index);
    latencies.push(performance.now() - before);
    peakQueueEvents = Math.max(peakQueueEvents, details?.queueEvents ?? 0);
    eventBytes = Math.max(eventBytes, details?.eventBytes ?? 0);
    resourceLimitSignals += details?.limit ? 1 : 0;
  }
  const durationMs = performance.now() - started;
  const row = {
    scenario,
    mode,
    iterations,
    throughputPerSecond: Number((iterations / (durationMs / 1000)).toFixed(2)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(4)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(4)),
    memoryBytes: process.memoryUsage().heapUsed,
    peakQueueEvents,
    eventBytes,
    diskBytes: 0,
    processCount: 1,
    estimatedCostUsd: 0,
    backpressureSignals: 0,
    resourceLimitSignals,
  };
  assertResultSchema(row);
  results.push(row);
}

async function workspace(specifier, fallback) {
  try {
    return await import(specifier);
  } catch {
    return import(pathToFileURL(join(process.cwd(), fallback)).href);
  }
}

const core = await workspace("@arnilo/prism", "dist/index.js");
const policy = await workspace("@arnilo/prism-policy", "packages/policy/dist/index.js");
const router = await workspace("@arnilo/prism-model-router", "packages/model-router/dist/index.js");
const work = await workspace("@arnilo/prism-work-tools", "packages/work-tools/dist/index.js");
const server = await workspace("@arnilo/prism-server", "packages/server/dist/index.js");

const identity = {
  tenantId: "bench-tenant",
  userId: "bench-user",
  principal: { kind: "user", id: "bench-user" },
  scopes: ["Mail.Read", "Mail.Send"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

await measure("identity-narrow-propagate", "in-process", () => {
  core.assertIdentityActive(identity);
  const child = core.narrowIdentity(identity, { scopes: ["Mail.Read"] });
  core.assertIdentityPropagation(identity, child);
  return { queueEvents: child.scopes.length, eventBytes: Buffer.byteLength(JSON.stringify(child), "utf8") };
});

const store = policy.createMemoryPolicyDecisionStore();
const evaluator = policy.createPolicyEvaluator({
  policyId: "bench",
  policyVersion: "1",
  evaluate: ({ action }) => (action === "deny" ? { outcome: "deny", reason: "bench" } : { outcome: "allow" }),
});
await measure("policy-evaluate-append", "memory-store", async (index) => {
  const record = await policy.evaluateAndAppend(
    { identity, action: `action-${index % 4}`, resource: { kind: "bench", id: String(index) } },
    { store, evaluator, id: `decision-${index}` },
  );
  return { queueEvents: 1, eventBytes: Buffer.byteLength(JSON.stringify(record), "utf8") };
});

const modelRouter = router.createModelRouter({
  resolver: (m) => ({
    id: m.provider,
    async *generate() {
      /* bench */
    },
  }),
  allowList: { providers: ["mock"], models: ["bench"] },
});
await measure("model-router-resolve", "in-process", async () => {
  const resolved = await modelRouter.resolve({ model: { provider: "mock", model: "bench" } });
  return {
    queueEvents: resolved.diagnostics.attempts.length,
    eventBytes: Buffer.byteLength(JSON.stringify(resolved.diagnostics), "utf8"),
  };
});

await measure("work-tools-argv-normalize", "fake-cli", async (index) => {
  const argv = work.buildMicrosoft365Argv("mail.list", { folderName: "inbox" });
  work.assertSafeArgv(argv);
  const page = work.normalizeMailPage("microsoft365", { value: [{ id: `m-${index}`, subject: "s" }] });
  return { queueEvents: page.items.length, eventBytes: Buffer.byteLength(JSON.stringify(page), "utf8") };
});

const drain = server.createPrismDrainController({ deadlineMs: 60_000 });
const health = server.createPrismHealthHandler({ live: () => true });
await measure("server-drain-health", "in-process", async () => {
  drain.assertAdmit();
  const live = await health(new Request("https://bench/health/livez"));
  const body = await live.text();
  return { queueEvents: 1, eventBytes: Buffer.byteLength(body, "utf8") };
});

const report = {
  generatedAt: new Date().toISOString(),
  release: "0.0.13",
  environment: { node: process.version, platform: process.platform, arch: process.arch, network: false, credentials: false },
  schema: { requiredResultFields: REQUIRED_RESULT_FIELDS },
  frozenBudgets: {
    identityScopes: "64/256",
    policyDecisionBytes: "8KiB/64KiB",
    routerAttempts: "3/8",
    workPaginationPages: "20/100",
    deploymentHealthBytes: "4KiB/64KiB",
  },
  results,
};
for (const row of results) assertResultSchema(row);
console.log(JSON.stringify(report, null, 2));
