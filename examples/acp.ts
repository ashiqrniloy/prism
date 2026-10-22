import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createAgent } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { acpHost, serveAcp } from "@arnilo/prism-acp";
import approval from "@arnilo/prism-approval";

/**
 * One agent, approval in ask mode, served over ACP on in-memory streams.
 * The client answers `session/request_permission` with `allow_once`. The tool runs once.
 * Run: npm run build:core && node examples/acp.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;
const executed: string[] = [];

const agent = await createAgent({
  id: "acp-demo",
  model: MODEL,
  host: acpHost(),
  packages: [
    approval({ mode: "ask" }),
    mockProvider([
      [providerToolCall(toolCallContent("call-1", "delete_file", { path: "tmp/scratch.txt" })), providerDone()],
      [providerTextDelta("Deleted."), providerDone()],
    ]),
  ],
  tools: {
    add: [
      {
        name: "delete_file",
        description: "Deletes a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        effects: ["write"],
        execute: (args) => {
          executed.push(String(args.path));
          return { toolCallId: "call-1", name: "delete_file", value: "deleted" };
        },
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
    requestPermission: async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }),
  }),
  ndJsonStream(clientToAgent.writable, agentToClient.readable),
);

const initialized = await client.initialize({ protocolVersion: PROTOCOL_VERSION });
const created = await client.newSession({ cwd: "/tmp", mcpServers: [] });
const prompt = await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "Delete tmp/scratch.txt" }] });
await server.close();
await agent.dispose();

if (executed.length !== 1 || prompt.stopReason !== "end_turn" || initialized.agentCapabilities?.loadSession !== true) {
  throw new Error(`ACP demo failed: ${JSON.stringify({ executed, stopReason: prompt.stopReason })}`);
}
console.log({ executed: executed.length, stopReason: prompt.stopReason, loadSession: true });
