/**
 * Plan 181 Task 1: a clean, frozen-lockfile install.
 *
 * `bun ci` froze the lockfile, but `bun install` rewrote it on every run, so a fresh
 * clone could never install. The cause was each workspace declaring the kernel
 * (`@arnilo/prism`) as `file:../../..` while the kernel is the workspace root: Bun
 * re-resolved that self-reference on every install and its frozen check always saw a
 * change. The root now links itself (`"@arnilo/prism": "file:."`), the per-package
 * `file:` deps and their `postinstall` symlink are gone, and this suite keeps it that
 * way: the committed lock must install frozen, and two plain installs must not move it.
 *
 * The installs run against a throwaway mirror of the manifests plus the lockfile, so a
 * non-idempotent install can never dirty the repository's own `bun.lock`.
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expandWorkspaceDirs, readManifest } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");

/** The manifests a `bun install` reads: root, every workspace, `bunfig.toml`, the lockfile. */
function mirrorTree() {
  const dir = mkdtempSync(join(tmpdir(), "prism-install-"));
  const root = readManifest(join(ROOT, "package.json"));
  for (const file of ["package.json", "bun.lock", "bunfig.toml"]) cpSync(join(ROOT, file), join(dir, file));
  for (const workspace of expandWorkspaceDirs(ROOT, root.workspaces)) {
    const target = join(dir, relative(ROOT, workspace));
    mkdirSync(target, { recursive: true });
    cpSync(join(workspace, "package.json"), join(target, "package.json"));
  }
  return dir;
}

function bunInstall(dir, args = []) {
  const result = spawnSync("bun", ["install", ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("clean frozen-lockfile install", () => {
  it("install_is_idempotent", () => {
    const dir = mirrorTree();
    try {
      // `bun ci`: the committed lock must be installable exactly as reviewed.
      const frozen = bunInstall(dir, ["--frozen-lockfile"]);
      expect(frozen.output, frozen.output).not.toContain("lockfile had changes");
      expect(frozen.status).toBe(0);

      // Two plain installs must leave the lock byte-identical; a non-idempotent
      // install rewrites it and fails the next `bun ci`.
      const first = readFileSync(join(dir, "bun.lock"), "utf8");
      const second = bunInstall(dir);
      expect(second.output, second.output).not.toContain("Saved lockfile");
      expect(second.status).toBe(0);
      expect(readFileSync(join(dir, "bun.lock"), "utf8")).toBe(first);

      const third = bunInstall(dir);
      expect(third.status).toBe(0);
      expect(readFileSync(join(dir, "bun.lock"), "utf8")).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no_ignore_scripts_workaround", () => {
    const files = [
      ...readdirSync(join(ROOT, ".github", "workflows")).map((name) => join(ROOT, ".github", "workflows", name)),
      ...readdirSync(join(ROOT, "docs"), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => join(entry.parentPath, entry.name)),
      join(ROOT, "README.md"),
      join(ROOT, "docs", "contributing.md"),
    ];
    const offenders = files.filter((file) => /bun\s+(ci|install)\b[^\n]*--ignore-scripts/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);

    // The manual symlink the `file:` deps needed is gone: no workspace may declare one.
    const root = readManifest(join(ROOT, "package.json"));
    const symlinkers = [ROOT, ...expandWorkspaceDirs(ROOT, root.workspaces)].filter((dir) =>
      /ln -s/.test(readManifest(join(dir, "package.json")).scripts?.postinstall ?? ""),
    );
    expect(symlinkers).toEqual([]);
  });
});
