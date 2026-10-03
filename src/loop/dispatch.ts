import type { Message, ToolCallContent, ToolResult } from "../contracts.js";
import { toToolResultMessage } from "../input.js";
import { errorToErrorInfo } from "../redaction.js";

/** Internal dispatch seam used by {@link RunController.executeTools}. */
export interface ToolDispatchContext {
  readonly signal: AbortSignal;
  readonly toolConcurrency: number;
  chargeToolRound?(calls: readonly ToolCallContent[]): void | Promise<void>;
  dispatchToolCall(call: ToolCallContent): Promise<ToolResult>;
  isToolCallExclusive?(call: ToolCallContent): boolean;
  /** Persist one transcript row. The caller owns history insertion. */
  appendMessage(message: Message): Promise<void>;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Agent run aborted");
}

/** Calls the host must dispatch. Provider-hosted calls were executed server-side. */
export function dispatchableToolCalls(calls: readonly ToolCallContent[]): readonly ToolCallContent[] {
  return calls.filter((call) => call.authority !== "provider-hosted");
}

/** Dispatch tool calls with bounded concurrency; append transcript rows in call order. */
export async function dispatchToolCallsInOrder(calls: readonly ToolCallContent[], ctx: ToolDispatchContext): Promise<void> {
  if (calls.length === 0) return;
  await ctx.chargeToolRound?.(calls);
  const concurrency = calls.some((call) => ctx.isToolCallExclusive?.(call)) ? 1 : Math.max(1, Math.min(ctx.toolConcurrency, calls.length));
  if (concurrency === 1) {
    for (const call of calls) {
      const result = await ctx.dispatchToolCall(call);
      await appendToolResultMessage(result, ctx);
    }
    return;
  }

  const results: (ToolResult | undefined)[] = new Array(calls.length);
  let nextIndex = 0;
  let stopped = false;
  let firstFailure: unknown;
  let failureIndex = -1;
  const recordFailure = (error: unknown, index: number): void => {
    if (stopped) return;
    stopped = true;
    firstFailure = error;
    failureIndex = index;
  };
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      if (stopped) return;
      let index = -1;
      try {
        throwIfAborted(ctx.signal);
        index = nextIndex;
        nextIndex += 1;
        if (index >= calls.length) return;
        results[index] = await ctx.dispatchToolCall(calls[index]!);
      } catch (error) {
        recordFailure(error, index >= 0 && index < calls.length ? index : -1);
        return;
      }
    }
  });
  await Promise.allSettled(workers);
  // Persist before rethrowing: a stopped batch must not leave the branch with `tool_call`
  // ids that never got a `tool_result` (providers reject that history on the next turn).
  const claimed = Math.min(nextIndex, calls.length);
  for (let index = 0; index < calls.length; index += 1) {
    const result = results[index];
    if (result) {
      await appendToolResultMessage(result, ctx);
      continue;
    }
    // Suspension/loop-state errors are not tool outcomes: their machinery appends the real
    // result on resume, so a synthetic row here would duplicate it.
    if (index === failureIndex && isRunControlError(firstFailure)) continue;
    const call = calls[index];
    if (call === undefined) continue;
    await appendToolResultMessage(syntheticFailureResult(call, index < claimed ? firstFailure : undefined), ctx);
  }
  if (stopped) throw firstFailure;
}

/** Run-level control errors rethrown by `dispatchToolCall` (mirrors `src/tools.ts`). */
function isRunControlError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" &&
    (code === "ERR_PRISM_AGENT_RUN_SUSPENDED" || code === "ERR_PRISM_DELEGATION_SUSPENDED" || code.startsWith("ERR_PRISM_LOOP_"))
  );
}

function syntheticFailureResult(call: ToolCallContent, failure: unknown): ToolResult {
  if (failure === undefined) {
    return {
      toolCallId: call.id,
      name: call.name,
      error: {
        code: "tool_call_not_dispatched",
        message: "Tool call was not dispatched: the batch stopped after an earlier call failed or the run was aborted.",
      },
    };
  }
  const info = errorToErrorInfo(failure);
  return { toolCallId: call.id, name: call.name, error: { name: info.name, message: info.message, code: info.code } };
}

async function appendToolResultMessage(result: ToolResult, ctx: ToolDispatchContext): Promise<void> {
  // Approval-gated calls return a marker instead of a real result; the transcript must not
  // record a phantom tool_result for a call that never dispatched.
  if ((result.metadata as { approvalPending?: unknown } | undefined)?.approvalPending === true) return;
  const message = toToolResultMessage(result);
  await ctx.appendMessage(message);
}
