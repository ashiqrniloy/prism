import * as nodeFs from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Skill, SkillRegistry } from "../contracts-core/agent.js";
import type { DriverDescriptor } from "./descriptor.js";
import { DriverError } from "./errors.js";
import { type ExcludeBlock, resolveGitExclude, writeExcludeBlock } from "./git-exclude.js";
import { isInside } from "./profiles.js";

/** The slice of `node:fs/promises` the materializer uses, injectable for tests. */
export type MaterializeFs = Pick<typeof nodeFs, "mkdir" | "readFile" | "writeFile" | "rm" | "readdir" | "lstat" | "chmod">;

export interface MaterializedFile {
  readonly path: string;
  readonly content: string;
}

export interface RunDirectory {
  readonly path: string;
  /** Writes a private file under the run directory; paths that escape it throw. */
  writeFile(rel: string, content: string): Promise<string>;
  /** Writes files into a worktree and lists each in `.git/info/exclude`. Removed on dispose. */
  overlay(worktree: string, files: readonly MaterializedFile[]): Promise<readonly string[]>;
  /** Removes overlay files, the exclude lines this run added, and the directory. Idempotent. */
  dispose(): Promise<void>;
}

export interface RunDirectoryOptions {
  readonly fs?: MaterializeFs;
}

const bad = (message: string): never => {
  throw new DriverError("profile_invalid", message);
};

/** Joins `rel` under `root`, rejecting absolute paths and `..`. A pure string check. */
function contain(root: string, rel: string): string {
  if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) bad("materialized paths must stay inside their root");
  const path = join(root, rel);
  if (!isInside(root, path)) bad("materialized paths must stay inside their root");
  return path;
}

/**
 * A private (`0700`) per-run directory at `<profileHome>/runs/<runId>`. Every path is built
 * from that directory or a worktree plus a validated relative name; nothing is symlinked.
 */
export async function createRunDirectory(profileRoot: string, runId: string, options: RunDirectoryOptions = {}): Promise<RunDirectory> {
  const fs = options.fs ?? nodeFs;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) bad("run ids are 1-128 characters of letters, digits, '.', '_' or '-'");
  const root = resolve(profileRoot, "runs", runId);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700);
  const overlays: { worktree: string; files: string[]; exclude?: ExcludeBlock }[] = [];
  let disposed = false;

  const writeAt = async (path: string, content: string): Promise<void> => {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, content, { mode: 0o600 });
  };

  return {
    path: root,
    async writeFile(rel, content) {
      const path = contain(root, rel);
      await writeAt(path, content);
      return path;
    },
    async overlay(worktree, files) {
      const wt = resolve(worktree);
      // Validate the exclude location before writing anything, so a `.git` pointing elsewhere fails closed.
      await resolveGitExclude(wt, { fs });
      const record: { worktree: string; files: string[]; exclude?: ExcludeBlock } = { worktree: wt, files: [] };
      overlays.push(record);
      const lines: string[] = [];
      for (const file of files) {
        const path = contain(wt, file.path);
        await writeAt(path, file.content);
        record.files.push(path);
        lines.push(`/${relative(wt, path).split("\\").join("/")}`);
      }
      if (lines.length > 0) record.exclude = await writeExcludeBlock(wt, runId, lines, { fs });
      return record.files;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of overlays.reverse()) {
        for (const file of record.files) await fs.rm(file, { force: true });
        await record.exclude?.dispose();
      }
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** Fails closed when strict isolation needs a worktree the run does not have. */
export function assertIsolation(
  descriptor: Pick<DriverDescriptor, "controls">,
  run: { readonly isolation?: "strict" | "inherit"; readonly worktree?: string },
): { readonly isolation: "strict" | "inherit"; readonly mechanism: DriverDescriptor["controls"]["isolation"] } {
  const isolation = run.isolation ?? "strict";
  const mechanism = descriptor.controls.isolation;
  if (isolation === "strict" && mechanism === "workspace-files" && run.worktree === undefined) {
    throw new DriverError("worktree_required", "strict isolation with a workspace-files driver needs a worktree", "isolation");
  }
  return { isolation, mechanism };
}

export interface MaterializedSkills {
  /** Directory holding one `<name>/SKILL.md` per selected skill. */
  readonly root: string;
  readonly pathToSkill: Map<string, string>;
  /** Extra files the layout callback returned, as written. */
  readonly extra: readonly string[];
}

export type SkillLayout = (out: {
  root: string;
  pathToSkill: ReadonlyMap<string, string>;
}) => readonly MaterializedFile[] | Promise<readonly MaterializedFile[]>;

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_FILES = 256;

async function copyTree(fs: MaterializeFs, from: string, to: RunDirectory, rel: string, budget: { n: number }): Promise<void> {
  for (const entry of (await fs.readdir(from, { withFileTypes: true })) as import("node:fs").Dirent[]) {
    // Content is copied, never linked; links and special files are skipped.
    if (entry.isSymbolicLink()) continue;
    const src = join(from, entry.name);
    const dest = `${rel}/${entry.name}`;
    if (entry.isDirectory()) await copyTree(fs, src, to, dest, budget);
    else if (entry.isFile()) {
      if (++budget.n > MAX_FILES) bad("a skill has too many resource files");
      await to.writeFile(dest, (await fs.readFile(src, "utf8")) as string);
    }
  }
}

/**
 * Writes the selected skills in the neutral `skill-dirs` layout under the run directory.
 * `selection` is `"all"` or skill names; an unknown name fails with `unknown_skill`.
 */
export async function materializeSkills(
  dir: RunDirectory,
  registry: Pick<SkillRegistry, "get" | "list">,
  selection: "all" | readonly string[],
  layout?: SkillLayout,
  options: RunDirectoryOptions = {},
): Promise<MaterializedSkills> {
  const fs = options.fs ?? nodeFs;
  const skills: Skill[] = [];
  if (selection === "all") skills.push(...registry.list());
  else {
    for (const name of selection) {
      const skill = registry.get(name);
      if (skill === undefined) throw new DriverError("unknown_skill", `skill "${name}" is not registered`);
      skills.push(skill);
    }
  }
  const pathToSkill = new Map<string, string>();
  for (const skill of skills) {
    if (!SKILL_NAME.test(skill.name)) bad("skill names are 1-64 characters of letters, digits, '.', '_' or '-'");
    const base = `skills/${skill.name}`;
    if (skill.path !== undefined) {
      const budget = { n: 0 };
      await copyTree(fs, dirname(skill.path), dir, base, budget);
    } else {
      const header = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description ?? "")}\n---\n\n`;
      await dir.writeFile(`${base}/SKILL.md`, `${header}${skill.instructions ?? ""}\n`);
    }
    pathToSkill.set(skill.name, join(dir.path, base, "SKILL.md"));
  }
  const root = join(dir.path, "skills");
  const extra: string[] = [];
  if (layout !== undefined) {
    for (const file of await layout({ root, pathToSkill })) extra.push(await dir.writeFile(file.path, file.content));
  }
  return { root, pathToSkill, extra };
}
