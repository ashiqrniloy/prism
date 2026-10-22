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
import { OwnershipScopeError, SessionNotFoundError, UnsupportedStoreCapabilityError } from "../contracts.js";
import { entriesInScope, getSessionBranchEntries, OWNERSHIP_SCOPE_KEYS, summarizeSession } from "../session-stores.js";

/** What a scope conflict does: `throw` for an authorization scope (session open, run), `base` for a query filter. */
type ScopeConflictMode = "throw" | "base";

/**
 * Plan 177 Task 4: the one scope-narrowing helper. A caller may add fields the base left undefined and may
 * repeat a base field, but never change one. `mode` decides what a changed field does: `"throw"` (the
 * session and run paths, where the request claims an identity) rejects it with `OwnershipScopeError`;
 * `"base"` (a `sessions.list/get/delete/search` query filter) keeps the base scope.
 */
export function narrowScope<T extends OwnershipScope>(
  base: OwnershipScope | undefined,
  requested: T | undefined,
  kind: string,
  mode: ScopeConflictMode = "throw",
): T | undefined {
  if (!base) return requested;
  if (!requested) return base as T;
  const merged: Record<string, unknown> = { ...(requested as Record<string, unknown>) };
  for (const key of OWNERSHIP_SCOPE_KEYS) {
    const own = base[key];
    if (own === undefined) continue;
    const other = requested[key];
    if (other !== undefined && other !== own && mode === "throw") {
      throw new OwnershipScopeError(`${kind} ownership scope ${key} "${other}" widens the declared scope "${own}"`);
    }
    merged[key] = own;
  }
  return merged as T;
}

/** The agent's scope always wins over a caller-supplied one: a query can narrow it, never widen it. */
function scoped<T extends OwnershipScope>(query: T | undefined, scope: OwnershipScope | undefined): T {
  return narrowScope(scope, query, "Session query", "base") ?? ({} as T);
}

/**
 * `SessionIndex` over a store without an `Agent`: list, get, delete and search under `ownership`, enforced
 * exactly as `agent.sessions` enforces it. `store` is a store or a getter (the agent resolves its slot lazily).
 */
export function createSessionIndex(
  store: SessionStore | (() => SessionStore),
  options: { readonly ownership?: OwnershipScope } = {},
): SessionIndex {
  const sources = {
    store: typeof store === "function" ? store : () => store,
    ownership: options.ownership,
  };
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
