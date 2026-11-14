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
  /** Called once for each synthetic result the seam writes, so the caller can emit its `tool.completed`. */
  settled?(result: ToolResult): void;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Agent run aborted");
}

function isDisposeAbort(signal: AbortSignal): boolean {
  return signal.aborted && (signal.reason as { code?: unknown } | null | undefined)?.code === "agent_disposed";
}

/** Calls the host must dispatch. Provider-hosted calls were executed server-side. */
export function dispatchableToolCalls(calls: readonly ToolCallContent[]): readonly ToolCallContent[] {
  return calls.filter((call) => call.authority !== "provider-hosted");
}

/** Dispatch tool calls with bounded concurrency; append transcript rows in call order. */
export async function dispatchToolCallsInOrder(
  calls: readonly ToolCallContent[],
  ctx: ToolDispatchContext,
): Promise<readonly ToolResult[]> {
  if (calls.length === 0) return [];
  try {
    await ctx.chargeToolRound?.(calls);
  } catch (error) {
    // The round charge runs before any call: nothing was dispatched, so every call is answered.
    await settleUnanswered(calls, 0, undefined, ctx, []);
    throw error;
  }
  const concurrency = calls.some((call) => ctx.isToolCallExclusive?.(call)) ? 1 : Math.max(1, Math.min(ctx.toolConcurrency, calls.length));
  if (concurrency === 1) {
    const serial: ToolResult[] = [];
    // `answered` calls have a result persisted; `running` is the call whose dispatch is in flight.
    let answered = 0;
    let running = -1;
    try {
      for (const call of calls) {
        // A dispose abort is answered per call (`agent_disposed` denials, plan 177 Task 5), not thrown.
        if (!isDisposeAbort(ctx.signal)) throwIfAborted(ctx.signal);
        running = answered;
        const result = await ctx.dispatchToolCall(call);
        running = -1;
        serial.push(result);
        await appendToolResultMessage(result, ctx);
        answered += 1;
      }
      return serial;
    } catch (error) {
      await settleUnanswered(calls, answered, running === answered ? error : undefined, ctx, serial);
      throw error;
    }
  }

  const results: (ToolResult | undefined)[] = new Array(calls.length);
  const returned: ToolResult[] = [];
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
      returned.push(result);
      await appendToolResultMessage(result, ctx);
      continue;
    }
    // Suspension/loop-state errors are not tool outcomes: their machinery appends the real
    // result on resume, so a synthetic row here would duplicate it.
    if (index === failureIndex && isRunControlError(firstFailure)) continue;
    const call = calls[index];
    if (call === undefined) continue;
    const synthetic = syntheticFailureResult(call, index < claimed ? firstFailure : undefined);
    returned.push(synthetic);
    await appendToolResultMessage(synthetic, ctx);
    ctx.settled?.(synthetic);
  }
  if (stopped) throw firstFailure;
  return returned;
}

/**
 * Answer calls `from..` of a stopped round, in call order, and never throw: the round's own error
 * is what the caller rethrows. `failure` belongs to call `from` (it was dispatching when it threw);
 * every later call, and `from` itself when `failure` is undefined, never started.
 */
async function settleUnanswered(
  calls: readonly ToolCallContent[],
  from: number,
  failure: unknown,
  ctx: ToolDispatchContext,
  returned: ToolResult[],
): Promise<void> {
  for (let index = from; index < calls.length; index += 1) {
    const call = calls[index];
    if (call === undefined) continue;
    const own = index === from ? failure : undefined;
    // Suspension and loop-state errors are not tool outcomes: their machinery writes the real result.
    if (own !== undefined && isRunControlError(own)) continue;
    const synthetic = syntheticFailureResult(call, own);
    try {
      await appendToolResultMessage(synthetic, ctx);
      returned.push(synthetic);
      ctx.settled?.(synthetic);
    } catch {
      // A failing store cannot be repaired here; the read-time repair covers the branch.
    }
  }
}

/** Run-level control errors rethrown by `dispatchToolCall` (mirrors `src/tools.ts`). */
export function isRunControlError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" &&
    (code === "ERR_PRISM_AGENT_RUN_SUSPENDED" || code === "ERR_PRISM_DELEGATION_SUSPENDED" || code.startsWith("ERR_PRISM_LOOP_"))
  );
}

export function syntheticFailureResult(call: ToolCallContent, failure: unknown): ToolResult {
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

export async function appendToolResultMessage(result: ToolResult, ctx: ToolDispatchContext): Promise<void> {
  // Approval-gated calls return a marker instead of a real result; the transcript must not
  // record a phantom tool_result for a call that never dispatched.
  if ((result.metadata as { approvalPending?: unknown } | undefined)?.approvalPending === true) return;
  const message = toToolResultMessage(result);
  await ctx.appendMessage(message);
}
