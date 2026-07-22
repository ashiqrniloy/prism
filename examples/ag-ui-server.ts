import { createAgUiHandler } from "@arnilo/prism-ag-ui";
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";

export async function demo() {
  const agent = createAgent({
    model: { provider: "mock", model: "mock" },
    provider: {
      id: "mock",
      async *generate() {
        yield providerTextDelta("hello from Prism");
        yield providerDone();
      },
    },
  });
  const handle = createAgUiHandler({
    authorize: () => ({ ownership: { userId: "demo" } }),
    sessionFactory: () => agent.createSession({ id: "ag-ui-demo" }),
  });
  const response = await handle(new Request("https://example.test/ag-ui", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [{ id: "message-1", role: "user", content: "hello" }],
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  }));
  return { status: response.status, events: (await response.text()).trim().split("\n\n").length };
}

if (import.meta.main) console.log(JSON.stringify(await demo()));
