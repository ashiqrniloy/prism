import { estimateTextBytes } from "./models/estimate.js";
import type { Message, Skill } from "./contracts.js";

export type SkillsDisclosure = "progressive" | "eager";

export const EMPTY_SKILL_DESCRIPTION = "(no description)" as const;
export const DEFAULT_MAX_SKILL_CATALOG_ENTRIES = 64;
export const DEFAULT_MAX_SKILL_DESCRIPTION_BYTES = 512;
export const DEFAULT_MAX_SKILL_INSTRUCTION_BYTES = 32_768;
export const HARD_MAX_SKILL_INSTRUCTION_BYTES = 262_144;

const SKILL_CATALOG_PREAMBLE =
  "Skills are task-specific instructions. When a task matches a skill below, call load_skill with its name before starting.";

export interface LoadedSkillSet {
  has(name: string): boolean;
  /** Record a load; the optional run id keeps compaction re-attach run-scoped. */
  add(name: string, runId?: string): void;
  list(): readonly string[];
  clear(): void;
  /** Name→run view; optional so an existing host implementation keeps compiling. */
  entries?(): readonly { readonly name: string; readonly runId?: string }[];
  remove?(name: string): void;
}

export function createLoadedSkillSet(): LoadedSkillSet {
  const names = new Set<string>();
  const runIds = new Map<string, string>();
  return {
    has(name) {
      return names.has(name);
    },
    add(name, runId) {
      names.add(name);
      if (runId !== undefined) runIds.set(name, runId);
    },
    list() {
      return [...names];
    },
    clear() {
      names.clear();
      runIds.clear();
    },
    entries() {
      return [...names].map((name) => ({ name, ...(runIds.has(name) ? { runId: runIds.get(name) } : {}) }));
    },
    remove(name) {
      names.delete(name);
      runIds.delete(name);
    },
  };
}

export interface SkillRenderContext {
  readonly disclosure?: SkillsDisclosure;
  readonly loaded?: LoadedSkillSet;
  /** Budget demotion: render catalog-only even when eager/loaded. */
  readonly demotedBodies?: ReadonlySet<string>;
  /** Names of the tools this request advertises. When set, a skill whose `requiresTools` are not all here is not rendered. */
  readonly tools?: ReadonlySet<string>;
}

/** The `requiresTools` of `skill` that `tools` does not advertise. The one availability test every skill path calls. */
export function missingSkillTools(skill: Skill, tools: ReadonlySet<string> | undefined): readonly string[] {
  if (!tools || !skill.requiresTools?.length) return [];
  return skill.requiresTools.filter((name) => !tools.has(name));
}

function isSkillAvailable(skill: Skill, tools: ReadonlySet<string> | undefined): boolean {
  return missingSkillTools(skill, tools).length === 0;
}

export function resolveSkillsDisclosure(run?: SkillsDisclosure, agent?: SkillsDisclosure): SkillsDisclosure {
  return run ?? agent ?? "progressive";
}

export function capSkillCatalog(skills: readonly Skill[]): readonly Skill[] {
  return skills.slice(0, DEFAULT_MAX_SKILL_CATALOG_ENTRIES);
}

/** Skills that should appear in prompt assembly for the given disclosure mode. */
export function selectSkillsForPrompt(skills: readonly Skill[], context: SkillRenderContext = {}): readonly Skill[] {
  const disclosure = context.disclosure ?? "progressive";
  const available = context.tools ? skills.filter((skill) => isSkillAvailable(skill, context.tools)) : skills;
  if (disclosure === "eager") return available.filter((skill) => skill.instructions);
  return available;
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
    return `Skill ${skill.name}:\n${skill.instructions}`;
  }
  return skillCatalogLine(skill);
}

/** One catalog line; descriptions are truncated, never rejected, so a skill cannot fail a run. */
function skillCatalogLine(skill: Skill): string {
  const raw = skill.description?.trim() || EMPTY_SKILL_DESCRIPTION;
  const description =
    estimateTextBytes(raw) > DEFAULT_MAX_SKILL_DESCRIPTION_BYTES ? truncateUtf8Bytes(raw, DEFAULT_MAX_SKILL_DESCRIPTION_BYTES) : raw;
  return `- ${skill.name}: ${description}`;
}

export function skillMessages(skills: readonly Skill[] | undefined, context: SkillRenderContext = {}): Message[] {
  const all = selectSkillsForPrompt(skills ?? [], context);
  const selected = capSkillCatalog(all);
  const lines: string[] = [];
  const bodies: Message[] = [];
  for (const skill of selected) {
    if (skillHasRenderableBody(skill, context)) {
      const text = skillPromptText(skill, context);
      if (text) bodies.push(textMessage("system", text, skill.metadata));
    } else {
      lines.push(skillCatalogLine(skill));
    }
  }
  const unlisted = all.length - selected.length;
  if (lines.length === 0 && (unlisted === 0 || context.disclosure === "eager")) return bodies;
  const overflow = unlisted > 0 ? [`(${unlisted} more skills are installed but not listed.)`] : [];
  return [textMessage("system", [SKILL_CATALOG_PREAMBLE, ...lines, ...overflow].join("\n")), ...bodies];
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
