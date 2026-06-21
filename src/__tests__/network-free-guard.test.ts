import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const skipDirs = new Set(["node_modules", "dist", ".git", ".agents", "plans", "docs", "coverage"]);
const guardFileName = "network-free-guard.test.ts";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
    } else if (path.endsWith(".test.ts")) {
      yield path;
    }
  }
}

describe("network-free default test guard", () => {
  it("every live test file is gated by a PRISM_LIVE_* env var", () => {
    for (const file of walk(repoRoot)) {
      if (!/live/i.test(file)) continue;
      const src = readFileSync(file, "utf8");
      assert.match(src, /PRISM_LIVE_[A-Z_]+/, `${file} must be gated by a PRISM_LIVE_* env var`);
    }
  });

  it("non-live test files do not reference globalThis.fetch", () => {
    for (const file of walk(repoRoot)) {
      if (/live/i.test(file)) continue;
      if (file.endsWith(guardFileName)) continue;
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /\bglobalThis\.fetch\b/, `${file} must not reference globalThis.fetch (inject a mock fetch instead)`);
    }
  });
});
