import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMemorySessionStore, createMockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent, type AIProvider, type ProviderEvent } from "prism";
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
    const runtime = createObservationalMemoryRuntime({ session, store, workerProvider, workerModel, overrides: { passive: true, observeAfterTokens: 1 } });
    assert.equal((await runtime.flush()).skipped, "passive");
    assert.equal(calls, 0);

    const gated = createObservationalMemoryRuntime({ session, store, workerProvider, workerModel, credentialRequest: { provider: "mock", name: "apiKey" }, overrides: { observeAfterTokens: 1 } });
    assert.equal((await gated.flush()).skipped, "missing_credentials");
    assert.equal(calls, 0);
  });

  it("runtime_appends_custom_ledger_entries_append_only_and_redacted", async () => {
    const { session, store } = await sessionWithMessage();
    const workerProvider = sequenceProvider([
      [providerToolCall(toolCallContent("o", "record_observation", { content: "secret-value package-only preference", relevance: "high", sourceEntryIds: [(await session.entries())[0]?.id] })), providerDone()],
      [providerToolCall(toolCallContent("r", "record_reflection", { content: "secret-value keep optional", supportingObservationIds: [] })), providerDone()],
    ]);
    const runtime = createObservationalMemoryRuntime({ session, store, workerProvider, workerModel, secrets: ["secret-value"], overrides: { observeAfterTokens: 1, reflectAfterTokens: 1, observationsPoolTargetTokens: 1, agentMaxTurns: 1 } });
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
    const runtime = createObservationalMemoryRuntime({ session, store, workerProvider, workerModel, overrides: { observeAfterTokens: 1 } });
    assert.equal((await runtime.flush()).skipped, "error");
    assert.equal((await session.entries()).at(-1)?.id, before);
    assert.equal(runtime.status().lastError, "boom");
  });
});
