#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Negative fixtures proving the formatting/linting/coverage gates actually fail
// on a violation (plan 079, Task 6). Mirrors scripts/release-gate.test.mjs.

const BIOME = join(process.cwd(), "node_modules", ".bin", "biome");

function biome(args, cwd) {
  try {
    execFileSync(BIOME, args, { cwd, stdio: "pipe" });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
}

function tempFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), "prism-tooling-"));
  const file = join(dir, name);
  writeFileSync(file, content);
  return { dir, file };
}

describe("tooling gates fail on violations", () => {
  it("biome lint rejects a lint error", () => {
    const { dir, file } = tempFile("bad.ts", "function f() {\n  debugger;\n}\n");
    try {
      assert.notEqual(biome(["lint", file], dir), 0, "biome lint passed on a debugger statement");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("biome format rejects an unformatted file", () => {
    const { dir, file } = tempFile("ugly.ts", "const   x=1\n");
    try {
      assert.notEqual(biome(["format", file], dir), 0, "biome format passed on an unformatted file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("biome accepts a clean file", () => {
    const { dir, file } = tempFile("ok.ts", "const x = 1;\nconsole.log(x);\n");
    try {
      assert.equal(biome(["check", file], dir), 0, "biome check failed on a clean file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires an explicit PostgreSQL URL without making sdk:ready networked", () => {
    const result = spawnSync(process.execPath, ["scripts/require-postgres-url.mjs"], {
      env: { ...process.env, PRISM_TEST_POSTGRES_URL: "" },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, "protected PostgreSQL gate passed without a URL");
    assert.match(result.stderr, /PRISM_TEST_POSTGRES_URL is required/);
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    assert.match(scripts["test:postgres"], /require-postgres-url/);
    assert.doesNotMatch(scripts["sdk:ready"], /test:postgres/);
  });

  it("keeps DDL out of the least-privilege enterprise request path", () => {
    const inventory = JSON.parse(readFileSync("scripts/enterprise-postgres-sql-inventory.json", "utf8"));
    assert.deepEqual(inventory.requestPath.verbs, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
    assert.ok(inventory.requestPath.forbidden.includes("DROP"));
    const basePath = existsSync("packages/prism-core/src/enterprise/postgres")
      ? "packages/prism-core/src/enterprise/postgres"
      : "packages/enterprise-postgres/src";
    const requestSources = ["policy", "evaluations", "work-idempotency", "tool-effects", "model-router", "cleanup"]
      .map((name) => readFileSync(`${basePath}/${name}.ts`, "utf8"))
      .join("\n");
    assert.doesNotMatch(requestSources, /\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT)\s+(?:SCHEMA|TABLE|INDEX)\b/);
    assert.match(readFileSync(`${basePath}/ddl.ts`, "utf8"), /CREATE SCHEMA/);
  });

  it("coverage thresholds and gates are wired into package scripts", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    for (const flag of [
      "--experimental-test-coverage",
      "--test-coverage-lines=",
      "--test-coverage-functions=",
      "--test-coverage-branches=",
    ]) {
      assert.ok(scripts["test:coverage"].includes(flag), `test:coverage missing ${flag}`);
    }
    for (const gate of ["npm run lint", "npm run format:check", "npm run test:coverage"]) {
      assert.ok(scripts["sdk:ready"].includes(gate), `sdk:ready missing ${gate}`);
    }
  });
});
