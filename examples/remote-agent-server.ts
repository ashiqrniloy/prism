import { type Agent, createAgent, type HostUi, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import approval from "@arnilo/prism-approval";

// Keep Bun transport declarations out of the examples compiler.
const remoteModule = "@arnilo/prism-remote";
const {
  remoteHostUi,
  serveAgent,
}: {
  remoteHostUi(): HostUi;
  serveAgent(agent: Agent, options: { transport: { kind: "stdio" }; hostUi: HostUi; endpointId: string }): { closed: Promise<void> };
} = await import(remoteModule);

// stdout belongs to the protocol; send any diagnostics to stderr.
const ui = remoteHostUi();
const agent = await createAgent({
  id: "remote-worker",
  name: "Remote worker",
  model: { provider: "mock", model: "demo" },
  host: { ui },
  packages: [
    mockProvider([
      [{ type: "tool_call", call: toolCallContent("save-1", "save", {}) }, providerDone()],
      [providerTextDelta("Remote approved report"), providerDone()],
    ]),
    approval({ mode: "ask" }),
  ],
  tools: {
    add: [
      {
        name: "save",
        parameters: { type: "object", properties: {} },
        effects: ["write"],
        execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "save", value: "approved" }),
      },
    ],
  },
});
const served = serveAgent(agent, { transport: { kind: "stdio" }, hostUi: ui, endpointId: "example-remote" });
try {
  await served.closed;
} finally {
  await agent.dispose();
}
