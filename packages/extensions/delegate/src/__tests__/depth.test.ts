import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type Message,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate, { DELEGATE_SERVICE, type DelegateService } from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

const textOf = (message: Message | undefined): string => JSON.stringify(message?.content ?? "");

/** The user brief a session started from: the first user message of its request. */
const briefOf = (request: ProviderRequest): string => textOf(request.messages.find((message) => message.role === "user"));

/**
 * Root ("go") delegates `level one`; a session that still sees `delegate` delegates one level deeper; the deepest
 * session calls `probe`, which asks the delegate service to go one level further. Every turn is 5 tokens.
 */
function treeProvider(seenTools: Map<string, string[]>): ModelProvider {
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const brief = briefOf(request);
      const level = /level (one|two|three)/.exec(brief)?.[1] ?? "root";
      if (!seenTools.has(level)) seenTools.set(level, tools);
      const last = request.messages.at(-1);
      if (last?.role === "tool") yield providerTextDelta(`${level} saw ${textOf(last)}`);
      else if (tools.includes("delegate")) {
        const next = level === "root" ? "one" : level === "one" ? "two" : "three";
        yield providerToolCall(toolCallContent(`call_${level}`, "delegate", { child: "worker", input: `level ${next}` }));
      } else if (tools.includes("probe")) yield providerToolCall(toolCallContent(`probe_${level}`, "probe", {}));
      else yield providerTextDelta(`leaf ${level}`);
      yield providerDone({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    },
  };
}

/** `probe` asks the delegate service for one more level from the session it runs in. */
const probeTools = definePackage({
  name: "probe-tools",
  version: "0.0.0",
  requires: { api: 2 },
  setup(prism) {
    prism.tools.register({
      name: "probe",
      description: "test only",
      async execute(_args, context) {
        const service = prism.services.require<DelegateService>(DELEGATE_SERVICE);
        try {
          await service.start({ child: "worker", input: "level three", mode: "sync", session: context.session as never });
          return { toolCallId: context.toolCallId, name: "probe", content: [{ type: "text", text: "probe started a child" }] };
        } catch (error) {
          return {
            toolCallId: context.toolCallId,
            name: "probe",
            content: [{ type: "text", text: `probe refused: ${(error as Error).message}` }],
          };
        }
      },
    });
  },
});

async function build(maxDepth: number, seenTools: Map<string, string[]>): Promise<Agent> {
  const agent = await createAgent({
    id: "depth-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("mock-provider", [treeProvider(seenTools)]),
      probeTools(),
      delegate({ maxDepth, announceAsync: false, children: { worker: { inherit: ["probe-tools"], description: "Works." } } }),
    ],
  });
  agents.push(agent);
  return agent;
}

describe("delegate depth", () => {
  it("grandchild_runs_at_depth_two_and_is_refused_at_depth_three_when_max_is_two", async () => {
    const seen = new Map<string, string[]>();
    const agent = await build(2, seen);
    const root = await agent.session();
    const result = await root.run("go");
    assert.equal(result.status, "completed");
    // The child (depth 1) sees the delegate tools; the grandchild (depth 2 = maxDepth) sees neither them nor the skill.
    assert.ok(seen.get("one")?.includes("delegate"), "the child may delegate");
    assert.ok(seen.get("one")?.includes("delegate_wait"));
    assert.deepEqual(seen.get("two"), ["probe"], "the grandchild has only its inherited tool");
    // The grandchild's probe asked for a third level through the service: refused, fail closed.
    assert.match(result.text, /depth_exceeded: this session is at depth 2 and maxDepth is 2/);
    assert.equal(seen.has("three"), false, "no great-grandchild ran");
    // The tree is in the store: root → child → grandchild.
    const [child] = (await agent.sessions.list({ parentSessionId: root.id })).items;
    assert.ok(child);
    const [grandchild] = (await agent.sessions.list({ parentSessionId: child.sessionId })).items;
    assert.ok(grandchild, "the grandchild is linked to the child");
  });

  it("max_depth_one_keeps_the_child_away_from_delegate", async () => {
    const seen = new Map<string, string[]>();
    const agent = await build(1, seen);
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.deepEqual(seen.get("one"), ["probe"]);
    assert.match(result.text, /depth_exceeded: this session is at depth 1 and maxDepth is 1/);
  });

  it("grandchild_usage_charges_both_ancestors", async () => {
    const seen = new Map<string, string[]>();
    const agent = await build(2, seen);
    const result = await (await agent.session()).run("go");
    // Root 2 turns + child 2 turns + grandchild 2 turns (probe, answer), 5 tokens each: the root run carries all six.
    assert.equal(result.usage?.totalTokens, 30);
    // The child's own usage (its status line) holds its turns and the grandchild's, not the root's.
    assert.match(result.text, /child worker: completed, 2 turns, 20 tokens/);
  });

  it("max_depth_above_three_fails_the_load", async () => {
    await assert.rejects(
      createAgent({
        id: "too-deep",
        model: { provider: "mock", model: "m" },
        packages: [
          providerPackage("mock-provider", [treeProvider(new Map())]),
          delegate({ maxDepth: 4, children: { worker: { inherit: [] } } }),
        ],
      }),
      /maxDepth/,
    );
  });
});
