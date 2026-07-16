import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import type { ModelConfig, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import {
  assertToolCallDeltasReconstruct,
  collectProviderEvents,
} from "@arnilo/prism/testing/provider-conformance";
import { createAiSdkProvider } from "../provider.js";
import { AiSdkProviderError } from "../errors.js";
import { toAiSdkCallOptions } from "../prompt.js";

const MODEL: ModelConfig = {
  provider: "ai-sdk",
  model: "fake-1",
  capabilities: {
    tools: true,
    streaming: true,
    structuredOutput: true,
    input: ["text", "image"],
  },
};

const emptyUsage = (): LanguageModelV4Usage => ({
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
});

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0): LanguageModelV4Usage {
  return {
    inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

function streamOf(parts: readonly LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function createFakeModel(options: {
  parts?: readonly LanguageModelV4StreamPart[];
  onStream?: (call: LanguageModelV4CallOptions) => void;
  streamFactory?: (call: LanguageModelV4CallOptions) => ReadableStream<LanguageModelV4StreamPart>;
  fail?: unknown;
}): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-1",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("doGenerate should not be used by the Prism adapter");
    },
    doStream: async (call) => {
      options.onStream?.(call);
      if (options.fail !== undefined) throw options.fail;
      return {
        stream: options.streamFactory?.(call) ?? streamOf(options.parts ?? [{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: emptyUsage() }]),
        warnings: [],
      };
    },
  };
}

function request(partial: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: MODEL,
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    ...partial,
  };
}

describe("createAiSdkProvider", () => {
  it("maps text/reasoning/tool fragments, usage, finish, and metadata without buffering", async () => {
    const callOrder: string[] = [];
    const provider = createAiSdkProvider({
      model: createFakeModel({
        parts: [
          { type: "stream-start", warnings: [{ type: "other", message: "ignored" }] },
          { type: "response-metadata", id: "resp_1", modelId: "fake-1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hello" },
          { type: "text-delta", id: "t1", delta: " world" },
          { type: "text-end", id: "t1" },
          { type: "reasoning-start", id: "r1" },
          { type: "reasoning-delta", id: "r1", delta: "think" },
          { type: "reasoning-end", id: "r1" },
          { type: "tool-input-start", id: "call_1", toolName: "echo" },
          { type: "tool-input-delta", id: "call_1", delta: "{\"x\":" },
          { type: "tool-input-delta", id: "call_1", delta: "1}" },
          { type: "tool-input-end", id: "call_1" },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "echo",
            input: "{\"x\":1}",
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: usage(10, 4, 2, 1),
            providerMetadata: { fake: { requestId: "meta-1" } },
          },
        ],
        onStream: () => callOrder.push("stream"),
      }),
    });

    const events = await collectProviderEvents(provider, request({
      tools: [{
        name: "echo",
        description: "Echo",
        parameters: { type: "object", properties: { x: { type: "number" } } },
        execute: async () => ({ toolCallId: "call_1", name: "echo", value: 1 }),
      }],
    }));

    assert.deepEqual(callOrder, ["stream"]);
    assert.equal(events.filter((event) => event.type === "content_delta" && event.content.type === "text").length, 2);
    assert.equal(events.some((event) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "think"), true);
    const toolCalls = assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "echo", arguments: { x: 1 } }]);
    assert.equal(toolCalls.length, 1);
    assert.equal(events.some((event) => event.type === "tool_call" && event.call.id === "call_1"), true);
    const usageEvent = events.find((event) => event.type === "usage");
    assert.deepEqual(usageEvent?.type === "usage" ? usageEvent.usage : undefined, {
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    });
    assert.equal(events.at(-1)?.type, "done");
  });

  it("maps structured-output options and rejects unsupported content before model invocation", async () => {
    let calls = 0;
    const provider = createAiSdkProvider({
      model: createFakeModel({
        onStream: (call) => {
          calls += 1;
          assert.deepEqual(call.responseFormat, {
            type: "json",
            name: "Answer",
            schema: { type: "object", properties: { ok: { type: "boolean" } } },
          });
        },
        parts: [
          { type: "text-delta", id: "t", delta: "{\"ok\":true}" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(1, 1) },
        ],
      }),
    });

    const ok = await collectProviderEvents(provider, request({
      options: {
        structuredOutput: {
          name: "Answer",
          schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      },
    }));
    assert.equal(calls, 1);
    assert.equal(ok.some((event) => event.type === "done"), true);

    const rejected = await collectProviderEvents(provider, request({
      messages: [{
        role: "user",
        content: [{ type: "audio", mediaType: "audio/wav", data: "AAAA" }],
      }],
    }));
    assert.equal(calls, 1, "model must not be invoked for unsupported content");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.type, "error");
    assert.match(rejected[0]?.type === "error" ? rejected[0].error.message : "", /audio/);
  });

  it("replays multi-turn Prism tool transcripts through AI SDK prompt messages", () => {
    const tool: ToolDefinition = {
      name: "lookup",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      execute: async () => ({ toolCallId: "1", name: "lookup", value: { hit: true } }),
    };
    const options = toAiSdkCallOptions(request({
      tools: [tool],
      messages: [
        { role: "user", content: [{ type: "text", text: "find it" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "calling" },
            { type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "prism" } },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { hit: true } }],
        },
      ],
    }));

    assert.equal(options.tools?.[0]?.type, "function");
    assert.equal(options.prompt.length, 3);
    assert.equal(options.prompt[1]?.role, "assistant");
    assert.equal(options.prompt[2]?.role, "tool");
    const assistant = options.prompt[1];
    assert.ok(assistant && assistant.role === "assistant");
    assert.deepEqual(assistant.content[1], {
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "lookup",
      input: { q: "prism" },
    });
    const toolMessage = options.prompt[2];
    assert.ok(toolMessage && toolMessage.role === "tool");
    assert.deepEqual(toolMessage.content[0], {
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "lookup",
      output: { type: "json", value: { hit: true } },
    });
  });

  it("propagates abort and model errors as provider error events", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort(new Error("user-abort"));
    const provider = createAiSdkProvider({
      model: createFakeModel({
        parts: [{ type: "text-delta", id: "t", delta: "should-not-run" }],
      }),
    });
    const aborted = await collectProviderEvents(provider, request({ signal: alreadyAborted.signal }));
    assert.equal(aborted.length, 1);
    assert.equal(aborted[0]?.type, "error");
    assert.match(aborted[0]?.type === "error" ? aborted[0].error.message : "", /aborted/i);

    const midAbort = new AbortController();
    const midProvider = createAiSdkProvider({
      model: createFakeModel({
        streamFactory: () => new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({ type: "text-delta", id: "t", delta: "partial" });
          },
          pull(ctrl) {
            midAbort.abort(new Error("user-abort"));
            ctrl.close();
          },
        }),
      }),
    });
    const mid = await collectProviderEvents(midProvider, request({ signal: midAbort.signal }));
    assert.equal(mid.some((event) => event.type === "content_delta"), true);
    assert.equal(mid.at(-1)?.type, "error");

    const failing = createAiSdkProvider({
      model: createFakeModel({ fail: new Error("upstream boom") }),
    });
    const failed = await collectProviderEvents(failing, request());
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.type, "error");
    assert.match(failed[0]?.type === "error" ? failed[0].error.message : "", /upstream boom/);
  });

  it("rejects non-v4 language models", () => {
    assert.throws(
      () => createAiSdkProvider({ model: { specificationVersion: "v3" } as unknown as LanguageModelV4 }),
      (error: unknown) => error instanceof AiSdkProviderError && error.code === "unsupported_specification",
    );
  });
});
