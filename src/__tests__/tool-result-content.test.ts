import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  type ModelProvider,
  createAgent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { EMPTY_TOOL_RESULT_TEXT, toToolResultMessage } from "../input.js";
import { serializeOpenAIChatMessage } from "../provider-kit/openai-primitives.js";
import { openAIChatBody } from "../provider-kit/codecs/openai-chat.js";
import type { Message as ProviderMessage } from "../contracts.js";
import { redactMessage } from "../redaction.js";
import { assertMessagesSupportModelCapabilities } from "../content.js";
import { providerPackage } from "../provider-kit/index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("tool result content on provider wire", () => {
  it("folds content-only tool results onto tool_result.result and serializes without null", async () => {
    let replay: ProviderRequest | undefined;
    const listing = "file AGENTS.md";
    const provider: ModelProvider = {
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

    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [provider])],
        tools: {
          add: [
            {
              name: "repo_list",
              execute: (_args, context) => ({
                toolCallId: context.toolCallId,
                name: "repo_list",
                content: [{ type: "text", text: listing }],
              }),
            },
          ],
        },
      })
    ).session();
    const pending = collect(session.subscribe());
    await session.run("list");
    const events = await pending;

    const finished = events.find((event) => event.type === "tool.completed");
    assert.equal(finished?.type === "tool.completed" ? finished.result.content?.[0]?.type : undefined, "text");

    const tool = replay?.messages.find((message) => message.role === "tool");
    assert.ok(tool);
    const block = tool.content.find((part) => part.type === "tool_result");
    assert.equal(block?.type === "tool_result" ? block.result : undefined, listing);
    assert.equal(
      tool.content.some((part) => part.type === "text"),
      false,
    );
    assert.equal(serializeOpenAIChatMessage(tool).content, listing);
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
    assert.equal(serializeOpenAIChatMessage(message).content, EMPTY_TOOL_RESULT_TEXT);
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
    // An error reaches the model as its message, not as an escaped JSON object.
    assert.equal(serializeOpenAIChatMessage(message).content, error.message);
  });

  it("openai_chat_tool_image_follows_as_user_message", () => {
    const messages: ProviderMessage[] = [
      { role: "assistant", content: [{ type: "tool_call", id: "c1", name: "read", arguments: {} }] },
      { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "read", result: "grab" }, { type: "image", mimeType: "image/png", data: PNG_1X1 }] },
      { role: "tool", content: [{ type: "tool_result", toolCallId: "c2", name: "read", result: "plain" }] },
    ];
    const body = openAIChatBody({
      model: { provider: "mock", model: "demo", capabilities: { input: ["text", "image"] } },
      messages,
    });
    const wire = body.messages as any[];
    // Tool replies stay contiguous; the images ride in one user message after the round.
    assert.deepEqual(wire.map((message) => message.role), ["assistant", "tool", "tool", "user"]);
    assert.equal(wire[3].content[0].text, "Images returned by read (c1):");
    assert.equal(wire[3].content[1].type, "image_url");
    assert.match(wire[3].content[1].image_url.url, /^data:image\/png;base64,/);
  });

  it("openai_chat_tool_image_without_capability_is_noted", () => {
    const body = openAIChatBody({
      model: { provider: "mock", model: "demo", capabilities: { input: ["text"] } },
      messages: [
        { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "read", result: "grab" }, { type: "image", mimeType: "image/png", data: PNG_1X1 }] },
      ],
    });
    const wire = body.messages as any[];
    assert.equal(wire.length, 1);
    assert.equal(wire[0].role, "tool");
    assert.match(wire[0].content, /grab/);
    assert.match(wire[0].content, /\[image omitted: the model does not accept images\]/);
  });

  it("tool_result_redaction_survives_encoding", () => {
    const secret = "sk-live-9f8e";
    const redacted = redactMessage(
      { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "shell", result: `token=${secret}` }] },
      { redact: (value) => JSON.parse(JSON.stringify(value).split(secret).join("[REDACTED]")) },
    );
    const content = serializeOpenAIChatMessage(redacted).content as string;
    assert.equal(content, "token=[REDACTED]");
    assert.ok(!content.includes(secret), "the raw secret must not reach the wire");
  });
});

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

describe("tool-result images and the request capability gate", () => {
  const textOnly = { provider: "mock", model: "demo", capabilities: { input: ["text" as const] } };
  const toolImage: ProviderMessage = {
    role: "tool",
    content: [
      { type: "tool_result", toolCallId: "c1", name: "read", result: "grab" },
      { type: "image", mimeType: "image/png", data: "AAAA" },
    ],
  };

  it("does not fail the gate for a tool-result image", () => {
    // The codecs render it as a note, so the request is representable on a text-only model.
    assert.doesNotThrow(() => assertMessagesSupportModelCapabilities(textOnly, [toolImage]));
  });

  it("still fails the gate for a user-message image", () => {
    assert.throws(
      () =>
        assertMessagesSupportModelCapabilities(textOnly, [
          { role: "user", content: [{ type: "image", mimeType: "image/png", data: "AAAA" }] },
        ]),
      /image/,
    );
  });
});
