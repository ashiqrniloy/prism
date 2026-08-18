/**
 * Phase 10 Task 7 — coding lifecycle -> ACP updates, permission parity lock,
 * and elicitation. Lifecycle mapping fixtures follow the freeze
 * lifecycleEventMapping table. Permission parity (four-outcome batch, cancel
 * deny, sticky) is already locked by acp-agent.test.ts; this file adds the
 * lifecycle fixtures, the agent wiring, and the elicitation flow.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentSession } from "@arnilo/prism";
import { createSecretRedactor } from "@arnilo/prism";
import { createCodingLifecycleEmitter } from "@arnilo/prism-coding-agent";
import { createAcpLifecycleMapper, createPrismAcpAgent } from "../acp/index.js";

const authorization = { ownership: { userId: "user-1" } };

describe("createAcpLifecycleMapper (freeze lifecycleEventMapping)", () => {
  const fileChanged = (toolCallId?: string) => ({
    type: "file_changed" as const,
    path: "/workspace/src/a.ts",
    op: "edit" as const,
    ...(toolCallId ? { toolCallId } : {}),
  });
  const processEvent = (type: "process_started" | "process_exited" | "process_killed") => ({
    type,
    sessionId: "ps-1",
    processId: "proc-1",
    owner: "user-1",
    at: "2026-08-07T00:00:00.000Z",
    ...(type === "process_exited" ? { exitCode: 0 } : {}),
  });

  it("maps file_changed to a locations-only tool_call_update; drops without toolCallId", async () => {
    const mapper = createAcpLifecycleMapper();
    const output = await mapper.map(fileChanged("tool-1"));
    assert.deepEqual(output, [{ sessionUpdate: "tool_call_update", toolCallId: "tool-1", locations: [{ path: "/workspace/src/a.ts" }] }]);
    assert.deepEqual(await mapper.map(fileChanged()), []);
  });

  it("attaches a redacted, byte-capped diff only from the fileDiff allow-list", async () => {
    const mapper = createAcpLifecycleMapper({
      redactor: createSecretRedactor(["TOKEN"]),
      projection: { fileDiff: () => ({ path: "/workspace/src/a.ts", oldText: "old TOKEN", newText: "new TOKEN" }) },
    });
    const output = await mapper.map(fileChanged("tool-1"));
    const update = output[0] as { content: Array<{ type: string; path?: string; oldText?: string; newText?: string }> };
    assert.deepEqual(update.content, [{ type: "diff", path: "/workspace/src/a.ts", oldText: "old [REDACTED]", newText: "new [REDACTED]" }]);

    const capped = createAcpLifecycleMapper({
      limits: { acpDiffBytes: 1024 },
      projection: { fileDiff: () => ({ path: "/x.ts", newText: "y".repeat(5000) }) },
    });
    const oversized = await capped.map(fileChanged("tool-1"));
    assert.equal((oversized[0] as { content?: unknown }).content, undefined);
  });

  it("maps worktree and process events only through the projection allow-list", async () => {
    const mapper = createAcpLifecycleMapper();
    assert.deepEqual(await mapper.map({ type: "worktree_changed", action: "add", path: "/workspace" }), []);
    assert.deepEqual(await mapper.map(processEvent("process_started")), []);

    const projected = createAcpLifecycleMapper({ projection: { lifecycle: (event) => `saw ${event.type}` } });
    assert.deepEqual(await projected.map({ type: "worktree_changed", action: "add", path: "/workspace" }), [
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "prism:worktree:/workspace",
        content: { type: "text", text: "saw worktree_changed" },
      },
    ]);
    assert.deepEqual(await projected.map(processEvent("process_exited")), [
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "prism:process:ps-1:proc-1",
        content: { type: "text", text: "saw process_exited" },
      },
    ]);
  });

  it("maps permission_denied to a failed update without raw args; drops when untargetable", async () => {
    const mapper = createAcpLifecycleMapper();
    assert.deepEqual(await mapper.map({ type: "permission_denied", reason: "policy", toolName: "write", toolCallId: "tool-1" }), [
      { sessionUpdate: "tool_call_update", toolCallId: "tool-1", title: "write", status: "failed" },
    ]);
    assert.deepEqual(await mapper.map({ type: "permission_denied", reason: "policy", toolName: "write", approvalId: "appr-1" }), [
      { sessionUpdate: "tool_call_update", toolCallId: "prism:denied:appr-1", title: "write", status: "failed" },
    ]);
    assert.deepEqual(await mapper.map({ type: "permission_denied", reason: "policy", toolName: "write" }), []);
  });

  it("leaves configuration_changed to the agent wiring (mapper returns nothing)", async () => {
    const mapper = createAcpLifecycleMapper();
    assert.deepEqual(await mapper.map({ type: "configuration_changed", keys: ["verbose"] }), []);
  });

  it("maps plan_changed to a complete plan_update and plan_removed to plan_removed (F5)", async () => {
    const mapper = createAcpLifecycleMapper();
    assert.deepEqual(
      await mapper.map({
        type: "plan_changed",
        planPath: "plans/task-1.md",
        todos: [
          { id: "a", text: "Write plan", done: true },
          { id: "b", text: "Verify", done: false },
        ],
      }),
      [
        {
          sessionUpdate: "plan_update",
          plan: {
            type: "items",
            planId: "plans/task-1.md",
            entries: [
              { content: "Write plan", priority: "medium", status: "completed" },
              { content: "Verify", priority: "medium", status: "pending" },
            ],
          },
        },
      ],
    );
    assert.deepEqual(await mapper.map({ type: "plan_removed", planPath: "plans/task-1.md" }), [
      { sessionUpdate: "plan_removed", planId: "plans/task-1.md" },
    ]);
  });

  it("redacts and byte-caps plan entries (F5)", async () => {
    const mapper = createAcpLifecycleMapper({ redactor: createSecretRedactor(["TOKEN"]) });
    const output = await mapper.map({
      type: "plan_changed",
      planPath: "plans/secret.md",
      todos: [{ id: "a", text: "do TOKEN", done: false }],
    });
    const update = output[0] as { plan: { planId: string; entries: Array<{ content: string }> } };
    assert.equal(update.plan.planId, "plans/secret.md");
    assert.equal(update.plan.entries[0]?.content, "do [REDACTED]");

    const capped = createAcpLifecycleMapper({ limits: { maxTextBytes: 16 } });
    const output2 = await capped.map({
      type: "plan_changed",
      planPath: "p.md",
      todos: [{ id: "a", text: "x".repeat(200), done: false }],
    });
    const entry = (output2[0] as { plan: { entries: Array<{ content: string }> } }).plan.entries[0]!;
    assert.ok(entry.content.length <= 16, "plan entry text is byte-capped");
  });
});

describe("ACP lifecycle wiring (Task 7)", () => {
  it("forwards file_changed to the streaming session's client", async () => {
    const emitter = createCodingLifecycleEmitter();
    const updates: Array<{ sessionUpdate: string; locations?: unknown }> = [];
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: "lifecycle-session",
          async *stream() {
            emitter.emit({ type: "file_changed", path: "/workspace/src/a.ts", op: "edit", toolCallId: "tool-1" });
            yield { type: "message_delta", sessionId: "lifecycle-session", runId: "run", content: { type: "text", text: "done" } };
          },
        } as unknown as AgentSession,
      }),
      lifecycle: {} as AgentRunLifecycle,
      coding: { lifecycle: emitter },
    });
    const acpClient = client().onNotification(methods.client.session.update, ({ params }) => {
      if (params.update.sessionUpdate === "tool_call_update") updates.push(params.update as never);
    });
    await acpClient.connectWith(acpAgent, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
    });
    assert.deepEqual(updates, [{ sessionUpdate: "tool_call_update", toolCallId: "tool-1", locations: [{ path: "/workspace/src/a.ts" }] }]);
  });

  it("emits plan updates only to clients that advertised the UNSTABLE plan capability (F5)", async () => {
    for (const advertise of [false, true]) {
      const emitter = createCodingLifecycleEmitter();
      const updates: Array<{ sessionUpdate: string }> = [];
      const acpAgent = createPrismAcpAgent({
        authorize: () => authorization,
        sessionFactory: () => ({
          session: {
            id: "plan-session",
            async *stream() {
              emitter.emit({ type: "plan_changed", planPath: "plans/task-1.md", todos: [{ id: "a", text: "go", done: false }] });
              emitter.emit({ type: "plan_removed", planPath: "plans/task-1.md" });
              yield { type: "message_delta", sessionId: "plan-session", runId: "run", content: { type: "text", text: "done" } };
            },
          } as unknown as AgentSession,
        }),
        lifecycle: {} as AgentRunLifecycle,
        coding: { lifecycle: emitter },
      });
      const acpClient = client().onNotification(methods.client.session.update, ({ params }) => {
        if (params.update.sessionUpdate === "plan_update" || params.update.sessionUpdate === "plan_removed") {
          updates.push(params.update as never);
        }
      });
      await acpClient.connectWith(acpAgent, async (connection) => {
        await connection.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: advertise ? { plan: {} } : {},
        });
        const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
        await connection.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: "go" }],
        });
      });
      if (advertise) {
        assert.deepEqual(
          updates.map((update) => update.sessionUpdate),
          ["plan_update", "plan_removed"],
        );
      } else {
        assert.deepEqual(updates, [], "no plan updates without the UNSTABLE advertisement");
      }
    }
  });

  it("broadcasts configuration_changed as config_option_update with the full per-session set", async () => {
    const emitter = createCodingLifecycleEmitter();
    const updates: Array<{ sessionUpdate: string; configOptions?: Array<{ id: string; currentValue: unknown }> }> = [];
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: "config-session",
          async *stream() {
            emitter.emit({ type: "configuration_changed", keys: ["verbose"] });
            yield { type: "message_delta", sessionId: "config-session", runId: "run", content: { type: "text", text: "done" } };
          },
        } as unknown as AgentSession,
      }),
      lifecycle: {} as AgentRunLifecycle,
      coding: { lifecycle: emitter },
      configOptions: { options: [{ type: "boolean", id: "verbose", name: "Verbose", defaultValue: false }] },
    });
    const acpClient = client().onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update as never);
    });
    await acpClient.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { session: { configOptions: { boolean: {} } } },
      });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
    });
    const config = updates.find((update) => update.sessionUpdate === "config_option_update");
    assert.ok(config, "expected a config_option_update");
    // Wire shape: the SDK notify path zod-strips fields that are not in SessionConfigOption
    // (defaultValue is not a wire field; it survives only on request responses).
    assert.deepEqual(config.configOptions, [{ type: "boolean", id: "verbose", name: "Verbose", currentValue: false }]);
  });

  it("omits unprojected worktree/process events (deny by default)", async () => {
    const emitter = createCodingLifecycleEmitter();
    let notifications = 0;
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: "quiet-session",
          async *stream() {
            emitter.emit({ type: "worktree_changed", action: "add", path: "/workspace" });
            emitter.emit({ type: "process_started", sessionId: "ps", processId: "p", owner: "u", at: "now" });
            yield { type: "message_delta", sessionId: "quiet-session", runId: "run", content: { type: "text", text: "done" } };
          },
        } as unknown as AgentSession,
      }),
      lifecycle: {} as AgentRunLifecycle,
      coding: { lifecycle: emitter },
    });
    const acpClient = client().onNotification(methods.client.session.update, () => {
      notifications += 1;
    });
    await acpClient.connectWith(acpAgent, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
    });
    assert.equal(notifications, 1); // only the message_delta
  });
});

describe("ACP elicitation (Task 7)", () => {
  const suspension = {
    type: "agent_suspended" as const,
    sessionId: "elicit-session",
    runId: "run",
    interruption: {
      kind: "elicitation" as const,
      reason: "Provide the connection details",
      toolCallId: "tool-1",
      pendingDecisions: [
        {
          approvalId: "appr-1",
          kind: "elicitation",
          toolCallId: "tool-1",
          scope: { toolName: "connect" },
          reason: "Provide the connection details",
          elicitationSchema: {
            type: "object",
            properties: { host: { type: "string" }, port: { type: "number" } },
            required: ["host"],
          },
        },
      ],
    },
    version: 1,
  };

  function agentWith(): {
    app: ReturnType<typeof createPrismAcpAgent>;
    resumed: unknown[];
    elicitationRequests: unknown[];
    permissionRequests: unknown[];
  } {
    const resumed: unknown[] = [];
    const elicitationRequests: unknown[] = [];
    const permissionRequests: unknown[] = [];
    const lifecycle = {
      async *resumeStream(_ref: unknown, resume: unknown) {
        resumed.push(resume);
        yield { type: "agent_denied", sessionId: "elicit-session", runId: "run", interruption: { kind: "elicitation" }, version: 1 };
      },
    } as unknown as AgentRunLifecycle;
    const app = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: "elicit-session",
          async *stream() {
            yield suspension as never;
          },
        } as unknown as AgentSession,
      }),
      lifecycle,
    });
    return { app, resumed, elicitationRequests, permissionRequests };
  }

  it("surfaces an elicitation decision via elicitation/create when the client advertises it", async () => {
    const { app, resumed } = agentWith();
    const acpClient = client()
      .onNotification(methods.client.session.update, () => {})
      .onRequest(methods.client.elicitation.create, ({ params }) => {
        const request = params as {
          mode?: string;
          sessionId?: string;
          toolCallId?: string;
          message?: string;
          requestedSchema?: { properties?: unknown };
        };
        assert.equal(request.mode, "form");
        assert.equal(request.sessionId, "elicit-session");
        assert.equal(request.toolCallId, "tool-1");
        assert.equal(request.message, "Provide the connection details");
        assert.deepEqual(request.requestedSchema?.properties, { host: { type: "string" }, port: { type: "number" } });
        return { action: "accept", content: { host: "db.example.com", port: 5432 } };
      });
    await acpClient.connectWith(app, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { elicitation: { form: {} } },
      });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
    });
    const decision = (resumed[0] as { decisions: Array<{ approvalId: string; outcome: string; elicitation?: unknown }> }).decisions;
    assert.deepEqual(decision, [{ approvalId: "appr-1", outcome: "allow_once", elicitation: { host: "db.example.com", port: 5432 } }]);
  });

  it("denies on decline and cancel, and never calls requestPermission for elicitations", async () => {
    for (const action of ["decline", "cancel"] as const) {
      const { app, resumed, permissionRequests } = agentWith();
      const acpClient = client()
        .onNotification(methods.client.session.update, () => {})
        .onRequest(methods.client.elicitation.create, () => ({ action }));
      await acpClient.connectWith(app, async (connection) => {
        await connection.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { elicitation: { form: {} } },
        });
        const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
        await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
      });
      assert.deepEqual((resumed[0] as { decisions: Array<{ approvalId: string; outcome: string }> }).decisions, [
        { approvalId: "appr-1", outcome: "reject_once" },
      ]);
      assert.equal(permissionRequests.length, 0);
    }
  });

  it("stays on the shared approval path when the client does not advertise elicitation", async () => {
    const { app } = agentWith();
    let permissionOptions: unknown;
    const acpClient = client()
      .onNotification(methods.client.session.update, () => {})
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        permissionOptions = params.options;
        return { outcome: { outcome: "selected", optionId: "reject-once" } };
      });
    await acpClient.connectWith(app, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
    });
    assert.equal((permissionOptions as Array<{ kind: string }>).length, 4);
    assert.equal((permissionOptions as Array<{ kind: string }>)[0]!.kind, "allow_once");
  });

  it("fails closed when the client rejects the elicitation create call", async () => {
    const { app, resumed } = agentWith();
    const acpClient = client()
      .onNotification(methods.client.session.update, () => {})
      .onRequest(methods.client.elicitation.create, () => {
        throw new Error("client refused");
      });
    await acpClient.connectWith(app, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { elicitation: { form: {} } },
      });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
    });
    assert.deepEqual((resumed[0] as { decisions: Array<{ approvalId: string; outcome: string }> }).decisions, [
      { approvalId: "appr-1", outcome: "reject_once" },
    ]);
  });
});
