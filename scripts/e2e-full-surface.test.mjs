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
  { dir: "packages/hosts/channels", name: "@arnilo/prism-channels" },
  { dir: "packages/hosts/evals", name: "@arnilo/prism-evals" },
  { dir: "packages/hosts/devtools", name: "@arnilo/prism-devtools" },
  { dir: "packages/memory/core", name: "@arnilo/prism-memory-core" },
  { dir: "packages/knowledge/rag", name: "@arnilo/prism-rag" },
  { dir: "packages/knowledge/wiki", name: "@arnilo/prism-wiki" },
  { dir: "packages/memory/compaction", name: "@arnilo/prism-memory-compaction" },
  { dir: "packages/memory/system", name: "@arnilo/prism-memory-system" },
  { dir: "packages/policy/governance", name: "@arnilo/prism-governance" },
  { dir: "packages/policy/model-router", name: "@arnilo/prism-model-router" },
  { dir: "packages/integrations/workflows", name: "@arnilo/prism-workflows" },
  { dir: "packages/integrations/observability", name: "@arnilo/prism-observability" },
  { dir: "packages/context/files", name: "@arnilo/prism-context-files" },
  { dir: "packages/context/engineering", name: "@arnilo/prism-context-engineering" },
  { dir: "packages/tools/coding", name: "@arnilo/prism-tools-coding" },
  { dir: "packages/tools/browser", name: "@arnilo/prism-tools-browser" },
  { dir: "packages/tools/web", name: "@arnilo/prism-tools-web" },
  { dir: "packages/tools/openapi", name: "@arnilo/prism-tools-openapi" },
  { dir: "packages/tools/computer-use", name: "@arnilo/prism-tools-computer-use" },
  { dir: "packages/tools/work", name: "@arnilo/prism-tools-work" },
  { dir: "packages/hosts/ag-ui", name: "@arnilo/prism-ag-ui" },
  { dir: "packages/integrations/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/hosts/mcp-server", name: "@arnilo/prism-mcp-server" },
  { dir: "packages/integrations/hooks-json", name: "@arnilo/prism-hooks-json" },
  { dir: "packages/stores/jsonl", name: "@arnilo/prism-store-jsonl" },
  { dir: "packages/stores/codecs", name: "@arnilo/prism-store-codecs" },
  { dir: "packages/stores/sqlite", name: "@arnilo/prism-store-sqlite" },
  { dir: "packages/stores/postgres", name: "@arnilo/prism-store-postgres" },
  { dir: "packages/credentials/keyring", name: "@arnilo/prism-credentials-keyring" },
  { dir: "packages/providers/opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/providers/hyper", name: "@arnilo/prism-provider-hyper" },
  { dir: "packages/providers/laya", name: "@arnilo/prism-provider-laya" },
  { dir: "packages/providers/typesafe", name: "@arnilo/prism-provider-typesafe" },
];

let consumer, run, hostRun;
let fixtureStartedMs;
before(() => {
  fixtureStartedMs = Date.now();
  consumer = createPackedConsumer(packages);
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
    const resolved = resolveFromConsumer(consumer.consumer, "@arnilo/prism-evals");
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
