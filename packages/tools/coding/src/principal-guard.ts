/**
 * Durable-effect principal guard (plan 154 Task 5, decision (f)).
 *
 * A tool whose declared effect is not `none` mutates local or external state. Without a host
 * principal there is no identity to attribute the mutation to, so the call fails closed with
 * `ERR_PRISM_CODING_PRINCIPAL_REQUIRED`. When the package config pins `principal.id`, a call
 * whose `ctx.principal.id` differs fails with `ERR_PRISM_CODING_PRINCIPAL_MISMATCH`. Read-only
 * calls (and the read-only git actions, whose classifier returns `none`) need no principal.
 *
 * Verification of the principal stays with `governance` (Phase 9); this only refuses an
 * unattributable or misattributed durable mutation.
 */
import type { JsonObject, ToolDefinition, ToolEffectDeclaration, ToolExecutionContext, ToolResult } from "@arnilo/prism";

export const ERR_PRISM_CODING_PRINCIPAL_REQUIRED = "ERR_PRISM_CODING_PRINCIPAL_REQUIRED" as const;
export const ERR_PRISM_CODING_PRINCIPAL_MISMATCH = "ERR_PRISM_CODING_PRINCIPAL_MISMATCH" as const;

/** Whether one call's declared effect is durable. A classifier that throws fails closed. */
export function isDurableCall(tool: ToolDefinition, args: JsonObject, context: ToolExecutionContext): boolean {
  const effect = tool.effect;
  if (effect === undefined) return false;
  if (typeof effect === "function") {
    try {
      return effect(args, context).kind !== "none";
    } catch {
      return true;
    }
  }
  return (effect as ToolEffectDeclaration).kind !== "none";
}

function principalError(toolCallId: string, toolName: string, code: string, message: string): ToolResult {
  return {
    toolCallId,
    name: toolName,
    content: [{ type: "text", text: message }],
    error: { code, message },
  };
}

/**
 * The error result for a durable call without a matching principal, or `undefined` when the call
 * may proceed. `expectedId` is the package-configured `principal.id`, when set.
 */
export function durablePrincipalError(
  tool: ToolDefinition,
  args: JsonObject,
  context: ToolExecutionContext,
  expectedId?: string,
): ToolResult | undefined {
  if (!isDurableCall(tool, args, context)) return undefined;
  const principal = context.principal;
  if (principal === undefined || typeof principal.id !== "string" || principal.id.length === 0) {
    return principalError(
      context.toolCallId,
      tool.name,
      ERR_PRISM_CODING_PRINCIPAL_REQUIRED,
      `${tool.name} has a durable effect and requires a principal`,
    );
  }
  if (expectedId !== undefined && principal.id !== expectedId) {
    return principalError(
      context.toolCallId,
      tool.name,
      ERR_PRISM_CODING_PRINCIPAL_MISMATCH,
      `${tool.name} principal does not match the configured principal`,
    );
  }
  return undefined;
}

/** Wrap a tool so a durable call fails closed before it executes. Non-durable calls pass through. */
export function withDurablePrincipal(tool: ToolDefinition, expectedId?: string): ToolDefinition {
  return {
    ...tool,
    async execute(args, context): Promise<ToolResult> {
      const error = durablePrincipalError(tool, args, context, expectedId);
      if (error !== undefined) return error;
      return await tool.execute(args, context);
    },
  };
}
