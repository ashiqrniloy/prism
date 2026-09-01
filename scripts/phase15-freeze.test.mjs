/**
 * Phase 15 (0.1.3) Task 0 dead-code/deprecation-hygiene scope gate (plan 015 Task 0).
 * Validates scripts/phase15-freeze-manifest.json: the 0.1.3 release/line/type,
 * the allowed hygiene changes vs the forbidden core/package/0.1.4+/0.2.0 items,
 * the additive-only compat promise, the audit/signed-tag/provenance policy, the
 * per-task evidence tokens, and the hygiene-freeze deviation log. Also validates
 * scripts/phase15-baseline.json coherence against the real filesystem (workspace/
 * provider/prism package counts, benchmark-runner inventory vs the live legs of
 * scripts/benchmark-0.1.0.mjs) and the frozen 0.1.2 evidence, so the baseline
 * used for regression comparison at the Task 5 exit gate is truthful. This is a
 * scope gate, not a release-contract support matrix; the 0.1.x support matrix
 * stays frozen at scripts/phase12-freeze-manifest.json.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { packedFilePaths } from "./release-gates.mjs";

const url = (path) => new URL(path, import.meta.url);
// Task 1 (0.2.5) split contracts-core.ts + agent-session.ts into a barrel + a sibling
// family dir (src/contracts-core/*, src/agent-session/*). Read the module = barrel +
// family so "stays in <module>" assertions hold after the split.
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
const manifest = JSON.parse(readFileSync(url("./phase15-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase15-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

test("manifest targets release 0.1.3 on the 0.1.x hygiene line off the 0.1.2 baseline", () => {
  assert.equal(manifest.release, "0.1.3");
  assert.equal(manifest.line, "0.1.x");
  assert.equal(manifest.type, "dead-code-deprecation-hygiene");
  assert.ok(manifest.baseline.startsWith("0.1.2"), "baseline names 0.1.2");
});

test("hygiene freeze is active with the allowed changes and forbidden items", () => {
  const freeze = manifest.hygieneFreeze;
  assert.equal(freeze.active, true);
  assert.ok(freeze.allowedChanges.length >= 4, "allowed hygiene changes listed");
  for (const token of ["benchmark", "review-doc archive", "sweep", "checkpoint persistence", "package.json"]) {
    assert.ok(
      freeze.allowedChanges.some((c) => c.includes(token)),
      `allowed list names the ${token} change`,
    );
  }
  assert.ok(freeze.forbiddenChanges.length >= 6, "forbiddenChanges covers public-export/0.1.4+/0.2.0/dependency items");
  for (const token of [
    "public export",
    "0.1.4 items",
    "0.1.5 items",
    "0.1.6 items",
    "0.1.7 items",
    "0.2.0 items",
    "new packages",
    "new runtime or dev dependencies",
    "benchmark-*.json evidence file",
    "ponytail: comments",
  ]) {
    assert.ok(
      freeze.forbiddenChanges.some((c) => c.includes(token)),
      `forbidden list names ${token}`,
    );
  }
  // allowed and forbidden are disjoint (no hygiene change is also forbidden)
  const allowedSet = new Set(freeze.allowedChanges);
  for (const f of freeze.forbiddenChanges) {
    assert.ok(!allowedSet.has(f), `forbidden item also allowed: ${f}`);
  }
});

test("hygiene-freeze deviation log is a structured array, empty at freeze", () => {
  const { deviations } = manifest.hygieneFreeze;
  assert.ok(Array.isArray(deviations), "deviations is an array");
  assert.equal(deviations.length, 0, "deviation log is empty at freeze");
  for (const d of deviations) {
    assert.ok(typeof d.task === "string" && d.task.length > 0, "deviation names its task");
    assert.ok(typeof d.change === "string" && d.change.length > 0, "deviation describes the change");
    assert.ok(typeof d.rationale === "string" && d.rationale.length > 0, "deviation records the rationale");
  }
});

test("compat promise is additive-only against the 0.1.2 compat baseline", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.1.2");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("additive-only"), "0.1.x compat promise is additive-only");
  assert.ok(compat.promise.includes("zero breaking"), "0.1.3 bump targets zero breaking deltas");
});

test("support matrix stays frozen at the phase 12 manifest (0.1.3 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.1.3 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the six plan 015 tasks with Task 0 done and Tasks 1-5 pending-or-done", () => {
  const tasks = manifest.tasks;
  for (const id of ["task0", "task1", "task2", "task3", "task4", "task5"]) {
    assert.ok(typeof tasks[id] === "string" && tasks[id].length > 0, `${id} has a token`);
  }
  assert.ok(tasks.task0.startsWith("done"), "Task 0 is done at freeze");
  for (const id of ["task1", "task2", "task3", "task4", "task5"]) {
    assert.ok(
      tasks[id].startsWith("pending") || tasks[id].startsWith("done"),
      `${id} is pending until its task lands, then done with evidence`,
    );
  }
});

test("security policy inherits blocked-gate semantics, moderate audit, and opt-in ownership-scoped persistence", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy inherited");
  assert.ok(security.auditPolicy.includes("moderate"), "moderate audit policy");
  assert.ok(security.persistencePolicy.includes("opt-in"), "Task 4 persistence is opt-in");
  assert.ok(security.persistencePolicy.includes("ownership-scoped"), "Task 4 persistence is ownership-scoped");
  assert.ok(security.persistencePolicy.includes("never persisted"), "skill bodies/file contents never persisted");
});

test("baseline evidence file exists and is valid JSON captured at 0.1.2", () => {
  assert.ok(existsSync(url("./phase15-baseline.json")));
  assert.equal(baseline.release, "0.1.2");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
});

test("baseline npm test and audit evidence is green at 0.1.2", () => {
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.ok(baseline.npmTest.corePass >= 1420, "core pass count recorded (>= 1420)");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
});

test("baseline coverage is core-only and above the frozen thresholds", () => {
  const cov = baseline.coverage;
  assert.ok(cov.lines >= cov.thresholds.lines, "core lines above threshold");
  assert.ok(cov.functions >= cov.thresholds.functions, "core functions above threshold");
  assert.ok(cov.branches >= cov.thresholds.branches, "core branches above threshold");
  assert.ok(cov.scope.includes("packages/**") && cov.scope.includes("excludes"), "core-only scope documented (plan 010 compromise)");
});

test("baseline release gate is green at 0.1.2 with 49 packages and zero breaking deltas", () => {
  const gate = baseline.releaseGate;
  assert.equal(gate.version, "0.1.2");
  assert.equal(gate.packages, 49);
  assert.equal(gate.breakingDeltas, 0);
});

test("baseline manifest count is coherent with the real filesystem", () => {
  const mc = baseline.manifestCount;
  const workspaceDirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(url(`../packages/${e.name}/package.json`)))
    .filter(
      (e) =>
        e.name !== "computer-use-linux" &&
        e.name !== "antigravity-agent" &&
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
    "capability = remainder",
  );
  assert.equal(mc.publishable + delta, mc.workspacePackages + delta + 1, "publishable = root + workspace");
  assert.equal(mc.rootPackage, rootPkg.name, "root package name matches package.json");
});

test("baseline benchmark inventory is coherent with the post-Task-1 filesystem (runners absorbed or deleted, evidence kept)", () => {
  const inv = baseline.benchmarkInventory;
  const files = readdirSync(url("."))
    .filter((f) => /^benchmark-0\.0\./.test(f))
    .sort();
  // Task 0 audit classified every benchmark-0.0.* file; after Task 1 the
  // runners/tests are gone and only the evidence JSON remains on disk.
  for (const f of inv.liveLegs) {
    assert.ok(!files.includes(f), `live leg ${f} was absorbed into benchmark-scenarios/`);
  }
  for (const f of inv.orphanRunners) {
    assert.ok(!files.includes(f), `orphan runner ${f} was deleted`);
  }
  for (const f of inv.orphanTests) {
    assert.ok(!files.includes(f), `orphan test ${f} was deleted`);
  }
  for (const f of inv.workflowReferencedTests) {
    assert.ok(!files.includes(f), `workflow-referenced test ${f} was rewired and deleted`);
  }
  assert.ok(inv.evidenceJson.length >= 6, "evidence JSON files recorded (0.0.23-0.0.28)");
  for (const f of inv.evidenceJson) {
    assert.ok(files.includes(f), `evidence ${f} kept on disk`);
  }
  assert.deepEqual([...inv.evidenceJson].sort(), files, "only the evidence JSON files remain under benchmark-0.0.*");
  assert.equal(inv.currentRunner.length, 3, "current runner trio recorded (orchestrator + test + evidence)");
  for (const f of inv.currentRunner) {
    assert.ok(existsSync(url(`./${f}`)), `current runner file ${f} exists on disk`);
  }
  // the orchestrator composes scenarios by name through the parameterized runner
  const orchestrator = readFileSync(url("./benchmark-0.1.0.mjs"), "utf8");
  const legs = [...orchestrator.matchAll(/scenario: "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(legs.length, 6, "orchestrator names six scenarios");
  for (const leg of legs) {
    assert.ok(existsSync(url(`./benchmark-scenarios/${leg}.mjs`)), `scenario module ${leg} exists`);
  }
});

test("baseline releaseCheck records the dirty-tree block (clean v0.1.2 passes per plan 014)", () => {
  const check = baseline.releaseCheck;
  assert.equal(check.version, "0.1.2");
  assert.ok(check.status.includes("dirty"), "dirty-tree block recorded (Task 0 uncommitted files)");
  assert.ok(check.status.includes("plan 014"), "points at the plan 014 clean-tree green evidence");
});

test("orphaned benchmark runners are gone: no live reference to benchmark-0.0.{8..16} or the renamed legs remains", () => {
  const targets = [
    "package.json",
    ".github/workflows/sandbox-browser.yml",
    "scripts/budget-gates.mjs",
    "scripts/budget-gate.test.mjs",
    "scripts/budgets.json",
    "scripts/benchmark-0.1.0.mjs",
    "scripts/benchmark-0.1.0.test.mjs",
    "scripts/benchmark.mjs",
    "scripts/benchmark.test.mjs",
  ];
  const deleted = /benchmark-0\.0\.(8|9|1[0-6])(\.mjs|\.test\.mjs)/;
  const renamed = /benchmark-0\.0\.(2[3-8])\.mjs/;
  for (const file of targets) {
    const content = readFileSync(url(`../${file}`), "utf8");
    assert.ok(!deleted.test(content), `${file} still references a deleted benchmark-0.0.{8..16} runner`);
    assert.ok(!renamed.test(content), `${file} still references a renamed benchmark-0.0.{23..28}.mjs leg`);
  }
  // evidence JSON files stay (consumed by budget-gate.test.mjs)
  for (const f of baseline.benchmarkInventory.evidenceJson) {
    assert.ok(existsSync(url(`./${f}`)), `evidence ${f} kept`);
  }
});

test("phase-review docs are archived: zero at docs/ root, 12 in docs/_evidence, tarball-excluded, links resolved", () => {
  const rootFiles = readdirSync(url("../docs")).filter((f) => f.startsWith("review-coverage-"));
  assert.deepEqual(rootFiles, [], "docs/ root must carry no review-coverage-* files");
  const archived = readdirSync(url("../docs/_evidence"))
    .filter((f) => f.startsWith("review-coverage-"))
    .sort();
  assert.equal(archived.length, 12, "docs/_evidence/ must hold exactly 12 review-coverage files");
  for (const f of archived) {
    assert.ok(existsSync(url(`../docs/_evidence/${f}`)), `archived ${f} exists`);
  }
  // tarball exclusion: packed list has docs/index.md and zero _evidence entries
  const packed = packedFilePaths(process.cwd(), ".");
  assert.ok(packed.includes("docs/index.md"), "packed tarball must include docs/index.md");
  assert.ok(!packed.some((p) => p.includes("_evidence")), "packed tarball must exclude docs/_evidence");
  // link integrity: no markdown link targets a review-coverage file outside _evidence/
  for (const file of readdirSync(url("../docs")).filter((f) => f.endsWith(".md"))) {
    const content = readFileSync(url(`../docs/${file}`), "utf8");
    assert.ok(!/\]\(review-coverage-/.test(content), `${file} links a review-coverage file outside docs/_evidence/`);
  }
  // every relative markdown link in docs/ resolves to an existing file or dir
  for (const file of readdirSync(url("../docs")).filter((f) => f.endsWith(".md"))) {
    const content = readFileSync(url(`../docs/${file}`), "utf8");
    for (const m of content.matchAll(/\]\(([^)#]+)\.md\)/g)) {
      const target = m[1];
      if (/^(https?:|#)/.test(target)) continue;
      const resolved = new URL(`${target}.md`, url(`../docs/${file}`));
      assert.ok(existsSync(resolved), `${file} links missing ${target}`);
    }
  }
});

test("sweep is non-blocking and isolated: sweep:unused exists, npm test never runs it, CI step is continue-on-error", () => {
  assert.ok(rootPkg.scripts["sweep:unused"], "package.json must define sweep:unused");
  assert.ok(rootPkg.scripts["sweep:unused"].includes("scripts/sweep-unused.mjs"), "sweep:unused runs the driver");
  assert.ok(!rootPkg.scripts.test.includes("sweep:unused"), "npm test must not run the sweep (non-blocking gate isolation)");
  const workflow = readFileSync(url("../.github/workflows/sandbox-browser.yml"), "utf8");
  assert.ok(workflow.includes("npm run sweep:unused"), "CI runs the sweep");
  assert.ok(workflow.includes("continue-on-error: true"), "CI sweep step is non-blocking");
  assert.ok(workflow.includes("unused-sweep-report"), "CI archives the sweep report");
  const release = readFileSync(url("../.github/workflows/release.yml"), "utf8");
  assert.ok(!release.includes("sweep:unused"), "release workflow stays untouched by the sweep");
});

test("opt-in checkpoint persistence (Task 4): seams present, opt-in default off, bounded, docs updated", () => {
  // 0.1.4 split: contracts live in the split modules behind the contracts.ts barrel.
  const contracts = ["contracts-core.ts", "contracts-run-state.ts", "contracts-protocol.ts"]
    .map((f) => readFileSync(url(`../src/${f}`), "utf8"))
    .join("\n");
  const runState = readFileSync(url("../src/agent-run-state.ts"), "utf8");
  // 0.1.4 agents split: the session runtime moved to agent-session.ts.
  const agents = readModule("../src/agent-session.ts");
  const lifecycle = readFileSync(url("../src/agent-run-lifecycle.ts"), "utf8");
  const rps = readFileSync(
    existsSync(url("../packages/coding-agent/src/read-path-set.ts"))
      ? url("../packages/coding-agent/src/read-path-set.ts")
      : url("../packages/prism-coding-tools/src/agent/read-path-set.ts"),
    "utf8",
  );
  const rpsIndex = readFileSync(
    existsSync(url("../packages/coding-agent/src/index.ts"))
      ? url("../packages/coding-agent/src/index.ts")
      : url("../packages/prism-coding-tools/src/agent/index.ts"),
    "utf8",
  );
  // Core: opt-in flag on run/resume/lifecycle options, optional stored field, bounds.
  assert.ok(contracts.includes("persistSessionState?: boolean"), "persistSessionState option on core run options");
  // 0.1.3 token; the optional block gained the additive loadedSkillBodies field at 0.1.6 (plan 018 closeout
  // checkpoint-bodies) — both fields stay optional and absent by default.
  assert.ok(runState.includes("readonly sessionState?: {"), "optional stored sessionState");
  assert.ok(runState.includes("readonly loadedSkillNames?: readonly string[]"), "stored skill-name catalog");
  assert.ok(runState.includes("readonly loadedSkillBodies?: readonly LoadedSkillBodiesEntry[]"), "stored skill bodies (0.1.6)");
  assert.ok(runState.includes("MAX_PERSISTED_SKILL_NAMES = 64"), "skill-name count cap");
  assert.ok(runState.includes("MAX_PERSISTED_SKILL_NAME_CHARS = 256"), "skill-name char cap");
  assert.ok(agents.includes("restoreLoadedSkills"), "resume re-adds names into the session catalog");
  assert.ok(lifecycle.includes("persistSessionState: request.persistSessionState"), "lifecycle adapter plumbs the flag");
  // Coding-agent: additive persistence helper over the host CheckpointStore.
  assert.ok(rps.includes("createReadPathSetPersistence"), "read-path persistence helper exists");
  assert.ok(rps.includes("DEFAULT_MAX_PERSISTED_READ_PATHS = 1024"), "read-path count cap");
  assert.ok(rps.includes("DEFAULT_MAX_PERSISTED_READ_PATH_CHARS = 1024"), "read-path char cap");
  assert.ok(rpsIndex.includes("createReadPathSetPersistence"), "helper exported from the coding-agent index");
  // Docs reflect the opt-in contract.
  const skills = readFileSync(url("../docs/context-and-skills.md"), "utf8");
  const tools = readFileSync(url("../docs/coding-agent-tools.md"), "utf8");
  const runtime = readFileSync(url("../docs/agent-session-runtime.md"), "utf8");
  assert.ok(skills.includes("persistSessionState"), "context-and-skills documents the opt-in");
  assert.ok(skills.includes("Bodies are never persisted"), "docs state bodies reload via the registry");
  assert.ok(tools.includes("createReadPathSetPersistence"), "coding-agent-tools documents the helper");
  assert.ok(runtime.includes("persistSessionState: true"), "agent-session-runtime documents the flag");
});

test("exit-gate evidence (Task 5) is recorded in the baseline, green, and post-dates the task tokens", () => {
  const baseline = JSON.parse(readFileSync(url("../scripts/phase15-baseline.json"), "utf8"));
  const gate = baseline.exitGate;
  assert.ok(gate, "baseline has an exitGate block");
  assert.equal(gate.version, "0.1.3", "exit gate targets 0.1.3");
  for (const key of [
    "docsTripwires",
    "npmTest",
    "coverage",
    "audit",
    "releaseGate",
    "releaseCheck",
    "sdkReady",
    "publishDryRun",
    "benchmark",
  ]) {
    assert.ok(gate[key] && Object.keys(gate[key]).length > 0, `exitGate.${key} is populated`);
  }
  assert.equal(gate.npmTest.exitCode, 0);
  assert.equal(gate.sdkReady.exitCode, 0);
  assert.equal(gate.audit.vulnerabilities, 0);
  assert.equal(gate.releaseGate.breakingDeltas, 0, "additive-only compat at the exit gate");
  assert.equal(gate.publishDryRun.packages, 49);
  assert.equal(gate.docsTripwires.pass, gate.docsTripwires.tests);
  // The baseline's exit gate post-dates the freeze: captured field is set and task5 token is done.
  assert.ok(baseline.captured, "baseline captured date present");
  assert.ok(manifest.tasks.task5.startsWith("done"), "Task 5 token is done before the exit-gate leg passes");
});

test("phase 15 baseline file is newer than the phase 14 freeze manifest (captured at Task 0)", () => {
  assert.ok(
    statSync(url("./phase15-baseline.json")).mtimeMs >= statSync(url("./phase14-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 14 freeze",
  );
});
