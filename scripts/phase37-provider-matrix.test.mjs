/**
 * Plan 037 Task 1: freeze the 19 first-party provider matrix (plan 055 Task 11:
 * hyper + commandcode added).
 * Network-free: reads package manifests + evidence markdown only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = join(root, "docs/_evidence/phase37-provider-matrix.md");
const packagesDir = join(root, "packages");

function providerAdapters() {
  // Plan 054 Task 6: adapters live as subpaths of the providers family manifest.
  const manifest = JSON.parse(readFileSync(join(packagesDir, "prism-providers", "package.json"), "utf8"));
  return Object.keys(manifest.exports ?? {})
    .filter((key) => key !== ".")
    .sort()
    .map((key) => ({ dir: `prism-providers${key.slice(1)}`, name: `@arnilo/prism-providers${key.slice(1)}` }));
}

function parseCacheClaims(evidence) {
  const start = evidence.indexOf("## Explicit cache field claims");
  assert.ok(start >= 0, "evidence missing Explicit cache field claims");
  const rest = evidence.slice(start);
  const rows = [];
  for (const line of rest.split("\n")) {
    if (!line.startsWith("| `@arnilo/prism-provider-") && !line.startsWith("| `@arnilo/prism-providers/")) continue;
    const cols = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    assert.equal(cols.length, 5, `cache claim row must have 5 cells: ${line}`);
    rows.push({ package: cols[0].replace(/^`|`$/g, ""), field: cols[1], status: cols[2], source: cols[3], official: cols[4] });
  }
  return rows;
}

test("phase37 matrix lists every provider family adapter subpath", () => {
  const evidence = readFileSync(evidencePath, "utf8");
  const pkgs = providerAdapters();
  assert.equal(pkgs.length, 19, `expected 19 provider adapters, got ${pkgs.length}`);
  for (const pkg of pkgs) {
    assert.ok(evidence.includes(pkg.name), `docs/_evidence/phase37-provider-matrix.md missing row for ${pkg.name}`);
  }
});

test("phase37 evidence names shared primitives and no core primitive", () => {
  const evidence = readFileSync(evidencePath, "utf8");
  for (const token of [
    "no core primitive",
    "readSseEvents",
    "createOpenAICompatibleProvider",
    "applyCacheControl",
    "sanitizeCacheKey",
    "assertProviderStreamConforms",
  ]) {
    assert.ok(evidence.includes(token), `evidence missing token ${token}`);
  }
});

test("phase37 explicit cache field claims match sources and official URLs", () => {
  const evidence = readFileSync(evidencePath, "utf8");
  const rows = parseCacheClaims(evidence);
  assert.ok(rows.length >= 19, `expected cache claims for the matrix, got ${rows.length}`);
  const pkgNames = new Set(providerAdapters().map((pkg) => pkg.name));
  const claimed = new Set();
  for (const row of rows) {
    assert.ok(pkgNames.has(row.package), `cache claim for unknown package ${row.package}`);
    claimed.add(row.package);
    assert.match(row.status, /^(supported|failing|host-owned)$/, `${row.package} ${row.field} status`);
    assert.match(row.official, /^https:\/\//, `${row.package} ${row.field} official URL`);
    assert.ok(evidence.includes(row.official), `${row.package} ${row.field} official URL must appear in evidence`);
    const sourcePath = join(root, row.source);
    const source = readFileSync(sourcePath, "utf8");
    if (row.status === "supported") {
      assert.ok(source.includes(row.field), `${row.source} missing supported field ${row.field}`);
    }
  }
  assert.equal(claimed.size, 19, `cache claims must cover all 19 packages, got ${claimed.size}`);
});
