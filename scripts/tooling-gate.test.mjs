#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "bun:test";

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
    assert.equal(scripts["test:postgres"], "bun scripts/postgres-evidence.mjs");
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

  // Plan 124 Task 2: the contributor toolchain is Bun-only, so the scan flipped. No repository
  // spawn may name `node` — on a Bun-only host the binary may not exist — and no spawn may pass a
  // Node-only test flag through `process.execPath`, which is Bun under the only parent this repo
  // runs (`bun --test` is a script run, not a test runner). Runner-agnostic `process.execPath`
  // spawns (script paths, `-e` snippets, CLI entrypoints) are fine: they execute Bun.
  // Documented exceptions:
  //   - scripts/branch-coverage-audit.mjs keeps the Node branch instrument: Bun 1.4.2 emits no
  //     branch data (plan 120 Task 6), asserted in scripts/phase23-coverage.test.mjs.
  //   - packages/prism-coding-tools/src/security/__tests__/docker-sandbox.test.ts passes the
  //     string "node" to computeCommandFingerprint as a command NAME to hash — data, not a spawn.
  //   - the release-host registry toolchain (plan 125 Task 5) spawns `npm`, not `node`.
  //   - the sqlite wrong-runtime probe spawns `node` on purpose (plan 126 Task 2).
  it("no spawn names `node`, and no Node-only flag rides process.execPath", () => {
    const NODE_ONLY = /--test\b|--test-isolation|--experimental-test-coverage/;
    const NODE_SPAWN_EXCEPTIONS = new Set([
      "scripts/branch-coverage-audit.mjs",
      "packages/prism-coding-tools/src/security/__tests__/docker-sandbox.test.ts",
      // Plan 126 Task 2: the wrong-runtime probe must actually run on node.
      "packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts",
    ]);
    // Skip matches inside a template literal (this file's own fixture strings).
    const inTemplateLiteral = (source, index) => {
      const before = source.slice(source.lastIndexOf("\n", index) + 1, index);
      return (before.match(/`/g) ?? []).length % 2 === 1;
    };
    const statement = (source, index) => source.slice(index).split(";")[0].slice(0, 500);
    // Any call whose first argument is the literal "node" and whose second is an argument array —
    // the shape of every runner spawn, whatever the helper is called (spawn, run, runInProject, …).
    const nodeByName = (source) =>
      [...source.matchAll(/(?:\w+)\s*\(\s*["']node["']\s*,\s*\[/g)]
        .filter((match) => !inTemplateLiteral(source, match.index))
        .map((match) => statement(source, match.index));
    const nodeFlagSpawns = (source) =>
      [...source.matchAll(/(?:spawn|spawnSync|execFile|execFileSync|run)\s*\(\s*process\.execPath/g)]
        .filter((match) => !inTemplateLiteral(source, match.index))
        .map((match) => statement(source, match.index))
        .filter((text) => NODE_ONLY.test(text));
    for (const ok of [
      `spawnSync("bun", ["test", "--timeout=0", file]);`,
      `spawn("bun", [LOCK, "bun", "test", file]);`,
      `spawnSync(process.execPath, ["-e", "1"]);`,
      `spawnSync(process.execPath, [cli, "--provider", id, "--mode", "rpc"]);`,
      `run(process.execPath, [join("scripts", "with-build-lock.mjs"), ...args]);`,
    ]) {
      assert.deepEqual(nodeByName(ok), [], `Bun spawns must pass the scan: ${ok}`);
      assert.deepEqual(nodeFlagSpawns(ok), [], `runner-agnostic spawn must pass the scan: ${ok}`);
    }
    for (const bad of [
      `spawnSync("node", ["--test", file]);`,
      `spawn("node", [LOCK, "node", "--test", IMPORTER]);`,
      `run("node", ["smoke.mjs"], consumer);`,
      `spawnSync(process.execPath, ["--test", file]);`,
      `spawn(process.execPath, [LOCK, "node", "--test", IMPORTER]);`,
      `run(process.execPath, ["--test-isolation=none", glob]);`,
      `spawnSync(process.execPath, ["--experimental-test-coverage", ...args]);`,
    ]) {
      const caught = nodeByName(bad).length + nodeFlagSpawns(bad).length;
      assert.ok(caught > 0, `a node spawn or Node-only flag must fail the scan: ${bad}`);
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
    for (const root of ["src", "scripts", "packages", "examples"]) walk(root);
    const offenders = files.flatMap((file) => {
      const rel = relative(process.cwd(), file).split("\\").join("/");
      if (NODE_SPAWN_EXCEPTIONS.has(rel)) return [];
      return [...nodeByName(readFileSync(file, "utf8")), ...nodeFlagSpawns(readFileSync(file, "utf8"))].map(
        (text) => `${rel}: ${text.split("\n")[0]}`,
      );
    });
    assert.deepEqual(offenders, [], `node spawns must be gone (plan 124 Task 2): ${offenders.join(" | ")}`);
  });

  // Plan 127 Task 4: `Bun.hash` is wyhash-style (non-crypto) and `Bun.CryptoHasher` is a faster
  // sha256 — neither may quietly replace a digest that backs a security decision. The measured
  // ledger is docs/_evidence/phase127-bun-concurrency.md §10; this test is its runnable half.
  it("Bun-native hashing ledger: no Bun.hash on a security path", () => {
    const ADOPTED_SITES = []; // Ledger mirror: a path lands here only with its measured win + "why not security" line in §10.
    const SECURITY_PATHS = [
      "src/agent-approval.ts",
      "src/agent-run-state.ts",
      "src/artifacts.ts",
      "src/attention-compiler.ts",
      "src/run-bundle.ts",
      "packages/prism-channels/src/approvals.ts",
      "packages/prism-channels/src/pairing.ts",
      "packages/prism-channels/src/telegram.ts",
      "packages/prism-coding-tools/src/security/approval.ts",
      "packages/prism-coding-tools/src/security/docker-cli.ts",
      "packages/prism-coding-tools/src/security/egress/policy.ts",
      "packages/prism-coding-tools/src/security/sandbox-tar.ts",
      "packages/prism-core/src/credentials/node/oauth2.ts",
      "packages/prism-core/src/governance/policy/audit-export.ts",
      "packages/prism-core/src/governance/prompts/util.ts",
      "packages/prism-providers/src/bedrock/sigv4.ts",
      "packages/prism-providers/src/openai/oauth.ts",
    ];
    const BUN_NATIVE_HASH = /\bBun\s*\.\s*(?:hash|CryptoHasher)\s*\(/g;
    const count = (source) => [...source.matchAll(BUN_NATIVE_HASH)].length;
    // Positive controls: both native shapes must be seen, and a node digest must not be.
    assert.ok(count("const k = Bun.hash(bytes);") > 0, "Bun.hash must be seen by the ledger scan");
    assert.ok(count('new Bun.CryptoHasher("sha256")') > 0, "Bun.CryptoHasher must be seen");
    assert.equal(count('createHash("sha256")'), 0, "a node:crypto digest is not a native site");

    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "dist", ".git", "coverage", "__tests__"].includes(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    for (const root of ["src", "packages"]) walk(root);
    const sites = files
      .map((file) => relative(process.cwd(), file).split("\\").join("/"))
      .filter((rel) => count(readFileSync(rel, "utf8")) > 0);
    const unledgered = sites.filter((rel) => !ADOPTED_SITES.includes(rel));
    assert.deepEqual(unledgered, [], `native hashing sites must be in the §10 ledger: ${unledgered.join(", ")}`);
    for (const rel of SECURITY_PATHS) {
      const source = readFileSync(rel, "utf8");
      assert.ok(source.includes('from "node:crypto"'), `${rel} must keep node:crypto`);
      assert.equal(count(source), 0, `${rel} backs a security decision and must not use a Bun-native hash (plan 127 Task 4 §10)`);
    }
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
    for (const gate of ["bun run lint", "bun run format:check", "bun run test:coverage"]) {
      assert.ok(scripts["sdk:ready"].includes(gate), `sdk:ready missing ${gate}`);
    }
  });

  // Plan 125 Task 3: the generated project is a contributor's entry point, so no scaffold or hint
  // surface may tell a user to run npm. The only npm left in these files is the release-host
  // registry toolchain (plan 125 Task 5: pack, publish, sbom, view) and prose about npm *naming*
  // rules — the registry's rules, not a command.
  it("scaffolds and hint strings emit Bun commands only", () => {
    const ALLOWED_NPM = /\bnpm\s+(?:pack|publish|sbom|view)\b|\bnpm[-\s](?:names?|validated|package)/;
    const violations = (source) =>
      [...source.matchAll(/\bnpm\b[^\n]*/g)].map((match) => match[0].trim()).filter((line) => !ALLOWED_NPM.test(line));
    for (const allowed of [
      '"pack:dry-run": "npm pack --dry-run"',
      "  bun install",
      "  bun test",
      "npm-validated provider/package name",
      "npm names are lowercase",
    ]) {
      assert.deepEqual(violations(allowed), [], `an allowlisted npm use must pass the scan: ${allowed}`);
    }
    for (const retired of [
      "  npm install",
      "  npm test",
      '"test": "npm run build && node --test dist/__tests__/agent.test.js"',
      "npm i retired-peer",
      "npm start",
      "npm ci",
    ]) {
      assert.ok(violations(retired).length > 0, `a retired npm command must fail the scan: ${retired}`);
    }
    const files = [
      ...readdirSync("src")
        .filter((name) => /^cli-.*\.ts$/.test(name))
        .map((name) => `src/${name}`),
      ...readdirSync("templates", { recursive: true })
        .filter((entry) => entry.endsWith(".tmpl"))
        .map((entry) => `templates/${entry}`),
    ];
    assert.ok(files.length >= 30, `expected the scaffold surface set, found ${files.length}`);
    // Non-vacuity: the surfaces must actually emit Bun commands, not merely avoid npm.
    const body = files.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const command of ["bun install", "bun test"]) {
      assert.ok(body.includes(command), `scaffold and hint surfaces must emit ${command}`);
    }
    const offenders = files.flatMap((file) => violations(readFileSync(file, "utf8")).map((line) => `${file}: ${line}`));
    assert.deepEqual(offenders, [], `scaffold and hint surfaces must not emit npm commands (plan 125 Task 3): ${offenders.join(" | ")}`);
  });

  // Plan 125 Task 5: npm survives only as the release-host registry toolchain. Probed 2026-09-25 on
  // Bun 1.4.2: `bun pack`, `bun dist-tag` and `bun deprecate` do not exist ("error: Script not
  // found") and `bun publish --help` has no --provenance, so the registry *interface* stays npm's
  // on the release host (`dist-tag`/`deprecate` come from the plan 054 legacy retirement path) while
  // any other npm use is a bug. Every npm call site carries the boundary comment, and a computed
  // argument list is only allowed where the file declares it (`publishArgs`).
  it("npm survives only as the release-host registry toolchain", () => {
    const REGISTRY_OPS = new Set(["pack", "publish", "sbom", "view", "dist-tag", "deprecate"]);
    const BOUNDARY_COMMENT = "release-host registry toolchain";
    const RETIRED_NPM = /\bnpm\s+(?:install|i|add|test|start|run|ci|exec|x|init|update|audit)\b/;
    // This scanner's own fixtures spell the banned shapes, exactly like the node-spawn scan above.
    const SELF = "scripts/tooling-gate.test.mjs";
    const spawnSite = /(?:spawnSync|spawn|execFileSync|execFile|execSync|exec|run)\s*\(\s*["']npm["']\s*,\s*\[/g;
    const helperSite = /[^\w.]npm\s*\(\s*\[\s*["']([\w-]+)["']/g;
    const computedSpawn = /(?:spawnSync|spawn|execFileSync|execFile|execSync|exec|run)\s*\(\s*["']npm["']\s*,\s*(?!\[)\S/g;
    const literalOp = /["']npm["']\s*,\s*\[\s*["']([\w-]+)["']/;
    const nonRegistryOps = (source) =>
      [...source.matchAll(spawnSite)]
        .map((match) => source.slice(match.index).match(literalOp)?.[1])
        .filter((op) => op && !REGISTRY_OPS.has(op));
    for (const ok of [
      'spawnSync("npm", ["pack", "--dry-run", "--json"]);',
      'execFileSync("npm", ["sbom", "--sbom-format", "spdx"], {});',
      'spawnSync("npm", ["view", name, "version"]);',
      'npm(["dist-tag", "add", spec, "legacy"]);',
      'const r = spawnSync("git", ["status"]);',
    ]) {
      assert.deepEqual(nonRegistryOps(ok), [], `a registry op must pass the scan: ${ok}`);
    }
    for (const bad of [
      'spawnSync("npm", ["install", "--offline"]);',
      'execFileSync("npm", ["test"], {});',
      'spawnSync("npm", ["ci"]);',
      'run("npm", ["run", "build"]);',
    ]) {
      assert.ok(nonRegistryOps(bad).length > 0, `a non-registry npm op must fail the scan: ${bad}`);
    }

    const walk = (dir, out = []) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(?:mjs|js)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const scriptFiles = walk("scripts");
    const sites = [];
    const offenders = [];
    for (const file of scriptFiles) {
      const rel = relative(process.cwd(), file).split("\\").join("/");
      if (rel === SELF) continue;
      const source = readFileSync(file, "utf8");
      const ops = [...source.matchAll(spawnSite)]
        .map((match) => ({ op: source.slice(match.index).match(literalOp)?.[1], line: source.slice(0, match.index).split("\n").length }))
        .concat([...source.matchAll(helperSite)].map((match) => ({ op: match[1], line: source.slice(0, match.index).split("\n").length })));
      // Retired npm hints are banned in every non-fixture script, whether or not it spawns npm.
      if (!/\.test\.mjs$/.test(rel) && !rel.startsWith("scripts/fixtures/")) {
        for (const match of source.matchAll(/\bnpm\b[^\n]*/g)) {
          if (RETIRED_NPM.test(match[0])) offenders.push(`${rel}: ${match[0].trim()} is retired (plan 125 Task 5)`);
        }
      }
      const computed = [...source.matchAll(computedSpawn)];
      if (!ops.length && !computed.length) continue;
      sites.push(...ops.map((site) => `${rel}:${site.line} npm ${site.op}`));
      if (!source.includes(BOUNDARY_COMMENT)) offenders.push(`${rel}: npm call site without the release-host comment`);
      for (const site of ops) {
        if (!REGISTRY_OPS.has(site.op)) offenders.push(`${rel}:Line ${site.line}: npm ${site.op} is not a registry op`);
      }
      for (const site of computed) {
        const line = source.slice(0, site.index).split("\n").length;
        const text = source.slice(site.index).split(";")[0];
        // Computed args are only allowed where the file declares the registry op it builds.
        const declared = /publishArgs/.test(text) && /function publishArgs\([\s\S]{0,400}?\["publish"/.test(source);
        sites.push(`${rel}:${line} npm ${declared ? "publish" : "<computed>"}`);
        if (!declared) {
          offenders.push(`${rel}:Line ${line}: npm spawn with computed args is not a declared registry op`);
        }
      }
    }
    const workflows = readdirSync(join(".github", "workflows")).filter((name) => name.endsWith(".yml"));
    for (const name of workflows) {
      const rel = `.github/workflows/${name}`;
      const source = readFileSync(rel, "utf8");
      const commandLines = source
        .split("\n")
        .map((line, index) => ({ line: line.trimStart(), index }))
        .filter(({ line }) => !line.startsWith("#") && /\bnpm\s+/.test(line));
      if (!commandLines.length) continue;
      if (!source.includes(BOUNDARY_COMMENT)) offenders.push(`${rel}: npm command without the release-host comment`);
      for (const { line, index } of commandLines) {
        const op = line.match(/\bnpm\s+([\w-]+)/)?.[1];
        sites.push(`${rel}:${index + 1} npm ${op}`);
        if (!REGISTRY_OPS.has(op)) offenders.push(`${rel}:Line ${index + 1}: npm ${op} is not a registry op`);
        const within = source
          .split("\n")
          .slice(Math.max(0, index - 30), index)
          .some((near) => near.includes(BOUNDARY_COMMENT));
        if (!within) offenders.push(`${rel}:Line ${index + 1}: npm ${op} without the release-host comment above it`);
      }
    }
    assert.deepEqual(offenders, [], `npm is the release-host registry toolchain only (plan 125 Task 5): ${offenders.join(" | ")}`);
    // Non-vacuity: the scan must actually see the registry surface, not an emptied matcher.
    assert.ok(sites.length >= 15, `expected the registry call-site census, found ${sites.length}: ${sites.join(", ")}`);
    const opsSeen = new Set(sites.map((site) => site.split(" npm ").at(-1)));
    for (const op of ["pack", "publish", "view"]) assert.ok(opsSeen.has(op), `registry op ${op} must appear in the census`);

    // The decision record (probed gaps) and the unchanged supply-chain surface.
    const release = readFileSync("scripts/release.mjs", "utf8");
    for (const token of ["bun pack", "bun dist-tag", "--provenance", "OIDC"]) {
      assert.ok(release.includes(token), `release.mjs must record the probed gap: ${token}`);
    }
    const releaseYml = readFileSync(".github/workflows/release.yml", "utf8");
    const publishSite = release.indexOf('spawnSync("npm", publishArgs');
    const publishComment = release.slice(0, publishSite).split("\n").slice(-8).join("\n");
    assert.ok(publishComment.includes(BOUNDARY_COMMENT), "the publish call site must carry the release-host comment");
    assert.match(releaseYml, /NODE_AUTH_TOKEN:\s*\$\{\{ secrets\.NPM_TOKEN \}\}/, "release.yml must keep the publish token");
    for (const token of [
      "id-token: write",
      "actions/attest-build-provenance@",
      "bun scripts/verify-sbom.mjs",
      "bun audit --audit-level=moderate",
      "bun run release:publish",
    ]) {
      assert.ok(releaseYml.includes(token), `release.yml must keep the unchanged supply-chain surface: ${token}`);
    }
  });
});

// Plan 126 Task 3. History, the plan family, and the CI SBOM snapshot may still name the retired driver.
const RETIRED_SQLITE = ["better", "sqlite3"].join("-");
describe("retired sqlite driver", () => {
  it("is absent from live manifests, src, scripts, and non-history docs", () => {
    const skip = (rel) =>
      rel.startsWith("plans/") ||
      rel.startsWith("docs/_evidence/") ||
      rel.startsWith("docs/history/") ||
      rel.startsWith("docs/migrate-to-") ||
      rel === "CHANGELOG.md" ||
      rel === "scripts/plan-review-gate.test.mjs" ||
      rel.startsWith("security-artifacts/");
    const hits = [];
    for (const rel of execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0")) {
      if (!rel || skip(rel)) continue;
      if (readFileSync(rel).includes(Buffer.from(RETIRED_SQLITE))) hits.push(rel);
    }
    assert.deepEqual(hits, [], `retired driver still named in ${hits.join(", ")}`);
    assert.ok(readFileSync("CHANGELOG.md").includes(RETIRED_SQLITE), "history must keep the retired name");
  });
});

// Plan 128 Task 2. Retirement gate: zero live node:test imports in live source files.
describe("retired node:test runner imports", () => {
  it("are absent from live src, packages, scripts, examples, and templates", () => {
    const skip = (rel) =>
      rel.startsWith("plans/") ||
      rel.startsWith("docs/_evidence/") ||
      rel.startsWith("docs/history/") ||
      rel === "CHANGELOG.md" ||
      rel === "scripts/plan-review-gate.test.mjs" ||
      rel.startsWith("security-artifacts/");
    const offenders = [];
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0");
    for (const rel of files) {
      if (!rel || skip(rel)) continue;
      if (
        rel.startsWith("src/") ||
        rel.startsWith("packages/") ||
        rel.startsWith("scripts/") ||
        rel.startsWith("examples/") ||
        rel.startsWith("templates/")
      ) {
        if (!/\.(?:ts|js|mjs|cjs|tmpl)$/.test(rel)) continue;
        const source = readFileSync(rel, "utf8");
        for (const [index, line] of source.split("\n").entries()) {
          if (/\bfrom\s+["']node:test["']/.test(line)) {
            offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], `live node:test imports still present: ${offenders.join(", ")}`);
  });
});
