import type { ContextProvider } from "@arnilo/prism";
import { MemoryValidationError } from "../errors.js";
import { assertNotAborted } from "../util.js";
import type { MemoryFabricObservationSource } from "./types.js";
import type { MemoryFabricSettings } from "./workers.js";

/**
 * The minimum the fabric needs from a session: its id. An `AgentSession` satisfies it, and so
 * does a test double — the fabric never runs the session, it gates on it.
 */
export interface MemoryFabricAttachableSession {
  readonly id: string;
}

export interface MemoryFabricAttachOptions {
  /** Aborting the caller's signal detaches this session (worker enrichment and tool access stop). */
  readonly signal?: AbortSignal;
}

export interface AttachedMemoryFabricSession<S extends MemoryFabricAttachableSession = MemoryFabricAttachableSession> {
  readonly session: S;
  /** The context seam for this fabric: the same blocks `createMemory` resolves. */
  readonly contextProvider: ContextProvider;
  /** Create-time settings this fabric resolved (workers, thresholds, caps). */
  readonly settings: MemoryFabricSettings;
  /** Removes the session from the gate; safe to call twice. */
  detach(): void;
}

export interface MemoryFabricAttachDeps {
  /** Live gate: sessions in this set may drive tools and enable the workers. */
  readonly attachedSessions: Set<string>;
  readonly settings: MemoryFabricSettings;
  readonly contextProvider: ContextProvider;
  readonly observational?: MemoryFabricObservationSource;
}

function assertAttachableSession(session: unknown): asserts session is MemoryFabricAttachableSession {
  if (session === null || typeof session !== "object") {
    throw new MemoryValidationError("attach requires a session");
  }
  const candidate = session as { id?: unknown; entries?: unknown; signal?: unknown };
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    throw new MemoryValidationError("attach requires a session with a non-empty id");
  }
  if (candidate.entries !== undefined && typeof candidate.entries !== "function") {
    throw new MemoryValidationError("attach session.entries must be a function");
  }
}

/**
 * Session gate for one fabric. Attaching authorizes a session's tool calls and turns on the
 * opt-in workers; `detach` (or aborting the attach signal) takes it back. Nothing runs in the
 * background: no timers, no loop — the gate is read on each tool call and each write.
 */
export function createFabricAttach(
  deps: MemoryFabricAttachDeps,
): <S extends MemoryFabricAttachableSession>(session: S, options?: MemoryFabricAttachOptions) => AttachedMemoryFabricSession<S> {
  return function attach<S extends MemoryFabricAttachableSession>(
    session: S,
    options: MemoryFabricAttachOptions = {},
  ): AttachedMemoryFabricSession<S> {
    assertAttachableSession(session);
    const signal = options.signal;
    if (signal !== undefined) {
      if (typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function") {
        throw new MemoryValidationError("attach signal must be an AbortSignal");
      }
      assertNotAborted(signal);
    }
    // An attached session may not read another branch: episode views and conversation search walk
    // the fabric's observational session, so a mismatch here would silently answer for the wrong one.
    const sourceId = deps.observational?.session.id;
    if (sourceId !== undefined && sourceId !== session.id) {
      throw new MemoryValidationError(`attach session ${session.id} does not match the fabric's observational session ${sourceId}`);
    }
    const detach = (): void => {
      deps.attachedSessions.delete(session.id);
    };
    if (signal !== undefined) signal.addEventListener("abort", detach, { once: true });
    deps.attachedSessions.add(session.id);
    return { session, contextProvider: deps.contextProvider, settings: deps.settings, detach };
  };
}
