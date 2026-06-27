import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ContributionFileKind,
  DiscoveredContribution,
  JsonObject,
} from "../contracts.js";
import type { ManifestContributionDeclaration, ManifestContributionKind } from "../manifests.js";
import { isJsonObject } from "../config.js";
import type { PermissionPolicy } from "../security.js";
import { assertPermission } from "../security.js";
import type { TrustPolicy } from "../security.js";
import { isPathInsideReal } from "./trust.js";
import { parseAgentFile, parseSkillFile } from "../contribution-parsing.js";

export interface DiscoveryOptions {
  readonly kinds: readonly ContributionFileKind[];
  /** Workspace root. Scans `<root>/.agent/<kind>s/<name>/`. Gated by `trust`. */
  readonly workspaceRoot?: string;
  /** Global root. Scans `<root>/.prism/agent/<kind>s/<name>/`. Opt-in: scanned
   *  only when explicitly passed (the host/CLI passes homedir() when
   *  `--discover-global` is set). Core never auto-touches `~/.prism`. */
  readonly globalRoot?: string;
  readonly permission?: PermissionPolicy;
  readonly trust?: TrustPolicy;
}

/**
 * Discover contributions on disk. One `readdir` per kind-root per origin; no
 * `import()`. Merge order: global first, workspace overrides same `(kind, name)`.
 * Inert output — executable behavior is host-owned (Task 5 registers; Phase 33
 * resolves agents). */
export async function discoverContributions(
  options: DiscoveryOptions,
): Promise<readonly DiscoveredContribution[]> {
  const kinds = options.kinds;
  const merged = new Map<string, DiscoveredContribution>();

  // ponytail: merge = global then workspace, workspace wins on (kind,name) collision. Per-namespace overrides are YAGNI until collisions bite.
  // Global is opt-in: only scanned when `globalRoot` is explicitly passed. The CLI passes homedir()
  // only when --discover-global is set — core never auto-touches ~/.prism (no hidden auto-load).
  if (options.globalRoot) {
    for (const kind of kinds) {
      const globalEntries = await scanKindRoot(options.globalRoot, kind, "global", options, false);
      for (const c of globalEntries) merged.set(`${c.kind}/${c.name}`, c);
    }
  }
  if (options.workspaceRoot) {
    for (const kind of kinds) {
      const workspaceEntries = await scanKindRoot(options.workspaceRoot, kind, "workspace", options, true);
      for (const c of workspaceEntries) merged.set(`${c.kind}/${c.name}`, c);
    }
  }

  return [...merged.values()];
}

// ponytail: single-level named-subdir scan; nested layouts would need a recursive walk if added later.
async function scanKindRoot(
  root: string,
  kind: ContributionFileKind,
  origin: "global" | "workspace",
  options: DiscoveryOptions,
  isWorkspace: boolean,
): Promise<readonly DiscoveredContribution[]> {
  const kindDir = origin === "workspace" ? join(root, ".agent", kindDirName(kind)) : join(root, ".prism", "agent", kindDirName(kind));

  if (isWorkspace && options.trust) {
    const decision = await options.trust.check({ kind: "project", target: kindDir });
    if (!decision.trusted) return []; // untrusted workspace root: skip, no throw
  }

  let names: readonly string[];
  try {
    names = await readdir(kindDir);
  } catch (error) {
    if (isMissingFile(error)) return []; // missing kind root is normal
    throw error;
  }

  const out: DiscoveredContribution[] = [];
  for (const name of names) {
    const dir = join(kindDir, name);
    let isDir: boolean;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }
    if (!isDir) continue;
    // Symlinks escaping the kind root are excluded via realpath containment.
    if (isWorkspace && !(await isPathInsideReal(kindDir, dir))) continue;

    await assertPermission(options.permission, { kind: "resource", action: "load", target: dir });
    const entry = await readEntry(dir, name, kind, origin);
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
    case "agent":
      return readAgentEntry(dir, fallbackName, origin);
    default:
      // tool / context / instructions → manifest.json declaration
      return readManifestEntry(dir, fallbackName, kind, origin);
  }
}

async function readSkillEntry(
  dir: string,
  fallbackName: string,
  origin: "global" | "workspace",
): Promise<DiscoveredContribution | undefined> {
  const path = join(dir, "SKILL.md");
  const text = await readOptionalFile(path);
  if (text === undefined) return undefined;
  const skill = parseSkillFile(text, path);
  return { kind: "skill", name: skill.name, origin, path, skill };
}

async function readAgentEntry(
  dir: string,
  fallbackName: string,
  origin: "global" | "workspace",
): Promise<DiscoveredContribution | undefined> {
  const path = join(dir, "AGENT.md");
  const text = await readOptionalFile(path);
  if (text === undefined) return undefined;
  const declaration = parseAgentFile(text, path);
  return { kind: "agent", name: declaration.name, origin, path, declaration };
}

async function readManifestEntry(
  dir: string,
  fallbackName: string,
  kind: ContributionFileKind,
  origin: "global" | "workspace",
): Promise<DiscoveredContribution | undefined> {
  const path = join(dir, "manifest.json");
  const text = await readOptionalFile(path);
  if (text === undefined) return undefined;
  const declaration = parseManifestDeclaration(text, path, kind, fallbackName);
  return { kind, name: declaration.name, origin, path, declaration };
}

// ponytail: Phase 31 — exported so the system/project prompt file loader reuses the scanner's
// ENOENT-tolerant read instead of duplicating it. isMissingFile stays private (only readOptionalFile needs it).
export async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

// --- Internal helpers. ---
// ponytail: parseSkillFile/parseAgentFile live in ../contribution-parsing.ts (core, fs-free); this
// Node module owns directory walking + manifest.json parsing only.

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
}

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
    case "agent":
      return "agent";
    case "skill":
      return "skill";
  }
}

// ponytail: Phase 29 fix — `${kind}s` produced `instructionss`/`contexts`; the documented layout is
// `.agent/{skills,tools,context,instructions,agents}/` (instructions and context are already the right form).
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
    case "agent":
      return "agents";
  }
}


