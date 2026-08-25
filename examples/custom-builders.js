import { createAgent, createAgentSession, createMockProvider, providerDone, providerTextDelta, } from "@arnilo/prism";
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
const preambleMessage = {
    role: "system",
    content: [{ type: "text", text: "Host preamble: answer in one short sentence." }],
};
const customInputBuilder = {
    name: "host-input",
    async build(input, _context) {
        const userText = typeof input === "string" ? input : "<structured input>";
        return [preambleMessage, { role: "user", content: [{ type: "text", text: userText }] }];
    },
};
const customPromptBuilder = {
    name: "host-prompt",
    async build(request) {
        const blocks = request.context ?? [];
        const blockMessages = blocks.map((b) => ({
            role: "system",
            content: [{ type: "text", text: `${b.title ?? "Context"}: ${typeof b.content === "string" ? b.content : "<blocks>"}` }],
        }));
        const toolMessages = (request.tools ?? []).map((t) => ({
            role: "system",
            content: [{ type: "text", text: `Tool available: ${t.name}` }],
        }));
        const skillMessages = (request.skills ?? []).map((s) => ({
            role: "system",
            content: [{ type: "text", text: `Skill active: ${s.name}` }],
        }));
        return [...blockMessages, ...toolMessages, ...skillMessages, ...request.messages];
    },
};
export async function demo() {
    const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
        inputBuilder: customInputBuilder,
        promptBuilder: customPromptBuilder,
        context: [{ name: "workspace", resolve: () => [{ title: "Workspace", content: "demo repo" }] }],
    });
    const session = createAgentSession({ agent });
    const types = [];
    async function drain() {
        for await (const event of session.subscribe())
            types.push(event.type);
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
