import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, Message, ProviderRequest, RunLimits, StopHook, StopHookContext } from "../contracts.js";
import {
  AgentRunError,
  activateKernel,
  createAgent,
  createExtensionKernel,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
} from "../index.js";

/**
 * Agent whose every turn answers in text. Stop hooks run after the loop ends naturally; each
 * continuation re-enters the loop and costs one more provider turn.
 */
function textAgent(options: {
  readonly requests: ProviderRequest[];
  readonly stopHooks?: readonly StopHook[];
  readonly limits?: RunLimits;
}) {
  return createAgent({
    id: "stop-hooks",
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        options.requests.push(request);
        yield providerTextDelta(`turn ${options.requests.length}`);
        yield providerDone();
      },
    },
    ...(options.stopHooks ? { stopHooks: options.stopHooks } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  });
}

function textOccurrences(request: ProviderRequest, text: string): number {
  return request.messages.filter((message) => message.content.some((block) => block.type === "text" && block.text.includes(text))).length;
}

function hookTextOccurrences(history: readonly Message[], text: string): number {
  return history.filter((message) => message.content.some((block) => block.type === "text" && block.text.includes(text))).length;
}

describe("stop hooks", () => {
  it("continues once, then stops, without replaying run-start input", async () => {
    const requests: ProviderRequest[] = [];
    const seen: StopHookContext[] = [];
    const agent = textAgent({ requests });
    const session = agent.createSession({ id: "continue-once" });

    const result = await session.run("investigate", {
      stopHooks: [
        {
          name: "nag",
          decide: (ctx) => {
            seen.push(ctx);
            return ctx.stopHookActive ? { action: "stop" } : { action: "continue", reason: "address the deferred items" };
          },
        },
      ],
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.stopReason, undefined, "a hook that stops leaves a natural end");
    assert.equal(requests.length, 2, "one continuation costs one more provider turn");
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.stopHookActive, false);
    assert.equal(seen[1]?.stopHookActive, true, "stopHookActive is true after the first continuation");
    assert.equal(seen[0]?.sessionId, "continue-once");
    assert.equal(seen[0]?.runId, result.runId);
    assert.equal(seen[0]?.turn, 1);
    assert.equal(seen[1]?.turn, 2, "turn counts provider turns across the whole run");
    assert.ok(seen[0]?.signal instanceof AbortSignal);
    assert.deepEqual(seen[0]?.metadata, {});
    assert.equal(textOccurrences(requests[0] as ProviderRequest, "investigate"), 1);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "investigate"), 1, "run-start input is never replayed");
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "address the deferred items"), 1, "the continuation reason is delivered");
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "turn 1"), 1, "history carries the first turn");
    assert.equal(hookTextOccurrences(seen[0]?.history ?? [], "investigate"), 1);
    assert.equal(hookTextOccurrences(seen[1]?.history ?? [], "investigate"), 1);
  });

  it("queues an optional steer message after the continuation reason", async () => {
    const requests: ProviderRequest[] = [];
    const agent = textAgent({ requests });
    const result = await agent.createSession({ id: "steered-hook" }).run("go", {
      stopHooks: [
        {
          name: "nag",
          decide: (ctx) =>
            ctx.stopHookActive ? { action: "stop" } : { action: "continue", reason: "finish the report", steer: "also check margins" },
        },
      ],
    });
    assert.equal(result.status, "succeeded");
    assert.equal(requests.length, 2);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "finish the report"), 1);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "also check margins"), 1);
  });

  it("caps continuations at maxStopContinuations and resumes the hook_limit checkpoint", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const requests: ProviderRequest[] = [];
    const agent = textAgent({ requests });
    let continueAlways = true;
    const hook: StopHook = {
      name: "always",
      decide: () => (continueAlways ? { action: "continue", reason: "again" } : { action: "stop" }),
    };
    const session = agent.createSession({ id: "capped" });

    const result = await session.run("go", {
      stopHooks: [hook],
      runState: { checkpoints, definitionRevision: "1", checkpointPolicy: "every-turn" },
    });
    assert.equal(result.status, "succeeded");
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
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.stopReason, undefined, "the resumed leg ends naturally once the hook stops");
  });

  it("observes stop hooks but never continues at maxStopContinuations: 0", async () => {
    const requests: ProviderRequest[] = [];
    const seen: string[] = [];
    const agent = textAgent({ requests });
    const result = await agent.createSession({ id: "observe-only" }).run("go", {
      limits: { maxStopContinuations: 0 },
      stopHooks: [
        {
          name: "observed",
          decide: (ctx) => {
            seen.push(ctx.stopHookActive ? "active" : "first");
            return { action: "continue", reason: "never delivered" };
          },
        },
      ],
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.stopReason, "hook_limit");
    assert.deepEqual(seen, ["first"], "the hook is consulted once");
    assert.equal(requests.length, 1, "no continuation turn runs");
    assert.equal(textOccurrences(requests[0] as ProviderRequest, "never delivered"), 0);
  });

  it("drops a guardrail-rejected continuation steer and still runs the continuation", async () => {
    const requests: ProviderRequest[] = [];
    const events: AgentEvent[] = [];
    const agent = textAgent({ requests });
    const session = agent.createSession({ id: "guarded-hook" });
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();

    const result = await session.run("go", {
      guardrails: {
        input: [
          {
            name: "no-deferred",
            stage: "input",
            evaluate: (ctx) =>
              ctx.value.some((message) => message.content.some((block) => block.type === "text" && block.text.includes("deferred")))
                ? { action: "block", reason: "blocked by policy" }
                : { action: "allow" },
          },
        ],
      },
      stopHooks: [
        {
          name: "nag",
          decide: (ctx) => (ctx.stopHookActive ? { action: "stop" } : { action: "continue", reason: "address the deferred items" }),
        },
      ],
    });
    await pump;

    assert.equal(result.status, "succeeded");
    assert.equal(result.stopReason, undefined, "a dropped steer does not cancel the continuation");
    assert.equal(requests.length, 2);
    assert.equal(textOccurrences(requests[1] as ProviderRequest, "deferred"), 0, "the rejected reason never reaches the provider");
    assert.ok(
      events.some((event) => event.type === "steer_rejected"),
      "the rejection is observable",
    );
  });

  it("fails the run closed with ERR_PRISM_STOP_HOOK on a throwing or malformed hook", async () => {
    const requests: ProviderRequest[] = [];
    const agent = textAgent({ requests });
    const outcome = await agent
      .createSession({ id: "throwing" })
      .run("go", {
        stopHooks: [
          {
            name: "boom",
            decide: () => {
              throw new Error("hook bug");
            },
          },
        ],
      })
      .then(
        (result) => ({ result, error: undefined }),
        (error: unknown) => ({ result: undefined, error }),
      );
    assert.ok(outcome.error instanceof AgentRunError);
    assert.equal(outcome.error.result.error?.code, "ERR_PRISM_STOP_HOOK");
    assert.equal(outcome.error.result.stopReason, undefined);
    assert.equal(requests.length, 1, "the provider turn happened before the hook ran");

    const malformed: readonly StopHook[] = [
      { name: "bad-action", decide: () => ({ action: "maybe" }) as never },
      { name: "no-reason", decide: () => ({ action: "continue" }) as never },
      { name: "bad-steer", decide: () => ({ action: "continue", reason: "x", steer: 42 }) as never },
    ];
    for (const hook of malformed) {
      await assert.rejects(
        () => agent.createSession({ id: `bad-${hook.name}` }).run("go", { stopHooks: [hook] }),
        (error: unknown) => error instanceof AgentRunError && error.result.error?.code === "ERR_PRISM_STOP_HOOK",
        `hook ${hook.name} must fail closed`,
      );
    }
    await assert.rejects(
      () => agent.createSession({ id: "invalid" }).run("go", { stopHooks: [{ name: "" } as never] }),
      /stopHooks entries/,
      "a malformed registration fails before the run starts",
    );
  });

  it("leaves the runtime path untouched when no stop hooks are configured", async () => {
    const baselineRequests: ProviderRequest[] = [];
    const baseline = await textAgent({ requests: baselineRequests }).createSession({ id: "no-hooks" }).run("go");
    const emptyRequests: ProviderRequest[] = [];
    const empty = await textAgent({ requests: emptyRequests }).createSession({ id: "no-hooks" }).run("go", { stopHooks: [] });
    assert.equal(baseline.status, "succeeded");
    assert.equal(empty.status, "succeeded");
    assert.equal(empty.stopReason, undefined);
    assert.equal(JSON.stringify(emptyRequests), JSON.stringify(baselineRequests), "an empty list must not perturb requests");
  });

  it("merges agent and run stop hooks in order, and the run overlay only narrows the cap", async () => {
    const calls: string[] = [];
    const agentHook: StopHook = {
      name: "agent-hook",
      decide: () => {
        calls.push("agent");
        return { action: "stop" };
      },
    };
    const runHook: StopHook = {
      name: "run-hook",
      decide: () => {
        calls.push("run");
        return { action: "stop" };
      },
    };
    const merged = await textAgent({ requests: [], stopHooks: [agentHook] })
      .createSession({ id: "merge" })
      .run("go", { stopHooks: [runHook] });
    assert.equal(merged.status, "succeeded");
    assert.deepEqual(calls, ["agent", "run"], "every hook is consulted, agent hooks first");

    const requests: ProviderRequest[] = [];
    const seen: number[] = [];
    const continueHook: StopHook = {
      name: "counter",
      decide: () => {
        seen.push(seen.length + 1);
        return { action: "continue", reason: "again" };
      },
    };
    const narrowed = await textAgent({ requests, stopHooks: [continueHook], limits: { maxStopContinuations: 1 } })
      .createSession({ id: "narrow" })
      .run("go", { limits: { maxStopContinuations: 3 } });
    assert.equal(narrowed.stopReason, "hook_limit");
    assert.equal(seen.length, 2, "the agent layer's cap wins: one continuation, second refused");
    assert.equal(requests.length, 2);
  });

  it("activates extension-registered stop hooks and unwinds them on dispose", async () => {
    const kernel = createExtensionKernel();
    const [loaded] = await kernel.load([
      {
        name: "ext",
        setup: (api) => {
          api.registerStopHook({ name: "ext-hook", decide: () => ({ action: "continue", reason: "from extension" }) });
        },
      },
    ]);
    const activated = activateKernel(kernel);
    assert.deepEqual(
      activated.stopHooks.map((hook) => hook.name),
      ["ext-hook"],
    );

    const requests: ProviderRequest[] = [];
    const result = await textAgent({ requests, stopHooks: activated.stopHooks }).createSession({ id: "ext-hook" }).run("go");
    assert.equal(result.stopReason, "hook_limit", "the always-continue extension hook hits the default cap");
    assert.equal(requests.length, 4);

    loaded?.dispose();
    assert.equal(kernel.registries.stopHooks.get("ext-hook"), undefined, "dispose unwinds the registration");
  });
});
