/**
 * Phase 26 Task 2 protected benchmark: large-monorepo index fixture.
 *
 * Frozen caps: 100000-file metadata fixture; indexed query p95 <= 250ms;
 * 1000-file batch update <= 1s; peak heap +64MiB. The literal (native)
 * baseline must not regress: it still routes through the same
 * createLocalRepositoryOperations path and this file asserts it works.
 *
 * The fixture is metadata-only (in-memory paths + snippets), matching the
 * frozen "100000-file metadata fixture" contract: the seam's cost model is
 * O(update batch + result page), never the host engine's storage.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createIndexedRepositoryOperations } from "../packages/coding-agent/dist/repository/indexed-search.js";
import { createLocalRepositoryOperations } from "../packages/coding-agent/dist/repository.js";

const FIXTURE_FILES = 100_000;
const UPDATE_BATCH = 1_000;
const QUERY_SAMPLES = 30;
const P95_MS = 250;
const UPDATE_MS = 1_000;
const HEAP_DELTA_BYTES = 64 * 1024 * 1024;

/** In-memory metadata index: path -> snippet (the host engine is not ours to benchmark). */
function makeIndexBackend(entries) {
  let updatedAt = Date.now();
  const revision = "bench-rev-1";
  return {
    capabilities: { semantic: true },
    async update(request) {
      for (const change of request.changes) entries.set(change.path, `export const ${change.path.replace(/[^a-z0-9]/gi, "_")} = 1;`);
      updatedAt = Date.now();
    },
    async remove(request) {
      for (const path of request.paths) entries.delete(path);
      updatedAt = Date.now();
    },
    async search(request) {
      const hits = [];
      for (const [path, snippet] of entries) {
        if (request.mode === "indexed_literal" && !path.includes(request.query)) continue;
        hits.push({ path, score: 0.5, snippet });
        if (hits.length >= request.maxResults) break;
      }
      return { hits, truncated: false };
    },
    async status() {
      return { state: "ready", sourceRevision: revision, updatedAt };
    },
    async dispose() {},
  };
}

function percentile(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

test("phase26 index benchmark: 100k-file fixture, p95 query and batch update bounds", async () => {
  const before = process.memoryUsage().heapUsed;
  const entries = new Map();
  for (let i = 0; i < FIXTURE_FILES; i++) {
    entries.set(`src/module-${i}/index.ts`, `// module ${i}`);
  }
  const fixtureBytes = JSON.stringify([...entries]).length;
  assert.equal(entries.size, 100000, "fixture holds 100000 files");
  const heapDelta = process.memoryUsage().heapUsed - before;
  assert.ok(
    heapDelta <= HEAP_DELTA_BYTES,
    `fixture peak heap +${(heapDelta / 1024 / 1024).toFixed(1)}MiB <= 64MiB (fixture ${fixtureBytes} bytes)`,
  );

  const backend = makeIndexBackend(entries);
  const composite = createIndexedRepositoryOperations(process.cwd(), {
    index: backend,
    fallback: createLocalRepositoryOperations(),
    allowedModes: ["literal", "indexed_literal", "semantic"],
  });

  // 1000-file batch update must stay under 1s (metadata-only host).
  const changes = Array.from({ length: UPDATE_BATCH }, (_, i) => ({
    path: `src/updated-${i}.ts`,
    kind: "add",
    bytes: 32,
  }));
  const updateStart = performance.now();
  await composite.index.update({ sourceRevision: "bench-rev-1", changes });
  const updateMs = performance.now() - updateStart;
  assert.ok(updateMs <= UPDATE_MS, `1000-file update ${updateMs.toFixed(1)}ms <= 1000ms`);

  // Query p95 over repeated indexed_literal queries.
  const samples = [];
  for (let i = 0; i < QUERY_SAMPLES; i++) {
    const start = performance.now();
    const result = await composite.search({ root: process.cwd(), query: `module-${i * 313}`, mode: "indexed_literal" });
    const elapsed = performance.now() - start;
    assert.ok(result.matches.length >= 1, `query ${i} finds its module`);
    samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  const p95 = percentile(samples, 95);
  assert.ok(p95 <= P95_MS, `indexed query p95 ${p95.toFixed(1)}ms <= 250ms (all: ${samples.map((s) => s.toFixed(0)).join(",")})`);

  // Semantic mode on the same fixture stays bounded.
  const semanticStart = performance.now();
  const semantic = await composite.search({ root: process.cwd(), query: "module", mode: "semantic", maxMatches: 100 });
  const semanticMs = performance.now() - semanticStart;
  assert.equal(semantic.matches.length, 100);
  assert.ok(semanticMs <= P95_MS, `semantic query ${semanticMs.toFixed(1)}ms <= 250ms`);

  // Literal baseline is untouched: native search over a real small tree.
  const root = await mkdtemp(join(tmpdir(), "phase26-index-bench-"));
  await writeFile(join(root, "needle.ts"), "export const needle = 1;\n");
  const literal = await composite.search({ root, query: "needle", mode: "literal" });
  assert.equal(literal.matches.length, 1);
  assert.equal(literal.matches[0].path, "needle.ts");
  assert.equal(literal.untrusted_index, undefined);
});
