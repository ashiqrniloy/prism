import type { AIProvider, ContentBlock, JsonObject, ProviderEvent, ProviderRequest, ToolCallContent, Usage } from "../contracts.js";
import { reconstructToolCallDeltas } from "../provider-events.js";

export interface ProviderStreamConformanceOptions {
  readonly provider: AIProvider;
  readonly request: ProviderRequest;
  readonly expect?: {
    readonly text?: string;
    readonly usage?: Usage;
  };
}

export interface ProviderAbortConformanceOptions {
  readonly provider: AIProvider;
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

export interface ProviderSecretLeakConformanceOptions {
  readonly events: readonly ProviderEvent[];
  readonly secrets: readonly string[];
}

export async function collectProviderEvents(provider: AIProvider, request: ProviderRequest): Promise<readonly ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate(request)) events.push(event);
  return events;
}

export async function assertProviderStreamConforms(options: ProviderStreamConformanceOptions): Promise<readonly ProviderEvent[]> {
  const events = await collectProviderEvents(options.provider, options.request);
  const terminal = events.at(-1);
  if (!terminal || (terminal.type !== "done" && terminal.type !== "error")) throw new Error("Provider stream must end with done or error");
  if (events.slice(0, -1).some((event) => event.type === "done" || event.type === "error")) throw new Error("Provider stream terminal event must be last");

  if (options.expect?.text !== undefined && textFrom(events) !== options.expect.text) throw new Error(`Provider text mismatch: expected ${JSON.stringify(options.expect.text)}`);
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

export function assertToolCallDeltasReconstruct(events: readonly ProviderEvent[], expected: readonly ToolCallDeltaExpectation[]): readonly ToolCallContent[] {
  const calls = reconstructToolCallDeltas(events);
  for (const item of expected) {
    const call = calls[item.index];
    if (!call) throw new Error(`Missing tool call at index ${item.index}`);
    if (item.id !== undefined && call.id !== item.id) throw new Error(`Tool call id mismatch at index ${item.index}`);
    if (item.name !== undefined && call.name !== item.name) throw new Error(`Tool call name mismatch at index ${item.index}`);
    if (item.arguments !== undefined && JSON.stringify(call.arguments) !== JSON.stringify(item.arguments)) throw new Error(`Tool call arguments mismatch at index ${item.index}`);
  }
  return calls;
}

export function assertSerializedRequestCoversContent(request: ProviderRequest, body: unknown, options: SerializedContentCoverageOptions = {}): void {
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

export function assertNoSecretLeak(events: readonly ProviderEvent[], secrets: readonly string[]): void {
  const eventText = JSON.stringify(events);
  for (const secret of secrets) {
    if (!secret) continue;
    if (eventText.includes(secret)) throw new Error(`Secret leaked into provider events: ${secret.slice(0, 8)}...`);
  }
}

export function assertUsageAccounting(events: readonly ProviderEvent[], expected: Usage): Usage {
  const usage = [...events].reverse().find((event) => event.type === "done" && event.usage || event.type === "usage") as Extract<ProviderEvent, { type: "usage" | "done" }> | undefined;
  const actual = usage?.type === "usage" ? usage.usage : usage?.usage;
  if (!actual) throw new Error("Provider stream did not include usage");
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
    if (expected[key] !== undefined && actual[key] !== expected[key]) throw new Error(`Usage ${key} mismatch: expected ${expected[key]}, got ${actual[key]}`);
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
      return [block.url, block.data, block.mimeType].filter((value): value is string => typeof value === "string" && value.length > 0);
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
  return events.map((event) => event.type === "content_delta" && event.content.type === "text" ? event.content.text : "").join("");
}
