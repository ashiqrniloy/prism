import type { AgentInput } from "./input.js";
import { inputMessages } from "./input.js";
import { createId } from "./ids.js";
import type {
  AgentEvent,
  AgentLoopOptions,
  AgentLoopStrategy,
  ArtifactContext,
  ArtifactParser,
  ArtifactRepairer,
  ArtifactValidation,
  ArtifactValidator,
  LoopContext,
  Message,
  TextContent,
  ToolCallContent,
  ToolResult,
  Usage,
} from "./contracts.js";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Agent run aborted");
}

function toolResultMessage(result: ToolResult): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: result.toolCallId, name: result.name, result: result.value, error: result.error }, ...(result.content ?? [])],
    metadata: result.metadata,
  };
}

// ponytail: SingleShotLoop extracted bit-for-bit from the former inline turn
// loop in RuntimeAgentSession.run. The runtime owns provider calls, retry,
// abort, store, events via LoopContext; this only orchestrates turns. Phase 28
// fires artifact_* events here as a noop seam — single-shot emits zero.
export const singleShotLoop: AgentLoopStrategy = {
  name: "single-shot",
  async run(ctx: LoopContext): Promise<Usage | undefined> {
    let usage: Usage | undefined;
    let toolRounds = 0;
    let nextInput: AgentInput = ctx.input;

    for (let turn = 1; ; turn += 1) {
      throwIfAborted(ctx.signal);
      ctx.emit({ type: "turn_started", sessionId: ctx.sessionId, runId: ctx.runId, turn });
      const request = await ctx.assemble(nextInput, undefined, turn);
      throwIfAborted(ctx.signal);
      const { content, calls, messageId, started, usage: turnUsage } = await ctx.generate(request);
      usage = turnUsage ?? usage;

      if (turn === 1) ctx.history.push(...ctx.inputMessages);
      if (started) {
        const message: Message = { id: messageId, role: "assistant", content };
        ctx.history.push(message);
        await ctx.appendMessage(message);
        ctx.emit({ type: "message_finished", sessionId: ctx.sessionId, runId: ctx.runId, message });
      }
      ctx.emit({ type: "turn_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn });

      if (calls.length === 0 || toolRounds >= ctx.maxToolRounds) break;
      toolRounds += 1;
      await dispatchToolCallsInOrder(calls, ctx);
      nextInput = [];
    }
    return usage;
  },
};

export function isAgentLoopOptions(value: AgentLoopStrategy | AgentLoopOptions | undefined): value is AgentLoopOptions {
  return typeof value === "object" && value !== null && "strategy" in value;
}

function defaultRepairer<T>(): ArtifactRepairer<T> {
  return (_value, failure) => ({
    role: "user",
    content: [{ type: "text", text: failure.errors?.map((e) => e.message).join("\n") ?? "invalid artifact" }],
  });
}

// ponytail: GenerateValidateReviseLoop reuses LoopContext primitives only —
// no provider/retry/store/event re-implementation. Bounded artifact tools use
// same dispatcher at concurrency one; add parallelism only with ordering need.
export function generateValidateReviseLoop(opts: {
  readonly validator: ArtifactValidator<unknown>;
  readonly parser?: ArtifactParser<unknown>;
  readonly repairer?: ArtifactRepairer<unknown>;
  readonly maxRevisions?: number;
  readonly toolCalls?: "disabled" | "bounded";
}): AgentLoopStrategy {
  const max = opts.maxRevisions ?? 3;
  const repairer = opts.repairer ?? defaultRepairer<unknown>();
  return {
    name: "generate-validate-revise",
    async run(ctx: LoopContext): Promise<Usage | undefined> {
      let usage: Usage | undefined;
      let nextInput: AgentInput = ctx.input;
      let pendingHistory: Message[] = [];
      let toolRounds = 0;
      let attempts = 0;

      for (let turn = 1; attempts <= max; turn += 1) {
        throwIfAborted(ctx.signal);
        ctx.emit({ type: "turn_started", sessionId: ctx.sessionId, runId: ctx.runId, turn });
        const request = await ctx.assemble(nextInput, undefined, turn);
        throwIfAborted(ctx.signal);
        const { content, calls, messageId, started, usage: turnUsage } = await ctx.generate(request);
        usage = turnUsage ?? usage;

        if (pendingHistory.length > 0) {
          ctx.history.push(...pendingHistory);
          pendingHistory = [];
        }
        if (turn === 1) ctx.history.push(...ctx.inputMessages);
        if (started) {
          const message: Message = { id: messageId, role: "assistant", content };
          ctx.history.push(message);
          await ctx.appendMessage(message);
          ctx.emit({ type: "message_finished", sessionId: ctx.sessionId, runId: ctx.runId, message });
        }
        ctx.emit({ type: "turn_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn });

        if (opts.toolCalls === "bounded" && calls.length > 0) {
          if (toolRounds >= ctx.maxToolRounds) {
            const result = { ok: false as const, errors: [{ message: "maximum tool rounds exceeded" }], metadata: { reason: "tool_round_limit" } };
            ctx.emit({ type: "artifact_failed", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt: attempts + 1, result });
            return usage;
          }
          toolRounds += 1;
          await dispatchToolCallsInOrder(calls, { ...ctx, toolConcurrency: 1 });
          nextInput = [];
          continue;
        }

        const artifactCtx: ArtifactContext = {
          sessionId: ctx.sessionId,
          runId: ctx.runId,
          turn,
          signal: ctx.signal,
          metadata: ctx.metadata,
        };
        const text = content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("");
        // Empty/whitespace-only call-free output is a parse failure (thinking-only
        // models must not succeed with an empty artifact via the identity parser).
        const parsed = text.trim() === ""
          ? { ok: false as const, error: "no artifact text in model output" }
          : opts.parser
            ? await opts.parser(text, artifactCtx)
            : { ok: true as const, value: text };

        // Parse failure consumes revision budget like a validation failure; the
        // repairer receives `undefined` value plus a synthetic parse issue.
        const parseFailure: ArtifactValidation | undefined =
          !parsed.ok || parsed.value === undefined
            ? { ok: false, errors: [{ path: "$", message: parsed.error ?? "artifact parse failed" }], metadata: { reason: "parse_error" } }
            : undefined;

        const attempt = ++attempts;
        ctx.emit({ type: "artifact_validation_started", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt });
        const result = parseFailure ?? await opts.validator(parsed.value!, artifactCtx);
        ctx.emit({ type: "artifact_validation_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
        if (result.ok) {
          ctx.emit({ type: "artifact_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
          return usage;
        }
        if (attempt > max) {
          ctx.emit({ type: "artifact_failed", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
          return usage;
        }
        ctx.emit({ type: "artifact_revision_started", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, failure: result });
        const repair = await repairer(parseFailure ? undefined : parsed.value, result, artifactCtx);
        const repairMessages = inputMessages(repair).map((m: Message) => ({ ...m, id: randomId("msg") }));
        for (const message of repairMessages) await ctx.appendMessage(message);
        pendingHistory = repairMessages;
        nextInput = repairMessages;
      }

      return usage;
    },
  };
}

// ponytail: resolveLoop returns the loop to run. RunOptions.loop wins over
// AgentConfig.loop; default is singleShotLoop. generate-validate-revise maps
// its options to the factory; unknown strategy throws.
export function resolveToolConcurrency(
  options: { loop?: AgentLoopStrategy | AgentLoopOptions },
  config: { loop?: AgentLoopStrategy | AgentLoopOptions },
): number {
  const loop = options.loop ?? config.loop;
  if (!loop || !isAgentLoopOptions(loop) || loop.strategy !== "single-shot") return 1;
  const value = loop.toolConcurrency;
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/** Dispatch tool calls with bounded concurrency; append transcript rows in call order. */
export async function dispatchToolCallsInOrder(calls: readonly ToolCallContent[], ctx: LoopContext): Promise<void> {
  if (calls.length === 0) return;
  ctx.chargeToolRound?.(calls);
  const concurrency = calls.some((call) => ctx.isToolCallExclusive?.(call))
    ? 1
    : Math.max(1, Math.min(ctx.toolConcurrency, calls.length));
  if (concurrency === 1) {
    for (const call of calls) {
      const result = await ctx.dispatchToolCall(call);
      await appendToolResultMessage(result, ctx);
    }
    return;
  }

  const results: ToolResult[] = new Array(calls.length);
  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      throwIfAborted(ctx.signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= calls.length) return;
      results[index] = await ctx.dispatchToolCall(calls[index]!);
    }
  });
  await Promise.all(workers);
  for (const result of results) {
    throwIfAborted(ctx.signal);
    await appendToolResultMessage(result, ctx);
  }
}

async function appendToolResultMessage(result: ToolResult, ctx: LoopContext): Promise<void> {
  const message = toolResultMessage(result);
  ctx.history.push(message);
  await ctx.appendMessage(message);
}

export function resolveLoop(options: { loop?: AgentLoopStrategy | AgentLoopOptions }, config: { loop?: AgentLoopStrategy | AgentLoopOptions }): AgentLoopStrategy {
  const loop = options.loop ?? config.loop;
  if (!loop) return singleShotLoop;
  if (isAgentLoopOptions(loop)) {
    const { strategy } = loop;
    if (strategy === "single-shot") return singleShotLoop;
    if (strategy === "generate-validate-revise") {
      return generateValidateReviseLoop({
        validator: loop.validator,
        parser: loop.parser,
        repairer: loop.repairer,
        maxRevisions: loop.maxRevisions,
        toolCalls: loop.toolCalls,
      });
    }
    throw new Error(`Unknown agent loop strategy: ${strategy}`);
  }
  return loop;
}

const randomId = createId;
