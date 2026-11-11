/**
 * Stable project identity from file reads only (plan 188.2 Task 2).
 *
 * The git remote URL is preferred: it survives a moved checkout and is shared by every worktree.
 * Without one the real path of the git top level, then the real path of the root, is the identity.
 * Nothing here spawns a process; a packed-object root-commit read was dropped in Task 1 (d).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { MemoryValidationError } from "@arnilo/prism-memory-system/core";

export interface ProjectIdentity {
  /** First 8 hex characters of SHA-256 over the identity source string. */
  readonly id8: string;
  readonly slug: string;
  readonly source: "remote" | "path";
  /** Real paths this resolution saw: the git top level first when it differs from the root. */
  readonly roots: readonly string[];
}

const SLUG_CAP = 40;
const PROJECTS_PREFIX = "projects";

/** `projects/<slug>--<id8>`, the project resource id under the memory tenant. */
export function projectResourceId(identity: Pick<ProjectIdentity, "slug" | "id8">): string {
  return `${PROJECTS_PREFIX}/${identity.slug}--${identity.id8}`;
}

/** Lowercase hyphenated repository name, `[a-z0-9-]` only, at most 40 characters. */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_CAP)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "project";
}

/**
 * Normalise a git remote to `host/path`: scheme, credentials, a trailing `.git`, and a trailing
 * slash are dropped, and the host is lowercased. A scp-like `user@host:path` keeps its path.
 */
export function normalizeRemote(raw: string): string {
  const value = raw.trim();
  if (value.length === 0) throw new MemoryValidationError("git remote URL is empty");
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(value);
  if (!value.includes("://") && scp) {
    return `${scp[1]!.toLowerCase()}/${stripGit(scp[2]!)}`;
  }
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}/${stripGit(url.pathname.replace(/^\/+/, ""))}`;
  } catch {
    return stripGit(value);
  }
}

function stripGit(value: string): string {
  return value
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "");
}

function remoteName(normalized: string): string {
  return (
    normalized
      .split("/")
      .filter((part) => part.length > 0)
      .at(-1) ?? normalized
  );
}

function hashId(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 8);
}

/** `realpath` of the longest existing ancestor with the missing tail re-joined. */
function realPathNearestSync(target: string): string {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      tail.push(basename(current));
      current = parent;
    }
  }
}

/** The `.git` directory and the working directory it belongs to, following a worktree `.git` file. */
function findGitDir(start: string): { gitDir: string; top: string } | undefined {
  let current = start;
  for (;;) {
    const candidate = join(current, ".git");
    if (existsSync(candidate)) {
      if (statSync(candidate).isDirectory()) return { gitDir: candidate, top: current };
      const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(candidate, "utf8"));
      if (match) {
        const target = match[1]!.trim();
        return { gitDir: isAbsolute(target) ? target : resolve(current, target), top: current };
      }
      return undefined;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** The shared git directory: a worktree's `gitdir` points at `<common>/worktrees/<name>`. */
function commonDir(gitDir: string): string {
  const file = join(gitDir, "commondir");
  if (!existsSync(file)) return gitDir;
  const value = readFileSync(file, "utf8").trim();
  return value.length === 0 ? gitDir : isAbsolute(value) ? value : resolve(gitDir, value);
}

/** The `origin` remote url from a git config, else the first remote url; `[remote "x"]` sections only. */
export function remoteUrlFromConfig(config: string): string | undefined {
  const remotes: { name: string; url: string }[] = [];
  let section = "";
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]!.trim().toLowerCase();
      continue;
    }
    if (!section.startsWith("remote ")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq).trim().toLowerCase() !== "url") continue;
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    if (value.length > 0) remotes.push({ name: section.slice("remote ".length), url: value });
  }
  return (remotes.find((remote) => remote.name === '"origin"') ?? remotes[0])?.url;
}

function pathIdentity(identityPath: string, roots: readonly string[]): ProjectIdentity {
  return {
    source: "path",
    slug: projectSlug(basename(identityPath)),
    id8: hashId(identityPath),
    roots: unique(roots),
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** Resolve the stable project identity for `root`. Throws when the root does not exist. */
export function resolveProjectIdentity(root: string): ProjectIdentity {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new MemoryValidationError("project root must be a non-empty string");
  }
  const requested = resolve(root);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new MemoryValidationError(`project root is not a directory: ${requested}`);
  }
  const realRoot = realPathNearestSync(requested);
  const found = findGitDir(realRoot);
  if (!found) return pathIdentity(realRoot, [realRoot]);
  const top = realPathNearestSync(found.top);
  const roots = unique(top === realRoot ? [realRoot] : [top, realRoot]);
  const configFile = join(commonDir(found.gitDir), "config");
  let remote: string | undefined;
  try {
    remote = existsSync(configFile) ? remoteUrlFromConfig(readFileSync(configFile, "utf8")) : undefined;
  } catch {
    remote = undefined;
  }
  if (remote === undefined) return pathIdentity(top, roots);
  const normalized = normalizeRemote(remote);
  return { source: "remote", slug: projectSlug(remoteName(normalized)), id8: hashId(normalized), roots };
}

declare const Bun: {
  readonly YAML: { parse(text: string): unknown; stringify(value: unknown): string };
};

export interface ProjectFileSections {
  readonly source?: string;
  readonly roots: readonly string[];
}

/** Read `prism.source` and `prism.roots` from a `project.md`, or undefined when it is unreadable. */
export function parseProjectFile(content: string): ProjectFileSections | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(match[1]!);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const prism = (parsed as { prism?: unknown }).prism;
  if (prism === null || typeof prism !== "object" || Array.isArray(prism)) return undefined;
  const rawRoots = (prism as { roots?: unknown }).roots;
  const roots = Array.isArray(rawRoots) ? rawRoots.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  const source = (prism as { source?: unknown }).source;
  return { roots, ...(typeof source === "string" ? { source } : {}) };
}

/**
 * Render `project.md`, keeping every root an earlier resolution recorded. The identity source and
 * roots are safe to write: a remote URL is normalised and carries no credentials.
 */
export function renderProjectFile(
  identity: { readonly resourceId: string; readonly source: "remote" | "path"; readonly roots: readonly string[] },
  current?: string,
): string {
  const prior = current === undefined ? undefined : parseProjectFile(current);
  const roots = unique([...(prior?.roots ?? []), ...identity.roots]);
  const title = projectSlug(identity.resourceId.split("/").at(-1)?.split("--")[0] ?? identity.resourceId);
  const lines = [
    "---",
    `type: "project"`,
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(`Project identity for ${title}.`)}`,
    `prism: ${JSON.stringify({ id: identity.resourceId, source: identity.source, roots })}`,
    "---",
    "",
    `# ${title}`,
    "",
    `Identity source: \`${identity.source}\`. Roots seen: ${roots.map((root) => `\`${root}\``).join(", ")}.`,
    "",
    "A worktree or a moved checkout adds a root and keeps the id.",
  ];
  return `${lines.join("\n")}\n`;
}
