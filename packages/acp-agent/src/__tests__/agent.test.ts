import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { type AIProvider, providerDone, toolCallContent } from "@arnilo/prism";
import { ConfigError } from "../config.js";
import { createSpawnableAgent, loadConfig, parseConfig, selectMcpServers } from "../index.js";

const baseConfig = (cwd: string) => ({
  userId: "local",
  cwd,
  sessionStore: { type: "sqlite", path: ".prism/sessions.db" },
  mcp: { allow: ["https://mcp.example.com"] },
  modes: { modes: [{ id: "edit", name: "Edit" }], defaultModeId: "edit" },
  configOptions: { options: [{ type: "boolean", id: "verbose", name: "Verbose", defaultValue: false }] },
});

function writeProvider(): AIProvider {
  let turns = 0;
  return {
    id: "acp-agent-write-test",
    async *generate() {
      if (++turns === 1) {
        yield { type: "tool_call", call: toolCallContent("write-1", "write", { path: "buffer.txt", content: "editor" }) };
      } else {
        yield providerDone();
      }
    },
  };
}

test("parseConfig resolves relative paths and validates the happy path", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-"));
  try {
    const config = parseConfig(JSON.stringify(baseConfig(".")), dir, "test.json");
    assert.equal(config.userId, "local");
    assert.equal(config.cwd, dir);
    assert.deepEqual(config.sessionStore, { type: "sqlite", path: join(dir, ".prism/sessions.db") });
    assert.deepEqual(config.mcp?.allow, ["https://mcp.example.com"]);
    assert.equal(config.modes?.defaultModeId, "edit");
    assert.equal(config.configOptions?.options[0]?.id, "verbose");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseConfig rejects invalid configs with clear errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-"));
  try {
    const cases: [unknown, string][] = [
      ["not an object", "config must be a JSON object"],
      [{ userId: "u", cwd: ".", typoKey: true }, "unknown key(s): typoKey"],
      [{ cwd: "." }, "userId must be a non-empty string"],
      [{ userId: "u", cwd: "/nonexistent-dir-xyz" }, "cwd is not an existing directory"],
      [{ userId: "u", cwd: ".", sessionStore: { type: "sqlite" } }, "path must be a non-empty string"],
      [{ userId: "u", cwd: ".", sessionStore: { type: "jsonl" } }, 'sessionStore.type must be "sqlite" or "memory"'],
      [
        {
          userId: "u",
          cwd: ".",
          modes: {
            modes: [
              { id: "a", name: "A" },
              { id: "a", name: "A2" },
            ],
          },
        },
        "duplicate mode id: a",
      ],
      [{ userId: "u", cwd: ".", modes: { modes: [{ id: "a", name: "A" }], defaultModeId: "b" } }, "defaultModeId 'b' is not a known mode"],
      [
        { userId: "u", cwd: ".", configOptions: { options: [{ type: "select", id: "s", name: "S", defaultValue: "x" }] } },
        "options must be a non-empty array",
      ],
      [
        { userId: "u", cwd: ".", configOptions: { options: [{ type: "boolean", id: "b", name: "B", defaultValue: "yes" }] } },
        "defaultValue must be a boolean",
      ],
      [{ userId: "u", cwd: ".", mcp: { allow: [""] } }, "mcp.allow must be an array of non-empty strings"],
    ];
    for (const [raw, expected] of cases) {
      assert.throws(
        () => parseConfig(JSON.stringify(raw), dir, "test.json"),
        (error: unknown) => error instanceof ConfigError && error.message.includes(expected),
        `expected rejection for ${JSON.stringify(raw)}`,
      );
    }
    // Memory store needs no path; unknown nested keys rejected.
    const config = parseConfig(JSON.stringify({ userId: "u", cwd: ".", sessionStore: { type: "memory", path: "/x" } }), dir);
    assert.deepEqual(config.sessionStore, { type: "memory" });
    // ":memory:" must survive verbatim (sqlite in-memory), never resolved to a literal file.
    const memoryConfig = parseConfig(JSON.stringify({ userId: "u", cwd: ".", sessionStore: { type: "sqlite", path: ":memory:" } }), dir);
    assert.deepEqual(memoryConfig.sessionStore, { type: "sqlite", path: ":memory:" });
    assert.throws(
      () => parseConfig(JSON.stringify({ userId: "u", cwd: ".", sessionStore: { type: "memory", extra: 1 } }), dir),
      /unknown key/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig reads a file and reports missing files", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-"));
  try {
    const path = join(dir, "prism-acp-agent.json");
    writeFileSync(path, JSON.stringify({ userId: "u", cwd: "." }));
    assert.equal(loadConfig(path).userId, "u");
    assert.throws(
      () => loadConfig(join(dir, "missing.json")),
      (error: unknown) => error instanceof ConfigError && /cannot read config file/.test(error.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("selectMcpServers gates http/sse by allow prefix and stdio by marker", () => {
  assert.equal(
    selectMcpServers(["https://mcp.example.com"], [{ type: "http", url: "https://mcp.example.com/sse", name: "x", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com"], [{ type: "sse", url: "https://evil.example.com", name: "x", headers: [] }]),
    false,
  );
  assert.equal(selectMcpServers(["stdio"], [{ command: "npx", name: "x", args: [], env: [] }]), true);
  assert.equal(selectMcpServers(["https://mcp.example.com"], [{ command: "npx", name: "x", args: [], env: [] }]), false);
  assert.equal(selectMcpServers(["https://mcp.example.com"], [{ type: "acp", name: "x", id: "y" } as never]), false);
});

test("createSpawnableAgent serves initialize/new/prompt/close over the SDK", async () => {
  const agent = createSpawnableAgent({
    config: parseConfig(JSON.stringify({ userId: "local", cwd: process.cwd() }), process.cwd()),
  });
  await client().connectWith(agent, async (connection) => {
    const initialized = await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
    assert.ok(initialized.agentInfo, "initialize must return agentInfo");
    assert.equal(initialized.agentInfo.name, "Prism ACP Agent");
    assert.match(initialized.agentInfo.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(initialized.agentCapabilities?.promptCapabilities, undefined);
    assert.deepEqual(initialized.agentCapabilities?.sessionCapabilities, { close: {} });
    const created = await connection.request(methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] });
    assert.equal(created.modes?.currentModeId, undefined);
    const result = await connection.request(methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "go" }],
    });
    assert.equal(result.stopReason, "end_turn");
    await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
  });
});

test("createSpawnableAgent routes advertised fs coding tools to client buffers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-fs-"));
  try {
    const diskPath = join(dir, "buffer.txt");
    writeFileSync(diskPath, "disk");
    const writes: Array<{ path: string; content: string }> = [];
    const agent = createSpawnableAgent({
      config: parseConfig(JSON.stringify({ userId: "local", cwd: dir, sessionStore: { type: "memory" } }), dir),
      provider: writeProvider(),
    });
    const acpClient = client({ name: "fs-test-client" })
      .onRequest(methods.client.fs.readTextFile, () => ({ content: "editor" }))
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
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const created = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      const result = await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "write buffer" }],
      });
      assert.equal(result.stopReason, "end_turn");
    });

    assert.deepEqual(writes, [{ path: diskPath, content: "editor" }]);
    assert.equal(readFileSync(diskPath, "utf8"), "disk", "client fs write must not touch cwd disk");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createSpawnableAgent keeps disk coding tools when fs is not advertised", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-disk-"));
  try {
    const agent = createSpawnableAgent({
      config: parseConfig(JSON.stringify({ userId: "local", cwd: dir, sessionStore: { type: "memory" } }), dir),
      provider: writeProvider(),
    });
    const acpClient = client({ name: "disk-test-client" }).onRequest(methods.client.session.requestPermission, () => ({
      outcome: { outcome: "selected", optionId: "allow-once" },
    }));

    await acpClient.connectWith(agent, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const created = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      const result = await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "write buffer" }],
      });
      assert.equal(result.stopReason, "end_turn");
    });

    assert.equal(readFileSync(join(dir, "buffer.txt"), "utf8"), "editor");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createSpawnableAgent works with the sqlite store", async () => {
  const agent = createSpawnableAgent({
    config: parseConfig(
      JSON.stringify({ userId: "local", cwd: process.cwd(), sessionStore: { type: "sqlite", path: ":memory:" } }),
      process.cwd(),
    ),
  });
  await client().connectWith(agent, async (connection) => {
    await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
    const created = await connection.request(methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] });
    const result = await connection.request(methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "go" }],
    });
    assert.equal(result.stopReason, "end_turn");
  });
});

test("bin spawns and answers initialize over stdio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-bin-"));
  try {
    const configPath = join(dir, "prism-acp-agent.json");
    writeFileSync(configPath, JSON.stringify(baseConfig(".")));
    const child = spawn(process.execPath, [join(import.meta.dirname, "../../../dist/bin/prism-acp-agent.js"), "--config", configPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const request = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} } })}\n`;
    const response = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`bin did not respond; stderr: ${stderr}`)), 10_000);
      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const line = buffer.indexOf("\n");
        if (line !== -1) {
          clearTimeout(timeout);
          resolve(buffer.slice(0, line));
        }
      });
      child.on("error", reject);
      child.stdin.write(request);
    });
    const message = JSON.parse(response) as { result?: { agentInfo?: { name?: string } } };
    assert.equal(message.result?.agentInfo?.name, "Prism ACP Agent");
    child.stdin.end();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("exit", (exitCode) => resolve(exitCode));
      child.on("error", reject);
    });
    assert.equal(code, 0, `bin exited nonzero; stderr: ${stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
