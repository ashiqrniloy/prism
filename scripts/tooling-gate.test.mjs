#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.equal(scripts["test:postgres"], "node scripts/postgres-evidence.mjs");
    assert.match(scripts["test:postgres:run"], /require-postgres-url/);
    assert.doesNotMatch(scripts["sdk:ready"], /test:postgres/);
  });

  it("keeps DDL out of the least-privilege enterprise request path", () => {
    const inventory = JSON.parse(readFileSync("scripts/enterprise-postgres-sql-inventory.json", "utf8"));
    assert.deepEqual(inventory.requestPath.verbs, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
    assert.ok(inventory.requestPath.forbidden.includes("DROP"));
    const basePath = existsSync("packages/prism-core/src/enterprise/postgres")
      ? "packages/prism-core/src/enterprise/postgres"
      : "packages/enterprise-postgres/src";
    // The router is a module directory (plan 070 Task 14); scan every file in it so the
    // DDL check cannot go vacuous when sources move between modules.
    const routerSources = (() => {
      const dir = `${basePath}/model-router`;
      if (!existsSync(dir)) return [readFileSync(`${basePath}/model-router.ts`, "utf8")];
      const walk = (d) =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".ts") ? [readFileSync(`${d}/${e.name}`, "utf8")] : [],
        );
      return walk(dir);
    })();
    assert.match(routerSources.join("\n"), /prism_model_router_/, "router source scan must cover the router modules");
    const requestSources = ["policy", "evaluations", "work-idempotency", "tool-effects", "cleanup"]
      .map((name) => readFileSync(`${basePath}/${name}.ts`, "utf8"))
      .concat(routerSources)
      .join("\n");
    assert.doesNotMatch(requestSources, /\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT)\s+(?:SCHEMA|TABLE|INDEX)\b/);
    assert.match(readFileSync(`${basePath}/ddl.ts`, "utf8"), /CREATE SCHEMA/);
  });

  // Plan 115 Task 3: a spawn that carries a Node-only flag (`--test`, `--test-isolation`,
  // `--experimental-test-coverage`) must run `node` by name — under a Bun parent
  // `process.execPath` is a Bun child, and `bun --test` is a script run, not a test runner.
  // Runner-agnostic spawns (`-e` snippets, CLI paths) keep `process.execPath` on purpose:
  // Bun's `-e` exists, which is why the root `bun test` run works.
  it("node-only spawns use `node` by name, not process.execPath", () => {
    const NODE_ONLY = /--test\b|--test-isolation|--experimental-test-coverage/;
    // The flags sit in the spawn's argument list, so scan from the command to the end of its
    // statement. ponytail: lexical, not an AST — a flag hidden behind a spread constant is
    // caught by review, not here.
    const violations = (source) =>
      [...source.matchAll(/(?:spawn|spawnSync|execFile|execFileSync|run)\s*\(\s*process\.execPath/g)]
        // Skip matches inside a template literal (this file's own fixture strings).
        .filter((match) => {
          const before = source.slice(source.lastIndexOf("\n", match.index) + 1, match.index);
          return (before.match(/`/g) ?? []).length % 2 === 0;
        })
        .map((match) => source.slice(match.index).split(";")[0].slice(0, 500))
        .filter((statement) => NODE_ONLY.test(statement));
    for (const ok of [
      `spawnSync(process.execPath, ["-e", "1"]);`,
      `spawnSync(process.execPath, [cli, "--provider", id, "--mode", "rpc"]);`,
      `const child = spawn(process.execPath, [FIXTURE], { stdio: ["pipe", "pipe", "pipe"] });`,
      `run(\n  process.execPath,\n  [join("scripts", "with-build-lock.mjs"), ...args],\n);`,
      `spawnSync("node", ["--test", file]);`,
    ]) {
      assert.deepEqual(violations(ok), [], `runner-agnostic spawn must pass the scan: ${ok}`);
    }
    for (const bad of [
      `spawnSync(process.execPath, ["--test", file]);`,
      `spawn(process.execPath, [LOCK, "node", "--test", IMPORTER]);`,
      `run(process.execPath, ["--test-isolation=none", glob]);`,
      `spawnSync(process.execPath, ["--experimental-test-coverage", ...args]);`,
      `spawn(\n  process.execPath,\n  ["--test", file],\n);`,
    ]) {
      assert.ok(violations(bad).length > 0, `Node-only spawn through process.execPath must fail the scan: ${bad}`);
    }
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "dist", ".git", "coverage"].includes(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(?:mjs|js|ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    for (const root of ["src", "scripts", "packages"]) walk(root);
    const offenders = files.flatMap((file) =>
      violations(readFileSync(file, "utf8")).map((statement) => `${file}: ${statement.split("\n")[0]}`),
    );
    assert.deepEqual(offenders, [], `Node-only spawns must use "node" by name: ${offenders.join(" | ")}`);
  });

  it("coverage thresholds and gates are wired into package scripts", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    for (const flag of ["bun test --coverage", "--timeout=0"]) {
      assert.ok(scripts["test:coverage"].includes(flag), `test:coverage missing ${flag}`);
    }
    assert.ok(!scripts["test:coverage"].includes("--experimental-test-coverage"), "test:coverage must not keep the Node instrument");
    // Floors are data now (core + per-package rows), not flags in the script.
    const thresholds = JSON.parse(readFileSync("scripts/coverage-thresholds.json", "utf8"));
    assert.ok(
      Number.isFinite(thresholds.core?.lines) && Number.isFinite(thresholds.core?.functions),
      "coverage-thresholds.json must carry the Bun-measured core floors",
    );
    for (const gate of ["npm run lint", "npm run format:check", "npm run test:coverage"]) {
      assert.ok(scripts["sdk:ready"].includes(gate), `sdk:ready missing ${gate}`);
    }
  });
});
