import { createAgent, type ContextBlock, providerDone, providerTextDelta, withContextBlocks, type ContextDraft } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

// Ordered context blocks as a `context.build` handler (roadmap §2.4). The draft is the provider
// view for this turn only, so a host-owned handler adds context without touching the session
// store. Blocks are appended in registration order, and a handler can never grant tools.
export async function demo() {
  let seen: readonly ContextBlock[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "context-demo" },
    packages: [
      mockProvider([[providerTextDelta("ok"), providerDone()]], {
        onRequest: (request) => {
          seen = request.context ?? [];
        },
      }),
    ],
    hooks: (hooks) =>
      hooks.on(
        "context.build",
        (draft: ContextDraft) =>
          withContextBlocks(draft, [{ content: `UTC: ${new Date(0).toISOString()}` }, { content: "Project notes placeholder." }]),
        { id: "clock-and-notes" },
      ),
  });

  await (await agent.session()).run("Hi");
  return { count: seen.length, contents: seen.map((b) => b.content) };
}
