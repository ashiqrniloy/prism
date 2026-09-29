import { afterEach, beforeEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  providerDone,
  providerError,
  providerTextDelta,
} from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import {
  compactSession,
  ensureDurableSessionRecord,
  formatSessionOption,
  getCanonicalWorkspaceRoot,
  legacySessionDbNotice,
  resolveSessionDbPath,
  resolveSessionStore,
  searchRepoSessions,
} from "../sessions.js";

describe("Repo-Scoped Sessions & Compaction", () => {
  let tempDir: string;
  let repoA: string;
  let repoB: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "prism-code-sessions-test-"));
    repoA = join(tempDir, "repo-a");
    repoB = join(tempDir, "repo-b");
    dbPath = join(tempDir, "sessions.db");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("Two real repo roots in same store plus >one result page: chooser lists all and only current repo, including empty sessions", async () => {
    const store = createSqlitePersistence({ filename: dbPath });

    // Populate repoA with 25 sessions (> 1 page where limit is 20)
    // First 10 sessions have transcript entries, remaining 15 are empty sessions
    for (let i = 1; i <= 25; i++) {
      const sessionId = `repoA-session-${String(i).padStart(2, "0")}`;
      const time = new Date(Date.now() + i * 1000).toISOString();
      await ensureDurableSessionRecord(store, sessionId, repoA, {
        createdAt: time,
        updatedAt: time,
        userId: "alice",
      });

      if (i <= 10) {
        await store.append(
          createSessionEntry({
            id: `entry-a-${i}`,
            sessionId,
            timestamp: time,
            kind: "message",
            message: { role: "user", content: [{ type: "text", text: `Work on repoA task ${i}` }] },
          }),
        );
      }
    }

    // Populate repoB with 5 sessions
    for (let j = 1; j <= 5; j++) {
      const sessionId = `repoB-session-${j}`;
      const time = new Date(Date.now() + 100000 + j * 1000).toISOString();
      await ensureDurableSessionRecord(store, sessionId, repoB, {
        createdAt: time,
        updatedAt: time,
        userId: "bob",
      });
      await store.append(
        createSessionEntry({
          id: `entry-b-${j}`,
          sessionId,
          timestamp: time,
          kind: "message",
          message: { role: "user", content: [{ type: "text", text: `Work on repoB task ${j}` }] },
        }),
      );
    }

    // Page 1 for repoA (limit 20)
    const page1 = await searchRepoSessions(store, {
      workspaceRoot: repoA,
      limit: 20,
    });

    assert.equal(page1.items.length, 20);
    assert.ok(page1.nextCursor !== undefined, "Expected nextCursor for page 2");

    // All items must belong to repoA, none to repoB
    for (const item of page1.items) {
      assert.ok(item.sessionId.startsWith("repoA-session-"), `Expected repoA session hit, got ${item.sessionId}`);
    }

    // Page 2 for repoA
    const page2 = await searchRepoSessions(store, {
      workspaceRoot: repoA,
      cursor: page1.nextCursor,
      limit: 20,
    });

    assert.equal(page2.items.length, 5);
    for (const item of page2.items) {
      assert.ok(item.sessionId.startsWith("repoA-session-"), `Expected repoA session hit on page 2, got ${item.sessionId}`);
    }

    // Total unique sessions for repoA across both pages must be 25
    const allRepoASessions = new Set([...page1.items, ...page2.items].map((s) => s.sessionId));
    assert.equal(allRepoASessions.size, 25);

    // Empty sessions (e.g. repoA-session-25) are included!
    assert.ok(allRepoASessions.has("repoA-session-25"), "Empty session must be included in search hits");
    assert.ok(allRepoASessions.has("repoA-session-01"), "Session with entries must be included in search hits");

    // Search for repoB must return all and only repoB sessions (exactly 5)
    const repoBResult = await searchRepoSessions(store, {
      workspaceRoot: repoB,
      limit: 20,
    });

    assert.equal(repoBResult.items.length, 5);
    for (const item of repoBResult.items) {
      assert.ok(item.sessionId.startsWith("repoB-session-"), `Expected repoB session, got ${item.sessionId}`);
    }
  });

  it("New session empty, resume restores leaf/model after process recreation", async () => {
    const store = createSqlitePersistence({ filename: dbPath });

    const provider = createMockProvider([
      providerTextDelta("Initial greeting response"),
      providerDone(),
      providerTextDelta("Second run response continuing branch"),
      providerDone(),
    ]);

    const agent = createAgent({
      provider,
      store,
      model: { provider: "mock", model: "default" },
    });

    // 1. Fresh session is initially empty
    const session1 = agent.createSession({ id: "resume-test-sess" });
    const initialEntries = await session1.entries();
    assert.equal(initialEntries.length, 0, "New session must be empty");

    // Run first prompt
    const run1 = await session1.run("Hello from run 1");
    assert.ok(run1.leafId !== undefined, "Run 1 must yield a leafId");

    const entriesAfterRun1 = await session1.entries();
    assert.ok(entriesAfterRun1.length > 0, "Session must have entries after run 1");
    const leaf1 = run1.leafId;

    // 2. Simulate process recreation: recreate agent and store connection from scratch
    const recreatedStore = createSqlitePersistence({ filename: dbPath });
    const recreatedAgent = createAgent({
      provider,
      store: recreatedStore,
      model: { provider: "mock", model: "default" },
    });

    // Resume session with stored leafId
    const resumedSession = recreatedAgent.createSession({
      id: "resume-test-sess",
      leafId: leaf1,
    });

    const resumedEntries = await resumedSession.entries();
    assert.equal(resumedEntries.length, entriesAfterRun1.length, "Resumed session must restore previous entries");
    assert.equal(resumedEntries.at(-1)?.id, leaf1, "Resumed session leaf must match previous leafId");

    // Next run continues the existing branch from leaf1
    const run2 = await resumedSession.run("Hello from run 2");
    assert.ok(run2.leafId !== undefined && run2.leafId !== leaf1);

    const entriesAfterRun2 = await resumedSession.entries();
    assert.ok(entriesAfterRun2.length > resumedEntries.length);
  });

  it("Provider compaction failure preserves leaf and raw entries", async () => {
    const store = createSqlitePersistence({ filename: dbPath });

    const normalProvider = createMockProvider([providerTextDelta("Assistant response 1"), providerDone()]);

    const agent = createAgent({
      provider: normalProvider,
      store,
      model: { provider: "mock", model: "default" },
    });

    const session = agent.createSession({ id: "compaction-fail-sess" });
    const run = await session.run("Initial instruction to start transcript");
    const leafBefore = run.leafId;

    const rawEntriesBefore = await session.entries();
    assert.ok(rawEntriesBefore.length >= 2, "Session should have user and assistant entries");

    // Provider that fails during summarization
    const failingProvider = createMockProvider([providerError(new Error("Simulated LLM rate limit or timeout"))]);

    // Calling compactSession must fail
    await assert.rejects(
      async () => {
        await compactSession({
          session,
          provider: failingProvider,
          model: { provider: "mock", model: "default" },
        });
      },
      (err: Error) => {
        return err.message.includes("Summarization failed") || err.message.includes("Simulated LLM rate limit");
      },
    );

    // Assert session leaf remains untouched!
    const rawEntriesAfter = await session.entries();
    assert.equal(rawEntriesAfter.at(-1)?.id, leafBefore, "Session leaf must remain untouched after failure");
    assert.equal(rawEntriesAfter.length, rawEntriesBefore.length, "Raw entries must be preserved in store");
  });

  it("Compaction success appends compaction entry with coding handoff", async () => {
    const store = createSqlitePersistence({ filename: dbPath });

    const summaryText = "Completed refactor of tool modules. Verified test suites pass. Next: deploy.";
    const workingProvider = createMockProvider([
      providerTextDelta("Hello from coder"),
      providerDone(),
      // Compaction summarization response
      providerTextDelta(summaryText),
      providerDone(),
    ]);

    const agent = createAgent({
      provider: workingProvider,
      store,
      model: { provider: "mock", model: "default" },
    });

    const session = agent.createSession({ id: "compaction-success-sess" });
    const run = await session.run("Please refactor tools");
    const leafBefore = run.leafId;

    // Perform compaction
    const result = await compactSession({
      session,
      provider: workingProvider,
      model: { provider: "mock", model: "default" },
      customInstructions: "Prioritize tests and handoff blockers.",
    });

    assert.ok(result.summary.includes(summaryText));
    assert.ok(result.entries !== undefined && result.entries.length > 0);

    const compactionEntry = result.entries[0];
    assert.equal(compactionEntry?.kind, "compaction");

    // Session entries now end with the compaction entry
    const entriesAfter = await session.entries();
    const lastEntry = entriesAfter.at(-1);
    assert.equal(lastEntry?.kind, "compaction");
    assert.notEqual(lastEntry?.id, leafBefore, "Leaf must advance to the new compaction entry");
    assert.ok(lastEntry?.summary?.includes(summaryText));
  });

  it("Memory store handles search rejection with explicit non-resumable message", async () => {
    const memStore = createMemorySessionStore();

    await assert.rejects(
      async () => {
        await searchRepoSessions(memStore, { workspaceRoot: "/test/repo" });
      },
      (err: Error) => {
        return err.message.includes("Session resumption is not supported");
      },
    );
  });

  it("formatSessionOption produces clean descriptions and redacts secrets", () => {
    const hit = {
      sessionId: "sess-abc",
      updatedAt: "2026-09-27T10:00:00.000Z",
      leafId: "leaf-1234567890",
      summary: "Completed work with secret-api-key-1234 in progress",
    };

    const formatted = formatSessionOption(hit, "sess-abc", ["secret-api-key-1234"]);
    assert.equal(formatted.name, "sess-abc (current)");
    assert.ok(formatted.description.includes("[REDACTED]"));
    assert.ok(!formatted.description.includes("secret-api-key-1234"));
  });

  it("resolveSessionDbPath defaults to <home>/sessions/sessions.db and honors store overrides", () => {
    const home = join(tempDir, "home");
    assert.equal(resolveSessionDbPath({ cwd: repoA }, home), join(home, "sessions", "sessions.db"));
    assert.equal(resolveSessionDbPath({ cwd: repoA, store: { type: "sqlite" } }, home), join(home, "sessions", "sessions.db"));
    assert.equal(resolveSessionDbPath({ cwd: repoA, store: { type: "sqlite", path: "custom.db" } }, home), join(repoA, "custom.db"));
    assert.equal(resolveSessionDbPath({ cwd: repoA, store: { type: "memory" } }, home), ":memory:");
  });

  it("default store is shared across repos under home with 0700 dir and 0600 file", async () => {
    const home = join(tempDir, "home-shared");
    const store = resolveSessionStore({ cwd: repoA }, home);

    await ensureDurableSessionRecord(store, "home-session-a", repoA);
    await ensureDurableSessionRecord(store, "home-session-b", repoB);

    const dbPath = join(home, "sessions", "sessions.db");
    assert.ok(existsSync(dbPath), "database lives under the home sessions directory");
    if (process.platform !== "win32") {
      assert.equal(statSync(dbPath).mode & 0o777, 0o600);
      assert.equal(statSync(join(home, "sessions")).mode & 0o777, 0o700);
      assert.equal(statSync(home).mode & 0o777, 0o700);
    }

    const foundA = await searchRepoSessions(store, { workspaceRoot: repoA });
    const foundB = await searchRepoSessions(store, { workspaceRoot: repoB });
    assert.deepEqual(
      foundA.items.map((item) => item.sessionId),
      ["home-session-a"],
    );
    assert.deepEqual(
      foundB.items.map((item) => item.sessionId),
      ["home-session-b"],
    );
  });

  it("scopes sessions to the canonical git root when launched from a subdirectory", async () => {
    const repo = join(tempDir, "git-repo");
    const subdir = join(repo, "packages", "app");
    mkdirSync(subdir, { recursive: true });
    try {
      execSync("git init -q", { cwd: repo, stdio: "ignore" });
    } catch {
      return; // git unavailable: the fallback realpath path is covered by the other tests
    }

    assert.equal(getCanonicalWorkspaceRoot(subdir), realpathSync(repo));

    const home = join(tempDir, "home-git");
    const store = resolveSessionStore({ cwd: subdir }, home);
    await ensureDurableSessionRecord(store, "subdir-session", subdir);

    const found = await searchRepoSessions(store, { workspaceRoot: subdir });
    assert.deepEqual(
      found.items.map((item) => item.sessionId),
      ["subdir-session"],
    );
  });

  it("leaves a legacy <cwd>/.prism/sessions.db untouched and points to the new location", async () => {
    const legacyPath = join(repoA, ".prism", "sessions.db");
    mkdirSync(join(repoA, ".prism"), { recursive: true });
    writeFileSync(legacyPath, "legacy-bytes");
    const home = join(tempDir, "home-legacy");

    const notice = legacySessionDbNotice({ cwd: repoA }, home);
    assert.ok(notice?.includes("can be deleted"), `notice points at the legacy file: ${notice}`);
    assert.ok(notice?.includes(join(home, "sessions", "sessions.db")));
    assert.equal(legacySessionDbNotice({ cwd: repoA, store: { type: "memory" } }, home), undefined);

    const store = resolveSessionStore({ cwd: repoA }, home);
    const found = await searchRepoSessions(store, { workspaceRoot: repoA });
    assert.equal(found.items.length, 0, "legacy sessions are not migrated");
    assert.equal(readFileSync(legacyPath, "utf8"), "legacy-bytes");
  });

  it("waits past a concurrent writer instead of failing with SQLITE_BUSY", async () => {
    const home = join(tempDir, "home-busy");
    const store = resolveSessionStore({ cwd: repoA }, home);
    const dbPath = join(home, "sessions", "sessions.db");
    const marker = join(tempDir, "lock-held");
    const holderScript = [
      'import { Database } from "bun:sqlite";',
      'import { writeFileSync } from "node:fs";',
      `const db = new Database(${JSON.stringify(dbPath)});`,
      'db.exec("PRAGMA journal_mode = WAL");',
      'db.exec("BEGIN IMMEDIATE");',
      `writeFileSync(${JSON.stringify(marker)}, "locked");`,
      'setTimeout(() => { db.exec("COMMIT"); db.close(); process.exit(0); }, 300);',
    ].join("\n");

    const holder = spawn(process.execPath, ["-e", holderScript], { stdio: "ignore" });
    try {
      for (let i = 0; i < 200 && !existsSync(marker); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(existsSync(marker), "concurrent writer holds the write lock");
      await ensureDurableSessionRecord(store, "busy-session", repoA);
    } finally {
      await new Promise<void>((resolve) => holder.on("exit", () => resolve()));
    }

    const found = await searchRepoSessions(store, { workspaceRoot: repoA });
    assert.deepEqual(
      found.items.map((item) => item.sessionId),
      ["busy-session"],
    );
  });
});
