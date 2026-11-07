import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

// SDK basics: create an agent + session, subscribe to events, run a prompt.
// Uses the mock provider — network-free, no credentials.
export async function demo(): Promise<readonly string[]> {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
  });

  const session = await agent.session();

  const types: string[] = [];
  for await (const event of session.subscribe()) {
    types.push(event.type);
  }

  await session.run("Hi");
  return types;
}
