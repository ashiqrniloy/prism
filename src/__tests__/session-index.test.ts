import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS,
  DEFAULT_SESSION_SEARCH_LIMIT,
  HARD_MAX_SESSION_SEARCH_LIMIT,
  HARD_MAX_SESSION_SEARCH_QUERY_BYTES,
  SESSION_SEARCH_UNSUPPORTED_CODE,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SessionSearchUnsupportedError,
  isSessionSearchUnsupported,
  resolveSessionSearchQuery,
  type SessionIndex,
  type SessionSearchHit,
  type SessionStore,
} from "../index.js";
import { assertSessionStoreConforms } from "../testing/session-store-conformance.js";
import { createMemorySessionStore, createSessionEntry } from "../session-stores.js";
import { createJsonlSessionStore } from "../node/session-store-jsonl.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("SessionIndex contracts", () => {
  it("resolveSessionSearchQuery applies defaults and rejects invalid limits/queries", () => {
    const resolved = resolveSessionSearchQuery({});
    assert.equal(resolved.limit, DEFAULT_SESSION_SEARCH_LIMIT);
    assert.equal(resolved.order, "desc");
    assert.equal(SESSION_SEARCH_WORKSPACE_METADATA_KEY, "workspaceRoot");

    assert.throws(() => resolveSessionSearchQuery({ limit: 0 }), TypeError);
    assert.throws(() => resolveSessionSearchQuery({ limit: Number.NaN }), TypeError);
    assert.throws(() => resolveSessionSearchQuery({ limit: HARD_MAX_SESSION_SEARCH_LIMIT + 1 }), TypeError);
    assert.throws(() => resolveSessionSearchQuery({ order: "sideways" as "asc" }), TypeError);
    assert.throws(
      () => resolveSessionSearchQuery({ query: "x".repeat(HARD_MAX_SESSION_SEARCH_QUERY_BYTES + 1) }),
      TypeError,
    );
    assert.throws(
      () => resolveSessionSearchQuery({ cursor: "c".repeat(HARD_MAX_SESSION_SEARCH_QUERY_BYTES) }),
      TypeError,
    );
  });

  it("exports SessionIndex seam and optional SessionStore.searchSessions", async () => {
    const hits: SessionSearchHit[] = [
      { sessionId: "s1", leafId: "leaf-1", label: "auth" },
    ];
    const index: SessionIndex = {
      async search(query) {
        const q = resolveSessionSearchQuery(query);
        return { items: hits.filter((hit) => !q.label || hit.label === q.label).slice(0, q.limit) };
      },
    };
    const page = await index.search({ label: "auth", limit: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.sessionId, "s1");
    assert.equal(page.items[0]?.leafId, "leaf-1");

    const base = createMemorySessionStore(undefined, { sessionSearchMode: "unsupported" });
    const store: SessionStore = {
      append: (entry, options) => base.append(entry, options),
      list: (sessionId) => base.list(sessionId),
      async searchSessions(query) {
        return index.search(query);
      },
    };
    await store.append(createSessionEntry({ sessionId: "s1", kind: "label", label: "auth" }));
    await assertSessionStoreConforms(store, { exerciseSearchSessions: true });
  });

  it("memory linear search: hit/miss/pagination/ownership/cap", async () => {
    const store = createMemorySessionStore();
    await store.append(createSessionEntry({
      id: "search-root",
      sessionId: "search-session",
      timestamp: "2026-01-01T00:00:02.000Z",
      kind: "message",
      label: "auth-flake",
      summary: "flaky login",
      message: { role: "user", content: [{ type: "text", text: "fix flaky auth test timeout" }] },
      metadata: { workspaceRoot: "/repo", tenantId: "tenant-a" },
      model: { provider: "anthropic", model: "claude-sonnet" },
    }));
    await store.append(createSessionEntry({
      id: "other-root",
      sessionId: "other-session",
      timestamp: "2026-01-01T00:00:01.000Z",
      kind: "label",
      label: "unrelated",
    }));

    const byLabel = await store.searchSessions!({ label: "auth-flake", limit: 10 });
    assert.equal(byLabel.items.length, 1);
    assert.equal(byLabel.items[0]?.sessionId, "search-session");
    assert.equal(byLabel.items[0]?.leafId, "search-root");

    const byQuery = await store.searchSessions!({ query: "flaky auth", limit: 10 });
    assert.ok(byQuery.items.some((hit) => hit.sessionId === "search-session"));

    const byWorkspace = await store.searchSessions!({ workspaceRoot: "/repo", limit: 10 });
    assert.deepEqual(byWorkspace.items.map((hit) => hit.sessionId), ["search-session"]);
    assert.equal(byWorkspace.items[0]?.metadata?.workspaceRoot, "/repo");

    const owned = await store.searchSessions!({ tenantId: "tenant-a", limit: 10 });
    assert.deepEqual(owned.items.map((hit) => hit.sessionId), ["search-session"]);
    assert.equal((await store.searchSessions!({ tenantId: "missing", limit: 10 })).items.length, 0);

    const page1 = await store.searchSessions!({ limit: 1, order: "asc" });
    assert.equal(page1.items.length, 1);
    assert.ok(page1.nextCursor);
    const page2 = await store.searchSessions!({ limit: 1, order: "asc", cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.notEqual(page2.items[0]?.sessionId, page1.items[0]?.sessionId);

    await assertSessionStoreConforms(store, { exerciseSearchSessions: true });

    // Cap: sessions beyond DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS are not scanned.
    const capped = createMemorySessionStore();
    for (let i = 0; i < DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS + 1; i++) {
      await capped.append(createSessionEntry({
        id: `cap-${i}`,
        sessionId: `cap-session-${i}`,
        timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
        kind: "label",
        label: i === DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS ? "needle-beyond-cap" : "noise",
      }));
    }
    const beyond = await capped.searchSessions!({ label: "needle-beyond-cap", limit: 10 });
    assert.equal(beyond.items.length, 0);
  });

  it("memory unsupported mode throws typed error, not empty page", async () => {
    const store = createMemorySessionStore([], { sessionSearchMode: "unsupported" });
    await store.append(createSessionEntry({ sessionId: "s1", kind: "label", label: "x" }));
    await assert.rejects(
      () => store.searchSessions!({ limit: 10 }),
      (error: unknown) =>
        error instanceof SessionSearchUnsupportedError
        && isSessionSearchUnsupported(error)
        && error.code === SESSION_SEARCH_UNSUPPORTED_CODE,
    );
  });

  it("JSONL searchSessions throws unsupported", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "prism-jsonl-search-")), "sessions.jsonl");
    const store = createJsonlSessionStore(path);
    await assert.rejects(
      () => store.searchSessions!({ limit: 10 }),
      (error: unknown) => isSessionSearchUnsupported(error),
    );
  });
});
