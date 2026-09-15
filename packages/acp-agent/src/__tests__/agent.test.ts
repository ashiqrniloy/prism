import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { type AIProvider, providerDone, toolCallContent } from "@arnilo/prism";
import { ConfigError } from "../config.js";
import { createSpawnableAgent, loadConfig, parseConfig, resolveProviderAdapter, selectMcpServers, SUPPORTED_PROVIDERS } from "../index.js";

const baseConfig = (cwd: string) => ({
  userId: "local",
  cwd,
  sessionStore: { type: "sqlite", path: ".prism/sessions.db" },
  model: { provider: "mock", model: "mock" },
  mcp: { allow: ["https://mcp.example.com"] },
  modes: { modes: [{ id: "edit", name: "Edit" }], defaultModeId: "edit" },
  configOptions: { options: [{ type: "boolean", id: "verbose", name: "Verbose", defaultValue: false }] },
});

function writeProvider(id = "acp-agent-write-test"): AIProvider {
  let turns = 0;
  return {
    id,
    async *generate() {
      if (++turns === 1) {
        yield { type: "tool_call", call: toolCallContent("write-1", "write", { path: "buffer.txt", content: "editor" }) };
      } else {
        yield providerDone();
      }
    },
  };
}

/** Spawns the built bin against a config file with piped stdio (the real editor wiring). */
function spawnAgent(configPath: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [join(import.meta.dirname, "../../../dist/bin/prism-acp-agent.js"), "--config", configPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Real-SDK agent stream over a spawned child's stdio (newline-delimited JSON both ways). */
function agentStream(child: ChildProcessWithoutNullStreams) {
  return ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
}

async function exitCode(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", reject);
  });
}

/** Modes + a boolean config option, the two negotiation seams the SDK client drives. */
const negotiatedConfig = (cwd: string) => ({
  userId: "local",
  cwd,
  sessionStore: { type: "memory" as const },
  model: { provider: "mock", model: "mock" },
  modes: {
    modes: [
      { id: "edit", name: "Edit" },
      { id: "plan", name: "Plan" },
    ],
    defaultModeId: "edit",
  },
  configOptions: { options: [{ type: "boolean" as const, id: "verbose", name: "Verbose", defaultValue: false }] },
});

test("parseConfig resolves relative paths and validates the happy path", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-"));
  try {
    const config = parseConfig(JSON.stringify(baseConfig(".")), dir, "test.json");
    assert.equal(config.userId, "local");
    assert.equal(config.cwd, dir);
    assert.deepEqual(config.sessionStore, { type: "sqlite", path: join(dir, ".prism/sessions.db") });
    assert.deepEqual(config.model, { provider: "mock", model: "mock" });
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
      [{ userId: "u", cwd: ".", mcp: { allow: ["https://user:pass@mcp.example.com"] } }, "credentials are not permitted"],
      [{ userId: "u", cwd: ".", mcp: { allow: ["https://mcp.example.com?query=1"] } }, "query parameters are not permitted"],
      [{ userId: "u", cwd: ".", mcp: { allow: ["https://mcp.example.com#hash"] } }, "fragment identifiers are not permitted"],
      [{ userId: "u", cwd: ".", mcp: { allow: ["ftp://mcp.example.com"] } }, "scheme must be http or https"],
      [{ userId: "u", cwd: ".", mcp: { allow: ["not-a-url"] } }, 'must be "stdio" or a valid absolute http/https URL'],
      [{ userId: "u", cwd: ".", mcp: { allow: ["https://mcp.example.com/%2e%2e/etc"] } }, "ambiguous encoded characters"],
      [{ userId: "u", cwd: ".", model: "not-an-object" }, "model must be an object"],
      [{ userId: "u", cwd: ".", model: { provider: "", model: "m" } }, "provider must be a non-empty string"],
      [{ userId: "u", cwd: ".", model: { provider: "p", model: "" } }, "model must be a non-empty string"],
      [{ userId: "u", cwd: ".", model: { provider: "p", model: "m", unknownKey: 1 } }, "unknown key(s): unknownKey"],
      [{ userId: "u", cwd: ".", credentialRef: "" }, "credentialRef must be a non-empty string"],
      [{ userId: "u", cwd: ".", credentialRef: "a".repeat(257) }, "credentialRef exceeds maximum length of 256 characters"],
      [{ userId: "u", cwd: ".", credentialRef: "line\nbreak" }, "credentialRef cannot contain control characters"],
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

test("selectMcpServers gates http/sse by origin and path-segment subtree and stdio by marker", () => {
  // 1. Allowed legitimate destinations
  assert.equal(
    selectMcpServers(["https://mcp.example.com"], [{ type: "http", url: "https://mcp.example.com/sse", name: "x", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com/mcp"], [{ type: "sse", url: "https://mcp.example.com/mcp/events", name: "x", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com"], [{ type: "sse", url: "https://evil.example.com", name: "x", headers: [] }]),
    false,
  );

  // 2. Origin lookalike rejection (Trap A)
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com.attacker.invalid/mcp", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com"], [{ type: "http", name: "probe", url: "https://mcp.example.com.evil.com", headers: [] }]),
    false,
  );

  // 3. Userinfo / credentials rejection
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com"],
      [{ type: "http", name: "probe", url: "https://user:pass@mcp.example.com/sse", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(
      ["https://user:pass@mcp.example.com"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/sse", headers: [] }],
    ),
    false,
  );

  // 4. Default vs non-default ports
  assert.equal(
    selectMcpServers(["https://mcp.example.com:443"], [{ type: "http", name: "probe", url: "https://mcp.example.com/sse", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com"], [{ type: "http", name: "probe", url: "https://mcp.example.com:443/sse", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["http://mcp.example.com:80"], [{ type: "http", name: "probe", url: "http://mcp.example.com/sse", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com:8443"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com:8443/sse", headers: [] }],
    ),
    true,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com:8443"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com:9443/sse", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com:8443"], [{ type: "http", name: "probe", url: "https://mcp.example.com/sse", headers: [] }]),
    false,
  );

  // 5. Mixed case scheme and hostname
  assert.equal(
    selectMcpServers(["HTTPS://MCP.EXAMPLE.COM/mcp"], [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com/mcp"], [{ type: "http", name: "probe", url: "HTTPS://MCP.EXAMPLE.COM/mcp", headers: [] }]),
    true,
  );

  // 6. IPv6
  assert.equal(
    selectMcpServers(["http://[::1]:8080/mcp"], [{ type: "http", name: "probe", url: "http://[::1]:8080/mcp", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["http://[::1]:8080/mcp"], [{ type: "http", name: "probe", url: "http://[::1]:9000/mcp", headers: [] }]),
    false,
  );

  // 7. IDN (Internationalized domain name)
  assert.equal(
    selectMcpServers(
      ["https://münchen.example.com"],
      [{ type: "http", name: "probe", url: "https://münchen.example.com/sse", headers: [] }],
    ),
    true,
  );
  assert.equal(
    selectMcpServers(
      ["https://xn--mnchen-3ya.example.com"],
      [{ type: "http", name: "probe", url: "https://münchen.example.com/sse", headers: [] }],
    ),
    true,
  );

  // 8. Trailing slash normalization
  assert.equal(
    selectMcpServers(["https://mcp.example.com/mcp/"], [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com/mcp"], [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp/", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(["https://mcp.example.com/"], [{ type: "http", name: "probe", url: "https://mcp.example.com/sse", headers: [] }]),
    true,
  );

  // 9. /mcp versus /mcp-other (exact path or path-segment subtree)
  assert.equal(
    selectMcpServers(["https://mcp.example.com/mcp"], [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp", headers: [] }]),
    true,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp/tools", headers: [] }],
    ),
    true,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp-other", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp_other", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcpextra", headers: [] }],
    ),
    false,
  );

  // 10. Encoded traversal and separators
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/%2e%2e/etc/passwd", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp%2fother", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp%5cother", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp\\other", headers: [] }],
    ),
    false,
  );
  assert.equal(
    selectMcpServers(
      ["https://mcp.example.com/mcp"],
      [{ type: "http", name: "probe", url: "https://mcp.example.com/mcp/../other", headers: [] }],
    ),
    false,
  );

  // 11. Invalid allow entry fails closed
  assert.equal(
    selectMcpServers(["invalid-url"], [{ type: "http", name: "probe", url: "https://mcp.example.com/sse", headers: [] }]),
    false,
  );

  // 12. Stdio and ACP transports
  assert.equal(selectMcpServers(["stdio"], [{ command: "npx", name: "x", args: [], env: [] }]), true);
  assert.equal(selectMcpServers(["https://mcp.example.com"], [{ command: "npx", name: "x", args: [], env: [] }]), false);
  assert.equal(selectMcpServers(["https://mcp.example.com"], [{ type: "acp", name: "x", id: "y" } as never]), false);
});

test("createSpawnableAgent serves initialize/new/prompt/close over the SDK", async () => {
  const agent = createSpawnableAgent({
    config: parseConfig(JSON.stringify({ userId: "local", cwd: process.cwd(), model: { provider: "mock", model: "mock" } }), process.cwd()),
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
      JSON.stringify({
        userId: "local",
        cwd: process.cwd(),
        sessionStore: { type: "sqlite", path: ":memory:" },
        model: { provider: "mock", model: "mock" },
      }),
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

test("spawns the bin and drives a mode/config-option/prompt round-trip with the real SDK client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-roundtrip-"));
  const configPath = join(dir, "prism-acp-agent.json");
  writeFileSync(configPath, JSON.stringify(negotiatedConfig(".")));
  const child = spawnAgent(configPath);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const updates: string[] = [];
  try {
    const acpClient = client({ name: "roundtrip-client" }).onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update.sessionUpdate);
    });
    await acpClient.connectWith(agentStream(child), async (connection) => {
      const initialized = await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        // Supplying `{}` is what advertises boolean session config options.
        clientCapabilities: { session: { configOptions: { boolean: {} } } },
      });
      assert.equal(initialized.agentInfo?.name, "Prism ACP Agent");
      const created = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      assert.equal(created.modes?.currentModeId, "edit", "the configured default mode must be negotiated");
      assert.deepEqual(
        created.modes?.availableModes?.map((mode) => mode.id),
        ["edit", "plan"],
      );

      await connection.request(methods.agent.session.setMode, { sessionId: created.sessionId, modeId: "plan" });
      // The SDK types this response as unknown (union schema), so read it structurally.
      const configured = (await connection.request(methods.agent.session.setConfigOption, {
        sessionId: created.sessionId,
        configId: "verbose",
        type: "boolean",
        value: true,
      })) as { configOptions?: readonly { id: string; currentValue?: unknown }[] };
      assert.equal(configured.configOptions?.find((option) => option.id === "verbose")?.currentValue, true);

      // Validation errors surface as request failures, not silent success (the wire layer
      // maps them to "Internal error", so the exact message is asserted in the ag-ui suite).
      await assert.rejects(connection.request(methods.agent.session.setMode, { sessionId: created.sessionId, modeId: "nope" }));
      await assert.rejects(
        connection.request(methods.agent.session.setConfigOption, {
          sessionId: created.sessionId,
          configId: "typo",
          type: "boolean",
          value: true,
        }),
      );
      // Rejected requests changed nothing: the accepted writes are the only two updates so far,
      // and the option still flips on the next valid write.
      assert.equal(updates.filter((update) => update === "current_mode_update").length, 1);
      assert.equal(updates.filter((update) => update === "config_option_update").length, 1);
      const reverted = (await connection.request(methods.agent.session.setConfigOption, {
        sessionId: created.sessionId,
        configId: "verbose",
        type: "boolean",
        value: false,
      })) as { configOptions?: readonly { id: string; currentValue?: unknown }[] };
      assert.equal(reverted.configOptions?.find((option) => option.id === "verbose")?.currentValue, false);

      const result = await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "go" }],
      });
      assert.equal(result.stopReason, "end_turn");
      await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
    });

    assert.equal(updates.filter((update) => update === "current_mode_update").length, 1, updates.join());
    assert.equal(updates.filter((update) => update === "config_option_update").length, 2, updates.join());
    child.stdin.end();
    assert.equal(await exitCode(child), 0, `bin exited nonzero; stderr: ${stderr}`);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refused and cancelled permission outcomes never run the tool", async () => {
  for (const outcome of ["selected-reject", "cancelled"] as const) {
    const dir = mkdtempSync(join(tmpdir(), "acp-agent-deny-"));
    try {
      const writes: string[] = [];
      const permissions: string[] = [];
      const agent = createSpawnableAgent({
        config: parseConfig(JSON.stringify({ userId: "local", cwd: dir, sessionStore: { type: "memory" } }), dir),
        provider: writeProvider(),
      });
      const acpClient = client({ name: `deny-${outcome}-client` })
        .onRequest(methods.client.fs.readTextFile, () => ({ content: "editor" }))
        .onRequest(methods.client.fs.writeTextFile, ({ params }) => {
          writes.push(params.path);
          return {};
        })
        .onRequest(methods.client.session.requestPermission, ({ params }) => {
          permissions.push(params.toolCall.toolCallId);
          return outcome === "cancelled"
            ? { outcome: { outcome: "cancelled" } as const }
            : { outcome: { outcome: "selected", optionId: "reject-once" } as const };
        });

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

      assert.equal(permissions.length, 1, `${outcome}: the run must ask before the tool`);
      assert.deepEqual(writes, [], `${outcome}: a refused tool must never reach the client fs`);
      assert.throws(() => readFileSync(join(dir, "buffer.txt"), "utf8"), `${outcome}: a refused write must not touch disk`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
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

test("recording provider sees exact requested model", async () => {
  const requestedModel = { provider: "openai", model: "gpt-4o-mini" };
  let seenModel: unknown = null;
  const recordingProvider: AIProvider = {
    id: "openai",
    async *generate(request) {
      seenModel = request.model;
      yield providerDone();
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-recording-"));
  try {
    const agent = createSpawnableAgent({
      config: parseConfig(
        JSON.stringify({
          userId: "local",
          cwd: dir,
          model: requestedModel,
          credentialRef: "TEST_REF",
        }),
        dir,
      ),
      provider: recordingProvider,
    });
    await client().connectWith(agent, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const session = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      await connection.request(methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello" }],
      });
    });
    assert.deepEqual(seenModel, requestedModel);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit mock mode stays completely offline and needs no credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-mock-"));
  try {
    const agent = createSpawnableAgent({
      config: parseConfig(
        JSON.stringify({
          userId: "local",
          cwd: dir,
          model: { provider: "mock", model: "mock" },
        }),
        dir,
      ),
    });
    await client().connectWith(agent, async (connection) => {
      const initialized = await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      assert.equal(initialized.agentInfo?.name, "Prism ACP Agent");
      const session = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      const result = await connection.request(methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "offline prompt" }],
      });
      assert.equal(result.stopReason, "end_turn");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown and mismatched provider fail before startup", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-unknown-"));
  try {
    // Missing model without provider fails
    assert.throws(
      () =>
        createSpawnableAgent({
          config: parseConfig(JSON.stringify({ userId: "local", cwd: dir }), dir),
        }),
      (err: unknown) => err instanceof ConfigError && /model configuration is required/.test(err.message),
    );

    // Unknown provider in config fails
    assert.throws(
      () =>
        createSpawnableAgent({
          config: parseConfig(JSON.stringify({ userId: "local", cwd: dir, model: { provider: "unsupported-llm", model: "v1" } }), dir),
        }),
      (err: unknown) => err instanceof ConfigError && /unknown provider "unsupported-llm"/.test(err.message),
    );

    // Injected provider mismatches config model
    assert.throws(
      () =>
        createSpawnableAgent({
          config: parseConfig(JSON.stringify({ userId: "local", cwd: dir, model: { provider: "openai", model: "gpt-4o" } }), dir),
          provider: {
            id: "anthropic",
            async *generate() {
              yield providerDone();
            },
          },
        }),
      (err: unknown) => err instanceof ConfigError && /provider mismatch/.test(err.message),
    );

    // Model option override mismatches injected provider
    assert.throws(
      () =>
        createSpawnableAgent({
          config: parseConfig(JSON.stringify({ userId: "local", cwd: dir }), dir),
          provider: {
            id: "anthropic",
            async *generate() {
              yield providerDone();
            },
          },
          model: { provider: "openai", model: "gpt-4o" },
        }),
      (err: unknown) => err instanceof ConfigError && /provider mismatch/.test(err.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing credentialRef or unresolvable credential fails before startup", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-cred-"));
  try {
    // Real provider without credentialRef fails
    assert.throws(
      () =>
        createSpawnableAgent({
          config: parseConfig(JSON.stringify({ userId: "local", cwd: dir, model: { provider: "openai", model: "gpt-4o" } }), dir),
        }),
      (err: unknown) => err instanceof ConfigError && /requires credentialRef in config/.test(err.message),
    );

    // Unresolvable credentialRef fails
    assert.throws(
      () =>
        createSpawnableAgent({
          config: parseConfig(
            JSON.stringify({
              userId: "local",
              cwd: dir,
              model: { provider: "openai", model: "gpt-4o" },
              credentialRef: "MISSING_ENV_VAR_XYZ_12345",
            }),
            dir,
          ),
          credentialResolver: () => undefined,
        }),
      (err: unknown) => err instanceof ConfigError && /could not be resolved/.test(err.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("credential value never enters config, identity, events, or persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-canary-"));
  const canary = "CANARY_SECRET_VALUE_XYZ_987654";
  const dbPath = join(dir, "sessions.db");
  try {
    const config = parseConfig(
      JSON.stringify({
        userId: "local",
        cwd: dir,
        sessionStore: { type: "sqlite", path: dbPath },
        model: { provider: "mock", model: "mock" },
        credentialRef: "TEST_SECRET_REF",
      }),
      dir,
    );
    // Config only has the ref, not the secret value
    assert.equal(config.credentialRef, "TEST_SECRET_REF");
    assert.equal(JSON.stringify(config).includes(canary), false);

    const testProvider: AIProvider = {
      id: "mock",
      async *generate() {
        yield providerDone();
      },
    };
    const agent = createSpawnableAgent({
      config,
      provider: testProvider,
      credentialResolver: (ref) => (ref === "TEST_SECRET_REF" ? canary : undefined),
    });

    const receivedNotifications: unknown[] = [];
    const testClient = client({ name: "canary-test-client" }).onNotification(methods.client.session.update, ({ params }) => {
      receivedNotifications.push(params);
    });

    await testClient.connectWith(agent, async (connection) => {
      const init = await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      assert.equal(JSON.stringify(init).includes(canary), false);
      const session = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      assert.equal(JSON.stringify(session).includes(canary), false);
      const promptResult = await connection.request(methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello" }],
      });
      assert.equal(JSON.stringify(promptResult).includes(canary), false);
    });

    // Check received notifications
    assert.equal(JSON.stringify(receivedNotifications).includes(canary), false);

    // Read sqlite DB file contents from disk
    const dbContent = readFileSync(dbPath).toString("utf8");
    assert.equal(dbContent.includes(canary), false, "credential value must never enter SQLite storage");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two sessions with editor FS preserve the selected model and provider independently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-two-sessions-"));
  try {
    const requestedModel = { provider: "openai", model: "gpt-4o" };
    const sessionModelCalls: Array<{ sessionId: string; model: unknown; file: string }> = [];
    const writesA: Array<{ path: string; content: string }> = [];
    const writesB: Array<{ path: string; content: string }> = [];

    let callIndex = 0;
    const multiSessionProvider: AIProvider = {
      id: "openai",
      async *generate(request) {
        callIndex++;
        if (callIndex === 1) {
          sessionModelCalls.push({ sessionId: "turn-1", model: request.model, file: "fileA.txt" });
          yield {
            type: "tool_call",
            call: toolCallContent("call-1", "write", { path: "fileA.txt", content: "content-fileA.txt" }),
          };
        } else if (callIndex === 2) {
          yield providerDone();
        } else if (callIndex === 3) {
          sessionModelCalls.push({ sessionId: "turn-2", model: request.model, file: "fileB.txt" });
          yield {
            type: "tool_call",
            call: toolCallContent("call-2", "write", { path: "fileB.txt", content: "content-fileB.txt" }),
          };
        } else {
          yield providerDone();
        }
      },
    };

    const agent = createSpawnableAgent({
      config: parseConfig(
        JSON.stringify({
          userId: "local",
          cwd: dir,
          model: requestedModel,
          credentialRef: "TEST_KEY",
        }),
        dir,
      ),
      provider: multiSessionProvider,
    });

    const testClient = client({ name: "multi-session-client" })
      .onRequest(methods.client.fs.readTextFile, () => ({ content: "" }))
      .onRequest(methods.client.fs.writeTextFile, ({ params }) => {
        if (params.path.endsWith("fileA.txt")) writesA.push(params);
        else writesB.push(params);
        return {};
      })
      .onRequest(methods.client.session.requestPermission, () => ({
        outcome: { outcome: "selected", optionId: "allow-once" },
      }));

    await testClient.connectWith(agent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });

      // Session 1
      const session1 = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      await connection.request(methods.agent.session.prompt, {
        sessionId: session1.sessionId,
        prompt: [{ type: "text", text: "write A" }],
      });

      // Session 2
      const session2 = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      await connection.request(methods.agent.session.prompt, {
        sessionId: session2.sessionId,
        prompt: [{ type: "text", text: "write B" }],
      });
    });

    // Both sessions saw the same requested model
    assert.equal(sessionModelCalls.length, 2);
    assert.deepEqual(sessionModelCalls[0].model, requestedModel);
    assert.deepEqual(sessionModelCalls[1].model, requestedModel);

    // Writes routed to respective sessions without interference
    assert.equal(writesA.length, 1);
    assert.equal(writesB.length, 1);
    assert.ok(writesA[0].path.endsWith("fileA.txt"));
    assert.ok(writesB[0].path.endsWith("fileB.txt"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("approval/restart reconstruction restores session agents across restart with SQLite persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-restart-"));
  const dbPath = join(dir, "restart.db");
  const model = { provider: "mock", model: "mock" };
  try {
    const config = parseConfig(
      JSON.stringify({
        userId: "local",
        cwd: dir,
        sessionStore: { type: "sqlite", path: dbPath },
        model,
      }),
      dir,
    );

    let capturedSessionId: string | undefined;
    const agent1 = createSpawnableAgent({ config, provider: writeProvider("mock") });
    const acpClient1 = client({ name: "client-1" })
      .onRequest(methods.client.fs.readTextFile, () => ({ content: "disk" }))
      .onRequest(methods.client.fs.writeTextFile, () => ({}))
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        capturedSessionId = params.sessionId;
        return { outcome: { outcome: "selected", optionId: "reject-once" } };
      });

    await acpClient1.connectWith(agent1, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const created = await connection.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
      capturedSessionId = created.sessionId;
      await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "write buffer" }],
      });
    });

    assert.ok(capturedSessionId);

    // Process 2: simulates process restart with same sqlite database and config
    const agent2 = createSpawnableAgent({ config });
    const sessionAgentId = `prism-acp-agent:${capturedSessionId}`;
    const lifecycle = (
      agent2 as unknown as {
        lifecycle: {
          resolveAgent: (input: { agentId: string }) => Promise<{
            agent: { config: { id: string; model: unknown; provider: { id: string } } };
          }>;
        };
      }
    ).lifecycle;
    assert.ok(lifecycle, "lifecycle should be exposed on spawnable agent");

    const resolved = await lifecycle.resolveAgent({ agentId: sessionAgentId });
    assert.ok(resolved.agent);
    assert.equal(resolved.agent.config.id, sessionAgentId);
    assert.deepEqual(resolved.agent.config.model, model);
    assert.equal(resolved.agent.config.provider.id, "mock");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("protected real-provider stdio journey initializes and creates session over spawned binary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-agent-real-stdio-"));
  try {
    const configPath = join(dir, "prism-acp-agent.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        userId: "local",
        cwd: ".",
        sessionStore: { type: "memory" },
        model: { provider: "openai", model: "gpt-4o" },
        credentialRef: "PRISM_TEST_OPENAI_KEY",
      }),
    );
    const child = spawn(process.execPath, [join(import.meta.dirname, "../../../dist/bin/prism-acp-agent.js"), "--config", configPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PRISM_TEST_OPENAI_KEY: "dummy-key-for-stdio-journey" },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const acpClient = client({ name: "stdio-real-client" });
    await acpClient.connectWith(agentStream(child), async (connection) => {
      const initialized = await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
      });
      assert.equal(initialized.agentInfo?.name, "Prism ACP Agent");
      const created = await connection.request(methods.agent.session.new, {
        cwd: dir,
        mcpServers: [],
      });
      assert.ok(created.sessionId, "session must be created");
      await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
    });

    child.stdin.end();
    const code = await exitCode(child);
    assert.equal(code, 0, `bin exited nonzero; stderr: ${stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveProviderAdapter resolves every advertised adapter and refuses anything else", async () => {
  // Trap C capability truth: SUPPORTED_PROVIDERS is what the launcher advertises and validates
  // against, so every entry except the local mock must resolve to a real factory — otherwise a
  // host that configured an advertised id fails only at first generate.
  // The one deliberate normalization: the Kimi Coding adapter names itself differently from the
  // config id the launcher advertises and validates.
  const ADAPTER_ID: Record<string, string> = { kimi: "kimi-coding" };
  for (const providerId of SUPPORTED_PROVIDERS) {
    if (providerId === "mock") continue;
    const provider = await resolveProviderAdapter(providerId, "test-credential");
    assert.equal(provider.id, ADAPTER_ID[providerId] ?? providerId, `${providerId} must resolve to its adapter`);
    assert.equal(typeof provider.generate, "function", `${providerId} must return a callable provider`);
  }
  await assert.rejects(() => resolveProviderAdapter("not-a-provider", "test-credential"), ConfigError);
});
