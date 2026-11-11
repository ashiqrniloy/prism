import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
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
import { mockProvider } from "@arnilo/prism/testing";
import delegate from "../index.js";

const MODEL = { provider: "mock", model: "m" } as const;
const CHILDREN = { reviewer: { inherit: [], description: "Reviews a diff.", instructions: "Review the diff." } } as const;

function textOf(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/** The first provider request of one run, optionally with the tool list narrowed or the children changed. */
async function firstRequest(options: { only?: readonly string[]; children?: Parameters<typeof delegate>[0] } = {}): Promise<{
  text: string;
  tools: readonly string[];
  skills: readonly { name: string; package?: string; requiresTools?: readonly string[] }[];
}> {
  const requests: ProviderRequest[] = [];
  const agent = await createAgent({
    model: MODEL,
    packages: [
      mockProvider([[{ type: "done" }]], { id: "mock", onRequest: (request) => requests.push(request) }),
      delegate(options.children ?? { children: CHILDREN }),
    ],
  });
  try {
    const session = await agent.session();
    await session.run("go", options.only === undefined ? {} : { tools: { only: [...options.only] } });
    const request = requests[0];
    assert.ok(request, "the run made a provider request");
    return { text: textOf(request.messages), tools: (request.tools ?? []).map((tool) => tool.name), skills: agent.inspect().skills };
  } finally {
    await agent.dispose();
  }
}

describe("@arnilo/prism-extensions/delegate skills", () => {
  it("delegate_registers_delegation_skill", async () => {
    const { text, tools, skills } = await firstRequest();
    const skill = skills.find((entry) => entry.name === "delegating-work");
    assert.ok(skill, "inspect().skills lists delegating-work");
    assert.equal(skill.package, "@arnilo/prism-extensions/delegate");
    assert.deepEqual(skill.requiresTools, ["delegate", "delegate_wait", "delegate_cancel"]);
    assert.ok(tools.includes("delegate"));
    assert.match(text, /- delegating-work: /);
  });

  it("delegate_skill_hidden_without_tools", async () => {
    const { text, skills } = await firstRequest({ only: [] });
    assert.doesNotMatch(text, /delegating-work/, "no tool is advertised, so the catalog omits the skill");
    assert.ok(
      skills.some((entry) => entry.name === "delegating-work"),
      "inspect still lists the hidden skill",
    );
  });

  it("delegate_skill_hidden_when_every_child_is_hidden", async () => {
    const { text, tools } = await firstRequest({ children: { children: { reviewer: { ...CHILDREN.reviewer, hidden: true } } } });
    assert.ok(!tools.includes("delegate"), "a hidden-only config registers no delegate tool");
    assert.doesNotMatch(text, /delegating-work/);
  });

  it("delegate_child_does_not_inherit_delegation_skill", async () => {
    const childTools: string[][] = [];
    let parentCalls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const tools = (request.tools ?? []).map((tool) => tool.name);
        if (tools.includes("delegate")) {
          parentCalls += 1;
          if (parentCalls === 1) yield providerToolCall(toolCallContent("call_d", "delegate", { child: "reviewer", input: "x" } as never));
          else yield providerTextDelta("done");
        } else {
          childTools.push(tools);
          yield providerTextDelta("child answer");
        }
        yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      },
    };
    const agent = await createAgent({
      model: MODEL,
      packages: [providerPackage("mock-provider", [provider]), delegate({ children: CHILDREN })],
    });
    try {
      const result = await (await agent.session()).run("go");
      assert.equal(result.status, "completed");
      assert.equal(childTools.length, 1, "the child ran once");
      assert.deepEqual(childTools[0], [], "a skill that needs `delegate` is not handed to a child, so no load_skill bridge appears");
    } finally {
      await agent.dispose();
    }
  });
});
