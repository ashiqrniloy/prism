import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  type AIProvider,
  createAgent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { EMPTY_TOOL_RESULT_TEXT, toToolResultMessage } from "../input.js";
import { serializeOpenAIChatMessage } from "../providers/openai-primitives.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("tool result content on provider wire", () => {
  it("folds content-only tool results onto tool_result.result and serializes without null", async () => {
    let replay: ProviderRequest | undefined;
    const listing = "file AGENTS.md";
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) {
          replay = request;
          yield providerTextDelta("ok");
          yield providerDone();
          return;
        }
        yield { type: "tool_call", call: toolCallContent("c1", "repo_list", {}) };
        yield providerDone();
      },
    };

    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [
        {
          name: "repo_list",
          execute: (_args, context) => ({
            toolCallId: context.toolCallId,
            name: "repo_list",
            content: [{ type: "text", text: listing }],
          }),
        },
      ],
    }).createSession();
    const pending = collect(session.subscribe());
    await session.run("list");
    const events = await pending;

    const finished = events.find((event) => event.type === "tool_execution_finished");
    assert.equal(finished?.type === "tool_execution_finished" ? finished.result.content?.[0]?.type : undefined, "text");

    const tool = replay?.messages.find((message) => message.role === "tool");
    assert.ok(tool);
    const block = tool.content.find((part) => part.type === "tool_result");
    assert.equal(block?.type === "tool_result" ? block.result : undefined, listing);
    assert.equal(
      tool.content.some((part) => part.type === "text"),
      false,
    );
    assert.equal(serializeOpenAIChatMessage(tool).content, JSON.stringify(listing));
    assert.notEqual(serializeOpenAIChatMessage(tool).content, "null");
  });

  it("keeps explicit value when content is also set", () => {
    const message = toToolResultMessage({
      toolCallId: "c1",
      name: "github",
      value: { ok: true },
      content: [{ type: "text", text: '{"ok":true}' }],
    });
    const block = message.content.find((part) => part.type === "tool_result");
    assert.deepEqual(block?.type === "tool_result" ? block.result : undefined, { ok: true });
    assert.equal(
      message.content.some((part) => part.type === "text"),
      false,
    );
  });

  it("serializes an all-empty tool result as the non-empty sentinel", () => {
    const message = toToolResultMessage({ toolCallId: "c1", name: "shell" });
    const block = message.content.find((part) => part.type === "tool_result");
    assert.equal(block?.type === "tool_result" ? block.result : undefined, EMPTY_TOOL_RESULT_TEXT);
    assert.equal(serializeOpenAIChatMessage(message).content, JSON.stringify(EMPTY_TOOL_RESULT_TEXT));
    assert.notEqual(serializeOpenAIChatMessage(message).content, "null");
    assert.notEqual(serializeOpenAIChatMessage(message).content, '""');
  });

  it("treats an empty text content block like an absent one", () => {
    const message = toToolResultMessage({ toolCallId: "c1", name: "shell", content: [{ type: "text", text: "" }] });
    const block = message.content.find((part) => part.type === "tool_result");
    assert.equal(block?.type === "tool_result" ? block.result : undefined, EMPTY_TOOL_RESULT_TEXT);
  });

  it("keeps error-only tool results unchanged", () => {
    const error = { name: "Error", message: "boom", code: "E_BOOM" };
    const message = toToolResultMessage({ toolCallId: "c1", name: "shell", error });
    const block = message.content.find((part) => part.type === "tool_result");
    assert.equal(block?.type === "tool_result" ? block.result : undefined, undefined);
    assert.deepEqual(block?.type === "tool_result" ? block.error : undefined, error);
    assert.equal(serializeOpenAIChatMessage(message).content, JSON.stringify(error));
  });
});
