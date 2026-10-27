// Plan 124 Task 3: the Postgres evidence wrapper parses Bun's reporter contract, not Node TAP.
// The contract is frozen in docs/_evidence/phase124-bun-only-inventory.md §3; this gate pins the
// parser and the fail-closed behaviour the release manifest depends on.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import { fileURLToPath } from "node:url";
import { evidenceCounts, evidenceDocument, parseReport } from "./postgres-evidence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Verbatim shapes from the Task 1 transcript (times elided).
const PASS_LINES = [
  "(pass) memory durable events survive a restart [3.19ms]",
  "(pass) rag acl filters revoked principals [0.64ms]",
  "(pass) propagation repoints the lineage [0.14ms]",
];
const SUMMARY = "Ran 4 tests across 2 files. [1.20s]";

test("the bun reporter contract parses to pass/fail counts", () => {
  const capture = [...PASS_LINES, "(fail) propagation survives a reconnect [12.40ms]", "", SUMMARY].join("\n");
  assert.deepEqual(parseReport(capture), { tests: 4, pass: 3, fail: 1 });
  assert.deepEqual(evidenceCounts(`${PASS_LINES.join("\n")}\n${SUMMARY}`), { tests: 4, pass: 3, fail: 0 });
});

test("an empty or summary-less capture fails closed", () => {
  assert.throws(() => evidenceCounts(""), /no `Ran N tests across M files\.` summary/);
  // Result lines without the summary line are exactly the truncated-capture shape: no evidence.
  assert.throws(() => parseReport(PASS_LINES.join("\n")), /no `Ran N tests across M files\.` summary/);
});

test("a child that exits 0 with no recorded tests fails the leg", () => {
  assert.throws(() => evidenceCounts("Ran 0 tests across 0 files. [0.02ms]"), /no tests ran/);
  assert.throws(() => evidenceCounts(`Ran 2 tests across 1 file. [1ms]\n${SUMMARY}`), /no passing tests recorded/);
  assert.throws(() => evidenceCounts(`${PASS_LINES.join("\n")}\nRan 2 tests across 1 file. [1ms]`), /pass count 3 exceeds/);
});

test("the wrapper is wired into the bun chain: URL gate first, workspace legs, then the phase files", () => {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(scripts["test:postgres"], "bun scripts/postgres-evidence.mjs");
  const chain = scripts["test:postgres:run"];
  const order = [
    "bun scripts/require-postgres-url.mjs",
    "bun run --filter @arnilo/prism-store-postgres test:postgres",
    "bun run --filter @arnilo/prism-channels test:postgres",
    "bun test --timeout=0 scripts/phase7-conformance.test.mjs",
  ].map((step) => chain.indexOf(step));
  assert.ok(
    order.every((index) => index >= 0),
    `test:postgres:run is missing a leg: ${chain}`,
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    "the URL gate, workspace legs, and phase files must stay in that order",
  );
  assert.ok(!chain.includes("npm "), `test:postgres:run must stay on bun: ${chain}`);
});

// Plan 153 Task 5: the session-store integrations run in the store package's leg.
const postgresRegressions = [
  "postgres_evaluation_store_conformance",
  "migration_upgrades_existing_database_with_evaluations",
  "scopes ordinary and leaf entry queries to the owning session",
  "filters and keyset-paginates branch entry queries",
  "keeps session activity monotonic across run, usage, and event writes",
].map((name) => `@arnilo/prism-store-postgres test:postgres: (pass) createPostgresPersistence integration > ${name} [1ms]`);
const liveCapture = [
  ...postgresRegressions,
  "@arnilo/prism-store-postgres test:postgres: Ran 5 tests across 1 file. [1ms]",
  "@arnilo/prism-channels test:postgres: (pass) channels integration [1ms]",
  "@arnilo/prism-channels test:postgres: Ran 1 test across 1 file. [1ms]",
  "(pass) process conformance [1ms]",
  "Ran 1 test across 1 file. [1ms]",
].join("\n");
const makeDocument = (output) => evidenceDocument({ gitHead: "0".repeat(40), captured: "2026-09-25T00:00:00.000Z", output });

test("service evidence counts every leg and requires live PostgreSQL regression cases", () => {
  assert.deepEqual(parseReport(liveCapture), { tests: 7, pass: 7, fail: 0 });
  assert.equal(makeDocument(liveCapture).counts.pass, 7);
  for (const regression of postgresRegressions) {
    assert.throws(
      () => makeDocument(liveCapture.replace(regression, regression.replace("(pass)", "(skip)"))),
      /required PostgreSQL regression did not pass/,
    );
  }
  assert.throws(() => makeDocument(`${PASS_LINES.join("\n")}\n${SUMMARY}`), /PostgreSQL service leg missing/);
  assert.throws(
    () =>
      makeDocument(
        liveCapture.replace(postgresRegressions[0], postgresRegressions[0].replace("@arnilo/prism-store-postgres test:postgres: ", "")),
      ),
    /required PostgreSQL regression did not pass/,
  );
  assert.throws(
    () =>
      makeDocument(
        liveCapture
          .split("\n")
          .filter((line) => !line.startsWith("@arnilo/prism-store-postgres"))
          .join("\n"),
      ),
    /PostgreSQL service leg missing/,
  );
  assert.throws(() => evidenceCounts(liveCapture.replace("(pass) channels integration", "(fail) channels integration")), /1 failing test/);
});

test("missing URL blocks PostgreSQL, and release publish depends on the live service job", () => {
  const guard = spawnSync("bun", ["scripts/require-postgres-url.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PRISM_TEST_POSTGRES_URL: "" },
  });
  assert.notEqual(guard.status, 0);
  assert.match(guard.stderr, /PRISM_TEST_POSTGRES_URL is required/);
  const release = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(release, /postgres-integration:[\s\S]*?run: bun run test:postgres/);
  assert.match(release, /needs: \[verify, postgres-integration,/);
  const service = readFileSync(join(ROOT, ".github", "workflows", "integration-postgres.yml"), "utf8");
  assert.match(service, /run --filter @arnilo\/prism-store-postgres test:postgres/);
  assert.match(service, /run --filter @arnilo\/prism-store-postgres test:postgres/);
});

test("a failing test never becomes evidence, and the capture text never reaches the document", () => {
  const dsn = "postgres://prism:secret@localhost:5432/prism";
  const capture = [PASS_LINES[0], `(fail) connects with ${dsn} [9ms]`, "", "Ran 2 tests across 1 file. [0.10s]"].join("\n");
  assert.throws(() => evidenceCounts(capture), /1 failing test/);
  const document = evidenceDocument({
    gitHead: "0".repeat(40),
    captured: "2026-09-25T00:00:00.000Z",
    output: `${liveCapture}\n${dsn}`,
  });
  assert.deepEqual(Object.keys(document).sort(), ["captured", "counts", "gitHead"]);
  assert.ok(!JSON.stringify(document).includes("postgres://"), "the wrapper must never persist the capture (or a DSN)");
});
