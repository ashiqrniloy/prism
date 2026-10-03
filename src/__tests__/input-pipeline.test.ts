import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  assembleProviderInput,
  createDefaultInputBuilder,
  createLoadedSkillSet,
  createSkillRegistry,
  type Message,
  type ResourceLoader,
  renderPromptTemplate,
  resolveActiveSkills,
  type ToolDefinition,
  type ToolResult,
} from "../index.js";

const text = (message: Message) => message.content.find((part) => part.type === "text")?.text;

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
    assert.match(text(messages[0]!)!, /System instruction:\nBe accurate\./);
    assert.match(text(messages[1]!)!, /Developer instruction:\nCite sources\./);
    assert.match(text(messages[2]!)!, /Attachment notes\.md:\n# Notes/);
    assert.match(text(messages[3]!)!, /Resource file\.md:\nloaded text/);
    assert.match(text(messages[4]!)!, /Summary:\nEarlier summary\./);
    assert.equal(text(messages[5]!)!, "Summarize");
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
    assert.match(text(messages[0]!)!, /Attachment notes\.md:\nnotes/);
    assert.match(text(messages[1]!)!, /Summary:\nEarlier/);
    assert.equal(text(messages[2]!)!, "old");
    assert.equal(text(messages[3]!)!, "Now");
  });

  it("legacy layout restores prior input-before-attachments order", async () => {
    const messages = await createDefaultInputBuilder().build("Now", {
      inputLayout: "legacy",
      summaries: ["Earlier"],
      history: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      attachments: [{ name: "notes.md", text: "notes" }],
    });

    assert.deepEqual(
      messages.map((message) => message.role),
      ["system", "assistant", "user", "user"],
    );
    assert.match(text(messages[0]!)!, /Summary:\nEarlier/);
    assert.equal(text(messages[2]!)!, "Now");
    assert.match(text(messages[3]!)!, /Attachment notes\.md:\nnotes/);
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
    assert.match(text(messages[0]!)!, /Attachment notes\.md:\nnotes/);
    assert.match(text(messages[1]!)!, /Resource package:\/\/demo\/context\.md:\nresource/);
    assert.match(text(messages[2]!)!, /Summary:\nEarlier/);
    assert.equal(text(messages[3]!), "old");
    assert.equal(text(messages[4]!), "Now");
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
    assert.equal(text(messages[2]!), "Follow up");
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

    assert.equal(text(messages[0]!), "Explain src/input.ts");
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
    assert.match(text(request.messages[0]!)!, /Skill brief:\nBe brief\./);
    assert.match(text(request.messages[1]!)!, /Available tools:\n- echo: Echo input/);
  });

  it("progressive disclosure shows the skill catalog only", async () => {
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Question",
      skills: [{ name: "brief", description: "Be brief.", instructions: "Full instructions." }],
      skillsDisclosure: "progressive",
    });
    assert.match(text(request.messages[0]!)!, /Skill brief: Be brief\./);
    assert.doesNotMatch(text(request.messages[0]!)!, /Full instructions/);
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

    assert.equal(text(first.messages[0]!), "System instruction:\nRules");
    assert.deepEqual(
      JSON.parse(JSON.stringify(prefix(first.messages, "Ask A"))),
      JSON.parse(JSON.stringify(prefix(second.messages, "Ask B"))),
    );
    assert.equal(first.messages.at(-1) ? text(first.messages.at(-1)!) : undefined, "Ask A");
    assert.equal(second.messages.at(-1) ? text(second.messages.at(-1)!) : undefined, "Ask B");

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
    const skillIndex = (messages: readonly Message[]) => messages.findIndex((message) => text(message)?.startsWith("Skill brief"));

    assert.deepEqual(
      JSON.parse(JSON.stringify(catalog.messages.slice(0, skillIndex(catalog.messages)))),
      JSON.parse(JSON.stringify(full.messages.slice(0, skillIndex(full.messages)))),
    );
    assert.match(text(catalog.messages[skillIndex(catalog.messages)]!)!, /Skill brief: Be brief/);
    assert.match(text(full.messages[skillIndex(full.messages)]!)!, /Skill brief:\nFull skill body/);
    assert.equal(text(catalog.messages.at(-1)!)!, "Ask");
    assert.equal(text(full.messages.at(-1)!)!, "Ask");
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

  it("legacy prompt layout preserves prior whole-prompt ordering", async () => {
    const tool: ToolDefinition = { name: "echo", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo", capabilities: { tools: true } },
      inputLayout: "legacy",
      input: "Ask",
      systemInstructions: "Rules",
      skills: [{ name: "brief", instructions: "Be brief" }],
      skillsDisclosure: "eager",
      summaries: ["Summary"],
      history: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      attachments: [{ name: "notes.md", text: "notes" }],
      toolResults: [{ toolCallId: "c", name: "echo", value: "ok" }],
      tools: [tool],
    });

    assert.deepEqual(
      request.messages.map((message) => message.role),
      ["system", "system", "system", "assistant", "user", "user", "tool"],
    );
    // Legacy keeps the old whole-prompt order: context, skills, tools, then the message groups.
    assert.equal(text(request.messages[0]!), "Skill brief:\nBe brief");
    assert.equal(text(request.messages[1]!), "System instruction:\nRules");
    assert.equal(text(request.messages[2]!), "Summary:\nSummary");
    assert.equal(text(request.messages[4]!), "Ask");
    assert.equal(text(request.messages[5]!), "Attachment notes.md:\nnotes");
    assert.deepEqual(request.tools, [tool]);
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
