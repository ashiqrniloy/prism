import { createAgent, createAgentSession, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";

// SDK basics: create an agent + session, subscribe to events, run a prompt.
// Uses the mock provider — network-free, no credentials.
export async function demo(): Promise<readonly string[]> {
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
  });

  const session = createAgentSession({ agent });

  const types: string[] = [];
  for await (const event of session.subscribe()) {
    types.push(event.type);
  }

  await session.run("Hi");
  return types;
}
