import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  type LoopStrategy,
  type ModelConfig,
  type ModelProvider,
  type ProviderRequest,
  type Session,
  createAgent,
  defaultLoop,
  providerDone,
  providerTextDelta,
} from "../index.js";
import { classifyProviderFailure, providerPackage } from "../provider-kit/index.js";
import { failedRun } from "./run-result-helpers.js";

/** A small window keeps the overflow fallback (estimate > window) cheap to trigger. */
const model: ModelConfig = { provider: "mock", model: "demo", limits: { contextWindow: 2_000, maxOutputTokens: 100 } };

const overflowInfo = {
  name: "ProviderHttpError",
  message: "provider request failed: 400 This endpoint's maximum context length is 204800 tokens",
  code: 400,
  failureClass: "context_overflow" as const,
};

type Step = "overflow" | "overflow_after_start" | "ok";

/** A provider that plays the given script in order and records every request it sees. */
function scriptedProvider(steps: readonly Step[]): { provider: ModelProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        const step = steps[Math.min(requests.length - 1, steps.length - 1)] ?? "ok";
        if (step === "overflow_after_start") {
          yield providerTextDelta("partial ");
          yield { type: "error" as const, error: overflowInfo };
          return;
        }
        if (step === "overflow") {
          yield { type: "error" as const, error: overflowInfo };
          return;
        }
        yield providerTextDelta("recovered");
        yield providerDone({ inputTokens: 100, outputTokens: 10 });
      },
    },
  };
}

function collectEvents(session: Session): { events: AgentEvent[]; done: Promise<void> } {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  return { events, done };
}

async function runOnce(
  steps: readonly Step[],
  options: { readonly hooks?: import("../index.js").AgentConfig["hooks"]; readonly limits?: import("../index.js").RunLimits } = {},
): Promise<{ session: Session; events: AgentEvent[]; requests: ProviderRequest[]; result: import("../index.js").RunResult }> {
  const { provider, requests } = scriptedProvider(steps);
  const agent = await createAgent({
    model,
    packages: [providerPackage("test-provider", [provider])],
    compaction: { keepRecentEntries: 1 },
    ...(options.hooks ? { hooks: options.hooks } : {}),
  });
  const session = await agent.session({ id: `s-overflow-${Math.random()}`, create: true });
  const { events, done } = collectEvents(session);
  const result = await session.run("a long request", options.limits ? { limits: options.limits } : {});
  await done;
  return { session, events, requests, result };
}

describe("Provider failure classification (plan 194 Task 3)", () => {
  const statusError = (status: number, body: string) => Object.assign(new Error(`request failed: ${status} ${body}`), { code: status });

  it("classifies the recorded OpenCode Go overflow bodies", () => {
    assert.equal(classifyProviderFailure(statusError(400, "invalid params, context window exceeds limit (2013)")), "context_overflow");
    assert.equal(
      classifyProviderFailure(
        statusError(400, "This endpoint's maximum context length is 204800 tokens. However, you requested about 506266 tokens"),
      ),
      "context_overflow",
    );
  });

  it("classifies the other supported overflow patterns and SystemOne's 422", () => {
    assert.equal(classifyProviderFailure(statusError(400, "context_length_exceeded")), "context_overflow");
    assert.equal(
      classifyProviderFailure(statusError(400, "prompt too long; exceeded max context length by 28996 tokens")),
      "context_overflow",
      "Ollama Cloud's measured overflow body",
    );
    assert.equal(classifyProviderFailure(statusError(413, "prompt is too long")), "context_overflow");
    assert.equal(classifyProviderFailure(statusError(422, "invalid params: context window exceeds limit")), "context_overflow");
  });

  it("leaves an unrelated 400 permanent", () => {
    assert.equal(classifyProviderFailure(statusError(400, "invalid tool schema")), "permanent");
    assert.equal(classifyProviderFailure(statusError(500, "maximum context length")), "transient");
  });
});

describe("Context-overflow recovery (plan 194 Task 3)", () => {
  it("compacts once with trigger overflow and retries the same turn", async () => {
    const { session, events, requests, result } = await runOnce(["overflow", "ok"], {
      // A veto would still allow recovery: the provider already decided, so `compaction.when` is skipped.
      hooks: (hooks) => hooks.on("compaction.when", () => ({ compact: false })),
    });
    assert.equal(result.status, "completed");
    assert.equal(requests.length, 2, "one retried provider call");
    const entries = await session.entries();
    const compaction = entries.find((entry) => entry.kind === "compaction");
    assert.ok(compaction, "an overflow compaction entry was stored");
    assert.equal((compaction.data as { trigger?: string }).trigger, "overflow");
    const completed = events.filter((event) => event.type === "compaction.completed");
    assert.equal(completed.length, 1, "exactly one compaction");
    assert.equal(completed[0]?.trigger, "overflow");
    assert.ok(
      events.some((event) => event.type === "turn.completed" && event.error),
      "the rejected attempt is observable",
    );
    await session.close();
  });

  it("does not charge maxTurns twice and records no estimate for the rejected attempt", async () => {
    const { events, result } = await runOnce(["overflow", "ok"], { limits: { maxTurns: 1 } });
    assert.equal(result.status, "completed", "the retry stays inside the same turn");
    const turns = events.filter((event) => event.type === "turn.completed");
    const failedAttempt = turns.find((event) => event.error !== undefined);
    assert.ok(failedAttempt, "the failed attempt settled");
    assert.equal(failedAttempt.usage, undefined, "a rejected request does not project usage");
    assert.equal(result.usage?.inputTokens, 100, "only the call that ran is recorded");
  });

  it("fails a second overflow with ContextOverflowError after one compaction", async () => {
    const { events, requests, result } = await runOnce(["overflow", "overflow"]);
    const failed = await failedRun(Promise.resolve(result), /after compaction/, "failed");
    assert.equal(failed.error?.code, "context_overflow");
    assert.equal(requests.length, 2, "no third attempt");
    const completed = events.filter((event) => event.type === "compaction.completed");
    assert.equal(completed.length, 1);
  });

  it("fails without retrying when output already started", async () => {
    const { events, requests, result } = await runOnce(["overflow_after_start", "ok"]);
    const failed = await failedRun(Promise.resolve(result), /already started a response/, "failed");
    assert.equal(failed.error?.code, "context_overflow");
    assert.equal(requests.length, 1, "no replay of a started stream");
    assert.equal(events.filter((event) => event.type === "compaction.completed").length, 0);
  });

  it("falls through to ContextOverflowError when the recovery compaction fails", async () => {
    const { provider, requests } = scriptedProvider(["overflow", "ok"]);
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      slots: {
        compaction: {
          name: "boom",
          compact() {
            throw new Error("summarizer down");
          },
        },
      },
    });
    const session = await agent.session({ id: "s-overflow-compaction-fails", create: true });
    const result = await session.run("a long request");
    const failed = await failedRun(Promise.resolve(result), /after compaction/, "failed");
    assert.equal(failed.error?.code, "context_overflow");
    assert.equal(requests.length, 1, "no retry without a compacted branch");
    assert.equal((await session.entries()).filter((entry) => entry.kind === "compaction").length, 0);
  });

  it("aborts during recovery without appending anything", async () => {
    const { provider, requests } = scriptedProvider(["overflow", "ok"]);
    const controller = new AbortController();
    const agent = await createAgent({
      model,
      packages: [providerPackage("test-provider", [provider])],
      slots: {
        compaction: {
          name: "aborting",
          compact() {
            // The abort lands inside recovery, after the provider already rejected the request.
            controller.abort(new Error("cancelled during recovery"));
            throw new Error("compaction stopped");
          },
        },
      },
    });
    const session = await agent.session({ id: "s-overflow-abort", create: true });
    const result = await failedRun(session.run("a long request", { signal: controller.signal }), /cancel|abort/i, "aborted");
    assert.equal(result.status, "aborted");
    assert.equal(requests.length, 1, "no retry after the abort");
    const messages = (await session.entries()).filter((entry) => entry.kind === "message");
    assert.equal(messages.length, 1, "only the run input remains");
  });

  it("recovers from the default loop and a custom loop", async () => {
    const custom: LoopStrategy = {
      name: "overflow-custom",
      revision: "1",
      async run(run) {
        for (;;) {
          const turn = await run.turn();
          if (turn.stopped) return;
          if (turn.toolCalls.length > 0) {
            await run.executeTools(turn.toolCalls);
            continue;
          }
          const end = await run.end();
          if (!end.continue) return;
        }
      },
    };
    for (const [name, loop] of [
      ["defaultLoop", defaultLoop],
      ["customLoop", custom],
    ] as const) {
      const { provider, requests } = scriptedProvider(["overflow", "ok"]);
      const agent = await createAgent({ model, slots: { loop }, packages: [providerPackage("test-provider", [provider])] });
      const session = await agent.session({ id: `s-overflow-${name}`, create: true });
      const result = await session.run("a long request");
      assert.equal(result.status, "completed", `${name} recovers`);
      assert.equal(requests.length, 2, `${name} retried once`);
      await session.close();
    }
  });
});
