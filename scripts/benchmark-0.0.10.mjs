#!/usr/bin/env node
/**
 * Release 0.0.10 reproducible workspace-mode benchmark.
 * Default mode is network-free (host temp dir + in-memory DisposableSandbox).
 * Optional:
 *   PRISM_BENCH_DOCKER=1 + PRISM_TEST_DOCKER_* — real Docker sandbox timings
 * Evidence fields only — never a flaky default CI timing gate.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
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
  "diskBytes",
  "processCount",
  "estimatedCostUsd",
  "backpressureSignals",
  "resourceLimitSignals",
]);

const percentile = (values, ratio) =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)];

const results = [];
const root = await mkdtemp(join(tmpdir(), "prism-bench-010-"));

function assertResultSchema(row) {
  for (const field of REQUIRED_RESULT_FIELDS) {
    if (!(field in row)) throw new Error(`benchmark result missing field: ${field}`);
  }
  if (!Number.isFinite(row.throughputPerSecond) || row.throughputPerSecond < 0) {
    throw new Error(`invalid throughput for ${row.scenario}`);
  }
  if (!Number.isFinite(row.p50Ms) || !Number.isFinite(row.p95Ms)) {
    throw new Error(`invalid latency for ${row.scenario}`);
  }
}

async function measure(scenario, mode, operation, details = {}) {
  const latencies = [];
  const started = performance.now();
  let resourceLimitSignals = details.resourceLimitSignals ?? 0;
  for (let index = 0; index < iterations; index += 1) {
    const before = performance.now();
    const signal = await operation(index);
    if (signal === "limit") resourceLimitSignals += 1;
    latencies.push(performance.now() - before);
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
    diskBytes: details.diskBytes ?? 0,
    processCount: details.processCount ?? 1,
    estimatedCostUsd: 0,
    backpressureSignals: details.backpressureSignals ?? 0,
    resourceLimitSignals,
  };
  assertResultSchema(row);
  results.push(row);
}

async function importWorkspace(specifier, relativeFromRoot) {
  try {
    return await import(specifier);
  } catch {
    return import(pathToFileURL(join(process.cwd(), relativeFromRoot)).href);
  }
}

/** Minimal memory DisposableSandbox for sandbox-mode composition benches. */
function createMemorySandbox(scripts, workspaceRoot = "/workspace") {
  const files = new Map();
  return {
    id: "bench-mem",
    files,
    async exec(request) {
      const cat = /^cat(?:\s+)(.+)$/.exec(request.command.trim());
      if (cat) {
        let path = cat[1].trim().replace(/^['"]|['"]$/g, "");
        if (!path.startsWith("/")) path = posix.join(request.cwd, path);
        const buf = files.get(path);
        if (!buf) return { exitCode: 1 };
        request.onData?.(buf);
        return { exitCode: 0 };
      }
      return { exitCode: 0 };
    },
    async execFile(request) {
      if (request.file !== "/bin/sh" || request.args[0] !== "-c") {
        return { exitCode: 1 };
      }
      const script = request.args[1];
      const positional = request.args.slice(3);
      const emit = (data) => request.onData?.(data);
      if (script === scripts.access) return { exitCode: files.has(positional[0]) ? 0 : 1 };
      if (script === scripts.stat) {
        const buf = files.get(positional[0]);
        if (!buf) return { exitCode: 1 };
        emit(Buffer.from(String(buf.byteLength)));
        return { exitCode: 0 };
      }
      if (script === scripts.read) {
        const buf = files.get(positional[0]);
        if (!buf) return { exitCode: 1 };
        emit(buf.subarray(0, Number(positional[1])));
        return { exitCode: 0 };
      }
      if (script === scripts.truncate) {
        files.set(positional[0], Buffer.alloc(0));
        return { exitCode: 0 };
      }
      if (script === scripts.mkdir) return { exitCode: 0 };
      if (script === scripts.write || script === scripts.append) {
        const chunk = Buffer.from(positional[0], "base64");
        const path = positional[1];
        if (script === scripts.write) files.set(path, chunk);
        else files.set(path, Buffer.concat([files.get(path) ?? Buffer.alloc(0), chunk]));
        return { exitCode: 0 };
      }
      if (script === scripts.find) {
        const start = positional[0];
        const prefix = start.endsWith("/") ? start : `${start}/`;
        const maxDepth = Number(positional[1]);
        const lines = [];
        for (const key of files.keys()) {
          if (!key.startsWith(prefix)) continue;
          const rel = key.slice(prefix.length);
          const depth = rel.split("/").filter(Boolean).length;
          if (depth >= 1 && depth <= maxDepth) lines.push(key);
        }
        if (lines.length) emit(Buffer.from(`${lines.sort().join("\n")}\n`));
        return { exitCode: 0 };
      }
      return { exitCode: 1 };
    },
    async status() {
      return {
        id: "bench-mem",
        state: "running",
        image: "memory",
        startedAt: 0,
        lastActivityAt: 0,
        commandCount: 0,
      };
    },
    async stop() {},
    async kill() {},
    async close() {},
  };
}

try {
  const codingSecurity = await importWorkspace(
    "@arnilo/prism-coding-security",
    "packages/coding-security/dist/index.js",
  );
  const ctx = (id) => ({ sessionId: "bench", runId: "bench", toolCallId: `t-${id}` });

  const hostRoot = join(root, "host");
  await mkdir(hostRoot);
  await writeFile(join(hostRoot, "seed.txt"), "seed\n");
  const host = codingSecurity.createSandboxCodingComposition(hostRoot, {
    workspaceMode: "host",
  });
  if (host.composition.containmentClaim !== false) {
    throw new Error("host mode must not claim containment");
  }
  const hostWrite = host.tools.find((t) => t.name === "write");
  const hostRead = host.tools.find((t) => t.name === "read");
  const hostList = host.tools.find((t) => t.name === "repo_list");

  await measure("host-composition-write-read", "host", async (i) => {
    const path = `h-${i}.txt`;
    const w = await hostWrite.execute({ path, content: `v${i}\n` }, ctx(i));
    if (w.error) throw new Error(w.error.message);
    const r = await hostRead.execute({ path }, ctx(i));
    if (r.error) throw new Error(r.error.message);
  });

  await measure("host-composition-list", "host", async (i) => {
    const r = await hostList.execute({ maxResults: 20 }, ctx(i));
    if (r.error) throw new Error(r.error.message);
  });

  const sandbox = createMemorySandbox(codingSecurity.SANDBOX_FS_SCRIPTS);
  sandbox.files.set("/workspace/seed.txt", Buffer.from("seed\n"));
  const sand = codingSecurity.createSandboxCodingComposition(hostRoot, {
    workspaceMode: "sandbox",
    sandbox,
    workspaceRoot: "/workspace",
  });
  if (sand.composition.containmentClaim !== true) {
    throw new Error("sandbox mode must claim containment when backends bound");
  }
  const sandWrite = sand.tools.find((t) => t.name === "write");
  const sandRead = sand.tools.find((t) => t.name === "read");
  const sandList = sand.tools.find((t) => t.name === "repo_list");
  const sandSearch = sand.tools.find((t) => t.name === "repo_search");

  await measure("sandbox-composition-write-read", "sandbox-fake", async (i) => {
    const path = `s-${i}.txt`;
    const w = await sandWrite.execute({ path, content: `v${i}\n` }, ctx(i));
    if (w.error) throw new Error(w.error.message);
    const r = await sandRead.execute({ path }, ctx(i));
    if (r.error) throw new Error(r.error.message);
  });

  await measure("sandbox-composition-list-search", "sandbox-fake", async (i) => {
    const listed = await sandList.execute({ maxResults: 20 }, ctx(i));
    if (listed.error) throw new Error(listed.error.message);
    const found = await sandSearch.execute({ query: "seed", maxMatches: 5 }, ctx(i));
    if (found.error) throw new Error(found.error.message);
  });

  if (process.env.PRISM_BENCH_DOCKER === "1") {
    const docker = process.env.PRISM_TEST_DOCKER_BIN;
    const image = process.env.PRISM_TEST_DOCKER_IMAGE;
    if (!docker || !image) {
      throw new Error("PRISM_BENCH_DOCKER=1 requires PRISM_TEST_DOCKER_BIN and PRISM_TEST_DOCKER_IMAGE");
    }
    const source = join(root, "sandbox-src");
    await mkdir(source);
    await writeFile(join(source, "marker.txt"), "m\n");
    let processCount = 0;
    await measure(
      "docker-sandbox-composition-write-read",
      "real-local-docker",
      async (i) => {
        const live = await codingSecurity.createDockerSandbox({
          docker,
          image,
          sourceRoot: source,
          user: process.env.PRISM_TEST_DOCKER_USER ?? "10001:10001",
          network: { mode: "none" },
          limits: {
            cpus: 1,
            memoryBytes: 256 * 1024 * 1024,
            maxPids: 64,
            workspaceBytes: 64 * 1024 * 1024,
            tmpBytes: 16 * 1024 * 1024,
            downloadBytes: 8 * 1024 * 1024,
            wallTimeMs: 120_000,
            idleTimeoutMs: 60_000,
            startupTimeoutMs: 60_000,
          },
        });
        processCount += 1;
        try {
          const { tools } = codingSecurity.createSandboxCodingComposition(source, {
            workspaceMode: "sandbox",
            sandbox: live,
            workspaceRoot: "/workspace",
          });
          const write = tools.find((t) => t.name === "write");
          const read = tools.find((t) => t.name === "read");
          const path = `live-${i}.txt`;
          const w = await write.execute({ path, content: "live\n" }, ctx(i));
          if (w.error) throw new Error(w.error.message);
          const r = await read.execute({ path }, ctx(i));
          if (r.error) throw new Error(r.error.message);
        } finally {
          await live.close();
        }
      },
      { processCount },
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    release: "0.0.10",
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      network: false,
      credentials: false,
      docker: process.env.PRISM_BENCH_DOCKER === "1",
    },
    schema: { requiredResultFields: REQUIRED_RESULT_FIELDS },
    results,
  };
  for (const row of results) assertResultSchema(row);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
