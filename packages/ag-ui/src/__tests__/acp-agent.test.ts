import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  type AgentLoopStrategy,
  type AgentRunLifecycle,
  type AgentRunRef,
  type AgentSession,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import packageJson from "../../package.json" with { type: "json" };
import { createPrismAcpAgent } from "../acp/index.js";

const authorization = { ownership: { userId: "user-1" } };

describe("createPrismAcpAgent", () => {
  it("exports only stable ACP sibling API", async () => {
    const exports = await import("@arnilo/prism-ag-ui/acp");
    assert.equal(typeof exports.createAcpEventMapper, "function");
    assert.equal(typeof exports.createPrismAcpAgent, "function");
    assert.equal("experimental" in exports, false);
  });

  it("initialize advertises wired seams truthfully and the package version", async () => {
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "x", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      sessions: { list: () => [{ sessionId: "s1", cwd: "/w" }] },
      mcp: { select: () => true, transports: ["sse"] },
      capabilities: { prompt: { embedded: () => true } },
    });
    const acpClient = client();
    await acpClient.connectWith(acpAgent, async (connection) => {
      const initialized = await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true }, terminal: true },
      });
      assert.equal(initialized.protocolVersion, PROTOCOL_VERSION);
      assert.deepEqual(initialized.agentCapabilities, {
        sessionCapabilities: { close: {}, list: {} },
        mcpCapabilities: { sse: true },
        promptCapabilities: { embeddedContext: true },
      });
      assert.deepEqual(initialized.agentInfo, { name: "Prism", version: packageJson.version });
    });
  });

  it("uses stable ACP builders to stream Prism output and resume one durable approval", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let writes = 0;
    let turn = 0;
    const updates: SessionNotification[] = [];
    const permissions: RequestPermissionRequest[] = [];
    let authorizations = 0;
    const prismAgent = createAgent({
      id: "approval-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) yield { type: "tool_call" as const, call: toolCallContent("write-1", "write", { path: "/host/secret.txt" }) };
          else yield providerTextDelta("resumed");
          yield providerDone();
        },
      },
      tools: [
        { name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "write-1", name: "write", value: ++writes }) },
      ],
    });
    const acpAgent = createPrismAcpAgent({
      authorize: () => {
        authorizations += 1;
        return authorization;
      },
      sessionFactory: () => ({ session: prismAgent.createSession({ id: "acp-session" }), agentId: "approval-agent" }),
      lifecycle: createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: prismAgent, definitionRevision: "1" }) }),
    });
    const acpClient = client({ name: "test-client" })
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params);
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        permissions.push(params);
        return { outcome: { outcome: "selected", optionId: "allow-once" } };
      });

    await acpClient.connectWith(acpAgent, async (connection) => {
      const initialized = await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      assert.equal(initialized.agentCapabilities?.sessionCapabilities?.close !== undefined, true);
      const created = await connection.request(methods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
      const result = await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "go" }],
      });
      assert.equal(result.stopReason, "end_turn");
      await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
    });

    assert.equal(writes, 1);
    assert.equal(authorizations, 3);
    assert.equal(permissions.length, 1);
    assert.deepEqual(
      permissions[0]?.options.map((option) => option.kind),
      ["allow_once", "allow_always", "reject_once", "reject_always"],
    );
    assert.ok(
      updates.some(
        ({ update }) =>
          update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" && update.content.text === "resumed",
      ),
    );
    assert.ok(updates.some(({ update }) => update.sessionUpdate === "tool_call" && update.title === "Approval required"));
    assert.doesNotMatch(JSON.stringify({ updates, permissions }), /\/host|rawInput|rawOutput|locations/);
  });

  it("bounds ACP updates before sending an unbounded stream", async () => {
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: "bounded",
          async *stream() {
            yield { type: "message_delta", sessionId: "bounded", runId: "run", content: { type: "text", text: "one" } };
            yield { type: "message_delta", sessionId: "bounded", runId: "run", content: { type: "text", text: "two" } };
          },
        } as unknown as AgentSession,
      }),
      lifecycle: {} as AgentRunLifecycle,
      limits: { maxStreamEvents: 1 },
    });
    const acpClient = client().onNotification(methods.client.session.update, () => {});
    await acpClient.connectWith(acpAgent, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
      await assert.rejects(
        connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] }),
      );
    });
  });

  it("maps core finish reasons onto the SDK StopReason set (F4)", async () => {
    const promptStopReason = async (config: Parameters<typeof createAgent>[0]): Promise<string> => {
      const acpAgent = createPrismAcpAgent({
        authorize: () => authorization,
        lifecycle: {} as AgentRunLifecycle,
        sessionFactory: () => ({
          session: createAgent(config).createSession({ id: "acp-f4" }),
          agentId: "f4-agent",
        }),
      });
      const acpClient = client();
      let stopReason = "";
      await acpClient.connectWith(acpAgent, async (connection) => {
        const created = await connection.request(methods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
        const result = await connection.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: "go" }],
        });
        stopReason = result.stopReason;
      });
      return stopReason;
    };
    const base = {
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield providerDone();
        },
      },
    };
    // Natural end.
    assert.equal(await promptStopReason(base), "end_turn");
    // Tool-round ceiling ends the run cleanly (real loop path).
    assert.equal(
      await promptStopReason({
        ...base,
        limits: { maxToolRounds: 1 },
        provider: {
          id: "mock",
          async *generate() {
            yield { type: "tool_call" as const, call: toolCallContent("f4-call", "echo", {}) };
            yield providerDone();
          },
        },
        tools: [{ name: "echo", parameters: { type: "object" }, execute: () => ({ toolCallId: "f4-call", name: "echo", value: {} }) }],
      }),
      "max_turn_requests",
    );
    // Other finish reasons map through the same field (no core producer yet for these).
    for (const [finishReason, expected] of [
      ["token_limit", "max_tokens"],
      ["refusal", "refusal"],
    ] as const) {
      assert.equal(
        await promptStopReason({
          ...base,
          loop: {
            name: `stop-${finishReason}`,
            run: async (ctx) => {
              ctx.finishReason = finishReason;
            },
          } satisfies AgentLoopStrategy,
        }),
        expected,
      );
    }
  });

  it("denies reject, cancelled, and unknown permission outcomes", async () => {
    const decisions: string[] = [];
    let sessionNumber = 0;
    const lifecycle = {
      async *resumeStream(_ref: unknown, resume: { decision: string }) {
        decisions.push(resume.decision);
        yield {
          type: "agent_denied",
          sessionId: "fake",
          runId: "run",
          interruption: { kind: "tool_approval", reason: "approval" },
          version: 1,
        };
      },
    } as unknown as AgentRunLifecycle;
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: `fake-${++sessionNumber}`,
          async *stream() {
            yield {
              type: "agent_suspended",
              sessionId: `fake-${sessionNumber}`,
              runId: "run",
              interruption: { kind: "tool_approval", reason: "approval", toolCallId: "tool" },
              version: 1,
            };
          },
        } as unknown as AgentSession,
      }),
      lifecycle,
    });
    const outcomes: RequestPermissionResponse[] = [
      { outcome: { outcome: "selected", optionId: "reject-once" } },
      { outcome: { outcome: "cancelled" } },
      { outcome: { outcome: "selected", optionId: "future" } },
    ];
    const acpClient = client()
      .onNotification(methods.client.session.update, () => {})
      .onRequest(methods.client.session.requestPermission, () => outcomes.shift()!);

    await acpClient.connectWith(acpAgent, async (connection) => {
      for (let index = 0; index < 3; index += 1) {
        const created = await connection.request(methods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
        await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
        await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
      }
    });
    assert.deepEqual(decisions, ["deny", "deny", "deny"]);
  });
});

it("maps the four ACP outcomes onto the shared decision batch without widening scope", async () => {
  const checkpoints = createMemoryCheckpointStore();
  let writes = 0;
  let turn = 0;
  const prismAgent = createAgent({
    id: "batch-approval-agent",
    model: { provider: "mock", model: "mock" },
    store: createMemorySessionStore(),
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    provider: {
      id: "mock",
      async *generate() {
        if (++turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("write-1", "write", { value: 1 }) };
          yield { type: "tool_call" as const, call: toolCallContent("write-2", "write", { value: 2 }) };
        } else {
          yield providerTextDelta("resumed");
        }
        yield providerDone();
      },
    },
    tools: [{ name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "write-1", name: "write", value: ++writes }) }],
  });
  const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: prismAgent, definitionRevision: "1" }) });
  let receivedDecisions: readonly { approvalId: string; outcome: string }[] | undefined;
  const acpAgent = createPrismAcpAgent({
    authorize: () => authorization,
    sessionFactory: () => ({ session: prismAgent.createSession({ id: "batch-acp-session" }), agentId: "batch-approval-agent" }),
    lifecycle: {
      ...lifecycle,
      resumeStream: ((ref: AgentRunRef, resume: { decisions?: readonly { approvalId: string; outcome: string }[] }, options: unknown) => {
        receivedDecisions = resume.decisions;
        return lifecycle.resumeStream(ref, resume as never, options as never);
      }) as never,
    },
  });
  let permissions: RequestPermissionRequest | undefined;
  const acpClient = client({ name: "test-client" }).onRequest(methods.client.session.requestPermission, ({ params }) => {
    permissions = params;
    return { outcome: { outcome: "selected", optionId: "allow-for-run" } };
  });

  await acpClient.connectWith(acpAgent, async (connection) => {
    await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
    const created = await connection.request(methods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
    await connection.request(methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "go" }],
    });
    await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
  });

  assert.equal(permissions?.options.length, 4);
  assert.equal(receivedDecisions?.length, 2);
  assert.deepEqual(
    receivedDecisions?.map((decision) => decision.outcome),
    ["allow_for_run", "allow_for_run"],
  );
  assert.equal(writes, 2);
});

it("B2: a run-level error rejects session/prompt with ERR_PRISM_ACP_RUN and never emits a fake error chunk", async () => {
  const updates: SessionNotification[] = [];
  const acpAgent = createPrismAcpAgent({
    authorize: () => authorization,
    sessionFactory: () => ({
      session: {
        id: "failing",
        async *stream() {
          yield { type: "error", sessionId: "failing", runId: "run", error: { message: "SECRET exploded" } };
        },
      } as unknown as AgentSession,
    }),
    lifecycle: {} as AgentRunLifecycle,
    redactor: createSecretRedactor(["SECRET"]),
  });
  const acpClient = client().onNotification(methods.client.session.update, ({ params }) => {
    updates.push(params);
  });
  await acpClient.connectWith(acpAgent, async (connection) => {
    const created = await connection.request(methods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
    await assert.rejects(
      connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] }),
      (error: unknown) => {
        const text = JSON.stringify(error);
        assert.match(text, /ERR_PRISM_ACP_RUN/);
        assert.doesNotMatch(text, /SECRET/);
        return true;
      },
    );
    // No fake "Agent error:" transcript chunk ever reaches the client.
    assert.equal(updates.length, 0);
  });

  it("F2: session/load replays bounded, redacted user/assistant chunks only when the transcript seam is wired", async () => {
    const updates: SessionNotification[] = [];
    const transcript: SessionEntry[] = [
      {
        id: "e1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00.000Z",
        kind: "message",
        message: { id: "m1", role: "user", content: [{ type: "text", text: "hello SECRET" }] },
      },
      {
        id: "e2",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        kind: "message",
        message: {
          id: "m2",
          role: "assistant",
          content: [
            { type: "text", text: "hi" },
            { type: "thinking", text: "hmm" },
          ],
        },
      },
      {
        id: "e3",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:02.000Z",
        kind: "event",
        event: { type: "tool_execution_started", sessionId: "s1", runId: "r", call: toolCallContent("t1", "read", {}) },
      },
      {
        id: "e4",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:03.000Z",
        kind: "message",
        message: { id: "m4", role: "system", content: [{ type: "text", text: "sys" }] },
      },
    ];
    const withSeam = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      redactor: createSecretRedactor(["SECRET"]),
      sessions: {
        load: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
        resume: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
        transcript: ({ sessionId }) => (sessionId === "s1" ? transcript : []),
      },
    });
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params);
      })
      .connectWith(withSeam, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        await connection.request(methods.agent.session.load, { sessionId: "s1", cwd: "/w", mcpServers: [] });
        await connection.request(methods.agent.session.close, { sessionId: "s1" });
        // session/resume replays through the same seam before the run resumes.
        await connection.request(methods.agent.session.resume, { sessionId: "s1", cwd: "/w" });
      });
    assert.deepEqual(
      updates.map(({ update }) => [update.sessionUpdate, (update as { content: { type: string; text: string } }).content.text]),
      [
        ["user_message_chunk", "hello [REDACTED]"],
        ["agent_message_chunk", "hi"],
        ["user_message_chunk", "hello [REDACTED]"],
        ["agent_message_chunk", "hi"],
      ],
    );
    assert.equal((updates[0]!.update as { messageId: string }).messageId, "m1");

    // Without the seam: load succeeds but emits nothing.
    const withoutSeam = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      sessions: { load: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }) },
    });
    const silent: SessionNotification[] = [];
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        silent.push(params);
      })
      .connectWith(withoutSeam, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        await connection.request(methods.agent.session.load, { sessionId: "s1", cwd: "/w", mcpServers: [] });
      });
    assert.equal(silent.length, 0);
  });

  it("F2: transcript replay truncates oversize chunks and stops at maxReplayEvents", async () => {
    const updates: SessionNotification[] = [];
    const transcript: SessionEntry[] = Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`,
      sessionId: "s1",
      timestamp: `2026-01-01T00:00:0${i}.000Z`,
      kind: "message" as const,
      message: {
        id: `m${i}`,
        role: "user" as const,
        content: [{ type: "text", text: `chunk-${i}-${"x".repeat(64)}` }],
      },
    }));
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      limits: { maxTextBytes: 16, maxReplayEvents: 3 },
      sessions: {
        load: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
        transcript: () => transcript,
      },
    });
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params);
      })
      .connectWith(acpAgent, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        await connection.request(methods.agent.session.load, { sessionId: "s1", cwd: "/w", mcpServers: [] });
      });
    assert.equal(updates.length, 3);
    for (const { update } of updates) {
      const text = (update as { content: { type: string; text: string } }).content.text;
      assert.ok(text.length <= 16, `chunk not truncated: ${text}`);
    }
    assert.match((updates[0]!.update as { content: { type: string; text: string } }).content.text, /^chunk-0-/);
  });

  it("F6: the title seam emits session_info_update on change (redacted and capped)", async () => {
    const updates: SessionNotification[] = [];
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: "s1",
          async *stream() {
            yield { type: "message_delta", sessionId: "s1", runId: "r", content: { type: "text", text: "done" } };
          },
        } as unknown as AgentSession,
      }),
      lifecycle: {} as AgentRunLifecycle,
      redactor: createSecretRedactor(["SECRET"]),
      limits: { maxTextBytes: 16 },
      sessions: {
        title: ({ prompt }) => {
          const text = prompt?.find((block) => block.type === "text" && "text" in block) as { text: string } | undefined;
          return text ? `Fix login SECRET ${text.text}` : undefined;
        },
      },
    });
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params);
      })
      .connectWith(acpAgent, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
        await connection.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: "go" }],
        });
      });
    const titles = updates
      .filter(({ update }) => update.sessionUpdate === "session_info_update")
      .map(({ update }) => (update as { title?: string }).title);
    assert.equal(titles.length, 1, "one session_info_update for the changed title");
    assert.ok(titles[0]!.length <= 16, "title is byte-capped");
    assert.doesNotMatch(titles[0]!, /SECRET/, "title is redacted");
  });

  it("F6: no title seam means no session_info_update, and list passes title/updatedAt through", async () => {
    const updates: SessionNotification[] = [];
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      sessions: {
        list: () => [
          { sessionId: "s1", cwd: "/w", title: "Durable plan", updatedAt: "2026-08-18T00:00:00.000Z" },
          { sessionId: "s2", cwd: "/w", additionalDirectories: ["/w/vendor"] },
        ],
      },
    });
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params);
      })
      .connectWith(acpAgent, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
        await connection.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: "go" }],
        });
        const listed = await connection.request(methods.agent.session.list, {});
        const first = listed.sessions.find((entry) => entry.sessionId === "s1");
        assert.equal(first?.title, "Durable plan");
        assert.equal(first?.updatedAt, "2026-08-18T00:00:00.000Z");
        const second = listed.sessions.find((entry) => entry.sessionId === "s2");
        assert.deepEqual(second?.additionalDirectories, ["/w/vendor"]);
      });
    assert.equal(updates.filter(({ update }) => update.sessionUpdate === "session_info_update").length, 0);
  });

  it("F6: title seam throws are best-effort and never fail the prompt", async () => {
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: "s1",
          async *stream() {
            yield { type: "message_delta", sessionId: "s1", runId: "r", content: { type: "text", text: "done" } };
          },
        } as unknown as AgentSession,
      }),
      lifecycle: {} as AgentRunLifecycle,
      sessions: { title: () => Promise.reject(new Error("store down")) },
    });
    await client().connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      const result = await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "go" }],
      });
      assert.ok(result.stopReason);
    });
  });

  it("F9: commands seam emits available_commands_update on session/new; absent seam emits nothing", async () => {
    const updates: SessionNotification[] = [];
    const withSeam = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      redactor: createSecretRedactor(["SECRET"]),
      commands: {
        list: () => [
          { name: "/review", description: "Review SECRET" },
          { name: "/ask", description: "Ask", input: { hint: "topic SECRET" } },
        ],
      },
    });
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params);
      })
      .connectWith(withSeam, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      });
    assert.deepEqual(
      updates.map(({ update }) => update),
      [
        {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "/review", description: "Review [REDACTED]" },
            { name: "/ask", description: "Ask", input: { hint: "topic [REDACTED]" } },
          ],
        },
      ],
    );

    const silent: SessionNotification[] = [];
    const without = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "s2", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
    });
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        silent.push(params);
      })
      .connectWith(without, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      });
    assert.equal(silent.length, 0);
  });

  it("F9: available_commands_update is sliced at acpCommandsPerUpdate", async () => {
    const updates: SessionNotification[] = [];
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "s1", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      limits: { acpCommandsPerUpdate: 2 },
      commands: {
        list: () => [
          { name: "/a", description: "A" },
          { name: "/b", description: "B" },
          { name: "/c", description: "C" },
        ],
      },
    });
    await client()
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params);
      })
      .connectWith(acpAgent, async (connection) => {
        await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
        await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      });
    const update = updates[0]?.update;
    assert.equal(update?.sessionUpdate, "available_commands_update");
    assert.deepEqual(update && "availableCommands" in update ? update.availableCommands.map((c) => c.name) : [], ["/a", "/b"]);
  });
});
