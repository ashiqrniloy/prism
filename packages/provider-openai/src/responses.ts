import type {
  AIProvider,
  AudioContent,
  ContentBlock,
  CredentialValueSource,
  DocumentContent,
  FileContent,
  JsonObject,
  MediaContentBlock,
  ModelConfig,
  ProviderRequest,
  ProviderRequestOptions,
  ResolvedMediaContent,
  ToolDefinition,
  Usage,
} from "@arnilo/prism";
import {
  assertStructuredOutputRequestSupported,
  canonicalizeJsonSchema,
  providerContinuationRequired,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  resolveCredentialValue,
  toolCallFromArgumentsText,
  trimTrailingSlashes,
} from "@arnilo/prism";
import {
  bytesToBase64,
  defaultProviderFilename,
  openAIAudioFormat,
  resolveProviderMediaMessages,
  serializeOpenAIResponsesInputAudio,
  serializeOpenAIResponsesInputFile,
} from "@arnilo/prism/providers/media";
import { applyOpenAIResponsesStructuredOutput } from "@arnilo/prism/providers/openai";
import { httpStatusError, readBoundedResponseText, readSseData } from "@arnilo/prism/providers/transport";
import {
  applyPromptCacheBreakpoints,
  type OpenAIBreakpointMessage,
  promptCacheKey,
  promptCacheOptions,
  promptCacheRetention,
} from "./cache.js";
import { createOpenAIFileUploadManager, type OpenAIFileUploadManager } from "./uploads.js";

export interface OpenAIResponsesProviderOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly uploadManager?: OpenAIFileUploadManager;
}

interface ToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
}

const MAX_CONTINUATION_HOPS = 8;
const MAX_CONTINUATION_CURSOR_BYTES = 4 * 1024;

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
      let usage: Usage | undefined;
      const uploadManager =
        options.uploadManager ??
        createOpenAIFileUploadManager({
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
      // ponytail: continuation auto-resumes internally up to 8 hops; the host sees a
      // `continuation_required` event for telemetry/AG-UI but never drives resume. Explicit
      // `options.continuation.cursor` seeds the first hop (e.g. resume an incomplete response).
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      let completed = false;
      try {
        cursor = continuationCursor(request.options?.continuation?.cursor);
        if (cursor) seenCursors.add(cursor);
        for (let hop = 0; hop < MAX_CONTINUATION_HOPS; hop += 1) {
          if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
          const tools = new Map<number, ToolAccumulator>();
          const body = await toResponsesRequest(request, mediaContext, cursor);
          if (!token) {
            token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
            secrets.push(token);
          }
          const response = await (options.fetch ?? fetch)(
            `${trimTrailingSlashes(options.baseUrl ?? "https://api.openai.com/v1")}/responses`,
            {
              method: "POST",
              headers: {
                ...request.options?.headers,
                "content-type": "application/json",
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...(request.options?.sessionId ? { "x-client-request-id": request.options.sessionId } : {}),
              },
              body: JSON.stringify(body),
              signal: request.signal,
            },
          );
          if (!response.ok) {
            return yield providerError(
              httpStatusError("OpenAI request failed", response, await readBoundedResponseText(response, { secrets })),
              secrets,
            );
          }
          if (!response.body) return yield providerError(new Error("OpenAI response had no body"), secrets);

          let responseId: string | undefined;
          let incomplete = false;
          for await (const data of readSseData(response.body, { signal: request.signal })) {
            if (data === "[DONE]") break;
            const event = JSON.parse(data) as OpenAIResponseEvent;
            if (event.response?.id) responseId = event.response.id;
            if (event.response?.status === "incomplete") incomplete = true;
            if (typeof event.delta === "string" && event.type?.includes("output_text")) yield providerTextDelta(event.delta);
            if (typeof event.delta === "string" && event.type?.includes("reasoning")) yield providerThinkingDelta(event.delta);

            // Official streaming: https://developers.openai.com/api/reference/resources/responses/streaming-events/
            // response.output_item.added carries the function_call item (call_id, name);
            // response.function_call_arguments.delta carries a raw string delta.
            if (event.type === "response.output_item.added" && isHostedCallItem(event.item)) {
              // Provider-hosted tools (web_search_call, file_search_call, code_interpreter_call,
              // computer_call, mcp_call) are executed server-side; the assistant text that
              // follows already incorporates their effect. Recorded as provider-hosted
              // tool_calls so the transcript/telemetry shows the invocation, but the host never
              // dispatches them or sends a tool_result (see agent-loops.dispatchableToolCalls).
              const hosted = event.item as { id?: string; type?: string };
              const hostedId = hosted.id ?? `hosted:${event.output_index ?? 0}`;
              yield providerToolCall({
                type: "tool_call",
                id: hostedId,
                name: hosted.type ?? "hosted",
                arguments: {},
                authority: "provider-hosted",
              });
            } else if (event.type === "response.output_item.added" && isFunctionCallItem(event.item)) {
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
              yield providerToolCall(toolCallFromArgumentsText(call.id, call.name, call.argumentsText));
            }
          }
          if (incomplete) {
            if (!responseId) {
              yield providerError(new Error("OpenAI incomplete response had no continuation cursor"), secrets);
              completed = true;
              break;
            }
            const nextCursor = continuationCursor(responseId)!;
            if (seenCursors.has(nextCursor)) {
              yield providerError(new Error("OpenAI returned a duplicate continuation cursor"), secrets);
              completed = true;
              break;
            }
            seenCursors.add(nextCursor);
            // Long response truncated by max_output_tokens: emit the opaque cursor and
            // self-continue with previous_response_id. The bounded loop fails closed below.
            yield providerContinuationRequired(nextCursor, "incomplete");
            cursor = nextCursor;
            continue;
          }
          yield providerDone(usage);
          completed = true;
          break;
        }
        if (!completed) yield providerError(new Error("OpenAI continuation hop cap exceeded"), secrets);
      } catch (error) {
        yield providerError(error, secrets);
      } finally {
        await mediaContext.uploadManager.cleanup(request.signal);
      }
    },
  };
}

function continuationCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!cursor || Buffer.byteLength(cursor) > MAX_CONTINUATION_CURSOR_BYTES) {
    throw new Error("OpenAI continuation cursor must be a non-empty string at most 4 KiB");
  }
  return cursor;
}

async function toResponsesRequest(request: ProviderRequest, mediaContext: ResponsesMediaContext, cursor?: string): Promise<JsonObject> {
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
  const messages = applyPromptCacheBreakpoints(request);
  const payload: Record<string, unknown> = {
    model: request.model.model,
    // `previous_response_id` carries prior context. Replaying history here would
    // duplicate prompt tokens and undermine cursor resumption.
    input: cursor ? [] : await toResponsesInput(messages, resolvedContext),
    tools: request.tools?.map(toTool),
    stream: true,
    store: false,
    ...parameters,
    max_output_tokens: maxTokens,
    ...optionsCompat,
    ...(reasoning ? { reasoning } : {}),
    ...(request.options?.extra ?? {}),
    // Resolved official cache fields win over raw extra/compat escape hatches.
    prompt_cache_key: promptCacheKey(request.options),
    prompt_cache_retention: promptCacheRetention(request.options, request.model),
    prompt_cache_options: promptCacheOptions(request.options, request.model),
    ...(cursor ? { previous_response_id: cursor } : {}),
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
async function toResponsesInput(messages: readonly OpenAIBreakpointMessage[], mediaContext: ResponsesMediaContext): Promise<JsonObject[]> {
  const items: JsonObject[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
      items.push(
        clean({
          type: "function_call_output",
          call_id: result?.toolCallId ?? "",
          output: result ? JSON.stringify(result.result ?? result.error ?? null) : "",
        }),
      );
      continue;
    }

    if (message.role === "assistant") {
      const contentParts: JsonObject[] = [];
      const functionCalls: JsonObject[] = [];
      for (const part of message.content) {
        if (part.type === "text") {
          const block = part as typeof part & { prompt_cache_breakpoint?: { mode: "explicit" } };
          contentParts.push(clean({ type: "output_text", text: part.text, prompt_cache_breakpoint: block.prompt_cache_breakpoint }));
        } else if (part.type === "thinking") {
        } else if (part.type === "tool_call") {
          // Provider-hosted calls (web_search_call, etc.) were executed server-side; resending
          // them as function_call would ask OpenAI to re-run them. Skip when serializing.
          if (part.authority === "provider-hosted") continue;
          functionCalls.push(
            clean({
              type: "function_call",
              call_id: part.id,
              name: part.name,
              arguments: JSON.stringify(part.arguments),
            }),
          );
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
        const block = part as typeof part & { prompt_cache_breakpoint?: { mode: "explicit" } };
        contentParts.push(clean({ type: "input_text", text: part.text, prompt_cache_breakpoint: block.prompt_cache_breakpoint }));
      } else if (part.type === "image") {
        contentParts.push(toResponsesImage(mediaContext.resolvedMedia!.get(part)!));
      } else if (part.type === "audio") {
        contentParts.push(await toResponsesAudio(part, mediaContext));
      } else if (part.type === "file" || part.type === "document") {
        contentParts.push(await toResponsesFile(part, mediaContext));
      } else if (part.type === "tool_call") {
        if (part.authority === "provider-hosted") continue;
        items.push(
          clean({
            type: "function_call",
            call_id: part.id,
            name: part.name,
            arguments: JSON.stringify(part.arguments),
          }),
        );
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

async function toResponsesAudio(part: AudioContent, mediaContext: ResponsesMediaContext): Promise<JsonObject> {
  const resolved = mediaContext.resolvedMedia!.get(part)!;
  return serializeOpenAIResponsesInputAudio({
    data: bytesToBase64(resolved.bytes),
    format: openAIAudioFormat(resolved.mediaType),
  });
}

async function toResponsesFile(part: FileContent | DocumentContent, mediaContext: ResponsesMediaContext): Promise<JsonObject> {
  const resolved = mediaContext.resolvedMedia!.get(part)!;
  const filename = defaultProviderFilename(part, part.type === "document" ? "document.pdf" : "file.bin");
  const wire = await mediaContext.uploadManager.resolveFileWire(resolved.mediaType, resolved.bytes, filename, mediaContext.signal);
  return serializeOpenAIResponsesInputFile(wire);
}

function toTool(tool: ToolDefinition): JsonObject {
  return clean({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: canonicalizeJsonSchema(tool.parameters ?? { type: "object" }) as JsonObject,
  });
}

function toUsage(usage: OpenAIUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.input_tokens_details?.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens,
  };
}

function isHostedCallItem(value: unknown): value is { readonly id?: string; readonly type?: string } {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: string }).type;
  // Provider-hosted tool items end with _call but are not the host-dispatched function_call.
  return typeof type === "string" && type.endsWith("_call") && type !== "function_call";
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
  return (
    !!value &&
    typeof value === "object" &&
    ("arguments" in value || "arguments_delta" in value) &&
    ("name" in value || "id" in value || "call_id" in value)
  );
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
  readonly response?: { readonly id?: string; readonly status?: string; readonly usage?: OpenAIUsage };
  readonly usage?: OpenAIUsage;
}

interface OpenAIUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens_details?: { readonly cached_tokens?: number; readonly cache_write_tokens?: number };
}
