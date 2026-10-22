/** Input estimation residue (plan 158 Task 8). The kernel's own accounting: the usage seam
 *  (`provider-round.ts`), the compaction trigger (`contracts-core/compaction.ts`), skill disclosure,
 *  and the context meter all measure with these helpers, so they stay in the kernel after the
 *  context-engineering stages moved to `@arnilo/prism-context-engineering`.
 *
 *  Nothing here decides anything: every function returns a number or a cap. The stages that act on
 *  those numbers are package `context.build` handlers, which import these estimators from
 *  `@arnilo/prism`. */
import type { ContextBlock, Message, ModelConfig, TokenEstimate, ToolDefinition } from "../contracts.js";
import { estimateTextTokensForFamily, MODEL_FAMILY_TOKENS, resolveModelFamily } from "../usage-estimation.js";

/**
 * Host-supplied token estimator. Budget-only: it never reaches billing, provider
 * usage, or the wire — it decides what a caller evicts and nothing else.
 */
export type TokenEstimator = (text: string) => number;

/** Input-cap resolution inputs: a host cap, or the model window minus headroom. */
export interface InputCapOptions {
  /** Host cap; when set it wins over `model.limits.contextWindow`. */
  readonly maxInputTokens?: number;
  /** Output + next-turn headroom subtracted from the window (default 1024). */
  readonly reserveTokens?: number;
}

/** Default headroom subtracted from a model window when a caller derives an input cap. */
export const DEFAULT_INPUT_RESERVE_TOKENS = 1_024;

/** UTF-16 code units / 4. Estimate only — not billing. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateTextBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function estimateMessageTokens(message: Message, estimateTokens?: TokenEstimator): number;
export function estimateMessageTokens(messages: readonly Message[], modelFamily?: string): TokenEstimate;
/**
 * Single message → flattened text → estimator (accounting, never billing).
 *
 * A message array plus a model id, provider id, or family name returns a labeled
 * {@link TokenEstimate}. It reuses this same per-message flattening and adds the family's
 * per-message chat-template overhead; `unknown` families fall back to the conservative table with
 * `lowConfidence: true`.
 */
export function estimateMessageTokens(
  input: Message | readonly Message[],
  estimatorOrFamily?: TokenEstimator | string,
): number | TokenEstimate {
  if (isMessageArray(input)) {
    const family = resolveModelFamily(estimatorOrFamily as string | undefined);
    const table = MODEL_FAMILY_TOKENS[family];
    let tokens = table.perMessageOverhead * input.length;
    for (const message of input) tokens += estimateTextTokensForFamily(messageText(message), family);
    return { tokens, confidence: table.confidence, lowConfidence: table.confidence === "low" };
  }
  const estimateTokens = typeof estimatorOrFamily === "function" ? estimatorOrFamily : estimateTextTokens;
  return estimateTokens(messageText(input));
}

function isMessageArray(value: Message | readonly Message[]): value is readonly Message[] {
  return Array.isArray(value);
}

export function estimateMessageBytes(message: Message): number {
  return estimateTextBytes(messageText(message));
}

export function estimateAssemblyTokens(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

/** Tool declarations and context blocks projected with the assembler's own `measureAll` text
 *  shapes, so the usage-fallback estimate and any package stage cannot drift (never
 *  `JSON.stringify` of the raw schemas). */
export function estimateRequestExtrasTokens(
  tools: readonly ToolDefinition[] | undefined,
  context: readonly ContextBlock[] | undefined,
  estimateTokens: TokenEstimator,
): number {
  let tokens = 0;
  if (context?.length) for (const block of context) tokens += estimateTokens(contextBlockMeasureText(block));
  if (tools?.length) tokens += estimateTokens(toolsMeasureText(tools));
  return tokens;
}

/** Resolve a per-request input cap: host `maxInputTokens` wins; otherwise
 *  `contextWindow - (maxOutputTokens ?? 0) - reserve`. Throws when no cap can be derived, so a
 *  caller that needs one fails at config time rather than on the turn that first measures. */
export function resolveInputCap(options: InputCapOptions = {}, model?: Pick<ModelConfig, "limits">): number {
  const reserveTokens = resolveReserveTokens(options.reserveTokens);
  if (options.maxInputTokens !== undefined) {
    if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1) {
      throw new TypeError("resolveInputCap maxInputTokens must be a positive safe integer");
    }
    return options.maxInputTokens;
  }
  const window = model?.limits?.contextWindow;
  if (!Number.isSafeInteger(window) || (window as number) <= 0) {
    throw new TypeError("resolveInputCap requires maxInputTokens or model.limits.contextWindow");
  }
  const maxOutputTokens = model?.limits?.maxOutputTokens;
  if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0)) {
    throw new TypeError("resolveInputCap requires model.limits.maxOutputTokens to be a non-negative safe integer");
  }
  const cap = (window as number) - (maxOutputTokens ?? 0) - reserveTokens;
  if (cap <= 0) {
    throw new TypeError(`resolveInputCap resolved a non-positive input cap (${cap}): raise contextWindow or lower reserveTokens`);
  }
  return cap;
}

function resolveReserveTokens(value: unknown): number {
  if (value === undefined) return DEFAULT_INPUT_RESERVE_TOKENS;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("resolveInputCap reserveTokens must be a non-negative safe integer");
  }
  return value as number;
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
