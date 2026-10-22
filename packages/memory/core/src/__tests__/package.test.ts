import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "bun:test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SRC = join(REPO_ROOT, "packages/memory/core/src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("memory core package (plan 158 Task 2)", () => {
  it("memory_core_has_no_package_definition", async () => {
    const core = (await import("../index.js")) as Record<string, unknown>;
    assert.equal("default" in core, false, "a library default-exports nothing");
    assert.equal(typeof core.definePackage, "undefined", "a library defines no package");
    assert.equal(typeof core.createHashEmbedder, "function", "the root surface still loads");
  });

  it("memory_core_loads_no_pg", async () => {
    // Static: no source file value-imports the driver. `postgres/index.ts` carries a type-only
    // import, and the runtime `await import("pg")` stays inside the store constructors.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      if (/import\s+(?!type\b)[^;]*from\s*["']pg["']/.test(text)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], "no memory-core source module may statically import pg");

    // Runtime: importing the root never loads pg. The `after` probe proves the check can see it.
    const script = [
      'const core = await import("@arnilo/prism-memory-core");',
      'const seen = () => Object.keys(require.cache ?? {}).some((key) => key.includes("node_modules/pg/"));',
      "const before = seen();",
      'await import("pg");',
      "const after = seen();",
      'console.log(JSON.stringify({ inert: typeof core.createHashEmbedder === "function", before, after }));',
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as { inert: boolean; before: boolean; after: boolean };
    assert.equal(probe.inert, true, "the root module loads without the driver");
    assert.equal(probe.before, false, "pg is absent from the module graph of a root import");
    assert.equal(probe.after, true, "the probe can observe pg once it is loaded");
  });
});
