import type { Message, Skill } from "./contracts.js";
import { estimateTextBytes } from "./context-budget.js";

export type SkillsDisclosure = "progressive" | "eager";

export const EMPTY_SKILL_DESCRIPTION = "(no description)" as const;
export const DEFAULT_MAX_SKILL_CATALOG_ENTRIES = 64;
export const HARD_MAX_SKILL_CATALOG_ENTRIES = 256;
export const DEFAULT_MAX_SKILL_DESCRIPTION_BYTES = 512;
export const HARD_MAX_SKILL_DESCRIPTION_BYTES = 4_096;
export const DEFAULT_MAX_SKILL_INSTRUCTION_BYTES = 32_768;
export const HARD_MAX_SKILL_INSTRUCTION_BYTES = 262_144;

export const SKILL_DISCLOSURE_ERROR_CODE = "skill_disclosure_exceeded" as const;

export class SkillDisclosureError extends Error {
  readonly code = SKILL_DISCLOSURE_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = "SkillDisclosureError";
  }
}

export function isSkillDisclosureError(error: unknown): error is SkillDisclosureError {
  return error instanceof Error && (error as { code?: unknown }).code === SKILL_DISCLOSURE_ERROR_CODE;
}

export interface LoadedSkillSet {
  has(name: string): boolean;
  add(name: string): void;
  list(): readonly string[];
  clear(): void;
}

export function createLoadedSkillSet(): LoadedSkillSet {
  const names = new Set<string>();
  return {
    has(name) {
      return names.has(name);
    },
    add(name) {
      names.add(name);
    },
    list() {
      return [...names];
    },
    clear() {
      names.clear();
    },
  };
}

export interface SkillRenderContext {
  readonly disclosure?: SkillsDisclosure;
  readonly loaded?: LoadedSkillSet;
  /** Budget demotion: render catalog-only even when eager/loaded. */
  readonly demotedBodies?: ReadonlySet<string>;
}

export function resolveSkillsDisclosure(run?: SkillsDisclosure, agent?: SkillsDisclosure): SkillsDisclosure {
  return run ?? agent ?? "progressive";
}

export function capSkillCatalog(skills: readonly Skill[]): readonly Skill[] {
  if (skills.length > HARD_MAX_SKILL_CATALOG_ENTRIES) {
    throw new SkillDisclosureError(`Skill catalog exceeds hard cap (${HARD_MAX_SKILL_CATALOG_ENTRIES} entries)`);
  }
  return skills.slice(0, DEFAULT_MAX_SKILL_CATALOG_ENTRIES);
}

/** Skills that should appear in prompt assembly for the given disclosure mode. */
export function selectSkillsForPrompt(skills: readonly Skill[], context: SkillRenderContext = {}): readonly Skill[] {
  const disclosure = context.disclosure ?? "progressive";
  if (disclosure === "eager") return skills.filter((skill) => skill.instructions);
  return skills;
}

export function skillHasRenderableBody(skill: Skill, context: SkillRenderContext = {}): boolean {
  const disclosure = context.disclosure ?? "progressive";
  const loaded = context.loaded?.has(skill.name) ?? false;
  const demoted = context.demotedBodies?.has(skill.name) ?? false;
  return !demoted && (disclosure === "eager" || loaded) && !!skill.instructions;
}

export function skillPromptText(skill: Skill, context: SkillRenderContext = {}): string | undefined {
  const includeBody = skillHasRenderableBody(skill, context);

  if (includeBody) {
    if (!skill.instructions) return undefined;
    const bytes = estimateTextBytes(skill.instructions);
    if (bytes > HARD_MAX_SKILL_INSTRUCTION_BYTES) {
      throw new SkillDisclosureError(`Skill ${skill.name} instructions exceed hard cap (${HARD_MAX_SKILL_INSTRUCTION_BYTES} bytes)`);
    }
    return `Skill ${skill.name}:\n${skill.instructions}`;
  }

  let description = skill.description?.trim() || EMPTY_SKILL_DESCRIPTION;
  const bytes = estimateTextBytes(description);
  if (bytes > HARD_MAX_SKILL_DESCRIPTION_BYTES) {
    throw new SkillDisclosureError(`Skill ${skill.name} description exceeds hard cap (${HARD_MAX_SKILL_DESCRIPTION_BYTES} bytes)`);
  }
  if (bytes > DEFAULT_MAX_SKILL_DESCRIPTION_BYTES) {
    description = truncateUtf8Bytes(description, DEFAULT_MAX_SKILL_DESCRIPTION_BYTES);
  }
  return `Skill ${skill.name}: ${description}`;
}

export function skillMessages(skills: readonly Skill[] | undefined, context: SkillRenderContext = {}): Message[] {
  return capSkillCatalog(selectSkillsForPrompt(skills ?? [], context))
    .map((skill) => {
      const text = skillPromptText(skill, context);
      return text ? textMessage("system", text, skill.metadata) : undefined;
    })
    .filter((message): message is Message => message !== undefined);
}

function textMessage(role: Message["role"], text: string, metadata?: Readonly<Record<string, unknown>>): Message {
  return { role, content: [{ type: "text", text }], metadata };
}

function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return text;
  const suffix = new TextEncoder().encode("…");
  let end = Math.max(0, maxBytes - suffix.length);
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return `${new TextDecoder().decode(encoded.slice(0, end))}…`;
}
