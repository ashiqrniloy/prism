import type { JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";
import type { DelegationMerge } from "./isolation.js";
import { DelegateError, type DelegateRuntime, type DelegationOutcome } from "./runtime.js";
import { DEFAULT_RESULT_MAX_CHARS } from "./limits.js";

const EFFECTS = ["external"] as const;

function failure(name: string, toolCallId: string, message: string): ToolResult {
  return { toolCallId, name, error: { message } };
}

interface Slice {
  readonly text: string;
  /** The retained answer's length, not the child's full output. */
  readonly totalChars: number;
  readonly nextOffset?: number;
  readonly truncated: boolean;
}

/** One page of the retained answer, cut at a paragraph break when one is close enough. */
function sliceAnswer(full: string, offset: number, maxChars: number): Slice {
  const head = full.slice(offset, offset + maxChars);
  if (full.length <= offset + maxChars) return { text: head, totalChars: full.length, truncated: false };
  const cut = head.lastIndexOf("\n\n");
  const text = cut > 0 ? head.slice(0, cut) : head;
  return { text, totalChars: full.length, nextOffset: offset + text.length, truncated: true };
}

/** What the parent must know about an isolated child's branch: landed, conflicted, refused, or kept unmerged. */
function mergeNote(merge: DelegationMerge | undefined): string {
  if (merge === undefined) return "";
  if (merge.status === "merged") {
    const files = merge.files.length === 1 ? "1 file" : `${merge.files.length} files`;
    return `, merged ${merge.commit.slice(0, 7)}${merge.files.length === 0 ? "" : ` (${files})`}`;
  }
  if (merge.status === "conflict") return `, merge conflict: ${merge.files.join(", ") || "unknown files"} (branch ${merge.branch} kept)`;
  if (merge.status === "refused") return `, merge refused: ${merge.reason.slice(0, 160)} (branch ${merge.branch} kept)`;
  return `, branch ${merge.branch} kept`;
}

/** What the child was given from the parent's conversation: the mode and how much of it survived the cut. */
function contextNote(context: DelegationOutcome["context"]): string {
  if (context === undefined) return "";
  if (context.mode === "summary") return ", saw a summary of this conversation";
  const omitted = context.omittedTurns === 0 ? "" : `, ${context.omittedTurns} earlier omitted`;
  return `, saw the last ${context.turns} turns${omitted}${context.truncated ? " (cut to fit)" : ""}`;
}

function statusLine(outcome: DelegationOutcome): string {
  const turns = `${outcome.turns} ${outcome.turns === 1 ? "turn" : "turns"}`;
  const tokens = outcome.usage?.totalTokens;
  const pending = outcome.pending?.length ? `, ${outcome.pending.length} pending` : "";
  return `[child ${outcome.child}: ${outcome.status}, ${turns}${tokens === undefined ? "" : `, ${tokens.toLocaleString("en-US")} tokens`}${pending}${mergeNote(outcome.merge)}${contextNote(outcome.context)}]`;
}

/**
 * A tool result is text, not an object: the kernel serializes `value` and drops text parts, and JSON-escaped
 * text is what plan 189 removed from coding results. The paging cursor therefore rides the hint line.
 */
function outcomeResult(
  name: string,
  toolCallId: string,
  outcome: DelegationOutcome,
  maxChars: number,
  offset = 0,
): { result: ToolResult; served: boolean; delegationId: string } {
  const page = sliceAnswer(outcome.text, offset, maxChars);
  const hint =
    page.nextOffset === undefined
      ? []
      : [`[truncated: ${page.nextOffset}/${page.totalChars} chars; delegate_wait { delegationId: "${outcome.delegationId}", offset: ${page.nextOffset} } returns the rest]`];
  const body = page.text || outcome.error || `Delegation ${outcome.delegationId} ${outcome.status}.`;
  return {
    result: {
      toolCallId,
      name,
      content: [{ type: "text", text: [body, ...hint, statusLine(outcome)].join("\n\n") }],
    },
    served: page.nextOffset === undefined,
    delegationId: outcome.delegationId,
  };
}

const message = (error: unknown, fallback: string): string => (error instanceof DelegateError ? error.message : fallback);

/** A terminal answer whose text was fully served releases its entry; a truncated one stays pageable. */
function complete(runtime: DelegateRuntime, sessionId: string, page: { result: ToolResult; served: boolean; delegationId: string }): ToolResult {
  if (page.served) runtime.release(page.delegationId, sessionId);
  return page.result;
}

export function createDelegateTools(runtime: DelegateRuntime): readonly ToolDefinition[] {
  const capFor = (child: string): number => runtime.resultMaxChars[child] ?? DEFAULT_RESULT_MAX_CHARS;
  const delegate: ToolDefinition = {
    name: "delegate",
    exclusive: false,
    effects: EFFECTS,
    description: runtime.description,
    parameters: {
      type: "object",
      properties: {
        child: { type: "string", enum: [...runtime.childNames], description: "Which child runs the task; one line above says when to use it." },
        input: {
          type: "string",
          description:
            "A self-contained brief: the goal, the relevant files or facts, constraints, and what to return. The child cannot ask you follow-up questions.",
        },
        mode: {
          type: "string",
          enum: ["sync", "async"],
          description: "sync waits for the result; async returns a delegationId for delegate_wait",
        },
      },
      required: ["child", "input"],
      additionalProperties: false,
    } as unknown as JsonObject,
    async execute(args, context) {
      const { child, input, mode = "sync" } = args;
      if (typeof child !== "string" || typeof input !== "string" || (mode !== "sync" && mode !== "async")) {
        return failure("delegate", context.toolCallId, "child and input must be strings; mode must be sync or async");
      }
      try {
        const started = await runtime.start({
          child,
          input,
          mode,
          parentSessionId: context.sessionId,
          parentRunId: context.runId,
          ...(context.session === undefined ? {} : { session: context.session }),
          ...(context.principal === undefined ? {} : { principal: context.principal }),
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        });
        if ("text" in started) return complete(runtime, context.sessionId, outcomeResult("delegate", context.toolCallId, started, capFor(started.child)));
        return {
          toolCallId: context.toolCallId,
          name: "delegate",
          content: [{ type: "text", text: `[child ${started.child}: running, delegationId ${started.delegationId}]` }],
        };
      } catch (error) {
        return failure("delegate", context.toolCallId, message(error, "Delegation failed"));
      }
    },
  };

  const wait: ToolDefinition = {
    name: "delegate_wait",
    exclusive: false,
    effects: EFFECTS,
    description:
      "Wait for one async delegation by its delegationId. A suspended child returns its pending decisions. Pass offset to page a long answer.",
    parameters: {
      type: "object",
      properties: {
        delegationId: { type: "string" },
        offset: { type: "integer", minimum: 0, description: "Character offset into the answer; use nextOffset from the previous result." },
      },
      required: ["delegationId"],
      additionalProperties: false,
    } as unknown as JsonObject,
    async execute(args, context) {
      if (typeof args.delegationId !== "string") return failure("delegate_wait", context.toolCallId, "delegationId must be a string");
      const offset = args.offset ?? 0;
      if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
        return failure("delegate_wait", context.toolCallId, "offset must be a non-negative integer");
      }
      try {
        const outcome = await runtime.wait(args.delegationId, context.sessionId, context.signal);
        return complete(runtime, context.sessionId, outcomeResult("delegate_wait", context.toolCallId, outcome, capFor(outcome.child), offset));
      } catch (error) {
        return failure("delegate_wait", context.toolCallId, message(error, "Wait failed"));
      }
    },
  };

  const cancel: ToolDefinition = {
    name: "delegate_cancel",
    exclusive: false,
    effects: EFFECTS,
    description: "Cancel one running delegation by its delegationId.",
    parameters: { type: "object", properties: { delegationId: { type: "string" } }, required: ["delegationId"], additionalProperties: false } as unknown as JsonObject,
    execute(args, context) {
      if (typeof args.delegationId !== "string") return failure("delegate_cancel", context.toolCallId, "delegationId must be a string");
      try {
        const status = runtime.cancel(args.delegationId, context.sessionId);
        return { toolCallId: context.toolCallId, name: "delegate_cancel", content: [{ type: "text", text: `delegation ${args.delegationId}: ${status}` }] };
      } catch (error) {
        return failure("delegate_cancel", context.toolCallId, message(error, "Cancel failed"));
      }
    },
  };

  return [delegate, wait, cancel];
}
