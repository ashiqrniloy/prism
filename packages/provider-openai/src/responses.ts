import type { AIProvider, AudioContent, ContentBlock, CredentialValueSource, DocumentContent, FileContent, JsonObject, MediaContentBlock, Message, ModelConfig, ProviderRequest, ProviderRequestOptions, ResolvedMediaContent, ToolDefinition, Usage } from "@arnilo/prism";
import { assertStructuredOutputRequestSupported, providerDone, providerError, providerTextDelta, providerThinkingDelta, providerToolCall, providerToolCallDelta, providerUsage, resolveCredentialValue, toolCallContent } from "@arnilo/prism";
import {
  bytesToBase64,
  defaultProviderFilename,
  openAIAudioFormat,
  resolveProviderMediaMessages,
  serializeOpenAIResponsesInputAudio,
  serializeOpenAIResponsesInputFile,
} from "@arnilo/prism/providers/media";
import { applyOpenAIResponsesStructuredOutput } from "@arnilo/prism/providers/openai";
import { parseJsonObjectArguments, readBoundedResponseText, readSseData } from "@arnilo/prism/providers/transport";
import { promptCacheKey, promptCacheRetention } from "./cache.js";
import { createOpenAIFileUploadManager, type OpenAIFileUploadManager } from "./uploads.js";

export interface OpenAIResponsesProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly uploadManager?: OpenAIFileUploadManager;
}

interface ToolAccumulator { id?: string; name?: string; argumentsText: string }

interface ResponsesMediaContext {
  readonly model: ModelConfig;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly uploadManager: OpenAIFileUploadManager;
  readonly resolvedMedia?: ReadonlyMap<MediaContentBlock, ResolvedMediaContent>;
}

export function createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions = {}): AIProvider {
  const id = options.id ?? "openai";
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      let token: string | undefined;
      const secrets: (string | undefined)[] = [];
      const tools = new Map<number, ToolAccumulator>();
      let usage: Usage | undefined;
      const uploadManager = options.uploadManager ?? createOpenAIFileUploadManager({
        providerId: id,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        fetch: options.fetch,
        scope: {
          sessionId: request.options?.sessionId,
          runId: typeof request.metadata?.runId === "string" ? request.metadata.runId : undefined,
          tenantId: typeof request.metadata?.tenantId === "string" ? request.metadata.tenantId : undefined,
        },
      });
      const mediaContext: ResponsesMediaContext = {
        model: request.model,
        fetch: options.fetch,
        signal: request.signal,
        uploadManager,
      };
      try {
        const body = await toResponsesRequest(request, mediaContext);
        token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
        secrets.push(token);
        const response = await (options.fetch ?? fetch)(`${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/responses`, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(request.options?.sessionId ? { "x-client-request-id": request.options.sessionId } : {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          return yield providerError(
            new Error(`OpenAI request failed: ${response.status} ${await readBoundedResponseText(response, { secrets })}`),
            secrets,
          );
        }
        if (!response.body) return yield providerError(new Error("OpenAI response had no body"), secrets);

        for await (const data of readSseData(response.body, { signal: request.signal })) {
          if (data === "[DONE]") break;
          const event = JSON.parse(data) as OpenAIResponseEvent;
          if (typeof event.delta === "string" && event.type?.includes("output_text")) yield providerTextDelta(event.delta);
          if (typeof event.delta === "string" && event.type?.includes("reasoning")) yield providerThinkingDelta(event.delta);

          // Official streaming: https://developers.openai.com/api/reference/resources/responses/streaming-events/
          // response.output_item.added carries the function_call item (call_id, name);
          // response.function_call_arguments.delta carries a raw string `delta`.
          if (event.type === "response.output_item.added" && isFunctionCallItem(event.item)) {
            const index = event.output_index ?? 0;
            const item = event.item;
            const current = tools.get(index) ?? { argumentsText: "" };
            current.id = item.call_id ?? item.id ?? current.id;
            current.name = item.name ?? current.name;
            if (typeof item.arguments === "string" && item.arguments.length > 0) current.argumentsText = item.arguments;
            tools.set(index, current);
            yield providerToolCallDelta({
              index,
              id: current.id,
              name: current.name,
              argumentsText: typeof item.arguments === "string" && item.arguments.length > 0 ? item.arguments : undefined,
            });
          } else if (event.type === "response.function_call_arguments.delta" && typeof event.delta === "string") {
            const index = event.output_index ?? 0;
            const current = tools.get(index) ?? { argumentsText: "" };
            current.argumentsText += event.delta;
            tools.set(index, current);
            yield providerToolCallDelta({ index, id: current.id, name: current.name, argumentsText: event.delta });
          } else if (event.type === "response.function_call_arguments.done" && typeof event.arguments === "string") {
            const index = event.output_index ?? 0;
            const current = tools.get(index) ?? { argumentsText: "" };
            current.argumentsText = event.arguments;
            tools.set(index, current);
          } else if (isLegacyToolDelta(event.item ?? event.delta)) {
            // Compat for older object-shaped fixtures; official wire uses the branches above.
            const tool = (event.item ?? event.delta) as {
              index?: number;
              id?: string;
              call_id?: string;
              name?: string;
              arguments?: string;
              arguments_delta?: string;
            };
            const index = tool.index ?? event.output_index ?? 0;
            const current = tools.get(index) ?? { argumentsText: "" };
            current.id = tool.call_id ?? tool.id ?? current.id;
            current.name = tool.name ?? current.name;
            current.argumentsText += tool.arguments ?? tool.arguments_delta ?? "";
            tools.set(index, current);
            yield providerToolCallDelta({
              index,
              id: current.id,
              name: current.name,
              argumentsText: tool.arguments ?? tool.arguments_delta,
            });
          }

          usage = toUsage(event.response?.usage ?? event.usage) ?? usage;
          if (event.type?.endsWith("completed") && usage) yield providerUsage(usage);
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
      } catch (error) {
        yield providerError(error, secrets);
      } finally {
        await mediaContext.uploadManager.cleanup(request.signal);
      }
    },
  };
}

async function toResponsesRequest(request: ProviderRequest, mediaContext: ResponsesMediaContext): Promise<JsonObject> {
  assertStructuredOutputRequestSupported(request.model, request.options);
  const { maxTokens, ...parameters } = request.model.parameters ?? {};
  const resolvedMedia = await resolveProviderMediaMessages(request.messages, request.model, {
    fetch: mediaContext.fetch,
    signal: mediaContext.signal,
  });
  const resolvedContext = { ...mediaContext, resolvedMedia };
  const optionsCompat = { ...(request.options?.compat ?? {}) } as Record<string, unknown>;
  const reasoning = resolveOpenAIReasoning(request.model, request.options);
  delete optionsCompat.reasoning;
  const payload: Record<string, unknown> = {
    model: request.model.model,
    input: await toResponsesInput(request.messages, resolvedContext),
    tools: request.tools?.map(toTool),
    stream: true,
    store: false,
    prompt_cache_key: promptCacheKey(request.options),
    prompt_cache_retention: promptCacheRetention(request.options, request.model),
    ...parameters,
    max_output_tokens: maxTokens,
    ...optionsCompat,
    ...(reasoning ? { reasoning } : {}),
    ...(request.options?.extra ?? {}),
  };
  applyOpenAIResponsesStructuredOutput(payload, request.options?.structuredOutput);
  return clean(payload);
}

/**
 * Flatten Prism messages into Responses `input` items.
 * Official docs: assistant text uses `output_text`; `function_call` / `function_call_output`
 * are top-level items with `call_id` (not nested message content with `id`).
 * @see https://developers.openai.com/api/docs/guides/function-calling
 */
async function toResponsesInput(
  messages: readonly Message[],
  mediaContext: ResponsesMediaContext,
): Promise<JsonObject[]> {
  const items: JsonObject[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
      items.push(clean({
        type: "function_call_output",
        call_id: result?.toolCallId ?? "",
        output: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
      }));
      continue;
    }

    if (message.role === "assistant") {
      const contentParts: JsonObject[] = [];
      const functionCalls: JsonObject[] = [];
      for (const part of message.content) {
        if (part.type === "text") {
          contentParts.push({ type: "output_text", text: part.text });
        } else if (part.type === "thinking") {
          // Bare thinking text cannot round-trip without an encrypted Responses reasoning item.
          continue;
        } else if (part.type === "tool_call") {
          functionCalls.push(clean({
            type: "function_call",
            call_id: part.id,
            name: part.name,
            arguments: JSON.stringify(part.arguments),
          }));
        } else if (part.type === "tool_result") {
          throw new Error("OpenAI Responses tool_result blocks must appear in role=tool messages");
        } else if (part.type === "image" || part.type === "audio" || part.type === "file" || part.type === "document") {
          throw new Error(`OpenAI Responses does not serialize assistant ${part.type} blocks as input`);
        }
      }
      if (contentParts.length > 0) items.push(clean({ role: "assistant", content: contentParts }));
      items.push(...functionCalls);
      continue;
    }

    const contentParts: JsonObject[] = [];
    for (const part of message.content) {
      if (part.type === "text" || part.type === "thinking") {
        contentParts.push({ type: "input_text", text: part.text });
      } else if (part.type === "image") {
        contentParts.push(toResponsesImage(mediaContext.resolvedMedia!.get(part)!));
      } else if (part.type === "audio") {
        contentParts.push(await toResponsesAudio(part, mediaContext));
      } else if (part.type === "file" || part.type === "document") {
        contentParts.push(await toResponsesFile(part, mediaContext));
      } else if (part.type === "tool_call") {
        items.push(clean({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.arguments),
        }));
      } else if (part.type === "tool_result") {
        throw new Error("OpenAI Responses tool_result blocks must appear in role=tool messages");
      }
    }
    if (contentParts.length > 0) items.push(clean({ role: message.role, content: contentParts }));
  }
  return items;
}

/** Merge model-default + per-turn `compat.reasoning` into official Responses `reasoning` object. */
export function resolveOpenAIReasoning(model: ModelConfig, options: ProviderRequestOptions | undefined): JsonObject | undefined {
  const fromModel = asReasoningObject(model.compat?.reasoning);
  const fromOptions = asReasoningObject(options?.compat?.reasoning);
  if (!fromModel && !fromOptions) return undefined;
  return clean({ ...fromModel, ...fromOptions });
}

function asReasoningObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function toResponsesImage(resolved: ResolvedMediaContent): JsonObject {
  return { type: "input_image", image_url: `data:${resolved.mediaType};base64,${bytesToBase64(resolved.bytes)}` };
}

async function toResponsesAudio(
  part: AudioContent,
  mediaContext: ResponsesMediaContext,
): Promise<JsonObject> {
  const resolved = mediaContext.resolvedMedia!.get(part)!;
  return serializeOpenAIResponsesInputAudio({
    data: bytesToBase64(resolved.bytes),
    format: openAIAudioFormat(resolved.mediaType),
  });
}

async function toResponsesFile(
  part: FileContent | DocumentContent,
  mediaContext: ResponsesMediaContext,
): Promise<JsonObject> {
  const resolved = mediaContext.resolvedMedia!.get(part)!;
  const filename = defaultProviderFilename(part, part.type === "document" ? "document.pdf" : "file.bin");
  const wire = await mediaContext.uploadManager.resolveFileWire(
    resolved.mediaType,
    resolved.bytes,
    filename,
    mediaContext.signal,
  );
  return serializeOpenAIResponsesInputFile(wire);
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object" } });
}

function toUsage(usage: OpenAIUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.input_tokens_details?.cached_tokens,
  };
}

function isFunctionCallItem(value: unknown): value is {
  readonly type?: string;
  readonly id?: string;
  readonly call_id?: string;
  readonly name?: string;
  readonly arguments?: string;
} {
  return !!value && typeof value === "object" && (value as { type?: string }).type === "function_call";
}

function isLegacyToolDelta(value: unknown): value is {
  index?: number;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  arguments_delta?: string;
} {
  return !!value
    && typeof value === "object"
    && ("arguments" in value || "arguments_delta" in value)
    && ("name" in value || "id" in value || "call_id" in value);
}

function clean(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

interface OpenAIResponseEvent {
  readonly type?: string;
  readonly delta?: unknown;
  readonly arguments?: unknown;
  readonly item?: unknown;
  readonly output_index?: number;
  readonly response?: { readonly usage?: OpenAIUsage };
  readonly usage?: OpenAIUsage;
}

interface OpenAIUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens_details?: { readonly cached_tokens?: number };
}
