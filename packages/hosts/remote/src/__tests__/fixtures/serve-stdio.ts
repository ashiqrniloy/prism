// A served agent over this process's stdin/stdout, for the connectAgent stdio test.
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { serveAgent } from "../../index.js";

const agent = await createAgent({
  id: "child",
  name: "child-agent",
  model: { provider: "mock", model: "m" },
  packages: [mockProvider([[providerTextDelta("from the child"), providerDone()]])],
});
const served = serveAgent(agent, { transport: { kind: "stdio" }, endpointId: "ep-child" });
await served.closed;
await agent.dispose();
