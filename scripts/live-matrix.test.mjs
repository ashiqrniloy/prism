/**
 * Live credential matrix gate (plans/064 Task 1).
 * Hermetic: validates scripts/live-matrix.json shape, the skip contract
 * (missing credential => skip, never fail), and model-selection entries.
 * Registered in the root `npm test` chain.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadMatrix, parseEnvFile, REPO_ROOT, resolveSuiteState, runLiveMatrix, validateMatrix } from "./live-matrix.mjs";

const matrix = loadMatrix();

test("manifest validates fail-closed (no unknown fields, env names, existing sources)", () => {
  const { ok, errors } = validateMatrix(matrix);
  assert.deepEqual(errors, [], errors.join("\n"));
  assert.equal(ok, true);
});

test("active suites are runnable-by-env; planned suites name plan 064", () => {
  for (const suite of matrix.suites) {
    if (suite.status === "active") {
      assert.ok(suite.source && suite.command, `${suite.id}: active needs source + command`);
    } else {
      assert.equal(suite.plan, "plans/064-E2E-Live-Test-Coverage-Matrix.md", suite.id);
    }
  }
});

test("skip contract: missing credential skips with reason, never 'run'", () => {
  const suite = matrix.suites.find((s) => s.id === "providers/openai");
  const missing = resolveSuiteState(suite, { PRISM_LIVE_PROVIDER_TESTS: "1" });
  assert.equal(missing.state, "skip");
  assert.match(missing.reason, /OPENAI_API_KEY/);
  const present = resolveSuiteState(suite, { PRISM_LIVE_PROVIDER_TESTS: "1", OPENAI_API_KEY: "sk-x" });
  assert.equal(present.state, "run");
  // Empty-string env counts as unset.
  assert.equal(resolveSuiteState(suite, { PRISM_LIVE_PROVIDER_TESTS: "1", OPENAI_API_KEY: "" }).state, "skip");
});

test("requiresAny: google runs on either key, skips on neither", () => {
  const google = matrix.suites.find((s) => s.id === "providers/google");
  assert.equal(resolveSuiteState(google, { PRISM_LIVE_PROVIDER_TESTS: "1", GEMINI_API_KEY: "g" }).state, "run");
  assert.equal(resolveSuiteState(google, { PRISM_LIVE_PROVIDER_TESTS: "1", GOOGLE_API_KEY: "g" }).state, "run");
  const neither = resolveSuiteState(google, { PRISM_LIVE_PROVIDER_TESTS: "1" });
  assert.equal(neither.state, "skip");
  assert.match(neither.reason, /GEMINI_API_KEY, GOOGLE_API_KEY/);
});

test("model selection: every provider suite reads its PRISM_LIVE_*_MODEL override (Task 4 retrofit complete)", () => {
  let providerSuites = 0;
  for (const suite of matrix.suites) {
    const isProvider = suite.id.startsWith("providers/");
    if (isProvider) providerSuites++;
    for (const m of suite.model ?? []) {
      assert.ok(m.env.startsWith("PRISM_LIVE_"), `${suite.id}: ${m.env}`);
      assert.ok(m.default.length > 0, `${suite.id}: ${m.env} needs a default`);
      if (isProvider) assert.equal(m.wired, true, `${suite.id}: ${m.env} must be wired after the Task 4 retrofit`);
    }
  }
  assert.equal(providerSuites, 20, "all 20 provider adapters have matrix entries");
  const dash = matrix.suites.find((s) => s.id === "providers/alibaba").model[0];
  assert.equal(dash.env, "PRISM_LIVE_DASHSCOPE_MODEL");
  assert.equal(dash.wired, true);
  for (const id of [
    "providers/azure",
    "providers/bedrock",
    "providers/vertex",
    "providers/ollama",
    "providers/ai-sdk",
    "providers/model-discovery",
  ]) {
    assert.equal(matrix.suites.find((s) => s.id === id).status, "active", `${id} activated by Task 4`);
  }
});

test("no secret-shaped values anywhere in the manifest (names only, never values)", () => {
  const flat = JSON.stringify(matrix);
  assert.doesNotMatch(flat, /sk-[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(flat, /Bearer\s+[A-Za-z0-9._-]{8,}/i);
});

test("validator rejects unknown fields and bad env names (fail closed)", () => {
  const bad = structuredClone(matrix);
  bad.suites[0].mystery = true;
  assert.equal(validateMatrix(bad).ok, false);
  const badEnv = structuredClone(matrix);
  badEnv.suites[0].requires.push("not-an-env-name");
  assert.equal(validateMatrix(badEnv).ok, false);
  const badSchema = structuredClone(matrix);
  badSchema.schemaVersion = 99;
  assert.equal(validateMatrix(badSchema).ok, false);
});

// ── runner (Task 2) ──────────────────────────────────────────────────────

/** Temp repo root with a synthetic 4-suite matrix: two keyed, one either-of,
 * one planned. Suite commands are trivial node -e one-liners. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "prism-live-matrix-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true }); // lockfile home for with-build-lock
  // the real build-lock wrapper (self-contained) so spawned suites exercise it
  writeFileSync(join(root, "scripts", "with-build-lock.mjs"), readFileSync(join(REPO_ROOT, "scripts", "with-build-lock.mjs"), "utf8"));
  writeFileSync(join(root, "scripts", "ok.mjs"), "process.exit(0);\n");
  writeFileSync(join(root, "scripts", "boom.mjs"), "console.error('boom-marker'); process.exit(3);\n");
  for (const id of ["needs-key", "fails", "either"]) {
    writeFileSync(join(root, "scripts", `${id}.mjs`), "// fixture source\n");
  }
  const manifest = {
    schemaVersion: 1,
    suites: [
      {
        id: "fake/needs-key",
        package: "@arnilo/x",
        status: "active",
        source: "scripts/needs-key.mjs",
        command: "node scripts/ok.mjs",
        requires: ["FAKE_KEY"],
        model: [{ env: "FAKE_MODEL", default: "m-default", wired: true }],
      },
      {
        id: "fake/fails",
        package: "@arnilo/x",
        status: "active",
        source: "scripts/fails.mjs",
        command: "node scripts/boom.mjs",
        requires: ["FAKE_KEY"],
      },
      {
        id: "fake/either",
        package: "@arnilo/x",
        status: "active",
        source: "scripts/either.mjs",
        command: "node scripts/ok.mjs",
        requiresAny: ["FAKE_A", "FAKE_B"],
      },
      {
        id: "fake/planned",
        package: "@arnilo/x",
        status: "planned",
        source: null,
        command: null,
        requires: ["FAKE_KEY"],
        plan: "plans/064-E2E-Live-Test-Coverage-Matrix.md",
        notes: "fixture",
      },
    ],
  };
  writeFileSync(join(root, "scripts", "live-matrix.json"), JSON.stringify(manifest));
  return root;
}

const SILENT = () => {};

function readReport(root) {
  return JSON.parse(readFileSync(join(root, "docs", "_evidence", "live-matrix-report.json"), "utf8"));
}

test("runner dry-run: missing credential skips with reason, present creds count ran, exit 0", async () => {
  const root = fixtureRoot();
  const { totals, results, exitCode } = await runLiveMatrix({ root, env: { FAKE_A: "1" }, dryRun: true, log: SILENT });
  assert.deepEqual(totals, { ran: 1, skipped: 2, failed: 0, planned: 1 });
  assert.equal(exitCode, 0);
  const needsKey = results.find((r) => r.id === "fake/needs-key");
  assert.equal(needsKey.status, "skipped");
  assert.match(needsKey.reason, /FAKE_KEY/);
  assert.equal(results.find((r) => r.id === "fake/planned").status, "planned");
  const report = readReport(root);
  assert.deepEqual(report.totals, totals);
  assert.equal(report.dryRun, true);
  assert.ok(existsSync(join(root, "docs", "_evidence", "live-matrix-report.md")));
});

test("runner dry-run: all creds present => all active ran; model override in effect", async () => {
  const root = fixtureRoot();
  const { totals, results } = await runLiveMatrix({
    root,
    env: { FAKE_KEY: "1", FAKE_A: "1", FAKE_MODEL: "m-custom" },
    dryRun: true,
    log: SILENT,
  });
  assert.deepEqual(totals, { ran: 3, skipped: 0, failed: 0, planned: 1 });
  assert.deepEqual(results.find((r) => r.id === "fake/needs-key").models, [{ env: "FAKE_MODEL", value: "m-custom", wired: true }]);
  // default kicks in when the override var is absent
  const fallback = await runLiveMatrix({ root, env: { FAKE_KEY: "1", FAKE_A: "1" }, dryRun: true, log: SILENT });
  assert.equal(fallback.results.find((r) => r.id === "fake/needs-key").models[0].value, "m-default");
});

test("runner strict mode: any skip fails the run", async () => {
  const root = fixtureRoot();
  const { exitCode } = await runLiveMatrix({ root, env: { FAKE_A: "1" }, dryRun: true, strict: true, log: SILENT });
  assert.equal(exitCode, 1);
  const allRun = await runLiveMatrix({ root, env: { FAKE_KEY: "1", FAKE_A: "1" }, dryRun: true, strict: true, log: SILENT });
  assert.equal(allRun.exitCode, 0);
});

test("runner filter: only matching suites execute", async () => {
  const root = fixtureRoot();
  const { totals, results } = await runLiveMatrix({ root, env: { FAKE_KEY: "1" }, dryRun: true, filter: "needs", log: SILENT });
  assert.deepEqual(
    results.filter((r) => r.status !== "planned").map((r) => r.id),
    ["fake/needs-key"],
  );
  assert.deepEqual(totals, { ran: 1, skipped: 0, failed: 0, planned: 0 }); // filter applies to planned rows too
});

test("runner real spawn: failing suite records failed + output tail, exit 1; passing suite ran", async () => {
  const root = fixtureRoot();
  const { totals, results, exitCode } = await runLiveMatrix({
    root,
    env: { ...process.env, FAKE_KEY: "1", FAKE_A: "1" },
    build: null,
    log: SILENT,
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(totals, { ran: 2, skipped: 0, failed: 1, planned: 1 });
  const failed = results.find((r) => r.id === "fake/fails");
  assert.equal(failed.status, "failed");
  assert.match(failed.reason, /exit 3/);
  assert.match(failed.outputTail, /boom-marker/);
  assert.equal(results.find((r) => r.id === "fake/needs-key").status, "ran");
});

test("runner skips never spawn: a requires-missing suite with a broken command still skips", async () => {
  const root = fixtureRoot();
  // break the needs-key command; with no FAKE_KEY the runner must not spawn it
  const manifest = JSON.parse(readFileSync(join(root, "scripts", "live-matrix.json"), "utf8"));
  manifest.suites[0].command = "node scripts/definitely-missing.mjs";
  writeFileSync(join(root, "scripts", "live-matrix.json"), JSON.stringify(manifest));
  const { totals, exitCode } = await runLiveMatrix({ root, env: { ...process.env, FAKE_A: "1" }, build: null, log: SILENT });
  assert.equal(totals.failed, 0);
  assert.equal(totals.skipped, 2);
  assert.equal(exitCode, 0);
});

test("parseEnvFile: comments, export prefix, quotes, blank lines; hard error on garbage", () => {
  const path = join(fixtureRoot(), "scripts", "sample.env");
  writeFileSync(path, '# comment\n\nFAKE_KEY=sk-value\nexport FAKE_OTHER=quoted\nFAKE_QUOTE="double quoted"\n');
  const parsed = parseEnvFile(path);
  assert.deepEqual(parsed, { FAKE_KEY: "sk-value", FAKE_OTHER: "quoted", FAKE_QUOTE: "double quoted" });
  writeFileSync(path, "this is not dotenv\n");
  assert.throws(() => parseEnvFile(path), /expected KEY=VALUE/);
});
