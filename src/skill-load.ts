import type { JsonObject, Skill, SkillRegistry, ToolDefinition, ToolExecutionContext, ToolResult } from "./contracts.js";
import { estimateTextBytes } from "./context-budget.js";
import { HARD_MAX_SKILL_INSTRUCTION_BYTES, type LoadedSkillSet } from "./skill-disclosure.js";

export const DEFAULT_LOAD_SKILL_TOOL_NAME = "load_skill" as const;
export const SKILL_LOAD_ERROR_CODE = "skill_load_failed" as const;
export const MAX_LOAD_SKILL_RESULT_BYTES = 512;

export class SkillLoadError extends Error {
  readonly code = SKILL_LOAD_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = "SkillLoadError";
  }
}

export function isSkillLoadError(error: unknown): error is SkillLoadError {
  return error instanceof Error && (error as { code?: unknown }).code === SKILL_LOAD_ERROR_CODE;
}

export interface ResolveSkillLoadOptions {
  readonly registry: SkillRegistry;
  readonly name: string;
  readonly tools?: readonly ToolDefinition[];
  readonly loaded?: LoadedSkillSet;
  readonly activeSkillNames?: readonly string[];
}

export function resolveSkillLoad(options: ResolveSkillLoadOptions): Skill {
  const name = options.name.trim();
  if (!name) throw new SkillLoadError("Skill name is required");

  let skill: Skill;
  try {
    skill = options.registry.resolve(name);
  } catch {
    throw new SkillLoadError(`Unknown skill: ${name}`);
  }

  if (options.activeSkillNames && !options.activeSkillNames.includes(skill.name)) {
    throw new SkillLoadError(`Skill ${skill.name} is not active for this run`);
  }

  const toolNames = new Set((options.tools ?? []).map((tool) => tool.name));
  const missingTool = skill.toolNames?.find((toolName) => !toolNames.has(toolName));
  if (missingTool) throw new SkillLoadError(`Skill ${skill.name} requires inactive tool: ${missingTool}`);

  if (!skill.instructions?.trim()) throw new SkillLoadError(`Skill ${skill.name} has no instructions to load`);

  const bytes = estimateTextBytes(skill.instructions);
  if (bytes > HARD_MAX_SKILL_INSTRUCTION_BYTES) {
    throw new SkillLoadError(`Skill ${skill.name} instructions exceed hard cap (${HARD_MAX_SKILL_INSTRUCTION_BYTES} bytes)`);
  }

  if (options.loaded?.has(skill.name)) throw new SkillLoadError(`Skill ${skill.name} is already loaded`);

  return skill;
}

export interface CreateLoadSkillToolOptions {
  readonly registry: SkillRegistry;
  readonly loaded?: LoadedSkillSet;
  readonly tools?: readonly ToolDefinition[];
  readonly name?: string;
}

interface SkillLoadToolMetadata {
  readonly loadedSkills?: LoadedSkillSet;
  readonly activeTools?: readonly ToolDefinition[];
  readonly activeSkillNames?: readonly string[];
}

function skillLoadMetadata(context: ToolExecutionContext): SkillLoadToolMetadata | undefined {
  const metadata = context.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return metadata as SkillLoadToolMetadata;
}

function capLoadSkillText(text: string): string {
  const bytes = estimateTextBytes(text);
  if (bytes <= MAX_LOAD_SKILL_RESULT_BYTES) return text;
  const suffix = "…";
  let end = MAX_LOAD_SKILL_RESULT_BYTES - new TextEncoder().encode(suffix).length;
  const encoded = new TextEncoder().encode(text);
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.slice(0, end)) + suffix;
}

export function createLoadSkillTool(options: CreateLoadSkillToolOptions): ToolDefinition {
  const toolName = options.name ?? DEFAULT_LOAD_SKILL_TOOL_NAME;
  return {
    name: toolName,
    description: "Load the full instructions for an active skill by exact name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact skill name from the catalog." },
      },
      required: ["name"],
    } as JsonObject,
    execute(args, context) {
      const fail = (reason: string, text: string): ToolResult => {
        const bounded = capLoadSkillText(text);
        return {
          toolCallId: context.toolCallId,
          name: toolName,
          value: { ok: false, reason, text: bounded },
          content: [{ type: "text", text: bounded }],
        };
      };

      const name = typeof args.name === "string" ? args.name : "";
      const metadata = skillLoadMetadata(context);
      const loaded = metadata?.loadedSkills ?? options.loaded;
      if (!loaded) return fail("no_loaded_set", "Skill load state is unavailable for this session.");

      try {
        const skill = resolveSkillLoad({
          registry: options.registry,
          name,
          tools: metadata?.activeTools ?? options.tools,
          loaded,
          activeSkillNames: metadata?.activeSkillNames,
        });
        loaded.add(skill.name);
        const text = capLoadSkillText(`Loaded skill ${skill.name} for this session.`);
        return {
          toolCallId: context.toolCallId,
          name: toolName,
          value: { ok: true, name: skill.name, text },
          content: [{ type: "text", text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Skill load failed";
        return fail("skill_load_failed", message);
      }
    },
  };
}
