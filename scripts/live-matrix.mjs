#!/usr/bin/env node
/**
 * Live-test credential matrix + runner (plans/064 Tasks 1-2).
 *
 * Declarative inventory of every live/real suite: scripts/live-matrix.json.
 * This module loads + validates the manifest, resolves per-suite state against
 * the environment, and (Task 2) spawns the runnable suites with accounting:
 *
 *   node scripts/live-matrix.mjs --check          validate + per-suite skip/run table
 *   node scripts/live-matrix.mjs                  run what creds allow (npm run test:live)
 *   PRISM_LIVE_DRY_RUN=1 node scripts/live-matrix.mjs   accounting only, no spawns
 *
 * Contracts encoded here:
 * - Skip, never fail: a suite whose required env vars are absent is skipped
 *   with a reason (resolveSuiteState), never spawned, never failed.
 *   PRISM_LIVE_STRICT=1 inverts this: any skip fails the RUN (exit 1).
 * - Model selection: provider suites declare `model: [{env, default, wired}]`;
 *   the env var overrides the default model id used by the live test.
 *   `wired: false` = the test file does not read the env var yet
 *   (retrofit: plans/064 Task 4).
 * - Fail closed: unknown manifest fields are validation errors; malformed
 *   env-file lines are hard errors.
 * - Secrets: the report contains env *names* (and model ids, which are config,
 *   not credentials) — never env values. Suite output passes through
 *   unmodified; suites keep themselves secret-clean via assertNoSecretLeak.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCoverage } from "./e2e-coverage-gate.mjs";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const SUITE_ID = /^[a-z0-9][a-z0-9/_-]*$/i;
// Credential-shaped values must never appear in the manifest (names only).
const SECRET_SHAPED = /(?:sk-|sk-ant-|xai-)[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|secret|token)\s*=/i;

const SUITE_KEYS = new Set([
  "id",
  "package",
  "status",
  "source",
  "command",
  "cwd",
  "requires",
  "requiresAny",
  "optional",
  "model",
  "scope",
  "cost",
  "plan",
  "notes",
  "thinkingProbe",
]);
const MODEL_KEYS = new Set(["env", "default", "wired"]);

export function loadMatrix(root = REPO_ROOT) {
  const path = join(root, "scripts/live-matrix.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateMatrix(matrix, root = REPO_ROOT) {
  const errors = [];
  if (matrix.schemaVersion !== 1) errors.push(`schemaVersion must be 1`);
  if (!Array.isArray(matrix.suites) || matrix.suites.length === 0) errors.push(`suites must be a non-empty array`);
  if (matrix.defaults !== undefined && typeof matrix.defaults !== "object") errors.push(`defaults must be an object`);
  for (const key of Object.keys(matrix)) {
    if (key !== "schemaVersion" && key !== "suites" && key !== "defaults") errors.push(`unknown top-level field: ${key}`);
  }

  const seen = new Set();
  for (const suite of matrix.suites ?? []) {
    const label = suite?.id ?? "<missing id>";
    if (typeof suite.id !== "string" || !SUITE_ID.test(suite.id)) errors.push(`${label}: invalid id`);
    if (seen.has(suite.id)) errors.push(`${label}: duplicate id`);
    seen.add(suite.id);
    for (const key of Object.keys(suite)) {
      if (!SUITE_KEYS.has(key)) errors.push(`${label}: unknown suite field: ${key}`);
    }
    if (!["active", "planned"].includes(suite.status)) errors.push(`${label}: status must be "active" or "planned"`);
    if (typeof suite.package !== "string" || !suite.package.startsWith("@arnilo/"))
      errors.push(`${label}: package must be an @arnilo/ name`);

    for (const field of ["requires", "requiresAny", "optional"]) {
      if (suite[field] === undefined) continue;
      if (!Array.isArray(suite[field])) errors.push(`${label}: ${field} must be an array`);
      else for (const v of suite[field]) if (!ENV_NAME.test(v)) errors.push(`${label}: ${field} entry not an env name: ${v}`);
    }
    if (suite.status === "active" && !Array.isArray(suite.requires) && !Array.isArray(suite.requiresAny)) {
      errors.push(`${label}: active suite needs requires or requiresAny (an empty requires array = always-runnable hermetic leg)`);
    }

    if (suite.status === "active") {
      if (typeof suite.source !== "string" || !existsSync(join(root, suite.source))) {
        errors.push(`${label}: active suite source does not exist: ${suite.source}`);
      }
      if (typeof suite.command !== "string" || !(suite.command.startsWith("node ") || suite.command.startsWith("npm run "))) {
        errors.push(`${label}: command must be a node / npm run invocation`);
      }
    } else {
      if (suite.plan !== "plans/064-E2E-Live-Test-Coverage-Matrix.md") {
        errors.push(`${label}: planned suite must name its plan file`);
      }
    }

    if (suite.model !== undefined) {
      if (!Array.isArray(suite.model)) errors.push(`${label}: model must be an array`);
      for (const m of suite.model ?? []) {
        for (const key of Object.keys(m)) if (!MODEL_KEYS.has(key)) errors.push(`${label}: unknown model field: ${key}`);
        if (!ENV_NAME.test(m.env ?? "")) errors.push(`${label}: model env not an env name: ${m.env}`);
        if (typeof m.default !== "string" || !m.default) errors.push(`${label}: model default must be a non-empty string (${m.env})`);
        if (typeof m.wired !== "boolean") errors.push(`${label}: model wired must be boolean (${m.env})`);
      }
    }

    for (const [field, value] of Object.entries(suite)) {
      if (typeof value === "string" && SECRET_SHAPED.test(value)) errors.push(`${label}: ${field} looks like a secret value`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The skip contract: missing credential => skipped with reason, never failed.
 * Pure so the runner (Task 2) and tests share one implementation.
 */
export function resolveSuiteState(suite, env = process.env) {
  const missing = (suite.requires ?? []).filter((v) => !env[v]);
  if (missing.length) return { state: "skip", reason: `missing ${missing.join(", ")}` };
  const anyMissing = (suite.requiresAny ?? []).every((v) => !env[v]);
  if ((suite.requiresAny ?? []).length && anyMissing) {
    return { state: "skip", reason: `missing one of ${suite.requiresAny.join(", ")}` };
  }
  return { state: "run", reason: null };
}

function check(root = REPO_ROOT) {
  const matrix = loadMatrix(root);
  const { ok, errors } = validateMatrix(matrix, root);
  if (!ok) {
    for (const e of errors) console.error(`LIVE-MATRIX: ${e}`);
    process.exit(1);
  }
  let env;
  try {
    env = { ...loadEnvFileOpt(root), ...process.env };
  } catch (err) {
    console.error(`LIVE-MATRIX: ${err.message} (--check continuing with process env only)`);
    env = process.env;
  }
  const active = matrix.suites.filter((s) => s.status === "active");
  const rows = active.map((s) => {
    const { state, reason } = resolveSuiteState(s, env);
    const models = (s.model ?? []).map((m) => `${m.env}=${env[m.env] ?? m.default}${m.wired ? "" : " (unwired)"}`).join(", ");
    return { id: s.id, state, reason: reason ?? "", models };
  });
  const runnable = rows.filter((r) => r.state === "run").length;
  for (const r of rows)
    console.log(`${r.state.padEnd(5)} ${r.id}${r.reason ? ` — ${r.reason}` : ""}${r.models ? ` — models: ${r.models}` : ""}`);
  console.log(`\n${runnable}/${rows.length} active suites runnable with current env (${matrix.suites.length - active.length} planned)`);
}

// ── runner (Task 2) ─────────────────────────────────────────────────────────

/** Parse a dotenv-shaped file (Node --env-file semantics, no deps): full-line
 * comments, optional `export ` prefix, optional surrounding quotes. Hard
 * error on any other line — fail closed on typos. Values are never logged. */
export function parseEnvFile(path) {
  const map = {};
  const lines = readFileSync(path, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m) throw new Error(`live env file ${path}:${i + 1}: expected KEY=VALUE or comment`);
    let value = m[2].trim();
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
      value = value.slice(1, -1);
    }
    map[m[1]] = value;
  }
  return map;
}

/** Default credential file: $PRISM_LIVE_ENV_FILE override, else
 * scripts/live.env when present (gitignored), else env-only. */
function loadEnvFileOpt(root) {
  const chosen = process.env.PRISM_LIVE_ENV_FILE ?? (existsSync(join(root, "scripts/live.env")) ? "scripts/live.env" : null);
  if (!chosen) return {};
  const path = chosen.startsWith("/") ? chosen : join(root, chosen);
  if (!existsSync(path)) throw new Error(`PRISM_LIVE_ENV_FILE points at a missing file: ${chosen}`);
  return parseEnvFile(path);
}

function modelsInEffect(suite, env) {
  return (suite.model ?? []).map((m) => ({ env: m.env, value: env[m.env] ?? m.default, wired: m.wired }));
}

function runOneSuite(suite, opts) {
  return new Promise((resolve) => {
    const started = Date.now();
    opts.log(`\n[live-matrix: ${suite.id}] $ ${suite.command}${suite.cwd ? `  (cwd: ${suite.cwd})` : ""}`);
    // with-build-lock wraps each dist-consuming leaf per repo doctrine (never the
    // orchestrator); shell:true preserves the command string. ponytail: spawn
    // timeout SIGTERMs the wrapper shell, a hung grandchild may survive it —
    // suites are bounded test runs, this is a safety net not a guarantee.
    const child = spawn(`${process.execPath} ${join(root_scripts(opts.root), "with-build-lock.mjs")} ${suite.command}`, {
      cwd: suite.cwd ? join(opts.root, suite.cwd) : opts.root,
      env: opts.env,
      shell: true,
      timeout: opts.timeoutMs,
      killSignal: "SIGTERM",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    let len = 0;
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        opts.log(chunk.toString("utf8"));
        out.push(chunk);
        len += chunk.length;
      });
    }
    const finish = (status, reason, exitCode = null) => {
      const tail = Buffer.concat(out)
        .subarray(Math.max(0, len - 4000))
        .toString("utf8");
      resolve({
        id: suite.id,
        package: suite.package,
        status,
        reason,
        exitCode,
        durationMs: Date.now() - started,
        command: suite.command,
        cwd: suite.cwd ?? null,
        models: modelsInEffect(suite, opts.env),
        outputTail: status === "failed" ? tail : "",
      });
    };
    child.on("error", (err) => finish("failed", err.message));
    child.on("timeout", () => finish("failed", `timed out after ${opts.timeoutMs}ms`));
    child.on("close", (code) => finish(code === 0 ? "ran" : "failed", code === 0 ? null : `exit ${code}`, code));
  });
}

function root_scripts(root) {
  return join(root, "scripts");
}

/**
 * Run (or dry-run) the matrix. Selected active suites run when their
 * credentials are present, skip with a reason otherwise; planned suites are
 * reported but never run. Returns { totals, results, exitCode } and writes
 * docs/_evidence/live-matrix-report.{json,md} under root.
 */
export async function runLiveMatrix(opts) {
  const o = {
    env: process.env,
    filter: null,
    strict: false,
    dryRun: false,
    concurrency: 1,
    timeoutMs: 600_000,
    build: "npm run build",
    log: console.log,
    ...opts,
  };
  const matrix = loadMatrix(o.root);
  const { ok, errors } = validateMatrix(matrix, o.root);
  if (!ok) return { totals: null, results: [], exitCode: 2, validationErrors: errors };

  const active = matrix.suites.filter((s) => s.status === "active");
  const planned = matrix.suites.filter((s) => s.status === "planned");
  const selected = active.filter((s) => !o.filter || s.id.includes(o.filter));
  const states = selected.map((s) => resolveSuiteState(s, o.env));

  if (!o.dryRun && o.build && states.some((s) => s.state === "run")) {
    o.log("[live-matrix] building workspaces (fresh dist for suite commands)...");
    const build = spawnSync(o.build, { cwd: o.root, shell: true, stdio: "inherit" });
    if (build.status !== 0) return { totals: { ran: 0, skipped: 0, failed: 1, planned: planned.length }, results: [], exitCode: 1 };
  }

  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < selected.length) {
      const suite = selected[next++];
      const { state, reason } = resolveSuiteState(suite, o.env);
      let row;
      if (state === "skip") {
        row = {
          id: suite.id,
          package: suite.package,
          status: "skipped",
          reason,
          exitCode: null,
          durationMs: 0,
          command: suite.command,
          cwd: suite.cwd ?? null,
          models: modelsInEffect(suite, o.env),
          outputTail: "",
        };
      } else if (o.dryRun) {
        row = {
          id: suite.id,
          package: suite.package,
          status: "ran",
          reason: null,
          exitCode: null,
          durationMs: 0,
          command: suite.command,
          cwd: suite.cwd ?? null,
          models: modelsInEffect(suite, o.env),
          outputTail: "",
        };
      } else {
        row = await runOneSuite(suite, o);
      }
      results.push(row);
      const detail = row.status === "skipped" ? ` — ${row.reason}` : row.status === "failed" ? ` — ${row.reason}` : "";
      o.log(`[live-matrix] ${row.status.padEnd(7)} ${row.id} (${(row.durationMs / 1000).toFixed(1)}s)${detail}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, selected.length)) }, worker));

  const plannedRows = planned
    .filter((s) => !o.filter || s.id.includes(o.filter))
    .map((s) => ({
      id: s.id,
      package: s.package,
      status: "planned",
      reason: s.notes ?? null,
      exitCode: null,
      durationMs: 0,
      command: null,
      cwd: null,
      models: [],
      outputTail: "",
    }));
  const all = [...results, ...plannedRows];
  const totals = {
    ran: all.filter((r) => r.status === "ran").length,
    skipped: all.filter((r) => r.status === "skipped").length,
    failed: all.filter((r) => r.status === "failed").length,
    planned: all.filter((r) => r.status === "planned").length,
  };
  const exitCode = totals.failed > 0 ? 1 : o.strict && totals.skipped > 0 ? 1 : 0;
  // Task 3 wiring: e2e surface coverage summary rides along in the report
  let coverage = null;
  try {
    const covManifest = JSON.parse(readFileSync(join(o.root, "scripts/e2e-coverage.json"), "utf8"));
    const cov = computeCoverage(o.root, covManifest);
    coverage = { ok: cov.errors.length === 0, ...cov.summary };
  } catch {
    coverage = null; // fixture roots have no manifest
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    envFile: process.env.PRISM_LIVE_ENV_FILE ?? null,
    strict: o.strict,
    dryRun: o.dryRun,
    filter: o.filter,
    totals,
    coverage,
    results: all,
  };
  writeReport(o.root, report);
  return { totals, results: all, coverage, exitCode };
}

function writeReport(root, report) {
  const dir = join(root, "docs", "_evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "live-matrix-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const md = [
    "# Live matrix report",
    "",
    `- generated: ${report.generatedAt}${report.envFile ? `\n- env file: ${report.envFile}` : ""}${report.filter ? `\n- filter: ${report.filter}` : ""}${report.dryRun ? "\n- mode: dry-run (no suites spawned)" : ""}${report.strict ? "\n- mode: strict (skips fail the run)" : ""}`,
    `- totals: ${report.totals.ran} ran, ${report.totals.skipped} skipped, ${report.totals.failed} failed, ${report.totals.planned} planned`,
    "",
    "| suite | status | ms | detail |",
    "|---|---|---|---|",
    ...report.results.map((r) => {
      const models = r.models.map((m) => `${m.env}=${m.value}`).join(", ");
      const detail = r.status === "failed" ? `${r.reason}${r.outputTail ? " (output tail in json report)" : ""}` : (r.reason ?? models);
      return `| ${r.id} | ${r.status} | ${r.durationMs} | ${detail.replaceAll("|", "\\|")} |`;
    }),
    "",
  ].join("\n");
  writeFileSync(join(dir, "live-matrix-report.md"), md);
}

function usage() {
  console.log(
    `usage: node scripts/live-matrix.mjs [--check]\n\n  --check            validate manifest + per-suite skip/run table (no spawns)\n  (default)          run active suites whose credentials are present; skip the rest\n\nenv:\n  PRISM_LIVE_ENV_FILE      credential file (default: scripts/live.env when present)\n  PRISM_LIVE_FILTER=<sub>  only suites whose id contains <sub>\n  PRISM_LIVE_STRICT=1      any skip fails the run\n  PRISM_LIVE_DRY_RUN=1     accounting only, no spawns\n  PRISM_LIVE_CONCURRENCY=n parallel suites (default 1, sequential)\n  PRISM_LIVE_SUITE_TIMEOUT_MS  per-suite kill timer (default 600000)`,
  );
}

async function main() {
  const root = REPO_ROOT;
  let env;
  try {
    env = { ...loadEnvFileOpt(root), ...process.env };
  } catch (err) {
    console.error(`LIVE-MATRIX: ${err.message}`);
    process.exit(2);
  }
  const { totals, coverage, exitCode, validationErrors } = await runLiveMatrix({
    root,
    env,
    filter: process.env.PRISM_LIVE_FILTER || null,
    strict: !!process.env.PRISM_LIVE_STRICT,
    dryRun: !!process.env.PRISM_LIVE_DRY_RUN,
    concurrency: Number(process.env.PRISM_LIVE_CONCURRENCY ?? 1) || 1,
    timeoutMs: Number(process.env.PRISM_LIVE_SUITE_TIMEOUT_MS ?? 600_000),
  });
  if (validationErrors) {
    for (const e of validationErrors) console.error(`LIVE-MATRIX: ${e}`);
    process.exit(2);
  }
  const filterNote = process.env.PRISM_LIVE_FILTER ? ` (filter: ${process.env.PRISM_LIVE_FILTER})` : "";
  console.log(
    `\nlive-matrix: ${totals.ran} ran, ${totals.skipped} skipped, ${totals.failed} failed, ${totals.planned} planned${filterNote}`,
  );
  if (coverage)
    console.log(
      `e2e-coverage: ${coverage.covered}/${coverage.total} surfaces covered, ${coverage.pending} pending (mode: ${coverage.mode})`,
    );
  console.log("report: docs/_evidence/live-matrix-report.json + .md");
  if (process.env.PRISM_LIVE_STRICT && totals.skipped > 0 && !totals.failed) {
    console.log("strict mode: skipped suites fail this run (PRISM_LIVE_STRICT=1).");
  }
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("-h") || process.argv.includes("--help")) usage();
  else if (process.argv.includes("--check")) check();
  else await main();
}
