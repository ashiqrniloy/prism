import { AntigravityWorkspaceConfigError } from "./types.js";

export const DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS = [
  "run_command",
  "write_to_file",
  "replace_file_content",
  "delete_file",
  "rename_file",
  "launch_browser",
  "browser_action",
] as const;

export const DOCUMENTED_ANTIGRAVITY_READONLY_TOOLS = [
  "view_file",
  "grep_search",
  "find_by_name",
  "list_dir",
  "read_url_content",
  "search_web",
] as const;

export const DOCUMENTED_ANTIGRAVITY_ORCHESTRATION_TOOLS = [
  "invoke_subagent",
  "manage_subagents",
  "define_subagent",
  "send_message",
  "schedule",
  "manage_task",
  "ask_question",
  "generate_image",
] as const;

export const DOCUMENTED_ANTIGRAVITY_BUILTIN_TOOLS = [
  ...DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS,
  ...DOCUMENTED_ANTIGRAVITY_READONLY_TOOLS,
  ...DOCUMENTED_ANTIGRAVITY_ORCHESTRATION_TOOLS,
] as const;

export type DocumentedAntigravityBuiltinTool = (typeof DOCUMENTED_ANTIGRAVITY_BUILTIN_TOOLS)[number];

const BUILTIN_SET = new Set<string>(DOCUMENTED_ANTIGRAVITY_BUILTIN_TOOLS);

export type AntigravityToolPolicyName = "prism-mutators" | "prism-only";

export interface AntigravityCustomToolPolicy {
  readonly allowBuiltins?: readonly string[];
  readonly denyBuiltins?: readonly string[];
}

export type AntigravityToolPolicy = AntigravityToolPolicyName | AntigravityCustomToolPolicy;

export interface ResolvedAntigravityToolPolicy {
  readonly kind: "prism-mutators" | "prism-only" | "custom";
  readonly allowedBuiltins: readonly string[];
  readonly deniedBuiltins: readonly string[];
  readonly preferPrismMutators: boolean;
  readonly permissions: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
}

export interface ResolveToolPolicyOptions {
  readonly policy?: AntigravityToolPolicy;
  readonly serverName?: string;
  readonly allowedMcpTools?: readonly string[];
}

export function validateBuiltinToolName(name: string): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new AntigravityWorkspaceConfigError("Built-in tool name must be a non-empty string");
  }
  const trimmed = name.trim();
  if (!BUILTIN_SET.has(trimmed)) {
    throw new AntigravityWorkspaceConfigError(
      `Unknown or unsupported Antigravity built-in tool: '${trimmed}'. Documented built-ins are: ${DOCUMENTED_ANTIGRAVITY_BUILTIN_TOOLS.join(", ")}`,
    );
  }
  return trimmed;
}

export function resolveToolPolicy(options?: ResolveToolPolicyOptions): ResolvedAntigravityToolPolicy {
  const policy = options?.policy ?? "prism-mutators";
  const serverName = options?.serverName ?? "prism";
  const allowedMcpTools = options?.allowedMcpTools;

  const mcpAllowRules = allowedMcpTools?.length ? allowedMcpTools.map((tool) => `mcp(${serverName}/${tool})`) : [`mcp(${serverName}/*)`];

  if (policy === "prism-mutators") {
    const deniedBuiltins = [...DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS];
    const allowedBuiltins = [...DOCUMENTED_ANTIGRAVITY_READONLY_TOOLS, ...DOCUMENTED_ANTIGRAVITY_ORCHESTRATION_TOOLS];

    const denyRules = deniedBuiltins.map((tool) => `builtin(${tool})`);
    const allowRules = [...mcpAllowRules, ...allowedBuiltins.map((tool) => `builtin(${tool})`)];

    return {
      kind: "prism-mutators",
      allowedBuiltins,
      deniedBuiltins,
      preferPrismMutators: true,
      permissions: {
        allow: allowRules,
        deny: denyRules,
      },
    };
  }

  if (policy === "prism-only") {
    const deniedBuiltins = [...DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS, ...DOCUMENTED_ANTIGRAVITY_READONLY_TOOLS];
    const allowedBuiltins = [...DOCUMENTED_ANTIGRAVITY_ORCHESTRATION_TOOLS];

    const denyRules = deniedBuiltins.map((tool) => `builtin(${tool})`);
    const allowRules = [...mcpAllowRules, ...allowedBuiltins.map((tool) => `builtin(${tool})`)];

    return {
      kind: "prism-only",
      allowedBuiltins,
      deniedBuiltins,
      preferPrismMutators: true,
      permissions: {
        allow: allowRules,
        deny: denyRules,
      },
    };
  }

  // Custom policy
  const allowInput = policy.allowBuiltins ?? [];
  const denyInput = policy.denyBuiltins ?? [];

  const validatedAllow = allowInput.map(validateBuiltinToolName);
  const validatedDeny = denyInput.map(validateBuiltinToolName);

  // Check for conflicts
  const allowSet = new Set(validatedAllow);
  for (const denied of validatedDeny) {
    if (allowSet.has(denied)) {
      throw new AntigravityWorkspaceConfigError(`Built-in tool '${denied}' cannot be both allowed and denied in custom tool policy`);
    }
  }

  const denyRules = validatedDeny.map((tool) => `builtin(${tool})`);
  const allowRules = [...mcpAllowRules, ...validatedAllow.map((tool) => `builtin(${tool})`)];

  return {
    kind: "custom",
    allowedBuiltins: validatedAllow,
    deniedBuiltins: validatedDeny,
    preferPrismMutators: validatedDeny.some((tool) =>
      DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS.includes(tool as (typeof DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS)[number]),
    ),
    permissions: {
      allow: allowRules,
      deny: denyRules,
    },
  };
}
