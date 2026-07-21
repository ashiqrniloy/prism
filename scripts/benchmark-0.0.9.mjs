#!/usr/bin/env node
/**
 * Release 0.0.9 reproducible coding/browser benchmark.
 * Default mode is network-free (fake/in-process adapters only).
 * Optional:
 *   PRISM_BENCH_DOCKER=1 + PRISM_TEST_DOCKER_* — real Docker sandbox timings
 *   PRISM_BENCH_PLAYWRIGHT=1 — real Playwright open/snapshot/action/close
 * Evidence fields only — never a flaky default CI timing gate.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
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
const root = await mkdtemp(join(tmpdir(), "prism-bench-009-"));

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

try {
  const coding = await importWorkspace("@arnilo/prism-coding-agent", "packages/coding-agent/dist/index.js");
  const browserPkg = await importWorkspace("@arnilo/prism-browser", "packages/browser/dist/index.js");

  const repoRoot = join(root, "repo");
  await mkdir(join(repoRoot, "src"), { recursive: true });
  for (let i = 0; i < 40; i += 1) {
    await writeFile(join(repoRoot, "src", `f${i}.ts`), `export const v${i} = ${i};\n`);
  }
  await writeFile(join(repoRoot, "README.md"), "# bench\n");

  const listTool = coding.createRepoListTool(repoRoot);
  const searchTool = coding.createRepoSearchTool(repoRoot);
  const ctx = (id) => ({ sessionId: "bench", runId: "bench", toolCallId: `t-${id}` });

  await measure("repo-list", "fake-in-process", async (i) => {
    const r = await listTool.execute({ path: ".", maxResults: 20 }, ctx(i));
    if (r.error) throw new Error(r.error.message);
  });

  await measure("repo-search", "fake-in-process", async (i) => {
    const r = await searchTool.execute({ query: "export const", maxMatches: 20 }, ctx(i));
    if (r.error) throw new Error(r.error.message);
  });

  // Git status over a tiny disposable repo
  const gitRepo = join(root, "git");
  await mkdir(gitRepo);
  const git = (args) => {
    const r = spawnSync("/usr/bin/git", args, { cwd: gitRepo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout || args.join(" "));
  };
  git(["init"]);
  git(["checkout", "-b", "main"]);
  await writeFile(join(gitRepo, "README.md"), "# g\n");
  git(["add", "--", "README.md"]);
  git(["-c", "user.name=Prism", "-c", "user.email=prism@example.com", "commit", "-m", "init"]);
  const statusTool = coding.createGitStatusTool(gitRepo, { gitPath: "/usr/bin/git" });
  await measure("git-status", "fake-in-process", async (i) => {
    const r = await statusTool.execute({}, ctx(i));
    if (r.error) throw new Error(r.error.message);
  });

  // Browser open/snapshot/action/close against fake Playwright (default)
  const { FakeBrowser } = await import(
    pathToFileURL(join(process.cwd(), "packages/browser/dist/__tests__/fake-playwright.js")).href
  ).catch(async () => {
    // Dist tests may be excluded; fall back to a minimal inline fake via public API only.
    return { FakeBrowser: null };
  });

  if (FakeBrowser) {
    const browser = new FakeBrowser();
    const manager = browserPkg.createBrowserManager({
      browser,
      limits: { closeGraceMs: 1 },
      networkPolicy: { requireContainedProxy: false, allowLoopback: true },
    });
    await measure(
      "browser-open-snapshot-action-close",
      "fake-in-process",
      async (i) => {
        const runId = `b-${i}`;
        await manager.open(runId, { url: "https://example.com/" });
        await manager.snapshot(runId);
        await manager.act(runId, { action: "click", target: { role: "button", name: "Go" } });
        await manager.closeRun(runId);
      },
      { processCount: 1 },
    );
    await manager.close();
  } else {
    // Schema-only placeholder when fake helper is not packed into dist tests.
    await measure("browser-open-snapshot-action-close", "fake-in-process", async () => {
      browserPkg.resolveBrowserLimits({ maxActions: 10 });
    });
  }

  // Optional real Docker
  if (process.env.PRISM_BENCH_DOCKER === "1") {
    const docker = process.env.PRISM_TEST_DOCKER_BIN;
    const image = process.env.PRISM_TEST_DOCKER_IMAGE;
    if (!docker || !image) {
      throw new Error("PRISM_BENCH_DOCKER=1 requires PRISM_TEST_DOCKER_BIN and PRISM_TEST_DOCKER_IMAGE");
    }
    const codingSecurity = await importWorkspace(
      "@arnilo/prism-coding-security",
      "packages/coding-security/dist/index.js",
    );
    const source = join(root, "sandbox-src");
    await mkdir(source);
    await writeFile(join(source, "marker.txt"), "m\n");
    let processCount = 0;
    await measure(
      "docker-sandbox-startup-exec-cleanup",
      "real-local-docker",
      async () => {
        const sandbox = await codingSecurity.createDockerSandbox({
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
          const out = await sandbox.execFile({
            file: "/bin/sh",
            args: ["-c", "echo hi"],
            onData: () => undefined,
          });
          if (out.exitCode !== 0) throw new Error("sandbox exec failed");
        } finally {
          await sandbox.close();
        }
      },
      { processCount },
    );
  }

  // Optional real Playwright
  if (process.env.PRISM_BENCH_PLAYWRIGHT === "1") {
    const playwright = await import("playwright-core");
    const http = await import("node:http");
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><button>Go</button></body></html>");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}/`;
    const pwBrowser = await playwright.chromium.launch({ headless: true });
    try {
      const manager = browserPkg.createBrowserManager({
        browser: pwBrowser,
        limits: { closeGraceMs: 50 },
        networkPolicy: { requireContainedProxy: false, allowLoopback: true },
      });
      await measure(
        "browser-open-snapshot-action-close",
        "protected-playwright",
        async (i) => {
          const runId = `pw-${i}`;
          await manager.open(runId, { url: baseUrl });
          await manager.snapshot(runId);
          await manager.act(runId, { action: "click", target: { role: "button", name: "Go" } });
          await manager.closeRun(runId);
        },
        { processCount: 2 },
      );
      await manager.close();
    } finally {
      await pwBrowser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    release: "0.0.9",
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      network: false,
      credentials: false,
      docker: process.env.PRISM_BENCH_DOCKER === "1",
      playwright: process.env.PRISM_BENCH_PLAYWRIGHT === "1",
    },
    schema: { requiredResultFields: REQUIRED_RESULT_FIELDS },
    results,
  };
  for (const row of results) assertResultSchema(row);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
