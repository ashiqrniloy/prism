import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBoundGitRunner, type BoundGitRunner, type GitExecRequest, type GitExecResult } from "../git-exec.js";
import { createGitAwareRepositoryOperations, parseGitLsFilesZ } from "../git-aware-repository.js";
import { createLocalRepositoryOperations } from "../repository.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "git-aware-"));
}

async function gitInit(cwd: string): Promise<BoundGitRunner> {
  const runner = await createBoundGitRunner();
  const run = async (...args: string[]) => {
    const r = await runner.exec({ args, cwd });
    assert.equal(r.exitCode, 0, gitStderr(r));
    return r;
  };
  await run("init");
  await run("config", "user.email", "test@example.com");
  await run("config", "user.name", "Test");
  return runner;
}

function gitStderr(r: GitExecResult): string {
  return r.stderr.toString("utf8") || `exit ${r.exitCode}`;
}

function fakeRunner(handler: (req: GitExecRequest) => Promise<GitExecResult>): BoundGitRunner {
  return {
    gitPath: "/usr/bin/git",
    exec: handler,
  };
}

function okResult(stdout: string | Buffer, exitCode = 0): GitExecResult {
  const buf = typeof stdout === "string" ? Buffer.from(stdout) : stdout;
  return {
    exitCode,
    stdout: buf,
    stderr: Buffer.alloc(0),
    timedOut: false,
    aborted: false,
    outputBytes: buf.length,
  };
}

test("parseGitLsFilesZ splits on NUL", () => {
  assert.deepEqual(parseGitLsFilesZ(Buffer.from("a\0b/c\0")), ["a", "b/c"]);
  assert.deepEqual(parseGitLsFilesZ(Buffer.from("solo")), ["solo"]);
  assert.deepEqual(parseGitLsFilesZ(Buffer.alloc(0)), []);
});

test("non-Git directory uses native fallback", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(join(cwd, "node_modules", "x.js"), "1\n").catch(async () => {
      await mkdir(join(cwd, "node_modules"), { recursive: true });
      await writeFile(join(cwd, "node_modules", "x.js"), "1\n");
    });

    const ops = createGitAwareRepositoryOperations(cwd);
    const listed = await ops.list({ root: cwd, maxResults: 100 });
    assert.ok(listed.entries.some((e) => e.path === "src" || e.path === "src/a.ts"));
    assert.equal(
      listed.entries.some((e) => e.path.includes("node_modules")),
      false,
    );

    const native = createLocalRepositoryOperations();
    const nativeListed = await native.list({ root: cwd, maxResults: 100 });
    assert.deepEqual(
      listed.entries.map((e) => e.path),
      nativeListed.entries.map((e) => e.path),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("git-aware honors nested gitignore and exclude-standard", async () => {
  const cwd = await tmp();
  try {
    const runner = await gitInit(cwd);
    await mkdir(join(cwd, "src", "nested"), { recursive: true });
    await writeFile(join(cwd, ".gitignore"), "ignored.txt\nsecret/\n");
    await writeFile(join(cwd, "src", ".gitignore"), "local-only.ts\n");
    await mkdir(join(cwd, ".git", "info"), { recursive: true });
    await writeFile(join(cwd, ".git", "info", "exclude"), "info-exclude.txt\n");
    await writeFile(join(cwd, "README.md"), "# hi\n");
    await writeFile(join(cwd, "ignored.txt"), "nope\n");
    await writeFile(join(cwd, "info-exclude.txt"), "nope\n");
    await mkdir(join(cwd, "secret"), { recursive: true });
    await writeFile(join(cwd, "secret", "x.txt"), "nope\n");
    await writeFile(join(cwd, "src", "keep.ts"), "export {}\n");
    await writeFile(join(cwd, "src", "local-only.ts"), "export {}\n");
    await writeFile(join(cwd, "src", "nested", "deep.ts"), "export {}\n");
    // Tracked-but-ignored: add -f then ignore should still show via --cached
    await runner.exec({ args: ["add", "-f", "ignored.txt"], cwd });
    await writeFile(join(cwd, ".gitignore"), "ignored.txt\nsecret/\n");
    await runner.exec({ args: ["add", "README.md", "src/keep.ts", "src/nested/deep.ts", ".gitignore", "src/.gitignore"], cwd });
    await runner.exec({ args: ["commit", "-m", "init"], cwd });

    const ops = createGitAwareRepositoryOperations(cwd, { git: runner });
    const listed = await ops.list({ root: cwd, maxResults: 200 });
    const paths = listed.entries.map((e) => e.path);

    assert.ok(paths.includes("README.md"));
    assert.ok(paths.includes("src/keep.ts"));
    assert.ok(paths.includes("src/nested/deep.ts"));
    assert.ok(paths.includes("ignored.txt"), "tracked-but-ignored stays visible via --cached");
    assert.equal(paths.includes("src/local-only.ts"), false);
    assert.equal(paths.includes("info-exclude.txt"), false);
    assert.equal(paths.includes("secret/x.txt"), false);
    assert.equal(
      paths.some((p) => p.startsWith(".git/")),
      false,
    );

    // Ground truth: same as git ls-files
    const truth = await runner.exec({
      args: ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      cwd,
    });
    const gitPaths = new Set(parseGitLsFilesZ(truth.stdout));
    for (const p of paths) {
      if (listed.entries.find((e) => e.path === p)?.kind === "directory") continue;
      assert.ok(gitPaths.has(p), `listed file ${p} must be in git ls-files`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("includeIgnored is host-only and surfaces untracked ignored files", async () => {
  const cwd = await tmp();
  try {
    const runner = await gitInit(cwd);
    await writeFile(join(cwd, ".gitignore"), "*.log\n");
    await writeFile(join(cwd, "app.ts"), "1\n");
    await writeFile(join(cwd, "noise.log"), "log\n");
    await runner.exec({ args: ["add", "app.ts", ".gitignore"], cwd });
    await runner.exec({ args: ["commit", "-m", "init"], cwd });

    const denied = createGitAwareRepositoryOperations(cwd, { git: runner });
    const without = await denied.list({ root: cwd, maxResults: 100 });
    assert.equal(
      without.entries.some((e) => e.path === "noise.log"),
      false,
    );

    const allowed = createGitAwareRepositoryOperations(cwd, { git: runner, includeIgnored: true });
    const withIgn = await allowed.list({ root: cwd, maxResults: 100 });
    assert.ok(withIgn.entries.some((e) => e.path === "noise.log"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("detection failure falls back; post-detection git failure fails closed", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "1\n");

    let calls = 0;
    const detectFail = fakeRunner(async () => {
      calls++;
      throw new Error("git missing");
    });
    const ops = createGitAwareRepositoryOperations(cwd, { git: detectFail });
    const listed = await ops.list({ root: cwd, maxResults: 10 });
    assert.ok(listed.entries.some((e) => e.path === "a.ts"));
    assert.ok(calls >= 1);

    let phase: "detect" | "ls" = "detect";
    const failAfterDetect = fakeRunner(async (req) => {
      if (req.args[0] === "rev-parse") {
        phase = "ls";
        return okResult("true\n");
      }
      throw new Error("ls-files boom");
    });
    const strict = createGitAwareRepositoryOperations(cwd, { git: failAfterDetect });
    await assert.rejects(() => strict.list({ root: cwd, maxResults: 10 }), /ls-files boom|git ls-files/);
    assert.equal(phase, "ls");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("symlink escape and .git internals stay excluded", async () => {
  const cwd = await tmp();
  const outside = await tmp();
  try {
    const runner = await gitInit(cwd);
    await writeFile(join(outside, "secret.txt"), "nope\n");
    await writeFile(join(cwd, "ok.ts"), "1\n");
    await symlink(outside, join(cwd, "escape"));
    await runner.exec({ args: ["add", "ok.ts"], cwd });
    await runner.exec({ args: ["commit", "-m", "init"], cwd });

    const ops = createGitAwareRepositoryOperations(cwd, { git: runner });
    const listed = await ops.list({ root: cwd, maxResults: 100 });
    const paths = listed.entries.map((e) => e.path);
    assert.ok(paths.includes("ok.ts"));
    assert.equal(
      paths.some((p) => p.includes("secret")),
      false,
    );
    assert.equal(
      paths.some((p) => p.startsWith(".git")),
      false,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("search and glob use git enumeration; large list caps without per-file spawn", async () => {
  const cwd = await tmp();
  try {
    const runner = await gitInit(cwd);
    await mkdir(join(cwd, "pkg"), { recursive: true });
    await writeFile(join(cwd, "pkg", "a.ts"), "const findme = 1;\n");
    await writeFile(join(cwd, "pkg", "b.ts"), "const other = 2;\n");
    await writeFile(join(cwd, ".gitignore"), "skip.ts\n");
    await writeFile(join(cwd, "skip.ts"), "const findme = 9;\n");
    await runner.exec({ args: ["add", "pkg", ".gitignore"], cwd });
    await runner.exec({ args: ["commit", "-m", "init"], cwd });

    let lsFilesCalls = 0;
    const counting: BoundGitRunner = {
      gitPath: runner.gitPath,
      exec: async (req) => {
        if (req.args[0] === "ls-files") lsFilesCalls++;
        return runner.exec(req);
      },
    };

    const ops = createGitAwareRepositoryOperations(cwd, { git: counting });
    const search = await ops.search({ root: cwd, query: "findme" });
    assert.equal(search.matches.length, 1);
    assert.equal(search.matches[0]?.path, "pkg/a.ts");

    const globbed = await ops.glob({ root: cwd, pattern: "pkg/*.ts" });
    assert.deepEqual(globbed.paths, ["pkg/a.ts", "pkg/b.ts"]);

    // One ls-files per operation (no includeIgnored) — never per-file spawn.
    assert.equal(lsFilesCalls, 2);

    // Entry cap truncates without exploding invocations
    lsFilesCalls = 0;
    const many = createGitAwareRepositoryOperations(cwd, {
      git: counting,
      limits: { maxEntries: 1, maxResults: 100 },
    });
    const capped = await many.list({ root: cwd, maxResults: 100 });
    assert.equal(capped.truncated, true);
    assert.equal(capped.truncatedBy, "entries");
    assert.equal(lsFilesCalls, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
