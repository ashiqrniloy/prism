import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type SessionNotification } from "@agentclientprotocol/sdk";
import { type Agent, createAgent, definePackage } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { acpHost, serveAcp } from "../index.js";

const MODEL = { provider: "mock", model: "demo" } as const;

function streams() {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  return {
    agent: ndJsonStream(agentToClient.writable, clientToAgent.readable),
    client: ndJsonStream(clientToAgent.writable, agentToClient.readable),
  };
}

function connect(agent: Agent, permission?: (toolCallId: string) => "allow_once" | "allow_always" | "reject_once" | "hold") {
  const pair = streams();
  const updates: SessionNotification[] = [];
  let release: (value: "allow_once" | "allow_always" | "reject_once") => void = () => undefined;
  const held = new Promise<"allow_once" | "allow_always" | "reject_once">((resolve) => {
    release = resolve;
  });
  const server = serveAcp(agent, { stream: pair.agent });
  const client = new ClientSideConnection(
    () => ({
      sessionUpdate: (params) => {
        updates.push(params);
      },
      requestPermission: async (params) => {
        const choice = permission?.(params.toolCall.toolCallId) ?? "allow_once";
        const optionId = choice === "hold" ? await held : choice;
        return { outcome: { outcome: "selected" as const, optionId } };
      },
    }),
    pair.client,
  );
  return { client, updates, server, release };
}

async function textAgent(text: string) {
  return createAgent({
    model: MODEL,
    packages: [mockProvider([[providerTextDelta(text), providerDone()]])],
  });
}

describe("serveAcp", () => {
  it("serve_acp_prompt_streams_session_events", async () => {
    const agent = await textAgent("hello");
    const { client, updates, server } = connect(agent);
    const init = await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    assert.equal(init.agentCapabilities?.loadSession, true);
    assert.equal(init.agentCapabilities?.mcpCapabilities, undefined);
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    const prompt = await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "hi" }] });
    assert.equal(prompt.stopReason, "end_turn");
    assert.ok(updates.some((update) => update.update.sessionUpdate === "agent_message_chunk"));
    await server.close();
  });

  it("serve_acp_permission_resumes_suspended_run", async () => {
    const executed: string[] = [];
    const agent = await createAgent({
      model: MODEL,
      host: acpHost(),
      hooks: (hooks) => hooks.on("tool.call", () => ({ ask: "delete?" })),
      packages: [
        mockProvider([
          [providerToolCall(toolCallContent("call-1", "delete_file", { path: "a.txt" })), providerDone()],
          [providerTextDelta("done"), providerDone()],
        ]),
      ],
      tools: {
        add: [
          {
            name: "delete_file",
            description: "Deletes",
            parameters: { type: "object", properties: { path: { type: "string" } } },
            effects: ["write"],
            execute: () => {
              executed.push("delete_file");
              return { toolCallId: "call-1", name: "delete_file", value: "deleted" };
            },
          },
        ],
      },
    });
    const asked: string[] = [];
    const { client, server } = connect(agent, (id) => {
      asked.push(id);
      return "reject_once";
    });
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    const denied = await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "delete" }] });
    assert.equal(executed.length, 0);
    assert.deepEqual(asked, ["call-1"]);
    assert.ok(denied.stopReason === "end_turn" || denied.stopReason === "refusal");
    await server.close();
  });

  it("serve_acp_allow_always_maps_to_allow_for_run", async () => {
    const executed: string[] = [];
    const agent = await createAgent({
      model: MODEL,
      hooks: (hooks) => hooks.on("tool.call", () => ({ ask: "delete?" })),
      packages: [
        mockProvider([
          [providerToolCall(toolCallContent("call-1", "delete_file", { path: "a.txt" })), providerDone()],
          [providerToolCall(toolCallContent("call-2", "delete_file", { path: "a.txt" })), providerDone()],
          [providerTextDelta("done"), providerDone()],
        ]),
      ],
      tools: {
        add: [
          {
            name: "delete_file",
            description: "Deletes",
            parameters: { type: "object", properties: { path: { type: "string" } } },
            effects: ["write"],
            execute: (_args, context) => {
              executed.push(context.toolCallId);
              return { toolCallId: context.toolCallId, name: "delete_file", value: "deleted" };
            },
          },
        ],
      },
    });
    const asked: string[] = [];
    const { client, server } = connect(agent, (id) => {
      asked.push(id);
      return "allow_always";
    });
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    const prompt = await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "delete" }] });
    assert.equal(prompt.stopReason, "end_turn");
    assert.deepEqual(asked, ["call-1"]);
    assert.equal(executed.length, 2);
    await server.close();
  });

  it("serve_acp_cancel_rejects_pending_permission", async () => {
    const executed: string[] = [];
    const agent = await createAgent({
      model: MODEL,
      hooks: (hooks) => hooks.on("tool.call", () => ({ ask: "delete?" })),
      packages: [mockProvider([[providerToolCall(toolCallContent("call-1", "delete_file", { path: "a.txt" })), providerDone()]])],
      tools: {
        add: [
          {
            name: "delete_file",
            description: "Deletes",
            parameters: { type: "object", properties: {} },
            effects: ["write"],
            execute: () => {
              executed.push("ran");
              return { toolCallId: "call-1", name: "delete_file", value: "deleted" };
            },
          },
        ],
      },
    });
    const { client, server } = connect(agent, () => "hold");
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    const pending = client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "delete" }] });
    await client.cancel({ sessionId: created.sessionId });
    const result = await pending;
    assert.equal(result.stopReason, "cancelled");
    assert.equal(executed.length, 0);
    await server.close();
  });

  it("serve_acp_load_replays_messages", async () => {
    const agent = await textAgent("stored");
    const { client, updates, server } = connect(agent);
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "remember" }] });
    updates.length = 0;
    await client.loadSession({ sessionId: created.sessionId, cwd: "/tmp", mcpServers: [] });
    assert.ok(updates.some((update) => JSON.stringify(update).includes("remember")));
    await assert.rejects(client.loadSession({ sessionId: "missing", cwd: "/tmp", mcpServers: [] }));
    await server.close();
  });

  it("serve_acp_commands_listed_and_run", async () => {
    const ran: string[] = [];
    const agent = await createAgent({
      model: MODEL,
      packages: [
        mockProvider([[providerTextDelta("nope"), providerDone()]]),
        definePackage({
          name: "ping-pkg",
          version: "0.1.0",
          requires: { api: 1 },
          setup(api) {
            api.commands.register({
              name: "ping",
              description: "Ping",
              run() {
                ran.push("ping");
                return "pong";
              },
            });
          },
        }),
      ],
    });
    const { client, updates, server } = connect(agent);
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    assert.ok(updates.some((update) => update.update.sessionUpdate === "available_commands_update"));
    await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "/ping" }] });
    assert.deepEqual(ran, ["ping"]);
    await server.close();
  });

  it("serve_acp_authorize_false_creates_no_session", async () => {
    const agent = await textAgent("nope");
    const pair = streams();
    const server = serveAcp(agent, { stream: pair.agent, authorize: () => false });
    const client = new ClientSideConnection(
      () => ({
        sessionUpdate: async () => undefined,
        requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
      }),
      pair.client,
    );
    await assert.rejects(client.initialize({ protocolVersion: PROTOCOL_VERSION }));
    await assert.rejects(client.newSession({ cwd: "/tmp", mcpServers: [] }));
    await server.close();
  });

  it("rejects a non-empty mcpServers list and creates no session", async () => {
    const agent = await textAgent("nope");
    const { client, server } = connect(agent);
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    await assert.rejects(client.newSession({ cwd: "/tmp", mcpServers: [{ name: "x", command: "/bin/false", args: [], env: [] }] }));
    await server.close();
  });
});
