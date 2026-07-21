import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import {
  INIT_PROVIDERS,
  createInitProject,
  defaultTemplatesRoot,
  parseInitArgs,
  runInitCommand,
} from "../cli-init.js";
import { runCli } from "../cli-runner.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const templatesRoot = defaultTemplatesRoot();

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

function totalBytes(dir: string): number {
  return walkFiles(dir).reduce((sum, path) => sum + statSync(path).size, 0);
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
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: cleanChildEnv() });
}

function secretScan(dir: string): string[] {
  const patterns = [
    /sk-[A-Za-z0-9]{10,}/,
    /sk-or-[A-Za-z0-9]{10,}/,
    /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
    /api[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}/i,
  ];
  const hits: string[] = [];
  for (const path of walkFiles(dir)) {
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text) && !text.includes("sk-...") && !text.includes("sk-or-...")) {
        hits.push(`${path}: ${pattern}`);
      }
    }
  }
  return hits;
}

describe("prism init", () => {
  it("parses provider and optional feature flags", () => {
    const parsed = parseInitArgs([
      "my-agent",
      "--provider",
      "openai",
      "--with-workflows",
      "--with-evals",
      "--force",
    ]);
    assert.equal(parsed.directory, "my-agent");
    assert.equal(parsed.provider, "openai");
    assert.equal(parsed.withWorkflows, true);
    assert.equal(parsed.withEvals, true);
    assert.equal(parsed.force, true);
  });

  it("rejects unknown provider, unknown flag, and missing directory", () => {
    assert.throws(() => parseInitArgs(["app", "--provider", "nope"]), /Unknown provider/);
    assert.throws(() => parseInitArgs(["app", "--wat"]), /Unknown flag/);
    assert.throws(() => parseInitArgs([]), /Missing destination directory/);
    assert.throws(() => parseInitArgs(["app", "extra"]), /Unexpected argument/);
  });

  it("runCli dispatches init and prints help", async () => {
    const io = streams();
    const code = await runCli(["init", "--help"], io);
    assert.equal(code, 0);
    assert.match(io.stdout.text(), /Usage: prism init/);
    assert.match(io.stdout.text(), /--with-workflows/);
  });

  it("generates a mock project that typechecks and passes offline tests", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-init-mock-"));
    const packDir = mkdtempSync(join(tmpdir(), "prism-init-pack-"));
    try {
      const target = join(root, "demo");
      const result = await createInitProject(
        {
          directory: target,
          provider: "mock",
          withWorkflows: false,
          withEvals: false,
          force: false,
          help: false,
        },
        {
          stdout: new MemoryWritable(),
          stderr: new MemoryWritable(),
          templatesRoot,
          packageVersion: "0.0.9",
          cwd: root,
        },
      );

      assert.ok(result.writtenFiles.includes("package.json"));
      assert.ok(result.writtenFiles.includes("src/agent.ts"));
      assert.ok(result.writtenFiles.includes("src/__tests__/agent.test.ts"));
      assert.ok(result.totalBytes > 0);
      assert.ok(result.totalBytes < 50_000, `scaffold unexpectedly large: ${result.totalBytes}`);

      const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@arnilo/prism"]);
      assert.equal(pkg.dependencies["@arnilo/prism"], "0.0.9");

      const packed = runInProject("npm", ["pack", "--pack-destination", packDir], repoRoot);
      assert.equal(packed.status, 0, packed.stderr || packed.stdout);
      const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
      assert.ok(tarball, "core tarball missing");

      pkg.dependencies["@arnilo/prism"] = join(packDir, tarball!);
      writeFileSync(join(target, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

      const install = runInProject("npm", ["install"], target);
      assert.equal(install.status, 0, install.stderr || install.stdout);

      const typecheck = runInProject("npm", ["run", "typecheck"], target);
      assert.equal(typecheck.status, 0, typecheck.stderr || typecheck.stdout);

      const test = runInProject("npm", ["test"], target);
      assert.equal(test.status, 0, test.stderr || test.stdout);
      assert.match(`${test.stdout}\n${test.stderr}`, /Hello from mock|ℹ pass 1|pass 1/);

      // Default install must stay tiny versus Mastra's 439 MB scaffold.
      const nm = join(target, "node_modules");
      const installBytes = totalBytes(nm);
      assert.ok(
        installBytes < 50 * 1024 * 1024,
        `default generated install too large: ${installBytes} bytes`,
      );

      const hits = secretScan(target);
      assert.deepEqual(
        hits.filter((hit) => !hit.includes(`${"node_modules"}/`)),
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(packDir, { recursive: true, force: true });
    }
  });

  it("supports every provider flag and optional dependency matrix", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-init-matrix-"));
    try {
      for (const provider of INIT_PROVIDERS) {
        const target = join(root, provider);
        await createInitProject(
          {
            directory: target,
            provider,
            withWorkflows: false,
            withEvals: false,
            force: false,
            help: false,
          },
          {
            stdout: new MemoryWritable(),
            stderr: new MemoryWritable(),
            templatesRoot,
            packageVersion: "0.0.9",
            cwd: root,
          },
        );
        const agent = readFileSync(join(target, "src/agent.ts"), "utf8");
        const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
          dependencies: Record<string, string>;
        };
        const env = readFileSync(join(target, ".env.example"), "utf8");
        assert.match(agent, /createAgent/);
        assert.ok(pkg.dependencies["@arnilo/prism"]);
        if (provider === "mock") {
          assert.equal(pkg.dependencies["@arnilo/prism-provider-openai"], undefined);
          assert.match(env, /No API key required|mock provider/i);
        } else {
          assert.ok(
            Object.keys(pkg.dependencies).some((name) => name.startsWith("@arnilo/prism-provider-")),
            `${provider} missing provider dependency`,
          );
          assert.match(env, /Placeholder only|API_KEY/);
          assert.doesNotMatch(env, /sk-[A-Za-z0-9]{8,}/);
        }
      }

      const withExtras = join(root, "extras");
      await createInitProject(
        {
          directory: withExtras,
          provider: "openrouter",
          withWorkflows: true,
          withEvals: true,
          force: false,
          help: false,
        },
        {
          stdout: new MemoryWritable(),
          stderr: new MemoryWritable(),
          templatesRoot,
          packageVersion: "0.0.9",
          cwd: root,
        },
      );
      const extrasPkg = JSON.parse(readFileSync(join(withExtras, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      assert.ok(extrasPkg.dependencies["@arnilo/prism-provider-openrouter"]);
      assert.ok(extrasPkg.dependencies["@arnilo/prism-workflows"]);
      assert.ok(extrasPkg.dependencies["@arnilo/prism-evals"]);
      assert.equal(extrasPkg.dependencies["@arnilo/prism-session-store-sqlite"], undefined);
      assert.equal(extrasPkg.dependencies["@arnilo/prism-observability-opentelemetry"], undefined);
      assert.ok(statSync(join(withExtras, "src/workflows-example.ts")).isFile());
      assert.ok(statSync(join(withExtras, "src/evals-example.ts")).isFile());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses non-empty destinations and overwrites only with --force", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-init-force-"));
    try {
      const target = join(root, "app");
      mkdirSync(target);
      writeFileSync(join(target, "keep.txt"), "preserve\n");

      const io = streams();
      const denied = await runInitCommand(["app"], {
        ...io,
        templatesRoot,
        packageVersion: "0.0.9",
        cwd: root,
      });
      assert.equal(denied, 2);
      assert.match(io.stderr.text(), /not empty|overwrite/i);
      assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "preserve\n");

      const forced = await runInitCommand(["app", "--force", "--provider", "mock"], {
        stdout: new MemoryWritable(),
        stderr: new MemoryWritable(),
        templatesRoot,
        packageVersion: "0.0.9",
        cwd: root,
      });
      assert.equal(forced, 0);
      assert.ok(statSync(join(target, "package.json")).isFile());
      assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "preserve\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps generated relative paths inside the destination", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-init-escape-"));
    try {
      mkdirSync(join(root, "cwd"), { recursive: true });
      const result = await createInitProject(
        {
          directory: "safe-app",
          provider: "mock",
          withWorkflows: false,
          withEvals: false,
          force: false,
          help: false,
        },
        {
          stdout: new MemoryWritable(),
          stderr: new MemoryWritable(),
          templatesRoot,
          packageVersion: "0.0.9",
          cwd: join(root, "cwd"),
        },
      );
      assert.equal(result.targetDir, resolve(root, "cwd", "safe-app"));
      for (const file of result.writtenFiles) {
        assert.equal(file.includes(".."), false, file);
        assert.equal(file.startsWith("/"), false, file);
      }

      const io = streams();
      const code = await runInitCommand(["/"], {
        ...io,
        templatesRoot,
        packageVersion: "0.0.9",
        cwd: join(root, "cwd"),
      });
      assert.equal(code, 2);
      assert.match(io.stderr.text(), /filesystem root|Refusing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports default scaffold size far below the Mastra baseline", async () => {
    const root = mkdtempSync(join(tmpdir(), "prism-init-size-"));
    try {
      const target = join(root, "sized");
      const result = await createInitProject(
        {
          directory: target,
          provider: "mock",
          withWorkflows: false,
          withEvals: false,
          force: false,
          help: false,
        },
        {
          stdout: new MemoryWritable(),
          stderr: new MemoryWritable(),
          templatesRoot,
          packageVersion: "0.0.9",
          cwd: root,
        },
      );
      const bytes = totalBytes(target);
      assert.equal(result.totalBytes, bytes);
      // Generated sources only (no node_modules). Mastra scaffold baseline is 439 MB install.
      assert.ok(bytes < 32_768, `default scaffold sources too large: ${bytes} bytes`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
