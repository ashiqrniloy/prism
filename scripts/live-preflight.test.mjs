/**
 * Live pre-flight check (plan 215 Task 31). Hermetic: fs, exec and fetch are injected, so no
 * network, no git, and no pi are needed. Registered in the root `bun run test` chain.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadMatrix, REPO_ROOT } from "./live-matrix.mjs";
import { main, PROBES, runPreflight, selectSuites } from "./live-preflight.mjs";

const HOME = "/home/operator";
const ENV_FILE = join(HOME, ".config/prism/live.env");
const FAKE = {
  HYPER_API_KEY: "hyper-fake-key-0123456789",
  OPENCODE_GO_API_KEY: "ocg-fake-key-0123456789",
  OPENROUTER_API_KEY: "or-fake-key-0123456789",
  KILO_API_KEY: "kilo-fake-key-0123456789",
  LITELLM_API_KEY: "litellm-fake-key-0123456789",
  COMMAND_CODE_API_KEY: "cc-fake-key-0123456789",
  OLLAMA_API_KEY: "ollama-fake-key-0123456789",
  TYPESAFE_API_KEY: "typesafe-fake-key-0123456789",
  LIQUID_API_KEY: "liquid-fake-key-0123456789",
};
const FLAGS = {
  PRISM_LIVE_PROVIDER_TESTS: "1",
  PRISM_LIVE_CACHE_PARITY: "1",
  PRISM_LIVE_LAYA: "1",
  PRISM_LIVE_LLAMA_SERVER_URL: "http://127.0.0.1:8080",
  PRISM_TEST_KEYCHAIN: "1",
};

const matrix = {
  schemaVersion: 1,
  suites: [
    { id: "providers/hyper", status: "active", requires: ["PRISM_LIVE_PROVIDER_TESTS", "HYPER_API_KEY"] },
    { id: "providers/openrouter", status: "active", requires: ["PRISM_LIVE_PROVIDER_TESTS", "OPENROUTER_API_KEY"] },
    { id: "release/cache-parity", status: "active", requires: ["PRISM_LIVE_CACHE_PARITY", "COMMAND_CODE_API_KEY", "OLLAMA_API_KEY"] },
    { id: "release/planned", status: "planned", requires: ["NEVER_SET"] },
  ],
};

function fakeFs({ mode = 0o100600, isFile = true, exists = true, fileEnv = { ...FAKE, ...FLAGS }, present = () => true } = {}) {
  return {
    stat(path) {
      if (!exists || path !== ENV_FILE) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { mode, isFile: () => isFile };
    },
    exists: present,
    realpath: (path) => path,
    parseEnvFile: () => fileEnv,
  };
}

function fakeExec({ committed = [], ignored = false, pi = true } = {}) {
  const calls = [];
  const exec = (command, args, opts = {}) => {
    calls.push({ command, args, input: opts.input });
    if (command === "pi") return pi ? { status: 0, stdout: "1.5.0\n", stderr: "" } : { status: null, stdout: "", stderr: "" };
    if (args[0] === "check-ignore") return { status: ignored ? 0 : 1, stdout: "", stderr: "" };
    if (args[0] === "grep") {
      const hit = committed.find((value) => opts.input.includes(value));
      return hit ? { status: 0, stdout: "docs/leaked.md\n", stderr: "" } : { status: 1, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected exec ${command} ${args.join(" ")}`);
  };
  exec.calls = calls;
  return exec;
}

const noNetwork = () => {
  throw new Error("network used without --probe");
};

function run(overrides = {}) {
  return runPreflight({
    selectors: ["providers/", "release/"],
    matrix,
    env: { HOME },
    repoRoot: REPO_ROOT,
    fs: fakeFs(),
    exec: fakeExec(),
    fetch: noNetwork,
    ...overrides,
  });
}

const row = (result, check) => result.rows.find((r) => r.check === check);

test("preflight passes on a complete, private, uncommitted setup (no network)", async () => {
  const result = await run();
  assert.equal(result.ok, true, JSON.stringify(result.rows, null, 2));
  assert.equal(row(result, "pi providers ready").detail, "commandcode, ollama-cloud");
});

test("preflight_rejects_world_readable_env_file", async () => {
  const result = await run({ fs: fakeFs({ mode: 0o100644 }) });
  assert.equal(result.ok, false);
  assert.equal(row(result, "env file mode").status, "fail");
  assert.match(row(result, "env file mode").detail, /0644/);
  const notFile = await run({ fs: fakeFs({ isFile: false }) });
  assert.equal(row(notFile, "env file exists").status, "fail");
  const missing = await run({ fs: fakeFs({ exists: false }) });
  assert.equal(row(missing, "env file exists").status, "fail");
});

test("preflight_rejects_tracked_env_file", async () => {
  const inside = join(REPO_ROOT, "live.env");
  const fs = { ...fakeFs(), stat: () => ({ mode: 0o100600, isFile: () => true }) };
  const tracked = await run({ env: { HOME, PRISM_LIVE_ENV_FILE: inside }, fs });
  assert.equal(row(tracked, "env file outside repo").status, "fail");
  assert.equal(tracked.ok, false);
  const ignored = await run({ env: { HOME, PRISM_LIVE_ENV_FILE: inside }, fs, exec: fakeExec({ ignored: true }) });
  assert.equal(row(ignored, "env file outside repo").status, "pass");
  assert.match(row(ignored, "env file outside repo").detail, /ignored by git/);
});

test("preflight_reports_missing_vars_by_name", async () => {
  const { HYPER_API_KEY: _omit, ...rest } = { ...FAKE, ...FLAGS };
  const result = await run({ fs: fakeFs({ fileEnv: rest }) });
  assert.equal(result.ok, false);
  const missing = row(result, "HYPER_API_KEY present");
  assert.equal(missing.status, "fail");
  assert.match(missing.detail, /providers\/hyper/);
  assert.equal(row(result, "OPENROUTER_API_KEY present").status, "pass");
});

test("preflight_detects_committed_key", async () => {
  const exec = fakeExec({ committed: [FAKE.OLLAMA_API_KEY] });
  const result = await run({ exec });
  const committed = row(result, "keys not committed");
  assert.equal(committed.status, "fail");
  assert.match(committed.detail, /OLLAMA_API_KEY in docs\/leaked\.md/);
  // The value reaches git on stdin only, never in argv.
  for (const call of exec.calls) for (const value of Object.values(FAKE)) assert.ok(!call.args.join(" ").includes(value));
  assert.ok(exec.calls.some((call) => call.args[0] === "grep" && call.input === `${FAKE.OLLAMA_API_KEY}\n`));
});

test("preflight_never_prints_values", async () => {
  const selectors = ["--suite", "providers/", "--suite", "release/", "--probe"];
  // A probe that echoes the key in its error and a committed key: the worst cases for leaks.
  const leakyFetch = async (url, init) => {
    throw new Error(`refused ${url} with ${init?.headers ? JSON.stringify(init.headers) : ""} ${Object.values(FAKE).join(" ")}`);
  };
  let out = "";
  const code = await main(selectors, {
    log: (text) => {
      out += `${text}\n`;
    },
    error: (text) => {
      out += `${text}\n`;
    },
    matrix: loadMatrix(),
    env: { HOME, ...FAKE },
    fs: fakeFs({ mode: 0o100644 }),
    exec: fakeExec({ committed: [FAKE.HYPER_API_KEY] }),
    fetch: leakyFetch,
  });
  assert.equal(code, 2);
  assert.ok(out.includes("[redacted]"), "the leaky probe errors must reach the scrubber");
  for (const [name, value] of Object.entries(FAKE)) assert.ok(!out.includes(value), `${name}'s value leaked into output`);
});

test("preflight_probe_uses_provider_package", async () => {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(input instanceof Request ? input.headers : init.headers);
    requests.push({ url, method: (input instanceof Request ? input.method : init.method) ?? "GET", auth: headers.get("authorization") });
    if (url.includes("/systemone"))
      return Response.json({
        model: "jev-latest",
        answers: { ready: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 8, output_tokens: 0 },
      });
    if (url.endsWith("/health")) return new Response("ok");
    if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "gemma4:31b", model: "gemma4:31b" }] });
    if (url.endsWith("/model/info")) return Response.json({ data: [] });
    return Response.json({ data: [{ id: "m-1", object: "model" }] });
  };
  const full = loadMatrix();
  const result = await runPreflight({
    selectors: ["providers/"],
    probe: true,
    matrix: full,
    env: { HOME },
    fs: fakeFs(),
    exec: fakeExec(),
    fetch: fetchImpl,
  });
  const probes = result.rows.filter((r) => r.check.startsWith("probe "));
  const ids = probes.map((r) => r.check.split(" ")[1]);
  for (const id of [
    "hyper",
    "opencode-go",
    "openrouter",
    "kilo",
    "litellm",
    "commandcode",
    "ollama-cloud",
    "typesafe",
    "liquid",
    "laya",
    "liquid-local",
  ])
    assert.ok(ids.includes(id), `probe ${id} missing: ${ids.join(", ")}`);
  for (const probe of probes) assert.equal(probe.status, "pass", `${probe.check}: ${probe.detail}`);

  // OpenRouter goes through listOpenRouterModels: one GET to the package's catalog URL, and the
  // detail never claims the public catalog validated the key.
  const openrouter = requests.filter((r) => r.url.startsWith("https://openrouter.ai/api/v1/"));
  assert.deepEqual(
    openrouter.map((r) => `${r.method} ${r.url}`),
    ["GET https://openrouter.ai/api/v1/models"],
  );
  assert.match(row(result, "probe openrouter (GET /models)").detail, /key not validated/);
  assert.ok(requests.some((r) => r.url === "https://hyper.charm.land/v1/models"));
  assert.ok(requests.some((r) => r.url === "https://opencode.ai/zen/go/v1/models"));
  assert.ok(requests.some((r) => r.url.startsWith("https://ai-gateway.kilo.ai/api/v1/models")));
  assert.ok(requests.some((r) => r.url === "http://127.0.0.1:4000/model/info"));
  assert.ok(requests.some((r) => r.url === "https://api.typesafe.ai/v1/systemone" && r.auth === `Bearer ${FAKE.TYPESAFE_API_KEY}`));
  assert.ok(requests.some((r) => r.url === "https://api.liquid.ai/decisions/v1/systemone"));
  assert.ok(requests.some((r) => r.url === "http://localhost:8000/v1/systemone"));
  assert.ok(requests.some((r) => r.url === "http://127.0.0.1:8080/health"));
  // No generation request: nothing but catalogs, decide calls, and reachability probes.
  for (const r of requests) assert.ok(!/chat\/completions|\/responses|\/messages|\/api\/chat/.test(r.url), r.url);
  // One probe per provider, even when several rows (liquid + liquid-local) share a package.
  assert.equal(new Set(ids).size, ids.length);
});

test("preflight_prefix_selects_all_release_rows", () => {
  const full = loadMatrix();
  const release = selectSuites(full, ["release/"]).map((s) => s.id);
  const expected = full.suites.filter((s) => s.status === "active" && s.id.startsWith("release/")).map((s) => s.id);
  assert.deepEqual(release, expected);
  assert.ok(release.includes("release/cache-parity"));
  const providers = selectSuites(full, ["providers/"]).map((s) => s.id);
  for (const id of ["providers/openrouter", "providers/kilo", "providers/litellm"]) assert.ok(providers.includes(id), id);
  assert.deepEqual(
    selectSuites(full, ["release/cache-parity"]).map((s) => s.id),
    ["release/cache-parity"],
  );
  // Every trigger variable a probe uses is a real manifest requirement, so no probe is dead.
  const required = new Set(full.suites.flatMap((s) => s.requires ?? []));
  for (const probe of PROBES) assert.ok(required.has(probe.trigger), `${probe.id}: ${probe.trigger}`);
});

test("preflight_reports_missing_binary", async () => {
  const result = await run({ exec: fakeExec({ pi: false }) });
  assert.equal(result.ok, false);
  assert.equal(row(result, "pi on PATH").status, "fail");
  const litellm = await runPreflight({
    selectors: ["providers/litellm"],
    matrix: loadMatrix(),
    env: { HOME },
    fs: fakeFs({ present: (path) => !path.endsWith("compose.yaml") }),
    exec: fakeExec(),
    fetch: noNetwork,
  });
  assert.equal(row(litellm, "litellm pool started").status, "fail");
  assert.match(row(litellm, "litellm pool started").detail, /scripts\/litellm\/up\.mjs/);
});

test("preflight_reports_pi_provider_not_ready", async () => {
  const result = await run({ fs: fakeFs({ present: (path) => !path.includes("pi-ollama-cloud") }) });
  assert.equal(result.ok, false);
  assert.equal(row(result, "pi on PATH").status, "pass");
  assert.equal(row(result, "pi providers ready").status, "fail");
  assert.match(row(result, "pi providers ready").detail, /pi-ollama-cloud/);
});

test("preflight exits 2 on bad usage and on an unmatched suite", async () => {
  const quiet = { log: () => {}, error: () => {} };
  assert.equal(await main([], quiet), 2);
  assert.equal(await main(["--suite"], quiet), 2);
  assert.equal(await main(["--bogus"], quiet), 2);
  assert.equal(
    await main(["--suite", "nothing/"], { ...quiet, matrix, env: { HOME }, fs: fakeFs(), exec: fakeExec(), fetch: noNetwork }),
    2,
  );
});
