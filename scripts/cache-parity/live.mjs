#!/usr/bin/env bun
/**
 * The `release/cache-parity` manifest command (plan 215 Task 24). Runs the enabled parity cells through
 * `run.mjs`'s `runCell`, reruns an `inconclusive` cell once, applies `parityGate` (metrics.mjs), writes each
 * cell's report plus one gate summary under `docs/_evidence/cache-parity/`, and exits non-zero when the gate fails.
 *
 *   PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live
 *
 * Cells (owner amendment 2026-11-08): Command Code chat / Responses / Messages and Ollama Cloud. Hyper, OpenCode
 * Go and OpenRouter are `deferred` (post-0.13.0), never failures. A missing `pi` binary or pi extension skips the
 * row with a reason; strict mode (PRISM_LIVE_STRICT=1) fails it. `PRISM_LIVE_PARITY_CELLS=<id>,<id>` reruns a subset
 * (after a fix); the gate then covers only those cells and the report says so. All gate logic is in metrics.mjs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parityGate, shouldRerun } from "./metrics.mjs";
import { PROVIDERS } from "./harnesses.mjs";
import { buildReport, defaultDeps, REPO_ROOT, runCell, writeReport } from "./run.mjs";

/** The enabled cells, in run order. Models are Task 21's matrix; an env override exists for each. */
export const CELLS = [
  {
    id: "commandcode/chat",
    provider: "commandcode",
    model: "minimax/minimax-m3.1-flash",
    modelEnv: "PRISM_LIVE_PARITY_COMMANDCODE_CHAT_MODEL",
  },
  {
    id: "commandcode/responses",
    provider: "commandcode",
    model: "gpt-5.6-luna",
    modelEnv: "PRISM_LIVE_PARITY_COMMANDCODE_RESPONSES_MODEL",
  },
  {
    id: "commandcode/messages",
    provider: "commandcode",
    model: "claude-haiku-5-5",
    modelEnv: "PRISM_LIVE_PARITY_COMMANDCODE_MESSAGES_MODEL",
  },
  { id: "ollama-cloud/chat", provider: "ollama-cloud", model: "gemma4:31b", modelEnv: "PRISM_LIVE_PARITY_OLLAMA_MODEL" },
];

/** Cells recorded as `deferred` (post-0.13.0), with the Task 21 reasons. */
export const DEFERRED_CELLS = [
  { id: "hyper/chat+messages", reason: "no Hyper credits (402); deferred to after 0.13.0 (owner, 2026-11-08)" },
  {
    id: "opencode-go/chat+messages",
    reason: "monthly limit reached (429) and mimo-v2.5 deprecated; deferred to after 0.13.0 (owner, 2026-11-08)",
  },
  {
    id: "openrouter/anthropic",
    reason: "unmeasurable: needs owner authorization and PRISM_LIVE_OPENROUTER_PAID=1; deferred to after 0.13.0",
  },
];

/**
 * Whether the row can run: `pi` on PATH and both extensions installed. Returns `{ ok: true }` or
 * `{ ok: false, reason }`. `which` and `exists` are injectable so the tests need no pi.
 */
export function preflight({ piHome, which = defaultWhich, exists = existsSync, cells = CELLS } = {}) {
  if (!which("pi")) return { ok: false, reason: "pi is not on PATH" };
  for (const provider of new Set(cells.map((cell) => cell.provider))) {
    const extension = PROVIDERS[provider].piExtension;
    if (!exists(join(piHome, "npm", "node_modules", extension))) return { ok: false, reason: `pi extension ${extension} is not installed` };
  }
  return { ok: true };
}

function defaultWhich(binary) {
  return spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 30_000 }).status === 0;
}

/**
 * Run every enabled cell. `run(cell)` returns `{ cell, requests, ... }` where `cell.verdict` is the cell's verdict.
 * An `inconclusive` first attempt is rerun once; every attempt is returned (the evidence file keeps every run).
 */
export async function runGate(cells, run, { strict = false } = {}) {
  const attempts = [];
  const finals = [];
  for (const spec of cells) {
    let attempt = 0;
    let last;
    do {
      last = await run(spec, attempt);
      attempts.push({ id: spec.id, attempt, verdict: last.cell.verdict, requests: last.requests });
      attempt += 1;
    } while (shouldRerun(last.cell.verdict, attempt - 1));
    finals.push({ id: spec.id, verdict: last.cell.verdict, reason: last.cell.reason });
    if (last.cell.verdict === "reference_config_mutated") break;
  }
  return {
    gate: parityGate([...finals, ...DEFERRED_CELLS.map((cell) => ({ id: cell.id, verdict: "deferred", reason: cell.reason }))], { strict }),
    attempts,
    finals,
  };
}

async function main() {
  const { loadEnv } = await import("./provider-probe.mjs");
  loadEnv();
  const strict = process.env.PRISM_LIVE_STRICT === "1";
  if (process.env.PRISM_LIVE_PROVIDER_TESTS !== "1" || process.env.PRISM_LIVE_CACHE_PARITY !== "1") {
    console.log("release/cache-parity: skipped (PRISM_LIVE_PROVIDER_TESTS and PRISM_LIVE_CACHE_PARITY must be 1)");
    process.exitCode = strict ? 1 : 0;
    return;
  }
  const missingKeys = [...new Set(CELLS.map((cell) => PROVIDERS[cell.provider].keyEnv))].filter((name) => !process.env[name]);
  const piHome = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const checked = missingKeys.length > 0 ? { ok: false, reason: `missing ${missingKeys.join(", ")}` } : preflight({ piHome });
  if (!checked.ok) {
    console.log(`release/cache-parity: skipped (${checked.reason})`);
    process.exitCode = strict ? 1 : 0;
    return;
  }
  const only = (process.env.PRISM_LIVE_PARITY_CELLS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const cells = only.length === 0 ? CELLS : CELLS.filter((cell) => only.includes(cell.id));
  if (cells.length === 0)
    throw new Error(`CacheParity: PRISM_LIVE_PARITY_CELLS names no cell; use ${CELLS.map((cell) => cell.id).join(", ")}`);
  const deps = defaultDeps(process.env, piHome);
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  const piVersion = spawnSync("pi", ["--version"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  const date = new Date().toISOString().slice(0, 10);
  const result = await runGate(
    cells,
    async (spec, attempt) => {
      const options = {
        provider: spec.provider,
        model: process.env[spec.modelEnv] || spec.model,
        runs: 3,
        harness: ["prism", "pi"],
        thinking: "medium",
      };
      const cellResult = await runCell(options, deps);
      const report = buildReport({ options, result: cellResult, date, prismCommit: git.stdout?.trim() || "unknown", piVersion });
      const [json] = writeReport({ ...report, attempt }, { secrets: deps.secrets });
      console.log(
        `${spec.id} attempt ${attempt + 1}: ${report.cell.verdict} (${report.requests.used}/${report.requests.ceiling} requests) -> ${json}`,
      );
      return report;
    },
    { strict },
  );
  const dir = join(REPO_ROOT, "docs/_evidence/cache-parity");
  mkdirSync(dir, { recursive: true });
  // The evidence keeps every run: a second gate on the same day gets its own file.
  let gateFile = join(dir, `gate-${date}.json`);
  for (let n = 2; existsSync(gateFile); n++) gateFile = join(dir, `gate-${date}-${n}.json`);
  writeFileSync(
    gateFile,
    `${JSON.stringify({ schema: "cache-parity-gate/1", date, cells: cells.map((cell) => cell.id), prismCommit: git.stdout?.trim() || "unknown", pi: piVersion, strict, ...result, deferred: DEFERRED_CELLS }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result.gate));
  process.exitCode = result.gate.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message?.startsWith("CacheParity:") ? error.message : "release/cache-parity failed; nothing more was recorded.");
    process.exitCode = 1;
  });
}
