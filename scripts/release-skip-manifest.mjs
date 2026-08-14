#!/usr/bin/env node
// Release-level skip/protected evidence manifest (plan 023 Task 3).
// Aggregates every test surface into scripts/release-evidence.json with state
// pass/skip/blocked/protected. Records env var NAMES only, never values
// (the manifest is retained and uploaded by CI).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MANIFEST_PATH = process.env.PRISM_RELEASE_EVIDENCE ?? join(ROOT, "scripts", "release-evidence.json");
const COVERAGE_ARTIFACT = process.env.PRISM_COVERAGE_ARTIFACT ?? join(ROOT, "scripts", "coverage-summary.json");
const THRESHOLDS_PATH = join(ROOT, "scripts", "coverage-thresholds.json");
const REQUIRED_POSTGRES_ENV = "PRISM_TEST_POSTGRES_URL";

// The four live canaries implemented by scripts/live-canary.mjs (run by
// .github/workflows/live-canaries.yml with real credentials, outside the
// release gate). Never state "pass": they are protected, documented gaps.
const CANARIES = [
  { name: "live provider canary", env: "PRISM_CANARY_PROVIDER_URL" },
  { name: "live MCP canary", env: "PRISM_CANARY_MCP_URL" },
  { name: "live A2A canary", env: "PRISM_CANARY_A2A_URL" },
  { name: "live web search canary", env: "PRISM_BRAVE_SEARCH_TOKEN" },
];

function latestBaseline() {
  const files = readdirSync(join(ROOT, "scripts"))
    .filter((f) => /^phase\d+-baseline\.json$/.test(f))
    .sort();
  if (!files.length) return undefined;
  const name = files.at(-1);
  return { name, data: JSON.parse(readFileSync(join(ROOT, "scripts", name), "utf8")) };
}

function envSet(name) {
  const value = process.env[name];
  return value !== undefined && value !== "";
}

function parseCounts(pattern, text) {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : undefined;
}

function npmTestCounts(text) {
  const match = /(\d+) tests? \/ (\d+) pass \/ (\d+) skip \/ (\d+) fail/.exec(text);
  if (!match) return undefined;
  return { tests: Number(match[1]), pass: Number(match[2]), skip: Number(match[3]), fail: Number(match[4]) };
}

// The phase baselines keep the machine-readable counts under exitGate.counts
// (the top-level npmTest/threatSuites/testPostgres fields are prose objects).
function countsOf(baseline) {
  return baseline?.data.exitGate?.counts ?? {};
}

// PRISM_ env names referenced from a package's sources (never values).
function envsInTree(dir) {
  const found = new Set();
  if (!existsSync(dir)) return found;
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|mts|mjs)$/.test(entry.name)) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(match[1]);
      }
    }
  };
  walk(dir);
  return found;
}

function workspacePackages() {
  return readdirSync(join(ROOT, "packages"))
    .filter((dir) => existsSync(join(ROOT, "packages", dir, "package.json")))
    .sort()
    .map((dir) => ({ dir, name: JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8")).name }));
}

function buildSurfaces({ baseline, artifact, thresholds, packages }) {
  const surfaces = [];

  // Required: core npm test.
  const counts = countsOf(baseline);
  const testCounts = npmTestCounts(counts.npmTest ?? "");
  if (!testCounts) {
    surfaces.push({ name: "core npm test", state: "blocked", reason: "no npmTest counts in baseline" });
  } else if (testCounts.fail > 0) {
    surfaces.push({ name: "core npm test", state: "blocked", reason: `npm test failed (${testCounts.fail} failures)` });
  } else {
    surfaces.push({ name: "core npm test", state: "pass", count: testCounts.tests, skip: testCounts.skip });
  }

  // Required: security threat suites.
  const threatCount = parseCounts(/(\d+)\/\d+/, counts.threatSuites ?? "");
  surfaces.push(
    threatCount
      ? { name: "security:threat-suites", state: "pass", count: threatCount }
      : {
          name: "security:threat-suites",
          state: "blocked",
          reason: "no threat-suites evidence in baseline (run npm run security:threat-suites)",
        },
  );

  // Required: workspace suites (evidence from the coverage artifact of the
  // same sdk:ready run; protectedException packages are documented gaps).
  const thresholdMap = thresholds?.packages ?? {};
  for (const { dir, name } of packages) {
    const row = artifact?.packages?.[name];
    const exception = thresholdMap[name]?.protectedException;
    // Packages without a test suite are not test surfaces (no dist/__tests__).
    const hasSuite = existsSync(join(ROOT, "packages", dir, "dist", "__tests__"));
    if (!hasSuite && !row) continue;
    if (exception) {
      const srcEnvs = envsInTree(join(ROOT, "packages", dir, "src"));
      const requiredEnv = srcEnvs.has("PRISM_TEST_NATS_URL")
        ? "PRISM_TEST_NATS_URL"
        : srcEnvs.has("PRISM_TEST_POSTGRES_URL")
          ? "PRISM_TEST_POSTGRES_URL"
          : /(PRISM_[A-Z0-9_]+)/.exec(exception)?.[1];
      surfaces.push({
        name: `${name} suite`,
        state: "protected",
        protected: true,
        reason: exception,
        ...(requiredEnv ? { requiredEnv } : {}),
      });
    } else if (!artifact) {
      surfaces.push({
        name: `${name} suite`,
        state: "blocked",
        reason: "no coverage-summary.json evidence (run npm run test:coverage first)",
      });
    } else if (!row) {
      surfaces.push({ name: `${name} suite`, state: "blocked", reason: "missing from coverage artifact" });
    } else {
      surfaces.push(
        row.pass
          ? { name: `${name} suite`, state: "pass" }
          : { name: `${name} suite`, state: "blocked", reason: "below its coverage threshold (see coverage-summary.json)" },
      );
    }
  }

  // Required: postgres durable conformance (a release cannot ship with the
  // required env absent; the release pipeline runs it in the
  // postgres-integration job).
  const postgresCount = parseCounts(/(\d+)\/\d+/, counts.testPostgres ?? "");
  if (!envSet(REQUIRED_POSTGRES_ENV)) {
    surfaces.push({
      name: "test:postgres durable conformance",
      state: "blocked",
      protected: true,
      requiredEnv: REQUIRED_POSTGRES_ENV,
      reason: `${REQUIRED_POSTGRES_ENV} not set at release-evidence time`,
    });
  } else if (!postgresCount) {
    surfaces.push({
      name: "test:postgres durable conformance",
      state: "blocked",
      protected: true,
      requiredEnv: REQUIRED_POSTGRES_ENV,
      reason: `${REQUIRED_POSTGRES_ENV} set but no testPostgres evidence in baseline`,
    });
  } else {
    surfaces.push({
      name: "test:postgres durable conformance",
      state: "pass",
      protected: true,
      requiredEnv: REQUIRED_POSTGRES_ENV,
      count: postgresCount,
    });
  }

  // Protected: real NATS JetStream legs (no NATS service in release CI; the
  // real-leg suite does not exist yet — the offline fake-jetstream seam only
  // runs in default workspace tests).
  surfaces.push({
    name: "test:nats real JetStream legs",
    state: "protected",
    protected: true,
    live: true,
    requiredEnv: "PRISM_TEST_NATS_URL",
    reason:
      "no NATS service in release CI and no suite references PRISM_TEST_NATS_URL yet; offline fake-jetstream seam only in default runs (session-store-nats); real-leg expansion is roadmap 0.3.0",
  });

  // Protected: provider live legs (offline conformance suites cover the same
  // mapping code, so the measured offline baseline is the regression signal).
  for (const { dir, name } of packages) {
    if (envsInTree(join(ROOT, "packages", dir, "src")).has("PRISM_LIVE_PROVIDER_TESTS")) {
      surfaces.push({
        name: `${name} live provider legs`,
        state: "protected",
        protected: true,
        live: true,
        requiredEnv: "PRISM_LIVE_PROVIDER_TESTS",
        reason:
          "live provider tests require real credentials (PRISM_LIVE_PROVIDER_TESTS gate); offline conformance suites cover the same mapping code",
      });
    }
  }

  // Protected: live canaries (scheduled live-canaries workflow, real
  // credentials, outside the release gate). Never pass.
  const inherited = baseline ? `${baseline.name} exitGate/protectedEvidence` : "no baseline";
  for (const canary of CANARIES) {
    surfaces.push({
      name: canary.name,
      state: "protected",
      protected: true,
      live: true,
      reason: `runs in .github/workflows/live-canaries.yml (scheduled, real credentials, PRISM_LIVE_CANARIES gate); ${canary.env} absent in release CI by design; full live-service matrix is roadmap 0.3.0`,
      source: `live-canaries.yml; inherited evidence: ${inherited}`,
    });
  }

  return surfaces;
}

export function buildManifest({ artifactPath = COVERAGE_ARTIFACT, thresholdsPath = THRESHOLDS_PATH } = {}) {
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const baseline = latestBaseline();
  const artifact = existsSync(artifactPath) ? JSON.parse(readFileSync(artifactPath, "utf8")) : undefined;
  const thresholds = existsSync(thresholdsPath) ? JSON.parse(readFileSync(thresholdsPath, "utf8")) : undefined;
  const surfaces = buildSurfaces({ baseline, artifact, thresholds, packages: workspacePackages() });
  const crossRef = baseline
    ? {
        baseline: baseline.name,
        exitGate: {
          protected: baseline.data.exitGate?.protected ?? null,
          blocked: baseline.data.exitGate?.blocked ?? null,
          note: baseline.data.exitGate?.note ?? null,
        },
        protectedEvidence: baseline.data.protectedEvidence ?? null,
      }
    : null;
  const manifest = {
    release: version,
    captured: new Date().toISOString(),
    surfaces,
    blocked: surfaces.some((surface) => surface.state === "blocked"),
    crossRef,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const manifest = buildManifest();
  console.log(`release evidence: ${manifest.surfaces.length} surfaces, blocked=${manifest.blocked}`);
  console.log(`manifest: ${MANIFEST_PATH}`);
}
