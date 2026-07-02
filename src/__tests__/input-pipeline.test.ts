import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleProviderInput,
  createDefaultInputBuilder,
  createDefaultPromptBuilder,
  createExtensionKernel,
  createMiddlewareRegistry,
  createSkillRegistry,
  renderPromptTemplate,
  resolveActiveSkills,
  resolveContextProviders,
  type ContextProvider,
  type Message,
  type ResourceLoader,
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
      attachments: [{ name: "notes.md", text: "# Notes" }, { uri: "package://demo/file.md", name: "file.md" }],
      resourceLoader,
    });

    assert.deepEqual(calls, ["package://demo/file.md"]);
    assert.deepEqual(messages.map((message) => message.role), ["system", "system", "system", "user", "user", "user"]);
    assert.match(text(messages[0]!)!, /System instruction:\nBe accurate\./);
    assert.match(text(messages[1]!)!, /Developer instruction:\nCite sources\./);
    assert.match(text(messages[2]!)!, /Summary:\nEarlier summary\./);
    assert.match(text(messages[4]!)!, /Attachment notes\.md:\n# Notes/);
    assert.match(text(messages[5]!)!, /Resource file\.md:\nloaded text/);
  });

  it("adds tool result messages without executing tools", async () => {
    const toolResults: ToolResult[] = [{ toolCallId: "call_1", name: "lookup", value: { ok: true } }];

    const messages = await createDefaultInputBuilder().build("Continue", { toolResults });

    assert.equal(messages.at(-1)?.role, "tool");
    assert.deepEqual(messages.at(-1)?.content[0], {
      type: "tool_result",
      toolCallId: "call_1",
      name: "lookup",
      result: { ok: true },
      error: undefined,
    });
  });

  it("keeps legacy layout as the default", async () => {
    const messages = await createDefaultInputBuilder().build("Now", {
      summaries: ["Earlier"],
      history: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      attachments: [{ name: "notes.md", text: "notes" }],
    });

    assert.deepEqual(messages.map((message) => message.role), ["system", "assistant", "user", "user"]);
    assert.match(text(messages[0]!)!, /Summary:\nEarlier/);
    assert.equal(text(messages[2]!), "Now");
    assert.match(text(messages[3]!)!, /Attachment notes\.md:\nnotes/);
  });

  it("cache-aware layout puts stable attachments resources summaries and history before current input", async () => {
    const calls: string[] = [];
    const resourceLoader: ResourceLoader = { async load(uri) { calls.push(uri); return { uri, text: "resource" }; } };
    const messages = await createDefaultInputBuilder().build("Now", {
      inputLayout: "cache_aware",
      summaries: ["Earlier"],
      history: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      attachments: [{ name: "notes.md", text: "notes" }],
      resourceUris: ["package://demo/context.md"],
      resourceLoader,
    });

    assert.deepEqual(calls, ["package://demo/context.md"]);
    assert.deepEqual(messages.map((message) => message.role), ["user", "user", "system", "assistant", "user"]);
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

    assert.deepEqual(messages.map((message) => message.role), ["assistant", "tool", "user"]);
    assert.equal(messages[0]?.content[0]?.type, "tool_call");
    assert.equal(messages[1]?.content[0]?.type, "tool_result");
    assert.equal(text(messages[2]!), "Follow up");
  });

  it("runs input assembly middleware only when supplied", async () => {
    const middleware = createMiddlewareRegistry();
    middleware.use<readonly Message[]>("input_assembly", (messages) => [
      ...messages,
      { role: "system", content: [{ type: "text", text: "middleware" }] },
    ]);

    assert.equal((await createDefaultInputBuilder().build("Hi")).length, 1);
    assert.equal((await createDefaultInputBuilder().build("Hi", { middleware })).length, 2);
  });
});

describe("prompt template rendering", () => {
  it("replaces variables", () => {
    assert.equal(renderPromptTemplate("Review {{file}} for {{focus}}", { file: "src/index.ts", focus: "exports" }), "Review src/index.ts for exports");
  });

  it("stringifies json values deterministically", () => {
    assert.equal(renderPromptTemplate("{{count}} {{ok}} {{nothing}} {{items}} {{object}}", {
      count: 2,
      ok: true,
      nothing: null,
      items: ["b", { z: 1, a: 2 }],
      object: { z: 1, a: 2 },
    }), "2 true null [\"b\",{\"a\":2,\"z\":1}] {\"a\":2,\"z\":1}");
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

describe("extension contribution integration", () => {
  it("extension registered input builder is inert until host uses it", async () => {
    const kernel = createExtensionKernel();
    await kernel.load([{ name: "input", setup: (api) => {
      api.registerInputBuilder({ name: "custom-input", build: () => [{ role: "user", content: [{ type: "text", text: "custom" }] }] });
    } }]);

    const defaultRequest = await assembleProviderInput({ model: { provider: "mock", model: "demo" }, input: "default" });
    const customRequest = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "default",
      inputBuilder: kernel.registries.inputBuilders.resolve("custom-input"),
    });

    assert.equal(text(defaultRequest.messages.at(-1)!), "default");
    assert.equal(text(customRequest.messages.at(-1)!), "custom");
  });

  it("extension registered context provider is selected explicitly", async () => {
    const kernel = createExtensionKernel();
    await kernel.load([{ name: "context", setup: (api) => {
      api.registerContextProvider({ name: "project", resolve: () => [{ title: "Project", content: "selected" }] });
    } }]);

    const withoutContext = await assembleProviderInput({ model: { provider: "mock", model: "demo" }, input: "Hi" });
    const withContext = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      contextProviders: [kernel.registries.contextProviders.resolve("project")],
    });

    assert.equal(withoutContext.context?.length, 0);
    assert.equal(withContext.context?.[0]?.title, "Project");
  });

  it("extension registered prompt builder can replace default", async () => {
    const kernel = createExtensionKernel();
    await kernel.load([{ name: "prompt", setup: (api) => {
      api.registerPromptBuilder({ name: "custom-prompt", build: () => [{ role: "system", content: [{ type: "text", text: "custom prompt" }] }] });
    } }]);

    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "ignored",
      promptBuilder: kernel.registries.promptBuilders.resolve("custom-prompt"),
    });

    assert.deepEqual(request.messages, [{ role: "system", content: [{ type: "text", text: "custom prompt" }] }]);
  });

  it("input context prompt middleware runs in documented order", async () => {
    const order: string[] = [];
    const kernel = createExtensionKernel();
    await kernel.load([{ name: "mw", setup: (api) => {
      api.use<readonly Message[]>("input_assembly", (messages) => { order.push("input"); return messages; });
      api.use("context", (blocks: readonly { content: string }[]) => { order.push("context"); return blocks; });
      api.use("prompt_build", (request) => { order.push("prompt"); return request; });
      api.registerContextProvider({ name: "ctx", resolve: () => [{ content: "ctx" }] });
    } }]);

    await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hi",
      contextProviders: [kernel.registries.contextProviders.resolve("ctx")],
      middleware: kernel.middleware,
    });

    assert.deepEqual(order, ["input", "context", "prompt"]);
  });

  it("extension registered skill is selected explicitly before prompt use", async () => {
    const tool: ToolDefinition = { name: "echo", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const kernel = createExtensionKernel();
    await kernel.load([{ name: "skill", setup: (api) => {
      api.registerSkill({ name: "brief", instructions: "Be brief.", toolNames: ["echo"] });
    } }]);
    const registry = createSkillRegistry([kernel.registries.skills.resolve("brief")]);
    const skills = resolveActiveSkills({ registry, names: ["brief"], tools: [tool] });

    const request = await assembleProviderInput({ model: { provider: "mock", model: "demo" }, input: "Hi", skills, tools: [tool] });

    assert.match(request.messages.map((message) => text(message) ?? "").join("\n"), /Skill brief:\nBe brief\./);
  });
});

describe("context resolution and prompt composition", () => {
  it("runs context providers in order and passes context", async () => {
    const calls: string[] = [];
    const providers: ContextProvider[] = ["one", "two"].map((name) => ({
      name,
      resolve(context) {
        calls.push(`${name}:${context.sessionId}:${context.runId}:${text(context.messages[0]!)}`);
        return [{ title: name, content: name }];
      },
    }));

    const blocks = await resolveContextProviders({
      providers,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      sessionId: "s1",
      runId: "r1",
    });

    assert.deepEqual(calls, ["one:s1:r1:hi", "two:s1:r1:hi"]);
    assert.deepEqual(blocks.map((block) => block.title), ["one", "two"]);
  });

  it("respects abort signal before later providers", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const providers: ContextProvider[] = [
      { name: "one", resolve: () => { calls.push("one"); controller.abort(); return []; } },
      { name: "two", resolve: () => { calls.push("two"); return []; } },
    ];

    await assert.rejects(() => resolveContextProviders({ providers, messages: [], signal: controller.signal }), /aborted/);
    assert.deepEqual(calls, ["one"]);
  });

  it("context middleware can transform blocks", async () => {
    const middleware = createMiddlewareRegistry();
    middleware.use("context", (blocks: readonly { title?: string; content: string }[]) => [...blocks, { title: "added", content: "middleware" }]);

    const blocks = await resolveContextProviders({
      providers: [{ name: "base", resolve: () => [{ title: "base", content: "context" }] }],
      messages: [],
      middleware,
    });

    assert.deepEqual(blocks.map((block) => block.title), ["base", "added"]);
  });

  it("default prompt builder includes context skills tools and messages", async () => {
    const tool: ToolDefinition = { name: "echo", description: "Echo input", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const messages = await createDefaultPromptBuilder().build({
      messages: [{ role: "user", content: [{ type: "text", text: "Question" }] }],
      context: [{ title: "Project", content: "Context" }],
      skills: [{ name: "brief", instructions: "Be brief." }],
      tools: [tool],
    });

    assert.deepEqual(messages.map((message) => message.role), ["system", "system", "system", "user"]);
    assert.match(text(messages[0]!)!, /Project:\nContext/);
    assert.match(text(messages[1]!)!, /Skill brief:\nBe brief\./);
    assert.match(text(messages[2]!)!, /Available tools:\n- echo: Echo input/);
  });

  it("cache-aware provider input has byte-stable prefix for different current user turns", async () => {
    const tool: ToolDefinition = { name: "echo", description: "Echo input", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const common = {
      model: { provider: "mock", model: "demo" },
      inputLayout: "cache_aware" as const,
      systemInstructions: "Rules",
      summaries: ["Summary"],
      history: [{ role: "assistant" as const, content: [{ type: "text" as const, text: "old" }] }],
      attachments: [{ name: "schema.md", text: "stable schema" }],
      contextProviders: [{ name: "project", resolve: () => [{ title: "Project", content: "Context" }] }],
      tools: [tool],
    };
    const first = await assembleProviderInput({ ...common, input: "Ask A" });
    const second = await assembleProviderInput({ ...common, input: "Ask B" });
    const prefix = (messages: readonly Message[], current: string) => messages.slice(0, messages.findIndex((message) => text(message) === current));

    assert.deepEqual(JSON.parse(JSON.stringify(prefix(first.messages, "Ask A"))), JSON.parse(JSON.stringify(prefix(second.messages, "Ask B"))));
    assert.equal(first.messages.at(-1) ? text(first.messages.at(-1)!) : undefined, "Ask A");
    assert.equal(second.messages.at(-1) ? text(second.messages.at(-1)!) : undefined, "Ask B");
  });

  it("assembles provider input without calling provider or executing tools", async () => {
    let executed = false;
    const tool: ToolDefinition = { name: "echo", execute: () => { executed = true; return { toolCallId: "c", name: "echo" }; } };
    const middleware = createMiddlewareRegistry();
    middleware.use("prompt_build", (request: { tools?: readonly ToolDefinition[] }) => ({
      ...request,
      tools: [{ name: "bad", execute: () => ({ toolCallId: "bad", name: "bad" }) }],
    }));

    const request = await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Hello",
      contextProviders: [{ name: "project", resolve: () => [{ title: "Project", content: "Context" }] }],
      tools: [tool],
      middleware,
    });

    assert.equal(executed, false);
    assert.deepEqual(request.tools, [tool]);
    assert.equal(request.context?.[0]?.title, "Project");
    assert.equal(request.messages.at(-1)?.role, "user");
  });
});
