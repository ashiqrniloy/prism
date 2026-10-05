import { type ContextDraft, createAgent, type Message, providerDone, providerTextDelta, withContextBlocks } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

// A host-owned prompt composition plus a `run.input` hook: both interception
// points a 0.12 `PromptBuilder` / `ContextProvider` pair used to occupy, now both
// on the hook bus (roadmap §2.4).
//
// - The `run.input` handler wraps raw user text in a tagged user message and
//   prepends a host-owned preamble.
// - The `context.build` handler places the host's context blocks and a tool
//   summary ahead of the transcript — a different order than the kernel's own.
//
// Uses the mock provider — no network, no credentials.
const preambleMessage: Message = {
  role: "system",
  content: [{ type: "text", text: "Host preamble: answer in one short sentence." }],
};

export async function demo(): Promise<readonly string[]> {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
    hooks: (hooks) => {
      hooks.on("run.input", (messages) => [
        preambleMessage,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: messages
                .map((m) => m.content)
                .flat()
                .map((b) => (b.type === "text" ? b.text : ""))
                .join(" "),
            },
          ],
        },
      ]);
      hooks.on(
        "context.build",
        (draft: ContextDraft) =>
          withContextBlocks(draft, [
            { title: "Workspace", content: "demo repo" },
            { title: "Tools", content: (draft.tools ?? []).map((entry) => entry.name).join(", ") || "none" },
          ]),
        { id: "host-context" },
      );
    },
  });

  const session = await agent.session();
  const types: string[] = [];
  async function drain(): Promise<void> {
    for await (const event of session.subscribe()) types.push(event.type);
  }
  await Promise.all([drain(), session.run("Summarize the workspace.")]);
  return types;
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
