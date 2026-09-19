import { createAgent, createAgentRunLifecycle, createMemoryCheckpointStore, createMemorySessionStore, providerDone, providerTextDelta, toolCallContent, createSecretRedactor } from "@arnilo/prism";
import { createPrismHandler } from "./dist/runtime/server/handler.js";
const checkpoints = createMemoryCheckpointStore();
const store = createMemorySessionStore();
const secret = "agent-lifecycle-secret";
let calls = 0, turn = 0;
const agent = createAgent({
  id: "support",
  model: { provider: "mock", model: "offline" },
  provider: { id: "mock", async *generate() {
    if (++turn === 1) { yield { type: "tool_call", call: toolCallContent("call-1", "write", { secret }) }; yield providerDone(); return; }
    yield providerTextDelta("finished"); yield providerDone();
  } },
  redactor: createSecretRedactor([secret]),
  store,
  tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write", value: ++calls }) }],
  runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
});
const lifecycle = createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent, definitionRevision: "1" }) });
const authorization = { ownership: { tenantId: "tenant-1", userId: "user-1" } };
const handler = createPrismHandler({ agents: { support: agent }, agentRuns: { support: { lifecycle } }, authorize: () => authorization, redactor: createSecretRedactor([secret]) });
const jsonRequest = (p, b) => new Request(`https://example.test${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const suspended = await handler(jsonRequest("/prism/agents/support/runs", { input: "go" }));
const started = await suspended.json();
const status = await handler(new Request(`https://example.test/prism/agents/support/runs/${started.runId}`));
console.log("GET status", status.status, (await status.text()).slice(0, 120));
