import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { parsePorcelainV2 } from "../git-status.js";
import { createGitOperations, resolveGitLimits, GitError } from "../git.js";
import {
  createGitTools,
  createGitStatusTool,
  createGitCommitTool,
  createGitApplyTool,
  createGitPrHandoffTool,
} from "../git-tools.js";
import { createCodingCheckTool } from "../checks.js";
import { createTempArtifactWriter } from "../artifacts.js";
import { SAFE_GIT_CONFIG_ARGS, SAFE_GIT_ENV } from "../git-exec.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "prism-git-"));
}

function run(cwd: string, args: string[]): string {
  const result = spawnSync("/usr/bin/git", [...SAFE_GIT_CONFIG_ARGS, ...args], {
    cwd,
    env: { ...SAFE_GIT_ENV, GIT_AUTHOR_NAME: "Prism", GIT_AUTHOR_EMAIL: "prism@example.com", GIT_COMMITTER_NAME: "Prism", GIT_COMMITTER_EMAIL: "prism@example.com" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

async function initRepo(): Promise<string> {
  const cwd = await tmp();
  run(cwd, ["init"]);
  run(cwd, ["checkout", "-b", "main"]);
  await writeFile(join(cwd, "README.md"), "# root\n");
  run(cwd, ["add", "--", "README.md"]);
  run(cwd, ["commit", "-m", "initial"]);
  return cwd;
}

test("resolveGitLimits rejects overflow", () => {
  assert.throws(() => resolveGitLimits({ maxPaths: 0 }), /maxPaths/);
  assert.throws(() => resolveGitLimits({ maxPatchBytes: 10 ** 12 }), /maxPatchBytes/);
});

test("parsePorcelainV2 ordinary/untracked/rename/branch", () => {
  const payload = [
    "# branch.oid abcdef",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +1 -2",
    "1 MM N... 100644 100644 100644 h1 h2 src/a.ts",
    "2 R. N... 100644 100644 100644 h1 h2 R100 src/b.ts",
    "src/a.ts",
    "? untracked.txt",
  ].join("\0");
  const parsed = parsePorcelainV2(Buffer.from(payload + "\0"));
  assert.equal(parsed.branch.head, "main");
  assert.equal(parsed.branch.oid, "abcdef");
  assert.equal(parsed.branch.ahead, 1);
  assert.equal(parsed.branch.behind, 2);
  assert.equal(parsed.dirty, true);
  assert.equal(parsed.entries[0]?.kind, "ordinary");
  assert.equal(parsed.entries[1]?.kind, "rename");
  assert.equal(parsed.entries[1]?.origPath, "src/a.ts");
  assert.equal(parsed.entries[2]?.kind, "untracked");
});

test("parsePorcelainV2 rejects malformed records", () => {
  assert.throws(() => parsePorcelainV2(Buffer.from("1 MM only\0")), /malformed/);
});

test("git_status and dirty commit protection", async () => {
  const cwd = await initRepo();
  try {
    await writeFile(join(cwd, "extra.txt"), "x\n");
    const statusTool = createGitStatusTool(cwd, { gitPath: "/usr/bin/git" });
    const status = await statusTool.execute({}, ctx());
    assert.equal(status.error, undefined);
    assert.match(textOf(status), /dirty=true/);
    assert.equal((status.metadata as { dirty?: boolean }).dirty, true);

    const commitTool = createGitCommitTool(cwd, {
      gitPath: "/usr/bin/git",
      commitIdentity: { name: "Prism", email: "prism@example.com" },
    });
    const denied = await commitTool.execute({ paths: ["README.md"], message: "nope" }, ctx());
    assert.ok(denied.error);
    assert.match(textOf(denied), /dirty/);

    await writeFile(join(cwd, "README.md"), "# root\nupdated\n");
    const ok = await commitTool.execute(
      { paths: ["README.md"], message: "update readme", createCheckpoint: true },
      ctx(),
    );
    assert.equal(ok.error, undefined, textOf(ok));
    assert.match(textOf(ok), /committed /);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("leading-dash path and invalid branch names", async () => {
  const cwd = await initRepo();
  try {
    await writeFile(join(cwd, "-weird.txt"), "dash\n");
    const ops = await createGitOperations({
      cwd,
      gitPath: "/usr/bin/git",
      commitIdentity: { name: "Prism", email: "prism@example.com" },
    });
    await ops.commit({ paths: ["-weird.txt"], message: "add weird" });
    const status = await ops.status();
    assert.equal(status.dirty, false);

    await assert.rejects(() => ops.branch({ action: "validate", name: "-bad" }), /branch name|invalid/);
    await assert.rejects(() => ops.branch({ action: "create", name: "has space" }), /invalid/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("git apply check/apply/reverse with rollback on failure path", async () => {
  const cwd = await initRepo();
  try {
    const before = await readFile(join(cwd, "README.md"), "utf8");
    const patch = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1,2 @@",
      " # root",
      "+added line",
      "",
    ].join("\n");

    const tool = createGitApplyTool(cwd, { gitPath: "/usr/bin/git" });
    const check = await tool.execute({ action: "check", patch }, ctx());
    assert.equal(check.error, undefined, textOf(check));

    const applied = await tool.execute({ action: "apply", patch }, ctx());
    assert.equal(applied.error, undefined, textOf(applied));
    assert.match(await readFile(join(cwd, "README.md"), "utf8"), /added line/);

    const reversed = await tool.execute({ action: "reverse", patch }, ctx());
    assert.equal(reversed.error, undefined, textOf(reversed));
    assert.equal(await readFile(join(cwd, "README.md"), "utf8"), before);

    const bad = await tool.execute(
      {
        action: "apply",
        patch: "diff --git a/missing.txt b/missing.txt\n--- a/missing.txt\n+++ b/missing.txt\n@@ -0,0 +1 @@\n+x\n",
      },
      ctx(),
    );
    assert.ok(bad.error);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("worktree add/list/remove within caps", async () => {
  const cwd = await initRepo();
  const wt = join(cwd, ".wt-feature");
  try {
    const ops = await createGitOperations({ cwd, gitPath: "/usr/bin/git", maxWorktrees: 4 });
    const added = await ops.worktree({ action: "add", path: wt, branch: "feature-x" });
    assert.ok(added.worktrees.some((w) => w.path === wt || w.path.endsWith(".wt-feature")));
    const listed = await ops.worktree({ action: "list" });
    assert.ok(listed.worktrees.length >= 2);
    await ops.worktree({ action: "remove", path: wt, force: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("PR handoff is bounded and never pushes", async () => {
  const cwd = await initRepo();
  try {
    run(cwd, ["checkout", "-b", "feature"]);
    await writeFile(join(cwd, "feat.txt"), "feat\n");
    run(cwd, ["add", "--", "feat.txt"]);
    run(cwd, ["commit", "-m", "feat"]);

    const artifacts: string[] = [];
    const tool = createGitPrHandoffTool(cwd, {
      gitPath: "/usr/bin/git",
      artifactWriter: async ({ kind, filename, bytes }) => {
        artifacts.push(kind);
        return {
          kind,
          uri: `memory://${filename}`,
          sha256: "abc",
          bytes: bytes.length,
        };
      },
    });
    const result = await tool.execute({ base: "main", checks: [{ name: "test", exitCode: 0, summary: "passed" }] }, ctx());
    assert.equal(result.error, undefined, textOf(result));
    const handoff = result.metadata as {
      base: string;
      head: string;
      changedPaths: string[];
      commits: unknown[];
      artifact?: { kind: string };
    };
    assert.ok(handoff.head);
    assert.ok(handoff.changedPaths.includes("feat.txt"));
    assert.equal(handoff.artifact?.kind, "patch");
    assert.deepEqual(artifacts, ["patch"]);
    assert.doesNotMatch(textOf(result), /\bpush\b/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createGitTools includes optional coding_check", async () => {
  const cwd = await initRepo();
  try {
    const tools = createGitTools(cwd, {
      gitPath: "/usr/bin/git",
      checks: {
        echo: { file: "/bin/echo", args: ["ok-check"] },
      },
    });
    const names = tools.map((t) => t.name);
    assert.deepEqual(
      names,
      [
        "git_status",
        "git_diff",
        "git_branch",
        "git_worktree",
        "git_apply",
        "git_commit",
        "git_pr_handoff",
        "coding_check",
      ],
    );
    const check = tools.find((t) => t.name === "coding_check")!;
    const result = await check.execute({ name: "echo" }, ctx());
    assert.equal(result.error, undefined, textOf(result));
    assert.match(textOf(result), /ok-check/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("coding_check rejects unknown names and non-absolute without PATH", async () => {
  const tool = createCodingCheckTool(process.cwd(), {
    checks: { bad: { file: "echo", args: ["x"] } },
  });
  const result = await tool.execute({ name: "bad" }, ctx());
  assert.ok(result.error);
  assert.match(textOf(result), /absolute/);

  const unknown = createCodingCheckTool(process.cwd(), {
    checks: { ok: { file: "/bin/true", args: [] } },
  });
  const miss = await unknown.execute({ name: "missing" }, ctx());
  assert.ok(miss.error);
});

test("fake runner proves no shell and safe config args", async () => {
  const calls: string[][] = [];
  const cwd = await initRepo();
  try {
    const ops = await createGitOperations({
      cwd,
      gitPath: "/usr/bin/git",
      runner: async (request) => {
        calls.push([...request.args]);
        // Delegate a minimal fake status for the first call.
        if (request.args[0] === "status") {
          const payload = ["# branch.oid deadbeef", "# branch.head main"].join("\0") + "\0";
          return {
            exitCode: 0,
            stdout: Buffer.from(payload),
            stderr: Buffer.alloc(0),
            timedOut: false,
            aborted: false,
            outputBytes: payload.length,
          };
        }
        return {
          exitCode: 0,
          stdout: Buffer.from("ok\n"),
          stderr: Buffer.alloc(0),
          timedOut: false,
          aborted: false,
          outputBytes: 3,
        };
      },
    });
    const status = await ops.status();
    assert.equal(status.branch.head, "main");
    assert.ok(calls[0]?.includes("status"));
    assert.ok(calls[0]?.includes("--porcelain=v2"));
    assert.ok(SAFE_GIT_CONFIG_ARGS.includes("-c"));
    assert.ok(SAFE_GIT_CONFIG_ARGS.includes("core.hooksPath=/dev/null"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("temp artifact writer produces sha256 file uri", async () => {
  const writer = createTempArtifactWriter();
  const ref = await writer({ kind: "patch", filename: "x.patch", bytes: Buffer.from("hi") });
  assert.match(ref.uri, /^file:\/\//);
  assert.equal(ref.bytes, 2);
  assert.equal(ref.sha256.length, 64);
});

test("GitError code is stable", () => {
  const error = new GitError("boom", 1);
  assert.equal(error.code, "ERR_PRISM_GIT");
  assert.equal(error.exitCode, 1);
});
