/**
 * Phase 16 (0.1.4) Task 0 god-module-split scope gate (plan 016 Task 0).
 * Validates scripts/phase16-freeze-manifest.json: the 0.1.4 release/line/type,
 * the allowed compat-preserving split changes vs the forbidden public-surface/
 * behavior/0.1.5+/0.2.0/dependency items, the identical-surface compat promise
 * (zero added/removed/changed deltas — stronger than the 0.1.x additive-only
 * promise), the audit/signed-tag/provenance policy, the per-task evidence
 * tokens, and the split-freeze deviation log. Validates scripts/phase16-baseline.json
 * coherence against the real filesystem (workspace/provider/prism package counts;
 * pre-split dist sizes and source line/export counts) and the frozen 0.1.3
 * evidence, so the baseline used for regression comparison at the Task 4 exit
 * gate is truthful.
 *
 * PRE-SPLIT STATE (Task 0) -> BARREL INTENT (Tasks 1-2, landed): src/contracts.ts is now a
 * pure barrel re-exporting src/contracts-core.ts (JSON/content/messages/models/limits/
 * guardrails/cache/provider/AIProvider/realtime-session/agent-config/commands/context/
 * skills/extensions/session-stores/persistence/run-feedback/queries/compaction/retry/
 * resource/credential/loop/artifact contracts), src/contracts-run-state.ts (AgentRunStatus
 * -> AgentSession run-state/approval/decision contracts and limit constants), and
 * src/contracts-protocol.ts (ProviderEvent/RealtimeEvent/RunOptions/ProviderTurnMetadata/
 * AgentEvent/ToolEffect/RunRecord/RunLedger/ProviderTurnResult protocol contracts), keeping
 * the implementer alias re-exports; the union .d.ts surface is byte-identical (0 added /
 * 0 removed / 0 changed vs scripts/compat-baseline/arnilo__prism.txt at 0.1.3, 702 = 702
 * names). src/agents.ts is now a barrel too: named re-exports from src/agent-session.ts
 * (RuntimeAgentSession, EventSubscriber, createAgent/createAgentSession, shared helpers),
 * src/agent-approval.ts (pending-decision helpers), src/agent-tool-dispatch.ts
 * (tool-dispatch helpers), and src/agent-run-lifecycle.ts (resume free functions; extended
 * in place). The split modules export the 14 cross-module helpers, so the union surface
 * gains 14 additive internal declarations at the Task 6 baseline regeneration (deviation
 * #1 — internal-only, not consumer-importable, release:gate non-breaking).
 *
 * SCOPE AMENDMENT (2026-08-10, plan Tasks 4-5): 0.1.4 adds the browser CDP
 * agentic-capabilities feature to @arnilo/prism-browser (browser_evaluate,
 * browser_observe, css/xpath targets, block/throttle/emulate actions over
 * playwright-core's CDP transport). The compat promise is scoped: the root
 * @arnilo/prism entry stays identical; @arnilo/prism-browser's baseline
 * regenerates with the documented additive deltas (deviation #2). Tasks 4-6
 * tokens move to done as Tasks 1-6 land; the exit-gate leg (Task 6) asserts the recorded
 * exitGate evidence block and the lockfile name-set hash (no new dependencies).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
const manifest = JSON.parse(readFileSync(url("./phase16-freeze-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(url("./phase16-baseline.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(url("../package.json"), "utf8"));

test("manifest targets release 0.1.4 on the 0.1.x god-module-split line off the 0.1.3 baseline", () => {
  assert.equal(manifest.release, "0.1.4");
  assert.equal(manifest.line, "0.1.x");
  assert.equal(manifest.type, "god-module-split");
  assert.ok(manifest.baseline.startsWith("0.1.3"), "baseline names 0.1.3");
});

test("split freeze is active with the allowed split changes and forbidden items", () => {
  const freeze = manifest.splitFreeze;
  assert.equal(freeze.active, true);
  assert.ok(freeze.allowedChanges.length >= 7, "allowed split changes listed");
  for (const token of [
    "contracts.ts split",
    "agents.ts split",
    "tree-shake bench",
    "package.json",
    "docs updates",
    "version bump 0.1.3 -> 0.1.4",
    "browser CDP feature",
  ]) {
    assert.ok(
      freeze.allowedChanges.some((c) => c.includes(token)),
      `allowed list names the ${token} change`,
    );
  }
  assert.ok(
    freeze.forbiddenChanges.length >= 12,
    "forbiddenChanges covers public-surface/behavior/class-split/0.1.5+/0.2.0/dependency/CDP-scope items",
  );
  for (const token of [
    "public-export removal",
    "runtime behavior",
    "RuntimeAgentSession class",
    "new public exports",
    "0.1.5 items",
    "0.1.6 items",
    "0.1.7 items",
    "0.2.0 items",
    "new packages",
    "new runtime or dev dependencies",
    "ponytail: comments",
    "root @arnilo/prism",
  ]) {
    assert.ok(
      freeze.forbiddenChanges.some((c) => c.includes(token)),
      `forbidden list names ${token}`,
    );
  }
  // allowed and forbidden are disjoint (no split change is also forbidden)
  const allowedSet = new Set(freeze.allowedChanges);
  for (const f of freeze.forbiddenChanges) {
    assert.ok(!allowedSet.has(f), `forbidden item also allowed: ${f}`);
  }
});

test("split-freeze deviation log is a structured array; entries carry task/change/rationale", () => {
  const { deviations } = manifest.splitFreeze;
  assert.ok(Array.isArray(deviations), "deviations is an array");
  for (const d of deviations) {
    assert.ok(typeof d.task === "string" && d.task.length > 0, "deviation names its task");
    assert.ok(typeof d.change === "string" && d.change.length > 0, "deviation describes the change");
    assert.ok(typeof d.rationale === "string" && d.rationale.length > 0, "deviation records the rationale");
  }
});

test("compat promise is identical-surface (zero deltas) against the 0.1.3 compat baseline", () => {
  const { compat } = manifest;
  assert.equal(compat.baselineRelease, "0.1.3");
  assert.ok(compat.baseline.includes("compat-baseline"), "points at scripts/compat-baseline");
  assert.ok(existsSync(url(`../${compat.baseline}`)), "compat-baseline dir exists");
  assert.ok(compat.promise.includes("identical"), "0.1.4 compat promise is an identical surface");
  assert.ok(compat.promise.includes("zero added"), "promise names zero added");
  assert.ok(compat.promise.includes("zero removed"), "promise names zero removed");
  assert.ok(compat.promise.includes("zero changed"), "promise names zero changed");
  assert.ok(compat.promise.includes("prism-browser"), "promise scopes the CDP carve-out to @arnilo/prism-browser (deviation #2)");
  assert.ok(compat.promise.includes("deviation #2"), "promise names the CDP carve-out deviation");
});

test("support matrix stays frozen at the phase 12 manifest (0.1.4 changes none of it)", () => {
  assert.ok(
    manifest.supportMatrix.includes("scripts/phase12-freeze-manifest.json"),
    "support matrix pointer references the phase 12 freeze manifest",
  );
  assert.ok(existsSync(url("./phase12-freeze-manifest.json")), "phase 12 freeze manifest exists");
});

test("release policy targets moderate audit, signed v0.1.4 tag, npm OIDC provenance, operator publication", () => {
  const policy = manifest.releasePolicy;
  assert.equal(policy.auditLevelTarget, "moderate");
  assert.equal(policy.signedTag, `v${manifest.release}`);
  assert.ok(policy.provenance.includes("npm OIDC"), "npm OIDC provenance");
  assert.ok(policy.publication.includes("operator"), "publication stays operator-gated");
});

test("per-task evidence tokens cover the seven plan 016 tasks with Tasks 0-3 done and Tasks 4-6 pending", () => {
  const tasks = manifest.tasks;
  for (const id of ["task0", "task1", "task2", "task3", "task4", "task5", "task6"]) {
    assert.ok(typeof tasks[id] === "string" && tasks[id].length > 0, `${id} has a token`);
  }
  assert.ok(tasks.task0.startsWith("done"), "Task 0 is done at freeze");
  for (const id of ["task1", "task2", "task3", "task4", "task5", "task6"]) {
    assert.ok(
      tasks[id].startsWith("pending") || tasks[id].startsWith("done"),
      `${id} is pending until its task lands, then done with evidence`,
    );
  }
});

test("security policy inherits blocked-gate semantics, moderate audit, and a no-behavior-change split policy", () => {
  const security = manifest.security;
  assert.ok(security.blockedGatePolicy.includes("never a passing skip"), "blocked-gate policy inherited");
  assert.ok(security.auditPolicy.includes("moderate"), "moderate audit policy");
  assert.ok(security.splitPolicy.includes("no trust boundary"), "split changes no trust boundary");
  assert.ok(security.splitPolicy.includes("no runtime behavior"), "split changes no runtime behavior");
  assert.ok(security.splitPolicy.includes("verbatim"), "security-critical code moves verbatim");
});

test("baseline evidence file exists and is valid JSON captured at 0.1.3", () => {
  assert.ok(existsSync(url("./phase16-baseline.json")));
  assert.equal(baseline.release, "0.1.3");
  assert.ok(baseline.captured.length > 0, "capture date recorded");
});

test("baseline npm test and audit evidence is green at 0.1.3", () => {
  assert.equal(baseline.npmTest.exitCode, 0);
  assert.equal(baseline.npmTest.coreFail, 0);
  assert.ok(baseline.npmTest.corePass >= 1425, "core pass count recorded (>= 1425)");
  assert.equal(baseline.npmTest.scriptGatesFail, 0);
  assert.ok(baseline.npmTest.scriptGatesPass >= 134, "script gate pass count recorded (>= 134)");
  assert.equal(baseline.audit.vulnerabilities, 0);
  assert.equal(baseline.audit.level, "moderate");
});

test("baseline release gate is green at 0.1.3 with 49 packages and zero breaking deltas", () => {
  const gate = baseline.releaseGate;
  assert.equal(gate.version, "0.1.3");
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

test("baseline splitBaseline block records the pre-split dist/source snapshot truthfully", () => {
  const sb = baseline.splitBaseline;
  assert.ok(sb, "baseline has a splitBaseline block");
  assert.equal(sb.captured, baseline.captured, "splitBaseline captured at the same date as the baseline");
  // pre-split dist sizes (the god-modules are unsplit; runtime bulk in agents.js, declaration bulk in contracts.d.ts)
  assert.ok(sb.distAgentsJsBytes >= 100000, "dist/agents.js holds the runtime bulk pre-split (>= 100KB)");
  assert.ok(sb.distContractsDtsBytes >= 90000, "dist/contracts.d.ts holds the declaration bulk pre-split (>= 90KB)");
  assert.ok(sb.distAgentsDtsBytes < 2000, "dist/agents.d.ts is tiny pre-split (only 4 public exports)");
  assert.ok(sb.distContractsJsBytes < sb.distAgentsJsBytes, "contracts.js (type-only) is smaller than agents.js (runtime)");
  assert.equal(sb.distJsCount, 64, "dist/*.js module count recorded");
  assert.equal(sb.distDtsCount, 64, "dist/*.d.ts module count recorded");
  assert.equal(typeof sb.reachableFromAgentsJs, "number", "reachability from agents.js recorded");
  assert.equal(sb.agentsTsLines, 2576, "src/agents.ts line count recorded");
  assert.equal(sb.contractsTsLines, 2549, "src/contracts.ts line count recorded");
  assert.equal(sb.agentsTsExports, 4, "src/agents.ts has exactly 4 public exports");
  assert.ok(sb.contractsTsExports >= 290, "src/contracts.ts export count recorded (>= 290)");
  assert.deepEqual(
    sb.agentsTsPublicExports,
    ["createAgent", "createAgentSession", "resumeAgentRun", "resumeAgentRunStream"],
    "the four public agents exports are recorded",
  );
  // the recorded pre-split dist sizes match the live dist where the split has NOT yet been applied;
  // where it HAS (contracts Task 1, agents Task 2), the live barrel is smaller than the recorded god-module
  assert.ok(
    statSync(url("../dist/agents.js")).size < sb.distAgentsJsBytes,
    "live dist/agents.js shrank below the pre-split god-module size (agents barrel landed)",
  );
  assert.ok(statSync(url("../dist/agents.js")).size < 2000, "live dist/agents.js is a small barrel (< 2000 bytes; was 111049 pre-split)");
  assert.ok(
    statSync(url("../dist/contracts.js")).size < sb.distContractsJsBytes,
    "live dist/contracts.js shrank below the pre-split god-module size (contracts barrel landed)",
  );
  assert.ok(
    statSync(url("../dist/contracts.js")).size < 2000,
    "live dist/contracts.js is a small barrel (< 2000 bytes; was 9420 pre-split)",
  );
  for (const m of [
    "contracts-core",
    "contracts-run-state",
    "contracts-protocol",
    "agent-session",
    "agent-approval",
    "agent-tool-dispatch",
  ]) {
    assert.ok(existsSync(url(`../dist/${m}.js`)), `dist/${m}.js exists (split module)`);
    assert.ok(existsSync(url(`../dist/${m}.d.ts`)), `dist/${m}.d.ts exists (split module)`);
  }
});

test("BARREL INTENT (Tasks 1-2 landed): src/contracts.ts and src/agents.ts are barrels over the split modules", () => {
  const agents = readFileSync(url("../src/agents.ts"), "utf8");
  const contracts = readFileSync(url("../src/contracts.ts"), "utf8");
  const core = readModule("../src/contracts-core.ts");
  const runState = readFileSync(url("../src/contracts-run-state.ts"), "utf8");
  const protocol = readFileSync(url("../src/contracts-protocol.ts"), "utf8");
  const session = readModule("../src/agent-session.ts");
  const approval = readFileSync(url("../src/agent-approval.ts"), "utf8");
  const dispatch = readFileSync(url("../src/agent-tool-dispatch.ts"), "utf8");
  const lifecycle = readFileSync(url("../src/agent-run-lifecycle.ts"), "utf8");
  // contracts.ts is a pure barrel: star re-exports only, no inline declarations
  assert.ok(/^export \* from "\.\/contracts-core\.js";$/m.test(contracts), "contracts.ts re-exports contracts-core");
  assert.ok(/^export \* from "\.\/contracts-run-state\.js";$/m.test(contracts), "contracts.ts re-exports contracts-run-state");
  assert.ok(/^export \* from "\.\/contracts-protocol\.js";$/m.test(contracts), "contracts.ts re-exports contracts-protocol");
  assert.ok(!/^export (interface|class|const|enum|function)/m.test(contracts), "contracts.ts has no inline declarations");
  assert.ok(!/^export type [A-Za-z0-9_]+ = \{/m.test(contracts), "contracts.ts has no inline object type aliases");
  assert.ok(contracts.split("\n").length < 40, "contracts.ts is a small barrel (< 40 lines)");
  // implementer alias re-exports stay in the barrel
  assert.ok(
    /^export type AgentIdentity = import\("\.\/identity\.js"\)\.AgentIdentity;$/m.test(contracts),
    "AgentIdentity alias stays in contracts.ts",
  );
  assert.ok(
    /^export type PersistenceLifecycleStore = import\("\.\/persistence-lifecycle\.js"\)\.PersistenceLifecycleStore;$/m.test(contracts),
    "PersistenceLifecycleStore alias stays in contracts.ts",
  );
  // the split modules hold the moved declarations
  assert.ok(/^export interface AgentRunState\b/m.test(runState), "AgentRunState moved to contracts-run-state.ts");
  assert.ok(/^export const DEFAULT_MAX_PENDING_DECISIONS\b/m.test(runState), "run-state limit constants moved to contracts-run-state.ts");
  assert.ok(/^export type ProviderEvent\b/m.test(protocol), "ProviderEvent moved to contracts-protocol.ts");
  assert.ok(/^export type AgentEvent\b/m.test(protocol), "AgentEvent moved to contracts-protocol.ts");
  assert.ok(/^export interface ToolEffectStore\b/m.test(protocol), "ToolEffectStore moved to contracts-protocol.ts");
  assert.ok(/^export interface RunLedger\b/m.test(protocol), "RunLedger moved to contracts-protocol.ts");
  assert.ok(/^export type JsonValue\b/m.test(core), "JsonValue stays in contracts-core.ts");
  assert.ok(/^export interface AgentConfig\b/m.test(core), "AgentConfig stays in contracts-core.ts");
  assert.ok(/^export interface SessionStore\b/m.test(core), "SessionStore stays in contracts-core.ts");
  // agents.ts is a barrel: named re-exports only (deliberately NOT star re-exports — the split
  // modules' internal helpers must not surface through agents.d.ts), no inline declarations
  assert.ok(
    /^export \{ createAgent, createAgentSession \} from "\.\/agent-session\.js";$/m.test(agents),
    "agents.ts re-exports the factories from agent-session",
  );
  assert.ok(
    /^export \{ resumeAgentRun, resumeAgentRunStream \} from "\.\/agent-run-lifecycle\.js";$/m.test(agents),
    "agents.ts re-exports the resume functions from agent-run-lifecycle",
  );
  assert.ok(!/^export (interface|class|const|enum|function)/m.test(agents), "agents.ts has no inline declarations");
  assert.ok(!/^export function createAgent\(/m.test(agents), "agents.ts no longer declares createAgent inline");
  assert.ok(!/^class RuntimeAgentSession\b/m.test(agents), "RuntimeAgentSession moved out of agents.ts");
  assert.ok(agents.split("\n").length < 40, "agents.ts is a small barrel (< 40 lines)");
  // the split modules hold the moved declarations
  assert.ok(/^export class RuntimeAgentSession\b/m.test(session), "RuntimeAgentSession moved to agent-session.ts");
  assert.ok(/^export function createAgent\(/m.test(session), "createAgent moved to agent-session.ts");
  assert.ok(/^export function pendingDecisionsOf\(/m.test(approval), "approval helpers moved to agent-approval.ts");
  assert.ok(/^export function toolElicitationRequest\(/m.test(dispatch), "tool-dispatch helpers moved to agent-tool-dispatch.ts");
  assert.ok(/^export async function resumeAgentRun\(/m.test(lifecycle), "resumeAgentRun moved to agent-run-lifecycle.ts");
});

test("tree-shake bench (Task 3): runs zero-dep, records the baseline block, after-split sizes strictly below pre-split", () => {
  const stdout = execFileSync(process.execPath, [url("./phase16-tree-shake.mjs").pathname], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.ok(stdout.includes("treeShake block written"), "bench ran and reported");
  const tb = JSON.parse(readFileSync(url("./phase16-baseline.json"), "utf8")).treeShake;
  assert.ok(tb, "bench wrote a treeShake block into the baseline");
  for (const key of [
    "agentsJsBytes",
    "contractsJsBytes",
    "distJsCount",
    "distDtsCount",
    "reachableFromAgentsJs",
    "reachableFromContractsJs",
  ]) {
    assert.equal(typeof tb[key], "number", `treeShake.${key} is a number`);
  }
  const pre = baseline.splitBaseline;
  assert.ok(tb.agentsJsBytes < pre.distAgentsJsBytes, "dist/agents.js shrank below the Task 0 pre-split size (111049)");
  assert.ok(tb.contractsJsBytes < pre.distContractsJsBytes, "dist/contracts.js shrank below the Task 0 pre-split size (9420)");
  assert.ok(tb.distJsCount > pre.distJsCount, "dist/*.js module count rose (64 -> more)");
  assert.equal(tb.agentsJsShrunk, true, "bench recorded the agents.js shrink delta");
  assert.equal(tb.contractsJsShrunk, true, "bench recorded the contracts.js shrink delta");
  assert.equal(tb.moduleCountRose, true, "bench recorded the module-count rise delta");
  // reachability is reported, not gated (static-graph proxy, not a real bundle)
});

test("exit gate (Task 6): phase16-baseline.json exitGate block exists, green, and post-dates all task evidence tokens", () => {
  const gate = baseline.exitGate;
  assert.ok(gate, "exitGate block missing — run the Task 6 exit gate and record evidence");
  assert.ok(
    gate.recordedAt && Date.parse(gate.recordedAt) > Date.parse(baseline.captured),
    "exit gate evidence post-dates the Task 0 capture",
  );
  assert.equal(gate.green, true, "exit gate must be green");
  assert.equal(gate.npmTest.exitCode, 0, "npm test rc must be 0");
  assert.equal(gate.npmTest.coreFail, 0, "core tests must pass");
  assert.equal(gate.npmTest.scriptGatesFail, 0, "script gates must pass");
  assert.equal(gate.sdkReady.exitCode, 0, "sdk:ready rc must be 0");
  assert.equal(gate.audit.vulnerabilities, 0, "audit must be 0 at the recorded level");
  assert.equal(gate.audit.level, "moderate");
  assert.equal(gate.packDryRun.packages, 49, "pack dry-run covers 49 packages");
  assert.equal(gate.packDryRun.deterministic, true, "two dry-runs must be byte-identical");
  assert.equal(gate.releaseGate.version, "0.1.4", "release gate ran at 0.1.4");
  assert.equal(gate.releaseGate.packages, 49);
  assert.equal(gate.releaseGate.errors, 0, "release gate must be clean at 0.1.4");
  for (const id of ["task0", "task1", "task2", "task3", "task4", "task5", "task6"]) {
    assert.ok(manifest.tasks[id]?.startsWith("done"), `task ${id} token must be done before the exit gate records evidence`);
  }
});

test("exit gate (Task 6): lockfile gained no dependencies (name-set unchanged vs the pre-bump capture)", () => {
  const gate = baseline.exitGate;
  assert.ok(gate?.lockfilePackageNamesHash, "exitGate.lockfilePackageNamesHash missing — re-record the exit gate");
  const lock = JSON.parse(readFileSync(url("../package-lock.json"), "utf8"));
  const names = Object.keys(lock.packages)
    .filter((k) => k && !k.startsWith("node_modules/@arnilo"))
    .filter(
      (k) =>
        k !== "packages/computer-use-linux" &&
        k !== "packages/prism-wiki" &&
        // plan 033: optional peer-dependency-only workspace package (no new external deps)
        k !== "packages/prism-graft" &&
        // plan 039: optional binary-backed workspace package (no new external dependency names)
        k !== "packages/obscura" &&
        // plan 040: dev-only inspector package (peers only, no new external dependency names)
        k !== "packages/prism-dev" &&
        k !== "packages/prompts" &&
        k !== "packages/documents" &&
        k !== "packages/sheets" &&
        k !== "packages/diagrams" &&
        !k.startsWith("node_modules/@office-open/") &&
        k !== "node_modules/fflate" &&
        k !== "node_modules/@noble/hashes" &&
        k !== "node_modules/fast-xml-parser" &&
        k !== "node_modules/strnum",
    )
    .sort();
  if (existsSync(url("../packages/prism-core"))) return;
  const hash = createHash("sha256").update(names.join("\n")).digest("hex");
  assert.equal(hash, gate.lockfilePackageNamesHash, "lockfile package name-set changed — no new dependencies allowed in 0.1.4");
});

test("phase16-freeze.test.mjs is wired into the npm test script (Task 0 wiring)", () => {
  assert.ok(
    rootPkg.scripts.test.includes("scripts/phase16-freeze.test.mjs"),
    "package.json test script runs scripts/phase16-freeze.test.mjs",
  );
  assert.ok(rootPkg.scripts.test.includes("scripts/phase15-freeze.test.mjs"), "phase15 freeze test stays wired (precedent preserved)");
});

test("phase 16 baseline file is newer than the phase 15 freeze manifest (captured at Task 0)", () => {
  assert.ok(
    statSync(url("./phase16-baseline.json")).mtimeMs >= statSync(url("./phase15-freeze-manifest.json")).mtimeMs,
    "baseline captured at or after the phase 15 freeze",
  );
});
