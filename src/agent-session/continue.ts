import type { Message, SessionEntry, ToolCallContent, ToolEffectKey, ToolEffectRecord, ToolResult } from "../contracts.js";
import { toToolResultMessage } from "../input.js";
import { deriveToolEffectKey, toolEffectArgumentsHash } from "../tool-effects.js";
import { interruptedResult } from "./history-repair.js";
import type { RunStateBounds, StoredAgentRunState } from "../agent-run-state.js";
import { parseRunCheckpoint } from "./session/persist.js";
import type { SessionHost } from "./session/types.js";

/** The `error.code` of a settled result whose durable effect was dispatched but never recorded. */
export const TOOL_CALL_OUTCOME_UNKNOWN = "tool_call_outcome_unknown";

/** The newest assistant message and the calls of it no later tool row answers, when only tool rows follow it. */
interface UnansweredTip {
  readonly entry: SessionEntry;
  readonly calls: readonly ToolCallContent[];
}

/**
 * Whether the branch "owes a model turn": its last message is a user message, a tool result, or an
 * assistant message with unanswered calls. An empty branch or a completed assistant reply owes nothing.
 */
export function owesModelTurn(messages: readonly Message[]): boolean {
  const last = messages.at(-1);
  if (!last) return false;
  if (last.role !== "assistant") return last.role === "user" || last.role === "tool";
  return last.content.some((block) => block.type === "tool_call" && block.authority !== "provider-hosted");
}

/**
 * Plan 231 Task 3: the checkpoint a continuation restores. The newest `run_checkpoint` counts only when it belongs
 * to the run that wrote the newest message (the interrupted run) and to this session: a fork copies checkpoints
 * but never continues another session's run. A malformed checkpoint throws (fail closed).
 */
export function continuationCheckpoint(
  entries: readonly SessionEntry[],
  sessionId: string,
  bounds?: RunStateBounds,
): StoredAgentRunState | undefined {
  let message: SessionEntry | undefined;
  let checkpoint: SessionEntry | undefined;
  for (let index = entries.length - 1; index >= 0 && !(message && checkpoint); index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "message") message ??= entry;
    else if (entry.kind === "run_checkpoint") checkpoint ??= entry;
  }
  const runId = message?.runId;
  if (!checkpoint || runId === undefined || checkpoint.runId !== runId) return undefined;
  const state = parseRunCheckpoint(checkpoint, bounds);
  return state.sessionId === sessionId ? state : undefined;
}

/** The tip's unanswered calls: only those of the newest assistant message followed solely by tool rows. */
function unansweredTip(entries: readonly SessionEntry[]): UnansweredTip | undefined {
  const answered = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const message = entry.kind === "message" ? entry.message : undefined;
    if (!message) continue;
    if (message.role === "tool") {
      for (const block of message.content) if (block.type === "tool_result") answered.add(block.toolCallId);
      continue;
    }
    if (message.role !== "assistant") return undefined;
    const calls = message.content.filter(
      (block): block is ToolCallContent => block.type === "tool_call" && block.authority !== "provider-hosted" && !answered.has(block.id),
    );
    return calls.length > 0 ? { entry, calls } : undefined;
  }
  return undefined;
}

function outcomeUnknownResult(call: ToolCallContent): ToolResult {
  return {
    toolCallId: call.id,
    name: call.name,
    error: {
      code: TOOL_CALL_OUTCOME_UNKNOWN,
      message:
        "The outcome of this tool call is unknown: it was dispatched, but the process stopped before its result was recorded. Verify its effect before repeating it.",
    },
  };
}

function failedResult(call: ToolCallContent, record: ToolEffectRecord): ToolResult {
  return {
    toolCallId: call.id,
    name: call.name,
    error: { code: record.failure?.code ?? "tool_call_failed", message: "Tool call failed before its result was recorded." },
  };
}

/**
 * Settle one interrupted call from the run's effect store. The key uses the call's own entry run id,
 * because the effect key includes the run that dispatched it. Nothing is re-dispatched.
 */
async function settleCall(session: SessionHost, runId: string, call: ToolCallContent): Promise<ToolResult> {
  const store = session.activeEffectStore;
  const ownership = session.activeOwnership;
  if (!store || !ownership?.tenantId) return interruptedResult(call);
  let key: ToolEffectKey;
  try {
    const base = {
      ownership,
      sessionId: session.id,
      runId,
      toolCallId: call.id,
      toolName: call.name,
      argumentsHash: toolEffectArgumentsHash(call.arguments),
    };
    key = { ...base, key: deriveToolEffectKey(base) };
  } catch {
    // Arguments or ids a store could never have keyed: the call never reached an effect claim.
    return interruptedResult(call);
  }
  let record: ToolEffectRecord | undefined;
  try {
    record = await store.get(key);
  } catch {
    // A store that cannot answer leaves the outcome unknown; never tell the model it did not happen.
    return outcomeUnknownResult(call);
  }
  if (!record) return interruptedResult(call);
  switch (record.status) {
    case "completed":
      return record.result ? { ...record.result, toolCallId: call.id, name: call.name } : outcomeUnknownResult(call);
    case "dispatched":
      if (record.claimToken) {
        await store
          .markUnknown({
            ...key,
            claimToken: record.claimToken,
            expectedVersion: record.version,
            failure: { code: "ERR_PRISM_TOOL_EFFECT_INTERRUPTED" },
          })
          // A version conflict means another writer moved it; the outcome is still unknown to this run.
          .catch(() => undefined);
      }
      return outcomeUnknownResult(call);
    case "unknown":
      return outcomeUnknownResult(call);
    case "failed_retryable":
    case "failed_terminal":
      return failedResult(call, record);
    default:
      // `pending`: claimed but never dispatched.
      return interruptedResult(call);
  }
}

/**
 * Give each unanswered call at the branch tip a persisted result before a continuation's first turn,
 * so the provider-view repair finds nothing left to answer. Runs inside the run, after the scope check
 * and the active-run claim. Resolves the settled call ids.
 */
export async function settleContinuationTip(session: SessionHost, runId: string): Promise<readonly string[]> {
  const tip = unansweredTip((await session.snapshot()).entries);
  if (!tip) return [];
  const callRunId = tip.entry.runId ?? runId;
  const settled: string[] = [];
  for (const call of tip.calls) {
    const result = await settleCall(session, callRunId, call);
    await session.appendMessage(toToolResultMessage(result), runId);
    settled.push(call.id);
  }
  return settled;
}
