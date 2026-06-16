import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleProviderInput,
  createDefaultInputBuilder,
  createDefaultPromptBuilder,
  createMiddlewareRegistry,
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
