import { createAgent, createAgentSession, createMockProvider, providerDone, providerTextDelta, providerUsage, } from "@arnilo/prism";
// Minimal host-app embed: create an agent + session, stream events while a
// prompt runs, and return the event-type sequence. Uses the mock provider —
// no network, no credentials.
//
// This is the canonical "hello world" host app. The subscribe consumer and
// session.run run concurrently via Promise.all: subscribe is an async
// generator that yields events as the run produces them, so it must be
// draining while run() is driving the provider turn.
export async function demo() {
    const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([
            providerTextDelta("Hello, host!"),
            providerUsage({ inputTokens: 4, outputTokens: 3, totalTokens: 7 }),
            providerDone(),
        ]),
    });
    const session = createAgentSession({ agent });
    const types = [];
    async function drain() {
        for await (const event of session.subscribe()) {
            types.push(event.type);
        }
    }
    await Promise.all([drain(), session.run("Hi")]);
    return types;
}
export async function main() {
    console.log(JSON.stringify(await demo()));
}
if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
