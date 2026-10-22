import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertIsolation, createRunDirectory, materializeSkills, type DriverDescriptor } from "../index.js";

const tmp = () => mkdtempSync(join(tmpdir(), "mat-"));
const registryOf = (skills: { name: string; path?: string; instructions?: string }[]) => ({
  get: (n: string) => skills.find((s) => s.name === n),
  list: () => skills,
});

describe("materializer", () => {
  it("run_directory_private_and_contained", async () => {
    const dir = await createRunDirectory(tmp(), "run-1");
    assert.equal(statSync(dir.path).mode & 0o777, 0o700);
    const file = await dir.writeFile("a/b.txt", "x");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    await assert.rejects(dir.writeFile("../escape", "x"), /profile_invalid/);
    await assert.rejects(dir.writeFile("/abs", "x"), /profile_invalid/);
    await dir.dispose();
    await dir.dispose();
    assert.equal(existsSync(dir.path), false);
  });

  it("overlay_writes_exclude_and_cleans_up", async () => {
    const wt = tmp();
    execFileSync("git", ["init", "-q"], { cwd: wt });
    const dir = await createRunDirectory(tmp(), "run-2");
    await dir.overlay(wt, [{ path: ".vendor/config.json", content: "{}" }]);
    await dir.overlay(wt, [{ path: ".vendor/config.json", content: "{}" }]);
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: wt }).toString(), "");
    const exclude = join(wt, ".git/info/exclude");
    assert.equal(readFileSync(exclude, "utf8").split("\n").filter((l) => l === "/.vendor/config.json").length, 1);
    await dir.dispose();
    assert.equal(existsSync(join(wt, ".vendor/config.json")), false);
    assert.ok(!readFileSync(exclude, "utf8").includes(".vendor/config.json"));
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: wt }).toString(), "");
  });

  it("materialize_skills_skill_dirs_layout_and_path_map", async () => {
    const src = tmp();
    mkdirSync(join(src, "res"));
    writeFileSync(join(src, "SKILL.md"), "# one");
    writeFileSync(join(src, "res/note.md"), "note");
    const dir = await createRunDirectory(tmp(), "run-3");
    const out = await materializeSkills(dir, registryOf([{ name: "one", path: join(src, "SKILL.md") }, { name: "two", instructions: "do it" }]), "all");
    assert.equal(readFileSync(join(out.root, "one/res/note.md"), "utf8"), "note");
    assert.match(readFileSync(out.pathToSkill.get("two") as string, "utf8"), /do it/);
    assert.equal(out.pathToSkill.size, 2);
    await dir.dispose();
  });

  it("materialize_skills_layout_callback_wraps", async () => {
    const dir = await createRunDirectory(tmp(), "run-4");
    const out = await materializeSkills(dir, registryOf([{ name: "one", instructions: "x" }]), ["one"], (o) => [
      { path: "plugin.json", content: JSON.stringify({ skills: o.root }) },
    ]);
    assert.equal(JSON.parse(readFileSync(join(dir.path, "plugin.json"), "utf8")).skills, out.root);
    await dir.dispose();
  });

  it("unknown_skill_fails", async () => {
    const dir = await createRunDirectory(tmp(), "run-5");
    await assert.rejects(materializeSkills(dir, registryOf([]), ["nope"]), /unknown_skill/);
    await dir.dispose();
  });

  it("workspace_files_strict_without_worktree_is_worktree_required", () => {
    const d = (isolation: "flags" | "workspace-files" | "none") => ({ controls: { isolation } }) as Pick<DriverDescriptor, "controls">;
    assert.throws(() => assertIsolation(d("workspace-files"), { isolation: "strict" }), /worktree_required/);
    assert.equal(assertIsolation(d("workspace-files"), { isolation: "inherit" }).isolation, "inherit");
    assert.equal(assertIsolation(d("workspace-files"), { worktree: "/w" }).mechanism, "workspace-files");
    assert.equal(assertIsolation(d("flags"), {}).isolation, "strict");
  });
});
