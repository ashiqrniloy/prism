import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createLoadedSkillSet,
  createLoadSkillTool,
  createSkillRegistry,
  createToolRegistry,
  dispatchToolCall,
  HARD_MAX_SKILL_INSTRUCTION_BYTES,
  type ProviderRequest,
  providerDone,
  resolveSkillLoad,
  SkillLoadError,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { skillPromptText } from "../skill-disclosure.js";

describe("skill load", () => {
  it("resolveSkillLoad succeeds for active registry skill", () => {
    const registry = createSkillRegistry([{ name: "brief", instructions: "Be brief." }]);
    const loaded = createLoadedSkillSet();
    const skill = resolveSkillLoad({ registry, name: "brief", loaded, activeSkillNames: ["brief"] });
    assert.equal(skill.name, "brief");
  });

  it("unknown name fails closed", () => {
    const registry = createSkillRegistry([]);
    assert.throws(() => resolveSkillLoad({ registry, name: "missing", activeSkillNames: [] }), SkillLoadError);
  });

  it("inactive required tool fails closed", () => {
    const registry = createSkillRegistry([{ name: "git", instructions: "Use git.", toolNames: ["git_status"] }]);
    assert.throws(() => resolveSkillLoad({ registry, name: "git", tools: [], activeSkillNames: ["git"] }), /requires inactive tool/);
  });

  it("oversized body fails closed", () => {
    const registry = createSkillRegistry([{ name: "big", instructions: "x".repeat(HARD_MAX_SKILL_INSTRUCTION_BYTES + 1) }]);
    assert.throws(() => resolveSkillLoad({ registry, name: "big", activeSkillNames: ["big"] }), SkillLoadError);
  });

  it("duplicate load fails closed", () => {
    const registry = createSkillRegistry([{ name: "brief", instructions: "Be brief." }]);
    const loaded = createLoadedSkillSet();
    loaded.add("brief");
    assert.throws(() => resolveSkillLoad({ registry, name: "brief", loaded, activeSkillNames: ["brief"] }), /already loaded/);
  });

  it("inactive skill name fails closed when activeSkillNames provided", () => {
    const registry = createSkillRegistry([
      { name: "brief", instructions: "Be brief." },
      { name: "secret", instructions: "Hidden." },
    ]);
    assert.throws(() => resolveSkillLoad({ registry, name: "secret", activeSkillNames: ["brief"] }), /not active for this run/);
  });

  it("load_skill tool adds to loaded set without widening active tools", async () => {
    const registry = createSkillRegistry([{ name: "brief", instructions: "Be brief." }]);
    const loaded = createLoadedSkillSet();
    const loadSkill = createLoadSkillTool({ registry, loaded, tools: [] });
    const echo: ToolDefinition = { name: "echo", execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: "ok" }) };
    const toolRegistry = createToolRegistry([loadSkill, echo]);

    const result = await dispatchToolCall({
      call: toolCallContent("call_1", "load_skill", { name: "brief" }),
      registry: toolRegistry,
      context: {
        sessionId: "s1",
        runId: "r1",
        toolCallId: "call_1",
        metadata: { loadedSkills: loaded, activeSkillNames: ["brief"], activeTools: [] },
      },
    });
    assert.equal((result.value as { ok?: boolean }).ok, true);
    assert.equal(loaded.has("brief"), true);
    assert.equal(
      toolRegistry
        .list()
        .map((tool) => tool.name)
        .sort()
        .join(","),
      "echo,load_skill",
    );
  });

  it("loaded set does not leak across sessions", async () => {
    const registry = createSkillRegistry([{ name: "brief", instructions: "Be brief." }]);
    const loadedA = createLoadedSkillSet();
    const loadedB = createLoadedSkillSet();
    const loadSkill = createLoadSkillTool({ registry });

    await dispatchToolCall({
      call: toolCallContent("call_1", "load_skill", { name: "brief" }),
      registry: createToolRegistry([loadSkill]),
      context: {
        sessionId: "s1",
        runId: "r1",
        toolCallId: "call_1",
        metadata: { loadedSkills: loadedA, activeSkillNames: ["brief"] },
      },
    });
    assert.equal(loadedA.has("brief"), true);
    assert.equal(loadedB.has("brief"), false);
  });

  it("agent session load_skill includes instructions on subsequent provider turn", async () => {
    const requests: ProviderRequest[] = [];
    const registry = createSkillRegistry([{ name: "brief", description: "Answer briefly.", instructions: "Be very brief." }]);
    const loadSkill = createLoadSkillTool({ registry });
    const provider = {
      id: "mock",
      async *generate(request: ProviderRequest) {
        requests.push(request);
        if (requests.length === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("call_1", "load_skill", { name: "brief" }) };
        } else {
          yield providerDone();
        }
      },
    };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      skills: registry,
      tools: [loadSkill],
    });

    await agent.createSession().run("Hi", { activeSkills: ["brief"], limits: { maxToolRounds: 1 } });

    assert.equal(requests.length, 2);
    const firstText = requests[0]!.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    const secondText = requests[1]!.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    assert.match(firstText, /Skill brief: Answer briefly\./);
    assert.doesNotMatch(firstText, /Be very brief/);
    assert.match(secondText, /Skill brief:\nBe very brief\./);
  });

  it("skillPromptText reflects loaded set after tool success", () => {
    const loaded = createLoadedSkillSet();
    loaded.add("brief");
    const text = skillPromptText(
      { name: "brief", description: "Short.", instructions: "Long body." },
      { disclosure: "progressive", loaded },
    );
    assert.equal(text, "Skill brief:\nLong body.");
  });
});
