import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWireProxy } from "../wire-proxy.mjs";
import { HARNESSES } from "./harnesses.mjs";
import { cellVerdict, compareUsage, median, piTurnUsages, prismTurnUsages, runMetrics } from "./metrics.mjs";
import {
  assertNoSecretLeak,
  buildReport,
  executeRun,
  parseArgs,
  prepareScratch,
  REPO_ROOT,
  renderMarkdown,
  runCell,
  runFixtureTests,
  writeReport,
} from "./run.mjs";

const KEY = "parity-test-key-0123456789";
const MODEL = "claude-haiku-5-5";

/** A fake upstream that answers every chat completion with scripted usage (cached tokens grow each turn). */
function fakeUpstream() {
  let served = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = JSON.parse(await req.text());
      served += 1;
      const cached = body.turn === 0 ? 0 : 800;
      return Response.json({
        id: `gen-${served}`,
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: cached } },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, served: () => served, stop: () => server.stop(true) };
}

/** Scripted harness: sends `turns` requests to the proxy, optionally fixes the bug, prints events. */
function scripted({ turns = 3, fix = true, leak = false, skewPrism = false, mutate } = {}) {
  const calls = [];
  const spawn = async (plan) => {
    calls.push(plan);
    const base = plan.env.PRISM_PARITY_BASE_URL ?? plan.env.COMMANDCODE_API_BASE;
    const events = [];
    for (let i = 0; i < turns; i++) {
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: MODEL, messages: [], turn: i }),
      });
      if (response.status === 429) break;
      const body = await response.json();
      const cached = body.usage.prompt_tokens_details.cached_tokens;
      events.push(
        plan.env.PRISM_PARITY_BASE_URL
          ? { type: "turn.completed", usage: { inputTokens: 1000 + (skewPrism && i === 1 ? 5 : 0), cacheReadTokens: cached } }
          : { type: "message_end", message: { role: "assistant", usage: { input: 1000 - cached, cacheRead: cached, cacheWrite: 0 } } },
      );
    }
    if (fix) {
      const file = join(plan.cwd, "src/pricing.js");
      writeFileSync(file, readFileSync(file, "utf8").replace("taxCents(subtotal,", "taxCents(discounted,"));
    }
    mutate?.();
    return {
      code: 0,
      stdout: events.map((event) => JSON.stringify(event)).join("\n") + (leak ? `\n${KEY}` : ""),
      stderr: "",
      timedOut: false,
    };
  };
  return { spawn, calls };
}

let upstream;
let tmp;
beforeEach(() => {
  upstream = fakeUpstream();
  tmp = mkdtempSync(join(tmpdir(), "parity-test-"));
  mkdirSync(join(tmp, "pi-home"));
  writeFileSync(join(tmp, "pi-home/commandcode-models.json"), "{}");
});
afterEach(() => {
  upstream.stop();
  rmSync(tmp, { recursive: true, force: true });
});

function deps(overrides = {}) {
  let id = 0;
  return {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, COMMAND_CODE_API_KEY: KEY },
    piHome: join(tmp, "pi-home"),
    piBinary: "pi",
    tmp,
    runId: () => `run${++id}`,
    task: "fix the failing test",
    secrets: [KEY],
    startProxy: (options) => startWireProxy({ ...options, upstream: upstream.url }),
    piSignature: () => "same",
    runTests: (workdir) => runFixtureTests(workdir, { PATH: process.env.PATH, HOME: process.env.HOME }),
    ...overrides,
  };
}
const options = { provider: "commandcode", model: MODEL, runs: 3, harness: ["prism", "pi"], thinking: "medium" };

describe("metrics", () => {
  test("metrics_compute_inclusive_hit_rate", () => {
    const entries = [
      { exchange: 1, status: 200, inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 1000 },
      { exchange: 2, status: 200, inputTokens: 1200, cacheReadTokens: 900, cacheWriteTokens: 0 },
      { exchange: 3, status: 429, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ];
    const metrics = runMetrics(entries, true);
    expect(metrics.requests).toBe(2);
    expect(metrics.failedRequests).toBe(1);
    expect(metrics.promptTokens).toBe(2200);
    expect(metrics.hitRate).toBeCloseTo(900 / 2200, 6);
    expect(metrics.firstTurnExcludedHitRate).toBeCloseTo(900 / 1200, 6);
    expect(median([0.5, 0.9, 0.7])).toBe(0.7);
    expect(median([])).toBeNull();
  });

  const run = (rate, solved, status = "ok") => ({
    status,
    metrics: { hitRate: rate, firstTurnExcludedHitRate: rate, requests: 5, taskSolved: solved },
  });

  test("metrics_exclude_unsolved_runs_only_when_both_solved", () => {
    // Both harnesses solved 2 of 3: the unsolved run is dropped from the comparison.
    const verdict = cellVerdict({
      prism: [run(0.9, true), run(0.9, true), run(0.1, false)],
      pi: [run(0.8, true), run(0.8, true), run(0.95, false)],
    });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.prism.hitRate.median).toBe(0.9);
    expect(verdict.pi.comparedRuns).toBe(2);
    // Prism behind pi on solved runs.
    expect(
      cellVerdict({ prism: [run(0.5, true), run(0.5, true), run(0.5, true)], pi: [run(0.8, true), run(0.8, true), run(0.8, true)] })
        .verdict,
    ).toBe("behind");
  });

  test("runner_marks_inconclusive_cell", () => {
    const verdict = cellVerdict({
      prism: [run(0.9, true), run(0.9, false), run(0.9, false)],
      pi: [run(0.8, true), run(0.8, true), run(0.8, true)],
    });
    expect(verdict.verdict).toBe("inconclusive");
  });

  test("usage_mismatch_beats_a_good_hit_rate", () => {
    const verdict = cellVerdict({
      prism: [run(0.99, true), { ...run(0.99, true), status: "usage_mismatch", detail: "x" }],
      pi: [run(0.5, true), run(0.5, true)],
    });
    expect(verdict.verdict).toBe("usage_mismatch");
  });

  test("compareUsage_reports_first_difference", () => {
    const entries = [{ exchange: 1, status: 200, inputTokens: 10, cacheReadTokens: 4, cacheWriteTokens: 0 }];
    expect(compareUsage([{ inputTokens: 10, cacheReadTokens: 4 }], entries)).toBeNull();
    expect(compareUsage([{ inputTokens: 10, cacheReadTokens: 5 }], entries)).toContain("cacheReadTokens");
    expect(compareUsage([], entries)).toContain("request count");
  });

  test("usage_readers_use_inclusive_totals", () => {
    expect(
      prismTurnUsages([
        { type: "turn.completed", usage: { inputTokens: 9, cacheReadTokens: 4 } },
        { type: "turn.completed", error: {}, usage: { inputTokens: 1 } },
      ]),
    ).toEqual([{ inputTokens: 9, cacheReadTokens: 4, cacheWriteTokens: 0 }]);
    expect(
      piTurnUsages([{ type: "message_end", message: { role: "assistant", usage: { input: 3, cacheRead: 1050, cacheWrite: 53 } } }]),
    ).toEqual([{ inputTokens: 1106, cacheReadTokens: 1050, cacheWriteTokens: 53 }]);
  });
});

describe("runner", () => {
  test("parseArgs_rejects_unknown_and_secret_flags", () => {
    expect(() => parseArgs(["--provider", "commandcode", "--model", MODEL, "--api-key", "x"])).toThrow();
    expect(() => parseArgs(["--provider", "hyper", "--model", MODEL])).toThrow();
    expect(parseArgs(["--provider", "commandcode", "--model", MODEL, "--harness", "pi"]).harness).toEqual(["pi"]);
  });

  test("runner_runs_a_cell_and_reports_medians", async () => {
    const { spawn } = scripted();
    const result = await runCell(options, deps({ spawn }));
    expect(result.cell.verdict).toBe("pass");
    expect(result.runs.prism).toHaveLength(3);
    expect(result.runs.pi).toHaveLength(3);
    expect(result.runs.prism.every((run) => run.status === "ok" && run.metrics.taskSolved)).toBe(true);
    expect(result.requests.used).toBe(18);
    expect(result.requests.ceiling).toBe(120);
    expect(result.runs.pi[0].piCrossCheck).toBe("match");
    expect(result.cell.prism.hitRate.median).toBeCloseTo(1600 / 3000, 6);
  });

  test("runner_aborts_on_budget", async () => {
    const { spawn } = scripted({ turns: 25 });
    // One run per harness; the per-run ceiling (20) is the only limit, so a cell of 2 runs x 2 harnesses stays inside 80.
    const small = await runCell({ ...options, runs: 1 }, deps({ spawn }));
    expect(small.runs.prism[0].forwarded).toBe(20);
    expect(small.runs.prism[0].ceiling).toBe(true);
    expect(small.requests.used).toBe(40);
    // A 50-request cell budget: 20 + 20 + the last 10, then the next run is refused.
    const { spawn: spawn2 } = scripted({ turns: 25 });
    const big = await runCell({ ...options, runs: 3 }, deps({ spawn: spawn2, budget: 50 }));
    expect(big.cell.verdict).toBe("budget_exceeded");
    expect(big.requests.used).toBe(50);
    expect(big.runs.prism.length + big.runs.pi.length).toBe(3);
  });

  test("runner_flags_usage_mismatch", async () => {
    const { spawn } = scripted({ skewPrism: true });
    const result = await runCell({ ...options, runs: 1 }, deps({ spawn }));
    expect(result.runs.prism[0].status).toBe("usage_mismatch");
    expect(result.runs.prism[0].detail).toContain("inputTokens");
    expect(result.cell.verdict).toBe("usage_mismatch");
  });

  test("runner_scans_outputs_for_keys", async () => {
    const { spawn } = scripted({ leak: true });
    await expect(
      executeRun(
        {
          ...options,
          harness: "prism",
          index: 0,
          modelRef: { provider: "commandcode", model: MODEL },
          runId: "r",
          maxRequests: 20,
          timeoutMs: 1000,
          task: "t",
          secrets: [KEY],
          env: deps().env,
          repoRoot: REPO_ROOT,
          piHome: join(tmp, "pi-home"),
        },
        deps({ spawn }),
      ),
    ).rejects.toThrow("secret value");
    expect(() => assertNoSecretLeak({ a: `x${KEY}` }, [KEY])).toThrow();
    expect(() =>
      writeReport(
        buildReport({
          options,
          result: {
            cell: { verdict: "pass", prism: { runs: 0 }, pi: { runs: 0 } },
            runs: {},
            requests: { used: 0, ceiling: 120, perRun: 20 },
          },
          date: KEY,
          prismCommit: "x",
          piVersion: "1",
        }),
        { root: tmp, secrets: [KEY] },
      ),
    ).toThrow();
  });

  test("runner_writes_reference_config_outside_repo", () => {
    const ctx = {
      provider: "commandcode",
      model: MODEL,
      modelRef: { provider: "commandcode", model: MODEL },
      scratch: join(tmp, "s"),
      workdir: join(tmp, "s/work"),
      proxyUrl: "http://127.0.0.1:1",
      runId: "r1",
      task: "t",
      env: deps().env,
      repoRoot: REPO_ROOT,
      piHome: join(tmp, "pi-home"),
      thinking: "medium",
    };
    for (const harness of ["prism", "pi"]) {
      for (const provider of ["commandcode", "ollama-cloud"]) {
        const plan = HARNESSES[harness].plan({ ...ctx, provider });
        for (const step of plan.prepare) {
          expect(step.path.startsWith(ctx.scratch)).toBe(true);
          expect(step.path.startsWith(REPO_ROOT)).toBe(false);
        }
      }
    }
    // A step outside the scratch directory is refused before anything is written.
    expect(() => prepareScratch([{ op: "write", path: join(tmp, "elsewhere"), content: "x" }], join(tmp, "s"))).toThrow("outside");
    expect(existsSync(join(tmp, "elsewhere"))).toBe(false);
  });

  test("runner_fails_if_pi_config_mutated", async () => {
    let signature = "before";
    const { spawn } = scripted({ mutate: () => void (signature = "after") });
    const result = await runCell({ ...options, runs: 3, harness: ["pi"] }, deps({ spawn, piSignature: () => signature }));
    expect(result.runs.pi[0].status).toBe("reference_config_mutated");
    expect(result.cell.verdict).toBe("reference_config_mutated");
    expect(result.runs.pi).toHaveLength(1);
  });

  test("runner_never_passes_key_as_argument", () => {
    const ctx = {
      provider: "commandcode",
      model: MODEL,
      modelRef: { provider: "commandcode", model: MODEL },
      scratch: join(tmp, "s"),
      workdir: join(tmp, "s/work"),
      proxyUrl: "http://127.0.0.1:1",
      runId: "r1",
      task: "t",
      env: { ...deps().env, OPENROUTER_API_KEY: "other-provider-key-123456" },
      repoRoot: REPO_ROOT,
      piHome: join(tmp, "pi-home"),
      thinking: "medium",
    };
    for (const harness of ["prism", "pi"]) {
      const plan = HARNESSES[harness].plan(ctx);
      expect(plan.args.join(" ")).not.toContain(KEY);
      expect(plan.args).not.toContain("--api-key");
      expect(plan.env.COMMAND_CODE_API_KEY).toBe(KEY);
      // Another provider's key never reaches the child.
      expect(plan.env.OPENROUTER_API_KEY).toBeUndefined();
      expect(JSON.stringify(plan.prepare)).not.toContain(KEY);
    }
  });

  test("runner_pi_plan_uses_isolation_flags", () => {
    const plan = HARNESSES.pi.plan({
      provider: "ollama-cloud",
      model: "gemma4:31b",
      scratch: join(tmp, "s"),
      workdir: join(tmp, "s/work"),
      proxyUrl: "http://127.0.0.1:9",
      runId: "r",
      task: "t",
      env: deps().env,
      repoRoot: REPO_ROOT,
      piHome: "/pi",
      thinking: "low",
    });
    for (const flag of [
      "--no-session",
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-approve",
    ])
      expect(plan.args).toContain(flag);
    expect(plan.args).toContain("ollama_web_search,ollama_web_fetch");
    expect(plan.args).toContain("ollama-cloud/gemma4:31b");
    const copy = plan.prepare.find((step) => step.op === "copyDir");
    expect(copy.replace[0][1]).toContain("http://127.0.0.1:9");
  });

  test("runner_writes_evidence_without_secrets", async () => {
    const { spawn } = scripted();
    const result = await runCell({ ...options, runs: 1 }, deps({ spawn }));
    const report = buildReport({ options, result, date: "2026-11-08", prismCommit: "abc1234", piVersion: "1.5.0" });
    const [json, md] = writeReport(report, { root: tmp, secrets: [KEY] });
    expect(readFileSync(json, "utf8")).not.toContain(KEY);
    expect(readFileSync(md, "utf8")).toContain("Verdict: pass");
    expect(readdirSync(join(tmp, "docs/_evidence/cache-parity"))).toHaveLength(2);
    expect(renderMarkdown(report)).toContain("pi 1.5.0");
  });
});

describe("prepareScratch copyDir", () => {
  test("copyDir_copies_an_extension_that_lives_under_a_node_modules_path", () => {
    const root = mkdtempSync(join(tmpdir(), "parity-copydir-"));
    try {
      // The pi extension really lives at ~/.pi/agent/npm/node_modules/<name>: the filter must apply to the
      // path below the source directory only, never to the source's own location.
      const from = join(root, "npm", "node_modules", "ext");
      mkdirSync(join(from, "node_modules", "dep"), { recursive: true });
      writeFileSync(join(from, "models.ts"), 'const CLOUD_BASE_URL = "https://ollama.com";\n');
      writeFileSync(join(from, "node_modules", "dep", "x.js"), "skip");
      const scratch = join(root, "scratch");
      mkdirSync(scratch);
      const path = join(scratch, "pi-extension", "ext");
      prepareScratch(
        [
          {
            op: "copyDir",
            from,
            path,
            replaceIn: "models.ts",
            replace: [['const CLOUD_BASE_URL = "https://ollama.com";', 'const CLOUD_BASE_URL = "http://127.0.0.1:1";']],
          },
        ],
        scratch,
      );
      expect(readFileSync(join(path, "models.ts"), "utf8")).toContain("http://127.0.0.1:1");
      expect(existsSync(join(path, "node_modules"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
