/**
 * Mapping between MCP elicitation (`ElicitRequest`) and the shared pending-decision model.
 * The wire behavior is unchanged: accepted results still require the explicit
 * `humanInteraction === true` marker, and the marker never reaches the protocol output.
 */
import type { JsonObject, PendingDecision, RunDecision } from "@arnilo/prism";
import { McpBridgeError, type PrismMcpElicitationResult } from "./types.js";

/** Parity with the frozen decision caps: reason 2 KiB, elicitation payload/schema 16 KiB. */
export const MAX_MCP_ELICITATION_MESSAGE_BYTES = 2_048;
export const MAX_MCP_ELICITATION_SCHEMA_BYTES = 16 * 1024;

export interface McpElicitationDecisionOptions {
  /** Tool name when the elicitation is raised during a mapped tool call. */
  readonly toolName?: string;
}

function boundedText(value: unknown, maxBytes: number, label: string): string {
  if (typeof value !== "string") throw new McpBridgeError(`${label} must be a string`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new McpBridgeError(`${label} exceeds ${maxBytes} bytes`);
  return value;
}

function boundedSchema(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { type: "object" };
  const text = JSON.stringify(value);
  if (text === undefined || Buffer.byteLength(text, "utf8") > MAX_MCP_ELICITATION_SCHEMA_BYTES) {
    throw new McpBridgeError(`MCP elicitation schema exceeds ${MAX_MCP_ELICITATION_SCHEMA_BYTES} bytes`);
  }
  return value as JsonObject;
}

/**
 * Convert an untrusted MCP `ElicitRequest` params object into a shared pending-decision
 * record (kind `elicitation`). Throws `McpBridgeError` on malformed or oversized input.
 */
export function mcpElicitationDecision(approvalId: string, params: unknown, options: McpElicitationDecisionOptions = {}): PendingDecision {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new McpBridgeError("MCP elicitation params must be an object");
  }
  const row = params as Record<string, unknown>;
  return {
    approvalId,
    kind: "elicitation",
    scope: options.toolName ? { toolName: options.toolName } : {},
    reason: boundedText(row.message, MAX_MCP_ELICITATION_MESSAGE_BYTES, "MCP elicitation message"),
    elicitationSchema: boundedSchema(row.requestedSchema),
  };
}

/**
 * Convert a shared run decision into an MCP elicitation result for the protocol boundary.
 * `reject_*` outcomes decline; `allow_*` outcomes accept with the decision's payload and
 * fail closed unless the host proved explicit human interaction.
 */
export function mcpElicitationResultFromDecision(
  decision: RunDecision,
  options: { readonly humanInteraction?: boolean } = {},
): PrismMcpElicitationResult {
  if (decision.outcome === "reject_once" || decision.outcome === "reject_for_run") return { action: "decline" };
  if (!decision.elicitation) throw new McpBridgeError("Accepted MCP elicitation requires an elicitation payload");
  if (options.humanInteraction !== true) {
    throw new McpBridgeError("Accepted MCP elicitation requires explicit human interaction");
  }
  return { action: "accept", content: decision.elicitation, humanInteraction: true };
}
