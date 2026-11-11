// scripts/registry-cleanup.test.mjs
// Plan 215 Task 37: the cleanup plan is pure, ordered, policy-aware and never runs npm.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildPlan,
  classifyEntries,
  classifyName,
  createRegistryCleanup,
  ledgerRetiredNames,
  NEW_LINE_VERSION,
  renderPlan,
  renderTrustedPublishers,
  shippedNames,
} from "./registry-cleanup.mjs";

const ROOT = join(import.meta.dir, "..");

const RETIRED = {
  name: "@arnilo/prism-a",
  range: "*",
  reused: false,
  message: "Legacy 0.12 package. Prism 0.13+: @arnilo/prism.",
  successor: "@arnilo/prism",
  anchor: "#a",
};

function entry(overrides = {}) {
  const name = overrides.name ?? "@arnilo/prism-a";
  return {
    name,
    state: "present",
    versions: ["0.12.1"],
    deprecatedVersions: ["0.12.1"],
    deprecatedMessage: "Legacy 0.12 package. Prism 0.13+: @arnilo/prism.",
    distTags: { latest: "0.12.1" },
    maintainers: ["arnilo"],
    downloadsLastWeek: 10,
    dependsOn: [],
    dependents: [],
    retired: { ...RETIRED, name },
    shipped: false,
    ...overrides,
  };
}

function evidenceOf(entries) {
  const names = classifyEntries(entries);
  return { generatedAt: "2026-11-08T00:00:00.000Z", registry: "https://registry.example", names };
}

test("cleanup_plan_orders_dependents_first", () => {
  const plan = buildPlan(
    evidenceOf([
      entry({ name: "@arnilo/prism-all", dependsOn: ["@arnilo/prism-code", "@arnilo/prism-mcp"], dependents: [] }),
      entry({ name: "@arnilo/prism-code", dependsOn: ["@arnilo/prism-mcp", "@arnilo/prism-core"], dependents: ["@arnilo/prism-all"] }),
      entry({ name: "@arnilo/prism-mcp", dependsOn: [], dependents: ["@arnilo/prism-all", "@arnilo/prism-code"] }),
      entry({ name: "@arnilo/prism-core", dependsOn: [], dependents: ["@arnilo/prism-code"] }),
    ]),
  );
  const order = plan.steps.map((step) => step.name);
  assert.equal(order.length, 4);
  assert.ok(
    order.indexOf("@arnilo/prism-all") < order.indexOf("@arnilo/prism-code"),
    "the aggregator goes before the packages it depends on",
  );
  assert.ok(order.indexOf("@arnilo/prism-code") < order.indexOf("@arnilo/prism-core"), "a dependent goes before its dependency");
  assert.ok(order.indexOf("@arnilo/prism-code") < order.indexOf("@arnilo/prism-mcp"), "a dependent goes before its dependency");

  // A cycle is a bug in the graph, not something to guess about.
  assert.throws(
    () =>
      buildPlan(
        evidenceOf([
          entry({ name: "@arnilo/prism-a", dependsOn: ["@arnilo/prism-b"], dependents: ["@arnilo/prism-b"] }),
          entry({ name: "@arnilo/prism-b", dependsOn: ["@arnilo/prism-a"], dependents: ["@arnilo/prism-a"] }),
        ]),
      ),
    /cycle/,
  );
});

test("cleanup_plan_deprecates_policy_ineligible_names", () => {
  const plan = buildPlan(
    evidenceOf([
      entry({ name: "@arnilo/prism-busy", downloadsLastWeek: 300 }),
      entry({ name: "@arnilo/prism-shared", maintainers: ["arnilo", "someone-else"] }),
      entry({ name: "@arnilo/prism-depended", dependents: ["@arnilo/prism-kept"] }),
      entry({ name: "@arnilo/prism-kept", shipped: true, retired: null }),
    ]),
  );
  assert.deepEqual(plan.refusals.map((refusal) => refusal.name).sort(), [
    "@arnilo/prism-busy",
    "@arnilo/prism-depended",
    "@arnilo/prism-shared",
  ]);
  assert.deepEqual(plan.steps, []);
  assert.match(plan.refusals[0].reasons.join("; "), /300 downloads|maintainers|depend/);
  for (const refusal of plan.refusals) {
    assert.match(
      refusal.command,
      /^npm deprecate '@arnilo\/prism-[a-z]+@\*' 'Legacy 0\.12 package\./,
      "a refusal falls back to the deprecation message",
    );
  }
  // An unknown download count is not a licence to delete.
  const unknown = buildPlan(evidenceOf([entry({ downloadsLastWeek: null })]));
  assert.match(unknown.refusals[0].reasons.join("; "), /downloads unknown/);
});

test("cleanup_plan_touches_only_old_line_of_reused_names", () => {
  const reused = entry({
    name: "@arnilo/prism-mcp",
    retired: { ...RETIRED, name: "@arnilo/prism-mcp", reused: true, range: "<0.13.0" },
    versions: ["0.11.0", "0.12.1", `${NEW_LINE_VERSION}`, `${NEW_LINE_VERSION}-experimental.0`],
    deprecatedVersions: ["0.11.0", "0.12.1"],
  });
  const kept = entry({
    name: "@arnilo/prism-knowledge/wiki",
    shipped: true,
    retired: null,
    versions: ["0.3.0"],
    deprecatedVersions: ["0.3.0"],
  });
  const plan = buildPlan(evidenceOf([reused, kept]));
  assert.equal(plan.steps.length, 1, "a shipped name off every list stays");
  const commands = plan.steps[0].commands;
  assert.deepEqual(commands, ["npm unpublish @arnilo/prism-mcp@0.11.0 --force", "npm unpublish @arnilo/prism-mcp@0.12.1 --force"]);
  assert.ok(!commands.some((command) => command.includes(NEW_LINE_VERSION)), "no 0.13.x version is ever in the plan");
  assert.ok(
    !plan.steps.flatMap((step) => step.commands).some((command) => command.includes("prism-wiki")),
    "a kept name appears in no command",
  );

  // The owner can sweep the fully deprecated unlisted names; a shipped name still keeps its entry.
  const swept = buildPlan(
    evidenceOf([
      reused,
      kept,
      entry({ name: "@arnilo/prism-dead", retired: null, shipped: false }),
      entry({ name: "@arnilo/prism-alive", retired: null, shipped: false, versions: ["0.4.0", "0.4.1"], deprecatedVersions: ["0.4.0"] }),
    ]),
    { includeUnlisted: true },
  );
  const sweptCommands = swept.steps.flatMap((step) => step.commands);
  assert.ok(sweptCommands.includes("npm unpublish @arnilo/prism-dead --force"));
  assert.ok(
    !sweptCommands.some((command) => command.includes("@arnilo/prism-alive")),
    "a partly deprecated name off every list is the owner's call, not the sweep's",
  );
  assert.ok(
    sweptCommands.includes("npm unpublish @arnilo/prism-knowledge/wiki --force"),
    "every version of the shipped name is retired, so the sweep deletes the name in one command",
  );
});

test("cleanup_plan_collapses_a_name_whose_every_version_is_retired", () => {
  const allOld = entry({
    name: "@arnilo/prism-ag-ui",
    retired: { ...RETIRED, name: "@arnilo/prism-ag-ui", reused: true, range: "<0.13.0" },
    versions: ["0.11.0", "0.12.1"],
    deprecatedVersions: [],
  });
  const mixed = entry({
    name: "@arnilo/prism-channels",
    retired: { ...RETIRED, name: "@arnilo/prism-channels", reused: true, range: "<0.13.0" },
    versions: ["0.12.1", NEW_LINE_VERSION],
    deprecatedVersions: ["0.12.1"],
  });
  const plan = buildPlan(evidenceOf([allOld, mixed]));
  const commands = plan.steps.flatMap((step) => step.commands);
  assert.ok(
    commands.includes("npm unpublish @arnilo/prism-ag-ui --force"),
    "losing every version is a name delete, so the plan asks for one command",
  );
  assert.ok(!commands.some((command) => command.includes("@arnilo/prism-ag-ui@")), "no per-version command for it");
  assert.deepEqual(
    plan.steps.find((step) => step.name === "@arnilo/prism-channels").commands,
    ["npm unpublish @arnilo/prism-channels@0.12.1 --force"],
    "a name with a 0.13.0 version keeps the per-version form, so the name survives",
  );
});

test("cleanup_plan_deletes_a_name_retired_before_0_13", () => {
  // @arnilo/prism-office was retired in 0.8, so no 0.13 list names it and the deprecated-version
  // signal is absent too; only the repo's retired-name ledger knows it is gone.
  const office = entry({
    name: "@arnilo/prism-office",
    retired: null,
    shipped: false,
    versions: ["0.6.0", "0.7.0"],
    deprecatedVersions: [],
  });
  const shipped = entry({ name: "@arnilo/prism-tools/work", retired: null, shipped: true, versions: ["0.12.1"] });
  const ledger = new Set(["@arnilo/prism-office", "@arnilo/prism-tools/work"]);
  const classified = classifyEntries([office, shipped], { ledger });
  assert.deepEqual(
    classified.map((item) => [item.name, item.action]),
    [
      ["@arnilo/prism-office", "delete-name"],
      ["@arnilo/prism-tools/work", "keep"],
    ],
    "the ledger retires an unshipped name and never reaches a name 0.13.0 ships",
  );
  assert.match(classified[0].reason, /scripts\/retired-names\.json/);
  assert.deepEqual(
    buildPlan({ names: classified }).steps.map((step) => step.commands),
    [["npm unpublish @arnilo/prism-office --force"]],
  );
  assert.equal(ledgerRetiredNames(ROOT).has("@arnilo/prism-office"), true, "the shipped ledger lists it");
});

test("trusted_publishers_render_lists_names_and_settings", () => {
  const text = renderTrustedPublishers(["@arnilo/prism", "@arnilo/prism-tools"], {
    owner: "ashiqrniloy",
    repository: "prism",
    published: new Set(["@arnilo/prism"]),
  });
  for (const phrase of [
    "organization/user: ashiqrniloy",
    "repository:        prism",
    "workflow filename: release.yml",
    "environment:       npm-publish",
  ]) {
    assert.ok(text.includes(phrase), `missing ${phrase}`);
  }
  assert.match(text, /- @arnilo\/prism\n/, "a published name is listed without a note");
  assert.match(
    text,
    /- @arnilo\/prism-tools {2}# never published: configure after the first manual publish/,
    "a name npm has never seen is marked for the bootstrap",
  );
  assert.ok(!text.includes("--token") && !text.includes("npm_token"), "the checklist carries no credential");
  assert.throws(() => renderTrustedPublishers(["@arnilo/prism"]), /owner and repository are required/);
});

test("cleanup_plan_never_invokes_npm", () => {
  const source = readFileSync(join(ROOT, "scripts/registry-cleanup.mjs"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const forbidden of ["child_process", "spawn", "execSync", "execFile", "Bun.$", "NPM_TOKEN", "authorization"]) {
    assert.ok(!code.includes(forbidden), `registry-cleanup.mjs must not contain ${forbidden}`);
  }
  assert.match(source, /npm unpublish \$\{name\}/, "the plan prints commands instead of running them");
});

test("cleanup_evidence_contains_no_secret", async () => {
  const fetchImpl = async (url) => {
    const json = (body) => ({ ok: true, status: 200, headers: new Map(), json: async () => body });
    if (url.endsWith("/-/org/arnilo/package")) return json({ "@arnilo/prism-a": "write", "@arnilo/prism-b": "write" });
    if (url.includes("/downloads/point/")) return json({ downloads: 7 });
    const dependencies = url.includes("prism-a") ? { "@arnilo/prism-b": "^0.12.0" } : {};
    return json({
      versions: { "0.12.1": { deprecated: "legacy", dependencies } },
      "dist-tags": { latest: "0.12.1" },
      maintainers: [{ name: "arnilo" }],
    });
  };
  const cleanup = createRegistryCleanup({ fetchImpl, retired: new Map(), shipped: new Set(), rootDir: ROOT, out: () => {} });
  const evidence = await cleanup.inventory();
  assert.deepEqual(
    evidence.names.map((name) => name.name),
    ["@arnilo/prism-a", "@arnilo/prism-b"],
    "every name in the scope listing is recorded",
  );
  assert.deepEqual(evidence.names[1].dependents, ["@arnilo/prism-a"], "dependents come from the published manifests");

  const tmp = mkdtempSync(join(ROOT, ".tmp-registry-cleanup-"));
  const path = join(tmp, "evidence.json");
  process.env.PRISM_CLEANUP_TEST_TOKEN = "supersecret-value";
  try {
    const leaked = { ...evidence, names: [{ ...evidence.names[0], deprecatedMessage: "supersecret-value" }] };
    assert.throws(
      () => cleanup.write(leaked, path),
      /secret value appears/,
      "a credential-shaped value anywhere in the evidence aborts the write",
    );
  } finally {
    delete process.env.PRISM_CLEANUP_TEST_TOKEN;
  }
  try {
    assert.equal(cleanup.write(evidence, path), path);
    const written = readFileSync(path, "utf8");
    assert.ok(!written.includes("supersecret-value"));
    assert.match(written, /"summary"/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cleanup_shipped_names_are_the_root_and_the_workspaces", () => {
  const shipped = shippedNames(ROOT);
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;
  assert.ok(shipped.has(root), "the root package is published, so its name is shipped");
  assert.equal(shipped.size, 7, "plan 224: kernel and six bundles");
  assert.ok(!shipped.has("@arnilo/prism-agent"), "a private workspace (apps/prism-agent) is never published");
  assert.equal(
    classifyName({ name: root, state: "present", shipped: true, retired: null, versions: ["0.12.1"], deprecatedVersions: [] }).category,
    "shipped",
  );
});

test("cleanup_plan_render_is_a_readable_script", () => {
  const plan = buildPlan(evidenceOf([entry({ name: "@arnilo/prism-a" }), entry({ name: "@arnilo/prism-b", downloadsLastWeek: 400 })]));
  const script = renderPlan(plan);
  assert.match(script, /^# Plan 215 Task 37/);
  assert.match(script, /npm unpublish @arnilo\/prism-a --force/);
  assert.match(script, /npm deprecate '@arnilo\/prism-b@\*'/);
  assert.match(script, /Irreversible/);
  assert.equal(
    script
      .trimEnd()
      .split("\n")
      .filter((line) => line.startsWith("npm ")).length,
    2,
  );
});
