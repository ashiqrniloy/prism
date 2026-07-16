import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createA2AClient, createA2AHandler, createSupervisor, type A2AAgentCard } from "@arnilo/prism-supervisor";

const ownership = { tenantId: "example", userId: "operator" };
const child = () => createAgent({ model: { provider: "mock", model: "research" }, provider: createMockProvider([providerTextDelta("verified"), providerDone()]) });
const supervisor = createSupervisor({ ownership, children: { research: { createAgent: child } } });
const local = await supervisor.delegate({ childId: "research", input: "Check sources" });

const endpoint = "https://agent.example/a2a/v1";
const card: A2AAgentCard = {
  name: "Research Agent",
  description: "Checks sources",
  supportedInterfaces: [{ url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
  version: "1.0.0",
  capabilities: { streaming: true },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [{ id: "research", name: "Research", description: "Checks sources", tags: ["research"] }],
};
const handler = createA2AHandler({ card, exposure: { sessionFactory: () => child().createSession() }, authorize: () => ({ ownership }) });
const client = createA2AClient({ endpoint, allowedOrigins: ["https://agent.example"], fetch: (input, init) => handler(new Request(input, init)) });
const remote = await client.send("Check sources");

console.log(JSON.stringify({ local: local.text, remote: remote.text }));
