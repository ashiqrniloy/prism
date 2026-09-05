/**
 * Hermetic doc-check: docs/live-testing.md credential matrix must stay in sync
 * with scripts/live-matrix.json. Register in the root test chain next to the
 * other static gates. Regenerate with:
 *   node scripts/generate-live-docs.mjs --write
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadManifest, regeneratedDoc } from "./generate-live-docs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("docs/live-testing.md credential matrix is in sync with scripts/live-matrix.json", () => {
  const doc = readFileSync(join(ROOT, "docs/live-testing.md"), "utf8");
  const expected = regeneratedDoc(doc, loadManifest());
  assert.equal(doc, expected, "docs/live-testing.md is stale — run: node scripts/generate-live-docs.mjs --write");
});

test("credential matrix keeps the least-privilege scope column populated", () => {
  const { suites } = loadManifest();
  for (const suite of suites) {
    assert.ok(typeof suite.scope === "string" && suite.scope.trim().length > 0, `suite ${suite.id} must document a least-privilege scope`);
    assert.ok(typeof suite.cost === "string" && suite.cost.trim().length > 0, `suite ${suite.id} must document its cost`);
  }
});
