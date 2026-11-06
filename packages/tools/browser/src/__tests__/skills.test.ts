import { describe, it, mock } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type Message, type ProviderRequest } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import toolsBrowser from "../index.js";
import { FakeBrowser } from "./fake-playwright.js";

mock.module("playwright-core", () => ({ chromium: { launch: async () => new FakeBrowser() } }));

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
      toolsBrowser({ headless: true }),
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

describe("@arnilo/prism-tools-browser skills", () => {
  it("tools_browser_registers_bundled_skills", async () => {
    const { text, skills } = await firstRequest();
    const skill = skills.find((entry) => entry.name === "browser-automation");
    assert.ok(skill, "inspect().skills lists browser-automation");
    assert.equal(skill.package, "@arnilo/prism-tools-browser");
    assert.deepEqual(skill.requiresTools, ["browser_open", "browser_snapshot", "browser_act"]);
    assert.match(text, /- browser-automation: /);
  });

  it("tools_browser_skill_hidden_without_tools", async () => {
    const { text, skills } = await firstRequest([]);
    assert.doesNotMatch(text, /browser-automation/, "no tool is advertised, so the catalog omits the skill");
    assert.ok(
      skills.some((entry) => entry.name === "browser-automation"),
      "inspect still lists the hidden skill",
    );
  });
});
