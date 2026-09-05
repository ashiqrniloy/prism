/**
 * Plans/064 Task 10: full-surface packed journey test.
 * Packs all ten first-party packages, installs the tarballs into a fresh
 * consumer, then runs scripts/fixtures/e2e-full-surface-journey.mjs inside
 * that consumer — public exports only, resolved against the packed
 * node_modules, never workspace source paths. Hermetic and network-free:
 * the mock provider drives the agent leg, and server-backed factories are
 * exercised at construct/validation level only.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createPackedConsumer, installedVersion, repoRoot, resolveFromConsumer } from "./fixtures/packed-consumer.mjs";

const JOURNEY_CEILING_MS = 120_000;

const packages = [
  { dir: ".", name: "@arnilo/prism" },
  { dir: "packages/prism-core", name: "@arnilo/prism-core" },
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers" },
  { dir: "packages/memory", name: "@arnilo/prism-memory" },
  { dir: "packages/prism-coding-tools", name: "@arnilo/prism-coding-tools" },
  { dir: "packages/web-tools", name: "@arnilo/prism-web-tools" },
  { dir: "packages/office", name: "@arnilo/prism-office" },
  { dir: "packages/ag-ui", name: "@arnilo/prism-ag-ui" },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/acp-agent", name: "@arnilo/prism-acp-agent" },
];

let consumer, run;
let fixtureStartedMs;
before(() => {
  fixtureStartedMs = Date.now();
  consumer = createPackedConsumer(packages);
  if (consumer.installStatus !== 0) return;
  copyFileSync(join(repoRoot, "scripts/fixtures/e2e-full-surface-journey.mjs"), join(consumer.consumer, "journey.mjs"));
  run = spawnSync(process.execPath, ["journey.mjs"], { cwd: consumer.consumer, encoding: "utf8", timeout: JOURNEY_CEILING_MS });
  run.durationMs = Date.now() - fixtureStartedMs;
});

after(() => consumer?.cleanup());

describe("packed-install full-surface journey", () => {
  it("packs and installs all ten packages at the workspace version", () => {
    assert.equal(consumer.installStatus, 0, consumer.installOut);
    for (const pkg of packages) {
      assert.equal(
        installedVersion(consumer.consumer, pkg.name),
        JSON.parse(readFileSync(join(repoRoot, pkg.dir, "package.json"), "utf8")).version,
        `${pkg.name} installed version must match the workspace manifest`,
      );
    }
  });

  it("resolves public imports from the packed install, not the workspace", () => {
    const resolved = resolveFromConsumer(consumer.consumer, "@arnilo/prism-core/governance/policy");
    assert.ok(resolved.startsWith(`file://${consumer.consumer}`), `resolved to ${resolved}, expected consumer node_modules`);
    assert.ok(!resolved.includes(repoRoot), "must not resolve into the workspace tree");
  });

  it("completes every package section from packed public exports", () => {
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /FULL SURFACE JOURNEY OK/, run.stdout + run.stderr);
  });

  it("finishes within the 120s journey ceiling", () => {
    assert.ok(run, "journey must have run");
    assert.ok(run.durationMs < JOURNEY_CEILING_MS, `journey took ${run.durationMs}ms`);
  });
});
