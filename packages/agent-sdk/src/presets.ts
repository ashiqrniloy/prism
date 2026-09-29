import type { ExecutionPolicy, ToolDefinition } from "@arnilo/prism";
import { createCodingTools, createGitTools } from "@arnilo/prism-coding-tools/agent";
import type { AgentSdkConfig } from "./define-agent.js";
import { AgentSdkConfigError } from "./errors.js";
import type { InstructionsPlaneConfig } from "./planes/instructions.js";
import type { McpPlaneConfig } from "./planes/mcp.js";
import type { SkillsPlaneConfig } from "./planes/skills.js";
import type { ResolveToolPlaneOptions } from "./tool-plane.js";

// ---------------------------------------------------------------------------
// Preset Options
// ---------------------------------------------------------------------------

export interface CodingPresetOptions {
  /**
   * Root workspace directory. Required for tools and AGENTS.md auto-load.
   */
  readonly cwd: string;
  /**
   * Optional execution policy applied to coding tools (Docker, approvals, limits).
   */
  readonly permissions?: ExecutionPolicy;
  /**
   * Optional plane selection.
   * `coding` defaults to true (9 core coding tools).
   * `git` defaults to false (opt-in 7 Git tools).
   */
  readonly planes?: {
    readonly coding?: boolean;
    readonly git?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Bare agent preset: produces an agentic loop with session lifecycle, zero tools,
 * and zero auto-discovery.
 */
export function barePreset(): Partial<AgentSdkConfig> {
  return {
    tools: {
      planes: {},
    },
  };
}

/**
 * Coding agent preset: configures the standard coding plane (`shell`, `read`, `write`,
 * `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move`) over `cwd`, enables
 * AGENTS.md auto-load, and optionally includes `createGitTools` when `planes.git: true`.
 *
 * @param options Preset configuration specifying workspace directory and execution policy.
 * @returns Partial `AgentSdkConfig` ready to merge with host overrides.
 */
export function codingPreset(options: CodingPresetOptions): Partial<AgentSdkConfig> {
  if (!options || typeof options !== "object" || typeof options.cwd !== "string" || options.cwd.length === 0) {
    throw new AgentSdkConfigError("codingPreset requires options with a non-empty cwd string");
  }

  const planes: Record<string, readonly ToolDefinition[]> = {};

  if (options.planes?.coding !== false) {
    planes.coding = createCodingTools(options.cwd, options.permissions ? { executionPolicy: options.permissions } : undefined);
  }

  if (options.planes?.git === true) {
    planes.git = createGitTools(options.cwd, options.permissions ? { executionPolicy: options.permissions } : undefined);
  }

  return {
    workspaceRoot: options.cwd,
    tools: {
      planes,
    },
    instructions: {
      agentsMd: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Preset / Config Merging
// ---------------------------------------------------------------------------

/**
 * Pure merge function: combines a base configuration (e.g. from a preset) with host overrides.
 *
 * Precedence & merging rules:
 * - Scalar fields: override wins over base.
 * - Tool-plane fields:
 *   - `planes`: shallow-merged (override keys replace base keys with the same name).
 *   - `exclude`: concatenated (`[...base.exclude, ...override.exclude]`).
 *   - `replace`: shallow-merged (host replacement wins on key collision).
 *   - `add`: concatenated (`[...base.add, ...override.add]`).
 * - `skills`: deep-merged (`workspaceRoot`/`trust` override wins, `exclude`/`add` arrays concatenated).
 * - `instructions`: object override shallow-merges with object base; scalar override wins.
 * - `mcp`: `servers` concatenated, other fields (`allow`/`connectTimeoutMs`/`executionPolicy`) override wins, `connector` override wins.
 * - No shared-reference mutation: all merged arrays and objects are new copies.
 */
export function mergeAgentConfig(base: Partial<AgentSdkConfig>, override: Partial<AgentSdkConfig>): Partial<AgentSdkConfig> {
  // 1. Tool plane resolution options (support nested .tools or top-level)
  const baseTools = base.tools ?? {};
  const overrideTools = override.tools ?? {};

  const basePlanes = baseTools.planes ?? base.planes ?? {};
  const overridePlanes = overrideTools.planes ?? override.planes ?? {};
  const mergedPlanes = { ...basePlanes, ...overridePlanes };

  const baseExclude = baseTools.exclude ?? base.exclude ?? [];
  const overrideExclude = overrideTools.exclude ?? override.exclude ?? [];
  const mergedExclude = [...baseExclude, ...overrideExclude];

  const baseReplace = baseTools.replace ?? base.replace ?? {};
  const overrideReplace = overrideTools.replace ?? override.replace ?? {};
  const mergedReplace = { ...baseReplace, ...overrideReplace };

  const baseAdd = baseTools.add ?? base.add ?? [];
  const overrideAdd = overrideTools.add ?? override.add ?? [];
  const mergedAdd = [...baseAdd, ...overrideAdd];

  const mergedTools: ResolveToolPlaneOptions = {
    planes: mergedPlanes,
    exclude: mergedExclude,
    replace: mergedReplace,
    add: mergedAdd,
  };

  // 2. Skills plane
  let mergedSkills: SkillsPlaneConfig | undefined;
  if (base.skills || override.skills) {
    mergedSkills = {
      workspaceRoot: override.skills?.workspaceRoot ?? base.skills?.workspaceRoot,
      roots: override.skills?.roots ?? base.skills?.roots,
      trust: override.skills?.trust ?? base.skills?.trust,
      exclude: [...(base.skills?.exclude ?? []), ...(override.skills?.exclude ?? [])],
      add: [...(base.skills?.add ?? []), ...(override.skills?.add ?? [])],
      activateAll: override.skills?.activateAll ?? base.skills?.activateAll,
      disclosure: override.skills?.disclosure ?? base.skills?.disclosure,
      registry: override.skills?.registry ?? base.skills?.registry,
    };
  }

  // 3. Instructions plane
  let mergedInstructions: string | InstructionsPlaneConfig | undefined;
  if (override.instructions !== undefined) {
    if (typeof override.instructions === "object" && typeof base.instructions === "object") {
      mergedInstructions = {
        ...base.instructions,
        ...override.instructions,
      };
    } else {
      mergedInstructions = override.instructions;
    }
  } else if (base.instructions !== undefined) {
    mergedInstructions = typeof base.instructions === "object" ? { ...base.instructions } : base.instructions;
  }

  // 4. MCP plane
  let mergedMcp: McpPlaneConfig | undefined;
  if (base.mcp || override.mcp) {
    mergedMcp = {
      ...base.mcp,
      ...override.mcp,
      servers: [...(base.mcp?.servers ?? []), ...(override.mcp?.servers ?? [])],
      connector: override.mcp?.connector ?? base.mcp?.connector,
    };
  }

  return {
    ...base,
    ...override,
    tools: mergedTools,
    planes: mergedPlanes,
    exclude: mergedExclude,
    replace: mergedReplace,
    add: mergedAdd,
    ...(mergedSkills ? { skills: mergedSkills } : {}),
    ...(mergedInstructions !== undefined ? { instructions: mergedInstructions } : {}),
    ...(mergedMcp ? { mcp: mergedMcp } : {}),
  };
}
