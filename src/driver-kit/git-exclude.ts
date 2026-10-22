import * as nodeFs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DriverError } from "./errors.js";

/** The slice of `node:fs/promises` the exclude helper uses, injectable for tests. */
export type GitExcludeFs = Pick<typeof nodeFs, "readFile" | "writeFile" | "mkdir" | "lstat">;

/** One owner's marked block in a worktree's `info/exclude`. */
export interface ExcludeBlock {
  /** The exclude file the block lives in. For a linked worktree this is the git common directory. */
  readonly path: string;
  /** The lines this owner wrote. */
  readonly lines: readonly string[];
  /** Removes this owner's block and nothing else. Idempotent. */
  dispose(): Promise<void>;
}

const OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const notGit = (): never => {
  throw new DriverError("worktree_not_git", "the worktree has no git directory");
};

const begin = (id: string): string => `# prism-overlay ${id} begin`;
const end = (id: string): string => `# prism-overlay ${id} end`;

/**
 * The `info/exclude` path git reads for `worktree`. A main worktree uses its own
 * `<worktree>/.git/info/exclude`; a linked worktree's `.git` is a file naming a per-worktree git
 * directory whose `commondir` names the git common directory — the file git actually reads is
 * `<commondir>/info/exclude`, outside the worktree. That is expected, not an escape.
 */
export async function resolveGitExclude(worktree: string, options: { fs?: GitExcludeFs } = {}): Promise<string> {
  const fs = options.fs ?? nodeFs;
  const dotGit = join(resolve(worktree), ".git");
  const stat = await fs.lstat(dotGit).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") notGit();
    throw error;
  });
  if (stat.isDirectory()) return join(dotGit, "info", "exclude");
  if (!stat.isFile()) notGit();
  const gitdir = /^\s*gitdir:\s*(.+?)\s*$/m.exec((await fs.readFile(dotGit, "utf8")) as string)?.[1] ?? notGit();
  const gitDir = resolve(dirname(dotGit), gitdir);
  await assertGitDir(fs, gitDir);
  try {
    const common = resolve(gitDir, ((await fs.readFile(join(gitDir, "commondir"), "utf8")) as string).trim());
    await assertGitDir(fs, common);
    return join(common, "info", "exclude");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return join(gitDir, "info", "exclude");
}

/** A git directory carries `HEAD`; a `.git` file pointing at `/etc` or the like fails closed. */
async function assertGitDir(fs: GitExcludeFs, dir: string): Promise<void> {
  const stat = await fs.lstat(dir).catch(() => notGit());
  if (!stat.isDirectory()) notGit();
  await fs.lstat(join(dir, "HEAD")).catch(() => notGit());
}

/** Splits into lines and drops trailing blanks, so a rewrite is stable. */
async function readLines(fs: GitExcludeFs, path: string): Promise<string[]> {
  let text: string;
  try {
    text = (await fs.readFile(path, "utf8")) as string;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

async function writeLines(fs: GitExcludeFs, path: string, lines: readonly string[]): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.writeFile(path, lines.length === 0 ? "" : `${lines.join("\n")}\n`, { mode: 0o644 });
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const out = [...a];
  const have = new Set(a);
  for (const line of b) {
    if (!have.has(line)) {
      have.add(line);
      out.push(line);
    }
  }
  return out;
}

function blockBounds(lines: readonly string[], id: string): { from: number; to: number; innerTo: number } | undefined {
  const from = lines.indexOf(begin(id));
  if (from === -1) return undefined;
  const at = lines.indexOf(end(id), from + 1);
  // A truncated block (no end marker, for example after a crash) owns the rest of the file.
  return at === -1 ? { from, to: lines.length, innerTo: lines.length } : { from, to: at + 1, innerTo: at };
}

/**
 * Writes `paths` as one marked block owned by `id`, unioning with an existing block for the same
 * owner so repeated calls do not duplicate lines. The returned `dispose` removes only that block;
 * lines inside another owner's block and unmarked user lines are never touched.
 */
export async function writeExcludeBlock(
  worktree: string,
  id: string,
  paths: readonly string[],
  options: { fs?: GitExcludeFs } = {},
): Promise<ExcludeBlock> {
  const fs = options.fs ?? nodeFs;
  if (!OWNER_ID.test(id)) throw new DriverError("profile_invalid", "overlay ids are 1-128 characters of letters, digits, '.', '_' or '-'");
  for (const line of paths) {
    if (line.includes("\n") || line.includes("\r")) throw new DriverError("profile_invalid", "exclude lines must be single lines");
  }
  const path = await resolveGitExclude(worktree, options);
  const lines = await readLines(fs, path);
  const bounds = blockBounds(lines, id);
  const existing = bounds === undefined ? [] : lines.slice(bounds.from + 1, bounds.innerTo);
  const merged = union(existing, paths);
  if (bounds === undefined) lines.push(begin(id), ...merged, end(id));
  else lines.splice(bounds.from, bounds.to - bounds.from, begin(id), ...merged, end(id));
  await writeLines(fs, path, lines);
  return {
    path,
    lines: merged,
    async dispose() {
      const current = await readLines(fs, path);
      const at = blockBounds(current, id);
      if (at === undefined) return;
      current.splice(at.from, at.to - at.from);
      await writeLines(fs, path, current);
    },
  };
}
