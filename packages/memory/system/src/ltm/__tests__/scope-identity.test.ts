import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseProjectFile, projectResourceId, renderProjectFile, resolveProjectIdentity } from "../scope/identity.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempDir(name = "identity"): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), "fabric-scope-")), name);
  await mkdir(dir, { recursive: true });
  dirs.push(join(dir, ".."));
  return dir;
}

async function gitRepo(dir: string, remote: string): Promise<void> {
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, ".git", "config"),
    `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
  );
}

function sha8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

describe("project identity (plan 188.2 Task 2)", () => {
  it("project_identity_from_remote_strips_credentials_and_normalises", async () => {
    const root = await tempDir("repo");
    await gitRepo(root, "https://user:token@GitHub.com/Org/Repo.git");
    const identity = resolveProjectIdentity(root);
    assert.equal(identity.source, "remote");
    assert.equal(identity.slug, "repo");
    assert.equal(identity.id8, sha8("github.com/Org/Repo"));
    assert.ok(identity.roots.includes(await realpath(root)));

    const file = renderProjectFile({
      resourceId: projectResourceId(identity),
      source: identity.source,
      roots: identity.roots,
    });
    // The identity source string is never written; the normalised remote holds no credentials either.
    assert.doesNotMatch(file, /token|user@|github\.com\/Org/i);
    assert.equal(parseProjectFile(file)?.source, "remote");
    assert.match(file, /type: "project"/);
  });

  it("worktree_resolves_to_same_project_id_and_adds_root", async () => {
    const main = await tempDir("main");
    await gitRepo(main, "git@github.com:Org/Repo.git");
    const worktree = await tempDir("worktree");
    const gitDir = join(main, ".git", "worktrees", "wt");
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, "commondir"), "../..\n");
    await writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`);

    const fromMain = resolveProjectIdentity(main);
    const fromWorktree = resolveProjectIdentity(worktree);
    assert.equal(fromWorktree.source, "remote");
    assert.equal(fromWorktree.id8, fromMain.id8, "a worktree shares the repository identity");
    assert.equal(fromWorktree.slug, fromMain.slug);
    assert.ok(fromWorktree.roots.includes(await realpath(worktree)));
    assert.ok(!fromWorktree.roots.includes(await realpath(main)), "the worktree root is not the main root");
  });

  it("moved_checkout_keeps_id_and_project_md_lists_both_roots", async () => {
    const first = await tempDir("one");
    const second = await tempDir("two");
    await gitRepo(first, "https://github.com/Org/Repo.git");
    await gitRepo(second, "https://github.com/Org/Repo.git");
    const a = resolveProjectIdentity(first);
    const b = resolveProjectIdentity(second);
    assert.equal(a.id8, b.id8, "a moved checkout keeps the project id");

    const one = renderProjectFile({ resourceId: projectResourceId(a), source: a.source, roots: a.roots });
    const both = renderProjectFile({ resourceId: projectResourceId(b), source: b.source, roots: b.roots }, one);
    const roots = parseProjectFile(both)?.roots ?? [];
    assert.ok(roots.includes(await realpath(first)));
    assert.ok(roots.includes(await realpath(second)));
    assert.equal(parseProjectFile(both)?.source, "remote");
  });

  it("non_git_root_uses_realpath_identity", async () => {
    const root = await tempDir("plain");
    const identity = resolveProjectIdentity(root);
    const real = await realpath(root);
    assert.equal(identity.source, "path");
    assert.equal(identity.slug, "plain");
    assert.equal(identity.id8, sha8(real));
    assert.deepEqual(identity.roots, [real]);
  });
});
