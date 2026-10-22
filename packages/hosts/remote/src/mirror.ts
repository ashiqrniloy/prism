import {
  type AgentEvent,
  type OwnershipScope,
  SESSION_LINKS_DATA_KEY,
  type SessionEntry,
  type SessionOptions,
  type SessionStore,
} from "@arnilo/prism";

/**
 * Archives one remote session into a local store, from the proxied event stream: a links `metadata` entry when
 * the mirror session is new, then one `message` entry per `message.completed`, chained by `parentId`.
 * Entries are stored as the remote sent them (the remote already redacted them), stamped with `ownership`.
 */
export interface SessionMirror {
  /** Reads the mirror's tip and writes the links entry when the session is new. */
  open(): Promise<void>;
  /** Queues the writes for `event`. Resolves with `flush()`. */
  record(event: AgentEvent): void;
  /** Resolves once every queued write landed. Rejects with the first write failure. */
  flush(): Promise<void>;
  entries(): Promise<readonly SessionEntry[]>;
}

export interface MirrorOptions {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly endpointId: string;
  readonly agent: string;
  readonly parent?: SessionOptions["parent"];
  readonly ownership?: OwnershipScope;
}

export function createSessionMirror(options: MirrorOptions): SessionMirror {
  const { store, sessionId } = options;
  const stamp: Record<string, unknown> = { remote: options.endpointId };
  for (const key of ["tenantId", "accountId", "userId"] as const) {
    const value = options.ownership?.[key];
    if (value !== undefined) stamp[key] = value;
  }
  let tip: string | undefined;
  let tail: Promise<void> = Promise.resolve();
  let failure: unknown;

  const append = async (entry: Omit<SessionEntry, "id" | "sessionId" | "timestamp" | "parentId" | "metadata">) => {
    const full: SessionEntry = {
      ...entry,
      id: `mirror-${crypto.randomUUID()}`,
      sessionId,
      timestamp: new Date().toISOString(),
      ...(tip !== undefined ? { parentId: tip } : {}),
      metadata: stamp,
    };
    await store.append(full, tip !== undefined ? { expectedParentId: tip } : undefined);
    tip = full.id;
  };

  const queue = (job: () => Promise<void>) => {
    tail = tail.then(job).catch((error) => {
      failure ??= error;
    });
  };

  return {
    async open() {
      const existing = await store.list(sessionId);
      if (existing.length > 0) {
        tip = existing[existing.length - 1]?.id;
        return;
      }
      await append({
        kind: "metadata",
        data: { [SESSION_LINKS_DATA_KEY]: { ...(options.parent ?? {}), actor: { kind: "prism", agent: options.agent } } },
      });
    },
    record(event) {
      if (event.type !== "message.completed") return;
      queue(() => append({ kind: "message", runId: event.runId, message: event.message }));
    },
    async flush() {
      await tail;
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        throw error instanceof Error ? error : new Error("mirror write failed");
      }
    },
    entries: () => store.list(sessionId),
  };
}
