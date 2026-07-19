import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMemorySessionStore, createMockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent, type AIProvider, type ProviderEvent, type SessionEntry } from "@arnilo/prism";
import {
  createObservationalMemoryRuntime,
  HARD_MAX_WORKER_ARGUMENT_BYTES,
  HARD_MAX_WORKER_ERROR_BYTES,
  HARD_MAX_WORKER_MESSAGE_BYTES,
  HARD_MAX_WORKER_RESULT_BYTES,
  HARD_MAX_WORKER_TOOL_CALLS,
  HARD_MAX_WORKER_TOOL_CALLS_PER_TURN,
  HARD_MAX_WORKER_TURNS,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
} from "../index.js";

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

  it("runtime_worker_errors_are_bounded_redacted_and_record_no_branch_entry", async () => {
    const { session, store } = await sessionWithMessage();
    const before = (await session.entries()).at(-1)?.id;
    const secret = "runtime-secret";
    const workerProvider: AIProvider = { id: "memory", async *generate() { throw new Error(`${secret}-${"x".repeat(100)}`); } };
    const debug: unknown[] = [];
    const runtime = createObservationalMemoryRuntime({ session, appendEntry: (entry) => store.append(entry), workerProvider, workerModel, secrets: [secret], maxWorkerErrorBytes: 16, debug: (_message, data) => debug.push(data), overrides: { observeAfterTokens: 1 } });
    assert.equal((await runtime.flush()).skipped, "error");
    assert.equal((await session.entries()).at(-1)?.id, before);
    assert.equal(runtime.status().lastError?.includes(secret), false);
    assert.ok(Buffer.byteLength(runtime.status().lastError ?? "", "utf8") <= 16);
    assert.equal(JSON.stringify(debug).includes(secret), false);
  });

  it("runtime_rejects_invalid_worker_limits_at_construction", async () => {
    const { session, store } = await sessionWithMessage();
    const base = { session, appendEntry: (entry: SessionEntry) => store.append(entry), workerProvider: createMockProvider([providerDone()]), workerModel };
    const limits = [
      ["maxWorkerTurns", HARD_MAX_WORKER_TURNS],
      ["maxWorkerToolCallsPerTurn", HARD_MAX_WORKER_TOOL_CALLS_PER_TURN],
      ["maxWorkerToolCalls", HARD_MAX_WORKER_TOOL_CALLS],
      ["maxWorkerArgumentBytes", HARD_MAX_WORKER_ARGUMENT_BYTES],
      ["maxWorkerResultBytes", HARD_MAX_WORKER_RESULT_BYTES],
      ["maxWorkerMessageBytes", HARD_MAX_WORKER_MESSAGE_BYTES],
      ["maxWorkerErrorBytes", HARD_MAX_WORKER_ERROR_BYTES],
    ] as const;
    for (const [name, hardCap] of limits) {
      assert.doesNotThrow(() => createObservationalMemoryRuntime({ ...base, [name]: hardCap }));
      for (const value of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, hardCap + 1]) {
        assert.throws(() => createObservationalMemoryRuntime({ ...base, [name]: value }), /must be a positive safe integer/);
      }
    }
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

  it("runtime_falls_back_to_session_model_when_worker_model_omitted", async () => {
    const { session, store } = await sessionWithMessage();
    let seenModel: string | undefined;
    const workerProvider: AIProvider = {
      id: "memory",
      async *generate(request) {
        seenModel = `${request.model.provider}/${request.model.model}`;
        yield providerToolCall(toolCallContent("o", "record_observation", { content: "from session model", relevance: "high", sourceEntryIds: [(await session.entries())[0]?.id] }));
        yield providerDone();
      },
    };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      workerProvider,
      sessionModel: model,
      overrides: { observeAfterTokens: 1, reflectAfterTokens: 999_999, agentMaxTurns: 1 },
    });
    const result = await runtime.flush();
    assert.equal(result.skipped, undefined);
    assert.equal(result.observations, 1);
    assert.equal(seenModel, "mock/demo");
  });

  it("runtime_explicit_worker_model_wins_over_session_model", async () => {
    const { session, store } = await sessionWithMessage();
    let seenModel: string | undefined;
    const workerProvider: AIProvider = {
      id: "memory",
      async *generate(request) {
        seenModel = `${request.model.provider}/${request.model.model}`;
        yield providerDone();
      },
    };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      workerProvider,
      workerModel,
      sessionModel: model,
      overrides: { observeAfterTokens: 1, reflectAfterTokens: 999_999, agentMaxTurns: 1 },
    });
    await runtime.flush();
    assert.equal(seenModel, "mock/memory");
  });

  it("runtime_requireExplicitModel_skips_without_worker_model_even_with_session_model", async () => {
    const { session, store } = await sessionWithMessage();
    let calls = 0;
    const workerProvider: AIProvider = { id: "memory", async *generate() { calls++; yield providerDone(); } };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      workerProvider,
      sessionModel: model,
      requireExplicitModel: true,
      overrides: { observeAfterTokens: 1 },
    });
    assert.equal((await runtime.flush()).skipped, "missing_model");
    assert.equal(calls, 0);
  });

  it("runtime_missing_model_when_neither_worker_nor_session_model", async () => {
    const { session, store } = await sessionWithMessage();
    let calls = 0;
    const workerProvider: AIProvider = { id: "memory", async *generate() { calls++; yield providerDone(); } };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      workerProvider,
      overrides: { observeAfterTokens: 1 },
    });
    assert.equal((await runtime.flush()).skipped, "missing_model");
    assert.equal(calls, 0);
  });

  it("runtime_default_credential_request_uses_resolved_model_provider", async () => {
    const { session, store } = await sessionWithMessage();
    let defaultProvider: string | undefined;
    const withDefault = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      workerProvider: {
        id: "memory",
        async *generate() {
          yield providerToolCall(toolCallContent("o", "record_observation", { content: "ok", relevance: "high", sourceEntryIds: [(await session.entries())[0]?.id] }));
          yield providerDone();
        },
      },
      workerModel: { provider: "worker-prov", model: "w1" },
      sessionModel: model,
      credential: {
        async resolve(request) {
          defaultProvider = request.provider;
          return { type: "api_key", value: "tok" };
        },
      },
      overrides: { observeAfterTokens: 1, reflectAfterTokens: 999_999, agentMaxTurns: 1 },
    });
    await withDefault.flush();
    assert.equal(defaultProvider, "worker-prov");
  });
});
