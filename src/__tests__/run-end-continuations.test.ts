import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, Message, ProviderRequest, RunLimits } from "../contracts.js";
import {
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  type HookRegistrar,
  type RunEndPayload,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

/**
 * Agent whose every turn answers in text. A `run.end` handler runs after the loop ends naturally;
 * each continuation it asks for re-enters the loop and costs one more provider turn.
 */
async function textAgent(options: {
  readonly requests: ProviderRequest[];
  readonly onEnd?: (registrar: HookRegistrar) => void;
  readonly limits?: RunLimits;
}) {
  return await createAgent({
    id: "run-end",
    slots: { store: createMemorySessionStore() },
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [{
      id: "mock",
      async *generate(request) {
        options.requests.push(request);
        yield providerTextDelta(`turn ${options.requests.length}`);
        yield providerDone();
      },
    }])],
    ...(options.onEnd ? { hooks: options.onEnd } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  });
}

function textOccurrences(request: ProviderRequest, text: string): number {
  return request.messages.filter((message) => message.content.some((block) => block.type === "text" && block.text.includes(text))).length;
}

function historyOccurrences(history: readonly Message[], text: string): number {
  return history.filter((message) => message.content.some((block) => block.type === "text" && block.text.includes(text))).length;
}

describe("run.end continuations", () => {
  it("continues once, then stops, without replaying run-start input", async () => {
    const requests: ProviderRequest[] = [];
    const seen: RunEndPayload[] = [];
    const session = await (
      await textAgent({
        requests,
        onEnd: (hooks) =>
          hooks.on("run.end", (payload) => {
            seen.push(payload);
            return payload.continuations === 0 ? { continue: { reason: "address the deferred items" } } : undefined;
          }),
      })
    ).session({ id: "continue-once", create: true });

    const result = await session.run("investigate");

    assert.equal(result.status, "completed");
    assert.equal(result.stopReason, undefined, "a handler that stops leaves a natural end");
    assert.equal(requests.length, 2, "one continuation costs one more provider turn");
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.continuations, 0);
    assert.equal(seen[1]?.continuations, 1, "continuations counts the asks already taken");
    assert.equal(seen[0]?.sessionId, "continue-once");
    assert.equal(seen[0]?.runId, result.runId);
    assert.equal(seen[0]?.turn, 1);
    assert.equal(seen[1]?.turn, 2, "turn counts provider turns across the whole run");
    assert.equal(textOccurrences(requests[0] as ProviderRequest, "investigate"), 1);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "investigate"), 1, "run-start input is never replayed");
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "address the deferred items"), 1, "the continuation reason is delivered");
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "turn 1"), 1, "history carries the first turn");
    assert.equal(historyOccurrences(seen[0]?.history ?? [], "investigate"), 1);
    assert.equal(historyOccurrences(seen[1]?.history ?? [], "investigate"), 1);
  });

  it("queues an optional steer message after the continuation reason", async () => {
    const requests: ProviderRequest[] = [];
    const result = await (
      await (
        await textAgent({
          requests,
          onEnd: (hooks) =>
            hooks.on("run.end", (payload) =>
              payload.continuations === 0 ? { continue: { reason: "finish the report", steer: "also check margins" } } : undefined,
            ),
        })
      ).session()
    ).run("go");
    assert.equal(result.status, "completed");
    assert.equal(requests.length, 2);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "finish the report"), 1);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "also check margins"), 1);
  });

  it("run_end_todo_continuation_capped_by_max_continuations", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: ProviderRequest[] = [];
    let continueAlways = true;
    const agent = await textAgent({
      requests,
      onEnd: (hooks) => hooks.on("run.end", () => (continueAlways ? { continue: { reason: "again" } } : undefined)),
    });
    const session = await agent.session({ id: "capped", create: true });

    const result = await session.run("go", {
      runState: { checkpoints, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    assert.equal(result.status, "stopped");
    assert.equal(result.stopReason, "hook_limit", "the cap is a clean stop, not an error");
    assert.equal(requests.length, 4, "default cap 3 allows three continuation turns");

    const state = await loadAgentRunState(checkpoints, { runId: result.runId });
    assert.equal(state.state.status, "succeeded");
    assert.equal(state.state.stopReason, "hook_limit");

    continueAlways = false;
    const resumed = await resumeAgentRun(
      agent,
      { runId: result.runId, sessionId: "capped" },
      { decision: "continue", expectedVersion: state.record.version },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.stopReason, undefined, "the resumed leg ends naturally once the handler stops");
  });

  it("observes run.end but never continues at maxContinuations: 0", async () => {
    const requests: ProviderRequest[] = [];
    const seen: number[] = [];
    const result = await (
      await (
        await textAgent({
          requests,
          onEnd: (hooks) =>
            hooks.on("run.end", (payload) => {
              seen.push(payload.continuations);
              return { continue: { reason: "never delivered" } };
            }),
        })
      ).session()
    ).run("go", { limits: { maxContinuations: 0 } });
    assert.equal(result.status, "stopped");
    assert.equal(result.stopReason, "hook_limit");
    assert.deepEqual(seen, [0], "the handler is consulted once");
    assert.equal(requests.length, 1, "no continuation turn runs");
    assert.equal(textOccurrences(requests[0] as ProviderRequest, "never delivered"), 0);
  });

  it("drops a run.input-rejected continuation steer and still runs the continuation", async () => {
    const requests: ProviderRequest[] = [];
    const events: AgentEvent[] = [];
    const agent = await createAgent({
      id: "run-end",
      slots: { store: createMemorySessionStore() },
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [{
        id: "mock",
        async *generate(request) {
          requests.push(request);
          yield providerTextDelta(`turn ${requests.length}`);
          yield providerDone();
        },
      }])],
      hooks: (hooks) => {
        // A steered continuation carrying "deferred" is dropped by `run.input`.
        hooks.on("run.input", (messages) =>
          messages.some((message) => message.content.some((block) => block.type === "text" && block.text.includes("deferred")))
            ? []
            : messages,
        );
        hooks.on("run.end", (payload) =>
          payload.continuations === 0 ? { continue: { reason: "address the deferred items" } } : undefined,
        );
      },
    });
    const session = await agent.session();
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();

    const result = await session.run("go");
    await pump;

    assert.equal(result.status, "completed");
    assert.equal(result.stopReason, undefined, "a dropped steer does not cancel the continuation");
    assert.equal(requests.length, 2);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "deferred"), 0, "the rejected reason never reaches the provider");
    assert.ok(
      events.some((event) => event.type === "package.event" && event.name === "steer.rejected"),
      "the rejection is observable",
    );
  });

  it("fails the run closed when a handler throws, and treats a malformed decision as no continuation", async () => {
    const requests: ProviderRequest[] = [];
    const agent = await textAgent({
      requests,
      onEnd: (hooks) =>
        hooks.on("run.end", () => {
          throw new Error("hook bug");
        }),
    });
    const outcome = await (await agent.session()).run("go");
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.stopReason, undefined);
    assert.equal(requests.length, 1, "the provider turn happened before run.end");
    assert.match(outcome.error?.message ?? "", /hook bug/);

    // A `continue` with no reason (or a non-object) never reaches the steer path: the run ends.
    for (const bad of [{ continue: {} }, { continue: 42 }, { continue: { reason: "" } }] as never[]) {
      const malformedRequests: ProviderRequest[] = [];
      const result = await (
        await (await textAgent({ requests: malformedRequests, onEnd: (hooks) => hooks.on("run.end", () => bad) })).session()
      ).run("go");
      assert.equal(result.status, "completed");
      assert.equal(result.stopReason, undefined, "a malformed decision ends the run cleanly");
      assert.equal(malformedRequests.length, 1);
    }
  });

  it("leaves the runtime path untouched when no handler is registered", async () => {
    const baselineRequests: ProviderRequest[] = [];
    const baseline = await (
      await (await await textAgent({ requests: baselineRequests })).session({ id: "bus-identity", create: true })
    ).run("go");
    const emptyRequests: ProviderRequest[] = [];
    const empty = await (
      await (await textAgent({ requests: emptyRequests, onEnd: (hooks) => void hooks })).session({ id: "bus-identity", create: true })
    ).run("go");
    assert.equal(baseline.status, "completed");
    assert.equal(empty.status, "completed");
    assert.equal(empty.stopReason, undefined);
    assert.equal(JSON.stringify(emptyRequests), JSON.stringify(baselineRequests), "an empty bus must not perturb requests");
  });

  it("consults every registered handler and lets the first continue win", async () => {
    const calls: string[] = [];
    const requests: ProviderRequest[] = [];
    const result = await (
      await (
        await textAgent({
          requests,
          onEnd: (hooks) => {
            hooks.on("run.end", () => {
              calls.push("first");
              return undefined;
            });
            hooks.on("run.end", (payload) => {
              calls.push(`second:${payload.continuations}`);
              return payload.continuations === 0 ? { continue: { reason: "second wins" } } : undefined;
            });
            hooks.on("run.end", () => {
              calls.push("third");
              return undefined;
            });
          },
        })
      ).session()
    ).run("go");
    assert.equal(result.status, "completed");
    assert.deepEqual(calls, ["first", "second:0", "third", "first", "second:1", "third"], "every handler is consulted, in order");
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "second wins"), 1);
  });

  it("a run overlay may only narrow maxContinuations", async () => {
    const requests: ProviderRequest[] = [];
    const seen: number[] = [];
    const result = await (
      await (
        await textAgent({
          requests,
          limits: { maxContinuations: 1 },
          onEnd: (hooks) =>
            hooks.on("run.end", () => {
              seen.push(seen.length + 1);
              return { continue: { reason: "again" } };
            }),
        })
      ).session()
    ).run("go", { limits: { maxContinuations: 3 } });
    assert.equal(result.stopReason, "hook_limit");
    assert.equal(seen.length, 2, "the agent layer's cap wins: one continuation, second refused");
    assert.equal(requests.length, 2);
  });
});
