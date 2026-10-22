import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createAgent, definePackage } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { acpHost, serveAcp } from "../index.js";
import { bindAcpSession } from "../session-map.js";

const MODEL = { provider: "mock", model: "demo" } as const;

describe("acpHost", () => {
  it("acp_host_routes_by_session_and_fails_closed", async () => {
    const seen: string[] = [];
    const host = acpHost();
    const agent = await createAgent({
      model: MODEL,
      host,
      packages: [
        mockProvider([
          [providerToolCall(toolCallContent("call-1", "touch", {})), providerDone()],
          [providerTextDelta("ok"), providerDone()],
        ]),
        definePackage({
          name: "ask-pkg",
          version: "0.1.0",
          requires: { api: 1 },
          capabilities: ["host-ui"],
          setup(api) {
            api.hooks.on("tool.call", async () => {
              const ui = api.host.ui;
              if (!ui) return { deny: "no ui" };
              const select = await ui.request({
                kind: "select",
                title: "Pick",
                options: [{ value: "a", label: "A" }],
              });
              seen.push(select.status);
              const secret = await ui.request({ kind: "secret", title: "Key", ref: "env:KEY" });
              seen.push(secret.status);
              return "allow" as const;
            });
          },
        }),
      ],
      tools: {
        add: [
          {
            name: "touch",
            description: "Touch",
            parameters: { type: "object", properties: {} },
            effects: ["write"],
            execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "touch", value: "ok" }),
          },
        ],
      },
    });
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
    const server = serveAcp(agent, {
      stream: ndJsonStream(agentToClient.writable, clientToAgent.readable),
    });
    const client = new ClientSideConnection(
      () => ({
        sessionUpdate: async () => undefined,
        requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
      }),
      ndJsonStream(clientToAgent.writable, agentToClient.readable),
    );
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    await client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "go" }],
    });
    // No elicitation advertised, and secret never leaves the host: both unavailable.
    assert.deepEqual(seen, ["unavailable", "unavailable"]);
    const unbound = await host.ui?.request({ kind: "select", title: "x", options: [], package: "ask-pkg", sessionId: "missing" });
    assert.equal(unbound?.status, "unavailable");
    await server.close();
  });

  it("acp_host_terminal_answers_unavailable", async () => {
    const port = acpHost();
    const elicited: unknown[] = [];
    bindAcpSession(port, "s1", {
      elicitation: true,
      notify: async () => {},
      elicit: async (request) => {
        elicited.push(request);
        return { status: "answered", value: true };
      },
      cancelPermission: () => {},
    });
    const answer = await port.ui?.request({ kind: "terminal", title: "Sign in", command: ["x", "login"], package: "p", sessionId: "s1" });
    assert.deepEqual(answer, { status: "unavailable" });
    assert.deepEqual(elicited, []);
  });

  it("acp_host_kernel_ask_suspends_not_confirms", async () => {
    const kinds: string[] = [];
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
            parameters: { type: "object", properties: {} },
            effects: ["write"],
            execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "delete_file", value: "deleted" }),
          },
        ],
      },
    });
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
    const server = serveAcp(agent, { stream: ndJsonStream(agentToClient.writable, clientToAgent.readable) });
    const client = new ClientSideConnection(
      () => ({
        sessionUpdate: async () => undefined,
        createElicitation: async () => {
          kinds.push("elicitation");
          return { action: "decline" as const };
        },
        requestPermission: async (params) => {
          kinds.push(`permission:${params.toolCall.toolCallId}`);
          return { outcome: { outcome: "selected" as const, optionId: "allow_once" } };
        },
      }),
      ndJsonStream(clientToAgent.writable, agentToClient.readable),
    );
    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { elicitation: { form: {} } } });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "delete" }] });
    assert.deepEqual(kinds, ["permission:call-1"]);
    await server.close();
  });
});
