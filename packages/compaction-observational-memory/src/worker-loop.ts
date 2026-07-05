import type { AIProvider, JsonObject, Message, ModelConfig, ProviderRequestOptions, ToolCallContent, ToolDefinition, ToolResult } from "@arnilo/prism";
import { mergeProviderRequestOptions, redactSecrets } from "@arnilo/prism";

export interface MemoryWorkerLoopOptions {
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
  const messages: Message[] = [
    { role: "system", content: [{ type: "text", text: redactSecrets(options.system, options.secrets ?? []) }] },
    { role: "user", content: [{ type: "text", text: redactSecrets(options.prompt, options.secrets ?? []) }] },
  ];
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  for (let turn = 0; turn < options.maxTurns; turn += 1) {
    const calls: ToolCallContent[] = [];
    for await (const event of options.provider.generate({
      model: options.model,
      messages,
      tools: options.tools,
      options: mergeProviderRequestOptions(options.providerOptions, options.thinkingLevel ? { extra: { thinkingLevel: options.thinkingLevel } } : undefined),
      signal: options.signal,
    })) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Observational memory worker aborted");
      if (event.type === "error") throw new Error(event.error.message);
      if (event.type === "tool_call") calls.push(event.call);
    }
    const executableCalls = calls.filter((call) => tools.has(call.name));
    if (!executableCalls.length) return;
    messages.push({ role: "assistant", content: executableCalls });
    for (const call of executableCalls) {
      const tool = tools.get(call.name)!;
      const result = await tool.execute(call.arguments as JsonObject, { sessionId: "observational-memory", runId: "observational-memory", toolCallId: call.id, signal: options.signal });
      messages.push(toolResultMessage(result));
    }
  }
}

function toolResultMessage(result: ToolResult): Message {
  return { role: "tool", content: [{ type: "tool_result", toolCallId: result.toolCallId, name: result.name, result: result.value, error: result.error }] };
}
