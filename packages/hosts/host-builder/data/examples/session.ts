import { createAgent } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";

/**
 * Open a session, stream one run, and read the RunResult (roadmap Phase 3). `agent.session()` opens a new
 * session; `agent.session({ id })` reopens it through the `store` slot; `run` resolves to a `RunResult`
 * whose `status` is completed | stopped | suspended | failed | aborted, and a failed run returns instead
 * of throwing. Imports only `@arnilo/prism` and `@arnilo/prism/testing`. Network-free.
 * Run: npm run build:core && node examples/session.ts
 */

export async function demo(): Promise<Record<string, unknown>> {
  const agent = await createAgent({
    id: "session-demo",
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([
      [providerTextDelta("Hello"), providerTextDelta(", world."), providerDone()],
      [providerTextDelta("Second answer."), providerDone()],
    ])],
  });

  const session = await agent.session();
  let streamed = "";
  for await (const event of session.stream("Say hello")) {
    if (event.type === "message.delta" && event.content.type === "text") streamed += event.content.text;
  }

  // A second turn through `run` returns the RunResult.
  const result = await session.run("And once more");

  // The same session, reopened by id: the branch comes back from the store slot.
  const reopened = await agent.session({ id: session.id });
  const messages = await reopened.messages();
  const listed = await agent.sessions.list();
  await agent.dispose();

  return {
    streamed,
    status: result.status,
    text: result.text,
    appended: result.messages.map((message) => message.role),
    reopenedMessages: messages.length,
    sessions: listed.items.map((item) => ({
      id: item.sessionId === session.id ? "this-session" : item.sessionId,
      messageCount: item.messageCount,
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
