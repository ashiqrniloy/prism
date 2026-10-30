import type { ContentBlock, JsonObject, JsonValue, Message, ModelConfig, ProviderEvent, ProviderRequest, Usage } from "../../contracts.js";
import {
  mapProviderStopReason,
  providerContentDelta,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallFromArgumentsText,
} from "../../models/events.js";
import { assertStructuredOutputRequestSupported } from "../structured-output.js";
import { resolveReasoningEffort, stripOwnedCompat } from "../thinking.js";
import { createToolNameMap, productToolName, type ToolNameMap, wireToolName } from "../tool-names.js";
import { isContextOverflowMessage, readSseEvents } from "../transport.js";
import { normalizeUsage } from "../usage.js";

/**
 * Request fields a Sign in with ChatGPT Responses route refuses with `400 unsupported_parameter`
 * (measured live, plan 204 Task 1 (e)). `max_output_tokens` is deliberately absent: the route
 * accepts it from 16 up.
 */
export const OPENAI_RESPONSES_UNSUPPORTED_FIELDS = [
  "background",
  "conversation",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;

/** Smallest `max_output_tokens` the Responses route accepts (8 is refused locally, never on the wire). */
export const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;

/** Default cap for `prompt_cache_key`; longer keys are truncated to this many characters. */
export const DEFAULT_RESPONSES_PROMPT_CACHE_KEY_MAX = 64;

/** A body that sets a token ceiling below the route minimum fails here, not at the provider. */
export class ResponsesMaxOutputTokensError extends Error {
  readonly code = "max_output_tokens_below_minimum";

  constructor(requested: number) {
    super(`max_output_tokens ${requested} is below the Responses route minimum of ${OPENAI_RESPONSES_MIN_OUTPUT_TOKENS}`);
    this.name = "ResponsesMaxOutputTokensError";
  }
}

/** Codec options shaping Responses body serialization. */
export interface OpenAIResponsesCodecOptions {
  /** `store` on the wire. `false` also forces `include: ["reasoning.encrypted_content"]`. Default `false`. */
  readonly store?: boolean;
  /** `stream` on the wire. Default `true`. */
  readonly stream?: boolean;
  /** Extra `include` values. The encrypted-reasoning include is added when `store` is false. */
  readonly include?: readonly string[];
  /** Body keys deleted after construction, so model `parameters` and `extra` cannot re-add a refused field. */
  readonly omitFields?: readonly string[];
  /** Cap for `prompt_cache_key`; defaults to 64 characters. */
  readonly promptCacheKeyMax?: number;
  /** `reasoning.summary` value. Absent means the model's compat decides. */
  readonly reasoningSummary?: string;
  /** Image input gate. Defaults to `"capability-gated"`. */
  readonly imageInput?: "capability-gated" | "always";
  /** Require `response.completed`/`response.incomplete` before `done`. Default `true`. */
  readonly strictCompletion?: boolean;
  /** Strip provider-owned compat options before the body merge. Defaults to `stripOwnedCompat()`. */
  readonly stripOwnedCompat?: (compat: JsonObject | undefined) => JsonObject | undefined;
  /** Final body transform applied before `omitFields`. */
  readonly transformBody?: (body: JsonObject, request: ProviderRequest) => JsonObject;
  /** Per-request product ↔ wire tool-name map. */
  readonly toolNames?: ToolNameMap;
}

export interface OpenAIResponsesEventsOptions {
  readonly signal?: AbortSignal;
  /** Provider id stamped into replayed reasoning, so a foreign provider's blob is never sent back. */
  readonly provider?: string;
  /** Require a completed/incomplete terminal event; a truncated stream is then an error. Default `true`. */
  readonly strictCompletion?: boolean;
  readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
  readonly secrets?: readonly (string | undefined)[];
  /** Must be the same map that serialized the request. */
  readonly toolNames?: ToolNameMap;
}

/** What a reasoning `ThinkingContent.data` carries: the wire item plus who produced it. */
interface ResponsesReasoningData {
  readonly provider?: string;
  readonly item?: JsonObject;
}

/**
 * Builds an OpenAI Responses wire body. The route is stateless and never continues a stored
 * response, so `previous_response_id` is removed even when a caller sets it.
 */
export function openAIResponsesBody(request: ProviderRequest, options: OpenAIResponsesCodecOptions = {}): JsonObject {
  const toolNames = options.toolNames ?? createToolNameMap(request.tools);
  assertStructuredOutputRequestSupported(request.model, request.options);

  const store = options.store ?? false;
  const stream = options.stream ?? true;
  const imageInput = options.imageInput ?? "capability-gated";

  const { instructions, developer, conversation } = splitSystemMessages(request.messages);
  const input: JsonObject[] = [];
  for (const message of developer) {
    input.push({ role: "developer", content: [{ type: "input_text", text: message }] });
  }
  for (const message of conversation) {
    input.push(...toInputItems(message, request.model, imageInput, toolNames));
  }

  const parameters = { ...(request.model.parameters ?? {}) };
  if (parameters.maxTokens !== undefined) {
    if (parameters.max_output_tokens === undefined) parameters.max_output_tokens = parameters.maxTokens;
    delete parameters.maxTokens;
  }
  if (parameters.max_tokens !== undefined) {
    if (parameters.max_output_tokens === undefined) parameters.max_output_tokens = parameters.max_tokens;
    delete parameters.max_tokens;
  }
  const requestedOutput = parameters.max_output_tokens ?? parameters.maxTokens;
  if (typeof requestedOutput === "number" && requestedOutput < OPENAI_RESPONSES_MIN_OUTPUT_TOKENS) {
    throw new ResponsesMaxOutputTokensError(requestedOutput);
  }

  const body: Record<string, unknown> = {
    model: request.model.model,
    input,
    stream,
    ...(store !== undefined ? { store } : {}),
    ...parameters,
    ...(options.stripOwnedCompat ?? stripOwnedCompat())(request.options?.compat),
    ...(request.options?.extra ?? {}),
  };

  if (instructions) body.instructions = instructions;

  const tools = request.tools?.map((tool) => serializeResponsesTool(tool, toolNames));
  if (tools && tools.length > 0) body.tools = tools;

  const include = store === false ? unique([...(options.include ?? []), "reasoning.encrypted_content"]) : options.include;
  if (include && include.length > 0) body.include = [...include];

  const cacheKey = request.options?.cacheKey ?? request.options?.sessionId;
  if (cacheKey) body.prompt_cache_key = cacheKey.slice(0, options.promptCacheKeyMax ?? DEFAULT_RESPONSES_PROMPT_CACHE_KEY_MAX);

  const reasoning = resolveResponsesReasoning(request, options);
  if (reasoning) body.reasoning = reasoning;

  const format = resolveResponsesStructuredOutput(request);
  if (format) {
    const existingText = body.text && typeof body.text === "object" && !Array.isArray(body.text) ? (body.text as JsonObject) : {};
    body.text = { ...existingText, format };
  }

  // A stateless route resumes nothing: a stored response id or a server-side conversation would be
  // the only way to continue one, and both are refused for this route.
  delete body.previous_response_id;

  const cleaned = cleanObject(body);
  const transformed = options.transformBody ? options.transformBody(cleaned, request) : cleaned;
  const omitted = new Set(options.omitFields ?? []);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(transformed)) {
    if (!omitted.has(key) && value !== undefined) result[key] = value;
  }
  return result as JsonObject;
}

/** Body builder alias, matching the Chat codec's naming. */
export const buildOpenAIResponsesBody = openAIResponsesBody;

/**
 * Function tools are flat on the Responses wire (`name`/`parameters` at the top level), not wrapped
 * in a `function` object the way Chat Completions requires.
 */
export function serializeResponsesTool(
  tool: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: JsonObject;
  },
  names?: ToolNameMap,
): JsonObject {
  return cleanObject({
    type: "function",
    name: wireToolName(tool.name, names),
    description: tool.description,
    parameters: tool.parameters ?? { type: "object" },
  });
}

function resolveResponsesReasoning(request: ProviderRequest, options: OpenAIResponsesCodecOptions): JsonObject | undefined {
  const compatReasoning =
    request.options?.compat?.reasoning &&
    typeof request.options.compat.reasoning === "object" &&
    !Array.isArray(request.options.compat.reasoning)
      ? (request.options.compat.reasoning as JsonObject)
      : undefined;
  const summary =
    options.reasoningSummary ??
    (typeof compatReasoning?.summary === "string" ? compatReasoning.summary : undefined) ??
    (typeof request.model.compat?.reasoning === "object" && request.model.compat?.reasoning !== null
      ? ((request.model.compat.reasoning as JsonObject).summary as string | undefined)
      : undefined);
  const effort = resolveReasoningEffort(request);
  if (!effort && !summary) return undefined;
  return cleanObject({ effort: effort ?? undefined, summary: summary ?? undefined });
}

function resolveResponsesStructuredOutput(request: ProviderRequest): JsonObject | undefined {
  const structured = request.options?.structuredOutput;
  if (!structured) return undefined;
  // Measured shape: the schema sits directly on `format`, with no `json_schema` wrapper.
  return cleanObject({
    type: "json_schema",
    name: structured.name,
    strict: structured.strict,
    schema: structured.schema as JsonValue,
  });
}

/** First system message text is the prompt; later system content must be `developer` items. */
function splitSystemMessages(messages: readonly Message[]): {
  readonly instructions?: string;
  readonly developer: readonly string[];
  readonly conversation: readonly Message[];
} {
  const systemTexts: string[] = [];
  const conversation: Message[] = [];
  for (const message of messages) {
    if (message.role !== "system") {
      conversation.push(message);
      continue;
    }
    const text = message.content
      .filter((part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text) systemTexts.push(text);
  }
  const [instructions, ...developer] = systemTexts;
  return {
    ...(instructions ? { instructions } : {}),
    developer,
    conversation,
  };
}

function toInputItems(
  message: Message,
  model: ModelConfig,
  imageInput: "capability-gated" | "always",
  toolNames?: ToolNameMap,
): JsonObject[] {
  const items: JsonObject[] = [];

  if (message.role === "tool") {
    const result = message.content.find((part): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result");
    const text = message.content
      .filter((part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n");
    const output =
      result?.result === undefined
        ? (result?.error?.message ?? "")
        : typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result);
    items.push({ type: "function_call_output", call_id: result?.toolCallId ?? "", output: text ? `${output}\n${text}` : output });
    return items;
  }

  if (message.role === "assistant") {
    // Encrypted reasoning is replayed whenever it came from this provider: dropping it would
    // break the next turn, and it is not the provider's choice to make.
    for (const part of message.content) {
      if (part.type !== "thinking") continue;
      const reasoning = replayReasoningItem(part.data, model.provider);
      if (reasoning) items.push(reasoning);
    }
    const outputText = message.content
      .filter((part): part is Extract<ContentBlock, { type: "text" }> => part.type === "text")
      .map((part): JsonObject => ({ type: "output_text", text: part.text }));
    if (outputText.length > 0) items.push({ role: "assistant", content: outputText });
    for (const part of message.content) {
      if (part.type !== "tool_call") continue;
      items.push({
        type: "function_call",
        call_id: part.id,
        name: wireToolName(part.name, toolNames),
        arguments: JSON.stringify(part.arguments ?? {}),
      });
    }
    return items;
  }

  const content: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ type: "input_text", text: part.text });
    } else if (part.type === "image") {
      if (imageInput === "capability-gated" && model.capabilities?.input?.includes("image") !== true) {
        throw new Error(`Provider ${message.role} message includes image but model does not declare image input capability`);
      }
      const url = part.url ?? (part.data ? `data:${part.mimeType ?? "image/png"};base64,${part.data}` : undefined);
      if (!url) throw new Error("Provider image block missing url or data");
      content.push({ type: "input_image", image_url: url });
    } else if (part.type === "thinking") {
    } else if (part.type === "tool_call" || part.type === "tool_result") {
      throw new Error("Provider tool blocks must be serialized in assistant or tool messages");
    } else {
      throw new Error(`OpenAI Responses does not support ${part.type} content blocks`);
    }
  }
  if (content.length > 0) items.push({ role: message.role, content });
  return items;
}

/**
 * A reasoning item is replayed only to the provider that produced it: the encrypted payload is
 * provider-bound, so sending it elsewhere is at best a rejected request and at worst a leak.
 */
function replayReasoningItem(data: string | undefined, provider: string): JsonObject | undefined {
  if (!data) return undefined;
  let parsed: ResponsesReasoningData;
  try {
    parsed = JSON.parse(data) as ResponsesReasoningData;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  if (parsed.provider !== provider) return undefined;
  const item = parsed.item;
  if (!item || item.type !== "reasoning" || typeof item.encrypted_content !== "string" || !item.encrypted_content) return undefined;
  return cleanObject({
    type: "reasoning",
    id: item.id,
    encrypted_content: item.encrypted_content,
    summary: item.summary ?? [],
  });
}

/**
 * Parses the Responses SSE stream into Prism provider events. Text and reasoning summaries stream as
 * deltas; the terminal `response.completed`/`response.incomplete` carries usage and the stop reason.
 */
export async function* openAIResponsesEvents(
  body: ReadableStream<Uint8Array>,
  options: OpenAIResponsesEventsOptions = {},
): AsyncIterable<ProviderEvent> {
  const secrets = options.secrets ?? [];
  const tools = new Map<number, { itemId?: string; callId?: string; name?: string; argumentsText: string }>();
  const streamedSummary = new Set<number>();
  let usage: Usage | undefined;
  let completed = false;
  let stopReason: string | undefined;

  for await (const sseEvent of readSseEvents(body, { signal: options.signal })) {
    const data = sseEvent.data.trim();
    if (!data || data === "[DONE]") continue;
    let event: JsonObject;
    try {
      event = JSON.parse(data) as JsonObject;
    } catch (error) {
      yield providerError(error, secrets);
      return;
    }

    const type = typeof event.type === "string" ? event.type : "";
    const outputIndex = typeof event.output_index === "number" ? event.output_index : 0;

    if (type === "error") {
      // The measured frame wraps the failure: {"type":"error","error":{...}} (plan 204 Task 9). The
      // flattened shape is kept for the older fixtures.
      yield responsesFailureError(asObject(event.error) ?? event, secrets);
      return;
    }

    if (type === "response.output_text.delta") {
      if (typeof event.delta === "string" && event.delta) yield providerTextDelta(event.delta);
      continue;
    }

    if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
      if (typeof event.delta === "string" && event.delta) {
        streamedSummary.add(outputIndex);
        yield providerThinkingDelta(event.delta);
      }
      continue;
    }

    if (type === "response.output_item.added") {
      const item = asObject(event.item);
      if (item?.type === "function_call") {
        tools.set(outputIndex, {
          itemId: typeof item.id === "string" ? item.id : undefined,
          callId: typeof item.call_id === "string" ? item.call_id : undefined,
          name: typeof item.name === "string" ? productToolName(item.name, options.toolNames) : undefined,
          argumentsText: "",
        });
      }
      continue;
    }

    if (type === "response.function_call_arguments.delta") {
      const delta = typeof event.delta === "string" ? event.delta : "";
      const current = tools.get(outputIndex) ?? { argumentsText: "" };
      current.argumentsText += delta;
      if (typeof event.item_id === "string") current.itemId = current.itemId ?? event.item_id;
      tools.set(outputIndex, current);
      if (delta) {
        yield providerToolCallDelta({
          index: outputIndex,
          id: current.callId ?? current.itemId,
          name: current.name,
          argumentsText: delta,
        });
      }
      continue;
    }

    if (type === "response.output_item.done") {
      const item = asObject(event.item);
      if (!item) continue;
      if (item.type === "reasoning") {
        const block = reasoningBlock(item, options.provider, streamedSummary.has(outputIndex));
        if (block) yield providerContentDelta(block);
      } else if (item.type === "function_call") {
        const current = tools.get(outputIndex) ?? { argumentsText: "" };
        tools.set(outputIndex, {
          itemId: current.itemId ?? (typeof item.id === "string" ? item.id : undefined),
          callId: current.callId ?? (typeof item.call_id === "string" ? item.call_id : undefined),
          name: current.name ?? (typeof item.name === "string" ? productToolName(item.name, options.toolNames) : undefined),
          argumentsText: current.argumentsText || (typeof item.arguments === "string" ? item.arguments : current.argumentsText),
        });
      }
      continue;
    }

    if (type === "response.completed" || type === "response.incomplete") {
      const response = asObject(event.response) ?? event;
      const mapped = (options.mapUsage ?? mapResponsesUsage)(response.usage, response);
      if (mapped) {
        usage = mapped;
        yield providerUsage(mapped);
      }
      completed = true;
      stopReason =
        type === "response.incomplete" ? incompleteReason(response) : typeof response.status === "string" ? response.status : "completed";
      continue;
    }

    if (type === "response.failed") {
      const response = asObject(event.response);
      yield responsesFailureError(asObject(response?.error) ?? response ?? event, secrets);
      return;
    }

    // response.created / in_progress / content_part.* / output_text.done /
    // function_call_arguments.done / reasoning_summary_part.* / response.metadata carry no
    // event the kernel consumes.
  }

  const incompleteCall = [...tools.entries()].find(([, call]) => !(call.callId ?? call.itemId) || !call.name);
  if (incompleteCall) {
    yield providerError(new Error(`Incomplete tool call delta at index ${incompleteCall[0]}`), secrets);
    return;
  }

  if (!completed) {
    if (options.strictCompletion ?? true) {
      yield providerError(new Error("Responses stream ended without completion evidence (response.completed missing)"), secrets);
      return;
    }
    for (const call of tools.values()) {
      const id = call.callId ?? call.itemId;
      if (id && call.name)
        yield providerToolCall(toolCallFromArgumentsText(id, productToolName(call.name, options.toolNames), call.argumentsText));
    }
    yield providerDone(usage, undefined);
    return;
  }

  for (const call of tools.values()) {
    yield providerToolCall(
      toolCallFromArgumentsText((call.callId ?? call.itemId)!, productToolName(call.name!, options.toolNames), call.argumentsText),
    );
  }
  yield providerDone(usage, mapProviderStopReason(stopReason));
}

/** `incomplete_details.reason` is a stop reason in its own right (`max_output_tokens`, filter). */
function incompleteReason(response: JsonObject): string {
  const details = asObject(response.incomplete_details);
  const reason = details?.reason;
  if (typeof reason === "string") return reason;
  return typeof response.status === "string" ? response.status : "incomplete";
}

/**
 * Reasoning item → one thinking block. `data` keeps the wire item verbatim so a replay is
 * byte-identical; an item without an encrypted payload has nothing to replay and is dropped.
 */
function reasoningBlock(item: JsonObject, provider: string | undefined, alreadyStreamed: boolean): ContentBlock | undefined {
  const encrypted = typeof item.encrypted_content === "string" ? item.encrypted_content : undefined;
  const summaryText = summaryParts(item).join("");
  if (!encrypted) {
    return summaryText && !alreadyStreamed ? { type: "thinking", text: summaryText } : undefined;
  }
  const data: ResponsesReasoningData = { ...(provider ? { provider } : {}), item };
  return {
    type: "thinking",
    text: alreadyStreamed ? "" : summaryText,
    redacted: true,
    data: JSON.stringify(data),
  };
}

function summaryParts(item: JsonObject): string[] {
  const summary = item.summary;
  if (!Array.isArray(summary)) return [];
  return summary
    .map((part) => asObject(part))
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean);
}

/**
 * A terminal stream error keeps the wire `code` and `param` in its message and carries the HTTP
 * status the shared classifier needs: an overflow payload has none on the wire (the response was a
 * 200 stream), so it is reported as a 400, which is how `context_length_exceeded` reaches
 * `classifyProviderFailure` as `context_overflow`.
 */
function responsesFailureError(error: JsonObject | undefined, secrets: readonly (string | undefined)[]): ProviderEvent {
  const rawCode = error?.code;
  const code = typeof rawCode === "string" || typeof rawCode === "number" ? rawCode : undefined;
  const param = typeof error?.param === "string" ? error.param : undefined;
  const detail = typeof error?.message === "string" ? error.message : "stream reported a terminal error";
  const label = code !== undefined ? String(code) : undefined;
  const message = `${label ?? "provider_error"}${param ? ` (${param})` : ""}: ${detail}`;
  const numericCode = typeof code === "number" ? code : typeof code === "string" && /^\d{3}$/.test(code) ? Number(code) : undefined;
  const overflow = isContextOverflowMessage(message);
  const failure = new Error(message) as Error & { code?: number | string };
  failure.name = "ProviderTransportError";
  const status = overflow ? 400 : numericCode;
  if (status !== undefined) failure.code = status;
  else if (code !== undefined) failure.code = code;
  return providerError(failure, secrets);
}

/** Responses usage is inclusive: `input_tokens` already counts cache reads. */
export function mapOpenAIResponsesUsage(usage: unknown): Usage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const wire = usage as {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly total_tokens?: number;
    readonly input_tokens_details?: { readonly cached_tokens?: number };
    readonly output_tokens_details?: { readonly reasoning_tokens?: number };
  };
  const reasoningTokens = wire.output_tokens_details?.reasoning_tokens;
  return normalizeUsage({
    inputTokens: wire.input_tokens,
    outputTokens: wire.output_tokens,
    totalTokens: wire.total_tokens,
    cacheReadTokens: wire.input_tokens_details?.cached_tokens,
    ...(typeof reasoningTokens === "number" && reasoningTokens > 0 ? { metadata: { reasoningTokens } } : {}),
  });
}

const mapResponsesUsage = mapOpenAIResponsesUsage;

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cleanObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
