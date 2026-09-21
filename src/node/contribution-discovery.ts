import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isJsonObject } from "../config.js";
import type { ContributionFileKind, DiscoveredContribution, JsonObject, Skill } from "../contracts.js";
import { parseSkillFile } from "../contribution-parsing.js";
import type { ManifestContributionDeclaration, ManifestContributionKind } from "../manifests.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import { assertPermission } from "../security.js";
import { HARD_MAX_SKILL_INSTRUCTION_BYTES } from "../skill-disclosure.js";
import { isNodeErrorCode } from "./config.js";
import { isPathInsideReal } from "./trust.js";

export interface DiscoveryOptions {
  readonly kinds: readonly ContributionFileKind[];
  /** Workspace root. Scans `<root>/.agents/<kind>s/<name>/`. Gated by `trust`. */
  readonly workspaceRoot?: string;
  readonly permission?: PermissionPolicy;
  readonly trust?: TrustPolicy;
}

/**
 * Discover contributions on disk. Scans the workspace `.agents/` tree only;
 * no global root. One `readdir` per kind-root; no `import()`. Inert output —
 * executable behavior is host-owned.
 */
export async function discoverContributions(options: DiscoveryOptions): Promise<readonly DiscoveredContribution[]> {
  const kinds = options.kinds;
  const merged = new Map<string, DiscoveredContribution>();

  if (options.workspaceRoot) {
    for (const kind of kinds) {
      const entries = await scanKindRoot(options.workspaceRoot, kind, options);
      for (const c of entries) merged.set(`${c.kind}/${c.name}`, c);
    }
  }

  return [...merged.values()];
}

// ponytail: single-level named-subdir scan; nested layouts would need a recursive walk if added later.
async function scanKindRoot(
  root: string,
  kind: ContributionFileKind,
  options: DiscoveryOptions,
): Promise<readonly DiscoveredContribution[]> {
  const kindDir = join(root, ".agents", kindDirName(kind));

  if (options.trust) {
    const decision = await options.trust.check({ kind: "project", target: kindDir });
    if (!decision.trusted) return []; // untrusted workspace root: skip, no throw
  }

  let names: readonly string[];
  try {
    names = await readdir(kindDir);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return []; // missing kind root is normal
    throw error;
  }

  const out: DiscoveredContribution[] = [];
  for (const name of names) {
    const dir = join(kindDir, name);
    let isDir: boolean;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) continue;
      throw error;
    }
    if (!isDir) continue;
    // Symlinks escaping the kind root are excluded via realpath containment.
    if (!(await isPathInsideReal(kindDir, dir))) continue;

    await assertPermission(options.permission, { kind: "resource", action: "load", target: dir });
    const entry = await readEntry(dir, name, kind, "workspace");
    if (entry) out.push(entry);
  }
  return out;
}

async function readEntry(
  dir: string,
  fallbackName: string,
  kind: ContributionFileKind,
  origin: "global" | "workspace",
): Promise<DiscoveredContribution | undefined> {
  switch (kind) {
    case "skill":
      return readSkillEntry(dir, fallbackName, origin);
    default:
      // tool / context / instructions → manifest.json declaration
      return readManifestEntry(dir, fallbackName, kind, origin);
  }
}

async function readSkillEntry(
  dir: string,
  _fallbackName: string,
  origin: "global" | "workspace",
): Promise<DiscoveredContribution | undefined> {
  const path = join(dir, "SKILL.md");
  if (!(await isPathInsideReal(dir, path))) return undefined;
  const text = await readOptionalFile(path);
  if (text === undefined) return undefined;
  const skill = parseSkillFile(text, path);
  return { kind: "skill", name: skill.name, origin, path, skill };
}

async function readManifestEntry(
  dir: string,
  fallbackName: string,
  kind: ContributionFileKind,
  origin: "global" | "workspace",
): Promise<DiscoveredContribution | undefined> {
  const path = join(dir, "manifest.json");
  if (!(await isPathInsideReal(dir, path))) return undefined;
  const text = await readOptionalFile(path);
  if (text === undefined) return undefined;
  const declaration = parseManifestDeclaration(text, path, kind, fallbackName);
  return { kind, name: declaration.name, origin, path, declaration };
}

// ponytail: Phase 31 — exported so the system/project prompt file loader reuses this ENOENT-tolerant read.
export async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export interface LoadSkillDirectoryOptions {
  /** Per-file byte cap; defaults to `HARD_MAX_SKILL_INSTRUCTION_BYTES` (262 144). */
  readonly maxSkillBytes?: number;
}

/**
 * Load a host-supplied `<directory>/<name>/SKILL.md` tree (an upstream persona
 * or provider checkout) into inert {@link Skill} values. Bounded per file,
 * symlink-contained, and deterministic (sorted by directory name); nothing is
 * auto-activated — the host registers the result through `api.registerSkill` or
 * its own loader.
 *
 * Throws when `directory` is unreadable or a SKILL.md exceeds the cap. A
 * subdirectory without SKILL.md (or a symlink escaping `directory`) is skipped.
 */
export async function loadSkillDirectory(directory: string, options: LoadSkillDirectoryOptions = {}): Promise<readonly Skill[]> {
  const maxBytes = options.maxSkillBytes ?? HARD_MAX_SKILL_INSTRUCTION_BYTES;
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    throw new Error(`No readable skill directory at ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const skills: Skill[] = [];
  for (const name of [...names].sort()) {
    const dir = join(directory, name);
    let isDir: boolean;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) continue;
      throw error;
    }
    if (!isDir || !(await isPathInsideReal(directory, dir))) continue;

    const path = join(dir, "SKILL.md");
    if (!(await isPathInsideReal(directory, path))) continue;
    const text = await readOptionalFile(path);
    if (text === undefined) continue;
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Skill file ${path} exceeds ${maxBytes} byte cap`);
    }
    skills.push(parseSkillFile(text, path));
  }
  return skills;
}

// --- Internal helpers. ---
// ponytail: parseSkillFile/parseAgentFile live in ../contribution-parsing.ts (core, fs-free); this
// Node module owns directory walking + manifest.json parsing only.

function parseManifestDeclaration(
  text: string,
  path: string,
  dirKind: ContributionFileKind,
  fallbackName: string,
): ManifestContributionDeclaration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON manifest ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Manifest ${path} must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === "string" && obj.name.length > 0 ? obj.name : fallbackName;
  const declaration: ManifestContributionDeclaration = {
    kind: kindToManifestKind(dirKind),
    name,
    ...(typeof obj.module === "string" ? { module: obj.module } : {}),
    ...(typeof obj.exportName === "string" ? { exportName: obj.exportName } : {}),
    ...(typeof obj.resource === "string" ? { resource: obj.resource } : {}),
    ...(typeof obj.metadata === "object" && obj.metadata !== null && !Array.isArray(obj.metadata) && isJsonObject(obj.metadata)
      ? { metadata: obj.metadata as JsonObject }
      : {}),
  };
  return declaration;
}

function kindToManifestKind(kind: ContributionFileKind): ManifestContributionKind {
  switch (kind) {
    case "tool":
      return "tool";
    case "context":
      return "contextProvider";
    case "instructions":
      return "systemPromptContribution";
    case "skill":
      return "skill";
  }
}

// ponytail: Phase 29 fix — `${kind}s` produced `instructionss`/`contexts`; the documented layout is
// `.agents/{skills,tools,context,instructions}/` (instructions and context are already the right form).
function kindDirName(kind: ContributionFileKind): string {
  switch (kind) {
    case "skill":
      return "skills";
    case "tool":
      return "tools";
    case "context":
      return "context";
    case "instructions":
      return "instructions";
  }
}
