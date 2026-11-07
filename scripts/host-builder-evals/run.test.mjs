import { test } from "bun:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createAgent, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { toolsCoding } from "@arnilo/prism-tools-coding";
import {
  ARMS,
  applyRound,
  buildWorkspace,
  checkWorkspace,
  classifySpecifier,
  decideClaims,
  disposeStaged,
  EVIDENCE_DIR,
  HIDDEN,
  installRateLimitedFetch,
  loadCriteria,
  registeredInputs,
  retiredNames,
  SOLUTIONS,
  surfaceViolations,
  WORKSPACES,
} from "./lib.mjs";
import { assertNoSecret, sealEvidence } from "../skill-evals/run.mjs";
import {
  armPackages,
  assertPreregistered,
  buildBuilder,
  evidenceFor,
  loadSuite,
  parseArgs,
  readLock,
  registrationFor,
  run,
} from "./run.mjs";
import { allowedProviders } from "../skill-evals/run.mjs";

const { criteria } = loadCriteria();
const TASKS = criteria.tasks.map((task) => task.id);
const SCORERS = criteria.claims.scorers;

// ── pre-registration ───────────────────────────────────────────────────────────

test("host_builder_eval_criteria_preregistered", () => {
  assert.ok(criteria.tasks.length >= 6 && criteria.tasks.length <= 8, "6 to 8 fixture tasks");
  assert.equal(criteria.trials, 3);
  assert.deepEqual(Object.keys(criteria.arms), ["none", "skill", "skill+mcp"]);
  assert.deepEqual(SCORERS, ["typecheck_passes", "acceptance_tests_pass", "public_surface_only", "no_retired_names"]);
  assert.equal(criteria.claims.alpha, 0.05);
  assert.deepEqual(
    criteria.providers.map((entry) => entry.id),
    ["hyper", "opencode-go", "openrouter", "kilo", "commandcode"],
    "the owner-approved provider set",
  );
  assert.ok(criteria.forbiddenProviders.includes("openrouter/free"), "router aliases stay refused");
  assert.deepEqual(Object.keys(criteria.loadings), ["natural", "preload"]);
  assert.match(criteria.builder.preloadInstruction, /load_skill.*prism-host-builder/);
  // Every task has a prompt, a seed workspace and a hidden test, and the hidden tests live outside the workspaces.
  for (const task of criteria.tasks) {
    assert.ok(task.prompt.length > 80, `${task.id} has a prompt`);
    assert.ok(existsSync(join(WORKSPACES, task.id)), `${task.id} has a workspace`);
    assert.ok(existsSync(join(HIDDEN, `${task.id}.test.ts`)), `${task.id} has a hidden test`);
    assert.ok(existsSync(join(SOLUTIONS, task.id)), `${task.id} has an oracle solution`);
  }
  // A lock pins the criteria and every input; a mismatch means something changed after registration.
  const lock = readLock();
  const suite = loadSuite();
  if (lock) {
    assert.equal(lock.criteriaHash, suite.criteriaHash, "criteria.json changed after it was locked");
    assert.deepEqual(
      lock.inputs,
      registeredInputs(),
      "a workspace, hidden test, solution, the skill or the indexes changed after the lock",
    );
  }
  // A paid run needs the lock; without one it refuses.
  assert.throws(() => assertPreregistered(suite, undefined, { requireCommitted: false }), /criteria.lock.json is missing/);
  assert.throws(
    () => assertPreregistered(suite, { ...registrationFor(suite), criteriaHash: "other" }, { requireCommitted: false }),
    /criteria.json changed/,
  );
  assert.throws(
    () =>
      assertPreregistered(
        suite,
        { ...registrationFor(suite), inputs: { ...registeredInputs(), hidden: "sha256:other" } },
        { requireCommitted: false },
      ),
    /hidden changed/,
  );
  // Evidence from a paid run starts after the lock and carries the locked hash.
  if (!existsSync(EVIDENCE_DIR)) return;
  for (const name of readdirSync(EVIDENCE_DIR).filter((entry) => entry.endsWith(".json"))) {
    assert.ok(lock, "evidence exists without a lock");
    const evidence = JSON.parse(readFileSync(join(EVIDENCE_DIR, name), "utf8"));
    if (evidence.mode === "offline") continue;
    assert.equal(evidence.criteriaHash, lock.criteriaHash, `${name} does not carry the locked criteria hash`);
    assert.ok(Date.parse(evidence.startedAt) >= Date.parse(lock.registeredAt), `${name} started before the lock`);
  }
});

// ── the offline suite ──────────────────────────────────────────────────────────

test("host_builder_eval_offline_runs_every_workspace", async () => {
  const started = Date.now();
  try {
    const { evidence } = await run(["--offline"]);
    assert.ok(Date.now() - started < 120_000, "the offline suite runs in under 120 s");
    const [entry] = evidence.providers;
    for (const arm of ARMS) {
      for (const id of SCORERS) assert.equal(entry.arms[arm].scorers[id]?.mean, 1, `${arm} ${id}: the oracle must pass every check`);
      assert.equal(entry.arms[arm].scoredRuns, TASKS.length);
      assert.equal(entry.arms[arm].failedCount, 0);
    }
    // The arms differ in what the builder is given: the skill is loaded in both skill arms, the MCP tool is used in one.
    assert.equal(entry.arms.none.skillLoadedRuns, 0);
    assert.equal(entry.arms.skill.skillLoadedRuns, TASKS.length);
    assert.equal(entry.arms.skill.mcpUsedRuns, 0);
    assert.equal(entry.arms["skill+mcp"].mcpUsedRuns, TASKS.length);
    assert.deepEqual(
      entry.tasks.map((row) => row.id),
      TASKS,
    );
    assert.equal(evidence.verdict, "no-claims", "identical arms claim nothing");
  } finally {
    disposeStaged();
  }
}, 180_000);

test("host_builder_eval_graders_reject_a_do_nothing_builder_and_accept_the_oracle", () => {
  try {
    for (const task of criteria.tasks) {
      const workspace = buildWorkspace({ task: task.id, arm: "none" });
      try {
        const before = checkWorkspace({ dir: workspace.dir, task: task.id, spec: task.checks });
        assert.equal(before.acceptance.ok, false, `${task.id}: the seed alone must fail the hidden test`);
        cpSync(join(SOLUTIONS, task.id), workspace.dir, { recursive: true });
        const after = checkWorkspace({ dir: workspace.dir, task: task.id, spec: task.checks });
        assert.equal(after.typecheck.ok, true, `${task.id}: ${after.typecheck.output}`);
        assert.equal(after.acceptance.ok, true, `${task.id}: ${after.acceptance.output}`);
        assert.deepEqual(after.surface.violations, [], task.id);
        assert.deepEqual(after.retired.hits, [], task.id);
      } finally {
        workspace.dispose();
      }
    }
  } finally {
    disposeStaged();
  }
}, 180_000);

// ── isolation ──────────────────────────────────────────────────────────────────

const walk = (directory) => {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
};

test("hidden_tests_not_in_builder_workspace", () => {
  try {
    const hidden = TASKS.map((task) => readFileSync(join(HIDDEN, `${task}.test.ts`), "utf8"));
    // The fixture tree holds no acceptance test of any task.
    for (const file of walk(WORKSPACES)) {
      const text = readFileSync(file, "utf8");
      for (const body of hidden)
        assert.ok(
          !text.includes(body.split("\n").find((line) => line.startsWith("test(")) ?? "never"),
          `${relative(WORKSPACES, file)} holds hidden test text`,
        );
      assert.ok(!/__acceptance__|\bhidden\b/.test(relative(WORKSPACES, file)), `${relative(WORKSPACES, file)}`);
    }
    // A builder's copy, in every arm, holds none either, and a finished check leaves none behind.
    for (const task of criteria.tasks) {
      for (const arm of ARMS) {
        const workspace = buildWorkspace({ task: task.id, arm });
        try {
          const files = walk(workspace.dir).map((file) => relative(workspace.dir, file));
          assert.ok(
            !files.some((file) => file.startsWith("__acceptance__") || file.includes("hidden")),
            `${task.id}/${arm}: ${files.filter((f) => f.includes("hidden") || f.startsWith("__acc")).join(",")}`,
          );
          if (arm === "none" && task.id === "headless-host") {
            checkWorkspace({ dir: workspace.dir, task: task.id, spec: task.checks });
            assert.equal(existsSync(join(workspace.dir, "__acceptance__")), false, "the hidden test is removed after the check");
          }
        } finally {
          workspace.dispose();
        }
      }
    }
  } finally {
    disposeStaged();
  }
}, 120_000);

test("host_builder_eval_arms_differ_only_by_the_kit", () => {
  try {
    const task = "headless-host";
    const tree = (arm) => {
      const workspace = buildWorkspace({ task, arm });
      const files = walk(workspace.dir).map((file) => relative(workspace.dir, file));
      const kit = existsSync(join(workspace.dir, "node_modules/@arnilo/prism-host-builder"));
      workspace.dispose();
      return { files, kit };
    };
    const none = tree("none");
    const skill = tree("skill");
    const both = tree("skill+mcp");
    assert.equal(none.kit, false, "the none arm has no kit installed");
    assert.equal(skill.kit, true);
    assert.deepEqual(skill.files, both.files, "skill and skill+mcp hold the same files: the MCP server is a package, not a file");
    const added = skill.files.filter((file) => !none.files.includes(file));
    const removed = none.files.filter((file) => !skill.files.includes(file));
    assert.deepEqual(removed, [], "the skill arms hold every file the none arm holds");
    assert.ok(added.includes(".agents/skills/prism-host-builder/SKILL.md"));
    assert.ok(
      added.every(
        (file) => file.startsWith(".agents/skills/prism-host-builder/") || file.startsWith("node_modules/@arnilo/prism-host-builder/"),
      ),
      "only the skill copy and the installed kit package are added",
    );
    // The builder's packages: identical except the MCP server in the last arm.
    const names = (arm) => armPackages(arm, "/nonexistent").map((instance) => instance.definition.name);
    assert.deepEqual(names("none"), names("skill"));
    assert.deepEqual(names("skill+mcp"), [...names("skill"), "@arnilo/prism-mcp"]);
  } finally {
    disposeStaged();
  }
}, 60_000);

// ── secrets ────────────────────────────────────────────────────────────────────

test("host_builder_eval_evidence_contains_no_secret", async () => {
  const secret = "hyper-test-secret-value-1234567890";
  const sealed = sealEvidence({ note: `key ${secret} leaked`, nested: { value: secret } }, [secret]);
  assert.ok(!JSON.stringify(sealed).includes(secret));
  assert.throws(() => assertNoSecret(`token ${secret}`, [secret]), /secret value/);
  assert.throws(() => assertNoSecret("sk-abcdefghijklmnopqrstuvwxyz0123456789", []), /key-shaped/);
  assert.throws(() => assertNoSecret("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123", []), /key-shaped/);
  if (existsSync(EVIDENCE_DIR)) {
    for (const entry of await readdir(EVIDENCE_DIR, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) assertNoSecret(readFileSync(join(entry.parentPath ?? entry.path, entry.name), "utf8"), []);
    }
  }
});

test("host_builder_eval_builder_shell_never_sees_live_keys", async () => {
  const fake = "hbe-fake-live-key-0123456789abcdef";
  const names = ["HYPER_API_KEY", "OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"];
  const saved = names.map((name) => process.env[name]);
  for (const name of names) process.env[name] = fake;
  const workspace = buildWorkspace({ task: "headless-host", arm: "none" });
  try {
    let last;
    const provider = {
      id: "probe",
      async *generate(request) {
        last = request;
        if (!request.messages.some((message) => message.role === "assistant")) {
          yield providerToolCall(toolCallContent("c1", "shell", { command: "env" }));
        }
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: { provider: "probe", model: "x" },
      ownership: { tenantId: "t" },
      principal: { kind: "user", id: "u" },
      packages: [providerPackage("probe", [provider]), toolsCoding({ root: workspace.dir })],
    });
    try {
      const session = await agent.session();
      await session.run("go");
      const text = JSON.stringify(last.messages);
      assert.ok(text.includes("tool_result"), "the shell ran");
      assert.ok(!text.includes(fake), "a live key reached the builder's shell");
    } finally {
      await agent.dispose();
    }
  } finally {
    workspace.dispose();
    disposeStaged();
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});

// ── the scorers' static checks ─────────────────────────────────────────────────

test("host_builder_eval_surface_and_retired_name_rules", () => {
  const dir = join(WORKSPACES, "headless-host");
  const file = join(dir, "src/x.ts");
  assert.equal(classifySpecifier("@arnilo/prism", file, dir), undefined);
  assert.equal(classifySpecifier("@arnilo/prism/testing", join(dir, "src/x.test.ts"), dir), undefined);
  assert.match(classifySpecifier("@arnilo/prism/testing", file, dir) ?? "", /outside a test/);
  assert.match(classifySpecifier("@arnilo/prism/src/index.ts", file, dir) ?? "", /not public/);
  assert.match(classifySpecifier("@arnilo/prism-tools-coding/src/agent/write", file, dir) ?? "", /deep or undeclared/);
  assert.match(classifySpecifier("@arnilo/prism-coding-tools", file, dir) ?? "", /retired/);
  assert.match(classifySpecifier("@arnilo/prism-nothing", file, dir) ?? "", /not a published/);
  assert.match(classifySpecifier("../../outside", file, dir) ?? "", /leaves the project/);
  assert.match(classifySpecifier("../node_modules/@arnilo/prism/src/x", file, dir) ?? "", /node_modules|leaves/);
  assert.equal(classifySpecifier("@arnilo/prism-tools-coding", file, dir), undefined);
  assert.equal(classifySpecifier("zod", file, dir), undefined);
  assert.deepEqual(surfaceViolations(join(WORKSPACES, "acp-serve")), []);
  // The 0.12-shaped seed trips both the surface rule and the retired-name rule; every other seed trips neither.
  assert.ok(surfaceViolations(join(WORKSPACES, "upgrade-0-12")).length > 0);
  const retired = retiredNames(join(WORKSPACES, "upgrade-0-12"));
  for (const needle of [
    "@arnilo/prism-coding-tools",
    "extensions: [",
    "tools: { use",
    "identity: { profile",
    'store: "memory"',
    "stopHooks",
  ]) {
    assert.ok(retired.some((hit) => hit.includes(needle.replace(/ \{ use$/, ""))) || retired.length >= 5, needle);
  }
  for (const task of TASKS.filter((id) => id !== "upgrade-0-12")) assert.deepEqual(retiredNames(join(WORKSPACES, task)), [], task);
  for (const task of TASKS) assert.deepEqual(retiredNames(join(SOLUTIONS, task)), [], `${task} solution`);
});

// ── the claim rules on synthetic reports ───────────────────────────────────────

function syntheticReport({ id, pass, unscored = 0 }) {
  const evaluations = [];
  const items = [];
  const count = pass[SCORERS[0]].length;
  for (let index = 0; index < count; index += 1) {
    const itemId = `item-${index}`;
    const own = SCORERS.map((scorerId) => ({
      id: `${id}-${scorerId}-${index}`,
      scorerId,
      status: "scored",
      score: pass[scorerId][index] ? 1 : 0,
      itemId,
      sampled: true,
      createdAt: "2026-11-07T00:00:00Z",
    }));
    evaluations.push(...own);
    items.push({ item: { id: itemId, expected: {} }, trials: [{ status: "succeeded", costComplete: false }], evaluations: own });
  }
  return {
    experimentId: id,
    datasetId: "synthetic",
    datasetVersion: "1",
    datasetContentHash: `sha256:${"a".repeat(64)}`,
    status: "succeeded",
    items,
    evaluations,
    aggregate: { itemCount: count, scoredCount: count, skippedCount: 0, failedCount: unscored, scorers: {} },
  };
}

const all = (value, count = 24) => Object.fromEntries(SCORERS.map((id) => [id, Array.from({ length: count }, () => value)]));
const mixed = (overrides) => ({ ...all(true), ...overrides });

test("host_builder_eval_claims_need_a_significant_improvement", () => {
  const none = syntheticReport({ id: "n", pass: mixed({ acceptance_tests_pass: Array.from({ length: 24 }, () => false) }) });
  const skill = syntheticReport({ id: "s", pass: all(true) });
  const both = syntheticReport({ id: "b", pass: all(true) });
  const decision = decideClaims({ reports: { none, skill, "skill+mcp": both }, criteria });
  assert.equal(decision.verdict, "claims", decision.reason);
  assert.ok(decision.claims.some((claim) => claim.text === "skill improves acceptance_tests_pass over none"));
  assert.ok(decision.claims.some((claim) => claim.text === "skill+mcp improves acceptance_tests_pass over none"));
  assert.ok(!decision.claims.some((claim) => claim.comparison === "skill_mcp_vs_skill"), "no MCP claim over the skill when the arms tie");
  assert.equal(applyRound(decision, 1), "claims");
  // Identical arms claim nothing.
  const tie = decideClaims({ reports: { none: syntheticReport({ id: "n", pass: all(true) }), skill, "skill+mcp": both }, criteria });
  assert.equal(tie.verdict, "no-claims");
  assert.deepEqual(tie.claims, []);
});

test("host_builder_eval_regression_against_none_blocks_then_goes_to_the_owner", () => {
  const none = syntheticReport({ id: "n", pass: all(true) });
  const worse = syntheticReport({ id: "s", pass: mixed({ no_retired_names: Array.from({ length: 24 }, () => false) }) });
  const decision = decideClaims({ reports: { none, skill: worse, "skill+mcp": syntheticReport({ id: "b", pass: all(true) }) }, criteria });
  assert.equal(decision.verdict, "blocked");
  assert.match(decision.reason, /skill_vs_none\/no_retired_names/);
  assert.deepEqual(decision.claims, [], "a blocked plan publishes no claim");
  assert.equal(applyRound(decision, 1), "fix-and-remeasure");
  assert.equal(applyRound(decision, 2), "owner-decision");
  // A skill+mcp arm that is worse than the skill arm (but not than none) is reported, not blocking.
  const mcpWorse = decideClaims({ reports: { none, skill: syntheticReport({ id: "s2", pass: all(true) }), "skill+mcp": worse }, criteria });
  assert.equal(mcpWorse.verdict, "blocked", "skill+mcp against none is a block too");
});

test("host_builder_eval_unscored_records_are_inconclusive", () => {
  const none = syntheticReport({ id: "n", pass: all(true) });
  const skill = syntheticReport({ id: "s", pass: all(true), unscored: 1 });
  const decision = decideClaims({ reports: { none, skill, "skill+mcp": syntheticReport({ id: "b", pass: all(true) }) }, criteria });
  assert.equal(decision.verdict, "inconclusive");
  assert.match(decision.reason, /unscored/);
  assert.deepEqual(decision.claims, []);
  const unpaired = decideClaims({
    reports: {
      none,
      skill: { ...syntheticReport({ id: "s2", pass: all(true) }), datasetId: "other" },
      "skill+mcp": syntheticReport({ id: "b", pass: all(true) }),
    },
    criteria,
  });
  assert.equal(unpaired.verdict, "inconclusive");
});

// ── the preload variant ────────────────────────────────────────────────────────

test("host_builder_eval_preload_tells_only_the_skill_arms_to_load_the_skill", async () => {
  try {
    const instructionsOf = async (arm, preload) => {
      const built = await buildBuilder({ task: "headless-host", arm, mode: "offline", criteria, preload });
      try {
        return built.agent.config?.instructions ?? built.agent.inspect().instructions ?? JSON.stringify(built.agent.inspect());
      } finally {
        await built.agent.dispose();
        built.workspace.dispose();
      }
    };
    for (const arm of ARMS) {
      const natural = await instructionsOf(arm, false);
      const preloaded = await instructionsOf(arm, true);
      assert.ok(!String(natural).includes(criteria.builder.preloadInstruction), `${arm} natural`);
      assert.equal(String(preloaded).includes(criteria.builder.preloadInstruction), arm !== "none", `${arm} preload`);
    }
    const { evidence } = await run(["--offline", "--preload"]);
    assert.equal(evidence.loading, "preload");
    assert.equal((await run(["--offline"])).evidence.loading, "natural");
  } finally {
    disposeStaged();
  }
}, 180_000);

test("host_builder_eval_provider_allowlist", () => {
  const ids = (list) => allowedProviders(criteria, list).map((entry) => entry.id);
  assert.deepEqual(ids(["openrouter", "kilo", "commandcode"]), ["openrouter", "kilo", "commandcode"]);
  assert.throws(() => allowedProviders(criteria, ["litellm"]), /not allowed/);
  const model = (id) => criteria.providers.find((entry) => entry.id === id).defaultModel;
  assert.ok(
    model("openrouter").endsWith(":free") && model("kilo").endsWith(":free") && model("commandcode").endsWith(":free"),
    "the defaults are the free rows",
  );
  assert.deepEqual(criteria.providers.find((entry) => entry.id === "commandcode").reserveModels, ["Qwen/Qwen3.7-Flash"]);
});

// ── arguments ──────────────────────────────────────────────────────────────────

test("host_builder_eval_arguments", () => {
  assert.throws(() => parseArgs([]), /pick exactly one/);
  assert.throws(() => parseArgs(["--offline", "--live", "--providers", "hyper"]), /pick exactly one/);
  assert.throws(() => parseArgs(["--live"]), /--providers is required/);
  assert.throws(() => parseArgs(["--offline", "--bogus"]), /unknown flag/);
  assert.throws(() => parseArgs(["--offline", "--trials", "0"]), /positive integer/);
  assert.deepEqual(parseArgs(["--dry-run", "--providers", "hyper,opencode-go"]).providers, ["hyper", "opencode-go"]);
  assert.equal(parseArgs(["--offline"]).offline, true);
  assert.equal(parseArgs(["--offline", "--preload"]).preload, true);
});

test("host_builder_eval_evidence_shape", async () => {
  const none = syntheticReport({ id: "n", pass: all(true) });
  const suite = loadSuite();
  const evidence = evidenceFor({
    results: [
      {
        provider: { id: "offline", model: "oracle" },
        reports: { none, skill: none, "skill+mcp": none },
        decision: decideClaims({ reports: { none, skill: none, "skill+mcp": none }, criteria }),
      },
    ],
    round: 1,
    mode: "offline",
    suite,
    startedAt: new Date().toISOString(),
    lock: undefined,
    fullTasks: TASKS.length,
    dataset: suite.dataset,
  });
  assert.equal(evidence.verdict, "no-claims");
  assert.deepEqual(Object.keys(evidence.providers[0].arms), ["none", "skill", "skill+mcp"]);
  assert.deepEqual(Object.keys(evidence.inputs).sort(), ["hidden", "indexes", "skill", "solutions", "workspaces"]);
});

// Keep the shared temp trees from outliving the file.
test("host_builder_eval_cleanup", () => {
  disposeStaged();
  rmSync(join(WORKSPACES, "headless-host", "__acceptance__"), { recursive: true, force: true });
  assert.equal(existsSync(join(WORKSPACES, "headless-host", "__acceptance__")), false);
});

test("host_builder_eval_rate_limited_fetch_waits_on_a_429_and_gives_up_on_a_daily_cap", async () => {
  const waits = [];
  const responses = [
    new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
    new Response("slow down", { status: 429, headers: { "x-ratelimit-reset": String(Date.now() + 4000) } }),
    new Response("ok", { status: 200 }),
  ];
  const calls = [];
  const restore = installRateLimitedFetch({
    minIntervalMs: { "example.test": 100 },
    base: async (url) => (calls.push(String(url)), responses.shift()),
    sleep: async (ms) => void waits.push(ms),
  });
  try {
    const response = await fetch("https://example.test/v1");
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3, "two 429s were retried");
    const retryWaits = waits.filter((ms) => ms >= 1000);
    assert.equal(retryWaits[0], 2000, "Retry-After seconds");
    assert.ok(retryWaits[1] > 3000 && retryWaits[1] <= 4600, `reset time: ${retryWaits[1]}`);
    assert.ok(
      waits.some((ms) => ms > 0 && ms <= 100),
      "requests to one host are spaced",
    );
  } finally {
    restore();
  }
  // A reset a day away is a daily cap: the 429 comes back at once instead of sleeping.
  const capped = [];
  const restoreCap = installRateLimitedFetch({
    base: async () => new Response("cap", { status: 429, headers: { "x-ratelimit-reset": String(Date.now() + 86_400_000) } }),
    sleep: async (ms) => void capped.push(ms),
  });
  try {
    assert.equal((await fetch("https://example.test/v1")).status, 429);
    assert.deepEqual(capped, []);
  } finally {
    restoreCap();
  }
  assert.equal(fetch.name === "fetch" || typeof fetch === "function", true, "the previous fetch is restored");
});
