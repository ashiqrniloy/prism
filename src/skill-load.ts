import { estimateTextBytes } from "./models/estimate.js";
import type { JsonObject, Skill, SkillRegistry, ToolDefinition, ToolExecutionContext, ToolResult } from "./contracts.js";
import { HARD_MAX_SKILL_INSTRUCTION_BYTES, missingSkillTools, type LoadedSkillSet } from "./skill-disclosure.js";

export const DEFAULT_LOAD_SKILL_TOOL_NAME = "load_skill" as const;
export const SKILL_LOAD_ERROR_CODE = "skill_load_failed" as const;
export const SKILL_UNAVAILABLE_ERROR_CODE = "skill_unavailable" as const;
/** HARD_MAX_SKILL_INSTRUCTION_BYTES (262_144) + a 1_024-byte header allowance. */
export const MAX_LOAD_SKILL_RESULT_BYTES = 263_168;
/** Failure text keeps the pre-body bound so an error never fills the context. */
const MAX_LOAD_SKILL_ERROR_BYTES = 512;

// Bodies-mode persistence bounds (plan 018 Task 6 closeout `checkpoint-bodies`): the
// checkpoint `maxStateBytes` ceiling is the documented outer bound (oversize refuses at
// save with a recorded error); these caps bound the bodies payload itself on load.
// ponytail: module constants, not tunable options — hosts tune maxStateBytes for the ceiling.
export const MAX_PERSISTED_SKILL_BODIES = 64; // names-mode parity (MAX_PERSISTED_SKILL_NAMES)
export const MAX_PERSISTED_SKILL_BODY_NAME_CHARS = 256; // names-mode parity
export const MAX_PERSISTED_SKILL_BODY_BYTES = 262_144; // = HARD_MAX_SKILL_INSTRUCTION_BYTES (loader parity)
export const HARD_MAX_PERSISTED_SKILL_BODY_TOTAL_BYTES = 1024 * 1024; // = HARD_MAX_AGENT_RUN_STATE_BYTES

/** One persisted loaded-skill body (plan 018 closeout `checkpoint-bodies`). */
export interface LoadedSkillBodiesEntry {
  readonly name: string;
  readonly instructions: string;
}

/** Fail-closed shape/cap validation for a persisted bodies payload (load and save sides). */
export function validateLoadedSkillBodies(value: unknown): asserts value is readonly LoadedSkillBodiesEntry[] {
  if (!Array.isArray(value) || value.length > MAX_PERSISTED_SKILL_BODIES) {
    throw new SkillLoadError(`Loaded-skill bodies exceed ${MAX_PERSISTED_SKILL_BODIES} entries`);
  }
  let totalBytes = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || typeof (entry as LoadedSkillBodiesEntry).name !== "string") {
      throw new SkillLoadError("Malformed loaded-skill body entry: name must be a string");
    }
    const { name, instructions } = entry as LoadedSkillBodiesEntry;
    if (name.length > MAX_PERSISTED_SKILL_BODY_NAME_CHARS) {
      throw new SkillLoadError(`Loaded-skill body name exceeds ${MAX_PERSISTED_SKILL_BODY_NAME_CHARS} chars`);
    }
    if (typeof instructions !== "string") {
      throw new SkillLoadError("Malformed loaded-skill body entry: instructions must be a string");
    }
    const bodyBytes = Buffer.byteLength(instructions, "utf8");
    if (bodyBytes > MAX_PERSISTED_SKILL_BODY_BYTES) {
      throw new SkillLoadError(`Loaded-skill body exceeds ${MAX_PERSISTED_SKILL_BODY_BYTES} bytes`);
    }
    totalBytes += Buffer.byteLength(name, "utf8") + bodyBytes;
    if (totalBytes > HARD_MAX_PERSISTED_SKILL_BODY_TOTAL_BYTES) {
      throw new SkillLoadError(`Loaded-skill bodies exceed ${HARD_MAX_PERSISTED_SKILL_BODY_TOTAL_BYTES} total bytes`);
    }
  }
}

/**
 * Snapshot the exact instructions of every loaded skill (registry-independent).
 * Loaded names without instructions are skipped (they render no body anyway);
 * a restored body for a loaded name wins over the registry body.
 */
export function snapshotLoadedSkillBodies(
  skills: readonly Skill[],
  loaded: LoadedSkillSet,
  restored?: ReadonlyMap<string, string>,
): LoadedSkillBodiesEntry[] {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const entries: LoadedSkillBodiesEntry[] = [];
  for (const name of loaded.list()) {
    const instructions = restored?.get(name) ?? byName.get(name)?.instructions;
    if (!instructions) continue;
    entries.push({ name, instructions });
  }
  validateLoadedSkillBodies(entries); // refuses oversize with a recorded error (never truncates)
  return entries;
}

/**
 * Apply persisted bodies to the skills a resumed session will render: replace the
 * instructions of known skills and append synthesized skills for names the live
 * registry no longer serves, so the exact loaded text renders registry-independently.
 */
export function applyRestoredSkillBodies(skills: readonly Skill[], bodies: readonly LoadedSkillBodiesEntry[]): readonly Skill[] {
  validateLoadedSkillBodies(bodies);
  if (bodies.length === 0) return skills;
  const out = skills.map((skill) => {
    const body = bodies.find((entry) => entry.name === skill.name);
    return body ? { ...skill, instructions: body.instructions } : skill;
  });
  const known = new Set(skills.map((skill) => skill.name));
  for (const entry of bodies) {
    if (!known.has(entry.name)) {
      out.push({ name: entry.name, instructions: entry.instructions });
    }
  }
  return out;
}

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

/** A registered skill whose `requiresTools` this turn does not advertise; the run continues. */
export class SkillUnavailableError extends SkillLoadError {
  readonly unavailableCode = SKILL_UNAVAILABLE_ERROR_CODE;
  constructor(
    readonly skill: string,
    readonly missing: readonly string[],
  ) {
    super(`Skill ${skill} is unavailable: its required tools are not active (${missing.join(", ")})`);
    this.name = "SkillUnavailableError";
  }
}

export interface ResolveSkillLoadOptions {
  readonly registry: SkillRegistry;
  readonly name: string;
  readonly tools?: readonly ToolDefinition[];
  readonly loaded?: LoadedSkillSet;
  readonly activeSkillNames?: readonly string[];
  /** The tool names this turn advertises; a skill's `requiresTools` must all be in it. Omitted: not checked. */
  readonly advertisedToolNames?: readonly string[];
  /** The tool answers an already-loaded skill as a normal result; direct callers keep the failure. */
  readonly allowLoaded?: boolean;
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

  const missingRequired = missingSkillTools(skill, options.advertisedToolNames && new Set(options.advertisedToolNames));
  if (missingRequired.length > 0) throw new SkillUnavailableError(skill.name, missingRequired);

  if (!skill.instructions?.trim()) throw new SkillLoadError(`Skill ${skill.name} has no instructions to load`);

  const bytes = estimateTextBytes(skill.instructions);
  if (bytes > HARD_MAX_SKILL_INSTRUCTION_BYTES) {
    throw new SkillLoadError(`Skill ${skill.name} instructions exceed hard cap (${HARD_MAX_SKILL_INSTRUCTION_BYTES} bytes)`);
  }

  if (!options.allowLoaded && options.loaded?.has(skill.name)) throw new SkillLoadError(`Skill ${skill.name} is already loaded`);

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
  /** Names the current turn advertises (after `when`, `tools.only` and per-turn clamps). */
  readonly advertisedToolNames?: readonly string[];
}

function skillLoadMetadata(context: ToolExecutionContext): SkillLoadToolMetadata | undefined {
  const metadata = context.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return metadata as SkillLoadToolMetadata;
}

function capLoadSkillText(text: string, maxBytes = MAX_LOAD_SKILL_RESULT_BYTES): string {
  const bytes = estimateTextBytes(text);
  if (bytes <= maxBytes) return text;
  const suffix = "…";
  let end = maxBytes - new TextEncoder().encode(suffix).length;
  const encoded = new TextEncoder().encode(text);
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.slice(0, end)) + suffix;
}

function skillDirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  if (idx === 2 && normalized[1] === ":") return normalized.slice(0, 3);
  return normalized.slice(0, idx);
}

export function createLoadSkillTool(options: CreateLoadSkillToolOptions): ToolDefinition {
  const toolName = options.name ?? DEFAULT_LOAD_SKILL_TOOL_NAME;
  return {
    name: toolName,
    description: "Load the full instructions for an active skill by exact name.",
    effects: ["read"],
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact skill name from the catalog." },
      },
      required: ["name"],
    } as JsonObject,
    execute(args, context) {
      const fail = (reason: string, text: string): ToolResult => {
        const bounded = capLoadSkillText(text, MAX_LOAD_SKILL_ERROR_BYTES);
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
          advertisedToolNames: metadata?.advertisedToolNames ?? (metadata?.activeTools ?? options.tools)?.map((tool) => tool.name),
          allowLoaded: true,
        });
        const alreadyLoaded = loaded.has(skill.name);
        // Always stamp this run: a reload of an earlier-run name makes the body current again.
        loaded.add(skill.name, context.runId);
        if (alreadyLoaded) {
          const text = capLoadSkillText(
            `Skill ${skill.name} is already loaded; its instructions are earlier in this conversation.`,
            MAX_LOAD_SKILL_ERROR_BYTES,
          );
          return {
            toolCallId: context.toolCallId,
            name: toolName,
            value: { ok: true, name: skill.name, text, alreadyLoaded: true },
            content: [{ type: "text", text }],
          };
        }
        const header = skill.path
          ? `Loaded skill ${skill.name}. Skill directory: ${skillDirname(skill.path)}. Paths in these instructions are relative to it.`
          : `Loaded skill ${skill.name}.`;
        const text = capLoadSkillText(`${header}\n\n${skill.instructions}`);
        return {
          toolCallId: context.toolCallId,
          name: toolName,
          value: { ok: true, name: skill.name, text },
          content: [{ type: "text", text }],
          metadata: { loadedSkill: skill.name, loadedSkillRunId: context.runId },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Skill load failed";
        if (error instanceof SkillUnavailableError) {
          const text = capLoadSkillText(message, MAX_LOAD_SKILL_ERROR_BYTES);
          return {
            toolCallId: context.toolCallId,
            name: toolName,
            value: { ok: false, reason: SKILL_UNAVAILABLE_ERROR_CODE, text, missing: error.missing },
            content: [{ type: "text", text }],
            error: { name: error.name, code: SKILL_UNAVAILABLE_ERROR_CODE, message: text },
          };
        }
        return fail("skill_load_failed", message);
      }
    },
  };
}
