import type { Message, ToolResult } from "../contracts.js";
import { toToolResultMessage } from "../input.js";

/** The `error.code` of a synthetic result the provider view carries for a call no result answers. */
export const TOOL_CALL_INTERRUPTED = "tool_call_interrupted";

export interface HistoryRepair {
  /** The provider view: `messages` itself when nothing needed repair. */
  readonly messages: readonly Message[];
  /** Ids of the calls that got a synthetic result, in branch order. */
  readonly repaired: readonly string[];
}

export function interruptedResult(call: { readonly id: string; readonly name: string }): ToolResult {
  return {
    toolCallId: call.id,
    name: call.name,
    error: { code: TOOL_CALL_INTERRUPTED, message: "Tool call was interrupted: no result was recorded for this call." },
  };
}

/**
 * Answer, in the provider view only, each assistant tool call that no tool result answers anywhere
 * later in the branch. The stored branch is never written. The result is a pure function of
 * `messages` and `skip`: the same branch yields byte-identical synthetic rows, so a cached prefix
 * stays valid.
 *
 * A synthetic row lands after the tool rows already following its assistant message, in call order,
 * because providers require the results directly after the call. `skip` holds the calls a pending
 * suspension owns on a resume; provider-hosted calls were executed server-side and are never repaired.
 */
export function repairUnansweredToolCalls(messages: readonly Message[], skip?: ReadonlySet<string>): HistoryRepair {
  // Walk newest to oldest so `answered` already holds every later result when an assistant message is met.
  let answered: Set<string> | undefined;
  let insertions: Map<number, ToolResult[]> | undefined;
  const repaired: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant") {
      let missing: ToolResult[] | undefined;
      for (const block of message.content) {
        if (block.type !== "tool_call" || block.authority === "provider-hosted") continue;
        if (answered?.has(block.id) || skip?.has(block.id)) continue;
        (missing ??= []).push(interruptedResult(block));
      }
      if (missing) {
        // After the contiguous tool rows that follow this assistant message.
        let at = index + 1;
        while (at < messages.length && messages[at]!.role === "tool") at += 1;
        (insertions ??= new Map()).set(at, [...(insertions.get(at) ?? []), ...missing]);
        repaired.unshift(...missing.map((result) => result.toolCallId));
      }
      continue;
    }
    for (const block of message.content) if (block.type === "tool_result") (answered ??= new Set()).add(block.toolCallId);
  }
  if (!insertions) return { messages, repaired };
  const output: Message[] = [];
  for (let index = 0; index <= messages.length; index += 1) {
    const inserted = insertions.get(index);
    if (inserted) for (const result of inserted) output.push(toToolResultMessage(result));
    if (index < messages.length) output.push(messages[index]!);
  }
  return { messages: output, repaired };
}
