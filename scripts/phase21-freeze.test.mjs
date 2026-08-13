/**
 * Phase 21 (0.2.1) Task 1 provider-completion-and-outbound-trust-boundaries
 * scope gate (plan 021 Task 1). Validates scripts/phase21-freeze-manifest.json:
 * the 0.2.1 release/line/type, the six implementation items with disjoint
 * allowed-file scopes and done-phase content markers, the shared coordination
 * files with per-editor markers, the preserved surface (egress dns-pin
 * primitives - decision 12 no-convergence, OAuth connector consumers,
 * strictCompletion opt-in adapter files, native streaming adapters —
 * byte-immutable for the whole phase), allowed/forbidden change lists, the
 * compat policy (additive-only with five documented behavior tightenings;
 * --allow-break only with a recorded deviation), the audit/signed-tag/
 * provenance policy, the protected-gate policy (OIDC/OPA evidence required,
 * never a passing skip), migration tokens, and per-task evidence tokens.
 * Validates scripts/phase21-baseline.json coherence against the real
 * filesystem and the live source.
 *
 * STATE MACHINE:
 * - while an item's task token is 'pending', every file in its allowed scope
 *   must be byte-identical to the Task 1 baseline hash (files recorded as
 *   "absent" must not exist);
 * - once a task token is 'done', the item assertions replace the hashes: the
 *   content markers are present in the shipped files and the mapped security
 *   tests exist;
 * - shared files are byte-identical while ALL their editors are pending; once
 *   any editor is done, that editor's markers must be present;
 * - preservedSurface files are byte-immutable at every task state;
 * - the Task 8 exit gate is null until recorded; when recorded it must be
 *   green with all task tokens done, audit 0, pack determinism, a clean plain
 *   release gate at 0.2.1, OIDC/OPA protected evidence present, and no
 *   blocker skip.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const url = (path) => new URL(path, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase21-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase21-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

const ITEMS = manifest.items;
const ITEM_IDS = [
  "strict-completion",
  "bounded-success-bodies",
  "dns-pinning",
  "oauth-consolidation",
  "edge-fixes",
  "security-regressions",
];
const TASKS = ["task2", "task3", "task4", "task5", "task6", "task7", "task8"];

function itemById(id) {
  const c = ITEMS.find((c) => c.id === id);
  assert.ok(c, `item ${id} present in the registry`);
  return c;
}

function sha256(file) {
  return createHash("sha256")
    .update(readFileSync(url(`../${file}`)))
    .digest("hex");
}

function dirHash(dir) {
  const files = readdirSync(url(`../${dir}`), { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
  const digest = createHash("sha256");
  for (const name of files) {
    digest.update(`${name}:${sha256(`${dir}/${name}`)}\n`);
  }
  return digest.digest("hex");
}

function workspaceManifestHash() {
  const dirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(url(`../packages/${e.name}/package.json`)))
    .map((e) => e.name)
    .sort();
  const digest = createHash("sha256");
  for (const name of dirs) {
    digest.update(`${name}:${sha256(`packages/${name}/package.json`)}\n`);
  }
  return digest.digest("hex");
}

function dependencyNameFingerprint() {
  const lines = [];
  const root = JSON.parse(readFileSync(url("../package.json"), "utf8"));
  for (const [pkg, manifestPath] of [
    [root.name, "package.json"],
    ...readdirSync(url("../packages"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(url(`../packages/${e.name}/package.json`)))
      .map((e) => [JSON.parse(readFileSync(url(`../packages/${e.name}/package.json`), "utf8")).name, `packages/${e.name}/package.json`]),
  ]) {
    const m = JSON.parse(readFileSync(url(`../${manifestPath}`), "utf8"));
    const names = Object.keys({ ...(m.dependencies ?? {}), ...(m.optionalDependencies ?? {}) }).sort();
    for (const name of names) lines.push(`${pkg}:${name}`);
  }
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

test("manifest targets release 0.2.1 on the 0.2.x trust-boundaries line off the 0.2.0 baseline", () => {
  assert.equal(manifest.release, "0.2.1");
  assert.equal(manifest.line, "0.2.x");
  assert.equal(manifest.type, "provider-completion-and-outbound-trust-boundaries");
  assert.ok(manifest.baseline.startsWith("0.2.0"), "baseline names 0.2.0");
});

test("items registry lists exactly the six 0.2.1 items with valid tasks, disjoint scopes, markers, and threat mapping", () => {
  assert.equal(ITEMS.length, 6, "exactly six items");
  assert.deepEqual(ITEMS.map((c) => c.id).sort(), [...ITEM_IDS].sort(), "registry ids match the plan 021 item set");
  for (const c of ITEMS) {
    assert.ok(c.task.startsWith("task") && TASKS.includes(c.task), `${c.id} maps to a phase-21 task`);
    assert.ok(Array.isArray(c.allowedFiles) && c.allowedFiles.length > 0, `${c.id} lists allowed files`);
    assert.ok(c.rationale.length > 0, `${c.id} records its rationale`);
    assert.ok(Array.isArray(c.securityTests) && c.securityTests.length > 0, `${c.id} maps threats to tests`);
    assert.ok(c.markers && Object.keys(c.markers).length > 0, `${c.id} defines done-phase content markers`);
  }
  // allowed scopes are disjoint so a single-file diff can never satisfy two items ambiguously
  const seen = new Map();
  for (const c of ITEMS) {
    for (const f of c.allowedFiles) {
      assert.ok(!seen.has(f), `file ${f} claimed by both ${seen.get(f)} and ${c.id}`);
      seen.set(f, c.id);
    }
  }
  // markers must point at files inside the item scope (or negative markers at preserved files)
  for (const c of ITEMS) {
    for (const f of Object.keys(c.markers)) {
      assert.ok(c.allowedFiles.includes(f), `${c.id} marker file ${f} is inside its allowed scope`);
    }
    for (const f of Object.keys(c.negativeMarkers ?? {})) {
      assert.ok(!c.allowedFiles.includes(f), `${c.id} negative marker file ${f} is NOT in its allowed scope (must stay untouched)`);
    }
  }
});

test("shared files registry: valid editors, per-editor markers, and no overlap with item scopes", () => {
  const shared = manifest.sharedFiles;
  assert.ok(shared.rule.includes("byte-immutable"), "shared files are immutable while all editors are pending");
  for (const [file, entry] of Object.entries(shared.files)) {
    assert.ok(Array.isArray(entry.editors) && entry.editors.length > 0, `${file} lists editor tasks`);
    for (const editor of entry.editors) {
      assert.ok(editor.startsWith("task"), `${file} editor ${editor} is a task id`);
      assert.ok(entry.markers[editor]?.length > 0, `${file} defines markers for editor ${editor}`);
    }
    for (const c of ITEMS) {
      assert.ok(!c.allowedFiles.includes(file), `shared file ${file} is not claimed by item ${c.id}`);
    }
  }
});

test("preserved surface is active and names exactly the reused primitives", () => {
  const ps = manifest.preservedSurface;
  assert.equal(ps.active, true);
  assert.ok(ps.rule.includes("byte-immutable"), "preserved files are immutable for the whole phase");
  const expected = [
    "packages/coding-security/src/egress/dns-pin.ts",
    "packages/coding-security/src/egress/index.ts",
    "packages/credentials-node/src/microsoft365-oauth.ts",
    "packages/credentials-node/src/google-workspace-oauth.ts",
    "packages/provider-alibaba/src/provider.ts",
    "packages/provider-kimi/src/moonshot.ts",
    "packages/provider-ollama/src/provider.ts",
    "packages/provider-opencode-go/src/openai-chat.ts",
    "packages/provider-anthropic/src/messages.ts",
    "packages/provider-google/src/generate-content.ts",
  ];
  assert.deepEqual(Object.keys(ps.files).sort(), [...expected].sort(), "preserved surface names the ten reused primitives");
  for (const f of expected) {
    assert.ok(existsSync(url(`../${f}`)), `preserved file exists: ${f}`);
    assert.ok(baseline.preservedSurface[f], `baseline records a preserved hash for ${f}`);
  }
  for (const f of expected) {
    for (const c of ITEMS) {
      assert.ok(!c.allowedFiles.includes(f), `preserved file ${f} is not in the ${c.id} allowed scope`);
    }
  }
});

test("allowed and forbidden change lists are disjoint; deviations are structured", () => {
  assert.ok(
    manifest.allowedChanges.length >= 9,
    "allowed changes cover freeze/implementation/docs/regressions/baseline/bump/compat/wiring/evidence",
  );
  for (const token of [
    "phase21-freeze.test.mjs",
    "readBoundedResponseJson",
    "pinnedFetch",
    "pollDeviceCodeToken",
    "phase21-security.test.mjs",
    "exitGate",
    "0.2.0 -> 0.2.1",
    "--update-baseline",
  ]) {
    assert.ok(
      manifest.allowedChanges.some((c) => c.includes(token)),
      `allowed list names ${token}`,
    );
  }
  assert.ok(
    manifest.forbiddenChanges.length >= 10,
    "forbiddenChanges covers pending-scope/preserved/shared/defaults/removal/deps/0.2.2+/egress/support/baseline/skip items",
  );
  for (const token of [
    "pending",
    "preservedSurface",
    "shared file",
    "behavior change to any default",
    "removal of strictCompletion",
    "new runtime or dev dependencies",
    "0.2.2+ items",
    "egress dns-pin.ts convergence",
    "support matrix",
    "skipping a protected security gate",
    "ponytail: comments",
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

test("compat promise: additive-only with five documented tightenings; deviation-gated --allow-break", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.2.0");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("ADDITIVE-ONLY"), "0.2.1 compat promise is additive-only");
  assert.ok(compat.promise.includes("strict completion"), "tightening 1: strict completion named");
  assert.ok(compat.promise.includes("readBoundedResponseJson"), "tightening 2: bounded success bodies named");
  assert.ok(compat.promise.includes("DNS-pinned fetch"), "tightening 3: DNS-pinned fetch named");
  assert.ok(compat.promise.includes("pollDeviceCodeToken"), "tightening 4: OAuth consolidation named");
  assert.ok(compat.promise.includes("edge fixes"), "tightening 5: edge fixes named");
  assert.ok(compat.promise.includes("--allow-break"), "deviation-gated --allow-break policy stated");
  assert.ok(compat.promise.includes("50 packages"), "publish graph stays 50");
});

test("migration tokens are recorded for the Task 8 migration doc", () => {
  assert.ok(Array.isArray(manifest.migrationTokens) && manifest.migrationTokens.length >= 6, "migration tokens recorded");
  for (const token of [
    "0.2.1",
    "strictCompletion",
    "readBoundedResponseJson",
    "response_body_shape",
    "pinnedFetch",
    "pollDeviceCodeToken",
  ]) {
    assert.ok(manifest.migrationTokens.includes(token), `migration token ${token} present`);
  }
});

test("support matrix stays frozen at the phase 12 manifest (0.2.1 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.2.1 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the nine plan 021 tasks with Tasks 0-1 done and Tasks 2-8 pending", () => {
  const tasks = manifest.tasks;
  for (const id of ["task0", "task1", ...TASKS]) {
    assert.ok(typeof tasks[id] === "string" && tasks[id].length > 0, `${id} has a token`);
  }
  assert.ok(tasks.task0.startsWith("done"), "Task 0 is done at freeze");
  assert.ok(tasks.task0.includes("cb9369d"), "Task 0 token records the 0.2.0 HEAD");
  assert.ok(tasks.task1.startsWith("done"), "Task 1 (this freeze) is done");
  for (const id of TASKS) {
    assert.ok(
      tasks[id].startsWith("pending") || tasks[id].startsWith("done"),
      `${id} is pending until its task lands, then done with evidence`,
    );
  }
});

test("security policy inherits blocked-gate semantics (OIDC/OPA required), moderate audit, fail-closed guarantees", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy inherited");
  assert.ok(security.blockedGatePolicy.includes("OIDC/OPA"), "OIDC/OPA protected evidence is a required gate");
  assert.ok(security.auditPolicy.includes("moderate"), "moderate audit policy");
  assert.ok(security.itemPolicy.includes("fail-closed stream completion"), "truncated streams never succeed as providerDone");
  assert.ok(security.itemPolicy.includes("bounded success bodies abort before full buffering"), "oversized bodies abort before buffering");
  assert.ok(security.itemPolicy.includes("DNS pin + redirect rejection"), "DNS pin is the trust boundary, not the URL check alone");
  assert.ok(security.itemPolicy.includes("redacts device_code"), "OAuth secrets redacted at both call sites");
  assert.ok(security.itemPolicy.includes("credential-once"), "credential resolved once per request");
  assert.ok(security.itemPolicy.includes("BUILT public entrypoints"), "regressions run against built public entrypoints");
  assert.ok(security.itemPolicy.includes("packed plain-JavaScript consumer"), "packed consumer regression required");
  assert.ok(security.itemPolicy.includes("operator"), "publication stays operator-gated");
});

test("baseline evidence file exists, is valid JSON captured at 0.2.0, with green test/coverage/audit/release evidence", () => {
  assert.ok(existsSync(url("./phase21-baseline.json")));
  assert.equal(baseline.release, "0.2.0");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
  assert.ok(baseline.gitHead.length >= 7, "git head recorded");
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.equal(baseline.npmTest.corePass, 1457, "core pass count recorded (1457)");
  assert.equal(baseline.npmTest.scriptGatesFail, 0);
  assert.equal(baseline.npmTest.scriptGatesPass, 231, "script gate pass count recorded (231)");
  assert.equal(baseline.npmTest.totals.tests, 3372, "total test count recorded (3372)");
  assert.equal(baseline.npmTest.totals.pass, 3339, "total pass count recorded (3339)");
  assert.equal(baseline.npmTest.totals.skip, 33, "total skip count recorded (33)");
  assert.equal(baseline.coverage.core.lines, 91.95, "core line coverage recorded (91.95%)");
  assert.equal(baseline.coverage.core.branches, 84.26, "core branch coverage recorded (84.26%)");
  assert.equal(baseline.coverage.core.functions, 91.36, "core function coverage recorded (91.36%)");
  assert.equal(baseline.typecheck.exitCode, 0);
  assert.equal(baseline.biome.exitCode, 0);
  assert.equal(baseline.format.fixes, 0);
  assert.equal(baseline.secrets.findings, 0);
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
  assert.equal(baseline.packDryRun.packages, 50);
  assert.equal(baseline.packDryRun.deterministic, true);
  assert.equal(baseline.releaseGate.version, "0.2.0");
  assert.equal(baseline.releaseGate.packages, 50);
  assert.equal(baseline.releaseGate.errors, 0);
  assert.equal(baseline.releaseGate.breakingDeltas, 0);
});

test("baseline manifest count is coherent with the real filesystem (0.2.1 adds no package)", () => {
  const mc = baseline.manifestCount;
  const workspaceDirs = readdirSync(url("../packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(url(`../packages/${e.name}/package.json`)));
  const providerDirs = workspaceDirs.filter((d) => d.name.startsWith("provider-"));
  const prismDirs = workspaceDirs.filter((d) => d.name.startsWith("prism-"));
  assert.equal(workspaceDirs.length, mc.workspacePackages, "workspacePackages matches packages/*/package.json count");
  assert.equal(mc.categories.provider, providerDirs.length, "provider category count matches packages/provider-*");
  assert.equal(mc.categories.prism, prismDirs.length, "prism category count matches packages/prism-*");
  assert.equal(
    mc.categories.capability,
    mc.workspacePackages - providerDirs.length - prismDirs.length,
    "capability = remainder of the workspace graph",
  );
  assert.equal(mc.publishable, mc.workspacePackages + 1, "publishable = root + workspace (baseline 50)");
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

test("baseline inventories record the current trust-boundary posture for all five roadmap items", () => {
  assert.equal(baseline.strictCompletionOptIns.current.length, 4, "four adapters currently opt in");
  assert.deepEqual(
    baseline.strictCompletionOptIns.inheritingPermissiveDefault,
    ["azure", "bedrock", "vertex", "openrouter", "zai", "neuralwatt"],
    "six adapters inherit the permissive default",
  );
  assert.equal(baseline.unboundedSuccessSites.modelDiscovery.length, 10, "ten model-discovery unbounded sites recorded");
  assert.equal(baseline.unboundedSuccessSites.other.length, 3, "quota/embeddings/uploads unbounded sites recorded");
  assert.equal(baseline.unboundedSuccessSites.oauthDeviceToken.length, 6, "six OAuth unbounded sites recorded");
  assert.ok(baseline.fetchPosture.mcp.includes("resolvePinnedAddress"), "MCP pinning primitive recorded as the strongest");
  assert.ok(baseline.fetchPosture.oidc.includes("no DNS pin"), "OIDC fetch posture recorded");
  assert.ok(baseline.fetchPosture.opa.includes("no DNS pin"), "OPA fetch posture recorded");
  assert.ok(
    baseline.oauthDuplication.duplicated.some((s) => s.includes("SLOW_DOWN_INCREMENT_MS")),
    "OAuth duplication recorded",
  );
  assert.equal(baseline.oauthDuplication.consumersOfOauth2.length, 2, "OAuth connector consumers recorded");
  assert.ok(baseline.bedrockCanonicalization.defect.includes("repeated query keys"), "SigV4 defect recorded");
  assert.ok(baseline.uploadCleanup.defect.includes("leak"), "upload cleanup defect recorded");
  assert.ok(baseline.cacheTelemetryOverflow.defect.includes("mixed-model"), "cache overflow defect recorded");
  assert.ok(
    baseline.exitGate === null || (baseline.exitGate?.green === true && baseline.exitGateVersion === "0.2.1"),
    "exit gate starts null and, once recorded at Task 8, is green at 0.2.1",
  );
  assert.equal(baseline.exitGateVersion, "0.2.1");
});

test("dependency names fingerprint matches the live manifests (zero new runtime dependency names in 0.2.1)", () => {
  assert.equal(
    dependencyNameFingerprint(),
    baseline.dependencyNames.sha256,
    "runtime dependency name set changed — 0.2.1 adds no dependency names anywhere",
  );
});

test("workspace manifest hashes and compat-baseline dir hash match the live tree while Task 8 is pending", () => {
  if (manifest.tasks.task8.startsWith("pending")) {
    assert.equal(
      workspaceManifestHash(),
      baseline.workspaceManifests.sha256,
      "workspace manifests changed before Task 8 — version bump belongs to Task 8 only",
    );
    assert.equal(
      dirHash("scripts/compat-baseline"),
      baseline.compatBaseline.sha256,
      "compat-baseline changed before Task 8 — regeneration belongs to Task 8 only",
    );
  }
});

test("preserved surface hashes match the live files at every state (byte-immutable for the whole phase)", () => {
  for (const [file, hash] of Object.entries(baseline.preservedSurface)) {
    assert.ok(manifest.preservedSurface.files[file], `preserved file ${file} listed in the manifest`);
    assert.equal(
      sha256(file),
      hash,
      `${file} changed — preserved surface is byte-immutable in 0.2.1 (egress dns-pin, OAuth connector consumers, strictCompletion opt-ins, native streaming adapters)`,
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
          assert.ok(!existsSync(url(`../${f}`)), `${c.task} pending: ${f} must not exist yet`);
        } else {
          assert.equal(
            sha256(f),
            recorded,
            `${c.task} pending: ${f} changed — Task 1 baseline no longer matches live source (pending scope is immutable)`,
          );
        }
      } else {
        assert.ok(token.startsWith("done"), `${c.task} token must be pending or done, got: ${token}`);
      }
    }
  }
});

test("STATE MACHINE: shared files are byte-identical while all editors are pending; done editors assert markers", () => {
  for (const [file, entry] of Object.entries(manifest.sharedFiles.files)) {
    const recorded = baseline.fileHashes[file];
    assert.ok(recorded !== undefined, `baseline records a hash for shared file ${file}`);
    const pendingEditors = entry.editors.filter((e) => manifest.tasks[e].startsWith("pending"));
    const doneEditors = entry.editors.filter((e) => manifest.tasks[e].startsWith("done"));
    if (pendingEditors.length === entry.editors.length) {
      // all editors pending: byte-immutable
      if (recorded === "absent") {
        assert.ok(!existsSync(url(`../${file}`)), `shared file ${file} must not exist yet`);
      } else {
        assert.equal(sha256(file), recorded, `shared file ${file} changed while all its editors are pending`);
      }
    } else {
      assert.ok(doneEditors.length > 0, `shared file ${file} has at least one done editor`);
      for (const editor of doneEditors) {
        const text = readFileSync(url(`../${file}`), "utf8");
        for (const marker of entry.markers[editor]) {
          if (marker === "To be filled") {
            // negative marker: the plan's compromise/further-action placeholders must be gone at Task 8
            assert.ok(!text.includes(marker), `shared file ${file} still contains placeholder '${marker}' after ${editor}`);
          } else if (marker === "- [x] ") {
            // roadmap: the five 0.2.1 milestone items must be checked at Task 8
            assert.ok((text.match(/- \[x\] /g) ?? []).length >= 5, `roadmap.md has fewer than 5 checked items after ${editor}`);
          } else {
            assert.ok(text.includes(marker), `shared file ${file} missing marker '${marker}' required by ${editor}`);
          }
        }
      }
    }
  }
});

test("DONE-PHASE ITEM ASSERTIONS: shipped artifacts exist, markers present, security tests mapped", () => {
  const tasks = manifest.tasks;
  const read = (f) => readFileSync(url(`../${f}`), "utf8");
  if (tasks.task2.startsWith("done")) {
    const base = read("src/providers/openai-compatible.ts");
    assert.ok(base.includes("strictCompletion"), "openai-compatible.ts still ships the strictCompletion option");
    assert.ok(read("src/__tests__/openai-compatible.test.ts").includes("truncated"), "base conformance covers truncated-stream rejection");
    assert.ok(
      read("docs/providers/openai-compatible.md").includes("strict completion"),
      "openai-compatible docs state the strict-completion default",
    );
    // fixture conformance corrections (deviation 2): adapter test streams carry terminal finish_reason chunks
    for (const fixture of [
      "packages/provider-azure/src/__tests__/azure.test.ts",
      "packages/provider-bedrock/src/__tests__/bedrock.test.ts",
      "packages/provider-vertex/src/__tests__/vertex.test.ts",
      "packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts",
    ]) {
      assert.ok(read(fixture).includes("finish_reason"), `${fixture} streams carry finish_reason terminal chunks`);
    }
  }
  if (tasks.task3.startsWith("done")) {
    assert.ok(read("src/providers/transport.ts").includes("readBoundedResponseJson"), "transport.ts ships the bounded JSON reader");
    assert.ok(read("src/providers/transport.ts").includes("response_body_shape"), "transport.ts ships the JSON-shape error code");
    for (const models of [
      "packages/provider-alibaba/src/models.ts",
      "packages/provider-anthropic/src/models.ts",
      "packages/provider-google/src/models.ts",
      "packages/provider-kimi/src/models.ts",
      "packages/provider-neuralwatt/src/models.ts",
      "packages/provider-ollama/src/models.ts",
      "packages/provider-openai/src/models.ts",
      "packages/provider-opencode-go/src/models.ts",
      "packages/provider-openrouter/src/models.ts",
      "packages/provider-zai/src/models.ts",
    ]) {
      assert.ok(read(models).includes("readBoundedResponseJson"), `${models} uses the bounded reader`);
    }
    assert.ok(read("packages/provider-neuralwatt/src/quota.ts").includes("readBoundedResponseJson"), "quota.ts uses the bounded reader");
    assert.ok(
      read("packages/provider-alibaba/src/embeddings.ts").includes("readBoundedResponseJson"),
      "embeddings.ts uses the bounded reader",
    );
    assert.ok(
      read("src/__tests__/provider-transport.test.ts").includes("readBoundedResponseJson"),
      "provider-transport tests cover the bounded reader",
    );
    assert.ok(
      read("docs/provider-primitives.md").includes("bounded success-body reader"),
      "provider-primitives docs document the bounded reader",
    );
  }
  if (tasks.task4.startsWith("done")) {
    assert.ok(existsSync(url("../src/pinned-fetch.ts")), "pinned-fetch.ts exists");
    assert.ok(read("src/pinned-fetch.ts").includes("pinnedFetch"), "pinned-fetch.ts ships pinnedFetch");
    assert.ok(read("src/content.ts").includes("pinnedFetch"), "content fetch routes through pinnedFetch");
    assert.ok(read("packages/credentials-node/src/oidc.ts").includes("pinnedFetch"), "OIDC JWKS fetch routes through pinnedFetch");
    assert.ok(read("packages/policy/src/opa.ts").includes("pinnedFetch"), "OPA decision fetch routes through pinnedFetch");
    assert.ok(read("packages/mcp/src/transport.ts").includes("pinnedFetch"), "MCP transport reuses pinnedFetch");
    assert.ok(existsSync(url("../src/__tests__/pinned-fetch.test.ts")), "pinned-fetch tests exist");
    assert.ok(read("src/__tests__/pinned-fetch.test.ts").includes("rebinding"), "pinned-fetch tests cover DNS rebinding");
    assert.ok(read("packages/credentials-node/src/__tests__/oidc.test.ts").includes("pinnedFetch"), "oidc tests cover the pinned fetch");
    assert.ok(read("packages/policy/src/__tests__/opa.test.ts").includes("pinnedFetch"), "opa tests cover the pinned fetch");
    for (const doc of ["docs/credential-storage.md", "docs/policy-and-audit.md", "docs/multimodal-content.md", "docs/mcp-tools.md"]) {
      assert.ok(read(doc).includes("DNS-pinned"), `${doc} documents the DNS-pinned fetch`);
    }
  }
  if (tasks.task5.startsWith("done")) {
    assert.ok(existsSync(url("../src/oauth-device-code.ts")), "oauth-device-code.ts exists");
    assert.ok(read("src/oauth-device-code.ts").includes("pollDeviceCodeToken"), "oauth-device-code.ts ships the shared poll helper");
    assert.ok(read("packages/provider-openai/src/oauth.ts").includes("pollDeviceCodeToken"), "OpenAI oauth.ts calls the shared helper");
    assert.ok(
      read("packages/credentials-node/src/oauth2.ts").includes("pollDeviceCodeToken"),
      "credentials-node oauth2.ts calls the shared helper",
    );
    assert.ok(
      read("packages/provider-openai/src/__tests__/codex-oauth.test.ts").includes("pollDeviceCodeToken"),
      "OpenAI oauth tests cover the shared helper",
    );
    assert.ok(
      read("packages/credentials-node/src/__tests__/oauth.test.ts").includes("pollDeviceCodeToken"),
      "credentials-node oauth tests cover the shared helper",
    );
    assert.ok(
      read("docs/credentials-and-redaction.md").includes("device/token flow"),
      "credentials docs document the shared device/token flow",
    );
  }
  if (tasks.task6.startsWith("done")) {
    assert.equal(
      (read("packages/provider-azure/src/provider.ts").match(/resolveCredentialValue/g) ?? []).length,
      1,
      "azure resolves the credential exactly once",
    );
    assert.equal(
      (read("packages/provider-vertex/src/provider.ts").match(/resolveCredentialValue/g) ?? []).length,
      1,
      "vertex resolves the credential exactly once",
    );
    assert.ok(read("packages/provider-bedrock/src/sigv4.ts").includes("canonical"), "sigv4.ts canonicalizes deterministically");
    assert.ok(read("packages/provider-openai/src/uploads.ts").includes("readBoundedResponseJson"), "uploads.ts uses the bounded reader");
    assert.ok(read("packages/provider-openai/src/__tests__/openai.test.ts").includes("retain"), "uploads tests cover ID retention");
    assert.ok(read("src/cache-telemetry.ts").includes("overflow"), "cache-telemetry.ts keeps the overflow bucket");
    assert.ok(read("src/__tests__/cache-telemetry.test.ts").includes("mixed"), "cache-telemetry tests cover mixed-model overflow");
    assert.ok(read("docs/providers/azure.md").includes("once per request"), "azure docs state credential-once");
    assert.ok(read("docs/providers/vertex.md").includes("once per request"), "vertex docs state credential-once");
    assert.ok(read("docs/providers/bedrock.md").includes("duplicate-case"), "bedrock docs state signing canonicalization");
    assert.ok(read("docs/provider-caching.md").includes("overflow"), "provider-caching docs state overflow behavior");
  }
  if (tasks.task7.startsWith("done")) {
    assert.ok(existsSync(url("../scripts/phase21-security.test.mjs")), "phase-21 security conformance exists");
    const sec = read("scripts/phase21-security.test.mjs");
    assert.ok(sec.includes("phase21"), "conformance self-identifies");
    assert.ok(
      rootPkg.scripts["security:threat-suites"].includes("phase21-security.test.mjs"),
      "threat suites run the phase-21 conformance",
    );
    assert.ok(read("src/__tests__/install-smoke.test.ts").includes("phase21"), "packed consumer regression is wired");
  }
  // Task 0 evidence lands before any implementation task
  if (tasks.task0.startsWith("done")) {
    const review = read("docs/_evidence/phase21-primitive-review.md");
    assert.ok(existsSync(url("../docs/_evidence/phase21-primitive-review.md")), "primitive review evidence exists");
    for (const item of [
      "readBoundedResponseJson",
      "pinnedFetch",
      "pollDeviceCodeToken",
      "strictCompletion",
      "response_body_shape",
      "dns-pin.ts",
    ]) {
      assert.ok(review.includes(item), `review covers ${item}`);
    }
    const boundaryCount = (review.match(/Trust boundaries/g) ?? []).length;
    assert.ok(review.includes("Threat-to-test traceability"), "review maps threats to tests in the traceability table");
    assert.ok(
      (review.match(/\| T\d+ /g) ?? []).length >= 15,
      `review maps at least 15 threats (found ${(review.match(/\| T\d+ /g) ?? []).length})`,
    );
    assert.ok(/no single-consumer\s+extraction/i.test(review), "single-consumer extraction rejected");
    assert.ok(review.includes("cb9369d"), "review records the reviewed HEAD");
  }
});

test("exit gate: null until Task 8 records it; green with full evidence once recorded", () => {
  const gate = baseline.exitGate;
  if (gate === null) return; // pre-Task-8 state
  assert.equal(gate.green, true, "exit gate must be green");
  assert.equal(gate.npmTest.exitCode, 0);
  assert.equal(gate.npmTest.coreFail, 0, "no core failures at the exit gate");
  assert.equal(gate.npmTest.scriptGatesFail, 0, "no script-gate failures at the exit gate");
  assert.equal(gate.sdkReady.exitCode, 0);
  assert.equal(gate.audit.vulnerabilities, 0);
  assert.equal(gate.audit.level, "moderate");
  assert.equal(gate.packDryRun.packages, 50, "pack dry-run covers the 50 baseline manifests (no new package in 0.2.1)");
  assert.equal(gate.packDryRun.deterministic, true, "two dry-runs must be byte-identical");
  assert.equal(gate.releaseGate.version, "0.2.1", "release gate ran at 0.2.1");
  assert.equal(gate.releaseGate.packages, 50);
  assert.equal(gate.releaseGate.errors, 0, "release gate must be clean at 0.2.1");
  assert.equal(gate.protectedEvidence.oidcOpa, true, "OIDC/OPA protected evidence required at the exit gate");
  assert.equal(gate.compatibility.allowBreak, false, "no --allow-break at the exit gate without a recorded deviation");
  if (gate.compatibility.allowBreak) {
    assert.ok(manifest.deviations.length > 0, "--allow-break requires a recorded deviation");
  }
  for (const id of ["task0", "task1", ...TASKS]) {
    assert.ok(manifest.tasks[id]?.startsWith("done"), `task ${id} token must be done before the exit gate records evidence`);
  }
});

test("phase21-freeze.test.mjs is wired into the npm test script after phase 20 (Task 1 wiring)", () => {
  assert.ok(
    rootPkg.scripts.test.includes("scripts/phase21-freeze.test.mjs"),
    "package.json test script runs scripts/phase21-freeze.test.mjs",
  );
  assert.ok(
    rootPkg.scripts.test.indexOf("scripts/phase21-freeze.test.mjs") > rootPkg.scripts.test.indexOf("scripts/phase20-freeze.test.mjs"),
    "phase21 freeze test runs after phase20 freeze test",
  );
});

test("phase 21 baseline is newer than the phase 20 freeze manifest (captured at Task 1)", () => {
  assert.ok(
    statSync(url("./phase21-baseline.json")).mtimeMs >= statSync(url("./phase20-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 20 freeze manifest",
  );
});
