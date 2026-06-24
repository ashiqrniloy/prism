import type { AIProvider, ContentBlock, CredentialValueSource, JsonObject, Message, ModelCapabilities, ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "@arnilo/prism";
import { providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, resolveCredentialValue, toolCallContent } from "@arnilo/prism";
import { readSseData } from "./sse.js";

export interface KimiCodingProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly userAgent?: string;
}

interface PartialBlock { id?: string; name?: string; argumentsText: string }

export function createKimiCodingProvider(options: KimiCodingProviderOptions = {}): AIProvider {
  const id = options.id ?? "kimi-coding";
  const baseUrl = (options.baseUrl ?? "https://api.kimi.com/coding").replace(/\/$/, "");
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const secrets = [token];
      try {
        const response = await (options.fetch ?? fetch)(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": options.userAgent ?? "KimiCLI/1.5",
            ...request.options?.headers,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(kimiAnthropicBody(request)),
          signal: request.signal,
        });
        if (!response.ok) return yield providerError(new Error(`Kimi request failed: ${response.status} ${await safeText(response)}`), secrets);
        if (!response.body) return yield providerError(new Error("Kimi response had no body"), secrets);
        yield* kimiAnthropicEvents(response.body);
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

export function kimiAnthropicBody(request: ProviderRequest): JsonObject {
  const preserveThinking = request.model.compat?.preserveThinking === true;
  return clean({
    model: request.model.model,
    messages: request.messages.filter((m) => m.role !== "system").map((message) => toMessage(message, request.model.capabilities ?? {}, preserveThinking)),
    system: request.messages.filter((m) => m.role === "system").map((m) => text(m, preserveThinking)).join("\n\n") || undefined,
    tools: request.tools?.map(toTool),
    stream: true,
    max_tokens: request.model.limits?.maxOutputTokens ?? 4096,
    ...request.model.parameters,
    ...request.options?.compat,
    ...request.options?.extra,
  });
}

export async function* kimiAnthropicEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderEvent> {
  const blocks = new Map<number, PartialBlock>();
  let usage: Usage | undefined;
  for await (const data of readSseData(body)) {
    if (data === "[DONE]") break;
    const event = JSON.parse(data) as KimiEvent;
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") blocks.set(event.index ?? 0, { id: event.content_block.id, name: event.content_block.name, argumentsText: "" });
    if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "text_delta" && delta.text) yield providerTextDelta(delta.text);
      if ((delta?.type === "thinking_delta" || delta?.type === "reasoning_delta") && (delta.thinking ?? delta.reasoning)) yield providerThinkingDelta(delta.thinking ?? delta.reasoning ?? "");
      if (delta?.type === "input_json_delta") {
        const index = event.index ?? 0;
        const current = blocks.get(index) ?? { argumentsText: "" };
        current.argumentsText += delta.partial_json ?? "";
        blocks.set(index, current);
        yield providerToolCallDelta({ index, id: current.id, name: current.name, argumentsText: delta.partial_json });
      }
    }
    usage = toUsage(event.message?.usage ?? event.usage) ?? usage;
    if (event.type === "message_delta" && usage) yield providerUsage(usage);
  }
  for (const call of blocks.values()) if (call.id && call.name) yield providerToolCall(toolCallContent(call.id, call.name, parseArgs(call.argumentsText)));
  yield providerDone(usage);
}

function toMessage(message: Message, capabilities: ModelCapabilities = {}, preserveThinking = false): JsonObject {
  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: result?.toolCallId ?? "",
        content: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
      }],
    };
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "thinking") {
      if (preserveThinking) {
        content.push(part.signature ? { type: "thinking", thinking: part.text, signature: part.signature } : { type: "thinking", thinking: part.text });
      } else {
        content.push({ type: "text", text: part.text });
      }
    } else if (part.type === "image") {
      if (!capabilities.input?.includes("image")) {
        throw new Error(`Kimi request includes image but model does not declare image input capability`);
      }
      const source: JsonObject = part.url
        ? { type: "url", url: part.url }
        : { type: "base64", media_type: part.mimeType ?? "image/png", data: part.data ?? "" };
      content.push({ type: "image", source });
    } else if (part.type === "tool_call") {
      content.push({ type: "tool_use", id: part.id, name: part.name, input: part.arguments });
    } else if (part.type === "tool_result") {
      throw new Error("Kimi tool_result blocks must appear in role=tool messages");
    }
  }

  return { role: message.role === "assistant" ? "assistant" : "user", content: content.length > 0 ? content : [{ type: "text", text: "" }] };
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ name: tool.name, description: tool.description, input_schema: tool.parameters ?? { type: "object" } });
}

function text(message: Message, preserveThinking = false): string {
  return message.content.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "thinking") return preserveThinking ? part.text : part.text;
    return "";
  }).join("");
}

function toUsage(usage: KimiUsage | undefined): Usage | undefined {
  return usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens, cacheWriteTokens: usage.cache_creation_input_tokens } : undefined;
}

function parseArgs(text: string): JsonObject {
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0))) as JsonObject;
}

async function safeText(response: Response): Promise<string> {
  try { return await response.text(); } catch { return ""; }
}

interface KimiEvent {
  readonly type?: string;
  readonly index?: number;
  readonly content_block?: { readonly type?: string; readonly id?: string; readonly name?: string };
  readonly delta?: { readonly type?: string; readonly text?: string; readonly thinking?: string; readonly reasoning?: string; readonly partial_json?: string };
  readonly message?: { readonly usage?: KimiUsage };
  readonly usage?: KimiUsage;
}
interface KimiUsage { readonly input_tokens?: number; readonly output_tokens?: number; readonly cache_read_input_tokens?: number; readonly cache_creation_input_tokens?: number }
