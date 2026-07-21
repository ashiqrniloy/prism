/**
 * Observation vs side-effect classification for browser tools.
 * Maps actions to ExecutionAction metadata for host ExecutionPolicy/approval.
 */
import type { BrowserActionName } from "./types.js";

export type BrowserRisk = "low" | "medium" | "high";
export type BrowserEffectClass = "observation" | "mutation" | "high_impact";

export interface BrowserOperationClass {
  readonly operation: string;
  readonly effect: BrowserEffectClass;
  readonly risk: BrowserRisk;
  readonly requiresSideEffectHook: boolean;
}

const OBSERVATION = new Set<string>(["open", "snapshot", "wait", "close"]);

export function classifyBrowserOperation(
  operation: string,
  details: {
    readonly dialogResponse?: "accept" | "dismiss";
    readonly hasUrl?: boolean;
    readonly pageKind?: "main" | "popup";
  } = {},
): BrowserOperationClass {
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

export function isSideEffectAction(action: BrowserActionName): boolean {
  return classifyBrowserOperation(action).requiresSideEffectHook;
}

export function buildBrowserExecutionAction(input: {
  readonly operation: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly pageId?: string;
  readonly url?: string;
  readonly origin?: string;
  readonly paths?: readonly string[];
  readonly resource?: string;
  readonly dialogResponse?: "accept" | "dismiss";
  readonly pageKind?: "main" | "popup";
  readonly metadata?: Readonly<Record<string, unknown>>;
}): {
  readonly kind: "browser";
  readonly operation: string;
  readonly risk: BrowserRisk;
  readonly paths?: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
} {
  const classified = classifyBrowserOperation(input.operation, {
    dialogResponse: input.dialogResponse,
    hasUrl: Boolean(input.url),
    pageKind: input.pageKind,
  });
  return {
    kind: "browser",
    operation: classified.operation,
    risk: classified.risk,
    ...(input.paths ? { paths: input.paths } : {}),
    metadata: {
      effect: classified.effect,
      runId: input.runId,
      sessionId: input.sessionId,
      pageId: input.pageId,
      url: input.url,
      origin: input.origin,
      resource: input.resource,
      ...input.metadata,
    },
  };
}
