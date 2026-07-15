import type { ExecutionAction, ExecutionDecision, ExecutionPolicy } from "@arnilo/prism";
import { assertPathInsideRoots } from "./path-containment.js";
import { evaluateCommandRules, type CommandRule } from "./command-rules.js";

export interface CodingApprovalRequest {
  readonly action: ExecutionAction;
  readonly signal?: AbortSignal;
}

export type CodingApprovalFn = (request: CodingApprovalRequest) => boolean | Promise<boolean>;

export type ApprovalCacheScope = "session" | "run" | "none";

export interface CodingApprovalPolicyOptions {
  readonly roots: readonly string[];
  readonly approve?: CodingApprovalFn;
  readonly readOnly?: boolean;
  readonly commandRules?: readonly CommandRule[];
  readonly approvalCacheScope?: ApprovalCacheScope;
  readonly approvalTimeoutMs?: number;
  /** When true (default), shell metacharacters require approval. */
  readonly denyMetacharacters?: boolean;
}

function isMutatingKind(kind: string): boolean {
  return kind === "shell" || kind === "write" || kind === "edit";
}

function approvalCacheKey(action: ExecutionAction): string {
  return [
    action.kind,
    action.operation,
    ...(action.paths ?? []),
    action.command ?? "",
  ].join("\0");
}

function readAbortSignal(action: ExecutionAction): AbortSignal | undefined {
  const signal = action.metadata?.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

async function waitForApproval(
  approve: CodingApprovalFn,
  request: CodingApprovalRequest,
  timeoutMs: number | undefined,
): Promise<boolean> {
  if (request.signal?.aborted) return false;

  const approvePromise = Promise.resolve(approve(request));
  if (!timeoutMs || timeoutMs <= 0) return approvePromise;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    approvePromise.then(finish, () => finish(false));
  });
}

export function createCodingApprovalPolicy(options: CodingApprovalPolicyOptions): ExecutionPolicy {
  const cache =
    options.approvalCacheScope === "none"
      ? undefined
      : new Map<string, boolean>();

  return {
    async check(action: ExecutionAction): Promise<ExecutionDecision> {
      if (options.roots.length === 0) {
        return { allowed: false, reason: "no trusted roots configured" };
      }

      if (options.readOnly && action.kind !== "read") {
        return { allowed: false, reason: "read-only mode" };
      }

      for (const path of action.paths ?? []) {
        if (!(await assertPathInsideRoots(options.roots, path))) {
          return { allowed: false, reason: `path outside trusted roots: ${path}` };
        }
      }

      let needsApproval = isMutatingKind(action.kind);

      if (action.kind === "shell" && action.command) {
        const evaluation = evaluateCommandRules(action.command, options.commandRules, {
          denyMetacharacters: options.denyMetacharacters,
        });
        if (evaluation.action === "deny") {
          return {
            allowed: false,
            reason: evaluation.reason ?? "command denied by policy",
          };
        }
        if (evaluation.action === "requireApproval") {
          needsApproval = true;
        }
      }

      if (needsApproval) {
        if (!options.approve) {
          return { allowed: false, reason: "approval required" };
        }

        const key = approvalCacheKey(action);
        if (cache?.has(key)) {
          const cached = cache.get(key);
          if (!cached) {
            return { allowed: false, reason: "approval denied (cached)" };
          }
        } else {
          const approved = await waitForApproval(
            options.approve,
            { action, signal: readAbortSignal(action) },
            options.approvalTimeoutMs,
          );
          cache?.set(key, approved);
          if (!approved) {
            return { allowed: false, reason: "approval denied" };
          }
        }
      }

      return {
        allowed: true,
        exclusive: action.kind === "shell",
      };
    },
  };
}
