import type { AIProvider, CredentialValueSource, JsonObject, ProviderEvent, ProviderRequest, Usage } from "@arnilo/prism";
import {
  assertStructuredOutputRequestSupported,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  resolveCredentialValue,
  toolCallFromArgumentsText,
} from "@arnilo/prism";
import {
  applyOpenAIChatStructuredOutput,
  mapOpenAIChatUsage,
  serializeOpenAIChatMessage,
  serializeOpenAITool,
} from "@arnilo/prism/providers/openai";
import { readBoundedResponseText, readSseData } from "@arnilo/prism/providers/transport";
import { type OllamaBasePreset, ollamaBaseUrl } from "./models.js";

export interface OllamaProviderOptions {
  readonly id?: string;
  /** Explicit OpenAI-compatible base URL (wins over `preset`). */
  readonly baseUrl?: string;
  /** Named deployment preset; defaults to `cloud`. */
  readonly preset?: OllamaBasePreset;
  /** Ollama Cloud API key; omit for unauthenticated local `ollama serve`. */
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

interface ToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
}

/**
 * Ollama Chat Completions provider (`POST {base}/chat/completions`, OpenAI-compatible).
 * Works against Ollama Cloud (`https://ollama.com`, Bearer API key) and local
 * `ollama serve` (`http://localhost:11434`, typically unauthenticated).
 *
 * Caching: Ollama reuses its KV/prompt cache automatically; there is no request knob and
 * no cached-token count in usage, so `Usage.cacheReadTokens` is intentionally left
 * undefined (documented ceiling — see docs/providers/ollama.md).
 * @see https://docs.ollama.com/api/openai-compatibility
 */
export function createOllamaProvider(options: OllamaProviderOptions = {}): AIProvider {
  const id = options.id ?? "ollama";
  const baseUrl = ollamaBaseUrl(options);
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      try {
        const body = ollamaBody(request);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`Ollama request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("Ollama response had no body"), secrets);
        yield* ollamaEvents(response.body, request.signal);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function ollamaBody(request: ProviderRequest): JsonObject {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const body: Record<string, unknown> = {
    model: request.model.model,
    messages: request.messages.map((message) => serializeOpenAIChatMessage(message, request.model.capabilities ?? {})),
    tools: request.tools?.map(serializeOpenAITool),
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: ollamaReasoningEffort(request),
    ...parameters,
    max_tokens: maxTokens ?? request.model.limits?.maxOutputTokens,
    ...stripOllamaCompat(request.options?.compat as JsonObject | undefined),
    ...request.options?.extra,
  };
  applyOpenAIChatStructuredOutput(body, request.options?.structuredOutput);
  return clean(body);
}

export async function* ollamaEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
  const tools = new Map<number, ToolAccumulator>();
  let usage: Usage | undefined;
  let sawDoneMarker = false;
  let sawFinishReason = false;
  for await (const data of readSseData(body, { signal })) {
    if (data === "[DONE]") {
      sawDoneMarker = true;
      break;
    }
    const chunk = JSON.parse(data) as OllamaChunk;
    if (chunk.usage) {
      const mapped = mapOpenAIChatUsage(chunk.usage);
      if (mapped) {
        usage = mapped;
        yield providerUsage(mapped);
      }
    }
    for (const choice of chunk.choices ?? []) {
      if (choice.finish_reason) sawFinishReason = true;
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
        yield providerToolCallDelta({
          index,
          id: tool.id,
          name: tool.function?.name,
          argumentsText: tool.function?.arguments,
        });
      }
    }
  }
  const danglingToolCall = [...tools.values()].some((call) => !call.id || !call.name);
  if (!sawDoneMarker || !sawFinishReason || danglingToolCall) {
    // Truncated streams must fail loudly — emitting done would mark partial output as succeeded.
    yield providerError(
      new Error(
        `Ollama chat stream ended without completion evidence ` +
          `([DONE]: ${sawDoneMarker ? "received" : "missing"}, ` +
          `finish_reason: ${sawFinishReason ? "received" : "missing"}, ` +
          `tool calls complete: ${danglingToolCall ? "no" : "yes"})`,
      ),
    );
    return;
  }
  for (const call of tools.values()) {
    yield providerToolCall(toolCallFromArgumentsText(call.id!, call.name!, call.argumentsText));
  }
  yield providerDone(usage);
}

/**
 * Ollama `reasoning_effort` top-level toggle (e.g. gpt-oss). Request
 * `options.compat.reasoning_effort` wins over the model default; omitted on the wire
 * unless explicitly a string.
 */
export function ollamaReasoningEffort(request: ProviderRequest): string | undefined {
  const value = request.options?.compat?.reasoning_effort ?? request.model.compat?.reasoning_effort;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Strip provider-owned compat keys so the opaque spread cannot leak routing directives. */
function stripOllamaCompat(compat: JsonObject | undefined): JsonObject {
  if (!compat) return {};
  const { reasoning_effort: _effort, route: _route, ollama: _meta, ...rest } = compat as Record<string, unknown>;
  return rest as JsonObject;
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;
}

interface OllamaChunk {
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly {
        readonly index?: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
  }[];
  readonly usage?: unknown;
}
