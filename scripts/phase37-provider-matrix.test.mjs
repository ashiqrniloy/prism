/**
 * Plan 037 Task 1: freeze the 19 first-party provider matrix (plan 055 Task 11:
 * hyper + commandcode added).
 * Network-free: reads package manifests + evidence markdown only.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = join(root, "docs/_evidence/phase37-provider-matrix.md");

// The Phase 37 evidence stays historical; shared codec extraction moved cache wire handling into provider-kit.
const currentCacheSources = {
  "packages/providers/opencode-go/src/cache.ts": {
    cache_control: "src/provider-kit/codecs/anthropic-messages.ts",
    "x-opencode-session": "packages/providers/opencode-go/src/provider.ts",
  },
  "packages/providers/hyper/src/cache.ts": {
    cache_control: "src/provider-kit/codecs/anthropic-messages.ts",
  },
  "packages/providers/hyper/src/telemetry.ts": {
    cached_tokens: "src/provider-kit/openai-primitives.ts",
  },
};

function providerAdapters() {
  const bundle = JSON.parse(readFileSync(join(root, "scripts/bundles.json"), "utf8")).bundles.find(
    (bundle) => bundle.dir === "packages/providers",
  );
  return bundle.subpaths
    .filter((row) => ["hyper", "laya", "opencode-go", "typesafe"].includes(row.dir))
    .map((row) => ({ dir: `providers/${row.dir}`, name: row.formerName }));
}

function parseCacheClaims(evidence) {
  const start = evidence.indexOf("## Explicit cache field claims");
  assert.ok(start >= 0, "evidence missing Explicit cache field claims");
  const rest = evidence.slice(start);
  const rows = [];
  for (const line of rest.split("\n")) {
    if (!line.startsWith("| `@arnilo/prism-provider-")) continue;
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
  // Plan 182 Task 2: 4 standalone @arnilo/prism-provider-<vendor> packages; 17 retired.
  assert.equal(pkgs.length, 4, `expected 4 provider adapters, got ${pkgs.length}`);
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
    if (!pkgNames.has(row.package)) continue;
    claimed.add(row.package);
    assert.match(row.status, /^(supported|failing|host-owned)$/, `${row.package} ${row.field} status`);
    assert.match(row.official, /^https:\/\//, `${row.package} ${row.field} official URL`);
    assert.ok(evidence.includes(row.official), `${row.package} ${row.field} official URL must appear in evidence`);
    const currentSource = currentCacheSources[row.source]?.[row.field] ?? row.source;
    const source = readFileSync(join(root, currentSource), "utf8");
    if (currentSource.startsWith("src/provider-kit/")) {
      const adapter = providerAdapters().find((pkg) => pkg.name === row.package);
      const provider = readFileSync(join(root, "packages", adapter.dir, "src/provider.ts"), "utf8");
      assert.match(provider, /createRoutedProvider/, `${row.package} must use the shared codecs`);
      if (row.field === "cache_control") assert.match(provider, /format: "anthropic-messages"/, `${row.package} keeps its messages route`);
      if (row.field === "cached_tokens") assert.match(provider, /mapOpenAIChatUsage\(raw\)/, `${row.package} keeps shared usage mapping`);
    }
    if (row.status === "supported") {
      assert.ok(source.includes(row.field), `${currentSource} (formerly ${row.source}) missing supported field ${row.field}`);
    }
  }
  assert.equal(claimed.size, 2, `cache claims must cover active packages from phase 37, got ${claimed.size}`);
});
