import type { ContentBlock, ExtensionEvent } from "./contracts.js";
import { errorToErrorInfo } from "./redaction.js";

export type MiddlewareHookName =
  | "beforeProviderTurn"
  | "provider_request"
  | "input_assembly"
  | "prompt_build"
  | "context"
  | "tool_call"
  | "tool_result"
  | "retry"
  | "compaction_request"
  | "compaction"
  | "session_start"
  | "session_shutdown";

/** Provenance of a host-answered turn (plan 096). An id, never free host code. */
export interface DeterministicTurnProvenance {
  /** Answering middleware id; bounded, replay-stable, and auditable. */
  readonly middleware: string;
}

/** Host middleware answer that completes a turn without any provider request (plan 096). */
export interface DeterministicTurnAnswer {
  /** Assistant content with provider content-block shape; tool calls are rejected (no provider ran). */
  readonly content: readonly ContentBlock[];
  /** Mandatory: a deterministic turn can never masquerade as model output. */
  readonly provenance: DeterministicTurnProvenance;
}

/**
 * Payload for the `beforeProviderTurn` hook (plan 096). Host middleware sets `answer` to complete the
 * turn deterministically; leaving it absent/undefined sends the turn to the provider as usual.
 */
export interface BeforeProviderTurnPayload {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;
  /** Concatenated text blocks of the latest user-role message in the assembled request. */
  readonly userText: string;
  /** Set by host middleware to answer without a provider call. */
  readonly answer?: DeterministicTurnAnswer;
}

/** Host answered with a malformed deterministic turn. Fails the run closed — never falls through. */
export class DeterministicTurnError extends Error {
  readonly code = "ERR_PRISM_DETERMINISTIC_TURN";
  constructor(message: string) {
    super(message);
    this.name = "DeterministicTurnError";
  }
}

/** Provenance ids stay ids: bounded, no whitespace or separators outside the id alphabet. */
const DETERMINISTIC_MIDDLEWARE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
// Assistant-visible blocks only: a deterministic answer cannot smuggle tool execution/authority.
const DETERMINISTIC_BLOCK_TYPES: ReadonlySet<string> = new Set(["text", "image", "audio", "file", "document", "video", "thinking"]);

/**
 * Validate a host deterministic answer at the trust boundary: non-empty assistant-visible content and
 * mandatory bounded provenance. Throws instead of degrading to a provider call.
 */
export function validateDeterministicTurnAnswer(value: unknown): DeterministicTurnAnswer {
  if (typeof value !== "object" || value === null) throw new DeterministicTurnError("answer must be an object");
  const answer = value as { readonly content?: unknown; readonly provenance?: unknown };
  if (!Array.isArray(answer.content) || answer.content.length === 0) {
    throw new DeterministicTurnError("answer.content must be a non-empty content block array");
  }
  for (const block of answer.content) {
    const type = (block as { readonly type?: unknown } | null)?.type;
    if (typeof block !== "object" || block === null || typeof type !== "string" || !DETERMINISTIC_BLOCK_TYPES.has(type)) {
      throw new DeterministicTurnError(
        "answer.content blocks must be assistant-visible content blocks (text, image, audio, file, document, video, thinking)",
      );
    }
    if (type === "text" && typeof (block as { readonly text?: unknown }).text !== "string") {
      throw new DeterministicTurnError("answer.content text blocks require a string text");
    }
    if (type === "thinking" && typeof (block as { readonly text?: unknown }).text !== "string") {
      throw new DeterministicTurnError("answer.content thinking blocks require a string text");
    }
  }
  const middleware = (answer.provenance as { readonly middleware?: unknown } | null | undefined)?.middleware;
  if (typeof middleware !== "string" || !DETERMINISTIC_MIDDLEWARE_ID.test(middleware)) {
    throw new DeterministicTurnError("answer.provenance.middleware must be a bounded id (1-64 chars: letters, digits, . _ : -)");
  }
  return { content: answer.content as readonly ContentBlock[], provenance: { middleware } };
}

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
      for (const [index, middleware] of (byHook.get(hook) ?? []).entries()) {
        try {
          let calledNext = false;
          const next: MiddlewareNext<typeof current> = async (nextValue) => {
            // Double next() forks the chain value nondeterministically — always a bug.
            if (calledNext) throw new Error(`Middleware hook "${hook}" #${index}: next() called more than once`);
            calledNext = true;
            current = nextValue;
            return current;
          };
          const result = await (middleware as Middleware<typeof current>)(current, next);
          if (!calledNext) current = result;
          else if (result !== undefined && result !== current) {
            // next(v) already committed the chain value; a conflicting return is silently
            // discarded. Ambiguous rather than certainly-wrong, so diagnose, don't throw.
            await options.onError?.(
              middlewareError(
                new Error(
                  `Middleware hook "${hook}" #${index}: called next(value) and returned a different value; the next() value wins, the return is discarded`,
                ),
                hook,
                secrets,
              ),
            );
          }
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
