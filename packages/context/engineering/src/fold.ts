import type { Message, } from "@arnilo/prism";
import { estimateTextBytes } from "@arnilo/prism";

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

async function foldToolResultMessage(
  message: Message,
  options: ResolvedToolResultFoldOptions,
  context: FoldToolResultsContext & { readonly toolResultTurn: number },
): Promise<Message> {
  if (message.role !== "tool") return message;
  const block = message.content.find((part) => part.type === "tool_result");
  if (block?.type !== "tool_result") return message;
  const text = toolResultFoldText(block.result, block.error, message.content);
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
    return input.apply(capToolResultSummary(String(summary), input.options.maxSummaryBytes));
  } catch {
    return undefined;
  }
}

/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export function formatFoldedToolResult(summary: string): string {
  return summary;
}

export function foldedToolResultHeader(toolName: string, toolCallId: string, summary: string): string {
  return `Tool result ${toolName} [${toolCallId}]: ${summary}`;
}

/** Text the fold summarizes for one tool result: the payload JSON, then any text blocks.
 *  Shared with the attention compiler so both hash/summarize the same bytes. */
export function toolResultFoldText(result: unknown, error: unknown, extra?: readonly { readonly type: string }[]): string {
  const parts = [JSON.stringify(error ?? result ?? null)];
  for (const block of extra ?? []) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

/** UTF-8 cap that never splits a multi-byte character. Shared with the attention
 *  compiler's host-summarize path so both cap host text identically. */
export function capToolResultSummary(summary: string, maxBytes: number): string {
  const bytes = estimateTextBytes(summary);
  if (bytes <= maxBytes) return summary;
  const encoded = new TextEncoder().encode(summary);
  const suffix = new TextEncoder().encode("…");
  let end = Math.max(0, maxBytes - suffix.length);
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return `${new TextDecoder().decode(encoded.slice(0, end))}…`;
}

/** Provider turn per history index: assistant messages advance the turn, tool rows use
 *  their `prismToolResultTurn` stamp when present and the last assistant turn otherwise.
 *  Shared with the attention compiler so age gates match the fold exactly. */
export function inferToolResultTurns(history: readonly Message[]): readonly number[] {
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

/* ------------------------------------------------------------------------------------------------
 * Summarize strategies (plan 158 Task 7). The kernel option was a host function; package config is
 * JSON, so the package ships the two shapes a config can name. A host that needs something else
 * registers its own `context.build` handler or uses the library's function option.
 * ------------------------------------------------------------------------------------------------ */

/** `fold.summarize: "truncate"` — the deterministic projection: the head of the payload, which the
 *  fold then caps at `maxSummaryBytes` without splitting a multi-byte character. No model call. */
export function truncateSummarize(input: ToolResultFoldInput): string {
  return input.text;
}

export interface ModelSummarizeOptions {
  /** Resolved by the package through `prism.models.client(fold.summarize.model)`. */
  readonly client: {
    generate(request: {
      readonly messages: readonly Message[];
      readonly signal?: AbortSignal;
    }): AsyncIterable<{ readonly type: string; readonly content?: { readonly type: string; readonly text?: string }; readonly error?: unknown }>;
  };
  /** Byte cap on the summary; the provider stream is aborted once it is reached. */
  readonly maxSummaryBytes: number;
  /** Prepended to the payload. Default {@link DEFAULT_FOLD_SUMMARY_INSTRUCTION}. */
  readonly instruction?: string;
}

export const DEFAULT_FOLD_SUMMARY_INSTRUCTION =
  "Summarize this tool result for a later turn. Keep identifiers, file paths, and outcomes; drop formatting noise. Answer with the summary only.";

/**
 * `fold.summarize: { model }` — one model call per newly folded result. Bounded twice: the provider
 * stream is aborted as soon as `maxSummaryBytes` is reached, and the fold caps the returned string
 * again, so a runaway provider cannot inflate the request.
 */
export function createModelSummarize(options: ModelSummarizeOptions): (input: ToolResultFoldInput) => Promise<string> {
  const instruction = options.instruction ?? DEFAULT_FOLD_SUMMARY_INSTRUCTION;
  return async (input) => {
    const parts: string[] = [];
    let retainedBytes = 0;
    for await (const event of options.client.generate({
      messages: [{ role: "user", content: [{ type: "text", text: `${instruction}\n\n${input.toolName} (${input.toolCallId}):\n${input.text}` }] }],
    })) {
      if (event.type === "error") throw new Error("tool result fold: provider error");
      if (event.type !== "content_delta" || event.content?.type !== "text" || typeof event.content.text !== "string") continue;
      parts.push(event.content.text);
      retainedBytes += estimateTextBytes(event.content.text);
      if (retainedBytes >= options.maxSummaryBytes) break;
    }
    return capToolResultSummary(parts.join(""), options.maxSummaryBytes);
  };
}
