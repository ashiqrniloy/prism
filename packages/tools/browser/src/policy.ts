/**
 * Observation vs side-effect classification for browser tools: feeds each tool's `effect`
 * declaration and the manager's side-effect hook.
 */
import type { ToolEffectDeclaration } from "@arnilo/prism";
import type { BrowserActionName } from "./types.js";

export type BrowserRisk = "low" | "medium" | "high";
export type BrowserEffectClass = "observation" | "mutation" | "high_impact";

export interface BrowserOperationClass {
  readonly operation: string;
  readonly effect: BrowserEffectClass;
  readonly risk: BrowserRisk;
  readonly requiresSideEffectHook: boolean;
}

const OBSERVATION = new Set<string>(["open", "snapshot", "wait", "close", "observe"]);

export function classifyBrowserOperation(
  operation: string,
  details: {
    readonly dialogResponse?: "accept" | "dismiss";
    readonly hasUrl?: boolean;
    readonly pageKind?: "main" | "popup";
  } = {},
): BrowserOperationClass {
  if (operation === "evaluate") {
    // Arbitrary page-context code execution: highest-risk browser operation.
    return {
      operation,
      effect: "high_impact",
      risk: "high",
      requiresSideEffectHook: true,
    };
  }
  if (operation === "block_urls" || operation === "unblock_urls" || operation === "throttle" || operation === "emulate") {
    // CDP network/emulation control changes what the page loads and how it renders.
    return {
      operation,
      effect: "mutation",
      risk: "medium",
      requiresSideEffectHook: true,
    };
  }
  if (operation === "open" && details.hasUrl) {
    return {
      operation: "open_navigate",
      effect: "mutation",
      risk: "medium",
      requiresSideEffectHook: true,
    };
  }
  if (OBSERVATION.has(operation)) {
    return {
      operation,
      effect: "observation",
      risk: "low",
      requiresSideEffectHook: false,
    };
  }
  if (operation === "select_page") {
    const popup = details.pageKind === "popup";
    return {
      operation: popup ? "select_popup" : "select_page",
      effect: popup ? "mutation" : "observation",
      risk: popup ? "medium" : "low",
      requiresSideEffectHook: popup,
    };
  }
  if (operation === "dialog") {
    const accept = details.dialogResponse === "accept";
    return {
      operation: accept ? "dialog_accept" : "dialog_dismiss",
      effect: accept ? "high_impact" : "mutation",
      risk: accept ? "high" : "medium",
      requiresSideEffectHook: true,
    };
  }
  if (operation === "download_release") {
    return {
      operation,
      effect: "high_impact",
      risk: "high",
      requiresSideEffectHook: true,
    };
  }
  if (operation === "upload" || operation === "screenshot") {
    return {
      operation,
      effect: operation === "upload" ? "high_impact" : "mutation",
      risk: operation === "upload" ? "high" : "medium",
      requiresSideEffectHook: true,
    };
  }
  if (
    operation === "navigate" ||
    operation === "click" ||
    operation === "type" ||
    operation === "fill" ||
    operation === "select" ||
    operation === "check" ||
    operation === "uncheck" ||
    operation === "scroll"
  ) {
    return {
      operation,
      effect: "mutation",
      risk: "medium",
      requiresSideEffectHook: true,
    };
  }
  return {
    operation,
    effect: "mutation",
    risk: "medium",
    requiresSideEffectHook: true,
  };
}

/** Browser mutations are external effects: browser state must reload+verify, never replay. */
export function classifyBrowserToolEffect(
  operation: string,
  details: Parameters<typeof classifyBrowserOperation>[1] = {},
): ToolEffectDeclaration {
  return classifyBrowserOperation(operation, details).effect === "observation"
    ? { kind: "none", idempotency: "none" }
    : { kind: "external_mutation", idempotency: "unsupported" };
}

export function isSideEffectAction(action: BrowserActionName | "evaluate" | "observe"): boolean {
  return classifyBrowserOperation(action).requiresSideEffectHook;
}
