#!/usr/bin/env node
/**
 * Phase 26 (plan 026 Task 7): protected real coding-agent release journey.
 *
 * Packs the first-party packages, installs them into a fresh consumer, runs
 * scripts/fixtures/phase26-coding-journey.mjs inside that consumer with real
 * host services, and retains scripts/phase26-coding-journey-report.json.
 *
 * Protected profile (never a passing skip): without PRISM_CODING_JOURNEY=1 or
 * any required frozen env/service, this script prints a BLOCKED GATE message
 * and exits 1. Default `npm test` does not run this script; the protected
 * release profile runs it (locally or in .github/workflows/coding-journey.yml)
 * with every service provisioned. release-skip-manifest.mjs consumes the
 * retained report: state pass -> pass, blocked/partial -> blocked, not_run or
 * missing -> documented protected gap.
 *
 * Required env:
 *   PRISM_CODING_JOURNEY=1
 *   PRISM_TEST_POSTGRES_URL        real Postgres connection string
 *   PRISM_TEST_DOCKER_BIN          absolute docker executable
 *   PRISM_TEST_DOCKER_IMAGE        digest-pinned image (name@sha256:...)
 *   PRISM_LIVE_PLAYWRIGHT=1        host Playwright chromium (installed into
 *                                  the consumer as playwright-core, pinned)
 *   PRISM_CODING_FORGE_REPOSITORY  owner/repo for the real forge leg
 *   PRISM_CODING_FORGE_TOKEN       GitHub token (late-bound, never argv/log)
 *   PRISM_CODING_PROVIDER          absolute path to a provider adapter module
 *                                  exporting createJourneyProvider()
 * Optional (frozen profile):
 *   PRISM_TEST_PTY_BACKEND         absolute path to a module exporting
 *                                  createPtyBackend() (host PTY engine)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createPackedConsumer, installedVersion, repoRoot, resolveFromConsumer } from "./fixtures/packed-consumer.mjs";

const freeze = JSON.parse(readFileSync(join(repoRoot, "scripts/phase26-freeze-manifest.json"), "utf8"));
const WALL_DEFAULT_MS = Number(/^(\d+)/.exec(freeze.frozenCaps.journey.wallMs)?.[1] ?? 1_200_000);
const WALL_HARD_MS = Number(/(\d+)$/.exec(freeze.frozenCaps.journey.wallMs)?.[1] ?? 2_400_000);
const CLEANUP_HARD_MS = Number(/(\d+)$/.exec(freeze.frozenCaps.journey.cleanupMs)?.[1] ?? 900_000);
const REPORT_PATH = join(repoRoot, "scripts", "phase26-coding-journey-report.json");
const REQUIRED_ENVS = [
  "PRISM_TEST_POSTGRES_URL",
  "PRISM_TEST_DOCKER_BIN",
  "PRISM_TEST_DOCKER_IMAGE",
  "PRISM_LIVE_PLAYWRIGHT",
  "PRISM_CODING_FORGE_REPOSITORY",
  "PRISM_CODING_FORGE_TOKEN",
  "PRISM_CODING_PROVIDER",
];

const packages = [
  { dir: ".", name: "@arnilo/prism" },
  { dir: "packages/coding-agent", name: "@arnilo/prism-coding-agent" },
  { dir: "packages/coding-security", name: "@arnilo/prism-coding-security" },
  { dir: "packages/ag-ui", name: "@arnilo/prism-ag-ui" },
  { dir: "packages/web-tools", name: "@arnilo/prism-web-tools" },
  { dir: "packages/prism-core", name: "@arnilo/prism-core" },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
];

// ---------------------------------------------------------------------------
// Protected gate: never a passing skip. Missing gate or infra => BLOCKED + exit 1.
const gateFailures = [];
if (process.env.PRISM_CODING_JOURNEY !== "1") gateFailures.push("PRISM_CODING_JOURNEY=1 is required");
for (const name of REQUIRED_ENVS) {
  if (name === "PRISM_LIVE_PLAYWRIGHT") {
    if (process.env.PRISM_LIVE_PLAYWRIGHT !== "1") gateFailures.push("PRISM_LIVE_PLAYWRIGHT=1 is required (host Playwright browser)");
    continue;
  }
  if (!process.env[name]) gateFailures.push(`${name} is required`);
}
if (process.env.PRISM_CODING_PROVIDER && !existsSync(process.env.PRISM_CODING_PROVIDER)) {
  gateFailures.push(`PRISM_CODING_PROVIDER does not exist: ${process.env.PRISM_CODING_PROVIDER}`);
}
if (process.env.PRISM_TEST_DOCKER_IMAGE && !process.env.PRISM_TEST_DOCKER_IMAGE.includes("@sha256:")) {
  gateFailures.push("PRISM_TEST_DOCKER_IMAGE must be digest-pinned (name@sha256:...)");
}
if (gateFailures.length > 0) {
  console.error(`BLOCKED GATE: the phase26 protected coding journey cannot run without every frozen env/service:
  ${gateFailures.join("\n  ")}
The protected release profile requires all of them; missing infrastructure is blocked, never a passing skip.`);
  process.exit(1);
}

// Leak-scan canaries: every credential-looking env VALUE (names only are
// recorded; values are compared against captured output and never written).
function credentialCanaries() {
  const found = new Set();
  for (const [name, value] of Object.entries(process.env)) {
    if (value && /(TOKEN|KEY|SECRET|PASSWORD)/i.test(name) && value.length >= 8) found.add(value);
  }
  return [...found];
}

let consumer;
let run;
let journeyWorkspace;
let fixtureStartedMs;
let playwrightInstall;
before(() => {
  fixtureStartedMs = Date.now();
  const packed = createPackedConsumer(packages);
  consumer = packed;
  if (packed.installStatus !== 0) return;
  if (process.env.PRISM_LIVE_PLAYWRIGHT === "1") {
    playwrightInstall = spawnSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", "playwright-core@1.61.0"], {
      cwd: packed.consumer,
      encoding: "utf8",
      timeout: 300_000,
    });
  }
  copyFileSync(join(repoRoot, "scripts/fixtures/phase26-coding-journey.mjs"), join(packed.consumer, "journey.mjs"));
  const suffix = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  journeyWorkspace = mkdtempSync(join(tmpdir(), "prism-journey-ws-"));
  run = spawnSync(process.execPath, ["journey.mjs"], {
    cwd: packed.consumer,
    encoding: "utf8",
    timeout: WALL_HARD_MS,
    env: {
      ...process.env,
      PRISM_JOURNEY_SUFFIX: suffix,
      PRISM_JOURNEY_WORKSPACE: journeyWorkspace,
      PRISM_PHASE26_JOURNEY_REPORT: REPORT_PATH,
    },
  });
  run.durationMs = Date.now() - fixtureStartedMs;
  if (run.status === null && run.signal === "SIGTERM") {
    run.timedOut = true;
  }
});

after(() => {
  if (journeyWorkspace) rmSync(journeyWorkspace, { recursive: true, force: true });
  consumer?.cleanup();
});

describe("protected real coding-agent journey", () => {
  it("packs and installs the exact manifest graph into a fresh consumer", () => {
    assert.equal(consumer.installStatus, 0, consumer.installOut);
    for (const pkg of packages) {
      assert.equal(
        installedVersion(consumer.consumer, pkg.name),
        JSON.parse(readFileSync(join(repoRoot, pkg.dir, "package.json"), "utf8")).version,
        `${pkg.name} installed version must match the packed manifest`,
      );
    }
    assert.ok(resolveFromConsumer(consumer.consumer, "@arnilo/prism-coding-agent").startsWith(`file://${consumer.consumer}`));
  });

  it("installs the pinned host browser into the consumer for the browser leg", () => {
    if (process.env.PRISM_LIVE_PLAYWRIGHT !== "1") return;
    assert.equal(playwrightInstall.status, 0, playwrightInstall.stdout + playwrightInstall.stderr);
    assert.equal(installedVersion(consumer.consumer, "playwright-core"), "1.61.0");
  });

  it("completes the full real journey within the frozen wall ceiling", () => {
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /PROTECTED CODING JOURNEY OK/, run.stdout + run.stderr);
    assert.ok(run.durationMs <= WALL_DEFAULT_MS, `journey wall ${run.durationMs}ms exceeds the default ceiling ${WALL_DEFAULT_MS}ms`);
  });

  it("retains a pass report with timings, states, and ids only", () => {
    assert.ok(existsSync(REPORT_PATH), "report must be retained");
    const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    assert.equal(report.journey.state, "pass");
    assert.equal(report.blocked, false);
    assert.ok(report.cleanupMs <= CLEANUP_HARD_MS, `cleanup ${report.cleanupMs}ms exceeds the hard ceiling ${CLEANUP_HARD_MS}ms`);
    assert.ok(
      report.journey.legs.every((leg) => leg.state === "pass"),
      `blocked leg: ${JSON.stringify(report.journey.legs)}`,
    );
    assert.ok(
      report.cleanups.every((c) => c.state === "pass"),
      `blocked cleanup: ${JSON.stringify(report.cleanups)}`,
    );
    for (const name of [
      "provider",
      "docker",
      "workspace",
      "agent-edit",
      "check-diagnostics",
      "patch-review",
      "process-recovery",
      "durable-cancel",
      "forge",
      "browser",
    ]) {
      assert.ok(
        report.journey.legs.some((leg) => leg.id === name),
        `leg ${name} must have run`,
      );
    }
    const text = JSON.stringify(report);
    assert.doesNotMatch(text, /(PRISM_[A-Z0-9_]+)=/, "report must record env names, never values");
    assert.ok(text.includes("blocked"), "report carries the blocked state marker");
  });

  it("leak scan: no credential canary appears in journey output or the report", () => {
    const captured = `${run.stdout}\n${run.stderr}\n${readFileSync(REPORT_PATH, "utf8")}`;
    for (const canary of credentialCanaries()) {
      assert.ok(!captured.includes(canary), "a credential value leaked into journey output or the report");
    }
  });
});
