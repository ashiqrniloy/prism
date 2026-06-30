import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMemorySessionStore, createMockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent, type AIProvider, type ProviderEvent, type SessionEntry } from "@arnilo/prism";
import { createObservationalMemoryRuntime, OBSERVATIONS_DROPPED, OBSERVATIONS_RECORDED, REFLECTIONS_RECORDED } from "../index.js";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };

function sequenceProvider(batches: readonly (readonly ProviderEvent[])[]): AIProvider {
  let index = 0;
  return { id: "memory", async *generate() { yield* (batches[index++] ?? [providerDone()]); } };
}

async function sessionWithMessage() {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const session = agent.createSession({ id: "s1" });
  await session.run("hello");
  return { session, store };
}

describe("observational memory runtime", () => {
  it("runtime_does_not_start_workers_when_passive_not_due_in_flight_or_missing_credentials", async () => {
    const { session, store } = await sessionWithMessage();
    let calls = 0;
    const workerProvider: AIProvider = { id: "memory", async *generate() { calls++; yield providerDone(); } };
    const appendEntry = (entry: SessionEntry) => store.append(entry);
    const runtime = createObservationalMemoryRuntime({ session, appendEntry, workerProvider, workerModel, overrides: { passive: true, observeAfterTokens: 1 } });
    assert.equal((await runtime.flush()).skipped, "passive");
    assert.equal(calls, 0);

    const gated = createObservationalMemoryRuntime({ session, appendEntry, workerProvider, workerModel, credentialRequest: { provider: "mock", name: "apiKey" }, overrides: { observeAfterTokens: 1 } });
    assert.equal((await gated.flush()).skipped, "missing_credentials");
    assert.equal(calls, 0);
  });

  it("runtime_appends_custom_ledger_entries_append_only_and_redacted", async () => {
    const { session, store } = await sessionWithMessage();
    const workerProvider = sequenceProvider([
      [providerToolCall(toolCallContent("o", "record_observation", { content: "secret-value package-only preference", relevance: "high", sourceEntryIds: [(await session.entries())[0]?.id] })), providerDone()],
      [providerToolCall(toolCallContent("r", "record_reflection", { content: "secret-value keep optional", supportingObservationIds: [] })), providerDone()],
    ]);
    const runtime = createObservationalMemoryRuntime({ session, appendEntry: (entry) => store.append(entry), workerProvider, workerModel, secrets: ["secret-value"], overrides: { observeAfterTokens: 1, reflectAfterTokens: 1, observationsPoolTargetTokens: 1, agentMaxTurns: 1 } });
    const result = await runtime.flush();
    const entries = await session.entries();
    assert.equal(result.observations, 1);
    assert.ok(entries.some((entry) => entry.kind === "custom" && (entry.data as any).type === OBSERVATIONS_RECORDED));
    assert.equal(JSON.stringify(entries).includes("secret-value"), false);
  });

  it("runtime_worker_errors_are_recorded_without_corrupting_branch", async () => {
    const { session, store } = await sessionWithMessage();
    const before = (await session.entries()).at(-1)?.id;
    const workerProvider: AIProvider = { id: "memory", async *generate() { throw new Error("boom"); } };
    const runtime = createObservationalMemoryRuntime({ session, appendEntry: (entry) => store.append(entry), workerProvider, workerModel, overrides: { observeAfterTokens: 1 } });
    assert.equal((await runtime.flush()).skipped, "error");
    assert.equal((await session.entries()).at(-1)?.id, before);
    assert.equal(runtime.status().lastError, "boom");
  });

  it("runtime_rejects_legacy_store_option_and_wrong_append_owner", async () => {
    const { session, store } = await sessionWithMessage();
    assert.throws(() => createObservationalMemoryRuntime({ session, store, appendEntry: async () => undefined, workerProvider: createMockProvider([providerDone()]), workerModel } as any), /appendEntry bound to the owning session store/);

    const otherStore = createMemorySessionStore();
    const workerProvider = sequenceProvider([
      [providerToolCall(toolCallContent("o", "record_observation", { content: "owned append", relevance: "high", sourceEntryIds: [(await session.entries())[0]?.id] })), providerDone()],
    ]);
    const before = session.leafId;
    const runtime = createObservationalMemoryRuntime({ session, appendEntry: (entry) => otherStore.append(entry), workerProvider, workerModel, overrides: { observeAfterTokens: 1, reflectAfterTokens: 999_999, agentMaxTurns: 1 } });

    assert.equal((await runtime.flush()).skipped, "error");
    assert.equal(runtime.status().lastError, "Observational memory appendEntry did not append to the owning session branch");
    assert.equal(session.leafId, before);
    assert.equal((await store.list(session.id)).some((entry) => entry.kind === "custom"), false);
    assert.equal((await otherStore.list(session.id)).some((entry) => entry.kind === "custom"), true);
  });
});
