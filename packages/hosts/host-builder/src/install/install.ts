/**
 * `prism-host-builder install`: copies the `prism-host-builder` skill into a coding agent's project skill
 * directory and, on request, adds the MCP server to the agent's project configuration.
 *
 * Project scope only: every path is resolved through its symlinks and must stay inside `--root`; the user-global
 * agent directories are never touched. The skill copy is stamped with its version and content hash, so a later
 * install replaces it only while the files still match that stamp. The installer never runs a package manager and
 * never writes a secret (the MCP entry holds `command` and `args` only).
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { HostBuilderError } from "../errors.js";
import { INSTALL_TARGETS, type InstallTarget, type InstallTargetName, SERVER_ENTRY, SERVER_NAME, SKILL_NAME } from "./targets.js";

const PACKAGE_DIR = join(import.meta.dirname, "..", "..");
const SKILL_SOURCE = join(PACKAGE_DIR, "skills", SKILL_NAME);
const STAMP_FILE = ".prism-host-builder.json";
const PACKAGE_NAME = "@arnilo/prism-hosts/host-builder";

export interface InstallOptions {
  readonly target: InstallTargetName;
  /** The project root (an existing directory). Nothing outside it is written. */
  readonly root: string;
  /** Also add the MCP server to the target's project configuration (JSON), or print the snippet (TOML). */
  readonly mcp?: boolean;
  /** Overwrite a modified skill copy or a different `prism` server entry. */
  readonly force?: boolean;
  /** Compute and report the plan; write nothing. */
  readonly dryRun?: boolean;
}

export type SkillStatus = "installed" | "upgraded" | "unchanged" | "overwritten";
export type McpStatus = "added" | "unchanged" | "replaced" | "snippet";

export interface InstallResult {
  readonly target: InstallTargetName;
  readonly dryRun: boolean;
  readonly skill: {
    readonly status: SkillStatus;
    /** Project-relative directory of the copy. */
    readonly dir: string;
    readonly version: string;
    readonly files: number;
  };
  readonly mcp?: {
    readonly status: McpStatus;
    readonly file: string;
    /** The exact text to add by hand, for a configuration the installer does not write. */
    readonly snippet?: string;
  };
  /** Extra lines for the person: a printed config, a duplicate warning, a skipped step. */
  readonly notes: readonly string[];
}

interface Stamp {
  readonly package: string;
  readonly version: string;
  readonly contentHash: string;
  readonly files: readonly string[];
}

interface SkillFile {
  readonly path: string;
  readonly bytes: Buffer;
}

const fail = (code: HostBuilderError["code"], message: string): never => {
  throw new HostBuilderError(code, message);
};

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * The absolute path of `rel` under `rootReal` with every existing component resolved through symlinks. Each
 * resolved component must stay inside the root; a dangling link is refused, since a write would follow it.
 */
function containedPath(rootReal: string, rel: string): string {
  let current = rootReal;
  const parts = rel.split("/").filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    let next = join(current, parts[index] as string);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return join(next, ...parts.slice(index + 1));
    }
    if (stat.isSymbolicLink()) {
      try {
        next = realpathSync(next);
      } catch {
        return fail("ERR_PRISM_HOST_BUILDER_INSTALL_ROOT", `${rel} passes through a symbolic link that does not resolve`);
      }
    }
    if (!isInside(rootReal, next))
      return fail("ERR_PRISM_HOST_BUILDER_INSTALL_ROOT", `${rel} resolves outside the project root ${rootReal}`);
    current = next;
  }
  return current;
}

/** Regular files under `dir`, sorted, as project-relative POSIX paths; symbolic links and other entries are skipped. */
function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function hashFiles(files: readonly SkillFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.bytes.length));
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readSkillSource(): SkillFile[] {
  return listFiles(SKILL_SOURCE)
    .filter((path) => path !== STAMP_FILE)
    .map((path) => ({ path, bytes: readFileSync(join(SKILL_SOURCE, path)) }));
}

function packageVersion(): string {
  const parsed = JSON.parse(readFileSync(join(PACKAGE_DIR, "..", "package.json"), "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function readStamp(dir: string): Stamp | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, STAMP_FILE), "utf8")) as Partial<Stamp>;
    if (
      parsed.package === PACKAGE_NAME &&
      typeof parsed.version === "string" &&
      typeof parsed.contentHash === "string" &&
      Array.isArray(parsed.files) &&
      parsed.files.every((file) => typeof file === "string" && file !== "" && !file.startsWith("/") && !file.split("/").includes(".."))
    )
      return parsed as Stamp;
  } catch {
    // No stamp, or one that is not ours: the copy is treated as foreign.
  }
  return undefined;
}

/** The hash of the files a stamp lists, as they are on disk now. A missing or unreadable file never matches. */
function diskHash(dir: string, stamp: Stamp): string | undefined {
  const files: SkillFile[] = [];
  for (const path of stamp.files) {
    try {
      const file = join(dir, path);
      if (!lstatSync(file).isFile()) return undefined;
      files.push({ path, bytes: readFileSync(file) });
    } catch {
      return undefined;
    }
  }
  return hashFiles(files);
}

interface SkillPlan {
  readonly status: SkillStatus;
  readonly dir: string;
  readonly write: boolean;
  readonly stale: readonly string[];
}

function planSkill(dir: string, shown: string, files: readonly SkillFile[], hash: string, version: string, force: boolean): SkillPlan {
  const conflict = (why: string): never =>
    fail("ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT", `${shown} ${why}. Re-run with --force to overwrite it.`);
  if (!existsSync(dir)) return { status: "installed", dir, write: true, stale: [] };
  if (!statSync(dir).isDirectory()) return fail("ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT", `${shown} exists and is not a directory`);
  const stamp = readStamp(dir);
  if (stamp === undefined) {
    if (readdirSync(dir).length === 0) return { status: "installed", dir, write: true, stale: [] };
    if (!force) conflict("holds a skill this installer did not write");
    return { status: "overwritten", dir, write: true, stale: [] };
  }
  const modified = diskHash(dir, stamp) !== stamp.contentHash;
  const stale = stamp.files.filter((path) => !files.some((file) => file.path === path));
  if (stamp.version === version && stamp.contentHash === hash) {
    return modified && force ? { status: "overwritten", dir, write: true, stale } : { status: "unchanged", dir, write: false, stale: [] };
  }
  if (modified && !force) conflict(`was edited since version ${stamp.version} was installed`);
  return { status: modified ? "overwritten" : "upgraded", dir, write: true, stale };
}

function writeAtomic(file: string, text: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

function applySkill(plan: SkillPlan, files: readonly SkillFile[], stamp: Stamp): void {
  for (const path of plan.stale) rmSync(join(plan.dir, path), { force: true });
  for (const file of files) writeAtomic(join(plan.dir, file.path), file.bytes);
  writeAtomic(join(plan.dir, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ConfigPlan {
  readonly status: McpStatus;
  readonly file: string;
  readonly text?: string;
}

/** Re-serialises with the file's own indent, line ending and trailing newline. Comments are not JSON and are refused earlier. */
function render(value: Json, original: string | undefined): string {
  const indent = /^([ \t]+)"/m.exec(original ?? "")?.[1] ?? "  ";
  const eol = original?.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(value, null, indent).replaceAll("\n", eol);
  return original === undefined || /\r?\n$/.test(original) ? `${body}${eol}` : body;
}

function planJsonConfig(file: string, shown: string, key: string, force: boolean): ConfigPlan {
  const refuse = (why: string): never => fail("ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG", `${shown} ${why}; it was not changed`);
  let original: string | undefined;
  let root: Json = {};
  if (existsSync(file)) {
    original = readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(original.replace(/^﻿/, ""));
    } catch (error) {
      return refuse(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!isObject(parsed)) return refuse("does not hold a JSON object");
    root = parsed;
  }
  const servers = root[key];
  if (servers !== undefined && !isObject(servers)) return refuse(`has a "${key}" value that is not an object`);
  const existing = servers?.[SERVER_NAME];
  if (existing !== undefined && isDeepStrictEqual(existing, SERVER_ENTRY)) return { status: "unchanged", file };
  if (existing !== undefined && !force)
    return fail(
      "ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT",
      `${shown} already has a different "${SERVER_NAME}" server under "${key}". Re-run with --force to replace it.`,
    );
  const next: Json = { ...root, [key]: { ...(servers ?? {}), [SERVER_NAME]: { ...SERVER_ENTRY, args: [...SERVER_ENTRY.args] } } };
  const text = render(next, original);
  // Parse check after: the written text must read back as the original with only our entry changed.
  const back = JSON.parse(text.replace(/^﻿/, "")) as Json;
  const expected = structuredClone(root);
  expected[key] = { ...((expected[key] as Json | undefined) ?? {}), [SERVER_NAME]: { ...SERVER_ENTRY, args: [...SERVER_ENTRY.args] } };
  if (!isDeepStrictEqual(back, expected)) return refuse("could not be merged without changing other entries");
  return { status: existing === undefined ? "added" : "replaced", file, text };
}

/** The exact text for a TOML configuration the installer does not write. */
function tomlSnippet(target: InstallTarget): string {
  const config = target.config as NonNullable<InstallTarget["config"]>;
  return [
    `[${config.key}.${SERVER_NAME}]`,
    `command = "${SERVER_ENTRY.command}"`,
    `args = [${SERVER_ENTRY.args.map((arg) => `"${arg}"`).join(", ")}]`,
  ].join("\n");
}

/** What a Prism builder agent lists in code: the skill is found by `contextFiles`, the MCP server by `@arnilo/prism-extensions/mcp`. */
function prismSnippet(): string {
  return [
    'import contextFiles from "@arnilo/prism-extensions/context-files";',
    'import mcp from "@arnilo/prism-extensions/mcp";',
    "",
    "packages: [",
    "  contextFiles({ root: process.cwd() }), // discovers .agents/skills (and .claude/skills) by default",
    "  mcp({",
    "    servers: [",
    `      { id: "prism-host-builder", transport: "stdio", command: "${SERVER_ENTRY.command}", args: [${SERVER_ENTRY.args.map((arg) => `"${arg}"`).join(", ")}], allow: "stdio:${SERVER_ENTRY.command}" },`,
    "    ],",
    "  }),",
    "],",
  ].join("\n");
}

/** A sibling skill directory of another target that already holds a copy under a different real path. */
function duplicateNote(rootReal: string, own: string, target: InstallTarget): string | undefined {
  for (const other of Object.values(INSTALL_TARGETS)) {
    if (other.skillDir === target.skillDir) continue;
    try {
      const dir = containedPath(rootReal, `${other.skillDir}/${SKILL_NAME}`);
      if (dir !== own && readStamp(dir) !== undefined)
        return `${other.skillDir}/${SKILL_NAME} also holds a copy; an agent that reads both directories (Cursor) will list the skill twice. Keep one.`;
    } catch {
      // A sibling that does not resolve inside the root is not our business here.
    }
  }
  return undefined;
}

/**
 * Installs the skill (and, with `mcp`, the MCP server entry) for one target. Every conflict is detected before the
 * first write, so a refused install changes nothing. `dryRun` returns the same result without writing.
 */
export function installHostBuilder(options: InstallOptions): InstallResult {
  const target = INSTALL_TARGETS[options.target];
  if (target === undefined || !Object.hasOwn(INSTALL_TARGETS, options.target))
    throw new RangeError(`unknown install target "${String(options.target)}"`);
  const force = options.force === true;
  const dryRun = options.dryRun === true;
  let rootReal: string;
  try {
    rootReal = realpathSync(options.root);
    if (!statSync(rootReal).isDirectory()) throw new Error("not a directory");
  } catch {
    return fail("ERR_PRISM_HOST_BUILDER_INSTALL_ROOT", `${options.root} is not a directory`);
  }

  const files = readSkillSource();
  const hash = hashFiles(files);
  const version = packageVersion();
  const skillRel = `${target.skillDir}/${SKILL_NAME}`;
  const skill = planSkill(containedPath(rootReal, skillRel), skillRel, files, hash, version, force);
  const notes: string[] = [];

  let config: ConfigPlan | undefined;
  let snippet: string | undefined;
  if (options.target === "prism") {
    snippet = prismSnippet();
    notes.push("Add to the Prism builder agent's packages:", snippet);
  } else if (options.mcp === true) {
    if (target.config === undefined) {
      notes.push(`target "${options.target}" has no MCP configuration to write; use --target claude, cursor or codex for --mcp.`);
    } else if (target.config.format === "toml") {
      snippet = tomlSnippet(target);
      config = { status: "snippet", file: target.config.file };
      notes.push(
        `Add to ${target.config.file} (Codex reads project configuration only for a trusted project; the installer writes no TOML):`,
        snippet,
      );
    } else {
      config = planJsonConfig(containedPath(rootReal, target.config.file), target.config.file, target.config.key, force);
    }
  }
  const duplicate = duplicateNote(rootReal, skill.dir, target);
  if (duplicate !== undefined) notes.push(duplicate);

  if (!dryRun) {
    if (skill.write) applySkill(skill, files, { package: PACKAGE_NAME, version, contentHash: hash, files: files.map((file) => file.path) });
    if (config?.text !== undefined) writeAtomic(config.file, config.text);
  }

  return {
    target: options.target,
    dryRun,
    skill: { status: skill.status, dir: skillRel, version, files: files.length },
    ...(config === undefined
      ? {}
      : {
          mcp: {
            status: config.status,
            file: (target.config as NonNullable<InstallTarget["config"]>).file,
            ...(config.status === "snippet" && snippet !== undefined ? { snippet } : {}),
          },
        }),
    notes,
  };
}

/** The lines the CLI prints for a result. */
export function describeInstall(result: InstallResult): string[] {
  const lines: string[] = [];
  if (result.dryRun) lines.push("dry run: nothing was written");
  lines.push(`skill ${result.skill.status}: ${result.skill.dir} (version ${result.skill.version}, ${result.skill.files} files)`);
  if (result.mcp !== undefined && result.mcp.status !== "snippet")
    lines.push(`mcp ${result.mcp.status}: "${SERVER_NAME}" in ${result.mcp.file}`);
  lines.push(...result.notes);
  return lines;
}
