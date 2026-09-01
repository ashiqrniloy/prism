/**
 * Phase 12 Task 3 (plan 012): packed-install coding journey.
 * Packs the coding packages from the workspace, installs the tarballs into a
 * fresh consumer, then runs scripts/fixtures/e2e-coding-journey.mjs inside
 * that consumer — the journey uses only public exports and resolves against
 * the packed node_modules, not workspace source paths.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createPackedConsumer, installedVersion, repoRoot, resolveFromConsumer } from "./fixtures/packed-consumer.mjs";

const freeze = JSON.parse(readFileSync(join(repoRoot, "scripts/phase12-freeze-manifest.json"), "utf8"));
const CEILING_MS = freeze.capacity.e2eJourneyFixtureMsCeiling;

const packages = [
  { dir: ".", name: "@arnilo/prism" },
  { dir: "packages/prism-coding-tools", name: "@arnilo/prism-coding-tools" },
  { dir: "packages/ag-ui", name: "@arnilo/prism-ag-ui" },
  { dir: "packages/prism-core", name: "@arnilo/prism-core" },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
];

let consumer, run;
let fixtureStartedMs;
before(() => {
  fixtureStartedMs = Date.now();
  const packed = createPackedConsumer(packages);
  consumer = packed;
  if (packed.installStatus !== 0) return;
  copyFileSync(join(repoRoot, "scripts/fixtures/e2e-coding-journey.mjs"), join(packed.consumer, "journey.mjs"));
  run = spawnSync(process.execPath, ["journey.mjs"], { cwd: packed.consumer, encoding: "utf8", timeout: CEILING_MS });
  run.durationMs = Date.now() - fixtureStartedMs;
});

after(() => consumer?.cleanup());

describe("packed-install coding journey", () => {
  it("packs and installs the exact 0.1.0 manifest graph", () => {
    assert.equal(consumer.installStatus, 0, consumer.installOut);
    for (const pkg of packages) {
      assert.equal(
        installedVersion(consumer.consumer, pkg.name),
        JSON.parse(readFileSync(join(repoRoot, pkg.dir, "package.json"), "utf8")).version,
        `${pkg.name} installed version must match the packed manifest`,
      );
    }
  });

  it("resolves public imports from the packed install, not the workspace", () => {
    const resolved = resolveFromConsumer(consumer.consumer, "@arnilo/prism-coding-tools/agent");
    assert.ok(resolved.startsWith(`file://${consumer.consumer}`), `resolved to ${resolved}, expected consumer node_modules`);
    assert.ok(!resolved.includes(repoRoot), "must not resolve into the workspace tree");
  });

  it("completes the coding journey from packed public exports", () => {
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /CODING JOURNEY OK/, run.stdout + run.stderr);
    assert.ok(run.durationMs <= CEILING_MS, `journey took ${run.durationMs}ms, ceiling ${CEILING_MS}ms`);
  });
});
