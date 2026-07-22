import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, methods, PROTOCOL_VERSION, type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification } from "@agentclientprotocol/sdk";
import { createAgent, createAgentRunLifecycle, createMemoryCheckpointStore, createMemorySessionStore, providerDone, providerTextDelta, toolCallContent, type AgentRunLifecycle, type AgentSession } from "@arnilo/prism";
import { createPrismAcpAgent } from "../acp/index.js";

const authorization = { ownership: { userId: "user-1" } };

describe("createPrismAcpAgent", () => {
  it("exports only stable ACP sibling API", async () => {
    const exports = await import("@arnilo/prism-ag-ui/acp");
    assert.equal(typeof exports.createAcpEventMapper, "function");
    assert.equal(typeof exports.createPrismAcpAgent, "function");
    assert.equal("experimental" in exports, false);
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
      tools: [{ name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "write-1", name: "write", value: ++writes }) }],
    });
    const acpAgent = createPrismAcpAgent({
      authorize: () => { authorizations += 1; return authorization; },
      sessionFactory: () => ({ session: prismAgent.createSession({ id: "acp-session" }), agentId: "approval-agent" }),
      lifecycle: createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: prismAgent, definitionRevision: "1" }) }),
    });
    const acpClient = client({ name: "test-client" })
      .onNotification(methods.client.session.update, ({ params }) => { updates.push(params); })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        permissions.push(params);
        return { outcome: { outcome: "selected", optionId: "allow-once" } };
      });

    await acpClient.connectWith(acpAgent, async (connection) => {
      const initialized = await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      assert.equal(initialized.agentCapabilities?.sessionCapabilities?.close !== undefined, true);
      const created = await connection.request(methods.agent.session.new, { cwd: "/ignored", mcpServers: [] });
      const result = await connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });
      assert.equal(result.stopReason, "end_turn");
      await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
    });

    assert.equal(writes, 1);
    assert.equal(authorizations, 3);
    assert.equal(permissions.length, 1);
    assert.deepEqual(permissions[0]?.options.map((option) => option.kind), ["allow_once", "reject_once"]);
    assert.ok(updates.some(({ update }) => update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" && update.content.text === "resumed"));
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
      await assert.rejects(connection.request(methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] }));
    });
  });

  it("denies reject, cancelled, and unknown permission outcomes", async () => {
    const decisions: string[] = [];
    let sessionNumber = 0;
    const lifecycle = {
      async *resumeStream(_ref: unknown, resume: { decision: string }) {
        decisions.push(resume.decision);
        yield { type: "agent_denied", sessionId: "fake", runId: "run", interruption: { kind: "tool_approval", reason: "approval" }, version: 1 };
      },
    } as unknown as AgentRunLifecycle;
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({
        session: {
          id: `fake-${++sessionNumber}`,
          async *stream() { yield { type: "agent_suspended", sessionId: `fake-${sessionNumber}`, runId: "run", interruption: { kind: "tool_approval", reason: "approval", toolCallId: "tool" }, version: 1 }; },
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
