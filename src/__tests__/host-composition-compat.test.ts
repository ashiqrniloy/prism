/**
 * Plan 122 Task 8: packed-install compatibility suite for the Synapta-shaped
 * composition.
 *
 * Two legs:
 *  - current release: packs the four family packages the composition needs
 *    (root, core, memory, providers) from the workspace, installs the tarballs
 *    into a fresh consumer on Bun (plan 125 Task 2 — tarballs from `npm pack`,
 *    install and execution Bun only), and runs `examples/host-composition-compat.ts`
 *    plus the Task 5 (host step-loop ledger) and Task 7 (revocation) example
 *    fixtures inside that consumer. All checks must pass.
 *  - pinned old family (default 0.9.0): env-gated. `PRISM_TEST_COMPAT_PIN_DIR`
 *    points at pre-packed tarballs (offline), `PRISM_TEST_COMPAT_PIN_FETCH=1`
 *    packs them from the registry, `PRISM_TEST_COMPAT_PIN` overrides the pin.
 *    Missing pins skip; pin failures are reported as named deltas and never
 *    fail the suite, because the pin is Synapta's to move.
 *
 * Offline by default: no registry access without the explicit fetch opt-in.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beforeAll as before, describe, it } from "bun:test";
import {
  createPackedConsumer,
  installedVersion,
  repoRoot,
  // @ts-expect-error stdlib-only packed-consumer helper intentionally ships as directly runnable JavaScript.
} from "../../scripts/fixtures/packed-consumer.mjs";

const PACKAGES = [
  { dir: ".", name: "@arnilo/prism" },
  { dir: "packages/prism-core", name: "@arnilo/prism-core" },
  { dir: "packages/memory", name: "@arnilo/prism-memory" },
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers" },
] as const;
const CONSUMER = "examples/host-composition-compat.ts";
const FIXTURES = ["examples/host-step-loop-timeline.ts", "examples/revocation-propagation.ts"];
const CHECK_NAMES = [
  "host-tools-only",
  "policy-chain-snapshot",
  "step-boundaries-and-trace-fields",
  "om-coverage-admission-retention",
  "typed-decisions-injected-transport",
  "legacy-adapter-safety",
];
const PIN = process.env.PRISM_TEST_COMPAT_PIN ?? "0.9.0";

interface CompatCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly delta?: string;
  readonly detail?: unknown;
}
interface CompatReport {
  readonly ok: boolean;
  readonly checks: readonly CompatCheck[];
}
interface Spawned {
  readonly status: number | null;
  readonly output: string;
  readonly payload?: unknown;
}

/** Copy the consumer contract and the reusable Task 5/7 fixtures into a consumer dir. */
function prepare(consumer: string): void {
  for (const source of [CONSUMER, ...FIXTURES]) {
    copyFileSync(join(repoRoot, source), join(consumer, basename(source)));
  }
}

function runScript(consumer: string, source: string, env: NodeJS.ProcessEnv = {}): Spawned {
  // Plan 125 Task 2: the consumer runtime contract is Bun, so the example runs on the Bun binary
  // by name — never `process.execPath`, which would follow whatever runner hosts this suite.
  const result = spawnSync("bun", [basename(source)], {
    cwd: consumer,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", ...env },
  });
  const output = result.stdout + result.stderr;
  if (result.status !== 0) return { status: result.status, output };
  const line = result.stdout.trim().split("\n").at(-1);
  if (!line) return { status: result.status, output };
  try {
    return { status: result.status, output, payload: JSON.parse(line) };
  } catch {
    return { status: result.status, output };
  }
}

function parseReport(run: Spawned): CompatReport {
  assert.ok(run.payload && typeof run.payload === "object", `consumer produced no JSON report:\n${run.output}`);
  return run.payload as CompatReport;
}

interface CurrentLeg {
  readonly report: CompatReport;
  readonly fixtures: readonly { readonly name: string; readonly run: Spawned }[];
  readonly versions: readonly string[];
}

/** Current-release leg, executed once and reused by the tests. */
function runCurrentLeg(): CurrentLeg {
  const packed = createPackedConsumer(PACKAGES);
  try {
    assert.equal(packed.installStatus, 0, `offline install failed:\n${packed.installOut}`);
    prepare(packed.consumer);
    const report = parseReport(runScript(packed.consumer, CONSUMER));
    const fixtures = FIXTURES.map((fixture) => ({ name: basename(fixture, ".ts"), run: runScript(packed.consumer, fixture) }));
    const versions = PACKAGES.map((pkg) => installedVersion(packed.consumer, pkg.name));
    return { report, fixtures, versions };
  } finally {
    packed.cleanup();
  }
}

let current: CurrentLeg | undefined;
function currentLeg(): CurrentLeg {
  assert.ok(current, "current-release leg must be set up");
  return current;
}

before(() => {
  current = runCurrentLeg();
});

describe("packed-install host-composition compatibility", () => {
  it("shape holds on current release: every contract check passes from the packed tarballs", () => {
    const leg = currentLeg();
    assert.deepEqual(
      leg.report.checks.map((entry) => entry.name),
      CHECK_NAMES,
      "the consumer runs the full contract set",
    );
    assert.equal(leg.report.ok, true, `packed consumer reported failures:\n${JSON.stringify(leg.report.checks, null, 2)}`);
    for (const name of CHECK_NAMES) {
      const entry = leg.report.checks.find((check) => check.name === name);
      assert.ok(entry?.ok, `${name} failed: ${entry?.delta ?? "missing"}`);
    }
    const legacy = leg.report.checks.find((check) => check.name === "legacy-adapter-safety");
    assert.deepEqual(
      legacy?.detail,
      {
        resolutions: 1,
        wireOptions: ["__proto__", "ask"],
        rendered: { verdict: "__proto__" },
        malformedEvents: ["error"],
      },
      "the legacy-adapter probe reports one credential resolution, the __proto__ wire option, and a providerError for a malformed answer",
    );
  });

  it("installs the current family versions from the workspace manifests", () => {
    const leg = currentLeg();
    PACKAGES.forEach((pkg, index) => {
      const manifest = JSON.parse(readFileSync(join(repoRoot, pkg.dir, "package.json"), "utf8")) as { version: string };
      assert.equal(leg.versions[index], manifest.version, `${pkg.name} installed version`);
    });
    assert.equal(new Set(leg.versions).size, 1, "family packages share one release version");
  });

  it("reuses the Task 5 and Task 7 example compositions as packed fixtures", () => {
    const byName = new Map(currentLeg().fixtures.map((fixture) => [fixture.name, fixture.run]));
    const stepLoop = byName.get("host-step-loop-timeline");
    assert.equal(stepLoop?.status, 0, `Task 5 fixture failed in the packed consumer:\n${stepLoop?.output}`);
    const stepPayload = stepLoop?.payload as { stepCount?: number; contentPolicy?: string } | undefined;
    assert.equal(stepPayload?.stepCount, 8, "the eight-step composition completes packed");
    assert.equal(stepPayload?.contentPolicy, "metadata");
    const revocation = byName.get("revocation-propagation");
    assert.equal(revocation?.status, 0, `Task 7 fixture failed in the packed consumer:\n${revocation?.output}`);
    const revocationPayload = revocation?.payload as
      | { context?: { parity?: boolean }; midFlight?: { denials?: readonly { sourceId: string; reason: string }[] } }
      | undefined;
    assert.equal(revocationPayload?.context?.parity, true, "read path and drop path agree packed");
    assert.equal(
      revocationPayload?.midFlight?.denials?.some((denial) => denial.sourceId === "plan-notes" && denial.reason === "no_grant"),
      true,
      "mid-rerank revoke is withheld packed",
    );
  });

  it(`${PIN} deltas reported not fatal`, () => {
    const pinDir = process.env.PRISM_TEST_COMPAT_PIN_DIR;
    const fetchPin = process.env.PRISM_TEST_COMPAT_PIN_FETCH === "1";
    if (!pinDir && !fetchPin) {
      console.log("env-gated: set PRISM_TEST_COMPAT_PIN_DIR (tarballs) or PRISM_TEST_COMPAT_PIN_FETCH=1 (registry)");
      return;
    }

    const staging = pinDir ? undefined : mkdtempSync(join(tmpdir(), "prism-compat-pin-pack-"));
    let consumerDir: string | undefined;
    try {
      let tarballs: string[];
      if (pinDir) {
        tarballs = readdirSync(pinDir)
          .filter((file) => file.endsWith(".tgz"))
          .map((file) => join(pinDir, file));
        assert.ok(tarballs.length > 0, `PRISM_TEST_COMPAT_PIN_DIR=${pinDir} contains no .tgz files`);
      } else {
        for (const pkg of PACKAGES) {
          const packed = spawnSync("npm", ["pack", `${pkg.name}@${PIN}`, "--pack-destination", staging ?? "."], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          });
          if (packed.status !== 0) {
            console.log(`pinned tarballs unavailable: npm pack ${pkg.name}@${PIN} failed`);
            return;
          }
        }
        tarballs = readdirSync(staging ?? ".")
          .filter((file) => file.endsWith(".tgz"))
          .map((file) => join(staging ?? ".", file));
      }

      consumerDir = mkdtempSync(join(tmpdir(), "prism-compat-pin-"));
      writeFileSync(
        join(consumerDir, "package.json"),
        JSON.stringify({ name: "prism-compat-pin", private: true, type: "module" }, null, 2),
      );
      // Plan 125 Task 2: pinned family installs on the Bun consumer too; `--prefer-offline` is the
      // cold-cache retry (bun needs cached manifests for third-party ranges). The env gates
      // (`PRISM_TEST_COMPAT_PIN*`) and the skip-on-unavailable behaviour are unchanged.
      let install = spawnSync("bun", ["install", ...tarballs, "--offline", "--no-audit", "--no-fund", "--no-update-notifier"], {
        cwd: consumerDir,
        encoding: "utf8",
      });
      if (install.status !== 0) {
        install = spawnSync("bun", ["install", ...tarballs, "--prefer-offline", "--no-audit", "--no-fund", "--no-update-notifier"], {
          cwd: consumerDir,
          encoding: "utf8",
        });
      }
      if (install.status !== 0) {
        console.log(`pinned install unavailable offline: ${(install.stdout + install.stderr).split("\n").slice(-2).join(" ")}`);
        return;
      }

      prepare(consumerDir);
      const report = parseReport(runScript(consumerDir, CONSUMER, { PRISM_COMPAT_REPORT_ONLY: "1" }));
      const deltas = report.checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${String(entry.delta ?? "failed")}`);
      for (const fixture of FIXTURES) {
        const run = runScript(consumerDir, fixture, { PRISM_COMPAT_REPORT_ONLY: "1" });
        if (run.status !== 0) {
          deltas.push(`fixture:${basename(fixture, ".ts")}: ${run.output.split("\n").slice(-2).join(" ").slice(0, 160)}`);
        }
      }
      assert.equal(report.checks.length, CHECK_NAMES.length, "the pinned consumer produced the full check set");
      assert.ok(deltas.length > 0, `pinned ${PIN} unexpectedly passed every check; raise the pin or drop the leg`);
      assert.ok(
        deltas.some((delta) => delta.startsWith("typed-decisions")),
        `expected the typed-decisions delta for ${PIN}:\n${deltas.join("\n")}`,
      );
      assert.ok(
        deltas.some((delta) => delta.startsWith("legacy-adapter-safety")),
        `expected the legacy-adapter-safety delta for ${PIN}:\n${deltas.join("\n")}`,
      );
      console.log(`packed-install compatibility deltas for ${PIN}:\n${deltas.join("\n")}`);
    } finally {
      if (consumerDir) rmSync(consumerDir, { recursive: true, force: true });
      if (staging) rmSync(staging, { recursive: true, force: true });
    }
  }, 300_000);
});
