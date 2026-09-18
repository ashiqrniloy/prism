// Plan 079 Task 8: network-free host composition — sqlite journal, mock agent, drain/stop.
import { type AgentIdentity, createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createMessagingRuntime } from "@arnilo/prism-channels";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";

const identity: AgentIdentity = {
  tenantId: "example-tenant",
  userId: "example-user",
  principal: { kind: "user", id: "example-user" },
  scopes: ["chat"],
  issuedAt: new Date(0).toISOString(),
  verified: true,
};

export async function demo(): Promise<Record<string, unknown>> {
  const persistence = createSqlitePersistence({ filename: ":memory:" });
  try {
    const agent = createAgent({
      id: "channel-agent",
      model: { provider: "mock", model: "offline" },
      provider: createMockProvider([providerTextDelta("Host example reply."), providerDone()]),
      store: persistence,
      runLedger: persistence,
    });
    const delivered: string[] = [];
    const runtime = createMessagingRuntime({
      authorize: (input) =>
        input.action === "notify"
          ? { identity, agentAliases: ["primary"], grantRevision: "rev-1", notifications: true }
          : { identity, agentAliases: ["primary"], grantRevision: "rev-1" },
      resolveAgent: () => agent,
      deliver: (reply) => {
        delivered.push(reply.text);
        return { delivered: true };
      },
      checkpoints: persistence.checkpoints,
      leases: persistence.leases,
    });
    const admission = await runtime.admit({
      connectionId: "example",
      externalConversationId: "chat-1",
      externalActorId: "user-1",
      eventId: "1",
      text: "hello",
    });
    const drained = await runtime.drain();
    // Opt-in reverse direction: one notice to the bound pair, no agent run, idempotent by `notifyId`.
    const notice = await runtime.notify({
      identity,
      connectionId: "example",
      externalConversationId: "chat-1",
      notifyId: "job-1-done",
      text: "The nightly job finished.",
    });
    const unresolved = await runtime.listUnresolved({ identity });
    await runtime.stop();
    return {
      admission: admission.status,
      settled: drained.settled,
      delivered,
      notice: notice.status,
      unresolved: unresolved.length,
      diagnostics: runtime.diagnostics(),
    };
  } finally {
    persistence.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
