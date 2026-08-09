import type { Message, ToolResult } from "./contracts.js";
import { estimateTextBytes } from "./context-budget.js";

export const DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS = 2;
export const DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES = 4_096;
export const DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES = 512;
export const HARD_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES = 4_096;

export const TOOL_RESULT_FOLD_TURN_METADATA_KEY = "prismToolResultTurn" as const;

export interface ToolResultFoldInput {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly text: string;
}

export interface ToolResultFoldOptions {
  readonly minAgeTurns?: number;
  readonly minBytes?: number;
  readonly maxSummaryBytes?: number;
  readonly summarize: (input: ToolResultFoldInput) => Promise<string> | string;
}

export interface ResolvedToolResultFoldOptions {
  readonly minAgeTurns: number;
  readonly minBytes: number;
  readonly maxSummaryBytes: number;
  readonly summarize: (input: ToolResultFoldInput) => Promise<string> | string;
}

export interface FoldToolResultsContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;
  readonly signal?: AbortSignal;
}

/** Run overrides agent; disabled when neither supplies `summarize`. */
export function resolveToolResultFold(
  run?: ToolResultFoldOptions,
  agent?: ToolResultFoldOptions,
): ResolvedToolResultFoldOptions | undefined {
  const options = run ?? agent;
  if (!options?.summarize) return undefined;
  const minAgeTurns = options.minAgeTurns ?? DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS;
  const minBytes = options.minBytes ?? DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES;
  const maxSummaryBytes = options.maxSummaryBytes ?? DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES;
  assertPositiveInt(minAgeTurns, "minAgeTurns", 1, 1_024);
  assertPositiveInt(minBytes, "minBytes", 1, 32 * 1024 * 1024);
  assertPositiveInt(maxSummaryBytes, "maxSummaryBytes", 1, HARD_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES);
  return {
    minAgeTurns,
    minBytes,
    maxSummaryBytes,
    summarize: options.summarize,
  };
}

/** Projection-only fold for history tool messages; does not mutate the input array. */
export async function foldToolResultHistory(
  history: readonly Message[],
  options: ResolvedToolResultFoldOptions,
  context: FoldToolResultsContext,
): Promise<readonly Message[]> {
  if (history.length === 0) return history;
  const turns = inferToolResultTurns(history);
  const out: Message[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]!;
    const folded = await foldToolResultMessage(message, options, {
      ...context,
      toolResultTurn: turns[index] ?? context.turn,
    });
    out.push(folded);
  }
  return out;
}

/** Projection-only fold for in-flight tool results before message conversion. */
export async function foldToolResults(
  results: readonly ToolResult[],
  options: ResolvedToolResultFoldOptions,
  context: FoldToolResultsContext,
): Promise<readonly ToolResult[]> {
  if (results.length === 0) return results;
  const out: ToolResult[] = [];
  for (const result of results) {
    const folded = await foldToolResultValue(result, options, {
      ...context,
      toolResultTurn: context.turn,
    });
    out.push(folded);
  }
  return out;
}

async function foldToolResultMessage(
  message: Message,
  options: ResolvedToolResultFoldOptions,
  context: FoldToolResultsContext & { readonly toolResultTurn: number },
): Promise<Message> {
  if (message.role !== "tool") return message;
  const block = message.content.find((part) => part.type === "tool_result");
  if (!block || block.type !== "tool_result") return message;
  const text = toolResultText(block.result, block.error, message.content);
  const folded = await maybeFold({
    options,
    context,
    toolCallId: block.toolCallId,
    toolName: block.name,
    text,
    apply: (summary) => ({
      ...message,
      content: message.content.map((part) =>
        part.type === "tool_result"
          ? {
              ...part,
              result: foldedToolResultHeader(block.name, block.toolCallId, summary),
              error: undefined,
            }
          : part,
      ),
      metadata: { ...message.metadata, prismFolded: true },
    }),
  });
  return folded ?? message;
}

async function foldToolResultValue(
  result: ToolResult,
  options: ResolvedToolResultFoldOptions,
  context: FoldToolResultsContext & { readonly toolResultTurn: number },
): Promise<ToolResult> {
  const text = toolResultText(result.value, result.error, result.content);
  const folded = await maybeFold({
    options,
    context,
    toolCallId: result.toolCallId,
    toolName: result.name,
    text,
    apply: (summary) => ({
      ...result,
      value: foldedToolResultHeader(result.name, result.toolCallId, summary),
      error: undefined,
      metadata: { ...result.metadata, prismFolded: true },
    }),
  });
  return folded ?? result;
}

async function maybeFold<T>(input: {
  readonly options: ResolvedToolResultFoldOptions;
  readonly context: FoldToolResultsContext & {
    readonly toolResultTurn: number;
  };
  readonly toolCallId: string;
  readonly toolName: string;
  readonly text: string;
  readonly apply: (summary: string) => T;
}): Promise<T | undefined> {
  const age = input.context.turn - input.context.toolResultTurn;
  if (age < input.options.minAgeTurns) return undefined;
  if (estimateTextBytes(input.text) < input.options.minBytes) return undefined;
  throwIfAborted(input.context.signal);
  try {
    const summary = await input.options.summarize({
      sessionId: input.context.sessionId,
      runId: input.context.runId,
      turn: input.context.toolResultTurn,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      text: input.text,
    });
    return input.apply(capSummaryBytes(String(summary), input.options.maxSummaryBytes));
  } catch {
    return undefined;
  }
}

export function formatFoldedToolResult(summary: string): string {
  return summary;
}

export function foldedToolResultHeader(toolName: string, toolCallId: string, summary: string): string {
  return `Tool result ${toolName} [${toolCallId}]: ${summary}`;
}

function toolResultText(result: unknown, error: unknown, extra?: readonly { readonly type: string }[]): string {
  const parts = [JSON.stringify(error ?? result ?? null)];
  for (const block of extra ?? []) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function capSummaryBytes(summary: string, maxBytes: number): string {
  const bytes = estimateTextBytes(summary);
  if (bytes <= maxBytes) return summary;
  const encoded = new TextEncoder().encode(summary);
  const suffix = new TextEncoder().encode("…");
  let end = Math.max(0, maxBytes - suffix.length);
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.slice(0, end)) + "…";
}

function inferToolResultTurns(history: readonly Message[]): readonly number[] {
  const turns: number[] = new Array(history.length).fill(1);
  let providerTurn = 0;
  let toolTurn = 1;
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]!;
    const stamped = readToolResultTurn(message.metadata);
    if (message.role === "assistant") {
      providerTurn += 1;
      toolTurn = providerTurn;
    }
    if (message.role === "tool") {
      turns[index] = stamped ?? toolTurn;
    }
  }
  return turns;
}

function readToolResultTurn(metadata: Readonly<Record<string, unknown>> | undefined): number | undefined {
  const value = metadata?.[TOOL_RESULT_FOLD_TURN_METADATA_KEY];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function assertPositiveInt(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`toolResultFold.${name} must be a safe integer from ${min} to ${max}`);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Tool result fold aborted");
}
