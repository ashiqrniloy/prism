/**
 * Phase 26 (0.2.6) Task 0 scope gate and per-task evidence state machine
 * (plan 026). Validates scripts/phase26-freeze-manifest.json against the live
 * repository and scripts/phase26-baseline.json: release/line/type, the nine
 * implementation items with disjoint single-editor allowed files, the demand
 * registry (gitlab-forge / bitbucket-forge deferred -> adapter source must be
 * absent; demanded -> named consumer recorded), the frozen state machines,
 * caps, errors, the T1-T8 threat model mapped to task tests, the additive-only
 * compat policy, the protected-gate policy (missing infrastructure records
 * blocked, never a passing skip), and the deviation log.
 *
 * STATE MACHINE:
 * - while an item's task token is 'pending', every single-editor file in its
 *   allowed scope must be byte-identical to the Task 0 baseline hash (files
 *   recorded as "absent" must not exist). Shared coordination files are not
 *   hash-locked; their per-editor content markers are asserted whenever the
 *   owning task is 'done';
 * - once a task token is 'done', the item assertions replace the hashes: the
 *   content markers are present in the shipped files, negative markers are
 *   absent, and the mapped security tests exist (test files that were absent
 *   at baseline must now exist);
 * - roadmap.md has a single editor (task8): byte-identical to the baseline
 *   hash while task8 is pending;
 * - the Task 8 exit gate is null until recorded; when recorded it must be
 *   green with all task tokens done, blocked false, and no deviation that
 *   weakens a frozen cap or the compat promise.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase26-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase26-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));
const plan = readFileSync(url("../plans/026-Release-0-2-6-Fully-Featured-Coding-Agent-Readiness.md"), "utf8");

const TASKS = ["task0", "task1", "task2", "task3", "task4", "task5", "task6", "task7", "task8"];
const ITEM_IDS = [
  "primitive-review",
  "pty-backend",
  "indexed-search",
  "workspace-lifecycle",
  "forge-breadth",
  "durable-recovery",
  "review-diagnostics",
  "coding-journey",
  "docs-bump-exit",
];

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
    "packages/coding-agent/": "packages/prism-coding-tools/src/agent/",
    "packages/coding-security/": "packages/prism-coding-tools/src/security/",
    "packages/document-reader/": "packages/prism-coding-tools/src/document-reader/",
    "packages/prism-openapi-tools/": "packages/prism-coding-tools/src/openapi/",
    "packages/computer-use-linux/": "packages/prism-coding-tools/src/computer-use-linux/",
    "packages/prism-dev/": "packages/prism-coding-tools/src/dev/",
    "packages/prism-caveman/": "packages/prism-coding-tools/src/caveman/",
    "packages/prism-ponytail/": "packages/prism-coding-tools/src/ponytail/",
    "packages/prism-impeccable/": "packages/prism-coding-tools/src/impeccable/",
  };
  for (const [prefix, target] of Object.entries(coreMap)) {
    if (file.startsWith(prefix)) {
      const rest = file.slice(prefix.length).replace(/^src\//, "");
      const cand = target + rest;
      if (existsSync(url(`../${cand}`))) return url(`../${cand}`);
      if (file.endsWith("CHANGELOG.md")) {
        if (target.includes("prism-coding-tools") && existsSync(url("../packages/prism-coding-tools/CHANGELOG.md"))) {
          return url("../packages/prism-coding-tools/CHANGELOG.md");
        }
        if (existsSync(url("../packages/prism-core/CHANGELOG.md"))) {
          return url("../packages/prism-core/CHANGELOG.md");
        }
      }
      if (file.endsWith("README.md")) {
        if (target.includes("prism-coding-tools") && existsSync(url("../packages/prism-coding-tools/README.md"))) {
          return url("../packages/prism-coding-tools/README.md");
        }
        if (existsSync(url("../packages/prism-core/README.md"))) {
          return url("../packages/prism-core/README.md");
        }
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

function itemById(id) {
  const found = manifest.items.find((item) => item.id === id);
  assert.ok(found, `item ${id} present in the registry`);
  return found;
}

test("manifest shape: release/line/type, items, tasks, threats, demand, policies", () => {
  assert.equal(manifest.release, "0.2.6");
  assert.equal(manifest.line, "0.2.x");
  assert.equal(manifest.type, "fully-featured-coding-agent-readiness");
  assert.deepEqual(
    manifest.items.map((item) => item.id),
    ITEM_IDS,
  );
  assert.deepEqual(
    manifest.items.map((item) => item.task),
    TASKS,
  );
  assert.deepEqual(Object.keys(manifest.tasks), TASKS);
  for (const token of Object.values(manifest.tasks)) assert.ok(["done", "pending"].includes(token));
  assert.ok(Array.isArray(manifest.deviations), "deviations log exists");
  assert.ok(manifest.compatPolicy.additiveOnly, "additive-only compat");
  assert.equal(manifest.compatPolicy.removedOrChanged, 0);
  assert.equal(manifest.compatPolicy.allowBreakUsed, false);
  assert.ok(manifest.protectedPolicy.requiredSurfaces.length >= 5, "protected surfaces listed");
  assert.ok(manifest.protectedEnvs.length >= 5, "protected env names listed (names only, never values)");
  assert.ok(
    manifest.stateMachines.pty &&
      manifest.stateMachines.index &&
      manifest.stateMachines.workspace &&
      manifest.stateMachines.processRecovery &&
      manifest.stateMachines.review &&
      manifest.stateMachines.cancellation,
  );
  assert.ok(
    manifest.frozenCaps.terminal &&
      manifest.frozenCaps.index &&
      manifest.frozenCaps.workspace &&
      manifest.frozenCaps.recovery &&
      manifest.frozenCaps.review &&
      manifest.frozenCaps.journey,
  );
  assert.ok(manifest.frozenErrors.existing.includes("ERR_PRISM_PROCESS_PTY_UNSUPPORTED"));
  assert.ok(manifest.frozenErrors.new.length >= 5);
  assert.equal(
    manifest.supportMatrix,
    "frozen at scripts/phase12-freeze-manifest.json (0.1.x compatibility and support matrix: Node, PostgreSQL, platform, provider, protocol pins, unsupported combinations); 0.2.6 changes none of it",
  );
});

test("Task 0 state: baseline captured, primitive review shipped, freeze test wired", () => {
  assert.equal(manifest.tasks.task0, "done", "task0 token done");
  assert.equal(baseline.baselineRelease, "0.2.5");
  assert.equal(baseline.release, "0.2.6");
  assert.ok(baseline.inherited.npmTest && baseline.inherited.coverage, "0.2.5 exit figures inherited");
  if (manifest.tasks.task8 === "pending") {
    assert.ok(baseline.exitGate === null, "exitGate null until Task 8");
  } else {
    assert.ok(baseline.exitGate?.green === true, "exitGate green at Task 8");
  }
  for (const file of [
    "docs/_evidence/phase26-primitive-review.md",
    "scripts/phase26-freeze-manifest.json",
    "scripts/phase26-baseline.json",
    "scripts/phase26-baseline.mjs",
    "scripts/phase26-freeze.test.mjs",
  ]) {
    assert.ok(existsSync(resolveFile(file)), `${file} exists`);
  }
  const review = readFileSync(url("../docs/_evidence/phase26-primitive-review.md"), "utf8");
  for (const marker of itemById("primitive-review").markers["docs/_evidence/phase26-primitive-review.md"])
    assert.ok(review.includes(marker), `primitive review contains ${marker}`);
  for (const negative of itemById("primitive-review").negativeMarkers["docs/_evidence/phase26-primitive-review.md"])
    assert.ok(!review.includes(negative), `primitive review avoids markdown links (${negative})`);
});

test("pending items are byte-identical to the Task 0 baseline (single-editor files)", () => {
  for (const item of manifest.items) {
    const token = manifest.tasks[item.task];
    for (const file of item.allowedFiles) {
      const editors = Object.entries(manifest.sharedFiles).filter(([, markers]) => markers[item.task]);
      if (editors.some(([sharedFile]) => sharedFile === file)) continue; // shared coordination file: marker-checked, not hash-locked
      const seam = baseline.seams[file];
      assert.ok(seam, `baseline records seam ${file} (item ${item.id})`);
      const regenerated = file in (manifest.regeneratedFiles ?? {});
      if (token === "pending") {
        if (seam.status === "absent") assert.ok(!existsSync(resolveFile(file)), `${file} must stay absent while ${item.task} is pending`);
        else if (regenerated) {
          assert.ok(existsSync(resolveFile(file)), `${file} present (chain-regenerated, hash not locked)`);
        } else if (file === "roadmap.md" && isRoadmapExempted()) {
          // coordination exemption: working tree is exactly a recorded user-authored roadmap edit
        } else assert.equal(sha256(file), seam.sha256, `${file} byte-identical while ${item.task} is pending (task0 baseline)`);
      } else {
        for (const marker of item.markers[file] ?? []) {
          assert.ok(readFileSync(resolveFile(file), "utf8").includes(marker), `${file} contains marker ${marker} (${item.task} done)`);
        }
        for (const negative of item.negativeMarkers?.[file] ?? []) {
          if (!negative) continue;
          assert.ok(!readFileSync(resolveFile(file), "utf8").includes(negative), `${file} avoids negative marker ${negative}`);
        }
      }
    }
  }
});

test("roadmap.md is byte-identical while task8 is pending (single editor)", () => {
  const seam = baseline.seams["roadmap.md"];
  assert.ok(seam, "baseline records roadmap.md");
  if (manifest.tasks.task8 === "pending") {
    if (!isRoadmapExempted()) {
      assert.equal(sha256("roadmap.md"), seam.sha256, "roadmap.md byte-identical while task8 is pending");
    }
  } else {
    for (const marker of itemById("docs-bump-exit").markers["roadmap.md"]) {
      assert.ok(readFileSync(url("../roadmap.md"), "utf8").includes(marker), `roadmap.md contains ${marker}`);
    }
  }
});

/** True when the current roadmap.md sha matches a recorded user-authored coordination exemption. */
function isRoadmapExempted() {
  const current = sha256("roadmap.md");
  const exemptions = manifest.coordination?.roadmapExemptions ?? [];
  for (const exemption of exemptions) {
    assert.match(exemption?.sha256 ?? "", /^[0-9a-f]{64}$/, "roadmap exemption sha256 is a hex sha");
    assert.ok(typeof exemption?.author === "string" && exemption.author.length > 0, "roadmap exemption records an author");
    assert.ok(typeof exemption?.reason === "string" && exemption.reason.length > 0, "roadmap exemption records a reason");
    if (exemption.sha256 === current) return true;
  }
  return false;
}

test("shared coordination markers: done tasks' markers present, pending tasks' plan checkboxes still open", () => {
  for (const [file, markersByTask] of Object.entries(manifest.sharedFiles)) {
    for (const [task, markers] of Object.entries(markersByTask)) {
      if (manifest.tasks[task] !== "done") continue;
      if (!existsSync(resolveFile(file))) {
        assert.fail(`shared file ${file} must exist once ${task} is done`);
      }
      const content = readFileSync(resolveFile(file), "utf8");
      const effective =
        file === "package.json"
          ? // gate-wiring markers for retired freeze tests (plan 057): absence is asserted by the dedicated wiring test
            markers.filter((m) => !(m.endsWith(".test.mjs") && !content.includes(m)))
          : markers;
      for (const marker of effective) assert.ok(content.includes(marker), `${file} contains marker ${marker} (${task} done)`);
    }
  }
  for (const task of TASKS) {
    const n = task.slice(4);
    if (manifest.tasks[task] === "pending") {
      assert.ok(plan.includes(`- [ ] Task ${n}`), `plan 026 keeps Task ${n} unchecked while pending`);
    } else {
      assert.ok(plan.includes(`- [x] Task ${n}`), `plan 026 marks Task ${n} done`);
    }
  }
});

test("demand registry: deferred adapters stay absent; demanded records a named consumer", () => {
  for (const key of ["gitlab-forge", "bitbucket-forge"]) {
    const entry = manifest.demand[key];
    assert.ok(entry, `demand entry ${key}`);
    assert.ok(["deferred", "demanded"].includes(entry.status));
  }
  const forgeBarrel = readFileSync(resolveFile("packages/coding-agent/src/forge/index.ts"), "utf8");
  for (const provider of ["gitlab", "bitbucket"]) {
    const entry = manifest.demand[`${provider}-forge`];
    const adapterFile = `packages/coding-agent/src/forge/${provider}.ts`;
    if (entry.status === "deferred") {
      assert.ok(!existsSync(resolveFile(adapterFile)), `${adapterFile} must not exist while deferred`);
      assert.ok(!forgeBarrel.toLowerCase().includes(provider), `forge barrel exports no ${provider} adapter while deferred`);
      assert.ok(entry.consumer === null, `deferred ${provider} has no consumer`);
    } else {
      assert.ok(entry.consumer?.host && entry.consumer?.date, `demanded ${provider} records a named consumer`);
      assert.ok(existsSync(resolveFile(adapterFile)), `${adapterFile} exists when demanded`);
    }
  }
});

test("threat model T1-T8 maps to task tests; mapped tests exist for done tasks", () => {
  assert.equal(manifest.threats.length, 8);
  for (let i = 1; i <= 8; i++) {
    const threat = manifest.threats.find((t) => t.id === `T${i}`);
    assert.ok(threat, `threat T${i} present`);
    assert.ok(TASKS.includes(threat.task), `T${i} maps to a known task`);
    assert.ok(threat.posture && threat.tests.length >= 1, `T${i} has posture and tests`);
    if (manifest.tasks[threat.task] === "done") {
      for (const testRef of threat.tests) {
        const testFile = testRef.split(" ")[0];
        assert.ok(
          existsSync(resolveFile(testFile)) || testFile === "scripts/phase26-freeze.test.mjs",
          `T${i} mapped test ${testFile} exists (${threat.task} done)`,
        );
      }
    }
  }
});

test("phase26-freeze.test.mjs is retired from npm test (plan 057) but stays runnable standalone", () => {
  const testScript = rootPkg.scripts.test;
  assert.ok(
    !testScript.includes("scripts/phase26-freeze.test.mjs"),
    "retired freeze gate must not run in npm test (plan 057); run standalone for audits",
  );
});

test("baseline seam coverage matches the manifest (every single-editor allowed file recorded)", () => {
  const singleEditor = new Set(["roadmap.md"]);
  for (const item of manifest.items) {
    for (const file of item.allowedFiles) {
      const editors = Object.entries(manifest.sharedFiles).filter(([, markers]) => markers[item.task]);
      if (!editors.some(([sharedFile]) => sharedFile === file)) singleEditor.add(file);
    }
  }
  const seamKeys = Object.keys(baseline.seams);
  assert.deepEqual(seamKeys.sort(), [...singleEditor].sort(), "baseline.seams covers exactly the single-editor allowed files");
  for (const [file, seam] of Object.entries(baseline.seams)) {
    const present = existsSync(resolveFile(file));
    assert.equal(seam.status, present ? "present" : "absent", `seam status matches filesystem for ${file}`);
    if (present) assert.equal(typeof seam.sha256, "string", `sha256 recorded for ${file}`);
  }
});

test("compat and migration tokens recorded; deviations never weaken the compat promise", () => {
  assert.equal(
    manifest.compatPolicy.migrationNote,
    "docs/migration.md ## 0.2.5 -> 0.2.6 (additive-only; separate versioned record namespaces; ACP activeRun optional; no removal note needed unless a deviation is recorded)",
  );
  assert.ok(
    manifest.migrationTokens.includes("0.2.6") &&
      manifest.migrationTokens.includes("ptyBackend") &&
      manifest.migrationTokens.includes("createCodingWorkspaceLifecycle"),
  );
  for (const deviation of manifest.deviations) {
    assert.ok(deviation.id && deviation.what && deviation.review, "every deviation records id/what/review");
    assert.ok(!String(deviation.what).toLowerCase().includes("allow-break"), "deviations must not smuggle --allow-break");
  }
});

test("Task 8 exit gate: null while pending; green with all tasks done and blocked false when recorded", () => {
  if (baseline.exitGate === null) {
    assert.ok(manifest.tasks.task8 === "pending", "exitGate null implies task8 pending");
    return;
  }
  assert.equal(baseline.exitGate.green, true, "exitGate green");
  assert.equal(baseline.exitGate.blocked, false, "exitGate blocked false");
  for (const token of Object.values(manifest.tasks)) assert.equal(token, "done", "all task tokens done at exit");
  assert.ok(baseline.exitGate.version === "0.2.6", "exitGate version 0.2.6");
});
