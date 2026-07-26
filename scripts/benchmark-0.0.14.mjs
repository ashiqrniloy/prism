#!/usr/bin/env node
/**
 * Release 0.0.14 network-free Phase 9 evidence: durable conversation replay,
 * memory consent-filtered injection, artifact revision/delivery, AG-UI co-work
 * mapping, and connector token refresh overhead.
 * Evidence fields only — bounds/fixtures, not timings, gate release.
 */
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const iterations = Number(process.env.PRISM_BENCH_ITERATIONS ?? 100);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 100_000) {
  throw new Error("PRISM_BENCH_ITERATIONS must be 10..100000");
}

const REQUIRED_RESULT_FIELDS = Object.freeze([
  "scenario", "mode", "iterations", "throughputPerSecond", "p50Ms", "p95Ms",
  "memoryBytes", "peakQueueEvents", "eventBytes", "diskBytes", "processCount",
  "estimatedCostUsd", "backpressureSignals", "resourceLimitSignals",
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
    scenario, mode, iterations,
    throughputPerSecond: Number((iterations / (durationMs / 1000)).toFixed(2)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(4)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(4)),
    memoryBytes: process.memoryUsage().heapUsed,
    peakQueueEvents, eventBytes,
    diskBytes: 0, processCount: 1, estimatedCostUsd: 0, backpressureSignals: 0, resourceLimitSignals,
  };
  assertResultSchema(row);
  results.push(row);
}

async function workspace(specifier, fallback) {
  try { return await import(specifier); }
  catch { return import(pathToFileURL(join(process.cwd(), fallback)).href); }
}

const core = await workspace("@arnilo/prism", "dist/index.js");
const server = await workspace("@arnilo/prism-server", "packages/server/dist/index.js");
const memory = await workspace("@arnilo/prism-memory", "packages/memory/dist/index.js");
const agui = await workspace("@arnilo/prism-ag-ui", "packages/ag-ui/dist/index.js");
const creds = await workspace("@arnilo/prism-credentials-node", "packages/credentials-node/dist/index.js");
const sqlite = await workspace("@arnilo/prism-session-store-sqlite", "packages/session-store-sqlite/dist/index.js");

const ownership = { tenantId: "bench-tenant", userId: "bench-user" };
const redactor = core.createSecretRedactor(["super-secret"]);

// 1. Durable conversation replay: seed a thread once through a mock agent run,
//    then measure the reconnectable redacted replay read path.
const persistence = sqlite.createSqlitePersistence({ filename: ":memory:" });
const agent = core.createAgent({
  model: { provider: "mock", model: "offline" },
  provider: core.createMockProvider([
    core.providerTextDelta("Saved to your durable thread."),
    core.providerUsage({ inputTokens: 5, outputTokens: 6, totalTokens: 11 }),
    core.providerDone(),
  ]),
  redactor,
  store: persistence,
  runLedger: persistence,
});
const conversations = server.createConversationService(persistence, {
  redactor,
  sessionFactory: ({ thread, leafId }) =>
    agent.createSession({ id: thread.id, ...(leafId === undefined ? {} : { leafId }) }),
});
const thread = await conversations.create({ ownership, title: "bench-thread" });
await conversations.continue({ ownership, threadId: thread.id, message: "Summarize the launch.", requestId: "req-1" });
await measure("conversation-replay", "sqlite-memory", async () => {
  const replay = await conversations.replay({ ownership, threadId: thread.id });
  return {
    queueEvents: replay.records.length,
    eventBytes: Buffer.byteLength(JSON.stringify(replay.records), "utf8"),
    limit: !replay.records.every((record) => record.redacted === true),
  };
});

// 2. Memory consent-filtered injection: hash embedder (network-free), one
//    invisible entry; strict recall must keep it out of the injected context.
const semantic = memory.createMemory({
  tenantId: "bench-tenant",
  resourceId: "bench-user",
  threadId: "bench-thread",
  embedder: memory.createHashEmbedder({ dimensions: 64 }),
});
await semantic.remember(
  {
    entries: [
      { id: "a", text: "favorite color is blue", sequence: 1 },
      { id: "b", text: "prefers concise bullet answers", sequence: 2 },
      { id: "secret", text: "favorite color is teal", sequence: 3, consent: { visible: false } },
    ],
  },
  { wait: true },
);
await measure("memory-consent-recall", "memory-store", async () => {
  const recalled = await semantic.recall("concise bullet answers", { topK: 4, requireConsent: true });
  return {
    queueEvents: recalled.hits.length,
    eventBytes: Buffer.byteLength(JSON.stringify(recalled.hits), "utf8"),
    limit: recalled.hits.some((hit) => hit.id === "secret"),
  };
});

// 3. Artifact revision/delivery: attach + revise + approve once, then measure
//    minting an expiring authorized delivery link (HMAC signing, refs only).
const artifacts = server.createArtifactService(core.createMemoryCheckpointStore(), {
  redactor,
  linkSecret: "bench-delivery-link-secret",
});
const artifactThreadId = "bench-artifact-thread";
const attached = await artifacts.attach({
  ownership,
  threadId: artifactThreadId,
  uri: "https://storage.example/release-plan.md",
  mime: "text/markdown",
  hash: "sha256:aaa111",
  title: "Release plan",
});
await artifacts.revise({
  ownership,
  threadId: artifactThreadId,
  artifactId: attached.id,
  uri: "https://storage.example/release-plan.md",
  hash: "sha256:bbb222",
  changeNote: "Added rollout dates",
});
await artifacts.approve({ ownership, threadId: artifactThreadId, artifactId: attached.id, version: 2, reviewer: "reviewer-1" });
await measure("artifact-delivery-link", "memory-store", async () => {
  const delivery = await artifacts.deliveryLink({ ownership, threadId: artifactThreadId, artifactId: attached.id });
  return { queueEvents: delivery.token.version, eventBytes: Buffer.byteLength(delivery.link, "utf8") };
});

// 4. AG-UI co-work mapping: pure projection of a co-work event to AG-UI events.
const mapper = agui.createAgUiEventMapper({ redactor });
const coworkEvent = { kind: "artifact.progress", artifactId: attached.id, version: 2, status: "in-review", progress: 0.5 };
await measure("cowork-map", "in-process", async () => {
  const mapped = mapper.mapCoWork(coworkEvent);
  return { queueEvents: mapped.length, eventBytes: Buffer.byteLength(JSON.stringify(mapped), "utf8") };
});

// 5. Connector token refresh: expired credential + fake token endpoint that
//    returns an immediately-stale token, so every resolution exercises the
//    late-bound refresh round-trip (single-flight, fail-closed) with no network.
const credentialStore = (() => {
  const map = new Map();
  const key = (provider, accountId) => `${provider}\u0000${accountId ?? ""}`;
  return {
    async set(provider, credential) { map.set(key(provider, credential.accountId), credential); },
    async get(provider, accountId) { return map.get(key(provider, accountId)); },
    async delete(provider, accountId) { return map.delete(key(provider, accountId)); },
  };
})();
await credentialStore.set("microsoft365", { access: "expired", refresh: "r", accountId: "acct-1", expires: Date.now() - 1000 });
const oauthProvider = creds.createMicrosoft365OAuthProvider({
  fetch: async () => Response.json({ access_token: "fresh", refresh_token: "r2", expires_in: 0 }),
});
const tokenProvider = creds.createOAuthWorkTokenProvider({
  provider: oauthProvider,
  store: credentialStore,
  envVar: "PRISM_BENCH_M365_TOKEN",
});
const connectorIdentity = {
  tenantId: "bench-tenant",
  accountId: "acct-1",
  userId: "bench-user",
  principal: { kind: "user", id: "bench-user" },
  scopes: ["Mail.Read"],
  issuedAt: new Date().toISOString(),
  verified: true,
};
await measure("connector-token-refresh", "fake-oauth", async () => {
  const env = await tokenProvider.tokenEnv(connectorIdentity);
  return {
    queueEvents: env ? 1 : 0,
    eventBytes: env ? Buffer.byteLength(JSON.stringify(env), "utf8") : 0,
    limit: !env,
  };
});

const report = {
  generatedAt: new Date().toISOString(), release: "0.0.14",
  environment: { node: process.version, platform: process.platform, arch: process.arch, network: false, credentials: false },
  schema: { requiredResultFields: REQUIRED_RESULT_FIELDS },
  frozenBudgets: {
    conversationListPages: "50/200",
    conversationActiveBranches: "16/64",
    replayExportPageEvents: "100/500",
    artifactRevisionsPerArtifact: "32/128",
    memoryRetentionBatch: "500/5000",
    capabilityTtl: "24h/31d",
    browserCheckpointsPerRun: "16/64",
    deviceStreamChunkBytes: "1MiB/8MiB",
    coworkMaxTextBytes: "64KiB/1MiB",
  },
  results,
};
for (const row of results) assertResultSchema(row);
console.log(JSON.stringify(report, null, 2));
