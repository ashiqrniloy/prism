import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PackageAPI, TrustPolicy } from "@arnilo/prism";
import { HARD_MAX_SKILL_INSTRUCTION_BYTES, isTrusted, parseSkillFile } from "@arnilo/prism";
import type { ContextFilesConfig } from "./config.js";

/** One configured skill root. Project roots pass the file trust policy; global roots are user-owned. */
export interface SkillRoot {
  readonly path: string;
  readonly origin: "project" | "global";
}

/**
 * Default skill roots in precedence order: project `.agents` then `.claude`, then the user-owned
 * equivalents under `globalRoot`. An explicit `skills.roots` replaces all defaults and is
 * root-relative unless absolute.
 */
export function planSkillRoots(
  config: ContextFilesConfig["skills"] | undefined,
  root: string,
  globalRoot: string | undefined,
): readonly SkillRoot[] {
  if (config?.enabled === false) return [];
  if (config?.roots !== undefined) {
    return config.roots.map((path) => ({ path: resolve(root, path), origin: "project" }));
  }
  const roots: SkillRoot[] = [
    { path: join(root, ".agents", "skills"), origin: "project" },
    { path: join(root, ".claude", "skills"), origin: "project" },
  ];
  if (globalRoot !== undefined) {
    roots.push(
      { path: join(globalRoot, ".agents", "skills"), origin: "global" },
      { path: join(globalRoot, ".claude", "skills"), origin: "global" },
      { path: join(globalRoot, ".codex", "skills"), origin: "global" },
    );
  }
  return roots;
}

/**
 * Scan the skill roots one level deep for `<name>/SKILL.md`, parse each, and register it through
 * `prism.skills.register`. Roots are de-duplicated by realpath and scanned in precedence order, so
 * the first root wins a duplicate name. A missing root is silent; a malformed, oversized, untrusted,
 * or conflicting skill is skipped with one status note and never fails setup.
 */
export async function registerDiscoveredSkills(
  prism: PackageAPI<ContextFilesConfig>,
  roots: readonly SkillRoot[],
  trust: TrustPolicy,
): Promise<void> {
  const seenRoots = new Set<string>();
  const seenSkills = new Map<string, string>();

  for (const root of roots) {
    let rootPath: string | undefined;
    try {
      rootPath = await resolveExisting(root.path);
    } catch (error) {
      prism.status.note("warn", `skipped skill root ${root.path}: ${errorMessage(error)}`);
      continue;
    }
    if (rootPath === undefined) continue;
    if (seenRoots.has(rootPath)) continue;
    seenRoots.add(rootPath);

    if (root.origin === "project" && !(await isTrusted(trust, { kind: "project", target: rootPath }))) {
      prism.status.note("warn", `skipped skill root ${root.path}: outside trusted roots`);
      continue;
    }

    let entries: readonly string[];
    try {
      entries = (await readdir(rootPath)).sort();
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT") && !isNodeErrorCode(error, "ENOTDIR")) {
        prism.status.note("warn", `skipped skill root ${root.path}: ${errorMessage(error)}`);
      }
      continue;
    }

    for (const name of entries) {
      const candidate = join(rootPath, name, "SKILL.md");
      try {
        const path = await realpath(candidate);
        if (root.origin === "project" && !(await isTrusted(trust, { kind: "project", target: path }))) {
          prism.status.note("warn", `skipped skill ${candidate}: outside trusted roots`);
          continue;
        }
        const info = await stat(path);
        if (!info.isFile()) continue;
        if (info.size > HARD_MAX_SKILL_INSTRUCTION_BYTES) {
          prism.status.note("warn", `skipped skill ${candidate}: file exceeds ${HARD_MAX_SKILL_INSTRUCTION_BYTES} bytes`);
          continue;
        }
        const text = await readFile(path, "utf8");
        if (Buffer.byteLength(text, "utf8") > HARD_MAX_SKILL_INSTRUCTION_BYTES) {
          prism.status.note("warn", `skipped skill ${candidate}: file exceeds ${HARD_MAX_SKILL_INSTRUCTION_BYTES} bytes`);
          continue;
        }
        const skill = parseSkillFile(text, path);
        const earlier = seenSkills.get(skill.name);
        if (earlier !== undefined) {
          prism.status.note("info", `skipped skill ${candidate}: ${skill.name} is already registered from ${earlier}`);
          continue;
        }
        try {
          prism.skills.register(skill);
        } catch (error) {
          prism.status.note("warn", `skipped skill ${candidate}: ${errorMessage(error)}`);
          continue;
        }
        seenSkills.set(skill.name, path);
      } catch (error) {
        if (!isNodeErrorCode(error, "ENOENT") && !isNodeErrorCode(error, "ENOTDIR")) {
          prism.status.note("warn", `skipped skill ${candidate}: ${errorMessage(error)}`);
        }
      }
    }
  }
}

async function resolveExisting(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT") || isNodeErrorCode(error, "ENOTDIR")) return undefined;
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
