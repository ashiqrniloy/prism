import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createProviderProject,
  defaultProviderTemplatesRoot,
  parseProviderAddArgs,
  ProviderAddUsageError,
  runProviderAddCommand,
  validateProviderName,
} from "../cli-provider-add.js";
import { runCli } from "../cli-runner.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const templatesRoot = defaultProviderTemplatesRoot();
const VERSION = "0.2.1";

class MemoryWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  text(): string {
    return this.chunks.join("");
  }
}

function streams() {
  return { stdin: Readable.from(""), stdout: new MemoryWritable(), stderr: new MemoryWritable() };
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else out.push(path);
  }
  return out;
}

function cleanChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "NODE_TEST_CONTEXT" || key === "NODE_TEST_WORKER_ID" || key.startsWith("NODE_TEST_")) {
      delete env[key];
    }
  }
  return env;
}

function runInProject(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: cleanChildEnv(), timeout: 120_000 });
}

const EXPECTED_FILES = [
  "CHANGELOG.md",
  "README.md",
  "docs/providers/acme.md",
  "package.json",
  "src/__tests__/provider.test.ts",
  "src/cache.ts",
  "src/index.ts",
  "src/models.ts",
  "src/provider.ts",
  "tsconfig.json",
];

describe("prism providers add", () => {
  it("parses flags with derived defaults", () => {
    const options = parseProviderAddArgs([
      "acme",
      "--base-url",
      "https://api.acme.example/v1/",
      "--env-key",
      "ACME_API_KEY",
      "--model",
      "acme-large",
    ]);
    assert.deepEqual(options, {
      name: "acme",
      baseUrl: "https://api.acme.example/v1/",
      envKey: "ACME_API_KEY",
      model: "acme-large",
      force: false,
      help: false,
    });
    const defaults = parseProviderAddArgs(["my-provider", "--force"]);
    assert.equal(defaults.baseUrl, "https://api.example.com/v1");
    assert.equal(defaults.envKey, "MY_PROVIDER_API_KEY");
    assert.equal(defaults.model, "my-provider-large");
    assert.equal(defaults.force, true);
  });

  it("rejects missing name, unknown flags, and missing flag values", () => {
    assert.throws(() => parseProviderAddArgs([]), ProviderAddUsageError);
    assert.throws(() => parseProviderAddArgs(["--force"]), ProviderAddUsageError);
    assert.throws(() => parseProviderAddArgs(["acme", "--nope"]), ProviderAddUsageError);
    assert.throws(() => parseProviderAddArgs(["acme", "--env-key"]), ProviderAddUsageError);
    assert.throws(() => parseProviderAddArgs(["a", "b"]), ProviderAddUsageError);
  });

  it("validates npm package names and refuses traversal", () => {
    for (const bad of [
      "",
      "../evil",
      "a/b",
      "a\\b",
      "Bad",
      "UPPER",
      ".hidden",
      "_underscore",
      "a..b",
      "with space",
      "x".repeat(215),
      "a\0b",
    ]) {
      assert.throws(() => validateProviderName(bad), ProviderAddUsageError, `expected rejection: ${JSON.stringify(bad)}`);
    }
    for (const good of ["acme", "my-provider", "my.provider", "a1", "openrouter2"]) {
      validateProviderName(good);
    }
  });

  it("rejects invalid env keys and base URLs with usage exit code 2 and nothing written", async () => {
    for (const [flag, value] of [
      ["--env-key", "1BAD"],
      ["--env-key", "bad-key"],
      ["--env-key", "with space"],
      ["--base-url", "not a url"],
      ["--base-url", "ftp://example.com"],
    ] as const) {
      const root = mkdtempSync(join(tmpdir(), "prism-provider-bad-"));
      try {
        const io = streams();
        const code = await runProviderAddCommand(["acme", flag, value], { ...io, templatesRoot, packageVersion: VERSION, cwd: root });
        assert.equal(code, 2, `${flag} ${value} must fail`);
        assert.match(io.stderr.text(), /Invalid|Missing/);
        assert.deepEqual(readdirSync(root), [], `${flag} ${value} must write nothing`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("generates the full file set with substituted tokens and no leftovers", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-provider-gen-"));
    try {
      const result = await createProviderProject(
        { name: "acme", baseUrl: "https://api.acme.example/v1/", envKey: "ACME_API_KEY", model: "acme-large", force: false, help: false },
        { stdout: new MemoryWritable(), stderr: new MemoryWritable(), templatesRoot, packageVersion: VERSION, cwd: root },
      );
      assert.equal(result.targetDir, join(root, "acme"));
      assert.deepEqual([...result.writtenFiles].sort(), EXPECTED_FILES);
      assert.ok(result.totalBytes > 0);
      assert.ok(result.totalBytes < 40_000, `scaffold unexpectedly large: ${result.totalBytes}`);

      const target = join(root, "acme");
      const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
        name: string;
        version: string;
        sideEffects: boolean;
        peerDependencies: Record<string, string>;
      };
      assert.equal(pkg.name, "acme");
      assert.equal(pkg.version, VERSION);
      assert.equal(pkg.sideEffects, false);
      assert.equal(pkg.peerDependencies["@arnilo/prism"], VERSION);

      const providerSource = readFileSync(join(target, "src/provider.ts"), "utf8");
      assert.match(providerSource, /ACME_DEFAULT_BASE_URL = "https:\/\/api\.acme\.example\/v1"/);
      assert.match(providerSource, /createAcmeProvider/);
      const models = readFileSync(join(target, "src/models.ts"), "utf8");
      assert.match(models, /model: "acme-large"/);
      const index = readFileSync(join(target, "src/index.ts"), "utf8");
      assert.match(index, /api\.registerAuthMethod\(\{ kind: "api_key", provider: providerId/);
      assert.match(index, /createAcmeProviderPackage/);
      const cache = readFileSync(join(target, "src/cache.ts"), "utf8");
      assert.match(cache, /ACME_PROMPT_CACHE_KEY_MAX_LENGTH/);
      assert.ok(readFileSync(join(target, "docs/providers/acme.md"), "utf8").includes("# acme provider"));
      assert.ok(readFileSync(join(target, "README.md"), "utf8").includes("ACME_API_KEY"));
      const testSource = readFileSync(join(target, "src/__tests__/provider.test.ts"), "utf8");
      assert.match(testSource, /@arnilo\/prism\/testing\/provider-conformance/);
      assert.match(testSource, /assertNoSecretLeak/);

      for (const file of walkFiles(target)) {
        assert.doesNotMatch(readFileSync(file, "utf8"), /__[A-Z0-9_]+__/, `unresolved token in ${file}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses overwrite without --force; overwrites only template files with --force", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-provider-overwrite-"));
    try {
      mkdirSync(join(root, "acme", "src"), { recursive: true });
      writeFileSync(join(root, "acme", "src", "custom.ts"), "export const mine = true;\n");
      const io = streams();
      const code = await runProviderAddCommand(["acme"], { ...io, templatesRoot, packageVersion: VERSION, cwd: root });
      assert.equal(code, 2);
      assert.match(io.stderr.text(), /not empty|--force/);

      const forced = await runProviderAddCommand(["acme", "--force"], { ...io, templatesRoot, packageVersion: VERSION, cwd: root });
      assert.equal(forced, 0);
      assert.ok(readFileSync(join(root, "acme", "package.json"), "utf8").includes('"name": "acme"'));
      // host-owned file untouched: --force only rewrites template-managed files
      assert.equal(readFileSync(join(root, "acme", "src", "custom.ts"), "utf8"), "export const mine = true;\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses non-empty destinations without --force and honors the symlink-escape refusal", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-provider-escape-"));
    try {
      const io = streams();
      // first plain run succeeds
      assert.equal(await runProviderAddCommand(["acme"], { ...io, templatesRoot, packageVersion: VERSION, cwd: root }), 0);
      // second run refuses the non-empty destination without --force
      const io2 = streams();
      const code = await runProviderAddCommand(["acme"], { ...io2, templatesRoot, packageVersion: VERSION, cwd: root });
      assert.equal(code, 2);
      assert.match(io2.stderr.text(), /not empty|--force/);

      // symlinked src/ pointing outside the destination refuses even with --force
      const outside = mkdtempSync(join(tmpdir(), "prism-provider-outside-"));
      rmSync(join(root, "acme", "src"), { recursive: true, force: true });
      symlinkSync(outside, join(root, "acme", "src"), "dir");
      const io3 = streams();
      const code3 = await runProviderAddCommand(["acme", "--force"], { ...io3, templatesRoot, packageVersion: VERSION, cwd: root });
      assert.equal(code3, 2);
      assert.match(io3.stderr.text(), /symlinked directory/);
      assert.deepEqual(readdirSync(outside), [], "no file may land outside the destination");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runCli dispatches providers add and prints help", async () => {
    const io = streams();
    const help = await runCli(["providers", "add", "--help"], io);
    assert.equal(help, 0);
    assert.match(io.stdout.text(), /prism providers add <name>/);

    const root = mkdtempSync(join(tmpdir(), "prism-provider-cli-"));
    try {
      const io2 = streams();
      const code = await runCli(["providers", "add", "acme", "--env-key", "ACME_API_KEY"], {
        ...io2,
        providerTemplatesRoot: templatesRoot,
        providerPackageVersion: VERSION,
        cwd: root,
      });
      assert.equal(code, 0);
      assert.match(io2.stdout.text(), /Scaffolded provider package/);
      assert.ok(readFileSync(join(root, "acme", "src", "provider.ts"), "utf8").includes("ACME_DEFAULT_BASE_URL"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fixture: generated package typechecks and its conformance test passes offline against the repo build", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-provider-fixture-"));
    // Fixture lives INSIDE the repo so module resolution walks up to the repo
    // node_modules (@arnilo/prism -> repo root, typescript, @types/node).
    const fixtureRoot = mkdtempSync(join(repoRoot, ".scaffold-fixture-"));
    try {
      const result = await createProviderProject(
        { name: "acme", baseUrl: "https://api.acme.example/v1/", envKey: "ACME_API_KEY", model: "acme-large", force: false, help: false },
        { stdout: new MemoryWritable(), stderr: new MemoryWritable(), templatesRoot, packageVersion: VERSION, cwd: fixtureRoot },
      );
      const target = result.targetDir;

      const typecheck = runInProject(
        process.execPath,
        [join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", join(target, "tsconfig.json")],
        target,
      );
      assert.equal(typecheck.status, 0, `typecheck failed:\n${typecheck.stdout}\n${typecheck.stderr}`);

      const test = runInProject(process.execPath, ["--test", join(target, "dist", "__tests__", "provider.test.js")], target);
      assert.equal(test.status, 0, `fixture test failed:\n${test.stdout}\n${test.stderr}`);
      assert.match(`${test.stdout}\n${test.stderr}`, /ℹ (pass|tests)/);

      // scaffold output never lands in the repo graph: fixture dir removed below; nothing tracked
      assert.ok(readdirSync(fixtureRoot).includes("acme"));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
