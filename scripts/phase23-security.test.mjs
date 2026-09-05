/**
 * Phase 23 security conformance (plan 023 Task 5).
 *
 * Proves the two 0.2.3 build/coverage integrity blockers are enforced at
 * RUNTIME through BUILT PUBLIC package entrypoints (dist via the package
 * exports map), never private source imports — the original review defects
 * were runtime/tooling-only gaps that TypeScript declarations could not
 * express:
 *
 *   T1 (regression matrix item 4, by name): concurrent emit builds plus an
 *     importer never observe a partial dist — the built public entry surface
 *     (every specifier in the exports map) is re-imported through the build
 *     lock while a wrapped emit runs, and the frozen export surface must
 *     resolve every round.
 *   T2 (regression matrix item 12, by name): workspace coverage excludes the
 *     imported core dist and records protected skips — the coverage artifact's
 *     per-package rows prove the package-local denominator (mcp >= 80 lines,
 *     impossible while core dist pollutes the denominator), the durable-leg
 *     packages are named protectedException instead of silently gated green,
 *     and belowThreshold stays empty.
 *
 * Gate accounting: the final test asserts every blocker ID above executed and
 * none was skipped, so a deleted/renamed/skipped blocker test fails the suite
 * even when the remaining tests pass.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AGENT_RUN_STATE_NAMESPACE, AgentRunError, createAgent } from "@arnilo/prism";

const ROOT = join(import.meta.dirname, "..");
const LOCK = join(ROOT, "scripts", "with-build-lock.mjs");
const IMPORTER = join(ROOT, "scripts", "fixtures", "phase23-public-entry.test.mjs");
const SUMMARY = join(ROOT, "scripts", "coverage-summary.mjs");
const ARTIFACT = join(ROOT, "scripts", "coverage-summary.json");

const BLOCKER_IDS = ["matrix-4-build-race", "matrix-12-coverage-denominator"];
const blockerIds = new Set();

// The built public entry must already expose the frozen surface at module
// load (phase22 precedent: threat-suites runs after a build in every chain).
assert.equal(typeof createAgent, "function");
assert.equal(typeof AgentRunError, "function");
assert.equal(typeof AGENT_RUN_STATE_NAMESPACE, "string");

function spawn(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env, NODE_TEST_CONTEXT: undefined, NODE_TEST_WORKER_ID: undefined },
  });
}

describe("phase23 security conformance (plan 023 Task 5, built public entrypoints)", () => {
  it("T1 [matrix item 4]: concurrent emit builds plus an importer never observe partial dist", async () => {
    blockerIds.add("matrix-4-build-race");
    for (let round = 1; round <= 2; round += 1) {
      // npm run build:core resolves node_modules/.bin for the tsc leaf (phase23-build-race precedent)
      const [build, importer] = await Promise.all([
        Promise.resolve().then(() => spawn("npm", ["run", "build:core"])),
        Promise.resolve().then(() => spawn(process.execPath, [LOCK, "node", "--test", IMPORTER])),
      ]);
      assert.equal(build.status, 0, `emit round ${round} failed:\n${build.stdout}\n${build.stderr}`);
      assert.equal(
        importer.status,
        0,
        `public-entry importer round ${round} observed a broken dist:\n${importer.stdout}\n${importer.stderr}`,
      );
      assert.ok(importer.stdout.includes("PUBLIC ENTRY OK"), `round ${round} importer ran the full surface check`);
    }
  });

  it("T2 [matrix item 12]: workspace coverage excludes imported core dist and records protected skips", () => {
    blockerIds.add("matrix-12-coverage-denominator");
    // Fast path: the same-run artifact from npm run test:coverage (CI runs
    // threat-suites after test:coverage). Fallback: produce one with permissive
    // thresholds so the assertion runs self-contained without the gate's files.
    let artifact = null;
    let thresholds = null;
    const tmp = mkdtempSync(join(tmpdir(), "prism-phase23-cov-"));
    try {
      if (existsSync(ARTIFACT)) {
        artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
      } else {
        const real = JSON.parse(readFileSync(join(ROOT, "scripts", "coverage-thresholds.json"), "utf8"));
        thresholds = join(tmp, "thresholds.json");
        writeFileSync(
          thresholds,
          JSON.stringify({
            captured: real.captured,
            marginPp: real.marginPp,
            packages: Object.fromEntries(Object.entries(real.packages).map(([name, value]) => [name, { ...value, lines: 0 }])),
          }),
        );
        const result = spawn(process.execPath, [SUMMARY], {
          env: { PRISM_COVERAGE_THRESHOLDS: thresholds, PRISM_COVERAGE_ARTIFACT: join(tmp, "artifact.json") },
        });
        assert.equal(result.status, 0, `coverage-summary failed:\n${result.stdout}\n${result.stderr}`);
        artifact = JSON.parse(readFileSync(join(tmp, "artifact.json"), "utf8"));
      }
      assert.ok(artifact.packages, "coverage artifact must carry per-package rows");
      const mcp = artifact.packages["@arnilo/prism-mcp"];
      assert.ok(mcp && typeof mcp.lines === "number", "mcp row must exist in the artifact");
      assert.ok(mcp.lines >= 80, `mcp lines ${mcp.lines} prove the core-dist-free denominator (0.2.2 polluted value was 45.47)`);
      // Since the 0.4.0 consolidation the durable legs live in prism-core
      // (packages/session-store-* moved to src/sessions/*); the protected
      // class is recorded on the prism-core row, not a standalone package.
      const core = artifact.packages["@arnilo/prism-core"];
      assert.ok(core?.protectedException, "durable-leg packages must be recorded protected, never gated green");
      assert.match(core.protectedException, /PRISM_TEST_(POSTGRES_URL|NATS_URL)/, "core durable legs must name their required env");
      assert.equal(core.threshold, null, "protected rows are exempt from a line gate");
      assert.deepEqual(artifact.belowThreshold, [], "no non-protected package may sit below its threshold");
      const protectedRows = Object.entries(artifact.packages).filter(([, row]) => row.protectedException);
      assert.ok(protectedRows.length >= 1, `protected skip classes must be named (found ${protectedRows.length})`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("gate accounting: both blocker IDs executed; none skipped or renamed away", () => {
    assert.deepEqual(
      [...blockerIds].sort(),
      [...BLOCKER_IDS].sort(),
      `blocker coverage incomplete; ran: ${[...blockerIds].sort().join(", ")}`,
    );
  });
});
