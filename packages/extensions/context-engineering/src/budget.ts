/**
 * Draft input budget (plan 158 Task 7), ported from the kernel's `src/context-budget.ts`
 * (plan 145 Task 4's "context blocks escape the context budget now" deferral closes here).
 *
 * The kernel version evicted from six named groups plus skills and context blocks; a `context.build`
 * draft is one flat message list with an addition channel for context blocks, so the port keeps the
 * same discipline over that shape:
 *
 * - The **mandatory prefix** is the leading system block (plus `draft.systemPrompt`, which replaces
 *   it). It is never dropped; when it alone exceeds the cap the transform rejects and the run fails
 *   closed, exactly as the kernel's `ContextBudgetError` did.
 * - Droppable rows are evicted oldest-first, tool results before other history, then context blocks
 *   lowest-priority-first — the kernel's drop order.
 * - Measurement counts messages, context blocks, and tool declarations with the assembler's own
 *   text shapes, so the pass sees what another `context.build` handler added before it.
 *
 * Budget-only: estimates never reach billing, provider usage, or the wire.
 */

import type { ContextBlock, Message, ToolDefinition } from "@arnilo/prism";
import { estimateMessageBytes, estimateMessageTokens, estimateTextBytes, estimateTextTokens } from "@arnilo/prism";

export type TokenEstimator = (text: string) => number;

/** Assembler-time input budget. At least one max required when present. */
export interface ContextBudget {
  readonly maxInputTokens?: number;
  readonly maxInputBytes?: number;
  readonly reportOmissions?: boolean;
}

export type ContextBudgetOmissionKind = "tool_results" | "history" | "context";

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

export const HARD_MAX_CONTEXT_BUDGET_TOKENS = 2_000_000;
export const HARD_MAX_CONTEXT_BUDGET_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS = 256;
export const HARD_MAX_CONTEXT_BUDGET_OMISSIONS = 1_024;
export const CONTEXT_BUDGET_ERROR_CODE = "context_budget_exceeded" as const;

/** The 0.12 message, kept verbatim so a host that matched on it still does. */
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

function assertPositiveCap(value: number, name: string, hardMax: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMax) {
    throw new TypeError(`contextBudget.${name} must be a safe integer from 1 to ${hardMax}`);
  }
}

/** One O(n) measurement of the whole draft. */
export function measureBudgetCost(options: {
  readonly messages: readonly Message[];
  readonly context?: readonly ContextBlock[];
  readonly tools?: readonly ToolDefinition[];
  readonly systemPrompt?: string;
}): { tokens: number; bytes: number } {
  let tokens = 0;
  let bytes = 0;
  if (options.systemPrompt !== undefined) {
    tokens += estimateTextTokens(options.systemPrompt);
    bytes += estimateTextBytes(options.systemPrompt);
  }
  for (const message of options.messages) {
    tokens += estimateMessageTokens(message);
    bytes += estimateMessageBytes(message);
  }
  for (const block of options.context ?? []) {
    const text = contextBlockMeasureText(block);
    tokens += estimateTextTokens(text);
    bytes += estimateTextBytes(text);
  }
  if (options.tools?.length) {
    const text = toolsMeasureText(options.tools);
    tokens += estimateTextTokens(text);
    bytes += estimateTextBytes(text);
  }
  return { tokens, bytes };
}

export interface ApplyDraftBudgetOptions {
  readonly messages: readonly Message[];
  readonly context?: readonly ContextBlock[];
  readonly tools?: readonly ToolDefinition[];
  readonly systemPrompt?: string;
  readonly budget: ContextBudget;
}

export interface ApplyDraftBudgetResult {
  readonly messages: readonly Message[];
  readonly context: readonly ContextBlock[];
  readonly report: ContextBudgetReport;
}

/**
 * Apply the budget to a whole draft. Throws `ContextBudgetError` when the mandatory prefix cannot
 * fit; the handler turns that into a `ctx.reject`, so the run fails closed rather than sending an
 * over-cap request.
 */
export function applyDraftBudget(options: ApplyDraftBudgetOptions): ApplyDraftBudgetResult {
  const budget = resolveContextBudget(options.budget);
  const boundary = leadingSystemCount(options.messages);
  const prefix = options.messages.slice(0, boundary);
  const droppable = [...options.messages.slice(boundary)];
  const context = [...(options.context ?? [])];
  const omitted: ContextBudgetOmission[] = [];
  const kept = measureBudgetCost({
    messages: prefix,
    context,
    tools: options.tools,
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
  });
  for (const message of droppable) {
    kept.tokens += estimateMessageTokens(message);
    kept.bytes += estimateMessageBytes(message);
  }

  const overBudget = () => {
    if (budget.maxInputTokens !== undefined && kept.tokens > budget.maxInputTokens) return true;
    if (budget.maxInputBytes !== undefined && kept.bytes > budget.maxInputBytes) return true;
    return false;
  };

  while (overBudget()) {
    const drop = dropNext(droppable, context);
    if (!drop) throw new ContextBudgetError();
    kept.tokens -= drop.tokenEstimate;
    kept.bytes -= drop.byteLength;
    if (omitted.length < HARD_MAX_CONTEXT_BUDGET_OMISSIONS) omitted.push(drop);
  }

  const reportOmissions = omitted.slice(0, DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS);
  return {
    // Identity is preserved when nothing was dropped, so a handler under budget reports "no change"
    // and the controller skips re-deriving the request.
    messages: omitted.length === 0 ? options.messages : [...prefix, ...droppable],
    context: omitted.every((omission) => omission.kind !== "context") ? (options.context ?? []) : context,
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

/** The kernel's `instructions` group: the leading run of system messages. Never dropped. */
function leadingSystemCount(messages: readonly Message[]): number {
  let index = 0;
  while (index < messages.length && messages[index]?.role === "system") index += 1;
  return index;
}

/**
 * Drop one row: tool results oldest-first, then other history oldest-first, then the lowest-priority
 * context block. `undefined` means nothing droppable is left.
 */
function dropNext(droppable: Message[], context: ContextBlock[]): ContextBudgetOmission | undefined {
  const toolResultAt = droppable.findIndex((message) => message.content.some((part) => part.type === "tool_result"));
  if (toolResultAt >= 0) {
    const message = droppable.splice(toolResultAt, 1)[0]!;
    const block = message.content.find((part) => part.type === "tool_result");
    return {
      kind: "tool_results",
      id: block?.type === "tool_result" ? block.toolCallId : message.id,
      tokenEstimate: estimateMessageTokens(message),
      byteLength: estimateMessageBytes(message),
    };
  }
  if (droppable.length > 0) {
    const message = droppable.shift()!;
    return {
      kind: "history",
      id: message.id,
      tokenEstimate: estimateMessageTokens(message),
      byteLength: estimateMessageBytes(message),
    };
  }
  if (context.length > 0) {
    const index = pickVictimIndex(context);
    const block = context.splice(index, 1)[0]!;
    const text = contextBlockMeasureText(block);
    return {
      kind: "context",
      id: block.id ?? block.title,
      tokenEstimate: estimateTextTokens(text),
      byteLength: estimateTextBytes(text),
    };
  }
  return undefined;
}

/** Lowest priority first, so a block a handler marked important survives the eviction. */
function pickVictimIndex(blocks: readonly ContextBlock[]): number {
  let victim = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (const [index, block] of blocks.entries()) {
    const priority = block.priority ?? 0;
    if (priority < lowest) {
      lowest = priority;
      victim = index;
    }
  }
  return victim;
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

function contextBlockMeasureText(block: ContextBlock): string {
  return `${block.title ? `${block.title}:\n` : "Context:\n"}${contextBlockText(block)}`;
}

function toolsMeasureText(tools: readonly ToolDefinition[]): string {
  return `Available tools:\n${tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`).join("\n")}`;
}
