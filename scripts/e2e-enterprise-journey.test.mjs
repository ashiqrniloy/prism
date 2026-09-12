/**
 * Phase 12 Task 3 (plan 012): packed-install enterprise journey.
 * Packs the enterprise packages from the workspace, installs the tarballs
 * into a fresh consumer, then runs scripts/fixtures/e2e-enterprise-journey.mjs
 * inside that consumer — the journey uses only public exports and resolves
 * against the packed node_modules, not workspace source paths.
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
  { dir: "packages/prism-core", name: "@arnilo/prism-core" },
  { dir: "packages/prism-coding-tools", name: "@arnilo/prism-coding-tools" },
];

let consumer, run, consumerHasPg;
let fixtureStartedMs;
before(() => {
  fixtureStartedMs = Date.now();
  const packed = createPackedConsumer(packages);
  consumer = packed;
  if (packed.installStatus !== 0) return;
  // `pg` is a peer of @arnilo/prism-core and no tarball installs it, so this probe
  // is normally false. It is recorded (not asserted away) because an ambient
  // PRISM_TEST_POSTGRES_URL must be reported as a skipped durable leg, never
  // silently ignored nor allowed to reach `await import("pg")`.
  try {
    resolveFromConsumer(consumer.consumer, "pg");
    consumerHasPg = true;
  } catch {
    consumerHasPg = false;
  }
  copyFileSync(join(repoRoot, "scripts/fixtures/e2e-enterprise-journey.mjs"), join(packed.consumer, "journey.mjs"));
  run = spawnSync(process.execPath, ["journey.mjs"], { cwd: packed.consumer, encoding: "utf8", timeout: CEILING_MS });
  run.durationMs = Date.now() - fixtureStartedMs;
});

after(() => consumer?.cleanup());

describe("packed-install enterprise journey", () => {
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
    const resolved = resolveFromConsumer(consumer.consumer, "@arnilo/prism");
    assert.ok(resolved.startsWith(`file://${consumer.consumer}`), `resolved to ${resolved}, expected consumer node_modules`);
    assert.ok(!resolved.includes(repoRoot), "must not resolve into the workspace tree");
  });

  it("completes the enterprise journey from packed public exports", (t) => {
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const skipLine = run.stdout.split("\n").find((line) => line.startsWith("SKIP durable postgres leg:"));
    if (skipLine) t.diagnostic(skipLine);
    if (process.env.PRISM_TEST_POSTGRES_URL !== undefined && !consumerHasPg) {
      assert.ok(skipLine, "an ambient PRISM_TEST_POSTGRES_URL without a resolvable pg driver must be reported as a skipped durable leg");
    }
    assert.match(run.stdout, /ENTERPRISE JOURNEY OK/, run.stdout + run.stderr);
    assert.ok(run.durationMs <= CEILING_MS, `journey took ${run.durationMs}ms, ceiling ${CEILING_MS}ms`);
  });
});
