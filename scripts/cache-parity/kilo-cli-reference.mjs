#!/usr/bin/env bun
/**
 * The Kilo CLI headless reference on plan 203's three-turn fixture (plan 215 Task 24, free-model Chat cell).
 * Sends the fixture's padded first message, then three follow-ups, through `kilo run --format json` (the
 * follow-ups continue the same session with `-c`), with the gateway routed through the wire proxy, and
 * reports cache reuse the way `provider-probe.mjs` does: cache reads on turns 2..n over the first request's
 * prompt tokens repeated n-1 times. The CLI adds its own system prompt and 24 tools, so its prefix is larger
 * than Prism's probe prefix; the reuse ratio is the comparable number, not the token counts.
 *
 *   PRISM_LIVE_PROVIDER_TESTS=1 PRISM_LIVE_CACHE_PARITY=1 bun scripts/cache-parity/kilo-cli-reference.mjs
 *
 * Requests: at most 4 `kilo run` calls (each makes one main request, plus possibly a title request); the
 * proxy ceiling is 12 forwarded requests. The key reaches `kilo` through its environment only.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startWireProxy } from "../wire-proxy.mjs";
import { childEnv } from "./harnesses.mjs";
import { median, parseUsageLog } from "./metrics.mjs";
import { loadEnv } from "./provider-probe.mjs";
import { REPO_ROOT } from "./run.mjs";

const MODEL = "nvidia/nemotron-3.5-super-vl:free";
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/three-turn-coding.json", import.meta.url), "utf8"));
const TURNS = 4;
const MAIN_REQUEST_MIN_TOKENS = 8192;

/** The four user messages: the padded first message, then short follow-ups with the same history. */
export function turnPrompts(fixture = FIXTURE) {
  const padding = Array.from({ length: fixture.padding.words }, () => fixture.padding.word).join(" ");
  return [
    `${padding}\n\n${fixture.system} Inspect fixture.js; do not call tools.`,
    "Inspect fixture.js again. Reply OK; do not call tools.",
    "Check the fixture tests. Reply OK; do not call tools.",
    "Summarise in one word. Reply OK; do not call tools.",
  ];
}

/** Reuse over the main requests (prompt tokens at least the fixture's 8192-token minimum). Missing counts => unmeasurable. */
export function summarize(entries) {
  const main = entries.filter((entry) => (entry.status === undefined || (entry.status >= 200 && entry.status < 300)) && (entry.inputTokens ?? 0) >= MAIN_REQUEST_MIN_TOKENS);
  if (main.length < 2) return { status: "unmeasurable", reason: `only ${main.length} main request(s) reached the proxy`, turns: main.length };
  const warm = main.slice(1);
  if (warm.some((entry) => !Number.isSafeInteger(entry.cacheReadTokens))) return { status: "unmeasurable", reason: "no cache counts reported", turns: main.length };
  const prefix = main[0].inputTokens;
  const reuse = warm.reduce((sum, entry) => sum + entry.cacheReadTokens, 0) / (prefix * warm.length);
  return {
    status: "measured",
    reuse,
    stablePrefixTokens: prefix,
    turns: main.map((entry, index) => ({ turn: index + 1, inputTokens: entry.inputTokens, cacheReadTokens: entry.cacheReadTokens ?? 0 })),
    medianHitRate: median(main.map((entry) => (entry.cacheReadTokens ?? 0) / entry.inputTokens)),
  };
}

function runKilo(args, { cwd, env, timeoutMs }) {
  return new Promise((resolveRun) => {
    const child = spawn("kilo", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => void (out += chunk));
    child.stderr.on("data", (chunk) => void (out += chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, out });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolveRun({ code: null, out });
    });
  });
}

async function main() {
  loadEnv();
  if (process.env.PRISM_LIVE_PROVIDER_TESTS !== "1" || process.env.PRISM_LIVE_CACHE_PARITY !== "1") {
    throw new Error("KiloReference: enable PRISM_LIVE_PROVIDER_TESTS=1 and PRISM_LIVE_CACHE_PARITY=1");
  }
  const key = process.env.KILO_API_KEY;
  if (!key) throw new Error("KiloReference: KILO_API_KEY is unavailable");
  const scratch = mkdtempSync(join(tmpdir(), "kilo-ref-"));
  const work = join(scratch, "work");
  const home = join(scratch, "home");
  mkdirSync(work);
  mkdirSync(home);
  const usageLog = join(scratch, "usage.jsonl");
  const proxy = await startWireProxy({ upstream: "https://ai-gateway.kilo.ai", listen: "127.0.0.1:0", usageLog, maxRequests: 12 });
  try {
    const env = childEnv(process.env, "KILO_API_KEY", {
      KILO_AI_GATEWAY_URL: `${proxy.url}/api/v1`,
      // A run-scoped home keeps the owner's kilo config and sessions untouched.
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_STATE_HOME: join(home, ".local/state"),
      XDG_CACHE_HOME: join(home, ".cache"),
    });
    const prompts = turnPrompts();
    const exits = [];
    for (const [index, prompt] of prompts.entries()) {
      const args = ["run", "--format", "json", "-m", `kilo/${MODEL}`, ...(index === 0 ? [] : ["-c"]), prompt];
      const result = await runKilo(args, { cwd: work, env, timeoutMs: 5 * 60_000 });
      if (result.out.includes(key)) throw new Error("KiloReference: the key appeared in kilo output; refusing to store anything");
      exits.push(result.code);
    }
    await proxy.drain();
    const entries = parseUsageLog(readFileSync(usageLog, "utf8"));
    const report = { schema: "kilo-cli-reference/1", date: new Date().toISOString().slice(0, 10), cli: "@kilocode/cli 7.8.18", model: MODEL, route: "chat", exits, requests: entries.length, ...summarize(entries) };
    const text = JSON.stringify(report, null, 2);
    if (text.includes(key)) throw new Error("KiloReference: the key appeared in the report");
    const out = join(REPO_ROOT, "docs/_evidence/cache-probe", `kilo-cli-headless-${MODEL.replace(/[^A-Za-z0-9.-]+/g, "-")}-${report.date}.json`);
    writeFileSync(out, `${text}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, reuse: report.reuse ?? null, requests: report.requests, evidence: out }));
  } finally {
    proxy.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message?.startsWith("KiloReference:") ? error.message : "Kilo CLI reference failed; nothing was recorded.");
    process.exitCode = 1;
  });
}
