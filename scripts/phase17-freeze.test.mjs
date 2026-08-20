/**
 * Phase 17 (0.1.5) Task 0 deprecated-option-removal scope gate (plan 017 Task 0).
 * Validates scripts/phase17-freeze-manifest.json: the 0.1.5 release/line/type,
 * the removal freeze (exact removed symbols with task/owner/replacement, the
 * explicitly preserved surface, the corrected roadmap labels, allowed/forbidden
 * changes, deviation log), the documented-breaking compat flow (--allow-break
 * break report before reviewed baseline regeneration of the three affected
 * baselines), the audit/signed-tag/provenance policy, and the per-task evidence
 * tokens. Validates scripts/phase17-baseline.json coherence against the real
 * filesystem and the live source.
 *
 * PRE-REMOVAL STATE (Task 0) -> REMOVAL STATE MACHINE (Tasks 1-3, landing):
 * while a task token is 'pending' its removed symbols must be PRESENT in the
 * owner scope at the recorded line (pre-removal truth — the freeze test fails
 * if someone deletes a symbol before flipping its task token); once a task
 * token is 'done' its removed symbols must be ABSENT from the owner scope while
 * the preserved surface in that owner stays present. This direct owner-scoped
 * scan is required because scripts/release-gates.mjs normalizes interface
 * signatures only to the opening brace and cannot alone detect removed
 * interface members. File hashes in the baseline hold while their owning task
 * is pending and are skipped once that task lands (the files legitimately
 * change). Task 4 flips the compat-baseline legs: while pending, the root
 * baseline must still list INIT_PROVIDERS and listInitProviders; once done, it
 * must list only listInitProviders.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const url = (path) => new URL(path, import.meta.url);
// Task 1 (0.2.5) split contracts-core.ts + agent-session.ts into a barrel + a sibling
// family dir. Read the module = barrel + family so "stays in <module>" assertions hold.
function readModule(rel) {
  const abs = fileURLToPath(url(rel));
  let text = readFileSync(abs, "utf8");
  const dir = abs.replace(/\.ts$/, "");
  try {
    if (statSync(dir).isDirectory()) {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !entry.includes("__tests__")) {
          text += `\n${readFileSync(join(dir, entry), "utf8")}`;
        }
      }
    }
  } catch {
    /* no sibling family dir */
  }
  return text;
}
const manifest = JSON.parse(readFileSync(url("./phase17-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase17-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

const REMOVED = baseline.deprecatedInventory;
const TASKS = ["task1", "task2", "task3", "task4"];

/** Extract the body of `export interface <owner> { ... }` from a source file; module-scope owners scan the whole file. */
function ownerScope(owner, file) {
  const src = readModule(`../${file}`);
  const m = src.match(new RegExp(`export interface ${owner}\\s*\\{`));
  if (!m) return src; // module-scope owner (const/CLI flag/export surface) — whole file is the scope
  // walk braces from the interface opening to the matching close at depth 0
  let depth = 0;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  assert.fail(`unterminated interface ${owner} in ${file}`);
}

const OWNER_FILE = {
  ProviderRequest: "src/contracts-core.ts",
  RunOptions: "src/contracts-protocol.ts",
  AgentConfig: "src/contracts-core.ts",
  RunLimits: "src/contracts-core.ts",
  LoopContext: "src/contracts-core.ts",
  ReadToolOptions: "packages/coding-agent/src/read.ts",
  "packages/coding-agent index": "packages/coding-agent/src/index.ts",
  "src/cli-init.ts": "src/cli-init.ts",
  "src/cli-runner.ts": "src/cli-runner.ts",
  ObservationalMemorySettingsInput: "packages/compaction-observational-memory/src/settings.ts",
  ObservationalMemoryRuntimeOptions: "packages/compaction-observational-memory/src/runtime.ts",
  CreateObservationalMemoryOptions: "packages/compaction-observational-memory/src/compose.ts",
};

function ownerFileFor(owner) {
  const file = OWNER_FILE[owner];
  assert.ok(file, `no owner->file mapping for ${owner}`);
  return file;
}

test("manifest targets release 0.1.5 on the 0.1.x deprecated-option-removal line off the 0.1.4 baseline", () => {
  assert.equal(manifest.release, "0.1.5");
  assert.equal(manifest.line, "0.1.x");
  assert.equal(manifest.type, "deprecated-option-removal");
  assert.ok(manifest.baseline.startsWith("0.1.4"), "baseline names 0.1.4");
});

test("removal freeze is active with corrected roadmap labels, exact removals, and the preserved surface", () => {
  const freeze = manifest.removalFreeze;
  assert.equal(freeze.active, true);
  // corrected roadmap labels: the deprecated alias lives on RunOptions, not AgentConfig;
  // transformImage and listInitProviders are the supported replacements (kept), not removal targets
  assert.ok(freeze.correctedRoadmapLabels.length >= 3, "three stale roadmap labels corrected");
  for (const token of [
    "RunOptions.maxToolRounds",
    "AgentConfig.limits.maxToolRounds",
    "autoResizeImages",
    "transformImage",
    "INIT_PROVIDERS",
    "listInitProviders",
  ]) {
    assert.ok(
      freeze.correctedRoadmapLabels.some((l) => l.includes(token)),
      `corrected-roadmap-labels names ${token}`,
    );
  }
  // exact removals: 20 symbols, each with task/owner/file/line/symbol/replacement
  const removals = freeze.exactRemovals;
  assert.equal(removals.length, 20, "exactly 20 removed symbols listed");
  for (const r of removals) {
    for (const key of ["task", "owner", "file", "line", "symbol", "replacement"]) {
      assert.ok(typeof r[key] === "string" || typeof r[key] === "number", `removal ${r.symbol} carries ${key}`);
    }
    assert.ok(TASKS.includes(r.task), `removal ${r.symbol} maps to a phase-17 task`);
    assert.ok(r.replacement.length > 0, `removal ${r.symbol} names a replacement`);
  }
  const removalKeys = new Set(removals.map((r) => `${r.owner}.${r.symbol}`));
  assert.equal(removalKeys.size, 20, "removed symbols are unique by owner");
  // preserved list is disjoint from the removals (same owner-scoped key space)
  const preserved = freeze.preserved;
  assert.ok(preserved.length >= 15, "preserved surface explicitly listed");
  for (const p of preserved) {
    assert.ok(!removalKeys.has(`${p.owner}.${p.symbol}`), `preserved ${p.owner}.${p.symbol} must not also be removed`);
  }
});

test("removal freeze: allowed and forbidden change lists are disjoint; deviations are structured", () => {
  const freeze = manifest.removalFreeze;
  assert.ok(freeze.allowedChanges.length >= 7, "allowed changes cover removal/refusal/migration/tests/docs/bump/baseline/wiring");
  for (const token of [
    "exactRemovals",
    "migration-refusal guards",
    "compile-time negative regression fixtures",
    "docs/migration.md 0.1.4 -> 0.1.5",
    "version bump 0.1.4 -> 0.1.5",
    "--allow-break",
    "phase17-freeze.test.mjs",
  ]) {
    assert.ok(
      freeze.allowedChanges.some((c) => c.includes(token)),
      `allowed list names ${token}`,
    );
  }
  assert.ok(
    freeze.forbiddenChanges.length >= 9,
    "forbiddenChanges covers preserved-surface/behavior/silent-ignore/0.1.6+/dependency/baseline items",
  );
  for (const token of [
    "preserved symbol",
    "behavior change",
    "silent ignore",
    "store, event, protocol",
    "new public exports",
    "0.1.6 items",
    "0.1.7 items",
    "0.2.0 items",
    "ponytail: comments",
  ]) {
    assert.ok(
      freeze.forbiddenChanges.some((c) => c.includes(token)),
      `forbidden list names ${token}`,
    );
  }
  const allowedSet = new Set(freeze.allowedChanges);
  for (const f of freeze.forbiddenChanges) {
    assert.ok(!allowedSet.has(f), `forbidden item also allowed: ${f}`);
  }
  const { deviations } = freeze;
  assert.ok(Array.isArray(deviations), "deviations is an array");
  for (const d of deviations) {
    assert.ok(typeof d.task === "string" && d.task.length > 0, "deviation names its task");
    assert.ok(typeof d.change === "string" && d.change.length > 0, "deviation describes the change");
    assert.ok(typeof d.rationale === "string" && d.rationale.length > 0, "deviation records the rationale");
  }
});

test("compat flow is the documented breaking cut: --allow-break break report, reviewed regeneration of the three affected baselines, then a normal gate", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.1.4");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("DOCUMENTED BREAKING"), "0.1.5 compat promise is the documented breaking cut");
  assert.ok(compat.promise.includes("--allow-break"), "promise names the --allow-break review flow");
  assert.ok(compat.promise.includes("migrationMentionsVersion"), "promise names the migration-mention gate behind --allow-break");
  assert.ok(compat.promise.includes("arnilo__prism.txt"), "promise scopes the root baseline regeneration");
  assert.ok(compat.promise.includes("arnilo__prism-coding-agent.txt"), "promise scopes the coding-agent baseline regeneration");
  assert.ok(
    compat.promise.includes("arnilo__prism-compaction-observational-memory.txt"),
    "promise scopes the observational-memory baseline regeneration",
  );
});

test("support matrix stays frozen at the phase 12 manifest (0.1.5 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.1.5 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the five plan 017 tasks with Task 0 done and Tasks 1-4 pending", () => {
  const tasks = manifest.tasks;
  for (const id of ["task0", ...TASKS]) {
    assert.ok(typeof tasks[id] === "string" && tasks[id].length > 0, `${id} has a token`);
  }
  assert.ok(tasks.task0.startsWith("done"), "Task 0 is done at freeze");
  for (const id of TASKS) {
    assert.ok(
      tasks[id].startsWith("pending") || tasks[id].startsWith("done"),
      `${id} is pending until its task lands, then done with evidence`,
    );
  }
});

test("security policy inherits blocked-gate semantics, moderate audit, and fail-closed removal refusal", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy inherited");
  assert.ok(security.auditPolicy.includes("moderate"), "moderate audit policy");
  assert.ok(security.removalPolicy.includes("fail-closed"), "removed behavior-affecting keys are refused fail-closed");
  assert.ok(security.removalPolicy.includes("never silently ignored"), "no silent ignore");
  assert.ok(security.removalPolicy.includes("never silently widened"), "no silent limit widening");
  assert.ok(security.removalPolicy.includes("cross-tenant isolation"), "adversarial suites stay untouched");
});

test("baseline evidence file exists, is valid JSON captured at 0.1.4, with green npm test/audit/release gate", () => {
  assert.ok(existsSync(url("./phase17-baseline.json")));
  assert.equal(baseline.release, "0.1.4");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
  assert.ok(baseline.gitHead.length >= 7, "git head recorded");
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.equal(baseline.npmTest.corePass, 1426, "core pass count recorded (1426)");
  assert.equal(baseline.npmTest.scriptGatesFail, 0);
  assert.equal(baseline.npmTest.scriptGatesPass, 153, "script gate pass count recorded (153)");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
  assert.equal(baseline.releaseGate.version, "0.1.4");
  assert.equal(baseline.releaseGate.packages, 49);
  assert.equal(baseline.releaseGate.breakingDeltas, 0);
});

test("baseline manifest count is coherent with the real filesystem", () => {
  const mc = baseline.manifestCount;
  const workspaceDirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(url(`../packages/${e.name}/package.json`)))
    .filter((e) => e.name !== "computer-use-linux" && e.name !== "antigravity-agent");
  const providerDirs = workspaceDirs.filter((d) => d.name.startsWith("provider-"));
  const prismDirs = workspaceDirs.filter((d) => d.name.startsWith("prism-"));
  assert.equal(mc.workspacePackages, workspaceDirs.length, "workspacePackages matches packages/*/package.json count");
  assert.equal(mc.categories.provider, providerDirs.length, "provider category count matches packages/provider-*");
  assert.equal(mc.categories.prism, prismDirs.length, "prism category count matches packages/prism-*");
  assert.equal(mc.categories.capability, workspaceDirs.length - providerDirs.length - prismDirs.length, "capability = remainder");
  assert.equal(mc.publishable, mc.workspacePackages + 1, "publishable = root + workspace");
  assert.equal(mc.rootPackage, rootPkg.name, "root package name matches package.json");
});

test("baseline deprecated inventory mirrors the manifest exactRemovals (same task/symbol set)", () => {
  assert.equal(REMOVED.length, manifest.removalFreeze.exactRemovals.length, "inventory and manifest list the same count");
  const inv = new Map(REMOVED.map((r) => [`${r.task}:${r.owner}.${r.symbol}`, r]));
  for (const r of manifest.removalFreeze.exactRemovals) {
    assert.ok(inv.has(`${r.task}:${r.owner}.${r.symbol}`), `inventory records ${r.task} ${r.owner}.${r.symbol}`);
  }
});

test("REMOVAL STATE MACHINE: pending tasks keep their removed symbols present at the recorded line; done tasks remove them from the owner scope", () => {
  for (const r of REMOVED) {
    const scope = ownerScope(r.owner, r.file);
    const line = readFileSync(url(`../${r.file}`), "utf8").split("\n")[r.line - 1];
    const token = manifest.tasks[r.task];
    if (token.startsWith("pending")) {
      assert.ok(
        scope.includes(r.symbol),
        `${r.task} pending: ${r.owner}.${r.symbol} must still be present in ${r.file} (pre-removal truth)`,
      );
      assert.ok(line?.includes(r.symbol), `${r.task} pending: ${r.file}:${r.line} must carry ${r.symbol}`);
    } else {
      assert.ok(token.startsWith("done"), `${r.task} token must be pending or done, got: ${token}`);
      assert.ok(!scope.includes(r.symbol), `${r.task} done: ${r.owner}.${r.symbol} must be ABSENT from the ${r.owner} scope in ${r.file}`);
    }
  }
});

test("Task 2 refusal surface: removed-key/alias TypeError messages exist in the OM sources and no deprecated marker remains", () => {
  const settingsSrc = readFileSync(url("../packages/compaction-observational-memory/src/settings.ts"), "utf8");
  const composeSrc = readFileSync(url("../packages/compaction-observational-memory/src/compose.ts"), "utf8");
  const runtimeSrc = readFileSync(url("../packages/compaction-observational-memory/src/runtime.ts"), "utf8");
  // settings.ts builds its messages from a template with the key interpolated;
  // assert the template exists and every removed key is listed in the frozen table.
  assert.ok(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal grep target for the frozen 0.1.5 removal-refusal template
    settingsSrc.includes('`Observational memory settings: "${key}" was removed in 0.1.5; use "${replacement}" instead`'),
    "settings.ts must carry the 0.1.5 removal refusal template",
  );
  for (const key of [
    "observeAfterTokens",
    "reflectAfterTokens",
    "compactAfterTokens",
    "keepRecentEntries",
    "recentMessageMaxTokens",
    "observationsPoolMaxTokens",
    "observationsPoolTargetTokens",
    "workerModel",
    "thinkingLevel",
    "requireExplicitModel",
  ]) {
    assert.ok(settingsSrc.includes(key), `settings.ts removed-key table must list ${key}`);
  }
  for (const alias of ["workerProvider", "workerModel"]) {
    assert.ok(
      composeSrc.includes(`"${alias}" was removed in 0.1.5`) && runtimeSrc.includes(`"${alias}" was removed in 0.1.5`),
      `compose.ts and runtime.ts must refuse the ${alias} alias`,
    );
  }
  for (const [file, src] of [
    ["settings.ts", settingsSrc],
    ["compose.ts", composeSrc],
    ["runtime.ts", runtimeSrc],
  ]) {
    assert.ok(!src.includes("@deprecated"), `${file} must not retain deprecated markers after Task 2`);
  }
});

test("preserved surface stays present in its owner scope (checked always — now and after removal)", () => {
  for (const p of baseline.preservedSurface) {
    if (p.present !== true) continue;
    const scope = ownerScope(p.owner, ownerFileFor(p.owner));
    assert.ok(scope.includes(p.symbol), `preserved ${p.owner}.${p.symbol} must remain present in its owner scope`);
  }
  // nested settings groups and active top-level settings must keep living inside ObservationalMemorySettingsInput
  const omScope = ownerScope("ObservationalMemorySettingsInput", "packages/compaction-observational-memory/src/settings.ts");
  for (const keep of ["observation", "reflection", "dropper", "context", "retrieval", "agentMaxTurns", "passive", "debugLog"]) {
    assert.ok(omScope.includes(keep), `ObservationalMemorySettingsInput keeps ${keep}`);
  }
  // the RunOptions scope keeps limits/signal/retry (the alias maxToolRounds is the only removal there)
  const runScope = ownerScope("RunOptions", "src/contracts-protocol.ts");
  for (const keep of ["limits", "signal", "retry"]) {
    assert.ok(runScope.includes(keep), `RunOptions keeps ${keep}`);
  }
});

test("Task 3 refusal surface: read.ts carries the autoResizeImages removal message, no deprecated marker remains, cli-init.ts drops the constant", () => {
  const readSrc = readFileSync(url("../packages/coding-agent/src/read.ts"), "utf8");
  const cliInitSrc = readFileSync(url("../src/cli-init.ts"), "utf8");
  assert.ok(
    readSrc.includes('"autoResizeImages" was removed in 0.1.5'),
    "read.ts must carry the 0.1.5 removal refusal naming transformImage",
  );
  assert.ok(!readSrc.includes("@deprecated"), "read.ts must not retain deprecated markers after Task 3");
  assert.ok(!cliInitSrc.includes("INIT_PROVIDERS"), "cli-init.ts must not retain the INIT_PROVIDERS constant after Task 3");
  assert.ok(!cliInitSrc.includes("@deprecated"), "cli-init.ts must not retain deprecated markers after Task 3");
  assert.ok(cliInitSrc.includes("export function listInitProviders"), "listInitProviders stays the single provider-list API");
});

test("compat-baseline legs: root baseline lists INIT_PROVIDERS + listInitProviders while task3 is pending; regeneration is Task 4's review step", () => {
  const rootBaseline = readFileSync(url("../scripts/compat-baseline/arnilo__prism.txt"), "utf8");
  assert.ok(rootBaseline.includes("listInitProviders"), "listInitProviders stays in the root compat baseline (preserved)");
  if (manifest.tasks.task3.startsWith("pending")) {
    assert.ok(rootBaseline.includes("INIT_PROVIDERS"), "INIT_PROVIDERS still in the root compat baseline pre-removal");
  } else if (manifest.tasks.task4.startsWith("pending")) {
    // removal done, but the reviewed baseline regeneration is Task 4; nothing to assert yet
    return;
  } else {
    assert.ok(!rootBaseline.includes("INIT_PROVIDERS"), "INIT_PROVIDERS removed from the root compat baseline");
  }
});

test("Task 0 file hashes hold while their owning task is pending (skip once the task lands and the file legitimately changes)", () => {
  const fileTask = {
    "src/contracts-core.ts": "task1",
    "src/contracts-protocol.ts": "task1",
    "packages/compaction-observational-memory/src/settings.ts": "task2",
    "packages/compaction-observational-memory/src/compose.ts": "task2",
    "packages/compaction-observational-memory/src/runtime.ts": "task2",
    "packages/coding-agent/src/read.ts": "task3",
    "src/cli-init.ts": "task3",
    "scripts/compat-baseline/arnilo__prism.txt": "task4",
    "scripts/compat-baseline/arnilo__prism-coding-agent.txt": "task4",
    "scripts/compat-baseline/arnilo__prism-compaction-observational-memory.txt": "task4",
  };
  for (const [file, task] of Object.entries(fileTask)) {
    if (!manifest.tasks[task].startsWith("pending")) continue; // task landed; file legitimately changed
    const recorded = baseline.fileHashes[file];
    assert.ok(recorded, `baseline records a Task 0 hash for ${file}`);
    const actual = createHash("sha256")
      .update(readFileSync(url(`../${file}`)))
      .digest("hex");
    assert.equal(actual, recorded, `${file} changed while ${task} is still pending — Task 0 baseline no longer matches live source`);
  }
});

test("exit gate: null until Task 4 records it; green with full evidence once recorded", () => {
  const gate = baseline.exitGate;
  if (gate === null) return; // pre-Task-4 state
  assert.equal(gate.green, true, "exit gate must be green");
  assert.equal(gate.npmTest.exitCode, 0);
  assert.equal(gate.npmTest.coreFail, 0, "no core failures at the exit gate");
  assert.equal(gate.npmTest.scriptGatesFail, 0, "no script-gate failures at the exit gate");
  assert.equal(gate.sdkReady.exitCode, 0);
  assert.equal(gate.audit.vulnerabilities, 0);
  assert.equal(gate.audit.level, "moderate");
  assert.equal(gate.packDryRun.packages, 49, "pack dry-run covers 49 packages");
  assert.equal(gate.packDryRun.deterministic, true, "two dry-runs must be byte-identical");
  assert.equal(gate.releaseGate.version, "0.1.5", "release gate ran at 0.1.5");
  assert.equal(gate.releaseGate.packages, 49);
  assert.equal(gate.releaseGate.errors, 0, "release gate must be clean at 0.1.5");
  for (const id of ["task0", "task1", "task2", "task3", "task4"]) {
    assert.ok(manifest.tasks[id]?.startsWith("done"), `task ${id} token must be done before the exit gate records evidence`);
  }
});

test("phase17-freeze.test.mjs is wired into the npm test script after phase 16 (Task 0 wiring)", () => {
  assert.ok(
    rootPkg.scripts.test.includes("scripts/phase17-freeze.test.mjs"),
    "package.json test script runs scripts/phase17-freeze.test.mjs",
  );
  assert.ok(
    rootPkg.scripts.test.indexOf("scripts/phase17-freeze.test.mjs") > rootPkg.scripts.test.indexOf("scripts/phase16-freeze.test.mjs"),
    "phase17 freeze test runs after phase16 freeze test",
  );
});

test("phase 17 baseline is newer than the phase 16 freeze manifest (captured at Task 0)", () => {
  // note: compared against the phase16 FREEZE MANIFEST (a stable artifact), not phase16-baseline.json,
  // which the tree-shake bench rewrites on every npm test run (its mtime always bounces later)
  assert.ok(
    statSync(url("./phase17-baseline.json")).mtimeMs >= statSync(url("./phase16-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 16 freeze manifest",
  );
});
