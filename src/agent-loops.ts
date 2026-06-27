import type { AgentInput } from "./input.js";
import { inputMessages } from "./input.js";
import type {
  AgentEvent,
  AgentLoopOptions,
  AgentLoopStrategy,
  ArtifactContext,
  ArtifactParser,
  ArtifactRepairer,
  ArtifactValidator,
  LoopContext,
  Message,
  TextContent,
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
    const toolResults: ToolResult[] = [];
    let toolRounds = 0;
    let nextInput: AgentInput = ctx.input;

    for (let turn = 1; ; turn += 1) {
      throwIfAborted(ctx.signal);
      ctx.emit({ type: "turn_started", sessionId: ctx.sessionId, runId: ctx.runId, turn });
      const request = await ctx.assemble(nextInput, toolResults, turn);
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
      for (const call of calls) {
        const result = await ctx.dispatchToolCall(call);
        toolResults.push(result);
        await ctx.appendMessage(toolResultMessage(result));
        throwIfAborted(ctx.signal);
      }
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
// no provider/retry/store/event re-implementation. T is host-defined, Prism
// never instantiates it. No tools in artifact revisions (roadmap scope is
// generate→validate→revise; tool coupling deferred). Phase 28 fires
// artifact_* events at the marked seams (noop here).
export function generateValidateReviseLoop(opts: {
  readonly validator: ArtifactValidator<unknown>;
  readonly parser?: ArtifactParser<unknown>;
  readonly repairer?: ArtifactRepairer<unknown>;
  readonly maxRevisions?: number;
}): AgentLoopStrategy {
  const max = opts.maxRevisions ?? 3;
  const repairer = opts.repairer ?? defaultRepairer<unknown>();
  return {
    name: "generate-validate-revise",
    async run(ctx: LoopContext): Promise<Usage | undefined> {
      let usage: Usage | undefined;
      let nextInput: AgentInput = ctx.input;

      for (let turn = 1; turn <= max + 1; turn += 1) {
        throwIfAborted(ctx.signal);
        const request = await ctx.assemble(nextInput, undefined, turn);
        throwIfAborted(ctx.signal);
        const { content, messageId, started, usage: turnUsage } = await ctx.generate(request);
        usage = turnUsage ?? usage;

        if (started) {
          const message: Message = { id: messageId, role: "assistant", content };
          ctx.history.push(message);
          await ctx.appendMessage(message);
          ctx.emit({ type: "message_finished", sessionId: ctx.sessionId, runId: ctx.runId, message });
        }

        const text = content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("");
        const artifactCtx: ArtifactContext = {
          sessionId: ctx.sessionId,
          runId: ctx.runId,
          turn,
          signal: ctx.signal,
          metadata: ctx.metadata,
        };

        const parsed = opts.parser
          ? await opts.parser(text, artifactCtx)
          : { ok: true as const, value: text };

        // Parse failure ends the loop silently (terminal parse errors stay on `error`).
        if (!parsed.ok || parsed.value === undefined) return usage;

        const attempt = turn;
        ctx.emit({ type: "artifact_validation_started", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt });
        const result = await opts.validator(parsed.value, artifactCtx);
        ctx.emit({ type: "artifact_validation_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
        if (result.ok) {
          ctx.emit({ type: "artifact_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
          return usage;
        }
        if (turn > max) {
          ctx.emit({ type: "artifact_failed", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
          return usage;
        }
        ctx.emit({ type: "artifact_revision_started", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, failure: result });
        const repair = await repairer(parsed.value, result, artifactCtx);
        const repairMessages = inputMessages(repair).map((m: Message) => ({ ...m, id: randomId("msg") }));
        for (const message of repairMessages) {
          ctx.history.push(message);
          await ctx.appendMessage(message);
        }
        nextInput = repairMessages;
        continue;
      }

      return usage;
    },
  };
}

// ponytail: resolveLoop returns the loop to run. RunOptions.loop wins over
// AgentConfig.loop; default is singleShotLoop. generate-validate-revise maps
// its options to the factory; unknown strategy throws.
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
      });
    }
    throw new Error(`Unknown agent loop strategy: ${strategy}`);
  }
  return loop;
}

function randomId(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}
