/**
 * Suspended-run store entry (roadmap §2.4 ask path, §2.5 store slot). A run that suspends on an
 * `ask` decision writes one `suspended_run` session entry through the store slot, so a later
 * process over the same store can find it and resume. The entry is self-contained: it carries the
 * full redacted run state, so a resume needs no `CheckpointStore` read.
 */
import { parseAgentRunState, type StoredAgentRunState } from "./agent-run-state.js";
import type { AgentRunInterruption, JsonValue, SessionEntry } from "./contracts.js";
import { AgentRunStateError } from "./contracts.js";

export const SUSPENDED_RUN_ENTRY_SCHEMA_VERSION = 1 as const;

/** Loop identity at suspension. `snapshot` is present only when the strategy declares one. */
export interface SuspendedRunLoopRef {
  readonly name: string;
  readonly revision: string;
  readonly snapshot?: JsonValue;
}

/** `SessionEntry.data` for a `suspended_run` entry. */
export interface SuspendedRunEntryData {
  readonly schemaVersion: typeof SUSPENDED_RUN_ENTRY_SCHEMA_VERSION;
  readonly runId: string;
  readonly loop: SuspendedRunLoopRef;
  /** Owner-scoped hook registration ids active when the run suspended. */
  readonly hookIds: readonly string[];
  readonly interruption: AgentRunInterruption;
  /** Full redacted run state; `session.resume` reads it from the branch to continue the run. */
  readonly state: StoredAgentRunState;
}

export function createSuspendedRunEntry(input: {
  readonly id: string;
  readonly sessionId: string;
  readonly parentId?: string;
  readonly runId: string;
  readonly loop: SuspendedRunLoopRef;
  readonly hookIds: readonly string[];
  readonly state: StoredAgentRunState;
}): SessionEntry {
  const data: SuspendedRunEntryData = {
    schemaVersion: SUSPENDED_RUN_ENTRY_SCHEMA_VERSION,
    runId: input.runId,
    loop: input.loop,
    hookIds: [...input.hookIds],
    interruption: input.state.interruption ?? { kind: "tool_approval", reason: "Run suspended", pendingDecisions: [] },
    state: input.state,
  };
  return {
    id: input.id,
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    sessionId: input.sessionId,
    runId: input.runId,
    timestamp: new Date().toISOString(),
    kind: "suspended_run",
    data,
  };
}

/** Fail-closed parse of a `suspended_run` entry's data; a malformed entry never resumes. */
export function parseSuspendedRunEntry(entry: SessionEntry): SuspendedRunEntryData {
  if (entry.kind !== "suspended_run") throw new AgentRunStateError("Not a suspended_run session entry");
  const data = entry.data as Partial<SuspendedRunEntryData> | undefined;
  if (!data || typeof data !== "object" || data.schemaVersion !== SUSPENDED_RUN_ENTRY_SCHEMA_VERSION) {
    throw new AgentRunStateError("Malformed suspended_run session entry");
  }
  if (typeof data.runId !== "string" || data.runId !== entry.runId) {
    throw new AgentRunStateError("Malformed suspended_run session entry runId");
  }
  if (!data.loop || typeof data.loop.name !== "string" || typeof data.loop.revision !== "string") {
    throw new AgentRunStateError("Malformed suspended_run session entry loop");
  }
  if (!Array.isArray(data.hookIds) || data.hookIds.some((id) => typeof id !== "string")) {
    throw new AgentRunStateError("Malformed suspended_run session entry hookIds");
  }
  if (!data.interruption || typeof data.interruption !== "object") {
    throw new AgentRunStateError("Malformed suspended_run session entry interruption");
  }
  const state = parseAgentRunState(data.state, (data.state as { readonly version?: number } | undefined)?.version);
  return {
    schemaVersion: SUSPENDED_RUN_ENTRY_SCHEMA_VERSION,
    runId: data.runId,
    loop: data.loop,
    hookIds: [...data.hookIds],
    interruption: data.interruption,
    state,
  };
}

/** Newest `suspended_run` entry for a session, or `undefined`. */
export async function loadSuspendedRunEntry(
  store: import("./contracts.js").SessionStore,
  sessionId: string,
  runId?: string,
): Promise<SuspendedRunEntryData | undefined> {
  const entries = await store.list(sessionId);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind !== "suspended_run") continue;
    if (runId !== undefined && entry.runId !== runId) continue;
    return parseSuspendedRunEntry(entry);
  }
  return undefined;
}

/**
 * The suspension a session's branch is waiting on: the newest `suspended_run` entry, provided it is the
 * branch tip (package state aside). Anything appended after it, such as a later run or the resumed run's own
 * messages, means that suspension was resolved or abandoned, so it never resumes twice.
 */
export function pendingSuspensionOf(branch: readonly SessionEntry[]): SuspendedRunEntryData | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]!;
    if (entry.kind === "package_state") continue;
    return entry.kind === "suspended_run" ? parseSuspendedRunEntry(entry) : undefined;
  }
  return undefined;
}
