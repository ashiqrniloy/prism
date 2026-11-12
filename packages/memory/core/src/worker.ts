/**
 * The bounded model-worker loop and its limits (plan 216 Task 3): shared by the session tiers, the LTM and the wiki,
 * so the wiki does not depend on the memory system. Moved unchanged from `@arnilo/prism-memory-system`; only
 * the error classes are core's own (`MemoryWorkerError`, `MemoryWorkerLimitError`).
 */
import type { JsonObject, Message, ModelClient, ProviderRequestOptions, ToolCallContent, ToolDefinition, ToolResult } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";
import { applyDefaultProviderRequestOptions, applyThinkingLevelForModel } from "@arnilo/prism/provider-kit";
import { MemoryError } from "./errors.js";

/** A worker loop failure the caller can tell from a provider failure without parsing messages. */
export class MemoryWorkerError extends MemoryError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "MemoryWorkerError";
  }
}

/** The worker loop hit one of its byte, turn or call limits. */
export class MemoryWorkerLimitError extends MemoryWorkerError {
  constructor(message: string) {
    super("limit", message);
    this.name = "MemoryWorkerLimitError";
  }
}

export const DEFAULT_MAX_WORKER_TURNS = 16;
export const HARD_MAX_WORKER_TURNS = 64;
export const DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN = 32;
export const HARD_MAX_WORKER_TOOL_CALLS_PER_TURN = 256;
export const DEFAULT_MAX_WORKER_TOOL_CALLS = 128;
export const HARD_MAX_WORKER_TOOL_CALLS = 1024;
export const DEFAULT_MAX_WORKER_ARGUMENT_BYTES = 64 * 1024;
export const HARD_MAX_WORKER_ARGUMENT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_WORKER_RESULT_BYTES = 64 * 1024;
export const HARD_MAX_WORKER_RESULT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_WORKER_MESSAGE_BYTES = 1024 * 1024;
export const HARD_MAX_WORKER_MESSAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_WORKER_ERROR_BYTES = 1024;
export const HARD_MAX_WORKER_ERROR_BYTES = 8 * 1024;
export const DEFAULT_MAX_TASK_STATE_BYTES = 2048;
export const HARD_MAX_TASK_STATE_BYTES = 64 * 1024;
const MAX_WORKER_JSON_DEPTH = 64;

export interface MemoryWorkerLimitOptions {
  readonly maxTurns?: number;
  readonly maxToolCallsPerTurn?: number;
  readonly maxToolCalls?: number;
  readonly maxArgumentBytes?: number;
  readonly maxResultBytes?: number;
  readonly maxMessageBytes?: number;
  readonly maxTaskStateBytes?: number;
  readonly maxErrorBytes?: number;
}

export interface ResolvedMemoryWorkerLimits {
  readonly maxTurns: number;
  readonly maxToolCallsPerTurn: number;
  readonly maxToolCalls: number;
  readonly maxArgumentBytes: number;
  readonly maxResultBytes: number;
  readonly maxMessageBytes: number;
  readonly maxTaskStateBytes: number;
  readonly maxErrorBytes: number;
}

const SPECS = {
  maxTaskStateBytes: [DEFAULT_MAX_TASK_STATE_BYTES, HARD_MAX_TASK_STATE_BYTES],
  maxTurns: [DEFAULT_MAX_WORKER_TURNS, HARD_MAX_WORKER_TURNS],
  maxToolCallsPerTurn: [DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN, HARD_MAX_WORKER_TOOL_CALLS_PER_TURN],
  maxToolCalls: [DEFAULT_MAX_WORKER_TOOL_CALLS, HARD_MAX_WORKER_TOOL_CALLS],
  maxArgumentBytes: [DEFAULT_MAX_WORKER_ARGUMENT_BYTES, HARD_MAX_WORKER_ARGUMENT_BYTES],
  maxResultBytes: [DEFAULT_MAX_WORKER_RESULT_BYTES, HARD_MAX_WORKER_RESULT_BYTES],
  maxMessageBytes: [DEFAULT_MAX_WORKER_MESSAGE_BYTES, HARD_MAX_WORKER_MESSAGE_BYTES],
  maxErrorBytes: [DEFAULT_MAX_WORKER_ERROR_BYTES, HARD_MAX_WORKER_ERROR_BYTES],
} as const;

export function resolveMemoryWorkerLimits(input: MemoryWorkerLimitOptions = {}): ResolvedMemoryWorkerLimits {
  return Object.fromEntries(
    Object.entries(SPECS).map(([name, [fallback, hardCap]]) => {
      const value = input[name as keyof MemoryWorkerLimitOptions] ?? fallback;
      if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
        throw new RangeError(`${name} must be a positive safe integer at most ${hardCap}`);
      }
      return [name, value];
    }),
  ) as unknown as ResolvedMemoryWorkerLimits;
}

export function measureWorkerJson(value: unknown, maxBytes: number, label: string): number {
  const active = new WeakSet<object>();
  let bytes = 0;
  const add = (amount: number): void => {
    bytes += amount;
    if (bytes > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  };
  const walk = (current: unknown, depth: number): void => {
    if (depth > MAX_WORKER_JSON_DEPTH) throw new Error(`${label} exceeds JSON depth ${MAX_WORKER_JSON_DEPTH}`);
    if (current === null) return add(4);
    if (typeof current === "string") return add(Buffer.byteLength(JSON.stringify(current), "utf8"));
    if (typeof current === "boolean") return add(current ? 4 : 5);
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error(`${label} contains a non-finite number`);
      return add(Buffer.byteLength(String(current), "utf8"));
    }
    if (!current || typeof current !== "object") throw new Error(`${label} contains a non-JSON value`);
    if (active.has(current)) throw new Error(`${label} contains a cycle`);
    active.add(current);
    try {
      if (Array.isArray(current)) {
        add(2);
        for (let index = 0; index < current.length; index += 1) {
          if (index) add(1);
          walk(current[index] ?? null, depth + 1);
        }
        return;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} contains a non-JSON object`);
      add(2);
      let count = 0;
      for (const key in current as Record<string, unknown>) {
        if (!Object.hasOwn(current, key)) continue;
        const item = (current as Record<string, unknown>)[key];
        if (item === undefined) continue;
        if (count++) add(1);
        add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        walk(item, depth + 1);
      }
    } finally {
      active.delete(current);
    }
  };
  walk(value, 0);
  return bytes;
}

export function joinWorkerText(parts: Iterable<string>, maxBytes: number, label: string): string {
  let output = "";
  for (const part of parts) {
    const nextBytes = Buffer.byteLength(output, "utf8") + (output ? 1 : 0) + Buffer.byteLength(part, "utf8");
    if (nextBytes > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
    output += `${output ? "\n" : ""}${part}`;
  }
  return output;
}

export function truncateWorkerText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1]!)) low -= 1;
  return text.slice(0, low);
}

export interface MemoryWorkerLoopOptions extends MemoryWorkerLimitOptions {
  /**
   * The model call. `prism.models.client(ref)` outside a package, or a client built over the host's
   * own provider. The worker never resolves a provider or a credential itself.
   */
  readonly client: ModelClient;
  readonly system: string;
  readonly prompt: string;
  readonly tools: readonly ToolDefinition[];
  readonly maxTurns: number;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly sessionId?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
  /**
   * What a tool call past `maxToolCallsPerTurn` or `maxToolCalls` does. `"fail"` (the default) throws a
   * `MemoryWorkerLimitError` and the whole loop fails, for workers whose contract is an exact number of calls.
   * `"refuse"` does not run the extra call and answers it with a `tool_call_limit` error result, so the calls within
   * the limits keep their effect: past the per-turn limit the model may repeat the call next turn; past the total
   * limit the loop ends after this turn. Byte limits still fail either way.
   */
  readonly onToolCallLimit?: "fail" | "refuse";
  /**
   * End the loop after a turn whose tool calls all ran without an error result, an `{ ok: false }` value or a
   * `warning` (none refused) and whose reply did not stop on the output limit, instead of asking the model again. A recording worker's next turn after a clean
   * turn is almost always a closing reply with no call (plan 217 Task 6: a third of the STM worker's input).
   * Default `false`.
   */
  readonly endAfterCleanTurn?: boolean;
}

/** The error result of a call `onToolCallLimit: "refuse"` did not run. */
export const MEMORY_WORKER_TOOL_CALL_LIMIT = "tool_call_limit";

/**
 * The error result of a call to a tool name the worker was not given (plan 218 Task 1.1). It is refused in the same
 * turn for every worker, whatever `onToolCallLimit` says, and counts toward the call limits.
 */
export const MEMORY_WORKER_UNKNOWN_TOOL = "unknown_tool";

/** How a worker loop ended (plan 218 Task 6). */
export interface MemoryWorkerLoopResult {
  /**
   * The last turn stopped on the model's output limit with no tool call: the model spent its output (often on
   * reasoning) before writing anything. A caller may retry with less to do; the loop itself never does.
   */
  readonly endedAtOutputCap: boolean;
}

export async function runMemoryWorkerLoop(options: MemoryWorkerLoopOptions): Promise<MemoryWorkerLoopResult> {
  throwIfAborted(options.signal);
  const limits = resolveMemoryWorkerLimits(options);
  const secrets = options.secrets ?? [];
  const messages: Message[] = [];
  let messageBytes = 2;
  const measure = (value: unknown, maxBytes: number, label: string): number => {
    try {
      return measureWorkerJson(value, maxBytes, label);
    } catch (error) {
      throw new MemoryWorkerLimitError(error instanceof Error ? error.message : "Observational memory worker limit exceeded");
    }
  };
  const messageSize = (message: Message): number => {
    const bytes = measure(message, limits.maxMessageBytes, "Observational memory worker message");
    const next = messageBytes + (messages.length ? 1 : 0) + bytes;
    if (next > limits.maxMessageBytes)
      throw new MemoryWorkerLimitError(`Observational memory worker messages exceed ${limits.maxMessageBytes} bytes`);
    return next;
  };
  const addMessage = (message: Message): void => {
    messageBytes = messageSize(message);
    messages.push(message);
  };
  addMessage({ role: "system", content: [{ type: "text", text: redactSecrets(options.system, secrets) }] });
  addMessage({ role: "user", content: [{ type: "text", text: redactSecrets(options.prompt, secrets) }] });

  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const refuse = options.onToolCallLimit === "refuse";
  // Plan 217 Task 6.1: a `provider/model` ref carries no description of its own, so the thinking level is mapped
  // against the provider's description of the model (`client.resolve`), or nothing reaches the wire.
  const thinkingModel = options.thinkingLevel ? ((await options.client.resolve?.()) ?? options.client.model) : options.client.model;
  let totalCalls = 0;
  for (let turn = 0; turn < limits.maxTurns; turn += 1) {
    const calls: {
      readonly raw: ToolCallContent;
      readonly safe: ToolCallContent;
      readonly refused?: string;
      readonly refusedCode?: string;
    }[] = [];
    let stopReason: string | undefined;
    try {
      throwIfAborted(options.signal);
      const request = applyDefaultProviderRequestOptions(
        {
          model: options.client.model,
          messages,
          tools: options.tools,
          // Model-aware adapter: stamped/heuristic family per model; non-reasoning
          // models get no invented field (omitted, not guessed).
          options: options.thinkingLevel
            ? applyThinkingLevelForModel(options.providerOptions, options.thinkingLevel, thinkingModel)
            : options.providerOptions,
          signal: options.signal,
        },
        { sessionId: options.sessionId },
      );
      for await (const event of options.client.generate({
        messages: request.messages,
        tools: request.tools,
        options: request.options,
        signal: request.signal,
      })) {
        throwIfAborted(options.signal);
        if (event.type === "error") throw new Error(safeWorkerError(event.error, secrets, limits.maxErrorBytes));
        if (event.type === "done") stopReason = event.stopReason;
        if (event.type !== "tool_call") continue;
        let refused: string | undefined;
        if (calls.length >= limits.maxToolCallsPerTurn) {
          if (!refuse)
            throw new MemoryWorkerLimitError(`Observational memory worker exceeds ${limits.maxToolCallsPerTurn} tool calls per turn`);
          refused = `per-turn limit of ${limits.maxToolCallsPerTurn} tool calls reached; this call was not run. Repeat it in your next turn.`;
        }
        totalCalls += 1;
        if (totalCalls > limits.maxToolCalls) {
          if (!refuse) throw new MemoryWorkerLimitError(`Observational memory worker exceeds ${limits.maxToolCalls} total tool calls`);
          refused = `total limit of ${limits.maxToolCalls} tool calls reached; this call was not run.`;
        }
        measure(event.call, limits.maxMessageBytes, "Observational memory tool call");
        measure(event.call.arguments, limits.maxArgumentBytes, "Observational memory tool arguments");
        let safe = redactSecrets(event.call, secrets);
        measure(safe.arguments, limits.maxArgumentBytes, "Redacted observational memory tool arguments");
        // Plan 218 Task 1.1: a name the worker was not given is refused with an `unknown_tool` result, not a failed
        // pass, so the calls that were valid keep their effect. It counted toward the caps above.
        let refusedCode = refused ? MEMORY_WORKER_TOOL_CALL_LIMIT : undefined;
        if (!tools.has(event.call.name)) {
          const name = truncateWorkerText(safe.name, limits.maxErrorBytes);
          safe = { ...safe, name };
          if (!refused) {
            refusedCode = MEMORY_WORKER_UNKNOWN_TOOL;
            refused = `${name} is not a tool here; tools: ${[...tools.keys()].join(", ")}`;
          }
        }
        messageSize({ role: "assistant", content: [...calls.map((call) => call.safe), safe] });
        calls.push({ raw: event.call, safe, ...(refused && refusedCode ? { refused, refusedCode } : {}) });
      }
    } catch (error) {
      throwIfAborted(options.signal);
      if (error instanceof MemoryWorkerError) throw error;
      throw new Error(safeWorkerError(error, secrets, limits.maxErrorBytes));
    }

    if (!calls.length) return { endedAtOutputCap: stopReason === "max_output_tokens" };
    addMessage({ role: "assistant", content: calls.map((call) => call.safe) });
    let clean = !calls.some((call) => call.refused) && stopReason !== "max_output_tokens";
    for (const call of calls) {
      if (call.refused) {
        addMessage(
          toolResultMessage(call.safe, { error: { code: call.refusedCode ?? MEMORY_WORKER_TOOL_CALL_LIMIT, message: call.refused } }),
        );
        continue;
      }
      const tool = tools.get(call.raw.name)!;
      let result: ToolResult;
      try {
        result = await tool.execute(call.raw.arguments as JsonObject, {
          sessionId: "observational-memory",
          runId: "observational-memory",
          toolCallId: call.raw.id,
          signal: options.signal,
        });
      } catch (error) {
        throwIfAborted(options.signal);
        throw new Error(safeWorkerError(error, secrets, limits.maxErrorBytes));
      }
      measure(result, limits.maxResultBytes, "Observational memory tool result");
      // A tool that refused its input answers `{ ok: false }` or an error, and one that changed it adds a `warning`: the
      // model gets a turn to see it.
      const value = result.value && typeof result.value === "object" ? (result.value as { ok?: unknown; warning?: unknown }) : undefined;
      if (result.error || value?.ok === false || value?.warning !== undefined) clean = false;
      const payload = { result: result.value, error: result.error };
      measure(payload, limits.maxResultBytes, "Observational memory tool result payload");
      const safePayload = redactSecrets(payload, secrets);
      measure(safePayload, limits.maxResultBytes, "Redacted observational memory tool result");
      addMessage(toolResultMessage(call.safe, safePayload));
    }
    // Past the total limit nothing more can run: the calls within the limits keep their effect and the loop ends.
    if (refuse && totalCalls >= limits.maxToolCalls) return { endedAtOutputCap: false };
    if (options.endAfterCleanTurn && clean) return { endedAtOutputCap: false };
  }
  return { endedAtOutputCap: false };
}

function toolResultMessage(call: ToolCallContent, payload: { readonly result?: unknown; readonly error?: ToolResult["error"] }): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: call.id, name: call.name, result: payload.result, error: payload.error }],
  };
}

function safeWorkerError(error: unknown, secrets: readonly (string | undefined)[], maxBytes: number): string {
  const message = error instanceof Error ? error.message : "Observational memory worker failed";
  return truncateWorkerText(redactSecrets(message, secrets), maxBytes) || "Observational memory worker failed";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Observational memory worker aborted");
}
