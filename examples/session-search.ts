import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionEntry, type SessionSearchHit } from "@arnilo/prism";
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";

// Workspace session search over stored sessions (plan 095). One query API covers the indexed
// stores (SQLite FTS5 / Postgres tsvector) and the linear-scan fallbacks (memory, JSONL): hits
// carry the matched entry id, run id, 1-based turn, store score, and a bounded snippet.
// Network-free: an in-memory SQLite database plus a temp JSONL file.

const WORKSPACES: Record<string, string> = { "session-auth": "/repo/app", "session-docs": "/repo/docs" };

function corpus(): ReturnType<typeof createSessionEntry>[] {
  return [
    createSessionEntry({
      id: "auth-root",
      sessionId: "session-auth",
      timestamp: "2026-01-01T00:00:02.000Z",
      kind: "message",
      runId: "run-auth",
      label: "auth-flake",
      message: { role: "user", content: [{ type: "text", text: "fix the flaky auth test timeout" }] },
      metadata: { workspaceRoot: WORKSPACES["session-auth"] },
    }),
    createSessionEntry({
      id: "auth-summary",
      sessionId: "session-auth",
      parentId: "auth-root",
      timestamp: "2026-01-01T00:00:03.000Z",
      kind: "summary",
      runId: "run-auth",
      summary: "Auth test stabilized by seeding the clock.",
    }),
    createSessionEntry({
      id: "docs-root",
      sessionId: "session-docs",
      timestamp: "2026-01-01T00:00:01.000Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "fix the flaky auth docs build" }] },
      metadata: { workspaceRoot: WORKSPACES["session-docs"] },
    }),
    createSessionEntry({
      id: "deps-root",
      sessionId: "session-deps",
      timestamp: "2026-01-01T00:00:00.500Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "bump the linter and fix warnings" }] },
      metadata: { workspaceRoot: "/repo/docs" },
    }),
    createSessionEntry({
      id: "web-root",
      sessionId: "session-web",
      timestamp: "2026-01-01T00:00:00.500Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "add a health endpoint" }] },
      metadata: { workspaceRoot: "/repo/web" },
    }),
  ];
}

/** Hit shape a host render: pointers to the matched entry plus the store's relevance. */
function hit(hit: SessionSearchHit): Record<string, unknown> {
  return {
    sessionId: hit.sessionId,
    entryId: hit.entryId,
    runId: hit.runId,
    turn: hit.turn,
    score: hit.score === undefined ? undefined : Number(hit.score.toFixed(4)),
    snippet: hit.snippet,
  };
}

async function demo(): Promise<Record<string, unknown>> {
  const entries = corpus();
  const stem = `prism-session-search-${process.pid}`;
  const dbPath = join(tmpdir(), `${stem}.db`);
  const jsonlPath = join(tmpdir(), `${stem}.jsonl`);
  const persistence = createSqlitePersistence({ filename: dbPath });
  try {
    // SQLite: the FTS5 index is maintained at append time, so the query is an indexed lookup.
    for (const sessionId of new Set(entries.map((entry) => entry.sessionId))) {
      const first = entries.find((entry) => entry.sessionId === sessionId);
      await persistence.appendSession!({
        id: sessionId,
        createdAt: first?.timestamp ?? "2026-01-01T00:00:00.000Z",
        updatedAt: first?.timestamp ?? "2026-01-01T00:00:00.000Z",
        metadata: { workspaceRoot: WORKSPACES[sessionId] },
      });
    }
    for (const entry of entries) await persistence.append(entry);

    const indexed = await persistence.searchSessions!({ workspaceRoot: "/repo/app", query: "flaky auth", limit: 10 });
    // Annotation search: the same API restricted to annotation entry kinds finds the summary.
    const annotations = await persistence.searchSessions!({ query: "clock", kind: ["summary"], limit: 10 });

    // JSONL: no index - the same query scans the file (O(corpus) per query) with the same hit shape.
    const writer = createJsonlSessionStore(jsonlPath);
    for (const entry of entries) await writer.append(entry);
    const linear = await createJsonlSessionStore(jsonlPath).searchSessions!({
      workspaceRoot: "/repo/app",
      query: "flaky auth",
      limit: 10,
    });

    assert.equal(indexed.items[0]?.entryId, "auth-root");
    assert.equal(indexed.items[0]?.runId, "run-auth");
    assert.equal(indexed.items[0]?.turn, 1);
    assert.match(indexed.items[0]?.snippet ?? "", /flaky auth/i);
    assert.equal(annotations.items[0]?.entryId, "auth-summary");
    assert.equal(annotations.items[0]?.turn, 2);
    assert.deepEqual(
      linear.items.map((hit) => [hit.sessionId, hit.entryId, hit.turn]),
      indexed.items.map((hit) => [hit.sessionId, hit.entryId, hit.turn]),
    );

    return {
      indexSearch: indexed.items.map(hit),
      annotationSearch: annotations.items.map(hit),
      linearFallback: linear.items.map(hit),
    };
  } finally {
    persistence.close();
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, jsonlPath]) rmSync(file, { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo(), null, 2));
