import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunDirectory, resolveGitExclude, writeExcludeBlock } from "../index.js";

const tmp = () => mkdtempSync(join(tmpdir(), "excl-"));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd }).toString();

/** A repo with one commit, so `git worktree add` has a HEAD to branch from. */
function repo(): string {
  const dir = tmp();
  git(dir, "init", "-q");
  git(dir, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "--allow-empty", "-qm", "init");
  return dir;
}

describe("git exclude", () => {
  it("overlay_on_linked_worktree_writes_common_exclude", async () => {
    const main = repo();
    const wt = join(tmp(), "wt");
    git(main, "worktree", "add", "-q", wt);
    assert.equal(await resolveGitExclude(wt), join(main, ".git", "info", "exclude"));
    const dir = await createRunDirectory(tmp(), "run-linked");
    await dir.overlay(wt, [{ path: ".vendor/config.json", content: "{}" }]);
    assert.equal(git(wt, "status", "--porcelain"), "");
    const exclude = join(main, ".git", "info", "exclude");
    assert.ok(readFileSync(exclude, "utf8").includes("/.vendor/config.json"));
    await dir.dispose();
    assert.ok(!readFileSync(exclude, "utf8").includes(".vendor/config.json"));
    assert.equal(git(wt, "status", "--porcelain"), "");
  });

  it("exclude_blocks_are_per_owner", async () => {
    const main = repo();
    const one = await createRunDirectory(tmp(), "run-one");
    const two = await createRunDirectory(tmp(), "run-two");
    await one.overlay(main, [{ path: ".vendor/config.json", content: "{}" }]);
    await two.overlay(main, [{ path: ".vendor/config.json", content: "{}" }]);
    await one.dispose();
    const exclude = readFileSync(join(main, ".git", "info", "exclude"), "utf8");
    assert.ok(exclude.includes("# prism-overlay run-two begin"));
    assert.ok(exclude.includes("/.vendor/config.json"));
    assert.ok(!exclude.includes("# prism-overlay run-one begin"));
    await two.dispose();
    assert.ok(!readFileSync(join(main, ".git", "info", "exclude"), "utf8").includes(".vendor/config.json"));
  });

  it("exclude_keeps_user_lines", async () => {
    const main = repo();
    const exclude = join(main, ".git", "info", "exclude");
    writeFileSync(exclude, "# mine\n/keep-me\n");
    const block = await writeExcludeBlock(main, "run-keep", ["/.vendor/config.json"]);
    assert.deepEqual(block.lines, ["/.vendor/config.json"]);
    assert.ok(readFileSync(exclude, "utf8").startsWith("# mine\n/keep-me\n"));
    await block.dispose();
    assert.equal(readFileSync(exclude, "utf8"), "# mine\n/keep-me\n");
  });

  it("git_file_pointing_outside_is_rejected", async () => {
    const wt = tmp();
    writeFileSync(join(wt, ".git"), "gitdir: /etc\n");
    await assert.rejects(resolveGitExclude(wt), /worktree_not_git/);
    const dir = await createRunDirectory(tmp(), "run-bad");
    await assert.rejects(dir.overlay(wt, [{ path: "x", content: "y" }]), /worktree_not_git/);
    assert.equal(existsSync(join(wt, "x")), false);
  });

  it("missing_git_directory_is_rejected", async () => {
    await assert.rejects(resolveGitExclude(tmp()), /worktree_not_git/);
  });
});
