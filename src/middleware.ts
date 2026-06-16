import type { ExtensionEvent } from "./contracts.js";
import { errorToErrorInfo } from "./redaction.js";

export type MiddlewareHookName =
  | "provider_request"
  | "provider_response"
  | "input_assembly"
  | "prompt_build"
  | "context"
  | "tool_call"
  | "tool_result"
  | "retry"
  | "compaction"
  | "session_start"
  | "session_shutdown";

export type MiddlewareNext<T> = (value: T) => Promise<T>;
export type Middleware<T = unknown> = (value: T, next: MiddlewareNext<T>) => T | Promise<T>;

export interface MiddlewareRegistryOptions {
  readonly errorPolicy?: "event" | "throw";
  readonly secrets?: readonly (string | undefined)[];
  readonly onError?: (event: ExtensionEvent) => void | Promise<void>;
}

export interface MiddlewareRegistry {
  use<T>(hook: MiddlewareHookName | string, middleware: Middleware<T>): () => void;
  run<T>(hook: MiddlewareHookName | string, value: T): Promise<T>;
  list(hook: MiddlewareHookName | string): readonly Middleware[];
}

function middlewareError(error: unknown, hook: string, secrets: readonly (string | undefined)[]): ExtensionEvent {
  return { type: "extension_error", extension: `middleware:${hook}`, error: errorToErrorInfo(error, secrets) };
}

export function createMiddlewareRegistry(options: MiddlewareRegistryOptions = {}): MiddlewareRegistry {
  const byHook = new Map<string, Middleware[]>();
  const errorPolicy = options.errorPolicy ?? "event";
  const secrets = options.secrets ?? [];

  return {
    use(hook, middleware) {
      const list = byHook.get(hook) ?? [];
      list.push(middleware as Middleware);
      byHook.set(hook, list);
      return () => {
        const next = (byHook.get(hook) ?? []).filter((item) => item !== middleware);
        if (next.length === 0) byHook.delete(hook);
        else byHook.set(hook, next);
      };
    },
    async run(hook, value) {
      let current = value;
      for (const middleware of byHook.get(hook) ?? []) {
        try {
          let calledNext = false;
          const next: MiddlewareNext<typeof current> = async (nextValue) => {
            calledNext = true;
            current = nextValue;
            return current;
          };
          const result = await (middleware as Middleware<typeof current>)(current, next);
          if (!calledNext) current = result;
        } catch (error) {
          if (errorPolicy === "throw") throw error;
          await options.onError?.(middlewareError(error, hook, secrets));
        }
      }
      return current;
    },
    list(hook) {
      return [...(byHook.get(hook) ?? [])];
    },
  };
}
