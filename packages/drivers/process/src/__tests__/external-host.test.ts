import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const packageDir = resolve(here, "../..");
const fixtureDir = join(here, "fixtures/external-host");
// Plan 174 Task 8: the kernel publishes TypeScript source, so an external host resolves the entry
// from the export map (`./src/index.ts`) rather than a built `dist/index.js`.
const KERNEL_ENTRY = join(repoRoot, "src", "index.ts");

/** The public specifiers a host may import. Anything else, including a `@arnilo/prism/dist/...` path, is refused. */
const ALLOWED = /^(@arnilo\/prism(\/(driver-kit|testing))?|@arnilo\/prism-driver-process(\/testing)?|node:.+)$/;
const ALLOWED_SKIPS = new Set(["deployment", "resume", "fixture_replay", "unknown_request_fails"]);
const MUST_PASS = [
  "abort_within_grace",
  "credential_canary",
  "no_secret",
  "resume_strategy",
  "hosted_acknowledgement",
  "limit_signal",
  "fail_closed_response",
  "steer",
  "gating",
];

interface Leg {
  readonly name: string;
  readonly status: "passed" | "skipped";
  readonly reason?: string;
}

function specifiers(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of [
    /from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec !== undefined) found.add(spec);
    }
  }
  return [...found];
}

/** Resolves as the workspace would: its own package.json, the linked packages' `exports`, not repo internals. */
function resolveFrom(dir: string, specifier: string): string {
  return createRequire(join(dir, "package.json")).resolve(specifier);
}

/** A temp workspace with the two packages linked and the host's own source copied in, as a host's repo would be. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "external-host-"));
  mkdirSync(join(dir, "node_modules/@arnilo"), { recursive: true });
  symlinkSync(repoRoot, join(dir, "node_modules/@arnilo/prism"), "dir");
  symlinkSync(packageDir, join(dir, "node_modules/@arnilo/prism-driver-process"), "dir");
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "external-host", private: true, type: "module" }, null, 2)}\n`);
  for (const name of readdirSync(fixtureDir)) writeFileSync(join(dir, name), readFileSync(join(fixtureDir, name)));
  return dir;
}

test("external_host_adapter_passes_with_public_imports_only", () => {
  assert.ok(existsSync(KERNEL_ENTRY), "the kernel entry must exist: the kernel publishes TypeScript source");
  const dir = workspace();
  try {
    for (const name of readdirSync(fixtureDir)) {
      for (const spec of specifiers(readFileSync(join(dir, name), "utf8"))) {
        if (spec.startsWith("./") || spec.startsWith("../")) {
          assert.ok(!spec.startsWith("../"), `${name} imports outside the workspace: ${spec}`);
          assert.ok(existsSync(join(dir, spec.replace(/\.js$/, ".ts"))), `${name} relative import does not resolve: ${spec}`);
          continue;
        }
        assert.match(spec, ALLOWED, `${name} imports a non-public specifier: ${spec}`);
      }
    }
    const kernel = resolveFrom(dir, "@arnilo/prism");
    assert.ok(kernel.endsWith(join("src", "index.ts")), `kernel resolved to ${kernel}, not the published source entry`);

    const run = spawnSync(process.execPath, [join(dir, "run.ts")], { cwd: dir, encoding: "utf8", timeout: 300_000 });
    assert.equal(run.status, 0, `conformance run exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    const legs = JSON.parse(run.stdout) as Leg[];
    assert.equal(legs.length, 21, `expected 21 legs, got ${legs.length}`);
    for (const leg of legs) {
      assert.ok(leg.status === "passed" || leg.status === "skipped", `${leg.name} has status ${String(leg.status)}`);
      if (leg.status === "skipped") assert.ok(ALLOWED_SKIPS.has(leg.name), `${leg.name} skipped unexpectedly: ${leg.reason}`);
    }
    for (const name of MUST_PASS) {
      assert.equal(legs.find((leg) => leg.name === name)?.status, "passed", `${name} must pass`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 300_000);

test("external_host_rejects_internal_import", () => {
  const dir = workspace();
  try {
    const internal = "@arnilo/prism/src/driver-kit/define.ts";
    const adapter = join(dir, "adapter.ts");
    writeFileSync(adapter, `${readFileSync(adapter, "utf8")}\nimport "${internal}";\n`);
    assert.ok(specifiers(readFileSync(adapter, "utf8")).includes(internal), "the scanner must see the internal import");
    assert.ok(!ALLOWED.test(internal), "the allow-list must reject an internal path");
    assert.throws(() => resolveFrom(dir, internal), `the kernel must not export ${internal}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
