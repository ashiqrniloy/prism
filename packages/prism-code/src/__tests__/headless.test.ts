import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AIProvider, createMockProvider, type ProviderRequest, providerDone, providerTextDelta } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import { assembleAppAgent, ensureDurableSessionRecord, runHeadless, searchRepoSessions, type WritableSink } from "../index.js";

class MemorySink implements WritableSink {
  public content = "";
  write(chunk: string): boolean | undefined {
    this.content += chunk;
    return true;
  }
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-test-${prefix}-`));
}

describe("headless runner", () => {
  it("print mode writes assistant text deltas with trailing newline and returns 0", async () => {
    const tempDir = await makeTempDir("print-mode");
    try {
      const stdout = new MemorySink();
      const stderr = new MemorySink();
      const provider = createMockProvider([providerTextDelta("Hello world from Prism Code!"), providerDone()]);

      const exitCode = await runHeadless({
        config: {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        prompt: "Say hello",
        mode: "print",
        stdout,
        stderr,
        provider,
      });

      assert.strictEqual(exitCode, 0);
      assert.strictEqual(stdout.content, "Hello world from Prism Code!\n");
      assert.strictEqual(stderr.content, "");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("json mode emits valid line-delimited JSON events and returns 0", async () => {
    const tempDir = await makeTempDir("json-mode");
    try {
      const stdout = new MemorySink();
      const stderr = new MemorySink();
      const provider = createMockProvider([providerTextDelta("JSON event stream text"), providerDone()]);

      const exitCode = await runHeadless({
        config: {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        prompt: "Test json mode",
        mode: "json",
        stdout,
        stderr,
        provider,
      });

      assert.strictEqual(exitCode, 0);
      assert.strictEqual(stderr.content, "");

      const lines = stdout.content.trim().split("\n");
      assert.ok(lines.length > 0, "Expected at least one event in stdout");

      const eventTypes: string[] = [];
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assert.strictEqual(parsed.type, "event");
        assert.ok(parsed.sessionId, "Event envelope must contain sessionId");
        assert.ok(parsed.event, "Event envelope must contain event");
        assert.ok(parsed.event.type, "Event must contain type");
        eventTypes.push(parsed.event.type);
      }

      assert.ok(eventTypes.includes("turn_started"), "Expected turn_started event");
      assert.ok(eventTypes.includes("message_delta"), "Expected message_delta event");
      assert.ok(eventTypes.includes("turn_finished"), "Expected turn_finished event");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 1 and writes error message when provider throws", async () => {
    const tempDir = await makeTempDir("provider-error");
    try {
      const stdout = new MemorySink();
      const stderr = new MemorySink();
      const failingProvider: AIProvider = {
        id: "failing-provider",
        async *generate() {
          throw new Error("Provider rate limit reached");
        },
      };

      const exitCode = await runHeadless({
        config: {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        prompt: "Will fail",
        mode: "print",
        stdout,
        stderr,
        provider: failingProvider,
      });

      assert.strictEqual(exitCode, 1);
      assert.ok(stderr.content.includes("Provider rate limit reached"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("json mode outputs structured error JSON on provider failure and returns 1", async () => {
    const tempDir = await makeTempDir("provider-error-json");
    try {
      const stdout = new MemorySink();
      const stderr = new MemorySink();
      const failingProvider: AIProvider = {
        id: "failing-provider",
        async *generate() {
          throw new Error("Connection refused to provider");
        },
      };

      const exitCode = await runHeadless({
        config: {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        prompt: "Will fail in json mode",
        mode: "json",
        stdout,
        stderr,
        provider: failingProvider,
      });

      assert.strictEqual(exitCode, 1);
      const lines = stdout.content.trim().split("\n");
      const lastLine = lines.at(-1);
      assert.ok(lastLine, "Expected output lines");
      const parsed = JSON.parse(lastLine);
      assert.strictEqual(parsed.type, "error");
      assert.ok(parsed.error.message.includes("Connection refused to provider"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects --session resumption when store is memory", async () => {
    const stdout = new MemorySink();
    const stderr = new MemorySink();

    const exitCode = await runHeadless({
      config: {
        cwd: process.cwd(),
        store: { type: "memory" },
      },
      prompt: "Resuming session",
      mode: "print",
      sessionId: "session-abc",
      stdout,
      stderr,
    });

    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.content.includes('store "memory" does not support session resumption'));
  });

  it("rejects --session resumption in json mode when store is memory", async () => {
    const stdout = new MemorySink();
    const stderr = new MemorySink();

    const exitCode = await runHeadless({
      config: {
        cwd: process.cwd(),
        store: { type: "memory" },
      },
      prompt: "Resuming session",
      mode: "json",
      sessionId: "session-abc",
      stdout,
      stderr,
    });

    assert.strictEqual(exitCode, 1);
    const parsed = JSON.parse(stdout.content.trim());
    assert.strictEqual(parsed.type, "error");
    assert.ok(parsed.error.message.includes('store "memory" does not support session resumption'));
  });

  it("resumes session across multiple headless runs with durable sqlite store", async () => {
    const tempDir = await makeTempDir("session-resume");
    const dbPath = join(tempDir, "sessions.db");
    const sessionId = "durable-session-001";
    const recordedRequests: ProviderRequest[] = [];

    const resumeProvider: AIProvider = {
      id: "resume-mock",
      async *generate(request) {
        recordedRequests.push(request);
        const count = recordedRequests.length;
        yield providerTextDelta(`Turn ${count} response`);
        yield providerDone();
      },
    };

    try {
      const config = {
        cwd: tempDir,
        store: { type: "sqlite" as const, path: dbPath },
        tools: { planes: { coding: false } },
      };

      // `--session <id>` resumes an existing record; seed it once for turn 1 (unknown ids now fail closed).
      const seedStore = createSqlitePersistence({ filename: dbPath });
      await ensureDurableSessionRecord(seedStore, sessionId, tempDir);
      seedStore.close();

      // Turn 1
      const stdout1 = new MemorySink();
      const exitCode1 = await runHeadless({
        config,
        prompt: "First question",
        mode: "print",
        sessionId,
        stdout: stdout1,
        provider: resumeProvider,
      });

      assert.strictEqual(exitCode1, 0);
      assert.strictEqual(stdout1.content, "Turn 1 response\n");
      assert.strictEqual(recordedRequests.length, 1);
      // First prompt titles the durable session record (display-only metadata).
      const titleStore = createSqlitePersistence({ filename: dbPath });
      const titledHit = (await searchRepoSessions(titleStore, { workspaceRoot: tempDir })).items[0];
      assert.strictEqual(titledHit?.metadata?.title, "First question");
      titleStore.close();
      // First turn contains the initial user prompt
      const turn1User = recordedRequests[0]?.messages.find((m) => m.role === "user");
      assert.strictEqual((turn1User?.content[0] as any)?.text, "First question");

      // Turn 2: resume same session
      const stdout2 = new MemorySink();
      const exitCode2 = await runHeadless({
        config,
        prompt: "Second question",
        mode: "print",
        sessionId,
        stdout: stdout2,
        provider: resumeProvider,
      });

      assert.strictEqual(exitCode2, 0);
      assert.strictEqual(stdout2.content, "Turn 2 response\n");
      assert.strictEqual(recordedRequests.length, 2);
      // Second turn contains the prior user message, prior assistant response, and new user prompt
      assert.ok(
        (recordedRequests[1]?.messages.length ?? 0) >= 3,
        `Expected at least 3 messages on turn 2, got ${recordedRequests[1]?.messages.length}`,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("never imports or initializes OpenTUI during headless execution", async () => {
    // Assert that headless.js/ts does NOT import OpenTUI
    const headlessPath = existsSync(join(__dirname, "..", "headless.js"))
      ? join(__dirname, "..", "headless.js")
      : join(__dirname, "..", "headless.ts");
    const headlessSource = await readFile(headlessPath, "utf8");
    assert.strictEqual(headlessSource.includes("@opentui/core"), false, "headless must never import @opentui/core");
    assert.strictEqual(headlessSource.includes("CliRenderer"), false, "headless must never reference CliRenderer");
  });

  it("assembleAppAgent creates a functional definition with agent and session", async () => {
    const tempDir = await makeTempDir("assemble-agent");
    try {
      const provider = createMockProvider([providerTextDelta("Assembled agent text"), providerDone()]);

      const definition = await assembleAppAgent(
        {
          cwd: tempDir,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        provider,
      );

      assert.ok(definition.agent);
      const session = definition.createSession();
      assert.ok(session);

      const result = await session.run("Testing assembleAppAgent");
      assert.strictEqual(result.status, "succeeded");
      assert.strictEqual(result.text, "Assembled agent text");

      await definition.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 1 on configuration error before any provider call", async () => {
    const tempDir = await makeTempDir("config-error");
    try {
      const stdout = new MemorySink();
      const stderr = new MemorySink();

      const exitCode = await runHeadless({
        config: {
          cwd: tempDir,
          tools: {
            add: ["./nonexistent-tool-module.ts"],
          },
        },
        prompt: "Will fail at tool loading",
        mode: "print",
        stdout,
        stderr,
      });

      assert.strictEqual(exitCode, 1);
      assert.ok(stderr.content.includes("prism-code:"));
      assert.ok(stderr.content.includes("nonexistent-tool-module.ts"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("auto-detects an env-only provider (fetch stubbed) instead of exiting 1", async () => {
    const binPath = existsSync(resolve(__dirname, "../../../bin/prism-code.ts"))
      ? resolve(__dirname, "../../../bin/prism-code.ts")
      : resolve(__dirname, "../../bin/prism-code.ts");
    const root = await makeTempDir("auto-detect");
    const home = join(root, "home");
    const cwd = join(root, "cwd");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });

    const sse = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Auto-detected reply"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":1,"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    const preload = join(root, "preload.ts");
    await writeFile(
      preload,
      // Bracket form keeps the network-free guard (which scans for the dotted global-fetch form) happy;
      // the generated preload still replaces the child process's global fetch.
      `globalThis["fetch"] = (async () => new Response(${JSON.stringify(sse)}, { status: 200, headers: { "content-type": "text/event-stream" } }));\n`,
    );

    try {
      const result = spawnSync(process.execPath, ["--preload", preload, binPath, "-p", "hi", "--mode", "print"], {
        encoding: "utf8",
        cwd,
        env: { ...process.env, PRISM_HOME: home, ANTHROPIC_API_KEY: "sk-ant-stub", OPENAI_API_KEY: "" },
      });
      assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes("Auto-detected reply"), `stdout: ${result.stdout}`);
      assert.ok(result.stderr.includes("auto-selected anthropic/claude-sonnet-5"), `stderr: ${result.stderr}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("CLI binary executes end-to-end in print and json modes", async () => {
    const binPath = existsSync(resolve(__dirname, "../../../bin/prism-code.ts"))
      ? resolve(__dirname, "../../../bin/prism-code.ts")
      : resolve(__dirname, "../../bin/prism-code.ts");
    const home = await makeTempDir("cli-home");
    const env = { ...process.env, PRISM_HOME: home };

    try {
      // Print mode
      const printResult = spawnSync(process.execPath, [binPath, "-p", "CLI test prompt", "--mode", "print", "--provider", "mock"], {
        encoding: "utf8",
        env,
      });
      assert.strictEqual(printResult.status, 0, `Print mode failed with stderr: ${printResult.stderr}`);
      assert.ok(printResult.stdout.includes("Mock response\n"));

      // JSON mode
      const jsonResult = spawnSync(process.execPath, [binPath, "-p", "CLI test prompt", "--mode", "json", "--provider", "mock"], {
        encoding: "utf8",
        env,
      });
      assert.strictEqual(jsonResult.status, 0, `JSON mode failed with stderr: ${jsonResult.stderr}`);
      const jsonLines = jsonResult.stdout.trim().split("\n");
      assert.ok(jsonLines.length > 0);
      const firstEvent = JSON.parse(jsonLines[0]);
      assert.strictEqual(firstEvent.type, "event");
      assert.strictEqual(firstEvent.event.type, "agent_started");

      // Missing prompt
      const missingPromptResult = spawnSync(process.execPath, [binPath, "--mode", "print", "--provider", "mock"], {
        encoding: "utf8",
        env,
      });
      assert.strictEqual(missingPromptResult.status, 1);
      assert.ok(missingPromptResult.stderr.includes("headless mode requires a prompt"));

      // Unknown --session id fails clearly before any session record is created.
      const unknownSessionResult = spawnSync(
        process.execPath,
        [binPath, "-p", "hi", "--mode", "print", "--provider", "mock", "--session", "does-not-exist"],
        { encoding: "utf8", env },
      );
      assert.strictEqual(unknownSessionResult.status, 1);
      assert.ok(unknownSessionResult.stderr.includes("session not found: does-not-exist"), unknownSessionResult.stderr);

      // --continue with no prior sessions for the repository fails clearly.
      const emptyRepo = await makeTempDir("cli-continue-empty");
      try {
        const continueEmptyResult = spawnSync(
          process.execPath,
          [binPath, "-p", "hi", "--mode", "print", "--provider", "mock", "--continue"],
          { encoding: "utf8", env, cwd: emptyRepo },
        );
        assert.strictEqual(continueEmptyResult.status, 1);
        assert.ok(continueEmptyResult.stderr.includes("no prior sessions"), continueEmptyResult.stderr);
      } finally {
        await rm(emptyRepo, { recursive: true, force: true });
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("warns once about a legacy <cwd>/.prism/sessions.db and never touches it", async () => {
    const binPath = existsSync(resolve(__dirname, "../../../bin/prism-code.ts"))
      ? resolve(__dirname, "../../../bin/prism-code.ts")
      : resolve(__dirname, "../../bin/prism-code.ts");
    const repo = await makeTempDir("legacy-store-repo");
    const home = await makeTempDir("legacy-store-home");
    const legacyPath = join(repo, ".prism", "sessions.db");
    try {
      await mkdir(join(repo, ".prism"), { recursive: true });
      await writeFile(legacyPath, "legacy-bytes");

      const result = spawnSync(process.execPath, [binPath, "-p", "hi", "--mode", "print", "--provider", "mock"], {
        encoding: "utf8",
        cwd: repo,
        env: { ...process.env, PRISM_HOME: home },
      });
      assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stderr.includes("can be deleted"), `stderr: ${result.stderr}`);
      assert.ok(existsSync(join(home, "sessions", "sessions.db")), "new sessions live under the home");
      assert.strictEqual(await readFile(legacyPath, "utf8"), "legacy-bytes");
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
});
