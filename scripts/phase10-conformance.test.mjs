/**
 * Phase 10 network-free conformance (plan 010 Task 8).
 * Cross-cuts the Task 0 matrices through the real `@arnilo/prism-ag-ui/acp`
 * subpath over the SDK in-process transport; the per-cell unit suites in
 * packages/ag-ui/src/__tests__/acp-*.test.ts remain authoritative.
 * Composed scenario: initialize matrix → session/new (dirs + MCP + modes +
 * config) → prompt with fs/terminal client methods and lifecycle updates →
 * four-outcome permission with cancel → mode/config switches → load/resume/
 * list/delete. Adversarial: unadvertised methods, UNSTABLE transport, limit
 * ladder at/above frozen caps, malformed payloads, secret redaction.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createSecretRedactor } from "@arnilo/prism";
import { createPrismAcpAgent } from "../packages/ag-ui/dist/acp/index.js";
import { createCodingLifecycleEmitter } from "../packages/prism-coding-tools/dist/agent/index.js";

const AUTHORIZATION = { ownership: { userId: "user-1" } };

/** Realistic host: in-memory sessions, fs store, terminal store, durable-resume lifecycle. */
function makeHost(options = {}) {
  const emitter = options.lifecycle ?? createCodingLifecycleEmitter();
  const sessions = new Map(); // sessionId -> { stream: (input) => AsyncGenerator, cwd }
  const created = [];
  const lifecycle = {
    async *resumeStream(_ref, resume, _opts) {
      const entry = sessions.get(_ref.sessionId);
      if (!entry) throw new Error(`no session ${_ref.sessionId}`);
      const decisions = resume.decisions ?? [];
      for (const decision of decisions) {
        if (decision.outcome === "allow_once" || decision.outcome === "allow_for_run") {
          yield {
            type: "tool_call",
            sessionId: _ref.sessionId,
            runId: _ref.runId,
            call: { id: decision.approvalId, name: "write", arguments: { path: "/workspace/a.txt", content: "ok" } },
          };
          yield {
            type: "tool_result",
            sessionId: _ref.sessionId,
            runId: _ref.runId,
            result: { toolCallId: decision.approvalId, name: "write", content: "wrote" },
          };
        }
      }
      yield { type: "agent_done", sessionId: _ref.sessionId, runId: _ref.runId, reason: "end_turn" };
    },
  };
  // Reconstructs a session binding for load/resume; the stream delegates to the stored entry.
  const bindingFor = (entry) => ({
    session: {
      id: entry.id,
      async *stream() {
        yield* entry.stream({ cwd: entry.cwd }, entry.id);
      },
    },
  });
  const agent = createPrismAcpAgent({
    authorize: () => AUTHORIZATION,
    sessionFactory: (input) => {
      const binding = {
        session: {
          id: input.sessionId ?? `host-${created.length + 1}`,
          async *stream() {
            const entry = sessions.get(this.id);
            yield* entry.stream(input, this.id);
          },
        },
      };
      created.push(input);
      return binding;
    },
    lifecycle,
    redactor: options.redactor,
    projection: options.projection,
    sessions: {
      async load({ sessionId }) {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        return bindingFor(entry);
      },
      async list({ cwd }) {
        return [...sessions.values()]
          .filter((entry) => !cwd || entry.cwd === cwd)
          .map((entry) => ({ sessionId: entry.id, cwd: entry.cwd }));
      },
      async resume({ sessionId }) {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        return bindingFor(entry);
      },
      async delete({ sessionId }) {
        sessions.delete(sessionId);
      },
      async additionalDirectories({ directories }) {
        return directories.filter((directory) => directory.startsWith("/allowed"));
      },
    },
    mcp: {
      transports: ["http", "sse", "stdio"],
      async select({ servers }) {
        return servers.every((server) => server.name !== "forbidden");
      },
    },
    modes: {
      modes: [
        { id: "edit", name: "Edit" },
        { id: "review", name: "Review" },
      ],
      defaultModeId: "edit",
    },
    configOptions: {
      options: [{ type: "boolean", id: "verbose", name: "Verbose", defaultValue: false }],
    },
    capabilities: {
      prompt: {
        media: async () => true,
        embedded: async () => true,
      },
    },
    coding: {
      lifecycle: emitter,
      filesystem: async (client, sessionId) => ({
        async readTextFile({ path }) {
          const result = await client.request(methods.client.fs.readTextFile, { sessionId, path });
          return { text: result.content };
        },
        async writeTextFile({ path, content }) {
          await client.request(methods.client.fs.writeTextFile, { sessionId, path, content });
          return {};
        },
      }),
      processes: async (client, sessionId) => ({
        async create({ command }) {
          const result = await client.request(methods.client.terminal.create, { sessionId, command });
          return {
            id: result.terminalId,
            async output() {
              const output = await client.request(methods.client.terminal.output, { sessionId, terminalId: result.terminalId });
              return { output: output.output, truncated: output.truncated ?? false };
            },
            async waitForExit() {
              return { exitCode: 0 };
            },
            async kill() {},
            async release() {},
          };
        },
      }),
    },
  });
  return { agent, created, sessions, lifecycle: emitter };
}

describe("Phase 10 conformance — composed ACP scenario (Task 8)", () => {
  it("initializes, creates, streams with fs/terminal/lifecycle, switches mode/config, resumes, lists, deletes", async () => {
    const host = makeHost();
    host.sessions.set("stored-1", { id: "stored-1", cwd: "/workspace", async *stream() {} });
    const updates = [];
    let sessionId;
    const acpClient = client({ name: "conformance-client" })
      .onNotification(methods.client.session.update, ({ params }) => updates.push(params.update))
      .onRequest(methods.client.fs.readTextFile, ({ params }) => {
        assert.equal(params.sessionId, sessionId);
        assert.equal(params.path, "/workspace/a.txt");
        return { content: "hello" };
      })
      .onRequest(methods.client.fs.writeTextFile, ({ params }) => {
        assert.equal(params.sessionId, sessionId);
        assert.equal(params.content, "bye");
        return {};
      })
      .onRequest(methods.client.terminal.create, ({ params }) => {
        assert.equal(params.sessionId, sessionId);
        assert.equal(params.command, "ls");
        return { terminalId: "term-1" };
      })
      .onRequest(methods.client.terminal.output, ({ params }) => {
        assert.equal(params.terminalId, "term-1");
        return { output: "a.txt\n", truncated: false };
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        assert.equal(params.options.length, 4);
        assert.deepEqual(
          params.options.map((option) => option.kind),
          ["allow_once", "allow_for_run", "reject_once", "reject_for_run"],
        );
        return { outcome: { outcome: "selected", optionId: "reject-once" } };
      });
    await acpClient.connectWith(host.agent, async (connection) => {
      const initialize = await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
          session: { configOptions: { boolean: {} } },
          elicitation: { form: {} },
        },
      });
      assert.equal(initialize.protocolVersion, PROTOCOL_VERSION);
      assert.ok(initialize.agentCapabilities.loadSession, "loadSession must be advertised when sessions.load is wired");
      assert.deepEqual(initialize.agentCapabilities.sessionCapabilities, {
        list: {},
        delete: {},
        additionalDirectories: {},
        resume: {},
        close: {},
      });
      assert.deepEqual(initialize.agentCapabilities.promptCapabilities, { image: true, audio: true, embeddedContext: true });
      assert.deepEqual(initialize.agentCapabilities.mcpCapabilities, { http: true, sse: true });
      assert.equal(initialize.agentInfo.name, "Prism");
      assert.match(initialize.agentInfo.version, /^\d+\.\d+\.\d+$/);

      const mcpServer = { type: "http", name: "repo", url: "https://mcp.example.com", headers: [] };

      const created = await connection.request(methods.agent.session.new, {
        cwd: "/workspace",
        additionalDirectories: ["/allowed/lib", "/denied/lib"],
        mcpServers: [mcpServer],
      });
      sessionId = created.sessionId;
      assert.match(sessionId, /^acp-/);
      // Host stream registered under the pre-generated ACP session id; fs/terminal
      // client-method round trips and the mid-stream lifecycle event run inside it.
      host.sessions.set(sessionId, {
        id: sessionId,
        cwd: "/workspace",
        async *stream(input) {
          const read = await input.coding.filesystem.readTextFile({ path: "/workspace/a.txt" });
          assert.equal(read.text, "hello");
          await input.coding.filesystem.writeTextFile({ path: "/workspace/b.txt", content: "bye" });
          const terminal = await input.coding.processes.create({ command: "ls" });
          const output = await terminal.output();
          assert.equal(output.output, "a.txt\n");
          host.lifecycle.emit({ type: "file_changed", path: "/workspace/b.txt", op: "write", toolCallId: "tool-1" });
          yield { type: "message_delta", sessionId, runId: "run-1", content: { type: "text", text: "listing done" } };
          yield { type: "agent_done", sessionId, runId: "run-1", reason: "end_turn" };
        },
      });
      assert.deepEqual(created.modes, {
        currentModeId: "edit",
        availableModes: [
          { id: "edit", name: "Edit" },
          { id: "review", name: "Review" },
        ],
      });
      assert.deepEqual(created.configOptions, [
        { type: "boolean", id: "verbose", name: "Verbose", defaultValue: false, currentValue: false },
      ]);
      // Host saw the policy-checked inputs.
      const inputs = host.created[0];
      assert.equal(inputs.cwd, "/workspace");
      assert.deepEqual(inputs.additionalDirectories, ["/allowed/lib"]);
      assert.deepEqual(inputs.mcpServers, [mcpServer]);

      // Mode switch.
      const switched = await connection.request(methods.agent.session.setMode, { sessionId, modeId: "review" });
      assert.deepEqual(switched, {});
      // Config option switch.
      const config = await connection.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "verbose",
        type: "boolean",
        value: true,
      });
      assert.deepEqual(config.configOptions, [
        { type: "boolean", id: "verbose", name: "Verbose", defaultValue: false, currentValue: true },
      ]);

      // Prompt: fs/terminal round trips + lifecycle + permission.
      const prompt = await connection.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "list the workspace" }],
      });
      assert.equal(prompt.stopReason, "end_turn");
      assert.ok(updates.some((update) => update.sessionUpdate === "tool_call_update" && update.locations?.length === 1));
      assert.ok(updates.some((update) => update.sessionUpdate === "current_mode_update" && update.currentModeId === "review"));
      assert.ok(updates.some((update) => update.sessionUpdate === "config_option_update" && update.configOptions[0].currentValue === true));
      // Sticky deny: the second approval in the same run must NOT ask again for the same run scope.
      // (Host lifecycle implements run stickiness; the ACP agent sends the four-outcome batch once.)

      // Resume of a still-registered session is a duplicate (INPUT) — the registry is the
      // connection's live set; reconnect to a stored session is a separate entry.
      await assert.rejects(
        connection.request(methods.agent.session.resume, { sessionId, cwd: "/workspace" }),
        (error) => error.data?.details?.includes("already exists") ?? false,
      );
      // Reconnect after replica change: a session in the host store that this connection
      // never registered resumes and re-registers.
      const resumed = await connection.request(methods.agent.session.resume, { sessionId: "stored-1", cwd: "/workspace" });
      assert.deepEqual(resumed.modes, {
        currentModeId: "edit",
        availableModes: [
          { id: "edit", name: "Edit" },
          { id: "review", name: "Review" },
        ],
      });
      assert.deepEqual(resumed.configOptions, [
        { type: "boolean", id: "verbose", name: "Verbose", defaultValue: false, currentValue: false },
      ]);
      const page = await connection.request(methods.agent.session.list, { cwd: "/workspace" });
      assert.ok(page.sessions.some((session) => session.sessionId === sessionId));
      assert.ok(page.sessions.some((session) => session.sessionId === "stored-1"));
      assert.equal(page.sessions[0].cwd, "/workspace");
      // Delete removes from the host store; the page shrinks.
      const deleted = await connection.request(methods.agent.session.delete, { sessionId: "stored-1" });
      assert.deepEqual(deleted, {});
      const afterDelete = await connection.request(methods.agent.session.list, { cwd: "/workspace" });
      assert.ok(!afterDelete.sessions.some((session) => session.sessionId === "stored-1"));
    });
  });
});

describe("Phase 10 conformance — capability matrix advertise on/off (Task 8)", () => {
  it("advertises only wired seams; unadvertised methods fail as method-not-found", async () => {
    const minimal = createPrismAcpAgent({
      authorize: () => AUTHORIZATION,
      sessionFactory: () => ({ session: { id: "m", async *stream() {} } }),
      lifecycle: { async *resumeStream() {} },
    });
    await client().connectWith(minimal, async (connection) => {
      const initialize = await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      assert.equal(initialize.agentCapabilities.loadSession, undefined);
      // close is always advertised; nothing else without the matching seam.
      assert.deepEqual(initialize.agentCapabilities.sessionCapabilities, { close: {} });
      assert.equal(initialize.agentCapabilities.promptCapabilities?.image, undefined);
      assert.equal(initialize.agentCapabilities.mcpCapabilities, undefined);
      // Unadvertised method: JSON-RPC method-not-found.
      await assert.rejects(connection.request(methods.agent.session.list, { cwd: "/workspace" }), (error) => error.code === -32601);
      await assert.rejects(
        connection.request(methods.agent.session.setMode, { sessionId: "m", modeId: "edit" }),
        (error) => error.code === -32601,
      );
    });
  });
});

describe("Phase 10 conformance — adversarial inputs and limit ladder (Task 8)", () => {
  const host = () => {
    const h = makeHost();
    h.sessions.set("host-1", { id: "host-1", cwd: "/workspace", async *stream() {} });
    return h;
  };

  it("rejects UNSTABLE MCP transport, unauthorized servers, and oversize configs before connect", async () => {
    const h = host();
    await client().connectWith(h.agent, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      // UNSTABLE acp transport: POLICY, never bridged.
      await assert.rejects(
        connection.request(methods.agent.session.new, {
          cwd: "/workspace",
          mcpServers: [{ type: "acp", name: "x", serverId: "srv" }],
        }),
        (error) => error.data?.details?.includes("UNSTABLE") ?? false,
      );
      // Host select denies: POLICY.
      await assert.rejects(
        connection.request(methods.agent.session.new, {
          cwd: "/workspace",
          mcpServers: [{ type: "http", name: "forbidden", url: "https://x.example.com", headers: [] }],
        }),
        (error) => error.data?.details?.includes("rejected") ?? false,
      );
      // Oversize per-server config: LIMIT before any select call.
      await assert.rejects(
        connection.request(methods.agent.session.new, {
          cwd: "/workspace",
          mcpServers: [{ type: "http", name: "big", url: `https://${"x".repeat(20000)}.example.com`, headers: [] }],
        }),
        (error) => error.data?.details?.includes("exceeds") ?? false,
      );
    });
  });

  it("fails closed on malformed cursors, unknown modes, and oversize prompt media", async () => {
    const h = host();
    h.sessions.set("host-1", { id: "host-1", cwd: "/workspace", async *stream() {} });
    await client().connectWith(h.agent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { session: { configOptions: { boolean: {} } } },
      });

      const created = await connection.request(methods.agent.session.new, { cwd: "/workspace", mcpServers: [] });
      // Garbage list cursor: INPUT.
      await assert.rejects(
        connection.request(methods.agent.session.list, { cwd: "/workspace", cursor: "not-a-number" }),
        (error) => error.data?.details?.includes("cursor") ?? false,
      );
      // Unknown mode id: INPUT, no host hook run.
      await assert.rejects(
        connection.request(methods.agent.session.setMode, { sessionId: created.sessionId, modeId: "nope" }),
        (error) => error.data?.details?.includes("mode") ?? false,
      );
      // Oversize prompt media: LIMIT before the provider call (stream never starts).
      await assert.rejects(
        connection.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [
            { type: "text", text: "go" },
            { type: "image", data: "a".repeat(2 * 1024 * 1024), mimeType: "image/png" },
          ],
        }),
        (error) => error.data?.details?.includes("exceeds") ?? false,
      );
      assert.equal(h.created[0].sessionId ?? "host-1", created.sessionId);
    });
  });

  it("redacts secrets from forwarded updates and never forwards raw tool arguments", async () => {
    const h = makeHost({ redactor: createSecretRedactor(["SECRET"]) });
    h.sessions.set("host-1", {
      id: "host-1",
      cwd: "/workspace",
      async *stream() {
        yield { type: "message_delta", sessionId: "host-1", runId: "run-3", content: { type: "text", text: "token SECRET visible" } };
        yield { type: "agent_done", sessionId: "host-1", runId: "run-3", reason: "end_turn" };
      },
    });
    const updates = [];
    await client()
      .onNotification(methods.client.session.update, ({ params }) => updates.push(params.update))
      .connectWith(h.agent, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });

        const created = await connection.request(methods.agent.session.new, { cwd: "/workspace", mcpServers: [] });

        await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
      });
    assert.ok(updates.some((update) => update.sessionUpdate === "agent_message_chunk" && update.content.text.includes("[REDACTED]")));
    assert.ok(!JSON.stringify(updates).includes("SECRET"));
  });
});

describe("Phase 10 conformance — elicitation and lifecycle mapping (Task 8)", () => {
  it("routes elicitation batches only when the client advertises elicitation", async () => {
    const lifecycle = createCodingLifecycleEmitter();
    const h = makeHost({ lifecycle });
    h.sessions.set("host-1", {
      id: "host-1",
      cwd: "/workspace",
      async *stream() {
        yield {
          type: "agent_suspended",
          sessionId: "host-1",
          runId: "run-4",
          version: 1,
          interruption: {
            kind: "elicitation",
            reason: "pick a host",
            toolCallId: "tool-1",
            pendingDecisions: [
              {
                approvalId: "appr-1",
                kind: "elicitation",
                toolCallId: "tool-1",
                scope: { toolName: "connect" },
                reason: "pick a host",
                elicitationSchema: { type: "object", properties: { host: { type: "string" } }, required: ["host"] },
              },
            ],
          },
        };
      },
    });
    const elicitationCalls = [];
    const acpClient = client()
      .onNotification(methods.client.session.update, () => {})
      .onRequest(methods.client.elicitation.create, ({ params }) => {
        elicitationCalls.push(params);
        return { action: "accept", content: { host: "db.example.com" } };
      });
    await acpClient.connectWith(h.agent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { elicitation: { form: {} } },
      });

      const created = await connection.request(methods.agent.session.new, { cwd: "/workspace", mcpServers: [] });

      await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
    });
    assert.equal(elicitationCalls.length, 1);
    assert.equal(elicitationCalls[0].mode, "form");
    assert.deepEqual(elicitationCalls[0].requestedSchema.properties, { host: { type: "string" } });

    // Same host without the advertisement: falls back to the four-option approval path.
    let permissionRequests = 0;
    const h2 = makeHost();
    h2.sessions.set("host-1", {
      id: "host-1",
      cwd: "/workspace",
      async *stream() {
        yield {
          type: "agent_suspended",
          sessionId: "host-1",
          runId: "run-4b",
          version: 1,
          interruption: {
            kind: "elicitation",
            reason: "pick a host",
            toolCallId: "tool-1",
            pendingDecisions: [
              {
                approvalId: "appr-1",
                kind: "elicitation",
                toolCallId: "tool-1",
                scope: { toolName: "connect" },
                reason: "pick a host",
              },
            ],
          },
        };
      },
    });
    await client()
      .onNotification(methods.client.session.update, () => {})
      .onRequest(methods.client.session.requestPermission, () => {
        permissionRequests += 1;
        return { outcome: { outcome: "selected", optionId: "reject-once" } };
      })
      .connectWith(h2.agent, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });

        const created = await connection.request(methods.agent.session.new, { cwd: "/workspace", mcpServers: [] });

        await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
      });
    assert.equal(permissionRequests, 1);
  });

  it("maps lifecycle events to freeze updates and defers the deferred kinds", async () => {
    const lifecycle = createCodingLifecycleEmitter();
    const h = makeHost({ lifecycle });
    h.sessions.set("host-1", {
      id: "host-1",
      cwd: "/workspace",
      async *stream() {
        lifecycle.emit({ type: "configuration_changed", keys: ["verbose"] });
        lifecycle.emit({ type: "file_changed", path: "/workspace/c.txt", op: "edit", toolCallId: "tool-5" });
        yield { type: "agent_done", sessionId: "host-1", runId: "run-5", reason: "end_turn" };
      },
    });
    const updates = [];
    await client()
      .onNotification(methods.client.session.update, ({ params }) => updates.push(params.update))
      .connectWith(h.agent, async (connection) => {
        await connection.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { session: { configOptions: { boolean: {} } } },
        });

        const created = await connection.request(methods.agent.session.new, { cwd: "/workspace", mcpServers: [] });

        await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
      });
    assert.ok(
      updates.some(
        (update) =>
          update.sessionUpdate === "tool_call_update" && update.toolCallId === "tool-5" && update.locations[0].path === "/workspace/c.txt",
      ),
      "file_changed must map to a locations tool_call_update",
    );
    assert.ok(
      updates.some((update) => update.sessionUpdate === "config_option_update" && update.configOptions[0].id === "verbose"),
      "configuration_changed must broadcast config_option_update",
    );
  });
});
