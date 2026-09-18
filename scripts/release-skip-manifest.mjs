#!/usr/bin/env node
// Release-level skip/protected evidence manifest (plan 023 Task 3).
// Aggregates every test surface into scripts/release-evidence.json with state
// pass/skip/blocked/protected. Records env var NAMES only, never values
// (the manifest is retained and uploaded by CI).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditBlockedGates, protectedGateSurfaces } from "./blocked-gate.mjs";

const ROOT = join(import.meta.dirname, "..");
const MANIFEST_PATH = process.env.PRISM_RELEASE_EVIDENCE ?? join(ROOT, "scripts", "release-evidence.json");
const COVERAGE_ARTIFACT = process.env.PRISM_COVERAGE_ARTIFACT ?? join(ROOT, "scripts", "coverage-summary.json");
const THRESHOLDS_PATH = join(ROOT, "scripts", "coverage-thresholds.json");
const REQUIRED_POSTGRES_ENV = "PRISM_TEST_POSTGRES_URL";
const POSTGRES_EVIDENCE_PATH = process.env.PRISM_POSTGRES_EVIDENCE ?? join(ROOT, "scripts", "postgres-evidence.json");

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

function postgresEvidenceForCurrentHead(path) {
  if (!existsSync(path)) return { reason: "no postgres evidence for this run (run npm run test:postgres)" };
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { reason: "postgres evidence is unreadable" };
  }
  const { gitHead, captured, counts } = evidence;
  if (
    !/^[0-9a-f]{40,64}$/i.test(gitHead ?? "") ||
    typeof captured !== "string" ||
    Number.isNaN(Date.parse(captured)) ||
    !Number.isInteger(counts?.tests) ||
    !Number.isInteger(counts?.pass) ||
    !Number.isInteger(counts?.fail) ||
    counts.tests < 1 ||
    counts.pass < 1 ||
    counts.pass > counts.tests ||
    counts.fail !== 0
  ) {
    return { reason: "postgres evidence is invalid" };
  }
  let currentHead;
  try {
    currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return { reason: "cannot determine current git HEAD for postgres evidence" };
  }
  if (gitHead !== currentHead) return { reason: "postgres evidence is not for current git HEAD" };
  return { evidence };
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

function buildSurfaces({ baseline, artifact, thresholds, packages, postgresEvidence }) {
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
      // Prefer POSTGRES here: the nats legs already carry their own dedicated
      // "test:nats real JetStream legs" surface, so naming POSTGRES on the core
      // suite row keeps both durable-env classes visible in the manifest.
      const requiredEnv = srcEnvs.has("PRISM_TEST_POSTGRES_URL")
        ? "PRISM_TEST_POSTGRES_URL"
        : srcEnvs.has("PRISM_TEST_NATS_URL")
          ? "PRISM_TEST_NATS_URL"
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

  // Required: postgres durable conformance. A matching, successful this-tree
  // run is the evidence; a phase baseline cannot attest the current checkout.
  // CI verify does not run the suite (no Postgres service); publish already
  // needs the postgres-integration job. PRISM_RELEASE_POSTGRES_JOB keeps that
  // split from failing closed on missing evidence.
  if (envSet("PRISM_RELEASE_POSTGRES_JOB") && !postgresEvidence.evidence) {
    surfaces.push({
      name: "test:postgres durable conformance",
      state: "protected",
      protected: true,
      requiredEnv: REQUIRED_POSTGRES_ENV,
      reason: "verify job does not run test:postgres; publish needs the postgres-integration job (pgvector/pgvector:pg16)",
    });
  } else if (!envSet(REQUIRED_POSTGRES_ENV)) {
    surfaces.push({
      name: "test:postgres durable conformance",
      state: "blocked",
      protected: true,
      requiredEnv: REQUIRED_POSTGRES_ENV,
      reason: `${REQUIRED_POSTGRES_ENV} not set at release-evidence time`,
    });
  } else if (!postgresEvidence.evidence) {
    surfaces.push({
      name: "test:postgres durable conformance",
      state: "blocked",
      protected: true,
      requiredEnv: REQUIRED_POSTGRES_ENV,
      reason: postgresEvidence.reason,
    });
  } else {
    surfaces.push({
      name: "test:postgres durable conformance",
      state: "pass",
      protected: true,
      requiredEnv: REQUIRED_POSTGRES_ENV,
      count: postgresEvidence.evidence.counts.tests,
    });
  }

  // Protected: real NATS JetStream legs. `npm run test:nats` exists, but
  // release CI has no broker to run it against.
  surfaces.push({
    name: "test:nats real JetStream legs",
    state: "protected",
    protected: true,
    live: true,
    requiredEnv: "PRISM_TEST_NATS_URL",
    reason:
      "no NATS service in release CI; npm run test:nats requires PRISM_TEST_NATS_URL and runs the real JetStream suite outside default network-free runs",
  });

  // Protected: provider live legs (offline conformance suites cover the same
  // mapping code, so the measured offline baseline is the regression signal).
  // Plan 054 Task 6: adapters live as subpaths of the providers family, so the
  // scan enumerates each adapter subtree to keep every live class visible.
  const providerScanDirs = packages.flatMap(({ dir, name }) => {
    const familySrc = join(ROOT, "packages", dir, "src");
    if (name === "@arnilo/prism-providers" && existsSync(familySrc)) {
      return readdirSync(familySrc, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ dir: join(dir, "src", e.name), name: `${name}/${e.name}` }));
    }
    return [{ dir, name }];
  });
  for (const { dir, name } of providerScanDirs) {
    if (envsInTree(join(ROOT, "packages", dir)).has("PRISM_LIVE_PROVIDER_TESTS")) {
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

  surfaces.push({
    name: "xAI SuperGrok OAuth live login",
    state: "protected",
    protected: true,
    live: true,
    requiredEnv: "PRISM_LIVE_XAI_OAUTH",
    reason:
      "device-code SuperGrok login requires a real SuperGrok/X Premium session; offline oauth.test.ts covers form-urlencoded poll; never a silent pass",
  });

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

  // Protected: Obscura live browser legs (plan 039). Binary/Docker/Playwright
  // live smoke behind the test:live script; offline fake-CLI suite covers the
  // same argv/serialization surface. Never a silent pass: enabling without a
  // binary throws in live.test.ts.
  surfaces.push({
    name: "Obscura live browser legs",
    state: "protected",
    protected: true,
    live: true,
    requiredEnv: "PRISM_LIVE_OBSCURA",
    reason:
      "requires a host-installed Obscura binary (PRISM_OBSCURA_BIN) and public web access; offline suites drive a deterministic fake CLI and the host-conformance abort leg kills owned children; never a silent pass",
  });

  // Protected: real coding journey (plan 026 Task 7). Consumes the retained
  // phase26-coding-journey-report.json: pass only for a real pass run;
  // blocked/partial reports block release evidence (fail closed); not_run or
  // missing reports are documented protected gaps (runs in coding-journey.yml
  // with every frozen env/service provisioned; the report is regenerated by
  // scripts/phase26-coding-journey.test.mjs and retained as evidence).
  const journeyReportPath = join(ROOT, "scripts", "phase26-coding-journey-report.json");
  const journeyReport = existsSync(journeyReportPath) ? JSON.parse(readFileSync(journeyReportPath, "utf8")) : undefined;
  const journeyState = journeyReport?.journey?.state;
  const journeyLegs = Array.isArray(journeyReport?.journey?.legs) ? journeyReport.journey.legs.length : 0;
  if (journeyState === "pass" && journeyReport?.blocked === false) {
    surfaces.push({
      name: "protected coding journey (0.2.6, plan 026)",
      state: "pass",
      protected: true,
      requiredEnv: "PRISM_CODING_JOURNEY",
      count: journeyLegs,
      source: `phase26-coding-journey-report.json (${journeyReport.generatedAt ?? "?"})`,
    });
  } else if (journeyState && journeyState !== "not_run") {
    surfaces.push({
      name: "protected coding journey (0.2.6, plan 026)",
      state: "blocked",
      protected: true,
      requiredEnv: "PRISM_CODING_JOURNEY",
      reason: `phase26-coding-journey-report.json records journey state '${journeyState}' (blocked=${journeyReport?.blocked}); rerun scripts/phase26-coding-journey.test.mjs with every frozen env/service and retain a pass report`,
    });
  } else {
    surfaces.push({
      name: "protected coding journey (0.2.6, plan 026)",
      state: "protected",
      protected: true,
      requiredEnv: "PRISM_CODING_JOURNEY",
      reason:
        "runs in .github/workflows/coding-journey.yml (real provider, digest-pinned Docker sandbox, host Playwright browser, real GitHub forge, real Postgres, host PTY when in the frozen profile); the retained report is regenerated by scripts/phase26-coding-journey.test.mjs on real runs only",
      source: `coding-journey.yml; inherited evidence: ${baseline ? `${baseline.name} exitGate/protectedEvidence` : "no baseline"}`,
    });
  }

  // Protected: the documented-gap legs from the blocked-gate registry
  // (scripts/blocked-gate.mjs) — one row per leg, so the manifest and
  // `node scripts/blocked-gate.mjs` can never disagree about what is blocked.
  surfaces.push(...protectedGateSurfaces());

  return surfaces;
}

export function buildManifest({
  artifactPath = COVERAGE_ARTIFACT,
  thresholdsPath = THRESHOLDS_PATH,
  postgresEvidencePath = POSTGRES_EVIDENCE_PATH,
} = {}) {
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const baseline = latestBaseline();
  const artifact = existsSync(artifactPath) ? JSON.parse(readFileSync(artifactPath, "utf8")) : undefined;
  const thresholds = existsSync(thresholdsPath) ? JSON.parse(readFileSync(thresholdsPath, "utf8")) : undefined;
  const postgresEvidence = postgresEvidenceForCurrentHead(postgresEvidencePath);
  const surfaces = buildSurfaces({ baseline, artifact, thresholds, packages: workspacePackages(), postgresEvidence });
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
  const blocked = auditBlockedGates();
  const profile = blocked.filter((row) => row.manifestClass === "required").map((row) => row.id);
  console.log(
    `protected legs not runnable here: ${blocked.length} (release-profile: ${profile.length ? profile.join(", ") : "none"}); audit: node scripts/blocked-gate.mjs`,
  );
  console.log(`manifest: ${MANIFEST_PATH}`);
}
