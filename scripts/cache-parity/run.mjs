#!/usr/bin/env bun
/**
 * Cache-parity runner (plan 215 Task 23). Runs one real coding task, three times per harness, through the
 * wire proxy, and compares Prism's prompt-cache hit rate with pi's on the same model.
 *
 *   bun scripts/cache-parity/run.mjs --provider commandcode --model claude-haiku-5-5 --runs 3
 *
 * See README.md for the budget and how to read the report. Every effect that costs money or touches the
 * machine (the proxy, the harness processes, the checksum of ~/.pi/agent) sits behind `deps`, so
 * `run.test.mjs` runs the whole thing offline against a fake upstream and scripted harnesses.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startWireProxy } from "../wire-proxy.mjs";
import { HARNESSES, PROVIDERS } from "./harnesses.mjs";
import { cellVerdict, compareUsage, parseUsageLog, piTurnUsages, prismTurnUsages, requestBudget, runMetrics } from "./metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
const FIXTURE = join(HERE, "fixture");
const TASK_FILE = join(HERE, "task.md");
const PER_RUN_REQUESTS = 20;
const RUN_TIMEOUT_MS = 10 * 60_000;
const HELP = `usage: bun scripts/cache-parity/run.mjs --provider <commandcode|ollama-cloud> --model <id> [--runs 3] [--harness prism,pi] [--route native|openai] [--thinking medium]
Requires PRISM_LIVE_PROVIDER_TESTS=1 and PRISM_LIVE_CACHE_PARITY=1 and the provider key (a private live.env is read). Budget: runs x harnesses x ${PER_RUN_REQUESTS} requests per cell (120 for 3 x 2); a cell that would exceed it stops with budget_exceeded.`;

export function parseArgs(argv) {
  const options = { runs: 3, harness: ["prism", "pi"], thinking: "medium" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help") return { help: true };
    const value = argv[i + 1];
    if (
      !["--provider", "--model", "--runs", "--harness", "--route", "--thinking"].includes(flag) ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error(`CacheParity: invalid argument ${flag}; use --help`);
    }
    i += 1;
    options[flag.slice(2)] = value;
  }
  if (!(options.provider in PROVIDERS)) throw new Error(`CacheParity: --provider must be one of ${Object.keys(PROVIDERS).join(", ")}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/~@-]{0,255}$/.test(options.model ?? "")) throw new Error("CacheParity: invalid --model");
  options.runs = Number(options.runs);
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 5) throw new Error("CacheParity: --runs must be 1..5");
  if (typeof options.harness === "string") options.harness = options.harness.split(",").map((name) => name.trim());
  if (options.harness.length === 0 || options.harness.some((name) => !(name in HARNESSES))) {
    throw new Error("CacheParity: --harness must be a list of prism, pi");
  }
  if (options.route !== undefined && (options.provider !== "ollama-cloud" || !["native", "openai"].includes(options.route))) {
    throw new Error("CacheParity: --route native|openai is Ollama Cloud only");
  }
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(options.thinking))
    throw new Error("CacheParity: invalid --thinking");
  return options;
}

/** Secret values a stored artifact must not contain: any credential-shaped variable of the environment. */
export function secretValues(env) {
  return Object.entries(env)
    .filter(([name, value]) => /(?:KEY|TOKEN|SECRET)$/.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value);
}

export function assertNoSecretLeak(value, secrets, label = "output") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (secrets.some((secret) => text.includes(secret)))
    throw new Error(`CacheParity: a secret value appears in ${label}; refusing to store it`);
}

/** A stat-based signature of `~/.pi/agent`: no file is read, so `auth.json` is never opened. */
export function piHomeSignature(piHome) {
  if (!existsSync(piHome)) return "absent";
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const rel = relative(piHome, path);
      if (rel === "sessions" || rel === "web-search-cache") continue;
      if (entry.isDirectory()) walk(path);
      else {
        const stat = statSync(path, { throwIfNoEntry: false });
        if (stat !== undefined) hash.update(`${rel}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}\n`);
      }
    }
  };
  walk(piHome);
  return hash.digest("hex");
}

function treeHash(dir) {
  const hash = createHash("sha256");
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(`${relative(dir, path)}\0`).update(readFileSync(path));
    }
  };
  if (existsSync(dir)) walk(dir);
  return hash.digest("hex");
}

/** Run a planned child process with a wall-clock timeout. stdout/stderr are returned for scanning, never stored. */
export function spawnChild({ command, args, cwd, env, timeoutMs }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => void (stdout += chunk));
    child.stderr.on("data", (chunk) => void (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr, timedOut });
    });
  });
}

/** The fixture's real test command, a fixed argv in the run's work directory. */
export function runFixtureTests(workdir, env) {
  const result = spawnSync("bun", ["test"], { cwd: workdir, env, encoding: "utf8", timeout: 60_000 });
  return result.status === 0;
}

function gitInit(workdir) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "parity",
    GIT_AUTHOR_EMAIL: "parity@example.invalid",
    GIT_COMMITTER_NAME: "parity",
    GIT_COMMITTER_EMAIL: "parity@example.invalid",
  };
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: workdir, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`CacheParity: git ${args[0]} failed in the fixture copy`);
  }
}

/** Execute the plan's preparation steps. Every path must be inside the run's scratch directory. */
export function prepareScratch(steps, scratch) {
  const inside = (path) => path === scratch || path.startsWith(`${scratch}${sep}`);
  for (const step of steps) {
    if (!inside(step.path)) throw new Error(`CacheParity: refusing to write outside the run scratch directory: ${step.path}`);
    mkdirSync(dirname(step.path), { recursive: true });
    if (step.op === "write") writeFileSync(step.path, step.content, { mode: 0o600 });
    else if (step.op === "copyFile") {
      if (!existsSync(step.from)) throw new Error(`CacheParity: ${step.from} is missing; start pi once so it exists`);
      cpSync(step.from, step.path);
    } else if (step.op === "symlink") symlinkSync(step.target, step.path);
    else if (step.op === "copyDir") {
      cpSync(step.from, step.path, { recursive: true, filter: (source) => !relative(step.from, source).split(sep).includes("node_modules") });
      if (step.replace !== undefined) {
        const file = join(step.path, step.replaceIn);
        let text = readFileSync(file, "utf8");
        for (const [from, to] of step.replace) {
          if (!text.includes(from)) throw new Error(`CacheParity: the pi extension changed; ${from} not found in ${step.replaceIn}`);
          text = text.replace(from, to);
        }
        writeFileSync(file, text);
      }
    } else throw new Error(`CacheParity: unknown preparation step ${step.op}`);
  }
}

function jsonLines(text) {
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return events;
}

/**
 * One run of one harness. Never throws for a harness failure: the failure is the run's `status`.
 * Statuses: `ok`, `usage_mismatch`, `model_mismatch`, `reference_config_mutated`, `harness_failed`, `timeout`.
 */
export async function executeRun(ctx, deps) {
  const scratch = mkdtempSync(join(deps.tmp, "parity-"));
  const workdir = join(scratch, "work");
  const usageLog = join(scratch, "usage.jsonl");
  const provider = PROVIDERS[ctx.provider];
  let proxy;
  try {
    cpSync(FIXTURE, workdir, { recursive: true });
    const testHash = treeHash(join(workdir, "test"));
    gitInit(workdir);
    proxy = await deps.startProxy({ upstream: provider.upstream, listen: "127.0.0.1:0", usageLog, maxRequests: ctx.maxRequests });
    const plan = HARNESSES[ctx.harness].plan({ ...ctx, scratch, workdir, proxyUrl: proxy.url, runId: ctx.runId, task: ctx.task });
    prepareScratch(plan.prepare, scratch);
    const before = deps.piSignature();
    const child = await deps.spawn({ command: plan.command, args: plan.args, cwd: plan.cwd, env: plan.env, timeoutMs: ctx.timeoutMs });
    await proxy.drain();
    const forwarded = proxy.forwarded();
    const after = deps.piSignature();
    for (const [label, text] of [
      ["harness stdout", child.stdout],
      ["harness stderr", child.stderr],
    ])
      assertNoSecretLeak(text, ctx.secrets, label);
    const entries = existsSync(usageLog) ? parseUsageLog(readFileSync(usageLog, "utf8")) : [];
    const solved = deps.runTests(workdir) && treeHash(join(workdir, "test")) === testHash;
    const metrics = runMetrics(entries, solved);
    const events = jsonLines(child.stdout);
    const result = {
      harness: ctx.harness,
      index: ctx.index,
      status: "ok",
      metrics,
      forwarded,
      ceiling: ctx.maxRequests > 0 && forwarded >= ctx.maxRequests,
      exitCode: child.code,
    };
    const models = [...new Set(entries.map((entry) => entry.model).filter(Boolean))];
    result.models = models;
    if (before !== after) return { ...result, status: "reference_config_mutated", detail: "~/.pi/agent changed during the run" };
    if (child.timedOut) return { ...result, status: "timeout", detail: `harness exceeded ${ctx.timeoutMs} ms` };
    if (models.some((model) => model !== ctx.model))
      return { ...result, status: "model_mismatch", detail: `proxy saw model ${models.join(", ")}` };
    if (ctx.harness === "prism") {
      const mismatch = compareUsage(prismTurnUsages(events), entries);
      if (mismatch !== null) return { ...result, status: "usage_mismatch", detail: mismatch };
    } else {
      const mismatch = compareUsage(piTurnUsages(events), entries);
      result.piCrossCheck = mismatch === null ? "match" : `mismatch: ${mismatch}`;
    }
    if (child.code !== 0 && entries.length === 0)
      return {
        ...result,
        status: "harness_failed",
        // stderr was scanned for credentials above; keep a short tail so a failure is diagnosable from the report.
        detail: `exit ${child.code} with no upstream request: ${child.stderr.trim().split("\n").slice(-3).join(" | ").slice(-400)}`,
      };
    return result;
  } finally {
    proxy?.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * One cell: `runs` runs of each harness, alternating which goes first. Stops with `budget_exceeded` when
 * the next run would start past the cell ceiling, and reports what ran.
 */
export async function runCell(options, deps) {
  const harnesses = options.harness;
  const budget = deps.budget ?? requestBudget({ runs: options.runs, harnesses: harnesses.length, perRun: PER_RUN_REQUESTS });
  const model = options.model;
  const modelRef = { provider: options.provider, model };
  const runs = { prism: [], pi: [] };
  let used = 0;
  let aborted;
  outer: for (let index = 0; index < options.runs; index++) {
    const order = index % 2 === 0 ? harnesses : [...harnesses].reverse();
    for (const harness of order) {
      const remaining = budget - used;
      if (remaining <= 0) {
        aborted = "budget_exceeded";
        break outer;
      }
      const run = await executeRun(
        {
          ...options,
          harness,
          index,
          modelRef,
          runId: deps.runId(),
          maxRequests: Math.min(PER_RUN_REQUESTS, remaining),
          timeoutMs: deps.timeoutMs ?? RUN_TIMEOUT_MS,
          task: deps.task,
          secrets: deps.secrets,
          env: deps.env,
          repoRoot: REPO_ROOT,
          piHome: deps.piHome,
          piBinary: deps.piBinary,
        },
        deps,
      );
      used += run.forwarded;
      runs[harness].push(run);
      if (run.status === "reference_config_mutated") {
        aborted = "reference_config_mutated";
        break outer;
      }
    }
  }
  const cell = cellVerdict(runs);
  return {
    cell:
      aborted === undefined
        ? cell
        : {
            ...cell,
            verdict: aborted,
            reason: aborted === "budget_exceeded" ? `cell ceiling ${budget} requests reached` : "~/.pi/agent changed",
          },
    runs,
    requests: { used, ceiling: budget, perRun: PER_RUN_REQUESTS },
  };
}

const pct = (value) => (value === null || value === undefined ? "n/a" : value.toFixed(3));
const range = (spreadValue) => (spreadValue === null ? "" : ` (${pct(spreadValue.min)}–${pct(spreadValue.max)})`);

export function renderMarkdown(report) {
  const rows = ["prism", "pi"]
    .filter((name) => report.cell[name]?.runs > 0)
    .map((name) => {
      const summary = report.cell[name];
      const label = name === "pi" ? `pi ${report.harnessVersions.pi}` : "prism";
      return `| ${label} | ${pct(summary.hitRate.median)}${range(summary.hitRate.spread)} | ${pct(summary.firstTurnExcludedHitRate.median)} | ${summary.requests.median ?? "n/a"} | ${summary.solved}/${summary.runs} |`;
    });
  const runRows = Object.values(report.runs)
    .flat()
    .map(
      (run) =>
        `| ${run.harness} | ${run.index + 1} | ${run.status} | ${run.metrics.requests} | ${run.metrics.promptTokens} | ${run.metrics.cacheRead} | ${run.metrics.cacheWrite} | ${pct(run.metrics.hitRate)} | ${run.metrics.taskSolved ? "yes" : "no"} |`,
    );
  return [
    `# Cache parity: ${report.provider} ${report.model}`,
    "",
    `Date ${report.date}. Prism commit \`${report.prismCommit}\`. pi ${report.harnessVersions.pi}. Route: ${report.route}. Thinking: ${report.thinking}.`,
    "",
    `**Verdict: ${report.cell.verdict}**${report.cell.reason ? ` (${report.cell.reason})` : ""}. Requests ${report.requests.used} of ${report.requests.ceiling} (ceiling ${report.requests.perRun} per run).`,
    "",
    "| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Runs",
    "",
    "| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...runRows,
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}

export function buildReport({ options, result, date, prismCommit, piVersion }) {
  const notes = [
    "Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.",
    "The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.",
  ];
  if (options.provider === "ollama-cloud") {
    notes.push(
      "pi-ollama-cloud ignores every base-URL override, so pi ran a run-scoped copy of the extension with its single base-URL constant changed to the proxy; models, compat and request building are the extension's own.",
    );
  }
  if (options.provider === "commandcode")
    notes.push("pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.");
  return {
    schema: "cache-parity/1",
    date,
    provider: options.provider,
    model: options.model,
    route: options.route ?? (options.provider === "ollama-cloud" ? "native (Prism) / chat completions (pi)" : "by model"),
    thinking: options.thinking,
    prismCommit,
    harnessVersions: { prism: prismCommit, pi: piVersion },
    ...result,
    notes,
  };
}

export function writeReport(report, { root = REPO_ROOT, secrets = [] } = {}) {
  const text = renderMarkdown(report);
  assertNoSecretLeak(report, secrets, "the report");
  assertNoSecretLeak(text, secrets, "the markdown report");
  const dir = join(root, "docs/_evidence/cache-parity");
  mkdirSync(dir, { recursive: true });
  const slug = `${report.provider}-${report.model}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  // The evidence keeps every run: a rerun or a second run on the same day never overwrites an earlier report.
  let base = join(dir, `${slug}-${report.date}`);
  for (let n = 2; existsSync(`${base}.json`); n++) base = join(dir, `${slug}-${report.date}-${n}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(`${base}.md`, text, { mode: 0o600 });
  return [`${base}.json`, `${base}.md`];
}

export function defaultDeps(env, piHome) {
  const piBinary = "pi";
  return {
    env,
    piHome,
    piBinary,
    tmp: tmpdir(),
    runId: () => randomUUID().slice(0, 8),
    task: readFileSync(TASK_FILE, "utf8").trim(),
    secrets: secretValues(env),
    spawn: spawnChild,
    startProxy: startWireProxy,
    piSignature: () => piHomeSignature(piHome),
    runTests: (workdir) => runFixtureTests(workdir, { PATH: env.PATH, HOME: env.HOME }),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const { loadEnv } = await import("./provider-probe.mjs");
  loadEnv();
  if (process.env.PRISM_LIVE_PROVIDER_TESTS !== "1" || process.env.PRISM_LIVE_CACHE_PARITY !== "1") {
    throw new Error("CacheParity: enable PRISM_LIVE_PROVIDER_TESTS=1 and PRISM_LIVE_CACHE_PARITY=1 after approving the request budget");
  }
  const keyName = PROVIDERS[options.provider].keyEnv;
  if (!process.env[keyName]) throw new Error(`CacheParity: ${keyName} is unavailable`);
  const piHome = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
  const deps = defaultDeps(process.env, piHome);
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  const piVersion = spawnSync("pi", ["--version"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  const result = await runCell(options, deps);
  const date = new Date().toISOString().slice(0, 10);
  const report = buildReport({ options, result, date, prismCommit: git.stdout?.trim() || "unknown", piVersion });
  const paths = writeReport(report, { secrets: deps.secrets });
  console.log(JSON.stringify({ verdict: report.cell.verdict, requests: report.requests, evidence: paths }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Child output and provider errors can echo credentials. Only our own messages are printed.
    console.error(
      error?.message?.startsWith("CacheParity:")
        ? error.message
        : "Cache parity run failed; nothing was recorded. Check flags, live.env, gates and credentials (--help).",
    );
    process.exitCode = 1;
  });
}
