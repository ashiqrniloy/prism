import type { AIProvider, JsonObject, ProviderEvent, ProviderRequest, ToolCallContent, Usage } from "../contracts.js";

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

export function assertUsageAccounting(events: readonly ProviderEvent[], expected: Usage): Usage {
  const usage = [...events].reverse().find((event) => event.type === "done" && event.usage || event.type === "usage") as Extract<ProviderEvent, { type: "usage" | "done" }> | undefined;
  const actual = usage?.type === "usage" ? usage.usage : usage?.usage;
  if (!actual) throw new Error("Provider stream did not include usage");
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
    if (expected[key] !== undefined && actual[key] !== expected[key]) throw new Error(`Usage ${key} mismatch: expected ${expected[key]}, got ${actual[key]}`);
  }
  return actual;
}

function reconstructToolCallDeltas(events: readonly ProviderEvent[]): ToolCallContent[] {
  const partials = new Map<number, { id?: string; name?: string; argumentsText: string }>();
  for (const event of events) {
    if (event.type !== "tool_call_delta") continue;
    const partial = partials.get(event.index) ?? { argumentsText: "" };
    if (event.id !== undefined) partial.id = event.id;
    if (event.name !== undefined) partial.name = event.name;
    if (event.argumentsText !== undefined) partial.argumentsText += event.argumentsText;
    partials.set(event.index, partial);
  }
  return [...partials.entries()].sort(([a], [b]) => a - b).map(([index, partial]) => {
    if (!partial.id || !partial.name) throw new Error(`Incomplete tool call delta at index ${index}`);
    return { type: "tool_call", id: partial.id, name: partial.name, arguments: parseArguments(partial.argumentsText, index) };
  });
}

function parseArguments(text: string, index: number): JsonObject {
  try {
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value as JsonObject;
  } catch (error) {
    throw new Error(`Invalid tool call arguments at index ${index}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function textFrom(events: readonly ProviderEvent[]): string {
  return events.map((event) => event.type === "content_delta" && event.content.type === "text" ? event.content.text : "").join("");
}
