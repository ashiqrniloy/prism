import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type Message, type ProviderRequest } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import toolsWeb from "../index.js";

const MODEL = { provider: "mock", model: "m" } as const;

function textOf(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/** The first provider request of one run, optionally with the tool list narrowed. */
async function firstRequest(
  only?: readonly string[],
): Promise<{ text: string; skills: readonly { name: string; package?: string; requiresTools?: readonly string[] }[] }> {
  const requests: ProviderRequest[] = [];
  const agent = await createAgent({
    model: MODEL,
    packages: [
      mockProvider([[{ type: "done" }]], { id: "mock", onRequest: (request) => requests.push(request) }),
      toolsWeb({ backend: "native" }),
    ],
  });
  try {
    const session = await agent.session();
    await session.run("go", only === undefined ? {} : { tools: { only: [...only] } });
    return { text: textOf(requests[0]!.messages), skills: agent.inspect().skills };
  } finally {
    await agent.dispose();
  }
}

describe("@arnilo/prism-tools/web skills", () => {
  it("tools_web_registers_bundled_skills", async () => {
    const { text, skills } = await firstRequest();
    const skill = skills.find((entry) => entry.name === "web-research");
    assert.ok(skill, "inspect().skills lists web-research");
    assert.equal(skill.package, "@arnilo/prism-tools/web");
    assert.deepEqual(skill.requiresTools, ["web_fetch"]);
    assert.match(text, /- web-research: /);
  });

  it("tools_web_skill_hidden_without_tools", async () => {
    const { text, skills } = await firstRequest([]);
    assert.doesNotMatch(text, /web-research/, "no tool is advertised, so the catalog omits the skill");
    assert.ok(
      skills.some((entry) => entry.name === "web-research"),
      "inspect still lists the hidden skill",
    );
  });
});
