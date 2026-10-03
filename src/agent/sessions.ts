/** `agent.sessions` (roadmap §2.3): list, get, delete and search over the `store` slot's declared capabilities. */
import type {
  OwnershipScope,
  PersistencePage,
  SessionIndex,
  SessionListQuery,
  SessionSearchHit,
  SessionSearchQuery,
  SessionStore,
  SessionSummary,
} from "../contracts.js";
import { SessionNotFoundError, UnsupportedStoreCapabilityError } from "../contracts.js";
import { entriesInScope, getSessionBranchEntries, summarizeSession } from "../session-stores.js";

/** The agent's scope always wins over a caller-supplied one: a query can narrow it, never widen it. */
function scoped<T extends OwnershipScope>(query: T | undefined, scope: OwnershipScope | undefined): T {
  return {
    ...(query ?? {}),
    ...(scope?.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
    ...(scope?.accountId !== undefined ? { accountId: scope.accountId } : {}),
    ...(scope?.userId !== undefined ? { userId: scope.userId } : {}),
  } as T;
}

export function createSessionIndex(sources: {
  readonly store: () => SessionStore;
  readonly ownership: OwnershipScope | undefined;
}): SessionIndex {
  return {
    async list(query?: SessionListQuery): Promise<PersistencePage<SessionSummary>> {
      const store = sources.store();
      if (!store.listSessions) throw new UnsupportedStoreCapabilityError("listSessions");
      return store.listSessions(scoped(query, sources.ownership));
    },
    async get(id: string): Promise<SessionSummary | undefined> {
      const store = sources.store();
      // One session's entries: the baseline `list` every store has, so `get` needs no extra capability.
      const entries = await store.list(id);
      if (entries.length === 0 || !entriesInScope(entries, sources.ownership)) return undefined;
      const leaf = getSessionBranchEntries(entries, {}).at(-1)?.id;
      return summarizeSession(id, entries, leaf);
    },
    async delete(id: string): Promise<void> {
      const store = sources.store();
      if (!store.deleteSession) throw new UnsupportedStoreCapabilityError("deleteSession");
      if (!(await store.deleteSession(id, sources.ownership))) throw new SessionNotFoundError(id);
    },
    async search(query?: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>> {
      const store = sources.store();
      if (!store.searchSessions) throw new UnsupportedStoreCapabilityError("searchSessions");
      return store.searchSessions(scoped(query, sources.ownership));
    },
  };
}
