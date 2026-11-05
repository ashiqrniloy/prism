import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import {
  assembleProviderInput,
  createAgent,
  createLoadedSkillSet,
  definePackage,
  type LoopStrategy,
  type Message,
  type ModelProvider,
  parseSkillFile,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type Skill,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { skillMessages } from "../skill-disclosure.js";

const MODEL = { provider: "mock", model: "demo" } as const;

const tool = (name: string): ToolDefinition => ({
  name,
  parameters: {},
  execute: (_args, context) => ({ toolCallId: context.toolCallId, name, value: "ran" }),
});

const web: Skill = {
  name: "web-research",
  description: "Search the web.",
  instructions: "WEB BODY",
  requiresTools: ["web_search", "web_fetch"],
};
const plain: Skill = { name: "plain", description: "Always here.", instructions: "PLAIN BODY" };

const tools = definePackage<any>({
  name: "@acme/web",
  version: "1.0.0",
  requires: { api: 1 },
  setup: ({ tools: api }) => {
    api.register(tool("web_search"));
    api.register(tool("web_fetch"));
  },
});

function textOf(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/** One run per scenario; returns each provider request. The mock calls `load_skill` once when asked to. */
async function run(options: {
  readonly loadSkill?: string;
  readonly disable?: { readonly tools: readonly string[] };
  readonly only?: readonly string[];
  readonly disclosure?: "progressive" | "eager";
  readonly loop?: LoopStrategy;
  readonly hideWhen?: () => boolean;
}) {
  const requests: ProviderRequest[] = [];
  const results: unknown[] = [];
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      const last = request.messages.at(-1);
      if (last?.role === "tool") results.push(last.content);
      if (options.loadSkill && !request.messages.some((message) => message.role === "tool")) {
        yield { type: "tool_call" as const, call: toolCallContent("c1", "load_skill", { name: options.loadSkill }) };
      } else yield providerTextDelta("done");
      yield providerDone();
    },
  };
  const gated = definePackage<any>({
    name: "@acme/gated",
    version: "1.0.0",
    requires: { api: 1 },
    setup: ({ tools: api, skills }) => {
      api.register(tool("gated_tool"), { when: () => !options.hideWhen?.() });
      skills.register({
        name: "gated-skill",
        description: "Needs the gated tool.",
        instructions: "GATED BODY",
        requiresTools: ["gated_tool"],
      });
    },
  });
  const owner = options.loop
    ? definePackage<any>({
        name: "@acme/loop",
        version: "1.0.0",
        requires: { api: 1 },
        capabilities: ["slot:loop"],
        setup: ({ slots }) => slots.loop.provide(options.loop!),
      })
    : undefined;
  const agent = await createAgent({
    model: MODEL,
    packages: [...(owner ? [owner] : []), tools, gated, providerPackage("test-provider", [provider])],
    skills: { add: [web, plain], ...(options.disclosure ? { disclosure: options.disclosure } : {}) },
    ...(options.disable ? { disable: options.disable } : {}),
  });
  const session = await agent.session();
  const result = await session.run("go", options.only ? { tools: { only: [...options.only] } } : {});
  return { requests, results, result, agent };
}

describe("skill availability", () => {
  it("skill_hidden_when_required_tool_absent", async () => {
    const full = await run({});
    assert.match(textOf(full.requests[0]!.messages), /- web-research: Search the web\./);
    const narrowed = await run({ only: ["web_search", "gated_tool"] });
    const text = textOf(narrowed.requests[0]!.messages);
    assert.doesNotMatch(text, /web-research/, "web_fetch is not advertised");
    assert.match(text, /- plain: Always here\./);
    assert.match(text, /- gated-skill:/);
    assert.deepEqual(
      narrowed.agent.inspect().skills.find((skill) => skill.name === "web-research")?.requiresTools,
      ["web_search", "web_fetch"],
      "inspect still lists the hidden skill and why",
    );
  });

  it("skill_hidden_when_tool_when_false", async () => {
    let hide = false;
    const shown = await run({ hideWhen: () => hide });
    assert.match(textOf(shown.requests[0]!.messages), /- gated-skill:/);
    hide = true;
    const hidden = await run({ hideWhen: () => hide });
    const text = textOf(hidden.requests[0]!.messages);
    assert.doesNotMatch(text, /gated-skill/);
    assert.match(text, /- web-research:/, "other skills are untouched");
  });

  it("skill_hidden_when_tool_disabled", async () => {
    const { requests } = await run({ disable: { tools: ["web_fetch"] } });
    assert.doesNotMatch(textOf(requests[0]!.messages), /web-research/);
  });

  it("load_skill_unavailable_is_tool_error", async () => {
    const { requests, result, results } = await run({ loadSkill: "web-research", disable: { tools: ["web_fetch"] } });
    assert.equal(requests.length, 2, "the run continued past the failed load");
    assert.equal(result.status, "completed");
    const serialized = JSON.stringify(results);
    assert.match(serialized, /skill_unavailable/);
    assert.match(serialized, /web_fetch/);
    assert.doesNotMatch(serialized, /WEB BODY/);
    // An unknown name keeps its own error.
    const unknown = await run({ loadSkill: "nope" });
    assert.match(JSON.stringify(unknown.results), /Unknown skill: nope/);
  });

  it("load_skill_unavailable_when_tool_hidden_by_when", async () => {
    const { results } = await run({ loadSkill: "gated-skill", hideWhen: () => true });
    assert.match(JSON.stringify(results), /skill_unavailable/);
    assert.doesNotMatch(JSON.stringify(results), /GATED BODY/);
  });

  it("load_skill_available_loads_the_body", async () => {
    const { results } = await run({ loadSkill: "web-research" });
    assert.match(JSON.stringify(results), /WEB BODY/);
  });

  it("eager_body_not_sent_when_unavailable", async () => {
    const eager = await run({ disclosure: "eager", disable: { tools: ["web_fetch"] } });
    const text = textOf(eager.requests[0]!.messages);
    assert.doesNotMatch(text, /WEB BODY/);
    assert.match(text, /PLAIN BODY/);
    const all = await run({ disclosure: "eager" });
    assert.match(textOf(all.requests[0]!.messages), /WEB BODY/);
  });

  it("reattach_skips_unavailable_skill", async () => {
    const loaded = createLoadedSkillSet();
    loaded.add("web-research", "run-1");
    loaded.add("plain", "run-1");
    const base = {
      model: MODEL,
      input: "go",
      history: [],
      skills: [web, plain],
      skillsDisclosure: "progressive" as const,
      loadedSkills: loaded,
      runId: "run-1",
    };
    const without = await assembleProviderInput({ ...base, tailSegments: new Map(), tools: [tool("web_search")] });
    const text = textOf(without.messages);
    assert.doesNotMatch(text, /WEB BODY/, "an unavailable body is never re-sent");
    assert.match(text, /PLAIN BODY/, "an available loaded skill still re-attaches");
    assert.match(text, /Previously loaded skills \(load again if needed\): web-research/);
    assert.equal(loaded.has("web-research"), true, "it stays loaded so the body returns with the tools");
    const back = await assembleProviderInput({ ...base, tailSegments: new Map(), tools: [tool("web_search"), tool("web_fetch")] });
    assert.match(textOf(back.messages), /WEB BODY/);
    assert.doesNotMatch(textOf(back.messages), /Previously loaded/);
  });

  it("restored_bodies_keep_the_requirement_and_unknown_ones_are_always_available", async () => {
    const loaded = createLoadedSkillSet();
    loaded.add("web-research", "run-1");
    loaded.add("orphan", "run-1");
    const request = await assembleProviderInput({
      model: MODEL,
      input: "go",
      history: [],
      skills: [web, { name: "orphan", instructions: "ORPHAN BODY" }],
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      runId: "run-1",
      tailSegments: new Map(),
      tools: [],
    });
    const text = textOf(request.messages);
    assert.doesNotMatch(text, /WEB BODY/);
    assert.match(text, /ORPHAN BODY/);
  });

  it("skill_without_requirement_unchanged", () => {
    const skills: Skill[] = [
      { name: "brief", description: "Answer briefly.", instructions: "Full body." },
      { name: "verbose", description: "Explain fully.", instructions: "Other body." },
    ];
    const golden = skillMessages(skills);
    assert.deepEqual(skillMessages(skills, { tools: new Set() }), golden, "an empty tool list changes nothing without requirements");
    assert.equal(
      textOf(golden),
      "Skills are task-specific instructions. When a task matches a skill below, call load_skill with its name before starting.\n- brief: Answer briefly.\n- verbose: Explain fully.",
    );
  });

  it("hidden_skill_takes_no_catalog_slot_and_is_not_counted", () => {
    const many: Skill[] = Array.from({ length: 70 }, (_, index) => ({ name: `s${index}`, description: "d", requiresTools: ["gone"] }));
    const skills = [...many, plain];
    assert.equal(textOf(skillMessages(skills, { tools: new Set() })).includes("more skills"), false);
    assert.match(textOf(skillMessages(skills, { tools: new Set() })), /- plain:/);
  });

  it("filter_cost_is_small", () => {
    const names = Array.from({ length: 8 }, (_, index) => `t${index}`);
    const skills: Skill[] = Array.from({ length: 64 }, (_, index) => ({ name: `s${index}`, description: "d", requiresTools: names }));
    const tools = new Set(names);
    skillMessages(skills, { tools });
    const start = performance.now();
    for (let index = 0; index < 100; index++) skillMessages(skills, { tools });
    const perCall = (performance.now() - start) / 100;
    assert.ok(perCall < 5, `a 64-skill catalog renders in ${perCall.toFixed(2)} ms`);
  });

  it("skill_availability_default_and_custom_loop", async () => {
    const custom: LoopStrategy = {
      name: "one-round",
      revision: "1",
      async run(controller) {
        const turn = await controller.turn();
        if (turn.stopped) return;
        if (turn.toolCalls.length > 0) await controller.executeTools(turn.toolCalls);
        const last = await controller.turn();
        if (last.stopped) return;
        await controller.end();
      },
    };
    for (const loop of [undefined, custom]) {
      const hiddenCatalog = await run({ disable: { tools: ["web_fetch"] }, ...(loop ? { loop } : {}) });
      assert.doesNotMatch(textOf(hiddenCatalog.requests[0]!.messages), /web-research/);
      const refused = await run({ loadSkill: "web-research", disable: { tools: ["web_fetch"] }, ...(loop ? { loop } : {}) });
      assert.match(JSON.stringify(refused.results), /skill_unavailable/);
      const allowed = await run({ loadSkill: "web-research", ...(loop ? { loop } : {}) });
      assert.match(JSON.stringify(allowed.results), /WEB BODY/);
    }
  });
});

describe("requiresTools parsing", () => {
  const file = (metadata: string) => `---\nname: demo\ndescription: d\n${metadata}---\nbody`;

  it("reads a space-separated metadata value, including dotted names", () => {
    const skill = parseSkillFile(file("metadata:\n  prism-requires-tools: web_search web_fetch memory.recall\n"), "/s/demo/SKILL.md");
    assert.deepEqual(skill.requiresTools, ["web_search", "web_fetch", "memory.recall"]);
    assert.equal(parseSkillFile(file(""), "/s/demo/SKILL.md").requiresTools, undefined);
  });

  it("rejects a malformed value", () => {
    for (const bad of [
      "metadata:\n  prism-requires-tools:\n    - a\n",
      "metadata:\n  prism-requires-tools: ok bad/name\n",
      'metadata:\n  prism-requires-tools: ""\n',
      "metadata: nope\n",
    ]) {
      assert.throws(() => parseSkillFile(file(bad), "/s/demo/SKILL.md"), /prism-requires-tools|skill metadata/, bad);
    }
  });

  it("requires_tools_malformed_fails_package_setup", async () => {
    const root = await mkdtemp(join(tmpdir(), "prism-requires-"));
    try {
      await mkdir(join(root, "demo"));
      await writeFile(join(root, "demo", "SKILL.md"), file("metadata:\n  prism-requires-tools: bad/name\n"));
      const pkg = definePackage<any>({
        name: "@acme/dirs",
        version: "1.0.0",
        requires: { api: 1 },
        setup: ({ skills }) => skills.addDir(root),
      });
      await assert.rejects(
        createAgent({ model: MODEL, packages: [providerPackage("test-provider", [{ id: "mock", async *generate() {} }]), pkg] }),
        /prism-requires-tools/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
