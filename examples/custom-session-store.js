import { createAgent, createAgentSession, createMockProvider, createSessionEntry, providerDone, providerTextDelta, } from "@arnilo/prism";
// Custom session store: a host implements the `SessionStore` contract
// (append + list) and passes it to `createAgentSession`. The runtime appends
// redacted session entries and reads them back to rebuild context across
// turns. This is the lightest custom-store seam — for a DB-backed reference
// with idempotency, conflict errors, and branch reads, see
// `external-app-db-backed.ts`.
//
// The store here is a simple in-memory map that records the kinds of entries
// the runtime appends, proving the host owns persistence. No network, no
// credentials.
function customStore() {
    const byId = new Map();
    const bySession = new Map();
    const kinds = [];
    return {
        async append(entry) {
            byId.set(entry.id, entry);
            (bySession.get(entry.sessionId) ?? bySession.set(entry.sessionId, []).get(entry.sessionId)).push(entry);
            kinds.push(entry.kind);
        },
        async list(sessionId) {
            return [...(bySession.get(sessionId) ?? [])];
        },
        async get(id) {
            return byId.get(id);
        },
        appendedKinds: () => [...kinds],
    };
}
export async function demo() {
    const store = customStore();
    const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerTextDelta("stored"), providerDone()]),
    });
    const session = createAgentSession({ agent, store });
    async function drain() {
        for await (const _event of session.subscribe()) {
            /* consume */
        }
    }
    await Promise.all([drain(), session.run("Hi")]);
    // The host can read its own store back to display a transcript, and use
    // createSessionEntry to build host-side entries outside the runtime.
    const entries = await store.list(session.id);
    const hostNote = createSessionEntry({
        sessionId: session.id,
        kind: "custom",
        message: { role: "user", content: [{ type: "text", text: "host-side note" }] },
    });
    return {
        appendedKinds: store.appendedKinds(),
        entryCount: entries.length + 1, // runtime entries + the host-side note
        hostNoteId: hostNote.id,
    };
}
export async function main() {
    console.log(JSON.stringify(await demo()));
}
if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
