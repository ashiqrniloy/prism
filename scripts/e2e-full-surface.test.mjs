/**
 * Plans/064 Task 10: full-surface packed journey test.
 * Packs all fourteen first-party packages, installs the tarballs into a fresh
 * consumer, then runs scripts/fixtures/e2e-full-surface-journey.mjs inside
 * that consumer — public exports only, resolved against the packed
 * node_modules, never workspace source paths. Hermetic and network-free:
 * the mock provider drives the agent leg, and server-backed factories are
 * exercised at construct/validation level only.
 */

import { afterAll as after, beforeAll as before, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPackedConsumer, installedVersion, repoRoot, resolveFromConsumer } from "./fixtures/packed-consumer.mjs";

const JOURNEY_CEILING_MS = 180_000;

const packages = [
  { dir: ".", name: "@arnilo/prism" },
  { dir: "packages/hosts", name: "@arnilo/prism-hosts/channels" },
  { dir: "packages/hosts", name: "@arnilo/prism-hosts/evals" },
  { dir: "packages/hosts", name: "@arnilo/prism-hosts/devtools" },
  { dir: "packages/memory", name: "@arnilo/prism-memory-system/core" },
  { dir: "packages/knowledge", name: "@arnilo/prism-knowledge/rag" },
  { dir: "packages/knowledge", name: "@arnilo/prism-knowledge/wiki" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/compaction" },
  { dir: "packages/memory", name: "@arnilo/prism-memory-system" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/governance" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/model-router" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/workflows" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/observability" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/context-files" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/context-engineering" },
  { dir: "packages/tools", name: "@arnilo/prism-tools/coding" },
  { dir: "packages/tools", name: "@arnilo/prism-tools/browser" },
  { dir: "packages/tools", name: "@arnilo/prism-tools/web" },
  { dir: "packages/tools", name: "@arnilo/prism-tools/openapi" },
  { dir: "packages/tools", name: "@arnilo/prism-tools/computer-use" },
  { dir: "packages/tools", name: "@arnilo/prism-tools/work" },
  { dir: "packages/hosts", name: "@arnilo/prism-hosts/ag-ui" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/mcp" },
  { dir: "packages/hosts", name: "@arnilo/prism-hosts/mcp-server" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/hooks-json" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/store-jsonl" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/store-codecs" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/store-sqlite" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/store-postgres" },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions/keyring" },
  { dir: "packages/providers", name: "@arnilo/prism-ai" },
];

let consumer, run, hostRun;
let fixtureStartedMs;
before(() => {
  fixtureStartedMs = Date.now();
  const peers = JSON.parse(readFileSync(join(repoRoot, "packages/tools/package.json"), "utf8")).peerDependencies;
  const officePeers = Object.fromEntries(
    Object.entries(peers).filter(([name]) => name.startsWith("@office-open/") || name === "ajv" || name === "fast-xml-parser"),
  );
  consumer = createPackedConsumer(packages, {
    ...officePeers,
    ...Object.fromEntries(
      Object.entries(JSON.parse(readFileSync(join(repoRoot, "packages/hosts/package.json"), "utf8")).peerDependencies).filter(
        ([name]) => name !== "@arnilo/prism",
      ),
    ),
  });
  if (consumer.installStatus !== 0) return;
  copyFileSync(join(repoRoot, "scripts/fixtures/e2e-full-surface-journey.mjs"), join(consumer.consumer, "journey.mjs"));
  copyFileSync(join(repoRoot, "scripts/fixtures/e2e-070-host-completeness-journey.mjs"), join(consumer.consumer, "host-completeness.mjs"));
  run = spawnSync(process.execPath, ["journey.mjs"], { cwd: consumer.consumer, encoding: "utf8", timeout: JOURNEY_CEILING_MS });
  hostRun = spawnSync(process.execPath, ["host-completeness.mjs"], {
    cwd: consumer.consumer,
    encoding: "utf8",
    timeout: JOURNEY_CEILING_MS,
  });
  run.durationMs = Date.now() - fixtureStartedMs;
});

after(() => consumer?.cleanup());

describe("packed-install full-surface journey", () => {
  it("packs and installs every listed package at the workspace version", () => {
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
    const resolved = resolveFromConsumer(consumer.consumer, "@arnilo/prism-hosts/evals");
    assert.ok(resolved.startsWith(`file://${consumer.consumer}`), `resolved to ${resolved}, expected consumer node_modules`);
    assert.equal(resolved.includes(repoRoot), false, "must not resolve into the workspace tree");
  });

  it("completes every package section from packed public exports", () => {
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /FULL SURFACE JOURNEY OK/, run.stdout + run.stderr);
  });

  it("finishes within the journey ceiling", () => {
    assert.ok(run, "journey must have run");
    assert.ok(run.durationMs < JOURNEY_CEILING_MS, `journey took ${run.durationMs}ms`);
  });

  it("completes the 0.7.0 host-completeness packed journey", () => {
    assert.equal(hostRun.status, 0, hostRun.stdout + hostRun.stderr);
    assert.match(hostRun.stdout, /HOST COMPLETENESS JOURNEY OK/);
    assert.match(hostRun.stdout, /EVAL OK/);
    assert.match(hostRun.stdout, /"sampleCount":3/);
    assert.match(hostRun.stdout, /R16 OK/);
    assert.doesNotMatch(hostRun.stdout, /R16 BLOCKED/);
    assert.match(hostRun.stdout, /R17 OK/);
    assert.doesNotMatch(hostRun.stdout, /R17 BLOCKED/);
  });
});
