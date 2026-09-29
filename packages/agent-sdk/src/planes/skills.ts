import {
  createContributionRegistries,
  createSkillRegistry,
  registerDiscoveredContributions,
  type Skill,
  type SkillRegistry,
  type TrustPolicy,
} from "@arnilo/prism";
import { type DiscoveryRoot, discoverContributions } from "@arnilo/prism/node/contribution-discovery";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

export interface SkillsPlaneConfig {
  /**
   * Root directory to scan for `.agents/skills` (single-level bounded discovery).
   * Omission keeps skills plane disabled (zero discovery) unless `roots` or `add` is set.
   */
  readonly workspaceRoot?: string;
  /**
   * Explicit discovery roots with origin and layout.
   */
  readonly roots?: readonly DiscoveryRoot[];
  /**
   * Trust policy gating path containment. Defaults to trusting `workspaceRoot` and all `roots` dirs.
   * Never defaults open or to the user's home directory.
   */
  readonly trust?: TrustPolicy;
  /**
   * Exact skill names to exclude from the resolved skill registry.
   */
  readonly exclude?: readonly string[];
  /**
   * Additional host-provided skills to register.
   */
  readonly add?: readonly Skill[];
  /**
   * Whether to activate all registered skills for session runs by setting `AgentConfig.activateAllSkills`.
   * Defaults to `true` when any skill is registered.
   */
  readonly activateAll?: boolean;
  /**
   * Skills disclosure mode: "progressive" (catalog only until load_skill) or "eager" (full instructions each turn).
   */
  readonly disclosure?: "progressive" | "eager";
  /**
   * Pre-assembled skill registry. When provided, zero filesystem discovery is performed.
   */
  readonly registry?: SkillRegistry;
}

export interface AssembledSkillsPlane {
  readonly skills?: SkillRegistry;
  readonly discoveredSkills: readonly Skill[];
  readonly activateAllSkills?: boolean;
}

/**
 * Assemble skills plane: scans configured roots and/or `.agents/skills` under the workspace root
 * with an explicit trust policy, drops excluded names, appends host additions,
 * and returns a SkillRegistry and activation setting.
 */
export async function assembleSkillsPlane(config?: SkillsPlaneConfig): Promise<AssembledSkillsPlane> {
  if (config?.registry) {
    return {
      skills: config.registry,
      discoveredSkills: config.registry.list(),
      activateAllSkills: config.activateAll ?? true,
    };
  }

  const hasRoots = Boolean(config?.roots && config.roots.length > 0);
  const hasWorkspaceRoot = Boolean(config?.workspaceRoot);
  const hasAdd = Boolean(config?.add && config.add.length > 0);

  if (!config || (!hasWorkspaceRoot && !hasRoots && !hasAdd)) {
    return { discoveredSkills: [] };
  }

  let skillsList: Skill[] = [];

  if (hasWorkspaceRoot || hasRoots) {
    const trustedRoots = [...(config.workspaceRoot ? [config.workspaceRoot] : []), ...(config.roots ? config.roots.map((r) => r.dir) : [])];
    const trust =
      config.trust ??
      createPathTrustPolicy({
        trustedRoots,
      });

    const discovered = await discoverContributions({
      kinds: ["skill"],
      workspaceRoot: config.workspaceRoot,
      roots: config.roots,
      trust,
    });

    const registries = createContributionRegistries();
    registerDiscoveredContributions(registries, discovered);
    skillsList = [...registries.skills.list()];
  }

  if (config.exclude && config.exclude.length > 0) {
    const excludeSet = new Set(config.exclude);
    skillsList = skillsList.filter((s) => !excludeSet.has(s.name));
  }

  if (config.add && config.add.length > 0) {
    skillsList.push(...config.add);
  }

  if (skillsList.length === 0) {
    return { discoveredSkills: [] };
  }

  const activateAllSkills = config.activateAll ?? true;

  return {
    skills: createSkillRegistry(skillsList),
    discoveredSkills: skillsList,
    activateAllSkills,
  };
}
