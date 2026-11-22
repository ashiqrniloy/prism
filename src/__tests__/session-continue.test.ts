/**
 * Plan 231 Task 2: `session.continue()` picks up a run that stopped partway. The branch must owe a model
 * turn; unanswered calls at the tip get a persisted result first, and nothing is re-dispatched.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { deriveToolEffectKey, toolEffectArgumentsHash } from "../tool-effects.js";
import {
  type AgentEvent,
  type LoopStrategy,
  type Message,
  type ModelProvider,
  type OwnershipScope,
  type ProviderRequest,
  type SessionStore,
  type ToolEffectStore,
  AgentDecisionError,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  createSessionEntry,
  providerDone,
  providerTextDelta,
  SessionContinueError,
  SessionNotFoundError,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const model = { provider: "mock", model: "demo" } as const;
const ownership: OwnershipScope = { tenantId: "t1" };

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });

/**
 * A provider driven by a script: `call:<id>` answers with that tool call, `fail` throws, anything else
 * answers with text. Requests are recorded.
 */
function scriptedProvider(requests: ProviderRequest[], script: string[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      const step = script.shift() ?? "done";
      if (step === "fail") throw new Error("provider down");
      if (step.startsWith("call:")) {
        yield { type: "tool_call" as const, call: toolCallContent(step.slice(5), "mutate", { n: 1 }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta(step);
      yield providerDone();
    },
  };
}

function mutateTool(counter: { count: number }, execute?: (signal: AbortSignal | undefined) => Promise<unknown>) {
  return {
    name: "mutate",
    parameters: { type: "object", properties: { n: { type: "number" } } },
    effect: { kind: "external_mutation" as const, idempotency: "required" as const },
    execute: async (_args: unknown, context: { readonly toolCallId: string; readonly signal?: AbortSignal }) => {
      counter.count += 1;
      const value = execute ? await execute(context.signal) : "mutated";
      return { toolCallId: context.toolCallId, name: "mutate", value };
    },
  };
}

/** Seed a branch `[user, assistant(call)]` as a process that died mid-call would leave it. */
async function seedCrashedBranch(store: SessionStore, sessionId: string, runId: string, callId: string): Promise<void> {
  const first = createSessionEntry({ sessionId, kind: "message", runId, message: user("do it"), metadata: { ...ownership } });
  await store.append(first);
  await store.append(
    createSessionEntry({
      sessionId,
      parentId: first.id,
      runId,
      kind: "message",
      message: { role: "assistant", content: [toolCallContent(callId, "mutate", { n: 1 })] },
      metadata: { ...ownership },
    }),
  );
}

function effectKey(sessionId: string, runId: string, callId: string) {
  const base = { ownership, sessionId, runId, toolCallId: callId, toolName: "mutate", argumentsHash: toolEffectArgumentsHash({ n: 1 }) };
  return { ...base, key: deriveToolEffectKey(base) };
}

function toolResultsOf(messages: readonly Message[]) {
  return messages.flatMap((message) => message.content.flatMap((block) => (block.type === "tool_result" ? [block] : [])));
}

async function agentOver(options: {
  store: SessionStore;
  requests: ProviderRequest[];
  script: string[];
  counter?: { count: number };
  effectStore?: ToolEffectStore;
  loop?: LoopStrategy;
  hooks?: Parameters<typeof createAgent>[0]["hooks"];
}) {
  return createAgent({
    model,
    packages: [providerPackage("p", [scriptedProvider(options.requests, options.script)])],
    slots: { store: options.store, ...(options.loop ? { loop: options.loop } : {}) },
    tools: { add: [mutateTool(options.counter ?? { count: 0 })] },
    ...(options.effectStore ? { effectStore: options.effectStore } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected a rejection");
}

describe("session.continue (plan 231 Task 2)", () => {
  it("continue_after_provider_failure_completes_the_task", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    const counter = { count: 0 };
    const agent = await agentOver({
      store,
      requests,
      counter,
      effectStore: createMemoryToolEffectStore(),
      script: ["call:c1", "fail", "finished"],
    });
    const session = await agent.session({ id: "s", create: true, ownership });
    const first = await session.run("do it");
    assert.equal(first.status, "failed");
    assert.equal(counter.count, 1);
    const before = await session.messages();
    assert.equal(before.at(-1)?.role, "tool", "the failed run leaves tool results at the tip");

    const result = await session.continue();
    assert.equal(result.status, "completed");
    assert.equal(result.text, "finished");
    assert.notEqual(result.runId, first.runId);
    assert.equal(counter.count, 1, "no tool is re-run");
    const after = await session.messages();
    assert.equal(after.filter((message) => message.role === "user").length, 1, "no new user message");
    assert.deepEqual(
      result.messages.map((message) => message.role),
      ["assistant"],
    );
    await agent.dispose();
  });

  it("continue_after_simulated_crash_settles_in_flight_calls", async () => {
    const store = createMemorySessionStore();
    await seedCrashedBranch(store, "s", "run-dead", "c1");
    const requests: ProviderRequest[] = [];
    const counter = { count: 0 };
    const agent = await agentOver({ store, requests, counter, script: ["ok"] });
    const session = await agent.session({ id: "s", ownership });
    const events: AgentEvent[] = [];
    for await (const event of session.continueStream()) events.push(event);
    const started = events.find((event) => event.type === "run.started");
    assert.ok(started?.type === "run.started" && started.continued === true);
    assert.equal(
      events.some((event) => event.type === "package.event" && event.name === "history.repaired"),
      false,
      "the provider-view repair finds nothing left to answer",
    );
    // The result is persisted in the branch, before the model turn.
    const messages = await session.messages();
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );
    assert.equal(toolResultsOf(messages)[0]?.error?.code, "tool_call_interrupted");
    assert.equal(toolResultsOf(requests[0]!.messages)[0]?.error?.code, "tool_call_interrupted");
    assert.equal(counter.count, 0);
    await agent.dispose();
  });

  it("dispatched_effect_is_marked_unknown_and_not_rerun", async () => {
    const store = createMemorySessionStore();
    const effectStore = createMemoryToolEffectStore();
    const counter = { count: 0 };
    let dispatched!: () => void;
    const inFlight = new Promise<void>((resolve) => (dispatched = resolve));
    // Process A: the tool is dispatched and never returns.
    const processA = await createAgent({
      model,
      packages: [providerPackage("p", [scriptedProvider([], ["call:c1"])])],
      slots: { store },
      effectStore,
      tools: {
        add: [
          mutateTool(counter, (signal) => {
            dispatched();
            return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
          }),
        ],
      },
    });
    const sessionA = await processA.session({ id: "s", create: true, ownership });
    const runA = sessionA.run("do it");
    await inFlight;
    const runAId = (await store.list("s")).find((entry) => entry.message?.role === "assistant")?.runId;
    assert.ok(runAId);
    assert.equal((await effectStore.get(effectKey("s", runAId, "c1")))?.status, "dispatched");

    // Process B: the same stores, a fresh agent.
    const requests: ProviderRequest[] = [];
    const processB = await agentOver({ store, requests, counter, effectStore, script: ["checked"] });
    const sessionB = await processB.session({ id: "s", ownership });
    const result = await sessionB.continue();
    assert.equal(result.status, "completed");
    assert.equal(counter.count, 1, "the in-flight call is not re-dispatched");
    assert.equal((await effectStore.get(effectKey("s", runAId, "c1")))?.status, "unknown");
    const settled = toolResultsOf(await sessionB.messages())[0];
    assert.equal(settled?.error?.code, "tool_call_outcome_unknown");
    assert.match(settled?.error?.message ?? "", /unknown/);
    assert.match(settled?.error?.message ?? "", /Verify/);

    sessionA.abort("test over");
    await runA.catch(() => undefined);
    await processA.dispose();
    await processB.dispose();
  });

  it("unknown_effect_and_version_conflict_settle_as_outcome_unknown", async () => {
    const store = createMemorySessionStore();
    await seedCrashedBranch(store, "s", "run-dead", "c1");
    const effectStore = createMemoryToolEffectStore();
    const key = effectKey("s", "run-dead", "c1");
    const begun = await effectStore.begin(key);
    const record = await effectStore.markDispatched({
      ...key,
      claimToken: begun.record.claimToken!,
      expectedVersion: begun.record.version,
    });
    await effectStore.markUnknown({ ...key, claimToken: begun.record.claimToken!, expectedVersion: record.version });
    const agent = await agentOver({ store, requests: [], effectStore, script: ["ok"] });
    const session = await agent.session({ id: "s", ownership });
    assert.equal((await session.continue()).status, "completed");
    assert.equal(toolResultsOf(await session.messages())[0]?.error?.code, "tool_call_outcome_unknown");
    await agent.dispose();
  });

  it("completed_effect_settles_with_its_stored_result", async () => {
    const store = createMemorySessionStore();
    await seedCrashedBranch(store, "s", "run-dead", "c1");
    const effectStore = createMemoryToolEffectStore();
    const key = effectKey("s", "run-dead", "c1");
    const begun = await effectStore.begin(key);
    const claim = { ...key, claimToken: begun.record.claimToken! };
    const dispatchedRecord = await effectStore.markDispatched({ ...claim, expectedVersion: begun.record.version });
    await effectStore.complete({
      ...claim,
      expectedVersion: dispatchedRecord.version,
      result: { toolCallId: "c1", name: "mutate", value: "the real result" },
    });
    const requests: ProviderRequest[] = [];
    const counter = { count: 0 };
    const agent = await agentOver({ store, requests, counter, effectStore, script: ["ok"] });
    const session = await agent.session({ id: "s", ownership });
    assert.equal((await session.continue()).status, "completed");
    const settled = toolResultsOf(await session.messages())[0];
    assert.equal(settled?.error, undefined);
    assert.equal(JSON.stringify(settled).includes("the real result"), true);
    assert.equal(counter.count, 0);
    await agent.dispose();
  });

  it("continue_rejects_when_nothing_is_owed", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    const agent = await agentOver({ store, requests, script: ["answer"] });
    const empty = await agent.session({ id: "empty", create: true });
    const onEmpty = await rejection(empty.continue());
    assert.ok(onEmpty instanceof SessionContinueError);
    assert.equal(onEmpty.code, "nothing_to_continue");

    const session = await agent.session({ id: "s", create: true });
    assert.equal((await session.run("hi")).status, "completed");
    const entries = (await store.list("s")).length;
    const error = await rejection(session.continue());
    assert.ok(error instanceof SessionContinueError);
    // The stream form rejects the same way, and neither wrote anything or called the provider.
    const streamed = await rejection(
      (async () => {
        for await (const _ of session.continueStream()) {
          // drain
        }
      })(),
    );
    assert.ok(streamed instanceof SessionContinueError);
    assert.equal((await store.list("s")).length, entries);
    assert.equal(requests.length, 1);
    await agent.dispose();
  });

  it("continue_rejects_on_pending_suspension", async () => {
    const requests: ProviderRequest[] = [];
    const agent = await createAgent({
      model,
      packages: [providerPackage("p", [scriptedProvider(requests, ["call:c1"])])],
      slots: { store: createMemorySessionStore() },
      hooks: askEveryTool(),
      tools: { add: [mutateTool({ count: 0 })] },
    });
    const session = await agent.session({ id: "s", create: true, ownership });
    const first = await session.run("go");
    assert.equal(first.status, "suspended");
    const error = await rejection(session.continue());
    assert.ok(error instanceof AgentDecisionError);
    // The suspension is still resumable.
    const resumed: AgentEvent[] = [];
    for await (const event of session.resume(first.pending!.map((p) => ({ approvalId: p.approvalId, outcome: "allow_once" as const }))))
      resumed.push(event);
    assert.ok(resumed.some((event) => event.type === "run.completed"));
    await agent.dispose();
  });

  for (const loopKind of ["default", "custom"] as const) {
    it(`continue_fires_the_same_hooks_as_run (${loopKind} loop)`, async () => {
      const loop: LoopStrategy | undefined =
        loopKind === "custom"
          ? {
              name: "one-turn",
              async run(run) {
                await run.turn();
              },
            }
          : undefined;
      const fired = (): { hooks: Set<string>; register: Parameters<typeof createAgent>[0]["hooks"] } => {
        const hooks = new Set<string>();
        return {
          hooks,
          register: (registrar) => {
            for (const name of ["run.input", "message.append", "context.build", "model.request", "model.response"] as const) {
              registrar.on(name, ((value: unknown) => {
                hooks.add(name);
                return value;
              }) as never);
            }
          },
        };
      };
      // A normal run.
      const normal = fired();
      const runAgent = await agentOver({ store: createMemorySessionStore(), requests: [], script: ["a"], loop, hooks: normal.register });
      await (await runAgent.session()).run("hi");
      await runAgent.dispose();
      // A continuation of a branch whose run died before its first answer.
      const store = createMemorySessionStore();
      await store.append(createSessionEntry({ sessionId: "s", kind: "message", message: user("hi") }));
      const continued = fired();
      const continueAgent = await agentOver({ store, requests: [], script: ["a"], loop, hooks: continued.register });
      const result = await (await continueAgent.session({ id: "s" })).continue();
      assert.equal(result.status, "completed");
      assert.deepEqual([...continued.hooks].sort(), [...normal.hooks].sort());
      await continueAgent.dispose();
    });
  }

  it("continue_respects_ownership_scope", async () => {
    const store = createMemorySessionStore();
    await seedCrashedBranch(store, "s", "run-dead", "c1");
    const agent = await agentOver({ store, requests: [], script: ["ok"] });
    const session = await agent.session({ id: "s" });
    const entries = (await store.list("s")).length;
    const foreign = await rejection(session.continue({ ownership: { tenantId: "other" } }));
    assert.ok(foreign instanceof SessionNotFoundError);
    assert.equal((await store.list("s")).length, entries, "the scope check runs before any append");
    assert.equal((await session.continue({ ownership })).status, "completed");
    await agent.dispose();
  });
});
