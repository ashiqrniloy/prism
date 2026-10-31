/**
 * Starts the repo's free LiteLLM test pool (plan 214 Task 5) and mints its budget-capped key.
 *
 *   bun scripts/litellm/up.mjs                 # start, print the groups served
 *   bun scripts/litellm/up.mjs --write-key     # also write LITELLM_API_KEY into the live env file
 *   bun scripts/litellm/up.mjs --otel http://127.0.0.1:4318/v1/traces
 *
 * Loopback only. The rendered config and compose file live in a scratch directory outside the
 * repo (mode 0600) and never contain a credential value: LiteLLM reads `os.environ/NAME` and
 * compose interpolates `${NAME}` from this process's environment.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "../live-matrix.mjs";
import { renderPool } from "./render.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_URL = process.env.PRISM_LIVE_LITELLM_BASE_URL ?? "http://127.0.0.1:4000";
// `compose up --wait` includes Prisma's first-run migration, which on a rootless podman host took
// past 180 s from an empty volume; the bound is for "hung", not for "slow disk".
const START_TIMEOUT_MS = 420_000;
const HEALTH_TIMEOUT_MS = 120_000;
const KEY_ALIAS = "prism-free-pool";
/** 1 cent: enough for the `prism-free/priced` tripwire to accrue spend, far below any paid call. */
const KEY_MAX_BUDGET_USD = 0.01;

export function scratchDir() {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "prism", "litellm-pool");
}

/** The bench's credential rules: `PRISM_LIVE_ENV_FILE`, else `~/.config/prism/live.env`, else env only. */
export function liveEnvFile() {
  const explicit = process.env.PRISM_LIVE_ENV_FILE;
  if (explicit) return explicit;
  const conventional = join(homedir(), ".config/prism/live.env");
  return existsSync(conventional) ? conventional : undefined;
}

/** Loads the live env file into `process.env` (never overwriting what is already set). */
export function loadEnv() {
  const path = liveEnvFile();
  if (!path) return undefined;
  if (!existsSync(path)) throw new Error(`PRISM_LIVE_ENV_FILE points at a missing file: ${path}`);
  for (const [name, value] of Object.entries(parseEnvFile(path))) if (process.env[name] === undefined) process.env[name] = value;
  return path;
}

/** One credential file, written 0600: `LITELLM_API_KEY` is upserted in place, nothing else changes. */
export function assertPrivateFile(path) {
  const stat = statSync(path);
  if ((stat.mode & 0o077) !== 0)
    throw new Error(`${path} must be mode 0600 before a key is written (it is ${(stat.mode & 0o777).toString(8)})`);
}

export function writeKeyToLiveEnv(path, key) {
  assertPrivateFile(path);
  const lines = readFileSync(path, "utf8").replace(/\n?$/, "\n").split("\n");
  const kept = lines.filter((line) => !/^\s*(?:export\s+)?LITELLM_API_KEY=/.test(line));
  const body = kept.filter((line, index) => line !== "" || index < kept.length - 1).join("\n");
  writeFileSync(path, `${body.endsWith("\n") ? body : `${body}\n`}LITELLM_API_KEY=${key}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function engine() {
  for (const candidate of [
    ["docker", ["compose"]],
    ["podman", ["compose"]],
  ]) {
    const [command, prefix] = candidate;
    const probe = spawnSync(command, [...prefix, "version"], { encoding: "utf8" });
    if (probe.status === 0) return { command, prefix };
  }
  throw new Error("no compose engine found: install docker compose or podman compose");
}

function compose(args, cwd) {
  const { command, prefix } = engine();
  const result = spawnSync(command, [...prefix, ...args], { cwd, encoding: "utf8", timeout: START_TIMEOUT_MS });
  if (result.error) throw new Error(`compose ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `compose ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout || "").trim().split("\n").slice(-8).join("\n")}`,
    );
  return result;
}

async function waitForHealth(url, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = "no attempt";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health/liveliness`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return response.text();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`pool did not become healthy within ${timeoutMs} ms (${last})`);
}

async function proxy(path, { method = "POST", key, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!response.ok)
    throw new Error(`${path}: HTTP ${response.status} ${(json?.error?.message ?? json?.error ?? text).toString().slice(0, 300)}`);
  return json;
}

/**
 * Mints (or rotates) the pool key. The user is created first with role `internal_user`, because
 * `/spend/logs/v2` only scopes rows for a caller that has both a role and a `user_id` (plan 214
 * Task 1b measured a role-less key reading every tenant's rows).
 */
async function mintKey({ groups }) {
  const master = process.env.LITELLM_MASTER_KEY;
  if (!master) return undefined;
  try {
    await proxy("/user/new", { key: master, body: { user_id: KEY_ALIAS, user_role: "internal_user", user_alias: "Prism free pool" } });
  } catch (error) {
    // A second run finds the user already there; anything else is worth failing on.
    if (!/already exists|duplicate/i.test(String(error))) throw error;
  }
  const generate = (body) => proxy("/key/generate", { key: master, body });
  const request = {
    key_alias: KEY_ALIAS,
    user_id: KEY_ALIAS,
    models: groups,
    max_budget: KEY_MAX_BUDGET_USD,
    budget_duration: "30d",
    metadata: { purpose: "prism-free-pool", plan: "214" },
  };
  // Rotation: a second run finds last run's key under the same alias, which LiteLLM refuses to
  // duplicate. Delete that one key (by alias) and mint a fresh one; nothing else is touched.
  let keyed;
  try {
    keyed = await generate(request);
  } catch (error) {
    if (!/already exists/i.test(String(error))) throw error;
    await proxy("/key/delete", { key: master, body: { key_aliases: [KEY_ALIAS] } });
    keyed = await generate(request);
  }
  return typeof keyed?.key === "string" ? keyed.key : undefined;
}

function parseArgs(argv) {
  const options = { writeKey: false, otel: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write-key") options.writeKey = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--otel") {
      options.otel = argv[++i];
      if (!options.otel) throw new Error("--otel needs a collector endpoint URL");
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

/**
 * One password per Postgres volume, not per run: `POSTGRES_PASSWORD` is only read when the volume is
 * initialised, so a fresh password against an existing volume is an authentication failure. The file
 * lives beside the compose file (mode 0600) and `down --purge` removes it with the volume.
 */
export function databasePassword(dir) {
  const path = join(dir, "db-password");
  if (existsSync(path)) {
    const stored = readFileSync(path, "utf8").trim();
    if (stored) return stored;
  }
  return randomBytes(24).toString("hex");
}

export async function up({ writeKey = false, otel, dryRun = false } = {}) {
  const envPath = loadEnv();
  // Fail before anything starts: a key must never be minted for a file we then refuse to write.
  if (writeKey) {
    if (!envPath) throw new Error("--write-key needs a live env file (PRISM_LIVE_ENV_FILE or ~/.config/prism/live.env)");
    assertPrivateFile(envPath);
  }
  const dir = scratchDir();
  const insideRepo = !relative(ROOT, dir).startsWith("..");
  if (insideRepo) throw new Error(`refusing to render the pool inside the repo (${dir})`);

  const rendered = renderPool({ env: (name) => process.env[name], otelEndpoint: otel, dbPassword: databasePassword(dir) });
  if (dryRun) {
    console.log(`${rendered.groups.length} groups: ${rendered.groups.join(", ")}`);
    if (rendered.missing.length > 0) console.log(`skipped for missing keys: ${rendered.missing.join(", ")}`);
    return rendered;
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  for (const [name, text] of [
    ["config.yaml", rendered.configText],
    ["compose.yaml", rendered.composeText],
    ["db-password", `${rendered.dbPassword}\n`],
  ]) {
    writeFileSync(join(dir, name), text, { mode: 0o600 });
    chmodSync(join(dir, name), 0o600);
  }
  writeFileSync(
    join(dir, "pool.json"),
    `${JSON.stringify({ baseUrl: BASE_URL, groups: rendered.groups, deployments: rendered.deployments }, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );

  compose(["-f", "compose.yaml", "up", "-d", "--wait"], dir);
  await waitForHealth(BASE_URL);
  console.log(`pool up: ${rendered.groups.length} groups at ${BASE_URL}`);
  if (rendered.missing.length > 0) console.log(`skipped for missing keys: ${rendered.missing.join(", ")}`);

  const key = await mintKey(rendered);
  if (key === undefined) {
    console.log("no LITELLM_MASTER_KEY in the environment: pool started without minting a virtual key");
    return rendered;
  }
  console.log(`key: alias ${KEY_ALIAS}, budget $${KEY_MAX_BUDGET_USD}/30d, models ${rendered.groups.join(", ")}`);
  if (!writeKey) {
    console.log("key not written anywhere (pass --write-key to store it as LITELLM_API_KEY in the live env file)");
    return rendered;
  }
  writeKeyToLiveEnv(envPath, key);
  console.log(`wrote LITELLM_API_KEY to ${envPath} (mode 0600)`);
  return rendered;
}

async function main() {
  try {
    await up(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`${error.name ?? "Error"}: ${error.message}`);
    if (process.env.PRISM_DEBUG) console.error(error.stack);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
