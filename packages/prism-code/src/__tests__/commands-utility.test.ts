import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemorySessionStore, createSecretRedactor, type SessionEntry } from "@arnilo/prism";
import type { CommandContext } from "../tui/commands.js";
import { formatSessionMarkdown, handleSlashCommand } from "../tui/commands.js";
import { CORE_SLASH_COMMANDS, formatHelpText } from "../tui/keybindings.js";
import { createInitialTuiState } from "../tui/reducer.js";

interface Recorded {
  readonly messages: any[];
  clearCount: number;
}

function mockStream(recorded: Recorded): any {
  return {
    appendOrUpdate: (entry: any) => {
      recorded.messages.push(entry);
      return entry;
    },
    clear: () => {
      recorded.clearCount += 1;
    },
  };
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-utility-${prefix}-`));
}

describe("TUI utility commands", () => {
  it("groups /tools by source and reports web availability", async () => {
    const recorded: Recorded = { messages: [], clearCount: 0 };
    const context = {
      stream: mockStream(recorded),
      state: createInitialTuiState(),
      definition: {
        agent: {
          config: {
            tools: {
              list: () => [
                { name: "shell", description: "shell" },
                { name: "mcp__github__search", description: "search" },
                { name: "my_tool", description: "custom" },
              ],
            },
          },
        },
        mcp: {
          status: [{ serverId: "github", state: "connected", toolCount: 1 }],
          getServerTools: () => [{ name: "mcp__github__search", description: "search" }],
        },
      },
      webResolution: {
        mode: "off",
        enabled: false,
        tools: [],
        toolNames: [],
        notes: [],
        unavailableReason: "Obscura binary not found on PATH",
      },
      mcpSession: { disabled: new Set<string>(), disable: () => ({ removed: 0 }), enable: () => ({ restored: 0 }) },
    } as unknown as CommandContext;

    const result = await handleSlashCommand("/tools", context);
    assert.equal(result.handled, true);
    const text = recorded.messages.at(-1)?.text as string;
    assert.ok(text.includes("Tools — 3 active"));
    assert.ok(text.includes("Built-in:"));
    assert.ok(text.includes("Opt-in:"));
    assert.ok(text.includes("git_status — off"));
    assert.ok(text.includes("shell — on"));
    assert.ok(text.includes("MCP:"));
    assert.ok(text.includes("github — connected, 1 tools"));
    assert.ok(text.includes("Web (mode off):"));
    assert.ok(text.includes("unavailable: Obscura binary not found on PATH"));
    assert.ok(text.includes("User modules:"));
    assert.ok(text.includes("my_tool — on"));
  });

  it("/clear wipes the transcript and creates a fresh session", async () => {
    const dir = await makeTempDir("clear");
    const recorded: Recorded = { messages: [], clearCount: 0 };
    let switched = 0;
    try {
      const context = {
        stream: mockStream(recorded),
        state: createInitialTuiState(),
        config: { cwd: dir },
        store: createMemorySessionStore(),
        definition: { createSession: () => ({ id: "session_new" }) },
        onSwitchSession: async () => {
          switched += 1;
        },
      } as unknown as CommandContext;

      const result = await handleSlashCommand("/clear", context);
      assert.equal(result.handled, true);
      assert.equal(recorded.clearCount, 1);
      assert.equal(switched, 1);
      assert.ok(recorded.messages.some((message) => String(message.text).includes("Created new session")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("/exit calls the host shutdown hook", async () => {
    const recorded: Recorded = { messages: [], clearCount: 0 };
    const codes: number[] = [];
    const context = {
      stream: mockStream(recorded),
      state: createInitialTuiState(),
      requestExit: (code?: number) => codes.push(code ?? 0),
    } as unknown as CommandContext;

    await handleSlashCommand("/exit", context);
    assert.deepEqual(codes, [0]);

    const noHook = { stream: mockStream({ messages: [], clearCount: 0 }), state: createInitialTuiState() } as unknown as CommandContext;
    await handleSlashCommand("/exit", noHook);
  });

  it("/export writes a 0600 redacted markdown transcript and refuses to overwrite without confirmation", async () => {
    const dir = await makeTempDir("export");
    const recorded: Recorded = { messages: [], clearCount: 0 };
    let answerIndex = 0;
    const picker = {
      show: async () => {
        const value = answerIndex === 0 ? "no" : "yes";
        answerIndex += 1;
        return { name: value === "yes" ? "Yes" : "No", value };
      },
    };

    const entries: SessionEntry[] = [
      {
        id: "e1",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "token sk-secret please" }] },
      },
      {
        id: "e2",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        kind: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running the tool." },
            { type: "tool_call", id: "call1", name: "shell", arguments: { command: "ls" } },
          ],
        },
      },
    ];

    try {
      const context = {
        stream: mockStream(recorded),
        state: createInitialTuiState(),
        config: { cwd: dir },
        picker,
        session: { id: "s1", entries: async () => entries },
        definition: { agent: { config: { redactor: createSecretRedactor(["sk-secret"]) } } },
      } as unknown as CommandContext;

      const target = join(dir, "out.md");
      writeFileSync(target, "previous content");

      const refused = await handleSlashCommand("/export out.md", context);
      assert.equal(refused.handled, true);
      assert.ok(recorded.messages.some((message) => message.text === "Export cancelled."));
      assert.equal(readFileSync(target, "utf8"), "previous content", "a declined overwrite must not touch the file");

      await handleSlashCommand("/export out.md", context);
      assert.equal(answerIndex, 2);
      const written = readFileSync(target, "utf8");
      assert.ok(written.includes("# Prism session s1"));
      assert.ok(written.includes("## User"));
      assert.ok(written.includes("## Assistant"));
      assert.ok(written.includes("### Tool call: shell"));
      assert.ok(written.includes("[REDACTED]"), "the secret is redacted on export");
      assert.ok(!written.includes("sk-secret"));
      if (process.platform !== "win32") {
        assert.equal(statSync(target).mode & 0o777, 0o600);
      }

      // Default path names the session id.
      await handleSlashCommand("/export", context);
      assert.ok(existsSync(join(dir, "prism-session-s1.md")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders /help from the command registry and keybinding table", async () => {
    const text = formatHelpText([]);
    for (const command of ["/clear", "/exit", "/tools", "/export", "/new", "/mcp"]) {
      assert.ok(text.includes(command), `help is missing ${command}`);
    }
    assert.ok(text.includes("Keybindings:"));
    assert.ok(text.includes("Ctrl+O"));
    assert.ok(CORE_SLASH_COMMANDS.every((command) => text.includes(command.name)));
    assert.ok(CORE_SLASH_COMMANDS.every((command) => command.description.length > 0));
  });

  it("formats a session transcript without attachment bodies", () => {
    const markdown = formatSessionMarkdown("s9", "/repo", [
      {
        id: "e1",
        sessionId: "s9",
        timestamp: new Date().toISOString(),
        kind: "message",
        message: {
          role: "user",
          content: [
            { type: "text", text: "hi" },
            { type: "text", text: "[attached file: secret.txt]\nbody" },
          ],
        },
      },
      { id: "e2", sessionId: "s9", timestamp: new Date().toISOString(), kind: "compaction", summary: "short summary" },
    ]);
    assert.ok(markdown.includes("## User"));
    assert.ok(markdown.includes("hi"));
    assert.ok(!markdown.includes("body"));
    assert.ok(markdown.includes("## Summary"));
    assert.ok(markdown.includes("short summary"));
  });
});
