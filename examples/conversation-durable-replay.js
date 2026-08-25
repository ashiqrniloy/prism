import { createAgent, createMockProvider, createSecretRedactor, providerDone, providerTextDelta, providerUsage, } from "@arnilo/prism";
import { createConversationService } from "@arnilo/prism-server";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
// Durable personal/work-agent conversation: create a thread, continue it through
// a mock agent run, then replay redacted events from a cursor. Network-free —
// sqlite `:memory:` store + mock provider, no credentials.
export async function demo() {
    const ownership = { tenantId: "tenant-a", userId: "user-1" };
    const persistence = createSqlitePersistence({ filename: ":memory:" });
    const agent = createAgent({
        model: { provider: "mock", model: "offline" },
        provider: createMockProvider([
            providerTextDelta("Saved to your durable thread."),
            providerUsage({ inputTokens: 5, outputTokens: 6, totalTokens: 11 }),
            providerDone(),
        ]),
        redactor: createSecretRedactor(["super-secret"]),
        store: persistence,
        runLedger: persistence,
    });
    const conversations = createConversationService(persistence, {
        redactor: createSecretRedactor(["super-secret"]),
        sessionFactory: ({ thread, leafId }) => agent.createSession({ id: thread.id, ...(leafId === undefined ? {} : { leafId }) }),
    });
    const thread = await conversations.create({ ownership, title: "Release follow-up" });
    await conversations.continue({ ownership, threadId: thread.id, message: "Summarize the launch.", requestId: "req-1" });
    // Reconnectable replay: page redacted event records from the start cursor.
    const replay = await conversations.replay({ ownership, threadId: thread.id });
    return {
        threadId: thread.id,
        state: thread.state,
        replayedEvents: replay.records.length,
        allRedacted: replay.records.every((record) => record.redacted === true),
        terminal: replay.terminal,
    };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(await demo()));
}
