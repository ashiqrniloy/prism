import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type RunResult,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import advisor from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

interface Seen {
  readonly advisor: string[];
  readonly parent: string[];
}

/** Parent turns follow `plan`; the advisor answers with the next `advice` (or throws). */
function scripted(seen: Seen, plan: readonly ("tool" | "text")[], advice: readonly string[] | "error"): ModelProvider {
  let parentCalls = 0;
  let advisorCalls = 0;
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const lastText = JSON.stringify(request.messages.at(-1)?.content ?? "");
      if (!tools.includes("write")) {
        advisorCalls += 1;
        seen.advisor.push(lastText);
        if (advice === "error") throw new Error("provider exploded");
        yield providerTextDelta(advice[Math.min(advisorCalls - 1, advice.length - 1)] ?? '{"verdict":"proceed","advice":""}');
        yield providerDone({ totalTokens: 7 });
        return;
      }
      seen.parent.push(lastText);
      const step = plan[parentCalls] ?? "text";
      parentCalls += 1;
      if (step === "tool") yield providerToolCall(toolCallContent(`call_w${parentCalls}`, "write", { path: "a" } as never));
      else yield providerTextDelta("final answer");
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

const executed: string[] = [];

const writeTool = definePackage({
  name: "write-tool",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "write",
      description: "write a file",
      execute: (_args, context) => {
        executed.push(context.toolCallId);
        return { toolCallId: context.toolCallId, name: "write", content: [{ type: "text", text: "written" }] };
      },
    });
  },
});

async function run(options: {
  readonly plan: readonly ("tool" | "text")[];
  readonly advice: readonly string[] | "error";
  readonly config?: Record<string, unknown>;
  readonly limits?: Record<string, number>;
}): Promise<{ seen: Seen; events: AgentEvent[]; result: RunResult }> {
  executed.length = 0;
  const seen: Seen = { advisor: [], parent: [] };
  const events: AgentEvent[] = [];
  const agent = await createAgent({
    id: "advisor-triggers",
    model: { provider: "mock", model: "m" },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.name === "advisor.consult") events.push(event);
      }),
    packages: [
      providerPackage("mock-provider", [scripted(seen, options.plan, options.advice)]),
      writeTool,
      advisor({ model: { provider: "mock", model: "m" }, tool: false, ...(options.config ?? {}) } as never),
    ],
  });
  agents.push(agent);
  const session = await agent.session();
  const result = await session.run("do the task");
  return { seen, events, result };
}

const consultData = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === "package.event" && event.name === "advisor.consult" ? [(event.data ?? {}) as Record<string, unknown>] : []));

describe("advisor review triggers", () => {
  it("before_tools_revise_denies_with_advice", async () => {
    const { seen, events } = await run({
      plan: ["tool", "text"],
      advice: ['{"verdict":"revise","advice":"use the patch tool instead"}'],
      config: { triggers: { beforeTools: ["write"] } },
    });
    assert.match(seen.parent[1] ?? "", /Advisor: use the patch tool instead/);
    assert.deepEqual(executed, []);
    assert.equal(consultData(events)[0]?.verdict, "revise");
  });

  it("before_tools_proceed_allows", async () => {
    const { seen, events } = await run({
      plan: ["tool", "text"],
      advice: ['{"verdict":"proceed","advice":""}'],
      config: { triggers: { beforeTools: ["write"] } },
    });
    assert.equal(executed.length, 1);
    assert.match(seen.parent[1] ?? "", /written/);
    assert.equal(consultData(events)[0]?.verdict, "proceed");
  });

  it("before_tools_ignores_unlisted_tools", async () => {
    const { seen, events } = await run({
      plan: ["tool", "text"],
      advice: ['{"verdict":"revise","advice":"no"}'],
      config: { triggers: { beforeTools: ["shell"] } },
    });
    assert.equal(seen.advisor.length, 0);
    assert.equal(executed.length, 1);
    assert.equal(consultData(events).length, 0);
  });

  it("before_tools_retry_same_args_skips_consult", async () => {
    const { seen } = await run({
      plan: ["tool", "tool", "text"],
      advice: ['{"verdict":"revise","advice":"reconsider"}'],
      config: { triggers: { beforeTools: ["write"] } },
    });
    // One consult for the first call; the identical retry is allowed without a second opinion.
    assert.equal(seen.advisor.length, 1);
    assert.equal(executed.length, 1);
  });

  it("before_finish_revise_continues_with_steer", async () => {
    const { seen, events, result } = await run({
      plan: ["text", "text"],
      advice: ['{"verdict":"revise","advice":"add tests before finishing"}', '{"verdict":"proceed","advice":""}'],
      config: { triggers: { beforeFinish: true } },
    });
    assert.equal(seen.parent.length, 2);
    assert.match(seen.parent[1] ?? "", /add tests before finishing/);
    assert.equal(result.status, "completed");
    const data = consultData(events);
    assert.deepEqual(
      data.map((entry) => entry.verdict),
      ["revise", "proceed"],
    );
  });

  it("before_finish_respects_max_continuations", async () => {
    const { seen, result } = await run({
      plan: ["text"],
      advice: ['{"verdict":"revise","advice":"keep going"}'],
      config: { triggers: { beforeFinish: true } },
      limits: { maxContinuations: 0 },
    });
    assert.equal(seen.parent.length, 1);
    assert.equal(result.stopReason, "hook_limit");
    assert.equal(seen.advisor.length, 1);
  });

  it("advisor_failure_never_blocks", async () => {
    const tool = await run({
      plan: ["tool", "text"],
      advice: "error",
      config: { triggers: { beforeTools: ["write"] } },
    });
    assert.equal(executed.length, 1);
    assert.equal(consultData(tool.events)[0]?.status, "skipped");

    const finish = await run({ plan: ["text"], advice: "error", config: { triggers: { beforeFinish: true } } });
    assert.equal(finish.result.status, "completed");
    assert.equal(consultData(finish.events)[0]?.status, "skipped");
  });

  it("advisor_failure_with_garbage_verdict_never_blocks", async () => {
    const { seen, events } = await run({
      plan: ["tool", "text"],
      advice: ["I think it is fine, probably."],
      config: { triggers: { beforeTools: ["write"] } },
    });
    assert.equal(executed.length, 1);
    assert.equal(seen.advisor.length, 1);
    assert.equal(consultData(events)[0]?.status, "skipped");
  });

  it("advisor_never_reenters_its_own_triggers", async () => {
    const { seen } = await run({
      plan: ["tool", "text"],
      advice: ['{"verdict":"proceed","advice":""}'],
      config: { triggers: { beforeTools: ["write"] } },
    });
    // Two parent turns, one tool call, one end: exactly one review consult, no consult of a consult.
    assert.equal(seen.advisor.length, 1);
    assert.equal(seen.parent.length, 2);
  });
});
