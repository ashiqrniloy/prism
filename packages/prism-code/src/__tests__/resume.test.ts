import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockProvider, createSessionEntry, providerDone, providerTextDelta, type SessionEntry } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import { createTestRenderer } from "@opentui/core/testing";
import { assembleAppAgent } from "../headless.js";
import {
  deriveSessionTitle,
  ensureDurableSessionRecord,
  formatRelativeTime,
  formatSessionOption,
  resolveContinueSessionId,
  searchRepoSessions,
  sessionRecordExists,
  setSessionTitle,
} from "../sessions.js";
import { entriesToUiEntries } from "../tui/history.js";
import { createPrismCodeTui } from "../tui/index.js";
import type { UiThinkingEntry, UiToolCallEntry } from "../tui/reducer.js";

const TS = "2026-09-28T00:00:00.000Z";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `prism-code-resume-${prefix}-`));
}

describe("Session Resume: titles, history, and CLI/TUI flows", () => {
  it("derives the title from the first line and caps it at the 80-char convention", () => {
    assert.equal(deriveSessionTitle("Fix the login bug\nsecond line ignored"), "Fix the login bug");
    assert.equal(deriveSessionTitle("  spaced   out  "), "spaced out");
    assert.equal(deriveSessionTitle("   \n "), undefined);
    assert.equal(deriveSessionTitle("x".repeat(200))?.length, 80);
  });

  it("persists first-prompt titles, never overwrites them, and lets /rename replace them", async () => {
    const dir = makeTempDir("title");
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const store = createSqlitePersistence({ filename: join(dir, "sessions.db") });
    try {
      await ensureDurableSessionRecord(store, "title-session", repo);

      assert.equal(await setSessionTitle(store, "title-session", "first prompt", { onlyIfUnset: true }), true);
      assert.equal(await setSessionTitle(store, "title-session", "second prompt", { onlyIfUnset: true }), false);
      assert.equal(await setSessionTitle(store, "title-session", "renamed"), true);

      const hit = (await searchRepoSessions(store, { workspaceRoot: repo })).items[0];
      assert.ok(hit);
      assert.equal(hit.metadata?.title, "renamed");
      assert.equal(hit.messageCount, 0);

      const option = formatSessionOption(hit);
      assert.equal(option.name, "renamed");
      assert.match(option.description, /0 messages/);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the most recent repo session and reports missing ids", async () => {
    const dir = makeTempDir("continue");
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const store = createSqlitePersistence({ filename: join(dir, "sessions.db") });
    try {
      await ensureDurableSessionRecord(store, "older", repo, { updatedAt: "2026-01-01T00:00:00.000Z" });
      await ensureDurableSessionRecord(store, "newer", repo, { updatedAt: "2026-02-01T00:00:00.000Z" });

      assert.equal(await resolveContinueSessionId(store, repo), "newer");
      assert.equal(await sessionRecordExists(store, "newer"), true);
      assert.equal(await sessionRecordExists(store, "missing"), false);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formats relative activity times for the picker", () => {
    const now = Date.parse(TS);
    assert.equal(formatRelativeTime(TS, now), "just now");
    assert.equal(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now), "5m ago");
    assert.equal(formatRelativeTime(new Date(now - 3 * 3_600_000).toISOString(), now), "3h ago");
    assert.equal(formatRelativeTime(undefined, now), "unknown");
  });

  it("replays stored entries through the live reducer with real tool status and thinking blocks", () => {
    const assistantCall = createSessionEntry({
      id: "hist-2",
      sessionId: "hist",
      timestamp: TS,
      kind: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", text: "the user wants a failing command" },
          { type: "tool_call", id: "call-1", name: "shell", arguments: { command: "exit 1" } },
          { type: "text", text: "Running the failing command." },
        ],
      },
    });
    const toolResult = createSessionEntry({
      id: "hist-3",
      sessionId: "hist",
      timestamp: TS,
      kind: "message",
      message: {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolCallId: "call-1",
            name: "shell",
            result: "boom",
            error: { message: "Command failed with exit code 1" },
          },
        ],
      },
    });
    const entries: SessionEntry[] = [
      createSessionEntry({
        id: "hist-1",
        sessionId: "hist",
        timestamp: TS,
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "make it fail" }] },
      }),
      assistantCall,
      toolResult,
      createSessionEntry({ id: "hist-4", sessionId: "hist", timestamp: TS, kind: "compaction", summary: "Earlier work summarized" }),
    ];

    const ui = entriesToUiEntries(entries, 500);
    const tool = ui.find((entry) => entry.type === "tool_call") as UiToolCallEntry;
    assert.equal(tool.status, "failure");
    assert.equal(tool.error, "Command failed with exit code 1");
    const thinking = ui.find((entry) => entry.type === "thinking") as UiThinkingEntry;
    assert.equal(thinking.text, "the user wants a failing command");
    assert.ok(ui.some((entry) => entry.type === "message" && entry.role === "user" && entry.text === "make it fail"));
    assert.ok(ui.some((entry) => entry.type === "message" && entry.role === "system" && entry.text.includes("Earlier work summarized")));

    const denied = entriesToUiEntries(
      [
        createSessionEntry({
          id: "deny-1",
          sessionId: "hist",
          timestamp: TS,
          kind: "message",
          message: { role: "assistant", content: [{ type: "tool_call", id: "call-2", name: "shell", arguments: { command: "rm -rf /" } }] },
        }),
        createSessionEntry({
          id: "deny-2",
          sessionId: "hist",
          timestamp: TS,
          kind: "message",
          message: {
            role: "tool",
            content: [
              {
                type: "tool_result",
                toolCallId: "call-2",
                name: "shell",
                error: { message: "approval denied for shell" },
              },
            ],
          },
        }),
      ],
      500,
    );
    assert.equal((denied.find((entry) => entry.type === "tool_call") as UiToolCallEntry).status, "denied");
  });

  it("replays a 5k-entry session within 300ms and keeps only the scrollback window", () => {
    const entries: SessionEntry[] = [];
    for (let i = 0; i < 5_000; i++) {
      entries.push(
        createSessionEntry({
          id: `perf-${i}`,
          sessionId: "perf",
          timestamp: new Date(1_700_000_000_000 + i).toISOString(),
          kind: "message",
          message:
            i % 2 === 0
              ? { role: "user", content: [{ type: "text", text: `prompt ${i}` }] }
              : { role: "assistant", content: [{ type: "text", text: `answer ${i}` }] },
        }),
      );
    }

    const started = performance.now();
    const ui = entriesToUiEntries(entries, 500);
    const elapsed = performance.now() - started;
    assert.equal(ui.length, 500);
    assert.ok(elapsed < 300, `history replay took ${elapsed.toFixed(0)}ms`);
  });

  it("resumes stored history and the last run model in the TUI, then continues the same session", async () => {
    const dir = makeTempDir("tui");
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const dbPath = join(dir, "sessions.db");
    const config = { cwd: repo, store: { type: "sqlite" as const, path: dbPath }, tools: { planes: { coding: false } } };
    try {
      // First run through the agent with a model override so the session stores a model_change entry.
      const store = createSqlitePersistence({ filename: dbPath });
      const definition1 = await assembleAppAgent(config, createMockProvider([providerTextDelta("first answer"), providerDone()]));
      const session1 = definition1.createSession({ id: "resume-e2e", metadata: { workspaceRoot: repo } });
      await session1.run("resume me", { model: { provider: "mock", model: "other" } });
      await ensureDurableSessionRecord(store, "resume-e2e", repo);
      await definition1.dispose();
      const beforeCount = (await store.list("resume-e2e")).length;

      const definition = await assembleAppAgent(config, createMockProvider([providerTextDelta("second answer"), providerDone()]));
      const env = await createTestRenderer({ width: 80, height: 24 });
      const tui = createPrismCodeTui({
        renderer: env.renderer,
        config,
        store,
        sessionId: "resume-e2e",
      });
      try {
        await tui.start(definition);
        await env.renderOnce();

        const state = (tui as any).state;
        assert.ok(
          state.entries.some((entry: any) => entry.type === "message" && entry.role === "user" && entry.text.includes("resume me")),
          "resumed transcript shows the prior user prompt",
        );
        assert.ok(
          state.entries.some((entry: any) => entry.type === "message" && entry.role === "assistant" && entry.text.includes("first answer")),
          "resumed transcript shows the prior assistant answer",
        );
        assert.equal(state.footer.model, "other", "resumed the model recorded by the last run");

        await (tui as any).handlePromptSubmit("follow up");
        const after = await store.list("resume-e2e");
        assert.ok(after.length > beforeCount, "resumed run appended to the same session");
        assert.ok(
          after.some(
            (entry) =>
              entry.kind === "message" && entry.message?.role === "user" && JSON.stringify(entry.message.content).includes("follow up"),
          ),
        );

        // First-prompt title is set by the resumed run; /rename replaces it.
        let hits = (await searchRepoSessions(store, { workspaceRoot: repo })).items;
        assert.equal(hits[0]?.metadata?.title, "follow up");
        assert.ok((hits[0]?.messageCount ?? 0) > 0);

        await (tui as any).handlePromptSubmit("/rename Renamed session");
        hits = (await searchRepoSessions(store, { workspaceRoot: repo })).items;
        assert.equal(hits[0]?.metadata?.title, "Renamed session");
      } finally {
        await tui.close();
        await definition.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("opens the /resume picker at startup for --resume", async () => {
    const dir = makeTempDir("picker");
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const dbPath = join(dir, "sessions.db");
    const config = { cwd: repo, store: { type: "sqlite" as const, path: dbPath }, tools: { planes: { coding: false } } };
    try {
      const store = createSqlitePersistence({ filename: dbPath });
      await ensureDurableSessionRecord(store, "picker-session", repo);
      const definition = await assembleAppAgent(config, createMockProvider([providerDone()]));
      const env = await createTestRenderer({ width: 80, height: 24 });
      const tui = createPrismCodeTui({ renderer: env.renderer, config, store, openResumePicker: true });
      try {
        const started = tui.start(definition);
        for (let i = 0; i < 200 && !(tui as any).pickerComponent?.isVisible; i++) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal((tui as any).pickerComponent?.isVisible, true);
        env.renderer.keyInput.emit("keypress", { name: "escape", ctrl: false, shift: false, meta: false } as any);
        await started;
      } finally {
        await tui.close();
        await definition.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
