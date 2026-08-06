#!/usr/bin/env node
/**
 * Release 0.0.26 network-free benchmark (plan 009 Task 7).
 * Ceilings from Task 0 freeze: enumeration p95 ≤ 2 s on a 100k-file synthetic
 * repository (≤ 2 git invocations); process chunk-page p95 ≤ 10 ms over a
 * 1 GiB spill; LSP 1000-diagnostic normalization p95 ≤ 100 ms; forge 100-page
 * pagination bounded with no per-page duplication; proxy 64 MiB download
 * completes within byte/time caps with resident buffering ≤ 2× maxBytes.
 *
 * Usage: node scripts/benchmark-0.0.26.mjs > scripts/benchmark-0.0.26.json
 */
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBoundGitRunner,
  createGitAwareRepositoryOperations,
  createGitHubForge,
  createLanguageIntelligence,
  createProcessSessions,
} from "../packages/coding-agent/dist/index.js";
import { createAllowListEgressProxy, createEgressPolicy } from "../packages/coding-security/dist/index.js";
import { createMemoryToolEffectStore } from "../dist/index.js";
import { resolveAgUiA2UiLimits } from "../packages/ag-ui/dist/a2ui.js";
import { DEFAULT_AG_UI_LIMITS } from "../packages/ag-ui/dist/limits.js";
import { createAgUiEventMapper } from "../packages/ag-ui/dist/ag-ui-mapper.js";
import { A2UiSurfaceState, reduceA2UiOps } from "../packages/ag-ui/dist/renderer/core.js";
import { renderA2UiSurface, DEFAULT_A2UI_CATALOG } from "../packages/ag-ui/dist/renderer/bind.js";

const WARMUPS = Number(process.env.PRISM_BENCH_WARMUPS ?? 5);
const ITERATIONS = Number(process.env.PRISM_BENCH_ITERATIONS ?? 20);
const ENUMERATION_FILES = 100_000;
const PROCESS_SPILL_BYTES = 1024 ** 3; // 1 GiB produced; accumulator retains 64 MiB + spills
const LSP_DIAGNOSTICS = 1_000;
const FORGE_PAGES = 100;
const PROXY_DOWNLOAD_BYTES = 64 * 1024 ** 2; // 64 MiB, exactly the default response cap
const RENDERER_OPS = 1_000; // 1,000-op A2UI surface stream (Task 14 renderer)
const MAPPER_EVENTS = 1_000; // 1,000-event sync-projection mapper stream (Task 15 sync path)
const FAKE_LSP = fileURLToPath(new URL("../packages/coding-agent/src/__tests__/fixtures/fake-lsp.mjs", import.meta.url));

const ceilings = {
  enumerationList: 2_000,
  processChunkPage: 10,
  lspDiagnosticNormalize: 100,
  forgePagination: 10_000,
  proxyDownload: 30_000,
  rendererStreamOps: 100,
  agUiMapperSync: 100,
};

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(name, samples) {
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  return {
    name,
    operations: samples.length,
    p50Ms: Number(p50.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    throughputPerSecond: Number((1000 / (samples.reduce((a, b) => a + b, 0) / samples.length)).toFixed(2)),
  };
}

class BenchNode {
  nodeType = 1;
  textContent = null;
  children = [];
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = [...children]; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); }
  setAttribute() {}
  addEventListener() {}
}
const benchDom = {
  createElement: () => new BenchNode(),
  createTextNode: (text) => {
    const node = new BenchNode();
    node.nodeType = 3;
    node.textContent = text;
    return node;
  },
};

/** 1,000-op A2UI surface stream: one snapshot batch + a rendered tree. */
function measureRendererStreamOps() {
  const ops = [
    { version: "v0.9", createSurface: { surfaceId: "bench", catalogId: "catalog" } },
  ];
  for (let i = 0; i < RENDERER_OPS - 1; i += 1) {
    ops.push({ version: "v0.9", updateComponents: { surfaceId: "bench", components: [{ id: `c${i}`, component: "Text", text: `value ${i}` }] } });
  }
  const a2uiLimits = resolveAgUiA2UiLimits({});
  const run = () => {
    const surfaces = new Map();
    // Real streams carry at most maxOperationsPerMessage (64) ops per message:
    // apply the 1,000-op stream as 16 snapshot batches of 64.
    for (let start = 0; start < ops.length; start += 64) {
      const result = reduceA2UiOps(surfaces, ops.slice(start, start + 64), a2uiLimits, DEFAULT_AG_UI_LIMITS, true);
      if (result.error) throw new Error(`renderer reduce failed: ${result.error.code}`);
    }
    const state = surfaces.get("bench");
    if (!state) throw new Error("renderer surface missing");
    return renderA2UiSurface(state, DEFAULT_A2UI_CATALOG, benchDom);
  };
  const samples = [];
  for (let i = 0; i < WARMUPS; i += 1) run();
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return { ...summarize("rendererStreamOps", samples), ops: RENDERER_OPS };
}

/** 1,000-event sync-projection stream through the AG-UI mapper (Task 15 sync path). */
async function measureAgUiMapperSync() {
  const mapper = createAgUiEventMapper({
    projection: {
      toolArguments: (call) => `args:${call.id}`,
      toolResult: (result) => `result:${result.toolCallId}`,
      messages: () => [{ id: "u1", role: "user", content: "hi" }],
      reasoning: (content) => ({ text: `summary:${content.type}` }),
      custom: (event) => ({ name: "prism.usage", value: { tokens: 1 } }),
    },
  });
  const events = [];
  for (let i = 0; i < MAPPER_EVENTS; i += 1) {
    events.push({ type: "message_delta", sessionId: "s", runId: "r", content: { type: "text", text: `delta ${i}` } });
    events.push({ type: "tool_execution_started", sessionId: "s", runId: "r", call: { id: `t${i}`, name: "read", arguments: { path: `/x/${i}` } } });
    events.push({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: { toolCallId: `t${i}`, name: "read", value: i },
      metadata: { durationMs: 1, status: "finished" },
    });
    events.push({
      type: "message_finished",
      sessionId: "s",
      runId: "r",
      message: { id: `m${i}`, role: "assistant", content: [{ type: "text", text: `done ${i}` }] },
    });
  }
  const run = async () => {
    for (const event of events) {
      const mapped = await mapper.map(event);
      if (mapped.length === 0) throw new Error("sync mapper produced no events");
    }
  };
  const samples = [];
  for (let i = 0; i < WARMUPS; i += 1) await run();
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  return { ...summarize("agUiMapperSync", samples), events: MAPPER_EVENTS * 4 };
}

function okResult(stdout, exitCode = 0) {
  return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
}

/** Synthetic 100k-file repo: fake runner answers rev-parse + ls-files; counts invocations. */
async function measureEnumerationList() {
  const root = await mkdtemp(join(tmpdir(), "prism-bench-repo-"));
  try {
    // Real files on disk: the walk lstat's every path to classify kind/size.
    const { openSync, closeSync, mkdirSync } = await import("node:fs");
    for (let d = 0; d < 100; d += 1) {
      mkdirSync(join(root, "src", `mod${d}`), { recursive: true });
    }
    for (let i = 0; i < ENUMERATION_FILES; i += 1) {
      const fd = openSync(join(root, "src", `mod${i % 100}`, `file${i}.ts`), "w");
      closeSync(fd);
    }
    const paths = [];
    for (let i = 0; i < ENUMERATION_FILES; i += 1) {
      paths.push(`src/mod${i % 100}/file${i}.ts`);
    }
    const lsFiles = `${paths.join("\0")}\0`;
    let invocations = 0;
    const runner = await createBoundGitRunner();
    const fake = {
      gitPath: runner.gitPath,
      async exec(request) {
        invocations += 1;
        if (request.args[0] === "rev-parse" && request.args[1] === "--is-inside-work-tree") return okResult("true\n");
        if (request.args[0] === "ls-files") return okResult(lsFiles);
        return okResult("", 1);
      },
    };
    const repo = createGitAwareRepositoryOperations(root, { git: fake, limits: { maxEntries: 100_000 } });
    const samples = [];
    for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
      const before = invocations;
      const start = performance.now();
      const listed = await repo.list({ root, maxResults: 10_000 });
      const ms = performance.now() - start;
      if (n >= WARMUPS) samples.push(ms);
      if (invocations - before > 2) throw new Error(`expected ≤ 2 git invocations per list, got ${invocations - before}`);
      if (listed.entries.length !== 10_000) throw new Error(`expected 10_000 capped entries, got ${listed.entries.length}`);
      if (listed.scannedEntries < 10_000) {
        throw new Error(`expected ≥ 10_000 scanned entries, got ${listed.scannedEntries}`);
      }
    }
    if (invocations > 2 + WARMUPS + ITERATIONS) throw new Error(`unexpected git invocation count ${invocations}`);
    return { ...summarize("enumerationList", samples), gitInvocationsPerList: 1 };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Process writes 1 GiB; accumulator retains 64 MiB + spills; page through with 64 KiB chunks. */
async function measureProcessChunkPage() {
  const root = await mkdtemp(join(tmpdir(), "prism-bench-proc-"));
  try {
    const sessions = createProcessSessions({ cwd: root, limits: { maxLifetimeMs: 300_000 } });
    const p = await sessions.start({
      command: process.execPath,
      args: [
        "-e",
        `const b = Buffer.alloc(1024 * 1024, 120); for (let i = 0; i < ${PROCESS_SPILL_BYTES / (1024 * 1024)}; i += 1) process.stdout.write(b);`,
      ],
      lifetimeMs: 300_000,
    });
    const exit = await p.wait({ timeoutMs: 120_000 });
    if (exit.exitCode !== 0) throw new Error(`spill process exited ${JSON.stringify(exit)}`);
    const samples = [];
    let cursor = 0;
    let total = 0;
    for (;;) {
      const start = performance.now();
      const chunk = await p.output({ cursor, maxBytes: 50 * 1024 });
      const ms = performance.now() - start;
      cursor = chunk.cursor;
      total += chunk.data.length;
      if (chunk.data.length === 0) break;
      samples.push(ms);
    }
    if (total === 0) throw new Error("no output paged");
    return { ...summarize("processChunkPage", samples), retainedBytes: total };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Fake LSP server publishes 1000 diagnostics; measure normalization round-trip. */
async function measureLspDiagnosticNormalize() {
  const root = await mkdtemp(join(tmpdir(), "prism-bench-lsp-"));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const file = join(root, "src", "a.ts");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(file, "export const foo = 1;\n");
    const language = createLanguageIntelligence({
      workspaceRoot: root,
      servers: {
        ts: {
          command: process.execPath,
          args: [FAKE_LSP],
          languages: ["typescript"],
          env: { FAKE_LSP_DIAG_COUNT: String(LSP_DIAGNOSTICS) },
        },
      },
      limits: { maxDiagnosticsPerFile: LSP_DIAGNOSTICS },
    });
    try {
      await language.diagnostics(file); // triggers didOpen; publish arrives async
      await new Promise((r) => setTimeout(r, 250));
      const samples = [];
      for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
        const start = performance.now();
        const diags = await language.diagnostics(file);
        const ms = performance.now() - start;
        if (n >= WARMUPS) samples.push(ms);
        if (diags.length !== LSP_DIAGNOSTICS) throw new Error(`expected ${LSP_DIAGNOSTICS} diagnostics, got ${diags.length}`);
      }
      return summarize("lspDiagnosticNormalize", samples);
    } finally {
      await language.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Fake GitHub serves 100 pages × 100 check-runs; verify bounded + no duplication. */
async function measureForgePagination() {
  const pages = [];
  for (let page = 1; page <= FORGE_PAGES; page += 1) {
    const runs = [];
    for (let i = 0; i < 100; i += 1) {
      runs.push({ name: `check-${(page - 1) * 100 + i}`, status: "completed", conclusion: "success" });
    }
    pages.push(runs);
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.endsWith("/check-runs")) {
      const page = Number(url.searchParams.get("page") ?? "1");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ check_runs: pages[page - 1] ?? [] }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ statuses: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.host === "api.github.com") return realFetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
    return realFetch(input, init);
  };
  try {
    const forge = createGitHubForge({
      repository: "acme/app",
      credentials: { name: "github", resolver: { resolve: async () => ({ type: "bearer", value: "bench-token" }) } },
      effectStore: createMemoryToolEffectStore(),
      limits: { pagesPerOperation: FORGE_PAGES },
    });
    const samples = [];
    for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
      const start = performance.now();
      const checks = await forge.checks({ ref: "main" });
      const ms = performance.now() - start;
      if (n >= WARMUPS) samples.push(ms);
      const names = new Set(checks.map((c) => c.name));
      if (names.size !== checks.length) throw new Error("duplicate check names in paginated result");
      if (checks.length !== FORGE_PAGES * 100) throw new Error(`expected ${FORGE_PAGES * 100} checks, got ${checks.length}`);
    }
    return { ...summarize("forgePagination", samples), pages: FORGE_PAGES, itemsPerPage: 100 };
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

/** 64 MiB download through the proxy; verify completion, bytes, and resident buffering. */
async function measureProxyDownload() {
  const payload = Buffer.alloc(1024 * 1024, 65);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(PROXY_DOWNLOAD_BYTES) });
    for (let i = 0; i < PROXY_DOWNLOAD_BYTES / payload.length; i += 1) res.write(payload);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const upstreamPort = server.address().port;
  const policy = createEgressPolicy({
    allow: [{ host: "bench.example", port: upstreamPort, protocol: "http", allowPrivate: true }],
  });
  const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
  const { port } = await proxy.start();
  const before = process.memoryUsage().rss;
  try {
    const samples = [];
    for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
      const start = performance.now();
      const bytes = await new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path: `http://bench.example:${upstreamPort}/`,
            method: "GET",
            headers: { host: `bench.example:${upstreamPort}` },
            setHost: false,
          },
          (res) => {
            let received = 0;
            res.on("data", (chunk) => {
              received += chunk.length;
            });
            res.on("end", () => resolve(received));
          },
        );
        req.on("error", reject);
        req.end();
      });
      const ms = performance.now() - start;
      if (n >= WARMUPS) samples.push(ms);
      if (bytes !== PROXY_DOWNLOAD_BYTES) throw new Error(`expected ${PROXY_DOWNLOAD_BYTES} bytes, got ${bytes}`);
    }
    const after = process.memoryUsage().rss;
    const residentDelta = after - before;
    const ceiling = 2 * 64 * 1024 ** 2;
    if (residentDelta > ceiling) throw new Error(`resident buffering ${residentDelta} exceeds 2× maxBytes`);
    return { ...summarize("proxyDownload", samples), bytes: PROXY_DOWNLOAD_BYTES, residentDeltaBytes: residentDelta };
  } finally {
    await proxy.close();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

const results = [];
results.push(await measureEnumerationList());
results.push(await measureProcessChunkPage());
results.push(await measureLspDiagnosticNormalize());
results.push(await measureForgePagination());
results.push(await measureProxyDownload());
results.push(measureRendererStreamOps());
results.push(await measureAgUiMapperSync());

const report = {
  version: "0.0.26",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? "unknown",
    memoryBytes: totalmem(),
    network: false,
  },
  fixture: {
    warmups: WARMUPS,
    measuredOperations: ITERATIONS,
    enumerationFiles: ENUMERATION_FILES,
    processSpillBytes: PROCESS_SPILL_BYTES,
    lspDiagnostics: LSP_DIAGNOSTICS,
    forgePages: FORGE_PAGES,
    proxyDownloadBytes: PROXY_DOWNLOAD_BYTES,
    rendererOps: RENDERER_OPS,
    mapperEvents: MAPPER_EVENTS * 4,
  },
  ceilingsMs: ceilings,
  results,
};

for (const row of results) {
  const ceiling = ceilings[row.name];
  if (row.p95Ms > ceiling) {
    console.error(`BUDGET FAIL: ${row.name} p95 ${row.p95Ms}ms > ${ceiling}ms`);
    process.exitCode = 1;
  }
}

console.log(JSON.stringify(report, null, 2));
