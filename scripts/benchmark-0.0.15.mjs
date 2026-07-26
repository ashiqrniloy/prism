#!/usr/bin/env node
/**
 * Release 0.0.15 network-free provider, RAG, and memory evidence.
 * Bounds/fixtures are release gates; host-local timings are not.
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
const results = [];
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)];

function assertResultSchema(row) {
  for (const field of REQUIRED_RESULT_FIELDS) if (!(field in row)) throw new Error(`benchmark result missing ${field}`);
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

function sse(events) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}

async function collect(provider, request) {
  const events = [];
  for await (const event of provider.generate(request)) events.push(event);
  return events;
}

function fakeRealtimeTransport() {
  const handlers = new Map();
  const sent = [];
  let state = 1;
  return {
    transport: {
      get readyState() { return state; },
      send(data) { sent.push(data); },
      close() { state = 3; for (const handler of handlers.get("close") ?? []) handler({}); },
      addEventListener(type, handler) { (handlers.get(type) ?? handlers.set(type, []).get(type)).push(handler); },
      removeEventListener() {},
    },
    sent,
    emit(type, data) { for (const handler of handlers.get(type) ?? []) handler({ data }); },
  };
}

const core = await workspace("@arnilo/prism", "dist/index.js");
const openai = await workspace("@arnilo/prism-provider-openai", "packages/provider-openai/dist/index.js");
const aiSdk = await workspace("@arnilo/prism-provider-ai-sdk", "packages/provider-ai-sdk/dist/index.js");
const kimi = await workspace("@arnilo/prism-provider-kimi", "packages/provider-kimi/dist/index.js");
const zai = await workspace("@arnilo/prism-provider-zai", "packages/provider-zai/dist/index.js");
const openrouter = await workspace("@arnilo/prism-provider-openrouter", "packages/provider-openrouter/dist/index.js");
const opencode = await workspace("@arnilo/prism-provider-opencode-go", "packages/provider-opencode-go/dist/index.js");
const alibaba = await workspace("@arnilo/prism-provider-alibaba", "packages/provider-alibaba/dist/index.js");
const ollama = await workspace("@arnilo/prism-provider-ollama", "packages/provider-ollama/dist/index.js");
const neuralwatt = await workspace("@arnilo/prism-provider-neuralwatt", "packages/provider-neuralwatt/dist/index.js");
const memory = await workspace("@arnilo/prism-memory", "packages/memory/dist/index.js");
const rag = await workspace("@arnilo/prism-rag", "packages/rag/dist/index.js");

const secret = "bench-secret";
const model = { provider: "openai", model: "gpt-5.1" };
const request = { model, messages: [{ role: "user", content: [{ type: "text", text: "find policy" }] }] };

await measure("openai-hosted-continuation", "fake-responses-sse", async () => {
  let credentialResolutions = 0;
  let hop = 0;
  const provider = openai.createOpenAIResponsesProvider({
    apiKey: () => { credentialResolutions += 1; return secret; },
    fetch: async () => {
      hop += 1;
      return new Response(sse(hop === 1 ? [
        { type: "response.output_item.added", output_index: 0, item: { type: "web_search_call", id: "search_1" } },
        { type: "response.output_text.delta", delta: "partial " },
        { type: "response.completed", response: { id: "response_1", status: "incomplete" } },
      ] : [
        { type: "response.output_text.delta", delta: "complete" },
        { type: "response.completed", response: { id: "response_2", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ]), { status: 200 });
    },
  });
  const events = await collect(provider, request);
  const json = JSON.stringify(events);
  const hosted = events.some((event) => event.type === "tool_call" && event.call.authority === "provider-hosted");
  return {
    queueEvents: events.length,
    eventBytes: Buffer.byteLength(json, "utf8"),
    limit: credentialResolutions === 0 || hop !== 2 || !hosted || !events.some((event) => event.type === "continuation_required") || !events.some((event) => event.type === "done") || json.includes(secret),
  };
});

await measure("openai-realtime-envelope", "fake-websocket", async (index) => {
  const fake = fakeRealtimeTransport();
  const session = openai.createOpenAIRealtimeSession({
    model,
    ownerId: `bench-owner-${index}`,
    apiKey: secret,
    webSocket: () => fake.transport,
  });
  const iterator = session.events()[Symbol.asyncIterator]();
  const started = iterator.next();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fake.emit("open");
  fake.emit("message", JSON.stringify({ type: "session.created", session: { id: `session-${index}` } }));
  const events = [await started];
  fake.emit("message", JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.from([1, 2]).toString("base64") }));
  events.push(await iterator.next());
  await session.interrupt();
  events.push(await iterator.next());
  await session.close("benchmark");
  events.push(await iterator.next());
  const values = events.map((event) => event.value);
  const json = JSON.stringify(values);
  return {
    queueEvents: values.length,
    eventBytes: Buffer.byteLength(json, "utf8"),
    limit: values.some((event) => !event) || !values.some((event) => event.type === "audio_delta") || !fake.sent.some((item) => item.includes("response.cancel")) || json.includes(secret),
  };
});

function aiSdkModel() {
  return {
    specificationVersion: "v4",
    provider: "benchmark",
    modelId: "benchmark-model",
    supportedUrls: {},
    async doGenerate() { throw new Error("stream only"); },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "response-metadata", id: "ai-sdk-response" });
            controller.enqueue({ type: "text-start", id: "text" });
            controller.enqueue({ type: "text-delta", id: "text", delta: "mapped" });
            controller.enqueue({ type: "text-end", id: "text" });
            controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } } });
            controller.close();
          },
        }),
        warnings: [],
      };
    },
  };
}

await measure("ai-sdk-v4-stream-mapping", "fake-language-model", async () => {
  const events = await collect(aiSdk.createAiSdkProvider({ model: aiSdkModel(), redactor: core.createSecretRedactor([secret]) }), {
    model: { provider: "ai-sdk", model: "benchmark-model" },
    messages: [{ role: "user", content: [{ type: "text", text: secret }] }],
  });
  const json = JSON.stringify(events);
  return {
    queueEvents: events.length,
    eventBytes: Buffer.byteLength(json, "utf8"),
    limit: !events.some((event) => event.type === "message_start") || !events.some((event) => event.type === "usage") || !events.some((event) => event.type === "done") || json.includes(secret),
  };
});

await measure("provider-package-metadata", "zero-fetch-setup", async () => {
  let credentialResolutions = 0;
  const registered = { providers: 0, models: 0, auth: 0 };
  const api = {
    registerProvider() { registered.providers += 1; },
    registerModel() { registered.models += 1; },
    registerAuthMethod() { registered.auth += 1; },
  };
  const resolver = () => { credentialResolutions += 1; return secret; };
  const packages = [
    kimi.createKimiProviderPackage({ kimiApiKey: resolver }),
    zai.createZaiProviderPackage({ apiKey: resolver }),
    openrouter.createOpenRouterProviderPackage({ apiKey: resolver }),
    opencode.createOpenCodeGoProviderPackage({ apiKey: resolver }),
    alibaba.createAlibabaProviderPackage({ apiKey: resolver }),
    ollama.createOllamaProviderPackage({ apiKey: resolver }),
    neuralwatt.createNeuralWattProviderPackage({ apiKey: resolver }),
  ];
  for (const providerPackage of packages) providerPackage.setup(api);
  return {
    queueEvents: registered.providers + registered.models + registered.auth,
    eventBytes: Buffer.byteLength(JSON.stringify(registered), "utf8"),
    limit: credentialResolutions !== 0 || registered.providers !== 7 || registered.auth !== 7,
  };
});

const ragScope = { tenantId: "bench-tenant", resourceId: "bench-resource", corpusId: "bench-corpus" };
await measure("rag-parse-replace-rerank-retrieve", "memory-vector-store", async () => {
  const store = memory.createMemoryVectorStore();
  const statusStore = rag.createMemoryIngestionStatusStore();
  const embedder = memory.createHashEmbedder({ dimensions: 16 });
  await rag.replaceDocument({
    uri: "package://benchmark-policy",
    sourceId: "benchmark-policy",
    loader: { load: async (uri) => ({ uri, mediaType: "text/markdown", text: "# Policy\n\nApproval requires current authorization.\n\n# Escalation\n\nDocument every decision." }) },
    parser: rag.markdownParser,
    chunk: { size: 36, overlap: 0 },
    embedder,
    store,
    scope: ragScope,
    statusStore,
  });
  const context = await rag.retrieveContext("authorization decision", {
    embedder,
    store,
    scope: ragScope,
    topK: 2,
    reranker: { rerank: async ({ hits }) => [...hits].reverse() },
    redactor: core.createSecretRedactor([secret]),
  });
  const status = await rag.listIngestionStatus({ store: statusStore, scope: ragScope });
  const json = JSON.stringify({ context, status });
  return {
    queueEvents: context.hits.length + status.entries.length,
    eventBytes: Buffer.byteLength(json, "utf8"),
    limit: context.hits.length === 0 || status.entries[0]?.state !== "indexed" || !context.hits.every((hit) => hit.trust.inert && hit.provenance.sourceId === "benchmark-policy") || json.includes(secret),
  };
});

await measure("memory-retention-export-rebuild", "memory-vector-store", async () => {
  const semantic = memory.createMemory({
    tenantId: "bench-tenant",
    resourceId: "bench-resource",
    threadId: "bench-thread",
    embedder: memory.createHashEmbedder({ dimensions: 16 }),
    redactor: core.createSecretRedactor([secret]),
  });
  await semantic.remember({ entries: [
    { id: "one", text: `old ${secret}`, sequence: 1, consent: { visible: true } },
    { id: "two", text: "retained preference", sequence: 2, consent: { visible: true } },
    { id: "three", text: "current preference", sequence: 3, consent: { visible: true } },
  ] }, { wait: true });
  const retained = await semantic.applyRetention({ maxEntries: 2 });
  const exported = await semantic.exportMemory({ identity: { tenantId: "bench-tenant", resourceId: "bench-resource", threadId: "bench-thread" } });
  const rebuilt = await semantic.rebuildIndex({ batchSize: 2 });
  const json = JSON.stringify({ retained, exported, rebuilt });
  return {
    queueEvents: exported.entries.length + rebuilt.rebuilt,
    eventBytes: Buffer.byteLength(json, "utf8"),
    limit: retained.deleted !== 1 || exported.entries.length !== 2 || rebuilt.rebuilt !== 2 || json.includes(secret),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  release: "0.0.15",
  environment: { node: process.version, platform: process.platform, arch: process.arch, network: false, credentials: false },
  schema: { requiredResultFields: REQUIRED_RESULT_FIELDS },
  frozenBudgets: {
    openAIContinuationHops: "8",
    openAIRealtimeAudioEventsPerSecond: "64/256",
    openAIRealtimeBytesPerSecond: "1MiB/8MiB",
    ragDocumentBytes: "1/8MiB",
    ragRerankBytesMsConcurrency: "64/256KiB, 2/10s, 2/8",
    ragIngestionStatusPage: "50/200",
    memoryRetentionBatch: "500/5000",
    memoryExport: "100/200 entries, 4/32MiB, 10/60s",
    memoryRebuild: "32/128 entries, 10/60s",
    packageInstallDelta: "0 packages, 0 runtime dependencies (43 manifests unchanged)",
  },
  results,
};
for (const row of results) assertResultSchema(row);
console.log(JSON.stringify(report, null, 2));
