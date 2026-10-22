import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createAgent, createSecretRedactor } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { serveAcp } from "../index.js";

describe("serveAcp redaction", () => {
  it("serve_acp_never_emits_secret", async () => {
    const secret = "super-secret-value";
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      redactor: createSecretRedactor([secret]),
      packages: [mockProvider([[providerTextDelta(`token ${secret}`), providerDone()]])],
    });
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
    const updates: string[] = [];
    const server = serveAcp(agent, { stream: ndJsonStream(agentToClient.writable, clientToAgent.readable) });
    const client = new ClientSideConnection(
      () => ({
        sessionUpdate: (params) => {
          updates.push(JSON.stringify(params));
        },
        requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
      }),
      ndJsonStream(clientToAgent.writable, agentToClient.readable),
    );
    await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
    await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "hi" }] });
    assert.equal(
      updates.some((update) => update.includes(secret)),
      false,
    );
    await server.close();
  });
});
