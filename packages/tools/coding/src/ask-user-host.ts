/**
 * The `ask_user_decision` host gate (plan 154 Task 5).
 *
 * A `tool.call` decide handler owns the ask: it calls `host.ui` `select` (options, plus a custom
 * sentinel when `allowCustom`) and `input` (a custom answer) and returns `{ respond }` with the
 * resulting tool result. When the host answers `unavailable` — or no UI is attached — it returns
 * `{ ask }`; the tool's `elicitation` contract then carries the answer schema and the kernel
 * suspends the run, so `session.resume(decisions)` delivers the answer without executing the tool.
 * `dismissed` becomes a declined tool result and never allows a fabricated choice.
 */
import type { HostUi, ToolCallDecision, ToolCallHookPayload } from "@arnilo/prism";
import {
  ASK_USER_DECISION_TOOL_NAME,
  askUserDecisionViaUi,
  parseAskUserDecisionArgs,
  resolveAskUserDecisionLimits,
} from "./agent/ask-user-decision.js";

export interface AskUserHostHookOptions {
  /** The host UI port, when one is attached. */
  readonly ui?: HostUi;
}

/** Build the `ask_user_decision` gate. It ignores every other tool and never throws. */
export function createAskUserHostHook(
  options: AskUserHostHookOptions,
): (payload: ToolCallHookPayload) => Promise<ToolCallDecision | undefined> {
  const limits = resolveAskUserDecisionLimits();
  return async (payload) => {
    if (payload.name !== ASK_USER_DECISION_TOOL_NAME) return undefined;
    let parsed: ReturnType<typeof parseAskUserDecisionArgs>;
    try {
      parsed = parseAskUserDecisionArgs(payload.args, limits);
    } catch {
      // Malformed args: let `execute` report the parse error rather than suspend on a bad question.
      return undefined;
    }
    if (options.ui === undefined) return { ask: parsed.question };
    try {
      const outcome = await askUserDecisionViaUi(options.ui, parsed, limits, payload.callId);
      if (outcome.kind === "unavailable") return { ask: parsed.question };
      return { respond: outcome.result };
    } catch {
      // A throwing host UI cannot answer: suspend instead of denying or fabricating a choice.
      return { ask: parsed.question };
    }
  };
}
