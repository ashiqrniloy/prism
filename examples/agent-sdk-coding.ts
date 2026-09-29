import { type AgentEvent, type ToolRegistry, createMockProvider, providerDone, providerTextDelta, providerUsage } from "@arnilo/prism";
import { type AgentSdkConfig, codingPreset, defineAgent, mergeAgentConfig } from "@arnilo/prism-agent-sdk";

// Demonstrates assembling a coding agent using `@arnilo/prism-agent-sdk`
// with `codingPreset`, mock provider, and session execution.
export async function demo(): Promise<{
  readonly toolCount: number;
  readonly eventTypes: readonly string[];
  readonly connectedMcpServers: readonly string[];
}> {
  const provider = createMockProvider([
    providerTextDelta("I am ready to edit code."),
    providerUsage({ inputTokens: 10, outputTokens: 8, totalTokens: 18 }),
    providerDone(),
  ]);

  // Define agent using the coding preset merged with model, provider, and instructions
  const app = await defineAgent(
    mergeAgentConfig(codingPreset({ cwd: process.cwd() }), {
      model: { provider: "mock", model: "coding-assistant" },
      provider,
      instructions: "You are a helpful coding assistant.",
    }) as AgentSdkConfig,
  );

  const session = app.createSession();
  const eventTypes: string[] = [];

  async function drain(): Promise<void> {
    for await (const event of session.subscribe() as AsyncIterable<AgentEvent>) {
      eventTypes.push(event.type);
    }
  }

  await Promise.all([drain(), session.run("Review the repository layout")]);

  const toolCount = (app.agent.config.tools as ToolRegistry).list().length;
  const connectedMcpServers = app.connectedMcpServerIds;

  await app.dispose();

  return {
    toolCount,
    eventTypes,
    connectedMcpServers,
  };
}

export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
