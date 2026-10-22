import type { JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";
import { DelegateError, type DelegateRuntime, type DelegationOutcome } from "./runtime.js";

const EFFECTS = ["external"] as const;

function failure(name: string, toolCallId: string, message: string): ToolResult {
  return { toolCallId, name, error: { message } };
}

function outcomeResult(name: string, toolCallId: string, outcome: DelegationOutcome): ToolResult {
  return {
    toolCallId,
    name,
    content: outcome.text ? [{ type: "text", text: outcome.text }] : [],
    value: {
      delegationId: outcome.delegationId,
      child: outcome.child,
      status: outcome.status,
      text: outcome.text,
      ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
      ...(outcome.pending === undefined ? {} : { pending: outcome.pending }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    } as unknown as JsonObject,
  };
}

const message = (error: unknown, fallback: string): string => (error instanceof DelegateError ? error.message : fallback);

export function createDelegateTools(runtime: DelegateRuntime): readonly ToolDefinition[] {
  const delegate: ToolDefinition = {
    name: "delegate",
    exclusive: false,
    effects: EFFECTS,
    description: `Run a child agent on a task. Children: ${runtime.childNames.join(", ")}. Use mode "async" to get a delegationId for delegate_wait.`,
    parameters: {
      type: "object",
      properties: {
        child: { type: "string", enum: [...runtime.childNames] },
        input: { type: "string" },
        mode: { type: "string", enum: ["sync", "async"] },
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
        if ("text" in started) return outcomeResult("delegate", context.toolCallId, started);
        return { toolCallId: context.toolCallId, name: "delegate", content: [], value: { ...started } };
      } catch (error) {
        return failure("delegate", context.toolCallId, message(error, "Delegation failed"));
      }
    },
  };

  const idSchema = {
    type: "object",
    properties: { delegationId: { type: "string" } },
    required: ["delegationId"],
    additionalProperties: false,
  } as unknown as JsonObject;

  const wait: ToolDefinition = {
    name: "delegate_wait",
    exclusive: false,
    effects: EFFECTS,
    description: "Wait for one async delegation by its delegationId. A suspended child returns its pending decisions.",
    parameters: idSchema,
    async execute(args, context) {
      if (typeof args.delegationId !== "string") return failure("delegate_wait", context.toolCallId, "delegationId must be a string");
      try {
        return outcomeResult("delegate_wait", context.toolCallId, await runtime.wait(args.delegationId, context.sessionId, context.signal));
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
    parameters: idSchema,
    execute(args, context) {
      if (typeof args.delegationId !== "string") return failure("delegate_cancel", context.toolCallId, "delegationId must be a string");
      try {
        return { toolCallId: context.toolCallId, name: "delegate_cancel", content: [], value: { delegationId: args.delegationId, status: runtime.cancel(args.delegationId, context.sessionId) } };
      } catch (error) {
        return failure("delegate_cancel", context.toolCallId, message(error, "Cancel failed"));
      }
    },
  };

  return [delegate, wait, cancel];
}
