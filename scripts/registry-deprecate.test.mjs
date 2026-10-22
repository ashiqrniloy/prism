// scripts/registry-deprecate.test.mjs
// Plan 175 Task 8: offline fixture suite for the registry deprecation tool. `fetch` is injected
// through createRegistryDeprecator, so no test touches the network, and the one CLI test serves a
// fixture registry from 127.0.0.1 (PRISM_DEPRECATE_REGISTRY) to exercise the env wiring.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistryDeprecator, escapedName, main, versionInRange } from "./registry-deprecate.mjs";

const ANCHOR = "#012-family-package-native-package-map";
const GUIDE_URL = "https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md";
const TOKEN = "npm_s3cr3t_do_not_log_7f2c";

function mkdtemp() {
  return mkdtempSync(join(tmpdir(), "prism-deprecate-"));
}

/** A packument with one `deprecated` value per version that carries one. */
function packument(name, versions, latest, deprecated = {}) {
  return {
    name,
    _rev: "1-fixture",
    "dist-tags": { latest },
    versions: Object.fromEntries(versions.map((v) => [v, deprecated[v] === undefined ? {} : { deprecated: deprecated[v] }])),
  };
}

function makeList(dir, names) {
  const path = join(dir, "deprecations.json");
  writeFileSync(
    path,
    JSON.stringify({
      $comment: "fixture",
      guide: "docs/migrate-to-0.13.md",
      registry: "https://registry.npmjs.org",
      names: names.map((name) => ({
        name,
        range: "<0.13.0",
        reused: true,
        successor: `${name}@0.13.0`,
        anchor: ANCHOR,
        message: `Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: ${name}@0.13.0. ${GUIDE_URL}${ANCHOR}`,
      })),
    }),
    null,
    2,
  );
  return path;
}

/** A stub registry: GET returns a clone, PUT stores the body the client sent. */
function makeRegistry(state) {
  const calls = { get: [], put: [] };
  const fetchImpl = async (url, init = {}) => {
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET") {
      calls.get.push({ name, headers: init.headers ?? {} });
      const found = state[name];
      if (!found) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => structuredClone(found) };
    }
    calls.put.push({ name, headers: init.headers ?? {}, body: JSON.parse(init.body) });
    if (!state[name]) return { ok: false, status: 404 };
    state[name] = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { fetchImpl, calls };
}

function makeDeprecator({ dir, state, token = TOKEN }) {
  const { fetchImpl, calls } = makeRegistry(state);
  const out = [];
  const err = [];
  const deprecator = createRegistryDeprecator({
    rootDir: dir,
    registry: "https://fixture.invalid",
    token,
    fetchImpl,
    listPath: makeList(dir, Object.keys(state)),
    planPath: join(dir, "deprecation-plan.json"),
    guidePath: join(import.meta.dirname, "..", "docs", "migrate-to-0.13.md"),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { deprecator, calls, out, err };
}

test("deprecate_plan_scopes_reused_names: a reused name deprecates only the pre-0.13 line", async () => {
  const dir = mkdtemp();
  const state = {
    "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.3.0", "0.12.0", "0.12.1", "0.13.0"], "0.13.0"),
  };
  const { deprecator, calls } = makeDeprecator({ dir, state });

  const plan = await deprecator.generate();
  assert.deepEqual(plan[0].deprecateVersions, ["0.3.0", "0.12.0", "0.12.1"], "only the pre-0.13 line is targeted");
  assert.equal(plan[0].range, "<0.13.0");
  assert.equal(plan[0].latest, "0.13.0");
  assert.equal(calls.get[0].headers.authorization, undefined, "generate is anonymous");

  const code = await deprecator.apply({ entries: plan });
  assert.equal(code, 0, "apply succeeds");
  assert.equal(calls.put.length, 1, "one PUT");
  const body = calls.put[0].body;
  for (const version of ["0.3.0", "0.12.0", "0.12.1"]) {
    assert.equal(body.versions[version].deprecated, plan[0].message, `${version} is deprecated`);
  }
  assert.equal(body.versions["0.13.0"].deprecated, undefined, "the 0.13.0 line is untouched");
});

test("apply_refuses_when_latest_in_range: zero PUTs, and the error names the package", async () => {
  const dir = mkdtemp();
  const state = {
    "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.12.1"),
  };
  const { deprecator, calls, err } = makeDeprecator({ dir, state });
  const plan = await deprecator.generate();

  const code = await deprecator.apply({ entries: plan });
  assert.equal(code, 1, "apply fails closed");
  assert.equal(calls.put.length, 0, "zero PUTs on a mismatch");
  assert.ok(
    err.some((line) => line.includes("@arnilo/prism-mcp") && line.includes("latest 0.12.1 is inside")),
    `the report names the package and the reason: ${err.join("\n")}`,
  );
});

test("apply_refuses_when_a_reused_name_has_no_0_13_published", async () => {
  const dir = mkdtemp();
  const state = {
    "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.11.1", "0.12.1"], "0.12.1"),
  };
  const { deprecator, calls, err } = makeDeprecator({ dir, state });
  const plan = await deprecator.generate();

  const code = await deprecator.apply({ entries: plan });
  assert.equal(code, 1, "apply fails closed");
  assert.equal(calls.put.length, 0, "zero PUTs");
  assert.ok(
    err.some((line) => line.includes("@arnilo/prism-mcp") && line.includes("0.13.0 is not published yet")),
    `the report names the missing line: ${err.join("\n")}`,
  );
});

test("apply_refuses_on_registry_state_drift", async () => {
  const dir = mkdtemp();
  const state = { "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0") };
  const { deprecator, calls, err } = makeDeprecator({ dir, state });
  const plan = await deprecator.generate();
  // A release lands after the plan was generated.
  state["@arnilo/prism-mcp"].versions["0.13.1"] = {};

  const code = await deprecator.apply({ entries: plan });
  assert.equal(code, 1, "apply fails closed");
  assert.equal(calls.put.length, 0, "zero PUTs");
  assert.ok(
    err.some((line) => line.includes("registry state differs from the generated plan")),
    `the report names the drift: ${err.join("\n")}`,
  );
});

test("apply_skips_already_deprecated: idempotent resume", async () => {
  const dir = mkdtemp();
  const message = `Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-mcp@0.13.0. ${GUIDE_URL}${ANCHOR}`;
  const state = {
    "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0", { "0.12.1": message }),
  };
  const { deprecator, calls } = makeDeprecator({ dir, state });
  const plan = await deprecator.generate();
  assert.deepEqual(plan[0].deprecateVersions, ["0.12.1"]);

  const code = await deprecator.apply({ entries: plan });
  assert.equal(code, 0, "resume succeeds");
  assert.equal(calls.put.length, 0, "an already-deprecated entry issues no PUT");
  const written = JSON.parse(readFileSync(join(dir, "deprecation-plan.json"), "utf8"));
  assert.equal(written.summary.skipped, 1);
  assert.equal(written.summary.applied, 0);
});

test("apply_refuses_without_a_token and never writes one to the plan", async () => {
  const dir = mkdtemp();
  const state = { "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0") };
  const { deprecator, calls, err } = makeDeprecator({ dir, state, token: "" });
  const plan = await deprecator.generate();

  const code = await deprecator.apply({ entries: plan });
  assert.equal(code, 2, "a missing token is a usage error");
  assert.equal(calls.put.length, 0, "zero PUTs");
  assert.ok(
    err.some((line) => line.includes("NPM_TOKEN is required")),
    err.join("\n"),
  );
});

test("apply_never_logs_token: stdout, stderr, and the plan file carry no token", async () => {
  const dir = mkdtemp();
  const state = { "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0") };
  const { deprecator, out, err, calls } = makeDeprecator({ dir, state });
  const plan = await deprecator.generate();
  const code = await deprecator.apply({ entries: plan });
  assert.equal(code, 0);

  const planText = readFileSync(join(dir, "deprecation-plan.json"), "utf8");
  for (const [label, text] of [
    ["stdout", out.join("\n")],
    ["stderr", err.join("\n")],
    ["plan", planText],
  ]) {
    assert.ok(!text.includes(TOKEN), `${label} must not contain the token`);
  }
  assert.equal(calls.put[0].headers.authorization, `Bearer ${TOKEN}`, "the token travels only in the request header");
});

test("versionInRange matches `*` everywhere and excludes the 0.13.0 line", () => {
  assert.equal(versionInRange("0.12.1", "*"), true);
  assert.equal(versionInRange("0.13.0-0", "*"), true, "`*` covers prereleases too");
  assert.equal(versionInRange("0.12.1", "<0.13.0"), true);
  assert.equal(versionInRange("0.13.0", "<0.13.0"), false);
  assert.equal(versionInRange("0.13.0-rc.1", "<0.13.0"), false, "the new line's prereleases stay untouched");
});

test("escapedName uses the registry path form npm builds", () => {
  assert.equal(escapedName("@arnilo/prism-mcp"), "@arnilo%2fprism-mcp");
  assert.equal(escapedName("plain"), "plain");
});

test("the CLI applies against a fixture registry through PRISM_DEPRECATE_REGISTRY", async () => {
  const dir = mkdtemp();
  const state = { "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0") };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
      if (request.method === "PUT") {
        state[name] = await request.json();
        return Response.json({ ok: true });
      }
      if (!state[name]) return new Response("not found", { status: 404 });
      return Response.json(state[name]);
    },
  });
  const listPath = makeList(dir, Object.keys(state));
  const planPath = join(dir, "deprecation-plan.json");
  const previous = { ...process.env };
  process.env.PRISM_DEPRECATE_REGISTRY = `http://127.0.0.1:${server.port}`;
  process.env.PRISM_DEPRECATE_LIST = listPath;
  process.env.PRISM_DEPRECATE_PLAN = planPath;
  process.env.NPM_TOKEN = TOKEN;
  try {
    assert.equal(await main(["--generate"]), 0);
    assert.equal(await main(["--dry-run"]), 0);
    assert.equal(await main(["--apply"]), 2, "apply without --confirm refuses");
    assert.equal(await main(["--apply", "--confirm"]), 0);
  } finally {
    server.stop(true);
    for (const key of ["PRISM_DEPRECATE_REGISTRY", "PRISM_DEPRECATE_LIST", "PRISM_DEPRECATE_PLAN", "NPM_TOKEN"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  const written = JSON.parse(readFileSync(planPath, "utf8"));
  assert.equal(written.summary.applied, 1);
  assert.equal(state["@arnilo/prism-mcp"].versions["0.12.1"].deprecated, written.entries[0].message);
  assert.equal(state["@arnilo/prism-mcp"].versions["0.13.0"].deprecated, undefined);
});
