import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { type CommandDefinition, parseSkillFile, type Skill } from "@arnilo/prism";
import type { DiscoveryRoot } from "@arnilo/prism/node/contribution-discovery";
import type { PrismCodeConfig } from "./config.js";
import { resolvePrismHome } from "./home.js";

/** Find git repository root by walking upward from cwd; fallback to cwd. */
export function findRepoRoot(cwd: string): string {
  let curr = resolve(cwd);
  while (true) {
    if (existsSync(join(curr, ".git"))) {
      return curr;
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return resolve(cwd);
}

/** Check if directory is owned by the current process UID (non-throwing, fails closed). */
export function isUserOwned(dir: string): boolean {
  if (process.platform === "win32" || typeof process.getuid !== "function") return true;
  try {
    if (!existsSync(dir)) return true;
    const entry = lstatSync(dir);
    const target = entry.isSymbolicLink() ? realpathSync(dir) : dir;
    return statSync(target).uid === process.getuid();
  } catch {
    return false;
  }
}

/**
 * Resolve skill discovery roots in increasing precedence:
 * 1. ~/.agents/agent/skills (global)
 * 2. ~/.prism/agent/skills (global, PRISM_HOME honored)
 * 3. each skills.dirs entry (workspace/config)
 * 4. <repo>/.agents/skills (workspace compat root, default on unless config.skills.compat === false)
 * 5. <repo>/.agents/agent/skills (workspace)
 *
 * <repo> is the git root of cwd (fallback cwd).
 */
export function resolveSkillRoots(
  config: PrismCodeConfig,
  home: string = resolvePrismHome(),
  repoRoot: string = findRepoRoot(config.cwd),
  agentsHome: string = homedir(),
): readonly DiscoveryRoot[] {
  const roots: DiscoveryRoot[] = [];

  // 1. ~/.agents/agent/skills
  const agentsGlobal = join(agentsHome, ".agents", "agent", "skills");
  if (isUserOwned(agentsGlobal)) {
    roots.push({ dir: agentsGlobal, origin: "global", layout: "flat" });
  }

  // 2. ~/.prism/agent/skills
  const prismGlobal = join(home, "agent", "skills");
  if (isUserOwned(prismGlobal)) {
    roots.push({ dir: prismGlobal, origin: "global", layout: "flat" });
  }

  // 3. each skills.dirs entry
  if (config.skills?.dirs) {
    for (const dir of config.skills.dirs) {
      const resolved = isAbsolute(dir) ? dir : resolve(config.cwd, dir);
      roots.push({ dir: resolved, origin: "workspace", layout: "flat" });
    }
  }

  // 4. <repo>/.agents/skills (compat root, default on unless config.skills.compat is explicitly false)
  if (config.skills?.compat !== false) {
    roots.push({ dir: join(repoRoot, ".agents", "skills"), origin: "workspace", layout: "flat" });
  }

  // 5. <repo>/.agents/agent/skills
  roots.push({ dir: join(repoRoot, ".agents", "agent", "skills"), origin: "workspace", layout: "flat" });

  return roots;
}

export type SkillOrigin = "project" | "prism" | "agents" | "config" | "wiki";

export interface SkillDetail {
  readonly name: string;
  readonly origin: SkillOrigin;
  readonly path?: string;
  readonly description?: string;
  readonly loaded: boolean;
  readonly shadowedOrigins?: readonly SkillOrigin[];
}

export interface InspectSkillsOptions {
  readonly activeSkills?: readonly Skill[];
  readonly loadedSkillNames?: readonly string[];
  readonly home?: string;
  readonly repoRoot?: string;
  readonly agentsHome?: string;
}

/**
 * Inspect discovered skills across all configured layers, resolving collisions
 * and reporting layer origins, loaded states, and shadowed layers.
 */
export async function inspectSkills(config: PrismCodeConfig, options?: InspectSkillsOptions): Promise<readonly SkillDetail[]> {
  const home = options?.home ?? resolvePrismHome();
  const repoRoot = options?.repoRoot ?? findRepoRoot(config.cwd);
  const agentsHome = options?.agentsHome ?? homedir();
  const roots = resolveSkillRoots(config, home, repoRoot, agentsHome);
  const excludeSet = new Set(config.skills?.exclude ?? []);
  const loadedSet = new Set(options?.loadedSkillNames ?? []);

  const agentsGlobal = join(agentsHome, ".agents", "agent", "skills");
  const prismGlobal = join(home, "agent", "skills");
  const configDirs = (config.skills?.dirs ?? []).map((d) => (isAbsolute(d) ? d : resolve(config.cwd, d)));

  type LayerEntry = {
    readonly origin: SkillOrigin;
    readonly path: string;
    readonly description?: string;
  };
  const layersBySkill = new Map<string, LayerEntry[]>();

  for (const root of roots) {
    let origin: SkillOrigin;
    if (root.dir === agentsGlobal) {
      origin = "agents";
    } else if (root.dir === prismGlobal) {
      origin = "prism";
    } else if (configDirs.includes(root.dir)) {
      origin = "config";
    } else {
      origin = "project";
    }

    if (!existsSync(root.dir)) continue;

    let entries: string[];
    try {
      entries = await readdir(root.dir);
    } catch {
      continue;
    }

    for (const name of entries.sort()) {
      if (excludeSet.has(name)) continue;
      const skillFile = join(root.dir, name, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      let text: string;
      try {
        text = await readFile(skillFile, "utf8");
      } catch {
        continue;
      }

      let parsedSkill: Skill;
      try {
        parsedSkill = parseSkillFile(text, skillFile);
      } catch {
        continue;
      }

      const existing = layersBySkill.get(parsedSkill.name) ?? [];
      existing.push({ origin, path: skillFile, description: parsedSkill.description });
      layersBySkill.set(parsedSkill.name, existing);
    }
  }

  const details: SkillDetail[] = [];

  for (const [name, occurrences] of layersBySkill.entries()) {
    // Later roots in `resolveSkillRoots` have higher precedence; last occurrence wins
    const winner = occurrences[occurrences.length - 1];
    if (!winner) continue;
    const shadowed = occurrences.slice(0, -1).map((o) => o.origin);

    details.push({
      name,
      origin: winner.origin,
      path: winner.path,
      description: winner.description,
      loaded: loadedSet.has(name),
      shadowedOrigins: shadowed.length > 0 ? shadowed : undefined,
    });
  }

  // Include active skills without filesystem origin (e.g. wiki additions)
  if (options?.activeSkills) {
    for (const active of options.activeSkills) {
      if (!layersBySkill.has(active.name)) {
        details.push({
          name: active.name,
          origin: "wiki",
          description: active.description,
          path: active.path,
          loaded: loadedSet.has(active.name),
        });
      }
    }
  }

  return details.sort((a, b) => a.name.localeCompare(b.name));
}

/** Format skills list for /skills output. */
export function formatSkillsList(skills: readonly SkillDetail[]): string {
  if (skills.length === 0) {
    return "No skills found in any layer (~/.agents, ~/.prism, skills.dirs, .agents/skills).";
  }

  const loadedCount = skills.filter((s) => s.loaded).length;
  const lines: string[] = [`Skills (${skills.length} available, ${loadedCount} loaded):`];

  for (const s of skills) {
    const loadedStr = s.loaded ? "loaded" : "not loaded";
    const overrodeStr = s.shadowedOrigins && s.shadowedOrigins.length > 0 ? ` (overrode ${s.shadowedOrigins.join(", ")})` : "";
    const pathStr = s.path ? ` - ${s.path}` : "";
    lines.push(`• ${s.name} [${s.origin}]${overrodeStr} [${loadedStr}]${pathStr}`);
    if (s.description) {
      lines.push(`    ${s.description}`);
    }
  }

  return lines.join("\n");
}

/** Create host-only command definitions for /skills and /skill. */
export function createSkillCommands(config: PrismCodeConfig): readonly CommandDefinition[] {
  return [
    {
      name: "skills",
      description: "List discovered skills, layer origins, and loaded states",
      execute: async (_args, context) => {
        const session = (context.metadata?.session as any) ?? (context as any)?.session;
        const loadedNames = session?.getLoadedSkillNames ? session.getLoadedSkillNames() : [];
        const skills = await inspectSkills(config, { loadedSkillNames: loadedNames });
        return {
          name: "skills",
          content: [{ type: "text", text: formatSkillsList(skills) }],
        };
      },
    },
    {
      name: "skill",
      description: "Force-load a skill into the current session",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact skill name from /skills." },
        },
        required: ["name"],
      },
      execute: async (args, context) => {
        const rawName = typeof args.name === "string" ? args.name : typeof args.text === "string" ? args.text : "";
        const name = rawName.trim();
        if (!name) {
          return {
            name: "skill",
            error: { message: "Usage: /skill <name>" },
          };
        }
        const session = (context.metadata?.session as any) ?? (context as any)?.session;
        if (!session) {
          return {
            name: "skill",
            error: { message: "No active session." },
          };
        }
        session.restoreLoadedSkills?.([name]);
        return {
          name: "skill",
          content: [{ type: "text", text: `Loaded skill "${name}" for this session.` }],
        };
      },
    },
  ];
}
