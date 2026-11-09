#!/usr/bin/env bun
/**
 * Live pre-flight check (plan 215 Task 31). Run it before a live run spends money: it checks the
 * credential rules of the release acceptance methodology (docs/live-testing.md, "Release acceptance
 * on live providers") for every active row of scripts/live-matrix.json that a `--suite` selects.
 *
 *   bun scripts/live-preflight.mjs --suite providers/
 *   bun scripts/live-preflight.mjs --suite release/ --probe
 *   bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity
 *
 * Checks, one output row each:
 * - the env file (PRISM_LIVE_ENV_FILE, else ~/.config/prism/live.env) exists, is a regular file, has
 *   mode 0600 or stricter, and is outside the repository or ignored by git;
 * - every `requires` variable (and one of each `requiresAny` group) is present, reported by name;
 * - no present credential value occurs in a tracked file (`git grep`, patterns on stdin, never argv);
 * - per-row prerequisites: `pi` and its provider extensions for release/cache-parity, the LiteLLM
 *   pool's rendered compose file (scripts/litellm/up.mjs) for providers/litellm;
 * - with `--probe`, one discovery or reachability request per provider, made through the provider
 *   package's own function, so the request path is the shipped one. No generation request is made,
 *   except Jev and hosted Liquid, whose cheapest authenticated call is one single-question decide.
 *
 * Exit 0 only when every check passes; exit 2 on any failure or bad usage. Output never contains a
 * variable's value: details name variables only, and every printed row is scrubbed of the values.
 * Every check is a pure function of injected env/fs/exec/fetch, so the tests run offline.
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { loadMatrix, parseEnvFile, REPO_ROOT } from "./live-matrix.mjs";

/** Variable names whose values are credentials: scanned in git and scrubbed from output. */
const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)$/;
/** Shorter values are flags or ports, not credentials; `git grep` on them only finds noise. */
const MIN_SECRET_LENGTH = 8;
const PROBE_TIMEOUT_MS = 15_000;
const DECIDE_PROBE = {
  state: "Prism live pre-flight check.",
  questions: { ready: { type: "noul", instructions: "Is this a connectivity check?" } },
};

/**
 * Probes, one per provider, selected when a chosen row requires the probe's `trigger` variable.
 * `run(ctx)` returns a short detail string or throws; `ctx.load(specifier)` imports the package.
 */
export const PROBES = [
  catalogProbe("hyper", "HYPER_API_KEY", "@arnilo/prism-provider-hyper", "listHyperModels", { publicCatalog: true }),
  catalogProbe("opencode-go", "OPENCODE_GO_API_KEY", "@arnilo/prism-provider-opencode-go", "listOpenCodeGoModels"),
  catalogProbe("openrouter", "OPENROUTER_API_KEY", "@arnilo/prism-provider-openrouter", "listOpenRouterModels", {
    publicCatalog: true,
  }),
  catalogProbe("kilo", "KILO_API_KEY", "@arnilo/prism-provider-kilo", "listKiloModels", { publicCatalog: true }),
  catalogProbe("litellm", "LITELLM_API_KEY", "@arnilo/prism-provider-litellm", "listLiteLLMModels", {
    baseUrlEnv: "PRISM_LIVE_LITELLM_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:4000",
  }),
  catalogProbe("commandcode", "COMMAND_CODE_API_KEY", "@arnilo/prism-provider-commandcode", "listCommandCodeModels"),
  catalogProbe("ollama-cloud", "OLLAMA_API_KEY", "@arnilo/prism-provider-ollama-cloud", "listOllamaCloudModels"),
  decideProbe(
    "typesafe",
    "TYPESAFE_API_KEY",
    "@arnilo/prism-provider-typesafe",
    "createTypeSafeProvider",
    () => "jev-latest",
    "PRISM_LIVE_TYPESAFE_MODEL",
  ),
  decideProbe("liquid", "LIQUID_API_KEY", "@arnilo/prism-provider-liquid", "createLiquidProvider", (env) =>
    (env.PRISM_LIVE_LIQUID_MODELS ?? "d1.1").split(",")[0].trim(),
  ),
  {
    id: "laya",
    trigger: "PRISM_LIVE_LAYA",
    label: (env) => `probe laya (${env.LAYA_BASE_URL ?? "http://localhost:8000"})`,
    async run(ctx) {
      // The suite's own reachability check (src/testing), so the probe and the T1 row agree.
      const { checkLayaServerReachable } = await ctx.load("@arnilo/prism/testing");
      const { LAYA_DEFAULT_BASE_URL } = await ctx.load("@arnilo/prism-provider-laya");
      const result = await withFetch(ctx.fetch, () => checkLayaServerReachable(ctx.env.LAYA_BASE_URL ?? LAYA_DEFAULT_BASE_URL));
      if (!result.reachable) throw new Error(result.reason ?? "laya-serve is not reachable");
      return "reachable";
    },
  },
  {
    id: "liquid-local",
    trigger: "PRISM_LIVE_LLAMA_SERVER_URL",
    label: (env) => `probe liquid-local (${env.PRISM_LIVE_LLAMA_SERVER_URL})`,
    async run(ctx) {
      // llama-server answers /health with 200 once the model is loaded (the suite's own check).
      const response = await ctx.fetch(`${ctx.env.PRISM_LIVE_LLAMA_SERVER_URL.replace(/\/+$/, "")}/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`llama-server answered ${response.status}`);
      return "reachable";
    },
  },
];

function catalogProbe(id, trigger, specifier, fn, { publicCatalog = false, baseUrlEnv, defaultBaseUrl } = {}) {
  return {
    id,
    trigger,
    label: () => `probe ${id} (GET /models)`,
    async run(ctx) {
      const list = (await ctx.load(specifier))[fn];
      const models = await list({
        apiKey: async () => ctx.env[trigger],
        fetch: ctx.fetch,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        ...(baseUrlEnv ? { baseUrl: ctx.env[baseUrlEnv] ?? defaultBaseUrl } : {}),
      });
      // A public catalog answers without a key, so success there proves catalog readiness only.
      return `${models.length} models${publicCatalog ? " (public catalog; key not validated)" : ""}`;
    },
  };
}

function decideProbe(id, trigger, specifier, factory, defaultModel, modelEnv) {
  return {
    id,
    trigger,
    label: () => `probe ${id} (one decide call)`,
    async run(ctx) {
      const create = (await ctx.load(specifier))[factory];
      const provider = create({ apiKey: async () => ctx.env[trigger], fetch: ctx.fetch, maxRetries: 0 });
      const model = (modelEnv && ctx.env[modelEnv]) || defaultModel(ctx.env);
      const result = await provider.decisions().decide({ model, ...DECIDE_PROBE, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return `answered (${result.model ?? model})`;
    },
  };
}

/** `checkLayaServerReachable` reads the global fetch; the injected one stands in for the call. */
async function withFetch(fetchImpl, fn) {
  if (fetchImpl === globalThis.fetch) return fn();
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Active rows whose id equals, or starts with, any selector. */
export function selectSuites(matrix, selectors) {
  return matrix.suites.filter((suite) => suite.status === "active" && selectors.some((s) => suite.id === s || suite.id.startsWith(s)));
}

export function defaultEnvFile(env) {
  return env.PRISM_LIVE_ENV_FILE ?? join(env.HOME ?? homedir(), ".config", "prism", "live.env");
}

const defaultFs = {
  stat: (path) => statSync(path),
  exists: (path) => existsSync(path),
  realpath: (path) => realpathSync(path),
  parseEnvFile: (path) => parseEnvFile(path),
};

function defaultExec(command, args, { input, cwd } = {}) {
  const result = spawnSync(command, args, { cwd, input, encoding: "utf8", timeout: 30_000 });
  return { status: result.error ? null : result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Env-file checks. Returns `{ rows, fileEnv }`; `fileEnv` is `{}` when the file cannot be used. */
export function checkEnvFile({ path, repoRoot, fs = defaultFs, exec = defaultExec }) {
  const rows = [];
  let stat;
  try {
    stat = fs.stat(path);
  } catch {
    rows.push(fail("env file exists", `${path} not found (set PRISM_LIVE_ENV_FILE)`));
    return { rows, fileEnv: {} };
  }
  if (!stat.isFile()) {
    rows.push(fail("env file exists", `${path} is not a regular file`));
    return { rows, fileEnv: {} };
  }
  rows.push(pass("env file exists", path));
  const mode = stat.mode & 0o777;
  const modeText = mode.toString(8).padStart(4, "0");
  rows.push((mode & 0o077) === 0 ? pass("env file mode", modeText) : fail("env file mode", `${modeText}; run chmod 600 ${path}`));

  const real = safeRealpath(fs, path);
  const rel = relative(repoRoot, real);
  if (rel.startsWith("..") || isAbsolute(rel)) rows.push(pass("env file outside repo", path));
  else if (exec("git", ["check-ignore", "-q", "--", rel], { cwd: repoRoot }).status === 0)
    rows.push(pass("env file outside repo", `inside the repo, ignored by git (${rel})`));
  else rows.push(fail("env file outside repo", `${rel} is inside the repo and not ignored by git`));

  try {
    return { rows, fileEnv: fs.parseEnvFile(path) };
  } catch (error) {
    // parseEnvFile names the path and line only, never the line's content.
    rows.push(fail("env file parses", error.message));
    return { rows, fileEnv: {} };
  }
}

function safeRealpath(fs, path) {
  try {
    return fs.realpath(path);
  } catch {
    return path;
  }
}

/** One row per required variable and per `requiresAny` group, named, never valued. */
export function checkVariables(suites, env) {
  const rows = [];
  const required = [...new Set(suites.flatMap((suite) => suite.requires ?? []))];
  for (const name of required)
    rows.push(env[name] ? pass(`${name} present`, "(value hidden)") : fail(`${name} present`, `missing (${rowsNeeding(suites, name)})`));
  const groups = new Map();
  for (const suite of suites) if (suite.requiresAny?.length) groups.set(suite.requiresAny.join(", "), suite.requiresAny);
  for (const [label, names] of groups) {
    const found = names.filter((name) => env[name]);
    rows.push(found.length ? pass(`one of ${label} present`, found.join(", ")) : fail(`one of ${label} present`, "none set"));
  }
  return rows;
}

function rowsNeeding(suites, name) {
  return suites
    .filter((suite) => suite.requires?.includes(name))
    .map((suite) => suite.id)
    .join(", ");
}

/** Credential values of the selected rows that are long enough to be secrets. */
export function secretValues(suites, env) {
  const names = new Set(suites.flatMap((suite) => [...(suite.requires ?? []), ...(suite.requiresAny ?? []), ...(suite.optional ?? [])]));
  const out = [];
  for (const name of names)
    if (SECRET_NAME.test(name) && (env[name] ?? "").length >= MIN_SECRET_LENGTH) out.push({ name, value: env[name] });
  return out;
}

/** `git grep -F -f -` per credential: the value goes to git on stdin, never in argv. */
export function checkCommittedKeys(secrets, { repoRoot, exec = defaultExec }) {
  const hits = [];
  for (const { name, value } of secrets) {
    const result = exec("git", ["grep", "-l", "-F", "-f", "-"], { cwd: repoRoot, input: `${value}\n` });
    if (result.status === 0) hits.push(`${name} in ${result.stdout.trim().split("\n").join(", ")}`);
    else if (result.status !== 1) return [fail("keys not committed", "git grep could not run")];
  }
  if (hits.length) return [fail("keys not committed", hits.join("; "))];
  return [pass("keys not committed", secrets.length ? `${secrets.length} checked` : "no credential values to check")];
}

/** Per-row prerequisites that are not env variables: binaries and started services. */
export async function checkPrerequisites(suites, { env, fs = defaultFs, exec = defaultExec, load = defaultLoad }) {
  const rows = [];
  const ids = new Set(suites.map((suite) => suite.id));
  if (ids.has("release/cache-parity")) {
    const version = exec("pi", ["--version"]);
    if (version.status !== 0) rows.push(fail("pi on PATH", "pi is not on PATH"));
    else {
      rows.push(pass("pi on PATH", `pi ${version.stdout.trim().split("\n")[0]}`));
      // The cache-parity row's own preflight: one pi extension per enabled cell's provider.
      const { preflight, CELLS } = await load(pathToFileURL(join(REPO_ROOT, "scripts/cache-parity/live.mjs")).href);
      const piHome = env.PI_CODING_AGENT_DIR ?? join(env.HOME ?? homedir(), ".pi", "agent");
      const ready = preflight({ piHome, which: () => true, exists: fs.exists, cells: CELLS });
      const providers = [...new Set(CELLS.map((cell) => cell.provider))].join(", ");
      rows.push(ready.ok ? pass("pi providers ready", providers) : fail("pi providers ready", ready.reason));
    }
  }
  if (ids.has("providers/litellm")) {
    const { scratchDir } = await load(pathToFileURL(join(REPO_ROOT, "scripts/litellm/up.mjs")).href);
    const composeFile = join(scratchDir(), "compose.yaml");
    rows.push(
      fs.exists(composeFile)
        ? pass("litellm pool started", "scripts/litellm/up.mjs has rendered the pool")
        : fail("litellm pool started", "run bun scripts/litellm/up.mjs --write-key"),
    );
  }
  return rows;
}

/** One request per provider whose trigger variable a selected row requires. */
export async function runProbes(suites, { env, fetch: fetchImpl = globalThis.fetch, load = defaultLoad, probes = PROBES }) {
  const needed = new Set(suites.flatMap((suite) => [...(suite.requires ?? []), ...(suite.requiresAny ?? [])]));
  const rows = [];
  for (const probe of probes) {
    if (!needed.has(probe.trigger)) continue;
    const label = probe.label(env);
    if (!env[probe.trigger]) {
      rows.push(fail(label, `skipped: ${probe.trigger} missing`));
      continue;
    }
    try {
      rows.push(pass(label, await probe.run({ env, fetch: fetchImpl, load })));
    } catch (error) {
      rows.push(fail(label, `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`));
    }
  }
  return rows;
}

function defaultLoad(specifier) {
  return import(specifier);
}

/**
 * The whole pre-flight. Returns `{ ok, rows, suites }`; rows are already scrubbed of every
 * credential value the run knows about.
 */
export async function runPreflight({
  selectors,
  probe = false,
  matrix = loadMatrix(),
  env = process.env,
  repoRoot = REPO_ROOT,
  fs = defaultFs,
  exec = defaultExec,
  fetch: fetchImpl = globalThis.fetch,
  load = defaultLoad,
  probes = PROBES,
}) {
  const suites = selectSuites(matrix, selectors);
  if (suites.length === 0) {
    return { ok: false, suites, rows: [fail("suite selection", `no active row matches ${selectors.join(", ")}`)] };
  }
  const envFile = checkEnvFile({ path: defaultEnvFile(env), repoRoot, fs, exec });
  const merged = { ...envFile.fileEnv, ...env };
  const secrets = secretValues(suites, merged);
  const rows = [
    pass("suites selected", suites.map((suite) => suite.id).join(", ")),
    ...envFile.rows,
    ...checkVariables(suites, merged),
    ...checkCommittedKeys(secrets, { repoRoot, exec }),
    ...(await checkPrerequisites(suites, { env: merged, fs, exec, load })),
    ...(probe ? await runProbes(suites, { env: merged, fetch: fetchImpl, load, probes }) : []),
  ];
  const scrubbed = rows.map((row) => ({ ...row, detail: scrub(row.detail, secrets) }));
  return { ok: scrubbed.every((row) => row.status === "pass"), rows: scrubbed, suites };
}

function scrub(text, secrets) {
  let out = String(text ?? "");
  for (const { value } of secrets) out = out.split(value).join("[redacted]");
  return out;
}

function pass(check, detail = "") {
  return { check, status: "pass", detail };
}

function fail(check, detail = "") {
  return { check, status: "fail", detail };
}

export function formatRows(rows) {
  const width = Math.max(5, ...rows.map((row) => row.check.length)) + 2;
  const lines = [`${"check".padEnd(width)}status  detail`];
  for (const row of rows) lines.push(`${row.check.padEnd(width)}${row.status.padEnd(8)}${row.detail}`.trimEnd());
  return lines.join("\n");
}

export function parseArgs(argv) {
  const selectors = [];
  let probe = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--probe") probe = true;
    else if (arg === "--suite") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--suite needs a row id or id prefix");
      selectors.push(value);
    } else if (arg.startsWith("--suite=")) selectors.push(arg.slice("--suite=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (selectors.length === 0) throw new Error("at least one --suite <id-or-prefix> is required");
  return { selectors, probe };
}

const USAGE = "usage: bun scripts/live-preflight.mjs --suite <id-or-prefix> [--suite …] [--probe]";

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error, ...deps } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    error(`live-preflight: ${err.message}\n${USAGE}`);
    return 2;
  }
  const result = await runPreflight({ ...deps, ...args });
  log(formatRows(result.rows));
  const failed = result.rows.filter((row) => row.status !== "pass").length;
  log(
    `\n${failed === 0 ? "pre-flight passed" : `pre-flight FAILED: ${failed} check(s)`}${args.probe ? "" : " (no network; add --probe for one request per provider)"}`,
  );
  return failed === 0 ? 0 : 2;
}

if (import.meta.main) process.exitCode = await main();
