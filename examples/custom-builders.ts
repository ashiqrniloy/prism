import {
  createAgent,
  createAgentSession,
  createMockProvider,
  providerDone,
  providerTextDelta,
  type ContextBlock,
  type InputBuilder,
  type InputBuildContext,
  type Message,
  type PromptBuilder,
  type PromptBuildRequest,
} from "@arnilo/prism";

// Custom input + prompt builders: a host replaces the default assembly seams
// to control how raw user input becomes messages and how the final message
// list is ordered. Both builders are plain objects implementing the
// `InputBuilder` / `PromptBuilder` contracts and are passed to `createAgent`.
//
// - The custom InputBuilder wraps raw string input in a tagged user message
//   and prepends a host-owned preamble (no middleware, no eval).
// - The custom PromptBuilder places context first, then tools, then skills,
//   then the input messages — a different order than the default builder.
//
// Uses the mock provider — no network, no credentials.
const preambleMessage: Message = {
  role: "system",
  content: [{ type: "text", text: "Host preamble: answer in one short sentence." }],
};

const customInputBuilder: InputBuilder = {
  name: "host-input",
  async build(input: string | Message | readonly Message[], _context?: InputBuildContext): Promise<readonly Message[]> {
    const userText = typeof input === "string" ? input : "<structured input>";
    return [
      preambleMessage,
      { role: "user", content: [{ type: "text", text: userText }] },
    ];
  },
};

const customPromptBuilder: PromptBuilder = {
  name: "host-prompt",
  async build(request: PromptBuildRequest): Promise<readonly Message[]> {
    const blocks = request.context ?? [];
    const blockMessages: Message[] = blocks.map((b: ContextBlock) => ({
      role: "system",
      content: [{ type: "text", text: `${b.title ?? "Context"}: ${typeof b.content === "string" ? b.content : "<blocks>"}` }],
    }));
    const toolMessages: Message[] = (request.tools ?? []).map((t) => ({
      role: "system",
      content: [{ type: "text", text: `Tool available: ${t.name}` }],
    }));
    const skillMessages: Message[] = (request.skills ?? []).map((s) => ({
      role: "system",
      content: [{ type: "text", text: `Skill active: ${s.name}` }],
    }));
    return [...blockMessages, ...toolMessages, ...skillMessages, ...request.messages];
  },
};

export async function demo(): Promise<readonly string[]> {
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
    inputBuilder: customInputBuilder,
    promptBuilder: customPromptBuilder,
    context: [
      { name: "workspace", resolve: () => [{ title: "Workspace", content: "demo repo" }] },
    ],
  });

  const session = createAgentSession({ agent });
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
