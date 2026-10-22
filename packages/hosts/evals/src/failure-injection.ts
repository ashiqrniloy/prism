import type { AgentConfig, SessionEntry, } from "@arnilo/prism";
import { EvalError } from "./errors.js";

export interface SessionStore {
  append(entry: SessionEntry, options?: unknown): Promise<void>;
  list(sessionId: string): Promise<readonly SessionEntry[]>;
  get?(id: string): Promise<SessionEntry | undefined>;
}

export interface FailureInjectionOptions {
  readonly failStore?: boolean;
  readonly denyTools?: readonly string[];
  readonly unknownEffect?: boolean;
}

type HookRegistrar = Parameters<NonNullable<AgentConfig["hooks"]>>[0];

/**
 * Returns an `AgentConfig.hooks` registration function for controlled eval failure injection.
 * - `denyTools`: `tool.call` denies named tools with an injected denial.
 * - `unknownEffect`: mutating tool executions skip their implementation and return an unknown effect result.
 */
export function failureInjection(injection: FailureInjectionOptions): NonNullable<AgentConfig["hooks"]> {
  const denySet = new Set(injection.denyTools ?? []);
  const unknownEffect = injection.unknownEffect === true;

  return (hooks: HookRegistrar) => {
    const mutatingCallIds = new Set<string>();

    if (denySet.size > 0 || unknownEffect) {
      hooks.on("tool.call", (payload) => {
        if (denySet.has(payload.name)) {
          return { deny: "injected tool denial" };
        }
        if (unknownEffect) {
          const isMutating =
            payload.effects.length === 0 ||
            payload.effects.some((e) => e === "write" || e === "execute" || e === "external");
          if (isMutating) {
            mutatingCallIds.add(payload.callId);
          }
        }
        return undefined;
      });
    }

    if (unknownEffect) {
      hooks.on("tool.execute", async (payload, next) => {
        if (mutatingCallIds.has(payload.callId)) {
          return {
            toolCallId: payload.callId,
            name: payload.name,
            error: {
              message: "tool effect outcome requires reconciliation",
              code: "ERR_PRISM_TOOL_EFFECT_UNKNOWN",
            },
          };
        }
        return next(payload);
      });
    }
  };
}

/**
 * Wraps a SessionStore so that the run fails on its first `append`.
 */
export function failingStore(store?: SessionStore): SessionStore {
  return {
    async append(_entry: SessionEntry, _options?: unknown): Promise<void> {
      throw new EvalError("injected store failure", "ERR_PRISM_EVAL_STORE_FAILURE");
    },
    async list(sessionId: string): Promise<readonly SessionEntry[]> {
      return store ? store.list(sessionId) : [];
    },
    ...(store?.get ? { get: (id: string) => store.get!(id) } : {}),
  } as SessionStore;
}
