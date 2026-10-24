import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createLoadedSkillSet,
  createLoadSkillTool,
  createSkillRegistry,
  createToolRegistry,
  dispatchToolCall,
  HARD_MAX_SKILL_INSTRUCTION_BYTES,
  MAX_LOAD_SKILL_RESULT_BYTES,
  type Message,
  type ProviderRequest,
  providerDone,
  resolveSkillLoad,
  SkillLoadError,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
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
    const big = { name: "big", instructions: "x".repeat(HARD_MAX_SKILL_INSTRUCTION_BYTES + 1) };
    // A registry that predates the registration guard must still fail at the load boundary.
    const registry = {
      register() {},
      get: () => big,
      resolve: () => big,
      list: () => [big],
      unregister: () => false,
    };
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

  it("agent session load_skill returns the body in the tool result, not a later tail", async () => {
    const requests: ProviderRequest[] = [];
    const registry = createSkillRegistry([{ name: "brief", description: "Answer briefly.", instructions: "Be very brief." }]);
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
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      skills: { add: registry.list() },
    });

    const session = await agent.session();
    await session.run("Hi", { limits: { maxToolRounds: 1 } });

    assert.equal(requests.length, 2);
    const firstText = requests[0]!.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    const secondJson = JSON.stringify(requests[1]?.messages ?? []);
    const secondText = requests[1]!.messages
      .flatMap((m) => m.content)
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    assert.match(firstText, /- brief: Answer briefly\./);
    assert.doesNotMatch(firstText, /Be very brief/);
    assert.match(secondText, /- brief: Answer briefly\./, "catalog stays in its original prefix slot");
    assert.match(secondJson, /Be very brief/, "the body rides in the turn's tool result");
    const toolMessage = requests[1]?.messages.at(-1);
    assert.equal(toolMessage?.role, "tool");
    assert.equal(toolMessage?.metadata?.loadedSkill, "brief");
    assert.ok(typeof toolMessage?.metadata?.loadedSkillRunId === "string");
    assert.ok(!(session as unknown as { tailSegments: ReadonlyMap<string, unknown> }).tailSegments.has("skill:brief"));
  });

  it("loading an already-loaded skill is a normal result, not a failure", async () => {
    const registry = createSkillRegistry([{ name: "brief", instructions: "Be brief." }]);
    const loaded = createLoadedSkillSet();
    const loadSkill = createLoadSkillTool({ registry, loaded, tools: [] });
    const toolRegistry = createToolRegistry([loadSkill]);
    const context = {
      sessionId: "s1",
      runId: "r1",
      metadata: { loadedSkills: loaded, activeSkillNames: ["brief"], activeTools: [] },
    };
    const first = await dispatchToolCall({
      call: toolCallContent("call_1", "load_skill", { name: "brief" }),
      registry: toolRegistry,
      context: { ...context, toolCallId: "call_1" },
    });
    const second = await dispatchToolCall({
      call: toolCallContent("call_2", "load_skill", { name: "brief" }),
      registry: toolRegistry,
      context: { ...context, toolCallId: "call_2" },
    });
    assert.equal((first.value as { ok: boolean }).ok, true);
    assert.equal(first.metadata?.loadedSkill, "brief");
    assert.equal(first.metadata?.loadedSkillRunId, "r1");
    assert.equal(second.error, undefined);
    assert.deepEqual(second.value, {
      ok: true,
      name: "brief",
      text: "Skill brief is already loaded; its instructions are earlier in this conversation.",
      alreadyLoaded: true,
    });
    assert.equal(second.metadata, undefined, "an already-loaded result carries no fresh body marker");
    assert.deepEqual(loaded.entries?.(), [{ name: "brief", runId: "r1" }]);
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

  it("load_skill success text includes directory when path is present and stays within the result bound", async () => {
    const registry = createSkillRegistry([
      { name: "with-path", description: "Has path.", instructions: "Body.", path: "/repo/skills/with-path/SKILL.md" },
    ]);
    const loaded = createLoadedSkillSet();
    const loadSkill = createLoadSkillTool({ registry, loaded, tools: [] });
    const result = await dispatchToolCall({
      call: toolCallContent("call_p", "load_skill", { name: "with-path" }),
      registry: createToolRegistry([loadSkill]),
      context: {
        sessionId: "s1",
        runId: "r1",
        toolCallId: "call_p",
        metadata: { loadedSkills: loaded, activeSkillNames: ["with-path"], activeTools: [] },
      },
    });
    const val = result.value as { ok: boolean; name: string; text: string };
    assert.equal(val.ok, true);
    assert.equal(
      val.text,
      "Loaded skill with-path. Skill directory: /repo/skills/with-path. Paths in these instructions are relative to it.\n\nBody.",
    );
    assert.equal(result.metadata?.loadedSkill, "with-path");
    assert.equal(result.metadata?.loadedSkillRunId, "r1");
    assert.ok(Buffer.byteLength(val.text, "utf8") <= MAX_LOAD_SKILL_RESULT_BYTES);

    // A long path stays within the body+header bound
    const longDir = "/very/long/".repeat(60);
    const registryLong = createSkillRegistry([
      { name: "long-path", description: "Long.", instructions: "Body.", path: `${longDir}SKILL.md` },
    ]);
    const loadedLong = createLoadedSkillSet();
    const loadSkillLong = createLoadSkillTool({ registry: registryLong, loaded: loadedLong, tools: [] });
    const resultLong = await dispatchToolCall({
      call: toolCallContent("call_long", "load_skill", { name: "long-path" }),
      registry: createToolRegistry([loadSkillLong]),
      context: {
        sessionId: "s1",
        runId: "r1",
        toolCallId: "call_long",
        metadata: { loadedSkills: loadedLong, activeSkillNames: ["long-path"], activeTools: [] },
      },
    });
    const valLong = resultLong.value as { ok: boolean; name: string; text: string };
    assert.equal(valLong.ok, true);
    assert.ok(valLong.text.includes("Skill directory:"));
    assert.ok(Buffer.byteLength(valLong.text, "utf8") <= MAX_LOAD_SKILL_RESULT_BYTES);
  });

  it("sends a loaded body in the tool result once and keeps the tail empty on later turns", async () => {
    const requests: ProviderRequest[] = [];
    const registry = createSkillRegistry([{ name: "brief", description: "Answer briefly.", instructions: "Be very brief." }]);
    const provider = {
      id: "mock",
      async *generate(request: ProviderRequest) {
        requests.push(request);
        if (requests.length === 2) {
          yield { type: "tool_call" as const, call: toolCallContent("call_1", "load_skill", { name: "brief" }) };
        } else {
          yield providerDone();
        }
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      skills: { add: registry.list() },
    });
    const session = await agent.session();
    const tailSkillsAfterTurn: string[][] = [];
    for (let turn = 1; turn <= 10; turn += 1) {
      const result = await session.run(`Turn ${turn}`, { limits: { maxToolRounds: 1 } });
      assert.equal(result.status, "completed", `turn ${turn}: ${result.error?.message ?? result.status}`);
      const tails = (session as unknown as { tailSegments: ReadonlyMap<string, Message> }).tailSegments;
      tailSkillsAfterTurn.push([...tails.keys()].filter((key) => key.startsWith("skill:")));
    }

    assert.equal(requests.length, 11, "one completion per turn plus the load round");
    const bodyRequests = requests.map((request) => JSON.stringify(request.messages).includes("Be very brief"));
    assert.equal(bodyRequests[0], false, "turn 1 has only the catalog");
    assert.equal(bodyRequests[1], false, "the load request precedes the body");
    for (let index = 2; index < bodyRequests.length; index += 1) {
      assert.equal(bodyRequests[index], true, `request ${index + 1} still carries the transcript body`);
    }
    assert.ok(
      tailSkillsAfterTurn.every((keys) => keys.length === 0),
      `expected no loaded body tail on any turn, got ${JSON.stringify(tailSkillsAfterTurn)}`,
    );
  });
});
