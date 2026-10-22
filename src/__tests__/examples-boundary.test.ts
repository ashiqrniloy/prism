import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RETIRED =
  /^@arnilo\/prism-(core|providers|agent-sdk|code|acp-agent|memory|coding-tools|web-tools|work|hooks|all|server|supervisor|policy|work-tools|enterprise-postgres)(\/|$)/;
const SPEC = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "adapters" || e.name === "node_modules" ? [] : files(p);
    return /\.(ts|js|mjs)$/.test(e.name) ? [p] : [];
  });
}

describe("examples boundary", () => {
  it("examples_import_only_public_surface", () => {
    const bad: string[] = [];
    for (const file of files(join(REPO, "examples"))) {
      for (const m of readFileSync(file, "utf8").matchAll(SPEC)) {
        const spec = m[1] ?? m[2] ?? "";
        if (RETIRED.test(spec) || /(^|\/)(src|dist)(\/|$)/.test(spec) || spec.includes("packages/")) bad.push(`${file}: ${spec}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it("build_workflow_example_in_gallery", () => {
    assert.ok(existsSync(join(REPO, "examples/build-workflow.ts")));
    assert.ok(readFileSync(join(REPO, "examples/README.md"), "utf8").includes("build-workflow.ts"));
    const manifest = JSON.parse(readFileSync(join(REPO, "scripts/examples-manifest.json"), "utf8"));
    assert.equal(manifest.skips["build-workflow.ts"], undefined, "build-workflow.ts must run under the gate");
  });
});
