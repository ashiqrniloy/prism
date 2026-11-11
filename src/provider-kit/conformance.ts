import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ModelProvider,
  ContentBlock,
  EmbeddingsProvider,
  EmbeddingsResult,
  JsonObject,
  Message,
  ModelConfig,
  ProviderEvent,
  ProviderRequest,
  ProviderRequestOptions,
  ToolCallContent,
  ToolDefinition,
  Usage,
} from "../contracts.js";
import { DecisionsError, EmbeddingsError } from "../contracts.js";
import { reconstructToolCallDeltas } from "../models/events.js";
import { SECRET_REF } from "../packages/schema.js";
import type { SecretSource } from "./provider-package.js";
import { canonicalizeJsonSchema } from "./schema.js";
import { type RecordedExchange, recordingHasErrorFrame, replayFetch } from "./wire-replay.js";

export interface ProviderStreamConformanceOptions {
  readonly provider: ModelProvider;
  readonly request: ProviderRequest;
  readonly expect?: {
    readonly text?: string;
    readonly usage?: Usage;
  };
}

export interface ProviderAbortConformanceOptions {
  readonly provider: ModelProvider;
  readonly request: Omit<ProviderRequest, "signal"> & { readonly signal?: AbortSignal };
  readonly reason?: unknown;
}

export interface ToolCallDeltaExpectation {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: JsonObject;
}

export interface SerializedContentCoverageOptions {
  readonly unsupported?: readonly ContentBlock["type"][];
}

export interface ProviderHeaderOwnershipConformanceOptions {
  /** Provider-owned header names mapped to the authoritative values the provider must set. */
  readonly owned: Readonly<Record<string, string>>;
  /** Caller-supplied headers, including attempts to override owned names and non-owned additions. */
  readonly caller: Readonly<Record<string, string>>;
}

export async function collectProviderEvents(provider: ModelProvider, request: ProviderRequest): Promise<readonly ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate(request)) events.push(event);
  return events;
}

export async function assertProviderStreamConforms(options: ProviderStreamConformanceOptions): Promise<readonly ProviderEvent[]> {
  const events = await collectProviderEvents(options.provider, options.request);
  const terminal = events.at(-1);
  if (!terminal || (terminal.type !== "done" && terminal.type !== "error")) throw new Error("Provider stream must end with done or error");
  if (events.slice(0, -1).some((event) => event.type === "done" || event.type === "error"))
    throw new Error("Provider stream terminal event must be last");

  if (options.expect?.text !== undefined && textFrom(events) !== options.expect.text)
    throw new Error(`Provider text mismatch: expected ${JSON.stringify(options.expect.text)}`);
  if (options.expect?.usage) assertUsageAccounting(events, options.expect.usage);
  return events;
}

export async function assertAbortIsObserved(options: ProviderAbortConformanceOptions): Promise<void> {
  const controller = new AbortController();
  controller.abort(options.reason ?? new Error("aborted"));
  let rejected = false;
  try {
    await collectProviderEvents(options.provider, { ...options.request, signal: controller.signal });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Provider did not observe an already-aborted signal");
}

export function assertToolCallDeltasReconstruct(
  events: readonly ProviderEvent[],
  expected: readonly ToolCallDeltaExpectation[],
): readonly ToolCallContent[] {
  const calls = reconstructToolCallDeltas(events);
  for (const item of expected) {
    const call = calls[item.index];
    if (!call) throw new Error(`Missing tool call at index ${item.index}`);
    if (item.id !== undefined && call.id !== item.id) throw new Error(`Tool call id mismatch at index ${item.index}`);
    if (item.name !== undefined && call.name !== item.name) throw new Error(`Tool call name mismatch at index ${item.index}`);
    if (item.arguments !== undefined && JSON.stringify(call.arguments) !== JSON.stringify(item.arguments))
      throw new Error(`Tool call arguments mismatch at index ${item.index}`);
  }
  return calls;
}

export function assertSerializedRequestCoversContent(
  request: ProviderRequest,
  body: unknown,
  options: SerializedContentCoverageOptions = {},
): void {
  const unsupported = new Set(options.unsupported ?? []);
  const bodyText = JSON.stringify(body);
  for (const message of request.messages) {
    for (const block of message.content) {
      if (unsupported.has(block.type)) continue;
      const canaries = contentBlockCanaries(block);
      if (canaries.length === 0) continue;
      const missing = canaries.filter((canary) => !bodyText.includes(canary));
      if (missing.length > 0) {
        throw new Error(`Serialized request dropped ${block.type} content; missing canaries: ${JSON.stringify(missing)}`);
      }
    }
  }
}

export function assertCanonicalToolParameters(serialized: unknown, original: unknown): void {
  const expected = canonicalizeJsonSchema(original ?? { type: "object" });
  if (JSON.stringify(serialized) !== JSON.stringify(expected)) {
    throw new Error("Tool parameters were not canonicalized");
  }
}

export function assertProviderOwnedHeadersWin(captured: Headers, options: ProviderHeaderOwnershipConformanceOptions): void {
  const ownedLower: Record<string, string> = {};
  for (const [name, expected] of Object.entries(options.owned)) ownedLower[name.toLowerCase()] = expected;
  for (const [name, expected] of Object.entries(ownedLower)) {
    const actual = captured.get(name);
    if (actual !== expected)
      throw new Error(
        `Caller header overrode provider-owned "${name}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
  }
  for (const [name, callerValue] of Object.entries(options.caller)) {
    if (Object.hasOwn(ownedLower, name.toLowerCase())) continue;
    const actual = captured.get(name);
    if (actual !== callerValue)
      throw new Error(
        `Provider dropped non-owned caller header "${name}": expected ${JSON.stringify(callerValue)}, got ${JSON.stringify(actual)}`,
      );
  }
}

export function assertNoSecretLeak(events: readonly ProviderEvent[], secrets: readonly string[]): void {
  const eventText = JSON.stringify(events);
  for (const secret of secrets) {
    if (!secret) continue;
    if (eventText.includes(secret)) throw new Error(`Secret leaked into provider events: ${secret.slice(0, 8)}...`);
  }
}

/** Known cache wire fields across protocols; any of these in a request body is an explicit cache control. */
const CACHE_WIRE_FIELDS = [
  "cache_control",
  "prompt_cache_key",
  "prompt_cache_retention",
  "prompt_cache_options",
  "prompt_cache_breakpoint",
  "cachedContent",
  "cachePoint",
] as const;

/**
 * Implicit/none-cache providers must serialize no foreign cache fields: implicit
 * caching works by byte-stable prefix reuse, not request payloads. `allowed` names
 * fields the provider documents for that route (e.g. `cachedContent` via the host
 * `extra.cachedContent` escape hatch on Gemini).
 */
export function assertNoForeignCacheFields(body: unknown, allowed: readonly string[] = []): void {
  const bodyText = JSON.stringify(body);
  for (const field of CACHE_WIRE_FIELDS) {
    if (allowed.includes(field)) continue;
    if (bodyText.includes(field)) throw new Error(`Serialized request carries foreign cache field "${field}"`);
  }
}

/** Provider construction and setup must perform zero network calls; discovery and streams are caller-gated. */
export function assertNoFetches(calls: readonly unknown[]): void {
  if (calls.length > 0) throw new Error(`Provider fetched ${calls.length} time(s) outside caller-gated discovery/stream`);
}

/** `models()` is optional; when present it resolves to a list of well-formed `ModelConfig` entries with unique ids. */
export async function assertModelsListValid(provider: ModelProvider): Promise<void> {
  if (provider.models === undefined) return;
  const models = await provider.models();
  if (!Array.isArray(models)) throw new Error("Provider models() must resolve to an array");
  const seen = new Set<string>();
  for (const model of models) {
    if (typeof model?.model !== "string" || model.model.length === 0) throw new Error("Provider models() entry has no model id");
    if (model.provider !== undefined && model.provider !== provider.id)
      throw new Error(`Provider models() entry "${model.model}" names provider "${model.provider}", not "${provider.id}"`);
    if (seen.has(model.model)) throw new Error(`Provider models() lists "${model.model}" twice`);
    seen.add(model.model);
  }
}

/** `auth` descriptors are optional; each is an `api-key` with a secret ref or an `oauth` method with an id and `login`. */
export function assertAuthDescriptorsWellFormed(provider: ModelProvider): void {
  if (provider.auth === undefined) return;
  if (!Array.isArray(provider.auth)) throw new Error("Provider auth must be an array");
  for (const method of provider.auth) {
    if (method.kind === "api-key") {
      if (typeof method.ref !== "string" || !SECRET_REF.test(method.ref))
        throw new Error("Provider api-key auth must carry an env: or keyring: ref");
    } else if (method.kind === "oauth") {
      if (typeof method.id !== "string" || method.id.length === 0) throw new Error("Provider oauth auth needs an id");
      if (typeof method.login !== "function") throw new Error(`Provider oauth auth "${method.id}" needs login()`);
    } else {
      throw new Error(`Provider auth kind "${String((method as { kind?: unknown }).kind)}" is unknown`);
    }
  }
}

export interface ProviderConformanceScenarioResult {
  readonly name: string;
  readonly ok: boolean;
  readonly events: readonly ProviderEvent[];
}

export interface ProviderConformanceResult {
  readonly ok: boolean;
  readonly scenarios: readonly ProviderConformanceScenarioResult[];
}

export interface ProviderConformanceOptions {
  /** A request the provider can serve against its (fake) transport. */
  readonly request?: ProviderRequest;
  /** Secret values the provider was given. At least one is required when recordings is omitted. */
  readonly secrets?: readonly string[];
  /**
   * Header ownership is always checked. `owned` maps provider-owned headers to the values they must carry;
   * `caller` is merged into `request.options.headers` (include an attempt to override an owned name);
   * `captured` returns the headers the fake transport saw for the last request.
   */
  readonly headers?: {
    readonly owned?: Readonly<Record<string, string>>;
    readonly caller?: Readonly<Record<string, string>>;
    readonly captured?: () => Headers | undefined;
  };
  readonly expect?: ProviderStreamConformanceOptions["expect"];
  readonly toolCalls?: readonly ToolCallDeltaExpectation[];
  /** Directory path or URL containing recorded wire scenarios. */
  readonly recordings?: string | URL;
  /** Catalog of models to match against recorded wire requests. */
  readonly models?: readonly ModelConfig[] | (() => Promise<readonly ModelConfig[]> | readonly ModelConfig[]);
}

function findJsonFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function requestFromWire(body: unknown, modelsList: readonly ModelConfig[], providerId: string, requestPath?: string): ProviderRequest {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const modelId = typeof obj.model === "string" ? obj.model : (modelsList[0]?.model ?? "default");
  const foundModel = modelsList.find((m) => m.model === modelId);

  const route = requestPath?.includes("messages")
    ? "anthropic"
    : requestPath?.includes("responses")
      ? "responses"
      : requestPath?.includes("chat/completions")
        ? "openai"
        : undefined;
  const responsesWire = route === "responses";

  const modelConfig: ModelConfig = foundModel
    ? {
        ...foundModel,
        ...(route ? { compat: { ...(foundModel.compat ?? {}), route } } : {}),
      }
    : {
        provider: providerId,
        model: modelId,
        ...(route ? { compat: { route } } : {}),
      };

  const messages: Message[] = [];

  if (responsesWire) {
    if (typeof obj.instructions === "string" && obj.instructions) {
      messages.push({ role: "system", content: [{ type: "text", text: obj.instructions }] });
    }
    const rawInput = Array.isArray(obj.input) ? obj.input : typeof obj.input === "string" ? [{ role: "user", content: obj.input }] : [];
    for (const raw of rawInput) {
      const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
      if (!item) continue;

      if (typeof item.type === "string" && item.type !== "message") {
        // A function call and its output replay as the tool call and the tool result they are.
        if (item.type === "function_call") {
          let args: JsonObject = {};
          try {
            args = typeof item.arguments === "string" ? (JSON.parse(item.arguments) as JsonObject) : {};
          } catch {}
          messages.push({
            role: "assistant",
            content: [
              {
                type: "tool_call",
                id: typeof item.call_id === "string" ? item.call_id : "call_1",
                name: typeof item.name === "string" ? item.name : "tool",
                arguments: args,
              },
            ],
          });
        } else if (item.type === "function_call_output") {
          let parsedResult: unknown = item.output;
          try {
            parsedResult = typeof item.output === "string" ? JSON.parse(item.output) : item.output;
          } catch {}
          messages.push({
            role: "tool",
            content: [
              {
                type: "tool_result",
                name: "tool",
                toolCallId: typeof item.call_id === "string" ? item.call_id : "",
                result: parsedResult,
              },
            ],
          });
        } else if (item.type === "reasoning") {
          // Replay the recorded reasoning item exactly as the codec would: `data` carries the
          // provider-bound payload, so the encrypted round trip is exercised, not skipped.
          const summary = Array.isArray(item.summary)
            ? item.summary
                .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : undefined))
                .filter((text): text is string => typeof text === "string")
                .join("")
            : "";
          messages.push({
            role: "assistant",
            content: [
              {
                type: "thinking",
                text: summary,
                redacted: true,
                data: JSON.stringify({ provider: providerId, item }),
              },
            ],
          });
        }
        continue;
      }

      const content: ContentBlock[] = [];
      const rawContent = item.content;
      if (typeof rawContent === "string") {
        content.push({ type: "text", text: rawContent });
      } else if (Array.isArray(rawContent)) {
        for (const part of rawContent) {
          if (!part || typeof part !== "object") continue;
          const p = part as Record<string, unknown>;
          if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
            content.push({ type: "text", text: typeof p.text === "string" ? p.text : "" });
          } else if (p.type === "input_image" && typeof p.image_url === "string") {
            content.push({ type: "image", url: p.image_url });
          }
        }
      }
      const role = typeof item.role === "string" ? item.role : "user";
      messages.push({
        role: role === "assistant" ? "assistant" : role === "system" || role === "developer" ? "system" : "user",
        content: content.length > 0 ? content : [{ type: "text", text: "" }],
      });
    }
  }

  const rawMessages = responsesWire ? [] : Array.isArray(obj.messages) ? obj.messages : [];

  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object") continue;
    const role = (raw as Record<string, unknown>).role;
    const rawContent = (raw as Record<string, unknown>).content;
    const content: ContentBlock[] = [];

    if (typeof rawContent === "string") {
      content.push({ type: "text", text: rawContent });
    } else if (Array.isArray(rawContent)) {
      for (const part of rawContent) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        const cacheControl = p.cache_control ? { cache_control: p.cache_control as JsonObject } : {};

        if (p.type === "text") {
          content.push({ type: "text", text: typeof p.text === "string" ? p.text : "", ...cacheControl });
        } else if (p.type === "thinking") {
          content.push({
            type: "thinking",
            text: typeof p.thinking === "string" ? p.thinking : typeof p.text === "string" ? p.text : "",
            signature: typeof p.signature === "string" ? p.signature : undefined,
            ...cacheControl,
          });
        } else if (p.type === "redacted_thinking") {
          content.push({
            type: "thinking",
            text: "",
            redacted: true,
            data: typeof p.data === "string" ? p.data : "",
            ...cacheControl,
          });
        } else if (p.type === "tool_use") {
          content.push({
            type: "tool_call",
            id: typeof p.id === "string" ? p.id : "call_1",
            name: typeof p.name === "string" ? p.name : "tool",
            arguments: p.input && typeof p.input === "object" ? (p.input as JsonObject) : {},
          });
        } else if (p.type === "tool_result") {
          let parsedResult: unknown;
          try {
            parsedResult = typeof p.content === "string" ? JSON.parse(p.content) : p.content;
          } catch {
            parsedResult = p.content;
          }
          content.push({
            type: "tool_result",
            name: typeof p.name === "string" ? p.name : "tool",
            toolCallId: typeof p.tool_use_id === "string" ? p.tool_use_id : typeof p.toolCallId === "string" ? p.toolCallId : "",
            result: parsedResult,
            ...cacheControl,
          });
        } else if (p.type === "image") {
          content.push(part as ContentBlock);
        }
      }
    }

    if (Array.isArray((raw as Record<string, unknown>).tool_calls)) {
      for (const tc of (raw as Record<string, unknown>).tool_calls as unknown[]) {
        if (!tc || typeof tc !== "object") continue;
        const callObj = tc as Record<string, unknown>;
        const fnObj = callObj.function as Record<string, unknown> | undefined;
        let argsObj: JsonObject = {};
        try {
          argsObj = typeof fnObj?.arguments === "string" ? JSON.parse(fnObj.arguments) : ((fnObj?.arguments as JsonObject) ?? {});
        } catch {}
        content.push({
          type: "tool_call",
          id: typeof callObj.id === "string" ? callObj.id : "call_1",
          name: typeof fnObj?.name === "string" ? fnObj.name : "tool",
          arguments: argsObj,
        });
      }
    }

    if (role === "tool" || (role === "user" && content.some((c) => c.type === "tool_result"))) {
      const toolResults = content.filter((c) => c.type === "tool_result");
      const otherContent = content.filter((c) => c.type !== "tool_result");
      if (otherContent.length > 0) {
        messages.push({ role: "user", content: otherContent });
      }
      if (toolResults.length > 0) {
        messages.push({ role: "tool", content: toolResults });
      }
    } else {
      messages.push({
        role: role === "assistant" ? "assistant" : role === "system" ? "system" : "user",
        content: content.length > 0 ? content : [{ type: "text", text: "" }],
      });
    }
  }

  let tools: ToolDefinition[] | undefined;
  if (Array.isArray(obj.tools)) {
    tools = (obj.tools as unknown[]).map((t) => {
      const toolObj = t as Record<string, unknown>;
      const fnObj = toolObj.function as Record<string, unknown> | undefined;
      const name = typeof toolObj.name === "string" ? toolObj.name : typeof fnObj?.name === "string" ? fnObj.name : "tool";
      const description =
        typeof toolObj.description === "string"
          ? toolObj.description
          : typeof fnObj?.description === "string"
            ? fnObj.description
            : undefined;
      const parameters = (toolObj.input_schema ?? fnObj?.parameters ?? toolObj.parameters ?? { type: "object" }) as JsonObject;
      return {
        name,
        description,
        parameters,
        execute: () => ({ toolCallId: "call_mock", name, content: [] }),
      };
    });
  }

  const options: ProviderRequestOptions = obj.thinking ? { compat: { thinking: true } } : {};

  return {
    model: modelConfig,
    messages: messages.length > 0 ? messages : [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

/**
 * One conformance run for a provider: stream shape, abort, tool-call deltas, header ownership, secret leak,
 * usage accounting, `models()` and `auth` descriptors. When `recordings` is provided, replays every recorded
 * scenario through the provider and verifies event order, usage rule, tool calls, and thinking signature round-trip.
 */
export async function providerConformance(
  factory: (fetchImpl?: typeof fetch, options?: { fetch?: typeof fetch }) => ModelProvider,
  options: ProviderConformanceOptions,
): Promise<ProviderConformanceResult> {
  if (!options.recordings) {
    if (!options.request) throw new Error("providerConformance requires request when recordings is not specified");
    if (!options.headers?.captured) throw new Error("providerConformance requires headers when recordings is not specified");
    if (!options.secrets || options.secrets.filter(Boolean).length === 0)
      throw new Error("providerConformance requires at least one secret to check for leaks");
    const callerHeaders = options.headers.caller ?? {};
    const ownedHeaders = options.headers.owned ?? {};
    const request: ProviderRequest = {
      ...options.request,
      options: { ...options.request.options, headers: { ...options.request.options?.headers, ...callerHeaders } },
    };
    const events = await assertProviderStreamConforms({ provider: factory(), request, expect: options.expect });
    const captured = options.headers.captured();
    if (!captured) throw new Error("providerConformance: the provider sent no request through the captured transport");
    assertProviderOwnedHeadersWin(captured, { owned: ownedHeaders, caller: callerHeaders });
    assertNoSecretLeak(events, options.secrets);
    if (options.toolCalls) assertToolCallDeltasReconstruct(events, options.toolCalls);
    await assertAbortIsObserved({ provider: factory(), request: options.request });
    const probe = factory();
    await assertModelsListValid(probe);
    assertAuthDescriptorsWellFormed(probe);
    return {
      ok: true,
      scenarios: [{ name: "default", ok: true, events }],
    };
  }

  const recordingsDir = options.recordings instanceof URL ? fileURLToPath(options.recordings) : resolve(String(options.recordings));

  if (!existsSync(recordingsDir)) {
    throw new Error(`providerConformance: recordings directory does not exist: ${recordingsDir}`);
  }

  let modelsList: readonly ModelConfig[] = [];
  if (options.models) {
    modelsList = typeof options.models === "function" ? await options.models() : options.models;
  } else {
    try {
      const probe = factory();
      if (probe.models) modelsList = await probe.models();
    } catch {
      // models() is optional
    }
  }

  const probe = factory();
  await assertModelsListValid(probe);
  assertAuthDescriptorsWellFormed(probe);

  const jsonFiles = findJsonFiles(recordingsDir);
  if (jsonFiles.length === 0) {
    if (options.request && options.headers && options.secrets) {
      return await providerConformance(factory, { ...options, recordings: undefined });
    }
    return { ok: true, scenarios: [] };
  }

  const secrets =
    options.secrets && options.secrets.filter(Boolean).length > 0
      ? options.secrets
      : ["canary-secret-should-not-leak", "sk-secret-token", "fake-key"];

  const scenarioResults: ProviderConformanceScenarioResult[] = [];

  for (const file of jsonFiles) {
    const scenarioName = basename(file, ".json");
    const rawContent = readFileSync(file, "utf8");
    const parsed = JSON.parse(rawContent);

    const exchanges: RecordedExchange[] = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "responseBody" in parsed
        ? [parsed as RecordedExchange]
        : parsed && typeof parsed === "object" && "recording" in parsed
          ? Array.isArray(parsed.recording)
            ? parsed.recording
            : [parsed.recording]
          : [];

    if (exchanges.length === 0) continue;

    let capturedHeaders: Headers | undefined;
    const baseReplay = replayFetch(exchanges);

    const trackingFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      if (init?.body) {
        try {
          const bodyStr = typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBufferView);
          const parsedBody = JSON.parse(bodyStr);
          if (parsedBody && Array.isArray(parsedBody.input)) {
            for (const item of parsedBody.input) {
              if (item && typeof item === "object" && (item as { type?: unknown }).type === "reasoning") {
                const encrypted = (item as { encrypted_content?: unknown }).encrypted_content;
                if (typeof encrypted !== "string" || encrypted.trim() === "") {
                  throw new Error(
                    `conformance_fails_on_unencrypted_reasoning_replay: replayed reasoning item without encrypted_content in scenario "${scenarioName}"`,
                  );
                }
              }
            }
          }
          if (parsedBody && Array.isArray(parsedBody.messages)) {
            for (const msg of parsedBody.messages) {
              if (msg.role === "assistant" && Array.isArray(msg.content)) {
                for (const part of msg.content) {
                  if (part && part.type === "thinking") {
                    if (!part.signature || typeof part.signature !== "string" || part.signature.trim() === "") {
                      throw new Error(
                        `conformance_fails_on_unsigned_thinking_replay: assistant thinking block replayed on wire without signature in scenario "${scenarioName}"`,
                      );
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          if (
            err instanceof Error &&
            (err.message.includes("conformance_fails_on_unsigned_thinking_replay") ||
              err.message.includes("conformance_fails_on_unencrypted_reasoning_replay"))
          ) {
            throw err;
          }
        }
      }
      return await baseReplay(input, init);
    }) as unknown as typeof fetch;

    const makeProvider = () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = trackingFetch;
      try {
        return factory(trackingFetch, { fetch: trackingFetch });
      } finally {
        globalThis.fetch = originalFetch;
      }
    };

    const provider = makeProvider();
    const allScenarioEvents: ProviderEvent[] = [];

    for (let turnIdx = 0; turnIdx < exchanges.length; turnIdx++) {
      const exchange = exchanges[turnIdx]!;
      let turnRequest: ProviderRequest;

      if (parsed && typeof parsed === "object" && parsed.request && exchanges.length === 1) {
        turnRequest = parsed.request;
      } else {
        turnRequest = requestFromWire(exchange.requestBody, modelsList, provider.id, exchange.path);
      }

      turnRequest = {
        ...turnRequest,
        options: {
          sessionId: turnRequest.options?.sessionId ?? "conformance-session",
          ...turnRequest.options,
          headers: {
            ...turnRequest.options?.headers,
            "x-conformance-caller": "caller-value",
            authorization: "Bearer attacker-header-override",
          },
        },
      };

      const turnEvents: ProviderEvent[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = trackingFetch;
      try {
        for await (const event of provider.generate(turnRequest)) {
          turnEvents.push(event);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }

      allScenarioEvents.push(...turnEvents);

      const terminal = turnEvents.at(-1);
      if (!terminal || (terminal.type !== "done" && terminal.type !== "error")) {
        throw new Error(`Provider stream in scenario "${scenarioName}" turn ${turnIdx + 1} must end with done or error`);
      }
      if (turnEvents.slice(0, -1).some((event) => event.type === "done" || event.type === "error")) {
        throw new Error(`Provider stream terminal event must be last in scenario "${scenarioName}" turn ${turnIdx + 1}`);
      }

      if ((exchange.status !== undefined && exchange.status >= 400) || recordingHasErrorFrame(exchange.responseBody)) {
        if (terminal.type !== "error") {
          throw new Error(`Expected error event for HTTP status ${exchange.status} in scenario "${scenarioName}"`);
        }
      } else {
        if (terminal.type !== "done") {
          throw new Error(`Expected done event for successful exchange in scenario "${scenarioName}"`);
        }
        if (terminal.stopReason === undefined) {
          throw new Error(`Terminal done event missing stopReason in scenario "${scenarioName}"`);
        }
      }

      for (const event of turnEvents) {
        if (event.type === "usage") {
          assertUsageAccounting([event, terminal], event.usage);
        } else if (event.type === "done" && event.usage) {
          assertUsageAccounting([event], event.usage);
        }
      }

      if (turnEvents.some((e) => e.type === "tool_call")) {
        const calls = reconstructToolCallDeltas(turnEvents);
        for (const call of calls) {
          if (!call.id || !call.name) {
            throw new Error(`Incomplete tool call reconstructed in scenario "${scenarioName}"`);
          }
        }
      }

      if (capturedHeaders) {
        const auth = capturedHeaders.get("authorization");
        if (auth === "Bearer attacker-header-override") {
          throw new Error(`Caller header overrode provider-owned authorization header in scenario "${scenarioName}"`);
        }
        const callerHeader = capturedHeaders.get("x-conformance-caller");
        if (callerHeader !== "caller-value") {
          throw new Error(`Non-owned caller header was dropped in scenario "${scenarioName}"`);
        }
      }
    }

    assertNoSecretLeak(allScenarioEvents, secrets);

    const sampleReq = requestFromWire(exchanges[0]?.requestBody, modelsList, provider.id, exchanges[0]?.path);
    await assertAbortIsObserved({ provider: makeProvider(), request: sampleReq });

    scenarioResults.push({
      name: scenarioName,
      ok: true,
      events: allScenarioEvents,
    });
  }

  return {
    ok: true,
    scenarios: scenarioResults,
  };
}

export function assertUsageAccounting(events: readonly ProviderEvent[], expected: Usage): Usage {
  const usage = [...events].reverse().find((event) => (event.type === "done" && event.usage) || event.type === "usage") as
    | Extract<ProviderEvent, { type: "usage" | "done" }>
    | undefined;
  const actual = usage?.type === "usage" ? usage.usage : usage?.usage;
  if (!actual) throw new Error("Provider stream did not include usage");
  if (
    (actual.cacheReadTokens !== undefined || actual.cacheWriteTokens !== undefined) &&
    (actual.cacheReadTokens ?? 0) + (actual.cacheWriteTokens ?? 0) > (actual.inputTokens ?? 0)
  ) {
    throw new Error(
      `Usage accounting invariant violated: cacheReadTokens (${actual.cacheReadTokens ?? 0}) + ` +
        `cacheWriteTokens (${actual.cacheWriteTokens ?? 0}) > inputTokens (${actual.inputTokens ?? 0})`,
    );
  }
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
    if (expected[key] !== undefined && actual[key] !== expected[key])
      throw new Error(`Usage ${key} mismatch: expected ${expected[key]}, got ${actual[key]}`);
  }
  return actual;
}

function contentBlockCanaries(block: ContentBlock): string[] {
  switch (block.type) {
    case "text":
      return block.text ? [block.text] : [];
    case "thinking":
      return block.text ? [block.text] : [];
    case "image":
      return [block.url, block.resourceUri, block.data, block.mimeType, block.name].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "audio":
      // Providers map mediaType to wire format tokens (e.g. audio/wav → "wav") and
      // typically omit display names from input_audio payloads; identity canaries are
      // source bytes/refs plus optional transcript text.
      return [block.url, block.resourceUri, block.data, block.transcript].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "file":
      return [block.url, block.resourceUri, block.data, block.mediaType, block.name].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "document":
      return [block.url, block.resourceUri, block.data, block.mediaType, block.name, block.transcript].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "tool_call":
      return [block.id, block.name, ...jsonPrimitives(block.arguments)];
    case "tool_result": {
      const values = [block.toolCallId, block.name, ...jsonPrimitives(block.result), ...jsonPrimitives(block.error)];
      return values.filter((value) => typeof value === "string" && value.length > 0);
    }
    default:
      return [];
  }
}

function jsonPrimitives(value: unknown): string[] {
  const primitives: string[] = [];
  const seen = new Set<unknown>();
  function walk(current: unknown) {
    if (seen.has(current)) return;
    if (current && typeof current === "object") {
      seen.add(current);
      if (Array.isArray(current)) {
        for (const item of current) walk(item);
      } else {
        for (const item of Object.values(current)) walk(item);
      }
    } else if (typeof current === "string" && current.length > 0) {
      primitives.push(current);
    } else if (typeof current === "number" || typeof current === "boolean") {
      primitives.push(String(current));
    }
  }
  walk(value);
  return primitives;
}

function textFrom(events: readonly ProviderEvent[]): string {
  return events.map((event) => (event.type === "content_delta" && event.content.type === "text" ? event.content.text : "")).join("");
}

export interface EmbeddingsConformanceOptions {
  readonly provider: EmbeddingsProvider;
  readonly model: string;
  /** When set, an oversized batch must fail with `EmbeddingsError("batch_too_large")`. */
  readonly maxBatchSize?: number;
  /** Happy-path mapping probe: inputs to embed and the expected vector count/dimensions. */
  readonly sample?: { readonly inputs: readonly string[]; readonly dimensions?: number };
}

/** Offline conformance for any `EmbeddingsProvider` (plan 061): typed empty-input
 *  error, typed oversized-batch error, and input-order vector mapping with finite
 *  coordinates. No network — the caller supplies the provider (real adapter with a
 *  fake transport, or a fake provider). */
export async function runEmbeddingsConformance(options: EmbeddingsConformanceOptions): Promise<EmbeddingsResult | undefined> {
  await assertEmbeddingsErrorCode(
    () => options.provider.embedMany({ model: options.model, inputs: [] }),
    "empty_input",
    "empty inputs must reject with EmbeddingsError(empty_input)",
  );
  if (options.maxBatchSize !== undefined) {
    const inputs = Array.from({ length: options.maxBatchSize + 1 }, (_, i) => `input-${i}`);
    await assertEmbeddingsErrorCode(
      () => options.provider.embedMany({ model: options.model, inputs }),
      "batch_too_large",
      `batches over ${options.maxBatchSize} must reject with EmbeddingsError(batch_too_large)`,
    );
  }
  if (!options.sample) return undefined;
  const result = await options.provider.embedMany({ model: options.model, inputs: options.sample.inputs });
  if (result.vectors.length !== options.sample.inputs.length)
    throw new Error(`vector count ${result.vectors.length} must match input count ${options.sample.inputs.length}`);
  for (const vector of result.vectors) {
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite))
      throw new Error("vectors must be non-empty arrays of finite numbers");
  }
  if (!(result.dimensions > 0)) throw new Error("result.dimensions must be positive");
  if (options.sample.dimensions !== undefined && result.dimensions !== options.sample.dimensions)
    throw new Error(`result.dimensions ${result.dimensions} must match expected ${options.sample.dimensions}`);
  return result;
}

async function assertEmbeddingsErrorCode(run: () => Promise<unknown>, code: EmbeddingsError["code"], label: string): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof EmbeddingsError)) throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}

export interface SystemOneConformanceOptions {
  readonly factory: (
    fetchImpl?: typeof fetch,
    options?: { readonly apiKey?: SecretSource; readonly fetch?: typeof fetch; readonly path?: string },
  ) => ModelProvider;
  readonly recordings?: string | URL;
  readonly keyRequired?: boolean;
}

export interface SystemOneConformanceScenarioResult {
  readonly name: string;
  readonly ok: boolean;
  readonly events?: readonly ProviderEvent[];
}

export interface SystemOneConformanceResult {
  readonly ok: boolean;
  readonly scenarios: readonly SystemOneConformanceScenarioResult[];
}

/**
 * Conformance test harness for System One decision providers (TypeSafe Jev, Laya).
 * Verifies gates before fetch, schema-valid rendering, boolean_threshold validation,
 * 401/422 status mapping, malformed success rejection, single credential resolution per request,
 * secret redaction, key policy, and optional wire recordings replay.
 */
export async function systemOneConformance(options: SystemOneConformanceOptions): Promise<SystemOneConformanceResult> {
  const probe = options.factory();
  let modelConfig: ModelConfig;
  if (probe.models) {
    const list = await probe.models();
    modelConfig = list[0] ?? {
      provider: probe.id,
      model: `${probe.id}-default`,
      capabilities: { structuredOutput: "json_schema" },
    };
  } else {
    modelConfig = {
      provider: probe.id,
      model: `${probe.id}-default`,
      capabilities: { structuredOutput: "json_schema" },
    };
  }

  const testSchema: JsonObject = {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["run", "reject", "ask"], description: "How should this be handled?" },
      irreversible: { type: "boolean", description: "Would running this destroy data?" },
    },
  };

  const baseRequest: ProviderRequest = {
    model: modelConfig,
    messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
    options: { structuredOutput: { name: "decision", schema: testSchema } },
  };

  const OK_RESPONSE = {
    model: `${probe.id}-checkpoint`,
    answers: {
      verdict: { type: "choice", choice: "ask", probabilities: { ask: 0.84 }, confidence: 0.68 },
      irreversible: { type: "noul", noul: 0.91 },
    },
    usage: { input_tokens: 96, output_tokens: 0 },
  };

  const scenarios: SystemOneConformanceScenarioResult[] = [];

  // 1. Gates before fetch: tools rejected
  {
    let fetched = false;
    const trackingFetch = (async () => {
      fetched = true;
      return new Response(JSON.stringify(OK_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const toolReq: ProviderRequest = {
      ...baseRequest,
      tools: [
        {
          name: "test_tool",
          description: "desc",
          parameters: { type: "object", properties: {} },
          execute: () => ({ toolCallId: "1", name: "test_tool", value: null }),
        },
      ],
    };
    const events = await collectProviderEvents(options.factory(trackingFetch), toolReq);
    if (fetched) throw new Error("systemOneConformance: tools must be rejected before fetch");
    const terminal = events.at(-1);
    if (terminal?.type !== "error" || !terminal.error.message.includes("tools")) {
      throw new Error("systemOneConformance: expected tools rejection error event before fetch");
    }
  }

  // 2. Gates before fetch: schema required
  {
    let fetched = false;
    const trackingFetch = (async () => {
      fetched = true;
      return new Response(JSON.stringify(OK_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const noSchemaReq: ProviderRequest = {
      model: modelConfig,
      messages: baseRequest.messages,
    };
    const events = await collectProviderEvents(options.factory(trackingFetch), noSchemaReq);
    if (fetched) throw new Error("systemOneConformance: request without structuredOutput must fail before fetch");
    const terminal = events.at(-1);
    if (terminal?.type !== "error" || !terminal.error.message.includes("structuredOutput")) {
      throw new Error("systemOneConformance: expected structuredOutput rejection error event before fetch");
    }
  }

  // 3. Schema-valid rendering & event sequence
  {
    const canaryKey = "sk-systemone-conformance-key";
    let sentAuth: string | null = null;
    const happyFetch = (async (_input: unknown, init?: RequestInit) => {
      sentAuth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify(OK_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const provider = options.factory(happyFetch, { apiKey: async () => canaryKey });
    const events = await collectProviderEvents(provider, baseRequest);
    const types = events.map((e) => e.type);
    if (types[0] !== "message_start") throw new Error("systemOneConformance: expected message_start as first event");
    const textDelta = events.find((e) => e.type === "content_delta" && e.content.type === "text");
    if (textDelta?.type !== "content_delta" || textDelta.content.type !== "text") {
      throw new Error("systemOneConformance: expected text content_delta");
    }
    const rendered = JSON.parse(textDelta.content.text);
    if (rendered.verdict !== "ask" || rendered.irreversible !== true) {
      throw new Error(`systemOneConformance: rendered output mismatch: ${JSON.stringify(rendered)}`);
    }
    const done = events.at(-1);
    if (done?.type !== "done" || done.stopReason !== "end_turn") {
      throw new Error("systemOneConformance: expected terminal done event with stopReason: end_turn");
    }
    if (done.usage?.inputTokens !== 96 || done.usage.outputTokens !== 0) {
      throw new Error("systemOneConformance: expected usage accounting on done event");
    }
    assertNoSecretLeak(events, [canaryKey]);
    if (options.keyRequired !== false && sentAuth !== `Bearer ${canaryKey}`) {
      throw new Error(`systemOneConformance: expected Bearer authorization header with key, got ${sentAuth}`);
    }
    scenarios.push({ name: "schema-valid-rendering", ok: true, events });
  }

  // 4. boolean_threshold validation
  {
    // Out of range fails before fetch
    for (const badThreshold of [1.5, -0.1]) {
      let fetched = false;
      const trackingFetch = (async () => {
        fetched = true;
        return new Response(JSON.stringify(OK_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;
      const req: ProviderRequest = {
        ...baseRequest,
        options: { ...baseRequest.options, compat: { boolean_threshold: badThreshold } },
      };
      const events = await collectProviderEvents(options.factory(trackingFetch), req);
      if (fetched) throw new Error("systemOneConformance: out-of-range boolean_threshold must fail before fetch");
      const terminal = events.at(-1);
      if (terminal?.type !== "error" || !terminal.error.message.includes("boolean_threshold")) {
        throw new Error("systemOneConformance: expected boolean_threshold error event");
      }
    }

    // In-range threshold behavior (0.6 probability vs 0.9 threshold and 0.5 threshold)
    const thresholdResponse = {
      model: `${probe.id}-model`,
      answers: { verdict: { type: "choice", choice: "ask" }, irreversible: { type: "noul", noul: 0.6 } },
      usage: { input_tokens: 10, output_tokens: 0 },
    };
    const makeThresholdFetch = () =>
      (async () =>
        new Response(JSON.stringify(thresholdResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;

    const highReq: ProviderRequest = {
      ...baseRequest,
      options: { ...baseRequest.options, compat: { boolean_threshold: 0.9 } },
    };
    const lowReq: ProviderRequest = {
      ...baseRequest,
      options: { ...baseRequest.options, compat: { boolean_threshold: 0.5 } },
    };
    const highEvents = await collectProviderEvents(options.factory(makeThresholdFetch()), highReq);
    const lowEvents = await collectProviderEvents(options.factory(makeThresholdFetch()), lowReq);
    const highText = highEvents.find((e) => e.type === "content_delta" && e.content.type === "text");
    const lowText = lowEvents.find((e) => e.type === "content_delta" && e.content.type === "text");
    const highParsed = JSON.parse(
      highText && highText.type === "content_delta" && highText.content.type === "text" ? highText.content.text : "{}",
    );
    const lowParsed = JSON.parse(
      lowText && lowText.type === "content_delta" && lowText.content.type === "text" ? lowText.content.text : "{}",
    );
    if (highParsed.irreversible !== false) {
      throw new Error(`systemOneConformance: 0.6 noul under 0.9 threshold should be false, got ${highParsed.irreversible}`);
    }
    if (lowParsed.irreversible !== true) {
      throw new Error(`systemOneConformance: 0.6 noul under 0.5 threshold should be true, got ${lowParsed.irreversible}`);
    }
    scenarios.push({ name: "boolean-threshold-validation", ok: true });
  }

  // 5. 401 and 422 mapping
  {
    const canary401 = "sk-bad-secret-401";
    let attempts401 = 0;
    const fetch401 = (async () => {
      attempts401++;
      return new Response(JSON.stringify({ error: { code: "invalid_api_key", message: `bad key ${canary401}` } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const events401 = await collectProviderEvents(options.factory(fetch401, { apiKey: async () => canary401 }), baseRequest);
    if (attempts401 !== 1) throw new Error(`systemOneConformance: 401 must not be retried, attempts: ${attempts401}`);
    const term401 = events401.at(-1);
    if (term401?.type !== "error" || !term401.error.message.includes("401")) {
      throw new Error("systemOneConformance: 401 response must yield error event mentioning 401");
    }
    if (term401.error.message.includes(canary401)) {
      throw new Error("systemOneConformance: 401 error message must redact API key");
    }
    assertNoSecretLeak(events401, [canary401]);

    let attempts422 = 0;
    const detail422 = "questions.verdict.criteria: expected at least 2 options";
    const fetch422 = (async () => {
      attempts422++;
      return new Response(JSON.stringify({ error: { code: "invalid_request", message: detail422 } }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const events422 = await collectProviderEvents(options.factory(fetch422), baseRequest);
    if (attempts422 !== 1) throw new Error(`systemOneConformance: 422 must not be retried, attempts: ${attempts422}`);
    const term422 = events422.at(-1);
    if (term422?.type !== "error" || !term422.error.message.includes("expected at least 2 options")) {
      throw new Error("systemOneConformance: 422 response must surface field detail in error event");
    }
    scenarios.push({ name: "error-mapping-401-422", ok: true });
  }
  for (const badAnswer of [
    { type: "choice", choice: "ask", confidence: 2 },
    { type: "choice", choice: "ask", probabilities: { ask: -1 } },
    { type: "choice", choice: 123 },
  ]) {
    const malformedFetch = (async () =>
      new Response(JSON.stringify({ ...OK_RESPONSE, answers: { verdict: badAnswer } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const events = await collectProviderEvents(options.factory(malformedFetch), baseRequest);
    const term = events.at(-1);
    if (term?.type !== "error" || events.some((e) => e.type === "done" || e.type === "content_delta")) {
      throw new Error("systemOneConformance: malformed success must yield error event and no decision");
    }
  }
  scenarios.push({ name: "malformed-success-rejected", ok: true });

  // 7. Credential resolution once per request and no secret leak
  {
    let resolutions = 0;
    const secret = "rotating-systemone-conformance-credential";
    const keySource: SecretSource = async () => {
      resolutions++;
      return secret;
    };
    const failingFetch = (async (_input: unknown, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== `Bearer ${secret}`) {
        throw new Error(`systemOneConformance: expected Bearer ${secret}, got ${auth}`);
      }
      throw new Error(`transport failed with ${secret}`);
    }) as unknown as typeof fetch;
    const events = await collectProviderEvents(options.factory(failingFetch, { apiKey: keySource }), baseRequest);
    if (resolutions !== 1) {
      throw new Error(`systemOneConformance: credential must resolve once per request, resolved ${resolutions} times`);
    }
    const term = events.at(-1);
    if (term?.type !== "error") {
      throw new Error("systemOneConformance: expected error event on transport failure");
    }
    assertNoSecretLeak(events, [secret]);
    scenarios.push({ name: "credential-resolution-once-and-redacted", ok: true });
  }

  // 8. Key policy: anonymous keyless when keyRequired === false
  if (options.keyRequired === false) {
    let capturedAuth: string | null = null;
    const fake = (async (_input: unknown, init?: RequestInit) => {
      capturedAuth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify(OK_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await collectProviderEvents(options.factory(fake), baseRequest);
    if (capturedAuth !== null) {
      throw new Error(`systemOneConformance: keyRequired: false must send no authorization header without a key, got ${capturedAuth}`);
    }
    scenarios.push({ name: "keyless-sends-no-auth", ok: true });
  }
  await assertAbortIsObserved({ provider: options.factory(), request: baseRequest });
  scenarios.push({ name: "abort-observed", ok: true });

  // 10. decisions(): raw answers, images, custom path, error mapping, credential resolution
  {
    if (!probe.decisions) throw new Error("systemOneConformance: provider must expose decisions()");

    const decideResponse = {
      model: `${probe.id}-checkpoint`,
      answers: {
        urgent: { type: "noul", noul: 0.93 },
        team: { type: "choice", choice: "billing", probabilities: { billing: 0.71, shipping: 0.29 }, confidence: 0.71 },
        severity: {
          type: "score",
          score: 2.4,
          legend: { "1": "low", "2": "medium", "3": "high" },
          probabilities: { "1": 0.1, "2": 0.5, "3": 0.4 },
          confidence: 0.5,
        },
      },
      usage: { input_tokens: 64, output_tokens: 0 },
    } as const;
    const questions = {
      urgent: { type: "noul", instructions: "Is the customer blocked right now?" },
      team: { type: "choice", instructions: "Which team owns this?", criteria: { billing: null, shipping: null } },
      severity: { type: "score", instructions: "How severe is it?", criteria: ["low", "medium", "high"] },
    } as const;

    // Raw answers, probabilities intact, and no images key on a text-only body.
    let decideBody: Record<string, unknown> | undefined;
    const decideFetch = (async (_input: unknown, init?: RequestInit) => {
      decideBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(decideResponse), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const adapter = options.factory(decideFetch).decisions!();
    const result = await adapter.decide({ model: modelConfig.model, state: "ticket", questions });
    if (JSON.stringify(result.answers) !== JSON.stringify(decideResponse.answers)) {
      throw new Error("systemOneConformance: decisions() must return raw answers with probabilities and confidence intact");
    }
    if (result.usage?.inputTokens !== 64 || !(typeof result.timingMs === "number" && result.timingMs >= 0)) {
      throw new Error("systemOneConformance: decisions() must map usage and timing");
    }
    const rawBody = await (async () => {
      await adapter.decide({ model: modelConfig.model, state: "ticket", questions });
      return decideBody;
    })();
    if (!rawBody || "images" in rawBody) throw new Error("systemOneConformance: decisions() must omit an empty images field");

    // Image input: sent only to a model whose capabilities declare it; rejected before fetch otherwise.
    const declaredInput = modelConfig.capabilities?.input;
    const image = "data:image/png;base64,iVBORw0KGgo=";
    let imageFetchCalls = 0;
    const imageFetch = (async (_input: unknown, init?: RequestInit) => {
      imageFetchCalls++;
      decideBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(decideResponse), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const imageAdapter = options.factory(imageFetch).decisions!();
    const textOnly = declaredInput !== undefined && !declaredInput.includes("image");
    if (textOnly) {
      let rejected: unknown;
      try {
        await imageAdapter.decide({ model: modelConfig.model, state: "ticket", questions, images: [image] });
      } catch (error) {
        rejected = error;
      }
      if (!(rejected instanceof DecisionsError) || rejected.code !== "invalid_request") {
        throw new Error("systemOneConformance: images to a text-only model must reject with DecisionsError(invalid_request)");
      }
      if (imageFetchCalls !== 0) throw new Error("systemOneConformance: text-only image rejection must happen before fetch");
    } else {
      await imageAdapter.decide({ model: modelConfig.model, state: "ticket", questions, images: [image] });
      if (!Array.isArray(decideBody?.images) || (decideBody!.images as string[])[0] !== image) {
        throw new Error("systemOneConformance: an image-capable or unknown model must forward images as data URLs");
      }
    }

    // Custom path is honored; a relative path is a construction error.
    let customUrl: string | undefined;
    const customFetch = (async (input: unknown) => {
      customUrl = String(input);
      return new Response(JSON.stringify(decideResponse), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const customPath = "/providers/microsoft/v1/systemone";
    const customAdapter = options.factory(customFetch, { path: customPath }).decisions?.();
    await customAdapter!.decide({ model: modelConfig.model, state: "ticket", questions });
    if (!customUrl?.endsWith(customPath)) {
      throw new Error(`systemOneConformance: custom path not honored, url was ${customUrl}`);
    }
    let pathRejected = false;
    try {
      options.factory(undefined, { path: "v1/systemone" });
    } catch {
      pathRejected = true;
    }
    if (!pathRejected) throw new Error("systemOneConformance: a path without a leading slash must fail at construction");

    // 401/422 map to DecisionsError(invalid_request) and never retry or leak.
    for (const status of [401, 422] as const) {
      const canary = `sk-decide-${status}-secret`;
      let attempts = 0;
      const failingFetch = (async () => {
        attempts++;
        return new Response(JSON.stringify({ error: { code: "invalid_request", message: `rejected ${canary}` } }), {
          status,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;
      const failingAdapter = options.factory(failingFetch, { apiKey: async () => canary }).decisions?.();
      let mapped: unknown;
      try {
        await failingAdapter!.decide({ model: modelConfig.model, state: "ticket", questions });
      } catch (error) {
        mapped = error;
      }
      if (!(mapped instanceof DecisionsError) || mapped.code !== "invalid_request") {
        throw new Error(`systemOneConformance: ${status} must map to DecisionsError(invalid_request)`);
      }
      if (attempts !== 1) throw new Error(`systemOneConformance: ${status} must not be retried, attempts: ${attempts}`);
      if (mapped.message.includes(canary)) throw new Error(`systemOneConformance: ${status} decide error must redact the key`);
    }

    // Credential resolves once per decide, and a transport failure carries no secret.
    let resolutions = 0;
    const secret = "rotating-decide-credential";
    const keySource: SecretSource = async () => {
      resolutions++;
      return secret;
    };
    const throwingFetch = (async (_input: unknown, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== `Bearer ${secret}`) throw new Error(`systemOneConformance: expected Bearer secret, got ${auth}`);
      throw new Error(`transport failed with ${secret}`);
    }) as unknown as typeof fetch;
    const throwingAdapter = options.factory(throwingFetch, { apiKey: keySource }).decisions?.();
    let transportError: unknown;
    try {
      await throwingAdapter!.decide({ model: modelConfig.model, state: "ticket", questions });
    } catch (error) {
      transportError = error;
    }
    if (resolutions !== 1) throw new Error(`systemOneConformance: decide must resolve the credential once, resolved ${resolutions}`);
    if (!(transportError instanceof DecisionsError) || transportError.message.includes(secret)) {
      throw new Error("systemOneConformance: decide transport failure must be a DecisionsError with the key redacted");
    }
    scenarios.push({ name: "decisions-raw-answers-images-path-and-errors", ok: true });
  }

  // 11. Wire recordings replay
  if (options.recordings) {
    const recordingsDir = options.recordings instanceof URL ? fileURLToPath(options.recordings) : resolve(String(options.recordings));
    if (existsSync(recordingsDir)) {
      const files = findJsonFiles(recordingsDir);
      for (const file of files) {
        const scenarioName = basename(file, ".json");
        const raw = readFileSync(file, "utf8");
        const parsed = JSON.parse(raw);
        const exchanges: RecordedExchange[] = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === "object" && "responseBody" in parsed
            ? [parsed as RecordedExchange]
            : [];
        if (exchanges.length === 0) continue;

        let requestForScenario: ProviderRequest;
        if (parsed.request) {
          requestForScenario = {
            ...parsed.request,
            model: {
              ...modelConfig,
              ...parsed.request.model,
              capabilities: parsed.request.model?.capabilities ?? modelConfig.capabilities,
            },
          };
        } else {
          requestForScenario = baseRequest;
        }

        const replay = replayFetch(exchanges);
        const provider = options.factory(replay as unknown as typeof fetch, { apiKey: async () => "conformance-wire-key" });

        const events = await collectProviderEvents(provider, requestForScenario);
        const terminal = events.at(-1);
        if (!terminal || (terminal.type !== "done" && terminal.type !== "error")) {
          throw new Error(`systemOneConformance: recorded scenario "${scenarioName}" must end with done or error`);
        }
        if (exchanges[0]?.status && exchanges[0].status >= 400) {
          if (terminal.type !== "error") {
            throw new Error(
              `systemOneConformance: recorded scenario "${scenarioName}" expected error event for status ${exchanges[0].status}`,
            );
          }
        } else {
          if (terminal.type !== "done") {
            throw new Error(
              `systemOneConformance: recorded scenario "${scenarioName}" expected done event, got ${terminal.type}${
                terminal.type === "error" ? `: ${terminal.error.message}` : ""
              }`,
            );
          }
        }
        assertNoSecretLeak(events, ["conformance-wire-key"]);
        scenarios.push({ name: `wire:${scenarioName}`, ok: true, events });
      }
    }
  }

  return { ok: true, scenarios };
}
