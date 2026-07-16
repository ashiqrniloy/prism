import type {
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import type { ProviderEvent, Usage } from "@arnilo/prism";
import {
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
} from "@arnilo/prism";
import { parseJsonObjectArguments } from "@arnilo/prism/providers/transport";
import { AiSdkProviderError } from "./errors.js";

interface ToolAccumulator {
  id: string;
  name: string;
  argumentsText: string;
  index: number;
}

export async function* mapAiSdkStream(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const tools = new Map<string, ToolAccumulator>();
  let nextIndex = 0;
  let usage: Usage | undefined;
  let sawFinish = false;

  for await (const part of readStream(stream, signal)) {
    for (const event of mapStreamPart(part, tools, () => nextIndex++)) {
      if (event.type === "usage") usage = event.usage;
      if (event.type === "done") {
        sawFinish = true;
        usage = event.usage ?? usage;
      }
      yield event;
      if (event.type === "error") return;
    }
  }

  if (!sawFinish) yield providerDone(usage);
}

function mapStreamPart(
  part: LanguageModelV4StreamPart,
  tools: Map<string, ToolAccumulator>,
  allocateIndex: () => number,
): readonly ProviderEvent[] {
  switch (part.type) {
    case "stream-start":
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
    case "tool-input-end":
    case "response-metadata":
    case "raw":
    case "file":
    case "source":
    case "reasoning-file":
    case "tool-approval-request":
    case "tool-result":
    case "custom":
      return [];
    case "text-delta":
      return part.delta ? [providerTextDelta(part.delta)] : [];
    case "reasoning-delta":
      return part.delta ? [providerThinkingDelta(part.delta)] : [];
    case "tool-input-start": {
      const index = allocateIndex();
      tools.set(part.id, {
        id: part.id,
        name: part.toolName,
        argumentsText: "",
        index,
      });
      return [providerToolCallDelta({ index, id: part.id, name: part.toolName })];
    }
    case "tool-input-delta": {
      const current = tools.get(part.id);
      if (!current) {
        const index = allocateIndex();
        tools.set(part.id, {
          id: part.id,
          name: "",
          argumentsText: part.delta,
          index,
        });
        return [providerToolCallDelta({ index, id: part.id, argumentsText: part.delta })];
      }
      current.argumentsText += part.delta;
      return [providerToolCallDelta({
        index: current.index,
        id: current.id,
        name: current.name || undefined,
        argumentsText: part.delta,
      })];
    }
    case "tool-call": {
      if (part.providerExecuted) return [];
      const existing = tools.get(part.toolCallId);
      const index = existing?.index ?? allocateIndex();
      tools.set(part.toolCallId, {
        id: part.toolCallId,
        name: part.toolName,
        argumentsText: part.input,
        index,
      });
      try {
        return [providerToolCall(toolCallContent(
          part.toolCallId,
          part.toolName,
          parseJsonObjectArguments(part.input, { toolName: part.toolName }),
        ))];
      } catch (error) {
        throw new AiSdkProviderError(
          "invalid_tool_arguments",
          error instanceof Error ? error.message : "Invalid AI SDK tool-call arguments",
          { cause: error },
        );
      }
    }
    case "finish": {
      const mapped = mapUsage(part.usage);
      return mapped ? [providerUsage(mapped), providerDone(mapped)] : [providerDone()];
    }
    case "error":
      return [providerError(part.error)];
    default: {
      const _exhaustive: never = part;
      void _exhaustive;
      return [];
    }
  }
}

export function mapUsage(usage: LanguageModelV4Usage | undefined): Usage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.inputTokens.total;
  const outputTokens = usage.outputTokens.total;
  const cacheReadTokens = usage.inputTokens.cacheRead;
  const cacheWriteTokens = usage.inputTokens.cacheWrite;
  const totalTokens =
    inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined;
  const mapped: Usage = {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
  return Object.values(mapped).some((value) => value !== undefined) ? mapped : undefined;
}

async function* readStream<T>(
  stream: ReadableStream<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  if (signal?.aborted) {
    throw new AiSdkProviderError("aborted", "AI SDK provider request aborted", {
      cause: signal.reason,
    });
  }
  const reader = stream.getReader();
  const onAbort = () => {
    void reader.cancel(signal?.reason ?? new AiSdkProviderError("aborted", "AI SDK provider request aborted"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) {
        throw new AiSdkProviderError("aborted", "AI SDK provider request aborted", {
          cause: signal.reason,
        });
      }
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
