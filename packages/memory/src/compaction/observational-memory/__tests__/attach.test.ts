import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AIProvider,
  createAgent,
  createExtensionKernel,
  createMemorySessionStore,
  createMockProvider,
  type ProviderEvent,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import {
  createObservationalMemory,
  createObservationalMemoryExtension,
  OBSERVATIONS_RECORDED,
  type ObservationalMemorySettingsInput,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };

function sequenceProvider(batches: readonly (readonly ProviderEvent[])[]): AIProvider {
  let index = 0;
  return {
    id: "memory",
    async *generate() {
      yield* batches[index++] ?? [providerDone()];
    },
  };
}

function attachFixture(worker: AIProvider, overrides: ObservationalMemorySettingsInput = {}) {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const baseSession = agent.createSession({ id: "s1" });
  const om = createObservationalMemory({
    observation: { provider: worker, model: workerModel },
    reflection: { provider: worker, model: workerModel },
    dropper: { provider: worker, model: workerModel },
    overrides,
  });
  const attached = om.attach(baseSession, {
    appendEntry: (entry, options) => store.append(entry, options),
    sessionModel: model,
  });
  return { attached, store, agent, om, baseSession };
}

describe("observational memory attach", () => {
  it("attached_run_triggers_observation_without_manual_flush", async () => {
    let workerCalls = 0;
    const worker: AIProvider = {
      id: "memory",
      async *generate() {
        workerCalls++;
        yield providerDone();
      },
    };
    const { attached } = attachFixture(worker, {
      observation: { messageTokens: 1 },
      reflection: { observationTokens: 999_999 },
      context: { compactAfterTokens: 999_999 },
      agentMaxTurns: 1,
    });
    await attached.session.run("hello");
    assert.equal(workerCalls, 1);
    assert.equal(
      (await attached.session.entries()).some(
        (entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === OBSERVATIONS_RECORDED,
      ),
      true,
    );
  });

  it("attached_run_compacts_when_compact_after_tokens_reached", async () => {
    const worker = sequenceProvider([[providerDone()]]);
    const { attached } = attachFixture(worker, {
      observation: { messageTokens: 999_999 },
      reflection: { observationTokens: 999_999 },
      context: { compactAfterTokens: 1 },
      agentMaxTurns: 1,
    });
    await attached.session.run("hello");
    assert.equal(
      (await attached.session.entries()).some((entry) => entry.kind === "compaction"),
      true,
    );
  });

  it("unattached_extension_setup_makes_zero_provider_calls", async () => {
    let calls = 0;
    const workerProvider: AIProvider = {
      id: "memory",
      async *generate() {
        calls++;
        yield providerDone();
      },
    };
    await createExtensionKernel().load([createObservationalMemoryExtension()]);
    createObservationalMemory({ observation: { provider: workerProvider, model: workerModel } });
    assert.equal(calls, 0);
  });

  it("runtime_flush_skips_while_attached_run_is_active", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createMemorySessionStore();
    const agentProvider: AIProvider = {
      id: "agent",
      async *generate() {
        await gate;
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const agent = createAgent({ model, provider: agentProvider, store });
    const baseSession = agent.createSession({ id: "s1" });
    const om = createObservationalMemory({
      observation: { provider: sequenceProvider([[providerDone()]]), model: workerModel },
      overrides: { observation: { messageTokens: 1 }, agentMaxTurns: 1 },
    });
    const attached = om.attach(baseSession, {
      appendEntry: (entry, options) => store.append(entry, options),
      sessionModel: model,
    });
    const runPromise = attached.session.run("hello");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal((await attached.runtime.flush()).skipped, "run_active");
    release?.();
    await runPromise;
  });

  it("manual_flush_remains_available_on_attached_runtime", async () => {
    const worker = sequenceProvider([[providerDone()]]);
    const { attached } = attachFixture(worker, {
      observation: { messageTokens: 1 },
      reflection: { observationTokens: 999_999 },
      agentMaxTurns: 1,
    });
    await attached.session.run("hello");
    const before = (await attached.session.entries()).length;
    const result = await attached.runtime.flush();
    assert.equal(result.skipped, undefined);
    assert.ok((await attached.session.entries()).length >= before);
  });

  it("context_provider_renders_memory_and_recent_messages_without_provider_call", async () => {
    const worker = sequenceProvider([
      [
        providerToolCall(
          toolCallContent("o", "record_observation", {
            content: "context block fact",
            relevance: "high",
            sourceEntryIds: ["x"],
          }),
        ),
        providerDone(),
      ],
    ]);
    const { attached } = attachFixture(worker, {
      observation: { messageTokens: 1 },
      reflection: { observationTokens: 999_999 },
      agentMaxTurns: 1,
    });
    let providerCalls = 0;
    const originalGenerate = worker.generate.bind(worker);
    worker.generate = async function* (...args) {
      providerCalls++;
      yield* originalGenerate(...args);
    };
    await attached.session.run("hello");
    const blocks = await attached.contextProvider.resolve({ messages: [] });
    assert.match(String(blocks[0]?.content ?? ""), /observational memory/i);
    const recent = blocks.find((block) => block.title === "recent-messages");
    assert.ok(recent);
    assert.match(String(recent?.content ?? ""), /hello|user/i);
    assert.equal(providerCalls, 1);
  });
});
