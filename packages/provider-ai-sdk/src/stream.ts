import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import type { ProviderEvent, SecretRedactor, ToolCallAuthority, Usage } from "@arnilo/prism";
import {
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerUsage,
  toolCallFromArgumentsText,
} from "@arnilo/prism";
import { AiSdkProviderError } from "./errors.js";

interface ToolAccumulator {
  readonly id: string;
  readonly name: string;
  argumentsText: string;
  readonly index: number;
  readonly authority?: ToolCallAuthority;
}

interface StreamState {
  readonly tools: Map<string, ToolAccumulator>;
  nextIndex: number;
  readonly redactor?: SecretRedactor;
}

type StreamPartType = LanguageModelV4StreamPart["type"];
type StreamPartMapper<T extends StreamPartType = StreamPartType> = (
  part: Extract<LanguageModelV4StreamPart, { type: T }>,
  state: StreamState,
) => readonly ProviderEvent[];

/** Pinned V4 stream-part contract. Every entry either normalizes or rejects a part. */
export const AI_SDK_STREAM_PART_MAPPINGS = {
  "stream-start": () => [], // Warnings have no normalized event and may contain provider-private data.
  "text-start": () => [],
  "text-delta": (part) => (part.delta ? [providerTextDelta(part.delta)] : []),
  "text-end": () => [],
  "reasoning-start": () => [],
  "reasoning-delta": (part) => (part.delta ? [providerThinkingDelta(part.delta)] : []),
  "reasoning-end": () => [],
  "tool-input-start": (part, state) => {
    const index = state.nextIndex++;
    const authority = part.providerExecuted ? "provider-hosted" : undefined;
    state.tools.set(part.id, { id: part.id, name: part.toolName, argumentsText: "", index, authority });
    return [{ type: "tool_call_delta", index, id: part.id, name: part.toolName, authority }];
  },
  "tool-input-delta": (part, state) => {
    const current = state.tools.get(part.id);
    if (!current) {
      const index = state.nextIndex++;
      state.tools.set(part.id, { id: part.id, name: "", argumentsText: part.delta, index });
      return [{ type: "tool_call_delta", index, id: part.id, argumentsText: part.delta }];
    }
    current.argumentsText += part.delta;
    return [
      {
        type: "tool_call_delta",
        index: current.index,
        id: current.id,
        name: current.name || undefined,
        argumentsText: part.delta,
        authority: current.authority,
      },
    ];
  },
  "tool-input-end": () => [],
  "tool-call": (part, state) => {
    const existing = state.tools.get(part.toolCallId);
    const authority = part.providerExecuted ? "provider-hosted" : existing?.authority;
    const call = toolCallFromArgumentsText(part.toolCallId, part.toolName, part.input);
    return [providerToolCall(authority ? { ...call, authority } : call)];
  },
  "tool-result": () => [], // Provider-executed result stays provider-side; its call is attributable above.
  "response-metadata": (part) => (part.id ? [{ type: "message_start", messageId: part.id }] : []),
  finish: (part) => {
    const usage = mapUsage(part.usage);
    return usage ? [providerUsage(usage), providerDone(usage)] : [providerDone()];
  },
  error: (part, state) => [toErrorEvent(part.error, state.redactor)],
  raw: () => [], // Transport diagnostics are neither normalized content nor safe telemetry.
  file: (part, state) => unsupportedPart(part.type, state.redactor),
  "reasoning-file": (part, state) => unsupportedPart(part.type, state.redactor),
  source: (part, state) => unsupportedPart(part.type, state.redactor),
  custom: (part, state) => unsupportedPart(part.type, state.redactor),
  "tool-approval-request": (part, state) => unsupportedPart(part.type, state.redactor),
} satisfies { readonly [T in StreamPartType]: StreamPartMapper<T> };

export async function* mapAiSdkStream(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  signal?: AbortSignal,
  redactor?: SecretRedactor,
): AsyncIterable<ProviderEvent> {
  const state: StreamState = { tools: new Map(), nextIndex: 0, redactor };
  let usage: Usage | undefined;
  let sawFinish = false;

  for await (const part of readStream(stream, signal)) {
    for (const event of mapStreamPart(part, state)) {
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

function mapStreamPart(part: LanguageModelV4StreamPart, state: StreamState): readonly ProviderEvent[] {
  const mapper = AI_SDK_STREAM_PART_MAPPINGS[part.type] as StreamPartMapper | undefined;
  return mapper ? mapper(part, state) : unsupportedPart(String(part.type), state.redactor);
}

export function mapUsage(usage: LanguageModelV4Usage | undefined): Usage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.inputTokens.total;
  const outputTokens = usage.outputTokens.total;
  const cacheReadTokens = usage.inputTokens.cacheRead;
  const cacheWriteTokens = usage.inputTokens.cacheWrite;
  const totalTokens = inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined;
  const mapped: Usage = { inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens };
  return Object.values(mapped).some((value) => value !== undefined) ? mapped : undefined;
}

function unsupportedPart(type: string, redactor?: SecretRedactor): readonly ProviderEvent[] {
  return [toErrorEvent(new AiSdkProviderError("unsupported_mapping", `AI SDK stream part "${type}" is unsupported`), redactor)];
}

function toErrorEvent(error: unknown, redactor?: SecretRedactor): ProviderEvent {
  const event = providerError(error) as Extract<ProviderEvent, { type: "error" }>;
  return redactor ? { ...event, error: redactor.redact(event.error) } : event;
}

async function* readStream<T>(stream: ReadableStream<T>, signal?: AbortSignal): AsyncGenerator<T> {
  if (signal?.aborted) {
    throw new AiSdkProviderError("aborted", "AI SDK provider request aborted", { cause: signal.reason });
  }
  const reader = stream.getReader();
  const onAbort = () => {
    void reader.cancel(signal?.reason ?? new AiSdkProviderError("aborted", "AI SDK provider request aborted"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) {
        throw new AiSdkProviderError("aborted", "AI SDK provider request aborted", { cause: signal.reason });
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
