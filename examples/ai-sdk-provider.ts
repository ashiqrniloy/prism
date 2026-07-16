import { createAgent } from "@arnilo/prism";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createAiSdkProvider } from "@arnilo/prism-provider-ai-sdk";

function createFakeLanguageModel(parts: readonly LanguageModelV4StreamPart[]): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-demo",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("demo uses streaming only");
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  };
}

const model = createFakeLanguageModel([
  { type: "text-delta", id: "t1", delta: "AI SDK model interoperates with Prism." },
  {
    type: "finish",
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 6, text: 6, reasoning: undefined },
    },
  },
]);

const provider = createAiSdkProvider({ model });
const agent = createAgent({
  provider,
  model: {
    provider: provider.id,
    model: model.modelId,
    capabilities: { tools: true, streaming: true, structuredOutput: true, input: ["text"] },
  },
});

const result = await agent.createSession().run("Demonstrate AI SDK interoperability");
console.log(result.text);
console.log(result.usage);
