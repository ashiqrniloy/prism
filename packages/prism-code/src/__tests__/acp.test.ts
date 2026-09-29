import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { type AIProvider, createMockProvider, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { createPrismCodeAcpAgent, createProviderCache, type PrismCodeConfig, selectMcpServers } from "../index.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeToolProvider(): AIProvider {
  let turn = 0;
  return {
    id: "acp-write-provider",
    async *generate() {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: toolCallContent("call_write_1", "write", {
            path: "virtual.txt",
            content: "client-editor-buffer-text",
          }),
        };
      } else {
        yield providerTextDelta("Write completed.");
        yield providerDone();
      }
    },
  };
}

describe("ACP Server (prism-code acp)", () => {
  it("in-process ACP client: initialize -> new session -> prompt -> receive bounded updates -> cancel; session load/list", async () => {
    const dir = await makeTempDir("prism-code-acp-client-");
    try {
      const config: PrismCodeConfig = {
        userId: "local-user",
        cwd: dir,
        store: { type: "memory" },
        model: { provider: "mock", model: "default" },
      };

      const provider = createMockProvider([providerTextDelta("Hello from ACP agent!"), providerDone()]);

      const agent = await createPrismCodeAcpAgent({ config, provider });
      const updates: any[] = [];

      const acpClient = client({ name: "test-editor-client" }).onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params.update);
      });

      await acpClient.connectWith(agent, async (connection) => {
        // 1. Initialize
        const init = await connection.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
        });
        assert.ok(init.agentInfo);
        assert.strictEqual(init.agentInfo.name, "Prism Code ACP Agent");
        assert.ok(init.agentCapabilities?.sessionCapabilities?.close);

        // 2. New session
        const session = await connection.request(methods.agent.session.new, {
          cwd: dir,
          mcpServers: [],
        });
        assert.ok(session.sessionId);

        // 3. Prompt and receive updates
        const promptResult = await connection.request(methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "Say hello" }],
        });
        assert.strictEqual(promptResult.stopReason, "end_turn");
        assert.ok(
          updates.some(
            (u) =>
              u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text" && u.content.text.includes("Hello from ACP agent!"),
          ),
        );

        // 4. Cancel
        await connection.notify(methods.agent.session.cancel, {
          sessionId: session.sessionId,
        });

        // 5. Session list
        const list = await connection.request(methods.agent.session.list, {});
        assert.ok(Array.isArray(list.sessions));
        assert.ok(list.sessions.some((s) => s.sessionId === session.sessionId));

        // 6. Close session
        await connection.request(methods.agent.session.close, {
          sessionId: session.sessionId,
        });

        // 7. Session load after close
        const loaded: any = await connection.request(methods.agent.session.load, {
          sessionId: session.sessionId,
          cwd: dir,
          mcpServers: [],
        });
        assert.ok(loaded);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves providers through the shared cache instead of a fixed agent-level instance", async () => {
    const dir = await makeTempDir("prism-code-acp-cache-");
    try {
      const config: PrismCodeConfig = {
        userId: "local-user",
        cwd: dir,
        store: { type: "memory" },
        model: { provider: "mock", model: "default" },
      };

      // No `provider` option: the agent must resolve through providerSource into this cache.
      const cache = createProviderCache();
      cache.seed(
        "mock",
        createMockProvider([providerTextDelta("Hello through the provider cache!"), providerDone()], { id: "cached-mock" }),
      );
      const agent = await createPrismCodeAcpAgent({ config, providerCache: cache });

      const updates: any[] = [];
      const acpClient = client({ name: "test-editor-client" }).onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params.update);
      });

      await acpClient.connectWith(agent, async (connection) => {
        const session = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
        const result = await connection.request(methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "Say hello" }],
        });
        assert.strictEqual(result.stopReason, "end_turn");
        assert.ok(
          updates.some(
            (u) =>
              u.sessionUpdate === "agent_message_chunk" &&
              u.content?.type === "text" &&
              u.content.text.includes("Hello through the provider cache!"),
          ),
          "the cached provider instance must serve the ACP run",
        );
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("modes and configOptions from config are advertised; unknown mode fails closed", async () => {
    const dir = await makeTempDir("prism-code-acp-modes-");
    try {
      const config: PrismCodeConfig = {
        userId: "local-user",
        cwd: dir,
        store: { type: "memory" },
        model: { provider: "mock", model: "default" },
        modes: {
          modes: [
            { id: "code", name: "Code Mode", description: "Full tool access" },
            { id: "architect", name: "Architect Mode", description: "Read only tools" },
          ],
          defaultModeId: "code",
        },
        configOptions: {
          options: [
            {
              type: "boolean",
              id: "verbose",
              name: "Verbose",
              defaultValue: false,
            },
          ],
        },
      };

      const agent = await createPrismCodeAcpAgent({
        config,
        provider: createMockProvider([providerDone()]),
      });

      const acpClient = client({ name: "modes-test-client" });

      await acpClient.connectWith(agent, async (connection) => {
        await connection.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            session: {
              configOptions: { boolean: {} },
            },
          },
        });

        const session = await connection.request(methods.agent.session.new, {
          cwd: dir,
          mcpServers: [],
        });

        assert.strictEqual(session.modes?.currentModeId, "code");
        assert.strictEqual(session.modes?.availableModes?.length, 2);
        assert.strictEqual(session.configOptions?.length, 1);
        assert.strictEqual(session.configOptions?.[0]?.id, "verbose");

        // Set valid mode
        await connection.request(methods.agent.session.setMode, {
          sessionId: session.sessionId,
          modeId: "architect",
        });

        // Unknown mode fails closed
        await assert.rejects(
          async () => {
            await connection.request(methods.agent.session.setMode, {
              sessionId: session.sessionId,
              modeId: "invalid-mode-id",
            });
          },
          (err: any) => Boolean(err.message?.includes("unknown mode") || err.data?.details?.includes("unknown mode 'invalid-mode-id'")),
        );
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("client fs adapter routes tool operations to client buffer when advertised", async () => {
    const dir = await makeTempDir("prism-code-acp-fs-");
    try {
      const config: PrismCodeConfig = {
        userId: "local-user",
        cwd: dir,
        store: { type: "memory" },
        model: { provider: "mock", model: "default" },
      };

      const writes: Array<{ path: string; content: string }> = [];

      const agent = await createPrismCodeAcpAgent({
        config,
        provider: writeToolProvider(),
      });

      const acpClient = client({ name: "client-fs-test" })
        .onRequest(methods.client.fs.readTextFile, () => ({ content: "existing-content" }))
        .onRequest(methods.client.fs.writeTextFile, ({ params }) => {
          writes.push({ path: params.path, content: params.content });
          return {};
        })
        .onRequest(methods.client.session.requestPermission, () => ({
          outcome: { outcome: "selected", optionId: "allow-once" },
        }));

      await acpClient.connectWith(agent, async (connection) => {
        await connection.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
        });

        const session = await connection.request(methods.agent.session.new, {
          cwd: dir,
          mcpServers: [],
        });

        const promptRes = await connection.request(methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "write buffer" }],
        });

        assert.strictEqual(promptRes.stopReason, "end_turn");
      });

      // Verification: client fs received the write
      assert.strictEqual(writes.length, 1);
      assert.ok(writes[0]?.path.includes("virtual.txt"));
      assert.strictEqual(writes[0]?.content, "client-editor-buffer-text");

      // Disk was not touched for virtual.txt
      let fileExistsOnDisk = true;
      try {
        readFileSync(join(dir, "virtual.txt"));
      } catch {
        fileExistsOnDisk = false;
      }
      assert.strictEqual(fileExistsOnDisk, false, "client fs writes must route to client buffers, not disk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("selectMcpServers gates http/sse by origin and path and stdio by marker", () => {
    // Stdio allowed
    assert.strictEqual(selectMcpServers(["stdio"], [{ command: "npx", name: "s1", args: [], env: [] }]), true);
    // Stdio disallowed when not in allow
    assert.strictEqual(selectMcpServers(["https://api.example.com"], [{ command: "npx", name: "s1", args: [], env: [] }]), false);

    // HTTP origin match
    assert.strictEqual(
      selectMcpServers(["https://api.example.com"], [{ type: "http", url: "https://api.example.com/mcp", name: "s2", headers: [] }]),
      true,
    );

    // Lookalike origin rejected
    assert.strictEqual(
      selectMcpServers(
        ["https://api.example.com"],
        [{ type: "http", url: "https://api.example.com.attacker.com/mcp", name: "s3", headers: [] }],
      ),
      false,
    );

    // Path traversal rejected
    assert.strictEqual(
      selectMcpServers(
        ["https://api.example.com/mcp"],
        [{ type: "http", url: "https://api.example.com/mcp/../secret", name: "s4", headers: [] }],
      ),
      false,
    );
  });

  it("CLI binary exits 1 with clear message on invalid config before serving ACP", async () => {
    const dir = await makeTempDir("prism-code-acp-cli-err-");
    try {
      const child: ChildProcessWithoutNullStreams = spawn(
        process.execPath,
        [join(import.meta.dirname, "../../bin/prism-code.js"), "acp", "-c", join(dir, "missing.json")],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("exit", (c) => resolve(c));
        child.on("error", reject);
      });

      assert.strictEqual(code, 1);
      assert.ok(stderr.includes("missing.json") || stderr.includes("cannot read config file") || stderr.includes("ENOENT"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("default ACP store resolves under the Prism home", async () => {
    const dir = await makeTempDir("prism-code-acp-home-");
    const home = await makeTempDir("prism-code-acp-store-");
    try {
      await createPrismCodeAcpAgent({
        config: { userId: "local-user", cwd: dir, model: { provider: "mock", model: "default" } },
        provider: createMockProvider([providerDone()]),
        home,
      });
      const dbPath = join(home, "sessions", "sessions.db");
      assert.ok(existsSync(dbPath));
      if (process.platform !== "win32") {
        assert.equal(statSync(dbPath).mode & 0o777, 0o600);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
