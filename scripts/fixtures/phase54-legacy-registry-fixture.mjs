// scripts/fixtures/phase54-legacy-registry-fixture.mjs
// Offline fixture for the plan 054 Task 7 legacy-registry suite (plan 115 Task 2 split):
// an executable npm shim (PRISM_LEGACY_NPM) that emulates view / dist-tag / deprecate
// against a JSON state file, so the release-only registry flow is verified without
// network or tokens. Shared by the three scenario files so each stays a small,
// independently schedulable `node --test` file.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSOLIDATION_SPEC } from "../phase54-package-map.mjs";

export const rootDir = join(import.meta.dirname, "..", "..");
export const script = join(rootDir, "scripts/phase54-legacy-registry.mjs");
export const guide = join(rootDir, "docs/history/migrate-to-0.4.md");

export const NAMES = CONSOLIDATION_SPEC.retiredPackages.map((r) => r.name);
// Mirrors the real registry: two retired names were never published.
export const UNPUBLISHED = ["@arnilo/prism-prompts", "@arnilo/prism-dev"];
export const PUBLISHED = NAMES.filter((n) => !UNPUBLISHED.includes(n));

export function makeFixture(dir, { corruptLegacy = [], corruptMessage = [] } = {}) {
  const state = { packages: {} };
  for (const name of PUBLISHED) {
    state.packages[name] = {
      versions: ["0.3.1", "0.3.0"],
      latest: "0.3.1",
      tags: corruptLegacy.includes(name) ? { legacy: "0.3.0" } : {},
      deprecated: corruptMessage.includes(name) ? { "0.3.1": "some other warning" } : {},
    };
  }
  const statePath = join(dir, "fixture-state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

export function makeShim(dir) {
  // Executable npm fixture: emulates the npm surface the registry script uses.
  const shimPath = join(dir, "npm-fixture.mjs");
  writeFileSync(
    shimPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.PRISM_LEGACY_FIXTURE;
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const fail = (msg) => { console.error(msg); process.exit(1); };
if (args[0] === "view") {
  const spec = args[1];
  const core = spec.startsWith("@") ? spec.slice(1) : spec;
  const at = core.lastIndexOf("@");
  const name = spec.startsWith("@") ? "@" + (at === -1 ? core : core.slice(0, at)) : core.slice(0, at === -1 ? core.length : at);
  const version = at === -1 ? undefined : core.slice(at + 1);
  const pkg = state.packages[name];
  if (!pkg) fail("npm ERR! 404 not found: " + name);
  if (args[2] === "version") {
    if (version === undefined) { if (pkg.tags?.latest === undefined && !pkg.latest) fail("no latest"); console.log(pkg.latest); }
    else if (!pkg.versions.includes(version)) fail("npm ERR! 404 no version " + version + " for " + name);
    else console.log(version);
  } else if (args[2] === "deprecated") {
    const msg = pkg.deprecated?.[version];
    if (msg) console.log(msg);
  } else fail("unsupported view field: " + args[2]);
} else if (args[0] === "dist-tag" && args[1] === "ls") {
  const pkg = state.packages[args[2]];
  if (!pkg) fail("npm ERR! 404 not found: " + args[2]);
  console.log("latest: " + pkg.latest);
  for (const [tag, version] of Object.entries(pkg.tags ?? {})) console.log(tag + ": " + version);
} else if (args[0] === "dist-tag" && args[1] === "add") {
  const spec = args[2];
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const pkg = state.packages[name];
  if (!pkg || !pkg.versions.includes(version)) fail("npm ERR! cannot tag " + spec);
  pkg.tags = pkg.tags ?? {};
  pkg.tags[args[3]] = version;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log("+" + args[3] + ": " + name + "@" + version);
} else if (args[0] === "deprecate") {
  const spec = args[1];
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const range = spec.slice(at + 1);
  if (range !== "<0.4.0") fail("unexpected deprecate range: " + range);
  const pkg = state.packages[name];
  if (!pkg) fail("npm ERR! 404 not found: " + name);
  pkg.deprecated = pkg.deprecated ?? {};
  // fixture versions are all 0.3.x, so the <0.4.0 range covers every listed version
  for (const version of pkg.versions) pkg.deprecated[version] = args[2];
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log("~" + name);
} else fail("unsupported fixture npm command: " + args.join(" "));
`,
  );
  chmodSync(shimPath, 0o755);
  return shimPath;
}

export function run(args, dir, statePath) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PRISM_LEGACY_NPM: makeShim(dir),
      PRISM_LEGACY_FIXTURE: statePath,
      PRISM_LEGACY_PLAN: join(dir, "legacy-registry-plan.json"),
    },
  });
}

export function readState(statePath) {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

export function mkdtemp() {
  return mkdtempSync(join(tmpdir(), "prism-legacy-registry-"));
}
