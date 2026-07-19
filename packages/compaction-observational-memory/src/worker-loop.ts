import type { AIProvider, JsonObject, Message, ModelConfig, ProviderRequestOptions, ToolCallContent, ToolDefinition, ToolResult } from "@arnilo/prism";
import { applyThinkingLevel, redactSecrets, thinkingFamilyForModel } from "@arnilo/prism";
import { measureWorkerJson, resolveMemoryWorkerLimits, truncateWorkerText, type MemoryWorkerLimitOptions } from "./limits.js";

export interface MemoryWorkerLoopOptions extends MemoryWorkerLimitOptions {
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly system: string;
  readonly prompt: string;
  readonly tools: readonly ToolDefinition[];
  readonly maxTurns: number;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export async function runMemoryWorkerLoop(options: MemoryWorkerLoopOptions): Promise<void> {
  throwIfAborted(options.signal);
  const limits = resolveMemoryWorkerLimits(options);
  const secrets = options.secrets ?? [];
  const messages: Message[] = [];
  let messageBytes = 2;
  const messageSize = (message: Message): number => {
    const bytes = measureWorkerJson(message, limits.maxMessageBytes, "Observational memory worker message");
    const next = messageBytes + (messages.length ? 1 : 0) + bytes;
    if (next > limits.maxMessageBytes) throw new Error(`Observational memory worker messages exceed ${limits.maxMessageBytes} bytes`);
    return next;
  };
  const addMessage = (message: Message): void => {
    messageBytes = messageSize(message);
    messages.push(message);
  };
  addMessage({ role: "system", content: [{ type: "text", text: redactSecrets(options.system, secrets) }] });
  addMessage({ role: "user", content: [{ type: "text", text: redactSecrets(options.prompt, secrets) }] });

  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  let totalCalls = 0;
  for (let turn = 0; turn < limits.maxTurns; turn += 1) {
    const calls: { readonly raw: ToolCallContent; readonly safe: ToolCallContent }[] = [];
    const thinkingFamily = thinkingFamilyForModel(options.model);
    try {
      throwIfAborted(options.signal);
      for await (const event of options.provider.generate({
        model: options.model,
        messages,
        tools: options.tools,
        options: options.thinkingLevel
          ? applyThinkingLevel(
              options.providerOptions,
              options.thinkingLevel,
              // Explicit host thinkingLevel must not become inert on unknown models.
              thinkingFamily === "noop" ? "reasoning_effort" : thinkingFamily,
            )
          : options.providerOptions,
        signal: options.signal,
      })) {
        throwIfAborted(options.signal);
        if (event.type === "error") throw new Error(safeWorkerError(event.error, secrets, limits.maxErrorBytes));
        if (event.type !== "tool_call") continue;
        if (calls.length >= limits.maxToolCallsPerTurn) throw new Error(`Observational memory worker exceeds ${limits.maxToolCallsPerTurn} tool calls per turn`);
        totalCalls += 1;
        if (totalCalls > limits.maxToolCalls) throw new Error(`Observational memory worker exceeds ${limits.maxToolCalls} total tool calls`);
        const tool = tools.get(event.call.name);
        if (!tool) throw new Error(`Unknown observational memory tool: ${truncateWorkerText(redactSecrets(event.call.name, secrets), limits.maxErrorBytes)}`);
        measureWorkerJson(event.call, limits.maxMessageBytes, "Observational memory tool call");
        measureWorkerJson(event.call.arguments, limits.maxArgumentBytes, "Observational memory tool arguments");
        const safe = redactSecrets(event.call, secrets);
        measureWorkerJson(safe.arguments, limits.maxArgumentBytes, "Redacted observational memory tool arguments");
        messageSize({ role: "assistant", content: [...calls.map((call) => call.safe), safe] });
        calls.push({ raw: event.call, safe });
      }
    } catch (error) {
      throwIfAborted(options.signal);
      if (error instanceof Error && /^(Observational memory|Unknown observational)/.test(error.message)) throw error;
      throw new Error(safeWorkerError(error, secrets, limits.maxErrorBytes));
    }

    if (!calls.length) return;
    addMessage({ role: "assistant", content: calls.map((call) => call.safe) });
    for (const call of calls) {
      const tool = tools.get(call.raw.name)!;
      let result: ToolResult;
      try {
        result = await tool.execute(call.raw.arguments as JsonObject, { sessionId: "observational-memory", runId: "observational-memory", toolCallId: call.raw.id, signal: options.signal });
      } catch (error) {
        throwIfAborted(options.signal);
        throw new Error(safeWorkerError(error, secrets, limits.maxErrorBytes));
      }
      measureWorkerJson(result, limits.maxResultBytes, "Observational memory tool result");
      const payload = { result: result.value, error: result.error };
      measureWorkerJson(payload, limits.maxResultBytes, "Observational memory tool result payload");
      const safePayload = redactSecrets(payload, secrets);
      measureWorkerJson(safePayload, limits.maxResultBytes, "Redacted observational memory tool result");
      addMessage(toolResultMessage(call.safe, safePayload));
    }
  }
}

function toolResultMessage(call: ToolCallContent, payload: { readonly result?: unknown; readonly error?: ToolResult["error"] }): Message {
  return { role: "tool", content: [{ type: "tool_result", toolCallId: call.id, name: call.name, result: payload.result, error: payload.error }] };
}

function safeWorkerError(error: unknown, secrets: readonly (string | undefined)[], maxBytes: number): string {
  const message = error instanceof Error ? error.message : "Observational memory worker failed";
  return truncateWorkerText(redactSecrets(message, secrets), maxBytes) || "Observational memory worker failed";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Observational memory worker aborted");
}
