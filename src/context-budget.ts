import type { ContextBlock, InputAssemblyLayout, Message, ProviderRequest, Skill, ToolDefinition } from "./contracts.js";
import {
  capSkillCatalog,
  type LoadedSkillSet,
  type SkillRenderContext,
  type SkillsDisclosure,
  selectSkillsForPrompt,
  skillHasRenderableBody,
  skillPromptText,
} from "./skill-disclosure.js";

/** Assembler-time input budget. At least one max required when present. */
export interface ContextBudget {
  readonly maxInputTokens?: number;
  readonly maxInputBytes?: number;
  readonly reportOmissions?: boolean;
}

export type ContextBudgetOmissionKind =
  | "skills"
  | "skill_body"
  | "context"
  | "history"
  | "tool_results"
  | "summaries"
  | "attachments"
  | "tools";

export interface ContextBudgetOmission {
  readonly kind: ContextBudgetOmissionKind;
  readonly id?: string;
  readonly tokenEstimate: number;
  readonly byteLength: number;
}

export interface ContextBudgetReport {
  readonly omitted: readonly ContextBudgetOmission[];
  readonly keptTokens: number;
  readonly keptBytes: number;
  readonly maxInputTokens?: number;
  readonly maxInputBytes?: number;
  readonly truncated: boolean;
}

export interface ContextBudgetMessageGroups {
  readonly instructions: readonly Message[];
  readonly summaries: readonly Message[];
  readonly history: readonly Message[];
  readonly input: readonly Message[];
  readonly attachments: readonly Message[];
  readonly toolResults: readonly Message[];
}

export const CONTEXT_BUDGET_REPORT_METADATA_KEY = "contextBudgetReport" as const;
export const HARD_MAX_CONTEXT_BUDGET_TOKENS = 2_000_000;
export const HARD_MAX_CONTEXT_BUDGET_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS = 256;
export const HARD_MAX_CONTEXT_BUDGET_OMISSIONS = 1_024;
export const CONTEXT_BUDGET_ERROR_CODE = "context_budget_exceeded" as const;

export class ContextBudgetError extends Error {
  readonly code = CONTEXT_BUDGET_ERROR_CODE;
  constructor(message = "context budget exceeded: mandatory prefix cannot fit") {
    super(message);
    this.name = "ContextBudgetError";
  }
}

export function isContextBudgetError(error: unknown): error is ContextBudgetError {
  return error instanceof Error && (error as { code?: unknown }).code === CONTEXT_BUDGET_ERROR_CODE;
}

/** UTF-16 code units / 4. Estimate only — not billing. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateTextBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function estimateMessageTokens(message: Message): number {
  return estimateTextTokens(messageText(message));
}

export function estimateMessageBytes(message: Message): number {
  return estimateTextBytes(messageText(message));
}

export function estimateAssemblyTokens(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function resolveContextBudget(budget: ContextBudget): Required<Pick<ContextBudget, "reportOmissions">> & ContextBudget {
  const hasTokens = budget.maxInputTokens !== undefined;
  const hasBytes = budget.maxInputBytes !== undefined;
  if (!hasTokens && !hasBytes) {
    throw new TypeError("contextBudget requires maxInputTokens and/or maxInputBytes");
  }
  if (hasTokens) assertPositiveCap(budget.maxInputTokens!, "maxInputTokens", HARD_MAX_CONTEXT_BUDGET_TOKENS);
  if (hasBytes) assertPositiveCap(budget.maxInputBytes!, "maxInputBytes", HARD_MAX_CONTEXT_BUDGET_BYTES);
  return { ...budget, reportOmissions: budget.reportOmissions === true };
}

export function getContextBudgetReport(request: ProviderRequest): ContextBudgetReport | undefined {
  const value = request.metadata?.[CONTEXT_BUDGET_REPORT_METADATA_KEY];
  return isContextBudgetReport(value) ? value : undefined;
}

export function applyContextBudget(options: {
  readonly groups: ContextBudgetMessageGroups;
  readonly context?: readonly ContextBlock[];
  readonly skills?: readonly Skill[];
  readonly tools?: readonly ToolDefinition[];
  readonly budget: ContextBudget;
  readonly layout?: InputAssemblyLayout;
  readonly skillsDisclosure?: SkillsDisclosure;
  readonly loadedSkills?: LoadedSkillSet;
}): {
  readonly groups: ContextBudgetMessageGroups;
  readonly context: readonly ContextBlock[];
  readonly skills: readonly Skill[];
  readonly tools: readonly ToolDefinition[] | undefined;
  readonly demotedSkillBodies: readonly string[];
  readonly report: ContextBudgetReport;
} {
  const budget = resolveContextBudget(options.budget);
  const layout = options.layout ?? "cache_aware";
  const groups = {
    instructions: [...options.groups.instructions],
    summaries: [...options.groups.summaries],
    history: [...options.groups.history],
    input: [...options.groups.input],
    attachments: [...options.groups.attachments],
    toolResults: [...options.groups.toolResults],
  };
  const context = [...(options.context ?? [])];
  const skillContext: SkillRenderContext = { disclosure: options.skillsDisclosure, loaded: options.loadedSkills };
  const skills = [...capSkillCatalog(selectSkillsForPrompt(options.skills ?? [], skillContext))];
  const tools = options.tools ? [...options.tools] : undefined;
  const omitted: ContextBudgetOmission[] = [];
  const demotedBodies = new Set<string>();
  const historyCursor = { index: 0 };

  // Measure once, then subtract each dropped item's own estimate (dropNext computes it
  // with the same estimators) — avoids an O(n²) re-scan of the full keep-set per drop.
  const kept = measureAll(groups, context, skills, tools, skillContext, demotedBodies);
  while (overBudget(kept, budget)) {
    const drop = dropNext(groups, context, skills, layout, skillContext, demotedBodies, historyCursor);
    if (!drop) {
      throw new ContextBudgetError();
    }
    kept.tokens -= drop.tokenEstimate;
    kept.bytes -= drop.byteLength;
    if (omitted.length < HARD_MAX_CONTEXT_BUDGET_OMISSIONS) omitted.push(drop);
  }

  if (historyCursor.index > 0) groups.history = groups.history.slice(historyCursor.index);
  const reportOmissions = omitted.slice(0, DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS);
  return {
    groups,
    context,
    skills,
    tools,
    demotedSkillBodies: [...demotedBodies],
    report: {
      omitted: budget.reportOmissions ? reportOmissions : [],
      keptTokens: kept.tokens,
      keptBytes: kept.bytes,
      maxInputTokens: budget.maxInputTokens,
      maxInputBytes: budget.maxInputBytes,
      truncated: omitted.length > 0,
    },
  };
}

function dropNext(
  groups: {
    instructions: Message[];
    summaries: Message[];
    history: Message[];
    input: Message[];
    attachments: Message[];
    toolResults: Message[];
  },
  context: ContextBlock[],
  skills: Skill[],
  layout: InputAssemblyLayout,
  skillContext: SkillRenderContext,
  demotedBodies: Set<string>,
  historyCursor: { index: number },
): ContextBudgetOmission | undefined {
  // ponytail: drop droppable groups in layout order; within history, advance a cursor and slice once.
  // cache_aware keeps attachments longer so stable prefix stays intact while budget still allows it.
  const order =
    layout === "cache_aware"
      ? (["tool_results", "history", "summaries", "context", "skills", "attachments"] as const)
      : (["tool_results", "history", "summaries", "attachments", "context", "skills"] as const);

  for (const kind of order) {
    if (kind === "tool_results" && groups.toolResults.length > 0) {
      const message = groups.toolResults.pop()!;
      return omission("tool_results", message.id ?? toolResultId(message), message);
    }
    if (kind === "history" && historyCursor.index < groups.history.length) {
      const message = groups.history[historyCursor.index++]!;
      return omission("history", message.id, message);
    }
    if (kind === "summaries" && groups.summaries.length > 0) {
      const message = groups.summaries.pop()!;
      return omission("summaries", message.id, message);
    }
    if (kind === "attachments" && groups.attachments.length > 0) {
      const message = groups.attachments.pop()!;
      return omission("attachments", message.id, message);
    }
    if (kind === "context" && context.length > 0) {
      const index = pickVictimIndex(context, (block) => block.priority ?? 0);
      const block = context.splice(index, 1)[0]!;
      const text = `${block.title ? `${block.title}:\n` : "Context:\n"}${contextBlockText(block)}`;
      return {
        kind: "context",
        id: block.id ?? block.title,
        tokenEstimate: estimateTextTokens(text),
        byteLength: estimateTextBytes(text),
      };
    }
    if (kind === "skills" && skills.length > 0) {
      const renderContext = withDemoted(skillContext, demotedBodies);
      const demoteIndex = findSkillBodyIndex(skills, renderContext);
      if (demoteIndex !== undefined) {
        const skill = skills[demoteIndex]!;
        const beforeText = skillPromptText(skill, renderContext) ?? "";
        demotedBodies.add(skill.name);
        const afterText = skillPromptText(skill, withDemoted(skillContext, demotedBodies)) ?? "";
        return {
          kind: "skill_body",
          id: skill.name,
          tokenEstimate: estimateTextTokens(beforeText) - estimateTextTokens(afterText),
          byteLength: estimateTextBytes(beforeText) - estimateTextBytes(afterText),
        };
      }
      const index = pickVictimIndex(skills, () => 0);
      const skill = skills.splice(index, 1)[0]!;
      const text = skillPromptText(skill, withDemoted(skillContext, demotedBodies)) ?? "";
      return {
        kind: "skills",
        id: skill.name,
        tokenEstimate: estimateTextTokens(text),
        byteLength: estimateTextBytes(text),
      };
    }
  }
  return undefined;
}

function omission(kind: ContextBudgetOmissionKind, id: string | undefined, message: Message): ContextBudgetOmission {
  return {
    kind,
    id,
    tokenEstimate: estimateMessageTokens(message),
    byteLength: estimateMessageBytes(message),
  };
}

function toolResultId(message: Message): string | undefined {
  const block = message.content.find((part) => part.type === "tool_result");
  return block && block.type === "tool_result" ? block.toolCallId : undefined;
}

function measureAll(
  groups: ContextBudgetMessageGroups,
  context: readonly ContextBlock[],
  skills: readonly Skill[],
  tools: readonly ToolDefinition[] | undefined,
  skillContext: SkillRenderContext,
  demotedBodies: ReadonlySet<string>,
): { tokens: number; bytes: number } {
  const renderContext = withDemoted(skillContext, demotedBodies);
  let tokens = 0;
  let bytes = 0;
  const addMessage = (message: Message) => {
    tokens += estimateMessageTokens(message);
    bytes += estimateMessageBytes(message);
  };
  for (const message of groups.instructions) addMessage(message);
  for (const message of groups.summaries) addMessage(message);
  for (const message of groups.history) addMessage(message);
  for (const message of groups.input) addMessage(message);
  for (const message of groups.attachments) addMessage(message);
  for (const message of groups.toolResults) addMessage(message);
  for (const block of context) {
    const text = `${block.title ? `${block.title}:\n` : "Context:\n"}${contextBlockText(block)}`;
    tokens += estimateTextTokens(text);
    bytes += estimateTextBytes(text);
  }
  for (const skill of skills) {
    const text = skillPromptText(skill, renderContext) ?? "";
    tokens += estimateTextTokens(text);
    bytes += estimateTextBytes(text);
  }
  if (tools?.length) {
    const text = `Available tools:\n${tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`).join("\n")}`;
    tokens += estimateTextTokens(text);
    bytes += estimateTextBytes(text);
  }
  return { tokens, bytes };
}

function overBudget(cost: { tokens: number; bytes: number }, budget: ContextBudget): boolean {
  if (budget.maxInputTokens !== undefined && cost.tokens > budget.maxInputTokens) return true;
  if (budget.maxInputBytes !== undefined && cost.bytes > budget.maxInputBytes) return true;
  return false;
}

function assertPositiveCap(value: number, name: string, hardMax: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMax) {
    throw new TypeError(`contextBudget.${name} must be a safe integer from 1 to ${hardMax}`);
  }
}

function isContextBudgetReport(value: unknown): value is ContextBudgetReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    Array.isArray(report.omitted) &&
    typeof report.keptTokens === "number" &&
    typeof report.keptBytes === "number" &&
    typeof report.truncated === "boolean"
  );
}

function messageText(message: Message): string {
  return message.content
    .map((part) => {
      if (part.type === "text" || part.type === "thinking") return part.text;
      if (part.type === "tool_result") return JSON.stringify(part.result ?? part.error ?? null);
      if (part.type === "tool_call") return `${part.name}(${JSON.stringify(part.arguments)})`;
      if (part.type === "tool_call_delta") return `${part.name ?? "tool"}(${part.argumentsText ?? ""})`;
      if (part.type === "image") return part.url ?? part.resourceUri ?? part.mimeType ?? "[image]";
      if (part.type === "audio") return part.transcript ?? part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[audio]";
      if (part.type === "file") return part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[file]";
      if (part.type === "document") return part.transcript ?? part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[document]";
      return "[content]";
    })
    .join("\n");
}

/** Lowest priority first; equal priority → LIFO (highest index). */
function pickVictimIndex<T>(items: readonly T[], priorityOf: (item: T) => number): number {
  let best = 0;
  for (let i = 1; i < items.length; i++) {
    const pi = priorityOf(items[i]!);
    const pb = priorityOf(items[best]!);
    if (pi < pb || (pi === pb && i > best)) best = i;
  }
  return best;
}

function withDemoted(context: SkillRenderContext, demotedBodies: ReadonlySet<string>): SkillRenderContext {
  return demotedBodies.size > 0 ? { ...context, demotedBodies } : context;
}

/** Index of skill with renderable body to demote; LIFO among ties (all skills default priority 0). */
function findSkillBodyIndex(skills: readonly Skill[], renderContext: SkillRenderContext): number | undefined {
  let best: number | undefined;
  for (let i = 0; i < skills.length; i++) {
    if (!skillHasRenderableBody(skills[i]!, renderContext)) continue;
    if (best === undefined || i > best) best = i;
  }
  return best;
}

function contextBlockText(block: ContextBlock): string {
  if (typeof block.content === "string") return block.content;
  return block.content
    .map((part) => {
      if (part.type === "text" || part.type === "thinking") return part.text;
      return "[content]";
    })
    .join("\n");
}
