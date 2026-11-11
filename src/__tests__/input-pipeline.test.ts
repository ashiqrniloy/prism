import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { restoreRunSessionState } from "../agent-run-restore.js";
import {
  assembleProviderInput,
  createDefaultInputBuilder,
  createLoadedSkillSet,
  createLoadSkillTool,
  createSkillRegistry,
  createToolRegistry,
  dispatchToolCall,
  type Message,
  type ResourceLoader,
  renderPromptTemplate,
  resolveActiveSkills,
  type StoredAgentRunState,
  type ToolDefinition,
  type ToolResult,
  toolCallContent,
} from "../index.js";

const text = (message: Message) => message.content.find((part) => part.type === "text")?.text;

function loadedToolMessage(name: string, runId: string, result: string, folded = false): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: `call_${name}`, name: "load_skill", result }],
    metadata: { loadedSkill: name, loadedSkillRunId: runId, ...(folded ? { prismFolded: true } : {}) },
  };
}

function messagesContaining(messages: readonly Message[], needle: string): number {
  return messages.filter((message) => JSON.stringify(message).includes(needle)).length;
}

function skillTailKeys(tailSegments: ReadonlyMap<string, Message>): string[] {
  return [...tailSegments.keys()].filter((key) => key.startsWith("skill:"));
}

describe("default input builder", () => {
  it("turns string into user text message", async () => {
    const messages = await createDefaultInputBuilder().build("Hello");

    assert.deepEqual(messages, [{ role: "user", content: [{ type: "text", text: "Hello" }], metadata: undefined }]);
  });

  it("preserves message and history order", async () => {
    const history: Message[] = [{ role: "assistant", content: [{ type: "text", text: "old" }] }];
    const input: Message = { role: "user", content: [{ type: "text", text: "new" }] };

    const messages = await createDefaultInputBuilder().build(input, { history });

    assert.deepEqual(messages, [...history, input]);
  });

  it("adds instructions summaries text attachments and resource text", async () => {
    const calls: string[] = [];
    const resourceLoader: ResourceLoader = {
      async load(uri) {
        calls.push(uri);
        return { uri, text: "loaded text" };
      },
    };

    const messages = await createDefaultInputBuilder().build("Summarize", {
      systemInstructions: "Be accurate.",
      developerInstructions: ["Cite sources."],
      summaries: ["Earlier summary."],
      attachments: [
        { name: "notes.md", text: "# Notes" },
        { uri: "package://demo/file.md", name: "file.md" },
      ],
      resourceLoader,
    });

    assert.deepEqual(calls, ["package://demo/file.md"]);
    assert.deepEqual(
      messages.map((message) => message.role),
      ["system", "system", "user", "user", "system", "user"],
    );
    const message0 = messages[0];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.match(messageText0, /System instruction:\nBe accurate\./);
    const message1 = messages[1];
    assert.ok(message1);
    const messageText1 = text(message1);
    assert.ok(messageText1 !== undefined);
    assert.match(messageText1, /Developer instruction:\nCite sources\./);
    const message2 = messages[2];
    assert.ok(message2);
    const messageText2 = text(message2);
    assert.ok(messageText2 !== undefined);
    assert.match(messageText2, /Attachment notes\.md:\n# Notes/);
    const message3 = messages[3];
    assert.ok(message3);
    const messageText3 = text(message3);
    assert.ok(messageText3 !== undefined);
    assert.match(messageText3, /Resource file\.md:\nloaded text/);
    const message4 = messages[4];
    assert.ok(message4);
    const messageText4 = text(message4);
    assert.ok(messageText4 !== undefined);
    assert.match(messageText4, /Summary:\nEarlier summary\./);
    const message5 = messages[5];
    assert.ok(message5);
    const messageText5 = text(message5);
    assert.ok(messageText5 !== undefined);
    assert.equal(messageText5, "Summarize");
  });

  it("adds tool result messages without executing tools", async () => {
    const toolResults: ToolResult[] = [{ toolCallId: "call_1", name: "lookup", value: { ok: true } }];

    const messages = await createDefaultInputBuilder().build("Continue", { toolResults });

    assert.deepEqual(
      messages.map((message) => message.role),
      ["tool", "user"],
    );
    assert.deepEqual(messages[0]?.content[0], {
      type: "tool_result",
      toolCallId: "call_1",
      name: "lookup",
      result: { ok: true },
      error: undefined,
    });
  });

  it("folds content-only tool results onto tool_result.result", async () => {
    const toolResults: ToolResult[] = [{ toolCallId: "call_1", name: "repo_list", content: [{ type: "text", text: "file AGENTS.md" }] }];
    const messages = await createDefaultInputBuilder().build("Continue", { toolResults });
    assert.deepEqual(messages[0]?.content, [
      {
        type: "tool_result",
        toolCallId: "call_1",
        name: "repo_list",
        result: "file AGENTS.md",
        error: undefined,
      },
    ]);
  });

  it("uses cache_aware layout by default", async () => {
    const messages = await createDefaultInputBuilder().build("Now", {
      summaries: ["Earlier"],
      history: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      attachments: [{ name: "notes.md", text: "notes" }],
    });

    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "system", "assistant", "user"],
    );
    const message0 = messages[0];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.match(messageText0, /Attachment notes\.md:\nnotes/);
    const message1 = messages[1];
    assert.ok(message1);
    const messageText1 = text(message1);
    assert.ok(messageText1 !== undefined);
    assert.match(messageText1, /Summary:\nEarlier/);
    const message2 = messages[2];
    assert.ok(message2);
    const messageText2 = text(message2);
    assert.ok(messageText2 !== undefined);
    assert.equal(messageText2, "old");
    const message3 = messages[3];
    assert.ok(message3);
    const messageText3 = text(message3);
    assert.ok(messageText3 !== undefined);
    assert.equal(messageText3, "Now");
  });

  it("cache-aware layout puts stable attachments resources summaries and history before current input", async () => {
    const calls: string[] = [];
    const resourceLoader: ResourceLoader = {
      async load(uri) {
        calls.push(uri);
        return { uri, text: "resource" };
      },
    };
    const messages = await createDefaultInputBuilder().build("Now", {
      inputLayout: "cache_aware",
      summaries: ["Earlier"],
      history: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      attachments: [{ name: "notes.md", text: "notes" }],
      resourceUris: ["package://demo/context.md"],
      resourceLoader,
    });

    assert.deepEqual(calls, ["package://demo/context.md"]);
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "user", "system", "assistant", "user"],
    );
    const message0 = messages[0];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.match(messageText0, /Attachment notes\.md:\nnotes/);
    const message1 = messages[1];
    assert.ok(message1);
    const messageText1 = text(message1);
    assert.ok(messageText1 !== undefined);
    assert.match(messageText1, /Resource package:\/\/demo\/context\.md:\nresource/);
    const message2 = messages[2];
    assert.ok(message2);
    const messageText2 = text(message2);
    assert.ok(messageText2 !== undefined);
    assert.match(messageText2, /Summary:\nEarlier/);
    const message3 = messages[3];
    assert.ok(message3);
    const messageText3 = text(message3);
    assert.ok(messageText3 !== undefined);
    assert.equal(messageText3, "old");
    const message4 = messages[4];
    assert.ok(message4);
    const messageText4 = text(message4);
    assert.ok(messageText4 !== undefined);
    assert.equal(messageText4, "Now");
  });

  it("cache-aware layout keeps tool results adjacent to prior tool calls before current input", async () => {
    const history: Message[] = [{ role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: {} }] }];
    const messages = await createDefaultInputBuilder().build("Follow up", {
      inputLayout: "cache_aware",
      history,
      toolResults: [{ toolCallId: "call_1", name: "lookup", value: { ok: true } }],
    });

    assert.deepEqual(
      messages.map((message) => message.role),
      ["assistant", "tool", "user"],
    );
    assert.equal(messages[0]?.content[0]?.type, "tool_call");
    assert.equal(messages[1]?.content[0]?.type, "tool_result");
    const message0 = messages[2];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.equal(messageText0, "Follow up");
  });
});

describe("assembleProviderInput session defaults", () => {
  it("copies sessionId into request options when set", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      sessionId: "s1",
    });
    assert.equal(request.options?.sessionId, "s1");
    assert.equal(request.options?.cacheKey, "s1");
  });

  it("host providerOptions.sessionId wins over assembler sessionId", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      sessionId: "s1",
      providerOptions: { sessionId: "custom", cacheKey: "ck" },
    });
    assert.equal(request.options?.sessionId, "custom");
    assert.equal(request.options?.cacheKey, "ck");
  });
});

describe("prompt template rendering", () => {
  it("replaces variables", () => {
    assert.equal(
      renderPromptTemplate("Review {{file}} for {{focus}}", { file: "src/index.ts", focus: "exports" }),
      "Review src/index.ts for exports",
    );
  });

  it("stringifies json values deterministically", () => {
    assert.equal(
      renderPromptTemplate("{{count}} {{ok}} {{nothing}} {{items}} {{object}}", {
        count: 2,
        ok: true,
        nothing: null,
        items: ["b", { z: 1, a: 2 }],
        object: { z: 1, a: 2 },
      }),
      '2 true null ["b",{"a":2,"z":1}] {"a":2,"z":1}',
    );
  });

  it("missing variable fails closed unless preserved", () => {
    assert.throws(() => renderPromptTemplate("Hello {{name}}", {}), /Missing prompt template variable: name/);
    assert.equal(renderPromptTemplate("Hello {{name}}", {}, { missing: "preserve" }), "Hello {{name}}");
  });

  it("does not eval expressions or prototype properties", () => {
    assert.equal(renderPromptTemplate("{{name.toUpperCase()}}", { name: "demo" }), "{{name.toUpperCase()}}");
    assert.throws(() => renderPromptTemplate("{{constructor}}", {}), /Missing prompt template variable: constructor/);
  });

  it("can feed default input assembly", async () => {
    const prompt = renderPromptTemplate("Explain {{file}}", { file: "src/input.ts" });
    const messages = await createDefaultInputBuilder().build(prompt);

    const message0 = messages[0];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.equal(messageText0, "Explain src/input.ts");
  });
});

describe("skill contribution integration", () => {
  it("a skill is selected explicitly before prompt use", async () => {
    const tool: ToolDefinition = { name: "echo", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const registry = createSkillRegistry([{ name: "brief", instructions: "Be brief.", toolNames: ["echo"] }]);
    const skills = resolveActiveSkills({ registry, names: ["brief"], tools: [tool] });

    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      skills,
      tools: [tool],
      skillsDisclosure: "eager",
    });

    assert.match(request.messages.map((message) => text(message) ?? "").join("\n"), /Skill brief:\nBe brief\./);
  });
});

describe("prompt composition", () => {
  it("the kernel composition includes skills, tool text, and the current turn", async () => {
    const tool: ToolDefinition = { name: "echo", description: "Echo input", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Question",
      skills: [{ name: "brief", instructions: "Be brief." }],
      tools: [tool],
      skillsDisclosure: "eager",
    });

    assert.deepEqual(
      request.messages.map((message) => message.role),
      ["system", "system", "user"],
    );
    const message0 = request.messages[0];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.match(messageText0, /Skill brief:\nBe brief\./);
    const message1 = request.messages[1];
    assert.ok(message1);
    const messageText1 = text(message1);
    assert.ok(messageText1 !== undefined);
    assert.match(messageText1, /Available tools:\n- echo: Echo input/);
  });

  it("progressive disclosure shows the skill catalog only", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Question",
      skills: [{ name: "brief", description: "Be brief.", instructions: "Full instructions." }],
      skillsDisclosure: "progressive",
    });
    const message0 = request.messages[0];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.match(messageText0, /- brief: Be brief\./);
    assert.doesNotMatch(messageText0, /Full instructions/);
  });

  it("the tool text list is omitted for tool-capable models only", async () => {
    const tool: ToolDefinition = { name: "echo", description: "Echo input", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const base = { input: "Question", tools: [tool] };

    const capable = await assembleProviderInput({
      ...base,
      model: { provider: "mock", model: "demo", capabilities: { tools: true } },
    });
    assert.equal(
      capable.messages.some((message) => /Available tools:/.test(text(message) ?? "")),
      false,
    );

    // Unknown (undefined) or declared-false capability keeps the text (fail-safe for text-only providers).
    for (const capabilities of [undefined, { tools: false }]) {
      const kept = await assembleProviderInput({ ...base, model: { provider: "mock", model: "demo", capabilities } });
      assert.equal(
        kept.messages.some((message) => /Available tools:/.test(text(message) ?? "")),
        true,
      );
    }
  });

  it("cache-aware provider input keeps stable instructions before dynamic context and current turns", async () => {
    const tool: ToolDefinition = { name: "echo", description: "Echo input", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const common = {
      model: { provider: "mock", model: "demo" },
      inputLayout: "cache_aware" as const,
      systemInstructions: "Rules",
      summaries: ["Summary"],
      history: [{ role: "assistant" as const, content: [{ type: "text" as const, text: "old" }] }],
      attachments: [{ name: "schema.md", text: "stable schema" }],
      tools: [tool],
    };
    const first = await assembleProviderInput({ ...common, input: "Ask A" });
    const second = await assembleProviderInput({ ...common, input: "Ask B" });
    const prefix = (messages: readonly Message[], current: string) =>
      messages.slice(
        0,
        messages.findIndex((message) => text(message) === current),
      );

    const message0 = first.messages[0];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.equal(messageText0, "System instruction:\nRules");
    assert.deepEqual(
      JSON.parse(JSON.stringify(prefix(first.messages, "Ask A"))),
      JSON.parse(JSON.stringify(prefix(second.messages, "Ask B"))),
    );
    const message1 = first.messages.at(-1);
    assert.ok(message1);
    const messageText1 = text(message1);
    assert.ok(messageText1 !== undefined);
    assert.equal(messageText1, "Ask A");
    const message2 = second.messages.at(-1);
    assert.ok(message2);
    const messageText2 = text(message2);
    assert.ok(messageText2 !== undefined);
    assert.equal(messageText2, "Ask B");

    // Only the trailing input differs, so everything ahead of it is byte-identical.
    assert.deepEqual(
      JSON.parse(JSON.stringify(prefix(first.messages, "Ask A"))),
      JSON.parse(JSON.stringify(prefix(second.messages, "Ask B"))),
    );
    assert.deepEqual(second.tools, first.tools);
  });

  it("cache-aware prompt order keeps loaded skill changes after the stable prefix", async () => {
    const skill = { name: "brief", description: "Be brief", instructions: "Full skill body" };
    const common = {
      model: { provider: "mock", model: "demo", capabilities: { tools: true } },
      inputLayout: "cache_aware" as const,
      systemInstructions: "Stable rules",
      skills: [skill],
      skillsDisclosure: "progressive" as const,
      input: "Ask",
    };
    const catalog = await assembleProviderInput(common);
    const loaded = createLoadedSkillSet();
    loaded.add("brief");
    const full = await assembleProviderInput({ ...common, loadedSkills: loaded });
    const skillIndex = (messages: readonly Message[]) =>
      messages.findIndex((message) => {
        const value = text(message) ?? "";
        return value.startsWith("Skill brief:") || value.includes("\n- brief:");
      });

    assert.deepEqual(
      JSON.parse(JSON.stringify(catalog.messages.slice(0, skillIndex(catalog.messages)))),
      JSON.parse(JSON.stringify(full.messages.slice(0, skillIndex(full.messages)))),
    );
    const message0 = catalog.messages[skillIndex(catalog.messages)];
    assert.ok(message0);
    const messageText0 = text(message0);
    assert.ok(messageText0 !== undefined);
    assert.match(messageText0, /- brief: Be brief/);
    const message1 = full.messages[skillIndex(full.messages)];
    assert.ok(message1);
    const messageText1 = text(message1);
    assert.ok(messageText1 !== undefined);
    assert.match(messageText1, /Skill brief:\nFull skill body/);
    const message2 = catalog.messages.at(-1);
    assert.ok(message2);
    const messageText2 = text(message2);
    assert.ok(messageText2 !== undefined);
    assert.equal(messageText2, "Ask");
    const message3 = full.messages.at(-1);
    assert.ok(message3);
    const messageText3 = text(message3);
    assert.ok(messageText3 !== undefined);
    assert.equal(messageText3, "Ask");
  });

  it("keeps late skill bodies append-only and reuses their segment positions", async () => {
    const loaded = createLoadedSkillSet();
    const tailSegments = new Map<string, Message>();
    const alpha = { name: "alpha", description: "Alpha catalog", instructions: "Alpha body" };
    const beta = { name: "beta", description: "Beta catalog", instructions: "Beta body" };
    const common = {
      model: { provider: "mock", model: "demo", capabilities: { tools: true } },
      input: "Ask",
      skills: [alpha, beta],
      skillsDisclosure: "progressive" as const,
      loadedSkills: loaded,
      tailSegments,
    };
    const catalog = await assembleProviderInput(common);
    loaded.add("beta");
    const betaLoaded = await assembleProviderInput(common);
    loaded.add("alpha");
    const bothLoaded = await assembleProviderInput(common);
    const upgraded = await assembleProviderInput({ ...common, skills: [alpha, { ...beta, instructions: "Beta body v2" }] });
    const bodyIndexes = (messages: readonly Message[]) =>
      messages.flatMap((message, index) => (text(message)?.includes(" body") ? [index] : []));
    const bodyTexts = (messages: readonly Message[]) =>
      messages.flatMap((message) => {
        const value = text(message);
        return value?.includes(" body") ? [value] : [];
      });

    assert.equal(bodyIndexes(catalog.messages).length, 0);
    assert.deepEqual(
      betaLoaded.messages.slice(0, bodyIndexes(betaLoaded.messages)[0]),
      bothLoaded.messages.slice(0, bodyIndexes(bothLoaded.messages)[0]),
      "loading alpha appends after beta instead of replacing its prompt position",
    );
    assert.deepEqual(bodyTexts(bothLoaded.messages), ["Skill beta:\nBeta body", "Skill alpha:\nAlpha body"]);
    assert.deepEqual(
      bodyTexts(upgraded.messages),
      ["Skill beta:\nBeta body v2", "Skill alpha:\nAlpha body"],
      "re-derivation replaces only beta's existing segment",
    );
    assert.equal(tailSegments.size, 2, "reloading a segment never grows the tail");
  });

  it("does not re-append a loaded body while its tool result is visible", async () => {
    const loaded = createLoadedSkillSet();
    loaded.add("alpha", "run-1");
    const tailSegments = new Map<string, Message>();
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills: [{ name: "alpha", description: "Alpha catalog", instructions: "Alpha body" }],
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      history: [loadedToolMessage("alpha", "run-1", "Skill alpha:\nAlpha body")],
      runId: "run-1",
      tailSegments,
    });

    assert.equal(messagesContaining(request.messages, "Alpha body"), 1, "only the tool result carries the body");
    assert.deepEqual(skillTailKeys(tailSegments), []);
  });

  it("re-attaches a loaded body once after compaction removes its tool result", async () => {
    const loaded = createLoadedSkillSet();
    loaded.add("alpha", "run-1");
    const tailSegments = new Map<string, Message>();
    const common = {
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills: [{ name: "alpha", description: "Alpha catalog", instructions: "Alpha body" }],
      skillsDisclosure: "progressive" as const,
      loadedSkills: loaded,
      runId: "run-1",
      tailSegments,
    };

    const first = await assembleProviderInput(common);
    const second = await assembleProviderInput(common);

    assert.equal(messagesContaining(first.messages, "Alpha body"), 1);
    assert.equal(messagesContaining(second.messages, "Alpha body"), 1, "the tail segment is stable, not duplicated");
    assert.deepEqual(skillTailKeys(tailSegments), ["skill:alpha"]);
  });

  it("re-attaches a body whose tool result was folded even without compaction", async () => {
    const loaded = createLoadedSkillSet();
    loaded.add("alpha", "run-1");
    const tailSegments = new Map<string, Message>();
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills: [{ name: "alpha", description: "Alpha catalog", instructions: "Alpha body" }],
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      history: [loadedToolMessage("alpha", "run-1", "Folded tool result summary", true)],
      runId: "run-1",
      tailSegments,
    });

    assert.equal(messagesContaining(request.messages, "Alpha body"), 1);
    assert.deepEqual(skillTailKeys(tailSegments), ["skill:alpha"]);
  });

  it("re-attaches only current-run bodies and names earlier runs in one line", async () => {
    const loaded = createLoadedSkillSet();
    loaded.add("alpha", "run-1");
    loaded.add("beta", "run-2");
    const tailSegments = new Map<string, Message>();
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills: [
        { name: "alpha", description: "Alpha catalog", instructions: "Alpha body" },
        { name: "beta", description: "Beta catalog", instructions: "Beta body" },
      ],
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      runId: "run-2",
      tailSegments,
    });

    assert.equal(messagesContaining(request.messages, "Alpha body"), 0, "an earlier run's body stays unloaded");
    assert.equal(messagesContaining(request.messages, "Beta body"), 1, "the current run's body re-attaches");
    assert.ok(request.messages.some((message) => text(message) === "Previously loaded skills (load again if needed): alpha"));
    assert.equal(loaded.has("alpha"), false);
    assert.equal(loaded.has("beta"), true);
  });

  it("loads a previously loaded skill again with its body", async () => {
    const loaded = createLoadedSkillSet();
    loaded.add("alpha", "run-1");
    const registry = createSkillRegistry([{ name: "alpha", description: "Alpha catalog", instructions: "Alpha body" }]);
    await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills: registry.list(),
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      runId: "run-2",
      tailSegments: new Map(),
    });
    assert.equal(loaded.has("alpha"), false);

    const loadSkill = createLoadSkillTool({ registry });
    const result = await dispatchToolCall({
      call: toolCallContent("call_alpha", "load_skill", { name: "alpha" }),
      registry: createToolRegistry([loadSkill]),
      context: {
        sessionId: "s1",
        runId: "run-2",
        toolCallId: "call_alpha",
        metadata: { loadedSkills: loaded, activeSkillNames: ["alpha"], activeTools: [] },
      },
    });
    const value = result.value as { ok: boolean; text: string; alreadyLoaded?: boolean };
    assert.equal(value.ok, true);
    assert.equal(value.alreadyLoaded, undefined);
    assert.match(value.text, /^Loaded skill alpha\./);
    assert.match(value.text, /Alpha body$/);
    assert.equal(result.metadata?.loadedSkill, "alpha");
    assert.equal(loaded.has("alpha"), true);
  });

  it("sorts and caps the previously loaded names line", async () => {
    const names = Array.from({ length: 20 }, (_, index) => `s${String(index).padStart(2, "0")}`);
    const loaded = createLoadedSkillSet();
    for (const name of names) loaded.add(name, "run-1");
    const tailSegments = new Map<string, Message>();
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills: names.map((name) => ({ name, description: `${name} catalog`, instructions: `${name} body` })),
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      runId: "run-2",
      tailSegments,
    });

    assert.ok(
      request.messages.some(
        (message) => text(message) === `Previously loaded skills (load again if needed): ${names.slice(0, 16).join(", ")} (+4)`,
      ),
    );
    assert.equal(loaded.list().length, 0);
  });

  it("restores a compacted transcript body at the tail for the resumed run", async () => {
    const loaded = createLoadedSkillSet();
    restoreRunSessionState(
      {
        restoreLoadedSkills(names, runId) {
          for (const name of names) loaded.add(name, runId);
        },
        restoreLoadedSkillBodies(bodies, runId) {
          for (const body of bodies) loaded.add(body.name, runId);
        },
      },
      {
        runId: "run-resume",
        sessionState: { loadedSkillBodies: [{ name: "alpha", instructions: "Alpha body" }] },
      } as unknown as StoredAgentRunState,
      { persistSessionState: true, includeSkillBodies: true },
    );
    const skills = [{ name: "alpha", description: "Alpha catalog", instructions: "Alpha body" }];
    const visibleTail = new Map<string, Message>();
    const visible = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills,
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      history: [loadedToolMessage("alpha", "run-resume", "Skill alpha:\nAlpha body")],
      runId: "run-resume",
      tailSegments: visibleTail,
    });
    assert.equal(messagesContaining(visible.messages, "Alpha body"), 1);
    assert.deepEqual(skillTailKeys(visibleTail), []);

    const compactedTail = new Map<string, Message>();
    const compacted = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      skills,
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
      runId: "run-resume",
      tailSegments: compactedTail,
    });
    assert.equal(messagesContaining(compacted.messages, "Alpha body"), 1);
    assert.deepEqual(skillTailKeys(compactedTail), ["skill:alpha"]);
  });

  it("moves URI resources into their reusable tail segment", async () => {
    const tailSegments = new Map<string, Message>();
    let body = "first body";
    const resourceLoader: ResourceLoader = {
      async load(uri) {
        return { uri, text: body };
      },
    };
    const common = {
      model: { provider: "mock", model: "demo" },
      input: "Ask",
      resourceUris: ["package://demo/reference.md"],
      resourceLoader,
      tailSegments,
    };
    const first = await assembleProviderInput(common);
    body = "second body";
    const updated = await assembleProviderInput(common);
    const resourceIndex = (messages: readonly Message[]) =>
      messages.findIndex((message) => text(message)?.startsWith("Resource package://demo/reference.md"));
    const firstIndex = resourceIndex(first.messages);
    const updatedIndex = resourceIndex(updated.messages);

    assert.equal(firstIndex, first.messages.length - 1);
    assert.equal(updatedIndex, firstIndex);
    assert.deepEqual(first.messages.slice(0, firstIndex), updated.messages.slice(0, updatedIndex));
    const updatedMessage = updated.messages[updatedIndex];
    assert.ok(updatedMessage, "updated resource message must exist in the tail");
    assert.match(text(updatedMessage) ?? "", /second body/);
    assert.equal(tailSegments.size, 1);
  });

  it("assembles provider input without calling provider or executing tools", async () => {
    let executed = false;
    const tool: ToolDefinition = {
      name: "echo",
      execute: () => {
        executed = true;
        return { toolCallId: "c", name: "echo" };
      },
    };
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hello",
      tools: [tool],
    });

    assert.equal(executed, false);
    assert.deepEqual(request.tools, [tool]);
    assert.equal(request.messages.at(-1)?.role, "user");
  });
});
