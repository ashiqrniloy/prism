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

const ROOT = join(import.meta.dirname, "..");

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
    throw new Error(`unexpected ${method} ${name}: the deprecator mutates nothing`);
  };
  return { fetchImpl, calls };
}

function makeDeprecator({ dir, state }) {
  const { fetchImpl, calls } = makeRegistry(state);
  const out = [];
  const err = [];
  const deprecator = createRegistryDeprecator({
    rootDir: dir,
    registry: "https://fixture.invalid",
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
  assert.equal(calls.get[0].headers.accept, "application/json", "no credential header is ever built");

  const [command] = deprecator.commands(plan);
  assert.ok(command.startsWith(`npm deprecate '@arnilo/prism-mcp@<0.13.0' '`), command);
  assert.ok(command.includes(plan[0].message), "the printed command carries the migration message");
});

test("deprecate_treats_an_unpublished_name_as_done", async () => {
  const dir = mkdtemp();
  const state = {
    "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0"),
  };
  const { deprecator, out, err } = makeDeprecator({ dir, state });
  const listPath = join(dir, "deprecations.json");
  const list = JSON.parse(readFileSync(listPath, "utf8"));
  list.names.push({ ...list.names[0], name: "@arnilo/prism-deleted" });
  writeFileSync(listPath, JSON.stringify(list), "utf8");

  // Task 37 unpublished the legacy names, so absence is the finished state, not a problem.
  const plan = await deprecator.generate();
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ["@arnilo/prism-mcp"],
    "an absent name is left out of the plan",
  );
  assert.ok(
    out.some((line) => line.includes("unpublished: @arnilo/prism-deleted")),
    out.join("\n"),
  );

  // A plan generated before the cleanup still carries it; the dry run reports it as done.
  const stale = [...plan, { ...plan[0], name: "@arnilo/prism-deleted", latest: "0.12.1" }];
  const code = await deprecator.dryRun(stale);
  assert.equal(code, 0, "a 404 is not a failure");
  assert.ok(
    err.some((line) => line.includes("1 unpublished") && line.includes("0 problem(s)")),
    `the summary counts it as done: ${err.join("\n")}`,
  );
});

test("deprecate_commands_are_the_owner_run_lines", async () => {
  const dir = mkdtemp();
  const state = { "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0") };
  const { deprecator } = makeDeprecator({ dir, state });
  const plan = await deprecator.generate();
  assert.deepEqual(deprecator.commands(plan), [`npm deprecate '@arnilo/prism-mcp@<0.13.0' '${plan[0].message}'`]);
  assert.ok(!deprecator.commands(plan)[0].includes("--confirm"), "no mutation path is offered");
});

test("registry_deprecate_has_no_apply_path", async () => {
  const source = readFileSync(join(ROOT, "scripts/registry-deprecate.mjs"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const forbidden of ['method: "PUT"', "authorization", "NPM_TOKEN", "process.env.NPM_TOKEN", "writePackument"]) {
    assert.ok(!code.includes(forbidden), `registry-deprecate.mjs must not contain ${forbidden}`);
  }
  assert.match(source, /--apply\b.*not OIDC-capable/s, "the CLI tells the owner why --apply is gone");
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

test("the CLI plans and prints commands against a fixture registry through PRISM_DEPRECATE_REGISTRY", async () => {
  const dir = mkdtemp();
  const state = { "@arnilo/prism-mcp": packument("@arnilo/prism-mcp", ["0.12.1", "0.13.0"], "0.13.0") };
  const mutations = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (request.method !== "GET") {
        mutations.push(request.method);
        return Response.json({ ok: true });
      }
      const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
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
  const printed = [];
  const originalLog = console.log;
  console.log = (line) => printed.push(String(line));
  try {
    assert.equal(await main(["--generate"]), 0);
    assert.equal(await main(["--dry-run"]), 0);
    assert.equal(await main(["--commands"]), 0);
    assert.equal(await main(["--apply", "--confirm"]), 2, "there is no apply path at all");
  } finally {
    console.log = originalLog;
    server.stop(true);
    for (const key of ["PRISM_DEPRECATE_REGISTRY", "PRISM_DEPRECATE_LIST", "PRISM_DEPRECATE_PLAN"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  assert.deepEqual(mutations, [], "the CLI never mutates the registry");
  const written = JSON.parse(readFileSync(planPath, "utf8"));
  assert.equal(written.summary.pending, 1);
  assert.equal(state["@arnilo/prism-mcp"].versions["0.12.1"].deprecated, undefined, "the registry state is untouched");
  assert.ok(
    printed.some((line) => line === `npm deprecate '@arnilo/prism-mcp@<0.13.0' '${written.entries[0].message}'`),
    printed.join("\n"),
  );
});
