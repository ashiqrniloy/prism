import type { JsonObject, ProviderEvent, ProviderRequest, Usage } from "@arnilo/prism";
import { assertStructuredOutputRequestSupported } from "@arnilo/prism";
import { providerDone, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, toolCallContent } from "@arnilo/prism";
import { applyOpenAIChatStructuredOutput, mapOpenAIChatUsage, serializeOpenAIChatMessage, serializeOpenAITool } from "@arnilo/prism/providers/openai";
import { parseJsonObjectArguments, readSseData } from "@arnilo/prism/providers/transport";

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

export function openAIChatBody(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => serializeOpenAIChatMessage(message, request.model.capabilities ?? {})),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    ...parameters,
    max_tokens: maxTokens,
    ...(request.options?.compat ?? {}),
    ...(request.options?.extra ?? {}),
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* openAIChatEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data) as OpenAIChunk;
    usage = mapOpenAIChatUsage(chunk.usage) ?? usage;
    const mapped = mapOpenAIChatUsage(chunk.usage);
    if (mapped) yield providerUsage(mapped);
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (delta.content) yield providerTextDelta(delta.content);
      if (delta.reasoning_content) yield providerThinkingDelta(delta.reasoning_content);
      for (const tool of delta.tool_calls ?? []) {
        const index = tool.index ?? 0;
        const current = tools.get(index) ?? { argumentsText: "" };
        current.id = tool.id ?? current.id;
        current.name = tool.function?.name ?? current.name;
        current.argumentsText += tool.function?.arguments ?? "";
        tools.set(index, current);
        yield providerToolCallDelta({ index, id: tool.id, name: tool.function?.name, argumentsText: tool.function?.arguments });
      }
    }
  }
  for (const call of tools.values()) {
    if (call.id && call.name) {
      yield providerToolCall(toolCallContent(
        call.id,
        call.name,
        parseJsonObjectArguments(call.argumentsText, { toolName: call.name }),
      ));
    }
  }
  yield providerDone(usage);
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

interface OpenAIChunk {
  readonly choices?: readonly { readonly delta?: { readonly content?: string; readonly reasoning_content?: string; readonly tool_calls?: readonly { readonly index?: number; readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[] } }[];
  readonly usage?: unknown;
}
