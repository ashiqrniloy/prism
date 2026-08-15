/** helpers (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import type {
  CompactionOptions,
  ContentBlock,
  ErrorInfo,
  Guardrails,
  Message,
  ProviderEvent,
  RetryOptions,
  TextContent,
  ToolCallContent,
  Usage,
} from "../contracts.js";
import type { AgentInput } from "../input.js";
import { createId } from "../ids.js";
import { reconstructToolCallDeltas } from "../provider-events.js";
import { singleShotLoop } from "../agent-loops.js";

export function providerContent(event: Extract<ProviderEvent, { type: "content_delta" | "tool_call" }>): ContentBlock {
  return event.type === "content_delta" ? event.content : event.call;
}

export function reconstructMissingToolCalls(
  deltas: readonly ProviderEvent[],
  calls: readonly ToolCallContent[],
): readonly ToolCallContent[] {
  if (deltas.length === 0) return [];
  const seen = new Set(calls.map((call) => call.id));
  return reconstructToolCallDeltas(deltas).filter((call) => !seen.has(call.id));
}

export function inputToMessages(input: AgentInput): Message[] {
  if (typeof input === "string") return [{ role: "user", content: [{ type: "text", text: input }] }];
  if ("role" in input) return [input];
  return [...input];
}

const steerTextEncoder = new TextEncoder();

export function messageTextBytes(message: Message): number {
  let total = 0;
  for (const block of message.content) {
    if (block.type === "text") total += steerTextEncoder.encode(block.text).byteLength;
  }
  return total;
}

const STEER_SOFT_INTERRUPT_CODE = "steer_soft_interrupt";

export class SteerSoftInterrupt extends Error {
  readonly code = STEER_SOFT_INTERRUPT_CODE;
  constructor() {
    super("Provider turn soft-interrupted by steer");
    this.name = "SteerSoftInterrupt";
  }
}

export function isSteerSoftInterrupt(error: unknown): boolean {
  return (
    error instanceof SteerSoftInterrupt ||
    (typeof error === "object" && error !== null && (error as { code?: unknown }).code === STEER_SOFT_INTERRUPT_CODE)
  );
}

export function finalAssistantMessage(history: readonly Message[]): {
  readonly message?: Message;
  readonly content: readonly ContentBlock[];
  readonly text: string;
} {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role !== "assistant") continue;
    const text = message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { message, content: message.content, text };
  }
  return { content: [], text: "" };
}
export function errorFromInfo(error: ErrorInfo): Error {
  return Object.assign(new Error(error.message), { name: error.name ?? "Error", cause: error.cause, code: error.code });
}

export class ProviderTurnFailure extends Error {
  constructor(
    readonly info: ErrorInfo,
    readonly observable: boolean,
  ) {
    super(info.message);
  }
}

export function mergeRetry(agent: false | RetryOptions | undefined, run: false | RetryOptions | undefined): RetryOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  return agent || undefined;
}

export function mergeCompaction(
  agent: false | CompactionOptions | undefined,
  run: false | CompactionOptions | undefined,
): CompactionOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  return agent || undefined;
}

/**
 * Durable-run gate: built-in option forms and the single-shot singleton are durable via the
 * pending-call mechanism; a custom strategy must declare both snapshot and restore hooks.
 */
export function isDurableLoop(loop: import("../contracts.js").AgentLoopStrategy | import("../contracts.js").AgentLoopOptions): boolean {
  if (typeof loop !== "object" || loop === null) return true;
  if ("strategy" in loop) return true;
  if (loop === singleShotLoop) return true;
  return typeof loop.snapshot === "function" && typeof loop.restore === "function";
}

export function mergeGuardrails(agent: Guardrails | undefined, run: Guardrails | undefined): Guardrails | undefined {
  if (!agent && !run) return undefined;
  return {
    input: [...(agent?.input ?? []), ...(run?.input ?? [])],
    output: [...(agent?.output ?? []), ...(run?.output ?? [])],
    toolInput: [...(agent?.toolInput ?? []), ...(run?.toolInput ?? [])],
    toolOutput: [...(agent?.toolOutput ?? []), ...(run?.toolOutput ?? [])],
    maxConcurrency: run?.maxConcurrency ?? agent?.maxConcurrency,
  };
}

export function withoutTrailingInput(messages: readonly Message[], input: readonly Message[]): Message[] {
  const next = [...messages];
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const last = next.at(-1);
    if (last && stableMessageKey(last) === stableMessageKey(input[i])) next.pop();
  }
  return next;
}

// Key-order-insensitive comparison: a redacted-then-reassembled message with reordered
// keys must still dedupe against the trailing input, or auto-compaction duplicates it.
function stableMessageKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableMessageKey).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableMessageKey(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function bridgeAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export function throwIfAborted(signal: AbortSignal): void {
  throwIfAbortedSignal(signal);
}

export function throwIfAbortedSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Agent run aborted");
}

const jsonTextEncoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  try {
    return jsonTextEncoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new TypeError("Provider request or event must be JSON-serializable for run limits");
  }
}

export function createUsageAccumulator(): { add(usage: Usage): void; value(): Usage | undefined } {
  const sums = new Map<keyof Usage, number>();
  let costCurrency: string | undefined;
  let costCompatible = true;

  return {
    add(usage) {
      for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
        const value = usage[key];
        if (value !== undefined) sums.set(key, (sums.get(key) ?? 0) + value);
      }
      const total =
        usage.totalTokens ??
        (usage.inputTokens !== undefined || usage.outputTokens !== undefined
          ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
          : undefined);
      if (total !== undefined) sums.set("totalTokens", (sums.get("totalTokens") ?? 0) + total);
      if (usage.cost !== undefined && costCompatible) {
        if (!sums.has("cost")) costCurrency = usage.currency;
        else if (usage.currency !== costCurrency) costCompatible = false;
        if (costCompatible) sums.set("cost", (sums.get("cost") ?? 0) + usage.cost);
      }
    },
    value() {
      if (sums.size === 0) return undefined;
      const usage: Record<string, number | string> = {};
      for (const [key, value] of sums) {
        if (key !== "cost" || costCompatible) usage[key] = value;
      }
      if (costCompatible && sums.has("cost") && costCurrency !== undefined) usage.currency = costCurrency;
      return Object.keys(usage).length > 0 ? (usage as Usage) : undefined;
    },
  };
}

export const randomId = createId;
