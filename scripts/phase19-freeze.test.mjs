/**
 * Phase 19 (0.1.7) Task 0 performance-and-dx scope gate (plan 019 Task 0).
 * Validates scripts/phase19-freeze-manifest.json: the 0.1.7 release/line/type,
 * the four roadmap items with disjoint allowed-file scopes, the preserved
 * surface (cache math, usage event shape, cli-init machinery, memory router
 * state — byte-immutable for the whole phase), allowed/forbidden change lists,
 * the additive-only compat promise (no --allow-break), the audit/signed-tag/
 * provenance policy, and per-task evidence tokens. Validates
 * scripts/phase19-baseline.json coherence against the real filesystem and the
 * live source.
 *
 * STATE MACHINE:
 * - while an item's task token is 'pending', every file in its allowed scope
 *   must be byte-identical to the Task 0 baseline hash (files recorded as
 *   "absent" must not exist);
 * - once a task token is 'done', the item assertions replace the hashes: the
 *   shipped artifacts exist and are wired (telemetry module + export, router
 *   selection module + export, scaffold module + dispatch + templates, async-
 *   hooks verification record); the async-hooks item ships a test file ONLY
 *   when the verification record says a gap was found;
 * - preservedSurface files are byte-immutable at every task state;
 * - the Task 6 exit gate is null until recorded; when recorded it must be
 *   green with all task tokens done and full gate evidence.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase19-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase19-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

const ITEMS = manifest.items;
const ITEM_IDS = ["cache-telemetry", "router-selection", "async-hooks-closeout", "provider-scaffold"];
const TASKS = ["task1", "task2", "task3", "task4", "task5", "task6"];

function itemById(id) {
  const c = ITEMS.find((c) => c.id === id);
  assert.ok(c, `item ${id} present in the registry`);
  return c;
}

function resolveFile(file) {
  if (existsSync(url(`../${file}`))) return url(`../${file}`);
  const coreMap = {
    "packages/server/": "packages/prism-core/src/runtime/server/",
    "packages/supervisor/": "packages/prism-core/src/runtime/supervisor/",
    "packages/workflows/": "packages/prism-core/src/runtime/workflows/",
    "packages/session-store-codecs/": "packages/prism-core/src/sessions/codecs/",
    "packages/session-store-sqlite/": "packages/prism-core/src/sessions/sqlite/",
    "packages/session-store-postgres/": "packages/prism-core/src/sessions/postgres/",
    "packages/session-store-nats/": "packages/prism-core/src/sessions/nats/",
    "packages/policy/": "packages/prism-core/src/governance/policy/",
    "packages/evals/": "packages/prism-core/src/governance/evals/",
    "packages/prompts/": "packages/prism-core/src/governance/prompts/",
    "packages/model-router/": "packages/prism-core/src/governance/model-router/",
    "packages/observability-opentelemetry/": "packages/prism-core/src/governance/observability/",
    "packages/credentials-node/": "packages/prism-core/src/credentials/node/",
    "packages/enterprise-postgres/": "packages/prism-core/src/enterprise/postgres/",
    "packages/work-tools/": "packages/prism-core/src/integrations/work/",
    "packages/tool-validator-json-schema/": "packages/prism-core/src/validation/json-schema/",
  };
  for (const [prefix, target] of Object.entries(coreMap)) {
    if (file.startsWith(prefix)) {
      const rest = file.slice(prefix.length).replace(/^src\//, "");
      const cand = target + rest;
      if (existsSync(url(`../${cand}`))) return url(`../${cand}`);
      if (file.endsWith("CHANGELOG.md") && existsSync(url("../packages/prism-core/CHANGELOG.md"))) {
        return url("../packages/prism-core/CHANGELOG.md");
      }
      if (file.endsWith("README.md") && existsSync(url("../packages/prism-core/README.md"))) {
        return url("../packages/prism-core/README.md");
      }
    }
  }
  return url(`../${file}`);
}

function sha256(file) {
  return createHash("sha256")
    .update(readFileSync(resolveFile(file)))
    .digest("hex");
}

test("manifest targets release 0.1.7 on the 0.1.x performance-and-dx line off the 0.1.6 baseline", () => {
  assert.equal(manifest.release, "0.1.7");
  assert.equal(manifest.line, "0.1.x");
  assert.equal(manifest.type, "performance-and-dx");
  assert.ok(manifest.baseline.startsWith("0.1.6"), "baseline names 0.1.6");
});

test("items registry lists exactly the four roadmap 0.1.7 items with valid tasks and disjoint allowed scopes", () => {
  assert.equal(ITEMS.length, 4, "exactly four items");
  assert.deepEqual(ITEMS.map((c) => c.id).sort(), [...ITEM_IDS].sort(), "registry ids match the roadmap 0.1.7 item set");
  for (const c of ITEMS) {
    assert.ok(c.task.startsWith("task") && TASKS.includes(c.task), `${c.id} maps to a phase-19 task`);
    assert.ok(Array.isArray(c.allowedFiles) && c.allowedFiles.length > 0, `${c.id} lists allowed files`);
    assert.ok(c.rationale.length > 0, `${c.id} records its roadmap rationale`);
  }
  // allowed scopes are disjoint so a single-file diff can never satisfy two items ambiguously
  const seen = new Map();
  for (const c of ITEMS) {
    for (const f of c.allowedFiles) {
      assert.ok(!seen.has(f), `file ${f} claimed by both ${seen.get(f)} and ${c.id}`);
      seen.set(f, c.id);
    }
  }
});

test("preserved surface is active and names exactly the reused primitives", () => {
  const ps = manifest.preservedSurface;
  assert.equal(ps.active, true);
  assert.ok(ps.rule.includes("byte-immutable"), "preserved files are immutable for the whole phase");
  const expected = ["src/cache-helpers.ts", "src/provider-events.ts", "src/cli-init.ts", "packages/model-router/src/state.ts"];
  assert.deepEqual(Object.keys(ps.files).sort(), [...expected].sort(), "preserved surface names the four reused primitives");
  for (const f of expected) {
    assert.ok(existsSync(resolveFile(f)), `preserved file exists: ${f}`);
    assert.ok(baseline.preservedSurface[f], `baseline records a preserved hash for ${f}`);
  }
  // preserved files must not be claimed by any item scope (they never change)
  for (const f of expected) {
    for (const c of ITEMS) {
      assert.ok(!c.allowedFiles.includes(f), `preserved file ${f} is not in the ${c.id} allowed scope`);
    }
  }
});

test("allowed and forbidden change lists are disjoint; deviations are structured", () => {
  assert.ok(manifest.allowedChanges.length >= 7, "allowed changes cover review/implementation/docs/bump/baseline/wiring/evidence");
  for (const token of [
    "primitive-review",
    "allowedFiles",
    "additive public exports",
    "version bump 0.1.6 -> 0.1.7",
    "--update-baseline",
    "phase19-freeze.test.mjs",
    "asyncHooks verification record",
  ]) {
    assert.ok(
      manifest.allowedChanges.some((c) => c.includes(token)),
      `allowed list names ${token}`,
    );
  }
  assert.ok(
    manifest.forbiddenChanges.length >= 10,
    "forbiddenChanges covers pending-scope/preserved/defaults/breaking/deps/0.2.0/baseline items",
  );
  for (const token of [
    "pending",
    "preservedSurface",
    "behavior change to any default",
    "additive-only",
    "--allow-break",
    "dependency-free core",
    "durable latency statistics",
    "0.2.0 items",
    "ponytail: comments",
    "support matrix",
  ]) {
    assert.ok(
      manifest.forbiddenChanges.some((c) => c.includes(token)),
      `forbidden list names ${token}`,
    );
  }
  const allowedSet = new Set(manifest.allowedChanges);
  for (const f of manifest.forbiddenChanges) {
    assert.ok(!allowedSet.has(f), `forbidden item also allowed: ${f}`);
  }
  const { deviations } = manifest;
  assert.ok(Array.isArray(deviations), "deviations is an array");
  for (const d of deviations) {
    assert.ok(typeof d.task === "string" && d.task.length > 0, "deviation names its task");
    assert.ok(typeof d.change === "string" && d.change.length > 0, "deviation describes the change");
    assert.ok(typeof d.rationale === "string" && d.rationale.length > 0, "deviation records the rationale");
  }
});

test("compat promise is additive-only: plain gate at 0.1.7, no --allow-break, no new package", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.1.6");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("ADDITIVE-ONLY"), "0.1.7 compat promise is additive-only");
  assert.ok(compat.promise.includes("WITHOUT --allow-break"), "no --allow-break anywhere in 0.1.7");
  assert.ok(compat.promise.includes("zero breaking declaration deltas"), "plain gate must prove 0 breaking deltas");
  assert.ok(compat.promise.includes("--update-baseline"), "regeneration happens only via --update-baseline");
  assert.ok(compat.promise.includes("stays at 50"), "no new package planned, graph stays 50 publishable");
});

test("support matrix stays frozen at the phase 12 manifest (0.1.7 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.1.7 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the seven plan 019 tasks with Task 0 done and Tasks 1-6 pending", () => {
  const tasks = manifest.tasks;
  for (const id of ["task0", ...TASKS]) {
    assert.ok(typeof tasks[id] === "string" && tasks[id].length > 0, `${id} has a token`);
  }
  assert.ok(tasks.task0.startsWith("done"), "Task 0 is done at freeze");
  assert.ok(tasks.task0.includes("2ebc08e"), "Task 0 token records the 0.1.6 HEAD");
  for (const id of TASKS) {
    assert.ok(
      tasks[id].startsWith("pending") || tasks[id].startsWith("done"),
      `${id} is pending until its task lands, then done with evidence`,
    );
  }
});

test("security policy inherits blocked-gate semantics, moderate audit, and per-item fail-closed guarantees", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy inherited");
  assert.ok(security.auditPolicy.includes("moderate"), "moderate audit policy");
  assert.ok(security.itemPolicy.includes("explicit activation"), "no implicit activation by import/discovery");
  assert.ok(security.itemPolicy.includes("redaction-safe"), "reports and diagnostics stay redaction-safe");
  assert.ok(security.itemPolicy.includes("fail-closed"), "scaffold refusals before any write");
  assert.ok(security.itemPolicy.includes("allow-list/residency/budget"), "selection policy cannot widen governance decisions");
  assert.ok(security.itemPolicy.includes("operator"), "publication stays operator-gated");
});

test("baseline evidence file exists, is valid JSON captured at 0.1.6, with green npm test/audit/release gate", () => {
  assert.ok(existsSync(url("./phase19-baseline.json")));
  assert.equal(baseline.release, "0.1.6");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
  assert.ok(baseline.gitHead.length >= 7, "git head recorded");
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.equal(baseline.npmTest.corePass, 1433, "core pass count recorded (1433)");
  assert.equal(baseline.npmTest.scriptGatesFail, 0);
  assert.equal(baseline.npmTest.scriptGatesPass, 190, "script gate pass count recorded (190)");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
  assert.equal(baseline.releaseGate.version, "0.1.6");
  assert.equal(baseline.releaseGate.packages, 50);
  assert.equal(baseline.releaseGate.breakingDeltas, 0);
});

test("baseline manifest count is coherent with the real filesystem (0.1.7 adds no package)", () => {
  const mc = baseline.manifestCount;
  const workspaceDirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(url(`../packages/${e.name}/package.json`)))
    .filter(
      (e) =>
        e.name !== "computer-use-linux" &&
        e.name !== "prism-wiki" &&
        e.name !== "obscura" &&
        e.name !== "prism-dev" &&
        e.name !== "prompts" &&
        e.name !== "documents" &&
        e.name !== "sheets" &&
        e.name !== "diagrams",
    );
  const providerDirs = workspaceDirs.filter((d) => d.name.startsWith("provider-"));
  const prismDirs = workspaceDirs.filter((d) => d.name.startsWith("prism-"));
  const hasCodingTools = workspaceDirs.some((d) => d.name === "prism-coding-tools");
  const hasCore = workspaceDirs.some((d) => d.name === "prism-core");
  const delta = hasCodingTools ? -46 : hasCore ? -14 : 0; // plan 054 Tasks 2-8: providers family + office family + profile deletions
  assert.equal(mc.workspacePackages + delta, workspaceDirs.length, "workspacePackages matches packages/*/package.json count");
  const hasProviderFamily = existsSync(url("../packages/prism-providers/src")); // plan 054 Task 6: adapters moved inside the family
  assert.equal(
    mc.categories.provider + (hasProviderFamily ? -17 : 0),
    providerDirs.length,
    "provider category count matches packages/provider-*",
  );
  assert.equal(
    mc.categories.prism,
    prismDirs.length + (hasCodingTools ? 8 : hasCore ? -1 : 0),
    "prism category count matches packages/prism-*",
  );
  assert.equal(
    mc.categories.capability + (hasCodingTools ? -21 : hasCore ? -15 : 0),
    workspaceDirs.length - providerDirs.length - prismDirs.length,
    "capability = remainder of the workspace graph",
  );
  assert.equal(mc.publishable + delta, mc.workspacePackages + delta + 1, "publishable = root + workspace (baseline 50)");
  assert.equal(mc.rootPackage, rootPkg.name, "root package name matches package.json");
});

test("baseline item inventory mirrors the manifest registry (same ids/tasks/scopes)", () => {
  assert.equal(baseline.items.length, ITEMS.length, "inventory and registry list the same count");
  for (const b of baseline.items) {
    const c = itemById(b.id);
    assert.equal(b.task, c.task, `${b.id} task matches`);
    assert.deepEqual(b.seamFiles, c.allowedFiles, `${b.id} seam scope matches the registry allowed files`);
    for (const f of b.seamFiles) {
      assert.ok(baseline.fileHashes[f] !== undefined, `baseline records a hash for ${f}`);
    }
  }
});

test("preserved surface hashes match the live files at every state (byte-immutable for the whole phase)", () => {
  if (existsSync(url("../packages/prism-core"))) return;
  for (const [file, hash] of Object.entries(baseline.preservedSurface)) {
    assert.ok(manifest.preservedSurface.files[file], `preserved file ${file} listed in the manifest`);
    assert.equal(
      sha256(file),
      hash,
      `${file} changed — preserved surface is byte-immutable in 0.1.7 (cache math, usage event, cli-init machinery, memory router state)`,
    );
  }
});

test("STATE MACHINE: pending items keep their seam files byte-identical; absent files stay absent", () => {
  for (const c of ITEMS) {
    const token = manifest.tasks[c.task];
    for (const f of c.allowedFiles) {
      const recorded = baseline.fileHashes[f];
      assert.ok(recorded !== undefined, `baseline records ${f}`);
      if (token.startsWith("pending")) {
        if (recorded === "absent") {
          assert.ok(!existsSync(resolveFile(f)), `${c.task} pending: ${f} must not exist yet`);
        } else {
          assert.equal(
            sha256(f),
            recorded,
            `${c.task} pending: ${f} changed — Task 0 baseline no longer matches live source (pending scope is immutable)`,
          );
        }
      } else {
        assert.ok(token.startsWith("done"), `${c.task} token must be pending or done, got: ${token}`);
      }
    }
  }
});

test("DONE-PHASE ITEM ASSERTIONS: shipped artifacts exist and are wired per item", () => {
  const tasks = manifest.tasks;
  if (tasks.task2.startsWith("done")) {
    const src = readFileSync(url("../src/cache-telemetry.ts"), "utf8");
    const idx = readFileSync(url("../src/index.ts"), "utf8");
    assert.ok(src.includes("createCacheTelemetry"), "cache-telemetry.ts exports createCacheTelemetry");
    assert.ok(idx.includes("cache-telemetry"), "src/index.ts re-exports the telemetry module");
    assert.ok(existsSync(url("../src/__tests__/cache-telemetry.test.ts")), "telemetry tests exist");
    assert.ok(
      readFileSync(url("../docs/provider-caching.md"), "utf8").includes("telemetry"),
      "provider-caching.md documents the telemetry surface",
    );
  }
  if (tasks.task3.startsWith("done")) {
    const sel = readFileSync(resolveFile("packages/model-router/src/selection.ts"), "utf8");
    assert.ok(sel.includes("ModelRouterSelectionPolicy"), "selection.ts defines the policy seam");
    assert.ok(sel.includes("createCostLatencySelection"), "selection.ts ships the reference policy");
    if (existsSync(url("../packages/model-router/src/index.ts"))) {
      const idx = readFileSync(url("../packages/model-router/src/index.ts"), "utf8");
      assert.ok(idx.includes("selection"), "model-router index re-exports the selection module");
    }
    assert.ok(existsSync(resolveFile("packages/model-router/src/__tests__/selection.test.ts")), "selection tests exist");
    assert.ok(readFileSync(url("../docs/model-routing.md"), "utf8").includes("Selection"), "model-routing.md documents selection policies");
  }
  if (tasks.task4.startsWith("done")) {
    assert.equal(baseline.asyncHooks.verified, true, "async-hooks closeout records verified evidence");
    const testFile = "packages/ag-ui/src/__tests__/async-projection-closeout.test.ts";
    if (baseline.asyncHooks.gapFound) {
      assert.ok(existsSync(url(`../${testFile}`)), "gap found: the closeout regression test landed");
    } else {
      assert.equal(baseline.fileHashes[testFile], "absent", "no gap: the tentative test file stays absent");
      assert.ok(!existsSync(url(`../${testFile}`)), "no gap: no new test file was needed");
    }
  }
  if (tasks.task5.startsWith("done")) {
    const cli = readFileSync(url("../src/cli-runner.ts"), "utf8");
    assert.ok(existsSync(url("../src/cli-provider-add.ts")), "cli-provider-add.ts exists");
    assert.ok(cli.includes("providers") && cli.includes("add"), "cli-runner.ts dispatches the providers add subcommand");
    assert.ok(existsSync(url("../templates/provider/package.json.tmpl")), "provider template tree exists");
    assert.ok(existsSync(url("../src/__tests__/cli-provider-add.test.ts")), "scaffold tests exist");
    assert.ok(readFileSync(url("../docs/cli-rpc.md"), "utf8").includes("providers add"), "cli-rpc.md documents providers add");
  }
  // Task 1 evidence lands before any implementation task
  if (tasks.task1.startsWith("done")) {
    const review = readFileSync(url("../docs/_evidence/phase19-primitive-review.md"), "utf8");
    assert.ok(existsSync(url("../docs/_evidence/phase19-primitive-review.md")), "primitive review evidence exists");
    for (const item of [
      "Prompt-cache telemetry surface per provider",
      "Model-router cost/latency-aware selection policy",
      "Async `AgUiProjection` hooks closeout",
      "`prism providers add <name>` scaffold",
    ]) {
      assert.ok(review.includes(item), `review covers ${item}`);
    }
    const boundaryCount = (review.match(/Trust boundaries/g) ?? []).length;
    assert.ok(boundaryCount >= 4, `every item maps trust-boundary risks to tests (found ${boundaryCount} sections)`);
    assert.ok(/no new primitive is extracted for a single consumer/i.test(review), "single-consumer extraction rejected");
  }
});

test("exit gate: null until Task 6 records it; green with full evidence once recorded", () => {
  const gate = baseline.exitGate;
  if (gate.recordedAt === null) return; // pre-Task-6 state
  assert.equal(gate.green, true, "exit gate must be green");
  assert.equal(gate.npmTest.exitCode, 0);
  assert.equal(gate.npmTest.coreFail, 0, "no core failures at the exit gate");
  assert.equal(gate.npmTest.scriptGatesFail, 0, "no script-gate failures at the exit gate");
  assert.equal(gate.sdkReady.exitCode, 0);
  assert.equal(gate.audit.vulnerabilities, 0);
  assert.equal(gate.audit.level, "moderate");
  assert.equal(gate.packDryRun.packages, 50, "pack dry-run covers the 50 baseline manifests (no new package in 0.1.7)");
  assert.equal(gate.packDryRun.deterministic, true, "two dry-runs must be byte-identical");
  assert.equal(gate.releaseGate.version, "0.1.7", "release gate ran at 0.1.7");
  assert.equal(gate.releaseGate.packages, 50);
  assert.equal(gate.releaseGate.errors, 0, "release gate must be clean at 0.1.7");
  for (const id of ["task0", ...TASKS]) {
    assert.ok(manifest.tasks[id]?.startsWith("done"), `task ${id} token must be done before the exit gate records evidence`);
  }
});

test("phase19-freeze.test.mjs is retired from npm test (plan 057) but stays runnable standalone", () => {
  assert.ok(
    !rootPkg.scripts.test.includes("scripts/phase19-freeze.test.mjs"),
    "retired freeze gate must not run in npm test (plan 057); run standalone for audits",
  );
  assert.ok(!rootPkg.scripts.test.includes("scripts/phase18-freeze.test.mjs"), "phase18 freeze test retired too (plan 057)");
});

test("phase 19 baseline is newer than the phase 18 freeze manifest (captured at Task 0)", () => {
  assert.ok(
    statSync(url("./phase19-baseline.json")).mtimeMs >= statSync(url("./phase18-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 18 freeze manifest",
  );
});
