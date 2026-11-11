import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Agent, createAgent, definePackage } from "@arnilo/prism";

import { type GitRunner, runGitCli } from "../../agent/git-exec.js";
import type { CodingLifecycleEvent } from "../../agent/lifecycle-events.js";
import toolsCoding from "../../index.js";
import { WorkspaceServiceError } from "../errors.js";
import { createWorkspaceService } from "../service.js";

const execFileAsync = promisify(execFile);
const bases: string[] = [];

afterEach(async () => {
  while (bases.length > 0) await rm(bases.pop() as string, { recursive: true, force: true });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/git", [...args], {
    cwd,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

async function status(cwd: string): Promise<string> {
  return (await git(cwd, ["status", "--porcelain"])).trim();
}

interface Fixture {
  readonly repo: string;
  readonly worktreeRoot: string;
}

/** A repository with one commit on `main`, and a worktree root outside it. */
async function fixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "prism-workspace-"));
  bases.push(base);
  const repo = join(base, "repo");
  const worktreeRoot = join(base, "worktrees");
  await mkdir(repo, { recursive: true });
  await git(repo, ["init", "-q", "-b", "main", "."]);
  await git(repo, ["config", "user.name", "Prism Test"]);
  await git(repo, ["config", "user.email", "prism@test.local"]);
  await writeFile(join(repo, "a.txt"), "one\n");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-qm", "seed"]);
  return { repo, worktreeRoot };
}

async function service(fixture: Fixture, options: Partial<Parameters<typeof createWorkspaceService>[0]> = {}) {
  return await createWorkspaceService({ root: fixture.repo, worktreeRoot: fixture.worktreeRoot, ...options });
}

async function code(error: unknown): Promise<string> {
  assert.ok(error instanceof WorkspaceServiceError, `expected a WorkspaceServiceError, got ${String(error)}`);
  return error.code;
}

/** Load the package with a probe package that can read the `workspace` service afterwards. */
async function load(root: string, workspace: unknown): Promise<{ agent: Agent; service: () => unknown }> {
  let read: (() => unknown) | undefined;
  const probe = definePackage({
    name: "@prism-test/workspace-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup: ({ services }) => {
      read = () => services.consume("workspace");
    },
  });
  const agent = await createAgent({
    model: { provider: "mock", model: "m" },
    packages: [toolsCoding({ root, workspace } as never), probe()],
  });
  return { agent, service: () => read?.() };
}

describe("workspace service", () => {
  it("workspace_round_trip", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const seed = (await git(fx.repo, ["rev-parse", "HEAD"])).trim();

    const wt = await workspace.worktree.create();
    assert.equal(wt.base, seed, "the handle reports the commit the branch started at");
    assert.equal(wt.branch, `prism/${wt.path.split("/").pop()}`);

    await writeFile(join(wt.path, "a.txt"), "worktree\n");
    await writeFile(join(wt.path, "new.txt"), "new\n");
    const overlay = await workspace.excludeOverlay(wt.path, [
      { path: ".agents/hooks.json", content: "{}" },
      { path: ".agents/nested/extra.json", content: "[]" },
    ]);

    const { changes, truncated } = await workspace.diff(wt.path);
    assert.deepEqual(
      changes.map((change) => change.path).sort(),
      ["a.txt", "new.txt"],
      "the edit and the untracked file appear; overlay files do not",
    );
    assert.equal(truncated, false);
    assert.equal(changes.find((change) => change.path === "new.txt")?.change, "created");
    assert.equal(changes.find((change) => change.path === "a.txt")?.change, "modified");
    assert.equal(await readFile(join(fx.repo, "a.txt"), "utf8"), "one\n", "the main worktree is untouched");

    // Conflicting change on the same lines of `main`.
    await writeFile(join(fx.repo, "a.txt"), "main\n");
    await git(fx.repo, ["commit", "-qam", "main change"]);
    const mainBefore = (await git(fx.repo, ["rev-parse", "main"])).trim();
    const wtBefore = (await git(wt.path, ["rev-parse", "HEAD"])).trim();
    const wtStatusBefore = await status(wt.path);

    const merged = await workspace.merge(wt.path, { into: "main", commit: { message: "delegated change" } });
    assert.equal(merged.status, "conflict");
    assert.deepEqual(merged.status === "conflict" ? merged.files : [], ["a.txt"]);
    assert.equal((await git(fx.repo, ["rev-parse", "main"])).trim(), mainBefore, "the target ref did not move");
    assert.equal((await git(wt.path, ["rev-parse", "HEAD"])).trim(), wtBefore, "the worktree ref did not move");
    assert.equal(await status(fx.repo), "", "the target tree is unchanged");
    assert.equal(await status(wt.path), wtStatusBefore, "the worktree state is unchanged by the failed merge");
    assert.equal((await git(wt.path, ["diff"])).trim().length > 0, true, "the uncommitted edit survives");

    await overlay.dispose();
    await wt.dispose({ force: true });
    assert.equal(existsSync(wt.path), false, "the worktree is gone");
    const exclude = await readFile(join(fx.repo, ".git", "info", "exclude"), "utf8");
    assert.ok(!exclude.includes(".agents/hooks.json"), "the exclude block is gone");
    assert.ok(!exclude.includes("prism-overlay"), "no marked block survives");
  });

  it("worktree_handle_reports_the_parent_branch", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const onMain = await workspace.worktree.create();
    assert.equal(onMain.parentBranch, "main", "the main tree's checked-out branch is recorded");
    await git(fx.repo, ["checkout", "-q", "-b", "feature"]);
    const onFeature = await workspace.worktree.create();
    assert.equal(onFeature.parentBranch, "feature", "the branch at creation time, not at merge time");
    await onMain.dispose({ force: true });
    await onFeature.dispose({ force: true });
  });

  it("commit_records_pending_changes_on_the_branch", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const wt = await workspace.worktree.create({ sessionId: "s1" });
    await writeFile(join(wt.path, "new.txt"), "child work\n");
    await writeFile(join(wt.path, "a.txt"), "changed\n");

    const { commit } = await workspace.commit(wt.path, { message: "delegate(coder): write the file" });
    assert.equal((await git(wt.path, ["rev-parse", "HEAD"])).trim(), commit, "the branch advanced to the new commit");
    assert.equal((await git(wt.path, ["show", `${commit}:new.txt`])).trim(), "child work", "the untracked file is committed");
    assert.equal(await status(wt.path), "", "the worktree is clean afterwards");

    const again = await workspace.commit(wt.path, { message: "no change" });
    assert.equal(again.commit, commit, "an unchanged worktree creates no commit");
    await wt.dispose({ force: true });
  });

  it("worktree_changed_events_come_from_the_service", async () => {
    const fx = await fixture();
    const events: CodingLifecycleEvent[] = [];
    const workspace = await service(fx, { onEvent: (event) => void events.push(event) });

    const wt = await workspace.worktree.create();
    await wt.dispose();

    assert.deepEqual(
      events.map((event) => ({
        type: event.type,
        ...(event.type === "worktree_changed" ? { action: event.action, path: event.path } : {}),
      })),
      [
        { type: "worktree_changed", action: "add", path: wt.path },
        { type: "worktree_changed", action: "remove", path: wt.path },
      ],
    );
  });

  it("merge_clean_updates_target", async () => {
    const fx = await fixture();
    const workspace = await service(fx);

    // Not checked out: the target ref is advanced with a compare-and-swap.
    await git(fx.repo, ["branch", "release"]);
    const release = await workspace.worktree.create({ branch: "feat-release" });
    await writeFile(join(release.path, "b.txt"), "b\n");
    const clean = await workspace.merge(release.path, { into: "release", commit: { message: "add b" } });
    assert.equal(clean.status, "merged");
    if (clean.status !== "merged") throw new Error("unreachable");
    assert.equal((await git(fx.repo, ["rev-parse", "release"])).trim(), clean.commit);
    assert.equal((await git(fx.repo, ["show", "release:b.txt"])).trim(), "b");
    assert.equal(await status(fx.repo), "", "the checked-out main worktree is untouched");
    assert.equal((await git(fx.repo, ["rev-parse", "main"])).trim(), (await git(fx.repo, ["rev-parse", "release^"])).trim());

    // Checked out: the target worktree is fast-forwarded so its index and files stay consistent.
    const checkedOut = await workspace.worktree.create({ branch: "feat-main" });
    await writeFile(join(checkedOut.path, "c.txt"), "c\n");
    const ontoMain = await workspace.merge(checkedOut.path, { into: "main", commit: { message: "add c" } });
    assert.equal(ontoMain.status, "merged");
    if (ontoMain.status !== "merged") throw new Error("unreachable");
    assert.equal((await git(fx.repo, ["rev-parse", "main"])).trim(), ontoMain.commit);
    assert.equal(await readFile(join(fx.repo, "c.txt"), "utf8"), "c\n", "the checked-out target has the merged file");
    assert.equal(await status(fx.repo), "", "the checked-out target is clean after the merge");
  });

  it("merge_dirty_without_commit_fails", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const wt = await workspace.worktree.create();
    await writeFile(join(wt.path, "a.txt"), "dirty\n");
    const mainBefore = (await git(fx.repo, ["rev-parse", "main"])).trim();

    const error = await workspace.merge(wt.path, { into: "main" }).catch((thrown: unknown) => thrown);
    assert.equal(await code(error), "workspace_dirty");
    assert.equal((await git(fx.repo, ["rev-parse", "main"])).trim(), mainBefore, "the target ref did not move");
    await wt.dispose({ force: true });
  });

  it("merge_dirty_target_fails", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const wt = await workspace.worktree.create();
    await writeFile(join(fx.repo, "untracked.txt"), "x\n");

    const error = await workspace.merge(wt.path, { into: "main" }).catch((thrown: unknown) => thrown);
    assert.equal(await code(error), "workspace_dirty_target");
    await wt.dispose({ force: true });
  });

  it("diff_is_bounded", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const wt = await workspace.worktree.create();
    for (const name of ["b.txt", "c.txt", "d.txt"]) await writeFile(join(wt.path, name), "x\n");
    await writeFile(join(wt.path, "a.txt"), "changed\n");

    const capped = await workspace.diff(wt.path, { maxFiles: 2 });
    assert.equal(capped.changes.length, 2);
    assert.equal(capped.truncated, true, "the list was cut at maxFiles");

    const bytes = await workspace.diff(wt.path, { maxBytes: 4 });
    assert.equal(bytes.truncated, true, "a file over maxBytes is reported as truncated");
    const modified = bytes.changes.find((change) => change.path === "a.txt");
    assert.equal(modified?.diff, undefined, "an over-size file is listed with no diff");
    assert.ok(modified !== undefined, "the file is still listed");
    await wt.dispose({ force: true });
  });

  it("create_refuses_escape_and_limit", async () => {
    const fx = await fixture();
    const workspace = await service(fx, { maxWorktrees: 1 });
    const wt = await workspace.worktree.create();

    const escape = await workspace.excludeOverlay(wt.path, [{ path: "../escape.txt", content: "x" }]).catch((thrown: unknown) => thrown);
    assert.equal(await code(escape), "workspace_path_escape");
    const absolute = await workspace
      .excludeOverlay(wt.path, [{ path: "/tmp/escape.txt", content: "x" }])
      .catch((thrown: unknown) => thrown);
    assert.equal(await code(absolute), "workspace_path_escape");
    assert.equal(existsSync(join(fx.worktreeRoot, "escape.txt")), false, "nothing was written outside");

    const limit = await workspace.worktree.create().catch((thrown: unknown) => thrown);
    assert.equal(await code(limit), "workspace_limit");
    await wt.dispose({ force: true });
  });

  it("max_worktrees_above_default_is_honored_by_the_git_layer", async () => {
    const fx = await fixture();
    const workspace = await service(fx, { maxWorktrees: 6 });
    const made = [];
    for (let i = 0; i < 6; i += 1) made.push(await workspace.worktree.create());
    const over = await workspace.worktree.create().catch((thrown: unknown) => thrown);
    assert.equal(await code(over), "workspace_limit");
    for (const wt of made) await wt.dispose({ force: true });
  });

  it("main_worktree_is_immutable", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    for (const path of [fx.repo, join(fx.repo, "a.txt")]) {
      const error = await workspace.diff(path).catch((thrown: unknown) => thrown);
      assert.equal(await code(error), "workspace_main_immutable");
    }
    const unknown = await workspace.diff(join(fx.worktreeRoot, "ws-nope")).catch((thrown: unknown) => thrown);
    assert.equal(await code(unknown), "workspace_unknown");
  });

  it("dispose_refuses_dirty_without_force_and_is_idempotent", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const wt = await workspace.worktree.create();
    await writeFile(join(wt.path, "a.txt"), "dirty\n");

    const error = await wt.dispose().catch((thrown: unknown) => thrown);
    assert.equal(await code(error), "workspace_dirty");
    assert.equal(existsSync(wt.path), true, "the worktree survives a refused dispose");

    await wt.dispose({ force: true });
    assert.equal(existsSync(wt.path), false);
    await wt.dispose({ force: true });
    await wt.dispose();
    assert.equal(workspace.worktree.bound("s1"), undefined);
  });

  it("bound_worktree_is_looked_up_by_session_and_dropped_on_dispose", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const wt = await workspace.worktree.create({ sessionId: "s-1" });
    assert.equal(workspace.worktree.bound("s-1")?.path, wt.path);
    assert.equal(workspace.worktree.bound("s-2"), undefined);
    await wt.dispose({ force: true });
    assert.equal(workspace.worktree.bound("s-1"), undefined);
  });

  it("not_a_git_repo_is_a_status_note", async () => {
    const base = await mkdtemp(join(tmpdir(), "prism-workspace-plain-"));
    bases.push(base);
    const { agent, service: read } = await load(base, undefined);
    try {
      assert.equal(read(), undefined, "no service is provided outside a git repository");
      assert.ok(
        agent
          .inspect()
          .statusNotes.some(
            (note) => note.package === "@arnilo/prism-tools/coding" && note.message.includes("workspace service unavailable"),
          ),
        `expected a status note, got ${JSON.stringify(agent.inspect().statusNotes)}`,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("old_git_without_merge_tree_fails_closed", async () => {
    const fx = await fixture();
    const real: GitRunner = (request) => runGitCli(request);
    const stubbed: GitRunner = async (request) => {
      if (request.args[0] === "merge-tree") {
        return {
          exitCode: 129,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("error: unknown option `write-tree'"),
          timedOut: false,
          aborted: false,
          outputBytes: 0,
        };
      }
      return await real(request);
    };
    const workspace = await service(fx, { runner: stubbed });
    const wt = await workspace.worktree.create();

    const error = await workspace.merge(wt.path, { into: "main" }).catch((thrown: unknown) => thrown);
    assert.equal(await code(error), "workspace_git_unsupported");
    await wt.dispose({ force: true });
  });
});

describe("workspace service config", () => {
  it("workspace_config_rejects_unknown_keys_and_out_of_range_bounds", async () => {
    const base = await mkdtemp(join(tmpdir(), "prism-workspace-config-"));
    bases.push(base);
    for (const workspace of [{ nope: true }, { maxWorktrees: 99 }, { diff: { maxFiles: 0 } }, { worktreeRoot: "" }]) {
      const thrown = await load(base, workspace).catch((error: unknown) => error);
      assert.ok(thrown instanceof Error, `expected ${JSON.stringify(workspace)} to fail closed`);
    }
  });

  it("workspace_enabled_false_provides_no_service", async () => {
    const fx = await fixture();
    const { agent, service: read } = await load(fx.repo, { enabled: false });
    try {
      assert.equal(read(), undefined);
    } finally {
      await agent.dispose();
    }
  });

  it("workspace_is_provided_inside_a_git_repository", async () => {
    const fx = await fixture();
    const { agent, service: read } = await load(fx.repo, { worktreeRoot: fx.worktreeRoot });
    try {
      assert.ok(read() !== undefined, "the service is provided inside a git repository");
    } finally {
      await agent.dispose();
    }
  });

  it("workspace_rebind_adopts_a_worktree_a_dead_process_left_behind", async () => {
    const fx = await fixture();
    const first = await service(fx);
    const wt = await first.worktree.create({ sessionId: "s1" });
    await writeFile(join(wt.path, "kept.txt"), "kept\n");
    // A second service is a fresh process: it holds no binding.
    const second = await service(fx);
    assert.equal(second.worktree.bound("s1"), undefined);
    const again = await second.worktree.rebind({ path: wt.path, sessionId: "s1", branch: wt.branch });
    assert.equal(again.path, wt.path);
    assert.equal(again.branch, wt.branch);
    assert.equal(again.base, wt.base, "the base is the merge base when not recorded");
    assert.equal(second.worktree.bound("s1")?.path, wt.path);
    assert.equal((await second.worktree.rebind({ path: wt.path, sessionId: "s1" })).path, wt.path, "idempotent");
    assert.deepEqual(
      (await second.diff(wt.path)).changes.map((change) => change.path),
      ["kept.txt"],
    );
    assert.equal(await code(await second.worktree.rebind({ path: wt.path, sessionId: "other" }).catch((e) => e)), "workspace_unknown");
    await again.dispose({ force: true });
  });

  it("workspace_rebind_fails_closed", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const wt = await workspace.worktree.create();
    const fresh = await service(fx);
    const reject = async (request: Parameters<typeof fresh.worktree.rebind>[0]) =>
      await code(await fresh.worktree.rebind(request).catch((e) => e));
    assert.equal(await reject({ path: wt.path, sessionId: "s", branch: "not-this" }), "workspace_unknown");
    assert.equal(await reject({ path: fx.repo, sessionId: "s" }), "workspace_path_escape", "the main tree is never adopted");
    assert.equal(await reject({ path: join(fx.worktreeRoot, "ws-missing"), sessionId: "s" }), "workspace_unknown");
    // A worktree someone else made under the root, with no service lock, is not adopted.
    const foreign = join(fx.worktreeRoot, "foreign");
    await git(fx.repo, ["worktree", "add", "-q", "-b", "foreign", foreign]);
    assert.equal(await reject({ path: foreign, sessionId: "s" }), "workspace_unknown");
    await wt.dispose({ force: true });
    assert.equal(await reject({ path: wt.path, sessionId: "s" }), "workspace_unknown", "a disposed worktree is gone");
  });
});
